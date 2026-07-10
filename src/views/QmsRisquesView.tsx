import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../AuthContext';
import { Loader2, ExternalLink, FileText, Search } from 'lucide-react';
import { useSort, SortTh } from '../utils/useSort';

const API_URL = import.meta.env.VITE_API_URL || '';

const CAT_COLOR: Record<string, string> = { GAP: 'bg-blue-100 text-blue-700', BIOSTERIL: 'bg-violet-100 text-violet-700', AUTRE: 'bg-slate-100 text-slate-600' };

const fmtDate = (iso: string | null) => { if (!iso) return '—'; const d = new Date(iso); return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR'); };
// Date d'approbation : extraite du nom de fichier (BioSteril → « 11.06.2024 » / « 13.03.2025 »), sinon n/a.
const approvalFromName = (name: string): string | null => {
  const m = (name || '').match(/(\d{2})[.\-_](\d{2})[.\-_](\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

export function QmsRisquesView() {
  const { token, socket } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [cat, setCat] = useState('');
  const [q, setQ] = useState('');
  const [mode, setMode] = useState<'docs' | 'register'>('docs');

  const authFetch = useCallback((url: string) => fetch(`${API_URL}${url}`, { headers: { Authorization: `Bearer ${token}` } }), [token]);
  const load = useCallback(async () => {
    try { const r = await authFetch('/api/qms/gap'); if (r.ok) setRows(await r.json()); } finally { setLoading(false); }
  }, [authFetch]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!socket) return; const h = () => load(); socket.on('qms:changed', h); return () => { socket.off('qms:changed', h); }; }, [socket, load]);

  const filtered = rows.filter((r) => (!cat || r.category === cat) && (!q || (r.name || '').toLowerCase().includes(q.toLowerCase())));
  const count = (c: string) => rows.filter((r) => r.category === c).length;
  const sort = useSort(filtered, 'lastModified', 'desc');
  const pick = (c: string) => () => setCat((v) => (v === c ? '' : c));

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-center gap-2 mb-5">
        <button onClick={() => setMode('docs')} className={`px-4 py-2 rounded-lg text-sm font-medium ${mode === 'docs' ? 'bg-blue-600 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>Documents (Gap & BioSteril)</button>
        <button onClick={() => setMode('register')} className={`px-4 py-2 rounded-lg text-sm font-medium ${mode === 'register' ? 'bg-blue-600 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>Registre des risques</button>
      </div>

      {mode === 'register' ? <RiskRegister authFetch={authFetch} /> : (<>
      <p className="text-sm text-slate-500 mb-4">Gap analysis (produits & réglementaire) et analyses de risque process (BioSteril), avec traçabilité des dates — source : documents contrôlés OneDrive.</p>

      <div className="grid grid-cols-3 gap-4 mb-5">
        <button onClick={pick('GAP')} className={`text-left bg-white rounded-xl border p-4 transition ${cat === 'GAP' ? 'border-blue-500 ring-2 ring-blue-200' : 'border-slate-200 hover:border-slate-300'}`}><div className="text-xs text-slate-400 uppercase tracking-wide">Gap analysis</div><div className="text-2xl font-bold text-slate-800 mt-1">{count('GAP')}</div></button>
        <button onClick={pick('BIOSTERIL')} className={`text-left bg-white rounded-xl border p-4 transition ${cat === 'BIOSTERIL' ? 'border-violet-500 ring-2 ring-violet-200' : 'border-slate-200 hover:border-slate-300'}`}><div className="text-xs text-slate-400 uppercase tracking-wide">Analyses risque BioSteril</div><div className="text-2xl font-bold text-slate-800 mt-1">{count('BIOSTERIL')}</div></button>
        <button onClick={() => setCat('')} className={`text-left bg-white rounded-xl border p-4 transition ${!cat ? 'border-blue-500 ring-2 ring-blue-200' : 'border-slate-200 hover:border-slate-300'}`}><div className="text-xs text-slate-400 uppercase tracking-wide">Total documents</div><div className="text-2xl font-bold text-slate-800 mt-1">{rows.length}</div></button>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un document…" className="pl-9 pr-3 py-2 w-72 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <select value={cat} onChange={(e) => setCat(e.target.value)} className="py-2 px-3 rounded-lg border border-slate-200 text-sm bg-white">
          <option value="">Toutes catégories</option><option value="GAP">Gap analysis</option><option value="BIOSTERIL">Analyse de risque BioSteril</option>
        </select>
        <span className="ml-auto text-sm text-slate-400">{filtered.length} document(s)</span>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-50 text-slate-500 text-left">
            <SortTh k="name" label="Document" sort={sort} /><SortTh k="category" label="Catégorie" sort={sort} />
            <SortTh k="createdDate" label="Créé le" sort={sort} /><th className="px-4 py-3 font-medium">Approbation</th>
            <SortTh k="lastModified" label="Modifié le" sort={sort} /><th className="px-4 py-3 font-medium text-right">Action</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {loading && <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Chargement…</td></tr>}
            {!loading && sort.sorted.length === 0 && <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-400">Aucun document (synchronisation OneDrive en cours ?).</td></tr>}
            {!loading && sort.sorted.map((r, idx) => {
              const appr = approvalFromName(r.name);
              return (
                <tr key={idx} className="hover:bg-slate-50">
                  <td className="px-4 py-3"><div className="flex items-center gap-2"><FileText className="w-4 h-4 text-slate-400 shrink-0" /><div className="min-w-0"><a href={r.webUrl} target="_blank" rel="noopener noreferrer" className="text-blue-700 hover:underline max-w-md truncate block font-medium">{r.name}</a><div className="text-xs text-slate-400 truncate">{r.path}</div></div></div></td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${CAT_COLOR[r.category] || ''}`}>{r.category === 'GAP' ? 'Gap analysis' : r.category === 'BIOSTERIL' ? 'Risque BioSteril' : r.category}</span></td>
                  <td className="px-4 py-3 text-slate-600">{fmtDate(r.createdDate)}</td>
                  <td className="px-4 py-3">{appr ? <span className="text-emerald-700 font-medium">{fmtDate(appr)}</span> : <span className="text-slate-300">—</span>}</td>
                  <td className="px-4 py-3 text-slate-600">{fmtDate(r.lastModified)}</td>
                  <td className="px-4 py-3 text-right">{r.webUrl && <a href={r.webUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 text-sm font-medium">Ouvrir <ExternalLink className="w-3.5 h-3.5" /></a>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </>)}
    </div>
  );
}

// Registre des risques ligne par ligne (ISO 14971) — produit & process, importé des matrices Excel.
const RISK_NIVEAU = (n: number) => n >= 15 ? { l: 'Critique', c: 'bg-red-100 text-red-700' } : n >= 9 ? { l: 'Élevé', c: 'bg-orange-100 text-orange-700' } : n >= 4 ? { l: 'Moyen', c: 'bg-amber-100 text-amber-700' } : { l: 'Faible', c: 'bg-emerald-100 text-emerald-700' };

function RiskRegister({ authFetch }: { authFetch: (url: string) => Promise<Response> }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [cat, setCat] = useState('');
  const [q, setQ] = useState('');
  const load = useCallback(async () => {
    try { const r = await authFetch('/api/qms/risk-register'); if (r.ok) setRows(await r.json()); } finally { setLoading(false); }
  }, [authFetch]);
  useEffect(() => { load(); }, [load]);

  const filtered = rows.filter((r) => (!cat || r.category === cat) && (!q || `${r.hazard} ${r.harm} ${r.step} ${r.extId}`.toLowerCase().includes(q.toLowerCase())));
  const sort = useSort(filtered.map((r) => ({ ...r, crit: (r.occurrence || 0) * (r.severity || 0), critRes: (r.occurrenceRes || 0) * (r.severityRes || 0) })), 'crit', 'desc');
  const countCat = (c: string) => rows.filter((r) => r.category === c).length;
  const critiques = rows.filter((r) => (r.occurrence || 0) * (r.severity || 0) >= 15).length;
  const pick = (c: string) => () => setCat((v) => (v === c ? '' : c));

  return (
    <div>
      <div className="grid grid-cols-4 gap-4 mb-5">
        <button onClick={pick('PRODUIT')} className={`text-left bg-white rounded-xl border p-4 transition ${cat === 'PRODUIT' ? 'border-blue-500 ring-2 ring-blue-200' : 'border-slate-200 hover:border-slate-300'}`}><div className="text-xs text-slate-400 uppercase tracking-wide">Risques produit</div><div className="text-2xl font-bold text-slate-800 mt-1">{countCat('PRODUIT')}</div></button>
        <button onClick={pick('PROCESS')} className={`text-left bg-white rounded-xl border p-4 transition ${cat === 'PROCESS' ? 'border-violet-500 ring-2 ring-violet-200' : 'border-slate-200 hover:border-slate-300'}`}><div className="text-xs text-slate-400 uppercase tracking-wide">Risques process</div><div className="text-2xl font-bold text-slate-800 mt-1">{countCat('PROCESS')}</div></button>
        <div className="bg-white rounded-xl border border-slate-200 p-4"><div className="text-xs text-slate-400 uppercase tracking-wide">Critiques (initial ≥15)</div><div className={`text-2xl font-bold mt-1 ${critiques ? 'text-red-600' : 'text-slate-800'}`}>{critiques}</div></div>
        <button onClick={() => setCat('')} className={`text-left bg-white rounded-xl border p-4 transition ${!cat ? 'border-blue-500 ring-2 ring-blue-200' : 'border-slate-200 hover:border-slate-300'}`}><div className="text-xs text-slate-400 uppercase tracking-wide">Total risques</div><div className="text-2xl font-bold text-slate-800 mt-1">{rows.length}</div></button>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher (danger, dommage, étape…)" className="pl-9 pr-3 py-2 w-80 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <select value={cat} onChange={(e) => setCat(e.target.value)} className="py-2 px-3 rounded-lg border border-slate-200 text-sm bg-white">
          <option value="">Toutes catégories</option><option value="PRODUIT">Produit</option><option value="PROCESS">Process</option>
        </select>
        <span className="ml-auto text-sm text-slate-400">{filtered.length} risque(s)</span>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-50 text-slate-500 text-left">
            <SortTh k="extId" label="ID" sort={sort} /><SortTh k="category" label="Cat." sort={sort} /><SortTh k="step" label="Étape" sort={sort} />
            <SortTh k="hazard" label="Danger → Dommage" sort={sort} /><SortTh k="crit" label="Criticité initiale" sort={sort} />
            <th className="px-4 py-3 font-medium">Maîtrise</th><SortTh k="critRes" label="Risque résiduel" sort={sort} />
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {loading && <tr><td colSpan={7} className="px-4 py-12 text-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Chargement…</td></tr>}
            {!loading && sort.sorted.length === 0 && <tr><td colSpan={7} className="px-4 py-12 text-center text-slate-400">Aucun risque importé (lancer l'import des matrices).</td></tr>}
            {!loading && sort.sorted.map((r) => {
              const ini = RISK_NIVEAU(r.crit); const res = RISK_NIVEAU(r.critRes);
              return (
                <tr key={r.id} className="hover:bg-slate-50 align-top">
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">{r.extId || '—'}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${r.category === 'PRODUIT' ? 'bg-blue-100 text-blue-700' : 'bg-violet-100 text-violet-700'}`}>{r.category === 'PRODUIT' ? 'Produit' : 'Process'}</span></td>
                  <td className="px-4 py-3 text-slate-600"><div className="max-w-[140px] truncate">{r.step || '—'}</div></td>
                  <td className="px-4 py-3"><div className="max-w-md text-slate-800">{r.hazard}</div>{r.harm && <div className="text-xs text-slate-400">→ {r.harm}</div>}</td>
                  <td className="px-4 py-3">{r.crit ? <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ini.c}`}>{r.occurrence}×{r.severity}={r.crit} · {ini.l}</span> : '—'}</td>
                  <td className="px-4 py-3 text-xs text-slate-500"><div className="max-w-xs truncate" title={r.control || ''}>{r.control || '—'}</div></td>
                  <td className="px-4 py-3">{r.critRes ? <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${res.c}`}>{r.occurrenceRes}×{r.severityRes}={r.critRes} · {res.l}</span> : (r.residualRisk ? <span className="text-xs text-slate-500">{r.residualRisk}</span> : '—')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
