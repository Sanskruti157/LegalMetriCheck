import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import LoginPage from '@/pages/LoginPage';
import AppShell from '@/components/AppShell';
import type { View } from '@/components/AppShell';
import DashboardPage from '@/pages/DashboardPage';
import ScannerPage from '@/pages/ScannerPage';
import InspectionRecordsPage from '@/pages/InspectionRecordsPage';

function AppContent() {
  const { user, loading } = useAuth();
  const [view, setView] = useState<View>('dashboard');

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <AppShell view={view} onNavigate={setView}>
      {view === 'dashboard' ? (
        <DashboardPage onScan={() => setView('scanner')} onRecords={() => setView('records')} />
      ) : view === 'scanner' ? (
        <ScannerPage />
      ) : (
        <InspectionRecordsPage />
      )}
    </AppShell>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
