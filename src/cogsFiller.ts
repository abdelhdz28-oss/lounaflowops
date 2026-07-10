// Moteur COGS Filler — rejoue le mécanisme des BOM Excel « BOM FILLER HA HAR »
// (gammes Louna Filler et Essentyal). La taille de cuve est CALCULÉE automatiquement
// à partir des boîtes demandées + paramètres ; les quantités viennent du modèle
// (paramétrable, pré-rempli depuis les Excel), les PRIX MP/AC viennent d'Odoo (standard_price).

export type Tank = '3L' | '5L' | '6L' | '7L' | '10L';
export const TANKS: Tank[] = ['3L', '5L', '6L', '7L', '10L'];

export interface BomLine { code: string; label: string; qty: number; unit: string; }
export interface AcLine { code: string; label: string; qtyPerBox: number; unit: string; }
export interface ProcessCost { label: string; cost: number; basis: 'per_box' | 'per_syringe' | 'per_run' | 'per_lot'; }
export interface Variant {
  code: string; label: string;
  pr: Partial<Record<Tank, number>>;   // masse gel PR (g) par taille de cuve
  pnr: Partial<Record<Tank, number>>;  // masse gel PNR (g) par taille de cuve
  ac: AcLine[];                         // conditionnement propre au variant (par boîte)
}
export interface FillerModel {
  gamme: string;                        // 'LOUNA' | 'ESSENTYAL'
  label: string;
  syringesPerBox: number;               // 2 (Louna) / 1 (Essentyal)
  yields: { form: number; fill: number; mir: number; cond: number };
  gelMassPerSyringe: number;            // g de gel par seringue remplie (≈ vol rempli)
  runYieldPR: number;                   // capacité gel PR par run de formulation (g)
  runYieldPNR: number;                  // capacité gel PNR par run de formulation (g)
  tankCapacityG: Partial<Record<Tank, number>>; // capacité gel formulé par taille de cuve (g)
  bomPR: BomLine[];                     // MP phase réticulée, par run
  bomPNR: BomLine[];                    // MP phase non-réticulée, par run
  actifs: BomLine[];                    // actifs/excipients gel final, par batch (variant actif)
  acShared: AcLine[];                   // conditionnement commun à tous les variants (par boîte)
  variants: Variant[];
  processCosts: ProcessCost[];
}

export interface CostLine { code: string; label: string; qty: number; unit: string; unitPrice: number; cost: number; missingPrice: boolean; }
// Une ligne de campagne = un variant, un nombre de boîtes, une cuve (ou 'auto').
export interface CampaignLine { variant: string; boxes: number; tank?: Tank | 'auto'; }
export interface LineResult {
  variant: string; label: string; tank: Tank; autoTank: Tank; nbBatches: number; valid: boolean;
  boxesDemanded: number; boxesProduced: number; surplus: number;
  sgReparti: number; sgConforme: number; gelPR: number; gelPNR: number;
  cogsLot: number; cogsBox: number;
}
export interface CogsResult {
  runsPR: number; runsPNR: number; totalBatches: number;
  totalBoxesDemanded: number; totalBoxesProduced: number; totalSurplus: number; totalSgConforme: number; totalSgReparti: number;
  totalPR: number; totalPNR: number;
  producedPR: number; producedPNR: number;   // gel formulé par les runs (runs × capacité run)
  residualPR: number; residualPNR: number;    // reste de gel après la campagne (produit − nécessaire)
  perLine: LineResult[];                       // aligné 1:1 sur les lignes de campagne en entrée
  mp: CostLine[]; ac: CostLine[]; process: CostLine[];
  costMP: number; costAC: number; costProcess: number;
  cogsLot: number; cogsBox: number; cogsSg: number;
  missingCodes: string[];
}

const yieldProduct = (m: FillerModel) => m.yields.form * m.yields.fill * m.yields.mir * m.yields.cond;

