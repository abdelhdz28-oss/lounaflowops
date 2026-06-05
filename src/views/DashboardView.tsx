import React, { useState } from 'react';
import { useAppContext } from '../AppContext';
import { cn } from '../utils/cn';
import { Batch } from '../types';
import { AlertTriangle, X } from 'lucide-react';

function getSampleAlertMessage(batch: Batch): string | null {
  if (!batch.samples) return null;
  
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const todayStr = `${yyyy}-${mm}-${dd}`;
  
  const alerts: string[] = [];
  
  batch.samples.forEach(s => {
    if (!s.applicable) return;
    
    // Condition 1: sendDate > expectedDate
    if (s.sendDate && s.expectedDate && s.sendDate > s.expectedDate) {
      alerts.push(`${s.type} : Envoyé le ${s.sendDate} (Dépassé, attendu le ${s.expectedDate})`);
    }
    // Condition 2: no sendDate (or not sent) and expectedDate is past
    else if (!s.sendDate && s.expectedDate && s.expectedDate < todayStr) {
      alerts.push(`${s.type} : Non envoyé (Retard, attendu le ${s.expectedDate})`);
    }
  });
  
  if (alerts.length === 0) return null;
  return `Alerte échantillons :\n` + alerts.join('\n');
}

interface DashboardViewProps {
  onOpenBatch: (id: string) => void;
}

