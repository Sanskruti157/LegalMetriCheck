import { LayoutDashboard, Scan, LogOut, ShieldCheck, User, ClipboardList } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

export type View = 'dashboard' | 'scanner' | 'records';

interface AppShellProps {
  view: View;
  onNavigate: (view: View) => void;
  children: React.ReactNode;
}

export default function AppShell({ view, onNavigate, children }: AppShellProps) {
  const { profile, signOut } = useAuth();
  const isSupervisor = profile?.role === 'supervisor';

  const navItems: { id: View; label: string; icon: typeof LayoutDashboard }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'records', label: 'Inspection Records', icon: ClipboardList },
  ];

  if (!isSupervisor) {
    navItems.splice(1, 0, { id: 'scanner', label: 'New Inspection', icon: Scan });
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b border-slate-100 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-emerald-600 flex items-center justify-center">
                <ShieldCheck className="w-5 h-5 text-white" />
              </div>
              <div className="hidden sm:block">
                <p className="font-bold text-slate-900 text-sm leading-tight">LegalMetriCheck</p>
                <p className="text-xs text-slate-400 leading-tight">Enforcement Portal</p>
              </div>
            </div>

            <nav className="flex items-center gap-1">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => onNavigate(item.id)}
                  className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                    view === item.id
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <item.icon className="w-4 h-4" />
                  <span className="hidden lg:inline">{item.label}</span>
                </button>
              ))}
            </nav>

            <div className="flex items-center gap-3">
              <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-50">
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                  isSupervisor ? 'bg-blue-100' : 'bg-emerald-100'
                }`}>
                  {isSupervisor ? <ShieldCheck className="w-4 h-4 text-blue-600" /> : <User className="w-4 h-4 text-emerald-600" />}
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-slate-900 leading-tight">{profile?.full_name}</p>
                  <p className="text-xs text-slate-400 leading-tight">
                    {isSupervisor ? 'Supervisor' : 'Officer'} · {profile?.badge_number}
                  </p>
                </div>
              </div>
              <button
                onClick={signOut}
                className="p-2 rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 transition-all"
                title="Sign out"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 py-8 px-4 lg:px-8">
        {children}
      </main>
    </div>
  );
}
