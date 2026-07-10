import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../AuthContext';
import { Loader2, Search } from 'lucide-react';
import { useSort, SortTh } from '../utils/useSort';

const API_URL = import.meta.env.VITE_API_URL || '';

const STATUS_COLOR: Record<string, string> = {
  'En Service': 'bg-emerald-100 text-emerald-700',
  'Integration in progress': 'bg-blue-100 text-blue-700',
  'Obsolete': 'bg-slate-200 text-slate-600',
  'Hors Service': 'bg-red-100 text-red-700',
};
const fmtDate = (iso: string | null) => { if (!iso) return '—'; const d = new Date(iso); return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR'); };
const fmtMonth = (iso: string | null) => { if (!iso) return '—'; const d = new Date(iso); return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' }); };

const TYPE_SHORT: Record<string, string> = { Maintenance: 'Maint.', 'Étalonnage': 'Étal.', Calib: 'Calib.', Verif: 'Vérif.', QO: 'QO', QI: 'QI', QP: 'QP' };
const shortType = (t: string) => TYPE_SHORT[t] || t;

// Planning : regroupe les interventions [{type,date,status}] par type → dernière réalisée (vert) + prochaine planifiée (orange).
function intvInfo(items: any[] | undefined) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return { has: false, byType: [] as any[], status: 'NONE' as const };
  const map: Record<string, any> = {};
  for (const it of list) {
    const t = it.type || 'Intervention';
    map[t] = map[t] || { type: t, lastDone: null, nextPlanned: null };
    if (it.status === 'done' && (!map[t].lastDone || it.date > map[t].lastDone)) map[t].lastDone = it.date;
    if (it.status === 'planned' && (!map[t].nextPlanned || it.date < map[t].nextPlanned)) map[t].nextPlanned = it.date;
  }
  const byType = Object.values(map);
  const now = Date.now();
  let status: 'OK' | 'SOON' | 'OVERDUE' = 'OK';
  for (const b of byType as any[]) {
    if (!b.nextPlanned) continue;
    const dt = new Date(b.nextPlanned).getTime();
    if (dt < now) { status = 'OVERDUE'; break; }
    if (dt - now < 90 * 864e5) status = 'SOON';
  }
  return { has: true, byType, status };
}
const CAL_DUE = (s: string) => s === 'OVERDUE' || s === 'SOON';

export function QmsEquipementView() {
  const { token, socket } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const [onlyCalDue, setOnlyCalDue] = useState(false);

  const authFetch = useCallback((url: string) => fetch(`${API_URL}${url}`, { headers: { Authorization: `Bearer ${token}` } }), [token]);
  const load = useCallback(async () => {
    const p = new URLSearchParams();
    if (status) p.set('status', status);
    if (type) p.set('type', type);
    if (q) p.set('q', q);
    try { const r = await authFetch(`/api/qms/equipment?${p.toString()}`); if (r.ok) setRows(await r.json()); } finally { setLoading(false); }
  }, [authFetch, status, type, q]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  useEffect(() => { if (!socket) return; const h = () => load(); socket.on('qms:changed', h); return () => { socket.off('qms:changed', h); }; }, [socket, load]);

  // KPIs globaux (chargés sans filtre)
  const [all, setAll] = useState<any[]>([]);
  useEffect(() => { (async () => { try { const r = await authFetch('/api/qms/equipment'); if (r.ok) setAll(await r.json()); } catch { /* */ } })(); }, [authFetch, rows.length]);
  const kpi = (s: string) => all.filter((x) => x.status === s).length;
  const types = useMemo(() => Array.from(new Set(all.map((x) => x.type).filter(Boolean))).sort(), [all]);
  const calDueCount = all.filter((x) => CAL_DUE(intvInfo(x.interventions).status)).length;
  const displayed = onlyCalDue ? rows.filter((x) => CAL_DUE(intvInfo(x.interventions).status)) : rows;
  const sort = useSort(displayed, 'extId');
  const card = (s: string) => () => { setOnlyCalDue(false); setStatus((v) => (v === s ? '' : s)); };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="grid grid-cols-5 gap-4 mb-5">
        <button onClick={card('En Service')} className={`text-left bg-white rounded-xl border p-4 transition ${status === 'En Service' && !onlyCalDue ? 'border-emerald-500 ring-2 ring-emerald-200' : 'border-slate-200 hover:border-slate-300'}`}><div className="text-xs text-slate-400 uppercase tracking-wide">En service</div><div className="text-2xl font-bold text-emerald-600 mt-1">{kpi('En Service')}</div></button>
        <button onClick={card('Integration in progress')} className={`text-left bg-white rounded-xl border p-4 transition ${status === 'Integration in progress' && !onlyCalDue ? 'border-blue-500 ring-2 ring-blue-200' : 'border-slate-200 hover:border-slate-300'}`}><div className="text-xs text-slate-400 uppercase tracking-wide">Intégration en cours</div><div className="text-2xl font-bold text-blue-600 mt-1">{kpi('Integration in progress')}</div></button>
        <button onClick={card('Obsolete')} className={`text-left bg-white rounded-xl border p-4 transition ${status === 'Obsolete' && !onlyCalDue ? 'border-slate-500 ring-2 ring-slate-200' : 'border-slate-200 hover:border-slate-300'}`}><div className="text-xs text-slate-400 uppercase tracking-wide">Obsolètes</div><div className="text-2xl font-bold text-slate-600 mt-1">{kpi('Obsolete')}</div></button>
        <button onClick={() => { setStatus(''); setType(''); setOnlyCalDue((v) => !v); }} className={`text-left bg-white rounded-xl border p-4 transition ${onlyCalDue ? 'border-amber-500 ring-2 ring-amber-200' : 'border-slate-200 hover:border-slate-300'}`}><div className="text-xs text-slate-400 uppercase tracking-wide">À calibrer (≤90j / retard)</div><div className={`text-2xl font-bold mt-1 ${calDueCount ? 'text-amber-600' : 'text-slate-800'}`}>{calDueCount}</div></button>
        <button onClick={() => { setStatus(''); setType(''); setOnlyCalDue(false); }} className={`text-left bg-white rounded-xl border p-4 transition ${!status && !type && !onlyCalDue ? 'border-blue-500 ring-2 ring-blue-200' : 'border-slate-200 hover:border-slate-300'}`}><div className="text-xs text-slate-400 uppercase tracking-wide">Total équipements</div><div className="text-2xl font-bold text-slate-800 mt-1">{all.length}</div></button>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher (EQT-…, nom, localisation)…" className="pl-9 pr-3 py-2 w-80 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="py-2 px-3 rounded-lg border border-slate-200 text-sm bg-white">
          <option value="">Tous statuts</option><option value="En Service">En service</option><option value="Integration in progress">Intégration en cours</option><option value="Obsolete">Obsolète</option><option value="Hors Service">Hors service</option>
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} className="py-2 px-3 rounded-lg border border-slate-200 text-sm bg-white">
          <option value="">Tous types</option>{types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <span className="ml-auto text-sm text-slate-400">{displayed.length} équipement(s){onlyCalDue ? ' à calibrer' : ''}</span>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-50 text-slate-500 text-left">
            <SortTh k="extId" label="Réf." sort={sort} /><SortTh k="name" label="Équipement" sort={sort} />
            <SortTh k="type" label="Type" sort={sort} /><SortTh k="location" label="Localisation" sort={sort} />
            <SortTh k="manufacturer" label="Fabricant / Modèle" sort={sort} /><SortTh k="status" label="Statut" sort={sort} />
            <th className="px-4 py-3 font-medium">Dernière intervention</th><th className="px-4 py-3 font-medium">Prochaine planifiée (2026)</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {loading && <tr><td colSpan={7} className="px-4 py-12 text-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Chargement…</td></tr>}
            {!loading && sort.sorted.length === 0 && <tr><td colSpan={7} className="px-4 py-12 text-center text-slate-400">Aucun équipement.</td></tr>}
            {!loading && sort.sorted.map((e) => {
              const cal = intvInfo(e.interventions);
              return (
              <tr key={e.id} className={cal.status === 'OVERDUE' ? 'bg-red-50/40' : cal.status === 'SOON' ? 'bg-amber-50/40' : 'hover:bg-slate-50'}>
                <td className="px-4 py-3 font-mono text-xs align-top">{e.webUrl ? <a href={e.webUrl} target="_blank" rel="noopener noreferrer" className="text-blue-700 hover:underline">{e.extId}</a> : <span className="text-slate-700">{e.extId}</span>}</td>
                <td className="px-4 py-3 text-slate-800 align-top">{e.name || '—'}{e.serial && <div className="text-xs text-slate-400">SN {e.serial}</div>}</td>
                <td className="px-4 py-3 text-slate-600 align-top">{e.type || '—'}</td>
                <td className="px-4 py-3 text-slate-600 align-top"><div className="max-w-xs truncate">{e.location || '—'}</div></td>
                <td className="px-4 py-3 text-slate-600 align-top">{e.manufacturer || '—'}{e.model && <div className="text-xs text-slate-400">{e.model}</div>}</td>
                <td className="px-4 py-3 align-top"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOR[e.status] || 'bg-slate-100 text-slate-600'}`}>{e.status || '—'}</span></td>
                <td className="px-4 py-3 text-slate-600 align-top text-xs">{!cal.has ? <span className="text-slate-300">n/a</span> : cal.byType.filter((b: any) => b.lastDone).map((b: any) => <div key={b.type}><span className="text-slate-500">{shortType(b.type)}</span> {fmtMonth(b.lastDone)}</div>)}{cal.has && !cal.byType.some((b: any) => b.lastDone) && <span className="text-slate-300">—</span>}</td>
                <td className="px-4 py-3 align-top text-xs">{!cal.has ? <span className="text-slate-300">n/a</span> : (() => {
                  const planned = cal.byType.filter((b: any) => b.nextPlanned);
                  if (!planned.length) return <span className="text-emerald-700">à jour</span>;
                  const now = Date.now();
                  return planned.map((b: any) => { const over = new Date(b.nextPlanned).getTime() < now; const soon = !over && new Date(b.nextPlanned).getTime() - now < 90 * 864e5; return <div key={b.type} className={over ? 'text-red-700 font-semibold' : soon ? 'text-amber-700 font-medium' : 'text-slate-600'}>{over && '⚠ '}<span className="font-normal">{shortType(b.type)}</span> {fmtMonth(b.nextPlanned)}</div>; });
                })()}</td>
              </tr>
            ); })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
