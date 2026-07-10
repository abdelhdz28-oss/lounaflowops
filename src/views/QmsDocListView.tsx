import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../AuthContext';
import { FileCheck, Loader2, RefreshCw, Search, CloudOff } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || '';

type Doc = {
  processus: string; reference: string; titre: string; version: string;
  statut: string; application: string; review: string; emplacement: string;
};

// Regroupe les statuts du fichier en 3 familles : en vigueur / en cours (création ou màj) / obsolète.
const statutKind = (s: string): 'vigueur' | 'cours' | 'obsolete' | 'autre' => {
  const t = (s || '').toLowerCase();
  if (/force|vigueur|applicable|approved/.test(t)) return 'vigueur';
  if (/obsol/.test(t)) return 'obsolete';
  if (t.trim()) return 'cours'; // creation / update / draft / in progress…
  return 'autre';
};

const BADGE: Record<string, string> = {
  vigueur: 'bg-green-50 text-green-700 border-green-200',
  cours: 'bg-amber-50 text-amber-700 border-amber-200',
  obsolete: 'bg-slate-100 text-slate-500 border-slate-200',
  autre: 'bg-slate-50 text-slate-400 border-slate-200',
};

export function QmsDocListView() {
  const { token, logout } = useAuth();
  const auth = { headers: { Authorization: `Bearer ${token}` } };

  const [docs, setDocs] = useState<Doc[]>([]);
  const [fileInfo, setFileInfo] = useState<{ name: string; modified: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [proc, setProc] = useState('__all__');
  const [statutF, setStatutF] = useState<'actifs' | 'vigueur' | 'cours' | 'obsolete' | 'tous'>('actifs');
  const [sortKey, setSortKey] = useState('reference');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const load = useCallback(async (refresh = false) => {
    setLoading(true); setError('');
    try {
      const r = await fetch(`${API_URL}/api/qms/doclist${refresh ? '?refresh=1' : ''}`, auth);
      // Session expirée (401/403) → on renvoie proprement à l'écran de connexion plutôt qu'un message technique.
      if (r.status === 401 || r.status === 403) { logout(); return; }
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error || `Lecture impossible (HTTP ${r.status}).`); setDocs([]); return; }
      setDocs(d.docs || []); setFileInfo(d.file || null);
    } catch { setError('Lecture impossible.'); setDocs([]); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const processes = useMemo(() => [...new Set(docs.map(d => d.processus).filter(Boolean))].sort(), [docs]);

  const filtered = useMemo(() => {
    const needle = q.toLowerCase().trim();
    return docs.filter(d => {
      const kind = statutKind(d.statut);
      if (statutF === 'actifs' && kind === 'obsolete') return false;
      if (statutF === 'vigueur' && kind !== 'vigueur') return false;
      if (statutF === 'cours' && kind !== 'cours') return false;
      if (statutF === 'obsolete' && kind !== 'obsolete') return false;
      if (proc !== '__all__' && d.processus !== proc) return false;
      if (needle && !`${d.reference} ${d.titre} ${d.processus}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [docs, q, proc, statutF]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      const va = String((a as any)[sortKey] ?? ''); const vb = String((b as any)[sortKey] ?? '');
      const c = va.localeCompare(vb, 'fr', { numeric: true });
      return sortDir === 'asc' ? c : -c;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const onSort = (k: string) => {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir('asc'); }
  };

  const kpis = useMemo(() => ({
    vigueur: docs.filter(d => statutKind(d.statut) === 'vigueur').length,
    cours: docs.filter(d => statutKind(d.statut) === 'cours').length,
    obsolete: docs.filter(d => statutKind(d.statut) === 'obsolete').length,
  }), [docs]);

  return (
    <div className="p-6 flex-1 overflow-auto bg-slate-50">
      {/* En-tête */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-blue-600 text-white flex items-center justify-center"><FileCheck className="w-6 h-6" /></div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Documents QA</h1>
            <p className="text-sm text-slate-500">
              {fileInfo ? <>Source : <span className="font-medium">{fileInfo.name}</span> · mis à jour le {fileInfo.modified}</> : 'Liste maîtresse des documents qualité (SharePoint)'}
            </p>
          </div>
        </div>
        <button onClick={() => load(true)} className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100">
          <RefreshCw className="w-4 h-4" /> Resynchroniser
        </button>
      </div>

      {error && (
        <div className="mb-5 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-center gap-2">
          <CloudOff className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4 mb-5">
        <Kpi label="En vigueur" value={kpis.vigueur} cls="text-green-600" />
        <Kpi label="En cours (création / mise à jour)" value={kpis.cours} cls="text-amber-500" />
        <Kpi label="Obsolètes" value={kpis.obsolete} cls="text-slate-400" />
      </div>

      {/* Filtres */}
      <div className="flex items-center gap-3 flex-wrap mb-4">
        <div className="relative flex-1 max-w-sm min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Référence, titre…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
        </div>
        <select value={proc} onChange={e => setProc(e.target.value)} className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white">
          <option value="__all__">Tous les processus</option>
          {processes.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={statutF} onChange={e => setStatutF(e.target.value as any)} className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white">
          <option value="actifs">Actifs (en vigueur + en cours)</option>
          <option value="vigueur">En vigueur</option>
          <option value="cours">En cours (création / màj)</option>
          <option value="obsolete">Obsolètes</option>
          <option value="tous">Tous</option>
        </select>
        <span className="text-xs text-slate-400">{sorted.length} document(s)</span>
      </div>

      {/* Tableau */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center gap-2 text-slate-500 py-16 justify-center"><Loader2 className="w-5 h-5 animate-spin" /> Lecture du fichier…</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <Th label="Processus" k="processus" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                <Th label="Référence" k="reference" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                <Th label="Titre" k="titre" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                <Th label="Version" k="version" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                <Th label="Statut" k="statut" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                <Th label="Date d'application" k="application" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                <Th label="Revue" k="review" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.map((d, i) => {
                const kind = statutKind(d.statut);
                return (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="px-4 py-2 text-slate-500 text-xs">{d.processus || '—'}</td>
                    <td className="px-4 py-2 font-mono text-xs font-semibold text-slate-700">{d.reference || '—'}</td>
                    <td className="px-4 py-2 text-slate-800">{d.titre || '—'}</td>
                    <td className="px-4 py-2 text-slate-600">{d.version || '—'}</td>
                    <td className="px-4 py-2">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full border ${BADGE[kind]}`}>{d.statut || '—'}</span>
                    </td>
                    <td className="px-4 py-2 text-slate-600 tabular-nums">{d.application || '—'}</td>
                    <td className="px-4 py-2 text-slate-500 tabular-nums">{d.review || '—'}</td>
                  </tr>
                );
              })}
              {sorted.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">Aucun document ne correspond aux filtres.</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, cls }: { label: string; value: number; cls: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="text-xs text-slate-500 mb-1">{label}</div>
      <div className={`text-2xl font-bold ${cls}`}>{value}</div>
    </div>
  );
}

function Th({ label, k, sortKey, sortDir, onSort }: {
  label: string; k: string; sortKey: string; sortDir: 'asc' | 'desc'; onSort: (k: string) => void;
}) {
  const active = sortKey === k;
  return (
    <th className="px-4 py-3 text-left">
      <button onClick={() => onSort(k)} className={`inline-flex items-center gap-1 uppercase hover:text-slate-700 ${active ? 'text-blue-600' : ''}`}>
        {label}<span className="text-[9px] leading-none">{active ? (sortDir === 'asc' ? '▲' : '▼') : '△'}</span>
      </button>
    </th>
  );
}