// Production d'un run (batch de remplissage) pour une taille de cuve donnée.
function runOutput(m: FillerModel, tank: Tank) {
  const cap = m.tankCapacityG[tank] ?? 0;
  const sgRaw = m.gelMassPerSyringe > 0 ? cap / m.gelMassPerSyringe : 0;
  const sgReparti = sgRaw * m.yields.form * m.yields.fill;               // seringues remplies
  const sgConforme = sgReparti * m.yields.mir * m.yields.cond;            // seringues mirées conformes
  const boxes = m.syringesPerBox > 0 ? Math.round(sgConforme / m.syringesPerBox) : 0;
  return { sgReparti, sgConforme, boxes };
}

// Choisit la cuve la plus petite (parmi celles définies pour le variant) qui couvre la demande en 1 batch.
// Si aucune ne suffit, prend la plus grande cuve et multiplie les batches.
function autoTank(m: FillerModel, v: Variant, demand: number): { tank: Tank; nbBatches: number } {
  const valid = TANKS.filter(t => (v.pr[t] != null || v.pnr[t] != null) && (m.tankCapacityG[t] ?? 0) > 0);
  if (!valid.length) return { tank: '3L', nbBatches: 1 };
  for (const t of valid) if (runOutput(m, t).boxes >= demand) return { tank: t, nbBatches: 1 };
  const largest = valid[valid.length - 1];
  const per = runOutput(m, largest).boxes || 1;
  return { tank: largest, nbBatches: Math.max(1, Math.ceil(demand / per)) };
}

// Résout la cuve d'une ligne : cuve imposée (si valide) sinon cuve automatique.
function resolveTank(model: FillerModel, v: Variant, boxes: number, pref?: Tank | 'auto'): { tank: Tank; nbBatches: number } {
  if (pref && pref !== 'auto' && (v.pr[pref] != null || v.pnr[pref] != null) && (model.tankCapacityG[pref] ?? 0) > 0) {
    const per = runOutput(model, pref).boxes || 1;
    return { tank: pref, nbBatches: Math.max(1, Math.ceil(boxes / per)) };
  }
  return autoTank(model, v, boxes);
}

