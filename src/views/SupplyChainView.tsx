import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../AuthContext';
import { cn } from '../utils/cn';
import { Loader2, RefreshCw, ExternalLink, PackageSearch, FileText, Upload, X, Lock, Unlock, Plus, Trash2, Copy } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from 'recharts';
import { MultiSelect } from '../components/MultiSelect';
import { useSort, SortTh } from '../utils/useSort';

const CHART = { grid: '#e2e8f0', tick: '#64748b' };

// En-tête de colonne triable : clic = croissant, re-clic = décroissant.
function Th({ label, k, sortKey, sortDir, onSort, right }: {
  label: string; k: string; sortKey: string; sortDir: 'asc' | 'desc';
  onSort: (k: string) => void; right?: boolean;
}) {
  const active = sortKey === k;
  return (
    <th className={cn('px-4 py-2', right && 'text-right')}>
      <button onClick={() => onSort(k)}
        className={cn('inline-flex items-center gap-1 uppercase hover:text-slate-700', active && 'text-blue-600')}>
        {label}<span className="text-[9px] leading-none">{active ? (sortDir === 'asc' ? '▲' : '▼') : '△'}</span>
      </button>
    </th>
  );
}
// Tranches d'échéance pour le graphe « arrivées prévues ».
const ARRIVAL_BUCKETS = [
  { label: 'En retard', test: (d: number) => d < 0, color: '#dc2626' },
  { label: '≤ 1 sem', test: (d: number) => d >= 0 && d <= 7, color: '#f59e0b' },
  { label: '1–2 sem', test: (d: number) => d > 7 && d <= 14, color: '#60a5fa' },
  { label: '2 sem–1 mois', test: (d: number) => d > 14 && d <= 30, color: '#3b82f6' },
  { label: '1–3 mois', test: (d: number) => d > 30 && d <= 90, color: '#2563eb' },
  { label: '> 3 mois', test: (d: number) => d > 90, color: '#94a3b8' },
];

const API_URL = import.meta.env.VITE_API_URL || '';
const fmt = (n: number) => (n || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 });

type Po = { id: number; name: string; partner: string; items: string[]; dateOrder: string | null; datePlanned: string | null; amount: number; receipt: string };

