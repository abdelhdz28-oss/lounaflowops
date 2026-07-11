import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../AuthContext';
import { cn } from '../utils/cn';
import { Plus, Trash2, Loader2, ChevronUp, ChevronDown, ChevronsUpDown, RefreshCw, FileDown, Archive } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { MultiSelect } from '../components/MultiSelect';

const API_URL = import.meta.env.VITE_API_URL || '';
const MOIS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
const eur = (n: number) => (Math.round(n) || 0).toLocaleString('fr-FR') + ' €';
const CHART = { primary: '#2563eb', realise: '#16a34a', odoo: '#f59e0b', grid: '#e2e8f0', tick: '#64748b' };

interface Vente { id: string; year: number; pays: string; ligneProduit: string; produit: string; codeOdoo: string; prixUnitaire: number; qty: number[]; retire: boolean; archived: boolean; dateAttendue?: string | null; }
interface Data { year: number; forecast: Vente[]; realise: Vente[]; years: number[]; archived?: boolean; realizedMonths?: boolean[]; forecastUpdatedAt?: string | null; }
interface OdooRow { code: string; produit: string; months: number[]; total: number; }

const sumQty = (v: Vente) => v.qty.reduce((a, b) => a + (b || 0), 0);
const caRow = (v: Vente) => sumQty(v) * (v.prixUnitaire || 0);
const monthlyCA = (rows: Vente[]) => { const m = Array(12).fill(0); for (const v of rows) for (let i = 0; i < 12; i++) m[i] += (v.qty[i] || 0) * (v.prixUnitaire || 0); return m; };
// Réalisé manuel : qty = montant € directement (pas × prix).
const monthlyEur = (rows: Vente[]) => { const m = Array(12).fill(0); for (const v of rows) for (let i = 0; i < 12; i++) m[i] += v.qty[i] || 0; return m; };
const sumEur = (v: Vente) => v.qty.reduce((a, b) => a + (b || 0), 0);

