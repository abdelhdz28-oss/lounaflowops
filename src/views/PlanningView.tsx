import React, { useState } from 'react';
import { Search, ArrowUp, ArrowDown, FileText, SquarePen } from 'lucide-react';
import { useAppContext } from '../AppContext';

interface PlanningViewProps {
  onOpenBatch: (id: string) => void;
}

type SortField = 'id' | 'startDate' | 'endDate' | 'deliveryDate';

const SORT_LABELS: Record<SortField, string> = {
  id: 'Numéro de lot',
  startDate: 'Début fab.',
  endDate: 'Fin fab.',
  deliveryDate: 'Livraison souhaitée',
};

export function PlanningView({ onOpenBatch }: PlanningViewProps) {
  const { batches, fluxConfig, updateBatch } = useAppContext();
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('startDate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const q = search.toLowerCase();
  const filteredBatches = batches.filter(b =>
    (b.id || '').toLowerCase().includes(q) ||
    (b.product || '').toLowerCase().includes(q)
  );

  const sortedBatches = [...filteredBatches].sort((a, b) => {
    const av = String((a as any)[sortField] ?? '');
    const bv = String((b as any)[sortField] ?? '');
    if (!av && bv) return 1;   // valeurs vides toujours en fin
    if (av && !bv) return -1;
    if (!av && !bv) return 0;
    return av.localeCompare(bv) * (sortDir === 'asc' ? 1 : -1);
  });

  return (
    <div className="p-8 flex-1 overflow-y-auto bg-slate-50">
      <div className="flex flex-wrap justify-between items-center gap-3 mb-6">
        <h3 className="text-lg font-semibold text-slate-800">Vue d'ensemble Planning</h3>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-500 whitespace-nowrap">Trier par</span>
            <select
              value={sortField}
              onChange={e => setSortField(e.target.value as SortField)}
              className="px-2 py-2 text-sm border border-slate-300 rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none bg-white"
            >
              {(Object.keys(SORT_LABELS) as SortField[]).map(f => (
                <option key={f} value={f}>{SORT_LABELS[f]}</option>
              ))}
            </select>
            <button
              onClick={() => setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))}
              title={sortDir === 'asc' ? 'Croissant' : 'Décroissant'}
              className="p-2 border border-slate-300 rounded-md text-slate-600 hover:bg-slate-50 transition-colors"
            >
              {sortDir === 'asc' ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />}
            </button>
          </div>
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
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {sortedBatches.map((b) => {
          const flux = fluxConfig[b.fluxKey];
          const stepName = flux?.steps[b.stepIndex] || '-';
          
          const getPlanningColor = (status: string) => {
            const s = status.toUpperCase().replace(/\s+/g, '_');
            if (s.includes('UPCOMING') || s.includes('AVENIR') || s.includes('À_VENIR')) {
              return 'bg-orange-500';
            }
            if (s.includes('ON_TRACK') || s.includes('TRACK')) {
              return 'bg-green-600';
            }
            if (s.includes('AT_RISK') || s.includes('RISK') || s.includes('DANGER')) {
              return 'bg-red-500';
            }
            if (s.includes('LIBEREE') || s.includes('LIBÉRÉE')) {
              return 'bg-blue-600'; // Bleu pour Libérée
            }
            if (s.includes('ENLEVE') || s.includes('ENLEVÉE') || s.includes('ARCHIVED') || s.includes('SUPPRIMÉ') || s.includes('RETIRÉ')) {
              return 'bg-slate-500'; // Gris pour Enlevée
            }
            if (s.includes('COMPLETED') || s.includes('TERMINÉ') || s.includes('TERMINE')) {
              return 'bg-blue-600';
            }
            return 'bg-slate-600';
          };
          const planningColor = getPlanningColor(b.status);

          return (
            <div key={b.id} className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
              <div className="flex items-start gap-6">
                  <div className="w-64 shrink-0">
                    <button
                      onClick={() => onOpenBatch(b.id)}
                      className="font-bold text-lg text-blue-600 hover:underline cursor-pointer text-left"
                    >
                      {b.id}
                    </button>
                    <div className="text-sm text-slate-600 flex items-center gap-2 mt-1">
                      <span className="font-medium">{b.product}</span>
                      <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-mono">{b.reference}</span>
                    </div>
                    <div className="text-xs text-slate-500 mt-1">{flux?.name}</div>
                  </div>
                  
                  <div className="flex-1 flex flex-col gap-4">
                    <div className="grid grid-cols-3 gap-4 max-w-[32rem]">
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">DÉBUT FAB.</label>
                        <input
                          type="date"
                          value={b.startDate}
                          onChange={(e) => updateBatch(b.id, { startDate: e.target.value })}
                          className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">FIN FAB.</label>
                        <input
                          type="date"
                          value={b.endDate}
                          onChange={(e) => updateBatch(b.id, { endDate: e.target.value })}
                          className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">LIVRAISON SOUHAITÉE</label>
                        <input
                          type="date"
                          value={b.deliveryDate || ''}
                          onChange={(e) => updateBatch(b.id, { deliveryDate: e.target.value })}
                          className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                        />
                      </div>
                    </div>

                    <div
                      className="w-full bg-slate-100 h-10 rounded-full relative overflow-hidden cursor-pointer hover:bg-slate-200 transition-colors"
                      onClick={() => onOpenBatch(b.id)}
                    >
                      <div
                        className={`absolute top-1 bottom-1 left-1 rounded-full flex items-center px-3 text-white text-xs font-semibold transition-all ${planningColor}`}
                        style={{ width: `calc(${b.progress}% - 8px)`, minWidth: b.progress > 0 ? 'fit-content' : '0' }}
                      >
                        {b.progress > 10 && `${stepName} (${b.progress}%)`}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => onOpenBatch(b.id)}
                    title="Ouvrir la fiche du lot"
                    className="shrink-0 flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors"
                  >
                    <SquarePen className="w-4 h-4" /> Fiche
                  </button>
                </div>

                {b.notes && (
                  <div className="mt-4 pt-4 border-t border-slate-100 flex items-start gap-2">
                    <FileText className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                    <p className="text-sm text-slate-600 whitespace-pre-wrap">{b.notes}</p>
                  </div>
                )}
              </div>
              );
        })}
      </div>
    </div>
  );
}
