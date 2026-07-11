import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../AuthContext';
import { Loader2, Search, ExternalLink, AlertTriangle } from 'lucide-react';
import { useSort, SortTh } from '../utils/useSort';
import { fmtDate } from '../utils/format';

const API_URL = import.meta.env.VITE_API_URL || '';

const STATUS_COLOR: Record<string, string> = {
  'Qualified': 'bg-emerald-100 text-emerald-700', 'In qualification': 'bg-blue-100 text-blue-700',
  'Obsolete': 'bg-slate-200 text-slate-600', 'Disqualified': 'bg-red-100 text-red-700',
};
const CLASS_COLOR: Record<string, string> = { 'Critical': 'bg-red-100 text-red-700', 'Major': 'bg-orange-100 text-orange-700', 'Minor': 'bg-slate-100 text-slate-600' };
const CAT_LABEL: Record<string, string> = { MP: 'Matière première', AC: 'Article conditionnement', AT: 'Article technique', '': 'Autre' };
const expirySoon = (iso: string | null) => { if (!iso) return false; const d = new Date(iso); if (isNaN(d.getTime())) return false; return d.getTime() < Date.now() + 90 * 864e5; };

export function QmsFournisseursView() {
  const { token, socket } = useAuth();
  const [tab, setTab] = useState<'sup' | 'spec'>('sup');
  const [sup, setSup] = useState<any[]>([]);
  const [specs, setSpecs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [cls, setCls] = useState('');
  const [q, setQ] = useState('');
  const [onlyExpiring, setOnlyExpiring] = useState(false);

  const authFetch = useCallback((url: string) => fetch(`${API_URL}${url}`, { headers: { Authorization: `Bearer ${token}` } }), [token]);
  const load = useCallback(async () => {
    try {
      const [s, sp] = await Promise.all([authFetch('/api/qms/suppliers'), authFetch('/api/qms/specs')]);
      if (s.ok) setSup(await s.json());
      if (sp.ok) setSpecs(await sp.json());
    } finally { setLoading(false); }
  }, [authFetch]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!socket) return; const h = () => load(); socket.on('qms:changed', h); return () => { socket.off('qms:changed', h); }; }, [socket, load]);

  const supFiltered = sup.filter((x) => (!status || x.status === status) && (!cls || x.classification === cls) && (!q || `${x.name} ${x.extId} ${x.product}`.toLowerCase().includes(q.toLowerCase())));
  const specFiltered = specs.filter((x) => !q || `${x.code} ${x.name}`.toLowerCase().includes(q.toLowerCase()));
  const cnt = (k: string, v: string) => sup.filter((x) => x[k] === v).length;
  const expiring = useMemo(() => sup.filter((x) => x.status === 'Qualified' && expirySoon(x.certExpiration)).length, [sup]);
  const supDisplayed = onlyExpiring ? supFiltered.filter((x) => x.status === 'Qualified' && expirySoon(x.certExpiration)) : supFiltered;
  const sortSup = useSort(supDisplayed, 'extId');
  const sortSpec = useSort(specFiltered, 'code');

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-center gap-2 mb-5">
        <button onClick={() => setTab('sup')} className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === 'sup' ? 'bg-blue-600 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>Fournisseurs <span className="opacity-70">({sup.length})</span></button>
        <button onClick={() => setTab('spec')} className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === 'spec' ? 'bg-blue-600 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>Spécifications <span className="opacity-70">({specs.length})</span></button>
      </div>

      {tab === 'sup' && (
        <div className="grid grid-cols-4 gap-4 mb-5">
          <button onClick={() => { setOnlyExpiring(false); setCls(''); setStatus(status === 'Qualified' ? '' : 'Qualified'); }} className={`text-left bg-white rounded-xl border p-4 transition ${status === 'Qualified' && !onlyExpiring ? 'border-emerald-500 ring-2 ring-emerald-200' : 'border-slate-200 hover:border-slate-300'}`}><div className="text-xs text-slate-400 uppercase tracking-wide">Qualifiés</div><div className="text-2xl font-bold text-emerald-600 mt-1">{cnt('status', 'Qualified')}</div></button>
          <button onClick={() => { setOnlyExpiring(false); setCls(''); setStatus(status === 'In qualification' ? '' : 'In qualification'); }} className={`text-left bg-white rounded-xl border p-4 transition ${status === 'In qualification' && !onlyExpiring ? 'border-blue-500 ring-2 ring-blue-200' : 'border-slate-200 hover:border-slate-300'}`}><div className="text-xs text-slate-400 uppercase tracking-wide">En qualification</div><div className="text-2xl font-bold text-blue-600 mt-1">{cnt('status', 'In qualification')}</div></button>
          <button onClick={() => { setOnlyExpiring(false); setStatus(''); setCls(cls === 'Critical' ? '' : 'Critical'); }} className={`text-left bg-white rounded-xl border p-4 transition ${cls === 'Critical' && !onlyExpiring ? 'border-red-500 ring-2 ring-red-200' : 'border-slate-200 hover:border-slate-300'}`}><div className="text-xs text-slate-400 uppercase tracking-wide">Critiques</div><div className="text-2xl font-bold text-red-600 mt-1">{cnt('classification', 'Critical')}</div></button>
          <button onClick={() => { setStatus(''); setCls(''); setOnlyExpiring((v) => !v); }} className={`text-left bg-white rounded-xl border p-4 transition ${onlyExpiring ? 'border-amber-500 ring-2 ring-amber-200' : 'border-slate-200 hover:border-slate-300'}`}><div className="text-xs text-slate-400 uppercase tracking-wide">Certif. à renouveler (≤90j)</div><div className={`text-2xl font-bold mt-1 ${expiring ? 'text-amber-600' : 'text-slate-800'}`}>{expiring}</div></button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tab === 'sup' ? 'Rechercher fournisseur / FNR / produit…' : 'Rechercher une spec (SPEC-MP…)…'} className="pl-9 pr-3 py-2 w-80 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        {tab === 'sup' && <>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="py-2 px-3 rounded-lg border border-slate-200 text-sm bg-white"><option value="">Tous statuts</option><option>Qualified</option><option>In qualification</option><option>Obsolete</option><option>Disqualified</option></select>
          <select value={cls} onChange={(e) => setCls(e.target.value)} className="py-2 px-3 rounded-lg border border-slate-200 text-sm bg-white"><option value="">Toutes criticités</option><option>Critical</option><option>Major</option><option>Minor</option></select>
        </>}
        <span className="ml-auto text-sm text-slate-400">{tab === 'sup' ? supDisplayed.length + ' fournisseur(s)' : specFiltered.length + ' spec(s)'}</span>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {loading ? <div className="px-4 py-12 text-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Chargement…</div> : tab === 'sup' ? (
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-50 text-slate-500 text-left">
              <SortTh k="extId" label="FNR" sort={sortSup} /><SortTh k="name" label="Fournisseur" sort={sortSup} /><SortTh k="classification" label="Criticité" sort={sortSup} />
              <SortTh k="type" label="Type / Produit" sort={sortSup} /><SortTh k="status" label="Statut" sort={sortSup} />
              <SortTh k="certRef" label="Certif." sort={sortSup} /><SortTh k="certExpiration" label="Expiration" sort={sortSup} />
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {sortSup.sorted.length === 0 && <tr><td colSpan={7} className="px-4 py-12 text-center text-slate-400">Aucun fournisseur.</td></tr>}
              {sortSup.sorted.map((s) => { const exp = s.status === 'Qualified' && expirySoon(s.certExpiration); return (
                <tr key={s.id} className={exp ? 'bg-amber-50/50' : 'hover:bg-slate-50'}>
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">{s.extId || '—'}</td>
                  <td className="px-4 py-3 font-medium">{s.webUrl ? <a href={s.webUrl} target="_blank" rel="noopener noreferrer" className="text-blue-700 hover:underline">{s.name}</a> : <span className="text-slate-800">{s.name}</span>}</td>
                  <td className="px-4 py-3">{s.classification && <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${CLASS_COLOR[s.classification] || ''}`}>{s.classification}</span>}</td>
                  <td className="px-4 py-3 text-slate-600">{s.type || '—'}{s.product && <div className="text-xs text-slate-400 max-w-xs truncate">{s.product}</div>}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOR[s.status] || 'bg-slate-100 text-slate-600'}`}>{s.status || '—'}</span></td>
                  <td className="px-4 py-3 text-xs text-slate-500">{s.certRef || '—'}</td>
                  <td className="px-4 py-3">{s.certExpiration ? <span className={exp ? 'text-amber-700 font-semibold inline-flex items-center gap-1' : 'text-slate-600'}>{exp && <AlertTriangle className="w-3.5 h-3.5" />}{fmtDate(s.certExpiration)}</span> : '—'}</td>
                </tr>
              ); })}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-50 text-slate-500 text-left">
              <SortTh k="code" label="Spécification" sort={sortSpec} /><SortTh k="category" label="Catégorie" sort={sortSpec} />
              <SortTh k="revision" label="Dernière révision" sort={sortSpec} /><SortTh k="createdDate" label="Créée le" sort={sortSpec} />
              <SortTh k="applicationDate" label="Date d'application" sort={sortSpec} /><th className="px-4 py-3 font-medium text-right">Action</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {sortSpec.sorted.length === 0 && <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-400">Aucune spécification (synchro OneDrive en cours ?).</td></tr>}
              {sortSpec.sorted.map((s) => (
                <tr key={s.code} className="hover:bg-slate-50">
                  <td className="px-4 py-3"><a href={s.webUrl} target="_blank" rel="noopener noreferrer" className="text-blue-700 hover:underline font-medium">{s.code}</a><div className="text-xs text-slate-400 max-w-xs truncate">{s.name}</div></td>
                  <td className="px-4 py-3 text-slate-600">{CAT_LABEL[s.category] || s.category}</td>
                  <td className="px-4 py-3"><span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">rév. {String(s.revision).padStart(2, '0')}</span></td>
                  <td className="px-4 py-3 text-slate-600">{fmtDate(s.createdDate)}</td>
                  <td className="px-4 py-3 text-slate-600">{fmtDate(s.applicationDate)}</td>
                  <td className="px-4 py-3 text-right">{s.webUrl && <a href={s.webUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 text-sm font-medium">Ouvrir <ExternalLink className="w-3.5 h-3.5" /></a>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