export function VentesView() {
  const { token, socket, canEdit } = useAuth();
  const [data, setData] = useState<Data>({ year: new Date().getFullYear(), forecast: [], realise: [], years: [] });
  const [odooRows, setOdooRows] = useState<OdooRow[]>([]);
  const [catalog, setCatalog] = useState<Record<string, string>>({});
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [tab, setTab] = useState<'pilotage' | 'forecast' | 'realise' | 'registre'>('pilotage');
  const [loading, setLoading] = useState(true);
  const [odooLoading, setOdooLoading] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    const r = await fetch(`${API_URL}/api/ventes/data?year=${year}`, { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) setData(await r.json());
    const o = await fetch(`${API_URL}/api/ventes/odoo-realise?year=${year}`, { headers: { Authorization: `Bearer ${token}` } });
    if (o.ok) { const d = await o.json(); setOdooRows(Array.isArray(d.rows) ? d.rows : []); }
    setLoading(false);
  }, [token, year]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!socket) return; const h = () => load(); socket.on('ventes:changed', h); return () => { socket.off('ventes:changed', h); }; }, [socket, load]);
  useEffect(() => { if (!token) return; fetch(`${API_URL}/api/ventes/odoo-products`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.ok ? r.json() : null).then(d => { if (d?.products) setCatalog(Object.fromEntries(d.products.map((x: any) => [x.code, x.name]))); }).catch(() => {}); }, [token]);

  const api = async (method: string, path: string, body?: any) => {
    const r = await fetch(`${API_URL}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) { const e = await r.json().catch(() => ({})); alert(e.error || 'Erreur'); }
    await load(); return r.ok;
  };

  const refreshOdoo = async () => {
    if (!token) return;
    setOdooLoading(true);
    try {
      const o = await fetch(`${API_URL}/api/ventes/odoo-realise?year=${year}`, { headers: { Authorization: `Bearer ${token}` } });
      if (o.ok) { const d = await o.json(); setOdooRows(Array.isArray(d.rows) ? d.rows : []); }
    } finally { setOdooLoading(false); }
  };

  const years = useMemo(() => { const s = new Set<number>(data.years); s.add(year); s.add(new Date().getFullYear()); return [...s].sort((a, b) => b - a); }, [data.years, year]);
  // Totaux mensuels Odoo (réalisé HT) dérivés du détail par produit.
  const odoo = useMemo(() => { const m = Array(12).fill(0); for (const r of odooRows) for (let i = 0; i < 12; i++) m[i] += r.months[i] || 0; return m; }, [odooRows]);

  if (loading) return <div className="p-8 flex-1 flex items-center justify-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Chargement…</div>;

  const fMonthly = monthlyCA(data.forecast);
  const fTotal = fMonthly.reduce((a, b) => a + b, 0);
  const oTotal = odoo.reduce((a, b) => a + b, 0);           // réalisé Odoo HT (factures externes)
  const manualMonthly = monthlyEur(data.realise);          // ajustements manuels (qty = € par mois)
  const rMonthly = odoo.map((v, i) => v + (manualMonthly[i] || 0)); // réalisé = Odoo + ajustements
  const rTotal = rMonthly.reduce((a, b) => a + b, 0);
  const ro = !!data.archived; // année archivée → lecture seule

  const archiveYear = async (val: boolean) => {
    if (!confirm(val ? `Archiver ${year} ? L'année passera en lecture seule.` : `Désarchiver ${year} ?`)) return;
    await fetch(`${API_URL}/api/ventes/archive?year=${year}&archived=${val}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    await load();
  };

  const exportPDF = () => {
    const grp = new Map<string, { ca: number; qty: number }>();
    for (const v of data.forecast) { const k = v.pays || '(sans pays)'; if (!grp.has(k)) grp.set(k, { ca: 0, qty: 0 }); const g = grp.get(k)!; const q = v.qty.reduce((a, b) => a + (b || 0), 0); g.qty += q; g.ca += q * (v.prixUnitaire || 0); }
    const max = Math.max(1, ...fMonthly, ...rMonthly), h = 150, bw = 46;
    const bars = MOIS.map((m, i) => { const x = i * bw + 34; const fh = fMonthly[i] / max * h, rh = rMonthly[i] / max * h; return `<rect x="${x}" y="${20 + h - fh}" width="17" height="${fh}" fill="#2563eb"/><rect x="${x + 19}" y="${20 + h - rh}" width="17" height="${rh}" fill="#16a34a"/><text x="${x + 18}" y="${20 + h + 12}" font-size="9" text-anchor="middle" fill="#64748b">${m}</text>`; }).join('');
    const svg = `<svg width="${MOIS.length * bw + 50}" height="${h + 40}"><text x="34" y="12" font-size="10" fill="#2563eb">■ Prévu</text><text x="90" y="12" font-size="10" fill="#16a34a">■ Réalisé</text>${bars}</svg>`;
    const mRows = MOIS.map((m, i) => `<tr><td>${m}</td><td class=r>${eur(fMonthly[i])}</td><td class=r>${eur(rMonthly[i])}</td><td class=r>${eur(rMonthly[i] - fMonthly[i])}</td></tr>`).join('');
    const pRows = [...grp.entries()].sort((a, b) => a[0].localeCompare(b[0], 'fr')).map(([p, g]) => `<tr><td>${p}</td><td class=r>${g.qty.toLocaleString('fr-FR')}</td><td class=r>${eur(g.ca)}</td></tr>`).join('');
    const html = `<!doctype html><html lang=fr><head><meta charset=utf-8><title>Forecast Ventes ${year}</title><style>body{font-family:system-ui,Arial;max-width:900px;margin:24px auto;color:#1e293b}h1{font-size:20px}h2{font-size:14px;border-bottom:2px solid #e2e8f0;padding-bottom:4px;margin-top:22px}table{width:100%;border-collapse:collapse;font-size:12px;margin-top:6px}th,td{border:1px solid #e2e8f0;padding:5px 8px}.r{text-align:right}.kpi{display:flex;gap:12px;flex-wrap:wrap;margin:10px 0}.kpi div{background:#f1f5f9;border-radius:8px;padding:8px 12px;font-size:12px}@media print{.np{display:none}}</style></head><body>
<button class=np onclick="print()" style="float:right;padding:6px 12px;cursor:pointer">Imprimer / PDF</button>
<h1>Forecast Ventes ${year} — situation CA</h1>
<div class="kpi"><div>Forecast : <b>${eur(fTotal)}</b></div><div>Réalisé : <b>${eur(rTotal)}</b></div><div>% réalisé : <b>${fTotal ? Math.round(rTotal / fTotal * 100) : 0}%</b></div><div>Reste à faire : <b>${eur(fTotal - rTotal)}</b></div></div>
<h2>Prévu vs Réalisé par mois</h2>${svg}
<table><thead><tr><th>Mois</th><th class=r>Prévu</th><th class=r>Réalisé</th><th class=r>Écart</th></tr></thead><tbody>${mRows}<tr style="font-weight:bold;background:#f8fafc"><td>Total</td><td class=r>${eur(fTotal)}</td><td class=r>${eur(rTotal)}</td><td class=r>${eur(rTotal - fTotal)}</td></tr></tbody></table>
<h2>Forecast par pays</h2><table><thead><tr><th>Pays</th><th class=r>Boîtes</th><th class=r>CA forecast</th></tr></thead><tbody>${pRows}</tbody></table>
</body></html>`;
    const w = window.open('', '_blank'); if (w) { w.document.write(html); w.document.close(); }
  };

  return (
    <div className="p-6 flex-1 overflow-auto bg-slate-50">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2">Forecast Ventes · pilotage CA {ro && <span className="text-[11px] font-medium text-amber-700 bg-amber-100 border border-amber-200 rounded-full px-2 py-0.5">Archivé · lecture seule</span>}</h3>
        <div className="flex items-center gap-2">
          <select value={year} onChange={e => setYear(Number(e.target.value))} className="text-sm border border-slate-300 rounded-md px-2 py-1.5 outline-none focus:border-blue-500">
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <button onClick={exportPDF} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"><FileDown className="w-4 h-4" /> Export PDF</button>
          {canEdit && <button onClick={() => archiveYear(!ro)} className={cn('flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border', ro ? 'text-blue-700 bg-blue-50 border-blue-200 hover:bg-blue-100' : 'text-slate-700 bg-white border-slate-300 hover:bg-slate-50')}><Archive className="w-4 h-4" /> {ro ? 'Désarchiver' : 'Archiver'}</button>}
          <button onClick={load} className="text-slate-400 hover:text-blue-600" title="Rafraîchir"><RefreshCw className="w-4 h-4" /></button>
        </div>
      </div>
      <div className="flex gap-1 mb-4 border-b border-slate-200">
        {([['pilotage', 'Pilotage'], ['forecast', 'Forecast'], ['realise', 'Réalisé'], ['registre', 'Registre commandes']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={cn('px-4 py-2 text-sm font-medium border-b-2 -mb-px', tab === k ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700')}>{l}</button>
        ))}
      </div>

      {tab === 'pilotage' && <Pilotage fMonthly={fMonthly} rMonthly={rMonthly} odoo={odoo} fTotal={fTotal} rTotal={rTotal} oTotal={oTotal} />}
      {tab === 'forecast' && <ForecastGrouped rows={data.forecast} year={year} canEdit={canEdit && !ro} api={api} catalog={catalog} realizedMonths={data.realizedMonths} updatedAt={data.forecastUpdatedAt} />}
      {tab === 'realise' && (
        <div className="space-y-5">
          <OdooRealiseDetail rows={odooRows} onRefresh={refreshOdoo} loading={odooLoading} />
          <div>
            <div className="text-sm font-medium text-slate-600 mb-2">Ajustements manuels <span className="text-xs font-normal text-slate-400">(montants € par mois, ajoutés au réalisé Odoo — peut être négatif pour corriger)</span></div>
            <Grid rows={data.realise} base="realise" year={year} canEdit={canEdit && !ro} api={api} catalog={catalog} />
          </div>
        </div>
      )}
      {tab === 'registre' && <RegistreCommandes />}
    </div>
  );
}

// Registre des commandes : miroir auto-synchronisé du fichier Excel + tri par colonne + date de facture (saisie app).
function RegistreCommandes() {
  const { token, socket } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [yearF, setYearF] = useState<string>('');
  const [sort, setSort] = useState<{ k: string; dir: 'asc' | 'desc' } | null>({ k: 'year', dir: 'desc' });
  const [countrySel, setCountrySel] = useState<Set<string>>(new Set());
  const [nameSel, setNameSel] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!token) return;
    const r = await fetch(`${API_URL}/api/ventes/registre`, { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) { const d = await r.json(); setRows(Array.isArray(d.rows) ? d.rows : []); }
    setLoading(false);
  }, [token]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!socket) return; const h = () => load(); socket.on('ventes:changed', h); return () => { socket.off('ventes:changed', h); }; }, [socket, load]);

  const COLS: { k: string; label: string; align?: string; num?: boolean }[] = [
    { k: 'year', label: 'Année', num: true },
    { k: 'country', label: 'Pays' },
    { k: 'productClass', label: 'Classe' },
    { k: 'commercialName', label: 'Nom commercial' },
    { k: 'ref', label: 'Réf' },
    { k: 'units', label: 'Boîtes', align: 'text-right', num: true },
    { k: 'batchNo', label: 'N° lot' },
    { k: 'expDate', label: 'Expiration' },
    { k: 'status', label: 'Statut' },
  ];
  const toggleSort = (k: string) => setSort(s => (s && s.k === k ? { k, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { k, dir: 'asc' }));

  const years = useMemo(() => [...new Set(rows.map(r => r.year).filter(Boolean))].sort((a: any, b: any) => b - a), [rows]);
  const countryOpts = useMemo(() => [...new Set(rows.map(r => r.country).filter(Boolean))].sort((a: any, b: any) => String(a).localeCompare(String(b), 'fr')), [rows]);
  const nameOpts = useMemo(() => [...new Set(rows.map(r => r.commercialName).filter(Boolean))].sort((a: any, b: any) => String(a).localeCompare(String(b), 'fr')), [rows]);
  const filtered = useMemo(() => rows.filter(r => {
    if (yearF && String(r.year) !== yearF) return false;
    if (countrySel.size && !countrySel.has(r.country)) return false;
    if (nameSel.size && !nameSel.has(r.commercialName)) return false;
    if (!q) return true;
    const s = q.toLowerCase();
    return [r.country, r.commercialName, r.ref, r.batchNo, r.status].some(v => String(v || '').toLowerCase().includes(s));
  }), [rows, q, yearF, countrySel, nameSel]);
  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const col = COLS.find(c => c.k === sort.k);
    const s = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const va = a[sort.k], vb = b[sort.k];
      if ((va == null || va === '') && (vb == null || vb === '')) return 0;
      if (va == null || va === '') return 1;
      if (vb == null || vb === '') return -1;
      if (col?.num) return (Number(va) - Number(vb)) * s;
      return String(va).localeCompare(String(vb), 'fr', { numeric: true }) * s;
    });
  }, [filtered, sort]);
  const totalUnits = filtered.reduce((a, r) => a + (r.units || 0), 0);

  const statusBadge = (st: string) => {
    const l = (st || '').toLowerCase();
    if (l.includes('deliver') || l.includes('livr')) return 'bg-green-100 text-green-700';
    if (l.includes('progress') || l.includes('cours') || l.includes('transit')) return 'bg-amber-100 text-amber-700';
    if (l.includes('cancel') || l.includes('annul')) return 'bg-red-100 text-red-700';
    return 'bg-slate-100 text-slate-600';
  };

  if (loading) return <div className="p-8 flex items-center justify-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Chargement…</div>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Rechercher (pays, produit, réf, lot…)" className="text-sm border border-slate-300 rounded-md px-3 py-1.5 outline-none focus:border-blue-500 w-72" />
        <select value={yearF} onChange={e => setYearF(e.target.value)} className="text-sm border border-slate-300 rounded-md px-2 py-1.5 outline-none focus:border-blue-500">
          <option value="">Toutes années</option>
          {years.map((y: any) => <option key={y} value={String(y)}>{y}</option>)}
        </select>
        <MultiSelect label="Pays" options={countryOpts as string[]} selected={countrySel} onChange={setCountrySel} width="w-72" />
        <MultiSelect label="Nom commercial" options={nameOpts as string[]} selected={nameSel} onChange={setNameSel} width="w-72" />
        {(countrySel.size > 0 || nameSel.size > 0 || yearF || q) && <button onClick={() => { setCountrySel(new Set()); setNameSel(new Set()); setYearF(''); setQ(''); }} className="text-xs text-slate-500 hover:text-blue-600 underline">Réinitialiser</button>}
        <div className="text-sm text-slate-500 ml-auto">{filtered.length} commande(s) · <b className="text-slate-800">{totalUnits.toLocaleString('fr-FR')}</b> boîtes · <span className="text-xs text-slate-400">🔄 synchronisé depuis Excel</span></div>
      </div>
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="bg-slate-100 text-left text-[10px] uppercase text-slate-500">
            {COLS.map(c => (
              <th key={c.k} className={cn('px-3 py-2 select-none', c.align)}>
                <button onClick={() => toggleSort(c.k)} className={cn('inline-flex items-center gap-1 uppercase hover:text-slate-700', c.align === 'text-right' && 'flex-row-reverse')}>
                  {c.label}
                  {sort?.k === c.k ? (sort.dir === 'asc' ? <ChevronUp className="w-3 h-3 text-blue-600" /> : <ChevronDown className="w-3 h-3 text-blue-600" />) : <ChevronsUpDown className="w-3 h-3 text-slate-300" />}
                </button>
              </th>
            ))}
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {sorted.map(r => (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="px-3 py-1.5 text-slate-600">{r.year || '—'}</td>
                <td className="px-3 py-1.5 text-slate-700">{r.country || '—'}</td>
                <td className="px-3 py-1.5 text-slate-500">{r.productClass || '—'}</td>
                <td className="px-3 py-1.5 text-slate-700">{r.commercialName || '—'}</td>
                <td className="px-3 py-1.5 font-mono text-[11px] text-slate-600">{r.ref || '—'}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">{r.units != null ? r.units.toLocaleString('fr-FR') : '—'}</td>
                <td className="px-3 py-1.5 font-mono text-[11px] text-slate-600">{r.batchNo || '—'}</td>
                <td className="px-3 py-1.5 text-slate-600">{r.expDate || '—'}</td>
                <td className="px-3 py-1.5"><span className={cn('inline-block px-2 py-0.5 rounded-full text-[10px] font-medium', statusBadge(r.status))}>{r.status || '—'}</span></td>
              </tr>
            ))}
            {sorted.length === 0 && <tr><td colSpan={COLS.length} className="px-4 py-10 text-center text-slate-400">Aucune commande.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OdooRealiseDetail({ rows, onRefresh, loading }: { rows: OdooRow[]; onRefresh: () => void; loading: boolean }) {
  const monthsTot = Array(12).fill(0);
  for (const r of rows) for (let i = 0; i < 12; i++) monthsTot[i] += r.months[i] || 0;
  const grand = monthsTot.reduce((a, b) => a + b, 0);
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-slate-100">
        <div className="font-semibold text-slate-800 text-sm">Réalisé Odoo · détail par produit <span className="text-xs font-normal text-slate-400">(factures externes HT, hors intercompagnie) · {rows.length} produits · total {eur(grand)}</span></div>
        <button onClick={onRefresh} disabled={loading} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-amber-500 rounded-lg hover:bg-amber-600 disabled:opacity-50 shrink-0">
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} /> Mise à jour Odoo
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="text-xs" style={{ tableLayout: 'fixed', width: 96 + 170 + 12 * 60 + 90 }}>
          <colgroup>
            <col style={{ width: 96 }} /><col style={{ width: 170 }} />
            {MOIS.map(m => <col key={m} style={{ width: 60 }} />)}<col style={{ width: 90 }} />
          </colgroup>
          <thead><tr className="bg-slate-50 text-left text-[10px] uppercase text-slate-500">
            <th className="px-2 py-2">Code</th><th className="px-2 py-2">Produit (Odoo)</th>
            {MOIS.map(m => <th key={m} className="px-1 py-2 text-right"><span className="inline-block [writing-mode:vertical-rl] rotate-180 leading-none">{m}</span></th>)}
            <th className="px-2 py-2 text-right">Total</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r, ri) => (
              <tr key={ri} className="hover:bg-slate-50">
                <td className="px-2 py-1.5 font-mono text-[11px] text-slate-600 truncate">{r.code || '—'}</td>
                <td className="px-2 py-1.5 text-slate-700 truncate" title={r.produit}>{r.produit}</td>
                {r.months.map((v, i) => <td key={i} className="px-1 py-1.5 text-right tabular-nums text-slate-600">{v ? Math.round(v).toLocaleString('fr-FR') : '·'}</td>)}
                <td className="px-2 py-1.5 text-right font-semibold text-slate-800 tabular-nums">{eur(r.total)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={15} className="px-4 py-8 text-center text-slate-400">{loading ? 'Chargement Odoo…' : 'Aucune facture externe sur l’année.'}</td></tr>}
          </tbody>
          {rows.length > 0 && (
            <tfoot><tr className="bg-slate-50 font-semibold text-slate-800 border-t-2 border-slate-200">
              <td className="px-2 py-2" colSpan={2}>TOTAL</td>
              {monthsTot.map((v, i) => <td key={i} className="px-1 py-2 text-right tabular-nums">{v ? Math.round(v).toLocaleString('fr-FR') : '·'}</td>)}
              <td className="px-2 py-2 text-right text-amber-600 tabular-nums">{eur(grand)}</td>
            </tr></tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

function Kpi({ title, value, sub, color }: { title: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
      <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">{title}</div>
      <div className={cn('text-2xl font-bold', color || 'text-slate-900')}>{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function Pilotage({ fMonthly, rMonthly, fTotal, rTotal }: { fMonthly: number[]; rMonthly: number[]; odoo: number[]; fTotal: number; rTotal: number; oTotal: number }) {
  const pct = fTotal ? Math.round((rTotal / fTotal) * 100) : 0;
  const reste = fTotal - rTotal;
  const barData = MOIS.map((m, i) => ({ mois: m, Prévu: Math.round(fMonthly[i]), Réalisé: Math.round(rMonthly[i]) }));
  let cf = 0, cr = 0;
  const cumData = MOIS.map((m, i) => { cf += fMonthly[i]; cr += rMonthly[i]; return { mois: m, 'Prévu cumulé': Math.round(cf), 'Réalisé cumulé': Math.round(cr) }; });
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Kpi title="FORECAST CA" value={eur(fTotal)} sub="prévisionnel année" />
        <Kpi title="RÉALISÉ CA" value={eur(rTotal)} sub="Odoo HT (externe)" color={rTotal ? 'text-green-600' : undefined} />
        <Kpi title="% RÉALISÉ" value={`${pct} %`} sub="réalisé / forecast" color={pct >= 100 ? 'text-green-600' : pct >= 50 ? 'text-amber-600' : undefined} />
        <Kpi title="RESTE À FAIRE" value={eur(reste)} sub="forecast − réalisé" color={reste > 0 ? 'text-blue-700' : 'text-green-600'} />
      </div>
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
        <div className="font-semibold text-slate-800 text-sm mb-3">Prévu vs Réalisé par mois (CA € HT) <span className="text-xs font-normal text-slate-400">· réalisé = factures Odoo externes (hors intercompagnie)</span></div>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={barData} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
            <XAxis dataKey="mois" tick={{ fontSize: 11, fill: CHART.tick }} />
            <YAxis tick={{ fontSize: 11, fill: CHART.tick }} width={64} tickFormatter={(v: any) => `${Math.round(v / 1000)}k`} />
            <Tooltip formatter={(v: any) => eur(v)} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="Prévu" fill={CHART.primary} radius={[3, 3, 0, 0]} />
            <Bar dataKey="Réalisé" fill={CHART.realise} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
        <div className="font-semibold text-slate-800 text-sm mb-3">Cumul prévu vs réalisé (CA €)</div>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={cumData} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
            <XAxis dataKey="mois" tick={{ fontSize: 11, fill: CHART.tick }} />
            <YAxis tick={{ fontSize: 11, fill: CHART.tick }} width={64} tickFormatter={(v: any) => `${Math.round(v / 1000)}k`} />
            <Tooltip formatter={(v: any) => eur(v)} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line dataKey="Prévu cumulé" stroke={CHART.primary} strokeWidth={2} dot={false} />
            <Line dataKey="Réalisé cumulé" stroke={CHART.realise} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// Forecast groupé par pays : sous-total par pays + total général. Colonnes Code Odoo → Produit → Prix → mois.
function ForecastGrouped({ rows, year, canEdit, api, catalog, realizedMonths, updatedAt }: { rows: Vente[]; year: number; canEdit: boolean; api: any; catalog: Record<string, string>; realizedMonths?: boolean[]; updatedAt?: string | null }) {
  const COLS: { id: string; label: string; month?: number; align?: string; w: number }[] = [
    { id: 'codeOdoo', label: 'Code Odoo', w: 104 },
    { id: 'produit', label: 'Produit (Odoo)', w: 188 },
    { id: 'prixUnitaire', label: 'Prix', align: 'text-right', w: 54 },
    ...MOIS.map((m, i) => ({ id: 'm' + i, label: m, month: i, align: 'text-right', w: 56 })),
    { id: 'total', label: 'Tot. qté', align: 'text-right', w: 66 },
    { id: 'ca', label: 'CA', align: 'text-right', w: 92 },
    { id: 'actions', label: '', align: '', w: 32 },
  ];
  const [widths, setWidths] = useState<Record<string, number>>(() => Object.fromEntries(COLS.map(c => [c.id, c.w])));
  const startResize = (id: string, e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX; const startW = widths[id] ?? 80;
    const onMove = (ev: MouseEvent) => setWidths(p => ({ ...p, [id]: Math.max(28, startW + ev.clientX - startX) }));
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
  };
  const totalW = COLS.reduce((s, c) => s + (widths[c.id] ?? c.w), 0);
  const colSpan = COLS.length;
  const cellCls = 'bg-transparent outline-none focus:bg-blue-50 rounded px-1 w-full text-xs [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';
  const patch = (id: string, body: any) => api('PATCH', `/api/ventes/forecast/${id}`, body);
  const setMonth = (v: Vente, i: number, raw: string) => { const q = [...v.qty]; q[i] = Number(raw) || 0; patch(v.id, { qty: q }); };
  const fr = (n: number) => Math.round(n).toLocaleString('fr-FR');
  const frK = (n: number) => n ? Math.round(n / 1000).toLocaleString('fr-FR') + 'k' : '·';
  const monthsCA = (vs: Vente[]) => { const t = Array(12).fill(0); for (const v of vs) for (let i = 0; i < 12; i++) t[i] += (v.qty[i] || 0) * (v.prixUnitaire || 0); return t; };
  const monthsSum = (vs: Vente[]) => { const t = Array(12).fill(0); for (const v of vs) for (let i = 0; i < 12; i++) t[i] += v.qty[i] || 0; return t; };
  // Mois marqués « réalisé » (colonne verte). Clic sur l'en-tête du mois pour basculer.
  const realized = (i: number) => !!(realizedMonths && realizedMonths[i]);
  const toggleMonth = (i: number) => { if (!canEdit) return; const next = Array.from({ length: 12 }, (_, j) => j === i ? !realized(j) : realized(j)); api('PUT', '/api/ventes/forecast-meta', { year, realizedMonths: next }); };
  const majDate = updatedAt ? new Date(updatedAt).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : null;

  const groups = useMemo(() => {
    const m = new Map<string, Vente[]>();
    for (const v of rows) { const k = v.pays || '(sans pays)'; if (!m.has(k)) m.set(k, []); m.get(k)!.push(v); }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'fr'));
  }, [rows]);

  const grandMonths = monthsSum(rows);
  const grandQty = grandMonths.reduce((a, b) => a + b, 0);
  const grandCA = rows.reduce((a, v) => a + caRow(v), 0);
  const grandCAm = monthsCA(rows);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-500">
          {rows.length} ligne(s) · {groups.length} pays · Total CA <b className="text-slate-800">{eur(grandCA)}</b>
          {majDate && <span className="ml-2 text-xs text-slate-400">· Dernière mise à jour : {majDate}</span>}
          <span className="ml-2 text-xs text-slate-400">· <span className="inline-block w-2 h-2 rounded-sm bg-green-400 align-middle" /> mois réalisé (cliquer l'en-tête du mois)</span>
        </div>
        {canEdit && <button onClick={() => { const p = prompt('Nouveau pays ?'); if (p) api('POST', '/api/ventes/forecast', { year, pays: p }); }} className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"><Plus className="w-4 h-4" /> Pays</button>}
      </div>
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-x-auto">
        <table className="text-xs" style={{ tableLayout: 'fixed', width: totalW }}>
          <colgroup>{COLS.map(c => <col key={c.id} style={{ width: widths[c.id] ?? c.w }} />)}</colgroup>
          <thead><tr className="bg-slate-100 text-left text-[10px] uppercase text-slate-500">
            {COLS.map(c => {
              const m = c.month;
              const isReal = m !== undefined && realized(m);
              return (
                <th key={c.id}
                  onClick={m !== undefined && canEdit ? () => toggleMonth(m) : undefined}
                  title={m !== undefined && canEdit ? (isReal ? 'Réalisé — cliquer pour repasser en prévisionnel' : 'Cliquer pour marquer ce mois comme réalisé') : undefined}
                  className={cn('relative px-2 py-2 select-none', c.align, isReal && 'bg-green-100 text-green-700', m !== undefined && canEdit && 'cursor-pointer hover:bg-green-50')}>
                  {m !== undefined ? <span className="inline-block [writing-mode:vertical-rl] rotate-180 leading-none">{c.label}</span> : c.label}
                  <span onMouseDown={e => startResize(c.id, e)} title="Régler la largeur" className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-blue-400/60" />
                </th>
              );
            })}
          </tr></thead>
          {rows.length === 0
            ? <tbody><tr><td colSpan={colSpan} className="px-4 py-10 text-center text-slate-400">Aucune ligne forecast.</td></tr></tbody>
            : groups.map(([pays, vs]) => {
              const sub = monthsSum(vs); const subQty = sub.reduce((a, b) => a + b, 0); const subCA = vs.reduce((a, v) => a + caRow(v), 0); const subCAm = monthsCA(vs);
              return (
                <tbody key={pays} className="divide-y divide-slate-100">
                  <tr className="bg-slate-50">
                    <td colSpan={colSpan} className="px-3 py-1.5 border-y border-slate-200">
                      <span className="inline-flex items-center gap-2 font-semibold text-slate-700">🌍 {pays} <span className="text-[10px] font-normal text-slate-400">· {vs.length} produit(s)</span>
                        {canEdit && <button onClick={() => api('POST', '/api/ventes/forecast', { year, pays: pays === '(sans pays)' ? '' : pays })} className="text-[10px] px-1.5 py-0.5 text-blue-600 hover:bg-blue-100 rounded">+ ligne</button>}
                      </span>
                    </td>
                  </tr>
                  {vs.map(v => (
                    <tr key={v.id} className="hover:bg-slate-50">
                      <td className="px-2 py-1"><input defaultValue={v.codeOdoo} disabled={!canEdit} placeholder="—" onBlur={e => { const code = e.target.value; if (code === v.codeOdoo) return; const name = catalog[code]; patch(v.id, name ? { codeOdoo: code, produit: name } : { codeOdoo: code }); }} className={cn(cellCls, v.codeOdoo ? 'font-mono text-[11px] text-slate-600' : 'text-red-400')} /></td>
                      <td className="px-2 py-1"><input defaultValue={v.produit} disabled={!canEdit} title={v.produit} onBlur={e => e.target.value !== v.produit && patch(v.id, { produit: e.target.value })} className={cellCls} /></td>
                      <td className="px-1 py-1"><input type="number" defaultValue={v.prixUnitaire} disabled={!canEdit} onBlur={e => Number(e.target.value) !== v.prixUnitaire && patch(v.id, { prixUnitaire: Number(e.target.value) || 0 })} className={cn(cellCls, 'text-right')} /></td>
                      {v.qty.map((q, i) => <td key={i} className={cn('px-1.5 py-1.5', realized(i) && 'bg-green-50')}><input type="number" inputMode="numeric" defaultValue={q} disabled={!canEdit} onBlur={e => Number(e.target.value) !== q && setMonth(v, i, e.target.value)} className={cn(cellCls, 'text-right', realized(i) && 'text-green-700 font-medium')} /></td>)}
                      <td className="px-2 py-1 text-right font-medium text-slate-700 tabular-nums">{fr(sumQty(v))}</td>
                      <td className="px-2 py-1 text-right font-semibold text-slate-800 tabular-nums">{eur(caRow(v))}</td>
                      <td className="px-1 py-1 text-right">{canEdit && <button onClick={() => confirm('Supprimer cette ligne ?') && api('DELETE', `/api/ventes/forecast/${v.id}`)} className="p-1 text-slate-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>}</td>
                    </tr>
                  ))}
                  <tr className="bg-blue-50/70 font-medium text-slate-700">
                    <td className="px-2 py-1.5 text-right text-[10px] uppercase text-slate-500" colSpan={3}>Sous-total {pays} · boîtes</td>
                    {sub.map((v, i) => <td key={i} className={cn('px-1 py-1.5 text-right tabular-nums', realized(i) && 'bg-green-100/70 text-green-700')}>{v ? fr(v) : '·'}</td>)}
                    <td className="px-2 py-1.5 text-right tabular-nums">{fr(subQty)}</td>
                    <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{eur(subCA)}</td>
                    <td />
                  </tr>
                  <tr className="bg-blue-50/40 text-slate-500">
                    <td className="px-2 py-1 text-right text-[10px] uppercase" colSpan={3}>Sous-total {pays} · CA (k€)</td>
                    {subCAm.map((v, i) => <td key={i} className="px-1 py-1 text-right tabular-nums text-[11px]">{frK(v)}</td>)}
                    <td />
                    <td className="px-2 py-1 text-right font-semibold tabular-nums">{eur(subCA)}</td>
                    <td />
                  </tr>
                </tbody>
              );
            })}
          {rows.length > 0 && (
            <tfoot>
              <tr className="bg-slate-800 text-white font-semibold">
                <td className="px-2 py-2 text-right uppercase text-[10px]" colSpan={3}>Total tous pays · boîtes</td>
                {grandMonths.map((v, i) => <td key={i} className={cn('px-1 py-2 text-right tabular-nums', realized(i) && 'text-green-300')}>{v ? fr(v) : '·'}</td>)}
                <td className="px-2 py-2 text-right tabular-nums">{fr(grandQty)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{eur(grandCA)}</td>
                <td />
              </tr>
              <tr className="bg-slate-700 text-slate-200 font-medium">
                <td className="px-2 py-1.5 text-right uppercase text-[10px]" colSpan={3}>Total tous pays · CA (k€)</td>
                {grandCAm.map((v, i) => <td key={i} className="px-1 py-1.5 text-right tabular-nums text-[11px]">{frK(v)}</td>)}
                <td />
                <td className="px-2 py-1.5 text-right tabular-nums">{eur(grandCA)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

type SortKey = 'pays' | 'ligneProduit' | 'produit' | 'codeOdoo' | 'prixUnitaire' | 'total' | 'ca';
function Grid({ rows, base, year, canEdit, api, odooInfo, catalog }: { rows: Vente[]; base: string; year: number; canEdit: boolean; api: any; odooInfo?: string; catalog?: Record<string, string> }) {
  const [sort, setSort] = useState<{ k: SortKey; dir: 'asc' | 'desc' } | null>(null);
  const toggle = (k: SortKey) => setSort(s => (s && s.k === k ? { k, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { k, dir: 'asc' }));
  const val = (v: Vente, k: SortKey): string | number => k === 'total' || k === 'ca' ? sumEur(v) : k === 'prixUnitaire' ? v.prixUnitaire : (v as any)[k];
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const s = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = val(a, sort.k), vb = val(b, sort.k);
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * s;
      return String(va).localeCompare(String(vb), 'fr', { numeric: true }) * s;
    });
  }, [rows, sort]);
  const patch = (id: string, body: any) => api('PATCH', `/api/ventes/${base}/${id}`, body);
  const setMonth = (v: Vente, i: number, raw: string) => { const q = [...v.qty]; q[i] = Number(raw) || 0; patch(v.id, { qty: q }); };
  const cellCls = 'bg-transparent outline-none focus:bg-blue-50 rounded px-1 w-full text-xs';
  const totalCA = rows.reduce((a, v) => a + sumEur(v), 0);

  // Réalisé manuel : montants € par mois. Ordre Code Odoo → Produit → Pays → Prix → mois (€) → Total €.
  const COLS: { id: string; label: string; sort?: SortKey; month?: number; align?: string; w: number }[] = [
    { id: 'codeOdoo', label: 'Code Odoo', sort: 'codeOdoo', w: 104 },
    { id: 'produit', label: 'Produit (Odoo)', sort: 'produit', w: 180 },
    { id: 'pays', label: 'Pays', sort: 'pays', w: 84 },
    { id: 'prixUnitaire', label: 'Prix', sort: 'prixUnitaire', align: 'text-right', w: 54 },
    ...MOIS.map((m, i) => ({ id: 'm' + i, label: m, month: i, align: 'text-right', w: 44 })),
    { id: 'total', label: 'Total €', sort: 'total' as SortKey, align: 'text-right', w: 96 },
    { id: 'actions', label: '', align: '', w: 32 },
  ];
  const [widths, setWidths] = useState<Record<string, number>>(() => Object.fromEntries(COLS.map(c => [c.id, c.w])));
  const startResize = (id: string, e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX; const startW = widths[id] ?? 80;
    const onMove = (ev: MouseEvent) => setWidths(p => ({ ...p, [id]: Math.max(28, startW + ev.clientX - startX) }));
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
  };
  const totalW = COLS.reduce((s, c) => s + (widths[c.id] ?? c.w), 0);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-500">{rows.length} ajustement(s) · Total <b className="text-slate-800">{eur(totalCA)}</b>{odooInfo && <span className="ml-2 text-xs text-amber-600">· {odooInfo}</span>}</div>
        {canEdit && <button onClick={() => api('POST', `/api/ventes/${base}`, { year })} className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"><Plus className="w-4 h-4" /> Ligne</button>}
      </div>
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-x-auto">
        <table className="text-xs border-collapse" style={{ tableLayout: 'fixed', width: totalW }}>
          <colgroup>{COLS.map(c => <col key={c.id} style={{ width: widths[c.id] ?? c.w }} />)}</colgroup>
          <thead><tr className="bg-slate-50 text-left text-[10px] uppercase text-slate-500">
            {COLS.map(c => (
              <th key={c.id} className={cn('relative px-2 py-2 select-none', c.align)}>
                {c.month !== undefined
                  ? <span className="inline-block [writing-mode:vertical-rl] rotate-180 leading-none">{c.label}</span>
                  : c.sort
                    ? <button onClick={() => toggle(c.sort!)} className="inline-flex items-center gap-1 uppercase hover:text-slate-700">{c.label}{sort?.k === c.sort ? (sort.dir === 'asc' ? <ChevronUp className="w-3 h-3 text-blue-600" /> : <ChevronDown className="w-3 h-3 text-blue-600" />) : <ChevronsUpDown className="w-3 h-3 text-slate-300" />}</button>
                    : c.label}
                <span onMouseDown={e => startResize(c.id, e)} title="Glisser pour régler la largeur" className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-blue-400/60" />
              </th>
            ))}
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {sorted.map(v => (
              <tr key={v.id} className="hover:bg-slate-50">
                <td className="px-2 py-1"><input defaultValue={v.codeOdoo} disabled={!canEdit} placeholder="—" onBlur={e => { const code = e.target.value; if (code === v.codeOdoo) return; const name = catalog && catalog[code]; patch(v.id, name ? { codeOdoo: code, produit: name } : { codeOdoo: code }); }} className={cn(cellCls, v.codeOdoo ? 'font-mono text-[11px] text-slate-600' : 'text-red-400')} /></td>
                <td className="px-2 py-1"><input defaultValue={v.produit} disabled={!canEdit} title={v.produit} onBlur={e => e.target.value !== v.produit && patch(v.id, { produit: e.target.value })} className={cellCls} /></td>
                <td className="px-2 py-1"><input defaultValue={v.pays} disabled={!canEdit} onBlur={e => e.target.value !== v.pays && patch(v.id, { pays: e.target.value })} className={cellCls} /></td>
                <td className="px-1 py-1"><input type="number" defaultValue={v.prixUnitaire} disabled={!canEdit} onBlur={e => Number(e.target.value) !== v.prixUnitaire && patch(v.id, { prixUnitaire: Number(e.target.value) || 0 })} className={cn(cellCls, 'text-right')} /></td>
                {v.qty.map((q, i) => (
                  <td key={i} className="px-0.5 py-1"><input type="number" defaultValue={q} disabled={!canEdit} onBlur={e => Number(e.target.value) !== q && setMonth(v, i, e.target.value)} className={cn(cellCls, 'text-right')} /></td>
                ))}
                <td className="px-2 py-1 text-right font-semibold text-slate-800 tabular-nums">{eur(sumEur(v))}</td>
                <td className="px-1 py-1 text-right">{canEdit && <button onClick={() => confirm('Supprimer cette ligne ?') && api('DELETE', `/api/ventes/${base}/${v.id}`)} className="p-1 text-slate-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={18} className="px-4 py-10 text-center text-slate-400">Aucun ajustement. {canEdit && 'Clique « + Ligne ».'}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