export function DashboardView({ onOpenBatch }: DashboardViewProps) {
  const { batches, fluxConfig } = useAppContext();

  // Filters State
  const [filterId, setFilterId] = useState('');
  const [filterProduct, setFilterProduct] = useState('');
  const [filterClient, setFilterClient] = useState('');
  const [filterStep, setFilterStep] = useState('');
  const [filterStart, setFilterStart] = useState('');
  const [filterEnd, setFilterEnd] = useState('');
  const [filterDelivery, setFilterDelivery] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterProgress, setFilterProgress] = useState('');

  // Extract unique values for dropdowns
  const uniqueClients = Array.from(new Set(batches.map(b => b.client).filter(Boolean))).sort();
  const uniqueStatuses = Array.from(new Set(batches.map(b => b.status).filter(Boolean))).sort();
  const uniqueSteps = Array.from(new Set(batches.map(b => {
    const flux = fluxConfig[b.fluxKey];
    return flux?.steps[b.stepIndex] || '-';
  }).filter(Boolean))).sort();

  const hasActiveFilters = !!(
    filterId || filterProduct || filterClient || filterStep || 
    filterStart || filterEnd || filterDelivery || filterStatus || filterProgress
  );

  const handleResetFilters = () => {
    setFilterId('');
    setFilterProduct('');
    setFilterClient('');
    setFilterStep('');
    setFilterStart('');
    setFilterEnd('');
    setFilterDelivery('');
    setFilterStatus('');
    setFilterProgress('');
  };

  // KPI calculations (always based on the total set of batches)
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

  // Apply filters to batches
  const filteredBatches = batches.filter(b => {
    const flux = fluxConfig[b.fluxKey];
    const step = flux?.steps[b.stepIndex] || '-';

    const matchesId = b.id.toLowerCase().includes(filterId.toLowerCase());
    const matchesProduct = (b.product || '').toLowerCase().includes(filterProduct.toLowerCase()) || 
                           (b.reference || '').toLowerCase().includes(filterProduct.toLowerCase());
    const matchesClient = !filterClient || b.client === filterClient;
    const matchesStep = !filterStep || step === filterStep;
    const matchesStart = (b.startDate || '').toLowerCase().includes(filterStart.toLowerCase());
    const matchesEnd = (b.endDate || '').toLowerCase().includes(filterEnd.toLowerCase());
    const matchesDelivery = (b.deliveryDate || '').toLowerCase().includes(filterDelivery.toLowerCase());
    const matchesStatus = !filterStatus || b.status === filterStatus;
    const matchesProgress = b.progress.toString().includes(filterProgress);

    return matchesId && matchesProduct && matchesClient && matchesStep && 
           matchesStart && matchesEnd && matchesDelivery && matchesStatus && matchesProgress;
  });

  return (
    <div className="p-8 flex-1 overflow-y-auto bg-slate-50">
      <div className="grid grid-cols-4 gap-6 mb-8">
        <KpiCard title="EN PRODUCTION" value={activeBatches} sub="Lots actifs" />
        <KpiCard title="ALERTES" value={riskBatches} sub="Critiques" valueColor="text-red-500" />
        <KpiCard title="TAUX REJET MOYEN" value={avgRejection} sub="Basé sur Mirage" />
        <KpiCard title="TESTS EN COURS" value={testsCount} sub="Qualité externe" />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[1000px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider w-32">Lot</th>
                <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Produit (Réf)</th>
                <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider w-40">Client</th>
                <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider w-40">Étape</th>
                <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider w-36">Début Fab.</th>
                <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider w-36">Fin Fab.</th>
                <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider w-36">Livraison Souhaitée</th>
                <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider w-32">Statut</th>
                <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider w-32">Progression</th>
                <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider w-24 text-center">Action</th>
              </tr>
              <tr className="bg-slate-50/50 border-b border-slate-200">
                <th className="py-2 px-3">
                  <input 
                    type="text" 
                    value={filterId} 
                    onChange={e => setFilterId(e.target.value)} 
                    placeholder="Filtrer Lot..."
                    className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-xs text-slate-700 font-normal outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </th>
                <th className="py-2 px-3">
                  <input 
                    type="text" 
                    value={filterProduct} 
                    onChange={e => setFilterProduct(e.target.value)} 
                    placeholder="Filtrer Produit..."
                    className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-xs text-slate-700 font-normal outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </th>
                <th className="py-2 px-3">
                  <select 
                    value={filterClient} 
                    onChange={e => setFilterClient(e.target.value)} 
                    className="w-full bg-white border border-slate-200 rounded px-1.5 py-1 text-xs text-slate-700 font-normal outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="">Tous</option>
                    {uniqueClients.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </th>
                <th className="py-2 px-3">
                  <select 
                    value={filterStep} 
                    onChange={e => setFilterStep(e.target.value)} 
                    className="w-full bg-white border border-slate-200 rounded px-1.5 py-1 text-xs text-slate-700 font-normal outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="">Tous</option>
                    {uniqueSteps.map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </th>
                <th className="py-2 px-3">
                  <input 
                    type="text" 
                    value={filterStart} 
                    onChange={e => setFilterStart(e.target.value)} 
                    placeholder="Filtrer..."
                    className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-xs text-slate-700 font-normal outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </th>
                <th className="py-2 px-3">
                  <input 
                    type="text" 
                    value={filterEnd} 
                    onChange={e => setFilterEnd(e.target.value)} 
                    placeholder="Filtrer..."
                    className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-xs text-slate-700 font-normal outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </th>
                <th className="py-2 px-3">
                  <input 
                    type="text" 
                    value={filterDelivery} 
                    onChange={e => setFilterDelivery(e.target.value)} 
                    placeholder="Filtrer..."
                    className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-xs text-slate-700 font-normal outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </th>
                <th className="py-2 px-3">
                  <select 
                    value={filterStatus} 
                    onChange={e => setFilterStatus(e.target.value)} 
                    className="w-full bg-white border border-slate-200 rounded px-1.5 py-1 text-xs text-slate-700 font-normal outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="">Tous</option>
                    {uniqueStatuses.map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </th>
                <th className="py-2 px-3">
                  <input 
                    type="text" 
                    value={filterProgress} 
                    onChange={e => setFilterProgress(e.target.value)} 
                    placeholder="Filtrer..."
                    className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-xs text-slate-700 font-normal outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </th>
                <th className="py-2 px-3 text-center">
                  {hasActiveFilters && (
                    <button 
                      onClick={handleResetFilters}
                      className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                      title="Réinitialiser les filtres"
                    >
                      <X className="w-4 h-4 mx-auto" />
                    </button>
                  )}
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredBatches.length > 0 ? (
                filteredBatches.map((b) => {
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
                      return 'bg-blue-100 text-blue-800 border border-blue-200';
                    }
                    if (s.includes('ENLEVE') || s.includes('ENLEVÉE') || s.includes('ARCHIVED') || s.includes('SUPPRIMÉ') || s.includes('RETIRÉ')) {
                      return 'bg-slate-100 text-slate-800 border border-slate-200';
                    }
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
                      className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors animate-fadeIn"
                    >
                      <td className="py-3 px-4 font-bold text-blue-600">
                        <div className="flex items-center gap-1.5">
                          <span>{b.id}</span>
                          {(() => {
                            const alertMsg = getSampleAlertMessage(b);
                            return alertMsg ? (
                              <AlertTriangle 
                                className="w-4 h-4 text-red-500 animate-pulse flex-shrink-0" 
                                title={alertMsg}
                              />
                            ) : null;
                          })()}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-slate-800">{b.product}</span>
                          <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded font-mono">{b.reference}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-slate-600">{b.client}</td>
                      <td className="py-3 px-4 text-slate-600">{step}</td>
                      <td className="py-3 px-4 text-slate-600 font-mono text-xs">{b.startDate || '-'}</td>
                      <td className="py-3 px-4 text-slate-600 font-mono text-xs">{b.endDate || '-'}</td>
                      <td className="py-3 px-4 text-slate-600 font-mono text-xs">{b.deliveryDate || '-'}</td>
                      <td className="py-3 px-4">
                        <span className={cn("inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold", statusClass)}>
                          {b.status}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="w-24 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                          <div 
                            className={cn("h-full rounded-full", b.progress === 100 ? "bg-green-600" : "bg-blue-600")}
                            style={{ width: `${b.progress}%` }}
                          />
                        </div>
                        <div className="text-xs text-slate-500 mt-1">{b.progress}%</div>
                      </td>
                      <td className="py-3 px-4 text-center" onClick={e => e.stopPropagation()}>
                        <button 
                          onClick={() => onOpenBatch(b.id)}
                          className="text-sm font-medium text-slate-600 hover:text-blue-600 px-3 py-1 border border-slate-200 rounded hover:bg-white transition-colors"
                        >
                          Voir
                        </button>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-sm text-slate-400">
                    Aucun lot ne correspond aux filtres actuels.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
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
