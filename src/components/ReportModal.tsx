import { useEffect, useRef } from 'react';
import { X, Download, Printer } from 'lucide-react';
import type { InspectionReportPayload } from '@/lib/reportGenerator';
import { generateLegalMetrologyReportHTML, downloadReportHTML } from '@/lib/reportGenerator';

interface ReportModalProps {
  data: InspectionReportPayload | null;
  onClose: () => void;
}

export default function ReportModal({ data, onClose }: ReportModalProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!data || !iframeRef.current) return;
    const doc = iframeRef.current.contentDocument;
    if (!doc) return;
    doc.open();
    doc.write(generateLegalMetrologyReportHTML(data));
    doc.close();
  }, [data]);

  if (!data) return null;

  const handlePrint = () => {
    iframeRef.current?.contentWindow?.focus();
    iframeRef.current?.contentWindow?.print();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0 bg-white">
          <div>
            <h2 className="text-base font-bold text-slate-900">Legal Metrology Inspection Report</h2>
            <p className="text-xs text-slate-500 font-mono">Report No: {data.reportNumber}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => downloadReportHTML(data)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-all shadow-sm shadow-emerald-600/20"
            >
              <Download className="w-4 h-4" />
              Download HTML
            </button>
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-all"
            >
              <Printer className="w-4 h-4" />
              Print Report
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all ml-1"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto bg-slate-100 p-4">
          <iframe
            ref={iframeRef}
            title="Legal Metrology Compliance Report"
            className="w-full h-full border-0 rounded-xl shadow-inner bg-white"
            style={{ minHeight: '650px' }}
          />
        </div>
      </div>
    </div>
  );
}
