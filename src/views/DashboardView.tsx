import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useAppContext } from '../AppContext';
import { cn } from '../utils/cn';
import { Batch, FluxConfig } from '../types';
import {
  PROCESS_STAGES, QUALITY_STATUSES, SCHEDULE_HEALTH, computeSampleMilestones, MilestoneState,
  PRODUCTION_MILESTONES, computeMilestoneDates, milestoneStatus, defaultMilestones, formatDate, ageEtapeLot, boitesProduites
} from '../constants';
import { PackageCheck, Send, FileCheck, X, ChevronUp, ChevronDown } from 'lucide-react';

const PROCESS_STAGE_LABELS: Record<string, string> = Object.fromEntries(PROCESS_STAGES.map(s => [s.value, s.label]));

// Couleurs des étiquettes d'étape (progression Planifié → Expédié), même style que les autres badges.
const PROCESS_STAGE_COLOR: Record<string, string> = {
  PLANIFIE: 'bg-slate-100 text-slate-700 border-slate-200',
  FORMULATION: 'bg-blue-100 text-blue-800 border-blue-200',
  CONDI_PRIM: 'bg-indigo-100 text-indigo-800 border-indigo-200',
  CONDI_SEC: 'bg-violet-100 text-violet-800 border-violet-200',
  LIBERATION: 'bg-amber-100 text-amber-800 border-amber-200',
  ATTENTE_ENLEVEMENT: 'bg-teal-100 text-teal-800 border-teal-200',
  EXPEDIE: 'bg-green-100 text-green-800 border-green-200'
};
const QUALITY_STATUS_MAP = Object.fromEntries(QUALITY_STATUSES.map(s => [s.value, s]));
const SCHEDULE_HEALTH_MAP = Object.fromEntries(SCHEDULE_HEALTH.map(s => [s.value, s]));

// Regroupement des dates par mois pour les filtres à choix multiple.
const MONTHS_FR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
function monthKey(dateStr?: string): string {
  const s = String(dateStr || '').slice(0, 7);
  return /^\d{4}-\d{2}$/.test(s) ? s : '';
}
function monthLabel(key: string): string {
  const [y, m] = key.split('-');
  return `${MONTHS_FR[parseInt(m, 10) - 1] || m} ${y}`;
}

// Couleur du pictogramme de jalon selon le statut agrégé.
const MILESTONE_COLOR: Record<MilestoneState, string> = {
  ok: 'text-green-500',
  warn: 'text-orange-500',
  late: 'text-red-500',
  na: 'text-slate-300'
};

// Groupe de 3 pictogrammes (réception / envoi / résultats) pour un lot.
function SampleMilestonesIcons({ batch }: { batch: Batch }) {
  const m = computeSampleMilestones(batch);
  const items = [
    { Icon: PackageCheck, state: m.reception, title: m.details.reception },
    { Icon: Send, state: m.envoi, title: m.details.envoi },
    { Icon: FileCheck, state: m.resultats, title: m.details.resultats }
  ];
  return (
    <span className="inline-flex items-center gap-1 flex-shrink-0">
      {items.map(({ Icon, state, title }, i) => (
        <Icon
          key={i}
          className={cn('w-3.5 h-3.5', MILESTONE_COLOR[state], state === 'late' && 'animate-pulse')}
          title={title}
        />
      ))}
    </span>
  );
}

// Couleur d'une pastille de jalon de production selon le statut.
const MILESTONE_DOT_COLOR: Record<MilestoneState, string> = {
  ok: 'bg-green-500',
  warn: 'bg-orange-500',
  late: 'bg-red-500',
  na: 'bg-slate-300'
};

// 3 pastilles (Condi. Primaire / Secondaire / Libération) pour un lot, avec tooltip.
function ProductionMilestonesDots({ batch, flux }: { batch: Batch; flux: FluxConfig | undefined }) {
  const dates = computeMilestoneDates(flux, batch.startDate);
  const ms = batch.milestones || defaultMilestones();
  const planifie = batch.process_stage === 'PLANIFIE';
  const STATE_LABEL: Record<MilestoneState, string> = {
    ok: 'à jour', warn: 'échéance proche', late: 'en retard', na: 'non démarré'
  };
  const items = PRODUCTION_MILESTONES.map(m => {
    const datePrevue = dates[m.key];
    const done = !!ms[m.key]?.done;
    const state: MilestoneState = planifie ? 'na' : milestoneStatus(datePrevue, done);
    const detail = done ? 'validé' : (datePrevue ? `prévu ${datePrevue} (${STATE_LABEL[state]})` : 'date non calculée');
    return { label: m.label, state, title: `${m.label} : ${detail}` };
  });
  return (
    <span className="inline-flex items-center gap-1 flex-shrink-0">
      {items.map((it, i) => (
        <span
          key={i}
          title={it.title}
          className={cn('w-2.5 h-2.5 rounded-full', MILESTONE_DOT_COLOR[it.state], it.state === 'late' && 'animate-pulse')}
        />
      ))}
    </span>
  );
}