// Calcul principal. `lines` = lignes de campagne (variant + boîtes + cuve). `prices` = { code MP/AC → prix }.
export function computeCogsFiller(model: FillerModel, lines: CampaignLine[], prices: Record<string, number>): CogsResult {
  let totalBoxesDemanded = 0, totalBoxesProduced = 0, totalSgConforme = 0, totalSgReparti = 0, totalPR = 0, totalPNR = 0, totalBatches = 0;
  // Un agrégat par ligne (aligné 1:1). Ligne inactive (variant inconnu ou 0 boîte) → active=false.
  const agg = lines.map(line => {
    const v = model.variants.find(x => x.code === line.variant);
    const d = Math.max(0, Math.floor(line.boxes || 0));
    if (!v || d <= 0) return { line, v: v || null, d, active: false as const, tank: '3L' as Tank, autoTank: '3L' as Tank, nbBatches: 0, boxesProduced: 0, sgReparti: 0, sgConforme: 0, gelPR: 0, gelPNR: 0 };
    const autoT = autoTank(model, v, d).tank;
    const { tank, nbBatches } = resolveTank(model, v, d, line.tank);
    const ro = runOutput(model, tank);
    const boxesProduced = ro.boxes * nbBatches;
    const sgReparti = Math.round(ro.sgReparti * nbBatches);
    const sgConforme = Math.round(ro.sgConforme * nbBatches);
    const gelPR = (v.pr[tank] ?? 0) * nbBatches;
    const gelPNR = (v.pnr[tank] ?? 0) * nbBatches;
    totalBoxesDemanded += d; totalBoxesProduced += boxesProduced; totalSgConforme += sgConforme;
    totalSgReparti += sgReparti; totalPR += gelPR; totalPNR += gelPNR; totalBatches += nbBatches;
    return { line, v, d, active: true as const, tank, autoTank: autoT, nbBatches, boxesProduced, sgReparti, sgConforme, gelPR, gelPNR };
  });
  const vAgg = agg.filter(a => a.active);
  const runsPR = totalPR > 0 ? Math.ceil(totalPR / model.runYieldPR) : 0;
  const runsPNR = totalPNR > 0 ? Math.ceil(totalPNR / model.runYieldPNR) : 0;
  const gelTotal = totalPR + totalPNR;

  const missing = new Set<string>();
  const priceOf = (code: string): number => {
    const p = prices[code];
    if (p == null || isNaN(Number(p))) { if (code) missing.add(code); return 0; }
    return Number(p);
  };
  const mkLine = (code: string, label: string, qty: number, unit: string): CostLine => {
    const has = !!code && prices[code] != null && !isNaN(Number(prices[code]));
    const p = priceOf(code);
    return { code, label, qty, unit, unitPrice: p, cost: qty * p, missingPrice: !!code && !has };
  };

  // MP : phase PR × runsPR, phase PNR × runsPNR, actifs × nb batches.
  const mp: CostLine[] = [];
  for (const l of model.bomPR) mp.push(mkLine(l.code, `${l.label} (PR)`, l.qty * runsPR, l.unit));
  for (const l of model.bomPNR) mp.push(mkLine(l.code, `${l.label} (PNR)`, l.qty * runsPNR, l.unit));
  for (const l of model.actifs) mp.push(mkLine(l.code, l.label, l.qty * totalBatches, l.unit));

  // AC : lignes communes + propres au variant, × boîtes PRODUITES du variant, agrégées par code.
  const acAgg = new Map<string, { label: string; qty: number; unit: string }>();
  const addAc = (line: AcLine, boxes: number) => {
    const cur = acAgg.get(line.code);
    if (cur) cur.qty += line.qtyPerBox * boxes;
    else acAgg.set(line.code, { label: line.label, qty: line.qtyPerBox * boxes, unit: line.unit });
  };
  for (const { v, boxesProduced } of vAgg) {
    for (const l of model.acShared) addAc(l, boxesProduced);
    for (const l of v.ac) addAc(l, boxesProduced);
  }
  const ac: CostLine[] = [...acAgg.entries()].map(([code, a]) => mkLine(code, a.label, a.qty, a.unit));

  // Process : coûts paramétrables selon leur base.
  const process: CostLine[] = model.processCosts.map(pc => {
    const q = pc.basis === 'per_box' ? totalBoxesProduced : pc.basis === 'per_syringe' ? totalSgConforme : pc.basis === 'per_run' ? (runsPR + runsPNR) : 1;
    const unit = pc.basis === 'per_box' ? 'boîtes' : pc.basis === 'per_syringe' ? 'seringues' : pc.basis === 'per_run' ? 'runs' : 'lot';
    return { code: '', label: pc.label, qty: q, unit, unitPrice: pc.cost, cost: q * pc.cost, missingPrice: false };
  });

  const sum = (arr: CostLine[]) => arr.reduce((s, l) => s + l.cost, 0);
  const costMP = sum(mp), costAC = sum(ac), costProcess = sum(process);
  const cogsLot = costMP + costAC + costProcess;
  const cogsBox = totalBoxesProduced > 0 ? cogsLot / totalBoxesProduced : 0;
  const cogsSg = totalSgConforme > 0 ? cogsLot / totalSgConforme : 0;

  // COGS par ligne : AC direct (boîtes produites), MP réparti au prorata du gel, actifs par batch, process selon base.
  const acByVariant = (v: Variant, boxes: number) =>
    [...model.acShared, ...v.ac].reduce((s, l) => s + l.qtyPerBox * boxes * priceOf(l.code), 0);
  const mpRunCostPR = model.bomPR.reduce((s, l) => s + l.qty * runsPR * priceOf(l.code), 0);
  const mpRunCostPNR = model.bomPNR.reduce((s, l) => s + l.qty * runsPNR * priceOf(l.code), 0);
  const actifsPerBatch = model.actifs.reduce((s, l) => s + l.qty * priceOf(l.code), 0);
  const processPerLine = (boxes: number, sg: number) => model.processCosts.reduce((s, pc) => {
    if (pc.basis === 'per_box') return s + pc.cost * boxes;
    if (pc.basis === 'per_syringe') return s + pc.cost * sg;
    if (pc.basis === 'per_run') return s; // runs de formulation mutualisés → imputés au global
    return s + pc.cost / (vAgg.length || 1); // per_lot réparti à parts égales
  }, 0);

  // Aligné 1:1 sur les lignes en entrée (les lignes inactives sont renvoyées à zéro).
  const perLine: LineResult[] = agg.map(a => {
    if (!a.active || !a.v) return {
      variant: a.line.variant, label: a.v?.label || a.line.variant, tank: a.tank, autoTank: a.autoTank, nbBatches: 0, valid: false,
      boxesDemanded: a.d, boxesProduced: 0, surplus: 0, sgReparti: 0, sgConforme: 0, gelPR: 0, gelPNR: 0, cogsLot: 0, cogsBox: 0,
    };
    const gelShare = gelTotal > 0 ? (a.gelPR + a.gelPNR) / gelTotal : 0;
    const cLot = acByVariant(a.v, a.boxesProduced) + (mpRunCostPR + mpRunCostPNR) * gelShare + actifsPerBatch * a.nbBatches + processPerLine(a.boxesProduced, a.sgConforme);
    return {
      variant: a.v.code, label: a.v.label, tank: a.tank, autoTank: a.autoTank, nbBatches: a.nbBatches, valid: true,
      boxesDemanded: a.d, boxesProduced: a.boxesProduced, surplus: a.boxesProduced - a.d,
      sgReparti: a.sgReparti, sgConforme: a.sgConforme, gelPR: a.gelPR, gelPNR: a.gelPNR,
      cogsLot: cLot, cogsBox: a.boxesProduced > 0 ? cLot / a.boxesProduced : 0,
    };
  });

  const producedPR = runsPR * model.runYieldPR;
  const producedPNR = runsPNR * model.runYieldPNR;
  return {
    runsPR, runsPNR, totalBatches,
    totalBoxesDemanded, totalBoxesProduced, totalSurplus: totalBoxesProduced - totalBoxesDemanded, totalSgConforme, totalSgReparti,
    totalPR, totalPNR,
    producedPR, producedPNR, residualPR: Math.max(0, producedPR - totalPR), residualPNR: Math.max(0, producedPNR - totalPNR),
    perLine, mp, ac, process,
    costMP, costAC, costProcess, cogsLot, cogsBox, cogsSg,
    missingCodes: [...missing],
  };
}

