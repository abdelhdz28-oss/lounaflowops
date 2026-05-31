import React from 'react';
import { Download, Plus, LogOut, User, Shield, Edit3, Eye } from 'lucide-react';
import { useAppContext } from '../AppContext';
import { useAuth } from '../AuthContext';
import { exportCurrentView } from '../utils/export';
import { cn } from '../utils/cn';

interface HeaderProps {
  title: string;
  currentView: string;
  onNewBatch: () => void;
}

const roleLabels: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  admin: { label: 'Admin', icon: <Shield className="w-3 h-3" />, color: 'text-red-600 bg-red-50 border-red-200' },
  editor: { label: 'Éditeur', icon: <Edit3 className="w-3 h-3" />, color: 'text-blue-600 bg-blue-50 border-blue-200' },
  viewer: { label: 'Lecture seule', icon: <Eye className="w-3 h-3" />, color: 'text-slate-600 bg-slate-50 border-slate-200' },
};

export function Header({ title, currentView, onNewBatch }: HeaderProps) {
  const { batches, deliveries, fluxConfig } = useAppContext();
  const { user, logout, canEdit } = useAuth();

  const handleExport = () => {
    exportCurrentView(currentView, { batches, deliveries, fluxConfig });
  };

  const roleInfo = user ? (roleLabels[user.role] || roleLabels.viewer) : null;

  return (
    <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8 shrink-0">
      <h1 className="text-lg font-semibold text-slate-800">{title}</h1>

      <div className="flex items-center gap-4">
        {user && roleInfo && (
          <div className="flex items-center gap-3 mr-2">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm">
              <User className="w-4 h-4 text-slate-500" />
              <span className="font-medium text-slate-700">{user.username}</span>
              <span className={cn(
                "flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium border",
                roleInfo.color
              )}>
                {roleInfo.icon}
                {roleInfo.label}
              </span>
            </div>
          </div>
        )}

        <button
          onClick={handleExport}
          className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-slate-600 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors"
        >
          <Download className="w-4 h-4" />
          Exporter
        </button>

        {canEdit && (
          <button
            onClick={onNewBatch}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Nouveau Lot
          </button>
        )}

        <button
          onClick={logout}
          className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-slate-500 bg-white border border-slate-200 rounded-md hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors"
          title="Déconnexion"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}
