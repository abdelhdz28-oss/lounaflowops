import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { useAppContext } from '../AppContext';
import { cn } from '../utils/cn';
import { SAMPLE_TESTS, computeSampleDelays } from '../constants';

const DELAY_TYPE_LABELS: Record<string, string> = {
  RECEPTION: 'Envoi/réception en retard',
  RESULTATS: 'Résultats en retard'
};

interface QualityViewProps {
  onOpenBatch: (id: string) => void;
}

export function QualityView({ onOpenBatch }: QualityViewProps) {
  const { batches, productCatalog } = useAppContext();

  // Agrégat de tous les lots × tests applicables en retard.
  const overdueRows = batches.flatMap(b =>
    computeSampleDelays(b.samples).map(d => ({
      batchId: b.id,
      product: b.product,
      testLabel: SAMPLE_TESTS.find(t => t.key === d.sample.type)?.label || d.sample.type,
      type: d.type,
      dueDate: d.dueDate,
      daysLate: d.daysLate
    }))
  ).sort((a, b) => b.daysLate - a.daysLate);

  return (
    <div className="p-8 flex-1 overflow-y-auto bg-slate-50">
      {/* Liste des tests en retard (tous lots confondus) */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden mb-6">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 bg-red-50">
          <AlertTriangle className="w-4 h-4 text-red-500" />
          <h3 className="text-sm font-semibold text-red-700">
            Tests en retard
            <span className="ml-2 text-xs font-normal text-red-500">({overdueRows.length})</span>
          </h3>
        </div>
        {overdueRows.length === 0 ? (
          <div className="px-4 py-4 text-sm text-slate-400">Aucun test en retard.</div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="py-2 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Lot</th>
                <th className="py-2 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Test</th>
                <th className="py-2 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Type de retard</th>
                <th className="py-2 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Date d'échéance</th>
                <th className="py-2 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Jours de retard</th>
              </tr>
            </thead>
            <tbody>
              {overdueRows.map((r, idx) => (
                <tr
                  key={`${r.batchId}-${r.testLabel}-${idx}`}
                  onClick={() => onOpenBatch(r.batchId)}
                  className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors"
                >
                  <td className="py-2 px-4 font-semibold text-slate-800">{r.batchId}</td>
                  <td className="py-2 px-4 text-slate-700">{r.testLabel}</td>
                  <td className="py-2 px-4">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 text-red-800">
                      {DELAY_TYPE_LABELS[r.type]}
                    </span>
                  </td>
                  <td className="py-2 px-4 font-mono text-xs text-slate-600">{r.dueDate}</td>
                  <td className="py-2 px-4 font-bold text-red-600">{r.daysLate} j</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="mb-6">
        <h3 className="text-lg font-semibold text-slate-800">Suivi des Échantillons & Contrôles</h3>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Lot</th>
              <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Produit (Réf)</th>
              <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Taux de Rejet</th>
              <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Rendement</th>
            </tr>
          </thead>
          <tbody>
            {batches.map((b) => {
              // Pas de calcul tant que Quantité répartie ET Miré conforme ne sont pas saisis → « — »
              const hasData = b.distributed > 0 && b.conform > 0;
              const rate = hasData ? ((b.distributed - b.conform) / b.distributed) * 100 : 0;

              // Rendement de production = (boîtes produites × condit × volume) / (volume lot en L × 1000) × 100
              const catalogEntry = productCatalog.find(p => p.ref === b.reference);
              const hasYield = b.sold > 0 && b.volume > 0 && !!catalogEntry
                && catalogEntry.condit > 0 && catalogEntry.volume > 0;
              const yieldPct = hasYield
                ? (b.sold * catalogEntry!.condit * catalogEntry!.volume) / (b.volume * 1000) * 100
                : 0;

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
                  <td className={cn("py-3 px-4 font-bold", hasData && rate > 5 ? "text-red-600" : "text-slate-700")}>
                    {hasData ? `${rate.toFixed(2)}%` : '—'}
                  </td>
                  <td className={cn("py-3 px-4 font-bold", hasYield ? "text-emerald-700" : "text-slate-400")}>
                    {hasYield ? `${yieldPct.toFixed(2)}%` : '—'}
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
