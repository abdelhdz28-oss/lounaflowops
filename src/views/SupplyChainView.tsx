import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../AuthContext';
import { cn } from '../utils/cn';
import { Loader2, RefreshCw, ExternalLink, PackageSearch, FileText } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from 'recharts';

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
    <div className="p-8 flex-1 overflow-auto bg-slate-50 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-blue-600 text-white flex items-center justify-center"><PackageSearch className="w-6 h-6" /></div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Supply chain · réceptions fournisseurs</h1>
            <p className="text-sm text-slate-500">Bons d'achat Louna Aesthetics · temps réel Odoo · confirmés non reçus</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={generateReport} disabled={!po}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
            <FileText className="w-4 h-4" /> Reporting
          </button>
          <button onClick={loadPo} className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100">
            <RefreshCw className={cn('w-4 h-4', poLoading && 'animate-spin')} /> Rafraîchir
          </button>
        </div>
      </div>

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
    </div>
  );
}
