export type Step = string;

export type ProcessStage = 'PLANIFIE' | 'FORMULATION' | 'CONDI_PRIM' | 'CONDI_SEC' | 'LIBERATION' | 'EXPEDIE';
export type QualityStatus = 'NOT_STARTED' | 'EN_COURS' | 'QUARANTAINE' | 'LIBERE' | 'REJETE';
export type ScheduleHealth = 'ON_TRACK' | 'AT_RISK' | 'EN_RETARD';

export interface FluxConfig {
  name: string;
  steps: Step[];
  durations: Record<Step, number>;
}

export type SampleStatus = 'A_ENVOYER' | 'ENVOYE' | 'RESULTATS_RECUS' | 'CONFORME' | 'NON_CONFORME';

export interface Sample {
  type: string;                       // clé : INTERTEK_BIO | INTERTEK_EPC | CHARLES_RIVERS_ENDO
  partner: string;                    // partenaire/labo ('' = non applicable)
  applicable: boolean;                // dérivé : partner non vide
  status: SampleStatus;
  dateEnvoi: string;                  // saisie
  dateReceptionEchantillon: string;   // calculé (Calcul 1), lecture seule
  dateResultatsAttendue: string;      // calculé (Calcul 2), lecture seule
  configError?: boolean;              // true si la fiche produit n'a pas l'étape de prélèvement
  datePrelevementReel?: string;       // saisie, optionnelle : date de prélèvement réelle (distincte de la réception théorique)
  dateResultatsRecus?: string;        // saisie, obligatoire pour passer à RESULTATS_RECUS
  rapportRef?: string;                // n° de rapport labo
  rapportUrl?: string;                // lien certificat (URL texte, pas d'upload)
  motifNonConforme?: string;          // obligatoire si status = NON_CONFORME
  history?: any[];                    // snapshots des essais précédents (re-test)
}

export interface MilestoneCheck {
  done: boolean;
  doneDate?: string;
}

export interface SampleConfig {
  mapping: Record<string, ProcessStage>;
  analysisLeadDays: Record<string, number>;
  businessDays?: boolean;             // si true, les calculs de dates sautent samedis/dimanches (jours fériés non gérés)
}

export interface Batch {
  id: string;
  fluxKey: string;
  reference: string;
  client: string;
  product: string;
  stepIndex: number;
  status: 'UPCOMING' | 'ON_TRACK' | 'AT_RISK' | 'COMPLETED';
  process_stage: ProcessStage;
  quality_status: QualityStatus;
  schedule_health: ScheduleHealth;
  progress: number;
  startDate: string;
  endDate: string;
  deliveryDate?: string;
  notes: string;
  volume: number;
  boxesTarget: number;
  distributed: number;
  conform: number;
  sold: number;
  palettes: number;
  samples: Sample[];
  milestones?: { CONDI_PRIM: MilestoneCheck; CONDI_SEC: MilestoneCheck; LIBERATION: MilestoneCheck };
}

export interface Delivery {
  id: string;
  batchId: string;
  client: string;
  date: string;
  boxesSold: number;
  palettes: number;
  status: 'PRÊT' | 'PLANIFIÉ' | 'EN ATTENTE' | 'RETARDÉ' | 'EXPÉDIÉ';
}

export interface Product {
  name: string;
  ref: string;
}

export interface ProductCatalogEntry {
  type: string;                          // type de produit
  name: string;                          // nom produit
  ref: string;                           // référence
  condit: number;                        // nb de contenants par boîte
  contenant: 'FLACON' | 'SERINGUE';      // type de contenant
  volume: number;                        // volume d'un contenant (mL)
}
