import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../AuthContext';
import { RefreshCw, ExternalLink, Search, AlertTriangle, CheckCircle2, Loader2, FileText } from 'lucide-react';
import { useSort, SortTh } from '../utils/useSort';

const API_URL = import.meta.env.VITE_API_URL || '';

const TYPE_LABEL: Record<string, string> = {
  PROCEDURE: 'Procédure', INSTRUCTION: 'Instruction', FORM: 'Formulaire',
  LIST: 'Liste', RECORD: 'Enregistrement', MANUAL: 'Manuel', AUTRE: 'Autre',
};
const TYPE_COLOR: Record<string, string> = {
  PROCEDURE: 'bg-blue-100 text-blue-700', INSTRUCTION: 'bg-indigo-100 text-indigo-700',
  FORM: 'bg-violet-100 text-violet-700', LIST: 'bg-teal-100 text-teal-700',
  RECORD: 'bg-amber-100 text-amber-700', MANUAL: 'bg-emerald-100 text-emerald-700',
  AUTRE: 'bg-slate-100 text-slate-600',
};
const STATE_LABEL: Record<string, string> = { APPROVED: 'Approuvé', IN_MODIF: 'En modification', ARCHIVE: 'Archive', RECORD: 'Record', OTHER: 'Autre' };
const STATE_COLOR: Record<string, string> = { APPROVED: 'bg-emerald-100 text-emerald-700', IN_MODIF: 'bg-amber-100 text-amber-700', ARCHIVE: 'bg-slate-100 text-slate-500', RECORD: 'bg-sky-100 text-sky-700', OTHER: 'bg-slate-100 text-slate-500' };