// Tous les codes MP/AC d'un modèle (pour interroger Odoo en une fois).
export function allCodes(model: FillerModel): string[] {
  const s = new Set<string>();
  for (const l of [...model.bomPR, ...model.bomPNR, ...model.actifs]) if (l.code) s.add(l.code);
  for (const l of model.acShared) if (l.code) s.add(l.code);
  for (const v of model.variants) for (const l of v.ac) if (l.code) s.add(l.code);
  return [...s];
}

// ————— Données par défaut (seed), pré-remplies depuis les 2 Excel. Éditables dans l'app. —————
const AC = (code: string, label: string, qtyPerBox: number, unit = 'u'): AcLine => ({ code, label, qtyPerBox, unit });
const MP = (code: string, label: string, qty: number, unit: string): BomLine => ({ code, label, qty, unit });

// Capacité gel formulé par taille de cuve (g) — commune aux 2 gammes.
const TANK_CAP: Record<Tank, number> = { '3L': 3000, '5L': 5000, '6L': 6000, '7L': 7000, '10L': 10000 };

// Phase Réticulée (par run) — commune aux 2 gammes.
const BOM_PR: BomLine[] = [
  MP('MP-010', 'NaHA', 115.5, 'g'), MP('MP-014', 'BDDE', 1, 'flacon'), MP('MP-007', 'WFI', 25, 'L'),
  MP('MP-002', 'NaCl', 207, 'g'), MP('MP-003', 'Sodium dihydrogen phosphate', 19, 'g'),
  MP('MP-004', 'Disodium hydrogen phosphate', 1.5, 'g'), MP('MP-005', 'NaOH', 0.2, 'L'),
  MP('MP-006', 'HCl', 0.2, 'L'), MP('AT-008', 'Membrane de dialyse', 3.25, 'm'),
];
const BOM_PNR: BomLine[] = [
  MP('MP-010', 'NaHA', 33, 'g'), MP('MP-007', 'WFI', 1, 'L'), MP('MP-002', 'NaCl', 26, 'g'),
  MP('MP-003', 'Sodium dihydrogen phosphate', 2.5, 'g'), MP('MP-004', 'Disodium hydrogen phosphate', 0.2, 'g'),
];

