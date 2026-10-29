import { CheckCircle2, XCircle, AlertTriangle, ShieldCheck, Barcode, Tag, Percent, Image as ImageIcon } from 'lucide-react';
import type { AnalysisResult } from '@/lib/analyzer';
import type { ComplianceStatus, Violation } from '@/lib/supabase';

const statusConfig: Record<ComplianceStatus, {
  label: string;
  verdict: 'PASS' | 'FAIL' | 'CONDITIONAL';
  icon: typeof CheckCircle2;
  bg: string;
  text: string;
  border: string;
  badge: string;
  accent: string;
}> = {
  compliant: {
    label: 'Compliant',
    verdict: 'PASS',
    icon: CheckCircle2,
    bg: 'bg-emerald-50',
    text: 'text-emerald-700',
    border: 'border-emerald-200',
    badge: 'bg-emerald-100 text-emerald-700',
    accent: 'text-emerald-600',
  },
  non_compliant: {
    label: 'Non-Compliant',
    verdict: 'FAIL',
    icon: XCircle,
    bg: 'bg-red-50',
    text: 'text-red-700',
    border: 'border-red-200',
    badge: 'bg-red-100 text-red-700',
    accent: 'text-red-600',
  },
  warning: {
    label: 'Conditional Pass',
    verdict: 'CONDITIONAL',
    icon: AlertTriangle,
    bg: 'bg-amber-50',
    text: 'text-amber-700',
    border: 'border-amber-200',
    badge: 'bg-amber-100 text-amber-700',
    accent: 'text-amber-600',
  },
  pending: {
    label: 'Pending',
    verdict: 'CONDITIONAL',
    icon: ShieldCheck,
    bg: 'bg-slate-50',
    text: 'text-slate-700',
    border: 'border-slate-200',
    badge: 'bg-slate-100 text-slate-700',
    accent: 'text-slate-600',
  },
};

const severityColors: Record<string, string> = {
  critical: 'bg-red-100 text-red-700 border-red-200',
  major: 'bg-orange-100 text-orange-700 border-orange-200',
  minor: 'bg-amber-100 text-amber-700 border-amber-200',
};