const fmtDate = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
};
const fmtSize = (b: number | null) => {
  if (b == null) return '';
  if (b < 1024) return `${b} o`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} Ko`;
  return `${(b / 1024 / 1024).toFixed(1)} Mo`;
};

export function QmsView() {
  const { token, socket, canEdit } = useAuth();
  const [docs, setDocs] = useState<any[]>([]);
  const [processes, setProcesses] = useState<any[]>([]);
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [q, setQ] = useState('');
  const [proc, setProc] = useState('');
  const [type, setType] = useState('');
  const [showDeleted, setShowDeleted] = useState(false);
  const [state, setState] = useState('');

  const authFetch = useCallback(
    (url: string, opts: RequestInit = {}) =>
      fetch(`${API_URL}${url}`, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` } }),
    [token]
  );

  const loadStatus = useCallback(async () => {
    try { const r = await authFetch('/api/qms/sync/status'); if (r.ok) setStatus(await r.json()); } catch { /* silencieux */ }
  }, [authFetch]);
  const loadProcesses = useCallback(async () => {
    try { const r = await authFetch('/api/qms/processes'); if (r.ok) setProcesses(await r.json()); } catch { /* silencieux */ }
  }, [authFetch]);
  const loadDocs = useCallback(async () => {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (proc) p.set('process', proc);
    if (type) p.set('type', type);
    if (state) p.set('state', state);
    if (showDeleted) p.set('includeDeleted', 'true');
    try { const r = await authFetch(`/api/qms/documents?${p.toString()}`); if (r.ok) setDocs(await r.json()); }
    finally { setLoading(false); }
  }, [authFetch, q, proc, type, state, showDeleted]);

  useEffect(() => { loadStatus(); loadProcesses(); }, [loadStatus, loadProcesses]);
  useEffect(() => { const t = setTimeout(loadDocs, 250); return () => clearTimeout(t); }, [loadDocs]);
  useEffect(() => { const i = setInterval(loadStatus, 30000); return () => clearInterval(i); }, [loadStatus]);
  useEffect(() => {
    if (!socket) return;
    const h = () => { loadStatus(); loadDocs(); loadProcesses(); };
    socket.on('qms:changed', h);
    return () => { socket.off('qms:changed', h); };
  }, [socket, loadStatus, loadDocs, loadProcesses]);

  const runSync = async () => {
    setSyncing(true);
    try { await authFetch('/api/qms/sync/run', { method: 'POST' }); }
    finally { setTimeout(() => { setSyncing(false); loadStatus(); loadDocs(); }, 1800); }
  };

  const sort = useSort(docs, 'lastModified', 'desc');

  return (
    <div className="flex-1 overflow-y-auto p-6">
      {/* Bandeau d'état de synchronisation */}
      <SyncBanner status={status} syncing={syncing} canEdit={canEdit} onSync={runSync} />

      {/* Filtres */}
      <div className="flex flex-wrap items-center gap-3 mt-5 mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un document…"
            className="pl-9 pr-3 py-2 w-72 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <select value={proc} onChange={(e) => setProc(e.target.value)} className="py-2 px-3 rounded-lg border border-slate-200 text-sm bg-white">
          <option value="">Tous les processus</option>
          {processes.map((p) => (
            <option key={p.code} value={p.code}>{p.code} · {p.libelle} ({p.docCount})</option>
          ))}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} className="py-2 px-3 rounded-lg border border-slate-200 text-sm bg-white">
          <option value="">Tous les types</option>
          {Object.keys(TYPE_LABEL).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
        </select>
        <select value={state} onChange={(e) => setState(e.target.value)} className="py-2 px-3 rounded-lg border border-slate-200 text-sm bg-white">
          <option value="">Tous les états</option>
          {Object.keys(STATE_LABEL).map((s) => <option key={s} value={s}>{STATE_LABEL[s]}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
          <input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} className="rounded" />
          Afficher les supprimés
        </label>
        <span className="ml-auto text-sm text-slate-400">{docs.length} document(s)</span>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-slate-500 text-left">
              <SortTh k="name" label="Nom" sort={sort} />
              <SortTh k="processCode" label="Processus" sort={sort} />
              <SortTh k="docType" label="Type" sort={sort} />
              <SortTh k="lifecycleState" label="État / Taille" sort={sort} />
              <SortTh k="lastModified" label="Modifié le" sort={sort} />
              <SortTh k="modifiedBy" label="Modifié par" sort={sort} />
              <th className="px-4 py-3 font-medium text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Chargement…</td></tr>
            )}
            {!loading && sort.sorted.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-slate-400">
                {status && !status.configured
                  ? 'Microsoft Graph non configuré — renseignez les variables GRAPH_* puis lancez une synchronisation.'
                  : 'Aucun document indexé pour ces filtres.'}
              </td></tr>
            )}
            {!loading && sort.sorted.map((d) => (
              <tr key={d.id} className={d.softDeleted ? 'bg-red-50/40' : 'hover:bg-slate-50'}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                    <div className="min-w-0">
                      <a href={d.webUrl} target="_blank" rel="noopener noreferrer" className={`font-medium truncate hover:underline ${d.softDeleted ? 'text-red-700 line-through' : 'text-blue-700'}`}>{d.name}</a>
                      <div className="flex items-center gap-2">
                        {d.lifecycleState && <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${STATE_COLOR[d.lifecycleState] || ''}`}>{STATE_LABEL[d.lifecycleState] || d.lifecycleState}</span>}
                        {d.path && <span className="text-xs text-slate-400 truncate">{d.path}</span>}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {d.processCode ? <span title={d.isoClause ? `ISO ${d.isoClause}` : ''}>{d.processCode} · {d.processLibelle || ''}</span> : '—'}
                </td>
                <td className="px-4 py-3">
                  {d.docType && <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_COLOR[d.docType] || TYPE_COLOR.AUTRE}`}>{TYPE_LABEL[d.docType] || d.docType}</span>}
                </td>
                <td className="px-4 py-3 text-slate-500 text-xs">{d.softDeleted ? <span className="text-red-600 font-medium">Supprimé</span> : (d.sizeBytes != null ? fmtSize(d.sizeBytes) : '—')}</td>
                <td className="px-4 py-3 text-slate-600">{fmtDate(d.lastModified)}</td>
                <td className="px-4 py-3 text-slate-500">{d.modifiedBy || '—'}</td>
                <td className="px-4 py-3 text-right">
                  {d.webUrl && (
                    <a href={d.webUrl} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 text-sm font-medium">
                      Ouvrir <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SyncBanner({ status, syncing, canEdit, onSync }: { status: any; syncing: boolean; canEdit: boolean; onSync: () => void }) {
  if (!status) {
    return <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Chargement de l'état de synchronisation…</div>;
  }

  const running = status.running || syncing;
  let tone: string; let Icon: any; let message: React.ReactNode;

  if (!status.configured) {
    tone = 'border-slate-200 bg-slate-50 text-slate-600'; Icon = AlertTriangle;
    message = <>Microsoft Graph non configuré. La synchronisation est désactivée tant que les variables <code className="text-xs">GRAPH_*</code> ne sont pas renseignées.</>;
  } else if (status.lastError) {
    tone = 'border-red-200 bg-red-50 text-red-700'; Icon = AlertTriangle;
    message = <>Dernière synchronisation en échec : <span className="font-medium">{status.lastError}</span></>;
  } else if (status.stale) {
    tone = 'border-red-200 bg-red-50 text-red-700'; Icon = AlertTriangle;
    message = <><span className="font-semibold">⚠ Index potentiellement désynchronisé.</span>{' '}
      Dernière synchro réussie {status.ageMinutes == null ? 'jamais' : `il y a ${status.ageMinutes} min`} (seuil {status.staleThreshold} min). L'app peut ne pas refléter OneDrive.</>;
  } else {
    tone = 'border-emerald-200 bg-emerald-50 text-emerald-700'; Icon = CheckCircle2;
    message = <>Index à jour — dernière synchro il y a {status.ageMinutes ?? 0} min · {status.documentCount ?? 0} document(s) indexé(s){status.webhooks ? ' · webhooks actifs' : ''}.</>;
  }

  return (
    <div className={`rounded-xl border px-4 py-3 flex items-center gap-3 ${tone}`}>
      {running ? <Loader2 className="w-5 h-5 animate-spin shrink-0" /> : <Icon className="w-5 h-5 shrink-0" />}
      <div className="text-sm flex-1">{running ? 'Synchronisation en cours…' : message}</div>
      {canEdit && status.configured && (
        <button onClick={onSync} disabled={running}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 shrink-0">
          <RefreshCw className={`w-4 h-4 ${running ? 'animate-spin' : ''}`} /> Synchroniser
        </button>
      )}
    </div>
  );
}
