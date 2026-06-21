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

// --- Suivi Échantillons (tests labo) : 3 tests + 2 dates calculées ---

import type { SampleStatus, SampleConfig, ProcessStage, Sample, FluxConfig } from './types';

export const SAMPLE_DUE_SOON_DAYS = 7;

export const SAMPLE_STATUSES: { value: SampleStatus; label: string; color: string }[] = [
  { value: 'A_ENVOYER', label: 'À envoyer', color: 'bg-slate-100 text-slate-700 border-slate-200' },
  { value: 'ENVOYE', label: 'Envoyé', color: 'bg-blue-100 text-blue-700 border-blue-200' },
  { value: 'RESULTATS_RECUS', label: 'Résultats reçus', color: 'bg-indigo-100 text-indigo-700 border-indigo-200' },
  { value: 'CONFORME', label: 'Conforme', color: 'bg-green-100 text-green-700 border-green-200' },
  { value: 'NON_CONFORME', label: 'Non conforme', color: 'bg-red-100 text-red-700 border-red-200' }
];

export const SAMPLE_TESTS: { key: string; label: string; defaultStage: ProcessStage; defaultPartner: string }[] = [
  { key: 'INTERTEK_BIO', label: 'Intertek-Biocharge', defaultStage: 'FORMULATION', defaultPartner: 'Intertek' },
  { key: 'INTERTEK_EPC', label: 'Intertek-EPC', defaultStage: 'CONDI_PRIM', defaultPartner: 'Intertek' },
  { key: 'CHARLES_RIVERS_ENDO', label: 'Charles Rivers-Endotoxine', defaultStage: 'CONDI_PRIM', defaultPartner: 'Charles River' }
];

export const DEFAULT_SAMPLE_PARTNERS: string[] = ['Intertek', 'Charles River'];

export const DEFAULT_SAMPLE_CONFIG: SampleConfig = {
  mapping: {
    INTERTEK_BIO: 'FORMULATION',
    INTERTEK_EPC: 'CONDI_PRIM',
    CHARLES_RIVERS_ENDO: 'CONDI_PRIM'
  },
  analysisLeadDays: {
    INTERTEK_BIO: 10,
    INTERTEK_EPC: 21,
    CHARLES_RIVERS_ENDO: 21
  },
  businessDays: false
};

// Transitions de statut autorisées depuis le statut courant (séquence verrouillée).
// Avance d'un cran ; retour arrière d'un cran autorisé pour corriger une erreur.
export const SAMPLE_STATUS_TRANSITIONS: Record<SampleStatus, SampleStatus[]> = {
  A_ENVOYER: ['ENVOYE'],
  ENVOYE: ['A_ENVOYER', 'RESULTATS_RECUS'],
  RESULTATS_RECUS: ['ENVOYE', 'CONFORME', 'NON_CONFORME'],
  CONFORME: ['RESULTATS_RECUS'],
  NON_CONFORME: ['RESULTATS_RECUS']
};

// true si la transition statut courant → cible est permise (ou identité).
export function isSampleTransitionAllowed(from: SampleStatus, to: SampleStatus): boolean {
  if (from === to) return true;
  return (SAMPLE_STATUS_TRANSITIONS[from] || []).includes(to);
}

// Dérive le process_stage depuis le label de l'étape flux (miroir de la fonction serveur).
export function deriveStageFromStepLabel(label: string): ProcessStage {
  const l = (label || '').toLowerCase();
  if (l.includes('formul') || l.includes('répart') || l.includes('repart')) return 'FORMULATION';
  if (l.includes('condi prim') || l.includes('cond. prim') || l.includes('primaire') || l.includes('mirage') || l.includes('blister')) return 'CONDI_PRIM';
  if (l.includes('condi sec') || l.includes('cond. sec') || l.includes('secondaire') || l.includes('condi') || l.includes('boite') || l.includes('boîte') || l.includes('finition')) return 'CONDI_SEC';
  if (l.includes('libération') || l.includes('liberation')) return 'LIBERATION';
  return 'FORMULATION';
}

const STATUS_AFTER_ENVOI: SampleStatus[] = ['ENVOYE', 'RESULTATS_RECUS', 'CONFORME', 'NON_CONFORME'];

function addDays(dateStr: string, days: number, businessDays = false): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  if (!businessDays) {
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
  }
  // Jours ouvrés : on saute samedis (6) et dimanches (0). Jours fériés non gérés.
  let remaining = days;
  while (remaining > 0) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) remaining--;
  }
  return d.toISOString().split('T')[0];
}

