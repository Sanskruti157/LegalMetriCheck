import { useEffect, useState, useCallback } from 'react';
import {
  Search, ChevronRight, Calendar, AlertTriangle, CheckCircle2,
  XCircle, Loader2, FileText, MapPin, Package, ArrowLeft,
  ClipboardList, Clock, Eye, Printer, ShieldAlert, ShieldCheck
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import type {
  Inspection, InspectionStatus, EvidenceImage, OcrResult, ComplianceFinding, Verdict
} from '@/lib/supabase';
import ReportModal from '@/components/ReportModal';
import { generateReportNumber, type InspectionReportPayload } from '@/lib/reportGenerator';

const statusConfig: Record<InspectionStatus, { label: string; color: string; icon: typeof Clock }> = {
  draft: { label: 'Draft', color: 'text-slate-600 bg-slate-100 border-slate-200', icon: Clock },
  ocr_review: { label: 'OCR Review', color: 'text-blue-700 bg-blue-50 border-blue-200', icon: FileText },
  compliance_review: { label: 'Compliance Review', color: 'text-amber-700 bg-amber-50 border-amber-200', icon: AlertTriangle },
  submitted: { label: 'Submitted', color: 'text-indigo-700 bg-indigo-50 border-indigo-200', icon: ClipboardList },
  approved: { label: 'Approved', color: 'text-emerald-700 bg-emerald-50 border-emerald-200', icon: CheckCircle2 },
  rejected: { label: 'Rejected', color: 'text-red-700 bg-red-50 border-red-200', icon: XCircle },
};

const verdictConfig: Record<Verdict, { label: string; color: string }> = {
  pass: { label: 'PASS (COMPLIANT)', color: 'text-emerald-800 bg-emerald-100 border-emerald-300' },
  fail: { label: 'FAIL (VIOLATION)', color: 'text-red-800 bg-red-100 border-red-300' },
  conditional: { label: 'CONDITIONAL REVIEW', color: 'text-amber-800 bg-amber-100 border-amber-300' },
};

const STATUTORY_DECLARATIONS = [
  { key: 'product_name', label: 'Product / Commodity Name', rule: 'Rule 6(1)(b)' },
  { key: 'manufacturer_name', label: 'Manufacturer / Packer / Importer Name', rule: 'Rule 6(1)(a)' },
  { key: 'address', label: 'Complete Address with PIN Code', rule: 'Rule 6(1)(a)' },
  { key: 'net_quantity', label: 'Net Quantity (Standard Units)', rule: 'Rule 6(1)(c), Rules 12 & 13' },
  { key: 'mrp', label: 'Maximum Retail Price (incl. of all taxes)', rule: 'Rule 6(1)(e)' },
  { key: 'mfg_date', label: 'Month & Year of Mfg / Packing', rule: 'Rule 6(1)(d)' },
  { key: 'consumer_care', label: 'Consumer Care Contact Details', rule: 'Rule 6(1)(da)' },
  { key: 'batch_number', label: 'Batch / Lot / Code Number', rule: 'Rule 6(1)(g)' },
];

export default function InspectionRecordsPage() {
  const { profile } = useAuth();
  const isSupervisor = profile?.role === 'supervisor';

  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<InspectionStatus | 'all'>('all');
  const [verdictFilter, setVerdictFilter] = useState<string>('all');
  const [selectedInspection, setSelectedInspection] = useState<Inspection | null>(null);
  const [detailData, setDetailData] = useState<{
    evidence: EvidenceImage[];
    ocr: OcrResult | null;
    findings: ComplianceFinding[];
  } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [reportModalData, setReportModalData] = useState<InspectionReportPayload | null>(null);

  const fetchInspections = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('inspections')
      .select('*, officer:officer_profiles!inspections_officer_id_fkey(*)')
      .order('created_at', { ascending: false });

    if (searchQuery.trim()) {
      query = query.or(
        `product_name.ilike.%${searchQuery}%,location_name.ilike.%${searchQuery}%,jurisdiction.ilike.%${searchQuery}%,manufacturer_name.ilike.%${searchQuery}%`
      );
    }
    if (statusFilter !== 'all') {
      query = query.eq('status', statusFilter);
    }
    if (verdictFilter !== 'all') {
      query = query.eq('overall_verdict', verdictFilter);
    }

    const { data, error } = await query.limit(50);
    if (!error && data) {
      setInspections(data as unknown as Inspection[]);
    }
    setLoading(false);
  }, [searchQuery, statusFilter, verdictFilter]);

  useEffect(() => {
    fetchInspections();
  }, [fetchInspections]);

  const openDetail = async (inspection: Inspection) => {
    setSelectedInspection(inspection);
    setDetailLoading(true);

    const [evidenceRes, ocrRes, findingsRes] = await Promise.all([
      supabase.from('evidence_images').select('*').eq('inspection_id', inspection.id),
      supabase.from('ocr_results').select('*').eq('inspection_id', inspection.id).maybeSingle(),
      supabase.from('compliance_findings').select('*, rule:compliance_rules(*)').eq('inspection_id', inspection.id),
    ]);

    const evidence = (evidenceRes.data ?? []) as unknown as EvidenceImage[];
    const ocr = ocrRes.data as unknown as OcrResult | null;
    const findings = (findingsRes.data ?? []) as unknown as ComplianceFinding[];

    // Fetch signed URLs for private evidence bucket
    const urls: Record<string, string> = {};
    for (const img of evidence) {
      const cleanPath = img.storage_path.replace(/^evidence\//, '');
      const { data: signed } = await supabase.storage
        .from('evidence')
        .createSignedUrl(cleanPath, 3600);
      if (signed?.signedUrl) {
        urls[img.id] = signed.signedUrl;
      } else if (img.image_url) {
        urls[img.id] = img.image_url;
      }
    }

    setImageUrls(urls);
    setDetailData({ evidence, ocr, findings });
    setDetailLoading(false);
  };

  const handleOpenReport = (insp: Inspection) => {
    if (!detailData) return;
    const reportNum = generateReportNumber(insp.id);
    const activeOcr = detailData.ocr?.officer_corrected && detailData.ocr.corrected_fields
      ? { ...detailData.ocr.extracted_fields, ...detailData.ocr.corrected_fields }
      : detailData.ocr?.extracted_fields ?? {};

    const payload: InspectionReportPayload = {
      reportNumber: reportNum,
      inspection: insp,
      officer: insp.officer || profile,
      evidence: detailData.evidence,
      ocrFields: activeOcr,
      rawOcrText: detailData.ocr?.raw_text || undefined,
      findings: detailData.findings,
      evidenceUrls: imageUrls,
    };
    setReportModalData(payload);
  };

  if (selectedInspection) {
    return (
      <InspectionDetailView
        inspection={selectedInspection}
        detailData={detailData}
        detailLoading={detailLoading}
        imageUrls={imageUrls}
        isSupervisor={isSupervisor}
        onBack={() => {
          setSelectedInspection(null);
          setDetailData(null);
          fetchInspections();
        }}
        onGenerateReport={() => handleOpenReport(selectedInspection)}
        reportModalData={reportModalData}
        onCloseReportModal={() => setReportModalData(null)}
      />
    );
  }

  return (
    <div className="max-w-6xl mx-auto pb-16">
      <div className="mb-6">
        <div className="flex items-center gap-2 text-emerald-700 text-xs font-bold uppercase tracking-wider mb-1">
          <ClipboardList className="w-4 h-4 text-emerald-600" />
          Enforcement Records Repository
        </div>
        <h1 className="text-2xl font-bold text-slate-900">Packaged Commodity Inspections</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          {isSupervisor
            ? 'Supervisory oversight of all inspection records, evidence photos, violations, and printable statutory reports.'
            : 'Access your submitted inspection records, OCR text, and generate official Legal Metrology compliance reports.'}
        </p>
      </div>

      {/* Search & Filters */}
      <div className="mb-6 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search by product name, manufacturer, establishment, or jurisdiction..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 text-xs sm:text-sm"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as InspectionStatus | 'all')}
          className="px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
        >
          <option value="all">All Inspection Statuses</option>
          <option value="submitted">Submitted</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="compliance_review">In Compliance Review</option>
          <option value="ocr_review">In OCR Review</option>
        </select>

        <select
          value={verdictFilter}
          onChange={(e) => setVerdictFilter(e.target.value)}
          className="px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
        >
          <option value="all">All Statutory Verdicts</option>
          <option value="pass">Pass (Compliant)</option>
          <option value="fail">Fail (Non-Compliant)</option>
          <option value="conditional">Conditional / Notice Issued</option>
        </select>
      </div>

      {/* Inspections List */}
      <div className="rounded-2xl bg-white border border-slate-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
          </div>
        ) : inspections.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400">
              <ClipboardList className="w-7 h-7" />
            </div>
            <p className="font-bold text-slate-800 text-sm">No inspection records found</p>
            <p className="text-xs text-slate-400 max-w-sm text-center">
              {searchQuery || statusFilter !== 'all' || verdictFilter !== 'all'
                ? 'Try adjusting your search terms or filters.'
                : 'Start a new inspection to file your first packaged commodity check.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {inspections.map((insp) => {
              const sc = statusConfig[insp.status] || statusConfig.draft;
              const vc = insp.overall_verdict ? verdictConfig[insp.overall_verdict] : null;

              return (
                <div
                  key={insp.id}
                  onClick={() => openDetail(insp)}
                  className="flex items-center gap-4 p-4 hover:bg-slate-50/70 transition-colors cursor-pointer group"
                >
                  <div className="w-11 h-11 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center shrink-0 text-emerald-700 group-hover:bg-emerald-100 transition-colors">
                    <Package className="w-5 h-5" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-slate-900 truncate text-sm">
                        {insp.product_name ?? 'Packaged Commodity'}
                      </p>
                      {insp.manufacturer_name && (
                        <span className="text-xs text-slate-400 truncate hidden md:inline">
                          · {insp.manufacturer_name}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3 mt-1 text-xs text-slate-400 flex-wrap">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5" />
                        {new Date(insp.inspection_date).toLocaleDateString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </span>

                      {insp.location_name && (
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5" />
                          {insp.location_name}
                        </span>
                      )}

                      {insp.officer && (
                        <span className="text-slate-500 font-medium">
                          Officer: {insp.officer.full_name}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Verdict Badge */}
                  {vc && (
                    <div className={`px-2.5 py-1 rounded-lg border text-xs font-black shrink-0 ${vc.color}`}>
                      {vc.label}
                    </div>
                  )}

                  {/* Status Badge */}
                  <div className={`flex items-center gap-1.5 px-3 py-1 rounded-lg border text-xs font-bold shrink-0 ${sc.color}`}>
                    <sc.icon className="w-3.5 h-3.5" />
                    <span>{sc.label}</span>
                  </div>

                  <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-slate-500 transition-colors" />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function InspectionDetailView({
  inspection,
  detailData,
  detailLoading,
  imageUrls,
  isSupervisor,
  onBack,
  onGenerateReport,
  reportModalData,
  onCloseReportModal,
}: {
  inspection: Inspection;
  detailData: {
    evidence: EvidenceImage[];
    ocr: OcrResult | null;
    findings: ComplianceFinding[];
  } | null;
  detailLoading: boolean;
  imageUrls: Record<string, string>;
  isSupervisor: boolean;
  onBack: () => void;
  onGenerateReport: () => void;
  reportModalData: InspectionReportPayload | null;
  onCloseReportModal: () => void;
}) {
  const sc = statusConfig[inspection.status] || statusConfig.draft;
  const vc = inspection.overall_verdict ? verdictConfig[inspection.overall_verdict] : null;

  const [supervisorNotes, setSupervisorNotes] = useState(inspection.supervisor_notes ?? '');
  const [updating, setUpdating] = useState(false);
  const [showRawOcr, setShowRawOcr] = useState(false);

  const activeOcr = detailData?.ocr?.officer_corrected && detailData.ocr.corrected_fields
    ? { ...detailData.ocr.extracted_fields, ...detailData.ocr.corrected_fields }
    : detailData?.ocr?.extracted_fields ?? {};

  const handleSupervisorAction = async (newStatus: 'approved' | 'rejected') => {
    setUpdating(true);
    await supabase
      .from('inspections')
      .update({
        status: newStatus,
        supervisor_notes: supervisorNotes.trim() || null,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', inspection.id);
    inspection.status = newStatus;
    inspection.supervisor_notes = supervisorNotes.trim() || null;
    setUpdating(false);
  };

  return (
    <div className="max-w-4xl mx-auto pb-16">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" /> Back to Inspection Records
      </button>

      {/* Record Header */}
      <div className="p-6 rounded-2xl bg-white border border-slate-100 shadow-sm mb-6 flex flex-col sm:flex-row items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full">
              Legal Metrology Record
            </span>
            <span className="text-xs text-slate-400 font-mono">
              ID: {inspection.id.slice(0, 8)}
            </span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">
            {inspection.product_name ?? 'Packaged Commodity'}
          </h1>
          <div className="flex items-center gap-4 mt-2 text-xs text-slate-500 flex-wrap">
            <span className="flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" />
              {new Date(inspection.inspection_date).toLocaleString('en-IN', {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            </span>
            {inspection.location_name && (
              <span className="flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5" />
                {inspection.location_name}
              </span>
            )}
            {inspection.jurisdiction && (
              <span>Jurisdiction: <strong>{inspection.jurisdiction}</strong></span>
            )}
          </div>
        </div>

        <div className="flex flex-col sm:items-end gap-2.5">
          <div className="flex items-center gap-2">
            {vc && (
              <span className={`px-3 py-1 rounded-lg border text-xs font-black ${vc.color}`}>
                {vc.label}
              </span>
            )}
            <span className={`flex items-center gap-1.5 px-3 py-1 rounded-lg border text-xs font-bold ${sc.color}`}>
              <sc.icon className="w-3.5 h-3.5" />
              {sc.label}
            </span>
          </div>

          <button
            onClick={onGenerateReport}
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold flex items-center gap-2 text-xs shadow-sm shadow-emerald-600/20"
          >
            <Printer className="w-4 h-4" /> Print / Export Official Report
          </button>
        </div>
      </div>

      {detailLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Photographic Evidence Gallery */}
          {detailData && detailData.evidence.length > 0 && (
            <div className="p-6 rounded-2xl bg-white border border-slate-100 shadow-sm space-y-4">
              <h2 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                <Package className="w-4 h-4 text-emerald-600" />
                Photographic Evidence Captured on Field ({detailData.evidence.length})
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {detailData.evidence.map((img) => {
                  const url = imageUrls[img.id] || img.image_url;
                  return (
                    <div key={img.id} className="rounded-xl overflow-hidden border border-slate-200 bg-slate-950 group relative">
                      {url ? (
                        <a href={url} target="_blank" rel="noopener noreferrer">
                          <img src={url} alt={img.label} className="w-full h-36 object-cover opacity-90 group-hover:opacity-100 transition-opacity" />
                        </a>
                      ) : (
                        <div className="w-full h-36 flex items-center justify-center text-slate-500 text-xs">
                          Image Stored
                        </div>
                      )}
                      <div className="absolute bottom-0 inset-x-0 bg-slate-900/80 p-1.5 text-center">
                        <span className="text-[11px] font-bold text-white truncate block">
                          {img.label.replace(/_/g, ' ').toUpperCase()}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Statutory Declarations Table */}
          <div className="p-6 rounded-2xl bg-white border border-slate-100 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-emerald-600" />
                Statutory Mandatory Declarations (Rule 6, PC Rules, 2011)
              </h2>
              {detailData?.ocr?.raw_text && (
                <button
                  onClick={() => setShowRawOcr(!showRawOcr)}
                  className="text-xs text-emerald-700 hover:text-emerald-800 font-semibold flex items-center gap-1"
                >
                  <Eye className="w-3.5 h-3.5" />
                  {showRawOcr ? 'Hide Raw OCR Text' : 'View Raw OCR Text'}
                </button>
              )}
            </div>

            {showRawOcr && detailData?.ocr?.raw_text && (
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                <p className="text-[11px] font-bold text-slate-700 uppercase mb-1">OCR System Raw Text Output:</p>
                <pre className="text-xs text-slate-800 font-mono whitespace-pre-wrap max-h-48 overflow-y-auto bg-white p-3 rounded-lg border border-slate-200 leading-relaxed">
                  {detailData.ocr.raw_text}
                </pre>
              </div>
            )}

            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                  <tr>
                    <th className="p-3">Statutory Declaration</th>
                    <th className="p-3">Legal Metrology Provision</th>
                    <th className="p-3">Verified Value on Label</th>
                    <th className="p-3 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {STATUTORY_DECLARATIONS.map(({ key, label, rule }) => {
                    const val = (activeOcr as Record<string, string | undefined>)[key];
                    const isPresent = Boolean(val && val.trim().length > 0);
                    return (
                      <tr key={key} className={isPresent ? 'bg-white' : 'bg-amber-50/30'}>
                        <td className="p-3 font-semibold text-slate-900">{label}</td>
                        <td className="p-3 text-slate-500 font-mono text-[11px]">{rule}</td>
                        <td className="p-3 font-medium text-slate-800">
                          {isPresent ? val : <span className="text-amber-800 italic">Needs Manual Verification</span>}
                        </td>
                        <td className="p-3 text-right">
                          {isPresent ? (
                            <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                              VERIFIED
                            </span>
                          ) : (
                            <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                              UNVERIFIED
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Compliance Findings */}
          {detailData && detailData.findings.length > 0 && (
            <div className="p-6 rounded-2xl bg-white border border-slate-100 shadow-sm space-y-4">
              <h2 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                <ShieldAlert className="w-4 h-4 text-emerald-600" />
                Compliance Assessment Findings ({detailData.findings.length})
              </h2>

              <div className="space-y-3">
                {detailData.findings.map((f) => {
                  const isConfirmed = f.finding_type === 'confirmed';
                  return (
                    <div
                      key={f.id}
                      className={`p-4 rounded-xl border ${
                        isConfirmed
                          ? 'bg-red-50/70 border-red-200'
                          : 'bg-amber-50/60 border-amber-200'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                              isConfirmed ? 'bg-red-600 text-white' : 'bg-amber-200 text-amber-900'
                            }`}
                          >
                            {isConfirmed ? 'CONFIRMED VIOLATION' : 'POTENTIAL / MANUAL REVIEW'}
                          </span>
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              f.severity === 'critical'
                                ? 'bg-red-100 text-red-800'
                                : f.severity === 'major'
                                ? 'bg-orange-100 text-orange-800'
                                : 'bg-yellow-100 text-yellow-800'
                            }`}
                          >
                            {f.severity.toUpperCase()}
                          </span>
                        </div>
                        {f.rule && (
                          <span className="text-[11px] font-mono text-slate-500">{f.rule.rule_code}</span>
                        )}
                      </div>

                      <p className="text-xs font-bold text-slate-900">{f.description}</p>
                      {f.evidence_text && (
                        <p className="text-[11px] text-slate-600 mt-1">Evidence Text: "{f.evidence_text}"</p>
                      )}
                      {f.officer_observation && (
                        <p className="text-[11px] text-emerald-800 bg-emerald-50 p-2 rounded mt-2 border border-emerald-100">
                          <strong>Officer Note:</strong> {f.officer_observation}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Officer Field Notes */}
          {inspection.officer_notes && (
            <div className="p-6 rounded-2xl bg-white border border-slate-100 shadow-sm space-y-2">
              <h2 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                Inspecting Officer's Field Notes
              </h2>
              <p className="text-xs text-slate-700 bg-slate-50 p-3.5 rounded-xl border border-slate-200 leading-relaxed">
                {inspection.officer_notes}
              </p>
            </div>
          )}

          {/* Supervisor Review Panel */}
          {isSupervisor && (
            <div className="p-6 rounded-2xl bg-white border-2 border-blue-200 shadow-sm space-y-4">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-blue-600" />
                <h2 className="text-sm font-bold text-slate-900">
                  Supervisor Oversight & Review Panel
                </h2>
              </div>
              <p className="text-xs text-slate-500">
                As a supervisor in this jurisdiction, review the evidence and officer observations. Enter your regulatory decision below.
              </p>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-2">
                  Supervisor Directives / Regulatory Remarks
                </label>
                <textarea
                  value={supervisorNotes}
                  onChange={(e) => setSupervisorNotes(e.target.value)}
                  placeholder="Enter supervisory instructions, whether notice under Section 36 is to be dispatched, or compound fee ordered..."
                  rows={3}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                />
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  disabled={updating}
                  onClick={() => handleSupervisorAction('approved')}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm"
                >
                  <CheckCircle2 className="w-4 h-4" /> Approve Inspection
                </button>
                <button
                  type="button"
                  disabled={updating}
                  onClick={() => handleSupervisorAction('rejected')}
                  className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm"
                >
                  <XCircle className="w-4 h-4" /> Reject / Request Re-inspection
                </button>
              </div>
            </div>
          )}

          {/* Existing Supervisor Notes (View Only for Officers) */}
          {!isSupervisor && inspection.supervisor_notes && (
            <div className="p-6 rounded-2xl bg-white border border-blue-100 shadow-sm space-y-2">
              <h2 className="text-xs font-bold text-blue-900 uppercase tracking-wider flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-blue-600" />
                Supervisor Review & Orders
              </h2>
              <p className="text-xs text-blue-950 bg-blue-50 p-3.5 rounded-xl border border-blue-200 leading-relaxed">
                {inspection.supervisor_notes}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Report Modal */}
      {reportModalData && (
        <ReportModal
          data={reportModalData}
          onClose={onCloseReportModal}
        />
      )}
    </div>
  );
}
