import React, { useState } from 'react';
import { AuthProvider, useAuth } from './AuthContext';
import { AppProvider, useAppContext } from './AppContext';
import { LoginPage } from './components/LoginPage';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { DashboardView } from './views/DashboardView';
import { PlanningView } from './views/PlanningView';
import { QualityView } from './views/QualityView';
import { DataHistoryView } from './views/DataHistoryView';
import { DeliveriesView } from './views/DeliveriesView';
import { SettingsView } from './views/SettingsView';
import { UsersView } from './views/UsersView';
import { BatchDrawer } from './components/BatchDrawer';
import { Loader2 } from 'lucide-react';

function AppContent() {
  const { loading } = useAppContext();
  const { isAdmin, canEdit } = useAuth();
  const [currentView, setCurrentView] = useState('dashboard');
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50 text-slate-500">
        <Loader2 className="w-6 h-6 animate-spin mr-2" />
        Chargement...
      </div>
    );
  }

  const titles: Record<string, string> = {
    'dashboard': 'Tableau de bord',
    'planning': 'Planning',
    'quality': 'Qualité',
    'data': 'Data Historique',
    'deliveries': 'Livraisons Clients',
    'users': 'Utilisateurs',
    'settings': 'Paramètres'
  };

  const handleNewBatch = () => {
    if (canEdit) {
      setSelectedBatchId(`NEW-${Math.floor(Math.random() * 10000)}`);
    }
  };

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900 font-sans overflow-hidden">
      <Sidebar currentView={currentView} onChangeView={setCurrentView} isAdmin={isAdmin} />

      <main className="flex-1 flex flex-col min-w-0">
        <Header
          title={titles[currentView] || 'LounaFlow'}
          currentView={currentView}
          onNewBatch={handleNewBatch}
        />

        {currentView === 'dashboard' && <DashboardView onOpenBatch={setSelectedBatchId} />}
        {currentView === 'planning' && <PlanningView onOpenBatch={setSelectedBatchId} />}
        {currentView === 'quality' && <QualityView onOpenBatch={setSelectedBatchId} />}
        {currentView === 'data' && <DataHistoryView onOpenBatch={setSelectedBatchId} />}
        {currentView === 'deliveries' && <DeliveriesView />}
        {currentView === 'users' && <UsersView />}
        {currentView === 'settings' && <SettingsView />}
      </main>

      {selectedBatchId && (
        <BatchDrawer
          batchId={selectedBatchId}
          onClose={() => setSelectedBatchId(null)}
        />
      )}
    </div>
  );
}

function AuthenticatedApp() {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50 text-slate-500">
        <Loader2 className="w-6 h-6 animate-spin mr-2" />
        Vérification de la session...
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AuthenticatedApp />
    </AuthProvider>
  );
}
