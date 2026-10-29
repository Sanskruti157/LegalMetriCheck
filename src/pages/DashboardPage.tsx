import { useEffect, useState } from 'react';
import {
  Scan, ClipboardList, CheckCircle2, XCircle, AlertTriangle, Loader2,
  ChevronRight, Calendar, MapPin, ShieldCheck, Printer, Package
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import type { Inspection, EvidenceImage, OcrResult, ComplianceFinding } from '@/lib/supabase';
import ReportModal from '@/components/ReportModal';
import { generateReportNumber, type InspectionReportPayload } from '@/lib/reportGenerator';

interface Stats {
  total: number;
  pass: number;
  fail: number;
  conditional: number;
}

export default function DashboardPage({ onScan, onRecords }: { onScan: () => void; onRecords: () => void }) {
  const { profile } = useAuth();
  const isSupervisor = profile?.role === 'supervisor';

  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stats>({ total: 0, pass: 0, fail: 0, conditional: 0 });
  const [activeFilter, setActiveFilter] = useState<'all' | 'pass' | 'fail' | 'conditional'>('all');
  const [reportModalData, setReportModalData] = useState<InspectionReportPayload | null>(null);
  const [reportLoading, setReportLoading] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);

      // Query actual counts directly from Supabase
      const { count: totalCount } = await supabase
        .from('inspections')
        .select('*', { count: 'exact', head: true });

      const { count: passCount } = await supabase
        .from('inspections')
        .select('*', { count: 'exact', head: true })
        .eq('overall_verdict', 'pass');

      const { count: failCount } = await supabase
        .from('inspections')
        .select('*', { count: 'exact', head: true })
        .eq('overall_verdict', 'fail');

      const { count: condCount } = await supabase
        .from('inspections')
        .select('*', { count: 'exact', head: true })
        .or('overall_verdict.eq.conditional,overall_verdict.is.null');

      setStats({
        total: totalCount ?? 0,
        pass: passCount ?? 0,
        fail: failCount ?? 0,
        conditional: condCount ?? 0,
      });

      // Fetch recent inspections with officer relation
      const { data, error } = await supabase
        .from('inspections')
        .select('*, officer:officer_profiles!inspections_officer_id_fkey(*)')
        .order('created_at', { ascending: false })
        .limit(10);

      if (!error && data) {
        setInspections(data as unknown as Inspection[]);
      }
      setLoading(false);
    })();
  }, []);

  const openReportForInspection = async (insp: Inspection) => {
    setReportLoading(true);
    const [evidenceRes, ocrRes, findingsRes] = await Promise.all([
      supabase.from('evidence_images').select('*').eq('inspection_id', insp.id),
      supabase.from('ocr_results').select('*').eq('inspection_id', insp.id).maybeSingle(),
      supabase.from('compliance_findings').select('*, rule:compliance_rules(*)').eq('inspection_id', insp.id),
    ]);

    const evidence = (evidenceRes.data ?? []) as unknown as EvidenceImage[];
    const ocr = ocrRes.data as unknown as OcrResult | null;
    const findings = (findingsRes.data ?? []) as unknown as ComplianceFinding[];

    const urls: Record<string, string> = {};
    for (const img of evidence) {
      const cleanPath = img.storage_path.replace(/^evidence\//, '');
      const { data: signed } = await supabase.storage.from('evidence').createSignedUrl(cleanPath, 3600);
      if (signed?.signedUrl) urls[img.id] = signed.signedUrl;
      else if (img.image_url) urls[img.id] = img.image_url;
    }

    const activeOcr = ocr?.officer_corrected && ocr.corrected_fields
      ? { ...ocr.extracted_fields, ...ocr.corrected_fields }
      : ocr?.extracted_fields ?? {};

    const payload: InspectionReportPayload = {
      reportNumber: generateReportNumber(insp.id),
      inspection: insp,
      officer: insp.officer || profile,
      evidence,
      ocrFields: activeOcr,
      rawOcrText: ocr?.raw_text || undefined,
      findings,
      evidenceUrls: urls,
    };

    setReportModalData(payload);
    setReportLoading(false);
  };

  const statCards = [
    {
      id: 'all',
      label: 'Total Inspections',
      value: stats.total,
      icon: ClipboardList,
      color: 'text-slate-800',
      bg: 'bg-slate-100',
      border: 'border-slate-200',
      desc: 'All field inspection records filed',
    },
    {
      id: 'pass',
      label: 'Compliant (Pass)',
      value: stats.pass,
      icon: CheckCircle2,
      color: 'text-emerald-700',
      bg: 'bg-emerald-50',
      border: 'border-emerald-200',
      desc: 'Full statutory label compliance',
    },
    {
      id: 'fail',
      label: 'Non-Compliant (Fail)',
      value: stats.fail,
      icon: XCircle,
      color: 'text-red-700',
      bg: 'bg-red-50',
      border: 'border-red-200',
      desc: 'Statutory violations confirmed',
    },
    {
      id: 'conditional',
      label: 'Pending Review / Notice',
      value: stats.conditional,
      icon: AlertTriangle,
      color: 'text-amber-700',
      bg: 'bg-amber-50',
      border: 'border-amber-200',
      desc: 'Requires supervisory review',
    },
  ];

  const filteredInspections = inspections.filter((insp) => {
    if (activeFilter === 'all') return true;
    if (activeFilter === 'pass') return insp.overall_verdict === 'pass';
    if (activeFilter === 'fail') return insp.overall_verdict === 'fail';
    if (activeFilter === 'conditional') return insp.overall_verdict === 'conditional' || !insp.overall_verdict;
    return true;
  });

  return (
    <div className="max-w-5xl mx-auto pb-16">
      {/* Dashboard Header */}
      <div className="mb-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-emerald-700 text-xs font-bold uppercase tracking-wider mb-1">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            Legal Metrology Act, 2009 Enforcement
          </div>
          <h1 className="text-2xl font-bold text-slate-900">
            {isSupervisor ? 'Supervisor Enforcement Dashboard' : 'Inspecting Officer Dashboard'}
          </h1>
          <p className="text-slate-500 text-xs sm:text-sm mt-0.5">
            {isSupervisor
              ? `Jurisdictional oversight of packaged commodities in ${profile?.assigned_jurisdiction ?? 'all districts'}.`
              : `Overview of packaged commodities inspected by ${profile?.full_name ?? 'Enforcement Officer'}.`}
          </p>
        </div>

        {!isSupervisor && (
          <button
            onClick={onScan}
            className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold flex items-center gap-2 transition-all shadow-md shadow-emerald-600/20 text-xs sm:text-sm"
          >
            <Scan className="w-4 h-4" />
            New Inspection
          </button>
        )}
      </div>

      {/* Stats Cards (Interactive filters) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {statCards.map((s) => (
          <div
            key={s.id}
            onClick={() => setActiveFilter(s.id as typeof activeFilter)}
            className={`p-5 rounded-2xl bg-white border cursor-pointer transition-all hover:shadow-md ${
              activeFilter === s.id
                ? 'border-emerald-500 ring-2 ring-emerald-500/20 shadow-sm'
                : 'border-slate-100 shadow-xs'
            }`}
          >
            <div className="flex items-center justify-between mb-3">
              <div className={`w-10 h-10 rounded-xl ${s.bg} flex items-center justify-center`}>
                <s.icon className={`w-5 h-5 ${s.color}`} />
              </div>
              {activeFilter === s.id && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                  ACTIVE
                </span>
              )}
            </div>
            <p className="text-3xl font-black text-slate-900 tracking-tight">{s.value}</p>
            <p className="text-xs font-bold text-slate-700 mt-1">{s.label}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">{s.desc}</p>
          </div>
        ))}
      </div>

      {/* Recent Inspections Table */}
      <div className="rounded-2xl bg-white border border-slate-100 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-emerald-600" />
            <div>
              <h2 className="font-bold text-slate-900 text-sm">
                Recent Packaged Commodity Inspections
              </h2>
              <p className="text-xs text-slate-400">
                {activeFilter === 'all'
                  ? 'Showing all recent inspection records'
                  : `Filtered by: ${activeFilter.toUpperCase()}`}
              </p>
            </div>
          </div>
          <button
            onClick={onRecords}
            className="text-xs text-emerald-700 hover:text-emerald-800 font-bold flex items-center gap-1 transition-colors"
          >
            View All Records
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
          </div>
        ) : filteredInspections.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center text-slate-400">
              <Package className="w-6 h-6" />
            </div>
            <p className="font-bold text-slate-800 text-sm">No inspections match this filter</p>
            <p className="text-xs text-slate-400">
              {activeFilter !== 'all' ? 'Try clicking "Total Inspections" to see all records.' : 'Start a new inspection to add records.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredInspections.map((insp) => {
              const verdictBadge = {
                pass: { label: 'PASS', color: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
                fail: { label: 'FAIL', color: 'bg-red-100 text-red-800 border-red-200' },
                conditional: { label: 'CONDITIONAL', color: 'bg-amber-100 text-amber-800 border-amber-200' },
              }[insp.overall_verdict ?? 'conditional'];

              return (
                <div
                  key={insp.id}
                  className="p-4 hover:bg-slate-50/70 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="flex items-start gap-3.5">
                    <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-700 shrink-0 mt-0.5">
                      <Package className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900 text-sm">
                          {insp.product_name ?? 'Packaged Commodity'}
                        </span>
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded border ${verdictBadge.color}`}>
                          {verdictBadge.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-400 mt-1 flex-wrap">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {new Date(insp.inspection_date).toLocaleDateString('en-IN', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </span>
                        {insp.location_name && (
                          <span className="flex items-center gap-1">
                            <MapPin className="w-3 h-3" />
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
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-auto">
                    <button
                      onClick={() => openReportForInspection(insp)}
                      disabled={reportLoading}
                      className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-emerald-50 hover:text-emerald-800 text-slate-700 text-xs font-bold flex items-center gap-1.5 transition-colors"
                      title="View & Print Inspection Report"
                    >
                      <Printer className="w-3.5 h-3.5 text-slate-500" />
                      Report
                    </button>
                    <button
                      onClick={onRecords}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                      title="Open full record"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Report Modal */}
      {reportModalData && (
        <ReportModal
          data={reportModalData}
          onClose={() => setReportModalData(null)}
        />
      )}
    </div>
  );
}