function VerdictBanner({ result }: { result: AnalysisResult }) {
  const config = statusConfig[result.status];
  const verdict = config.verdict;
  const Icon = config.icon;

  if (verdict === 'PASS') {
    return (
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-emerald-500 to-emerald-600 p-6 shadow-lg shadow-emerald-500/20">
        <div className="absolute -right-4 -top-4 w-32 h-32 rounded-full bg-white/10" />
        <div className="absolute -right-12 top-8 w-40 h-40 rounded-full bg-white/5" />
        <div className="relative flex items-center gap-5">
          <div className="w-16 h-16 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-9 h-9 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-3xl font-bold text-white tracking-tight">PASS</h2>
              <span className="px-3 py-1 rounded-full bg-white/20 text-white text-xs font-bold uppercase tracking-wide">
                Compliant
              </span>
            </div>
            <p className="text-emerald-50 text-sm mt-1.5">
              Product meets all food safety compliance standards. No violations detected.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (verdict === 'FAIL') {
    return (
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-red-500 to-red-600 p-6 shadow-lg shadow-red-500/20">
        <div className="absolute -right-4 -top-4 w-32 h-32 rounded-full bg-white/10" />
        <div className="absolute -right-12 top-8 w-40 h-40 rounded-full bg-white/5" />
        <div className="relative flex items-center gap-5">
          <div className="w-16 h-16 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
            <XCircle className="w-9 h-9 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-3xl font-bold text-white tracking-tight">FAIL</h2>
              <span className="px-3 py-1 rounded-full bg-white/20 text-white text-xs font-bold uppercase tracking-wide">
                Non-Compliant
              </span>
            </div>
            <p className="text-red-50 text-sm mt-1.5">
              Product does not meet compliance standards. {result.violations.length} violation{result.violations.length !== 1 ? 's' : ''} detected requiring enforcement action.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-amber-400 to-amber-500 p-6 shadow-lg shadow-amber-500/20">
      <div className="absolute -right-4 -top-4 w-32 h-32 rounded-full bg-white/10" />
      <div className="absolute -right-12 top-8 w-40 h-40 rounded-full bg-white/5" />
      <div className="relative flex items-center gap-5">
        <div className="w-16 h-16 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
          <Icon className="w-9 h-9 text-white" />
        </div>
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold text-white tracking-tight">CONDITIONAL</h2>
            <span className="px-3 py-1 rounded-full bg-white/20 text-white text-xs font-bold uppercase tracking-wide">
              Warning
            </span>
          </div>
          <p className="text-amber-50 text-sm mt-1.5">
            Minor violations detected. Product requires corrective action but does not warrant immediate removal.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function ResultPanel({ result, imageUrl }: { result: AnalysisResult; imageUrl?: string | null }) {
  const config = statusConfig[result.status];

  return (
    <div className="space-y-4">
      <VerdictBanner result={result} />

      <div className={`rounded-2xl border ${config.border} ${config.bg} p-6`}>
        {imageUrl && (
          <div className="mb-5 grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="relative rounded-xl overflow-hidden bg-slate-100">
              <img src={imageUrl} alt="Scanned product" className="w-full h-auto" />
              <div className="absolute top-2 left-2 px-2.5 py-1 rounded-full bg-slate-900/70 backdrop-blur-sm text-white text-xs font-medium flex items-center gap-1.5">
                <ImageIcon className="w-3 h-3" />
                Scanned Image
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl ${config.badge} flex items-center justify-center`}>
                    <config.icon className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-900">Analysis Details</h3>
                    <p className={`text-sm font-semibold ${config.text}`}>{config.label}</p>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/60 border border-slate-200 w-fit">
                <Percent className="w-3.5 h-3.5 text-slate-500" />
                <span className="text-sm font-semibold text-slate-700">
                  {Math.round(result.confidence * 100)}% confidence
                </span>
              </div>
            </div>
          </div>
        )}

        {!imageUrl && (
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl ${config.badge} flex items-center justify-center`}>
                <config.icon className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Analysis Details</h3>
                <p className={`text-sm font-semibold ${config.text}`}>{config.label}</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/60 border border-slate-200">
              <Percent className="w-3.5 h-3.5 text-slate-500" />
              <span className="text-sm font-semibold text-slate-700">
                {Math.round(result.confidence * 100)}% confidence
              </span>
            </div>
          </div>
        )}

        {/* Product info */}
        <div className="space-y-3 mb-5 p-4 rounded-xl bg-white/70 border border-slate-100">
          <div className="flex items-center gap-2">
            <Tag className="w-4 h-4 text-slate-400" />
            <span className="text-sm text-slate-500">Product:</span>
            <span className="text-sm font-semibold text-slate-900">{result.detectedProduct.name}</span>
          </div>
          <div className="flex items-center gap-2">
            <Barcode className="w-4 h-4 text-slate-400" />
            <span className="text-sm text-slate-500">Barcode:</span>
            <span className="text-sm font-mono text-slate-700">{result.detectedProduct.barcode}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-500">Category:</span>
            <span className="text-sm font-medium text-slate-700">{result.detectedProduct.category}</span>
          </div>
        </div>

        {/* Violations */}
        {result.violations.length > 0 ? (
          <div>
            <h4 className="text-sm font-semibold text-slate-700 mb-3">
              Detected Violations ({result.violations.length})
            </h4>
            <div className="space-y-3">
              {result.violations.map((v: Violation, i: number) => (
                <div key={i} className="p-4 rounded-xl bg-white/70 border border-slate-100">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-slate-900">{v.type}</span>
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${severityColors[v.severity]}`}>
                      {v.severity.toUpperCase()}
                    </span>
                  </div>
                  <p className="text-sm text-slate-600 leading-relaxed">{v.description}</p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 p-4 rounded-xl bg-emerald-50 border border-emerald-100">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <p className="text-sm text-emerald-700">
              No violations detected. Product meets all food safety compliance standards.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
