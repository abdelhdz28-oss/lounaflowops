import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../AuthContext';
import { User, Plus, Edit2, Trash2, Shield, Edit3, Eye, Loader2, X, Check } from 'lucide-react';
import { cn } from '../utils/cn';

const API_URL = import.meta.env.VITE_API_URL || '';

type UserRole = 'admin' | 'editor' | 'viewer';

interface UserData {
  id: string;
  username: string;
  role: UserRole;
  permissions?: string[];
  created_at: string;
}

// Onglets attribuables par utilisateur (l'onglet « Utilisateurs » reste réservé admin).
const ATTRIBUTABLE_VIEWS: { id: string; label: string }[] = [
  { id: 'dashboard', label: 'Tracking Production' },
  { id: 'kanban', label: 'Tracking Kanban' },
  { id: 'prepprod', label: 'Préparation prod' },
  { id: 'forecasts', label: 'Forecast Production' },
  { id: 'ventes', label: 'Forecast Ventes' },
  { id: 'quality', label: 'Qualité' },
  { id: 'deliveries', label: 'Livraisons' },
  { id: 'pl', label: 'Packing List & Factures' },
  { id: 'opsreporting', label: 'Reporting Ops' },
  { id: 'odooerp', label: 'Odoo / ERP' },
  { id: 'coa', label: 'CoA Tracking' },
  { id: 'qms', label: 'QMS (Qualité / Doc / NC-CAPA / Fournisseurs…)' },
  { id: 'data', label: 'Data Historique' },
  { id: 'audit', label: "Journal d'Audit" },
  { id: 'settings', label: 'Paramètres' },
];
const ALL_VIEW_IDS = ATTRIBUTABLE_VIEWS.map(v => v.id);

const roleInfo: Record<UserRole, { label: string; icon: React.ReactNode; color: string; bgColor: string }> = {
  admin: { label: 'Admin', icon: <Shield className="w-4 h-4" />, color: 'text-red-700', bgColor: 'bg-red-50 border-red-200' },
  editor: { label: 'Éditeur', icon: <Edit3 className="w-4 h-4" />, color: 'text-blue-700', bgColor: 'bg-blue-50 border-blue-200' },
  viewer: { label: 'Lecture seule', icon: <Eye className="w-4 h-4" />, color: 'text-slate-600', bgColor: 'bg-slate-50 border-slate-200' },
};