// Supply chain : bons d'achat Louna Aesthetics en cours de réception, pilotés par date planifiée.
export function SupplyChainView() {
  const { token } = useAuth();

  const [tab, setTab] = useState<'reception' | 'stock' | 'valo'>('reception');
  const [po, setPo] = useState<Po[] | null>(null);
  const [poBase, setPoBase] = useState('');
  const [poLoading, setPoLoading] = useState(false);
  const [horizon, setHorizon] = useState<'all' | 'late' | '7' | '14' | '30' | '90'>('all');
  const [receiptF, setReceiptF] = useState<'all' | 'pending' | 'partial'>('all');
  const [sortKey, setSortKey] = useState('datePlanned');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const onSort = (k: string) => {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir('asc'); }
  };

  const loadPo = useCallback(async () => {
    setPoLoading(true);
    try {
      const r = await fetch(`${API_URL}/api/odoo/purchase-orders`, { headers: { Authorization: `Bearer ${token}` } });
      const d = r.ok ? await r.json() : { orders: [] };
      setPo(Array.isArray(d.orders) ? d.orders : []);
      setPoBase(d.base || '');
    } catch { setPo([]); } finally { setPoLoading(false); }
  }, [token]);
  useEffect(() => { loadPo(); }, [loadPo]);

  // Jours restants avant la date planifiée (négatif = en retard).
  const daysTo = (d: string | null) => d ? Math.ceil((new Date(d + 'T12:00:00').getTime() - Date.now()) / 86400000) : null;
  const poFiltered = (po || []).filter(p => {
    if (receiptF === 'pending' && p.receipt === 'partial') return false;
    if (receiptF === 'partial' && p.receipt !== 'partial') return false;
    if (horizon === 'all') return true;
    const dd = daysTo(p.datePlanned);
    if (dd === null) return false;
    if (horizon === 'late') return dd < 0;
    // les retards restent visibles dans les horizons courts (ce sont les plus urgents à relancer)
    return dd <= parseInt(horizon, 10);
  });
  const poKpis = {
    pending: (po || []).filter(p => p.receipt !== 'partial').length,
    partial: (po || []).filter(p => p.receipt === 'partial').length,
    late: (po || []).filter(p => { const dd = daysTo(p.datePlanned); return dd !== null && dd < 0; }).length,
  };
  const plannedCls = (d: string | null) => {
    const dd = daysTo(d);
    if (dd === null) return 'text-slate-400';
    return dd < 0 ? 'text-red-600 font-semibold' : dd <= 7 ? 'text-amber-600 font-semibold' : 'text-slate-700';
  };
  const plannedLabel = (d: string | null) => {
    const dd = daysTo(d);
    if (dd === null) return '';
    return dd < 0 ? ` (retard ${-dd} j)` : dd === 0 ? " (aujourd'hui)" : ` (dans ${dd} j)`;
  };

  // Tri du tableau (les graphes restent sur l'ensemble).
  const poSorted = [...poFiltered].sort((a, b) => {
    const val = (p: Po): string | number =>
      sortKey === 'name' ? p.name
      : sortKey === 'partner' ? p.partner
      : sortKey === 'items' ? (p.items[0] || '')
      : sortKey === 'dateOrder' ? (p.dateOrder || '')
      : sortKey === 'receipt' ? p.receipt
      : sortKey === 'amount' ? p.amount
      : (p.datePlanned || '9999');
    const va = val(a), vb = val(b);
    const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'fr', { numeric: true });
    return sortDir === 'asc' ? c : -c;
  });

  // Reporting : rapport HTML imprimable (→ PDF) pour suivre et piloter les relances fournisseurs.
  const generateReport = () => {
    if (!po) return;
    const today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const rowsHtml = (list: Po[]) => list.map(p => `<tr>
      <td><b>${esc(p.name)}</b></td><td>${esc(p.partner)}</td>
      <td>${(p.items || []).map(esc).join('<br/>') || '—'}</td>
      <td>${esc(p.datePlanned || '—')}${(() => { const dd = daysTo(p.datePlanned); return dd === null ? '' : dd < 0 ? ` <span class="late">(retard ${-dd} j)</span>` : ` (dans ${dd} j)`; })()}</td>
      <td>${p.receipt === 'partial' ? 'Partielle' : 'En attente'}</td>
      <td style="text-align:right">${fmt(p.amount)} €</td>
    </tr>`).join('');
    const late = po.filter(p => { const dd = daysTo(p.datePlanned); return dd !== null && dd < 0; });
    const soon = po.filter(p => { const dd = daysTo(p.datePlanned); return dd !== null && dd >= 0 && dd <= 14; });
    const later = po.filter(p => { const dd = daysTo(p.datePlanned); return dd === null || dd > 14; });
    const table = (title: string, list: Po[], cls = '') => list.length ? `
      <h2 class="${cls}">${title} · ${list.length}</h2>
      <table><thead><tr><th>N° commande</th><th>Fournisseur</th><th>Articles</th><th>Date prévue</th><th>Réception</th><th style="text-align:right">Montant</th></tr></thead>
      <tbody>${rowsHtml(list)}</tbody></table>` : '';
    const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Reporting Supply Chain — ${today}</title>
      <style>
        body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;margin:32px;font-size:13px}
        h1{font-size:20px;margin:0 0 2px} .sub{color:#64748b;margin-bottom:20px}
        .kpis{display:flex;gap:16px;margin:16px 0 24px} .kpi{border:1px solid #e2e8f0;border-radius:10px;padding:10px 16px}
        .kpi b{font-size:20px;display:block} .red b{color:#dc2626} .amber b{color:#d97706} .blue b{color:#2563eb}
        h2{font-size:14px;margin:22px 0 8px;border-bottom:2px solid #e2e8f0;padding-bottom:4px} h2.late{color:#dc2626;border-color:#fecaca}
        table{width:100%;border-collapse:collapse;font-size:12px} th{text-align:left;background:#f8fafc;color:#64748b;text-transform:uppercase;font-size:10px}
        th,td{padding:6px 8px;border-bottom:1px solid #f1f5f9;vertical-align:top} .late{color:#dc2626;font-weight:600}
        .foot{margin-top:28px;color:#94a3b8;font-size:11px}
        @media print {.noprint{display:none}}
      </style></head><body>
      <button class="noprint" onclick="window.print()" style="float:right;padding:8px 14px;border-radius:8px;border:1px solid #cbd5e1;background:#fff;cursor:pointer">🖨 Imprimer / PDF</button>
      <h1>Reporting Supply Chain — Réceptions fournisseurs</h1>
      <div class="sub">Louna Aesthetics · ${today} · bons d'achat confirmés non totalement reçus (Odoo temps réel)</div>
      <div class="kpis">
        <div class="kpi amber"><b>${poKpis.pending}</b>En attente de réception</div>
        <div class="kpi blue"><b>${poKpis.partial}</b>Partiellement reçues</div>
        <div class="kpi"><b>${po.length}</b>Total en cours</div>
        <div class="kpi red"><b>${poKpis.late}</b>En retard (à relancer)</div>
      </div>
      ${table('🔴 À relancer — date prévue dépassée', late, 'late')}
      ${table('🟠 Arrivées sous 2 semaines', soon)}
      ${table('Au-delà de 2 semaines', later)}
      <h2>Top fournisseurs (€ en attente)</h2>
      <table><thead><tr><th>Fournisseur</th><th style="text-align:right">Montant en attente</th></tr></thead>
      <tbody>${chartSuppliers.map(s => `<tr><td>${esc(s.partner)}</td><td style="text-align:right">${fmt(s.amount)} €</td></tr>`).join('')}</tbody></table>
      <div class="foot">Généré automatiquement depuis LounaFlow · onglet Supply chain</div>
      </body></html>`;
    const w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); }
  };

  // Graphes (sur l'ensemble des commandes en cours, indépendants des filtres).
  const chartArrivals = ARRIVAL_BUCKETS.map(b => {
    const rows = (po || []).filter(p => { const dd = daysTo(p.datePlanned); return dd !== null && b.test(dd); });
    return { label: b.label, count: rows.length, amount: Math.round(rows.reduce((s, p) => s + p.amount, 0)), color: b.color };
  });
  const chartSuppliers = (() => {
    const acc: { [k: string]: number } = {};
    (po || []).forEach(p => { acc[p.partner] = (acc[p.partner] || 0) + p.amount; });
    return Object.entries(acc)
      .map(([partner, amount]) => ({ partner: partner.length > 20 ? partner.slice(0, 19) + '…' : partner, amount: Math.round(amount) }))
      .sort((a, b) => b.amount - a.amount).slice(0, 8);
  })();

  return (
    <div className="p-4 sm:p-6 lg:p-8 flex-1 overflow-auto bg-slate-50 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-blue-600 text-white flex items-center justify-center"><PackageSearch className="w-6 h-6" /></div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Supply chain</h1>
            <p className="text-sm text-slate-500">{tab === 'reception' ? "Bons d'achat Louna Aesthetics · temps réel Odoo · confirmés non reçus"
              : tab === 'stock' ? 'État de stock Bio-Steril · instantané mensuel importé depuis Excel'
                : 'Valorisation du stock · Bio-Steril + stocks saisis à la main, au prix du catalogue'}</p>
          </div>
        </div>
        <div className={cn('flex items-center gap-2', tab !== 'reception' && 'hidden')}>
          <button onClick={generateReport} disabled={!po}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
            <FileText className="w-4 h-4" /> Reporting
          </button>
          <button onClick={loadPo} className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100">
            <RefreshCw className={cn('w-4 h-4', poLoading && 'animate-spin')} /> Rafraîchir
          </button>
        </div>
      </div>

      {/* Sous-onglets : réceptions fournisseurs (Odoo) / état de stock Bio-Steril (Excel mensuel) / valorisation */}
      <div className="flex gap-1 border-b border-slate-200">
        {([['reception', 'Réceptions fournisseurs'], ['stock', 'État de stock Bio-Steril'], ['valo', 'Valorisation du stock']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={cn('px-4 py-2 text-sm font-medium border-b-2 -mb-px', tab === k ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700')}>{l}</button>
        ))}
      </div>

      {tab === 'stock' && <StockBiosterile />}
      {tab === 'valo' && <StockValorisation />}

      {tab === 'reception' && <>
      {/* Mini-dashboard : chaque carte est cliquable et filtre le tableau (re-clic = désactive) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <button onClick={() => { setReceiptF(f => f === 'pending' ? 'all' : 'pending'); }}
          className={cn('bg-white rounded-xl border p-4 text-left transition-shadow hover:shadow-md',
            receiptF === 'pending' ? 'border-amber-400 ring-2 ring-amber-200' : 'border-slate-200')}>
          <div className="text-xs text-slate-500">En attente de réception</div>
          <div className="text-2xl font-bold text-amber-600">{po ? poKpis.pending : '—'}</div>
        </button>
        <button onClick={() => { setReceiptF(f => f === 'partial' ? 'all' : 'partial'); }}
          className={cn('bg-white rounded-xl border p-4 text-left transition-shadow hover:shadow-md',
            receiptF === 'partial' ? 'border-blue-400 ring-2 ring-blue-200' : 'border-slate-200')}>
          <div className="text-xs text-slate-500">Partiellement reçues</div>
          <div className="text-2xl font-bold text-blue-600">{po ? poKpis.partial : '—'}</div>
        </button>
        <button onClick={() => { setReceiptF('all'); setHorizon('all'); }}
          className={cn('bg-white rounded-xl border p-4 text-left transition-shadow hover:shadow-md',
            receiptF === 'all' && horizon === 'all' ? 'border-slate-400 ring-2 ring-slate-200' : 'border-slate-200')}>
          <div className="text-xs text-slate-500">Total en cours</div>
          <div className="text-2xl font-bold text-slate-800">{po ? po.length : '—'}</div>
        </button>
        <button onClick={() => { setHorizon(h => h === 'late' ? 'all' : 'late'); setReceiptF('all'); }}
          className={cn('bg-white rounded-xl border p-4 text-left transition-shadow hover:shadow-md',
            horizon === 'late' ? 'border-red-400 ring-2 ring-red-200' : 'border-red-100')}>
          <div className="text-xs text-red-500">En retard (à relancer)</div>
          <div className="text-2xl font-bold text-red-600">{po ? poKpis.late : '—'}</div>
        </button>
      </div>

      {/* Graphes de pilotage */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Arrivées prévues par échéance <span className="font-normal text-xs text-slate-400">(nb de commandes)</span></h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartArrivals} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: CHART.tick }} interval={0} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: CHART.tick }} width={32} />
              <Tooltip formatter={(v: any, _n: any, p: any) => [`${v} commande(s) · ${fmt(p?.payload?.amount || 0)} €`, 'À recevoir']} />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {chartArrivals.map((b, i) => <Cell key={i} fill={b.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Top fournisseurs à relancer <span className="font-normal text-xs text-slate-400">(€ en attente de réception)</span></h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartSuppliers} layout="vertical" margin={{ top: 8, right: 24, bottom: 8, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: CHART.tick }} tickFormatter={(v: any) => `${fmt(v / 1000)} k€`} />
              <YAxis type="category" dataKey="partner" tick={{ fontSize: 10, fill: CHART.tick }} width={140} />
              <Tooltip formatter={(v: any) => [`${fmt(v)} €`, 'En attente']} />
              <Bar dataKey="amount" fill="#2563eb" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Filtres d'horizon sur la date planifiée */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-slate-500 mr-1">Arrivées prévues :</span>
        {([['all', 'Toutes'], ['late', '🔴 En retard'], ['7', '≤ 1 semaine'], ['14', '≤ 2 semaines'], ['30', '≤ 1 mois'], ['90', '≤ 3 mois']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setHorizon(k)}
            className={cn('px-3 py-1 rounded-full text-xs font-medium border transition-colors',
              horizon === k ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100')}>
            {label}
          </button>
        ))}
        <span className="text-xs text-slate-400 ml-1">{poFiltered.length} commande(s)</span>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-left text-[11px] uppercase text-slate-500">
              <Th label="N° commande" k="name" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <Th label="Fournisseur" k="partner" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <Th label="Articles commandés" k="items" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <Th label="Commandée le" k="dateOrder" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <Th label="Date prévue" k="datePlanned" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <Th label="Réception" k="receipt" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <Th label="Montant" k="amount" sortKey={sortKey} sortDir={sortDir} onSort={onSort} right />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {poLoading && !po && <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-400"><Loader2 className="w-4 h-4 animate-spin inline mr-1" /> Chargement…</td></tr>}
            {po && poSorted.map(p => (
              <tr key={p.id} className="hover:bg-slate-50">
                <td className="px-4 py-2">
                  {/^https?:/.test(poBase) ? (
                    <a href={`${poBase}/odoo/purchase/${p.id}`} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-blue-600 hover:underline">
                      {p.name}<ExternalLink className="w-3 h-3" />
                    </a>
                  ) : (
                    <span className="font-mono text-xs font-semibold text-slate-700">{p.name}</span>
                  )}
                </td>
                <td className="px-4 py-2 text-slate-800">{p.partner}</td>
                <td className="px-4 py-2 text-xs text-slate-600 max-w-[280px]" title={(p.items || []).join('\n')}>
                  {(p.items || []).length === 0 ? '—' : (
                    <>
                      <div className="truncate">{p.items[0]}</div>
                      {p.items.length > 1 && <div className="truncate">{p.items[1]}</div>}
                      {p.items.length > 2 && <div className="text-slate-400">+ {p.items.length - 2} autre(s)…</div>}
                    </>
                  )}
                </td>
                <td className="px-4 py-2 text-slate-500 text-xs tabular-nums">{p.dateOrder || '—'}</td>
                <td className={cn('px-4 py-2 tabular-nums', plannedCls(p.datePlanned))}>{p.datePlanned || '—'}<span className="text-[11px]">{plannedLabel(p.datePlanned)}</span></td>
                <td className="px-4 py-2">
                  <span className={cn('text-[11px] px-2 py-0.5 rounded-full border', p.receipt === 'partial' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-amber-50 text-amber-700 border-amber-200')}>
                    {p.receipt === 'partial' ? 'Partielle' : 'En attente'}
                  </span>
                </td>
                <td className="px-4 py-2 text-right font-medium text-slate-700 tabular-nums">{fmt(p.amount)} €</td>
              </tr>
            ))}
            {po && poFiltered.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-400">Aucune commande sur cette sélection.</td></tr>}
          </tbody>
        </table>
      </div>
      </>}
    </div>
  );
}

// État de stock Bio-Steril : import mensuel du fichier Excel SUIVI_STOCK, recherche et historique par article.
type StockRow = { emplacement: string; articleId: string; typeArticle: string; designation: string; fournisseur: string; refFournisseur: string; lot: string; quantite: number; unite: string; statut: string; datePr: string | null; dateReception: string | null };
type Periode = { periode: string; fichier: string; lignes: number; importedAt: string };

function StockBiosterile() {
  const { token, canEdit } = useAuth();
  const [rows, setRows] = useState<StockRow[]>([]);
  const [periodes, setPeriodes] = useState<Periode[]>([]);
  const [periode, setPeriode] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; s: string } | null>(null);
  const [q, setQ] = useState('');
  const [typeSel, setTypeSel] = useState<Set<string>>(new Set());
  const [statutSel, setStatutSel] = useState<Set<string>>(new Set());
  const [fourSel, setFourSel] = useState<Set<string>>(new Set());
  const [showZero, setShowZero] = useState(false);
  const [mode, setMode] = useState<'article' | 'lignes'>('article');
  const [sel, setSel] = useState<string | null>(null);
  const [hist, setHist] = useState<{ periode: string; total: number }[] | null>(null);

  const load = useCallback(async (p?: string) => {
    if (!token) return;
    setLoading(true);
    try {
      const r = await fetch(`${API_URL}/api/stock-biosterile${p ? `?periode=${encodeURIComponent(p)}` : ''}`, { headers: { Authorization: `Bearer ${token}` } });
      const d = r.ok ? await r.json() : { periodes: [], periode: '', rows: [] };
      setPeriodes(d.periodes || []); setPeriode(d.periode || ''); setRows(d.rows || []);
    } finally { setLoading(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  // Historique de l'article sélectionné (courbe d'évolution mois par mois).
  useEffect(() => {
    if (!sel || !token) { setHist(null); return; }
    let ok = true;
    fetch(`${API_URL}/api/stock-biosterile/historique?article=${encodeURIComponent(sel)}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : { points: [] }).then(d => { if (ok) setHist(d.points || []); }).catch(() => { if (ok) setHist([]); });
    return () => { ok = false; };
  }, [sel, token]);

  const onFile = async (f: File | null) => {
    if (!f || !token) return;
    setBusy(true); setMsg(null);
    try {
      const data: string = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = rej; fr.readAsDataURL(f); });
      const r = await fetch(`${API_URL}/api/stock-biosterile/import`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ filename: f.name, data }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setMsg({ t: 'err', s: d.error || 'Import impossible.' });
      else { setMsg({ t: 'ok', s: `Stock de ${d.periode} importé · ${fmt(d.lignes)} lignes.${d.datesIgnorees ? ` ⚠ ${d.datesIgnorees} date(s) illisible(s) dans le fichier, laissée(s) vide(s).` : ''}` }); await load(d.periode); }
    } catch { setMsg({ t: 'err', s: 'Fichier illisible.' }); } finally { setBusy(false); }
  };

  const typeOpts = React.useMemo(() => [...new Set(rows.map(r => r.typeArticle).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr')), [rows]);
  const statutOpts = React.useMemo(() => [...new Set(rows.map(r => r.statut).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr')), [rows]);
  const fourOpts = React.useMemo(() => [...new Set(rows.map(r => r.fournisseur).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr')), [rows]);

  const filtered = React.useMemo(() => rows.filter(r => {
    if (!showZero && !r.quantite) return false;
    if (typeSel.size && !typeSel.has(r.typeArticle)) return false;
    if (statutSel.size && !statutSel.has(r.statut)) return false;
    if (fourSel.size && !fourSel.has(r.fournisseur)) return false;
    if (!q) return true;
    const s = q.toLowerCase();
    return [r.articleId, r.designation, r.lot, r.fournisseur, r.refFournisseur, r.emplacement, r.typeArticle].some(v => String(v || '').toLowerCase().includes(s));
  }), [rows, q, typeSel, statutSel, fourSel, showZero]);

  // Agrégat par article : on ADDITIONNE chaque ligne (2 emplacements = 2 stocks réels).
  const parArticle = React.useMemo(() => {
    const m = new Map<string, { articleId: string; designation: string; typeArticle: string; total: number; unites: Set<string>; lots: Set<string>; emplacements: Set<string>; alerte: boolean }>();
    for (const r of filtered) {
      let g = m.get(r.articleId);
      if (!g) { g = { articleId: r.articleId, designation: r.designation, typeArticle: r.typeArticle, total: 0, unites: new Set(), lots: new Set(), emplacements: new Set(), alerte: false }; m.set(r.articleId, g); }
      g.total += r.quantite;
      if (r.unite) g.unites.add(r.unite);
      if (r.lot) g.lots.add(r.lot);
      if (r.emplacement) g.emplacements.add(r.emplacement);
      if (r.statut && r.statut.toUpperCase() !== 'LIBERE') g.alerte = true;
      if (!g.designation && r.designation) g.designation = r.designation;
    }
    return [...m.values()].sort((a, b) => a.articleId.localeCompare(b.articleId, 'fr', { numeric: true }));
  }, [filtered]);

  const nonLibere = filtered.filter(r => r.statut && r.statut.toUpperCase() !== 'LIBERE').length;
  const detail = sel ? filtered.filter(r => r.articleId === sel) : [];
  const selInfo = parArticle.find(a => a.articleId === sel);
  const stCls = (s: string) => { const u = (s || '').toUpperCase(); return u === 'LIBERE' ? 'bg-green-100 text-green-700' : u.includes('QUARANT') ? 'bg-amber-100 text-amber-700' : u.includes('NON') ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'; };
  const moisLabel = (p: string) => { const [y, m] = (p || '').split('-'); const noms = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']; return m ? `${noms[Number(m) - 1] || m} ${y}` : p; };

  return (
    <div className="space-y-4">
      {/* Barre : import du fichier du mois + choix du mois */}
      <div className="flex flex-wrap items-center gap-2 bg-white border border-slate-200 rounded-xl p-3">
        {canEdit && (
          <label className={cn('flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg cursor-pointer', busy ? 'bg-slate-200 text-slate-500' : 'bg-blue-600 text-white hover:bg-blue-700')}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {busy ? 'Analyse en cours…' : 'Charger le fichier du mois'}
            <input type="file" accept=".xlsx,.xls" disabled={busy} className="hidden" onChange={e => { onFile(e.target.files?.[0] || null); e.target.value = ''; }} />
          </label>
        )}
        {periodes.length > 0 && (
          <>
            <span className="text-sm text-slate-500 ml-1">Mois :</span>
            <select value={periode} onChange={e => { setSel(null); load(e.target.value); }} className="text-sm border border-slate-300 rounded-md px-2 py-1.5 outline-none focus:border-blue-500">
              {periodes.map(p => <option key={p.periode} value={p.periode}>{moisLabel(p.periode)}</option>)}
            </select>
            <span className="text-xs text-slate-400">{periodes.length} mois en mémoire</span>
          </>
        )}
        {msg && <span className={cn('text-xs px-2 py-1 rounded-md', msg.t === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700')}>{msg.s}</span>}
      </div>

      {loading ? <div className="p-10 text-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin inline mr-2" /> Chargement…</div>
        : !periodes.length ? (
          <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-slate-500">
            <PackageSearch className="w-8 h-8 mx-auto mb-2 text-slate-300" />
            Aucun stock importé pour l'instant.{canEdit && <> Cliquez sur <b>Charger le fichier du mois</b> et choisissez votre fichier <code>SUIVI_STOCK_AAAA-MM.xlsx</code>.</>}
          </div>
        ) : (
          <>
            {/* Repères du mois affiché */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white rounded-xl border border-slate-200 p-4"><div className="text-xs text-slate-500">Articles</div><div className="text-2xl font-bold text-slate-800">{fmt(parArticle.length)}</div></div>
              <div className="bg-white rounded-xl border border-slate-200 p-4"><div className="text-xs text-slate-500">Lignes de stock</div><div className="text-2xl font-bold text-slate-800">{fmt(filtered.length)}</div></div>
              <div className="bg-white rounded-xl border border-slate-200 p-4"><div className="text-xs text-slate-500">Emplacements</div><div className="text-2xl font-bold text-blue-600">{fmt(new Set(filtered.map(r => r.emplacement).filter(Boolean)).size)}</div></div>
              <div className="bg-white rounded-xl border border-slate-200 p-4"><div className="text-xs text-slate-500">Lignes non libérées</div><div className={cn('text-2xl font-bold', nonLibere ? 'text-amber-600' : 'text-slate-800')}>{fmt(nonLibere)}</div></div>
            </div>

            {/* Recherche + filtres */}
            <div className="flex flex-wrap items-center gap-2">
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Rechercher (article, désignation, lot, fournisseur, emplacement…)" className="text-sm border border-slate-300 rounded-md px-3 py-1.5 outline-none focus:border-blue-500 w-80" />
              <MultiSelect label="Type" options={typeOpts} selected={typeSel} onChange={setTypeSel} width="w-64" />
              <MultiSelect label="Statut" options={statutOpts} selected={statutSel} onChange={setStatutSel} width="w-56" />
              <MultiSelect label="Fournisseur" options={fourOpts} selected={fourSel} onChange={setFourSel} width="w-64" />
              <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer"><input type="checkbox" checked={showZero} onChange={e => setShowZero(e.target.checked)} /> Afficher les stocks à 0</label>
              {(q || typeSel.size || statutSel.size || fourSel.size) && <button onClick={() => { setQ(''); setTypeSel(new Set()); setStatutSel(new Set()); setFourSel(new Set()); }} className="text-xs text-slate-500 hover:text-blue-600 underline">Réinitialiser</button>}
              <div className="ml-auto flex rounded-lg border border-slate-200 overflow-hidden">
                {([['article', 'Par article'], ['lignes', 'Détail par lot']] as const).map(([k, l]) => (
                  <button key={k} onClick={() => setMode(k)} className={cn('px-3 py-1.5 text-xs font-medium', mode === k ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50')}>{l}</button>
                ))}
              </div>
            </div>

            {/* Fiche article : évolution mois par mois + ses lots */}
            {sel && (
              <div className="bg-white border border-blue-200 rounded-xl p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-slate-800">{sel} · {selInfo?.designation || '—'}</div>
                    <div className="text-xs text-slate-500">{selInfo ? `${fmt(selInfo.total)} ${[...selInfo.unites].join(' / ') || ''} · ${selInfo.lots.size} lot(s) · ${selInfo.emplacements.size} emplacement(s)` : ''}</div>
                  </div>
                  <button onClick={() => setSel(null)} className="text-slate-400 hover:text-slate-700"><X className="w-4 h-4" /></button>
                </div>
                {hist === null ? <div className="text-xs text-slate-400">Chargement de l'historique…</div>
                  : hist.length < 2 ? <div className="text-xs text-slate-400">Historique disponible à partir de 2 mois importés (actuellement {hist.length}).</div>
                    : (
                      <ResponsiveContainer width="100%" height={180}>
                        <LineChart data={hist.map(p => ({ mois: moisLabel(p.periode), Quantité: p.total }))} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
                          <XAxis dataKey="mois" tick={{ fontSize: 10, fill: CHART.tick }} />
                          <YAxis tick={{ fontSize: 10, fill: CHART.tick }} width={56} tickFormatter={(v: any) => fmt(v)} />
                          <Tooltip formatter={(v: any) => fmt(v)} />
                          <Line dataKey="Quantité" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    )}
                <table className="w-full text-xs">
                  <thead><tr className="bg-slate-50 text-left text-[10px] uppercase text-slate-500"><th className="px-2 py-1.5">Lot</th><th className="px-2 py-1.5">Emplacement</th><th className="px-2 py-1.5 text-right">Quantité</th><th className="px-2 py-1.5">Statut</th><th className="px-2 py-1.5">Péremption</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {detail.map((r, i) => (
                      <tr key={i}><td className="px-2 py-1 font-mono text-[11px] text-slate-600">{r.lot || '—'}</td><td className="px-2 py-1 text-slate-600">{r.emplacement || '—'}</td>
                        <td className="px-2 py-1 text-right tabular-nums font-medium text-slate-800">{fmt(r.quantite)} <span className="text-[10px] font-normal text-slate-400">{r.unite}</span></td>
                        <td className="px-2 py-1"><span className={cn('px-2 py-0.5 rounded-full text-[10px] font-medium', stCls(r.statut))}>{r.statut || '—'}</span></td>
                        <td className="px-2 py-1 text-slate-500">{r.datePr || '—'}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Tableau principal */}
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-x-auto">
              {mode === 'article' ? (
                <table className="w-full text-xs">
                  <thead><tr className="bg-slate-100 text-left text-[10px] uppercase text-slate-500">
                    <th className="px-3 py-2">Article</th><th className="px-3 py-2">Désignation</th><th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2 text-right">Stock total</th><th className="px-3 py-2 text-right">Lots</th><th className="px-3 py-2 text-right">Emplac.</th><th className="px-3 py-2"></th>
                  </tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {parArticle.map(a => (
                      <tr key={a.articleId} onClick={() => setSel(s => s === a.articleId ? null : a.articleId)} className={cn('cursor-pointer hover:bg-blue-50', sel === a.articleId && 'bg-blue-50')}>
                        <td className="px-3 py-1.5 font-mono text-[11px] font-semibold text-blue-700">{a.articleId}</td>
                        <td className="px-3 py-1.5 text-slate-700 max-w-[320px] truncate" title={a.designation}>{a.designation || '—'}</td>
                        <td className="px-3 py-1.5 text-slate-500">{a.typeArticle || '—'}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-slate-800">{fmt(a.total)} <span className="text-[10px] font-normal text-slate-400">{a.unites.size === 1 ? [...a.unites][0] : a.unites.size > 1 ? '⚠ unités mixtes' : ''}</span></td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{a.lots.size}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{a.emplacements.size}</td>
                        <td className="px-3 py-1.5">{a.alerte && <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-700">à vérifier</span>}</td>
                      </tr>
                    ))}
                    {!parArticle.length && <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">Aucun article sur cette sélection.</td></tr>}
                  </tbody>
                </table>
              ) : (
                <table className="w-full text-xs">
                  <thead><tr className="bg-slate-100 text-left text-[10px] uppercase text-slate-500">
                    <th className="px-3 py-2">Article</th><th className="px-3 py-2">Désignation</th><th className="px-3 py-2">Lot</th><th className="px-3 py-2">Emplac.</th>
                    <th className="px-3 py-2 text-right">Quantité</th><th className="px-3 py-2">Fournisseur</th><th className="px-3 py-2">Statut</th><th className="px-3 py-2">Péremption</th>
                  </tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {filtered.map((r, i) => (
                      <tr key={i} className="hover:bg-slate-50">
                        <td className="px-3 py-1.5 font-mono text-[11px] text-slate-600">{r.articleId}</td>
                        <td className="px-3 py-1.5 text-slate-700 max-w-[260px] truncate" title={r.designation}>{r.designation || '—'}</td>
                        <td className="px-3 py-1.5 font-mono text-[11px] text-slate-600">{r.lot || '—'}</td>
                        <td className="px-3 py-1.5 text-slate-500">{r.emplacement || '—'}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums font-medium text-slate-800">{fmt(r.quantite)} <span className="text-[10px] font-normal text-slate-400">{r.unite}</span></td>
                        <td className="px-3 py-1.5 text-slate-600 max-w-[160px] truncate" title={r.fournisseur}>{r.fournisseur || '—'}</td>
                        <td className="px-3 py-1.5"><span className={cn('px-2 py-0.5 rounded-full text-[10px] font-medium', stCls(r.statut))}>{r.statut || '—'}</span></td>
                        <td className="px-3 py-1.5 text-slate-500">{r.datePr || '—'}</td>
                      </tr>
                    ))}
                    {!filtered.length && <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">Aucune ligne sur cette sélection.</td></tr>}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Valorisation du stock : catalogue de prix (Excel « ETAT STOCK » + ajustements),
// stock Bio-Steril du mois complété par des lignes saisies à la main, clôture mensuelle.
// ---------------------------------------------------------------------------

type ValoRow = {
  source: 'biosteril' | 'manuel'; id?: number; site: string; articleId: string; designation: string;
  unite: string; famille: string; quantite: number; cout: number | null; valeur: number; sansPrix: boolean;
  corrige?: boolean; quantiteFichier?: number; uniteFichier?: string;
};
type ManRow = { id: number; site: string; articleId: string; designation: string; quantite: number; unite: string; cout: number | null };
type PrixRow = { articleId: string; libelle: string; unite: string; cout: number; source: string };

const moisLabelValo = (p: string) => {
  const [y, m] = (p || '').split('-');
  const noms = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  return m ? `${noms[Number(m) - 1] || m} ${y}` : p;
};
const eur = (n: number) => `${(n || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €`;

function StockValorisation() {
  const { token, canEdit } = useAuth();
  const [periodes, setPeriodes] = useState<string[]>([]);
  const [periode, setPeriode] = useState('');
  const [rows, setRows] = useState<ValoRow[]>([]);
  const [cloture, setCloture] = useState<{ total: number; par: string; at: string } | null>(null);
  const [prix, setPrix] = useState<PrixRow[]>([]);
  const [manuels, setManuels] = useState<ManRow[]>([]);
  const [hist, setHist] = useState<{ periode: string; total: number; cloture: boolean }[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; s: string } | null>(null);
  const [q, setQ] = useState('');
  const [siteSel, setSiteSel] = useState<Set<string>>(new Set());
  const [famSel, setFamSel] = useState<Set<string>>(new Set());
  const [saisieOuverte, setSaisieOuverte] = useState(false);
  const [siteImport, setSiteImport] = useState('');
  const [edits, setEdits] = useState<{ [k: string]: { quantite?: string; unite?: string } }>({});
  const [prixSaisis, setPrixSaisis] = useState<{ [k: string]: string }>({});
  const [neuf, setNeuf] = useState({ site: '', articleId: '', designation: '', quantite: '', unite: '', cout: '' });

  const fige = !!cloture;

  const load = useCallback(async (p?: string) => {
    if (!token) return;
    setLoading(true);
    try {
      const h = { Authorization: `Bearer ${token}` };
      const r = await fetch(`${API_URL}/api/stock-valorisation${p ? `?periode=${encodeURIComponent(p)}` : ''}`, { headers: h });
      const d = r.ok ? await r.json() : { periodes: [], periode: '', rows: [], cloture: null };
      setPeriodes(d.periodes || []); setPeriode(d.periode || ''); setRows(d.rows || []); setCloture(d.cloture || null);
      const [rp, rm, rh] = await Promise.all([
        fetch(`${API_URL}/api/stock-prix`, { headers: h }),
        d.periode ? fetch(`${API_URL}/api/stock-manuel?periode=${encodeURIComponent(d.periode)}`, { headers: h }) : Promise.resolve(null as any),
        fetch(`${API_URL}/api/stock-valorisation/historique`, { headers: h }),
      ]);
      setPrix(rp?.ok ? await rp.json() : []);
      setManuels(rm?.ok ? await rm.json() : []);
      setHist(rh?.ok ? (await rh.json()).points || [] : []);
    } finally { setLoading(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  // Import du catalogue de prix (fichier « ETAT STOCK »).
  const onCatalogue = async (f: File | null) => {
    if (!f || !token) return;
    setBusy(true); setMsg(null);
    try {
      const data: string = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = rej; fr.readAsDataURL(f); });
      const r = await fetch(`${API_URL}/api/stock-prix/import`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ filename: f.name, data }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setMsg({ t: 'err', s: d.error || 'Import impossible.' });
      else { setMsg({ t: 'ok', s: `Catalogue mis à jour · ${fmt(d.prix)} prix importés.${d.proteges ? ` ${fmt(d.proteges)} prix que vous aviez saisis à la main ont été conservés.` : ''}` }); await load(periode); }
    } catch { setMsg({ t: 'err', s: 'Fichier illisible.' }); } finally { setBusy(false); }
  };

  // Import Excel des stocks saisis à la main (un ou plusieurs sites dans le même fichier).
  const onFichierStocks = async (f: File | null) => {
    if (!f || !token) return;
    setBusy(true); setMsg(null);
    try {
      const data: string = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = rej; fr.readAsDataURL(f); });
      const r = await fetch(`${API_URL}/api/stock-manuel/import`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ filename: f.name, data, periode, site: siteImport.trim() }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setMsg({ t: 'err', s: d.error || 'Import impossible.' });
      else { setMsg({ t: 'ok', s: `${fmt(d.lignes)} ligne(s) chargée(s) pour ${(d.sites || []).join(', ')}.` }); await load(periode); }
    } catch { setMsg({ t: 'err', s: 'Fichier illisible.' }); } finally { setBusy(false); }
  };

  // Modèle Excel vide, aux colonnes attendues par l'import.
  const telechargerModele = async () => {
    const mod: any = await import('xlsx'); const XLSX = mod.default ?? mod;
    const ws = XLSX.utils.aoa_to_sheet([
      ['Site', 'Article', 'Désignation', 'Quantité', 'Unité', 'Prix unitaire (facultatif)'],
      ['Louna', 'AC-002', 'Bouchon élastomère 20 mm', 10000, 'u', ''],
      ['Laboratoire France Cosmétique', 'MP-010', 'Hyaluronate de sodium', 500, 'g', ''],
      ['R&D', '', 'Flacon échantillon 30 ml (hors catalogue)', 120, 'u', 3.2],
    ]);
    ws['!cols'] = [{ wch: 32 }, { wch: 16 }, { wch: 44 }, { wch: 12 }, { wch: 8 }, { wch: 24 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Stocks');
    XLSX.writeFile(wb, `Modele_stocks_${periode || 'mois'}.xlsx`);
  };

  const api = async (url: string, method: string, body?: any) => {
    const r = await fetch(`${API_URL}${url}`, {
      method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setMsg({ t: 'err', s: d.error || 'Opération impossible.' }); return null; }
    return d;
  };

  const enregistrerPrix = async (articleId: string) => {
    const v = prixSaisis[articleId];
    if (v === undefined || v === '') return;
    setBusy(true);
    const r = await api('/api/stock-prix', 'PUT', { articleId, cout: v });
    setBusy(false);
    if (r) { setPrixSaisis(s => { const n = { ...s }; delete n[articleId]; return n; }); await load(periode); }
  };

  const ajouterLigne = async () => {
    if (!neuf.site || (!neuf.articleId && !neuf.designation)) { setMsg({ t: 'err', s: 'Indiquez au moins le site et l’article.' }); return; }
    setBusy(true);
    const r = await api('/api/stock-manuel', 'POST', { ...neuf, periode });
    setBusy(false);
    if (r) { setNeuf({ site: neuf.site, articleId: '', designation: '', quantite: '', unite: '', cout: '' }); await load(periode); }
  };
  const majLigne = async (l: ManRow) => { setBusy(true); const r = await api('/api/stock-manuel', 'POST', { ...l, periode }); setBusy(false); if (r) await load(periode); };

  // Correction de la quantité / unité directement dans le tableau de détail.
  const cleLigne = (r: ValoRow) => (r.source === 'manuel' ? `m${r.id}` : `b${r.articleId}`);
  const majDetail = async (r: ValoRow) => {
    const e = edits[cleLigne(r)];
    if (!e) return;
    const quantite = e.quantite ?? String(r.quantite);
    const unite = e.unite ?? r.unite;
    setBusy(true);
    // Pour une ligne saisie, on renvoie son prix PROPRE (souvent vide = prix du catalogue), pas le prix affiché.
    const propre = manuels.find(m => m.id === r.id);
    const ok = r.source === 'manuel'
      ? await api('/api/stock-manuel', 'POST', { id: r.id, periode, site: r.site, articleId: r.articleId, designation: r.designation, quantite, unite, cout: propre ? propre.cout : null })
      : await api('/api/stock-correction', 'PUT', { periode, articleId: r.articleId, quantite, unite });
    setBusy(false);
    if (ok) { setEdits(s => { const n = { ...s }; delete n[cleLigne(r)]; return n; }); await load(periode); }
  };
  const annulerCorrection = async (r: ValoRow) => {
    setBusy(true);
    const ok = await api(`/api/stock-correction/${encodeURIComponent(periode)}/${encodeURIComponent(r.articleId)}`, 'DELETE');
    setBusy(false);
    if (ok) await load(periode);
  };
  const supprLigne = async (id: number) => { setBusy(true); const r = await api(`/api/stock-manuel/${id}`, 'DELETE'); setBusy(false); if (r) await load(periode); };
  const reprendreMois = async () => {
    const i = periodes.indexOf(periode);
    const precedent = periodes[i + 1]; // periodes est trié du plus récent au plus ancien
    if (!precedent) { setMsg({ t: 'err', s: 'Aucun mois précédent en mémoire.' }); return; }
    setBusy(true);
    const r = await api('/api/stock-manuel/copier', 'POST', { depuis: precedent, vers: periode });
    setBusy(false);
    if (r) { setMsg({ t: 'ok', s: `${fmt(r.lignes)} ligne(s) reprises de ${moisLabelValo(precedent)}.` }); await load(periode); }
  };
  const cloturer = async () => {
    if (!window.confirm(`Clôturer ${moisLabelValo(periode)} ?\n\nLa valorisation et les prix utilisés seront figés : l'historique de ce mois ne bougera plus, même si vous corrigez un prix plus tard.`)) return;
    setBusy(true);
    const r = await api('/api/stock-valorisation/cloturer', 'POST', { periode });
    setBusy(false);
    if (r) { setMsg({ t: 'ok', s: `${moisLabelValo(periode)} clôturé · ${eur(r.total)}.` }); await load(periode); }
  };
  const rouvrir = async () => {
    if (!window.confirm(`Rouvrir ${moisLabelValo(periode)} ? La valorisation redeviendra provisoire et suivra à nouveau les prix du catalogue.`)) return;
    setBusy(true);
    const r = await api(`/api/stock-valorisation/cloture/${encodeURIComponent(periode)}`, 'DELETE');
    setBusy(false);
    if (r) await load(periode);
  };

  const siteOpts = React.useMemo(() => [...new Set<string>(rows.map(r => r.site).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr')), [rows]);
  const famOpts = React.useMemo(() => [...new Set<string>(rows.map(r => r.famille).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr')), [rows]);
  const filtered = React.useMemo(() => rows.filter(r => {
    if (siteSel.size && !siteSel.has(r.site)) return false;
    if (famSel.size && !famSel.has(r.famille)) return false;
    if (!q) return true;
    const s = q.toLowerCase();
    return [r.articleId, r.designation, r.site, r.famille].some(v => String(v || '').toLowerCase().includes(s));
  }), [rows, q, siteSel, famSel]);

  // Tri du tableau de détail : par défaut la plus grosse valeur en premier, chaque colonne cliquable.
  const sort = useSort(filtered, 'valeur', 'desc');

  const total = React.useMemo(() => rows.reduce((a, r) => a + (r.valeur || 0), 0), [rows]);
  const totalFiltre = React.useMemo(() => filtered.reduce((a, r) => a + (r.valeur || 0), 0), [filtered]);
  // Articles en stock sans prix connu : c'est là qu'on demande à l'utilisateur de compléter.
  const manquants = React.useMemo(() => {
    const m = new Map<string, { articleId: string; designation: string; unite: string; quantite: number }>();
    for (const r of rows.filter(x => x.sansPrix && x.quantite)) {
      const k = r.articleId || r.designation;
      const g = m.get(k) || { articleId: r.articleId, designation: r.designation, unite: r.unite, quantite: 0 };
      g.quantite += r.quantite; if (!g.designation) g.designation = r.designation;
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => (a.articleId || '').localeCompare(b.articleId || '', 'fr', { numeric: true }));
  }, [rows]);
  const parGroupe = (cle: 'site' | 'famille') => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r[cle] || '—', (m.get(r[cle] || '—') || 0) + (r.valeur || 0));
    return [...m.entries()].map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v);
  };
  const parSite = React.useMemo(() => parGroupe('site'), [rows]);
  const parFamille = React.useMemo(() => parGroupe('famille'), [rows]);

  const exportPDF = () => {
    const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const today = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
    const bloc = (titre: string, list: { k: string; v: number }[]) => `<h2>${titre}</h2>
      <table><thead><tr><th>${titre.includes('site') ? 'Site' : 'Famille'}</th><th style="text-align:right">Valorisation</th><th style="text-align:right">Part</th></tr></thead>
      <tbody>${list.map(x => `<tr><td>${esc(x.k)}</td><td style="text-align:right">${eur(x.v)}</td><td style="text-align:right">${total ? Math.round(x.v / total * 100) : 0} %</td></tr>`).join('')}
      <tr style="font-weight:bold;background:#f8fafc"><td>Total</td><td style="text-align:right">${eur(total)}</td><td style="text-align:right">100 %</td></tr></tbody></table>`;
    const det = [...rows].sort((a, b) => (b.valeur || 0) - (a.valeur || 0)).map(r => `<tr>
      <td>${esc(r.site)}</td><td>${esc(r.articleId || '—')}</td><td>${esc(r.designation)}</td>
      <td style="text-align:right">${fmt(r.quantite)} ${esc(r.unite)}</td>
      <td style="text-align:right">${r.cout === null ? '<span class=red>prix manquant</span>' : (r.cout).toLocaleString('fr-FR', { maximumFractionDigits: 4 }) + ' €'}</td>
      <td style="text-align:right">${eur(r.valeur)}</td></tr>`).join('');
    const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Valorisation du stock — ${moisLabelValo(periode)}</title>
      <style>
        body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;margin:32px;font-size:13px}
        h1{font-size:20px;margin:0 0 2px} .sub{color:#64748b;margin-bottom:20px}
        .kpis{display:flex;gap:16px;margin:16px 0 24px} .kpi{border:1px solid #e2e8f0;border-radius:10px;padding:10px 16px}
        .kpi b{font-size:20px;display:block} .red{color:#dc2626}
        h2{font-size:14px;margin:22px 0 8px;border-bottom:2px solid #e2e8f0;padding-bottom:4px}
        table{width:100%;border-collapse:collapse;font-size:11px} th{text-align:left;background:#f8fafc;color:#64748b;text-transform:uppercase;font-size:10px}
        th,td{padding:5px 8px;border-bottom:1px solid #f1f5f9}
        .foot{margin-top:28px;color:#94a3b8;font-size:11px}
        @media print {.noprint{display:none}}
      </style></head><body>
      <button class="noprint" onclick="window.print()" style="float:right;padding:8px 14px;border-radius:8px;border:1px solid #cbd5e1;background:#fff;cursor:pointer">🖨 Imprimer / PDF</button>
      <h1>Valorisation du stock — ${moisLabelValo(periode)}</h1>
      <div class="sub">Louna Aesthetics · édité le ${today} · ${fige ? `valorisation clôturée (figée)` : 'valorisation provisoire'}</div>
      <div class="kpis">
        <div class="kpi"><b>${eur(total)}</b>Valorisation totale</div>
        <div class="kpi"><b>${fmt(rows.length)}</b>Lignes de stock</div>
        <div class="kpi"><b class="${manquants.length ? 'red' : ''}">${fmt(manquants.length)}</b>Articles sans prix</div>
      </div>
      ${bloc('Répartition par site', parSite)}
      ${bloc('Répartition par famille', parFamille)}
      <h2>Détail article par article</h2>
      <table><thead><tr><th>Site</th><th>Article</th><th>Désignation</th><th style="text-align:right">Quantité</th><th style="text-align:right">Prix unitaire</th><th style="text-align:right">Valorisation</th></tr></thead>
      <tbody>${det}<tr style="font-weight:bold;background:#f8fafc"><td colspan="5">TOTAL</td><td style="text-align:right">${eur(total)}</td></tr></tbody></table>
      <div class="foot">Généré automatiquement depuis LounaFlow · Supply chain · Valorisation du stock</div>
      </body></html>`;
    const w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); }
  };

  const sites = [...new Set([...manuels.map(m => m.site), 'Bio-Steril', 'Louna', 'Laboratoire France Cosmétique', 'R&D'])].filter(Boolean);

  return (
    <div className="space-y-4">
      {/* Barre : catalogue de prix, mois, clôture, export */}
      <div className="flex flex-wrap items-center gap-2 bg-white border border-slate-200 rounded-xl p-3">
        {canEdit && (
          <label className={cn('flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg cursor-pointer', busy ? 'bg-slate-200 text-slate-500' : 'bg-slate-700 text-white hover:bg-slate-800')}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            Catalogue de prix
            <input type="file" accept=".xlsx,.xls" disabled={busy} className="hidden" onChange={e => { onCatalogue(e.target.files?.[0] || null); e.target.value = ''; }} />
          </label>
        )}
        <span className="text-xs text-slate-400">{fmt(prix.length)} prix en mémoire</span>
        {periodes.length > 0 && (
          <>
            <span className="text-sm text-slate-500 ml-2">Mois :</span>
            <select value={periode} onChange={e => load(e.target.value)} className="text-sm border border-slate-300 rounded-md px-2 py-1.5 outline-none focus:border-blue-500">
              {periodes.map(p => <option key={p} value={p}>{moisLabelValo(p)}</option>)}
            </select>
            {fige
              ? <span className="flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-slate-100 text-slate-600"><Lock className="w-3 h-3" /> Clôturé{cloture?.at ? ` le ${new Date(cloture.at).toLocaleDateString('fr-FR')}` : ''}</span>
              : <span className="text-xs px-2 py-1 rounded-md bg-amber-50 text-amber-700">Provisoire</span>}
            {canEdit && (fige
              ? <button onClick={rouvrir} disabled={busy} className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100"><Unlock className="w-3.5 h-3.5" /> Rouvrir</button>
              : <button onClick={cloturer} disabled={busy} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700"><Lock className="w-3.5 h-3.5" /> Clôturer le mois</button>)}
            <button onClick={exportPDF} className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 ml-auto"><FileText className="w-3.5 h-3.5" /> Export PDF</button>
          </>
        )}
        {msg && <span className={cn('text-xs px-2 py-1 rounded-md w-full', msg.t === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700')}>{msg.s}</span>}
      </div>

      {loading ? <div className="p-10 text-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin inline mr-2" /> Chargement…</div>
        : !periodes.length ? (
          <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-slate-500">
            <PackageSearch className="w-8 h-8 mx-auto mb-2 text-slate-300" />
            Rien à valoriser pour l'instant. Chargez d'abord un état de stock dans l'onglet <b>État de stock Bio-Steril</b>, puis le <b>catalogue de prix</b> ici.
          </div>
        ) : (
          <>
            {/* Repères du mois */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white rounded-xl border border-slate-200 p-4"><div className="text-xs text-slate-500">Valorisation totale</div><div className="text-2xl font-bold text-blue-700">{eur(total)}</div></div>
              <div className="bg-white rounded-xl border border-slate-200 p-4"><div className="text-xs text-slate-500">Lignes valorisées</div><div className="text-2xl font-bold text-slate-800">{fmt(rows.filter(r => !r.sansPrix).length)}</div></div>
              <div className="bg-white rounded-xl border border-slate-200 p-4"><div className="text-xs text-slate-500">Articles sans prix</div><div className={cn('text-2xl font-bold', manquants.length ? 'text-red-600' : 'text-slate-800')}>{fmt(manquants.length)}</div></div>
              <div className="bg-white rounded-xl border border-slate-200 p-4"><div className="text-xs text-slate-500">Saisi à la main</div><div className="text-2xl font-bold text-slate-800">{eur(rows.filter(r => r.source === 'manuel').reduce((a, r) => a + r.valeur, 0))}</div></div>
            </div>

            {/* Prix manquants : l'app pose la question, l'utilisateur répond ici */}
            {!fige && manquants.length > 0 && (
              <div className="bg-white border border-red-200 rounded-xl p-4">
                <div className="text-sm font-semibold text-red-700 mb-1">{manquants.length} article(s) en stock n'ont pas de prix</div>
                <div className="text-xs text-slate-500 mb-3">Renseignez le prix unitaire : il sera mémorisé et réutilisé tous les mois suivants.</div>
                <div className="max-h-72 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="bg-slate-50 text-left text-[10px] uppercase text-slate-500">
                      <th className="px-2 py-1.5">Article</th><th className="px-2 py-1.5">Désignation</th><th className="px-2 py-1.5 text-right">Quantité</th><th className="px-2 py-1.5 w-44">Prix unitaire (€)</th>
                    </tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {manquants.map(a => (
                        <tr key={a.articleId || a.designation}>
                          <td className="px-2 py-1 font-mono text-[11px] font-semibold text-slate-700">{a.articleId || '—'}</td>
                          <td className="px-2 py-1 text-slate-600 max-w-[300px] truncate" title={a.designation}>{a.designation || '—'}</td>
                          <td className="px-2 py-1 text-right tabular-nums text-slate-600">{fmt(a.quantite)} <span className="text-[10px] text-slate-400">{a.unite}</span></td>
                          <td className="px-2 py-1">
                            <div className="flex items-center gap-1">
                              <input value={prixSaisis[a.articleId] ?? ''} disabled={!canEdit}
                                onChange={e => setPrixSaisis(s => ({ ...s, [a.articleId]: e.target.value }))}
                                onKeyDown={e => { if (e.key === 'Enter') enregistrerPrix(a.articleId); }}
                                placeholder="0,00" className="w-24 text-xs border border-slate-300 rounded-md px-2 py-1 outline-none focus:border-blue-500" />
                              <button onClick={() => enregistrerPrix(a.articleId)} disabled={!canEdit || busy || !(prixSaisis[a.articleId] || '').trim()}
                                className="px-2 py-1 text-[11px] rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">OK</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Stocks saisis à la main : Louna, Laboratoire France Cosmétique, R&D… */}
            <div className="bg-white border border-slate-200 rounded-xl">
              <button onClick={() => setSaisieOuverte(o => !o)} className="w-full flex items-center justify-between px-4 py-3 text-left">
                <span className="text-sm font-semibold text-slate-800">Stocks saisis à la main · {manuels.length} ligne(s) · {eur(rows.filter(r => r.source === 'manuel').reduce((a, r) => a + r.valeur, 0))}</span>
                <span className="text-xs text-slate-400">{saisieOuverte ? 'Masquer' : 'Afficher / ajouter'}</span>
              </button>
              {saisieOuverte && (
                <div className="border-t border-slate-100 p-4 space-y-3">
                  {fige && <div className="text-xs text-amber-700 bg-amber-50 rounded-md px-2 py-1.5">Mois clôturé : rouvrez-le pour modifier ces lignes.</div>}
                  {/* Chargement d'un fichier Excel : plus rapide que la saisie ligne à ligne */}
                  {canEdit && !fige && (
                    <div className="flex flex-wrap items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg p-2">
                      <label className={cn('flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg cursor-pointer', busy ? 'bg-slate-200 text-slate-500' : 'bg-blue-600 text-white hover:bg-blue-700')}>
                        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} Charger un Excel
                        <input type="file" accept=".xlsx,.xls" disabled={busy} className="hidden" onChange={e => { onFichierStocks(e.target.files?.[0] || null); e.target.value = ''; }} />
                      </label>
                      <button onClick={telechargerModele} className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-slate-300 text-slate-600 hover:bg-white"><FileText className="w-3.5 h-3.5" /> Modèle Excel</button>
                      <input list="valo-sites" value={siteImport} onChange={e => setSiteImport(e.target.value)} placeholder="Site (si absent du fichier)"
                        className="text-xs border border-slate-300 rounded-md px-2 py-1.5 outline-none focus:border-blue-500 w-64" />
                      <span className="text-[11px] text-slate-400">Recharger un fichier remplace les lignes des sites concernés, sans doublon.</span>
                    </div>
                  )}
                  <datalist id="valo-sites">{sites.map(s => <option key={s} value={s} />)}</datalist>
                  <datalist id="valo-articles">{prix.map(p => <option key={p.articleId} value={p.articleId}>{p.libelle}</option>)}</datalist>
                  <table className="w-full text-xs">
                    <thead><tr className="bg-slate-50 text-left text-[10px] uppercase text-slate-500">
                      <th className="px-2 py-1.5">Site</th><th className="px-2 py-1.5">Article</th><th className="px-2 py-1.5">Désignation</th>
                      <th className="px-2 py-1.5 text-right">Quantité</th><th className="px-2 py-1.5">Unité</th><th className="px-2 py-1.5 text-right">Prix (si hors catalogue)</th><th className="px-2 py-1.5"></th>
                    </tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {manuels.map((l, i) => (
                        <tr key={l.id}>
                          <td className="px-2 py-1"><input list="valo-sites" value={l.site} disabled={!canEdit || fige}
                            onChange={e => setManuels(m => m.map((x, k) => k === i ? { ...x, site: e.target.value } : x))} onBlur={() => majLigne(l)}
                            className="w-36 text-xs border border-slate-200 rounded px-1.5 py-1 outline-none focus:border-blue-500" /></td>
                          <td className="px-2 py-1"><input list="valo-articles" value={l.articleId} disabled={!canEdit || fige}
                            onChange={e => setManuels(m => m.map((x, k) => k === i ? { ...x, articleId: e.target.value } : x))} onBlur={() => majLigne(l)}
                            className="w-32 text-xs font-mono border border-slate-200 rounded px-1.5 py-1 outline-none focus:border-blue-500" /></td>
                          <td className="px-2 py-1"><input value={l.designation} disabled={!canEdit || fige}
                            onChange={e => setManuels(m => m.map((x, k) => k === i ? { ...x, designation: e.target.value } : x))} onBlur={() => majLigne(l)}
                            className="w-full min-w-[160px] text-xs border border-slate-200 rounded px-1.5 py-1 outline-none focus:border-blue-500" /></td>
                          <td className="px-2 py-1"><input value={String(l.quantite)} disabled={!canEdit || fige}
                            onChange={e => setManuels(m => m.map((x, k) => k === i ? { ...x, quantite: e.target.value as any } : x))} onBlur={() => majLigne(l)}
                            className="w-24 text-xs text-right tabular-nums border border-slate-200 rounded px-1.5 py-1 outline-none focus:border-blue-500" /></td>
                          <td className="px-2 py-1"><input value={l.unite} disabled={!canEdit || fige}
                            onChange={e => setManuels(m => m.map((x, k) => k === i ? { ...x, unite: e.target.value } : x))} onBlur={() => majLigne(l)}
                            className="w-16 text-xs border border-slate-200 rounded px-1.5 py-1 outline-none focus:border-blue-500" /></td>
                          <td className="px-2 py-1"><input value={l.cout === null ? '' : String(l.cout)} disabled={!canEdit || fige} placeholder="catalogue"
                            onChange={e => setManuels(m => m.map((x, k) => k === i ? { ...x, cout: (e.target.value === '' ? null : e.target.value) as any } : x))} onBlur={() => majLigne(l)}
                            className="w-24 text-xs text-right tabular-nums border border-slate-200 rounded px-1.5 py-1 outline-none focus:border-blue-500" /></td>
                          <td className="px-2 py-1 text-right">{canEdit && !fige && <button onClick={() => supprLigne(l.id)} className="text-slate-300 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>}</td>
                        </tr>
                      ))}
                      {canEdit && !fige && (
                        <tr className="bg-slate-50/60">
                          <td className="px-2 py-1"><input list="valo-sites" value={neuf.site} onChange={e => setNeuf(n => ({ ...n, site: e.target.value }))} placeholder="Site" className="w-36 text-xs border border-slate-300 rounded px-1.5 py-1 outline-none focus:border-blue-500" /></td>
                          <td className="px-2 py-1"><input list="valo-articles" value={neuf.articleId} onChange={e => setNeuf(n => ({ ...n, articleId: e.target.value }))} placeholder="AC-002" className="w-32 text-xs font-mono border border-slate-300 rounded px-1.5 py-1 outline-none focus:border-blue-500" /></td>
                          <td className="px-2 py-1"><input value={neuf.designation} onChange={e => setNeuf(n => ({ ...n, designation: e.target.value }))} placeholder="Désignation (si article hors catalogue)" className="w-full min-w-[160px] text-xs border border-slate-300 rounded px-1.5 py-1 outline-none focus:border-blue-500" /></td>
                          <td className="px-2 py-1"><input value={neuf.quantite} onChange={e => setNeuf(n => ({ ...n, quantite: e.target.value }))} placeholder="0" className="w-24 text-xs text-right border border-slate-300 rounded px-1.5 py-1 outline-none focus:border-blue-500" /></td>
                          <td className="px-2 py-1"><input value={neuf.unite} onChange={e => setNeuf(n => ({ ...n, unite: e.target.value }))} placeholder="u" className="w-16 text-xs border border-slate-300 rounded px-1.5 py-1 outline-none focus:border-blue-500" /></td>
                          <td className="px-2 py-1"><input value={neuf.cout} onChange={e => setNeuf(n => ({ ...n, cout: e.target.value }))} placeholder="catalogue" className="w-24 text-xs text-right border border-slate-300 rounded px-1.5 py-1 outline-none focus:border-blue-500" /></td>
                          <td className="px-2 py-1 text-right"><button onClick={ajouterLigne} disabled={busy} className="flex items-center gap-1 px-2 py-1 text-[11px] rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"><Plus className="w-3 h-3" /> Ajouter</button></td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                  {canEdit && !fige && !manuels.length && (
                    <button onClick={reprendreMois} disabled={busy} className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100">
                      <Copy className="w-3.5 h-3.5" /> Reprendre les lignes du mois précédent
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Répartitions + évolution */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {([['Répartition par site', parSite], ['Répartition par famille', parFamille]] as const).map(([titre, list]) => (
                <div key={titre} className="bg-white rounded-xl border border-slate-200 p-4">
                  <div className="text-xs font-semibold text-slate-500 uppercase mb-2">{titre}</div>
                  <table className="w-full text-xs">
                    <tbody className="divide-y divide-slate-100">
                      {list.map(x => (
                        <tr key={x.k}>
                          <td className="py-1.5 text-slate-700">{x.k}</td>
                          <td className="py-1.5 text-right tabular-nums font-medium text-slate-800">{eur(x.v)}</td>
                          <td className="py-1.5 text-right tabular-nums text-slate-400 w-12">{total ? Math.round(x.v / total * 100) : 0} %</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="text-xs font-semibold text-slate-500 uppercase mb-2">Évolution mois par mois</div>
                {hist.length < 2 ? <div className="text-xs text-slate-400 py-8 text-center">Disponible à partir de 2 mois (actuellement {hist.length}).</div> : (
                  <ResponsiveContainer width="100%" height={180}>
                    <LineChart data={hist.map(p => ({ mois: moisLabelValo(p.periode), Valorisation: Math.round(p.total) }))} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
                      <XAxis dataKey="mois" tick={{ fontSize: 10, fill: CHART.tick }} />
                      <YAxis tick={{ fontSize: 10, fill: CHART.tick }} width={64} tickFormatter={(v: any) => fmt(v)} />
                      <Tooltip formatter={(v: any) => eur(Number(v))} />
                      <Line dataKey="Valorisation" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Détail article par article */}
            <div className="flex flex-wrap items-center gap-2">
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Rechercher (article, désignation, site…)" className="text-sm border border-slate-300 rounded-md px-3 py-1.5 outline-none focus:border-blue-500 w-80" />
              <MultiSelect label="Site" options={siteOpts} selected={siteSel} onChange={setSiteSel} width="w-64" />
              <MultiSelect label="Famille" options={famOpts} selected={famSel} onChange={setFamSel} width="w-64" />
              {(q || siteSel.size || famSel.size) && <button onClick={() => { setQ(''); setSiteSel(new Set()); setFamSel(new Set()); }} className="text-xs text-slate-500 hover:text-blue-600 underline">Réinitialiser</button>}
              {canEdit && !fige && <span className="text-[11px] text-slate-400">Quantité et unité modifiables directement dans le tableau.</span>}
              <span className="ml-auto text-sm text-slate-600">Sélection : <b className="text-slate-800">{eur(totalFiltre)}</b></span>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="bg-slate-100 text-left text-[10px] uppercase text-slate-500">
                  <SortTh k="site" label="Site" sort={sort} className="px-3 py-2" />
                  <SortTh k="articleId" label="Article" sort={sort} className="px-3 py-2" />
                  <SortTh k="designation" label="Désignation" sort={sort} className="px-3 py-2" />
                  <SortTh k="famille" label="Famille" sort={sort} className="px-3 py-2" />
                  <SortTh k="quantite" label="Quantité" sort={sort} className="px-3 py-2 text-right" align="right" />
                  <SortTh k="cout" label="Prix unitaire" sort={sort} className="px-3 py-2 text-right" align="right" />
                  <SortTh k="valeur" label="Valorisation" sort={sort} className="px-3 py-2 text-right" align="right" />
                </tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {sort.sorted.map((r, i) => {
                    const k = cleLigne(r), e = edits[k], modifiable = canEdit && !fige;
                    return (
                      <tr key={i} className={cn('hover:bg-slate-50', r.sansPrix && 'bg-red-50/40', r.corrige && 'bg-amber-50/60')}>
                        <td className="px-3 py-1.5 text-slate-600">{r.site}{r.source === 'manuel' && <span className="ml-1 text-[10px] text-slate-400">(saisi)</span>}</td>
                        <td className="px-3 py-1.5 font-mono text-[11px] font-semibold text-blue-700">{r.articleId || '—'}</td>
                        <td className="px-3 py-1.5 text-slate-700 max-w-[300px] truncate" title={r.designation}>{r.designation || '—'}</td>
                        <td className="px-3 py-1.5 text-slate-500">
                          {r.famille}
                          {r.corrige && <span title={`Fichier Bio-Steril : ${fmt(r.quantiteFichier || 0)} ${r.uniteFichier || ''}`} className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-700">corrigé</span>}
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          {modifiable ? (
                            <div className="flex items-center justify-end gap-1">
                              <input value={e?.quantite ?? String(r.quantite)}
                                onChange={ev => setEdits(s => ({ ...s, [k]: { ...s[k], quantite: ev.target.value } }))}
                                onBlur={() => majDetail(r)} onKeyDown={ev => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur(); }}
                                title={r.corrige ? `Valeur du fichier : ${fmt(r.quantiteFichier || 0)}` : undefined}
                                className={cn('w-24 text-xs text-right tabular-nums border rounded px-1.5 py-1 outline-none focus:border-blue-500', r.corrige ? 'border-amber-300 bg-amber-50' : 'border-transparent hover:border-slate-300')} />
                              <input value={e?.unite ?? r.unite}
                                onChange={ev => setEdits(s => ({ ...s, [k]: { ...s[k], unite: ev.target.value } }))}
                                onBlur={() => majDetail(r)} onKeyDown={ev => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur(); }}
                                className={cn('w-12 text-xs border rounded px-1 py-1 outline-none focus:border-blue-500', r.corrige ? 'border-amber-300 bg-amber-50' : 'border-transparent hover:border-slate-300')} />
                              {r.corrige && <button onClick={() => annulerCorrection(r)} title="Revenir à la valeur du fichier" className="text-amber-500 hover:text-amber-700"><X className="w-3.5 h-3.5" /></button>}
                            </div>
                          ) : <span className="tabular-nums text-slate-800">{fmt(r.quantite)} <span className="text-[10px] text-slate-400">{r.unite}</span></span>}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{r.cout === null ? <span className="text-red-600">prix manquant</span> : `${r.cout.toLocaleString('fr-FR', { maximumFractionDigits: 4 })} €`}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-slate-800">{eur(r.valeur)}</td>
                      </tr>
                    );
                  })}
                  {!filtered.length && <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">Aucune ligne sur cette sélection.</td></tr>}
                </tbody>
                <tfoot><tr className="bg-slate-100 font-semibold text-slate-800"><td className="px-3 py-2 uppercase text-[10px]" colSpan={6}>Total {moisLabelValo(periode)}</td><td className="px-3 py-2 text-right tabular-nums">{eur(totalFiltre)}</td></tr></tfoot>
              </table>
            </div>
          </>
        )}
    </div>
  );
}
