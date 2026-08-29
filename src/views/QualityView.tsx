import React, { useState, useEffect } from 'react';
import { AlertTriangle, Timer, Save, Check, Pencil } from 'lucide-react';
import { useAppContext } from '../AppContext';
import { cn } from '../utils/cn';
import { SAMPLE_TESTS, computeSampleDelays, formatDate } from '../constants';
import { Batch, SampleConfig } from '../types';
import { ProductionYieldView } from './ProductionYieldView';

const DELAY_TYPE_LABELS: Record<string, string> = {
  RECEPTION: 'Envoi/réception en retard',
  RESULTATS: 'Résultats en retard'
};

// Lead time réel d'un test = jours calendaires entre l'envoi des échantillons et la réception du rapport.
function daysBetween(from?: string, to?: string): number | null {
  if (!from || !to) return null;
  const a = new Date(from), b = new Date(to);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return null;
  const d = Math.round((b.getTime() - a.getTime()) / 86400000);
  return d < 0 ? null : d;   // réception avant envoi = saisie erronée, on ignore
}
function daysSince(from?: string): number | null {
  if (!from) return null;
  const a = new Date(from);
  if (isNaN(a.getTime())) return null;
  // Les dates DB sont parsées en UTC minuit ; comparer à aujourd'hui en UTC pour éviter un décalage ±1 j.
  const now = new Date();
  const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((todayUTC - a.getTime()) / 86400000);
}

type LtRow = {
  batchId: string;
  product: string;
  testKey: string;
  testLabel: string;
  partner: string;
  dateEnvoi: string;
  dateRecus?: string;
  target: number;
  lt: number | null;        // lead time réel (reçu) ou null
  elapsed: number | null;   // jours écoulés si non reçu
  received: boolean;
  state: 'ontime' | 'late' | 'progress' | 'progress_late';
};

interface QualityViewProps {
  onOpenBatch: (id: string) => void;
}

