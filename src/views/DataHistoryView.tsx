import React, { useState } from 'react';
import { ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { useAppContext } from '../AppContext';

interface DataHistoryViewProps {
  onOpenBatch: (id: string) => void;
}

const EMPTY_FILTERS = { lot: '', produit: '', leadtime: '', repartis: '', conforme: '', rejet: '', yield: '' };
type SortKey = keyof typeof EMPTY_FILTERS;

export function DataHistoryView({ onOpenBatch }: DataHistoryViewProps) {
  const { batches, fluxConfig } = useAppContext();
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS });
  const [sortField, setSortField] = useState<SortKey>('lot');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const setF = (k: keyof typeof EMPTY_FILTERS, v: string) => setFilters(f => ({ ...f, [k]: v }));
  const inc = (val: unknown, q: string) => String(val ?? '').toLowerCase().includes(q.toLowerCase());
  const toggleSort = (k: SortKey) => {
    if (k === sortField) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortField(k); setSortDir('asc'); }
  };

  const rows = batches.map((b) => {
    const rejection = b.distributed > 0 ? ((b.distributed - b.conform) / b.distributed) * 100 : 0;
    const yieldVal = b.distributed > 0 ? (b.conform / b.distributed) * 100 : 0;
    const leadtime = Object.values(fluxConfig[b.fluxKey]?.durations || {}).reduce((a: number, v: number) => a + v, 0);
    return { b, rejection, yieldVal, leadtime };
  });

  const filtered = rows.filter(({ b, rejection, yieldVal, leadtime }) =>
    inc(b.id, filters.lot) &&
    (inc(b.product, filters.produit) || inc(b.reference, filters.produit)) &&
    inc(leadtime, filters.leadtime) &&
    inc(b.distributed, filters.repartis) &&
    inc(b.conform, filters.conforme) &&
    inc(rejection.toFixed(1), filters.rejet) &&
    inc(yieldVal.toFixed(1), filters.yield)
  );

  const sortValOf = (r: typeof rows[number]): string | number => {
    switch (sortField) {
      case 'lot': return r.b.id.toLowerCase();
      case 'produit': return (r.b.product || '').toLowerCase();
      case 'leadtime': return r.leadtime;
      case 'repartis': return r.b.distributed;
      case 'conforme': return r.b.conform;
      case 'rejet': return r.rejection;
      case 'yield': return r.yieldVal;
    }
  };
  const sorted = [...filtered].sort((a, b) => {
    const av = sortValOf(a), bv = sortValOf(b);
    const cmp = (typeof av === 'number' && typeof bv === 'number') ? av - bv : String(av).localeCompare(String(bv));
    return cmp * (sortDir === 'asc' ? 1 : -1);
  });

  const sortTh = (k: SortKey, label: string) => (
    <th className="py-3 px-4">
      <button onClick={() => toggleSort(k)} className="flex items-center gap-1 text-xs font-semibold text-slate-500 uppercase tracking-wider hover:text-slate-700">
        {label}
        {sortField === k
          ? (sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)
          : <ArrowUpDown className="w-3 h-3 opacity-30" />}
      </button>
    </th>
  );

  const filterInput = (k: keyof typeof EMPTY_FILTERS) => (
    <input
      value={filters[k]}
      onChange={e => setF(k, e.target.value)}
      placeholder="Filtrer..."
      onClick={e => e.stopPropagation()}
      className="w-full px-2 py-1 text-xs font-normal normal-case border border-slate-300 rounded focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
    />
  );

  return (
    <div className="p-8 flex-1 overflow-y-auto bg-slate-50">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-slate-800">Data Historique</h3>
        <span className="text-sm text-slate-400">{filtered.length} / {rows.length} lots</span>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              {sortTh('lot', 'Lot')}
              {sortTh('produit', 'Produit (Réf)')}
              {sortTh('leadtime', 'Leadtime')}
              {sortTh('repartis', 'Répartis')}
              {sortTh('conforme', 'Conforme')}
              {sortTh('rejet', 'Taux Rejet')}
              {sortTh('yield', 'Yield')}
            </tr>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-4 pb-3">{filterInput('lot')}</th>
              <th className="px-4 pb-3">{filterInput('produit')}</th>
              <th className="px-4 pb-3">{filterInput('leadtime')}</th>
              <th className="px-4 pb-3">{filterInput('repartis')}</th>
              <th className="px-4 pb-3">{filterInput('conforme')}</th>
              <th className="px-4 pb-3">{filterInput('rejet')}</th>
              <th className="px-4 pb-3">{filterInput('yield')}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr><td colSpan={7} className="py-8 text-center text-slate-400 text-sm">Aucun lot ne correspond aux filtres</td></tr>
            ) : sorted.map(({ b, rejection, yieldVal, leadtime }) => (
              <tr
                key={b.id}
                onClick={() => onOpenBatch(b.id)}
                className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors"
              >
                <td className="py-3 px-4 font-semibold text-slate-800">{b.id}</td>
                <td className="py-3 px-4">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-800">{b.product}</span>
                    <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded font-mono">{b.reference}</span>
                  </div>
                </td>
                <td className="py-3 px-4 text-slate-600">{leadtime} sem</td>
                <td className="py-3 px-4 text-slate-600">{b.distributed.toLocaleString()}</td>
                <td className="py-3 px-4 text-slate-600">{b.conform.toLocaleString()}</td>
                <td className="py-3 px-4 font-semibold text-red-600">{rejection.toFixed(1)}%</td>
                <td className="py-3 px-4 font-semibold text-green-600">{yieldVal.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
