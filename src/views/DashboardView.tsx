import React, { useState } from 'react';
import { useAppContext } from '../AppContext';
import { cn } from '../utils/cn';
import { Batch } from '../types';
import { PROCESS_STAGES, QUALITY_STATUSES, SCHEDULE_HEALTH } from '../constants';
import { AlertTriangle, X, ChevronUp, ChevronDown } from 'lucide-react';

const PROCESS_STAGE_LABELS: Record<string, string> = Object.fromEntries(PROCESS_STAGES.map(s => [s.value, s.label]));
const QUALITY_STATUS_MAP = Object.fromEntries(QUALITY_STATUSES.map(s => [s.value, s]));
const SCHEDULE_HEALTH_MAP = Object.fromEntries(SCHEDULE_HEALTH.map(s => [s.value, s]));

function getSampleAlertMessage(batch: Batch): string | null {
  if (!batch || !batch.samples) return null;
  
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const todayStr = `${yyyy}-${mm}-${dd}`;
  
  const alerts: string[] = [];
  
  batch.samples.forEach(s => {
    if (!s || !s.applicable) return;
    
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

type SortableColumn = 'id' | 'product' | 'client' | 'step' | 'startDate' | 'endDate' | 'deliveryDate' | 'quality' | 'health' | 'progress';

export function DashboardView({ onOpenBatch }: DashboardViewProps) {
  const { batches } = useAppContext();

  // Defensive guard: Ensure batches is an array
  const batchList = Array.isArray(batches) ? batches : [];

  // Filters State
  const [filterId, setFilterId] = useState('');
  const [filterProduct, setFilterProduct] = useState('');
  const [filterClient, setFilterClient] = useState('');
  const [filterStep, setFilterStep] = useState('');
  const [filterStart, setFilterStart] = useState('');
  const [filterEnd, setFilterEnd] = useState('');
  const [filterDelivery, setFilterDelivery] = useState('');
  const [filterQuality, setFilterQuality] = useState('');
  const [filterHealth, setFilterHealth] = useState('');
  const [filterProgress, setFilterProgress] = useState('');

  // Sorting State
  const [sortColumn, setSortColumn] = useState<SortableColumn | null>('startDate');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Extract unique values for dropdowns
  const uniqueClients = Array.from(new Set(batchList.map(b => b?.client).filter(Boolean))).sort();
  const uniqueSteps = Array.from(new Set(batchList.map(b => b?.process_stage).filter(Boolean))).sort();

  const hasActiveFilters = !!(
    filterId || filterProduct || filterClient || filterStep ||
    filterStart || filterEnd || filterDelivery || filterQuality || filterHealth || filterProgress
  );

  const handleResetFilters = () => {
    setFilterId('');
    setFilterProduct('');
    setFilterClient('');
    setFilterStep('');
    setFilterStart('');
    setFilterEnd('');
    setFilterDelivery('');
    setFilterQuality('');
    setFilterHealth('');
    setFilterProgress('');
  };

  const handleSort = (column: SortableColumn) => {
    if (sortColumn === column) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  // KPI calculations (always based on the total set of batches)
  const activeBatches = batchList.length;
  const riskBatches = batchList.filter(b => b && (b.schedule_health === 'AT_RISK' || b.schedule_health === 'EN_RETARD')).length;
  
  let totalRejection = 0;
  let rejectCount = 0;
  let testsCount = 0;

  batchList.forEach(b => {
    if (!b) return;
    if (b.distributed > 0) {
      const rate = ((b.distributed - b.conform) / b.distributed) * 100;
      totalRejection += rate;
      rejectCount++;
    }
    if (Array.isArray(b.samples)) {
      b.samples.forEach(s => {
        if (s && s.applicable && !s.sent) testsCount++;
      });
    }
  });

  const avgRejection = rejectCount ? (totalRejection / rejectCount).toFixed(1) + '%' : '-';

  // Apply filters to batches
  const filteredBatches = batchList.filter(b => {
    if (!b) return false;

    const matchesId = (b.id || '').toLowerCase().includes(filterId.toLowerCase());
    const matchesProduct = (b.product || '').toLowerCase().includes(filterProduct.toLowerCase()) ||
                           (b.reference || '').toLowerCase().includes(filterProduct.toLowerCase());
    const matchesClient = !filterClient || b.client === filterClient;
    const matchesStep = !filterStep || b.process_stage === filterStep;
    const matchesStart = (b.startDate || '').toLowerCase().includes(filterStart.toLowerCase());
    const matchesEnd = (b.endDate || '').toLowerCase().includes(filterEnd.toLowerCase());
    const matchesDelivery = (b.deliveryDate || '').toLowerCase().includes(filterDelivery.toLowerCase());
    const matchesQuality = !filterQuality || b.quality_status === filterQuality;
    const matchesHealth = !filterHealth || b.schedule_health === filterHealth;
    const matchesProgress = (b.progress ?? '').toString().includes(filterProgress);

    return matchesId && matchesProduct && matchesClient && matchesStep &&
           matchesStart && matchesEnd && matchesDelivery && matchesQuality && matchesHealth && matchesProgress;
  });

  // Sort batches
  const sortedBatches = [...filteredBatches].sort((a, b) => {
    if (!sortColumn) return 0;
    
    let valA: any = '';
    let valB: any = '';

    if (sortColumn === 'step') {
      valA = a.process_stage || '';
      valB = b.process_stage || '';
    } else if (sortColumn === 'quality') {
      valA = a.quality_status || '';
      valB = b.quality_status || '';
    } else if (sortColumn === 'health') {
      valA = a.schedule_health || '';
      valB = b.schedule_health || '';
    } else {
      valA = a[sortColumn];
      valB = b[sortColumn];
    }

    if (typeof valA === 'number' || typeof valB === 'number') {
      const numA = Number(valA ?? 0);
      const numB = Number(valB ?? 0);
      return sortDirection === 'asc' ? numA - numB : numB - numA;
    }

    // Date columns: ISO yyyy-mm-dd lexicographic compare, empty values always last
    if (sortColumn === 'startDate' || sortColumn === 'endDate' || sortColumn === 'deliveryDate') {
      const dateA = String(valA ?? '');
      const dateB = String(valB ?? '');
      if (!dateA && !dateB) return 0;
      if (!dateA) return 1;
      if (!dateB) return -1;
      return sortDirection === 'asc' ? dateA.localeCompare(dateB) : dateB.localeCompare(dateA);
    }

    const strA = String(valA ?? '').toLowerCase();
    const strB = String(valB ?? '').toLowerCase();
    return sortDirection === 'asc' 
      ? strA.localeCompare(strB) 
      : strB.localeCompare(strA);
  });

  const renderHeader = (label: string, column: SortableColumn, widthClass?: string) => {
    const isSorted = sortColumn === column;
    return (
      <th 
        onClick={() => handleSort(column)}
        className={cn(
          "py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 hover:text-slate-700 transition-colors select-none",
          widthClass
        )}
      >
        <div className="flex items-center gap-1.5">
          <span>{label}</span>
          <span className="inline-flex items-center text-slate-300">
            {isSorted ? (
              sortDirection === 'asc' ? (
                <ChevronUp className="w-3.5 h-3.5 text-blue-600" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 text-blue-600" />
              )
            ) : (
              <span className="w-3 h-3 text-[10px] text-slate-300 font-normal leading-none">⇅</span>
            )}
          </span>
        </div>
      </th>
    );
  };

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
                {renderHeader('Lot', 'id', 'w-32')}
                {renderHeader('Produit (Réf)', 'product')}
                {renderHeader('Client', 'client', 'w-40')}
                {renderHeader('Étape', 'step', 'w-40')}
                {renderHeader('Début Fab.', 'startDate', 'w-36')}
                {renderHeader('Fin Fab.', 'endDate', 'w-36')}
                {renderHeader('Livraison Souhaitée', 'deliveryDate', 'w-36')}
                {renderHeader('Statut qualité', 'quality', 'w-32')}
                {renderHeader('OTD', 'health', 'w-28')}
                {renderHeader('Progression', 'progress', 'w-32')}
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
                      <option key={s} value={s}>{PROCESS_STAGE_LABELS[s] || s}</option>
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
                    value={filterQuality}
                    onChange={e => setFilterQuality(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded px-1.5 py-1 text-xs text-slate-700 font-normal outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="">Tous</option>
                    {QUALITY_STATUSES.map(q => (
                      <option key={q.value} value={q.value}>{q.label}</option>
                    ))}
                  </select>
                </th>
                <th className="py-2 px-3">
                  <select
                    value={filterHealth}
                    onChange={e => setFilterHealth(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded px-1.5 py-1 text-xs text-slate-700 font-normal outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="">Tous</option>
                    {SCHEDULE_HEALTH.map(h => (
                      <option key={h.value} value={h.value}>{h.label}</option>
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
              {sortedBatches.length > 0 ? (
                sortedBatches.map((b) => {
                  const step = PROCESS_STAGE_LABELS[b.process_stage] || b.process_stage || '-';
                  const quality = QUALITY_STATUS_MAP[b.quality_status];
                  const health = SCHEDULE_HEALTH_MAP[b.schedule_health];

                  return (
                    <tr 
                      key={b.id} 
                      onClick={() => onOpenBatch(b.id)}
                      className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors"
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
                          <span className="font-medium text-slate-800">{b.product || ''}</span>
                          <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded font-mono">{b.reference || ''}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-slate-600">{b.client || ''}</td>
                      <td className="py-3 px-4 text-slate-600">{step}</td>
                      <td className="py-3 px-4 text-slate-600 font-mono text-xs">{b.startDate || '-'}</td>
                      <td className="py-3 px-4 text-slate-600 font-mono text-xs">{b.endDate || '-'}</td>
                      <td className="py-3 px-4 text-slate-600 font-mono text-xs">{b.deliveryDate || '-'}</td>
                      <td className="py-3 px-4">
                        <span className={cn("inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border", quality?.color || 'bg-slate-100 text-slate-700 border-slate-200')}>
                          {quality?.label || b.quality_status || ''}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className={cn("inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border", health?.color || 'bg-slate-100 text-slate-500 border-slate-200')}>
                          {health?.label || b.schedule_health || ''}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="w-24 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                          <div 
                            className={cn("h-full rounded-full", b.progress === 100 ? "bg-green-600" : "bg-blue-600")}
                            style={{ width: `${b.progress ?? 0}%` }}
                          />
                        </div>
                        <div className="text-xs text-slate-500 mt-1">{(b.progress !== undefined && b.progress !== null) ? b.progress : 0}%</div>
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
                  <td colSpan={11} className="py-8 text-center text-sm text-slate-400">
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
