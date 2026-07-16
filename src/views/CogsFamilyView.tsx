import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../AuthContext';
import { cn } from '../utils/cn';
import { Plus, Trash2, Loader2, Save, Check, Lock, Unlock } from 'lucide-react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';

const API_URL = import.meta.env.VITE_API_URL || '';

// ============================================================================
// Simulateur COGS paramétrique par produit (« COGS par famille »).
// L'utilisateur change les paramètres (volume de lot, rendements, prix/quantités
// des postes) → le COGS/unité et /boîte se recalculent en direct.
// ============================================================================

interface CogsLine { label: string; category: string; qty: number; unit: string; unitPrice: number; scalable?: boolean; multiple?: number | null; }
interface CogsModel {
  id: number; code: string; family: string | null; label: string | null;
  batchL: number | null; refBatchL: number | null; volUnitMl: number | null; density: number | null; unitsPerBox: number | null;
  yBulk: number | null; yFill: number | null; yVisual: number | null; yPack: number | null;
  lines: CogsLine[]; cogsTarget: number | null; notes: string | null;
}

const CATEGORIES = ['Matières', 'CMO', 'Analytique', 'Indirect'];
const CAT_COLORS: Record<string, string> = { 'Matières': '#2563eb', 'CMO': '#7c3aed', 'Analytique': '#f59e0b', 'Indirect': '#64748b' };

const eur2 = (n: number | null) => n == null || !isFinite(n) ? '—' : n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const eur0 = (n: number | null) => n == null || !isFinite(n) ? '—' : Math.round(n).toLocaleString('fr-FR') + ' €';
const int0 = (n: number | null) => n == null || !isFinite(n) ? '—' : Math.round(n).toLocaleString('fr-FR');

// Modèle de calcul (identique pour tous les produits) :
// baseUnits = batchL*1000/(volUnitMl*density) ; conformUnits = baseUnits × 4 rendements ;
// cogsLot = Σ qty×unitPrice ; cogsUnit = cogsLot/conformUnits ; cogsBox = cogsUnit×unitsPerBox.
// Une ligne « évolutive » voit sa quantité multipliée par (taille de lot ÷ taille de référence).
// Par défaut, les lignes « Matières » (MP + AC) sont évolutives.
export function lineIsScalable(ln: CogsLine): boolean { return ln.scalable ?? (ln.category === 'Matières'); }
export function batchScale(m: CogsModel): number {
  const ref = m.refBatchL || m.batchL || 0;
  return (m.batchL && ref) ? m.batchL / ref : 1;
}
export function effQty(ln: CogsLine, scale: number): number {
  const raw = (Number(ln.qty) || 0) * (lineIsScalable(ln) ? scale : 1);
  // « Multiple » (conditionnement, ex. sachets stériles) : la consommation est arrondie au pack supérieur.
  const mult = Number(ln.multiple) || 0;
  return mult > 0 ? Math.ceil(raw / mult) * mult : raw;
}
function calcModel(m: CogsModel) {
  const density = m.density || 1;
  const baseUnits = (m.batchL && m.volUnitMl) ? m.batchL * 1000 / (m.volUnitMl * density) : 0;
  const conformUnits = baseUnits * (m.yBulk ?? 1) * (m.yFill ?? 1) * (m.yVisual ?? 1) * (m.yPack ?? 1);
  const boxes = m.unitsPerBox ? conformUnits / m.unitsPerBox : 0;
  const scale = batchScale(m);
  const byCat: Record<string, number> = {};
  let cogsLot = 0;
  for (const ln of m.lines || []) {
    const c = effQty(ln, scale) * (Number(ln.unitPrice) || 0);
    byCat[ln.category] = (byCat[ln.category] || 0) + c;
    cogsLot += c;
  }
  const cogsUnit = conformUnits > 0 ? cogsLot / conformUnits : null;
  const cogsBox = (cogsUnit != null && m.unitsPerBox) ? cogsUnit * m.unitsPerBox : null;
  return { baseUnits, conformUnits, boxes, byCat, cogsLot, cogsUnit, cogsBox, scale };
}

