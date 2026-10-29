import { useState, useRef, useCallback, useEffect } from 'react';
import {
  Camera, Upload, Scan, X, Loader2, CheckCircle2, AlertTriangle, FileText,
  ArrowRight, ArrowLeft, MapPin, Building2, ImageIcon,
  Edit3, ShieldAlert, ShieldCheck, Send, Eye, Plus, ChevronLeft, ChevronRight,
  Printer, Check
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import type { OcrExtractedFields, ComplianceRule, EvidenceImage, Verdict } from '@/lib/supabase';
import {
  callOcrExtractMultiple,
  callComplianceCheck,
  dataUrlToBlob,
  type PotentialFinding,
  type OcrImageInput
} from '@/lib/ocrService';
import ReportModal from '@/components/ReportModal';
import { generateReportNumber, type InspectionReportPayload } from '@/lib/reportGenerator';

type Step = 'details' | 'upload' | 'ocr_review' | 'compliance_review' | 'submitted';

const ALL_OCR_FIELDS: { key: keyof OcrExtractedFields; label: string; ruleRef: string; description: string }[] = [
  { key: 'product_name', label: 'Product / Commodity Name', ruleRef: 'Rule 6(1)(b)', description: 'Generic or common name of commodity' },
  { key: 'manufacturer_name', label: 'Manufacturer / Packer / Importer Name', ruleRef: 'Rule 6(1)(a)', description: 'Name of person/firm responsible for package' },
  { key: 'address', label: 'Complete Address with PIN Code', ruleRef: 'Rule 6(1)(a)', description: 'Premises, street, city & 6-digit postal PIN' },
  { key: 'net_quantity', label: 'Net Quantity (Standard Units)', ruleRef: 'Rule 6(1)(c), R.12-13', description: 'Quantity in standard metric units (g, kg, ml, L, N)' },
  { key: 'mrp', label: 'Maximum Retail Price (incl. of all taxes)', ruleRef: 'Rule 6(1)(e)', description: 'MRP in Rs./₹ with inclusive of all taxes clause' },
  { key: 'mfg_date', label: 'Month & Year of Mfg / Packing', ruleRef: 'Rule 6(1)(d)', description: 'Month & year of manufacture or pre-packing' },
  { key: 'consumer_care', label: 'Consumer Care Contact Details', ruleRef: 'Rule 6(1)(da)', description: 'Toll-free/phone number, email & address for grievances' },
  { key: 'batch_number', label: 'Batch / Lot / Code Number', ruleRef: 'Rule 6(1)(g)', description: 'Batch or identification mark for traceability' },
];

const IMAGE_LABELS = [
  { value: 'packaging_front', label: 'Front of Pack (PDP)', hint: 'Product name & net quantity' },
  { value: 'packaging_back', label: 'Back of Pack', hint: 'Manufacturer, address & consumer care' },
  { value: 'label_closeup', label: 'Label Close-up', hint: 'MRP, batch & packing date' },
  { value: 'other', label: 'Additional Evidence', hint: 'Side panel, barcode or seal' },
];

const RECOMMENDED_LABELS = ['packaging_front', 'packaging_back', 'label_closeup'];

/**
 * Resizes an image dataURL using an offscreen canvas to keep it under 800 KB
 * and within 1600px dimension. Perfect for high-accuracy OCR without hitting OCR.space 1MB limit.
 */
function resizeImageToFitLimit(dataUrl: string, maxDimension = 1600, quality = 0.85): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

export default function ScannerPage() {
  const { profile, user } = useAuth();
  const [step, setStep] = useState<Step>('details');
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Step 1: Inspection details
  const [locationName, setLocationName] = useState('');
  const [locationAddress, setLocationAddress] = useState('');
  const [jurisdiction, setJurisdiction] = useState(profile?.jurisdiction ?? profile?.assigned_jurisdiction ?? 'Central Enforcement');

  useEffect(() => {
    if (profile?.jurisdiction) {
      setJurisdiction(profile.jurisdiction);
    } else if (profile?.assigned_jurisdiction) {
      setJurisdiction(profile.assigned_jurisdiction);
    }
  }, [profile]);

  // Step 2: Image upload
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [evidenceImages, setEvidenceImages] = useState<{ dataUrl: string; label: string }[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraActive, setCameraActive] = useState(false);

  // Step 3: OCR review
  const [ocrFields, setOcrFields] = useState<Partial<OcrExtractedFields>>({});
  const [fieldsNotFound, setFieldsNotFound] = useState<string[]>([]);
  const [rawOcrText, setRawOcrText] = useState('');
  const [refImageIndex, setRefImageIndex] = useState(0);

  // Step 4: Compliance review
  const [potentialFindings, setPotentialFindings] = useState<PotentialFinding[]>([]);
  const [confirmedFindingIds, setConfirmedFindingIds] = useState<Set<number>>(new Set());
  const [dismissedFindingIds, setDismissedFindingIds] = useState<Set<number>>(new Set());
  const [officerObservations, setOfficerObservations] = useState<Record<number, string>>({});
  const [physicalChecks, setPhysicalChecks] = useState({
    font_size: true,
    principal_display_panel: true,
    contrast_legibility: true,
    no_smudging_dual_mrp: true,
  });
  const [officerNotes, setOfficerNotes] = useState('');

  // Step 5: Submitted
  const [inspectionId, setInspectionId] = useState<string | null>(null);
  const [evidenceRecords, setEvidenceRecords] = useState<EvidenceImage[]>([]);
  const [finalVerdict, setFinalVerdict] = useState<Verdict>('pass');
  const [reportModalData, setReportModalData] = useState<InspectionReportPayload | null>(null);

  // Camera cleanup
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  }, []);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCameraActive(true);
      setError(null);
    } catch {
      setError('Unable to access camera hardware. Please use the Upload Photo option instead.');
    }
  }, []);

  const capturePhoto = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const rawDataUrl = canvas.toDataURL('image/jpeg', 0.9);
    const optimized = await resizeImageToFitLimit(rawDataUrl);
    setCapturedImage(optimized);
    stopCamera();
  }, [stopCamera]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const raw = ev.target?.result as string;
      const optimized = await resizeImageToFitLimit(raw);
      setCapturedImage(optimized);
      // Reset input value so same file can be re-selected if desired
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsDataURL(file);
  };

  const addEvidenceImage = (label: string) => {
    if (!capturedImage) return;
    setEvidenceImages((prev) => [...prev, { dataUrl: capturedImage, label }]);
    setCapturedImage(null);
  };

  const removeEvidenceImage = (index: number) => {
    setEvidenceImages((prev) => prev.filter((_, i) => i !== index));
  };

  // Step 1 -> Step 2
  const goToUpload = () => {
    if (!locationName.trim()) {
      setError('Please enter the establishment or store name.');
      return;
    }
    setError(null);
    setStep('upload');
  };

  // Step 2 -> Step 3: Run OCR
  const runOcr = async () => {
    if (evidenceImages.length === 0) {
      setError('Please add at least one evidence image (Front of pack, back of pack, or close-up label).');
      return;
    }
    setError(null);
    setLoading(true);

    try {
      const officerId = profile?.id || user?.id;
      if (!officerId) {
        throw new Error('No active officer session found. Please sign in again.');
      }

      // 1. Create inspection record in DB
      const { data: inspData, error: inspError } = await supabase
        .from('inspections')
        .insert({
          officer_id: officerId,
          inspection_date: new Date().toISOString(),
          location_name: locationName.trim(),
          location_address: locationAddress.trim() || null,
          jurisdiction: jurisdiction || 'Central Enforcement',
          status: 'ocr_review',
        })
        .select()
        .single();

      if (inspError || !inspData) {
        throw new Error(`Failed to initialize inspection record: ${inspError?.message || 'Database error'}`);
      }

      const newInspectionId = inspData.id;
      setInspectionId(newInspectionId);

      // 2. Upload each image to Supabase Storage and record in evidence_images
      const newEvidence: EvidenceImage[] = [];
      const ocrInputs: OcrImageInput[] = [];

      for (let i = 0; i < evidenceImages.length; i++) {
        const img = evidenceImages[i];
        const blob = dataUrlToBlob(img.dataUrl);
        const filePath = `${officerId}/${newInspectionId}/${Date.now()}_${i}.jpg`;

        const { error: uploadError } = await supabase.storage
          .from('evidence')
          .upload(filePath, blob, { contentType: 'image/jpeg', upsert: true });

        if (uploadError) {
          throw new Error(`Failed to upload ${img.label.replace(/_/g, ' ')} image: ${uploadError.message}`);
        }

        const { data: signedData } = await supabase.storage
          .from('evidence')
          .createSignedUrl(filePath, 3600);

        const signedUrl = signedData?.signedUrl ?? null;

        const { data: evData, error: evError } = await supabase
          .from('evidence_images')
          .insert({
            inspection_id: newInspectionId,
            storage_path: filePath,
            image_url: signedUrl,
            label: img.label,
          })
          .select()
          .single();

        if (evError || !evData) {
          throw new Error(`Failed to record evidence image reference: ${evError?.message || 'DB error'}`);
        }

        const evRecord = evData as unknown as EvidenceImage;
        newEvidence.push(evRecord);

        ocrInputs.push({
          storagePath: filePath,
          imageUrl: signedUrl,
          imageBase64: img.dataUrl,
          label: img.label,
        });
      }

      setEvidenceRecords(newEvidence);

      // 3. Run OCR on all images in parallel and merge text and detected fields
      
console.log('OCR inputs:', ocrInputs.map((img) => ({
  storagePath: img.storagePath,
  hasImageUrl: !!img.imageUrl,
  hasImageBase64: !!img.imageBase64,
  label: img.label,
})));

const ocrResult = await callOcrExtractMultiple(ocrInputs);
console.log('FULL COMBINED OCR TEXT:', ocrResult.raw_text);
console.log('ALL EXTRACTED FIELDS:', ocrResult.extracted_fields);
console.log('FIELDS NOT FOUND:', ocrResult.fields_not_found);

console.log('OCR result:', ocrResult);


      setOcrFields(ocrResult.extracted_fields);
      setFieldsNotFound(ocrResult.fields_not_found);
      setRawOcrText(ocrResult.raw_text);

      // 4. Save initial OCR result to DB
      if (newEvidence[0]) {
        await supabase.from('ocr_results').insert({
          inspection_id: newInspectionId,
          evidence_id: newEvidence[0].id,
          raw_text: ocrResult.raw_text,
          extracted_fields: ocrResult.extracted_fields,
          fields_not_found: ocrResult.fields_not_found,
          officer_corrected: false,
        });
      }

      if (ocrResult.ocr_error) {
        setError(`OCR note: ${ocrResult.ocr_error}. You can verify and manually fill in any missing declarations below.`);
      }

      setStep('ocr_review');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to process images and run OCR.';
      setError(message);
    }
    setLoading(false);
  };

  // Step 3 -> Step 4: Check Compliance
  const goToCompliance = async () => {
    setError(null);
    setLoading(true);

    try {
      if (inspectionId) {
        // Update OCR result with officer's manual corrections
        await supabase
          .from('ocr_results')
          .update({
            officer_corrected: true,
            corrected_fields: ocrFields,
          })
          .eq('inspection_id', inspectionId);

        // Update product name & manufacturer on inspection record
        await supabase
          .from('inspections')
          .update({
            product_name: ocrFields.product_name || null,
            manufacturer_name: ocrFields.manufacturer_name || null,
            status: 'compliance_review',
          })
          .eq('id', inspectionId);
      }

      // Fetch active Legal Metrology compliance rules from DB
      let { data: rules } = await supabase
        .from('compliance_rules')
        .select('*')
        .eq('is_active', true);

      // Fallback defaults if rules table had no active rows
      if (!rules || rules.length === 0) {
        rules = [
          { id: 'rule-1', rule_code: 'LM-R1', rule_name: 'Product Name Declaration', required_field: 'product_name', severity: 'critical', category: 'declaration', description: 'Rule 6(1)(b) - Generic Name of Commodity' },
          { id: 'rule-2', rule_code: 'LM-R2', rule_name: 'Manufacturer/Packer/Importer Name', required_field: 'manufacturer_name', severity: 'critical', category: 'declaration', description: 'Rule 6(1)(a) - Name of Mfg/Packer/Importer' },
          { id: 'rule-3', rule_code: 'LM-R3', rule_name: 'Complete Address with PIN Code', required_field: 'address', severity: 'major', category: 'address', description: 'Rule 6(1)(a) - Address with Postal PIN Code' },
          { id: 'rule-4', rule_code: 'LM-R4', rule_name: 'Net Quantity Declaration', required_field: 'net_quantity', severity: 'critical', category: 'quantity', description: 'Rule 6(1)(c), Rules 12 & 13 - Standard Units' },
          { id: 'rule-5', rule_code: 'LM-R5', rule_name: 'MRP Declaration', required_field: 'mrp', severity: 'critical', category: 'pricing', description: 'Rule 6(1)(e) - MRP incl. of all taxes' },
          { id: 'rule-6', rule_code: 'LM-R6', rule_name: 'Manufacturing/Packing Date', required_field: 'mfg_date', severity: 'major', category: 'date', description: 'Rule 6(1)(d) - Month & Year of Mfg/Pack' },
          { id: 'rule-7', rule_code: 'LM-R7', rule_name: 'Consumer Care Contact', required_field: 'consumer_care', severity: 'minor', category: 'declaration', description: 'Rule 6(1)(da) - Name, Tel & Email for complaints' },
          { id: 'rule-8', rule_code: 'LM-R8', rule_name: 'Batch/Lot Number', required_field: 'batch_number', severity: 'minor', category: 'declaration', description: 'Rule 6(1)(g) - Batch or Code Number' },
        ] as ComplianceRule[];
      }

      const findings = await callComplianceCheck(ocrFields, rules as ComplianceRule[]);
      setPotentialFindings(findings);
      setConfirmedFindingIds(new Set());
      setDismissedFindingIds(new Set());

      setStep('compliance_review');
    } catch (err) {
      setError(`Compliance check error: ${err instanceof Error ? err.message : String(err)}`);
      setStep('compliance_review');
    }
    setLoading(false);
  };

  const toggleConfirmFinding = (index: number) => {
    setConfirmedFindingIds((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
        setDismissedFindingIds((d) => {
          const dNext = new Set(d);
          dNext.delete(index);
          return dNext;
        });
      }
      return next;
    });
  };

  const toggleDismissFinding = (index: number) => {
    setDismissedFindingIds((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
        setConfirmedFindingIds((c) => {
          const cNext = new Set(c);
          cNext.delete(index);
          return cNext;
        });
      }
      return next;
    });
  };

  // Step 4 -> Step 5: Submit Inspection
  const submitInspection = async () => {
    setSaveError(null);
    setLoading(true);

    try {
      if (!inspectionId) throw new Error('No active inspection record ID found.');

      // Check confirmed violations
      const confirmedList = potentialFindings.filter((_, idx) => confirmedFindingIds.has(idx));
      const hasCritical = confirmedList.some((f) => f.severity === 'critical') || !physicalChecks.no_smudging_dual_mrp;
      const hasMajor = confirmedList.some((f) => f.severity === 'major') || !physicalChecks.principal_display_panel || !physicalChecks.font_size;
      const hasMinor = confirmedList.some((f) => f.severity === 'minor') || !physicalChecks.contrast_legibility;

      let verdict: Verdict = 'pass';
      if (hasCritical) {
        verdict = 'fail';
      } else if (hasMajor || hasMinor) {
        verdict = 'conditional';
      }

      // 1. Save all findings to DB
      for (let i = 0; i < potentialFindings.length; i++) {
        const f = potentialFindings[i];
        const isConfirmed = confirmedFindingIds.has(i);
        const isDismissed = dismissedFindingIds.has(i);

        // Sanitize rule_id: only send valid UUID or null
        const isValidUUID = f.rule_id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(f.rule_id);
        const sanitizedRuleId = isValidUUID ? f.rule_id : null;

        const { error: findErr } = await supabase.from('compliance_findings').insert({
          inspection_id: inspectionId,
          rule_id: sanitizedRuleId,
          finding_type: isConfirmed ? 'confirmed' : 'potential',
          severity: f.severity,
          description: f.description,
          evidence_text: f.evidence_text || null,
          officer_observation: officerObservations[i] ?? null,
          status: isDismissed ? 'dismissed' : isConfirmed ? 'open' : 'open',
        });

        if (findErr) {
          console.warn('Error saving finding:', findErr);
        }
      }

      // Add physical verification findings if failed
      if (!physicalChecks.no_smudging_dual_mrp) {
        await supabase.from('compliance_findings').insert({
          inspection_id: inspectionId,
          rule_id: null,
          finding_type: 'confirmed',
          severity: 'critical',
          description: 'Section 18 & 36 Violations: Dual MRP sticker, smudging, or overwriting observed on packaging.',
          status: 'open',
          officer_observation: 'Officer observed illegible, altered, or overwritten MRP.',
        });
      }
      if (!physicalChecks.font_size) {
        await supabase.from('compliance_findings').insert({
          inspection_id: inspectionId,
          rule_id: null,
          finding_type: 'confirmed',
          severity: 'major',
          description: 'Rule 7 & 9 Violation: Font size or numeral height does not meet minimum statutory height specification for declared net quantity.',
          status: 'open',
          officer_observation: 'Officer verified font size falls below statutory minimum height.',
        });
      }

      // 2. Update inspection with final verdict and product details
      const { error: updateError } = await supabase
        .from('inspections')
        .update({
          status: 'submitted',
          overall_verdict: verdict,
          product_name: ocrFields.product_name ?? 'Packaged Commodity',
          manufacturer_name: ocrFields.manufacturer_name ?? null,
          officer_notes: officerNotes.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', inspectionId);

      if (updateError) {
        throw new Error(`Failed to update inspection verdict: ${updateError.message}`);
      }

      // 3. Generate and save inspection report record in inspection_reports
      const reportNumber = generateReportNumber(inspectionId);
      const reportSnapshot: InspectionReportPayload = {
        reportNumber,
        inspection: {
          id: inspectionId,
          officer_id: profile?.id || user?.id || '',
          inspection_date: new Date().toISOString(),
          location_name: locationName,
          location_address: locationAddress,
          jurisdiction: jurisdiction,
          product_name: ocrFields.product_name ?? 'Packaged Commodity',
          manufacturer_name: ocrFields.manufacturer_name ?? null,
          barcode: null,
          status: 'submitted',
          overall_verdict: verdict,
          officer_notes: officerNotes || null,
          supervisor_notes: null,
          supervisor_id: null,
          reviewed_at: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        officer: profile,
        evidence: evidenceRecords,
        ocrFields,
        rawOcrText,
        findings: potentialFindings.map((f, i) => ({
          id: `f-${i}`,
          inspection_id: inspectionId,
          rule_id: f.rule_id,
          finding_type: confirmedFindingIds.has(i) ? 'confirmed' : 'potential',
          severity: f.severity,
          description: f.description,
          evidence_text: f.evidence_text,
          officer_observation: officerObservations[i] ?? null,
          status: dismissedFindingIds.has(i) ? 'dismissed' : 'open',
          created_at: new Date().toISOString(),
          rule: {
            id: f.rule_id,
            rule_code: f.rule_code,
            rule_name: f.rule_name,
            description: f.legal_reference || f.description,
            required_field: '',
            severity: f.severity,
            category: 'legal_metrology',
            is_active: true,
          },
        })),
      };

      const { error: reportError } = await supabase.from('inspection_reports').insert({
        inspection_id: inspectionId,
        report_number: reportNumber,
        generated_by: profile?.id || user?.id,
        report_data: reportSnapshot,
      });

      if (reportError) {
        console.warn('Report table record note:', reportError);
      }

      setFinalVerdict(verdict);
      setReportModalData(reportSnapshot);
      setStep('submitted');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save inspection to Supabase.';
      setSaveError(msg);
    }
    setLoading(false);
  };

  const resetAll = () => {
    setStep('details');
    setError(null);
    setSaveError(null);
    setLoading(false);
    setLocationName('');
    setLocationAddress('');
    setCapturedImage(null);
    setEvidenceImages([]);
    setOcrFields({});
    setFieldsNotFound([]);
    setRawOcrText('');
    setPotentialFindings([]);
    setConfirmedFindingIds(new Set());
    setDismissedFindingIds(new Set());
    setOfficerObservations({});
    setOfficerNotes('');
    setInspectionId(null);
    setEvidenceRecords([]);
    setRefImageIndex(0);
    setReportModalData(null);
    stopCamera();
  };

  const stepLabels: { step: Step; label: string }[] = [
    { step: 'details', label: '1. Store Details' },
    { step: 'upload', label: '2. Upload Photos' },
    { step: 'ocr_review', label: '3. OCR Review' },
    { step: 'compliance_review', label: '4. Compliance Check' },
    { step: 'submitted', label: '5. Inspection Report' },
  ];

  const currentStepIndex = stepLabels.findIndex((s) => s.step === step);

  return (
    <div className="max-w-4xl mx-auto pb-16">
      {/* Page Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 text-emerald-700 text-xs font-bold uppercase tracking-wider mb-1">
          <ShieldCheck className="w-4 h-4 text-emerald-600" /> Legal Metrology Enforcement (PC Rules, 2011)
        </div>
        <h1 className="text-2xl font-bold text-slate-900">Packaged Commodities Inspection</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          Scan product packaging, extract statutory declarations via OCR, verify Legal Metrology compliance, and file official inspection reports.
        </p>
      </div>

      {/* Step Stepper */}
      {step !== 'submitted' && (
        <div className="mb-8 flex items-center gap-2 bg-white p-3 rounded-2xl border border-slate-100 shadow-sm overflow-x-auto">
          {stepLabels.slice(0, 4).map((s, i) => (
            <div key={s.step} className="flex items-center gap-2 flex-1 min-w-[150px]">
              <div
                className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                  i === currentStepIndex
                    ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-600/30'
                    : i < currentStepIndex
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'text-slate-400 bg-slate-50'
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold ${
                    i === currentStepIndex
                      ? 'bg-white text-emerald-700'
                      : i < currentStepIndex
                      ? 'bg-emerald-200 text-emerald-800'
                      : 'bg-slate-200 text-slate-500'
                  }`}
                >
                  {i < currentStepIndex ? <Check className="w-3 h-3" /> : i + 1}
                </div>
                <span>{s.label}</span>
              </div>
              {i < 3 && <div className={`h-0.5 flex-1 ${i < currentStepIndex ? 'bg-emerald-300' : 'bg-slate-200'}`} />}
            </div>
          ))}
        </div>
      )}

      {/* Error Banners */}
      {error && (
        <div className="mb-6 flex items-start gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800">{error}</p>
        </div>
      )}

      {saveError && (
        <div className="mb-6 flex items-start gap-3 p-4 rounded-xl bg-red-50 border border-red-200">
          <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-red-800">Database Save Failed</p>
            <p className="text-sm text-red-700 mt-0.5">{saveError}</p>
          </div>
        </div>
      )}

      {/* STEP 1: Details */}
      {step === 'details' && (
        <div className="space-y-6">
          <div className="rounded-2xl bg-white border border-slate-100 shadow-sm p-6 space-y-5">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <MapPin className="w-5 h-5 text-emerald-600" />
              Inspection Location & Jurisdiction
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                  Establishment / Store Name *
                </label>
                <input
                  type="text"
                  placeholder="e.g. D-Mart Supermarket, Big Bazaar, Sharma General Store"
                  value={locationName}
                  onChange={(e) => setLocationName(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                  Enforcement Jurisdiction
                </label>
                <input
                  type="text"
                  placeholder="e.g. South Delhi Division, Bengaluru Urban, Mumbai Zone 1"
                  value={jurisdiction}
                  onChange={(e) => setJurisdiction(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 text-sm"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                  Store Address / Market Location (Optional)
                </label>
                <input
                  type="text"
                  placeholder="Shop number, market complex, street, PIN code"
                  value={locationAddress}
                  onChange={(e) => setLocationAddress(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 text-sm"
                />
              </div>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
                <Building2 className="w-5 h-5 text-emerald-700" />
              </div>
              <div className="text-xs text-slate-600">
                <span className="font-semibold text-slate-900">Inspecting Officer:</span> {profile?.full_name ?? 'Logged-in Officer'} · Badge: {profile?.badge_number ?? 'LM-OFFICER'}
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              onClick={goToUpload}
              className="px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold flex items-center gap-2 transition-all shadow-lg shadow-emerald-600/20 text-sm"
            >
              Continue to Photo Upload <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 2: Upload Evidence Images */}
      {step === 'upload' && (
        <div className="space-y-6">
          <div className="rounded-2xl bg-white border border-slate-100 shadow-sm p-6">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <ImageIcon className="w-5 h-5 text-emerald-600" />
                Upload Package Evidence Photographs
              </h2>
              {evidenceImages.length > 0 && (
                <span className="text-xs font-bold px-3 py-1 rounded-full bg-emerald-100 text-emerald-800">
                  {evidenceImages.length} Image{evidenceImages.length !== 1 ? 's' : ''} Ready
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mb-5">
              Upload clear photos of the packaging. Capturing the <strong>Front (PDP)</strong>, <strong>Back</strong>, and a <strong>Label Close-up</strong> ensures complete OCR detection of all statutory declarations.
            </p>

            {/* Recommended Checklist */}
            <div className="mb-5 flex gap-2 flex-wrap">
              {RECOMMENDED_LABELS.map((rl) => {
                const hasIt = evidenceImages.some((img) => img.label === rl);
                const info = IMAGE_LABELS.find((l) => l.value === rl);
                return (
                  <div
                    key={rl}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                      hasIt ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-50 text-slate-400 border border-slate-200'
                    }`}
                  >
                    {hasIt ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> : <Plus className="w-3.5 h-3.5" />}
                    {info?.label ?? rl}
                  </div>
                );
              })}
            </div>

            {/* Capture Buttons */}
            {!capturedImage && !cameraActive && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                <button
                  type="button"
                  onClick={startCamera}
                  className="group flex flex-col items-center justify-center gap-3 p-8 rounded-2xl border-2 border-dashed border-slate-200 hover:border-emerald-500 hover:bg-emerald-50/40 transition-all"
                >
                  <div className="w-14 h-14 rounded-2xl bg-emerald-100 group-hover:bg-emerald-200 flex items-center justify-center transition-colors">
                    <Camera className="w-7 h-7 text-emerald-700" />
                  </div>
                  <div className="text-center">
                    <p className="font-bold text-slate-900 text-sm">{evidenceImages.length > 0 ? 'Capture Another Photo' : 'Take Photo with Camera'}</p>
                    <p className="text-xs text-slate-400 mt-0.5">Use device camera to photograph label</p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="group flex flex-col items-center justify-center gap-3 p-8 rounded-2xl border-2 border-dashed border-slate-200 hover:border-teal-500 hover:bg-teal-50/40 transition-all"
                >
                  <div className="w-14 h-14 rounded-2xl bg-teal-100 group-hover:bg-teal-200 flex items-center justify-center transition-colors">
                    <Upload className="w-7 h-7 text-teal-700" />
                  </div>
                  <div className="text-center">
                    <p className="font-bold text-slate-900 text-sm">{evidenceImages.length > 0 ? 'Upload Another Photo' : 'Upload Image File'}</p>
                    <p className="text-xs text-slate-400 mt-0.5">JPEG, PNG or WebP image from disk</p>
                  </div>
                </button>
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileUpload}
            />

            {/* Live Camera View */}
            {cameraActive && (
              <div className="space-y-3 mb-4">
                <div className="relative rounded-2xl overflow-hidden bg-slate-950 aspect-video max-w-xl mx-auto">
                  <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
                  <div className="absolute inset-8 border-2 border-white/60 rounded-xl pointer-events-none flex items-center justify-center">
                    <span className="text-white text-xs bg-slate-900/70 px-3 py-1 rounded-full font-medium">Position packaging label within frame</span>
                  </div>
                </div>
                <div className="flex gap-3 justify-center">
                  <button
                    onClick={capturePhoto}
                    className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold flex items-center gap-2 text-sm shadow-md"
                  >
                    <Camera className="w-4 h-4" /> Capture Photo
                  </button>
                  <button
                    onClick={stopCamera}
                    className="px-5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold flex items-center gap-2 text-sm"
                  >
                    <X className="w-4 h-4" /> Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Selected Image Labeling */}
            {capturedImage && !cameraActive && (
              <div className="space-y-4 mb-4 p-4 rounded-2xl bg-slate-50 border border-slate-200">
                <p className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Assign Package Label View Before Adding:
                </p>
                <div className="flex flex-col sm:flex-row items-center gap-4">
                  <div className="w-36 h-36 rounded-xl overflow-hidden border border-slate-200 bg-white shrink-0">
                    <img src={capturedImage} alt="Captured preview" className="w-full h-full object-cover" />
                  </div>
                  <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2 w-full">
                    {IMAGE_LABELS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => addEvidenceImage(opt.value)}
                        className="flex flex-col items-start p-3 rounded-xl bg-white border border-slate-200 hover:border-emerald-500 hover:bg-emerald-50/50 text-left transition-all"
                      >
                        <span className="text-xs font-bold text-slate-900">{opt.label}</span>
                        <span className="text-[11px] text-slate-400 mt-0.5">{opt.hint}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={() => setCapturedImage(null)}
                    className="text-xs text-red-600 hover:text-red-700 font-semibold px-3 py-1"
                  >
                    Discard Photo
                  </button>
                </div>
              </div>
            )}

            {/* Added Images Gallery */}
            {evidenceImages.length > 0 && (
              <div className="border-t border-slate-100 pt-5 mt-4">
                <p className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-3">
                  Evidence Photos Ready for OCR ({evidenceImages.length})
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {evidenceImages.map((img, i) => (
                    <div key={i} className="relative rounded-xl overflow-hidden border border-slate-200 bg-slate-900 group">
                      <img src={img.dataUrl} alt={img.label} className="w-full h-28 object-cover opacity-90 group-hover:opacity-100 transition-opacity" />
                      <div className="absolute bottom-0 inset-x-0 bg-slate-900/80 backdrop-blur-xs p-1.5 text-center">
                        <p className="text-[11px] font-bold text-white truncate">
                          {IMAGE_LABELS.find((l) => l.value === img.label)?.label ?? img.label}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeEvidenceImage(i)}
                        className="absolute top-1.5 right-1.5 w-6 h-6 rounded-md bg-red-600 text-white flex items-center justify-center opacity-80 hover:opacity-100 transition-all"
                        title="Remove photo"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <canvas ref={canvasRef} className="hidden" />
          </div>

          <div className="flex justify-between items-center">
            <button
              onClick={() => setStep('details')}
              className="px-5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold flex items-center gap-2 text-sm"
            >
              <ArrowLeft className="w-4 h-4" /> Back to Details
            </button>
            <button
              onClick={runOcr}
              disabled={loading || evidenceImages.length === 0}
              className="px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold flex items-center gap-2 shadow-lg shadow-emerald-600/20 text-sm transition-all"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Running OCR on {evidenceImages.length} Image{evidenceImages.length !== 1 ? 's' : ''}...
                </>
              ) : (
                <>
                  <Scan className="w-4 h-4" />
                  Run OCR on {evidenceImages.length} Image{evidenceImages.length !== 1 ? 's' : ''} <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: OCR Review */}
      {step === 'ocr_review' && (
        <div className="space-y-6">
          <div className="rounded-2xl bg-white border border-slate-100 shadow-sm p-6 space-y-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div>
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Edit3 className="w-5 h-5 text-emerald-600" />
                  Review & Verify Statutory Declarations
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Verify each detected declaration against the evidence photos. You can edit any field before running compliance checks.
                </p>
              </div>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-100 text-slate-600">
                {8 - fieldsNotFound.length}/8 Detected
              </span>
            </div>

            {/* Reference image viewer & raw OCR text */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Photo viewer */}
              <div className="space-y-2">
                <div className="relative rounded-xl overflow-hidden bg-slate-900 border border-slate-200 aspect-[4/3]">
                  {evidenceImages[refImageIndex] && (
                    <img
                      src={evidenceImages[refImageIndex].dataUrl}
                      alt="Reference evidence"
                      className="w-full h-full object-contain"
                    />
                  )}
                  <div className="absolute top-2 left-2 px-2.5 py-1 rounded-full bg-slate-900/80 text-white text-[11px] font-bold">
                    {IMAGE_LABELS.find((l) => l.value === evidenceImages[refImageIndex]?.label)?.label ?? 'Reference'}
                  </div>
                </div>

                {evidenceImages.length > 1 && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setRefImageIndex((p) => (p - 1 + evidenceImages.length) % evidenceImages.length)}
                      className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <div className="flex-1 flex gap-1.5 overflow-x-auto py-1">
                      {evidenceImages.map((img, i) => (
                        <button
                          key={i}
                          onClick={() => setRefImageIndex(i)}
                          className={`w-12 h-12 rounded-lg overflow-hidden border-2 shrink-0 ${
                            i === refImageIndex ? 'border-emerald-500' : 'border-transparent opacity-60'
                          }`}
                        >
                          <img src={img.dataUrl} alt="Thumbnail" className="w-full h-full object-cover" />
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => setRefImageIndex((p) => (p + 1) % evidenceImages.length)}
                      className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>

              {/* Extracted raw OCR text */}
              <div className="lg:col-span-2 space-y-3">
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5 text-slate-500" />
                      Extracted Text from Packaging Label
                    </span>
                    <span className="text-[11px] text-slate-400">
                      {rawOcrText ? `${rawOcrText.length} characters read` : 'No text detected'}
                    </span>
                  </div>
                  <pre className="text-xs text-slate-700 font-mono whitespace-pre-wrap max-h-44 overflow-y-auto leading-relaxed bg-white p-3 rounded-lg border border-slate-200">
                    {rawOcrText || '(OCR did not detect printable text in the uploaded image. Please enter fields manually below or upload clearer photos)'}
                  </pre>
                </div>

                {fieldsNotFound.length > 0 && (
                  <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-2.5">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div className="text-xs text-amber-800">
                      <span className="font-bold">{fieldsNotFound.length} field{fieldsNotFound.length !== 1 ? 's' : ''} not automatically detected: </span>
                      {fieldsNotFound.map((f) => f.replace(/_/g, ' ')).join(', ')}.
                      <span className="block text-amber-700 mt-0.5">Please check the label image and enter any visible values below.</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Editable 8 Statutory Fields */}
            <div className="space-y-4 pt-2">
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Statutory Mandatory Declarations (Legal Metrology Packaged Commodities Rules, 2011)
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {ALL_OCR_FIELDS.map(({ key, label, ruleRef, description }) => {
                  const hasValue = Boolean(ocrFields[key] && ocrFields[key]!.trim().length > 0);
                  return (
                    <div
                      key={key}
                      className={`p-3.5 rounded-xl border transition-all ${
                        hasValue ? 'border-slate-200 bg-white' : 'border-amber-200 bg-amber-50/30'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                          {label}
                        </label>
                        {hasValue ? (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                            DETECTED
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" /> Needs Manual Verification
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 mb-2">
                        {ruleRef} · {description}
                      </p>
                      <input
                        type="text"
                        value={ocrFields[key] ?? ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          setOcrFields((prev) => ({ ...prev, [key]: val }));
                          setFieldsNotFound((prev) =>
                            val.trim().length > 0 ? prev.filter((k) => k !== key) : [...prev.filter((k) => k !== key), key]
                          );
                        }}
                        placeholder={hasValue ? '' : 'Needs manual verification — enter value if printed on package...'}
                        className={`w-full px-3 py-2 rounded-lg border text-xs focus:outline-none focus:ring-2 transition-all ${
                          hasValue
                            ? 'border-slate-200 bg-slate-50 text-slate-900 focus:bg-white focus:border-emerald-500 focus:ring-emerald-500/20'
                            : 'border-amber-300 bg-white text-slate-900 placeholder:text-amber-600/70 focus:border-amber-500 focus:ring-amber-500/20'
                        }`}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="flex justify-between items-center">
            <button
              onClick={() => setStep('upload')}
              className="px-5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold flex items-center gap-2 text-sm"
            >
              <ArrowLeft className="w-4 h-4" /> Back to Upload
            </button>
            <button
              onClick={goToCompliance}
              disabled={loading}
              className="px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold flex items-center gap-2 shadow-lg shadow-emerald-600/20 text-sm transition-all"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Verifying Compliance...
                </>
              ) : (
                <>
                  Verify Legal Metrology Compliance <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* STEP 4: Compliance Review */}
      {step === 'compliance_review' && (
        <div className="space-y-6">
          <div className="rounded-2xl bg-white border border-slate-100 shadow-sm p-6 space-y-6">
            <div className="border-b border-slate-100 pb-4">
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-emerald-600" />
                Legal Metrology Compliance Assessment
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Review potential issues below. Distinguish between confirmed violations and items requiring physical inspection. A product is not compliant simply because OCR read its text.
              </p>
            </div>

            {/* Findings List */}
            {potentialFindings.length === 0 ? (
              <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center gap-3">
                <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
                <div>
                  <p className="text-xs font-bold text-emerald-900">All 8 Statutory Declarations Detected</p>
                  <p className="text-xs text-emerald-700 mt-0.5">
                    Product label text contains required statutory statements. Please verify physical display attributes below before final submission.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Statutory Findings & Verification Items ({potentialFindings.length})
                  </h3>
                  <span className="text-xs text-slate-500">
                    {confirmedFindingIds.size} Confirmed Violation{confirmedFindingIds.size !== 1 ? 's' : ''}
                  </span>
                </div>

                {potentialFindings.map((f, i) => {
                  const isConfirmed = confirmedFindingIds.has(i);
                  const isDismissed = dismissedFindingIds.has(i);

                  return (
                    <div
                      key={i}
                      className={`p-4 rounded-xl border transition-all ${
                        isConfirmed
                          ? 'bg-red-50/80 border-red-300 shadow-sm'
                          : isDismissed
                          ? 'bg-slate-50 border-slate-200 opacity-60'
                          : 'bg-amber-50/70 border-amber-200'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-200 text-slate-700">
                              {f.rule_code}
                            </span>
                            <span
                              className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                                f.severity === 'critical'
                                  ? 'bg-red-100 text-red-800'
                                  : f.severity === 'major'
                                  ? 'bg-orange-100 text-orange-800'
                                  : 'bg-yellow-100 text-yellow-800'
                              }`}
                            >
                              {f.severity.toUpperCase()}
                            </span>
                            <span
                              className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                                isConfirmed
                                  ? 'bg-red-600 text-white'
                                  : isDismissed
                                  ? 'bg-slate-300 text-slate-700'
                                  : 'bg-amber-200 text-amber-900'
                              }`}
                            >
                              {isConfirmed ? 'CONFIRMED VIOLATION' : isDismissed ? 'VERIFIED AS COMPLIANT' : 'NEEDS MANUAL VERIFICATION'}
                            </span>
                          </div>
                          <p className="text-xs font-bold text-slate-900 pt-0.5">{f.rule_name}</p>
                          <p className="text-xs text-slate-600 leading-relaxed">{f.description}</p>
                          {f.legal_reference && (
                            <p className="text-[11px] text-slate-500 italic">Reference: {f.legal_reference}</p>
                          )}
                          {f.evidence_text && (
                            <div className="mt-1 text-[11px] text-slate-600 bg-white/80 p-2 rounded border border-slate-200 font-mono">
                              Detected Value: "{f.evidence_text}"
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Officer Observation & Action */}
                      <div className="mt-3 pt-3 border-t border-slate-200/60 flex flex-col sm:flex-row items-center gap-3">
                        <input
                          type="text"
                          placeholder="Add officer note or corrective action required (optional)..."
                          value={officerObservations[i] ?? ''}
                          onChange={(e) => setOfficerObservations((prev) => ({ ...prev, [i]: e.target.value }))}
                          className="w-full sm:flex-1 px-3 py-1.5 text-xs rounded-lg border border-slate-300 bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        />
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => toggleConfirmFinding(i)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
                              isConfirmed
                                ? 'bg-red-700 text-white shadow-sm'
                                : 'bg-red-100 hover:bg-red-200 text-red-800'
                            }`}
                          >
                            <ShieldAlert className="w-3.5 h-3.5" />
                            {isConfirmed ? 'Confirmed as Violation' : 'Confirm Violation'}
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleDismissFinding(i)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                              isDismissed
                                ? 'bg-emerald-700 text-white shadow-sm'
                                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                            }`}
                          >
                            <Check className="w-3.5 h-3.5" />
                            {isDismissed ? 'Verified Compliant' : 'Mark Compliant'}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Physical Display & Visibility Checklist */}
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                <Eye className="w-4 h-4 text-emerald-600" />
                Physical Label Attributes (Manual Verification Checklist)
              </h3>
              <p className="text-[11px] text-slate-500">
                Mandatory under Rule 7, 9 & Section 18: Font height, placement, and conspicuousness cannot be assessed solely by OCR. Verify physically:
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <label className="flex items-center gap-2 p-2.5 rounded-lg bg-white border border-slate-200 cursor-pointer text-xs font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={physicalChecks.principal_display_panel}
                    onChange={(e) => setPhysicalChecks((p) => ({ ...p, principal_display_panel: e.target.checked }))}
                    className="rounded text-emerald-600 focus:ring-emerald-500"
                  />
                  <span>Principal Display Panel (PDP) placement conforms to Rule 6</span>
                </label>
                <label className="flex items-center gap-2 p-2.5 rounded-lg bg-white border border-slate-200 cursor-pointer text-xs font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={physicalChecks.font_size}
                    onChange={(e) => setPhysicalChecks((p) => ({ ...p, font_size: e.target.checked }))}
                    className="rounded text-emerald-600 focus:ring-emerald-500"
                  />
                  <span>Minimum font/numeral height matches Net Quantity (Rule 7/9)</span>
                </label>
                <label className="flex items-center gap-2 p-2.5 rounded-lg bg-white border border-slate-200 cursor-pointer text-xs font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={physicalChecks.contrast_legibility}
                    onChange={(e) => setPhysicalChecks((p) => ({ ...p, contrast_legibility: e.target.checked }))}
                    className="rounded text-emerald-600 focus:ring-emerald-500"
                  />
                  <span>Declarations have clear contrast against package background (Rule 9)</span>
                </label>
                <label className="flex items-center gap-2 p-2.5 rounded-lg bg-white border border-slate-200 cursor-pointer text-xs font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={physicalChecks.no_smudging_dual_mrp}
                    onChange={(e) => setPhysicalChecks((p) => ({ ...p, no_smudging_dual_mrp: e.target.checked }))}
                    className="rounded text-emerald-600 focus:ring-emerald-500"
                  />
                  <span>No dual MRP stickers, alterations, smudging, or overwriting (Sec. 18/36)</span>
                </label>
              </div>
            </div>

            {/* Officer Field Notes */}
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                Inspecting Officer's Concluding Notes (Optional)
              </label>
              <textarea
                value={officerNotes}
                onChange={(e) => setOfficerNotes(e.target.value)}
                placeholder="Enter any additional field observations, stock quantities inspected, seized batches, or notice details..."
                rows={3}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 resize-none"
              />
            </div>

            {/* Expected Verdict Preview */}
            {(() => {
              const confirmedCount = confirmedFindingIds.size;
              const hasCriticalViolations =
                potentialFindings.some((f, idx) => confirmedFindingIds.has(idx) && f.severity === 'critical') ||
                !physicalChecks.no_smudging_dual_mrp;
              const hasMajorViolations =
                potentialFindings.some((f, idx) => confirmedFindingIds.has(idx) && f.severity === 'major') ||
                !physicalChecks.principal_display_panel ||
                !physicalChecks.font_size;
              const hasMinorViolations =
                potentialFindings.some((f, idx) => confirmedFindingIds.has(idx) && f.severity === 'minor') ||
                !physicalChecks.contrast_legibility;

              let verdictPreview: Verdict = 'pass';
              if (hasCriticalViolations) verdictPreview = 'fail';
              else if (hasMajorViolations || hasMinorViolations) verdictPreview = 'conditional';

              const config = {
                pass: { bg: 'bg-emerald-50 border-emerald-300', text: 'text-emerald-800', badge: 'COMPLIANT (PASS)', desc: 'No confirmed violations. Product meets Legal Metrology statutory requirements.' },
                fail: { bg: 'bg-red-50 border-red-300', text: 'text-red-800', badge: 'NON-COMPLIANT (FAIL)', desc: 'Critical violations confirmed. Packaging does not comply with statutory requirements.' },
                conditional: { bg: 'bg-amber-50 border-amber-300', text: 'text-amber-800', badge: 'CONDITIONAL / PENDING REVIEW', desc: 'Minor/major non-compliances confirmed. Corrective notice recommended.' },
              }[verdictPreview];

              return (
                <div className={`p-4 rounded-xl border ${config.bg} flex items-center justify-between`}>
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Calculated Inspection Verdict:</span>
                    <p className={`text-base font-black ${config.text} tracking-wide`}>{config.badge}</p>
                    <p className="text-xs text-slate-600 mt-0.5">{config.desc}</p>
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-bold text-slate-700">{confirmedCount} Violation{confirmedCount !== 1 ? 's' : ''} Confirmed</span>
                  </div>
                </div>
              );
            })()}
          </div>

          <div className="flex justify-between items-center">
            <button
              onClick={() => setStep('ocr_review')}
              className="px-5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold flex items-center gap-2 text-sm"
            >
              <ArrowLeft className="w-4 h-4" /> Back to OCR Review
            </button>
            <button
              onClick={submitInspection}
              disabled={loading}
              className="px-6 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-semibold flex items-center gap-2 shadow-lg text-sm transition-all"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Saving & Filing Inspection...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" /> Save Inspection & Generate Report
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* STEP 5: Submitted & Report View */}
      {step === 'submitted' && (
        <div className="max-w-xl mx-auto py-8 text-center space-y-6">
          {(() => {
            const config = {
              pass: { icon: CheckCircle2, bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-emerald-300', label: 'COMPLIANT (PASS)', desc: 'The packaged commodity meets statutory Legal Metrology declarations.' },
              fail: { icon: ShieldAlert, bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-300', label: 'NON-COMPLIANT (FAIL)', desc: 'Confirmed statutory violations identified. Offence actionable under Section 36 of Legal Metrology Act, 2009.' },
              conditional: { icon: AlertTriangle, bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-300', label: 'CONDITIONAL / NOTICE ISSUED', desc: 'Minor or major non-compliances recorded. Rectification notice required.' },
            }[finalVerdict];
            const Icon = config.icon;

            return (
              <div className="rounded-2xl bg-white border border-slate-100 shadow-sm p-8 space-y-5">
                <div className={`w-20 h-20 rounded-2xl ${config.bg} flex items-center justify-center mx-auto shadow-inner`}>
                  <Icon className={`w-10 h-10 ${config.text}`} />
                </div>
                <div>
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Inspection Successfully Saved</span>
                  <h2 className="text-2xl font-black text-slate-900 mt-1">Inspection Record Filed</h2>
                  <div className={`inline-block px-4 py-1.5 rounded-lg text-xs font-black mt-3 border ${config.bg} ${config.text} ${config.border}`}>
                    VERDICT: {config.label}
                  </div>
                  <p className="text-xs text-slate-500 mt-3 max-w-md mx-auto leading-relaxed">
                    {config.desc} All evidence photographs, OCR results, and findings have been permanently stored in Supabase.
                  </p>
                </div>

                <div className="pt-2 flex flex-col sm:flex-row gap-3 justify-center">
                  {reportModalData && (
                    <button
                      onClick={() => setReportModalData({ ...reportModalData })}
                      className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold flex items-center justify-center gap-2 text-xs shadow-md shadow-emerald-600/20"
                    >
                      <Printer className="w-4 h-4" /> View / Print Inspection Report
                    </button>
                  )}
                  <button
                    onClick={resetAll}
                    className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold flex items-center justify-center gap-2 text-xs"
                  >
                    <Scan className="w-4 h-4" /> Start New Inspection
                  </button>
                </div>
              </div>
            );
          })()}
        </div>
      )}

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
