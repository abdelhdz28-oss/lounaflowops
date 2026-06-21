export type Step = string;

export type ProcessStage = 'FORMULATION' | 'CONDI_PRIM' | 'CONDI_SEC' | 'LIBERATION' | 'EXPEDIE';
export type QualityStatus = 'EN_COURS' | 'QUARANTAINE' | 'LIBERE' | 'REJETE';
export type ScheduleHealth = 'ON_TRACK' | 'AT_RISK' | 'EN_RETARD';

export interface FluxConfig {
  name: string;
  steps: Step[];
  durations: Record<Step, number>;
}

export interface Sample {
  type: string;
  applicable: boolean;
  sent: boolean;
  sendDate: string;
  expectedDate: string;
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
