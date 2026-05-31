import React from 'react';
import { useAppContext } from '../AppContext';
import { cn } from '../utils/cn';

interface QualityViewProps {
  onOpenBatch: (id: string) => void;
}

export function QualityView({ onOpenBatch }: QualityViewProps) {
  const { batches } = useAppContext();

  return (
    <div className="p-8 flex-1 overflow-y-auto bg-slate-50">
      <h3 className="text-lg font-semibold text-slate-800 mb-6">Suivi des Échantillons & Contrôles</h3>
      
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Lot</th>
              <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Produit (Réf)</th>
              <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Suivi Échantillons</th>
              <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Taux de Rejet</th>
              <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Statut</th>
            </tr>
          </thead>
          <tbody>
            {batches.map((b) => {
              let rate = 0;
              if (b.distributed > 0) {
                rate = ((b.distributed - b.conform) / b.distributed) * 100;
              }

              return (
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
                  <td className="py-3 px-4">
                    <div className="flex gap-1.5 flex-wrap">
                      {b.samples.filter(s => s.applicable).map((s, idx) => (
                        <span 
                          key={idx} 
                          className={cn(
                            "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold",
                            s.sent ? "bg-green-100 text-green-800" : "bg-orange-100 text-orange-800"
                          )}
                        >
                          {s.type.split('-')[0]}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className={cn("py-3 px-4 font-bold", rate > 5 ? "text-red-600" : "text-slate-700")}>
                    {rate.toFixed(2)}%
                  </td>
                  <td className="py-3 px-4 text-sm text-slate-600">{b.status}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