// Couleur d'urgence d'une date (Fin Fab. / Livraison Souhaitée) : rouge = dépassée (en retard), orange ≤14j (échéance proche), vert >14j.
function dateUrgencyClass(dateStr: string | undefined): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysUntil = Math.floor((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (daysUntil < 0) return 'text-red-600 font-semibold';      // date dépassée = en retard
  if (daysUntil <= 14) return 'text-orange-600 font-semibold'; // échéance proche
  return 'text-green-600 font-semibold';
}

interface DashboardViewProps {
  onOpenBatch: (id: string) => void;
}

type SortableColumn = 'id' | 'product' | 'client' | 'step' | 'startDate' | 'endDate' | 'deliveryDate' | 'quality' | 'health' | 'progress';

// Persistance des filtres/tri pour toute la session de travail (survit aux re-renders et au remontage)
const DASHBOARD_FILTERS_KEY = 'lounaflow:dashboardFilters';
function loadDashboardFilters(): Record<string, any> {
  try {
    const raw = sessionStorage.getItem(DASHBOARD_FILTERS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function DashboardView({ onOpenBatch }: DashboardViewProps) {
  const { batches, fluxConfig, productCatalog } = useAppContext();

  // Defensive guard: Ensure batches is an array
  const batchList = Array.isArray(batches) ? batches : [];

  // Filters State — chaque colonne = liste de valeurs cochées (choix multiple). Restaurés depuis la session.
  const [saved] = useState(loadDashboardFilters);
  const asArr = (v: any): string[] => (Array.isArray(v) ? v : []);
  const [filterId, setFilterId] = useState<string[]>(asArr(saved.filterId));
  const [filterProduct, setFilterProduct] = useState<string[]>(asArr(saved.filterProduct));
  const [filterClient, setFilterClient] = useState<string[]>(asArr(saved.filterClient));
  const [filterStep, setFilterStep] = useState<string[]>(asArr(saved.filterStep));
  const [filterStart, setFilterStart] = useState<string[]>(asArr(saved.filterStart));
  const [filterEnd, setFilterEnd] = useState<string[]>(asArr(saved.filterEnd));
  const [filterDelivery, setFilterDelivery] = useState<string[]>(asArr(saved.filterDelivery));
  const [filterQuality, setFilterQuality] = useState<string[]>(asArr(saved.filterQuality));
  const [filterHealth, setFilterHealth] = useState<string[]>(asArr(saved.filterHealth));
  const [filterProgress, setFilterProgress] = useState<string[]>(asArr(saved.filterProgress));
  // Lots clôturés : archivés, donc masqués par défaut (choix mémorisé pour la session).
  const [afficherClotures, setAfficherClotures] = useState<boolean>(!!saved.afficherClotures);

  // Sorting State
  const [sortColumn, setSortColumn] = useState<SortableColumn | null>(saved.sortColumn ?? 'startDate');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>(saved.sortDirection || 'asc');

  // Persiste filtres + tri à chaque changement, pour toute la session de travail
  useEffect(() => {
    const data = {
      filterId, filterProduct, filterClient, filterStep, filterStart, filterEnd,
      filterDelivery, filterQuality, filterHealth, filterProgress, sortColumn, sortDirection, afficherClotures
    };
    try { sessionStorage.setItem(DASHBOARD_FILTERS_KEY, JSON.stringify(data)); } catch { /* quota/full : ignore */ }
  }, [filterId, filterProduct, filterClient, filterStep, filterStart, filterEnd,
      filterDelivery, filterQuality, filterHealth, filterProgress, sortColumn, sortDirection]);

  // Type de produit affiché (catalogue prioritaire, sinon libellé du lot).
  const productTypeOf = (b: Batch) => productCatalog.find(p => p.ref === b.reference)?.type || b.product || '';

  // Options des menus déroulants (valeurs réellement présentes). value = clé filtrée, label = affichage.
  // Mémorisées : recalculées uniquement quand les lots ou le catalogue changent (pas à chaque filtre/tri).
  const { optId, optProduct, optClient, optStep, optQuality, optHealth, optStart, optEnd, optDelivery, optProgress } = useMemo(() => {
    const uniqTxt = (vals: (string | undefined)[]) =>
      Array.from(new Set(vals.filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }));
    // Dates : regroupées par mois (clé triable "AAAA-MM", label "juil. 2026").
    const monthOpts = (vals: (string | undefined)[]) =>
      Array.from(new Set(vals.map(monthKey).filter(Boolean))).sort().map(v => ({ value: v, label: monthLabel(v) }));
    return {
      optId: uniqTxt(batchList.map(b => b?.id)).map(v => ({ value: v, label: v })),
      optProduct: uniqTxt(batchList.map(productTypeOf)).map(v => ({ value: v, label: v })),
      optClient: uniqTxt(batchList.map(b => b?.client)).map(v => ({ value: v, label: v })),
      optStep: uniqTxt(batchList.map(b => b?.process_stage)).map(v => ({ value: v, label: PROCESS_STAGE_LABELS[v] || v })),
      optQuality: uniqTxt(batchList.map(b => b?.quality_status)).map(v => ({ value: v, label: QUALITY_STATUS_MAP[v]?.label || v })),
      optHealth: uniqTxt(batchList.map(b => b?.schedule_health)).map(v => ({ value: v, label: SCHEDULE_HEALTH_MAP[v]?.label || v })),
      optStart: monthOpts(batchList.map(b => b?.startDate)),
      optEnd: monthOpts(batchList.map(b => b?.endDate)),
      optDelivery: monthOpts(batchList.map(b => b?.deliveryDate)),
      optProgress: Array.from(new Set(batchList.map(b => String(b?.progress ?? 0))))
        .sort((a, b) => Number(a) - Number(b)).map(v => ({ value: v, label: `${v}%` })),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchList, productCatalog]);

  const clotures = batchList.filter(b => b?.cloture).length;
  const hasActiveFilters =
    filterId.length > 0 || filterProduct.length > 0 || filterClient.length > 0 || filterStep.length > 0 ||
    filterStart.length > 0 || filterEnd.length > 0 || filterDelivery.length > 0 ||
    filterQuality.length > 0 || filterHealth.length > 0 || filterProgress.length > 0;

  const handleResetFilters = () => {
    setFilterId([]);
    setFilterProduct([]);
    setFilterClient([]);
    setFilterStep([]);
    setFilterStart([]);
    setFilterEnd([]);
    setFilterDelivery([]);
    setFilterQuality([]);
    setFilterHealth([]);
    setFilterProgress([]);
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
        if (s && s.applicable && s.status === 'A_ENVOYER') testsCount++;
      });
    }
  });

  const avgRejection = rejectCount ? (totalRejection / rejectCount).toFixed(1) + '%' : '-';

  // Apply filters to batches
  const filteredBatches = batchList.filter(b => {
    if (!b) return false;
    // Les lots clôturés sont archivés : masqués sauf demande explicite.
    if (b.cloture && !afficherClotures) return false;

    // Filtre = liste vide → tout passe ; sinon la valeur du lot doit être cochée.
    const matchesId = filterId.length === 0 || filterId.includes(b.id);
    const matchesProduct = filterProduct.length === 0 || filterProduct.includes(productTypeOf(b));
    const matchesClient = filterClient.length === 0 || filterClient.includes(b.client);
    const matchesStep = filterStep.length === 0 || filterStep.includes(b.process_stage);
    const matchesStart = filterStart.length === 0 || filterStart.includes(monthKey(b.startDate));
    const matchesEnd = filterEnd.length === 0 || filterEnd.includes(monthKey(b.endDate));
    const matchesDelivery = filterDelivery.length === 0 || filterDelivery.includes(monthKey(b.deliveryDate));
    const matchesQuality = filterQuality.length === 0 || filterQuality.includes(b.quality_status);
    const matchesHealth = filterHealth.length === 0 || filterHealth.includes(b.schedule_health);
    const matchesProgress = filterProgress.length === 0 || filterProgress.includes(String(b.progress ?? 0));

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
    <div className="p-4 sm:p-6 lg:p-8 flex-1 overflow-y-auto bg-slate-50">
      <div className="grid grid-cols-4 gap-6 mb-8">
        <KpiCard title="EN PRODUCTION" value={activeBatches} sub="Lots actifs" />
        <KpiCard title="ALERTES" value={riskBatches} sub="Critiques" valueColor="text-red-500" />
        <KpiCard title="TAUX REJET MOYEN" value={avgRejection} sub="Basé sur Mirage" />
        <KpiCard title="TESTS EN COURS" value={testsCount} sub="Qualité externe" />
      </div>

      <div className="flex items-center justify-end mb-2">
        <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
          <input type="checkbox" checked={afficherClotures} onChange={e => setAfficherClotures(e.target.checked)} className="h-4 w-4" />
          Afficher les lots clôturés
          {clotures > 0 && <span className="text-xs text-slate-400">({clotures})</span>}
        </label>
      </div>
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[1000px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                {renderHeader('Lot', 'id', 'min-w-[8rem] whitespace-nowrap')}
                {renderHeader('Type de produit', 'product')}
                {renderHeader('Client', 'client', 'w-40')}
                {renderHeader('Début Fab.', 'startDate', 'w-36')}
                {renderHeader('Fin Fab.', 'endDate', 'w-36')}
                {renderHeader('Livraison Souhaitée', 'deliveryDate', 'w-36')}
                {renderHeader('Étape', 'step', 'w-40')}
                {renderHeader('Statut qualité', 'quality', 'w-32')}
                {renderHeader('OTD', 'health', 'w-28')}
                <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider w-24 text-center">Jalons</th>
                {renderHeader('Progression', 'progress', 'w-32')}
                <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider w-28 text-right" title="Conformes ÷ conditionnement du produit">Boîtes produites</th>
                <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider w-32">Responsable</th>
                <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider w-28" title="Depuis combien de temps le lot est à cette étape">Depuis</th>
              </tr>
              <tr className="bg-slate-50/50 border-b border-slate-200">
                <th className="py-2 px-3"><ColumnFilter options={optId} selected={filterId} onChange={setFilterId} placeholder="Tous" /></th>
                <th className="py-2 px-3"><ColumnFilter options={optProduct} selected={filterProduct} onChange={setFilterProduct} placeholder="Tous" /></th>
                <th className="py-2 px-3"><ColumnFilter options={optClient} selected={filterClient} onChange={setFilterClient} placeholder="Tous" /></th>
                <th className="py-2 px-3"><ColumnFilter options={optStart} selected={filterStart} onChange={setFilterStart} placeholder="Tous" /></th>
                <th className="py-2 px-3"><ColumnFilter options={optEnd} selected={filterEnd} onChange={setFilterEnd} placeholder="Tous" /></th>
                <th className="py-2 px-3"><ColumnFilter options={optDelivery} selected={filterDelivery} onChange={setFilterDelivery} placeholder="Tous" /></th>
                <th className="py-2 px-3"><ColumnFilter options={optStep} selected={filterStep} onChange={setFilterStep} placeholder="Tous" /></th>
                <th className="py-2 px-3"><ColumnFilter options={optQuality} selected={filterQuality} onChange={setFilterQuality} placeholder="Tous" /></th>
                <th className="py-2 px-3"><ColumnFilter options={optHealth} selected={filterHealth} onChange={setFilterHealth} placeholder="Tous" /></th>
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
                <th className="py-2 px-3"><ColumnFilter options={optProgress} selected={filterProgress} onChange={setFilterProgress} placeholder="Tous" /></th>
                <th className="py-2 px-3"></th>
                <th className="py-2 px-3"></th>
                <th className="py-2 px-3"></th>
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
                      className={cn('border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors', b.cloture && 'bg-slate-50/70 text-slate-400')}
                    >
                      <td className={cn('py-3 px-4 font-bold', b.cloture ? 'text-slate-400' : 'text-blue-600')}>
                        <div className="flex items-center gap-1.5 whitespace-nowrap">
                          {b.cloture && <span title="Lot clôturé">🔒</span>}
                          <span className="whitespace-nowrap">{b.id}</span>
                          <SampleMilestonesIcons batch={b} />
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-medium text-slate-800">{productCatalog.find(p => p.ref === b.reference)?.type || b.product || '—'}</span>
                      </td>
                      <td className="py-3 px-4 text-slate-600">{b.client || ''}</td>
                      <td className="py-3 px-4 text-slate-600 font-mono text-xs">{formatDate(b.startDate)}</td>
                      <td className={cn("py-3 px-4 font-mono text-xs", dateUrgencyClass(b.endDate) || 'text-slate-600')}>{formatDate(b.endDate)}</td>
                      <td className={cn("py-3 px-4 font-mono text-xs", dateUrgencyClass(b.deliveryDate) || 'text-slate-600')}>{formatDate(b.deliveryDate)}</td>
                      <td className="py-3 px-4">
                        <span className={cn("inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border", PROCESS_STAGE_COLOR[b.process_stage] || 'bg-slate-100 text-slate-700 border-slate-200')}>
                          {step}
                        </span>
                      </td>
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
                      <td className="py-3 px-4 text-center">
                        <ProductionMilestonesDots batch={b} flux={fluxConfig[b.fluxKey]} />
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
                      <td className="py-3 px-4 text-right tabular-nums">
                        {(() => {
                          const bo = boitesProduites(b, productCatalog as any);
                          if (bo.valeur === null) return <span className="text-slate-300">—</span>;
                          return (
                            <span className="font-semibold text-slate-700" title={bo.forcee ? 'Valeur corrigée à la main' : `Calcul : ${b.conform} ${bo.contenant} ÷ ${bo.condit} par boîte`}>
                              {bo.valeur.toLocaleString('fr-FR')}{bo.forcee && <span className="text-amber-500 ml-0.5">*</span>}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="py-3 px-4 text-slate-600 text-sm">
                        {b.responsable ? b.responsable : <span className="text-slate-300">non assigné</span>}
                        {b.blocage_motif && <div className="text-[11px] text-red-600 truncate max-w-[8rem]" title={b.blocage_motif}>⛔ {b.blocage_motif}</div>}
                      </td>
                      <td className="py-3 px-4">
                        {(() => {
                          const a = ageEtapeLot(b.stage_since);
                          return <span className={cn('text-xs font-semibold', a.j == null ? 'text-slate-400' : a.j >= 21 ? 'text-red-600' : a.j >= 10 ? 'text-amber-600' : 'text-slate-500')}>{a.texte}</span>;
                        })()}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={14} className="py-8 text-center text-sm text-slate-400">
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

// Filtre de colonne à choix multiple : menu déroulant à cases + recherche (façon Excel).
// Liste vide = aucun filtre (tout s'affiche). Se ferme au clic extérieur.
function ColumnFilter({ options, selected, onChange, placeholder }: {
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  const shown = options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()));
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v]);
  const allShownChecked = shown.length > 0 && shown.every(o => selected.includes(o.value));
  const toggleAll = () => {
    if (allShownChecked) onChange(selected.filter(s => !shown.some(o => o.value === s)));
    else onChange(Array.from(new Set([...selected, ...shown.map(o => o.value)])));
  };
  const active = selected.length > 0;
  return (
    <div ref={ref} className="relative font-normal">
      <button
        onClick={() => setOpen(o => !o)}
        className={cn(
          "w-full flex items-center justify-between gap-1 border rounded px-2 py-1 text-xs bg-white hover:bg-slate-50 transition-colors",
          active ? "border-blue-400 text-blue-700" : "border-slate-200 text-slate-500"
        )}
      >
        <span className="truncate">{active ? `${selected.length} choisi${selected.length > 1 ? 's' : ''}` : placeholder}</span>
        <ChevronDown className={cn("w-3 h-3 shrink-0 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="absolute z-40 mt-1 left-0 w-56 max-h-72 overflow-hidden bg-white border border-slate-200 rounded-lg shadow-lg flex flex-col">
          <div className="p-2 border-b border-slate-100">
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Rechercher..."
              className="w-full border border-slate-200 rounded px-2 py-1 text-xs outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div className="flex items-center justify-between px-2 py-1 border-b border-slate-100 text-[11px]">
            <button onClick={toggleAll} className="text-blue-600 hover:underline">{allShownChecked ? 'Tout décocher' : 'Tout cocher'}</button>
            {active && <button onClick={() => onChange([])} className="text-slate-400 hover:text-red-500">Réinitialiser</button>}
          </div>
          <div className="overflow-auto p-1">
            {shown.length === 0 && <div className="px-2 py-2 text-xs text-slate-400">Aucune valeur</div>}
            {shown.map(o => (
              <label key={o.value} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-slate-50 cursor-pointer text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={selected.includes(o.value)}
                  onChange={() => toggle(o.value)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500/30"
                />
                <span className="truncate">{o.label}</span>
              </label>
            ))}
          </div>
        </div>
      )}
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
