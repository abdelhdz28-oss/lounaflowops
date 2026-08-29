import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../AuthContext';
import { 
  Shield, 
  LogIn, 
  LogOut, 
  FileText, 
  Edit, 
  Trash2, 
  Search, 
  User, 
  Calendar, 
  Globe, 
  Laptop, 
  Loader2, 
  AlertTriangle,
  RefreshCw
} from 'lucide-react';
import { cn } from '../utils/cn';

interface AuditLog {
  id: string;
  timestamp: string;
  user_id: string | null;
  username: string;
  action_type: string;
  resource_id: string | null;
  description: string;
  ip_address: string | null;
  user_agent: string | null;
}

const actionCategories = {
  ALL: { label: 'Tous les événements', color: 'bg-slate-100 text-slate-700' },
  AUTH: { label: 'Connexions', color: 'bg-blue-50 border-blue-200 text-blue-700' },
  DATA: { label: 'Modifications Lots & Livraisons', color: 'bg-amber-50 border-amber-200 text-amber-700' },
  READ: { label: 'Accès & Consultations', color: 'bg-sky-50 border-sky-200 text-sky-700' },
  SECURITY: { label: 'Sécurité & Comptes', color: 'bg-red-50 border-red-200 text-red-700' },
};

function getLogMeta(actionType: string) {
  if (actionType.startsWith('LOGIN_SUCCESS')) {
    return { icon: <LogIn className="w-4 h-4 text-emerald-600" />, bgColor: 'bg-emerald-50 border-emerald-100', category: 'AUTH' };
  }
  if (actionType.startsWith('LOGIN_FAILURE')) {
    return { icon: <AlertTriangle className="w-4 h-4 text-red-600" />, bgColor: 'bg-red-50 border-red-100', category: 'SECURITY' };
  }
  if (actionType.startsWith('USER_CREATE')) {
    return { icon: <User className="w-4 h-4 text-emerald-600" />, bgColor: 'bg-emerald-50 border-emerald-100', category: 'SECURITY' };
  }
  if (actionType.startsWith('USER_UPDATE')) {
    return { icon: <Edit className="w-4 h-4 text-blue-600" />, bgColor: 'bg-blue-50 border-blue-100', category: 'SECURITY' };
  }
  if (actionType.startsWith('USER_DELETE')) {
    return { icon: <Trash2 className="w-4 h-4 text-red-600" />, bgColor: 'bg-red-50 border-red-100', category: 'SECURITY' };
  }
  if (actionType.endsWith('CREATE')) {
    return { icon: <Edit className="w-4 h-4 text-emerald-600" />, bgColor: 'bg-emerald-50 border-emerald-100', category: 'DATA' };
  }
  if (actionType.endsWith('UPDATE')) {
    return { icon: <Edit className="w-4 h-4 text-amber-600" />, bgColor: 'bg-amber-50 border-amber-100', category: 'DATA' };
  }
  if (actionType.endsWith('DELETE')) {
    return { icon: <Trash2 className="w-4 h-4 text-red-600" />, bgColor: 'bg-red-50 border-red-100', category: 'DATA' };
  }
  if (actionType.includes('READ')) {
    return { icon: <FileText className="w-4 h-4 text-sky-600" />, bgColor: 'bg-sky-50 border-sky-100', category: 'READ' };
  }
  return { icon: <Shield className="w-4 h-4 text-slate-600" />, bgColor: 'bg-slate-50 border-slate-100', category: 'DATA' };
}

const API_URL = import.meta.env.VITE_API_URL || '';

