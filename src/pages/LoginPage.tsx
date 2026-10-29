import { useState, FormEvent } from 'react';
import { ShieldCheck, Mail, Lock, User, BadgeCheck, MapPin, Eye, EyeOff, Loader2, AlertCircle, UserCog, Shield } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import type { UserRole } from '@/lib/supabase';

type Mode = 'signin' | 'signup';

export default function LoginPage() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [badgeNumber, setBadgeNumber] = useState('');
  const [jurisdiction, setJurisdiction] = useState('');
  const [role, setRole] = useState<UserRole>('officer');
  const [assignedJurisdiction, setAssignedJurisdiction] = useState('');
  const [supervisorBadge, setSupervisorBadge] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    if (mode === 'signin') {
      const { error } = await signIn(email, password);
      if (error) setError(error);
    } else {
      if (password.length < 6) {
        setError('Password must be at least 6 characters');
        setLoading(false);
        return;
      }
      if (role === 'supervisor' && !assignedJurisdiction.trim()) {
        setError('Supervisors must specify an assigned jurisdiction');
        setLoading(false);
        return;
      }
      const { error } = await signUp(
        email,
        password,
        fullName,
        badgeNumber,
        jurisdiction,
        role,
        assignedJurisdiction,
        supervisorBadge,
      );
      if (error) setError(error);
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* Left panel - branding */}
      <div className="lg:w-1/2 bg-gradient-to-br from-slate-900 via-slate-800 to-emerald-950 flex flex-col justify-center items-center p-8 lg:p-16 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-20 left-10 w-72 h-72 bg-emerald-500 rounded-full blur-3xl" />
          <div className="absolute bottom-10 right-10 w-96 h-96 bg-teal-500 rounded-full blur-3xl" />
        </div>
        <div className="relative z-10 max-w-md text-center lg:text-left">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-emerald-500/20 border border-emerald-400/30 mb-8">
            <ShieldCheck className="w-10 h-10 text-emerald-400" />
          </div>
          <h1 className="text-3xl lg:text-4xl font-bold text-white mb-4 tracking-tight">
            LegalMetriCheck
          </h1>
          <p className="text-slate-300 text-lg leading-relaxed mb-8">
            Legal Metrology enforcement platform. Inspect product packaging, run OCR analysis,
            verify compliance, and file inspection reports.
          </p>
          <div className="space-y-4">
            {[
              { icon: ShieldCheck, text: 'OCR-powered label extraction & field review' },
              { icon: BadgeCheck, text: 'Legal Metrology rules compliance checking' },
              { icon: MapPin, text: 'Jurisdiction-aware access for officers & supervisors' },
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-3 text-slate-200">
                <item.icon className="w-5 h-5 text-emerald-400 shrink-0" />
                <span className="text-sm">{item.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right panel - form */}
      <div className="lg:w-1/2 flex items-center justify-center p-6 lg:p-16 bg-slate-50 overflow-y-auto" style={{ maxHeight: '100vh' }}>
        <div className="w-full max-w-md py-4">
          <div className="mb-6">
            <h2 className="text-2xl font-bold text-slate-900 mb-2">
              {mode === 'signin' ? 'Sign In' : 'Create Account'}
            </h2>
            <p className="text-slate-500 text-sm">
              {mode === 'signin'
                ? 'Enter your credentials to access the enforcement portal.'
                : 'Register as an Enforcement Officer or Supervisor.'}
            </p>
          </div>

          {error && (
            <div className="mb-5 flex items-start gap-3 p-4 rounded-xl bg-red-50 border border-red-200">
              <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <>
                {/* Role selector */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Role</label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setRole('officer')}
                      className={`flex items-center gap-2 px-4 py-3 rounded-xl border-2 transition-all ${
                        role === 'officer'
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                          : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                      }`}
                    >
                      <User className="w-5 h-5" />
                      <div className="text-left">
                        <p className="text-sm font-semibold">Officer</p>
                        <p className="text-xs opacity-70">Field inspections</p>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setRole('supervisor')}
                      className={`flex items-center gap-2 px-4 py-3 rounded-xl border-2 transition-all ${
                        role === 'supervisor'
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                          : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                      }`}
                    >
                      <Shield className="w-5 h-5" />
                      <div className="text-left">
                        <p className="text-sm font-semibold">Supervisor</p>
                        <p className="text-xs opacity-70">Review & oversight</p>
                      </div>
                    </button>
                  </div>
                </div>

                <FormField icon={<User className="w-5 h-5" />} label="Full Name" type="text" value={fullName} onChange={setFullName} placeholder="John Doe" required />
                <FormField icon={<BadgeCheck className="w-5 h-5" />} label="Badge Number" type="text" value={badgeNumber} onChange={setBadgeNumber} placeholder="LM-2024-0156" required />
                <FormField icon={<MapPin className="w-5 h-5" />} label="Jurisdiction" type="text" value={jurisdiction} onChange={setJurisdiction} placeholder="Central District" required />

                {role === 'supervisor' && (
                  <FormField icon={<MapPin className="w-5 h-5" />} label="Assigned Jurisdiction" type="text" value={assignedJurisdiction} onChange={setAssignedJurisdiction} placeholder="Central District (your area of oversight)" required />
                )}

                {role === 'officer' && (
                  <FormField icon={<UserCog className="w-5 h-5" />} label="Supervisor Badge Number (optional)" type="text" value={supervisorBadge} onChange={setSupervisorBadge} placeholder="LM-2024-0100" />
                )}
              </>
            )}

            <FormField icon={<Mail className="w-5 h-5" />} label="Email" type="email" value={email} onChange={setEmail} placeholder="officer@legalmetrology.gov" required />

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Password</label>
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                  <Lock className="w-5 h-5" />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full pl-11 pr-11 py-3 rounded-xl border border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-semibold transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  {mode === 'signin' ? 'Signing in...' : 'Creating account...'}
                </>
              ) : (
                mode === 'signin' ? 'Sign In' : 'Create Account'
              )}
            </button>
          </form>

          <div className="mt-5 text-center">
            <button
              onClick={() => {
                setMode(mode === 'signin' ? 'signup' : 'signin');
                setError(null);
              }}
              className="text-sm text-slate-500 hover:text-emerald-600 transition-colors"
            >
              {mode === 'signin'
                ? "Don't have an account? Register here"
                : 'Already registered? Sign in instead'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FormField({
  icon,
  label,
  type,
  value,
  onChange,
  placeholder,
  required,
}: {
  icon: React.ReactNode;
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-2">{label}</label>
      <div className="relative">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">{icon}</div>
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          className="w-full pl-11 pr-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500 transition-all"
        />
      </div>
    </div>
  );
}
