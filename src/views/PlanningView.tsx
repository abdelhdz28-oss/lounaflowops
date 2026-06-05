import React from 'react';
import { useAppContext } from '../AppContext';

interface PlanningViewProps {
  onOpenBatch: (id: string) => void;
}

export function PlanningView({ onOpenBatch }: PlanningViewProps) {
  const { batches, fluxConfig, updateBatch } = useAppContext();

  return (
    <div className="p-8 flex-1 overflow-y-auto bg-slate-50">
      <h3 className="text-lg font-semibold text-slate-800 mb-6">Vue d'ensemble Planning</h3>
      
      <div className="flex flex-col gap-4">
        {batches.map((b) => {
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
            <div key={b.id} className="bg-white border border-slate-200 rounded-xl p-6 flex items-center gap-6 shadow-sm">
                  <div className="w-64 shrink-0">
                    <div className="font-bold text-lg text-blue-600">{b.id}</div>
                    <div className="text-sm text-slate-600 flex items-center gap-2 mt-1">
                      <span className="font-medium">{b.product}</span>
                      <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-mono">{b.reference}</span>
                    </div>
                    <div className="text-xs text-slate-500 mt-1">{flux?.name}</div>
                  </div>
                  
                  <div className="w-72 shrink-0 grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">DÉBUT</label>
                      <input 
                        type="date" 
                        value={b.startDate} 
                        onChange={(e) => updateBatch(b.id, { startDate: e.target.value })}
                        className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">FIN</label>
                      <input 
                        type="date" 
                        value={b.endDate} 
                        onChange={(e) => updateBatch(b.id, { endDate: e.target.value })}
                        className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                      />
                    </div>
                  </div>
                  
                  <div 
                    className="flex-1 bg-slate-100 h-10 rounded-full relative overflow-hidden cursor-pointer hover:bg-slate-200 transition-colors"
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
              );
        })}
      </div>
    </div>
  );
}
