import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../AuthContext';
import { cn } from '../utils/cn';
import { RefreshCw, Save, Check, AlertTriangle, ChevronDown, Trash2, Plus } from 'lucide-react';
import { DEFAULT_COGS_FILLER_MODELS, computeCogsFiller, allCodes, TANKS, FillerModel, CampaignLine, Tank } from '../cogsFiller';

const API_URL = import.meta.env.VITE_API_URL || '';
const eur = (n: number) => (n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const int = (n: number) => Math.round(n || 0).toLocaleString('fr-FR');
const num = (v: any) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isNaN(n) ? 0 : n; };

export function CogsFillerView() {
  const { token, canEdit } = useAuth();
  const headers = useMemo(() => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }), [token]);

  const [models, setModels] = useState<FillerModel[]>(DEFAULT_COGS_FILLER_MODELS);
  const [gamme, setGamme] = useState('LOUNA');
  const [lines, setLines] = useState<CampaignLine[]>([]);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [pricesLoading, setPricesLoading] = useState(false);
  const [pricesLoaded, setPricesLoaded] = useState(false);
  const [showParams, setShowParams] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const model = models.find(m => m.gamme === gamme) || models[0];

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API_URL}/api/settings/cogsFillerModels`, { headers });
        if (r.ok) { const d = await r.json(); if (Array.isArray(d) && d.length) setModels(d); }
      } catch { /* défauts */ }
    })();
  }, [headers]);

  const loadPrices = useCallback(async () => {
    if (!model) return;
    setPricesLoading(true);
    try {
      const codes = allCodes(model).join(',');
      const r = await fetch(`${API_URL}/api/cogs-filler/prices?codes=${encodeURIComponent(codes)}`, { headers });
      if (r.ok) { const d = await r.json(); setPrices(d.prices || {}); setPricesLoaded(true); }
    } finally { setPricesLoading(false); }
  }, [model, headers]);
  useEffect(() => { loadPrices(); }, [loadPrices]);

  const effPrices = useMemo(() => {
    const p: Record<string, number> = { ...prices };
    for (const [k, v] of Object.entries(overrides)) if (String(v).trim() !== '') p[k] = num(v);
    return p;
  }, [prices, overrides]);

  const result = useMemo(() => model ? computeCogsFiller(model, lines, effPrices) : null, [model, lines, effPrices]);

  // Lignes de campagne — F8.4 : taille de lot par défaut = 1000 boîtes (Louna Filler + Essentyal).
  const DEFAULT_CAMPAIGN_BOXES = 1000;
  const addLine = () => setLines(ls => [...ls, { variant: model.variants[0]?.code || '', boxes: DEFAULT_CAMPAIGN_BOXES, tank: 'auto' }]);
  const setLine = (i: number, patch: Partial<CampaignLine>) => setLines(ls => ls.map((l, j) => j === i ? { ...l, ...patch } : l));
  const removeLine = (i: number) => setLines(ls => ls.filter((_, j) => j !== i));
  const switchGamme = (g: string) => { setGamme(g); setLines([]); };   // on repart d'une campagne vide (variants différents)

  const patchModel = (patch: Partial<FillerModel>) => setModels(prev => prev.map(m => m.gamme === gamme ? { ...m, ...patch } : m));
  const setVariant = (vi: number, patch: Partial<FillerModel['variants'][number]>) =>
    patchModel({ variants: model.variants.map((x, j) => j === vi ? { ...x, ...patch } : x) });
  const setAc = (vi: number, li: number, patch: Partial<FillerModel['variants'][number]['ac'][number]>) =>
    setVariant(vi, { ac: model.variants[vi].ac.map((l, j) => j === li ? { ...l, ...patch } : l) });
  const addVariant = () => patchModel({ variants: [...model.variants, { code: `VAR${model.variants.length + 1}`, label: 'Nouveau variant', pr: {}, pnr: {}, ac: [] }] });
  const removeVariant = (vi: number) => {
    if (!confirm(`Supprimer le variant « ${model.variants[vi]?.label} » ?`)) return;
    patchModel({ variants: model.variants.filter((_, j) => j !== vi) });
  };
  const saveModels = async () => {
    setSaving(true);
    try {
      const r = await fetch(`${API_URL}/api/settings/cogsFillerModels`, { method: 'PUT', headers, body: JSON.stringify(models) });
      if (r.ok) { setSaved(true); setTimeout(() => setSaved(false), 4000); }
    } finally { setSaving(false); }
  };

  if (!model || !result) return null;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex gap-1 bg-white border border-slate-200 rounded-lg p-1">
          {models.map(m => (
            <button key={m.gamme} onClick={() => switchGamme(m.gamme)}
              className={cn('px-4 py-1.5 text-sm font-medium rounded-md', gamme === m.gamme ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100')}>{m.label}</button>
          ))}
        </div>
        <button onClick={loadPrices} disabled={pricesLoading} className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50">
          <RefreshCw className={cn('w-4 h-4', pricesLoading && 'animate-spin')} /> Rafraîchir les prix Odoo
        </button>
      </div>

      {/* Campagne = lignes libres : variant + boîtes + cuve (auto ou imposée). Un variant peut revenir plusieurs fois. */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-semibold text-slate-700">Campagne — lignes de production</h3>
          <button onClick={addLine} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"><Plus className="w-4 h-4" /> Ajouter une ligne</button>
        </div>
        <p className="text-xs text-slate-400 mb-3">Choisis le variant, le nombre de boîtes et la cuve (« Auto » = la plus petite qui couvre la demande). Le même variant peut être ajouté plusieurs fois avec des cuves différentes.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead><tr className="text-left text-[11px] uppercase text-slate-500 border-b border-slate-200">
              <th className="px-3 py-2 min-w-[240px] align-bottom">Variant</th><th className="px-3 py-2 w-28 align-bottom">Boîtes</th>
              <th className="px-3 py-2 w-24 text-center align-bottom">Cuve<br/>(auto)</th><th className="px-3 py-2 w-28 align-bottom">Cuve<br/>(manu)</th>
              <VHead label="Qté PR (g)" /><VHead label="Qté PNR (g)" /><VHead label="Sg réparties" /><VHead label="Sg conformes" />
              <VHead label="Boîtes produites" /><VHead label="Surplus" /><VHead label="COGS / boîte" /><th className="px-1 py-2"></th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {lines.length === 0 && <tr><td colSpan={12} className="px-3 py-6 text-center text-slate-400">Aucune ligne. Clique « Ajouter une ligne » pour composer ta campagne.</td></tr>}
              {lines.map((l, i) => {
                const rv = result.perLine[i];
                const v = model.variants.find(x => x.code === l.variant);
                const validTanks = v ? TANKS.filter(t => v.pr[t] != null || v.pnr[t] != null) : [];
                return (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="px-3 py-2">
                      <select className="w-full text-sm border border-slate-300 rounded px-2 py-1 outline-none focus:border-blue-500" value={l.variant} onChange={e => setLine(i, { variant: e.target.value })}>
                        {model.variants.map((vv, j) => <option key={j} value={vv.code}>{vv.label}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2"><input type="number" min={0} className="w-full text-sm border border-slate-300 rounded px-2 py-1 outline-none focus:border-blue-500"
                      value={l.boxes || ''} onChange={e => setLine(i, { boxes: num(e.target.value) })} placeholder="0" /></td>
                    <td className="px-3 py-2 text-center">
                      {rv?.valid ? <span className="inline-block text-xs font-semibold bg-slate-100 text-slate-600 rounded px-2 py-1">{rv.autoTank}</span> : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-3 py-2">
                      <select className="w-full text-sm border border-slate-300 rounded px-2 py-1 outline-none focus:border-blue-500" value={l.tank && l.tank !== 'auto' ? l.tank : ''} onChange={e => setLine(i, { tank: e.target.value ? e.target.value as Tank : 'auto' })}>
                        <option value="">— (auto)</option>
                        {validTanks.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">{rv?.valid ? int(rv.gelPR) : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">{rv?.valid ? int(rv.gelPNR) : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">{rv?.valid ? int(rv.sgReparti) : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">{rv?.valid ? int(rv.sgConforme) : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-800">{rv?.valid ? int(rv.boxesProduced) : '—'}</td>
                    <td className={cn('px-3 py-2 text-right tabular-nums font-medium', rv?.valid && rv.surplus > 0 ? 'text-amber-600' : 'text-slate-400')}>{rv?.valid ? (rv.surplus > 0 ? `+${int(rv.surplus)}` : '0') : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-blue-700">{rv?.valid ? eur(rv.cogsBox) : '—'}</td>
                    <td className="px-3 py-2 text-center"><button onClick={() => removeLine(i)} title="Supprimer la ligne" className="text-slate-300 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button></td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold text-slate-800">
                <td className="px-3 py-2">TOTAL</td>
                <td className="px-3 py-2 tabular-nums">{int(result.totalBoxesDemanded)}</td>
                <td className="px-3 py-2 text-center text-slate-400">—</td>
                <td className="px-3 py-2 text-center text-slate-400">—</td>
                <td className="px-3 py-2 text-right tabular-nums">{int(result.totalPR)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{int(result.totalPNR)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{int(result.totalSgReparti)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{int(result.totalSgConforme)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{int(result.totalBoxesProduced)}</td>
                <td className={cn('px-3 py-2 text-right tabular-nums', result.totalSurplus > 0 ? 'text-amber-600' : 'text-slate-400')}>{result.totalSurplus > 0 ? `+${int(result.totalSurplus)}` : '0'}</td>
                <td className="px-3 py-2 text-right tabular-nums text-blue-700">{result.totalBoxesProduced ? eur(result.cogsBox) : '—'}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Phases à lancer + reste de gel */}
      {(result.runsPR > 0 || result.runsPNR > 0) && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Phases à lancer pour cette campagne</h3>
          <div className="grid md:grid-cols-2 gap-4">
            <PhaseCard title="Phase réticulée (PR)" sub="gel BDDE-crosslinked" runs={result.runsPR}
              produced={result.producedPR} needed={result.totalPR} residual={result.residualPR} color="blue" />
            <PhaseCard title="Phase non-réticulée (PNR)" sub="HA linéaire (PBS)" runs={result.runsPNR}
              produced={result.producedPNR} needed={result.totalPNR} residual={result.residualPNR} color="violet" />
          </div>
          <p className="text-[11px] text-slate-400 mt-3">Les runs de formulation sont arrondis au-dessus : le « reste » est le gel produit en plus de la campagne, disponible pour un lot suivant.</p>
        </div>
      )}

      {/* Alerte surplus global */}
      {result.totalSurplus > 0 && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div><b>{int(result.totalSurplus)} boîte(s) en surplus</b> — la taille de cuve produit plus que la demande ({int(result.totalBoxesProduced)} produites pour {int(result.totalBoxesDemanded)} demandées). Ce surplus est mis à disposition (stock).</div>
        </div>
      )}

      {/* Alerte prix manquants */}
      {pricesLoaded && result.missingCodes.length > 0 && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-800">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div><b>{result.missingCodes.length} prix manquant(s) dans Odoo</b> — le COGS est sous-estimé. Codes : {result.missingCodes.join(', ')}. Saisis-les manuellement dans « Nomenclature & prix » ci-dessous.</div>
        </div>
      )}

      {/* KPIs globaux */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Kpi title="COGS / BOÎTE" value={result.totalBoxesProduced ? eur(result.cogsBox) : '—'} accent="text-blue-700" />
        <Kpi title="COGS / SERINGUE" value={result.totalSgConforme ? eur(result.cogsSg) : '—'} />
        <Kpi title="BOÎTES PRODUITES" value={int(result.totalBoxesProduced)} sub={result.totalSurplus > 0 ? `dont +${int(result.totalSurplus)} surplus` : `${int(result.totalBoxesDemanded)} demandées`} />
        <Kpi title="COGS LOT / RUNS" value={eur(result.cogsLot)} sub={`${result.runsPR} run PR · ${result.runsPNR} run PNR`} />
      </div>

      {/* Répartition du COGS */}
      <div className="grid md:grid-cols-3 gap-4">
        <CostBreak title="Matières premières (MP)" total={result.costMP} lot={result.cogsLot} lines={result.mp} />
        <CostBreak title="Articles de conditionnement (AC)" total={result.costAC} lot={result.cogsLot} lines={result.ac} />
        <CostBreak title="Coûts process" total={result.costProcess} lot={result.cogsLot} lines={result.process} editable={canEdit}
          onEditProcess={(i, cost) => patchModel({ processCosts: model.processCosts.map((p, j) => j === i ? { ...p, cost } : p) })} model={model} />
      </div>

      {/* Panneau paramètres & nomenclature éditable */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
        <button onClick={() => setShowParams(s => !s)} className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          <span>Nomenclature & prix — paramètres éditables ({model.label})</span>
          <ChevronDown className={cn('w-4 h-4 transition-transform', showParams && 'rotate-180')} />
        </button>
        {showParams && (
          <div className="border-t border-slate-100 p-4 space-y-5">
            <div>
              <div className="text-xs font-semibold text-slate-500 uppercase mb-2">Rendements & paramètres maîtres</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <ParamNum label="Rdt formulation" value={model.yields.form} onChange={v => patchModel({ yields: { ...model.yields, form: v } })} disabled={!canEdit} pct />
                <ParamNum label="Rdt remplissage" value={model.yields.fill} onChange={v => patchModel({ yields: { ...model.yields, fill: v } })} disabled={!canEdit} pct />
                <ParamNum label="Rdt mirage" value={model.yields.mir} onChange={v => patchModel({ yields: { ...model.yields, mir: v } })} disabled={!canEdit} pct />
                <ParamNum label="Rdt conditionnement" value={model.yields.cond} onChange={v => patchModel({ yields: { ...model.yields, cond: v } })} disabled={!canEdit} pct />
                <ParamNum label="Gel / seringue (g)" value={model.gelMassPerSyringe} onChange={v => patchModel({ gelMassPerSyringe: v })} disabled={!canEdit} />
                <ParamNum label="Capacité run PR (g)" value={model.runYieldPR} onChange={v => patchModel({ runYieldPR: v })} disabled={!canEdit} />
                <ParamNum label="Capacité run PNR (g)" value={model.runYieldPNR} onChange={v => patchModel({ runYieldPNR: v })} disabled={!canEdit} />
                <ParamNum label="Seringues / boîte" value={model.syringesPerBox} onChange={v => patchModel({ syringesPerBox: v })} disabled={!canEdit} />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-semibold text-slate-500 uppercase">Variants & masse gel par cuve (g) — ligne 1 = PR, ligne 2 = PNR</div>
                {canEdit && <button onClick={addVariant} className="text-xs px-2 py-1 text-blue-600 hover:bg-blue-50 rounded font-medium">+ Ajouter un variant</button>}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-slate-400 border-b border-slate-200"><th className="px-2 py-1 w-56">Variant (code · libellé)</th>{TANKS.map(t => <th key={t} className="px-2 py-1 text-center">{t}</th>)}<th className="px-2 py-1"></th></tr></thead>
                  <tbody>
                    {model.variants.map((v, vi) => (
                      <React.Fragment key={vi}>
                        <tr className="border-b border-slate-50">
                          <td className="px-2 py-1 align-top" rowSpan={2}>
                            <div className="flex flex-col gap-1">
                              <input className="w-20 border border-slate-200 rounded px-1 py-0.5 font-mono font-medium" value={v.code} disabled={!canEdit} onChange={e => setVariant(vi, { code: e.target.value })} placeholder="Code" />
                              <input className="w-full border border-slate-200 rounded px-1 py-0.5" value={v.label} disabled={!canEdit} onChange={e => setVariant(vi, { label: e.target.value })} placeholder="Libellé" />
                            </div>
                          </td>
                          {TANKS.map(t => <td key={t} className="px-2 py-1"><input className="w-16 border border-slate-200 rounded px-1 py-0.5 text-center" value={v.pr[t] ?? ''} disabled={!canEdit}
                            onChange={e => setVariant(vi, { pr: { ...v.pr, [t]: num(e.target.value) } })} title="PR" /></td>)}
                          <td className="px-2 py-1 align-top" rowSpan={2}>{canEdit && <button onClick={() => removeVariant(vi)} title="Supprimer ce variant" className="text-slate-300 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>}</td>
                        </tr>
                        <tr className="border-b border-slate-100">
                          {TANKS.map(t => <td key={t} className="px-2 py-1"><input className="w-16 border border-slate-200 rounded px-1 py-0.5 text-center text-slate-500" value={v.pnr[t] ?? ''} disabled={!canEdit}
                            onChange={e => setVariant(vi, { pnr: { ...v.pnr, [t]: num(e.target.value) } })} title="PNR" /></td>)}
                        </tr>
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Conditionnement (AC) par variant */}
            <div>
              <div className="text-xs font-semibold text-slate-500 uppercase mb-2">Conditionnement (AC) propre à chaque variant — code, libellé, quantité / boîte</div>
              <div className="space-y-3">
                {model.variants.map((v, vi) => (
                  <div key={vi} className="border border-slate-100 rounded-lg p-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold text-slate-600">{v.code} — {v.label}</span>
                      {canEdit && <button onClick={() => setVariant(vi, { ac: [...v.ac, { code: '', label: '', qtyPerBox: 1, unit: 'u' }] })} className="text-[11px] px-1.5 py-0.5 text-blue-600 hover:bg-blue-50 rounded">+ ligne AC</button>}
                    </div>
                    {v.ac.length === 0 && <div className="text-[11px] text-slate-400 px-1">Aucun conditionnement propre (seul le conditionnement commun s'applique).</div>}
                    {v.ac.map((l, li) => (
                      <div key={li} className="flex items-center gap-1.5 py-0.5">
                        <input className="w-20 border border-slate-200 rounded px-1 py-0.5 text-xs font-mono" value={l.code} disabled={!canEdit} onChange={e => setAc(vi, li, { code: e.target.value })} placeholder="AC-000" />
                        <input className="flex-1 border border-slate-200 rounded px-1 py-0.5 text-xs" value={l.label} disabled={!canEdit} onChange={e => setAc(vi, li, { label: e.target.value })} placeholder="Libellé" />
                        <input type="number" className="w-14 border border-slate-200 rounded px-1 py-0.5 text-xs text-right" value={l.qtyPerBox} disabled={!canEdit} onChange={e => setAc(vi, li, { qtyPerBox: num(e.target.value) })} title="Qté / boîte" />
                        {canEdit && <button onClick={() => setVariant(vi, { ac: v.ac.filter((_, j) => j !== li) })} className="text-slate-300 hover:text-red-500"><Trash2 className="w-3 h-3" /></button>}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold text-slate-500 uppercase mb-2">Prix unitaires (Odoo standard_price, surchargeables)</div>
              <div className="overflow-x-auto max-h-72 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-slate-400 border-b border-slate-200 sticky top-0 bg-white"><th className="px-2 py-1">Code</th><th className="px-2 py-1 text-right">Prix Odoo</th><th className="px-2 py-1 text-right w-28">Surcharge</th></tr></thead>
                  <tbody>
                    {allCodes(model).map(code => (
                      <tr key={code} className="border-b border-slate-50">
                        <td className="px-2 py-1 font-mono text-slate-600">{code}</td>
                        <td className={cn('px-2 py-1 text-right tabular-nums', prices[code] == null ? 'text-red-500' : 'text-slate-500')}>{prices[code] == null ? 'manquant' : eur(prices[code])}</td>
                        <td className="px-2 py-1 text-right"><input className="w-24 border border-slate-200 rounded px-1 py-0.5 text-right" value={overrides[code] ?? ''} disabled={!canEdit}
                          onChange={e => setOverrides(o => ({ ...o, [code]: e.target.value }))} placeholder="—" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {canEdit && (
              <div className="flex items-center gap-3">
                <button onClick={saveModels} disabled={saving} className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
                  <Save className="w-4 h-4" /> {saving ? 'Enregistrement…' : 'Enregistrer les paramètres'}
                </button>
                {saved && <span className="flex items-center gap-1 text-sm text-green-600"><Check className="w-4 h-4" /> Enregistré.</span>}
                <span className="text-xs text-slate-400">Les surcharges de prix ne sont pas sauvegardées (elles servent au calcul en cours).</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PhaseCard({ title, sub, runs, produced, needed, residual, color }: {
  title: string; sub: string; runs: number; produced: number; needed: number; residual: number; color: 'blue' | 'violet';
}) {
  const ring = color === 'blue' ? 'border-blue-200 bg-blue-50' : 'border-violet-200 bg-violet-50';
  const txt = color === 'blue' ? 'text-blue-700' : 'text-violet-700';
  return (
    <div className={cn('border rounded-lg p-4', ring)}>
      <div className="flex items-baseline justify-between">
        <div><div className="text-sm font-semibold text-slate-800">{title}</div><div className="text-[11px] text-slate-500">{sub}</div></div>
        <div className={cn('text-2xl font-bold', txt)}>{runs} <span className="text-sm font-normal">run{runs > 1 ? 's' : ''} à lancer</span></div>
      </div>
      <div className="grid grid-cols-3 gap-2 mt-3 text-center">
        <div><div className="text-[10px] uppercase text-slate-400">Nécessaire</div><div className="text-sm font-medium text-slate-700 tabular-nums">{int(needed)} g</div></div>
        <div><div className="text-[10px] uppercase text-slate-400">Produit</div><div className="text-sm font-medium text-slate-700 tabular-nums">{int(produced)} g</div></div>
        <div><div className="text-[10px] uppercase text-slate-400">Reste</div><div className="text-sm font-semibold text-amber-600 tabular-nums">{int(residual)} g</div></div>
      </div>
    </div>
  );
}

// En-tête de colonne à la verticale (texte lu de bas en haut) pour compacter la largeur.
function VHead({ label }: { label: string }) {
  return (
    <th className="px-1 py-2 align-bottom">
      <div className="h-24 flex items-end justify-center">
        <span style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }} className="whitespace-nowrap leading-none">{label}</span>
      </div>
    </th>
  );
}

function Kpi({ title, value, sub, accent }: { title: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
      <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">{title}</div>
      <div className={cn('text-2xl font-bold', accent || 'text-slate-900')}>{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function CostBreak({ title, total, lot, lines, editable, onEditProcess, model }: {
  title: string; total: number; lot: number; lines: any[];
  editable?: boolean; onEditProcess?: (i: number, cost: number) => void; model?: FillerModel;
}) {
  const pct = lot > 0 ? Math.round((total / lot) * 100) : 0;
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-xs font-semibold text-slate-500 uppercase">{title}</div>
        <div className="text-sm font-bold text-slate-800">{eur(total)} <span className="text-xs font-normal text-slate-400">· {pct}%</span></div>
      </div>
      <div className="max-h-56 overflow-y-auto text-xs divide-y divide-slate-50">
        {lines.length === 0 && <div className="text-slate-400 py-2">—</div>}
        {lines.map((l, i) => (
          <div key={i} className="flex items-center justify-between gap-2 py-1">
            <span className="text-slate-600 truncate" title={l.code ? `${l.code} — ${l.label}` : l.label}>{l.label}</span>
            <span className="flex items-center gap-2 shrink-0">
              <span className="text-slate-400 tabular-nums">{Math.round(l.qty).toLocaleString('fr-FR')} {l.unit}</span>
              {editable && onEditProcess && model
                ? <input type="number" className="w-16 border border-slate-200 rounded px-1 py-0.5 text-right" value={model.processCosts[i]?.cost ?? 0} onChange={e => onEditProcess(i, num(e.target.value))} title="Coût unitaire" />
                : <span className={cn('tabular-nums font-medium', l.missingPrice ? 'text-red-500' : 'text-slate-700')}>{l.missingPrice ? '?' : eur(l.cost)}</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ParamNum({ label, value, onChange, disabled, pct }: { label: string; value: number; onChange: (v: number) => void; disabled?: boolean; pct?: boolean }) {
  return (
    <label className="block">
      <span className="text-xs text-slate-500 block mb-0.5">{label}{pct ? ' (%)' : ''}</span>
      <input type="number" step={pct ? 1 : 0.01} disabled={disabled}
        className="w-full text-sm border border-slate-300 rounded px-2 py-1 outline-none focus:border-blue-500 disabled:bg-slate-50"
        value={pct ? Math.round(value * 100) : value}
        onChange={e => { const n = num(e.target.value); onChange(pct ? n / 100 : n); }} />
    </label>
  );
}
