export const FLUX_DEFAULTS = {
  'Hydragel_A1': { 
      name: 'Hydragel A1', 
      steps: ['-', 'Formul.', 'Mirage', 'Condi Sec.', 'Libération'],
      durations: { '-': 1, 'Formul.': 1, 'Mirage': 3, 'Condi Sec.': 2, 'Libération': 1 }
  },
  'Hydragel_A2': { 
      name: 'Hydragel A2', 
      steps: ['-', 'Formul.', 'Mirage', 'Condi Sec.', 'Libération'],
      durations: { '-': 1, 'Formul.': 1, 'Mirage': 3, 'Condi Sec.': 2, 'Libération': 1 }
  },
  'Hydragel_A3': { 
      name: 'Hydragel A3', 
      steps: ['-', 'Formul.', 'Mirage', 'Condi Sec.', 'Finition', 'Libération'],
      durations: { '-': 1, 'Formul.': 1, 'Mirage': 3, 'Condi Sec.': 2, 'Finition': 1, 'Libération': 1 }
  },
  'Hydragel_A2_Seringue': { 
      name: 'Hydragel A2 Seringue', 
      steps: ['-', 'Formul.', 'Mirage', 'Blister', 'Boite', 'Libération'],
      durations: { '-': 1, 'Formul.': 1, 'Mirage': 3, 'Blister': 2, 'Boite': 1, 'Libération': 1 }
  },
  'HAR_Louna': { 
      name: 'HAR - Louna Fillers', 
      steps: ['-', 'Formul.', 'Répart.', 'Mirage', 'Blister', 'Boite', 'Libération'],
      durations: { '-': 1, 'Formul.': 1, 'Répart.': 2, 'Mirage': 3, 'Blister': 2, 'Boite': 1, 'Libération': 1 }
  },
  'HAR_Essentyal': { 
      name: 'HAR - Essentyal', 
      steps: ['-', 'Formul.', 'Répart.', 'Mirage', 'Blister', 'Boite', 'Libération'],
      durations: { '-': 1, 'Formul.': 1, 'Répart.': 2, 'Mirage': 3, 'Blister': 2, 'Boite': 1, 'Libération': 1 }
  },
  'Hydroxyal': { 
      name: 'Hydroxyal', 
      steps: ['-', 'Formul.', 'Mirage', 'Condi Sec.', 'Libération'],
      durations: { '-': 1, 'Formul.': 1, 'Mirage': 3, 'Condi Sec.': 2, 'Libération': 1 }
  }
};

// --- Refonte du suivi des lots : 3 axes orthogonaux ---

// Axe 1 : Étape process (séquentiel, ordonné)
export const PROCESS_STAGES: { value: import('./types').ProcessStage; label: string }[] = [
  { value: 'FORMULATION', label: 'Formulation' },
  { value: 'CONDI_PRIM', label: 'Conditionnement primaire' },
  { value: 'CONDI_SEC', label: 'Conditionnement secondaire' },
  { value: 'LIBERATION', label: 'Libération' },
  { value: 'EXPEDIE', label: 'Expédié' }
];

// Axe 2 : Statut qualité (décision QA)
export const QUALITY_STATUSES: { value: import('./types').QualityStatus; label: string; color: string }[] = [
  { value: 'EN_COURS', label: 'En cours', color: 'bg-slate-100 text-slate-700 border-slate-200' },
  { value: 'QUARANTAINE', label: 'Quarantaine', color: 'bg-amber-100 text-amber-700 border-amber-200' },
  { value: 'LIBERE', label: 'Libéré', color: 'bg-green-100 text-green-700 border-green-200' },
  { value: 'REJETE', label: 'Rejeté', color: 'bg-red-100 text-red-700 border-red-200' }
];

