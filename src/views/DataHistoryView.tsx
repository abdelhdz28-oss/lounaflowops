import React from 'react';
import { useAppContext } from '../AppContext';

interface DataHistoryViewProps {
  onOpenBatch: (id: string) => void;
}

export function DataHistoryView({ onOpenBatch }: DataHistoryViewProps) {
  const { batches, fluxConfig } = useAppContext();

  return (
    <div className="p-8 flex-1 overflow-y-auto bg-slate-50">
      <h3 className="text-lg font-semibold text-slate-800 mb-6">Data Historique</h3>
      
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Lot</th>
              <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Produit (Réf)</th>
              <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Leadtime</th>
              <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Répartis</th>
              <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Conforme</th>
              <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Taux Rejet</th>
              <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Yield</th>
            </tr>
          </thead>
          <tbody>
            {batches.map((b) => {
              const rejection = b.distributed > 0 ? ((b.distributed - b.conform) / b.distributed) * 100 : 0;
              const yieldVal = b.distributed > 0 ? (b.conform / b.distributed) * 100 : 0;
              const leadtime = Object.values(fluxConfig[b.fluxKey]?.durations || {}).reduce((a: number, v: number) => a + v, 0);

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
                  <td className="py-3 px-4 text-slate-600">{leadtime} sem</td>
                  <td className="py-3 px-4 text-slate-600">{b.distributed.toLocaleString()}</td>
                  <td className="py-3 px-4 text-slate-600">{b.conform.toLocaleString()}</td>
                  <td className="py-3 px-4 font-semibold text-red-600">{rejection.toFixed(1)}%</td>
                  <td className="py-3 px-4 font-semibold text-green-600">{yieldVal.toFixed(1)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
