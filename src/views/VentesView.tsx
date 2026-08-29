import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../AuthContext';
import { cn } from '../utils/cn';
import { Plus, Trash2, Loader2, ChevronUp, ChevronDown, ChevronsUpDown, RefreshCw, FileDown, Archive, Camera, History, CalendarPlus, X, RotateCcw } from 'lucide-react';
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
  const [tab, setTab] = useState<'pilotage' | 'forecast' | 'realise' | 'registre' | 'client'>('pilotage');
  const [loading, setLoading] = useState(true);
  const [odooLoading, setOdooLoading] = useState(false);
  const [revOpen, setRevOpen] = useState(false);
  const [revKey, setRevKey] = useState(0);   // force le rechargement de la liste des révisions

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

  if (loading) return <div className="p-4 sm:p-6 lg:p-8 flex-1 flex items-center justify-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Chargement…</div>;

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

  // Fige l'état actuel de l'année sous un nom (V1 budget, V2 après comité…).
  const figerRevision = async () => {
    const nom = prompt(`Nom de cette révision du forecast ${year} ?\n(ex. « V1 budget », « V2 après comité de mars »)`);
    if (!nom || !nom.trim()) return;
    const commentaire = prompt('Commentaire (facultatif) : pourquoi cette révision ?') || null;
    const ok = await api('POST', '/api/ventes/revisions', { year, nom: nom.trim(), commentaire });
    if (ok) { setRevKey(k => k + 1); alert(`Révision « ${nom.trim()} » figée. Le forecast ${year} reste modifiable.`); }
  };
  // Prépare l'année suivante : structure reprise, 12 mois vides.
  const preparerAnneeSuivante = async () => {
    const cible = year + 1;
    if (!confirm(`Préparer le forecast ${cible} à partir de ${year} ?\n\nLes mêmes pays, produits, prix et codes Odoo seront repris, avec les 12 mois vides à remplir.\nLe forecast ${year} n'est pas modifié.`)) return;
    const ok = await api('POST', '/api/ventes/nouvelle-annee', { source: year, cible });
    if (ok) { setYear(cible); alert(`Forecast ${cible} créé. Tu es maintenant dessus : il ne reste qu'à saisir les quantités.`); }
  };

  const exportPDF = () => {
    const grp = new Map<string, { ca: number; qty: number }>();
    for (const v of data.forecast) { const k = v.pays || '(sans pays)'; if (!grp.has(k)) grp.set(k, { ca: 0, qty: 0 }); const g = grp.get(k)!; const q = v.qty.reduce((a, b) => a + (b || 0), 0); g.qty += q; g.ca += q * (v.prixUnitaire || 0); }
    // Boîtes par pays et par mois (détail mensuel).
    const paysMonths = new Map<string, number[]>();
    for (const v of data.forecast) { const k = v.pays || '(sans pays)'; if (!paysMonths.has(k)) paysMonths.set(k, Array(12).fill(0)); const arr = paysMonths.get(k)!; for (let i = 0; i < 12; i++) arr[i] += v.qty[i] || 0; }
    const grandBoxMonths = Array(12).fill(0); for (const arr of paysMonths.values()) for (let i = 0; i < 12; i++) grandBoxMonths[i] += arr[i];
    const frB = (n: number) => n ? Math.round(n).toLocaleString('fr-FR') : '·';
    const boxThs = MOIS.map(m => `<th class=r>${m}</th>`).join('');
    const boxRows = [...paysMonths.entries()].sort((a, b) => a[0].localeCompare(b[0], 'fr')).map(([p, arr]) => `<tr><td>${p}</td>${arr.map(v => `<td class=r>${frB(v)}</td>`).join('')}<td class=r><b>${frB(arr.reduce((a, b) => a + b, 0))}</b></td></tr>`).join('');
    const boxTot = `<tr style="font-weight:bold;background:#f8fafc"><td>Total</td>${grandBoxMonths.map(v => `<td class=r>${frB(v)}</td>`).join('')}<td class=r>${frB(grandBoxMonths.reduce((a, b) => a + b, 0))}</td></tr>`;

    // --- Quantités à vendre : par produit (tous pays), puis par pays et par produit ---
    const nomProduit = (v: Vente) => v.produit || catalog[v.codeOdoo] || v.codeOdoo || '(sans produit)';
    // Par produit, tous pays confondus : 12 mois + total boîtes + CA.
    const prodMonths = new Map<string, { m: number[]; ca: number }>();
    for (const v of data.forecast) {
      const k = nomProduit(v);
      if (!prodMonths.has(k)) prodMonths.set(k, { m: Array(12).fill(0), ca: 0 });
      const g = prodMonths.get(k)!;
      for (let i = 0; i < 12; i++) { g.m[i] += v.qty[i] || 0; g.ca += (v.qty[i] || 0) * (v.prixUnitaire || 0); }
    }
    const prodTotMonths = Array(12).fill(0); let prodTotCa = 0;
    for (const g of prodMonths.values()) { for (let i = 0; i < 12; i++) prodTotMonths[i] += g.m[i]; prodTotCa += g.ca; }
    const prodRows = [...prodMonths.entries()].sort((a, b) => a[0].localeCompare(b[0], 'fr')).map(([p, g]) =>
      `<tr><td>${p}</td>${g.m.map(v => `<td class=r>${frB(v)}</td>`).join('')}<td class=r><b>${frB(g.m.reduce((a, b) => a + b, 0))}</b></td><td class=r>${eur(g.ca)}</td></tr>`).join('');
    const prodTotRow = `<tr style="font-weight:bold;background:#f8fafc"><td>Total</td>${prodTotMonths.map(v => `<td class=r>${frB(v)}</td>`).join('')}<td class=r>${frB(prodTotMonths.reduce((a, b) => a + b, 0))}</td><td class=r>${eur(prodTotCa)}</td></tr>`;
    // Par pays, détaillé produit par produit (une ligne d'en-tête par pays).
    const paysProd = new Map<string, Map<string, number[]>>();
    for (const v of data.forecast) {
      const kp = v.pays || '(sans pays)', kq = nomProduit(v);
      if (!paysProd.has(kp)) paysProd.set(kp, new Map());
      const mp = paysProd.get(kp)!;
      if (!mp.has(kq)) mp.set(kq, Array(12).fill(0));
      const arr = mp.get(kq)!;
      for (let i = 0; i < 12; i++) arr[i] += v.qty[i] || 0;
    }
    const paysProdRows = [...paysProd.entries()].sort((a, b) => a[0].localeCompare(b[0], 'fr')).map(([pays, mp]) => {
      const sous = Array(12).fill(0);
      for (const arr of mp.values()) for (let i = 0; i < 12; i++) sous[i] += arr[i];
      const lignes = [...mp.entries()].sort((a, b) => a[0].localeCompare(b[0], 'fr')).map(([prod, arr]) =>
        `<tr><td style="padding-left:14px">${prod}</td>${arr.map(v => `<td class=r>${frB(v)}</td>`).join('')}<td class=r><b>${frB(arr.reduce((a, b) => a + b, 0))}</b></td></tr>`).join('');
      const entete = `<tr style="background:#eef2f7;font-weight:bold"><td>${pays}</td>${sous.map(v => `<td class=r>${frB(v)}</td>`).join('')}<td class=r>${frB(sous.reduce((a, b) => a + b, 0))}</td></tr>`;
      return entete + lignes;
    }).join('');
    const max = Math.max(1, ...fMonthly, ...rMonthly), h = 150, bw = 46;
    const bars = MOIS.map((m, i) => { const x = i * bw + 34; const fh = fMonthly[i] / max * h, rh = rMonthly[i] / max * h; return `<rect x="${x}" y="${20 + h - fh}" width="17" height="${fh}" fill="#2563eb"/><rect x="${x + 19}" y="${20 + h - rh}" width="17" height="${rh}" fill="#16a34a"/><text x="${x + 18}" y="${20 + h + 12}" font-size="9" text-anchor="middle" fill="#64748b">${m}</text>`; }).join('');
    const svg = `<svg width="${MOIS.length * bw + 50}" height="${h + 40}"><text x="34" y="12" font-size="10" fill="#2563eb">■ Prévu</text><text x="90" y="12" font-size="10" fill="#16a34a">■ Réalisé</text>${bars}</svg>`;
    const mRows = MOIS.map((m, i) => `<tr><td>${m}</td><td class=r>${eur(fMonthly[i])}</td><td class=r>${eur(rMonthly[i])}</td><td class=r>${eur(rMonthly[i] - fMonthly[i])}</td></tr>`).join('');
    const pRows = [...grp.entries()].sort((a, b) => a[0].localeCompare(b[0], 'fr')).map(([p, g]) => `<tr><td>${p}</td><td class=r>${g.qty.toLocaleString('fr-FR')}</td><td class=r>${eur(g.ca)}</td></tr>`).join('');
    const html = `<!doctype html><html lang=fr><head><meta charset=utf-8><title>Forecast Ventes ${year}</title><style>body{font-family:system-ui,Arial;max-width:900px;margin:24px auto;color:#1e293b}h1{font-size:20px}h2{font-size:14px;border-bottom:2px solid #e2e8f0;padding-bottom:4px;margin-top:22px}table{width:100%;border-collapse:collapse;font-size:12px;margin-top:6px}th,td{border:1px solid #e2e8f0;padding:5px 8px}.r{text-align:right}.kpi{display:flex;gap:12px;flex-wrap:wrap;margin:10px 0}.kpi div{background:#f1f5f9;border-radius:8px;padding:8px 12px;font-size:12px}table.boxes{font-size:9px}table.boxes th,table.boxes td{padding:3px 4px}@media print{.np{display:none}}</style></head><body>
<button class=np onclick="print()" style="float:right;padding:6px 12px;cursor:pointer">Imprimer / PDF</button>
<h1>Forecast Ventes ${year} — situation CA</h1>
<div class="kpi"><div>Forecast : <b>${eur(fTotal)}</b></div><div>Réalisé : <b>${eur(rTotal)}</b></div><div>% réalisé : <b>${fTotal ? Math.round(rTotal / fTotal * 100) : 0}%</b></div><div>Reste à faire : <b>${eur(fTotal - rTotal)}</b></div></div>
<h2>Prévu vs Réalisé par mois</h2>${svg}
<table><thead><tr><th>Mois</th><th class=r>Prévu</th><th class=r>Réalisé</th><th class=r>Écart</th></tr></thead><tbody>${mRows}<tr style="font-weight:bold;background:#f8fafc"><td>Total</td><td class=r>${eur(fTotal)}</td><td class=r>${eur(rTotal)}</td><td class=r>${eur(rTotal - fTotal)}</td></tr></tbody></table>
<h2>Forecast par pays</h2><table><thead><tr><th>Pays</th><th class=r>Boîtes</th><th class=r>CA forecast</th></tr></thead><tbody>${pRows}</tbody></table>
<h2>Boîtes par pays et par mois</h2><table class=boxes><thead><tr><th>Pays</th>${boxThs}<th class=r>Total</th></tr></thead><tbody>${boxRows}${boxTot}</tbody></table>
<h2>Quantités à vendre par produit (toutes destinations)</h2><table class=boxes><thead><tr><th>Produit</th>${boxThs}<th class=r>Total boîtes</th><th class=r>CA forecast</th></tr></thead><tbody>${prodRows}${prodTotRow}</tbody></table>
<h2>Quantités à vendre par pays et par produit</h2><table class=boxes><thead><tr><th>Pays / produit</th>${boxThs}<th class=r>Total boîtes</th></tr></thead><tbody>${paysProdRows}</tbody></table>
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
          {canEdit && !ro && <button onClick={figerRevision} title="Enregistrer une photo figée du forecast de cette année" className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"><Camera className="w-4 h-4" /> Figer une révision</button>}
          <button onClick={() => setRevOpen(true)} title="Consulter, comparer ou restaurer les révisions figées" className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"><History className="w-4 h-4" /> Révisions</button>
          {canEdit && <button onClick={preparerAnneeSuivante} title={`Créer le forecast ${year + 1} à partir de ${year}`} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"><CalendarPlus className="w-4 h-4" /> Préparer {year + 1}</button>}
          <button onClick={exportPDF} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"><FileDown className="w-4 h-4" /> Export PDF</button>
          {canEdit && <button onClick={() => archiveYear(!ro)} className={cn('flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border', ro ? 'text-blue-700 bg-blue-50 border-blue-200 hover:bg-blue-100' : 'text-slate-700 bg-white border-slate-300 hover:bg-slate-50')}><Archive className="w-4 h-4" /> {ro ? 'Désarchiver' : 'Archiver'}</button>}
          <button onClick={load} className="text-slate-400 hover:text-blue-600" title="Rafraîchir"><RefreshCw className="w-4 h-4" /></button>
        </div>
      </div>
      <div className="flex gap-1 mb-4 border-b border-slate-200">
        {([['pilotage', 'Pilotage'], ['forecast', 'Forecast'], ['realise', 'Réalisé'], ['registre', 'Registre commandes'], ['client', 'Vue client']] as const).map(([k, l]) => (
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
      {tab === 'client' && <ClientView rows={data.forecast} year={year} realizedMonths={data.realizedMonths} />}
      {revOpen && <RevisionsModal year={year} token={token} actuel={data.forecast} canEdit={canEdit && !ro} cle={revKey} onClose={() => setRevOpen(false)} onRestore={load} />}
    </div>
  );
}

// ---------- Révisions du forecast : consulter, comparer à aujourd'hui, restaurer ----------
interface RevisionInfo { id: number; year: number; nom: string; commentaire: string | null; totalCa: number; creePar: string | null; creeLe: string; nbLignes: number; }

function RevisionsModal({ year, token, actuel, canEdit, cle, onClose, onRestore }:
  { year: number; token: string | null; actuel: Vente[]; canEdit: boolean; cle: number; onClose: () => void; onRestore: () => void }) {
  const [liste, setListe] = useState<RevisionInfo[] | null>(null);
  const [choisie, setChoisie] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let vivant = true;
    fetch(`${API_URL}/api/ventes/revisions?year=${year}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : []).then(v => { if (vivant) setListe(v); }).catch(() => { if (vivant) setListe([]); });
    return () => { vivant = false; };
  }, [year, token, cle]);

  const ouvrir = async (id: number) => {
    const r = await fetch(`${API_URL}/api/ventes/revisions/${id}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return alert('Révision illisible.');
    setChoisie(await r.json());
  };
  const restaurer = async (rev: any) => {
    if (!confirm(`Restaurer « ${rev.nom} » ?\n\nLes quantités du forecast ${year} reprendront les valeurs de cette révision.\nL'état actuel sera d'abord figé automatiquement, tu pourras donc revenir en arrière.`)) return;
    setBusy(true);
    const r = await fetch(`${API_URL}/api/ventes/revisions/${rev.id}/restore`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    setBusy(false);
    if (!r.ok) { const e = await r.json().catch(() => ({})); return alert(e.error || 'Échec de la restauration.'); }
    const d = await r.json();
    alert(`Restauration faite : ${d.restaurees} ligne(s) remise(s) à leur valeur d'origine.` + (d.absentes ? `\n${d.absentes} ligne(s) de la révision n'existent plus et ont été ignorées.` : ''));
    onRestore(); onClose();
  };

  // Comparaison mois par mois, en euros : révision vs état actuel.
  const comparaison = useMemo(() => {
    if (!choisie) return null;
    const rev = Array(12).fill(0), act = Array(12).fill(0);
    for (const l of choisie.lignes as any[]) for (let i = 0; i < 12; i++) rev[i] += (l.qty[i] || 0) * (l.prixUnitaire || 0);
    for (const v of actuel) for (let i = 0; i < 12; i++) act[i] += (v.qty[i] || 0) * (v.prixUnitaire || 0);
    return { rev, act, totalRev: rev.reduce((a, b) => a + b, 0), totalAct: act.reduce((a, b) => a + b, 0) };
  }, [choisie, actuel]);

  const quand = (v: any) => v ? new Date(v).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[88vh] overflow-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <h4 className="font-semibold text-slate-800">Révisions du forecast {year}</h4>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          {liste === null && <div className="text-sm text-slate-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Chargement…</div>}
          {liste?.length === 0 && <div className="text-sm text-slate-500">Aucune révision figée pour {year}. Clique sur « Figer une révision » pour enregistrer l'état actuel : tu pourras ensuite comparer ce que tu prévoyais à ce moment-là avec la situation du jour.</div>}
          {!!liste?.length && (
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="bg-slate-50 text-left text-[11px] uppercase text-slate-500">
                  <th className="px-3 py-2">Révision</th><th className="px-3 py-2">Figée le</th><th className="px-3 py-2">Par</th>
                  <th className="px-3 py-2 text-right">CA forecast</th><th className="px-3 py-2 text-right">Lignes</th><th className="px-3 py-2"></th>
                </tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {liste.map(r => (
                    <tr key={r.id} className={cn('hover:bg-slate-50', choisie?.id === r.id && 'bg-blue-50/60')}>
                      <td className="px-3 py-2"><div className="font-medium text-slate-800">{r.nom}</div>{r.commentaire && <div className="text-xs text-slate-500">{r.commentaire}</div>}</td>
                      <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{quand(r.creeLe)}</td>
                      <td className="px-3 py-2 text-slate-600">{r.creePar || '—'}</td>
                      <td className="px-3 py-2 text-right text-slate-700 tabular-nums">{eur(r.totalCa)}</td>
                      <td className="px-3 py-2 text-right text-slate-500 tabular-nums">{r.nbLignes}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <button onClick={() => ouvrir(r.id)} className="text-xs font-semibold text-blue-600 hover:underline">Comparer</button>
                        {canEdit && <button onClick={() => restaurer(r)} disabled={busy} title="Remettre le forecast dans cet état" className="ml-3 text-xs font-semibold text-slate-500 hover:text-amber-700 inline-flex items-center gap-1"><RotateCcw className="w-3 h-3" /> Restaurer</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {choisie && comparaison && (
            <div>
              <div className="text-sm font-semibold text-slate-800 mb-2">« {choisie.nom} » comparée au forecast d'aujourd'hui</div>
              <div className="border border-slate-200 rounded-lg overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="bg-slate-50 text-left text-[10px] uppercase text-slate-500">
                    <th className="px-2 py-1.5">Mois</th>{MOIS.map(m => <th key={m} className="px-2 py-1.5 text-right">{m}</th>)}<th className="px-2 py-1.5 text-right">Total</th>
                  </tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    <tr><td className="px-2 py-1.5 text-slate-600">Révision</td>{comparaison.rev.map((v, i) => <td key={i} className="px-2 py-1.5 text-right tabular-nums text-slate-600">{eur(v)}</td>)}<td className="px-2 py-1.5 text-right font-semibold tabular-nums">{eur(comparaison.totalRev)}</td></tr>
                    <tr><td className="px-2 py-1.5 text-slate-600">Aujourd'hui</td>{comparaison.act.map((v, i) => <td key={i} className="px-2 py-1.5 text-right tabular-nums text-slate-600">{eur(v)}</td>)}<td className="px-2 py-1.5 text-right font-semibold tabular-nums">{eur(comparaison.totalAct)}</td></tr>
                    <tr className="bg-slate-50 font-semibold">
                      <td className="px-2 py-1.5 text-slate-700">Écart</td>
                      {comparaison.act.map((v, i) => { const d = v - comparaison.rev[i]; return <td key={i} className={cn('px-2 py-1.5 text-right tabular-nums', d > 0 ? 'text-green-700' : d < 0 ? 'text-red-600' : 'text-slate-400')}>{d ? (d > 0 ? '+' : '') + eur(d) : '·'}</td>; })}
                      {(() => { const d = comparaison.totalAct - comparaison.totalRev; return <td className={cn('px-2 py-1.5 text-right tabular-nums', d > 0 ? 'text-green-700' : d < 0 ? 'text-red-600' : 'text-slate-400')}>{(d > 0 ? '+' : '') + eur(d)}</td>; })()}
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="text-[11px] text-slate-400 mt-1">Figée le {quand(choisie.creeLe)} par {choisie.creePar || '—'} · {(choisie.lignes as any[]).length} ligne(s)</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Vue client : extraction quantités seulement (boîtes) pour un pays (= un client). Aucun prix, aucun CA.
function ClientView({ rows, year, realizedMonths }: { rows: Vente[]; year: number; realizedMonths?: boolean[] }) {
  const countries = useMemo(() => [...new Set(rows.map(v => v.pays || '(sans pays)'))].sort((a, b) => a.localeCompare(b, 'fr')), [rows]);
  const [pays, setPays] = useState<string>('');
  useEffect(() => { if (!pays && countries.length) setPays(countries[0]); }, [countries, pays]);
  const lignes = useMemo(() => rows.filter(v => (v.pays || '(sans pays)') === pays), [rows, pays]);
  const monthsTot = useMemo(() => { const t = Array(12).fill(0); for (const v of lignes) for (let i = 0; i < 12; i++) t[i] += v.qty[i] || 0; return t; }, [lignes]);
  const grandTot = monthsTot.reduce((a, b) => a + b, 0);
  // CA total = somme (boîtes x prix unitaire) des lignes du Forecast de ce pays.
  const caTot = lignes.reduce((a, v) => a + caRow(v), 0);
  // CA mois par mois : boîtes du mois x prix unitaire (somme = caTot).
  const caMonths = useMemo(() => { const t = Array(12).fill(0); for (const v of lignes) for (let i = 0; i < 12; i++) t[i] += (v.qty[i] || 0) * (v.prixUnitaire || 0); return t; }, [lignes]);
  const fr = (n: number) => n ? Math.round(n).toLocaleString('fr-FR') : '·';
  const realized = (i: number) => !!(realizedMonths && realizedMonths[i]);

  const exportPDF = () => {
    const gc = (i: number) => realized(i) ? ' g' : '';
    const ths = MOIS.map((m, i) => `<th class="r${gc(i)}">${m}</th>`).join('');
    const mRows = lignes.map(v => `<tr><td>${v.codeOdoo || '—'}</td><td>${v.produit || '—'}</td>${v.qty.map((q, i) => `<td class="r${gc(i)}">${fr(q)}</td>`).join('')}<td class=r><b>${fr(sumQty(v))}</b></td></tr>`).join('');
    const caRowHtml = `<tr class=tot><td colspan=2>TOTAL ${pays} — chiffre d'affaires (€)</td>${caMonths.map((v, i) => `<td class="r${gc(i)}">${fr(Math.round(v))}</td>`).join('')}<td class=r>${eur(caTot)}</td></tr>`;
    const totRow = `<tr class=tot><td colspan=2>TOTAL ${pays}</td>${monthsTot.map((v, i) => `<td class="r${gc(i)}">${fr(v)}</td>`).join('')}<td class=r>${fr(grandTot)}</td></tr>`;
    const html = `<!doctype html><html lang=fr><head><meta charset=utf-8><title>Prévisions ${pays} ${year}</title><style>body{font-family:system-ui,Arial;max-width:1000px;margin:24px auto;color:#1e293b}h1{font-size:20px}p.sub{color:#64748b;font-size:13px;margin-top:-6px}table{width:100%;border-collapse:collapse;font-size:10px;margin-top:12px}th,td{border:1px solid #e2e8f0;padding:4px 5px}.r{text-align:right}.tot{font-weight:bold;background:#f1f5f9}.g{background:#dcfce7;color:#15803d}@media print{.np{display:none}}</style></head><body>
<button class=np onclick="print()" style="float:right;padding:6px 12px;cursor:pointer">Imprimer / PDF</button>
<h1>Prévisions de commandes ${year} — ${pays}</h1>
<p class=sub>Quantités prévisionnelles (boîtes) par produit et par mois, et chiffre d'affaires total. <span style="color:#15803d">■ vert = déjà facturé</span></p>
<table><thead><tr><th>Code</th><th>Produit</th>${ths}<th class=r>Total</th></tr></thead><tbody>${mRows}${totRow}${caRowHtml}</tbody></table>
</body></html>`;
    const w = window.open('', '_blank'); if (w) { w.document.write(html); w.document.close(); }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-slate-500">Client (pays) :</span>
        <select value={pays} onChange={e => setPays(e.target.value)} className="text-sm border border-slate-300 rounded-md px-2 py-1.5 outline-none focus:border-blue-500">
          {countries.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <div className="text-sm text-slate-500 ml-2">{lignes.length} produit(s) · <b className="text-slate-800">{fr(grandTot)}</b> boîtes · CA <b className="text-slate-800">{eur(caTot)}</b> <span className="ml-1 text-xs text-slate-400">· <span className="inline-block w-2 h-2 rounded-sm bg-green-400 align-middle" /> déjà facturé</span></div>
        <button onClick={exportPDF} disabled={!lignes.length} className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50"><FileDown className="w-4 h-4" /> Export PDF (quantités)</button>
      </div>
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-x-auto">
        <table className="text-xs" style={{ tableLayout: 'fixed', width: 104 + 200 + 12 * 52 + 70 }}>
          <colgroup><col style={{ width: 104 }} /><col style={{ width: 200 }} />{MOIS.map(m => <col key={m} style={{ width: 52 }} />)}<col style={{ width: 70 }} /></colgroup>
          <thead><tr className="bg-slate-100 text-left text-[10px] uppercase text-slate-500">
            <th className="px-2 py-2">Code Odoo</th><th className="px-2 py-2">Produit</th>
            {MOIS.map((m, i) => <th key={m} className={cn('px-1 py-2 text-right', realized(i) && 'bg-green-100 text-green-700')}><span className="inline-block [writing-mode:vertical-rl] rotate-180 leading-none">{m}</span></th>)}
            <th className="px-2 py-2 text-right">Total</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {lignes.map(v => (
              <tr key={v.id} className="hover:bg-slate-50">
                <td className="px-2 py-1.5 font-mono text-[11px] text-slate-600 truncate">{v.codeOdoo || '—'}</td>
                <td className="px-2 py-1.5 text-slate-700 truncate" title={v.produit}>{v.produit || '—'}</td>
                {v.qty.map((q, i) => <td key={i} className={cn('px-1 py-1.5 text-right tabular-nums text-slate-600', realized(i) && 'bg-green-50 text-green-700 font-medium')}>{fr(q)}</td>)}
                <td className="px-2 py-1.5 text-right font-semibold text-slate-800 tabular-nums">{fr(sumQty(v))}</td>
              </tr>
            ))}
            {lignes.length === 0 && <tr><td colSpan={15} className="px-4 py-10 text-center text-slate-400">Aucune ligne pour ce pays.</td></tr>}
          </tbody>
          {lignes.length > 0 && (
            <tfoot><tr className="bg-slate-800 text-white font-semibold">
              <td className="px-2 py-2 uppercase text-[10px]" colSpan={2}>Total {pays} · boîtes</td>
              {monthsTot.map((v, i) => <td key={i} className={cn('px-1 py-2 text-right tabular-nums', realized(i) && 'text-green-300')}>{fr(v)}</td>)}
              <td className="px-2 py-2 text-right tabular-nums">{fr(grandTot)}</td>
            </tr>
            <tr className="bg-slate-700 text-slate-200 font-medium">
              <td className="px-2 py-1.5 uppercase text-[10px]" colSpan={2}>Total {pays} · chiffre d'affaires (€)</td>
              {caMonths.map((v, i) => <td key={i} className={cn('px-1 py-1.5 text-right tabular-nums text-[11px]', realized(i) && 'text-green-300')}>{fr(Math.round(v))}</td>)}
              <td className="px-2 py-1.5 text-right tabular-nums">{eur(caTot)}</td>
            </tr></tfoot>
          )}
        </table>
      </div>
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

  if (loading) return <div className="p-4 sm:p-6 lg:p-8 flex items-center justify-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Chargement…</div>;

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