// Calcul 1 + Calcul 2 + configError + règle applicable=false.
// Mute le sample en place ; renvoie le sample (miroir de la logique serveur).
export function computeSampleDates(
  sample: Sample,
  flux: FluxConfig | undefined,
  startDate: string | undefined,
  sampleConfig: SampleConfig
): Sample {
  if (!sample.applicable) {
    sample.dateReceptionEchantillon = '';
    sample.dateResultatsAttendue = '';
    sample.configError = false;
    return sample;
  }

  const stage = sampleConfig.mapping[sample.type];
  const businessDays = !!sampleConfig.businessDays;

  // Calcul 1 — date_reception_echantillon
  let reception = '';
  let configError = false;
  if (!flux || !startDate || !stage) {
    reception = '';
  } else {
    let weeks = 0;
    let found = false;
    for (const label of flux.steps) {
      if (label === '-') continue;
      weeks += flux.durations[label] || 0;
      if (deriveStageFromStepLabel(label) === stage) {
        found = true;
        break;
      }
    }
    if (!found) {
      configError = true;
      reception = '';
    } else {
      reception = addDays(startDate, weeks * 7, businessDays);
    }
  }
  sample.configError = configError;
  sample.dateReceptionEchantillon = reception;

  // Calcul 2 — date_resultats_attendue
  const lead = sampleConfig.analysisLeadDays[sample.type] || 0;
  const base = (STATUS_AFTER_ENVOI.includes(sample.status) && sample.dateEnvoi)
    ? sample.dateEnvoi
    : reception;
  sample.dateResultatsAttendue = base ? addDays(base, lead, businessDays) : '';

  return sample;
}

// tests_ok : true si toutes les lignes applicable=true sont CONFORME.
export function computeTestsOk(samples: Sample[]): boolean {
  const applicables = samples.filter(s => s.applicable);
  if (applicables.length === 0) return false;
  return applicables.every(s => s.status === 'CONFORME');
}

// Badge couleur pour une date d'échéance échantillon.
// notDone = true si le statut n'a pas encore atteint l'étape attendue (rouge si dépassé).
export function sampleDateBadgeColor(dateStr: string, notDone: boolean): string {
  if (!dateStr) return 'bg-slate-100 text-slate-500 border-slate-200';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return 'bg-slate-100 text-slate-500 border-slate-200';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0 && notDone) return 'bg-red-100 text-red-700 border-red-200';
  if (diffDays <= SAMPLE_DUE_SOON_DAYS) return 'bg-orange-100 text-orange-700 border-orange-200';
  return 'bg-green-100 text-green-700 border-green-200';
}

export type SampleDelayType = 'RECEPTION' | 'RESULTATS';

export interface SampleDelay {
  sample: Sample;
  type: SampleDelayType;       // RECEPTION = aurait dû être envoyé ; RESULTATS = résultats en retard
  dueDate: string;             // date d'échéance dépassée
  daysLate: number;            // jours de retard (>= 0)
}

// Agrège les retards d'un lot : réception théorique dépassée et non envoyé,
// OU résultats attendus dépassés et résultats non reçus. Source unique de vérité UI.
export function computeSampleDelays(samples: Sample[] | undefined): SampleDelay[] {
  if (!Array.isArray(samples)) return [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split('T')[0];
  const dayMs = 1000 * 60 * 60 * 24;
  const result: SampleDelay[] = [];

  for (const s of samples) {
    if (!s || !s.applicable) continue;
    // Réception/envoi en retard : réception théorique passée alors que pas encore envoyé
    if (s.dateReceptionEchantillon && s.dateReceptionEchantillon < todayStr && s.status === 'A_ENVOYER') {
      const due = new Date(s.dateReceptionEchantillon);
      result.push({
        sample: s,
        type: 'RECEPTION',
        dueDate: s.dateReceptionEchantillon,
        daysLate: Math.round((today.getTime() - due.getTime()) / dayMs)
      });
    }
    // Résultats en retard : résultats attendus passés et non reçus
    else if (s.dateResultatsAttendue && s.dateResultatsAttendue < todayStr
      && !['RESULTATS_RECUS', 'CONFORME', 'NON_CONFORME'].includes(s.status)) {
      const due = new Date(s.dateResultatsAttendue);
      result.push({
        sample: s,
        type: 'RESULTATS',
        dueDate: s.dateResultatsAttendue,
        daysLate: Math.round((today.getTime() - due.getTime()) / dayMs)
      });
    }
  }
  return result;
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
