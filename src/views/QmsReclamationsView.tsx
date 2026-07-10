import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../AuthContext';
import { Plus, X, ArrowRightCircle, Loader2, Link2, AlertTriangle } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || '';

const TRANSITIONS: Record<string, string[]> = {
  OUVERTE: ['EN_INVESTIGATION', 'CLOTUREE'], EN_INVESTIGATION: ['CAPA_OUVERTE', 'CLOTUREE', 'OUVERTE'],
  CAPA_OUVERTE: ['CLOTUREE', 'EN_INVESTIGATION'], CLOTUREE: ['OUVERTE'],
};
const STATUT_LABEL: Record<string, string> = { OUVERTE: 'Ouverte', EN_INVESTIGATION: 'En investigation', CAPA_OUVERTE: 'CAPA ouverte', CLOTUREE: 'Clôturée' };
const STATUT_COLOR: Record<string, string> = { OUVERTE: 'bg-amber-100 text-amber-700', EN_INVESTIGATION: 'bg-blue-100 text-blue-700', CAPA_OUVERTE: 'bg-violet-100 text-violet-700', CLOTUREE: 'bg-emerald-100 text-emerald-700' };
const fmtDate = (iso: string | null) => { if (!iso) return '—'; const d = new Date(iso); return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR'); };

export function QmsReclamationsView() {
  const { token, socket, canEdit } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [processes, setProcesses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);

  const authFetch = useCallback(
    (url: string, opts: RequestInit = {}) => fetch(`${API_URL}${url}`, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}), Authorization: `Bearer ${token}` } }),
    [token]
  );
  const load = useCallback(async () => {
    try {
      const [c, p] = await Promise.all([authFetch('/api/qms/complaints'), authFetch('/api/qms/processes')]);
      if (c.ok) setRows(await c.json());
      if (p.ok) setProcesses(await p.json());
    } finally { setLoading(false); }
  }, [authFetch]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!socket) return; const h = () => load(); socket.on('qms:changed', h); return () => { socket.off('qms:changed', h); }; }, [socket, load]);

  const patch = async (id: number, body: any) => { const r = await authFetch(`/api/qms/complaints/${id}`, { method: 'PATCH', body: JSON.stringify(body) }); if (!r.ok) alert((await r.json()).error || 'Erreur'); else load(); };
  const openCapa = async (id: number) => { if (!confirm('Ouvrir une CAPA liée à cette réclamation ?')) return; const r = await authFetch(`/api/qms/complaints/${id}/open-capa`, { method: 'POST' }); if (!r.ok) alert((await r.json()).error || 'Erreur'); else load(); };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-center mb-4">
        <div className="text-sm text-slate-400">{rows.length} réclamation(s) · {rows.filter((r) => r.vigilance).length} en vigilance</div>
        {canEdit && <button onClick={() => setModal(true)} className="ml-auto inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"><Plus className="w-4 h-4" /> Nouvelle réclamation</button>}
      </div>

      {loading ? <div className="py-12 text-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Chargement…</div> : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-50 text-slate-500 text-left">
              <th className="px-4 py-3 font-medium">N°</th><th className="px-4 py-3 font-medium">Produit / Lot</th>
              <th className="px-4 py-3 font-medium">Description</th><th className="px-4 py-3 font-medium">IMDRF</th>
              <th className="px-4 py-3 font-medium">Vigilance</th><th className="px-4 py-3 font-medium">Reçue</th>
              <th className="px-4 py-3 font-medium">Statut</th><th className="px-4 py-3 font-medium">CAPA</th><th className="px-4 py-3 font-medium text-right">Action</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 && <tr><td colSpan={9} className="px-4 py-12 text-center text-slate-400">Aucune réclamation.</td></tr>}
              {rows.map((c) => (
                <tr key={c.id} className={c.vigilance ? 'bg-red-50/30' : 'hover:bg-slate-50'}>
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">{c.numero}</td>
                  <td className="px-4 py-3 text-slate-600">{c.produit || '—'}{c.lot && <div className="text-xs text-slate-400">Lot {c.lot}</div>}</td>
                  <td className="px-4 py-3"><div className="max-w-xs truncate text-slate-800">{c.description}</div></td>
                  <td className="px-4 py-3 text-xs text-slate-500">{c.imdrfCodes || '—'}</td>
                  <td className="px-4 py-3">{c.vigilance ? <span className="inline-flex items-center gap-1 text-red-700 text-xs font-medium"><AlertTriangle className="w-3.5 h-3.5" />Vigilance</span> : <span className="text-slate-300 text-xs">—</span>}</td>
                  <td className="px-4 py-3 text-slate-600">{fmtDate(c.dateReception)}</td>
                  <td className="px-4 py-3">
                    <select value={c.statut} disabled={!canEdit || (TRANSITIONS[c.statut] || []).length === 0} onChange={(e) => { if (e.target.value !== c.statut) patch(c.id, { statut: e.target.value }); }} className={`text-xs font-medium px-2 py-1 rounded-full border-0 ${STATUT_COLOR[c.statut] || 'bg-slate-100'}`}>
                      <option value={c.statut}>{STATUT_LABEL[c.statut] || c.statut}</option>
                      {(TRANSITIONS[c.statut] || []).map((s) => <option key={s} value={s}>→ {STATUT_LABEL[s] || s}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-xs">{c.capaNumero ? <span className="inline-flex items-center gap-1 text-violet-700"><Link2 className="w-3 h-3" />{c.capaNumero}</span> : '—'}</td>
                  <td className="px-4 py-3 text-right">{canEdit && !c.capaId && (c.statut === 'OUVERTE' || c.statut === 'EN_INVESTIGATION') && <button onClick={() => openCapa(c.id)} className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 text-sm font-medium"><ArrowRightCircle className="w-4 h-4" /> Ouvrir CAPA</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && <ComplaintModal processes={processes} authFetch={authFetch} onClose={() => setModal(false)} onSaved={() => { setModal(false); load(); }} />}
    </div>
  );
}

function ComplaintModal({ processes, authFetch, onClose, onSaved }: any) {
  const [f, setF] = useState<any>({ description: '', produit: '', lot: '', dateReception: '', imdrfCodes: '', vigilance: false, gravite: 'MINEURE', processId: '', responsable: '' });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: any) => setF((s: any) => ({ ...s, [k]: v }));
  const save = async () => {
    if (!f.description) { alert('Description requise'); return; }
    setSaving(true);
    try { const r = await authFetch('/api/qms/complaints', { method: 'POST', body: JSON.stringify({ ...f, processId: f.processId || null }) }); if (!r.ok) { alert((await r.json()).error || 'Erreur'); return; } onSaved(); }
    finally { setSaving(false); }
  };
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4"><h2 className="text-lg font-semibold text-slate-800">Nouvelle réclamation</h2><button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button></div>
        <div className="space-y-3">
          <div><label className="block text-sm font-medium text-slate-600 mb-1">Description</label><textarea value={f.description} onChange={(e) => set('description', e.target.value)} rows={2} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm font-medium text-slate-600 mb-1">Produit</label><input value={f.produit} onChange={(e) => set('produit', e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" /></div>
            <div><label className="block text-sm font-medium text-slate-600 mb-1">Lot</label><input value={f.lot} onChange={(e) => set('lot', e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" /></div>
            <div><label className="block text-sm font-medium text-slate-600 mb-1">Date de réception</label><input type="date" value={f.dateReception} onChange={(e) => set('dateReception', e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" /></div>
            <div><label className="block text-sm font-medium text-slate-600 mb-1">Gravité</label><select value={f.gravite} onChange={(e) => set('gravite', e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">{['MINEURE', 'MAJEURE', 'CRITIQUE'].map((s) => <option key={s}>{s}</option>)}</select></div>
            <div><label className="block text-sm font-medium text-slate-600 mb-1">Codes IMDRF</label><input value={f.imdrfCodes} onChange={(e) => set('imdrfCodes', e.target.value)} placeholder="ex. A0701, F0201" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" /></div>
            <div><label className="block text-sm font-medium text-slate-600 mb-1">Responsable</label><input value={f.responsable} onChange={(e) => set('responsable', e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" /></div>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={f.vigilance} onChange={(e) => set('vigilance', e.target.checked)} /> Cas de <span className="font-medium text-red-700">vigilance</span> (déclaration autorité compétente)</label>
          <div><label className="block text-sm font-medium text-slate-600 mb-1">Processus lié</label><select value={f.processId} onChange={(e) => set('processId', e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"><option value="">— Aucun —</option>{processes.map((p: any) => <option key={p.id} value={p.id}>{p.code} · {p.libelle}</option>)}</select></div>
        </div>
        <div className="flex justify-end gap-2 mt-5"><button onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-sm text-slate-600">Annuler</button><button onClick={save} disabled={saving} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50">{saving ? 'Enregistrement…' : 'Enregistrer'}</button></div>
      </div>
    </div>
  );
}