export function AuditLogsView() {
  const { token, socket } = useAuth();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUser, setSelectedUser] = useState('ALL');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  const fetchLogs = useCallback(async () => {
    if (!token) return;
    try {
      setLoading(true);
      const response = await fetch(`${API_URL}/api/audit-logs`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setLogs(data);
      }
    } catch (error) {
      console.error('Failed to fetch audit logs:', error);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Écoute des événements temps réel via Socket.IO
  useEffect(() => {
    if (!socket) return;

    const handleNewAudit = (newLog: any) => {
      // Insertion dynamique en tête de liste avec fondu
      setLogs((prevLogs) => [newLog, ...prevLogs].slice(0, 500));
    };

    socket.on('audit:logged', handleNewAudit);

    return () => {
      socket.off('audit:logged', handleNewAudit);
    };
  }, [socket]);

  const uniqueUsers = Array.from(new Set(logs.map(log => log.username)));

  // Filtrage des logs
  const filteredLogs = logs.filter(log => {
    const meta = getLogMeta(log.action_type);
    
    const matchesSearch = 
      log.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.action_type.toLowerCase().includes(searchQuery.toLowerCase());
      
    const matchesUser = selectedUser === 'ALL' || log.username === selectedUser;
    const matchesCategory = selectedCategory === 'ALL' || meta.category === selectedCategory;

    return matchesSearch && matchesUser && matchesCategory;
  });

  // Calcul des statistiques
  const stats = {
    total: logs.length,
    connections: logs.filter(l => getLogMeta(l.action_type).category === 'AUTH').length,
    modifications: logs.filter(l => getLogMeta(l.action_type).category === 'DATA').length,
    security: logs.filter(l => getLogMeta(l.action_type).category === 'SECURITY').length
  };

  const toggleExpandLog = (id: string) => {
    setExpandedLogId(expandedLogId === id ? null : id);
  };

  if (loading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600 mr-2" />
        <span className="text-slate-500 font-medium">Chargement du journal d'audit...</span>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 flex-1 overflow-y-auto bg-slate-50">
      <div className="max-w-6xl mx-auto space-y-6">
        
        {/* Résumé des statistiques d'audit */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
              <Shield className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Événements</p>
              <h4 className="text-2xl font-bold text-slate-800 mt-1">{stats.total}</h4>
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0">
              <LogIn className="w-6 h-6 text-emerald-600" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Connexions</p>
              <h4 className="text-2xl font-bold text-slate-800 mt-1">{stats.connections}</h4>
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
              <Edit className="w-6 h-6 text-amber-600" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Modifications</p>
              <h4 className="text-2xl font-bold text-slate-800 mt-1">{stats.modifications}</h4>
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-red-50 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-6 h-6 text-red-600" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Sécurité & Alertes</p>
              <h4 className="text-2xl font-bold text-slate-800 mt-1">{stats.security}</h4>
            </div>
          </div>
        </div>

        {/* Panneau de filtrage */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
            <div className="relative w-full md:w-80">
              <Search className="absolute left-3.5 top-3 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Rechercher une action, un utilisateur..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm transition-all"
              />
            </div>

            <div className="flex flex-wrap gap-3 w-full md:w-auto justify-end">
              {/* Filtre par collaborateur */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-slate-500">Collaborateur :</span>
                <select
                  value={selectedUser}
                  onChange={(e) => setSelectedUser(e.target.value)}
                  className="px-3 py-1.5 border border-slate-200 rounded-xl text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="ALL">Tous les collaborateurs</option>
                  {uniqueUsers.map(user => (
                    <option key={user} value={user}>{user}</option>
                  ))}
                </select>
              </div>

              {/* Bouton rafraîchir */}
              <button
                onClick={fetchLogs}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-600 bg-blue-50 rounded-xl hover:bg-blue-100 transition-colors"
                title="Rafraîchir"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Rafraîchir
              </button>
            </div>
          </div>

          {/* Filtres par catégories d'action */}
          <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100">
            {Object.entries(actionCategories).map(([key, value]) => (
              <button
                key={key}
                onClick={() => setSelectedCategory(key)}
                className={cn(
                  "px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-all cursor-pointer",
                  selectedCategory === key
                    ? "bg-slate-800 border-slate-800 text-white shadow-sm"
                    : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                )}
              >
                {value.label}
              </button>
            ))}
          </div>
        </div>

        {/* Timeline des Logs */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 overflow-hidden">
          <div className="relative border-l border-slate-150 pl-6 ml-3 space-y-6">
            
            {filteredLogs.map((log) => {
              const meta = getLogMeta(log.action_type);
              const isExpanded = expandedLogId === log.id;
              const formattedDate = new Date(log.timestamp).toLocaleDateString('fr-FR', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
              });

              return (
                <div key={log.id} className="relative group transition-all duration-200">
                  {/* Point central de la timeline */}
                  <div className={cn(
                    "absolute -left-[38px] top-1 w-7 h-7 rounded-full flex items-center justify-center border-2 border-white shadow-sm",
                    meta.bgColor
                  )}>
                    {meta.icon}
                  </div>

                  {/* Bloc de log */}
                  <div className="space-y-1">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-slate-800">{log.username}</span>
                        <span className={cn(
                          "inline-flex px-2 py-0.5 rounded text-[10px] font-semibold border tracking-wider",
                          actionCategories[meta.category as keyof typeof actionCategories]?.color || 'bg-slate-50 text-slate-500'
                        )}>
                          {log.action_type}
                        </span>
                      </div>
                      
                      <div className="flex items-center gap-1.5 text-xs text-slate-400">
                        <Calendar className="w-3.5 h-3.5" />
                        <span>{formattedDate}</span>
                      </div>
                    </div>

                    <p className="text-sm text-slate-600 mt-1">{log.description}</p>

                    {/* Accès détails de sécurité */}
                    <div className="pt-1 flex items-center gap-4">
                      <button
                        onClick={() => toggleExpandLog(log.id)}
                        className="text-xs font-semibold text-blue-600 hover:text-blue-700 transition-colors flex items-center gap-1 cursor-pointer"
                      >
                        {isExpanded ? "Masquer les détails" : "Plus d'infos (IP, Agent)"}
                      </button>
                    </div>

                    {/* Panneau déplié d'audit technique */}
                    {isExpanded && (
                      <div className="mt-3 p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-500 grid grid-cols-1 md:grid-cols-2 gap-3 animate-fadeIn">
                        <div className="flex items-center gap-2">
                          <Globe className="w-4 h-4 text-slate-400 shrink-0" />
                          <span><strong>Adresse IP :</strong> {log.ip_address || "Inconnue"}</span>
                        </div>
                        <div className="flex items-start gap-2">
                          <Laptop className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                          <span className="break-all"><strong>Navigateur / Agent :</strong> {log.user_agent || "Non renseigné"}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {filteredLogs.length === 0 && (
              <div className="py-12 text-center text-slate-500 -ml-6">
                <Shield className="w-12 h-12 mx-auto mb-3 text-slate-200" />
                <p className="text-sm font-semibold">Aucun événement ne correspond à vos critères</p>
                <p className="text-xs text-slate-400 mt-1">Modifiez vos filtres ou effectuez une nouvelle recherche</p>
              </div>
            )}

          </div>
        </div>

      </div>
    </div>
  );
}
