import React, { useState } from 'react';
import { LayoutDashboard, KanbanSquare, ClipboardCheck, FolderKanban, Boxes, FileCheck, ChevronDown, TrendingUp, BarChart3, TestTube2, Database, Truck, Settings, Activity, Users, Shield, FolderCheck, Gauge, PackageCheck, Eye, PackageSearch, Home, Mail, X } from 'lucide-react';
import { cn } from '../utils/cn';
import { useAuth } from '../AuthContext';

interface SidebarProps {
  currentView: string;
  onChangeView: (view: string) => void;
  isAdmin: boolean;
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
}

// adminOnly : réservé admin. ownerOnly : onglets personnels d'Abdel (Accueil, Emails),
// invisibles pour tous les autres comptes, y compris les administrateurs.
// children : sous-menus (l'accès est géré par la permission du parent).
const navItems: any[] = [
  { id: 'accueil', label: 'Accueil', icon: Home, adminOnly: false, ownerOnly: true },
  { id: 'emails', label: 'Emails', icon: Mail, adminOnly: false, ownerOnly: true },
  { id: 'pilotage', label: "Aujourd'hui", icon: Gauge, adminOnly: false },
  { id: 'dashboard', label: 'Tracking Production', icon: LayoutDashboard, adminOnly: false },
  { id: 'kanban', label: 'Tracking Kanban', icon: KanbanSquare, adminOnly: false },
  {
    id: 'prepprod', label: 'Préparation prod', icon: ClipboardCheck, adminOnly: false, children: [
      { id: 'prepprod-suivi', label: 'Suivi BC' },
      { id: 'prepprod-lots', label: 'Affectation n° de lot' },
      { id: 'prepprod-ddl', label: 'Création DDL' },
    ],
  },
  { id: 'forecasts', label: 'Forecast Production', icon: TrendingUp, adminOnly: false },
  { id: 'ventes', label: 'Forecast Ventes', icon: BarChart3, adminOnly: false },
  {
    id: 'cockpit', label: 'Cockpit Louna', icon: Gauge, adminOnly: false, children: [
      { id: 'cockpit-dashboard', label: 'Dashboard' },
      { id: 'cockpit-cogs', label: 'COGS' },
      { id: 'cockpit-nomenclature', label: 'Nomenclature' },
      { id: 'cockpit-familles', label: 'COGS Product' },
      { id: 'cockpit-cogs-filler', label: 'COGS Filler' },
    ],
  },
  { id: 'quality', label: 'Qualité', icon: TestTube2, adminOnly: false },
  { id: 'mirage', label: 'Mirage', icon: Eye, adminOnly: false },
  { id: 'deliveries', label: 'Livraisons', icon: Truck, adminOnly: false },
  { id: 'pl', label: 'Packing List & Factures', icon: PackageCheck, adminOnly: false },
  { id: 'opsreporting', label: 'Reporting Ops', icon: FolderKanban, adminOnly: false },
  { id: 'odooerp', label: 'Odoo / ERP', icon: Boxes, adminOnly: false },
  { id: 'supplychain', label: 'Supply chain', icon: PackageSearch, adminOnly: false },
  {
    id: 'coa', label: 'CoA Tracking', icon: FileCheck, adminOnly: false, children: [
      { id: 'coa-dashboard', label: 'Tableau de bord' },
      { id: 'coa-lots', label: 'Lots' },
      { id: 'coa-alertes', label: 'Alertes' },
      { id: 'coa-parametres', label: 'Paramètres' },
    ],
  },
  {
    id: 'qms', label: 'QMS', icon: FolderCheck, adminOnly: false, children: [
      { id: 'qms-doclist', label: 'Documents QA' },
      { id: 'qms-docs', label: 'Maîtrise documentaire' },
      { id: 'qms-capa', label: 'NC / CAPA / Change' },
      { id: 'qms-risques', label: 'Gap Analysis & Risques' },
      { id: 'qms-equip', label: 'Gestion des équipements' },
      { id: 'qms-suppliers', label: 'Gestion des fournisseurs' },
    ],
  },
  { id: 'data', label: 'Data Historique', icon: Database, adminOnly: false },
  { id: 'users', label: 'Utilisateurs', icon: Users, adminOnly: true },
  { id: 'audit', label: 'Journal d\'Audit', icon: Shield, adminOnly: false },
  { id: 'settings', label: 'Paramètres', icon: Settings, adminOnly: false },
];

export function Sidebar({ currentView, onChangeView, isAdmin, mobileOpen = false, onCloseMobile }: SidebarProps) {
  const { hasView, isOwner } = useAuth();
  const [open, setOpen] = useState<Set<string>>(new Set(currentView.startsWith('coa') ? ['coa'] : currentView.startsWith('qms') ? ['qms'] : currentView.startsWith('prepprod') ? ['prepprod'] : currentView.startsWith('cockpit') ? ['cockpit'] : []));
  const visibleItems = navItems.filter(item => item.ownerOnly ? isOwner : item.adminOnly ? isAdmin : hasView(item.id));

  const itemCls = (active: boolean) => cn(
    'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
    active ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
  );

  return (
    <aside className={cn(
      'w-64 bg-white border-r border-slate-200 flex flex-col py-6 px-4 shrink-0 overflow-y-auto',
      'fixed inset-y-0 left-0 z-40 transition-transform duration-200 lg:static lg:translate-x-0 lg:shadow-none',
      mobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'
    )}>
      <div className="flex items-center justify-between gap-2 text-blue-600 font-bold text-xl mb-8 px-2">
        <span className="flex items-center gap-2"><Activity className="w-6 h-6" /> LounaFlow</span>
        <button onClick={onCloseMobile} aria-label="Fermer le menu" className="lg:hidden p-1 rounded-md text-slate-400 hover:bg-slate-100">
          <X className="w-5 h-5" />
        </button>
      </div>
      <nav className="flex flex-col gap-1">
        {visibleItems.map((item) => {
          const Icon = item.icon;

          if (item.children) {
            const isOpen = open.has(item.id);
            const parentActive = currentView === item.id || currentView.startsWith(item.id + '-');
            return (
              <div key={item.id}>
                <button
                  onClick={() => setOpen(s => { const n = new Set(s); n.has(item.id) ? n.delete(item.id) : n.add(item.id); return n; })}
                  className={itemCls(parentActive && !isOpen)}
                >
                  <Icon className="w-5 h-5" />
                  {item.label}
                  <ChevronDown className={cn('ml-auto w-4 h-4 transition-transform', isOpen && 'rotate-180')} />
                </button>
                {isOpen && (
                  <div className="ml-4 mt-1 mb-1 flex flex-col gap-1 border-l border-slate-200 pl-3">
                    {item.children.map((c: any) => (
                      <button
                        key={c.id}
                        onClick={() => onChangeView(c.id)}
                        className={cn(
                          'text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                          currentView === c.id ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
                        )}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          }

          return (
            <button key={item.id} onClick={() => onChangeView(item.id)} className={itemCls(currentView === item.id)}>
              <Icon className="w-5 h-5" />
              {item.label}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
