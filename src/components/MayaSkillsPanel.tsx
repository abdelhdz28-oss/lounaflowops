import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../AuthContext';
import { cn } from '../utils/cn';
import { Plus, Trash2, Pencil, Save, X, Sparkles, Loader2 } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || '';

interface Skill { id: number; name: string; trigger: string; body: string; enabled: boolean; }
const EMPTY = { name: '', trigger: '', body: '', enabled: true };

// Panneau d'administration des « compétences » (fiches méthode) que l'assistante Maya charge à la demande.
export function MayaSkillsPanel() {
  const { token, isAdmin } = useAuth();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<{ id: number | null; name: string; trigger: string; body: string; enabled: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    const r = await fetch(`${API_URL}/api/maya/skills`, { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) { const d = await r.json(); setSkills(d.skills || []); }
    setLoading(false);
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const api = async (method: string, path: string, body?: any) => {
    const r = await fetch(`${API_URL}${path}`, {
      method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) { const e = await r.json().catch(() => ({})); alert(e.error || 'Erreur'); return false; }
    return true;
  };

  const save = async () => {
    if (!editing) return;
    if (!editing.name.trim()) { alert('Donne un nom à la compétence.'); return; }
    setBusy(true);
    const payload = { name: editing.name.trim(), trigger: editing.trigger, body: editing.body, enabled: editing.enabled };
    const ok = editing.id
      ? await api('PATCH', `/api/maya/skills/${editing.id}`, payload)
      : await api('POST', '/api/maya/skills', payload);
    setBusy(false);
    if (ok) { setEditing(null); load(); }
  };

  const toggle = async (s: Skill) => { if (await api('PATCH', `/api/maya/skills/${s.id}`, { enabled: !s.enabled })) load(); };
  const remove = async (s: Skill) => { if (confirm(`Supprimer la compétence « ${s.name} » ?`) && await api('DELETE', `/api/maya/skills/${s.id}`)) load(); };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm mb-8">
      <div className="flex flex-wrap justify-between items-center gap-2 mb-2">
        <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2"><Sparkles className="w-5 h-5 text-blue-600" /> Compétences de Maya</h3>
        {isAdmin && !editing && (
          <button onClick={() => setEditing({ id: null, ...EMPTY })} className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors">
            <Plus className="w-4 h-4" /> Nouvelle compétence
          </button>
        )}
      </div>
      <p className="text-sm text-slate-500 mb-4">
        Des « fiches méthode » que Maya charge au bon moment pour suivre ta façon de faire (analyse, procédure, format de réponse).
        Le champ « Quand l'utiliser » aide Maya à choisir la bonne fiche. Colle ici le contenu d'une méthode ou d'une skill (partie « savoir » uniquement).
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-slate-400 text-sm py-4"><Loader2 className="w-4 h-4 animate-spin" /> Chargement…</div>
      ) : (
        <div className="space-y-2">
          {skills.length === 0 && !editing && <p className="text-sm text-slate-400 italic">Aucune compétence pour l'instant.</p>}
          {skills.map(s => (
            <div key={s.id} className={cn('border rounded-lg p-3', s.enabled ? 'border-slate-200' : 'border-slate-200 bg-slate-50 opacity-70')}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-800 text-sm">{s.name}</span>
                    {!s.enabled && <span className="text-[10px] uppercase font-semibold text-slate-400 border border-slate-300 rounded px-1.5 py-0.5">désactivée</span>}
                  </div>
                  {s.trigger && <div className="text-xs text-slate-500 mt-0.5">Quand : {s.trigger}</div>}
                  <div className="text-xs text-slate-400 mt-1 line-clamp-2 whitespace-pre-wrap">{s.body || '(vide)'}</div>
                </div>
                {isAdmin && (
                  <div className="flex items-center gap-1 shrink-0">
                    <label className="flex items-center gap-1 text-[11px] text-slate-500 mr-1" title="Activer / désactiver pour Maya">
                      <input type="checkbox" checked={s.enabled} onChange={() => toggle(s)} className="h-3.5 w-3.5" /> active
                    </label>
                    <button onClick={() => setEditing({ id: s.id, name: s.name, trigger: s.trigger, body: s.body, enabled: s.enabled })} className="p-1 text-slate-400 hover:text-blue-600" title="Modifier"><Pencil className="w-4 h-4" /></button>
                    <button onClick={() => remove(s)} className="p-1 text-slate-400 hover:text-red-600" title="Supprimer"><Trash2 className="w-4 h-4" /></button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <div className="mt-4 border border-blue-200 bg-blue-50/40 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-700">{editing.id ? 'Modifier la compétence' : 'Nouvelle compétence'}</span>
            <button onClick={() => setEditing(null)} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
          </div>
          <label className="block"><span className="text-xs font-medium text-slate-500">Nom</span>
            <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder="Ex. Analyse taux de rejet Mirage" className="mt-1 w-full text-sm border border-slate-300 rounded-md px-2 py-1.5 outline-none focus:border-blue-500" /></label>
          <label className="block"><span className="text-xs font-medium text-slate-500">Quand l'utiliser (déclencheur)</span>
            <input value={editing.trigger} onChange={e => setEditing({ ...editing, trigger: e.target.value })} placeholder="Ex. quand on parle de rejets, Pareto, contrôle visuel" className="mt-1 w-full text-sm border border-slate-300 rounded-md px-2 py-1.5 outline-none focus:border-blue-500" /></label>
          <label className="block"><span className="text-xs font-medium text-slate-500">Contenu (la méthode)</span>
            <textarea value={editing.body} onChange={e => setEditing({ ...editing, body: e.target.value })} rows={8} placeholder="Décris la méthode / procédure / format de réponse que Maya doit suivre…" className="mt-1 w-full text-sm border border-slate-300 rounded-md px-2 py-1.5 outline-none focus:border-blue-500 font-mono" /></label>
          <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={editing.enabled} onChange={e => setEditing({ ...editing, enabled: e.target.checked })} /> Activée (disponible pour Maya)</label>
          <div className="flex justify-end gap-2">
            <button onClick={() => setEditing(null)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg">Annuler</button>
            <button onClick={save} disabled={busy} className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"><Save className="w-4 h-4" /> {busy ? 'Enregistrement…' : 'Enregistrer'}</button>
          </div>
        </div>
      )}
    </div>
  );
}