// Aiguilles : AC-035 = 30G, AC-034 = 27G.
const LOUNA_SHARED: AcLine[] = [
  AC('AC-030', 'Seringue 1mL COP SCHOTT', 2), AC('AC-031', 'Piston 1mL SCHOTT', 2),
  AC('AC-032', 'Blister A3P', 2), AC('AC-085', 'Opercule Tyvek 1073B', 0.1, 'm'),
  AC('AC-045', 'Étiquette Blister', 2), AC('AC-048', 'Notice IFU', 1),
  AC('AC-036', 'Étiquette boîte', 1), AC('AC-008', 'Pastille inviolabilité', 1),
];
const LOUNA_MODEL: FillerModel = {
  gamme: 'LOUNA', label: 'Louna Filler HAR', syringesPerBox: 2,
  yields: { form: 0.93, fill: 0.90, mir: 0.90, cond: 0.99 }, gelMassPerSyringe: 1.05,
  runYieldPR: 2696, runYieldPNR: 950, tankCapacityG: TANK_CAP, bomPR: BOM_PR, bomPNR: BOM_PNR,
  actifs: [MP('MP-015', 'Lidocaïne HCl', 36, 'g'), MP('MP-009', 'Niacinamide', 83, 'g')],
  acShared: LOUNA_SHARED,
  variants: [
    { code: 'HAR1', label: 'HAR1 — Instant Refine', pr: { '3L': 1107.7, '6L': 2215.4 }, pnr: { '3L': 60, '6L': 120 },
      ac: [AC('AC-041', 'Étiquette seringue HAR1', 2), AC('AC-062', 'Tige HAR1', 2), AC('AC-061', 'Back stop HAR1', 2), AC('AC-035', 'Aiguille 30G', 4), AC('AC-053', 'Carte implant HAR1', 2), AC('AC-057', 'Étui HAR1 Instant Refine', 1)] },
    { code: 'HAR2', label: 'HAR2 — Shape & Volume', pr: { '3L': 1336.2, '5L': 2226, '7L': 3117.7, '10L': 4453.8 }, pnr: { '3L': 63, '5L': 105, '7L': 147, '10L': 210 },
      ac: [AC('AC-042', 'Étiquette seringue HAR2', 2), AC('AC-064', 'Tige HAR2', 2), AC('AC-063', 'Back stop HAR2', 2), AC('AC-035', 'Aiguille 30G', 2), AC('AC-034', 'Aiguille 27G', 2), AC('AC-054', 'Carte implant HAR2', 2), AC('AC-058', 'Étui HAR2 Shape & Volume', 1)] },
    { code: 'HAR2L', label: 'HAR2L — Glossy Lips', pr: { '3L': 1350, '5L': 2146.2, '7L': 3004.6, '10L': 4292.3 }, pnr: { '3L': 122.5, '5L': 210, '7L': 294, '10L': 420 },
      ac: [AC('AC-043', 'Étiquette seringue HAR2L', 2), AC('AC-066', 'Tige HAR2L', 2), AC('AC-065', 'Back stop HAR2L', 2), AC('AC-035', 'Aiguille 30G', 2), AC('AC-034', 'Aiguille 27G', 2), AC('AC-055', 'Carte implant HAR2L', 2), AC('AC-059', 'Étui HAR2L Glossy Lips', 1)] },
    { code: 'HAR3', label: 'HAR3 — Maxi Lift', pr: { '3L': 1563.7, '5L': 2606.2, '7L': 3648.6, '10L': 5212.3 }, pnr: { '3L': 67.2, '5L': 112, '7L': 156.8, '10L': 224 },
      ac: [AC('AC-044', 'Étiquette seringue HAR3', 2), AC('AC-068', 'Tige HAR3', 2), AC('AC-067', 'Back stop HAR3', 2), AC('AC-034', 'Aiguille 27G', 4), AC('AC-056', 'Carte implant HAR3', 2), AC('AC-060', 'Étui HAR3 Maxi Lift', 1)] },
  ],
  processCosts: [
    { label: 'Formulation (CMO)', cost: 0, basis: 'per_run' },
    { label: 'Remplissage / répartition', cost: 0, basis: 'per_syringe' },
    { label: 'Mirage (contrôle visuel)', cost: 0, basis: 'per_syringe' },
    { label: 'Conditionnement', cost: 0, basis: 'per_box' },
    { label: 'Libération / contrôles labo (IPC/EPC)', cost: 0, basis: 'per_lot' },
  ],
};