// Axe 3 : Santé délai (calculé, lecture seule)
export const SCHEDULE_HEALTH: { value: import('./types').ScheduleHealth; label: string; color: string }[] = [
  { value: 'ON_TRACK', label: 'On track', color: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  { value: 'AT_RISK', label: 'At risk', color: 'bg-orange-100 text-orange-800 border-orange-200' },
  { value: 'EN_RETARD', label: 'En retard', color: 'bg-red-100 text-red-800 border-red-200' }
];

export const SCHEDULE_MARGIN_DAYS = 7;

// Calcul de la santé délai (le serveur fait foi ; utile pour l'affichage immédiat).
export function computeScheduleHealth(
  endDate: string | undefined,
  deliveryDate: string | undefined,
  process_stage: import('./types').ProcessStage | undefined
): import('./types').ScheduleHealth {
  if (!endDate || !deliveryDate) return 'ON_TRACK';
  const end = new Date(endDate);
  const delivery = new Date(deliveryDate);
  if (isNaN(end.getTime()) || isNaN(delivery.getTime())) return 'ON_TRACK';

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (end > delivery || (today > delivery && process_stage !== 'EXPEDIE')) {
    return 'EN_RETARD';
  }
  const marginDays = Math.round((delivery.getTime() - end.getTime()) / (1000 * 60 * 60 * 24));
  if (marginDays >= SCHEDULE_MARGIN_DAYS) return 'ON_TRACK';
  return 'AT_RISK';
}

// Statuts de livraison dérivés automatiquement de l'état du lot lié
export const DELIVERY_STATUSES: { value: string; label: string; color: string }[] = [
  { value: 'A_PLANIFIER', label: 'À planifier', color: 'bg-slate-100 text-slate-800 border-slate-200' },
  { value: 'EN_PRODUCTION', label: 'En cours de production', color: 'bg-blue-100 text-blue-800 border-blue-200' },
  { value: 'PRET', label: 'Prêt à être enlevé', color: 'bg-orange-100 text-orange-800 border-orange-200' },
  { value: 'ENLEVE', label: 'Enlevé', color: 'bg-emerald-200 text-emerald-900 border-emerald-300' }
];

// Dérive la clé de statut de livraison à partir du lot lié
export function deliveryStatusFromBatch(batch: import('./types').Batch | undefined): string {
  if (!batch) return 'A_PLANIFIER';
  if (batch.process_stage === 'EXPEDIE') return 'ENLEVE';
  if (batch.quality_status === 'LIBERE') return 'PRET';
  if (batch.process_stage === 'FORMULATION') return 'A_PLANIFIER';
  return 'EN_PRODUCTION';
}

export const PRODUCT_CATALOG = [
  { name: 'INNOVYAL LIGHTENING', ref: 'DB-ILA' },
  { name: 'INNOVYAL LIGHTENING COS', ref: 'DB-ILA-C' },
  { name: 'INNOVYAL REGENERATIVE', ref: 'DB-IRA' },
  { name: 'INNOVYAL REGENERATIVE COS', ref: 'DB-IRA-C' },
  { name: 'INNOVYAL REGENERATIVE LIFT', ref: 'DB-IRA-S' },
  { name: 'INNOVYAL HAIR', ref: 'DB-IHA' },
  { name: 'INNOVYAL HAIR COS', ref: 'DB-IHA-C' },
  { name: 'LOUNA FILLER INSTANT REFINE', ref: 'DF-HAR1-2U' },
  { name: 'LOUNA FILLER SHAPE & VOLUME', ref: 'DF-HAR2-2U' },
  { name: 'LOUNA FILLER GLOSSY LIPS', ref: 'DF-HAR2-L-2U' },
  { name: 'LOUNA FILLER MAXI LIFT', ref: 'DF-HAR3-2U' },
  { name: 'ESSENTYAL TOUCH', ref: 'DF-HAR1-1U' },
  { name: 'ESSENTYAL LIPS', ref: 'DF-HAR2-L-1U' },
  { name: 'ESSENTYAL VOLUME', ref: 'DF-HAR2-1U' },
  { name: 'ESSENTYAL EXTREME', ref: 'DF-HAR3-1U' }
];
