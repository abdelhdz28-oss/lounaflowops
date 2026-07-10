import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../AuthContext';
import { Search, Loader2, AlertTriangle } from 'lucide-react';
import { useSort, SortTh } from '../utils/useSort';

const API_URL = import.meta.env.VITE_API_URL || '';

const KIND_LABEL: Record<string, string> = { NC: 'Non-conformité', CAPA: 'CAPA', CC: 'Change Control' };
const KIND_COLOR: Record<string, string> = { NC: 'bg-orange-100 text-orange-700', CAPA: 'bg-violet-100 text-violet-700', CC: 'bg-sky-100 text-sky-700' };
const fmtDate = (iso: string | null) => { if (!iso) return '—'; const d = new Date(iso); return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR'); };
const isOverdue = (due: string | null, status: string) => { if (!due || status !== 'OPEN') return false; const d = new Date(due); return !isNaN(d.getTime()) && d.getTime() < Date.now(); };

export function QmsCapaView() {
  const { token, socket } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('OPEN');
  const [q, setQ] = useState('');
  const [overdue, setOverdue] = useState(false);

  const authFetch = useCallback((url: string) => fetch(`${API_URL}${url}`, { headers: { Authorization: `Bearer ${token}` } }), [token]);
  const load = useCallback(async () => {
    const p = new URLSearchParams();
    if (kind) p.set('kind', kind);
    if (status) p.set('status', status);
    if (q) p.set('q', q);
    try { const r = await authFetch(`/api/qms/tracking?${p.toString()}`); if (r.ok) setRows(await r.json()); }
    finally { setLoading(false); }
  }, [authFetch, kind, status, q]);

  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  useEffect(() => { if (!socket) return; const h = () => load(); socket.on('qms:changed', h); return () => { socket.off('qms:changed', h); }; }, [socket, load]);

  // KPIs (items ouverts, indépendants des filtres courants)
  const [openRows, setOpenRows] = useState<any[]>([]);
  useEffect(() => { (async () => { try { const r = await authFetch('/api/qms/tracking?status=OPEN'); if (r.ok) setOpenRows(await r.json()); } catch { /* */ } })(); }, [authFetch, rows.length]);
  const kpi = { NC: openRows.filter((x) => x.kind === 'NC').length, CAPA: openRows.filter((x) => x.kind === 'CAPA').length, CC: openRows.filter((x) => x.kind === 'CC').length };
  const overdueCount = openRows.filter((r) => isOverdue(r.dueDate, r.status)).length;

  const displayed = overdue ? rows.filter((r) => isOverdue(r.dueDate, r.status)) : rows;
  const sort = useSort(displayed, 'dueDate');

  return (
    <div className="flex-1 overflow-y-auto p-6">
      {/* KPIs items ouverts */}
      <div className="grid grid-cols-4 gap-4 mb-5">
        {(['NC', 'CAPA', 'CC'] as const).map((k) => {
          const active = kind === k && status === 'OPEN' && !overdue;
          return (
            <button key={k} onClick={() => { setOverdue(false); setKind(k); setStatus('OPEN'); }} className={`text-left bg-white rounded-xl border p-4 transition ${active ? 'border-blue-500 ring-2 ring-blue-200' : 'border-slate-200 hover:border-slate-300'}`}>
              <div className="text-xs text-slate-400 uppercase tracking-wide">{KIND_LABEL[k]} ouvertes</div>
              <div className="text-2xl font-bold text-slate-800 mt-1">{kpi[k]}</div>
            </button>
          );
        })}
        <button onClick={() => { setOverdue(true); setKind(''); setStatus('OPEN'); }} className={`text-left bg-white rounded-xl border p-4 transition ${overdue ? 'border-red-500 ring-2 ring-red-200' : 'border-slate-200 hover:border-slate-300'}`}>
          <div className="text-xs text-slate-400 uppercase tracking-wide">En retard</div>
          <div className={`text-2xl font-bold mt-1 ${overdueCount ? 'text-red-600' : 'text-slate-800'}`}>{overdueCount}</div>
        </button>
      </div>

      {/* Filtres */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher par n° (CAPA-24-…) ou sujet…" className="pl-9 pr-3 py-2 w-80 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <select value={kind} onChange={(e) => setKind(e.target.value)} className="py-2 px-3 rounded-lg border border-slate-200 text-sm bg-white">
          <option value="">Tous types</option><option value="NC">Non-conformités</option><option value="CAPA">CAPA</option><option value="CC">Change Control</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="py-2 px-3 rounded-lg border border-slate-200 text-sm bg-white">
          <option value="OPEN">Ouverts</option><option value="CLOSED">Clôturés</option><option value="">Tous</option>
        </select>
        <span className="ml-auto text-sm text-slate-400">{displayed.length} enregistrement(s){overdue ? ' en retard' : ''}</span>
      </div>

      {/* Table registre */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-50 text-slate-500 text-left">
            <SortTh k="extId" label="N°" sort={sort} /><SortTh k="kind" label="Type" sort={sort} />
            <SortTh k="description" label="Sujet" sort={sort} /><SortTh k="status" label="Statut" sort={sort} />
            <SortTh k="openingDate" label="Ouverture" sort={sort} /><SortTh k="dueDate" label="Échéance" sort={sort} />
            <SortTh k="closureDate" label="Clôture" sort={sort} />
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {loading && <tr><td colSpan={7} className="px-4 py-12 text-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Chargement…</td></tr>}
            {!loading && sort.sorted.length === 0 && <tr><td colSpan={7} className="px-4 py-12 text-center text-slate-400">Aucun enregistrement (registre importé des fichiers de suivi de l'AQ).</td></tr>}
            {!loading && sort.sorted.map((r) => {
              const over = isOverdue(r.dueDate, r.status);
              return (
                <tr key={r.kind + r.id} className={over ? 'bg-red-50/50' : 'hover:bg-slate-50'}>
                  <td className="px-4 py-3 font-mono text-xs">{r.webUrl ? <a href={r.webUrl} target="_blank" rel="noopener noreferrer" className="text-blue-700 hover:underline">{r.extId}</a> : <span className="text-slate-700">{r.extId}</span>}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${KIND_COLOR[r.kind] || ''}`}>{r.kind}</span></td>
                  <td className="px-4 py-3"><div className="max-w-lg text-slate-800">{r.description || '—'}</div>{r.ref && <div className="text-xs text-slate-400">réf. {r.ref}</div>}</td>
                  <td className="px-4 py-3">{r.status === 'OPEN' ? <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">{r.rawStatus || 'Ouvert'}</span> : <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">Clôturé</span>}</td>
                  <td className="px-4 py-3 text-slate-600">{fmtDate(r.openingDate)}</td>
                  <td className="px-4 py-3">{r.dueDate ? <span className={over ? 'text-red-700 font-semibold inline-flex items-center gap-1' : 'text-slate-600'}>{over && <AlertTriangle className="w-3.5 h-3.5" />}{fmtDate(r.dueDate)}</span> : '—'}</td>
                  <td className="px-4 py-3 text-slate-500">{fmtDate(r.closureDate)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
