import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './AuthContext';
import { AppProvider, useAppContext } from './AppContext';
import { LoginPage } from './components/LoginPage';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { DashboardView } from './views/DashboardView';
import { KanbanView } from './views/KanbanView';
import { PrepProdView } from './views/PrepProdView';
import { ForecastsView } from './views/ForecastsView';
import { VentesView } from './views/VentesView';
import { QualityView } from './views/QualityView';
import { MirageView } from './views/MirageView';
import { DataHistoryView } from './views/DataHistoryView';
import { DeliveriesView } from './views/DeliveriesView';
import { OpsReportingView } from './views/OpsReportingView';
import { OdooView } from './views/OdooView';
import { SupplyChainView } from './views/SupplyChainView';
import { CoaTrackingView } from './views/CoaTrackingView';
import { CockpitView } from './views/CockpitView';
import { QmsView } from './views/QmsView';
import { QmsDocListView } from './views/QmsDocListView';
import { QmsCapaView } from './views/QmsCapaView';
import { QmsRisquesView } from './views/QmsRisquesView';
import { QmsEquipementView } from './views/QmsEquipementView';
import { QmsFournisseursView } from './views/QmsFournisseursView';
import { PackingListView } from './views/PackingListView';
import { MayaChat } from './components/MayaChat';
import { SettingsView } from './views/SettingsView';
import { UsersView } from './views/UsersView';
import { AuditLogsView } from './views/AuditLogsView';
import { BatchDrawer } from './components/BatchDrawer';
import { Loader2 } from 'lucide-react';

