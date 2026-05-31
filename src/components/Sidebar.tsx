import React from 'react';
import { LayoutDashboard, CalendarDays, TestTube2, Database, Truck, Settings, Activity, Users } from 'lucide-react';
import { cn } from '../utils/cn';

interface SidebarProps {
  currentView: string;
  onChangeView: (view: string) => void;
  isAdmin: boolean;
}

const navItems = [
  { id: 'dashboard', label: 'Tableau de bord', icon: LayoutDashboard, adminOnly: false },
  { id: 'planning', label: 'Planning', icon: CalendarDays, adminOnly: false },
  { id: 'quality', label: 'Qualité', icon: TestTube2, adminOnly: false },
  { id: 'data', label: 'Data Historique', icon: Database, adminOnly: false },
  { id: 'deliveries', label: 'Livraisons', icon: Truck, adminOnly: false },
  { id: 'users', label: 'Utilisateurs', icon: Users, adminOnly: true },
  { id: 'settings', label: 'Paramètres', icon: Settings, adminOnly: false },
];

export function Sidebar({ currentView, onChangeView, isAdmin }: SidebarProps) {
  const visibleItems = navItems.filter(item => !item.adminOnly || isAdmin);

  return (
    <aside className="w-64 bg-white border-r border-slate-200 flex flex-col py-6 px-4 shrink-0">
      <div className="flex items-center gap-2 text-blue-600 font-bold text-xl mb-8 px-2">
        <Activity className="w-6 h-6" />
        <span>LounaFlow</span>
      </div>
      <nav className="flex flex-col gap-1">
        {visibleItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentView === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onChangeView(item.id)}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                isActive
                  ? "bg-blue-600 text-white"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              )}
            >
              <Icon className="w-5 h-5" />
              {item.label}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
