import React from 'react';
import { useAppContext } from '../AppContext';
import { cn } from '../utils/cn';
import { Batch } from '../types';

interface DashboardViewProps {
  onOpenBatch: (id: string) => void;
}

export function DashboardView({ onOpenBatch }: DashboardViewProps) {
  const { batches, fluxConfig } = useAppContext();

  const activeBatches = batches.length;
  const riskBatches = batches.filter(b => b.status === 'AT_RISK').length;
  
  let totalRejection = 0;
  let rejectCount = 0;
  let testsCount = 0;

  batches.forEach(b => {
    if (b.distributed > 0) {
      const rate = ((b.distributed - b.conform) / b.distributed) * 100;
      totalRejection += rate;
      rejectCount++;
    }
    b.samples.forEach(s => {
      if (s.applicable && !s.sent) testsCount++;
    });
  });

  const avgRejection = rejectCount ? (totalRejection / rejectCount).toFixed(1) + '%' : '-';

  return (
    <div className="p-8 flex-1 overflow-y-auto bg-slate-50">
      <div className="grid grid-cols-4 gap-6 mb-8">
        <KpiCard title="EN PRODUCTION" value={activeBatches} sub="Lots actifs" />
        <KpiCard title="ALERTES" value={riskBatches} sub="Critiques" valueColor="text-red-500" />
        <KpiCard title="TAUX REJET MOYEN" value={avgRejection} sub="Basé sur Mirage" />
        <KpiCard title="TESTS EN COURS" value={testsCount} sub="Qualité externe" />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Lot</th>
              <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Produit (Réf)</th>
              <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Client</th>
              <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Étape</th>
              <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Statut</th>
              <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Progression</th>
              <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Action</th>
            </tr>
          </thead>
          <tbody>
            {batches.map((b) => {
              const flux = fluxConfig[b.fluxKey];
              const step = flux?.steps[b.stepIndex] || '-';
              
              const getStatusClass = (status: string) => {
                const s = status.toUpperCase().replace(/\s+/g, '_');
                if (s.includes('UPCOMING') || s.includes('AVENIR') || s.includes('À_VENIR')) {
                  return 'bg-orange-100 text-orange-800 border border-orange-200';
                }
                if (s.includes('ON_TRACK') || s.includes('TRACK')) {
                  return 'bg-green-100 text-green-800 border border-green-200';
                }
                if (s.includes('AT_RISK') || s.includes('RISK') || s.includes('DANGER')) {
                  return 'bg-red-100 text-red-800 border border-red-200';
                }
                if (s.includes('LIBEREE') || s.includes('LIBÉRÉE')) {
                  return 'bg-blue-100 text-blue-800 border border-blue-200'; // Bleu proposé pour Libérée
                }
                if (s.includes('ENLEVE') || s.includes('ENLEVÉE') || s.includes('ARCHIVED') || s.includes('SUPPRIMÉ') || s.includes('RETIRÉ')) {
                  return 'bg-slate-100 text-slate-800 border border-slate-200'; // Gris proposé pour Enlevée
                }
                // Fallbacks
                if (s.includes('COMPLETED') || s.includes('TERMINÉ') || s.includes('TERMINE')) {
                  return 'bg-blue-100 text-blue-800 border border-blue-200';
                }
                return 'bg-slate-100 text-slate-700 border border-slate-200';
              };
              const statusClass = getStatusClass(b.status);

              return (
                <tr 
                  key={b.id} 
                  onClick={() => onOpenBatch(b.id)}
                  className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors"
                >
                  <td className="py-3 px-4 font-bold text-blue-600">{b.id}</td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-800">{b.product}</span>
                      <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded font-mono">{b.reference}</span>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-slate-600">{b.client}</td>
                  <td className="py-3 px-4 text-slate-600">{step}</td>
                  <td className="py-3 px-4">
                    <span className={cn("inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold", statusClass)}>
                      {b.status}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <div className="w-24 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-blue-600 rounded-full" 
                        style={{ width: `${b.progress}%` }}
                      />
                    </div>
                    <div className="text-xs text-slate-500 mt-1">{b.progress}%</div>
                  </td>
                  <td className="py-3 px-4">
                    <button className="text-sm font-medium text-slate-600 hover:text-blue-600 px-3 py-1 border border-slate-200 rounded hover:bg-white transition-colors">
                      Voir
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function KpiCard({ title, value, sub, valueColor = "text-slate-900" }: { title: string, value: string | number, sub: string, valueColor?: string }) {
  return (
    <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">{title}</div>
      <div className={cn("text-3xl font-bold mb-1", valueColor)}>{value}</div>
      <div className="text-sm text-slate-500">{sub}</div>
    </div>
  );
}