// Essentyal : format 1 seringue 2 ml / boîte, rendements plus élevés, seringue BD 2mL.
const ESS_SHARED: AcLine[] = [
  AC('AC-074', 'Seringue 2mL BD', 1), AC('AC-075', 'Piston 2mL BD', 1),
  AC('AC-077', 'Tige 2mL BD', 1), AC('AC-076', 'Back stop 2mL BD', 1),
  AC('AC-131', 'Foil PET blister', 1), AC('AC-132', 'Foil Tyvek lid', 1),
  AC('AC-094', 'Notice IFU', 1),
];
const ESSENTYAL_MODEL: FillerModel = {
  gamme: 'ESSENTYAL', label: 'Essentyal', syringesPerBox: 1,
  yields: { form: 0.98, fill: 0.95, mir: 0.95, cond: 1.00 }, gelMassPerSyringe: 2.05,
  runYieldPR: 2696, runYieldPNR: 950, tankCapacityG: TANK_CAP, bomPR: BOM_PR, bomPNR: BOM_PNR,
  actifs: [MP('MP-015', 'Lidocaïne HCl', 36, 'g')],
  acShared: ESS_SHARED,
  variants: [
    { code: 'HAR1', label: 'HAR1 — Touch', pr: { '3L': 1038.5, '5L': 1730.8, '7L': 2423.1, '10L': 3461.5 }, pnr: { '3L': 150, '5L': 250, '7L': 350, '10L': 500 },
      ac: [AC('AC-114', 'Étiquette seringue Touch', 1), AC('AC-116', 'Étui Essentyal Touch', 1)] },
    { code: 'HAR2', label: 'HAR2 — Volume', pr: { '3L': 1224.4, '5L': 2041.7, '7L': 2858.3, '10L': 4083.3 }, pnr: { '3L': 157.5, '5L': 262.5, '7L': 367.5, '10L': 525 },
      ac: [AC('AC-089', 'Étiquette seringue Volume', 1), AC('AC-092', 'Étui Essentyal Volume', 1)] },
    { code: 'HAR2L', label: 'HAR2L — Lips', pr: { '3L': 1171.2, '5L': 1951.9, '7L': 2732.7, '10L': 3903.8 }, pnr: { '3L': 227.5, '5L': 319.2, '7L': 530.8, '10L': 758.3 },
      ac: [AC('AC-115', 'Étiquette seringue Lips', 1), AC('AC-117', 'Étui Essentyal Lips', 1)] },
    { code: 'HAR3', label: 'HAR3 — Extreme', pr: { '3L': 1419.2, '5L': 2365.4, '7L': 3311.5, '10L': 4730.8 }, pnr: { '3L': 205, '5L': 342, '7L': 478, '10L': 683 },
      ac: [AC('AC-090', 'Étiquette seringue Extreme', 1), AC('AC-093', 'Étui Essentyal Extreme', 1)] },
  ],
  processCosts: [
    { label: 'Formulation (CMO)', cost: 0, basis: 'per_run' },
    { label: 'Remplissage / répartition', cost: 0, basis: 'per_syringe' },
    { label: 'Mirage (contrôle visuel)', cost: 0, basis: 'per_syringe' },
    { label: 'Conditionnement', cost: 0, basis: 'per_box' },
    { label: 'Libération / contrôles labo (IPC/EPC)', cost: 0, basis: 'per_lot' },
  ],
};

export const DEFAULT_COGS_FILLER_MODELS: FillerModel[] = [LOUNA_MODEL, ESSENTYAL_MODEL];
