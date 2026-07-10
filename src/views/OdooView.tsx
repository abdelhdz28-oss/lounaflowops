import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../AuthContext';
import { cn } from '../utils/cn';
import { Search, Loader2, RefreshCw, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { MayaChat } from '../components/MayaChat';

const API_URL = import.meta.env.VITE_API_URL || '';
const fmt = (n: number) => (n || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 });

export function OdooView() {
  const { token } = useAuth();
  const auth = { headers: { Authorization: `Bearer ${token}` } };

  const [q, setQ] = useState('');
  const [rows, setRows] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);

  const [reg, setReg] = useState<any>(null);
  const [aes, setAes] = useState<any>(null);
  const [aesRest, setAesRest] = useState<any>(null);
  const [list, setList] = useState<any[] | null>(null);
  const [invLoading, setInvLoading] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [sort, setSort] = useState<{ f: string; dir: 'asc' | 'desc' }>({ f: 'date', dir: 'desc' });
  const toggleSort = (f: string) => setSort(s => (s.f === f ? { f, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { f, dir: 'asc' }));
  const sortedList = (list || []).slice().sort((a, b) => {
    if (sort.f === 'ttc') return sort.dir === 'asc' ? (a.ttc || 0) - (b.ttc || 0) : (b.ttc || 0) - (a.ttc || 0);
    const av = String(a[sort.f] || '').toLowerCase(), bv = String(b[sort.f] || '').toLowerCase();
    return sort.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
  });
  const SortTh = ({ f, label, align }: { f: string; label: string; align?: string }) => (
    <th className={cn('px-4 py-2', align)}>
      <button onClick={() => toggleSort(f)} className="inline-flex items-center gap-1 uppercase hover:text-slate-700">
        {label}
        {sort.f === f ? (sort.dir === 'asc' ? <ChevronUp className="w-3 h-3 text-blue-600" /> : <ChevronDown className="w-3 h-3 text-blue-600" />) : <ChevronsUpDown className="w-3 h-3 text-slate-300" />}
      </button>
    </th>
  );

  const loadInv = useCallback(async () => {
    setInvLoading(true);
    try {
      const get = (u: string) => fetch(`${API_URL}${u}`, auth).then(r => r.ok ? r.json() : null);
      const [a, b, c, d] = await Promise.all([
        get('/api/odoo/invoices?company=regenerative&since=2026-01-01'),
        get('/api/odoo/invoices?company=regenerative&since=2026-01-01&customer=aesthetics'),
        get('/api/odoo/invoices?company=regenerative&since=2026-01-01&customer=others'),
        get('/api/odoo/invoices-list?company=regenerative&since=2026-01-01&customer=others'),
      ]);
      setReg(a); setAes(b); setAesRest(c); setList(Array.isArray(d) ? d : []);
    } catch { /* ignore */ } finally { setInvLoading(false); }
  }, [token]);
  useEffect(() => { loadInv(); }, [loadInv]);

  const search = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API_URL}/api/odoo/stock?q=${encodeURIComponent(q)}&company=aesthetics`, auth);
      setRows(r.ok ? await r.json() : []);
    } catch { setRows([]); } finally { setLoading(false); }
  };

  // Péremptions : historique complet des lots (MP/AC), y compris consommés.
  const [expQ, setExpQ] = useState('');
  const [expType, setExpType] = useState<'all' | 'MP' | 'AC'>('all');
  const [expRows, setExpRows] = useState<any[] | null>(null);
  const [expLoading, setExpLoading] = useState(false);
  const searchExp = async (typeOverride?: 'all' | 'MP' | 'AC') => {
    setExpLoading(true);
    try {
      const t = typeOverride ?? expType;
      const r = await fetch(`${API_URL}/api/odoo/lot-expirations?q=${encodeURIComponent(expQ)}&type=${t}`, auth);
      const d = r.ok ? await r.json() : { lots: [] };
      setExpRows(Array.isArray(d.lots) ? d.lots : []);
    } catch { setExpRows([]); } finally { setExpLoading(false); }
  };
  // Couleur de la date d'expiration : rouge = dépassée, ambre = < 90 jours, vert = OK.
  const expCls = (dateStr: string | null) => {
    if (!dateStr) return 'text-slate-400';
    const days = (new Date(dateStr).getTime() - Date.now()) / 86400000;
    return days < 0 ? 'text-red-600 font-semibold' : days < 90 ? 'text-amber-600 font-semibold' : 'text-green-700';
  };

  const Card = ({ title, data, accent }: { title: string; data: any; accent?: string }) => (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{title}</div>
      {data ? (
        <>
          <div className={cn('text-2xl font-bold mt-1', accent || 'text-slate-900')}>{fmt(data.totalTTC)} €</div>
          <div className="text-xs text-slate-500">{data.count} factures (TTC) · HT {fmt(data.totalHT)} €</div>
        </>
      ) : <div className="text-slate-400 text-sm mt-2">{invLoading ? 'Chargement…' : '—'}</div>}
    </div>
  );

  return (
    <div className="p-8 flex-1 overflow-auto bg-slate-50 space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-800">Factures clients</h3>
        <button onClick={loadInv} title="Rafraîchir" className="text-slate-400 hover:text-blue-600"><RefreshCw className={cn('w-4 h-4', invLoading && 'animate-spin')} /></button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card title="Louna Regenerative · 2026 (total)" data={reg} accent="text-blue-700" />
        <Card title="dont → Louna Aesthetics (intercompagnie)" data={aes} accent="text-violet-700" />
        <Card title="dont → autres clients (Dermacity, etc.)" data={aesRest} accent="text-green-700" />
      </div>

      {/* Détail factures Louna Aesthetics */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <button onClick={() => setDetailOpen(o => !o)} className={cn('w-full flex items-center justify-between p-4 hover:bg-slate-50 transition-colors', detailOpen && 'border-b border-slate-100')}>
          <span className="font-semibold text-slate-800">Détail des factures · Louna Regenerative 2026 {list && <span className="text-xs font-normal text-slate-400">· {list.length} factures</span>}</span>
          {detailOpen ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
        </button>
        {detailOpen && (
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-left text-[11px] uppercase text-slate-500">
              <SortTh f="name" label="N° facture" />
              <SortTh f="date" label="Date" />
              <SortTh f="partner" label="Client" />
              <th className="px-4 py-2">Lot(s)</th>
              <SortTh f="ttc" label="Montant TTC" align="text-right" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list === null && <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400"><Loader2 className="w-4 h-4 animate-spin inline mr-1" /> Chargement…</td></tr>}
            {list && sortedList.map((r, i) => (
              <tr key={i} className="hover:bg-slate-50">
                <td className="px-4 py-2 font-mono text-xs text-slate-600">{r.name}</td>
                <td className="px-4 py-2 text-slate-600">{r.date}</td>
                <td className="px-4 py-2 text-slate-800">{r.partner}</td>
                <td className="px-4 py-2 font-mono text-xs text-slate-600">{r.lots && r.lots.length ? r.lots.join(', ') : '—'}</td>
                <td className="px-4 py-2 text-right font-semibold text-slate-800">{fmt(r.ttc)} €</td>
              </tr>
            ))}
            {list && list.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">Aucune facture.</td></tr>}
          </tbody>
        </table>
        )}
      </div>

      {/* Recherche stock */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center gap-2">
          <span className="font-semibold text-slate-800">Stock Louna Aesthetics</span>
          <span className="text-xs text-slate-400">temps réel Odoo</span>
        </div>
        <div className="p-4 flex gap-2">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && search()}
              placeholder="Réf article (ex. DB-IHA) ou nom du produit…"
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-md outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500" />
          </div>
          <button onClick={search} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700">Rechercher</button>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-left text-[11px] uppercase text-slate-500">
              <th className="px-4 py-2">Réf</th><th className="px-4 py-2">Produit</th>
              <th className="px-4 py-2 text-right">Stock physique</th>
              <th className="px-4 py-2 text-right">Stock réservé</th>
              <th className="px-4 py-2 text-right">Stock restant virtuel</th>
              <th className="px-4 py-2">Unité</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400"><Loader2 className="w-4 h-4 animate-spin inline mr-1" /> Recherche…</td></tr>}
            {!loading && rows && rows.map((r, i) => (
              <tr key={i} className="hover:bg-slate-50">
                <td className="px-4 py-2 font-mono text-xs text-slate-600">{r.ref || '—'}</td>
                <td className="px-4 py-2 text-slate-800">{r.name}</td>
                <td className="px-4 py-2 text-right font-medium text-slate-700 tabular-nums">{fmt(r.physique)}</td>
                <td className={cn('px-4 py-2 text-right tabular-nums', r.reserve > 0 ? 'text-amber-600' : 'text-slate-400')}>{fmt(r.reserve)}</td>
                <td className={cn('px-4 py-2 text-right font-semibold tabular-nums', r.restant > 0 ? 'text-green-600' : r.restant < 0 ? 'text-red-600' : 'text-slate-400')}>{fmt(r.restant)}</td>
                <td className="px-4 py-2 text-xs text-slate-500">{r.uom}</td>
              </tr>
            ))}
            {!loading && rows && rows.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">Aucun résultat.</td></tr>}
            {!loading && !rows && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-300">Tape une réf ou un nom de produit, puis « Rechercher ».</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Péremptions : date d'expiration par lot (historique complet, MP/AC, consommés inclus) */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center gap-2">
          <span className="font-semibold text-slate-800">Péremptions · lots MP / AC</span>
          <span className="text-xs text-slate-400">historique complet Odoo (consommés inclus)</span>
        </div>
        <div className="p-4 flex gap-2 flex-wrap items-center">
          <div className="relative flex-1 max-w-md min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input value={expQ} onChange={e => setExpQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && searchExp()}
              placeholder="N° de lot, réf interne (MP-, AC-) ou désignation…"
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-md outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500" />
          </div>
          <select value={expType} onChange={e => { const t = e.target.value as 'all' | 'MP' | 'AC'; setExpType(t); if (expRows !== null) searchExp(t); }}
            className="text-sm border border-slate-300 rounded-md px-3 py-2 bg-white">
            <option value="all">MP + AC + autres</option>
            <option value="MP">Matières premières (MP-)</option>
            <option value="AC">Conditionnement (AC-/PAC-)</option>
          </select>
          <button onClick={() => searchExp()} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700">Rechercher</button>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-left text-[11px] uppercase text-slate-500">
              <th className="px-4 py-2">N° de lot</th>
              <th className="px-4 py-2">Réf</th>
              <th className="px-4 py-2">Désignation</th>
              <th className="px-4 py-2">Expiration</th>
              <th className="px-4 py-2 text-right">Qté restante</th>
              <th className="px-4 py-2">Créé le</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {expLoading && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400"><Loader2 className="w-4 h-4 animate-spin inline mr-1" /> Recherche…</td></tr>}
            {!expLoading && expRows && expRows.map((r, i) => (
              <tr key={i} className="hover:bg-slate-50">
                <td className="px-4 py-2 font-mono text-xs text-slate-700">{r.lot}</td>
                <td className="px-4 py-2 font-mono text-xs text-slate-600">{r.ref || '—'}</td>
                <td className="px-4 py-2 text-slate-800">{r.name}</td>
                <td className={cn('px-4 py-2 tabular-nums', expCls(r.expiration))}>{r.expiration || '—'}</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {r.qty > 0 ? <span className="font-medium text-slate-700">{fmt(r.qty)}</span> : <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">Consommé</span>}
                </td>
                <td className="px-4 py-2 text-xs text-slate-500">{r.created || '—'}</td>
              </tr>
            ))}
            {!expLoading && expRows && expRows.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">Aucun lot trouvé.</td></tr>}
            {!expLoading && !expRows && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-300">Tape un n° de lot, une réf ou une désignation, puis « Rechercher » (vide = tout l'historique).</td></tr>}
          </tbody>
        </table>
      </div>

      <MayaChat />
    </div>
  );
}