export function UsersView() {
  const { token, user: currentUser } = useAuth();
  const [users, setUsers] = useState<UserData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<UserData | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [formUsername, setFormUsername] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formRole, setFormRole] = useState<UserRole>('viewer');
  const [formPermissions, setFormPermissions] = useState<string[]>(ALL_VIEW_IDS);
  const [formLoading, setFormLoading] = useState(false);

  const togglePermission = (viewId: string) => {
    setFormPermissions(prev =>
      prev.includes(viewId) ? prev.filter(v => v !== viewId) : [...prev, viewId]
    );
  };

  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    if (!token) return;

    try {
      setLoading(true);
      const response = await fetch(`${API_URL}/api/users`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        const data = await response.json();
        setUsers(data);
      }
    } catch (err) {
      console.error('Error loading users:', err);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const openCreateModal = () => {
    setEditingUser(null);
    setFormUsername('');
    setFormPassword('');
    setFormRole('viewer');
    setFormPermissions(ALL_VIEW_IDS); // tout coché par défaut
    setError('');
    setSuccess('');
    setShowModal(true);
  };

  const openEditModal = (user: UserData) => {
    setEditingUser(user);
    setFormUsername(user.username);
    setFormPassword('');
    setFormRole(user.role);
    setFormPermissions(user.permissions ?? ALL_VIEW_IDS);
    setError('');
    setSuccess('');
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setFormLoading(true);

    try {
      if (editingUser) {
        const updates: Partial<{ password: string; role: UserRole; permissions: string[] }> = {};
        if (formPassword) updates.password = formPassword;
        if (formRole !== editingUser.role) updates.role = formRole;
        // Les permissions ne concernent pas l'admin (accès total). Envoyer si elles ont changé.
        const prevPerms = [...(editingUser.permissions ?? ALL_VIEW_IDS)].sort();
        const nextPerms = [...formPermissions].sort();
        if (formRole !== 'admin' && JSON.stringify(prevPerms) !== JSON.stringify(nextPerms)) {
          updates.permissions = formPermissions;
        }

        if (Object.keys(updates).length === 0) {
          setError('Aucune modification à enregistrer');
          setFormLoading(false);
          return;
        }

        const response = await fetch(`${API_URL}/api/users/${editingUser.id}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(updates)
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Erreur lors de la modification');
        }

        setSuccess('Utilisateur modifié avec succès');
      } else {
        if (!formUsername || !formPassword) {
          setError('Nom d\'utilisateur et mot de passe requis');
          setFormLoading(false);
          return;
        }

        const response = await fetch(`${API_URL}/api/users`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            username: formUsername,
            password: formPassword,
            role: formRole,
            permissions: formRole === 'admin' ? ALL_VIEW_IDS : formPermissions
          })
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Erreur lors de la création');
        }

        setSuccess('Utilisateur créé avec succès');
      }

      setTimeout(() => {
        setShowModal(false);
        loadUsers();
      }, 1000);
    } catch (err: any) {
      setError(err.message || 'Erreur');
    } finally {
      setFormLoading(false);
    }
  };

  const handleDelete = async (userId: string) => {
    try {
      const response = await fetch(`${API_URL}/api/users/${userId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        setSuccess('Utilisateur supprimé');
        loadUsers();
      } else {
        const data = await response.json();
        setError(data.error || 'Erreur lors de la suppression');
      }
    } catch (err: any) {
      setError(err.message || 'Erreur');
    } finally {
      setDeleteConfirm(null);
    }
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="p-8 flex-1 overflow-y-auto bg-slate-50">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h3 className="text-lg font-semibold text-slate-800">Gestion des utilisateurs</h3>
            <p className="text-sm text-slate-500 mt-1">
              {users.length} utilisateur{users.length > 1 ? 's' : ''} enregistré{users.length > 1 ? 's' : ''}
            </p>
          </div>
          <button
            onClick={openCreateModal}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Nouvel utilisateur
          </button>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
            {error}
          </div>
        )}

        {success && (
          <div className="mb-4 p-4 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm">
            {success}
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Utilisateur
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Rôle
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Créé le
                </th>
                <th className="px-6 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((u) => {
                const isCurrentUser = currentUser?.userId === u.id;
                const role = roleInfo[u.role] || roleInfo.viewer;

                return (
                  <tr key={u.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center">
                          <User className="w-4 h-4 text-slate-500" />
                        </div>
                        <div>
                          <div className="text-sm font-medium text-slate-900">
                            {u.username}
                            {isCurrentUser && (
                              <span className="ml-2 text-xs text-blue-600 font-normal">(vous)</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={cn(
                        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border",
                        role.bgColor, role.color
                      )}>
                        {role.icon}
                        {role.label}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-500">
                      {new Date(u.created_at).toLocaleDateString('fr-FR', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric'
                      })}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {deleteConfirm === u.id ? (
                        <div className="flex items-center justify-end gap-2">
                          <span className="text-xs text-red-600 mr-2">Confirmer ?</span>
                          <button
                            onClick={() => handleDelete(u.id)}
                            className="p-1.5 text-white bg-red-600 rounded hover:bg-red-700 transition-colors"
                            title="Confirmer"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setDeleteConfirm(null)}
                            className="p-1.5 text-slate-500 bg-slate-100 rounded hover:bg-slate-200 transition-colors"
                            title="Annuler"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openEditModal(u)}
                            className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                            title="Modifier"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          {!isCurrentUser && (
                            <button
                              onClick={() => setDeleteConfirm(u.id)}
                              className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                              title="Supprimer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {users.length === 0 && (
            <div className="py-12 text-center text-slate-500">
              <User className="w-12 h-12 mx-auto mb-3 text-slate-300" />
              <p className="text-sm">Aucun utilisateur</p>
            </div>
          )}
        </div>

        <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-xl">
          <h4 className="text-sm font-medium text-blue-800 mb-2">Permissions par rôle</h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="p-3 bg-white rounded-lg border border-slate-200">
              <div className="flex items-center gap-2 mb-1">
                <Eye className="w-4 h-4 text-slate-500" />
                <span className="text-sm font-medium text-slate-700">Viewer</span>
              </div>
              <p className="text-xs text-slate-500">Lecture seule des données</p>
            </div>
            <div className="p-3 bg-white rounded-lg border border-slate-200">
              <div className="flex items-center gap-2 mb-1">
                <Edit3 className="w-4 h-4 text-blue-600" />
                <span className="text-sm font-medium text-slate-700">Éditeur</span>
              </div>
              <p className="text-xs text-slate-500">Créer/modifier lots & livraisons</p>
            </div>
            <div className="p-3 bg-white rounded-lg border border-slate-200">
              <div className="flex items-center gap-2 mb-1">
                <Shield className="w-4 h-4 text-red-600" />
                <span className="text-sm font-medium text-slate-700">Admin</span>
              </div>
              <p className="text-xs text-slate-500">Tout + gestion utilisateurs</p>
            </div>
          </div>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-slate-900">
                {editingUser ? 'Modifier l\'utilisateur' : 'Nouvel utilisateur'}
              </h2>
              <button
                onClick={() => setShowModal(false)}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {error && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
                  {error}
                </div>
              )}

              {success && (
                <div className="p-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm">
                  {success}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Nom d'utilisateur
                </label>
                <input
                  type="text"
                  value={formUsername}
                  onChange={(e) => setFormUsername(e.target.value)}
                  disabled={!!editingUser}
                  placeholder="Nom d'utilisateur"
                  className={cn(
                    "w-full px-3 py-2.5 border rounded-lg outline-none transition-colors",
                    editingUser
                      ? "bg-slate-50 text-slate-500 border-slate-200"
                      : "border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  )}
                />
                {editingUser && (
                  <p className="text-xs text-slate-500 mt-1">Le nom d'utilisateur ne peut pas être modifié</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Mot de passe {editingUser && <span className="text-slate-400 font-normal">(laisser vide pour conserver)</span>}
                </label>
                <input
                  type="password"
                  value={formPassword}
                  onChange={(e) => setFormPassword(e.target.value)}
                  placeholder={editingUser ? 'Nouveau mot de passe (optionnel)' : 'Mot de passe'}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Rôle
                </label>
                <select
                  value={formRole}
                  onChange={(e) => setFormRole(e.target.value as UserRole)}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors bg-white"
                >
                  <option value="viewer">Viewer - Lecture seule</option>
                  <option value="editor">Éditeur - Créer/modifier</option>
                  <option value="admin">Admin - Tous les droits</option>
                </select>
              </div>

              {formRole !== 'admin' ? (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    Onglets accessibles
                  </label>
                  <div className="grid grid-cols-2 gap-2 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                    {ATTRIBUTABLE_VIEWS.map(v => (
                      <label key={v.id} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formPermissions.includes(v.id)}
                          onChange={() => togglePermission(v.id)}
                          className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        />
                        {v.label}
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-slate-500 mt-1">Décochez un onglet pour le masquer à cet utilisateur.</p>
                </div>
              ) : (
                <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-3">
                  Un administrateur a accès à tous les onglets.
                </p>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={formLoading}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {formLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Enregistrement...
                    </>
                  ) : (
                    editingUser ? 'Enregistrer' : 'Créer'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