export function CogsFamilyView() {
  const { token, socket, canEdit } = useAuth();
  const [models, setModels] = useState<CogsModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [selCode, setSelCode] = useState<string | null>(null);
  const [draft, setDraft] = useState<CogsModel | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [realCogs, setRealCogs] = useState<Record<string, number>>({});
  // F8 : la taille de lot de référence est figée par défaut (lecture seule) ; on peut la défiger pour l'éditer.
  const [refUnlocked, setRefUnlocked] = useState(false);
  useEffect(() => { setRefUnlocked(false); }, [selCode]);

  const load = useCallback(async () => {
    if (!token) return;
    const r = await fetch(`${API_URL}/api/cogs/models`, { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) { const d = await r.json(); setModels(d.models || []); }
    setLoading(false);
  }, [token]);

  // COGS réel du Cockpit : moyenne pondérée Σ coûts / Σ unités vendues des lots par code produit.
  const loadReal = useCallback(async () => {
    if (!token) return;
    const r = await fetch(`${API_URL}/api/cockpit/data`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return;
    const d = await r.json();
    const agg: Record<string, { costs: number; sold: number }> = {};
    for (const l of d.lots || []) {
      if (!l.productCode || !l.unitsSold) continue;
      const total = Object.values(l.costs || {}).reduce((a: number, b: any) => a + (Number(b) || 0), 0) as number;
      const g = agg[l.productCode] || { costs: 0, sold: 0 };
      g.costs += total; g.sold += l.unitsSold; agg[l.productCode] = g;
    }
    const out: Record<string, number> = {};
    for (const [code, g] of Object.entries(agg)) if (g.sold > 0) out[code] = g.costs / g.sold;
    setRealCogs(out);
  }, [token]);

  useEffect(() => { load(); loadReal(); }, [load, loadReal]);
  useEffect(() => {
    if (!socket) return;
    const h = () => { load(); loadReal(); };
    socket.on('cockpit:changed', h);
    return () => { socket.off('cockpit:changed', h); };
  }, [socket, load, loadReal]);

  // Sélection par défaut + copie éditable locale (ne pas écraser des modifications en cours).
  useEffect(() => {
    if (!models.length) return;
    const code = selCode && models.some(m => m.code === selCode) ? selCode : models[0].code;
    if (code !== selCode) setSelCode(code);
    if (!dirty) {
      const m = models.find(x => x.code === code);
      if (m) { const c = JSON.parse(JSON.stringify(m)); if (c.refBatchL == null) c.refBatchL = c.batchL; setDraft(c); }
    }
  }, [models, selCode, dirty]);

  const selectProduct = (code: string) => {
    if (dirty && !confirm('Modifications non enregistrées — changer de produit sans enregistrer ?')) return;
    setSelCode(code);
    setDirty(false);
    const m = models.find(x => x.code === code);
    if (m) { const c = JSON.parse(JSON.stringify(m)); if (c.refBatchL == null) c.refBatchL = c.batchL; setDraft(c); }
  };

  const upd = (patch: Partial<CogsModel>) => { if (!draft) return; setDraft({ ...draft, ...patch }); setDirty(true); };
  const updLine = (idx: number, patch: Partial<CogsLine>) => {
    if (!draft) return;
    const lines = draft.lines.map((ln, i) => i === idx ? { ...ln, ...patch } : ln);
    setDraft({ ...draft, lines }); setDirty(true);
  };
  const addLine = (category: string) => {
    if (!draft) return;
    setDraft({ ...draft, lines: [...draft.lines, { label: 'Nouveau poste', category, qty: 0, unit: '', unitPrice: 0, scalable: category === 'Matières' }] });
    setDirty(true);
  };
  const delLine = (idx: number) => {
    if (!draft) return;
    setDraft({ ...draft, lines: draft.lines.filter((_, i) => i !== idx) }); setDirty(true);
  };

  const save = async () => {
    if (!draft) return;
    const r = await fetch(`${API_URL}/api/cogs/models/${draft.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        label: draft.label, batchL: draft.batchL, refBatchL: draft.refBatchL, volUnitMl: draft.volUnitMl, density: draft.density, unitsPerBox: draft.unitsPerBox,
        yBulk: draft.yBulk, yFill: draft.yFill, yVisual: draft.yVisual, yPack: draft.yPack,
        cogsTarget: draft.cogsTarget, lines: draft.lines,
      }),
    });
    if (r.ok) {
      setDirty(false); setSaved(true); setTimeout(() => setSaved(false), 2500);
      load();
    } else {
      const e = await r.json().catch(() => ({}));
      alert(e.error || 'Erreur lors de l\'enregistrement');
    }
  };

  const calc = useMemo(() => draft ? calcModel(draft) : null, [draft]);

  if (loading) return <div className="p-8 flex items-center justify-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Chargement…</div>;
  if (!models.length) return <div className="p-8 text-center text-slate-400 text-sm">Aucun modèle COGS. Le fichier cogs_seed.json est semé au 1ᵉʳ démarrage du serveur.</div>;
  if (!draft || !calc) return null;

  const real = realCogs[draft.code];
  const target = draft.cogsTarget;
  const targetTone = (target != null && calc.cogsUnit != null)
    ? (calc.cogsUnit <= target ? 'text-green-600' : calc.cogsUnit > target * 1.05 ? 'text-red-600' : 'text-amber-600')
    : 'text-slate-800';

  const catData = CATEGORIES.filter(c => (calc.byCat[c] || 0) > 0).map(c => ({ name: c, value: Math.round(calc.byCat[c] || 0) }));
  const top5 = [...draft.lines]
    .map((ln, i) => ({ label: ln.label, cout: Math.round(effQty(ln, calc?.scale ?? 1) * (Number(ln.unitPrice) || 0)), cat: ln.category, i }))
    .sort((a, b) => b.cout - a.cout).slice(0, 5);

  const inp = 'w-full text-sm border border-slate-300 rounded-md px-2 py-1.5 outline-none focus:border-blue-500 disabled:bg-slate-50 disabled:text-slate-400';
  const lbl = 'text-xs font-medium text-slate-500';
  const numV = (v: number | null) => v ?? '';
  const setNum = (k: keyof CogsModel) => (e: React.ChangeEvent<HTMLInputElement>) => upd({ [k]: e.target.value === '' ? null : Number(e.target.value) } as any);
  // Rendements : saisis en % (ex. 96), stockés en fraction (0.96).
  const yV = (v: number | null) => v == null ? '' : Math.round(v * 10000) / 100;
  const setY = (k: keyof CogsModel) => (e: React.ChangeEvent<HTMLInputElement>) => upd({ [k]: e.target.value === '' ? null : Number(e.target.value) / 100 } as any);

  return (
    <div className="space-y-4">
      {/* Sélecteur de produit + bouton Enregistrer */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5">
          {models.map(m => (
            <button key={m.code} onClick={() => selectProduct(m.code)}
              className={cn('px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors',
                m.code === draft.code ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50')}
              title={m.label || ''}>
              <span className="font-mono">{m.code}</span>
              <span className={cn('ml-1.5 text-xs', m.code === draft.code ? 'text-blue-100' : 'text-slate-400')}>{m.label}</span>
            </button>
          ))}
        </div>
        {canEdit && (
          <button onClick={save} disabled={!dirty}
            className={cn('ml-auto inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium',
              dirty ? 'bg-blue-600 text-white hover:bg-blue-700' : saved ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-400')}>
            {saved ? <><Check className="w-4 h-4" /> Enregistré</> : <><Save className="w-4 h-4" /> Enregistrer</>}
          </button>
        )}
      </div>

      {/* Cartes KPI (recalcul live) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">COGS / unité</div>
          <div className={cn('text-2xl font-bold', targetTone)}>{eur2(calc.cogsUnit)}</div>
          <div className="text-xs text-slate-500 mt-0.5">
            {target != null ? `Cible : ${eur2(target)}` : 'Pas de cible définie'}
            {real != null && <span className="block">COGS réel (lots) : {eur2(real)}</span>}
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">COGS / boîte ({draft.unitsPerBox ?? '—'}u)</div>
          <div className="text-2xl font-bold text-slate-900">{eur2(calc.cogsBox)}</div>
          <div className="text-xs text-slate-500 mt-0.5">{int0(calc.boxes)} boîtes / lot</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Unités conformes / lot</div>
          <div className="text-2xl font-bold text-slate-900">{int0(calc.conformUnits)}</div>
          <div className="text-xs text-slate-500 mt-0.5">sur {int0(calc.baseUnits)} unités théoriques</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Coût total lot</div>
          <div className="text-2xl font-bold text-slate-900">{eur0(calc.cogsLot)}</div>
          <div className="text-xs text-slate-500 mt-0.5">{(draft.lines || []).length} poste(s) de coût</div>
        </div>
      </div>

      {/* Paramètres + Rendements + Graphe */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 space-y-4">
          <div>
            <div className="text-[11px] font-bold text-blue-700 uppercase mb-2">Paramètres du lot</div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block"><span className={lbl}>Volume lot cible (L)</span><input type="number" step="any" disabled={!canEdit} value={numV(draft.batchL)} onChange={setNum('batchL')} className={inp} title="Taille de lot cible : la modifier recalcule le COGS et met les quantités évolutives à l'échelle en direct." /></label>
              <label className="block">
                <span className={cn(lbl, 'flex items-center justify-between gap-1')}>
                  <span>Taille lot réf. (L)</span>
                  {canEdit && <button type="button" onClick={() => setRefUnlocked(u => !u)} title={refUnlocked ? 'Figer la taille de référence' : 'Défiger pour modifier la taille de référence'} className={cn('inline-flex items-center gap-0.5 text-[10px] font-medium', refUnlocked ? 'text-amber-600' : 'text-slate-400 hover:text-blue-600')}>{refUnlocked ? <><Unlock className="w-3 h-3" /> défigée</> : <><Lock className="w-3 h-3" /> figée</>}</button>}
                </span>
                <input type="number" step="any" disabled={!canEdit || !refUnlocked} value={numV(draft.refBatchL)} onChange={setNum('refBatchL')} className={inp} title="Taille de lot de référence (figée) : fixe les quantités de base. Les lignes « évolue » sont mises au prorata volume cible ÷ taille réf." />
              </label>
              <label className="block"><span className={lbl}>Volume / unité (ml)</span><input type="number" step="any" disabled={!canEdit} value={numV(draft.volUnitMl)} onChange={setNum('volUnitMl')} className={inp} /></label>
              <label className="block"><span className={lbl}>Densité</span><input type="number" step="any" disabled={!canEdit} value={numV(draft.density)} onChange={setNum('density')} className={inp} /></label>
              <label className="block"><span className={lbl}>Unités / boîte</span><input type="number" disabled={!canEdit} value={numV(draft.unitsPerBox)} onChange={setNum('unitsPerBox')} className={inp} /></label>
              <label className="block col-span-2"><span className={lbl}>Cible COGS / unité (€)</span><input type="number" step="0.01" disabled={!canEdit} value={numV(draft.cogsTarget)} onChange={setNum('cogsTarget')} className={inp} /></label>
            </div>
          </div>
          <div>
            <div className="text-[11px] font-bold text-blue-700 uppercase mb-2">Rendements (%) — les leviers</div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block"><span className={lbl}>Bulk (formulation)</span><input type="number" step="0.1" min="0" max="100" disabled={!canEdit} value={yV(draft.yBulk)} onChange={setY('yBulk')} className={inp} /></label>
              <label className="block"><span className={lbl}>Remplissage</span><input type="number" step="0.1" min="0" max="100" disabled={!canEdit} value={yV(draft.yFill)} onChange={setY('yFill')} className={inp} /></label>
              <label className="block"><span className={lbl}>Mirage (contrôle visuel)</span><input type="number" step="0.1" min="0" max="100" disabled={!canEdit} value={yV(draft.yVisual)} onChange={setY('yVisual')} className={inp} /></label>
              <label className="block"><span className={lbl}>Packaging</span><input type="number" step="0.1" min="0" max="100" disabled={!canEdit} value={yV(draft.yPack)} onChange={setY('yPack')} className={inp} /></label>
            </div>
            <p className="text-[11px] text-slate-400 mt-2">Baisser un rendement réduit les unités conformes → le COGS/unité augmente. Chaque point de rendement gagné se lit immédiatement sur les cartes ci-dessus.</p>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
          <div className="font-semibold text-slate-800 text-sm mb-2">Répartition du COGS par catégorie</div>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={catData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2}>
                {catData.map((d) => <Cell key={d.name} fill={CAT_COLORS[d.name] || '#94a3b8'} />)}
              </Pie>
              <Tooltip formatter={(v: any) => `${Number(v).toLocaleString('fr-FR')} €`} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap gap-x-4 gap-y-1 justify-center text-xs text-slate-600">
            {catData.map(d => (
              <span key={d.name} className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: CAT_COLORS[d.name] }} />
                {d.name} · {calc.cogsLot ? Math.round((calc.byCat[d.name] || 0) / calc.cogsLot * 100) : 0} %
              </span>
            ))}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
          <div className="font-semibold text-slate-800 text-sm mb-2">Top 5 des postes (€ / lot)</div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={top5} layout="vertical" margin={{ top: 8, right: 24, bottom: 8, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: '#64748b' }} />
              <YAxis type="category" dataKey="label" tick={{ fontSize: 10, fill: '#64748b' }} width={130} />
              <Tooltip formatter={(v: any) => [`${Number(v).toLocaleString('fr-FR')} €`, 'Coût / lot']} />
              <Bar dataKey="cout" radius={[0, 4, 4, 0]}>
                {top5.map((d) => <Cell key={d.i} fill={CAT_COLORS[d.cat] || '#94a3b8'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Tableau des postes, groupé par catégorie */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-100 font-semibold text-slate-800 text-sm">
          Postes de coût <span className="text-xs font-normal text-slate-400">· tout est éditable, le COGS se recalcule en direct — le petit champ « pack » près de l'unité arrondit la consommation au conditionnement (sachets stériles)</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-100 text-left text-[10px] uppercase text-slate-500">
                <th className="px-3 py-2">Poste</th>
                <th className="px-3 py-2 text-right">Qté / lot</th>
                <th className="px-3 py-2">Unité</th>
                <th className="px-3 py-2 text-right">Prix U. (€)</th>
                <th className="px-3 py-2 text-right">Coût / lot (€)</th>
                <th className="px-3 py-2 text-right">Part %</th>
                {canEdit && <th className="px-2 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {CATEGORIES.map(cat => {
                const rows = draft.lines.map((ln, i) => ({ ln, i })).filter(x => x.ln.category === cat);
                const subtotal = calc.byCat[cat] || 0;
                return (
                  <React.Fragment key={cat}>
                    <tr className="bg-slate-50">
                      <td colSpan={canEdit ? 7 : 6} className="px-3 py-1.5">
                        <span className="font-semibold" style={{ color: CAT_COLORS[cat] }}>{cat}</span>
                        {canEdit && <button onClick={() => addLine(cat)} className="ml-3 text-[11px] text-blue-600 hover:underline inline-flex items-center gap-0.5"><Plus className="w-3 h-3" /> poste</button>}
                      </td>
                    </tr>
                    {rows.map(({ ln, i }) => {
                      const scal = lineIsScalable(ln);
                      const eq = effQty(ln, calc.scale ?? 1);
                      const cost = eq * (Number(ln.unitPrice) || 0);
                      return (
                        <tr key={i} className="hover:bg-slate-50">
                          <td className="px-2 py-1">
                            <span className="inline-flex items-center gap-1.5 w-full">
                              <input type="checkbox" disabled={!canEdit} checked={scal} onChange={e => updLine(i, { scalable: e.target.checked })} title="Évolue avec la taille de lot (au prorata du volume)" className="shrink-0 rounded border-slate-300 text-blue-600" />
                              <input disabled={!canEdit} value={ln.label} onChange={e => updLine(i, { label: e.target.value })} className="w-full min-w-[150px] bg-transparent border border-transparent hover:border-slate-200 focus:border-blue-400 rounded px-1.5 py-1 outline-none text-xs" />
                            </span>
                          </td>
                          <td className="px-2 py-1">
                            <input type="number" step="any" disabled={!canEdit} value={ln.qty ?? ''} onChange={e => updLine(i, { qty: e.target.value === '' ? 0 : Number(e.target.value) })} className="w-20 text-right bg-transparent border border-transparent hover:border-slate-200 focus:border-blue-400 rounded px-1.5 py-1 outline-none text-xs tabular-nums" />
                            {Math.abs(eq - (Number(ln.qty) || 0)) > 0.001 && <span className="ml-1 text-[10px] text-blue-500 tabular-nums" title="Quantité effective (taille de lot + multiple de conditionnement)">→ {int0(eq)}</span>}
                          </td>
                          <td className="px-2 py-1">
                            <div className="flex items-center gap-1">
                              <input disabled={!canEdit} value={ln.unit ?? ''} onChange={e => updLine(i, { unit: e.target.value })} className="w-16 bg-transparent border border-transparent hover:border-slate-200 focus:border-blue-400 rounded px-1.5 py-1 outline-none text-xs" />
                              <input type="number" step="any" min="0" disabled={!canEdit} value={ln.multiple ?? ''} onChange={e => updLine(i, { multiple: e.target.value === '' ? null : Number(e.target.value) })} placeholder="pack" title="Multiple / conditionnement (ex. sachets stériles) : la consommation est arrondie au pack supérieur. Laisser vide si non applicable." className="w-12 text-right bg-transparent border border-transparent hover:border-slate-200 focus:border-blue-400 rounded px-1 py-1 outline-none text-[11px] tabular-nums text-slate-500" />
                            </div>
                          </td>
                          <td className="px-2 py-1"><input type="number" step="any" disabled={!canEdit} value={ln.unitPrice ?? ''} onChange={e => updLine(i, { unitPrice: e.target.value === '' ? 0 : Number(e.target.value) })} className="w-24 text-right bg-transparent border border-transparent hover:border-slate-200 focus:border-blue-400 rounded px-1.5 py-1 outline-none text-xs tabular-nums" /></td>
                          <td className="px-3 py-1 text-right tabular-nums text-slate-700">{eur2(cost)}</td>
                          <td className="px-3 py-1 text-right tabular-nums text-slate-500">{calc.cogsLot ? (Math.round(cost / calc.cogsLot * 1000) / 10).toLocaleString('fr-FR') : '—'} %</td>
                          {canEdit && <td className="px-2 py-1 text-right"><button onClick={() => delLine(i)} className="p-1 text-slate-300 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button></td>}
                        </tr>
                      );
                    })}
                    {rows.length > 0 && (
                      <tr className="bg-slate-50/50">
                        <td colSpan={4} className="px-3 py-1.5 text-right text-[11px] font-medium text-slate-500">Sous-total {cat}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-slate-700">{eur2(subtotal)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{calc.cogsLot ? Math.round(subtotal / calc.cogsLot * 100) : 0} %</td>
                        {canEdit && <td />}
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              <tr className="bg-blue-50">
                <td colSpan={4} className="px-3 py-2 text-right text-xs font-bold text-blue-800">Total général</td>
                <td className="px-3 py-2 text-right tabular-nums font-bold text-blue-800">{eur2(calc.cogsLot)}</td>
                <td className="px-3 py-2 text-right tabular-nums font-bold text-blue-800">100 %</td>
                {canEdit && <td />}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-xs text-slate-400">
        COGS/u = coût total du lot ÷ unités conformes · unités conformes = unités théoriques × rendements bulk, remplissage, mirage et packaging.
        Pour l'Hydroxyal, le poste CMO « Seringues mirées non conformes » illustre le coût direct du mirage.
      </p>
    </div>
  );
}