function AppContent() {
  const { loading } = useAppContext();
  const { isAdmin, canEdit, hasView } = useAuth();
  const [currentView, setCurrentView] = useState('dashboard');
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [presentation, setPresentation] = useState(false);

  // Mode présentation : plein écran + menu masqué + contenu agrandi (pour projeter à l'écran).
  useEffect(() => {
    const onFsChange = () => { if (!document.fullscreenElement) setPresentation(false); };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const togglePresentation = () => {
    if (!presentation) {
      document.documentElement.requestFullscreen?.();
      setPresentation(true);
    } else {
      if (document.fullscreenElement) document.exitFullscreen?.();
      setPresentation(false);
    }
  };

  // « Utilisateurs » : admin uniquement. Les autres onglets dépendent des permissions de l'utilisateur.
  const NAV_ORDER = ['dashboard', 'kanban', 'prepprod-suivi', 'forecasts', 'ventes', 'cockpit-dashboard', 'quality', 'deliveries', 'pl', 'opsreporting', 'odooerp', 'supplychain', 'coa-dashboard', 'qms-docs', 'data', 'audit', 'settings', 'users'];
  const canSee = (view: string) => view === 'users' ? isAdmin : (view.startsWith('coa') ? hasView('coa') : view.startsWith('qms') ? hasView('qms') : view.startsWith('prepprod') ? hasView('prepprod') : view.startsWith('cockpit') ? hasView('cockpit') : view.startsWith('pl') ? hasView('pl') : hasView(view));
  const activeView = canSee(currentView) ? currentView : (NAV_ORDER.find(canSee) ?? null);

  // Si l'onglet courant n'est plus autorisé, basculer sur le premier accessible.
  useEffect(() => {
    if (activeView && activeView !== currentView) setCurrentView(activeView);
  }, [activeView, currentView]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50 text-slate-500">
        <Loader2 className="w-6 h-6 animate-spin mr-2" />
        Chargement...
      </div>
    );
  }

  const titles: Record<string, string> = {
    'dashboard': 'Tracking Production',
    'kanban': 'Tracking Kanban',
    'prepprod-suivi': 'Préparation prod · Suivi BC',
    'prepprod-lots': 'Préparation prod · Affectation n° de lot',
    'prepprod-ddl': 'Préparation prod · Création DDL',
    'cockpit-dashboard': 'Cockpit opérationnel Louna · Dashboard',
    'cockpit-cogs': 'Cockpit opérationnel Louna · COGS',
    'cockpit-nomenclature': 'Cockpit opérationnel Louna · Nomenclature',
    'cockpit-familles': 'Cockpit opérationnel Louna · COGS Product',
    'cockpit-cogs-filler': 'Cockpit opérationnel Louna · COGS Filler',
    'forecasts': 'Forecast Production',
    'ventes': 'Forecast Ventes',
    'quality': 'Qualité',
    'mirage': 'Analyse des mirages',
    'data': 'Data Historique',
    'deliveries': 'Livraisons Clients',
    'pl': 'Packing List & Factures',
    'opsreporting': 'Reporting Ops',
    'odooerp': 'Odoo / ERP',
    'supplychain': 'Supply chain',
    'coa-dashboard': 'CoA Tracking · Tableau de bord',
    'coa-lots': 'CoA Tracking · Lots',
    'coa-alertes': 'CoA Tracking · Alertes',
    'coa-parametres': 'CoA Tracking · Paramètres',
    'qms-doclist': 'QMS · Documents QA',
    'qms-docs': 'QMS · Maîtrise documentaire',
    'qms-capa': 'QMS · NC / CAPA / Change',
    'qms-risques': 'QMS · Gap Analysis & Risques',
    'qms-equip': 'QMS · Gestion des équipements',
    'qms-suppliers': 'QMS · Gestion des fournisseurs',
    'users': 'Utilisateurs',
    'audit': 'Journal d\'Audit',
    'settings': 'Paramètres'
  };

  const handleNewBatch = () => {
    if (canEdit) {
      setSelectedBatchId(`NEW-${Math.floor(Math.random() * 10000)}`);
    }
  };

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900 font-sans overflow-hidden">
      {!presentation && <Sidebar currentView={activeView || ''} onChangeView={setCurrentView} isAdmin={isAdmin} />}

      <main className="flex-1 flex flex-col min-w-0" style={{ zoom: presentation ? 1.3 : 1 }}>
        <Header
          title={(activeView && titles[activeView]) || 'LounaFlow'}
          currentView={activeView || ''}
          onNewBatch={handleNewBatch}
          presentation={presentation}
          onTogglePresentation={togglePresentation}
        />

        {!activeView && (
          <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
            Aucun onglet ne vous est accessible. Contactez un administrateur.
          </div>
        )}
        {activeView === 'dashboard' && <DashboardView onOpenBatch={setSelectedBatchId} />}
        {activeView === 'kanban' && <KanbanView onOpenBatch={setSelectedBatchId} />}
        {activeView && activeView.startsWith('prepprod') && <PrepProdView view={activeView} onOpenBatch={setSelectedBatchId} />}
        {activeView === 'forecasts' && <ForecastsView onOpenBatch={setSelectedBatchId} />}
        {activeView === 'ventes' && <VentesView />}
        {activeView === 'quality' && <QualityView onOpenBatch={setSelectedBatchId} />}
        {activeView === 'mirage' && <MirageView />}
        {activeView === 'data' && <DataHistoryView onOpenBatch={setSelectedBatchId} />}
        {activeView === 'deliveries' && <DeliveriesView />}
        {activeView && activeView.startsWith('pl') && <PackingListView />}
        {activeView === 'opsreporting' && <OpsReportingView />}
        {activeView === 'odooerp' && <OdooView />}
        {activeView === 'supplychain' && <SupplyChainView />}
        {activeView && activeView.startsWith('cockpit') && <CockpitView view={activeView} />}
        {activeView && activeView.startsWith('coa') && <CoaTrackingView view={activeView} />}
        {activeView === 'qms-doclist' && <QmsDocListView />}
        {activeView === 'qms-docs' && <QmsView />}
        {activeView === 'qms-capa' && <QmsCapaView />}
        {activeView === 'qms-risques' && <QmsRisquesView />}
        {activeView === 'qms-equip' && <QmsEquipementView />}
        {activeView === 'qms-suppliers' && <QmsFournisseursView />}
        {activeView && activeView.startsWith('qms') && <MayaChat />}
        {activeView === 'users' && <UsersView />}
        {activeView === 'audit' && <AuditLogsView />}
        {activeView === 'settings' && <SettingsView />}
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