export function QualityView({ onOpenBatch }: QualityViewProps) {
  const { batches, productCatalog, sampleConfig, updateSampleConfig } = useAppContext();
  const [tab, setTab] = useState<'rendement' | 'controles'>('rendement');

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
    <div className="p-4 sm:p-6 lg:p-8 flex-1 overflow-y-auto bg-slate-50">
      <div className="flex gap-1 mb-5 border-b border-slate-200">
        {([['rendement', 'Rendement de production'], ['controles', 'Contrôles & lead time']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={cn('px-4 py-2 text-sm font-medium border-b-2 -mb-px', tab === k ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700')}>{l}</button>
        ))}
      </div>

      {tab === 'rendement' && <ProductionYieldView />}

      {tab === 'controles' && (<>
      {/* Pilotage du lead time des tests externes (envoi → réception rapport) */}
      <LeadTimeSection
        batches={batches}
        sampleConfig={sampleConfig}
        updateSampleConfig={updateSampleConfig}
        onOpenBatch={onOpenBatch}
      />

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
                  <td className="py-2 px-4 font-mono text-xs text-slate-600">{formatDate(r.dueDate)}</td>
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
      </>)}
    </div>
  );
}

// ── Section Lead time des tests externes ──────────────────────────────────────
function LeadTimeSection({ batches, sampleConfig, updateSampleConfig, onOpenBatch }: {
  batches: Batch[];
  sampleConfig: SampleConfig;
  updateSampleConfig: (c: SampleConfig) => Promise<boolean>;
  onOpenBatch: (id: string) => void;
}) {
  // Construire les lignes : un test envoyé = une ligne (reçu ou en cours).
  const rows: LtRow[] = [];
  for (const b of batches) {
    if (!Array.isArray(b.samples)) continue;
    for (const s of b.samples) {
      if (!s || !s.applicable || !s.dateEnvoi) continue;
      const target = sampleConfig.analysisLeadDays?.[s.type] ?? 0;
      const hasTarget = target > 0;   // objectif non défini (0) = pas de comparaison
      const lt = s.dateResultatsRecus ? daysBetween(s.dateEnvoi, s.dateResultatsRecus) : null;
      const received = lt !== null;
      const elapsed = received ? null : daysSince(s.dateEnvoi);
      let state: LtRow['state'];
      if (received) state = (!hasTarget || (lt as number) <= target) ? 'ontime' : 'late';
      else state = (hasTarget && elapsed !== null && elapsed > target) ? 'progress_late' : 'progress';
      rows.push({
        batchId: b.id,
        product: b.product,
        testKey: s.type,
        testLabel: SAMPLE_TESTS.find(t => t.key === s.type)?.label || s.type,
        partner: s.partner,
        dateEnvoi: s.dateEnvoi,
        dateRecus: s.dateResultatsRecus,
        target,
        lt,
        elapsed,
        received,
        state,
      });
    }
  }
  // Tri : en retard d'abord, puis en cours, puis reçus ; par jours décroissants.
  const order = { progress_late: 0, late: 1, progress: 2, ontime: 3 } as const;
  rows.sort((a, b) => order[a.state] - order[b.state] || (b.lt ?? b.elapsed ?? 0) - (a.lt ?? a.elapsed ?? 0));

  // KPIs
  const receivedRows = rows.filter(r => r.received);
  const avgLt = receivedRows.length
    ? Math.round(receivedRows.reduce((s, r) => s + (r.lt as number), 0) / receivedRows.length)
    : null;
  const onTimeCount = receivedRows.filter(r => r.state === 'ontime').length;
  const onTimePct = receivedRows.length ? Math.round((onTimeCount / receivedRows.length) * 100) : null;
  const inProgress = rows.filter(r => !r.received).length;
  const lateCount = rows.filter(r => r.state === 'late' || r.state === 'progress_late').length;

  // Résumé par type de test (pour les barres LT moyen vs objectif).
  const perType = SAMPLE_TESTS.map(t => {
    const rec = receivedRows.filter(r => r.testKey === t.key);
    const avg = rec.length ? Math.round(rec.reduce((s, r) => s + (r.lt as number), 0) / rec.length) : null;
    const target = sampleConfig.analysisLeadDays?.[t.key] ?? 0;
    const late = rows.filter(r => r.testKey === t.key && (r.state === 'late' || r.state === 'progress_late')).length;
    return { key: t.key, label: t.label, avg, target, count: rec.length, late };
  });

  const STATE_BADGE: Record<LtRow['state'], { label: string; cls: string }> = {
    ontime: { label: 'Dans les délais', cls: 'bg-green-100 text-green-700 border-green-200' },
    late: { label: 'Hors délai', cls: 'bg-red-100 text-red-700 border-red-200' },
    progress: { label: 'En cours', cls: 'bg-blue-100 text-blue-700 border-blue-200' },
    progress_late: { label: 'En cours · en retard', cls: 'bg-red-100 text-red-700 border-red-200' },
  };

  return (
    <div className="mb-8">
      <div className="flex items-center gap-2 mb-4">
        <Timer className="w-5 h-5 text-blue-600" />
        <h3 className="text-lg font-semibold text-slate-800">Lead time des tests externes</h3>
        <span className="text-xs text-slate-400">envoi des échantillons → réception du rapport</span>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <Kpi label="LT moyen réel" value={avgLt !== null ? `${avgLt} j` : '—'} sub="tests reçus" />
        <Kpi label="Dans l'objectif" value={onTimePct !== null ? `${onTimePct}%` : '—'} sub={`${onTimeCount}/${receivedRows.length} reçus`} tone={onTimePct !== null && onTimePct < 80 ? 'bad' : 'ok'} />
        <Kpi label="Tests en cours" value={String(inProgress)} sub="en attente de rapport" tone="neutral" />
        <Kpi label="En retard" value={String(lateCount)} sub="au-delà de l'objectif" tone={lateCount > 0 ? 'bad' : 'ok'} />
      </div>

      {/* Objectifs paramétrables + barres par type de test */}
      <div className="grid md:grid-cols-3 gap-4 mb-4">
        <TargetEditor sampleConfig={sampleConfig} updateSampleConfig={updateSampleConfig} />
        <div className="md:col-span-2 bg-white border border-slate-200 rounded-xl shadow-sm p-4">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">LT moyen réel vs objectif</div>
          <div className="space-y-3">
            {perType.map(pt => {
              const pct = pt.avg !== null && pt.target > 0 ? Math.min((pt.avg / pt.target) * 100, 130) : 0;
              const over = pt.avg !== null && pt.target > 0 && pt.avg > pt.target;
              return (
                <div key={pt.key}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-700 font-medium">{pt.label}</span>
                    <span className={cn('font-semibold', over ? 'text-red-600' : 'text-slate-600')}>
                      {pt.avg !== null ? `${pt.avg} j` : '— '} <span className="text-slate-400 font-normal">/ objectif {pt.target > 0 ? `${pt.target} j` : 'non défini'} · {pt.count} reçu{pt.count > 1 ? 's' : ''}{pt.late ? ` · ${pt.late} en retard` : ''}</span>
                    </span>
                  </div>
                  <div className="relative h-2.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className={cn('h-full rounded-full transition-all', over ? 'bg-red-500' : 'bg-green-500')} style={{ width: `${pct}%` }} />
                    {/* Repère de l'objectif à 100% de la cible (position relative au cap 130%) */}
                    <div className="absolute top-0 bottom-0 w-0.5 bg-slate-500/60" style={{ left: `${(100 / 130) * 100}%` }} title={`Objectif ${pt.target} j`} />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="text-[11px] text-slate-400 mt-3">Le trait vertical marque l'objectif. Barre verte = dans les délais, rouge = au-delà.</div>
        </div>
      </div>

      {/* Détail par lot */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 text-sm font-semibold text-slate-700">
          Détail par lot <span className="text-xs font-normal text-slate-400">({rows.length})</span>
        </div>
        {rows.length === 0 ? (
          <div className="px-4 py-4 text-sm text-slate-400">Aucun test envoyé pour le moment.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[820px]">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="py-2 px-4">Lot</th>
                  <th className="py-2 px-4">Test</th>
                  <th className="py-2 px-4">Envoi</th>
                  <th className="py-2 px-4">Réception rapport</th>
                  <th className="py-2 px-4 text-right">LT réel</th>
                  <th className="py-2 px-4 text-right">Objectif</th>
                  <th className="py-2 px-4 text-right">Écart</th>
                  <th className="py-2 px-4">Statut</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const badge = STATE_BADGE[r.state];
                  const shown = r.received ? (r.lt as number) : r.elapsed;
                  const ecart = shown !== null && r.target > 0 ? shown - r.target : null;
                  return (
                    <tr key={`${r.batchId}-${r.testKey}-${i}`} onClick={() => onOpenBatch(r.batchId)}
                      className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors">
                      <td className="py-2 px-4 font-semibold text-slate-800">{r.batchId}</td>
                      <td className="py-2 px-4 text-slate-700">{r.testLabel}</td>
                      <td className="py-2 px-4 font-mono text-xs text-slate-600">{formatDate(r.dateEnvoi)}</td>
                      <td className="py-2 px-4 font-mono text-xs text-slate-600">{r.received ? formatDate(r.dateRecus) : <span className="text-slate-400 italic">en attente</span>}</td>
                      <td className={cn('py-2 px-4 text-right font-bold tabular-nums', r.state === 'late' || r.state === 'progress_late' ? 'text-red-600' : 'text-slate-700')}>
                        {shown !== null ? `${shown} j` : '—'}{!r.received && shown !== null ? ' *' : ''}
                      </td>
                      <td className="py-2 px-4 text-right tabular-nums text-slate-500">{r.target > 0 ? `${r.target} j` : '—'}</td>
                      <td className={cn('py-2 px-4 text-right font-semibold tabular-nums', ecart !== null && ecart > 0 ? 'text-red-600' : ecart !== null && ecart <= 0 ? 'text-green-600' : 'text-slate-400')}>
                        {ecart !== null ? (ecart > 0 ? `+${ecart}` : ecart) + ' j' : '—'}
                      </td>
                      <td className="py-2 px-4">
                        <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border', badge.cls)}>{badge.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-4 py-2 text-[11px] text-slate-400 border-t border-slate-100">* pour un test en cours, la colonne « LT réel » affiche les jours déjà écoulés depuis l'envoi.</div>
      </div>
    </div>
  );
}

// Éditeur des objectifs de lead time par type de test (sauvegarde dans sampleConfig).
function TargetEditor({ sampleConfig, updateSampleConfig }: {
  sampleConfig: SampleConfig;
  updateSampleConfig: (c: SampleConfig) => Promise<boolean>;
}) {
  const [edit, setEdit] = useState(false);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (edit) return;   // ne pas écraser une saisie en cours si le contexte se rafraîchit
    const init: Record<string, string> = {};
    SAMPLE_TESTS.forEach(t => { init[t.key] = String(sampleConfig.analysisLeadDays?.[t.key] ?? 0); });
    setVals(init);
  }, [sampleConfig, edit]);

  const save = async () => {
    setSaving(true);
    const analysisLeadDays = { ...sampleConfig.analysisLeadDays };
    SAMPLE_TESTS.forEach(t => {
      const n = parseInt(vals[t.key], 10);
      if (!isNaN(n) && n >= 0) analysisLeadDays[t.key] = n;
    });
    const ok = await updateSampleConfig({ ...sampleConfig, analysisLeadDays });
    setSaving(false);
    if (ok) { setEdit(false); setSaved(true); setTimeout(() => setSaved(false), 4000); }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Objectifs (jours)</div>
        {!edit ? (
          <button onClick={() => setEdit(true)} className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"><Pencil className="w-3 h-3" /> Ajuster</button>
        ) : (
          <button onClick={save} disabled={saving} className="inline-flex items-center gap-1 text-xs font-medium text-white bg-blue-600 rounded px-2 py-1 hover:bg-blue-700 disabled:opacity-50">
            <Save className="w-3 h-3" /> {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        )}
      </div>
      <div className="space-y-2">
        {SAMPLE_TESTS.map(t => (
          <div key={t.key} className="flex items-center justify-between gap-2">
            <span className="text-sm text-slate-700">{t.label}</span>
            {edit ? (
              <div className="flex items-center gap-1">
                <input
                  type="number" min={0}
                  value={vals[t.key] ?? ''}
                  onChange={e => setVals(v => ({ ...v, [t.key]: e.target.value }))}
                  className="w-16 border border-slate-300 rounded px-2 py-1 text-sm text-right outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
                <span className="text-xs text-slate-400">j</span>
              </div>
            ) : (
              <span className="text-sm font-semibold text-slate-800 tabular-nums">{sampleConfig.analysisLeadDays?.[t.key] ?? 0} j</span>
            )}
          </div>
        ))}
      </div>
      {saved && <div className="mt-3 flex items-center gap-1 text-xs text-green-600"><Check className="w-3.5 h-3.5" /> Objectifs enregistrés.</div>}
    </div>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'ok' | 'bad' | 'neutral' }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">{label}</div>
      <div className={cn('text-2xl font-bold', tone === 'bad' ? 'text-red-600' : tone === 'ok' ? 'text-green-600' : 'text-slate-900')}>{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}
