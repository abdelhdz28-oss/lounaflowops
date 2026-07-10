import React, { useState } from 'react';
import { Truck, Plus, Search, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { useAppContext } from '../AppContext';
import { cn } from '../utils/cn';
import { DELIVERY_STATUSES, deliveryStatusFromBatch, formatDate } from '../constants';

const DELIVERY_STATUS_MAP = Object.fromEntries(DELIVERY_STATUSES.map(s => [s.value, s]));

export function DeliveriesView() {
  const { deliveries, createDelivery, batches } = useAppContext();
  const [search, setSearch] = useState('');

  const [sortField, setSortField] = useState<'client' | 'date' | 'batchId' | 'boxesSold' | 'palettes' | 'status'>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const toggleSort = (f: typeof sortField) => {
    if (f === sortField) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortField(f); setSortDir('asc'); }
  };

  const q = search.toLowerCase();
  const filteredDeliveries = deliveries.filter(d =>
    (d.batchId || '').toLowerCase().includes(q) ||
    (d.client || '').toLowerCase().includes(q)
  );

  const STATUS_ORDER: Record<string, number> = { A_PLANIFIER: 0, EN_PRODUCTION: 1, EN_LIBERATION: 2, PRET: 3, ENLEVE: 4 };
  const sortVal = (d: typeof deliveries[number]): string | number => {
    switch (sortField) {
      case 'client': return (d.client || '').toLowerCase();
      case 'date': return d.date || '';
      case 'batchId': return (d.batchId || '').toLowerCase();
      case 'boxesSold': return d.boxesSold ?? 0;
      case 'palettes': return d.palettes ?? 0;
      case 'status': return STATUS_ORDER[deliveryStatusFromBatch(batches.find(b => b.id === d.batchId))] ?? 0;
    }
  };
  const sortedDeliveries = [...filteredDeliveries].sort((a, b) => {
    const av = sortVal(a), bv = sortVal(b);
    let cmp: number;
    if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
    else {
      const as = String(av), bs = String(bv);
      if (!as && bs) return 1;   // valeurs vides toujours en fin
      if (as && !bs) return -1;
      cmp = as.localeCompare(bs);
    }
    return cmp * (sortDir === 'asc' ? 1 : -1);
  });

  const SortHead = ({ field, label }: { field: typeof sortField; label: string }) => (
    <button
      onClick={() => toggleSort(field)}
      className="flex items-center gap-1 uppercase tracking-wider hover:text-slate-700 text-left"
    >
      {label}
      {sortField === field
        ? (sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)
        : <ArrowUpDown className="w-3 h-3 opacity-30" />}
    </button>
  );

  const handleAddDelivery = () => {
    const client = prompt("Nom du client :");
    if (client) {
      const lot = prompt("Numéro de Lot :");
      const boxes = prompt("Quantité de boîtes vendues :");
      const pal = prompt("Nombre de palettes :");
      
      createDelivery({
        batchId: lot || 'N/A',
        client: client,
        date: new Date().toISOString().split('T')[0],
        boxesSold: parseInt(boxes || '0', 10),
        palettes: parseInt(pal || '0', 10),
        status: 'PLANIFIÉ'
      });
    }
  };

  return (
    <div className="p-8 flex-1 overflow-y-auto bg-slate-50">
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-lg font-semibold text-slate-800">Planning Livraisons Clients</h3>
        <div className="flex items-center gap-3">
          <div className="relative w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Rechercher un numéro de lot..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            />
          </div>
          <button
            onClick={handleAddDelivery}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Ajouter Livraison
          </button>
        </div>
      </div>
      
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden flex flex-col">
        <div className="flex items-center p-4 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wider">
          <div className="w-16 flex justify-center"></div>
          <div className="flex-1 grid grid-cols-6 gap-4 items-center">
            <SortHead field="client" label="Client" />
            <SortHead field="date" label="Date livraison" />
            <SortHead field="batchId" label="Numéro de lot" />
            <SortHead field="boxesSold" label="Boîtes vendues" />
            <SortHead field="palettes" label="Palettes" />
            <SortHead field="status" label="Statut" />
          </div>
        </div>
        
        <div className="flex flex-col">
          {sortedDeliveries.map((d) => {
            const batch = batches.find(b => b.id === d.batchId);
            const derived = DELIVERY_STATUS_MAP[deliveryStatusFromBatch(batch)];
            return (
            <div key={d.id} className="flex items-center p-4 border-b border-slate-100 hover:bg-slate-50 transition-colors last:border-0">
              <div className="w-16 flex justify-center text-blue-600">
                <Truck className="w-6 h-6" />
              </div>
              <div className="flex-1 grid grid-cols-6 gap-4 items-center text-sm text-slate-700">
                <div className="font-medium text-slate-900">{d.client}</div>
                <div>{formatDate(d.date)}</div>
                <div className="font-mono font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded w-fit">{d.batchId}</div>
                <div>{(d.boxesSold ?? 0).toLocaleString()} boîtes</div>
                <div>{d.palettes ?? 0} Palette(s)</div>
                <div>
                  <span className={cn(
                    "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border",
                    derived.color
                  )}>
                    {derived.label}
                  </span>
                </div>
              </div>
            </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
