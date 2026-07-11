import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../AuthContext';
import { cn } from '../utils/cn';
import { Plus, Trash2, Loader2, X, Settings2, ChevronUp, ChevronDown, ChevronsUpDown, Pencil, RefreshCw } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, ComposedChart, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, Cell } from 'recharts';
import { MultiSelect } from '../components/MultiSelect';
import { CogsFamilyView } from './CogsFamilyView';
import { NomenclatureView } from './NomenclatureView';
import { CogsFillerView } from './CogsFillerView';

const API_URL = import.meta.env.VITE_API_URL || '';
const MOIS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
const CHART = { primary: '#2563eb', ok: '#16a34a', warn: '#f59e0b', bad: '#dc2626', grid: '#e2e8f0', tick: '#64748b' };

interface Product { id: number; code: string; name: string | null; type: string; unitsPerBox: number; cogsTarget: number | null; priceFr: number | null; priceCh: number | null; }
interface Lot {
  id: number; batchNumber: string; productCode: string | null; type: string; year: number | null; site: string | null;
  dateProdStart: string | null; dateProdEnd: string | null; datePlannedEnd: string | null;
  dateReleaseCmo: string | null; dateReleaseLouna: string | null;
  unitsTheoretical: number | null; unitsFilled: number | null; unitsConform: number | null;
  unitsRejected: number | null; unitsSold: number | null;
  costs: Record<string, number>; status: string; comment: string | null;
}

const eur = (n: number | null) => n == null ? '—' : Math.round(n).toLocaleString('fr-FR') + ' €';
const eur2 = (n: number | null) => n == null ? '—' : n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const pct = (n: number | null) => n == null ? '—' : Math.round(n * 100) + ' %';
const days = (a: string | null, b: string | null) => (a && b) ? Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000) : null;
const median = (arr: number[]) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };

// Libellés des 5 postes de coûts (structure normalisée reprise de l'Excel).
const COST_KEYS: { k: string; label: string }[] = [
  { k: 'cmo', label: 'CMO Bio-Steril' },
  { k: 'synexias', label: 'Synexias' },
  { k: 'labs', label: 'IPC/EPC' },
  { k: 'mp', label: 'Composants MP/AC' },
  { k: 'autres', label: 'Autres' },
];

// Tous les indicateurs d'un lot — UNE seule règle de calcul (normalisée).
function lotCalc(l: Lot, p?: Product) {
  const totalCosts = Object.values(l.costs || {}).reduce((a, b) => a + (Number(b) || 0), 0);
  const sold = l.unitsSold || 0;
  const upb = p?.unitsPerBox || (l.type === 'vial' ? 3 : 2);
  const cogsUnit = sold ? totalCosts / sold : null;
  const cogsBox = cogsUnit != null ? cogsUnit * upb : null;
  const boxes = sold ? Math.floor(sold / upb) : 0;
  const priceFr = p?.priceFr ?? null;
  const marginFr = (priceFr && cogsBox != null) ? (priceFr - cogsBox) / priceFr : null;
  const profitFr = (priceFr && cogsBox != null) ? (priceFr - cogsBox) * boxes : null;
  const revenueFr = priceFr ? priceFr * boxes : null;
  const priceCh = p?.priceCh ?? null;
  const marginCh = (priceCh && cogsBox != null) ? (priceCh - cogsBox) / priceCh : null;
  const profitCh = (priceCh && cogsBox != null) ? (priceCh - cogsBox) * boxes : null;
  const revenueCh = priceCh ? priceCh * boxes : null;
  const yieldGlobal = (l.unitsTheoretical && sold) ? sold / l.unitsTheoretical : null;
  const rejectRate = (l.unitsFilled && l.unitsRejected != null) ? l.unitsRejected / l.unitsFilled : null;
  const leadProd = days(l.dateProdStart, l.dateProdEnd);
  const leadRelease = days(l.dateProdEnd, l.dateReleaseLouna);
  const leadTotal = days(l.dateProdStart, l.dateReleaseLouna);
  const onTime = (l.datePlannedEnd && l.dateProdEnd) ? l.dateProdEnd <= l.datePlannedEnd : null;
  const ageSinceProd = (l.status !== 'LIBERE' && l.dateProdEnd) ? days(l.dateProdEnd, new Date().toISOString().slice(0, 10)) : null;
  return { totalCosts, cogsUnit, cogsBox, boxes, marginFr, profitFr, revenueFr, marginCh, profitCh, revenueCh, yieldGlobal, rejectRate, leadProd, leadRelease, leadTotal, onTime, ageSinceProd, upb };
}

