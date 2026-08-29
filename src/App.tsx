import React, { useState, useEffect, lazy, Suspense } from 'react';
import { AuthProvider, useAuth } from './AuthContext';
import { AppProvider, useAppContext } from './AppContext';
import { LoginPage } from './components/LoginPage';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { MayaChat } from './components/MayaChat';
import { BatchDrawer } from './components/BatchDrawer';
import { Loader2 } from 'lucide-react';

// Vues chargées à la demande (code splitting) : chaque onglet n'est téléchargé
// qu'à sa première ouverture, ce qui allège fortement le chargement initial.
const AccueilView = lazy(() => import('./views/AccueilView').then(m => ({ default: m.AccueilView })));
const EmailsView = lazy(() => import('./views/EmailsView').then(m => ({ default: m.EmailsView })));
const PilotageView = lazy(() => import('./views/PilotageView').then(m => ({ default: m.PilotageView })));
const DashboardView = lazy(() => import('./views/DashboardView').then(m => ({ default: m.DashboardView })));
const KanbanView = lazy(() => import('./views/KanbanView').then(m => ({ default: m.KanbanView })));
const PrepProdView = lazy(() => import('./views/PrepProdView').then(m => ({ default: m.PrepProdView })));
const ForecastsView = lazy(() => import('./views/ForecastsView').then(m => ({ default: m.ForecastsView })));
const VentesView = lazy(() => import('./views/VentesView').then(m => ({ default: m.VentesView })));
const QualityView = lazy(() => import('./views/QualityView').then(m => ({ default: m.QualityView })));
const MirageView = lazy(() => import('./views/MirageView').then(m => ({ default: m.MirageView })));
const DataHistoryView = lazy(() => import('./views/DataHistoryView').then(m => ({ default: m.DataHistoryView })));
const DeliveriesView = lazy(() => import('./views/DeliveriesView').then(m => ({ default: m.DeliveriesView })));
const OpsReportingView = lazy(() => import('./views/OpsReportingView').then(m => ({ default: m.OpsReportingView })));
const OdooView = lazy(() => import('./views/OdooView').then(m => ({ default: m.OdooView })));
const SupplyChainView = lazy(() => import('./views/SupplyChainView').then(m => ({ default: m.SupplyChainView })));
const CoaTrackingView = lazy(() => import('./views/CoaTrackingView').then(m => ({ default: m.CoaTrackingView })));
const CockpitView = lazy(() => import('./views/CockpitView').then(m => ({ default: m.CockpitView })));
const QmsView = lazy(() => import('./views/QmsView').then(m => ({ default: m.QmsView })));
const QmsDocListView = lazy(() => import('./views/QmsDocListView').then(m => ({ default: m.QmsDocListView })));
const QmsCapaView = lazy(() => import('./views/QmsCapaView').then(m => ({ default: m.QmsCapaView })));
const QmsRisquesView = lazy(() => import('./views/QmsRisquesView').then(m => ({ default: m.QmsRisquesView })));
const QmsEquipementView = lazy(() => import('./views/QmsEquipementView').then(m => ({ default: m.QmsEquipementView })));
const QmsFournisseursView = lazy(() => import('./views/QmsFournisseursView').then(m => ({ default: m.QmsFournisseursView })));
const PackingListView = lazy(() => import('./views/PackingListView').then(m => ({ default: m.PackingListView })));
const SettingsView = lazy(() => import('./views/SettingsView').then(m => ({ default: m.SettingsView })));
const UsersView = lazy(() => import('./views/UsersView').then(m => ({ default: m.UsersView })));
const AuditLogsView = lazy(() => import('./views/AuditLogsView').then(m => ({ default: m.AuditLogsView })));

function AppContent() {
  const { loading } = useAppContext();
  const { isAdmin, canEdit, hasView, isOwner } = useAuth();
  const [currentView, setCurrentView] = useState(isOwner ? 'accueil' : 'dashboard');
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [presentation, setPresentation] = useState(false);
  const [navOpen, setNavOpen] = useState(false); // menu escamotable sur téléphone
  const [mayaOpen, setMayaOpen] = useState(false);

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
  const NAV_ORDER = ['accueil', 'emails', 'pilotage', 'dashboard', 'kanban', 'prepprod-suivi', 'forecasts', 'ventes', 'cockpit-dashboard', 'quality', 'deliveries', 'pl', 'opsreporting', 'odooerp', 'supplychain', 'coa-dashboard', 'qms-docs', 'data', 'audit', 'settings', 'users'];
  const canSee = (view: string) => (view === 'accueil' || view === 'emails') ? isOwner : view === 'users' ? isAdmin : (view.startsWith('coa') ? hasView('coa') : view.startsWith('qms') ? hasView('qms') : view.startsWith('prepprod') ? hasView('prepprod') : view.startsWith('cockpit') ? hasView('cockpit') : view.startsWith('pl') ? hasView('pl') : hasView(view));
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
    'accueil': 'Accueil',
    'emails': 'Emails',
    'pilotage': "Aujourd'hui · poste de pilotage",
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
      {!presentation && (
        <>
          <Sidebar currentView={activeView || ''} onChangeView={(v) => { setCurrentView(v); setNavOpen(false); }}
            isAdmin={isAdmin} mobileOpen={navOpen} onCloseMobile={() => setNavOpen(false)} />
          {/* Voile : referme le menu d'un doigt sur téléphone */}
          {navOpen && <div onClick={() => setNavOpen(false)} className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden" />}
        </>
      )}

      <main className="flex-1 flex flex-col min-w-0" style={{ zoom: presentation ? 1.3 : 1 }}>
        <Header
          title={(activeView && titles[activeView]) || 'LounaFlow'}
          currentView={activeView || ''}
          onNewBatch={handleNewBatch}
          presentation={presentation}
          onTogglePresentation={togglePresentation}
          onOpenMaya={() => setMayaOpen(true)}
          onOpenMenu={() => setNavOpen(true)}
        />

        {!activeView && (
          <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
            Aucun onglet ne vous est accessible. Contactez un administrateur.
          </div>
        )}
        <Suspense fallback={
          <div className="flex-1 flex items-center justify-center text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Chargement…
          </div>
        }>
        {activeView === 'accueil' && <AccueilView onOpenBatch={setSelectedBatchId} onGoEmails={() => setCurrentView('emails')} />}
        {activeView === 'emails' && <EmailsView />}
        {activeView === 'pilotage' && <PilotageView onOpenBatch={setSelectedBatchId} />}
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
        <MayaChat open={mayaOpen} onClose={() => setMayaOpen(false)} />
        {activeView === 'users' && <UsersView />}
        {activeView === 'audit' && <AuditLogsView />}
        {activeView === 'settings' && <SettingsView />}
        </Suspense>
      </main>

      {selectedBatchId && (
        <BatchDrawer
          batchId={selectedBatchId}
          onClose={() => setSelectedBatchId(null)}
          onOpenCatalogue={() => { setSelectedBatchId(null); setCurrentView('settings'); }}
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