function useCockpit() {
  const { token, socket } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [lots, setLots] = useState<Lot[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!token) return;
    const r = await fetch(`${API_URL}/api/cockpit/data`, { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) { const d = await r.json(); setProducts(d.products || []); setLots(d.lots || []); }
    setLoading(false);
  }, [token]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!socket) return; const h = () => load(); socket.on('cockpit:changed', h); return () => { socket.off('cockpit:changed', h); }; }, [socket, load]);
  const api = useCallback(async (method: string, path: string, body?: any) => {
    const r = await fetch(`${API_URL}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) { const e = await r.json().catch(() => ({})); alert(e.error || 'Erreur'); }
    await load();
    return r.ok;
  }, [token, load]);
  const prodByCode = useMemo(() => Object.fromEntries(products.map(p => [p.code, p])), [products]);
  return { products, lots, loading, api, prodByCode, reload: load };
}

export function CockpitView({ view }: { view: string }) {
  const data = useCockpit();
  if (data.loading) return <div className="p-8 flex-1 flex items-center justify-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Chargement…</div>;
  return (
    <div className="p-6 flex-1 overflow-auto bg-slate-50">
      {view === 'cockpit-nomenclature' ? <NomenclatureView /> : view === 'cockpit-familles' ? <CogsFamilyView /> : view === 'cockpit-cogs-filler' ? <CogsFillerView /> : view === 'cockpit-cogs' ? <CogsTab {...data} /> : <DashboardTab {...data} />}
    </div>
  );
}

// ============================================================================
// Filtres partagés (Année / Produit / Site)
// ============================================================================

function useFilters(lots: Lot[], reload?: () => void) {
  const [yearSel, setYearSel] = useState<Set<string>>(new Set());
  const [prodSel, setProdSel] = useState<Set<string>>(new Set());
  const [siteSel, setSiteSel] = useState<Set<string>>(new Set());
  const years = useMemo(() => [...new Set(lots.map(l => l.year).filter(Boolean))].sort((a: any, b: any) => b - a).map(String), [lots]);
  const prods = useMemo(() => [...new Set(lots.map(l => l.productCode).filter(Boolean))].sort() as string[], [lots]);
  const sites = useMemo(() => [...new Set(lots.map(l => l.site).filter(Boolean))].sort() as string[], [lots]);
  const filtered = useMemo(() => lots.filter(l =>
    (!yearSel.size || yearSel.has(String(l.year))) && (!prodSel.size || prodSel.has(l.productCode || '')) && (!siteSel.size || siteSel.has(l.site || ''))
  ), [lots, yearSel, prodSel, siteSel]);
  const active = yearSel.size + prodSel.size + siteSel.size;
  const ui = (
    <div className="flex flex-wrap items-center gap-2">
      <MultiSelect label="Années" options={years} selected={yearSel} onChange={setYearSel} />
      <MultiSelect label="Produits" options={prods} selected={prodSel} onChange={setProdSel} />
      <MultiSelect label="Sites" options={sites} selected={siteSel} onChange={setSiteSel} />
      {active > 0 && <button onClick={() => { setYearSel(new Set()); setProdSel(new Set()); setSiteSel(new Set()); }} className="text-xs text-slate-500 hover:text-blue-600 underline">Réinitialiser</button>}
      {reload && <button onClick={reload} className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 border border-slate-300 bg-white rounded-lg text-sm font-medium hover:bg-slate-50"><RefreshCw className="w-4 h-4" /> Rafraîchir</button>}
    </div>
  );
  return { filtered, ui };
}

// ============================================================================
// Onglet DASHBOARD — 4 cartes, 2 graphiques, liste « lots à surveiller »
// ============================================================================
type Tone = 'ok' | 'warn' | 'bad' | 'na';
const TONE: Record<Tone, string> = { ok: 'bg-green-500', warn: 'bg-amber-500', bad: 'bg-red-500', na: 'bg-slate-300' };

function KpiCard({ title, value, sub, tone }: { title: string; value: string; sub: string; tone: Tone }) {
  return (
    <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
      <div className="flex items-center gap-2 mb-1">
        <span className={cn('w-2.5 h-2.5 rounded-full shrink-0', TONE[tone])} />
        <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">{title}</span>
      </div>
      <div className="text-2xl font-bold text-slate-900">{value}</div>
      <div className="text-xs text-slate-500 mt-0.5">{sub}</div>
    </div>
  );
}

function DashboardTab({ lots, prodByCode, reload }: ReturnType<typeof useCockpit>) {
  const { filtered, ui } = useFilters(lots, reload);
  const calcs = filtered.map(l => ({ l, c: lotCalc(l, prodByCode[l.productCode || '']) }));

  // KPI 1 — Marge brute pondérée (Σ profits / Σ CA) : jamais une moyenne de %.
  const withMargin = calcs.filter(x => x.c.profitFr != null && x.c.revenueFr);
  const marginW = withMargin.length ? withMargin.reduce((a, x) => a + x.c.profitFr!, 0) / withMargin.reduce((a, x) => a + x.c.revenueFr!, 0) : null;
  // KPI 2 — Rendement global pondéré (Σ vendus / Σ théoriques).
  const withYield = calcs.filter(x => x.l.unitsTheoretical && x.l.unitsSold);
  const yieldW = withYield.length ? withYield.reduce((a, x) => a + x.l.unitsSold!, 0) / withYield.reduce((a, x) => a + x.l.unitsTheoretical!, 0) : null;
  // KPI 3 — Lead time total médian (début prod → libération Louna).
  const leadMed = median(calcs.map(x => x.c.leadTotal).filter((v): v is number => v != null));
  // KPI 4 — COGS moyen pondéré (Σ coûts / Σ unités vendues) sur la sélection courante (année, produits, sites).
  const withCogs = calcs.filter(x => x.l.unitsSold);
  const cogsAvg = withCogs.length ? withCogs.reduce((a, x) => a + x.c.totalCosts, 0) / withCogs.reduce((a, x) => a + (x.l.unitsSold || 0), 0) : null;
  const withTarget = withCogs.filter(x => prodByCode[x.l.productCode || '']?.cogsTarget != null);
  const targetAvg = withTarget.length ? withTarget.reduce((a, x) => a + (prodByCode[x.l.productCode || ''].cogsTarget || 0) * (x.l.unitsSold || 0), 0) / withTarget.reduce((a, x) => a + (x.l.unitsSold || 0), 0) : null;

  const toneMargin: Tone = marginW == null ? 'na' : marginW >= 0.75 ? 'ok' : marginW >= 0.6 ? 'warn' : 'bad';
  const toneYield: Tone = yieldW == null ? 'na' : yieldW >= 0.95 ? 'ok' : yieldW >= 0.9 ? 'warn' : 'bad';
  const toneLead: Tone = leadMed == null ? 'na' : leadMed <= 65 ? 'ok' : leadMed <= 95 ? 'warn' : 'bad';
  const toneCogs: Tone = (cogsAvg == null || targetAvg == null) ? 'na' : cogsAvg <= targetAvg * 1.05 ? 'ok' : cogsAvg <= targetAvg * 1.15 ? 'warn' : 'bad';

  // Graphique 1 — marge par produit (pondérée volume), barres triées, cible 75 %.
  const byProduct = useMemo(() => {
    const m = new Map<string, { profit: number; rev: number }>();
    for (const x of calcs) {
      if (x.c.profitFr == null || !x.c.revenueFr || !x.l.productCode) continue;
      const g = m.get(x.l.productCode) || { profit: 0, rev: 0 };
      g.profit += x.c.profitFr; g.rev += x.c.revenueFr;
      m.set(x.l.productCode, g);
    }
    return [...m.entries()].map(([code, g]) => ({ code, marge: Math.round(g.profit / g.rev * 100) })).sort((a, b) => b.marge - a.marge);
  }, [calcs]);

  // Graphique 2 — production mensuelle (unités vendues, mois de fin de prod) + taux de rejet.
  const byMonth = useMemo(() => {
    const rows = MOIS.map(mois => ({ mois, unites: 0, rejets: 0, remplis: 0 }));
    for (const x of calcs) {
      if (!x.l.dateProdEnd) continue;
      const m = new Date(x.l.dateProdEnd).getMonth();
      rows[m].unites += x.l.unitsSold || 0;
      rows[m].rejets += x.l.unitsRejected || 0;
      rows[m].remplis += x.l.unitsFilled || 0;
    }
    return rows.map(r => ({ mois: r.mois, 'Unités vendues': r.unites, 'Taux de rejet %': r.remplis ? Math.round(r.rejets / r.remplis * 1000) / 10 : 0 }));
  }, [calcs]);

  // Rendement de production pondéré par année (Σ vendus / Σ théoriques).
  const yieldByYear = useMemo(() => {
    const m = new Map<number, { sold: number; theo: number }>();
    for (const x of calcs) {
      if (!x.l.year || !x.l.unitsTheoretical || !x.l.unitsSold) continue;
      const g = m.get(x.l.year) || { sold: 0, theo: 0 };
      g.sold += x.l.unitsSold; g.theo += x.l.unitsTheoretical; m.set(x.l.year, g);
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([year, g]) => ({ year: String(year), rendement: Math.round(g.sold / g.theo * 100) }));
  }, [calcs]);
  // Évolution du COGS moyen/unité par année et par famille (Flacon / Seringue).
  const cogsByYear = useMemo(() => {
    const m = new Map<number, { v: { c: number; u: number }; s: { c: number; u: number } }>();
    for (const x of calcs) {
      if (!x.l.year || !x.l.unitsSold) continue;
      const g = m.get(x.l.year) || { v: { c: 0, u: 0 }, s: { c: 0, u: 0 } };
      const t = x.l.type === 'syringe' ? g.s : g.v;
      t.c += x.c.totalCosts; t.u += x.l.unitsSold; m.set(x.l.year, g);
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([year, g]) => ({
      year: String(year),
      Flacon: g.v.u ? Math.round(g.v.c / g.v.u * 100) / 100 : null,
      Seringue: g.s.u ? Math.round(g.s.c / g.s.u * 100) / 100 : null,
    }));
  }, [calcs]);

  return (
    <div className="space-y-5">
      {ui}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard title="Marge brute" value={pct(marginW)} sub={`France · sur ${withMargin.length} lot(s)`} tone={toneMargin} />
        <KpiCard title="Rendement global" value={pct(yieldW)} sub={`vendus / théoriques · ${withYield.length} lot(s)`} tone={toneYield} />
        <KpiCard title="Lead time total" value={leadMed == null ? '—' : `${leadMed} j`} sub="médiane prod → libération Louna" tone={toneLead} />
        <KpiCard title="COGS moyen / unité" value={eur2(cogsAvg)} sub={`${withCogs.length} lot(s)${targetAvg != null ? ` · cible ${eur2(targetAvg)}` : ''}`} tone={toneCogs} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
          <div className="font-semibold text-slate-800 text-sm mb-3">Marge brute par produit (%) <span className="text-xs font-normal text-slate-400">· cible 75 %</span></div>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={byProduct} layout="vertical" margin={{ top: 8, right: 24, bottom: 8, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: CHART.tick }} unit=" %" domain={[0, 100]} />
              <YAxis type="category" dataKey="code" tick={{ fontSize: 10, fill: CHART.tick }} width={92} />
              <Tooltip formatter={(v: any) => [`${v} %`, 'Marge']} />
              <ReferenceLine x={75} stroke={CHART.bad} strokeDasharray="4 4" />
              <Bar dataKey="marge" radius={[0, 4, 4, 0]}>
                {byProduct.map((d, i) => <Cell key={i} fill={d.marge >= 75 ? CHART.ok : d.marge >= 60 ? CHART.warn : CHART.bad} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
          <div className="font-semibold text-slate-800 text-sm mb-3">Production mensuelle & taux de rejet <span className="text-xs font-normal text-slate-400">· mois de fin de production</span></div>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={byMonth} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
              <XAxis dataKey="mois" tick={{ fontSize: 11, fill: CHART.tick }} />
              <YAxis yAxisId="u" tick={{ fontSize: 11, fill: CHART.tick }} width={56} />
              <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11, fill: CHART.tick }} unit=" %" width={44} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar yAxisId="u" dataKey="Unités vendues" fill={CHART.primary} radius={[3, 3, 0, 0]} />
              <Line yAxisId="r" dataKey="Taux de rejet %" stroke={CHART.bad} strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
          <div className="font-semibold text-slate-800 text-sm mb-3">Rendement de production par année (%) <span className="text-xs font-normal text-slate-400">· vendus / théoriques · cible 95 %</span></div>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={yieldByYear} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
              <XAxis dataKey="year" tick={{ fontSize: 11, fill: CHART.tick }} />
              <YAxis tick={{ fontSize: 11, fill: CHART.tick }} unit=" %" width={44} domain={[0, 100]} />
              <Tooltip formatter={(v: any) => [`${v} %`, 'Rendement']} />
              <ReferenceLine y={95} stroke={CHART.ok} strokeDasharray="4 4" />
              <Bar dataKey="rendement" radius={[3, 3, 0, 0]}>
                {yieldByYear.map((d, i) => <Cell key={i} fill={d.rendement >= 95 ? CHART.ok : d.rendement >= 90 ? CHART.warn : CHART.bad} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
          <div className="font-semibold text-slate-800 text-sm mb-3">Évolution du COGS moyen / unité <span className="text-xs font-normal text-slate-400">· par famille (Flacon / Seringue) & année</span></div>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={cogsByYear} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
              <XAxis dataKey="year" tick={{ fontSize: 11, fill: CHART.tick }} />
              <YAxis tick={{ fontSize: 11, fill: CHART.tick }} unit=" €" width={52} />
              <Tooltip formatter={(v: any) => v == null ? '—' : `${v} €`} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line dataKey="Flacon" stroke={CHART.primary} strokeWidth={2} connectNulls dot={{ r: 3 }} />
              <Line dataKey="Seringue" stroke="#7c3aed" strokeWidth={2} connectNulls dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls = status === 'LIBERE' ? 'bg-green-100 text-green-700' : status === 'BLOQUE' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700';
  const label = status === 'LIBERE' ? 'Libéré' : status === 'BLOQUE' ? 'Bloqué' : 'En cours';
  return <span className={cn('inline-block px-2 py-0.5 rounded-full text-[10px] font-medium', cls)}>{label}</span>;
}

// ============================================================================
// Onglet COGS — saisie par lot + référentiel produits
// ============================================================================
type SortDir = 'asc' | 'desc';

function CogsTab({ products, lots, api, prodByCode, reload }: ReturnType<typeof useCockpit>) {
  const { canEdit } = useAuth();
  const { filtered, ui } = useFilters(lots, reload);
  const [draft, setDraft] = useState<any>(null);
  const [showProducts, setShowProducts] = useState(false);
  const [sort, setSort] = useState<{ k: string; dir: SortDir } | null>({ k: 'batchNumber', dir: 'desc' });

  const rows = useMemo(() => filtered.map(l => ({ l, c: lotCalc(l, prodByCode[l.productCode || '']) })), [filtered, prodByCode]);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const s = sort.dir === 'asc' ? 1 : -1;
    const get = (x: { l: Lot; c: ReturnType<typeof lotCalc> }): any => {
      switch (sort.k) {
        case 'batchNumber': return x.l.batchNumber; case 'productCode': return x.l.productCode; case 'year': return x.l.year;
        case 'unitsSold': return x.l.unitsSold; case 'yield': return x.c.yieldGlobal; case 'reject': return x.c.rejectRate;
        case 'cogsUnit': return x.c.cogsUnit; case 'cogsBox': return x.c.cogsBox; case 'margin': return x.c.marginCh; case 'profit': return x.c.profitCh;
        default: return null;
      }
    };
    return [...rows].sort((a, b) => {
      const va = get(a), vb = get(b);
      if (va == null && vb == null) return 0; if (va == null) return 1; if (vb == null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * s;
      return String(va).localeCompare(String(vb), 'fr', { numeric: true }) * s;
    });
  }, [rows, sort]);
  const toggleSort = (k: string) => setSort(s => (s && s.k === k ? { k, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { k, dir: 'asc' }));

  const HEADERS: { k: string; label: string; align?: string }[] = [
    { k: 'batchNumber', label: 'Lot' }, { k: 'productCode', label: 'Produit' }, { k: 'year', label: 'Année' },
    { k: 'unitsSold', label: 'Vendus', align: 'text-right' }, { k: 'yield', label: 'Rendement', align: 'text-right' },
    { k: 'reject', label: 'Rejets', align: 'text-right' }, { k: 'cogsUnit', label: 'COGS/u', align: 'text-right' },
    { k: 'cogsBox', label: 'COGS/boîte', align: 'text-right' }, { k: 'margin', label: 'Marge CH', align: 'text-right' },
    { k: 'profit', label: 'Profit CH', align: 'text-right' },
  ];

  const newLot = () => setDraft({ type: 'vial', status: 'EN_COURS', costs: {}, year: new Date().getFullYear(), site: 'Bio-Steril' });
  const editLot = (l: Lot) => setDraft({ ...l, costs: { ...(l.costs || {}) } });
  const delLot = (l: Lot) => { if (confirm(`Supprimer le lot ${l.batchNumber} ?`)) api('DELETE', `/api/cockpit/lots/${l.id}`); };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {ui}
        <div className="ml-auto flex items-center gap-2">
          {canEdit && <button onClick={() => setShowProducts(s => !s)} className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-slate-300 bg-white rounded-lg text-sm font-medium hover:bg-slate-50"><Settings2 className="w-4 h-4" /> Produits & prix</button>}
          {canEdit && <button onClick={newLot} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"><Plus className="w-4 h-4" /> Lot</button>}
        </div>
      </div>

      {showProducts && <ProductsPanel products={products} api={api} canEdit={canEdit} />}

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="bg-slate-100 text-left text-[10px] uppercase text-slate-500">
            {HEADERS.map(h => (
              <th key={h.k} className={cn('px-3 py-2 select-none', h.align)}>
                <button onClick={() => toggleSort(h.k)} className={cn('inline-flex items-center gap-1 uppercase hover:text-slate-700', h.align === 'text-right' && 'flex-row-reverse')}>
                  {h.label}
                  {sort?.k === h.k ? (sort.dir === 'asc' ? <ChevronUp className="w-3 h-3 text-blue-600" /> : <ChevronDown className="w-3 h-3 text-blue-600" />) : <ChevronsUpDown className="w-3 h-3 text-slate-300" />}
                </button>
              </th>
            ))}
            <th className="px-3 py-2 text-[10px] uppercase">Statut</th>
            {canEdit && <th className="px-2 py-2" />}
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {sorted.map(({ l, c }) => {
              const p = prodByCode[l.productCode || ''];
              const overTarget = c.cogsUnit != null && p?.cogsTarget != null && c.cogsUnit > p.cogsTarget * 1.05;
              return (
                <tr key={l.id} className="hover:bg-slate-50">
                  <td className="px-3 py-1.5">
                    <span className="font-mono font-semibold text-blue-700">{l.batchNumber}</span>
                    <span className={cn('ml-1.5 inline-block px-1.5 py-0.5 rounded text-[9px] font-medium', l.type === 'vial' ? 'bg-sky-100 text-sky-700' : 'bg-violet-100 text-violet-700')}>{l.type === 'vial' ? 'Flacon' : 'Seringue'}</span>
                  </td>
                  <td className="px-3 py-1.5 text-slate-700" title={p?.name || ''}>{l.productCode || '—'}</td>
                  <td className="px-3 py-1.5 text-slate-600">{l.year || '—'}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">{l.unitsSold != null ? l.unitsSold.toLocaleString('fr-FR') : '—'}</td>
                  <td className={cn('px-3 py-1.5 text-right tabular-nums', c.yieldGlobal == null ? 'text-slate-400' : c.yieldGlobal >= 0.95 ? 'text-green-600' : c.yieldGlobal >= 0.9 ? 'text-amber-600' : 'text-red-600')}>{pct(c.yieldGlobal)}</td>
                  <td className={cn('px-3 py-1.5 text-right tabular-nums', c.rejectRate == null ? 'text-slate-400' : c.rejectRate <= 0.03 ? 'text-green-600' : c.rejectRate <= 0.07 ? 'text-amber-600' : 'text-red-600')}>{c.rejectRate == null ? '—' : (Math.round(c.rejectRate * 1000) / 10) + ' %'}</td>
                  <td className={cn('px-3 py-1.5 text-right tabular-nums font-medium', overTarget ? 'text-red-600' : 'text-slate-800')} title={p?.cogsTarget != null ? `Cible : ${eur2(p.cogsTarget)}` : ''}>{eur2(c.cogsUnit)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">{eur2(c.cogsBox)}</td>
                  <td className={cn('px-3 py-1.5 text-right tabular-nums font-semibold', c.marginCh == null ? 'text-slate-400' : c.marginCh >= 0.75 ? 'text-green-600' : c.marginCh >= 0.6 ? 'text-amber-600' : 'text-red-600')}>{pct(c.marginCh)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">{eur(c.profitCh)}</td>
                  <td className="px-3 py-1.5"><StatusBadge status={l.status} /></td>
                  {canEdit && (
                    <td className="px-2 py-1.5 text-right whitespace-nowrap">
                      <button onClick={() => editLot(l)} className="p-1 text-slate-400 hover:text-blue-600"><Pencil className="w-3.5 h-3.5" /></button>
                      <button onClick={() => delLot(l)} className="p-1 text-slate-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
                    </td>
                  )}
                </tr>
              );
            })}
            {sorted.length === 0 && <tr><td colSpan={HEADERS.length + 2} className="px-4 py-10 text-center text-slate-400">Aucun lot.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-400">COGS/u = coûts totaux ÷ unités vendues · Marge CH = (prix boîte Suisse − COGS/boîte) ÷ prix boîte Suisse · rouge = COGS &gt; cible +5 % ou marge &lt; 60 %.</p>

      {draft && <LotModal draft={draft} setDraft={setDraft} products={products} api={api} onClose={() => setDraft(null)} />}
    </div>
  );
}

// Formulaire de lot (création / édition) — inputs inline (pas de sous-composant → pas de perte de focus).
function LotModal({ draft, setDraft, products, api, onClose }: { draft: any; setDraft: (d: any) => void; products: Product[]; api: any; onClose: () => void }) {
  const set = (k: string, v: any) => setDraft({ ...draft, [k]: v });
  const setCost = (k: string, v: string) => setDraft({ ...draft, costs: { ...(draft.costs || {}), [k]: v === '' ? 0 : Number(v) } });
  const p = products.find(x => x.code === draft.productCode);
  const preview = lotCalc(draft as Lot, p);
  const inp = 'mt-1 w-full text-sm border border-slate-300 rounded-md px-2 py-1.5 outline-none focus:border-blue-500';
  const lbl = 'text-xs font-medium text-slate-500';
  const num = (v: any) => v === '' || v == null ? null : Number(v);

  const save = async () => {
    if (!draft.batchNumber) return alert('Numéro de lot requis.');
    const payload = {
      batchNumber: draft.batchNumber, productCode: draft.productCode || null, type: draft.type || 'vial',
      year: num(draft.year), site: draft.site || null,
      dateProdStart: draft.dateProdStart || null, dateProdEnd: draft.dateProdEnd || null, datePlannedEnd: draft.datePlannedEnd || null,
      dateReleaseCmo: draft.dateReleaseCmo || null, dateReleaseLouna: draft.dateReleaseLouna || null,
      unitsTheoretical: num(draft.unitsTheoretical), unitsFilled: num(draft.unitsFilled), unitsConform: num(draft.unitsConform),
      unitsRejected: num(draft.unitsRejected) ?? 0, unitsSold: num(draft.unitsSold),
      costs: draft.costs || {}, status: draft.status || 'EN_COURS', comment: draft.comment || null,
    };
    const ok = draft.id ? await api('PATCH', `/api/cockpit/lots/${draft.id}`, payload) : await api('POST', '/api/cockpit/lots', payload);
    if (ok) onClose();
  };

  const d = (v: string | null) => v ? String(v).slice(0, 10) : '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 sticky top-0 bg-white">
          <h4 className="font-semibold text-slate-800">{draft.id ? `Modifier le lot ${draft.batchNumber}` : 'Nouveau lot'}</h4>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-5">
          <div>
            <div className="text-[11px] font-bold text-blue-700 uppercase mb-2">1 · Identité</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <label className="block"><span className={lbl}>N° de lot *</span><input value={draft.batchNumber ?? ''} onChange={e => set('batchNumber', e.target.value)} className={cn(inp, 'font-mono')} /></label>
              <label className="block"><span className={lbl}>Type</span>
                <select value={draft.type ?? 'vial'} onChange={e => set('type', e.target.value)} className={inp}>
                  <option value="vial">Flacon</option><option value="syringe">Seringue</option>
                </select></label>
              <label className="block"><span className={lbl}>Produit</span>
                <select value={draft.productCode ?? ''} onChange={e => set('productCode', e.target.value)} className={inp}>
                  <option value="">—</option>
                  {products.filter(x => x.type === (draft.type || 'vial')).map(x => <option key={x.code} value={x.code}>{x.code}</option>)}
                </select></label>
              <label className="block"><span className={lbl}>Année</span><input type="number" value={draft.year ?? ''} onChange={e => set('year', e.target.value)} className={inp} /></label>
            </div>
          </div>
          <div>
            <div className="text-[11px] font-bold text-blue-700 uppercase mb-2">2 · Dates</div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <label className="block"><span className={lbl}>Début prod</span><input type="date" value={d(draft.dateProdStart)} onChange={e => set('dateProdStart', e.target.value)} className={inp} /></label>
              <label className="block"><span className={lbl}>Fin prod réelle</span><input type="date" value={d(draft.dateProdEnd)} onChange={e => set('dateProdEnd', e.target.value)} className={inp} /></label>
              <label className="block"><span className={lbl}>Fin prévue</span><input type="date" value={d(draft.datePlannedEnd)} onChange={e => set('datePlannedEnd', e.target.value)} className={inp} /></label>
              <label className="block"><span className={lbl}>Libération CMO</span><input type="date" value={d(draft.dateReleaseCmo)} onChange={e => set('dateReleaseCmo', e.target.value)} className={inp} /></label>
              <label className="block"><span className={lbl}>Libération Louna</span><input type="date" value={d(draft.dateReleaseLouna)} onChange={e => set('dateReleaseLouna', e.target.value)} className={inp} /></label>
            </div>
          </div>
          <div>
            <div className="text-[11px] font-bold text-blue-700 uppercase mb-2">3 · Quantités (unités)</div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <label className="block"><span className={lbl}>Théoriques</span><input type="number" value={draft.unitsTheoretical ?? ''} onChange={e => set('unitsTheoretical', e.target.value)} className={inp} /></label>
              <label className="block"><span className={lbl}>Remplies</span><input type="number" value={draft.unitsFilled ?? ''} onChange={e => set('unitsFilled', e.target.value)} className={inp} /></label>
              <label className="block"><span className={lbl}>Conformes</span><input type="number" value={draft.unitsConform ?? ''} onChange={e => set('unitsConform', e.target.value)} className={inp} /></label>
              <label className="block"><span className={lbl}>Rejetées</span><input type="number" value={draft.unitsRejected ?? ''} onChange={e => set('unitsRejected', e.target.value)} className={inp} /></label>
              <label className="block"><span className={lbl}>Vendues</span><input type="number" value={draft.unitsSold ?? ''} onChange={e => set('unitsSold', e.target.value)} className={inp} /></label>
            </div>
          </div>
          <div>
            <div className="text-[11px] font-bold text-blue-700 uppercase mb-2">4 · Coûts du lot (€)</div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {COST_KEYS.map(ck => (
                <label key={ck.k} className="block"><span className={lbl}>{ck.label}</span>
                  <input type="number" step="0.01" value={draft.costs?.[ck.k] ?? ''} onChange={e => setCost(ck.k, e.target.value)} className={inp} /></label>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="block"><span className={lbl}>Statut</span>
              <select value={draft.status ?? 'EN_COURS'} onChange={e => set('status', e.target.value)} className={inp}>
                <option value="EN_COURS">En cours</option><option value="LIBERE">Libéré</option><option value="BLOQUE">Bloqué</option>
              </select></label>
            <label className="block md:col-span-2"><span className={lbl}>Commentaire</span><input value={draft.comment ?? ''} onChange={e => set('comment', e.target.value)} className={inp} /></label>
          </div>
          {/* Aperçu calculé en direct */}
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
            <div><div className="text-[10px] uppercase text-slate-400">COGS / unité</div><div className="font-bold text-slate-800">{eur2(preview.cogsUnit)}</div></div>
            <div><div className="text-[10px] uppercase text-slate-400">COGS / boîte ({preview.upb}u)</div><div className="font-bold text-slate-800">{eur2(preview.cogsBox)}</div></div>
            <div><div className="text-[10px] uppercase text-slate-400">Marge Suisse</div><div className={cn('font-bold', preview.marginCh == null ? 'text-slate-400' : preview.marginCh >= 0.75 ? 'text-green-600' : preview.marginCh >= 0.6 ? 'text-amber-600' : 'text-red-600')}>{pct(preview.marginCh)}</div></div>
            <div><div className="text-[10px] uppercase text-slate-400">Rendement</div><div className="font-bold text-slate-800">{pct(preview.yieldGlobal)}</div></div>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-100 sticky bottom-0 bg-white">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg">Annuler</button>
          <button onClick={save} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700">Enregistrer</button>
        </div>
      </div>
    </div>
  );
}

// Référentiel produits (prix, cibles) — éditable en ligne.
function ProductsPanel({ products, api, canEdit }: { products: Product[]; api: any; canEdit: boolean }) {
  const inp = 'w-full bg-transparent border border-transparent hover:border-slate-200 focus:border-blue-400 rounded px-1.5 py-1 outline-none text-xs';
  const patch = (id: number, k: string, v: any) => api('PATCH', `/api/cockpit/products/${id}`, { [k]: v });
  const add = () => { const code = prompt('Code du nouveau produit (ex. DB-ILA-C) :'); if (code && code.trim()) api('POST', '/api/cockpit/products', { code: code.trim() }); };
  const del = (p: Product) => { if (confirm(`Supprimer le produit ${p.code} ?`)) api('DELETE', `/api/cockpit/products/${p.id}`); };
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100">
        <div className="font-semibold text-slate-800 text-sm">Produits & prix <span className="text-xs font-normal text-slate-400">· prix par boîte, COGS cible par unité</span></div>
        {canEdit && <button onClick={add} className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1"><Plus className="w-3 h-3" /> Produit</button>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="bg-slate-50 text-left text-[10px] uppercase text-slate-500">
            <th className="px-3 py-2">Code</th><th className="px-3 py-2">Nom</th><th className="px-3 py-2">Type</th><th className="px-3 py-2 text-right">U./boîte</th><th className="px-3 py-2 text-right">COGS cible (€/u)</th><th className="px-3 py-2 text-right">Prix FR (€/boîte)</th><th className="px-3 py-2 text-right">Prix CH (€/boîte)</th>{canEdit && <th />}
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {products.map(p => (
              <tr key={p.id} className="hover:bg-slate-50">
                <td className="px-2 py-1 font-mono text-[11px] text-slate-700">{p.code}</td>
                <td className="px-2 py-1"><input defaultValue={p.name ?? ''} disabled={!canEdit} onBlur={e => e.target.value !== (p.name ?? '') && patch(p.id, 'name', e.target.value)} className={inp} /></td>
                <td className="px-2 py-1">
                  <select value={p.type} disabled={!canEdit} onChange={e => patch(p.id, 'type', e.target.value)} className="bg-transparent text-xs outline-none">
                    <option value="vial">Flacon</option><option value="syringe">Seringue</option>
                  </select>
                </td>
                <td className="px-2 py-1"><input type="number" defaultValue={p.unitsPerBox} disabled={!canEdit} onBlur={e => Number(e.target.value) !== p.unitsPerBox && patch(p.id, 'unitsPerBox', Number(e.target.value) || 1)} className={cn(inp, 'text-right w-16')} /></td>
                <td className="px-2 py-1"><input type="number" step="0.01" defaultValue={p.cogsTarget ?? ''} disabled={!canEdit} onBlur={e => Number(e.target.value) !== (p.cogsTarget ?? 0) && patch(p.id, 'cogsTarget', e.target.value === '' ? null : Number(e.target.value))} className={cn(inp, 'text-right w-20')} /></td>
                <td className="px-2 py-1"><input type="number" step="0.01" defaultValue={p.priceFr ?? ''} disabled={!canEdit} onBlur={e => Number(e.target.value) !== (p.priceFr ?? 0) && patch(p.id, 'priceFr', e.target.value === '' ? null : Number(e.target.value))} className={cn(inp, 'text-right w-20')} /></td>
                <td className="px-2 py-1"><input type="number" step="0.01" defaultValue={p.priceCh ?? ''} disabled={!canEdit} onBlur={e => Number(e.target.value) !== (p.priceCh ?? 0) && patch(p.id, 'priceCh', e.target.value === '' ? null : Number(e.target.value))} className={cn(inp, 'text-right w-20')} /></td>
                {canEdit && <td className="px-2 py-1 text-right"><button onClick={() => del(p)} className="p-1 text-slate-300 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
