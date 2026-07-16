import express, { Request, Response, NextFunction } from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import cors from 'cors';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import AdmZip from 'adm-zip';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { geminiUploadPdf, geminiGenerateJson, geminiDeleteFile } from './lib/gemini';
import { resolveMoveTarget, reorderIds, extractBilanJson } from './lib/opsReporting';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
const httpServer = createServer(app);

const isProduction = process.env.NODE_ENV === 'production';

if (!isProduction) {
  app.use(cors({
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    credentials: true
  }));
}

const io = new Server(httpServer, {
  cors: isProduction ? undefined : {
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    credentials: true
  }
});

app.use(express.json({ limit: '60mb' }));   // 60 Mo : PDF base64 (brouillon email Packing List, import multi-DDL rendement)

if (isProduction) {
  const distPath = path.join(__dirname, 'dist');
  console.log(`📂 Serving static files from: ${distPath}`);
  app.use(express.static(distPath));
}

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined
});

type UserRole = 'admin' | 'editor' | 'viewer';

interface User {
  id: string;
  username: string;
  password_hash: string;
  role: UserRole;
  created_at: Date;
}

interface JWTPayload {
  userId: string;
  username: string;
  role: UserRole;
  permissions?: string[];
}

// Onglets dont l'accès est attribuable par utilisateur (l'onglet « Utilisateurs » reste réservé admin).
const ATTRIBUTABLE_VIEWS = ['dashboard', 'kanban', 'prepprod', 'forecasts', 'ventes', 'quality', 'mirage', 'deliveries', 'pl', 'opsreporting', 'odooerp', 'supplychain', 'coa', 'qms', 'data', 'audit', 'settings'];

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

const SALT_ROUNDS = 10;

const FLUX_DEFAULTS = {
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

const DEFAULT_CLIENTS = ['DERMACITY', 'ETERNA GLOW', 'DERMABAY', 'FARMAS UA'];
const DEFAULT_STATUSES = ['UPCOMING', 'ON_TRACK', 'AT_RISK', 'COMPLETED'];

// --- Packing List & Factures : seed initial (catalogue produits, clients avec adresse, sites d'enlèvement) ---
// ref | designation | type | hs_code | unit_price | box_weight_kg | capacity_per_carton
const PL_SEED_PRODUCTS: [string, string, string, string | null, number | null, number | null, number | null][] = [
  ['DB-ILA', 'Innovyal Lightening Action', 'DM', '3304990', 36, 0.146, 56],
  ['DB-IRA', 'Innovyal Regenerative Action', 'DM', '3304990', 45, 0.146, 56],
  ['DB-IHA', 'Innovyal Hair Action', 'Cosmetic', '34013000', 42, 0.14, 56],
  ['DB-IRA-S', 'Innovyal Regenerative Action', 'DM', '901839900000', 50, 0.152, 47],
  ['DF-HAR1-2U', 'Louna Filler - Instant Refine', 'DM', '901839900000', 55, 0.114, 47],
  ['DF-HAR2-L-2U', 'Louna Filler - Glossy Lips', 'DM', '901839900000', 55, 0.114, 47],
  ['DF-HAR2-2U', 'Louna Filler - Shape&Volume', 'DM', '901839900000', 55, 0.114, 47],
  ['DF-HAR3-2U', 'Louna Filler - Maxi Lift', 'DM', '901839900000', 55, 0.114, 47],
  ['DF-HAR1-1U', 'Essentyal Touch', 'DM', '901839900000', 23, null, null],
  ['DF-HAR2-L-1U', 'Essentyal Lips', 'DM', '901839900000', 23, null, null],
  ['DF-HAR2-1U', 'Essentyal Volume', 'DM', '901839900000', 23, null, null],
  ['DF-HAR3-1U', 'Essentyal Extreme', 'DM', '901839900000', 23, null, null],
  ['DF-STIM0', 'Hydroxyal', 'DM', null, null, null, 47],
  ['DF-STIM1', 'Hydroxyal', 'DM', null, null, null, 47],
  ['COS-CLA', 'TXA Intense Corrector cream', 'Cosmetic', '34013000', 20, 0.18, 70],
  ['COS-SLA', 'TXA Intense Corrector serum', 'Cosmetic', '34013000', 20, 0.121, 15],
  ['COS-CYS', 'Cystea+ cream', 'Cosmetic', '34013000', 20, 0.18, 35],
  ['EXOSOME X1', 'Exovyal', 'Cosmetic', '34013000', 70, 0.11, 102],
  ['EXOSOME X2', 'Exovyal', 'Cosmetic', '34013000', 70, 0.11, 102],
];
// name | address | customer_id
const PL_SEED_CLIENTS: [string, string, string][] = [
  ['DERMA CITY MEDICAL Co.', '7324 King Abdulaziz Road - Ar Rabie Dist.\nUnit number : 15\nRiyadh 13315 -4790\nSAUDI ARABIA', 'DI001'],
  ['Derma Bay Trading L.LC', 'Blue Bay Tower office 1531 Business Bay Dubai uae\nTEL: +971566603177\nAttn: Ahmed Abd Al Aziz\nEmail: a.aziz@derma-bay.com', 'DI002'],
  ['ETERNA GLOW FZCO', 'License No 06380\nOffice Number 435 Fourth Floor Dubai Airport Free Zone\nAmr Shaaban Tel: +971 50 955 6867', 'DI003'],
  ['FARMAS UA', 'Bandery Stepana Ave, 13.\nKyiv city 04073\nUkraine', 'DI004'],
  ['Hope pharma medicine Trading', 'Shope8 Bldg1-16 Morocco cluster\nInternational city Dubai\nTEL: +04 2546625\nAttn: Ali ibrahem\nEmail: ali.zakiuae@gmail.com', ''],
];
// name | address (LFC / Bio-Steril / Albomed : adresses à compléter dans l'app)
const PL_SEED_SITES: [string, string][] = [
  ['Louna', 'Louna Aesthetics\n30 route des Creusettes, 74330 Poisy – France'],
  ['LFC', 'À compléter'],
  ['Bio-Steril', 'À compléter'],
  ['Albomed', 'À compléter'],
];

// --- Refonte du suivi des lots : 3 axes orthogonaux ---
type ProcessStage = 'PLANIFIE' | 'FORMULATION' | 'CONDI_PRIM' | 'CONDI_SEC' | 'LIBERATION' | 'ATTENTE_ENLEVEMENT' | 'EXPEDIE';
type QualityStatus = 'NOT_STARTED' | 'EN_COURS' | 'QUARANTAINE' | 'LIBERE' | 'REJETE';
type ScheduleHealth = 'ON_TRACK' | 'AT_RISK' | 'EN_RETARD';
type SampleStatus = 'A_ENVOYER' | 'ENVOYE' | 'RESULTATS_RECUS' | 'CONFORME' | 'NON_CONFORME';

const SCHEDULE_MARGIN_DAYS = 7;

// Configuration des tests labo (étape de prélèvement + délai d'analyse). Éditable via Réglages.
const DEFAULT_SAMPLE_CONFIG = {
  mapping: {
    INTERTEK_BIO: 'FORMULATION',
    INTERTEK_EPC: 'CONDI_PRIM',
    CHARLES_RIVERS_ENDO: 'CONDI_PRIM'
  } as Record<string, ProcessStage>,
  analysisLeadDays: {
    INTERTEK_BIO: 10,
    INTERTEK_EPC: 21,
    CHARLES_RIVERS_ENDO: 21
  } as Record<string, number>,
  businessDays: false
};

// Transitions de statut autorisées. L'écran avance clic par clic mais n'enregistre
// qu'à la fin : on accepte donc les sauts en avant dans la séquence (les dates
// d'envoi/réception et le motif NC restent exigés par validateSamples).
// Les retours en arrière restent limités à une étape.
const SAMPLE_STATUS_TRANSITIONS: Record<string, string[]> = {
  A_ENVOYER: ['ENVOYE', 'RESULTATS_RECUS', 'CONFORME', 'NON_CONFORME'],
  ENVOYE: ['A_ENVOYER', 'RESULTATS_RECUS', 'CONFORME', 'NON_CONFORME'],
  RESULTATS_RECUS: ['ENVOYE', 'CONFORME', 'NON_CONFORME'],
  CONFORME: ['RESULTATS_RECUS'],
  NON_CONFORME: ['RESULTATS_RECUS']
};

const STATUS_AFTER_ENVOI: SampleStatus[] = ['ENVOYE', 'RESULTATS_RECUS', 'CONFORME', 'NON_CONFORME'];

// Partenaires / laboratoires sélectionnables pour les tests. Éditable via Réglages.
const DEFAULT_SAMPLE_PARTNERS = ['Intertek', 'Charles River'];

// Catalogue produits configurable (réglage 'productCatalog'). Éditable via Réglages.
const DEFAULT_PRODUCT_CATALOG = [
  { type: 'HYDRAGEL A1 DM', name: 'INNOVYAL LIGHTENING ACTION', ref: 'DB-ILA', condit: 3, contenant: 'FLACON', volume: 3.3 },
  { type: 'HYDRAGEL A1 COS', name: 'INNOVYAL LIGHTENING ACTION', ref: 'DB-ILA-C', condit: 3, contenant: 'FLACON', volume: 3.3 },
  { type: 'HYDRAGEL A2 DM', name: 'INNOVYAL REGENERATIVE ACTION', ref: 'DB-IRA', condit: 3, contenant: 'FLACON', volume: 3.3 },
  { type: 'HYDRAGEL A2 COS', name: 'INNOVYAL REGENERATIVE ACTION', ref: 'DB-IRA-C', condit: 3, contenant: 'FLACON', volume: 3.3 },
  { type: 'HYDRAGEL A3 COS', name: 'INNOVYAL HAIR ACTION', ref: 'DB-IHA-C', condit: 3, contenant: 'FLACON', volume: 3.3 },
  { type: 'STIM', name: 'HYDROXYAL', ref: 'DF-STIM0', condit: 1, contenant: 'SERINGUE', volume: 1.5 },
  { type: 'STIM +', name: 'HYDROXYAL +', ref: 'DF-STIM1', condit: 1, contenant: 'SERINGUE', volume: 1.5 },
  { type: 'EXOSOME', name: 'EXOVYAL', ref: 'EXOSOME X1', condit: 1, contenant: 'FLACON', volume: 3.3 },
  { type: 'HYDRAGEL A2 SYRINGE', name: 'INNOVYAL REGENERATIVE ACTION -LIFT', ref: 'DB-IRA-S', condit: 2, contenant: 'SERINGUE', volume: 2.1 },
  { type: 'HAR1-LOUNA FILLERS', name: 'INSTANT REFINE', ref: 'DF-HAR1-2U', condit: 2, contenant: 'SERINGUE', volume: 1.1 },
  { type: 'HAR2-LOUNA FILLERS', name: 'SHAPE & VOLUME', ref: 'DF-HAR2-2U', condit: 2, contenant: 'SERINGUE', volume: 1.1 },
  { type: 'HAR2L-LOUNA FILLERS', name: 'GLOSSY LIPS', ref: 'DF-HAR2-L-2U', condit: 2, contenant: 'SERINGUE', volume: 1.1 },
  { type: 'HAR3-LOUNA FILLERS', name: 'MAXI LIFT', ref: 'DF-HAR3-2U', condit: 2, contenant: 'SERINGUE', volume: 1.1 },
  { type: 'HAR1-ESSENTYAL', name: 'TOUCH', ref: 'DF-HAR1-1U', condit: 1, contenant: 'SERINGUE', volume: 2.1 },
  { type: 'HAR2-ESSENTYAL', name: 'VOLUME', ref: 'DF-HAR2-1U', condit: 1, contenant: 'SERINGUE', volume: 2.1 },
  { type: 'HAR2L-ESSENTYAL', name: 'LIPS', ref: 'DF-HAR2-L-1U', condit: 1, contenant: 'SERINGUE', volume: 2.1 },
  { type: 'HAR3-ESSENTYAL', name: 'EXTREME', ref: 'DF-HAR3-1U', condit: 1, contenant: 'SERINGUE', volume: 2.1 }
];

// Référentiel des types de défauts mirage (réglage 'mirageDefectTypes', extensible via l'onglet Mirage).
// Un même défaut peut être formulé différemment selon les dossiers (seringues vs flacons) : tout est rationalisé vers cette liste.
const DEFAULT_MIRAGE_DEFECT_TYPES = [
  'Particules/fibres blanches',
  'Particules/fibres noires',
  'Particules/fibres roses',
  'Particules/fibres bleues',
  'Particules/fibres rouges',
  'Particules/fibres jaunes',
  'Particules/fibres autres couleurs',
  'Corps étranger',
  "Bulles d'air",
  'Volume / remplissage',
  'Flacon vide',
  'Capsule - déformation',
  'Capsule - sertissage insuffisant',
  'Capsule - absence',
  'Capsule - tache',
  'Bouchon - abîmé',
  'Bouchon - absence',
  'Bouchon - positionnement',
  'Bouchon - tache',
  "Flacon - ligne d'air",
  'Flacon - rayure',
  'Flacon - casse',
  'Flacon - déformation',
  'Seringue - casse',
  'Piston - défaut',
  'Fuite / étanchéité',
  'Défaut cosmétique / aspect',
  'Étiquetage',
  'Non précisé',
];

// Partenaire par défaut par test (pour la migration des samples existants).
const SAMPLE_DEFAULT_PARTNER: Record<string, string> = {
  INTERTEK_BIO: 'Intertek',
  INTERTEK_EPC: 'Intertek',
  CHARLES_RIVERS_ENDO: 'Charles River'
};

// Axe 3 : Santé délai. Calculée à la volée, jamais stockée ni acceptée en écriture.
function computeScheduleHealth(
  endDate: string | null | undefined,
  deliveryDate: string | null | undefined,
  process_stage: string | null | undefined
): ScheduleHealth {
  if (!deliveryDate) return 'ON_TRACK';
  const delivery = new Date(deliveryDate);
  if (isNaN(delivery.getTime())) return 'ON_TRACK';

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Lot planifié non démarré : pas d'alerte tant que la livraison souhaitée n'est pas dépassée
  if (process_stage === 'PLANIFIE') {
    return today > delivery ? 'EN_RETARD' : 'ON_TRACK';
  }

  // Livraison souhaitée déjà passée et lot non expédié → en retard (même si Fin Fab inconnue)
  if (today > delivery && process_stage !== 'EXPEDIE') return 'EN_RETARD';
  if (!endDate) return 'ON_TRACK';
  const end = new Date(endDate);
  if (isNaN(end.getTime())) return 'ON_TRACK';
  if (end > delivery) return 'EN_RETARD';

  const marginDays = Math.round((delivery.getTime() - end.getTime()) / (1000 * 60 * 60 * 24));
  if (marginDays >= SCHEDULE_MARGIN_DAYS) return 'ON_TRACK';
  return 'AT_RISK';
}

// Valide la cohérence inter-axes. Retourne un message d'erreur FR ou null si OK.
function validateAxes(process_stage: string | undefined, quality_status: string | undefined): string | null {
  // PLANIFIE (étape la plus précoce, avant FORMULATION) et NOT_STARTED : aucune contrainte spéciale.
  if (quality_status === 'LIBERE' && process_stage !== 'LIBERATION' && process_stage !== 'ATTENTE_ENLEVEMENT' && process_stage !== 'EXPEDIE') {
    return 'Le statut qualité « Libéré » nécessite une étape process « Libération », « Attente d\'enlèvement » ou « Expédié ».';
  }
  if (process_stage === 'EXPEDIE' && quality_status !== 'LIBERE') {
    return 'L\'étape process « Expédié » nécessite un statut qualité « Libéré ».';
  }
  return null;
}

// Dérive le process_stage depuis le label de l'étape flux (pour la migration one-shot).
function deriveStageFromStepLabel(label: string): ProcessStage {
  const l = (label || '').toLowerCase();
  if (l.includes('formul') || l.includes('répart') || l.includes('repart')) return 'FORMULATION';
  if (l.includes('condi prim') || l.includes('cond. prim') || l.includes('primaire') || l.includes('mirage') || l.includes('blister')) return 'CONDI_PRIM';
  if (l.includes('condi sec') || l.includes('cond. sec') || l.includes('secondaire') || l.includes('condi') || l.includes('boite') || l.includes('boîte') || l.includes('finition')) return 'CONDI_SEC';
  if (l.includes('libération') || l.includes('liberation')) return 'LIBERATION';
  return 'FORMULATION';
}

function addDaysIso(dateStr: string, days: number, businessDays = false): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  if (!businessDays) {
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
  }
  // Jours ouvrés : saute samedis/dimanches. Jours fériés non gérés.
  let remaining = days;
  while (remaining > 0) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) remaining--;
  }
  return d.toISOString().split('T')[0];
}

// Recule de N jours ouvrés (samedis/dimanches sautés ; jours fériés non gérés). Pour l'échéance de validation DDL.
function subBusinessDaysIso(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  let remaining = days;
  while (remaining > 0) { d.setDate(d.getDate() - 1); const dow = d.getDay(); if (dow !== 0 && dow !== 6) remaining--; }
  return d.toISOString().split('T')[0];
}
// Date ISO (AAAA-MM-JJ) → JJ/MM/AAAA.
function fmtFrDate(iso?: string | null): string { const s = String(iso || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.split('-').reverse().join('/') : (s || '—'); }

// Calcul 1 (date_reception_echantillon) + Calcul 2 (date_resultats_attendue) + configError.
// Mute le sample en place.
function computeSampleDates(sample: any, flux: any, startDate: string | undefined, sampleConfig: any) {
  if (!sample.applicable) {
    sample.dateReceptionEchantillon = '';
    sample.dateResultatsAttendue = '';
    sample.configError = false;
    return sample;
  }

  const stage = sampleConfig.mapping?.[sample.type];
  const businessDays = !!sampleConfig.businessDays;

  // Calcul 1
  let reception = '';
  let configError = false;
  if (!flux || !startDate || !stage) {
    reception = '';
  } else {
    let weeks = 0;
    let found = false;
    for (const label of (flux.steps || [])) {
      if (label === '-') continue;
      weeks += flux.durations?.[label] || 0;
      if (deriveStageFromStepLabel(label) === stage) {
        found = true;
        break;
      }
    }
    if (!found) {
      configError = true;
      reception = '';
    } else {
      reception = addDaysIso(startDate, weeks * 7, businessDays);
    }
  }
  sample.configError = configError;
  sample.dateReceptionEchantillon = reception;

  // Calcul 2
  const lead = sampleConfig.analysisLeadDays?.[sample.type] || 0;
  const base = (STATUS_AFTER_ENVOI.includes(sample.status) && sample.dateEnvoi)
    ? sample.dateEnvoi
    : reception;
  sample.dateResultatsAttendue = base ? addDaysIso(base, lead, businessDays) : '';

  return sample;
}

async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT DEFAULT 'viewer' CHECK (role IN ('admin', 'editor', 'viewer')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS batches (
        id TEXT PRIMARY KEY,
        fluxKey TEXT NOT NULL,
        reference TEXT,
        client TEXT,
        product TEXT,
        stepIndex INTEGER DEFAULT 0,
        status TEXT DEFAULT 'UPCOMING' CHECK (status IN ('UPCOMING', 'ON_TRACK', 'AT_RISK', 'COMPLETED')),
        progress INTEGER DEFAULT 0,
        startDate TEXT,
        endDate TEXT,
        deliveryDate TEXT,
        notes TEXT,
        volume INTEGER DEFAULT 0,
        boxesTarget INTEGER DEFAULT 0,
        distributed INTEGER DEFAULT 0,
        conform INTEGER DEFAULT 0,
        sold INTEGER DEFAULT 0,
        palettes INTEGER DEFAULT 0,
        samples JSONB DEFAULT '[]'::jsonb,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS deliveries (
        id TEXT PRIMARY KEY,
        batchId TEXT NOT NULL,
        client TEXT,
        date TEXT,
        boxesSold INTEGER DEFAULT 0,
        palettes INTEGER DEFAULT 0,
        status TEXT DEFAULT 'PLANIFIÉ' CHECK (status IN ('PRÊT', 'PLANIFIÉ', 'EN ATTENTE', 'RETARDÉ', 'EXPÉDIÉ')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value JSONB
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        username TEXT NOT NULL,
        action_type TEXT NOT NULL,
        resource_id TEXT,
        description TEXT NOT NULL,
        ip_address TEXT,
        user_agent TEXT
      )
    `);

    // Migrations de schéma pour s'assurer que toutes les colonnes requises existent
    console.log('🔄 Exécution des migrations de schéma...');
    
    // Table batches
    await client.query("ALTER TABLE batches ADD COLUMN IF NOT EXISTS fluxKey TEXT NOT NULL DEFAULT ''");
    await client.query("ALTER TABLE batches ADD COLUMN IF NOT EXISTS reference TEXT");
    await client.query("ALTER TABLE batches ADD COLUMN IF NOT EXISTS client TEXT");
    await client.query("ALTER TABLE batches ADD COLUMN IF NOT EXISTS product TEXT");
    await client.query("ALTER TABLE batches ADD COLUMN IF NOT EXISTS stepIndex INTEGER DEFAULT 0");
    await client.query("ALTER TABLE batches ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'UPCOMING'");
    await client.query("ALTER TABLE batches ADD COLUMN IF NOT EXISTS progress INTEGER DEFAULT 0");
    await client.query("ALTER TABLE batches ADD COLUMN IF NOT EXISTS startDate TEXT");
    await client.query("ALTER TABLE batches ADD COLUMN IF NOT EXISTS endDate TEXT");
    await client.query("ALTER TABLE batches ADD COLUMN IF NOT EXISTS deliveryDate TEXT");
    await client.query("ALTER TABLE batches ADD COLUMN IF NOT EXISTS notes TEXT");
    await client.query("ALTER TABLE batches ADD COLUMN IF NOT EXISTS volume INTEGER DEFAULT 0");
    await client.query("ALTER TABLE batches ADD COLUMN IF NOT EXISTS boxesTarget INTEGER DEFAULT 0");
    await client.query("ALTER TABLE batches ADD COLUMN IF NOT EXISTS distributed INTEGER DEFAULT 0");
    await client.query("ALTER TABLE batches ADD COLUMN IF NOT EXISTS conform INTEGER DEFAULT 0");
    await client.query("ALTER TABLE batches ADD COLUMN IF NOT EXISTS sold INTEGER DEFAULT 0");
    await client.query("ALTER TABLE batches ADD COLUMN IF NOT EXISTS palettes INTEGER DEFAULT 0");
    await client.query("ALTER TABLE batches ADD COLUMN IF NOT EXISTS samples JSONB DEFAULT '[]'::jsonb");
    await client.query("ALTER TABLE batches ADD COLUMN IF NOT EXISTS milestones JSONB DEFAULT '{}'::jsonb");
    await client.query("ALTER TABLE batches ADD COLUMN IF NOT EXISTS note_entries JSONB DEFAULT '[]'::jsonb");
    await client.query("ALTER TABLE batches ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP");

    // Migration idempotente : initialiser note_entries depuis l'ancien champ notes (legacy)
    // pour les lots dont l'historique est vide mais qui ont des notes existantes (ex. DA102C).
    await client.query(`
      UPDATE batches
      SET note_entries = jsonb_build_array(
        jsonb_build_object(
          'user', '(historique)',
          'at', to_char(COALESCE(created_at, CURRENT_TIMESTAMP) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'text', notes
        )
      )
      WHERE COALESCE(note_entries, '[]'::jsonb) = '[]'::jsonb
        AND notes IS NOT NULL
        AND btrim(notes) <> ''
    `);

    // Refonte 3 axes : nouvelles colonnes (schedule_health n'est PAS stocké, calculé à la volée)
    await client.query("ALTER TABLE batches ADD COLUMN IF NOT EXISTS process_stage TEXT");
    await client.query("ALTER TABLE batches ADD COLUMN IF NOT EXISTS quality_status TEXT");

    // Table deliveries
    await client.query("ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS batchId TEXT NOT NULL DEFAULT ''");
    await client.query("ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS client TEXT");
    await client.query("ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS date TEXT");
    await client.query("ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS boxesSold INTEGER DEFAULT 0");
    await client.query("ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS palettes INTEGER DEFAULT 0");
    await client.query("ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'PLANIFIÉ'");

    // Déduplication : au plus une livraison par lot (corrige d'anciens doublons). N'affecte pas les entrées manuelles ('', 'N/A').
    await client.query(`
      DELETE FROM deliveries a USING deliveries b
      WHERE a.ctid < b.ctid
        AND a.batchId = b.batchId
        AND a.batchId NOT IN ('', 'N/A')
    `);

    // Permissions par onglet (par utilisateur). Les comptes existants conservent l'accès à tout.
    await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions JSONB");
    await client.query("UPDATE users SET permissions = $1::jsonb WHERE permissions IS NULL", [JSON.stringify(ATTRIBUTABLE_VIEWS)]);

    // Préparation prod : checklist documentaire par lot ({ taskId: true/false })
    await client.query("ALTER TABLE batches ADD COLUMN IF NOT EXISTS preptasks JSONB DEFAULT '{}'::jsonb");

    console.log('✅ Migrations de schéma terminées');

    // Supprimer la contrainte check sur le statut des lots pour autoriser des statuts personnalisés
    await client.query("ALTER TABLE batches DROP CONSTRAINT IF EXISTS batches_status_check;");

    const usersResult = await client.query('SELECT COUNT(*) FROM users');
    if (parseInt(usersResult.rows[0].count) === 0) {
      const defaultUsername = process.env.ADMIN_USERNAME || 'admin';
      const defaultPassword = process.env.ADMIN_PASSWORD || 'louna2026';
      const passwordHash = await bcrypt.hash(defaultPassword, SALT_ROUNDS);

      await client.query(
        'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3)',
        [defaultUsername, passwordHash, 'admin']
      );
      console.log(`✅ Utilisateur admin créé: ${defaultUsername} / ${defaultPassword}`);
    }

    const configResult = await client.query("SELECT value FROM settings WHERE key = 'fluxConfig'");
    if (configResult.rows.length === 0) {
      await client.query(
        "INSERT INTO settings (key, value) VALUES ('fluxConfig', $1)",
        [JSON.stringify(FLUX_DEFAULTS)]
      );
    }

    const clientsResult = await client.query("SELECT value FROM settings WHERE key = 'clients'");
    if (clientsResult.rows.length === 0) {
      await client.query(
        "INSERT INTO settings (key, value) VALUES ('clients', $1)",
        [JSON.stringify(DEFAULT_CLIENTS)]
      );
    }

    const statusesResult = await client.query("SELECT value FROM settings WHERE key = 'statuses'");
    if (statusesResult.rows.length === 0) {
      await client.query(
        "INSERT INTO settings (key, value) VALUES ('statuses', $1)",
        [JSON.stringify(DEFAULT_STATUSES)]
      );
    }

    const sampleConfigResult = await client.query("SELECT value FROM settings WHERE key = 'sampleConfig'");
    if (sampleConfigResult.rows.length === 0) {
      await client.query(
        "INSERT INTO settings (key, value) VALUES ('sampleConfig', $1)",
        [JSON.stringify(DEFAULT_SAMPLE_CONFIG)]
      );
    }

    const samplePartnersResult = await client.query("SELECT value FROM settings WHERE key = 'samplePartners'");
    if (samplePartnersResult.rows.length === 0) {
      await client.query(
        "INSERT INTO settings (key, value) VALUES ('samplePartners', $1)",
        [JSON.stringify(DEFAULT_SAMPLE_PARTNERS)]
      );
    }

    const productCatalogResult = await client.query("SELECT value FROM settings WHERE key = 'productCatalog'");
    if (productCatalogResult.rows.length === 0) {
      await client.query(
        "INSERT INTO settings (key, value) VALUES ('productCatalog', $1)",
        [JSON.stringify(DEFAULT_PRODUCT_CATALOG)]
      );
    }

    // --- Migration de données one-shot (idempotente) : éclatement de `status` en 3 axes ---
    const toMigrate = await client.query("SELECT * FROM batches WHERE process_stage IS NULL");
    if (toMigrate.rows.length > 0) {
      console.log(`🔄 Migration 3 axes de ${toMigrate.rows.length} lot(s)...`);
      const fluxCfgRes = await client.query("SELECT value FROM settings WHERE key = 'fluxConfig'");
      const fluxConfig = fluxCfgRes.rows[0]?.value || FLUX_DEFAULTS;

      for (const row of toMigrate.rows) {
        const oldStatus = row.status;
        let process_stage: ProcessStage;
        let quality_status: QualityStatus;

        if (oldStatus === 'LIBERE' || oldStatus === 'COMPLETED') {
          process_stage = 'LIBERATION';
          quality_status = 'LIBERE';
        } else if (oldStatus === 'ENLEVE') {
          process_stage = 'EXPEDIE';
          quality_status = 'LIBERE';
        } else {
          quality_status = 'EN_COURS';
          const flux = fluxConfig[row.fluxkey];
          const stepLabel = (flux?.steps && flux.steps[row.stepindex]) || '';
          process_stage = deriveStageFromStepLabel(stepLabel);
        }

        await client.query(
          'UPDATE batches SET process_stage = $1, quality_status = $2 WHERE id = $3',
          [process_stage, quality_status, row.id]
        );

        await client.query(
          `INSERT INTO audit_logs (username, action_type, resource_id, description)
           VALUES ($1, $2, $3, $4)`,
          [
            'Système',
            'BATCH_MIGRATE_AXES',
            row.id,
            `Migration 3 axes du lot ${row.id} : ancien statut '${oldStatus}' → process_stage='${process_stage}', quality_status='${quality_status}'`
          ]
        );
      }
      console.log('✅ Migration 3 axes terminée');
    }

    // --- Migration de données one-shot (idempotente) : refonte des samples (3 tests + 2 dates) ---
    const fluxCfgRes2 = await client.query("SELECT value FROM settings WHERE key = 'fluxConfig'");
    const fluxConfigMig = fluxCfgRes2.rows[0]?.value || FLUX_DEFAULTS;
    const sampleCfgRes = await client.query("SELECT value FROM settings WHERE key = 'sampleConfig'");
    const sampleConfigMig = sampleCfgRes.rows[0]?.value || DEFAULT_SAMPLE_CONFIG;

    const allBatches = await client.query("SELECT * FROM batches");
    const KNOWN_KEYS = ['INTERTEK_BIO', 'INTERTEK_EPC', 'CHARLES_RIVERS_ENDO'];

    const mapOldType = (t: string): string | null => {
      const u = (t || '').toLowerCase();
      if (KNOWN_KEYS.includes(t)) return t; // déjà au nouveau format
      if (u.includes('biocharge')) return 'INTERTEK_BIO';
      if (u.includes('epc')) return 'INTERTEK_EPC';
      if (u.includes('endotox')) return 'CHARLES_RIVERS_ENDO';
      return null; // 'interne' ou inconnu → hors périmètre
    };

    for (const row of allBatches.rows) {
      const raw = typeof row.samples === 'string' ? JSON.parse(row.samples) : (row.samples || []);
      if (!Array.isArray(raw)) continue;

      // Idempotence : ne migrer que si au moins un sample a encore l'ancien format
      const needsMig = raw.some((s: any) =>
        s && (('sent' in s) || ('expectedDate' in s) || ('sendDate' in s) || !KNOWN_KEYS.includes(s.type))
      );
      if (!needsMig) continue;

      const newSamples: any[] = [];
      for (const s of raw) {
        if (!s) continue;
        const key = mapOldType(s.type);
        if (!key) continue; // ligne retirée (hors périmètre)

        let status: SampleStatus;
        let dateEnvoi = s.dateEnvoi || s.sendDate || '';
        if (s.sent === true && dateEnvoi) {
          status = 'ENVOYE';
        } else if (s.status && ['A_ENVOYER', 'ENVOYE', 'RESULTATS_RECUS', 'CONFORME', 'NON_CONFORME'].includes(s.status)) {
          status = s.status;
          if (STATUS_AFTER_ENVOI.includes(status) && !dateEnvoi) status = 'A_ENVOYER';
        } else {
          status = 'A_ENVOYER';
        }

        const applicable = s.applicable === true;
        const ns: any = {
          type: key,
          partner: typeof s.partner === 'string' ? s.partner : (applicable ? (SAMPLE_DEFAULT_PARTNER[key] || '') : ''),
          applicable,
          status,
          dateEnvoi,
          dateReceptionEchantillon: '',
          dateResultatsAttendue: '',
          configError: false,
          datePrelevementReel: s.datePrelevementReel || '',
          dateResultatsRecus: s.dateResultatsRecus || '',
          rapportRef: s.rapportRef || '',
          rapportUrl: s.rapportUrl || '',
          motifNonConforme: s.motifNonConforme || '',
          history: Array.isArray(s.history) ? s.history : []
        };
        computeSampleDates(ns, fluxConfigMig[row.fluxkey], row.startdate, sampleConfigMig);
        newSamples.push(ns);
      }

      await client.query(
        'UPDATE batches SET samples = $1::jsonb WHERE id = $2',
        [JSON.stringify(newSamples), row.id]
      );

      await client.query(
        `INSERT INTO audit_logs (username, action_type, resource_id, description)
         VALUES ($1, $2, $3, $4)`,
        [
          'Système',
          'SAMPLE_MIGRATE',
          row.id,
          `Migration échantillons du lot ${row.id} : ${raw.length} ancien(s) → ${newSamples.length} test(s) au nouveau format (clés ${newSamples.map((x: any) => x.type).join(', ') || 'aucune'})`
        ]
      );
    }

    // --- Migration idempotente : champ `partner` sur les samples au nouveau format ---
    const batchesForPartner = await client.query("SELECT id, samples FROM batches");
    for (const row of batchesForPartner.rows) {
      const arr = typeof row.samples === 'string' ? JSON.parse(row.samples) : (row.samples || []);
      if (!Array.isArray(arr) || arr.length === 0) continue;

      const needsPartner = arr.some((s: any) => s && !('partner' in s));
      if (!needsPartner) continue;

      for (const s of arr) {
        if (!s || 'partner' in s) continue;
        s.partner = s.applicable === true ? (SAMPLE_DEFAULT_PARTNER[s.type] || '') : '';
      }

      await client.query(
        'UPDATE batches SET samples = $1::jsonb WHERE id = $2',
        [JSON.stringify(arr), row.id]
      );

      await client.query(
        `INSERT INTO audit_logs (username, action_type, resource_id, description)
         VALUES ($1, $2, $3, $4)`,
        [
          'Système',
          'SAMPLE_MIGRATE',
          row.id,
          `Initialisation du champ partenaire des échantillons du lot ${row.id}`
        ]
      );
    }

    // --- Migration idempotente : nouveaux champs optionnels sur les samples ---
    const NEW_SAMPLE_FIELDS: Record<string, any> = {
      datePrelevementReel: '',
      dateResultatsRecus: '',
      rapportRef: '',
      rapportUrl: '',
      motifNonConforme: '',
      history: []
    };
    const batchesForNewFields = await client.query("SELECT id, samples FROM batches");
    for (const row of batchesForNewFields.rows) {
      const arr = typeof row.samples === 'string' ? JSON.parse(row.samples) : (row.samples || []);
      if (!Array.isArray(arr) || arr.length === 0) continue;

      const needs = arr.some((s: any) => s && Object.keys(NEW_SAMPLE_FIELDS).some(k => !(k in s)));
      if (!needs) continue;

      for (const s of arr) {
        if (!s) continue;
        for (const [k, v] of Object.entries(NEW_SAMPLE_FIELDS)) {
          if (!(k in s)) s[k] = Array.isArray(v) ? [] : v;
        }
      }

      await client.query(
        'UPDATE batches SET samples = $1::jsonb WHERE id = $2',
        [JSON.stringify(arr), row.id]
      );
    }

    // --- Migration idempotente : champ businessDays sur sampleConfig ---
    const cfgRow = await client.query("SELECT value FROM settings WHERE key = 'sampleConfig'");
    if (cfgRow.rows.length > 0) {
      const cfg = cfgRow.rows[0].value || {};
      if (!('businessDays' in cfg)) {
        cfg.businessDays = false;
        await client.query(
          "UPDATE settings SET value = $1 WHERE key = 'sampleConfig'",
          [JSON.stringify(cfg)]
        );
      }
    }

    // --- Migration idempotente : jalons de production (3 jalons) ---
    const batchesForMilestones = await client.query("SELECT id, milestones FROM batches");
    for (const row of batchesForMilestones.rows) {
      const m = typeof row.milestones === 'string' ? JSON.parse(row.milestones) : (row.milestones || {});
      const hasAll = m && m.CONDI_PRIM && m.CONDI_SEC && m.LIBERATION;
      if (hasAll) continue;
      const init = {
        CONDI_PRIM: m?.CONDI_PRIM || { done: false },
        CONDI_SEC: m?.CONDI_SEC || { done: false },
        LIBERATION: m?.LIBERATION || { done: false }
      };
      await client.query(
        'UPDATE batches SET milestones = $1::jsonb WHERE id = $2',
        [JSON.stringify(init), row.id]
      );
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS forecasts (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        product_type TEXT,
        product TEXT,
        reference TEXT,
        client TEXT,
        planned_quantity INTEGER DEFAULT 0,
        target_start TEXT,
        target_end TEXT,
        status TEXT DEFAULT 'EN_DISCUSSION',
        notes TEXT,
        converted_batch_id TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // --- Module Reporting Ops : board projet → milestone → deliverable + commentaires hebdo ---
    await client.query(`
      CREATE TABLE IF NOT EXISTS ops_projects (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        name TEXT NOT NULL,
        code TEXT UNIQUE,
        color TEXT,
        archived BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ops_milestones (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        project_id UUID REFERENCES ops_projects(id) ON DELETE CASCADE,
        number INTEGER,
        title TEXT NOT NULL,
        status TEXT DEFAULT 'not_started',
        deadline TEXT,
        owner TEXT,
        archived BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ops_deliverables (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        milestone_id UUID REFERENCES ops_milestones(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        status TEXT DEFAULT 'not_started',
        deadline TEXT,
        owner TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ops_weekly_comments (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        entity_type TEXT NOT NULL,
        entity_id UUID NOT NULL,
        iso_week TEXT NOT NULL,
        text TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (entity_type, entity_id, iso_week)
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ops_deadline_history (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        entity_type TEXT NOT NULL,
        entity_id UUID NOT NULL,
        old_deadline TEXT,
        new_deadline TEXT,
        changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // is_slip : un report d'échéance est-il un glissement à comptabiliser (true) ou une simple correction (false) ?
    await client.query(`ALTER TABLE ops_deadline_history ADD COLUMN IF NOT EXISTS is_slip BOOLEAN DEFAULT TRUE`);
    // Photo hebdomadaire des chiffres clés Ops → tendance semaine N vs N-1 dans le débrief.
    await client.query(`
      CREATE TABLE IF NOT EXISTS ops_kpi_snapshots (
        iso_week TEXT PRIMARY KEY,
        milestones_done INTEGER, milestones_total INTEGER,
        deliverables_done INTEGER, deliverables_total INTEGER,
        retards INTEGER, glissements INTEGER,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // F1 — ordre explicite d'un livrable au sein de son jalon (réordonnancement réservé admin).
    await client.query(`ALTER TABLE ops_deliverables ADD COLUMN IF NOT EXISTS ordre INTEGER`);
    // Backfill : numérote 1..n par jalon selon l'ordre de création, pour les lignes pas encore numérotées.
    await client.query(`
      WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY milestone_id ORDER BY created_at) AS rn
        FROM ops_deliverables WHERE ordre IS NULL
      )
      UPDATE ops_deliverables d SET ordre = r.rn FROM ranked r WHERE d.id = r.id
    `);
    // F2 — statut d'intégration des commentaires hebdo + note de synthèse hebdo versionnée (garde-fou concurrence).
    await client.query(`ALTER TABLE ops_weekly_comments ADD COLUMN IF NOT EXISTS statut TEXT DEFAULT 'ouvert'`);
    await client.query(`ALTER TABLE ops_weekly_comments ADD COLUMN IF NOT EXISTS integrated_at TIMESTAMP`);
    await client.query(`ALTER TABLE ops_weekly_comments ADD COLUMN IF NOT EXISTS integrated_by TEXT`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ops_synthesis_notes (
        iso_week TEXT PRIMARY KEY,
        corps TEXT DEFAULT '',
        version INTEGER DEFAULT 1,
        updated_by TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // F4 — bilan IA enregistré (JSON éditable) par semaine.
    await client.query(`
      CREATE TABLE IF NOT EXISTS ops_ia_bilans (
        iso_week TEXT PRIMARY KEY,
        contenu JSONB,
        updated_by TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // Historique des bilans enregistrés (une entrée par enregistrement, horodatée).
    await client.query(`
      CREATE TABLE IF NOT EXISTS ops_bilan_history (
        id SERIAL PRIMARY KEY,
        iso_week TEXT,
        contenu JSONB,
        created_by TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // Compétences de Maya : fiches méthode éditables (nom + déclencheur + contenu) que l'assistant charge à la demande.
    await client.query(`
      CREATE TABLE IF NOT EXISTS maya_skills (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        trigger TEXT DEFAULT '',
        body TEXT DEFAULT '',
        enabled BOOLEAN DEFAULT TRUE,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // Mirage : plans d'action qualité enregistrés (proposés par l'IA, éditables, suivis).
    await client.query(`
      CREATE TABLE IF NOT EXISTS mirage_action_plans (
        id SERIAL PRIMARY KEY,
        defaut TEXT DEFAULT '',
        action TEXT NOT NULL,
        responsable TEXT DEFAULT '',
        priorite INTEGER DEFAULT 2,
        echeance DATE,
        statut TEXT DEFAULT 'à faire',
        synthese TEXT DEFAULT '',
        created_by TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // Forecast Ventes / pilotage CA : forecast (prévisionnel) + réalisé (override manuel), par ligne produit, qtés mensuelles m1..m12.
    await client.query(`
      CREATE TABLE IF NOT EXISTS ventes_forecast (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        year INTEGER NOT NULL,
        pays TEXT DEFAULT '',
        ligne_produit TEXT DEFAULT '',
        produit TEXT DEFAULT '',
        prix_unitaire NUMERIC DEFAULT 0,
        qty JSONB DEFAULT '[0,0,0,0,0,0,0,0,0,0,0,0]'::jsonb,
        retire BOOLEAN DEFAULT FALSE,
        archived BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ventes_realise (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        year INTEGER NOT NULL,
        pays TEXT DEFAULT '',
        ligne_produit TEXT DEFAULT '',
        produit TEXT DEFAULT '',
        prix_unitaire NUMERIC DEFAULT 0,
        qty JSONB DEFAULT '[0,0,0,0,0,0,0,0,0,0,0,0]'::jsonb,
        archived BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // code_odoo : lien vers le code article Odoo (DB-IRA, DF-HAR2-2U, COS-CLA…) — produit standardisé sur la dénomination Odoo.
    await client.query(`ALTER TABLE ventes_forecast ADD COLUMN IF NOT EXISTS code_odoo TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE ventes_realise ADD COLUMN IF NOT EXISTS code_odoo TEXT DEFAULT ''`);
    // date_attendue : date de livraison prévue d'une commande (le « mois attendu » du scénario en est déduit).
    await client.query(`ALTER TABLE ventes_forecast ADD COLUMN IF NOT EXISTS date_attendue DATE`);
    // Meta du forecast par année : quels mois sont marqués « réalisé » (12 booléens, colonne verte) + horodatage de mise à jour.
    await client.query(`
      CREATE TABLE IF NOT EXISTS ventes_forecast_meta (
        year INTEGER PRIMARY KEY,
        realized_months JSONB DEFAULT '[false,false,false,false,false,false,false,false,false,false,false,false]'::jsonb,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // Seed des 4 projets actuels (idempotent)
    await client.query(`
      INSERT INTO ops_projects (name, code, color) VALUES
        ('ALBOMED', 'ALBOMED', '#2563eb'),
        ('STIM', 'STIM', '#16a34a'),
        ('ODOO', 'ODOO', '#9333ea'),
        ('COGS', 'COGS', '#ea580c')
      ON CONFLICT (code) DO NOTHING
    `);

    // --- Module CoA Tracking (Certificats d'Analyse des matières premières) ---
    await client.query(`
      CREATE TABLE IF NOT EXISTS coa_materiau (
        id SERIAL PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        libelle TEXT NOT NULL,
        seuil_loss_drying DOUBLE PRECISION,
        loss_drying_applicable BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS coa_reference_produit (
        id SERIAL PRIMARY KEY,
        materiau_id INTEGER REFERENCES coa_materiau(id) ON DELETE CASCADE,
        fournisseur TEXT NOT NULL,
        ref_interne TEXT,
        ref_client TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (materiau_id, fournisseur)
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS coa_lot_mp (
        id SERIAL PRIMARY KEY,
        reference_interne TEXT,
        reference_client TEXT,
        numero_commande TEXT,
        materiau_id INTEGER REFERENCES coa_materiau(id),
        numero_lot TEXT NOT NULL,
        fournisseur TEXT NOT NULL,
        date_commande DATE,
        date_reception DATE,
        date_peremption DATE,
        quantite_g DOUBLE PRECISION,
        loss_drying DOUBLE PRECISION,
        coa_fichier TEXT,
        coa_lien TEXT,
        a_verifier BOOLEAN DEFAULT FALSE,
        commentaire TEXT,
        uploaded_by TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // Unité de la quantité saisie (g par défaut ; g / kg / L).
    await client.query(`ALTER TABLE coa_lot_mp ADD COLUMN IF NOT EXISTS quantite_unite TEXT DEFAULT 'g'`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS coa_document (
        id SERIAL PRIMARY KEY,
        lot_id INTEGER UNIQUE REFERENCES coa_lot_mp(id) ON DELETE CASCADE,
        nom_fichier TEXT NOT NULL,
        type_mime TEXT DEFAULT 'application/pdf',
        taille_octets INTEGER,
        contenu BYTEA,
        uploaded_by TEXT,
        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // --- Nettoyage : abandon de l'approche « prod_lot » native au profit de la photocopie Excel live (Graph).
    // Ces tables avaient été créées lors d'un run précédent ; on les supprime (no-op si déjà absentes).
    await client.query(`DROP TABLE IF EXISTS prod_traca_cell, prod_traca_materiau, prod_lot, prod_map_annee, prod_map_site, prod_map_produit CASCADE`);

    // --- Module QMS (ISO 13485 / MDR) : index documentaire OneDrive via Microsoft Graph ---
    // Principe : OneDrive reste la source unique des docs contrôlés. On stocke uniquement
    // métadonnées + lien (web_url) + version. Clé stable = graph_item_id (jamais le nom/chemin).
    await client.query(`
      CREATE TABLE IF NOT EXISTS qms_processes (
        id SERIAL PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        libelle TEXT NOT NULL,
        iso_clause TEXT,
        responsable TEXT,
        folder_name TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS qms_documents (
        id SERIAL PRIMARY KEY,
        graph_item_id TEXT UNIQUE NOT NULL,
        drive_id TEXT NOT NULL,
        name TEXT NOT NULL,
        is_folder BOOLEAN DEFAULT FALSE,
        doc_type TEXT,
        process_id INTEGER REFERENCES qms_processes(id) ON DELETE SET NULL,
        process_code TEXT,
        parent_id TEXT,
        path TEXT,
        version TEXT,
        etag TEXT,
        web_url TEXT,
        mime_type TEXT,
        size_bytes BIGINT,
        last_modified TIMESTAMP,
        modified_by TEXT,
        soft_deleted BOOLEAN DEFAULT FALSE,
        deleted_flag_seen BOOLEAN DEFAULT FALSE,
        first_indexed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_qms_documents_process ON qms_documents(process_code)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_qms_documents_type ON qms_documents(doc_type)`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS qms_sync_state (
        drive_id TEXT NOT NULL,
        root_item_id TEXT NOT NULL,
        delta_link TEXT,
        last_success TIMESTAMP,
        last_attempt TIMESTAMP,
        last_error TEXT,
        running BOOLEAN DEFAULT FALSE,
        full_count INTEGER DEFAULT 0,
        PRIMARY KEY (drive_id, root_item_id)
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS qms_subscriptions (
        id TEXT PRIMARY KEY,
        resource TEXT,
        expires TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // Seed des 10 processus QMS (mapping dossier OneDrive → processus + clause ISO). Idempotent.
    await client.query(`
      INSERT INTO qms_processes (code, libelle, iso_clause, folder_name) VALUES
        ('00','Manuel Qualité & Amélioration continue','4.2.2','00 - Manual Quality & CI'),
        ('01','Management','5','01 - Management'),
        ('02','Affaires réglementaires','4.2 / MDR','02 - Regulatory'),
        ('03','Qualité','8','03 - Quality'),
        ('04','Conception & développement','7.3','04 - Conception and development'),
        ('05','Production','7.5','05 - Manufacturing'),
        ('06','Ventes & marché','7.2','06 - Sales and market'),
        ('07','Ressources humaines','6.2','07 - Human resources'),
        ('08','Infrastructure','6.3','08 - Infrastructure'),
        ('09','Achats','7.4','09 - Purchase')
      ON CONFLICT (code) DO NOTHING
    `);

    // --- Module QMS Jalon 2 : Non-conformités (§8.3) + CAPA (§8.5) ---
    await client.query(`
      CREATE TABLE IF NOT EXISTS qms_non_conformities (
        id SERIAL PRIMARY KEY,
        numero TEXT UNIQUE NOT NULL,
        date_detection DATE,
        source TEXT,
        description TEXT NOT NULL,
        severite TEXT DEFAULT 'MINEURE',
        process_id INTEGER REFERENCES qms_processes(id) ON DELETE SET NULL,
        document_id TEXT,
        batch_id TEXT,
        statut TEXT DEFAULT 'OUVERTE',
        responsable TEXT,
        capa_id INTEGER,
        created_by TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS qms_capa (
        id SERIAL PRIMARY KEY,
        numero TEXT UNIQUE NOT NULL,
        type TEXT DEFAULT 'CORRECTIVE',
        source TEXT,
        nc_id INTEGER REFERENCES qms_non_conformities(id) ON DELETE SET NULL,
        description TEXT NOT NULL,
        analyse_cause TEXT,
        actions JSONB DEFAULT '[]'::jsonb,
        verification_efficacite TEXT,
        efficacite_statut TEXT DEFAULT 'NON_EVALUEE',
        echeance DATE,
        process_id INTEGER REFERENCES qms_processes(id) ON DELETE SET NULL,
        document_id TEXT,
        statut TEXT DEFAULT 'OUVERTE',
        responsable TEXT,
        created_by TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // --- Module QMS Jalon 3 : Réclamations/Vigilance/PMS (§8.2, MDR) + Risques (ISO 14971) ---
    await client.query(`
      CREATE TABLE IF NOT EXISTS qms_complaints (
        id SERIAL PRIMARY KEY,
        numero TEXT UNIQUE NOT NULL,
        date_reception DATE,
        produit TEXT,
        lot TEXT,
        description TEXT NOT NULL,
        imdrf_codes TEXT,
        vigilance BOOLEAN DEFAULT FALSE,
        gravite TEXT DEFAULT 'MINEURE',
        process_id INTEGER REFERENCES qms_processes(id) ON DELETE SET NULL,
        capa_id INTEGER REFERENCES qms_capa(id) ON DELETE SET NULL,
        statut TEXT DEFAULT 'OUVERTE',
        responsable TEXT,
        created_by TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS qms_risks (
        id SERIAL PRIMARY KEY,
        numero TEXT UNIQUE NOT NULL,
        danger TEXT NOT NULL,
        situation TEXT,
        dommage TEXT,
        prob INTEGER DEFAULT 1,
        gravite INTEGER DEFAULT 1,
        mesures_maitrise TEXT,
        prob_res INTEGER,
        gravite_res INTEGER,
        complaint_ids JSONB DEFAULT '[]'::jsonb,
        process_id INTEGER REFERENCES qms_processes(id) ON DELETE SET NULL,
        statut TEXT DEFAULT 'OUVERT',
        responsable TEXT,
        created_by TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Maîtrise documentaire : on indexe désormais TOUS les fichiers + colonne d'état du cycle de vie.
    await client.query(`ALTER TABLE qms_documents ADD COLUMN IF NOT EXISTS lifecycle_state TEXT`);
    await client.query(`ALTER TABLE qms_documents ADD COLUMN IF NOT EXISTS created_date TIMESTAMP`);
    // Re-catalogue complet one-shot (tous les fichiers + date de création pour la traçabilité gap analysis).
    const reidx = await client.query("SELECT 1 FROM settings WHERE key = 'qms_reindex_all_v3'");
    if (reidx.rows.length === 0) {
      await client.query('UPDATE qms_sync_state SET delta_link = NULL');
      await client.query("INSERT INTO settings (key, value) VALUES ('qms_reindex_all_v3', 'true'::jsonb) ON CONFLICT (key) DO NOTHING");
    }
    await client.query(`
      CREATE TABLE IF NOT EXISTS qms_equipment (
        id SERIAL PRIMARY KEY,
        ext_id TEXT UNIQUE NOT NULL,
        name TEXT, type TEXT, location TEXT, model TEXT, manufacturer TEXT, serial TEXT,
        install_date DATE, status TEXT,
        imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`ALTER TABLE qms_equipment ADD COLUMN IF NOT EXISTS web_url TEXT`);
    // Registre NC / CAPA / Change importé depuis les fichiers de suivi Excel de l'AQ (snapshot).
    await client.query(`
      CREATE TABLE IF NOT EXISTS qms_tracking (
        id SERIAL PRIMARY KEY,
        kind TEXT NOT NULL,
        ext_id TEXT NOT NULL,
        description TEXT,
        status TEXT,
        raw_status TEXT,
        opening_date DATE,
        due_date DATE,
        closure_date DATE,
        ref TEXT,
        imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (kind, ext_id)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS qms_suppliers (
        id SERIAL PRIMARY KEY,
        ext_id TEXT,
        name TEXT NOT NULL UNIQUE,
        status TEXT, classification TEXT, type TEXT, supply_type TEXT, product TEXT,
        cert_ref TEXT, cert_expiration DATE, quality_agreement TEXT,
        imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`ALTER TABLE qms_tracking ADD COLUMN IF NOT EXISTS web_url TEXT`);
    await client.query(`ALTER TABLE qms_suppliers ADD COLUMN IF NOT EXISTS web_url TEXT`);

    // Registre des commandes (Forecast Ventes) : miroir auto-synchronisé du fichier Excel « DOC-0014 Registre_Commandes ».
    await client.query(`
      CREATE TABLE IF NOT EXISTS registre_commandes (
        id SERIAL PRIMARY KEY,
        year INTEGER,
        country TEXT,
        product_class TEXT,
        commercial_name TEXT,
        ref TEXT,
        units INTEGER,
        batch_no TEXT,
        exp_date TEXT,
        status TEXT
      )
    `);
    // Nettoyage : la « date de facture » a été retirée de l'app (absente du fichier Excel source).
    await client.query(`DROP TABLE IF EXISTS registre_facture`);
    await client.query(`ALTER TABLE registre_commandes DROP COLUMN IF EXISTS row_key`);

    // --- Cockpit opérationnel Louna : COGS par lot (flacons/seringues) + dashboard.
    // L'app est désormais la SOURCE (le fichier Excel « DASHBOARD OPERATION LOUNA » est abandonné,
    // ses 67 lots ont été repris une fois via cockpit_seed.json avec des formules normalisées).
    await client.query(`
      CREATE TABLE IF NOT EXISTS cockpit_products (
        id SERIAL PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        name TEXT,
        type TEXT DEFAULT 'vial',
        units_per_box INTEGER DEFAULT 3,
        cogs_target NUMERIC,
        price_fr NUMERIC,
        price_ch NUMERIC
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS cockpit_lots (
        id SERIAL PRIMARY KEY,
        batch_number TEXT UNIQUE NOT NULL,
        product_code TEXT,
        type TEXT DEFAULT 'vial',
        year INTEGER,
        site TEXT DEFAULT 'Bio-Steril',
        date_prod_start DATE, date_prod_end DATE, date_planned_end DATE,
        date_release_cmo DATE, date_release_louna DATE,
        units_theoretical INTEGER, units_filled INTEGER, units_conform INTEGER,
        units_rejected INTEGER DEFAULT 0, units_sold INTEGER,
        costs JSONB DEFAULT '{}'::jsonb,
        status TEXT DEFAULT 'EN_COURS',
        comment TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    {
      const c = await client.query('SELECT COUNT(*)::int AS n FROM cockpit_lots');
      if (c.rows[0].n === 0) {
        try {
          const seedPath = path.join(process.cwd(), 'cockpit_seed.json');
          if (fs.existsSync(seedPath)) {
            const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
            for (const p of seed.products || []) {
              await client.query(
                `INSERT INTO cockpit_products (code, name, type, units_per_box, cogs_target, price_fr, price_ch)
                 VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (code) DO NOTHING`,
                [p.code, p.name || null, p.type || 'vial', p.unitsPerBox || 3, p.cogsTarget ?? null, p.priceFr ?? null, p.priceCh ?? null]);
            }
            for (const l of seed.lots || []) {
              await client.query(
                `INSERT INTO cockpit_lots (batch_number, product_code, type, year, site, date_prod_start, date_prod_end,
                   date_release_cmo, date_release_louna, units_theoretical, units_filled, units_conform, units_rejected, units_sold, costs, status)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16) ON CONFLICT (batch_number) DO NOTHING`,
                [l.batchNumber, l.productCode || null, l.type || 'vial', l.year ?? null, l.site || null, l.dateProdStart, l.dateProdEnd,
                 l.dateReleaseCmo, l.dateReleaseLouna, l.unitsTheoretical, l.unitsFilled, l.unitsConform, l.unitsRejected ?? 0, l.unitsSold, JSON.stringify(l.costs || {}), l.status || 'EN_COURS']);
            }
            console.log(`✅ Cockpit : import initial de ${(seed.lots || []).length} lot(s) + ${(seed.products || []).length} produit(s)`);
          }
        } catch (e) { console.error('Cockpit seed', e); }
      }
    }

    // --- Simulateur COGS paramétrique par produit (sous-onglet « COGS par famille » du Cockpit).
    // Modèle : baseUnits = batch_l*1000/(vol_unit_ml*density) ; conformUnits = baseUnits*yBulk*yFill*yVisual*yPack ;
    // cogsUnit = Σ(qty*unitPrice des lignes)/conformUnits. Les 4 rendements sont les leviers d'optimisation.
    await client.query(`
      CREATE TABLE IF NOT EXISTS cogs_models (
        id SERIAL PRIMARY KEY,
        code TEXT UNIQUE,
        family TEXT,
        label TEXT,
        batch_l NUMERIC,
        vol_unit_ml NUMERIC,
        density NUMERIC DEFAULT 1,
        units_per_box INT,
        y_bulk NUMERIC,
        y_fill NUMERIC,
        y_visual NUMERIC,
        y_pack NUMERIC,
        lines JSONB DEFAULT '[]',
        cogs_target NUMERIC,
        notes TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    {
      // Taille de lot de référence (litres) : base à laquelle les quantités « évolutives » sont saisies.
      await client.query('ALTER TABLE cogs_models ADD COLUMN IF NOT EXISTS ref_batch_l NUMERIC');
      const c = await client.query('SELECT COUNT(*)::int AS n FROM cogs_models');
      if (c.rows[0].n === 0) {
        try {
          const seedPath = path.join(process.cwd(), 'cogs_seed.json');
          if (fs.existsSync(seedPath)) {
            const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
            for (const p of seed.products || []) {
              await client.query(
                `INSERT INTO cogs_models (code, family, label, batch_l, vol_unit_ml, density, units_per_box, y_bulk, y_fill, y_visual, y_pack, lines)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb) ON CONFLICT (code) DO NOTHING`,
                [p.code, p.family || null, p.label || null, p.batchL ?? null, p.volUnitMl ?? null, p.density ?? 1, p.unitsPerBox ?? null,
                 p.yBulk ?? null, p.yFill ?? null, p.yVisual ?? null, p.yPack ?? null, JSON.stringify(p.lines || [])]);
            }
            console.log(`✅ COGS par famille : import initial de ${(seed.products || []).length} modèle(s)`);
          }
        } catch (e) { console.error('COGS models seed', e); }
      }
    }

    // Planning de qualification/calibration : interventions par équipement [{type,date,status}] (vert=réalisé, orange=planifié) depuis le planning Excel.
    await client.query(`ALTER TABLE qms_equipment ADD COLUMN IF NOT EXISTS calibrations JSONB DEFAULT '[]'::jsonb`);
    await client.query(`ALTER TABLE qms_equipment ADD COLUMN IF NOT EXISTS interventions JSONB DEFAULT '[]'::jsonb`);

    // Registre des risques ligne par ligne (ISO 14971) importé des matrices produit/process.
    await client.query(`
      CREATE TABLE IF NOT EXISTS qms_risk_register (
        id SERIAL PRIMARY KEY,
        category TEXT NOT NULL,
        ext_id TEXT,
        step TEXT,
        hazard TEXT,
        situation TEXT,
        harm TEXT,
        occurrence INTEGER,
        severity INTEGER,
        risk_eval TEXT,
        control TEXT,
        occurrence_res INTEGER,
        severity_res INTEGER,
        residual_risk TEXT,
        imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (category, ext_id)
      )
    `);

    // --- Packing List & Factures : catalogue produits, clients, sites d'enlèvement, documents enregistrés ---
    await client.query(`
      CREATE TABLE IF NOT EXISTS pl_products (
        ref TEXT PRIMARY KEY,
        designation TEXT,
        type TEXT,
        hs_code TEXT,
        unit_price NUMERIC,
        box_weight_kg NUMERIC,
        capacity_per_carton INT
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS pl_clients (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE,
        address TEXT,
        customer_id TEXT
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS pl_pickup_sites (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE,
        address TEXT
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS pl_documents (
        id SERIAL PRIMARY KEY,
        invoice_no TEXT,
        doc_date DATE,
        rev INT DEFAULT 0,
        client_name TEXT,
        client_address TEXT,
        pickup_name TEXT,
        pickup_address TEXT,
        lines JSONB,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    {
      const n = (await client.query('SELECT COUNT(*)::int AS n FROM pl_products')).rows[0].n;
      if (n === 0) {
        for (const [ref, designation, type, hs, price, weight, cap] of PL_SEED_PRODUCTS) {
          await client.query(
            `INSERT INTO pl_products (ref, designation, type, hs_code, unit_price, box_weight_kg, capacity_per_carton)
             VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (ref) DO NOTHING`,
            [ref, designation, type, hs, price, weight, cap]);
        }
        console.log(`✅ Packing List : catalogue produits initial (${PL_SEED_PRODUCTS.length} réfs)`);
      }
    }
    {
      const n = (await client.query('SELECT COUNT(*)::int AS n FROM pl_clients')).rows[0].n;
      if (n === 0) {
        for (const [name, address, customerId] of PL_SEED_CLIENTS) {
          await client.query(
            `INSERT INTO pl_clients (name, address, customer_id) VALUES ($1,$2,$3) ON CONFLICT (name) DO NOTHING`,
            [name, address, customerId]);
        }
      }
    }
    {
      const n = (await client.query('SELECT COUNT(*)::int AS n FROM pl_pickup_sites')).rows[0].n;
      if (n === 0) {
        for (const [name, address] of PL_SEED_SITES) {
          await client.query(
            `INSERT INTO pl_pickup_sites (name, address) VALUES ($1,$2) ON CONFLICT (name) DO NOTHING`,
            [name, address]);
        }
      }
    }

    // --- Mirage : contrôle visuel des unités (inspection) ---
    await client.query(`
      CREATE TABLE IF NOT EXISTS mirage_inspections (
        id TEXT PRIMARY KEY,
        product_code TEXT,
        product_name TEXT,
        lot TEXT NOT NULL,
        inspection_date DATE,
        qty_inspected INTEGER DEFAULT 0,
        qty_rejected INTEGER DEFAULT 0,
        unit_type TEXT,
        defects JSONB DEFAULT '[]'::jsonb,
        notes TEXT,
        pdf_filename TEXT,
        created_by TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // --- Suivi de rendement de production (extrait d'un DDL : étapes seringues/flacons) ---
    await client.query(`
      CREATE TABLE IF NOT EXISTS rendement_ddl (
        id TEXT PRIMARY KEY,
        product_code TEXT,
        product_name TEXT,
        lot TEXT NOT NULL,
        unit_type TEXT,
        date_repartition DATE, date_mirage DATE, date_etiquetage DATE, date_miseenboite DATE,
        qty_reparti INTEGER DEFAULT 0,
        qty_mire_conforme INTEGER DEFAULT 0,
        qty_etiquete INTEGER DEFAULT 0,
        qty_miseenboite INTEGER DEFAULT 0,
        masse_gel_g NUMERIC,
        vol_moyen_ml NUMERIC,
        masse_moyenne_g NUMERIC,
        notes TEXT,
        pdf_filename TEXT,
        created_by TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // Taille de cuve initiale saisie manuellement (litres) → masse de gel mise à disposition (×1000, ratio 1:1).
    await client.query(`ALTER TABLE rendement_ddl ADD COLUMN IF NOT EXISTS cuve_initiale_l NUMERIC`);

    // --- Création DDL : PDF générés depuis les modèles Word approuvés (SharePoint) ---
    await client.query(`
      CREATE TABLE IF NOT EXISTS prepprod_ddl (
        id SERIAL PRIMARY KEY,
        lot TEXT NOT NULL,
        family TEXT,
        template_name TEXT,
        ddl_number TEXT,
        ddl_version TEXT,
        application_date TEXT,
        pdf_filename TEXT,
        pdf BYTEA,
        created_by TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // Suivi du cycle de vie du DDL : GENERE → EN_VALIDATION → VALIDE → IMPRIME.
    await client.query("ALTER TABLE prepprod_ddl ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'GENERE'");

    {
      const r = await client.query("SELECT value FROM settings WHERE key = 'mirageDefectTypes'");
      if (r.rows.length === 0) {
        await client.query("INSERT INTO settings (key, value) VALUES ('mirageDefectTypes', $1)", [JSON.stringify(DEFAULT_MIRAGE_DEFECT_TYPES)]);
      }
    }

    await client.query('COMMIT');
    console.log('✅ Base de données initialisée');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

interface AuthRequest extends Request {
  user?: JWTPayload;
}

async function logActivity(
  req: Request & { user?: JWTPayload },
  actionType: string,
  resourceId: string | null,
  description: string
) {
  const userId = req.user?.userId || null;
  const username = req.user?.username || 'Système';
  const ipAddress = (req.headers['x-forwarded-for'] as string) || req.ip || req.socket?.remoteAddress || null;
  const userAgent = req.headers['user-agent'] || 'Inconnu';

  try {
    await pool.query(
      `INSERT INTO audit_logs (user_id, username, action_type, resource_id, description, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, username, actionType, resourceId, description, ipAddress, userAgent]
    );

    io.emit('audit:logged', {
      timestamp: new Date(),
      username,
      action_type: actionType,
      resource_id: resourceId,
      description
    });
  } catch (error) {
    console.error('❌ Erreur lors de l\'enregistrement de l\'audit:', error);
  }
}

function authenticateToken(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token manquant' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JWTPayload;
    req.user = decoded;
    next();
  } catch {
    return res.status(403).json({ error: 'Token invalide ou expiré' });
  }
}

function requireRole(minRole: UserRole) {
  const roleHierarchy: UserRole[] = ['viewer', 'editor', 'admin'];
  const minIndex = roleHierarchy.indexOf(minRole);

  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Non autorisé' });
    }

    const userIndex = roleHierarchy.indexOf(req.user.role);
    if (userIndex < minIndex) {
      return res.status(403).json({ error: 'Permissions insuffisantes' });
    }

    next();
  };
}

// Autorise si l'utilisateur est admin OU si l'onglet figure dans ses permissions.
function requireView(viewId: string) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const u = req.user;
    if (u && (u.role === 'admin' || (Array.isArray(u.permissions) && u.permissions.includes(viewId)))) {
      return next();
    }
    return res.status(403).json({ error: 'Accès non autorisé à cette section.' });
  };
}

function broadcast(event: string, data?: any) {
  io.emit(event, data);
}

app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', version: '2.0.0' });
});

app.post('/api/login', async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Nom d\'utilisateur et mot de passe requis' });
    }

    const result = await pool.query(
      'SELECT * FROM users WHERE username = $1',
      [username]
    );

    if (result.rows.length === 0) {
      await logActivity(req, 'LOGIN_FAILURE', null, `Tentative de connexion infructueuse : utilisateur '${username}' inexistant`);
      return res.status(401).json({ error: 'Nom d\'utilisateur ou mot de passe incorrect' });
    }

    const user = result.rows[0];
    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatch) {
      await logActivity(req, 'LOGIN_FAILURE', null, `Tentative de connexion infructueuse pour '${username}' : mot de passe incorrect`);
      return res.status(401).json({ error: 'Nom d\'utilisateur ou mot de passe incorrect' });
    }

    // L'admin a toujours accès à tout ; sinon on utilise les permissions stockées (par défaut : tout).
    const permissions = user.role === 'admin'
      ? ATTRIBUTABLE_VIEWS
      : (Array.isArray(user.permissions) ? user.permissions : ATTRIBUTABLE_VIEWS);

    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role, permissions },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN as any }
    );

    const reqWithUser = req as Request & { user?: JWTPayload };
    reqWithUser.user = { userId: user.id, username: user.username, role: user.role, permissions };
    await logActivity(reqWithUser, 'LOGIN_SUCCESS', user.id, `Connexion réussie de l'utilisateur ${user.username} (Rôle: ${user.role})`);

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        permissions
      },
      expiresIn: JWT_EXPIRES_IN
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/api/me', authenticateToken, (req: AuthRequest, res: Response) => {
  res.json({ user: req.user });
});

app.get('/api/users', authenticateToken, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT id, username, role, permissions, created_at FROM users ORDER BY created_at'
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/users', authenticateToken, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { username, password, role, permissions } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Nom d\'utilisateur et mot de passe requis' });
    }

    const validRoles: UserRole[] = ['admin', 'editor', 'viewer'];
    if (role && !validRoles.includes(role)) {
      return res.status(400).json({ error: 'Rôle invalide' });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const userRole = role || 'viewer';
    // Par défaut un nouvel utilisateur a accès à tout ; on ne garde que des onglets valides.
    const perms = Array.isArray(permissions)
      ? permissions.filter((v: string) => ATTRIBUTABLE_VIEWS.includes(v))
      : ATTRIBUTABLE_VIEWS;

    const result = await pool.query(
      'INSERT INTO users (username, password_hash, role, permissions) VALUES ($1, $2, $3, $4::jsonb) RETURNING id, username, role, permissions, created_at',
      [username, passwordHash, userRole, JSON.stringify(perms)]
    );

    await logActivity(req, 'USER_CREATE', result.rows[0].id, `A créé le compte de l'utilisateur ${username} avec le rôle ${userRole}`);

    broadcast('user:created', result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (error: any) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Nom d\'utilisateur déjà existant' });
    }
    console.error('Error creating user:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.patch('/api/users/:id', authenticateToken, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { password, role, permissions } = req.body;

    if (!password && !role && permissions === undefined) {
      return res.status(400).json({ error: 'Rien à modifier' });
    }

    if (req.user?.role !== 'admin' && id === req.user?.userId) {
      return res.status(403).json({ error: 'Vous ne pouvez pas modifier votre propre rôle' });
    }

    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (password) {
      const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
      fields.push(`password_hash = $${paramIndex++}`);
      values.push(passwordHash);
    }

    if (role) {
      const validRoles: UserRole[] = ['admin', 'editor', 'viewer'];
      if (!validRoles.includes(role)) {
        return res.status(400).json({ error: 'Rôle invalide' });
      }
      fields.push(`role = $${paramIndex++}`);
      values.push(role);
    }

    if (permissions !== undefined) {
      const perms = Array.isArray(permissions)
        ? permissions.filter((v: string) => ATTRIBUTABLE_VIEWS.includes(v))
        : [];
      fields.push(`permissions = $${paramIndex++}::jsonb`);
      values.push(JSON.stringify(perms));
    }

    values.push(id);

    const result = await pool.query(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING id, username, role, permissions, created_at`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    const modDetails = `${role ? 'rôle modifié pour ' + role : ''}${password ? (role ? ' & ' : '') + 'mot de passe réinitialisé' : ''}`;
    await logActivity(req, 'USER_UPDATE', result.rows[0].id, `A mis à jour le compte de l'utilisateur ${result.rows[0].username} (${modDetails})`);

    broadcast('user:updated', result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.delete('/api/users/:id', authenticateToken, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    if (id === req.user?.userId) {
      return res.status(403).json({ error: 'Vous ne pouvez pas supprimer votre propre compte' });
    }

    const result = await pool.query(
      'DELETE FROM users WHERE id = $1 RETURNING id, username',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    await logActivity(req, 'USER_DELETE', id, `A supprimé le compte de l'utilisateur ${result.rows[0].username}`);

    broadcast('user:deleted', { id });
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

function mapBatchFromDb(row: any): any {
  if (!row) return row;
  return {
    id: row.id,
    fluxKey: row.fluxkey,
    reference: row.reference,
    client: row.client,
    product: row.product,
    stepIndex: row.stepindex,
    status: row.status,
    process_stage: row.process_stage,
    quality_status: row.quality_status,
    schedule_health: computeScheduleHealth(row.enddate, row.deliverydate, row.process_stage),
    progress: row.progress,
    startDate: row.startdate,
    endDate: row.enddate,
    deliveryDate: row.deliverydate,
    notes: row.notes,
    noteEntries: typeof row.note_entries === 'string' ? JSON.parse(row.note_entries) : (row.note_entries || []),
    volume: row.volume,
    boxesTarget: row.boxestarget,
    distributed: row.distributed,
    conform: row.conform,
    sold: row.sold,
    palettes: row.palettes,
    samples: typeof row.samples === 'string' ? JSON.parse(row.samples) : (row.samples || []),
    milestones: mapMilestones(row.milestones),
    prepTasks: typeof row.preptasks === 'string' ? JSON.parse(row.preptasks) : (row.preptasks || {})
  };
}

function mapMilestones(raw: any): any {
  const m = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
  return {
    CONDI_PRIM: m?.CONDI_PRIM || { done: false },
    CONDI_SEC: m?.CONDI_SEC || { done: false },
    LIBERATION: m?.LIBERATION || { done: false }
  };
}

function mapDeliveryFromDb(row: any): any {
  if (!row) return row;
  return {
    id: row.id,
    batchId: row.batchid,
    client: row.client,
    date: row.date,
    boxesSold: row.boxessold,
    palettes: row.palettes,
    status: row.status
  };
}

function mapForecastFromDb(row: any): any {
  if (!row) return row;
  return {
    id: row.id,
    productType: row.product_type,
    product: row.product,
    reference: row.reference,
    client: row.client,
    plannedQuantity: row.planned_quantity,
    targetStart: row.target_start,
    targetEnd: row.target_end,
    status: row.status,
    notes: row.notes,
    convertedBatchId: row.converted_batch_id,
    createdAt: row.created_at
  };
}

// Dérive la clé de flux à partir d'un type de produit catalogue (pour la conversion forecast → lot).
function fluxKeyForType(type: string, fluxConfig: Record<string, any>): string {
  const t = (type || '').toUpperCase();
  let key = 'Hydroxyal';
  if (t.includes('HYDRAGEL A2 SYRINGE') || t.includes('A2 SERINGUE')) key = 'Hydragel_A2_Seringue';
  else if (t.includes('HYDRAGEL A1')) key = 'Hydragel_A1';
  else if (t.includes('HYDRAGEL A2')) key = 'Hydragel_A2';
  else if (t.includes('HYDRAGEL A3')) key = 'Hydragel_A3';
  else if (t.includes('LOUNA FILLERS')) key = 'HAR_Louna';
  else if (t.includes('ESSENTYAL')) key = 'HAR_Essentyal';
  if (fluxConfig && fluxConfig[key]) return key;
  const keys = fluxConfig ? Object.keys(fluxConfig) : [];
  return keys.length > 0 ? keys[0] : key;
}

app.get('/api/batches', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT * FROM batches ORDER BY startDate DESC'
    );
    await logActivity(req, 'BATCH_READ_ALL', null, `A accédé à la liste des lots`);
    res.json(result.rows.map(mapBatchFromDb));
  } catch (error) {
    console.error('Error fetching batches:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

async function recalculateBatchDates(batch: any) {
  try {
    const configResult = await pool.query("SELECT value FROM settings WHERE key = 'fluxConfig'");
    const fluxConfig = configResult.rows[0]?.value || {};
    const flux = fluxConfig[batch.fluxKey];

    const sampleCfgRes = await pool.query("SELECT value FROM settings WHERE key = 'sampleConfig'");
    const sampleConfig = sampleCfgRes.rows[0]?.value || DEFAULT_SAMPLE_CONFIG;

    if (batch.startDate) {
      const startDate = new Date(batch.startDate);
      if (!isNaN(startDate.getTime())) {
        // 1. Recalculate endDate (leadtime total du flux)
        if (flux) {
          const leadTimeWeeks = (Object.values(flux.durations || {}) as number[]).reduce((sum: number, val: number) => sum + val, 0);
          const endDate = new Date(startDate);
          endDate.setDate(endDate.getDate() + leadTimeWeeks * 7);
          batch.endDate = endDate.toISOString().split('T')[0];
        }
      }
    }

    // 2. Recalculate samples (Calcul 1 + Calcul 2 + configError), indépendant de startDate valide
    if (batch.samples) {
      const samples = typeof batch.samples === 'string' ? JSON.parse(batch.samples) : batch.samples;
      if (Array.isArray(samples)) {
        samples.forEach((s: any) => computeSampleDates(s, flux, batch.startDate, sampleConfig));
        batch.samples = samples;
      }
    }
  } catch (err) {
    console.error('Error in recalculateBatchDates:', err);
  }
}

// Validation des samples. Règles :
//  - status ≥ ENVOYE exige dateEnvoi
//  - RESULTATS_RECUS (et au-delà) exige dateResultatsRecus
//  - NON_CONFORME exige motifNonConforme
//  - transition statut courant → cible doit être valide (séquence verrouillée)
// `prevSamples` (optionnel) = état précédent pour valider les transitions. Retourne message FR ou null.
function validateSamples(samples: any, prevSamples?: any): string | null {
  const arr = typeof samples === 'string' ? JSON.parse(samples) : samples;
  if (!Array.isArray(arr)) return null;
  const prevArr = prevSamples
    ? (typeof prevSamples === 'string' ? JSON.parse(prevSamples) : prevSamples)
    : null;
  const STATUS_RESULTS_DONE = ['RESULTATS_RECUS', 'CONFORME', 'NON_CONFORME'];

  for (const s of arr) {
    if (!s || !s.applicable) continue;

    if (STATUS_AFTER_ENVOI.includes(s.status) && !s.dateEnvoi) {
      return `Le test « ${s.type} » a un statut « ${s.status} » sans date d'envoi. Veuillez renseigner la date d'envoi.`;
    }
    if (STATUS_RESULTS_DONE.includes(s.status) && !s.dateResultatsRecus) {
      return `Le test « ${s.type} » a un statut « ${s.status} » sans date de réception des résultats. Veuillez la renseigner.`;
    }
    if (s.status === 'NON_CONFORME' && !(s.motifNonConforme && String(s.motifNonConforme).trim())) {
      return `Le test « ${s.type} » est « Non conforme » sans motif. Veuillez saisir un motif.`;
    }

    // Transition verrouillée (uniquement si on connaît l'état précédent du même test)
    if (Array.isArray(prevArr)) {
      const prev = prevArr.find((p: any) => p && p.type === s.type);
      if (prev && prev.applicable && prev.status !== s.status) {
        const allowed = SAMPLE_STATUS_TRANSITIONS[prev.status] || [];
        if (!allowed.includes(s.status)) {
          return `Transition de statut invalide pour le test « ${s.type} » : « ${prev.status} » → « ${s.status} » n'est pas autorisée.`;
        }
      }
    }
  }
  return null;
}

async function syncDeliveryForBatch(client: any, batch: any) {
  try {
    if (batch.deliveryDate) {
      // Check if delivery exists
      const delCheck = await client.query('SELECT id FROM deliveries WHERE batchId = $1 ORDER BY id', [batch.id]);
      if (delCheck.rows.length > 0) {
        // Auto-réparation : ne garder qu'une seule livraison par lot
        const keepId = delCheck.rows[0].id;
        if (delCheck.rows.length > 1) {
          await client.query('DELETE FROM deliveries WHERE batchId = $1 AND id <> $2', [batch.id, keepId]);
        }
        // Update existing delivery
        await client.query(
          `UPDATE deliveries
           SET date = $1, client = $2, boxesSold = $3, palettes = $4
           WHERE id = $5`,
          [batch.deliveryDate, batch.client || 'N/A', batch.boxesTarget || 0, batch.palettes || 0, keepId]
        );
        // Fetch and broadcast update
        const updatedDel = await client.query('SELECT * FROM deliveries WHERE id = $1', [keepId]);
        if (updatedDel.rows.length > 0) {
          broadcast('delivery:updated', mapDeliveryFromDb(updatedDel.rows[0]));
        }
      } else {
        // Insert new delivery
        const deliveryId = (Date.now() + Math.floor(Math.random() * 1000)).toString();
        const result = await client.query(
          `INSERT INTO deliveries (id, batchId, client, date, boxesSold, palettes, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *`,
          [deliveryId, batch.id, batch.client || 'N/A', batch.deliveryDate, batch.boxesTarget || 0, batch.palettes || 0, 'PLANIFIÉ']
        );
        broadcast('delivery:created', mapDeliveryFromDb(result.rows[0]));
      }
    } else {
      // Delete if exists and deliveryDate is cleared
      const delCheck = await client.query('SELECT id FROM deliveries WHERE batchId = $1', [batch.id]);
      if (delCheck.rows.length > 0) {
        const result = await client.query(
          'DELETE FROM deliveries WHERE batchId = $1 RETURNING id',
          [batch.id]
        );
        broadcast('delivery:deleted', { id: result.rows[0].id });
      }
    }
  } catch (err) {
    console.error('Error in syncDeliveryForBatch:', err);
  }
}

app.post('/api/batches', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    const batch = req.body;

    // schedule_health est calculé serveur : ne jamais accepter de valeur client
    delete batch.schedule_health;

    // Validation de cohérence inter-axes
    const axesError = validateAxes(batch.process_stage, batch.quality_status);
    if (axesError) {
      return res.status(400).json({ error: axesError });
    }

    const sampleError = validateSamples(batch.samples);
    if (sampleError) {
      return res.status(400).json({ error: sampleError });
    }

    // Recalculate dates before saving
    await recalculateBatchDates(batch);
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      const result = await client.query(
        `INSERT INTO batches (
          id, fluxKey, reference, client, product, stepIndex, status,
          process_stage, quality_status,
          progress, startDate, endDate, deliveryDate, notes, volume,
          boxesTarget, distributed, conform, sold, palettes, samples, milestones
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
        RETURNING *`,
        [
          batch.id, batch.fluxKey, batch.reference, batch.client, batch.product,
          batch.stepIndex, batch.status, batch.process_stage, batch.quality_status,
          batch.progress, batch.startDate, batch.endDate,
          batch.deliveryDate, batch.notes, batch.volume, batch.boxesTarget,
          batch.distributed, batch.conform, batch.sold, batch.palettes,
          JSON.stringify(batch.samples || []),
          JSON.stringify(batch.milestones || { CONDI_PRIM: { done: false }, CONDI_SEC: { done: false }, LIBERATION: { done: false } })
        ]
      );
      
      const newBatch = mapBatchFromDb(result.rows[0]);
      
      // Sync delivery
      await syncDeliveryForBatch(client, newBatch);
      
      await client.query('COMMIT');
      
      await logActivity(req, 'BATCH_CREATE', newBatch.id, `A créé le lot ${batch.id} (Produit: ${batch.product}, Client: ${batch.client})`);
      
      broadcast('batch:created', newBatch);
      res.status(201).json(newBatch);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error creating batch:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.patch('/api/batches/:id', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // schedule_health est calculé serveur : ne jamais accepter de valeur client
    delete updates.schedule_health;

    const allowedFields = [
      'id', 'fluxKey', 'reference', 'client', 'product', 'stepIndex', 'status',
      'process_stage', 'quality_status',
      'progress', 'startDate', 'endDate', 'deliveryDate', 'notes', 'volume',
      'boxesTarget', 'distributed', 'conform', 'sold', 'palettes', 'samples', 'milestones', 'prepTasks'
    ];

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Get current batch data to merge
      const currentRes = await client.query('SELECT * FROM batches WHERE id = $1', [id]);
      if (currentRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Lot non trouvé' });
      }
      
      const currentBatch = mapBatchFromDb(currentRes.rows[0]);
      const mergedBatch = { ...currentBatch, ...updates };

      // Validation de cohérence inter-axes sur les valeurs fusionnées
      const axesError = validateAxes(mergedBatch.process_stage, mergedBatch.quality_status);
      if (axesError) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: axesError });
      }

      const sampleError = validateSamples(mergedBatch.samples, currentBatch.samples);
      if (sampleError) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: sampleError });
      }

      // Parse samples if string
      if (typeof mergedBatch.samples === 'string') {
        mergedBatch.samples = JSON.parse(mergedBatch.samples);
      }
      if (typeof updates.samples === 'string') {
        updates.samples = JSON.parse(updates.samples);
      }

      // If dates or config changes, recalculate
      if (updates.startDate !== undefined || updates.fluxKey !== undefined || updates.samples !== undefined) {
        await recalculateBatchDates(mergedBatch);
        updates.endDate = mergedBatch.endDate;
        updates.samples = mergedBatch.samples;
      }

      // 2. Synchronize deliveries
      if (updates.deliveryDate !== undefined || updates.client !== undefined || updates.boxesTarget !== undefined || updates.palettes !== undefined || updates.id !== undefined) {
        await syncDeliveryForBatch(client, mergedBatch);
      }

      // 3. Build update query
      const fields: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      for (const [key, value] of Object.entries(updates)) {
        if (allowedFields.includes(key)) {
          if (key === 'samples' || key === 'milestones' || key === 'prepTasks') {
            fields.push(`${key} = $${paramIndex++}::jsonb`);
            values.push(JSON.stringify(value));
          } else {
            fields.push(`${key} = $${paramIndex++}`);
            values.push(value);
          }
        }
      }

      if (fields.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Aucun champ à mettre à jour' });
      }

      fields.push(`updated_at = CURRENT_TIMESTAMP`);
      values.push(id);

      const result = await client.query(
        `UPDATE batches SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
        values
      );

      const updatedBatch = mapBatchFromDb(result.rows[0]);

      // Cascade update if id changed
      if (updates.id && updates.id !== id) {
        await client.query(
          'UPDATE deliveries SET batchId = $1 WHERE batchId = $2',
          [updates.id, id]
        );
      }

      await client.query('COMMIT');

      const changedFields = Object.keys(updates).filter(k => allowedFields.includes(k)).join(', ');
      await logActivity(req, 'BATCH_UPDATE', updatedBatch.id, `A mis à jour le lot ${id} (Champs modifiés: ${changedFields})`);

      broadcast('batch:updated', updatedBatch);
      res.json(updatedBatch);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error updating batch:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Ajout d'un commentaire au fil (historique). User + horodatage stampés côté serveur (intégrité Class II).
app.post('/api/batches/:id/notes', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { text } = req.body;

    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'Le texte du commentaire est requis' });
    }

    const currentRes = await pool.query('SELECT * FROM batches WHERE id = $1', [id]);
    if (currentRes.rows.length === 0) {
      return res.status(404).json({ error: 'Lot non trouvé' });
    }

    const entry = {
      user: req.user!.username,
      at: new Date().toISOString(),
      text: text.trim()
    };

    const result = await pool.query(
      `UPDATE batches
       SET note_entries = COALESCE(note_entries, '[]'::jsonb) || $1::jsonb,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 RETURNING *`,
      [JSON.stringify([entry]), id]
    );

    const updatedBatch = mapBatchFromDb(result.rows[0]);

    await logActivity(req, 'BATCH_NOTE', id, `A ajouté un commentaire au lot ${id}`);

    broadcast('batch:updated', updatedBatch);
    res.json(updatedBatch);
  } catch (error) {
    console.error('Error adding batch note:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.delete('/api/batches/:id', authenticateToken, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM batches WHERE id = $1 RETURNING id',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Lot non trouvé' });
    }

    // Supprimer la/les livraison(s) liée(s) pour ne pas laisser d'orphelin dans l'onglet Livraisons
    const delDeliveries = await pool.query('DELETE FROM deliveries WHERE batchId = $1 RETURNING id', [id]);

    await logActivity(req, 'BATCH_DELETE', id, `A supprimé le lot ${id}`);

    broadcast('batch:deleted', { id });
    delDeliveries.rows.forEach(r => broadcast('delivery:deleted', { id: r.id }));
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting batch:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// --- Forecasts (productions prévues, convertibles en lot) ---

app.get('/api/forecasts', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query('SELECT * FROM forecasts ORDER BY created_at DESC');
    res.json(result.rows.map(mapForecastFromDb));
  } catch (error) {
    console.error('Error fetching forecasts:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/forecasts', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    const f = req.body || {};
    const result = await pool.query(
      `INSERT INTO forecasts (
        product_type, product, reference, client, planned_quantity,
        target_start, target_end, status, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *`,
      [
        f.productType || '', f.product || '', f.reference || '', f.client || '',
        f.plannedQuantity || 0, f.targetStart || '', f.targetEnd || '',
        f.status || 'EN_DISCUSSION', f.notes || ''
      ]
    );
    const forecast = mapForecastFromDb(result.rows[0]);
    await logActivity(req, 'FORECAST_CREATE', forecast.id, `A créé le forecast ${forecast.product} (Client: ${forecast.client})`);
    broadcast('forecast:created', forecast);
    res.status(201).json(forecast);
  } catch (error) {
    console.error('Error creating forecast:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.patch('/api/forecasts/:id', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const body = req.body || {};

    // Map camelCase (et snake_case) → colonnes
    const fieldMap: Record<string, string> = {
      productType: 'product_type',
      product_type: 'product_type',
      product: 'product',
      reference: 'reference',
      client: 'client',
      planned_quantity: 'planned_quantity',
      plannedQuantity: 'planned_quantity',
      target_start: 'target_start',
      targetStart: 'target_start',
      target_end: 'target_end',
      targetEnd: 'target_end',
      status: 'status',
      notes: 'notes'
    };

    const sets: string[] = [];
    const values: any[] = [];
    let i = 1;
    for (const [key, col] of Object.entries(fieldMap)) {
      if (key in body && !sets.some(s => s.startsWith(`${col} =`))) {
        sets.push(`${col} = $${i}`);
        values.push(body[key]);
        i++;
      }
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: 'Aucun champ à mettre à jour' });
    }

    values.push(id);
    const result = await pool.query(
      `UPDATE forecasts SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Forecast non trouvé' });
    }

    const forecast = mapForecastFromDb(result.rows[0]);
    await logActivity(req, 'FORECAST_UPDATE', id, `A modifié le forecast ${forecast.product}`);
    broadcast('forecast:updated', forecast);
    res.json(forecast);
  } catch (error) {
    console.error('Error updating forecast:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.delete('/api/forecasts/:id', authenticateToken, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM forecasts WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Forecast non trouvé' });
    }
    await logActivity(req, 'FORECAST_DELETE', id, `A supprimé le forecast ${id}`);
    broadcast('forecast:deleted', { id });
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting forecast:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/forecasts/:id/convert', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const lotNumber = (req.body?.lotNumber || '').trim();

    if (!lotNumber) {
      return res.status(400).json({ error: 'Le numéro de lot est obligatoire.' });
    }

    const fRes = await pool.query('SELECT * FROM forecasts WHERE id = $1', [id]);
    if (fRes.rows.length === 0) {
      return res.status(404).json({ error: 'Forecast non trouvé' });
    }
    const forecast = mapForecastFromDb(fRes.rows[0]);

    const existing = await pool.query('SELECT id FROM batches WHERE id = $1', [lotNumber]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: `Un lot avec le numéro « ${lotNumber} » existe déjà.` });
    }

    const cfgRes = await pool.query("SELECT value FROM settings WHERE key = 'fluxConfig'");
    const fluxConfig = cfgRes.rows[0]?.value || FLUX_DEFAULTS;
    const fluxKey = fluxKeyForType(forecast.productType, fluxConfig);

    const batch: any = {
      id: lotNumber,
      fluxKey,
      reference: forecast.reference || '',
      client: forecast.client || '',
      product: forecast.product || '',
      stepIndex: 0,
      status: 'UPCOMING',
      process_stage: 'PLANIFIE',
      quality_status: 'NOT_STARTED',
      progress: 0,
      startDate: forecast.targetStart || '',
      endDate: forecast.targetEnd || '',
      deliveryDate: forecast.targetEnd || '',
      notes: '',
      volume: 0,
      boxesTarget: forecast.plannedQuantity || 0,
      distributed: 0,
      conform: 0,
      sold: 0,
      palettes: 0,
      samples: Object.keys(SAMPLE_DEFAULT_PARTNER).map((key: string) => ({
        type: key,
        partner: SAMPLE_DEFAULT_PARTNER[key],
        applicable: true,
        status: 'A_ENVOYER',
        dateEnvoi: '',
        dateReceptionEchantillon: '',
        dateResultatsAttendue: '',
        configError: false,
        datePrelevementReel: '',
        dateResultatsRecus: '',
        rapportRef: '',
        rapportUrl: '',
        motifNonConforme: '',
        history: []
      })),
      milestones: { CONDI_PRIM: { done: false }, CONDI_SEC: { done: false }, LIBERATION: { done: false } },
      note_entries: []
    };

    await recalculateBatchDates(batch);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const result = await client.query(
        `INSERT INTO batches (
          id, fluxKey, reference, client, product, stepIndex, status,
          process_stage, quality_status,
          progress, startDate, endDate, deliveryDate, notes, volume,
          boxesTarget, distributed, conform, sold, palettes, samples, milestones
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
        RETURNING *`,
        [
          batch.id, batch.fluxKey, batch.reference, batch.client, batch.product,
          batch.stepIndex, batch.status, batch.process_stage, batch.quality_status,
          batch.progress, batch.startDate, batch.endDate,
          batch.deliveryDate, batch.notes, batch.volume, batch.boxesTarget,
          batch.distributed, batch.conform, batch.sold, batch.palettes,
          JSON.stringify(batch.samples || []),
          JSON.stringify(batch.milestones || { CONDI_PRIM: { done: false }, CONDI_SEC: { done: false }, LIBERATION: { done: false } })
        ]
      );

      const newBatch = mapBatchFromDb(result.rows[0]);
      await syncDeliveryForBatch(client, newBatch);

      const updForecast = await client.query(
        `UPDATE forecasts SET status = 'CONVERTI', converted_batch_id = $1 WHERE id = $2 RETURNING *`,
        [lotNumber, id]
      );

      await client.query('COMMIT');

      const updatedForecast = mapForecastFromDb(updForecast.rows[0]);

      await logActivity(req, 'FORECAST_CONVERT', forecast.id, `A converti le forecast ${forecast.product} en lot ${lotNumber}`);

      broadcast('batch:created', newBatch);
      broadcast('forecast:updated', updatedForecast);

      res.status(201).json({ forecast: updatedForecast, batch: newBatch });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error converting forecast:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/api/deliveries', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query('SELECT * FROM deliveries ORDER BY date DESC');
    res.json(result.rows.map(mapDeliveryFromDb));
  } catch (error) {
    console.error('Error fetching deliveries:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/deliveries', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    const delivery = req.body;
    const deliveryId = Date.now().toString();

    const result = await pool.query(
      `INSERT INTO deliveries (id, batchId, client, date, boxesSold, palettes, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [deliveryId, delivery.batchId, delivery.client, delivery.date,
       delivery.boxesSold, delivery.palettes, delivery.status || 'PLANIFIÉ']
    );

    broadcast('delivery:created', mapDeliveryFromDb(result.rows[0]));
    res.status(201).json(mapDeliveryFromDb(result.rows[0]));
  } catch (error) {
    console.error('Error creating delivery:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.patch('/api/deliveries/:id', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const allowedFields = ['client', 'date', 'boxesSold', 'palettes', 'status'];
    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        fields.push(`${key} = $${paramIndex++}`);
        values.push(value);
      }
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'Aucun champ à mettre à jour' });
    }

    values.push(id);
    const result = await pool.query(
      `UPDATE deliveries SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Livraison non trouvée' });
    }

    broadcast('delivery:updated', mapDeliveryFromDb(result.rows[0]));
    res.json(mapDeliveryFromDb(result.rows[0]));
  } catch (error) {
    console.error('Error updating delivery:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.delete('/api/deliveries/:id', authenticateToken, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM deliveries WHERE id = $1 RETURNING id',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Livraison non trouvée' });
    }

    broadcast('delivery:deleted', { id });
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting delivery:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ===================== Module Reporting Ops =====================
function mapOpsProject(r: any) { return { id: r.id, name: r.name, code: r.code, color: r.color, archived: r.archived, createdAt: r.created_at }; }
function mapOpsMilestone(r: any) { return { id: r.id, projectId: r.project_id, number: r.number, title: r.title, status: r.status, deadline: r.deadline, owner: r.owner, archived: r.archived }; }
function mapOpsDeliverable(r: any) { return { id: r.id, milestoneId: r.milestone_id, title: r.title, status: r.status, deadline: r.deadline, owner: r.owner, ordre: r.ordre }; }
function mapOpsComment(r: any) { return { id: r.id, entityType: r.entity_type, entityId: r.entity_id, isoWeek: r.iso_week, text: r.text, statut: r.statut || 'ouvert', integratedAt: r.integrated_at, integratedBy: r.integrated_by }; }

async function loadOpsBoard() {
  const [p, m, d, c, h, sn] = await Promise.all([
    pool.query('SELECT * FROM ops_projects ORDER BY created_at'),
    pool.query('SELECT * FROM ops_milestones ORDER BY number NULLS LAST, created_at'),
    pool.query('SELECT * FROM ops_deliverables ORDER BY milestone_id, ordre NULLS LAST, created_at'),
    pool.query('SELECT * FROM ops_weekly_comments'),
    pool.query('SELECT * FROM ops_deadline_history ORDER BY changed_at'),
    pool.query('SELECT * FROM ops_synthesis_notes'),
  ]);
  const milestones = m.rows.map(mapOpsMilestone);
  const deliverables = d.rows.map(mapOpsDeliverable);
  // Statut du milestone dérivé automatiquement de ses deliverables (s'il en a) :
  // une action en retard => retard ; toutes terminées => terminé ; sinon en cours / pas commencé.
  const byMs: Record<string, string[]> = {};
  const dueByMs: Record<string, string[]> = {};
  for (const dl of deliverables) {
    (byMs[dl.milestoneId] ||= []).push(dl.status);
    if (dl.deadline) (dueByMs[dl.milestoneId] ||= []).push(dl.deadline);
  }
  for (const ms of milestones) {
    const ds = byMs[ms.id];
    if (ds && ds.length) {
      ms.status = ds.includes('delay') ? 'delay'
        : ds.every(s => s === 'complete') ? 'complete'
        : ds.some(s => s === 'in_progress' || s === 'complete') ? 'in_progress'
        : 'not_started';
    }
    // Échéance du milestone dérivée = la date la plus tardive parmi ses livrables datés
    // (le jalon n'est atteint qu'une fois son dernier livrable terminé). Dates ISO → tri lexicographique = chronologique.
    const due = dueByMs[ms.id];
    if (due && due.length) ms.deadline = due.reduce((a, b) => (a > b ? a : b));
  }
  return {
    projects: p.rows.map(mapOpsProject),
    milestones,
    deliverables,
    weeklyComments: c.rows.map(mapOpsComment),
    deadlineHistory: h.rows.map(r => ({ id: r.id, entityType: r.entity_type, entityId: r.entity_id, oldDeadline: r.old_deadline, newDeadline: r.new_deadline, isSlip: r.is_slip, changedAt: r.changed_at })),
    synthesisNotes: sn.rows.map(r => ({ isoWeek: r.iso_week, corps: r.corps || '', version: r.version || 1, updatedBy: r.updated_by, updatedAt: r.updated_at })),
  };
}

// Libellé lisible d'une entité ops (pour tracer l'origine d'un commentaire intégré dans la note de synthèse).
async function opsEntityLabel(entityType: string, entityId: string): Promise<string> {
  if (entityType === 'milestone') { const r = await pool.query('SELECT title FROM ops_milestones WHERE id = $1', [entityId]); return r.rows[0]?.title || 'Jalon'; }
  const r = await pool.query('SELECT title FROM ops_deliverables WHERE id = $1', [entityId]); return r.rows[0]?.title || 'Livrable';
}

// Update générique d'une entité ops ; journalise un report d'échéance (forward) dans l'historique.
async function opsPatch(table: string, id: string, allowed: string[], body: any, entityType: string | null) {
  if (body.deadline !== undefined && entityType) {
    const cur = await pool.query(`SELECT deadline FROM ${table} WHERE id = $1`, [id]);
    const old = cur.rows[0]?.deadline || null;
    if ((old || '') !== (body.deadline || '')) {
      await pool.query(
        'INSERT INTO ops_deadline_history (entity_type, entity_id, old_deadline, new_deadline, is_slip) VALUES ($1, $2, $3, $4, $5)',
        [entityType, id, old, body.deadline || null, body.deadlineIsSlip === false ? false : true]
      );
    }
  }
  const fields: string[] = []; const values: any[] = []; let i = 1;
  for (const k of allowed) { if (body[k] !== undefined) { fields.push(`${k} = $${i++}`); values.push(body[k]); } }
  if (fields.length === 0) return null;
  values.push(id);
  const r = await pool.query(`UPDATE ${table} SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, values);
  return r.rows[0];
}

app.get('/api/ops/board', authenticateToken, async (_req: AuthRequest, res: Response) => {
  try { res.json(await loadOpsBoard()); }
  catch (e) { console.error('ops board', e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// --- Projets ---
app.post('/api/ops/projects', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    const { name, code, color } = req.body;
    if (!name) return res.status(400).json({ error: 'Nom requis' });
    const r = await pool.query('INSERT INTO ops_projects (name, code, color) VALUES ($1, $2, $3) RETURNING *', [name, code || null, color || '#64748b']);
    await logActivity(req, 'OPS_PROJECT_CREATE', r.rows[0].id, `A créé le projet Ops ${name}`);
    broadcast('ops:changed', {});
    res.status(201).json(mapOpsProject(r.rows[0]));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});
app.patch('/api/ops/projects/:id', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    const row = await opsPatch('ops_projects', req.params.id, ['name', 'code', 'color', 'archived'], req.body, null);
    if (!row) return res.status(400).json({ error: 'Rien à modifier' });
    broadcast('ops:changed', {});
    res.json(mapOpsProject(row));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});
app.delete('/api/ops/projects/:id', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    await pool.query('DELETE FROM ops_projects WHERE id = $1', [req.params.id]);
    await logActivity(req, 'OPS_PROJECT_DELETE', req.params.id, `A supprimé un projet Ops`);
    broadcast('ops:changed', {});
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// --- Milestones ---
app.post('/api/ops/milestones', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    const { projectId, number, title, status, deadline, owner } = req.body;
    if (!projectId || !title) return res.status(400).json({ error: 'Projet et titre requis' });
    const r = await pool.query(
      'INSERT INTO ops_milestones (project_id, number, title, status, deadline, owner) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [projectId, number ?? null, title, status || 'not_started', deadline || null, owner || null]
    );
    broadcast('ops:changed', {});
    res.status(201).json(mapOpsMilestone(r.rows[0]));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});
app.patch('/api/ops/milestones/:id', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    const row = await opsPatch('ops_milestones', req.params.id, ['number', 'title', 'status', 'deadline', 'owner', 'archived'], req.body, 'milestone');
    if (!row) return res.status(400).json({ error: 'Rien à modifier' });
    broadcast('ops:changed', {});
    res.json(mapOpsMilestone(row));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});
app.delete('/api/ops/milestones/:id', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try { await pool.query('DELETE FROM ops_milestones WHERE id = $1', [req.params.id]); broadcast('ops:changed', {}); res.json({ success: true }); }
  catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});
// Réordonner un milestone dans son projet (monter/descendre). Renumérote 1..n via le champ `number`.
app.post('/api/ops/milestones/:id/move', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    const direction = req.body?.direction === 'up' ? 'up' : 'down';
    const cur = await pool.query('SELECT project_id FROM ops_milestones WHERE id = $1', [req.params.id]);
    if (!cur.rows.length) return res.status(404).json({ error: 'Milestone introuvable' });
    const list = await pool.query('SELECT id FROM ops_milestones WHERE project_id = $1 ORDER BY number NULLS LAST, created_at', [cur.rows[0].project_id]);
    const ids: string[] = list.rows.map(r => r.id);
    const idx = ids.indexOf(req.params.id);
    const swap = direction === 'up' ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= ids.length) return res.json({ success: true }); // déjà à l'extrémité
    [ids[idx], ids[swap]] = [ids[swap], ids[idx]];
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (let i = 0; i < ids.length; i++) await client.query('UPDATE ops_milestones SET number = $1 WHERE id = $2', [i + 1, ids[i]]);
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
    broadcast('ops:changed', {});
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});
// Tendance hebdo : photo des chiffres clés (upsert de la semaine courante) + lecture de la semaine précédente.
app.put('/api/ops/kpi-snapshot', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    const { isoWeek, milestonesDone, milestonesTotal, deliverablesDone, deliverablesTotal, retards, glissements } = req.body || {};
    if (!isoWeek) return res.status(400).json({ error: 'Semaine requise' });
    await pool.query(
      `INSERT INTO ops_kpi_snapshots (iso_week, milestones_done, milestones_total, deliverables_done, deliverables_total, retards, glissements, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, CURRENT_TIMESTAMP)
       ON CONFLICT (iso_week) DO UPDATE SET milestones_done=$2, milestones_total=$3, deliverables_done=$4, deliverables_total=$5, retards=$6, glissements=$7, updated_at=CURRENT_TIMESTAMP`,
      [isoWeek, milestonesDone || 0, milestonesTotal || 0, deliverablesDone || 0, deliverablesTotal || 0, retards || 0, glissements || 0]
    );
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});
app.get('/api/ops/kpi-prev', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const week = String(req.query.week || '');
    const r = await pool.query('SELECT * FROM ops_kpi_snapshots WHERE iso_week < $1 ORDER BY iso_week DESC LIMIT 1', [week]);
    if (!r.rows.length) return res.json(null);
    const x = r.rows[0];
    res.json({ isoWeek: x.iso_week, milestonesDone: x.milestones_done, milestonesTotal: x.milestones_total, deliverablesDone: x.deliverables_done, deliverablesTotal: x.deliverables_total, retards: x.retards, glissements: x.glissements });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// --- Deliverables ---
app.post('/api/ops/deliverables', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    const { milestoneId, title, status, deadline, owner } = req.body;
    if (!milestoneId || !title) return res.status(400).json({ error: 'Milestone et titre requis' });
    const r = await pool.query(
      'INSERT INTO ops_deliverables (milestone_id, title, status, deadline, owner) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [milestoneId, title, status || 'not_started', deadline || null, owner || null]
    );
    broadcast('ops:changed', {});
    res.status(201).json(mapOpsDeliverable(r.rows[0]));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});
app.patch('/api/ops/deliverables/:id', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    const row = await opsPatch('ops_deliverables', req.params.id, ['title', 'status', 'deadline', 'owner'], req.body, 'deliverable');
    if (!row) return res.status(400).json({ error: 'Rien à modifier' });
    broadcast('ops:changed', {});
    res.json(mapOpsDeliverable(row));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});
app.delete('/api/ops/deliverables/:id', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try { await pool.query('DELETE FROM ops_deliverables WHERE id = $1', [req.params.id]); broadcast('ops:changed', {}); res.json({ success: true }); }
  catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});
// F1 — Réordonner un livrable dans son jalon. Réservé au Multiplicateur (admin). Renumérote 1..n en transaction.
// Accepte { direction: 'up'|'down' } (flèches) OU { position: n } (saisie directe).
app.post('/api/ops/deliverables/:id/move', authenticateToken, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const cur = await pool.query('SELECT milestone_id FROM ops_deliverables WHERE id = $1', [req.params.id]);
    if (!cur.rows.length) return res.status(404).json({ error: 'Livrable introuvable' });
    const list = await pool.query('SELECT id FROM ops_deliverables WHERE milestone_id = $1 ORDER BY ordre NULLS LAST, created_at', [cur.rows[0].milestone_id]);
    const ids: string[] = list.rows.map(r => r.id);
    const idx = ids.indexOf(req.params.id);
    const target = resolveMoveTarget(idx, ids.length, { direction: req.body?.direction, position: req.body?.position });
    if (req.body?.position !== undefined && target < 0) return res.status(400).json({ error: 'Position invalide' });
    if (target < 0 || target >= ids.length || target === idx) return res.json({ success: true }); // aux extrémités : no-op
    const ordered = reorderIds(ids, idx, target); // déplacement (pas un simple échange) → gère aussi la saisie de position
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (let i = 0; i < ordered.length; i++) await client.query('UPDATE ops_deliverables SET ordre = $1 WHERE id = $2', [i + 1, ordered[i]]);
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
    broadcast('ops:changed', {});
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// --- Commentaire hebdo (un par entité + semaine ISO) ---
app.put('/api/ops/comments', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    const { entityType, entityId, isoWeek, text } = req.body;
    if (!entityType || !entityId || !isoWeek) return res.status(400).json({ error: 'Paramètres manquants' });
    const r = await pool.query(
      `INSERT INTO ops_weekly_comments (entity_type, entity_id, iso_week, text) VALUES ($1, $2, $3, $4)
       ON CONFLICT (entity_type, entity_id, iso_week) DO UPDATE SET text = $4 RETURNING *`,
      [entityType, entityId, isoWeek, text || '']
    );
    broadcast('ops:changed', {});
    res.json(mapOpsComment(r.rows[0]));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// --- F2 : note de synthèse hebdo (corps éditable) + intégration des commentaires ---
function mapSynthesis(r: any) { return { isoWeek: r.iso_week, corps: r.corps || '', version: r.version || 1, updatedBy: r.updated_by, updatedAt: r.updated_at }; }

// Lecture de la note d'une semaine (renvoie une note vide version 0 si aucune n'existe encore).
app.get('/api/ops/synthesis', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const week = String(req.query.week || '');
    if (!week) return res.status(400).json({ error: 'Semaine requise' });
    const r = await pool.query('SELECT * FROM ops_synthesis_notes WHERE iso_week = $1', [week]);
    if (!r.rows.length) return res.json({ isoWeek: week, corps: '', version: 0, updatedBy: null, updatedAt: null });
    res.json(mapSynthesis(r.rows[0]));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// Enregistrement du corps avec contrôle de concurrence : la version envoyée doit correspondre à la version en base.
app.put('/api/ops/synthesis', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    const { isoWeek, corps, version } = req.body || {};
    if (!isoWeek) return res.status(400).json({ error: 'Semaine requise' });
    const author = req.user?.username || 'Système';
    const cur = await pool.query('SELECT version FROM ops_synthesis_notes WHERE iso_week = $1', [isoWeek]);
    const currentVersion = cur.rows.length ? cur.rows[0].version : 0;
    if (Number(version) !== Number(currentVersion)) {
      // Écriture sur une version périmée → refus explicite, pas d'écrasement silencieux.
      return res.status(409).json({ error: 'La note a été modifiée entre-temps. Rechargez avant d\'enregistrer.', currentVersion });
    }
    let row;
    if (cur.rows.length) {
      row = (await pool.query('UPDATE ops_synthesis_notes SET corps = $1, version = version + 1, updated_by = $2, updated_at = CURRENT_TIMESTAMP WHERE iso_week = $3 RETURNING *', [corps || '', author, isoWeek])).rows[0];
    } else {
      row = (await pool.query('INSERT INTO ops_synthesis_notes (iso_week, corps, version, updated_by) VALUES ($1, $2, 1, $3) RETURNING *', [isoWeek, corps || '', author])).rows[0];
    }
    broadcast('ops:changed', {});
    res.json(mapSynthesis(row));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// « Intégrer » un commentaire : ajoute son texte au corps de la note et passe le commentaire en statut `intégré` (horodaté + auteur). Transactionnel.
app.post('/api/ops/comments/integrate', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    const { entityType, entityId, isoWeek } = req.body || {};
    if (!entityType || !entityId || !isoWeek) return res.status(400).json({ error: 'Paramètres manquants' });
    const author = req.user?.username || 'Système';
    const c = await pool.query('SELECT * FROM ops_weekly_comments WHERE entity_type = $1 AND entity_id = $2 AND iso_week = $3', [entityType, entityId, isoWeek]);
    if (!c.rows.length || !(c.rows[0].text || '').trim()) return res.status(404).json({ error: 'Commentaire introuvable ou vide' });
    if (c.rows[0].statut === 'intégré') return res.status(409).json({ error: 'Commentaire déjà intégré' });
    const label = await opsEntityLabel(entityType, entityId);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const note = await client.query('SELECT corps FROM ops_synthesis_notes WHERE iso_week = $1 FOR UPDATE', [isoWeek]);
      const prev = note.rows[0]?.corps || '';
      const nextCorps = `${prev ? prev + '\n' : ''}• ${label} : ${c.rows[0].text}`;
      if (note.rows.length) await client.query('UPDATE ops_synthesis_notes SET corps = $1, version = version + 1, updated_by = $2, updated_at = CURRENT_TIMESTAMP WHERE iso_week = $3', [nextCorps, author, isoWeek]);
      else await client.query('INSERT INTO ops_synthesis_notes (iso_week, corps, version, updated_by) VALUES ($1, $2, 1, $3)', [isoWeek, nextCorps, author]);
      await client.query("UPDATE ops_weekly_comments SET statut = 'intégré', integrated_at = CURRENT_TIMESTAMP, integrated_by = $1 WHERE entity_type = $2 AND entity_id = $3 AND iso_week = $4", [author, entityType, entityId, isoWeek]);
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
    broadcast('ops:changed', {});
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// « Résoudre » un commentaire sans l'intégrer.
app.post('/api/ops/comments/resolve', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    const { entityType, entityId, isoWeek } = req.body || {};
    if (!entityType || !entityId || !isoWeek) return res.status(400).json({ error: 'Paramètres manquants' });
    const r = await pool.query("UPDATE ops_weekly_comments SET statut = 'résolu' WHERE entity_type = $1 AND entity_id = $2 AND iso_week = $3 RETURNING *", [entityType, entityId, isoWeek]);
    if (!r.rows.length) return res.status(404).json({ error: 'Commentaire introuvable' });
    broadcast('ops:changed', {});
    res.json(mapOpsComment(r.rows[0]));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// --- F4 : bilan IA (DeepSeek, compatible OpenAI) + objectifs hebdomadaires ---
// Appelle DeepSeek (chat/completions, mode JSON forcé) et renvoie le JSON parsé. Retente une fois si invalide.
// Renvoie { __noKey: true } si la clé n'est pas configurée, null en cas d'échec définitif.
// Modèle réglable via DEEPSEEK_BILAN_MODEL (ex. la version « V4 pro »), sinon DEEPSEEK_MODEL, sinon deepseek-chat.
async function deepseekBilan(system: string, user: string): Promise<any> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) return { __noKey: true };
  const base = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
  const model = process.env.DEEPSEEK_BILAN_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-chat';
  const callOnce = async (): Promise<string> => {
    const r = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, temperature: 0.2, stream: false, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    });
    if (!r.ok) { console.error('deepseek bilan', r.status, await r.text().catch(() => '')); return ''; }
    const d: any = await r.json();
    return d.choices?.[0]?.message?.content || '';
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    const parsed = extractBilanJson(await callOnce());
    if (parsed) return parsed;
  }
  return null;
}

const BILAN_SYSTEM = `Tu es un assistant de pilotage opérationnel. À partir des données d'actions et de livrables fournies (et uniquement d'elles), produis un bilan factuel par projet puis propose des objectifs hebdomadaires SMART.
Règles :
- Ne t'appuie que sur les données transmises. N'invente aucun fait ; signale les données manquantes ou incohérentes.
- Identifie explicitement les actions en retard (échéance dépassée) et les blocages.
- Objectifs : 3 à 5 par projet, SMART, priorisés, rattachés à des actions/livrables existants, avec un critère de succès mesurable.
- Réponds en français, ton concret et opérationnel ; objectifs mesurables, pas de généralités.
- Réponds STRICTEMENT au format JSON suivant, sans texte hors JSON :
{
  "bilan": [{ "projet": "", "avancement": "", "faits_marquants": [""], "risques_retards": [""] }],
  "objectifs_hebdo": [{ "projet": "", "objectifs": [ { "intitule": "", "priorite": 1, "actions_liees": [""], "critere_succes": "" } ]}]
}`;

// Génère le bilan (ne l'enregistre pas — il est édité côté UI avant sauvegarde).
app.post('/api/ops/ia-bilan/generate', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    const board = await loadOpsBoard();
    const today = new Date().toISOString().slice(0, 10);
    const isoWeek = String(req.body?.isoWeek || '');
    const note = isoWeek ? (board.synthesisNotes.find((n: any) => n.isoWeek === isoWeek)) : null;
    // Entrée strictement limitée au reporting : projets → jalons → livrables ordonnés (+ retards), et le corps du reporting.
    const data = board.projects.map((p: any) => ({
      projet: p.name,
      jalons: board.milestones.filter((m: any) => m.projectId === p.id).map((m: any) => ({
        titre: m.title, statut: m.status, echeance: m.deadline || null,
        en_retard: !!(m.deadline && m.deadline < today && m.status !== 'complete'),
        livrables: board.deliverables.filter((d: any) => d.milestoneId === m.id).map((d: any) => ({
          titre: d.title, statut: d.status, echeance: d.deadline || null, responsable: d.owner || null,
          en_retard: !!(d.deadline && d.deadline < today && d.status !== 'complete'),
        })),
      })),
    }));
    const user = `Date du jour : ${today}\nSemaine : ${isoWeek || '(non précisée)'}\n\nDONNÉES (actions et livrables ordonnés, par projet) :\n${JSON.stringify(data, null, 1)}\n\n${note?.corps ? 'CORPS DU REPORTING (note de synthèse de la semaine) :\n' + note.corps : '(Aucune note de synthèse pour cette semaine.)'}`;
    const result = await deepseekBilan(BILAN_SYSTEM, user);
    if (result?.__noKey) return res.status(503).json({ error: "Bilan IA non configuré (clé DEEPSEEK_API_KEY manquante côté serveur)." });
    if (!result) return res.status(502).json({ error: "L'IA n'a pas renvoyé de résultat exploitable (réessayez)." });
    res.json(result);
  } catch (e) { console.error('ia-bilan generate', e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// Charge le dernier bilan enregistré pour une semaine.
app.get('/api/ops/ia-bilan', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const week = String(req.query.week || '');
    if (!week) return res.status(400).json({ error: 'Semaine requise' });
    const r = await pool.query('SELECT * FROM ops_ia_bilans WHERE iso_week = $1', [week]);
    if (!r.rows.length) return res.json(null);
    res.json({ isoWeek: r.rows[0].iso_week, contenu: r.rows[0].contenu, updatedBy: r.rows[0].updated_by, updatedAt: r.rows[0].updated_at });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// Enregistre le bilan (éventuellement édité) attaché à la semaine.
app.put('/api/ops/ia-bilan', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    const { isoWeek, contenu } = req.body || {};
    if (!isoWeek || !contenu) return res.status(400).json({ error: 'Semaine et contenu requis' });
    const author = req.user?.username || 'Système';
    const payload = JSON.stringify(contenu);
    await pool.query(
      `INSERT INTO ops_ia_bilans (iso_week, contenu, updated_by, updated_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
       ON CONFLICT (iso_week) DO UPDATE SET contenu = $2, updated_by = $3, updated_at = CURRENT_TIMESTAMP`,
      [isoWeek, payload, author]
    );
    // Conserve chaque enregistrement dans l'historique (horodaté).
    await pool.query(`INSERT INTO ops_bilan_history (iso_week, contenu, created_by) VALUES ($1, $2, $3)`, [isoWeek, payload, author]);
    broadcast('ops:changed', {});
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// Historique des bilans enregistrés (liste légère : sans le contenu complet).
app.get('/api/ops/ia-bilan/history', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const week = String(req.query.week || '');
    const params: any[] = [];
    let where = '';
    if (week) { where = 'WHERE iso_week = $1'; params.push(week); }
    const r = await pool.query(`SELECT id, iso_week, created_by, created_at FROM ops_bilan_history ${where} ORDER BY created_at DESC LIMIT 100`, params);
    res.json({ history: r.rows.map((x: any) => ({ id: x.id, isoWeek: x.iso_week, createdBy: x.created_by, createdAt: x.created_at })) });
  } catch (e) { console.error('bilan history', e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// Contenu complet d'un bilan historisé.
app.get('/api/ops/ia-bilan/history/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const r = await pool.query('SELECT * FROM ops_bilan_history WHERE id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Introuvable' });
    const x = r.rows[0];
    res.json({ id: x.id, isoWeek: x.iso_week, contenu: x.contenu, createdBy: x.created_by, createdAt: x.created_at });
  } catch (e) { console.error('bilan history get', e); res.status(500).json({ error: 'Erreur serveur' }); }
});

app.delete('/api/ops/ia-bilan/history/:id', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    await pool.query('DELETE FROM ops_bilan_history WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { console.error('bilan history del', e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// --- Export lecture seule pour l'agent (frontière de sécurité : token dédié ou admin) ---
app.get('/api/ops-export', async (req: Request, res: Response) => {
  try {
    const token = (req.query.token as string) || (req.headers['authorization'] || '').toString().replace('Bearer ', '');
    const expected = process.env.OPS_EXPORT_TOKEN;
    let authorized = false;
    if (expected && token && token === expected) authorized = true;
    else if (token) { try { const d = jwt.verify(token, JWT_SECRET) as JWTPayload; if (d.role === 'admin') authorized = true; } catch { /* ignore */ } }
    if (!authorized) return res.status(401).json({ error: 'Token invalide' });
    res.json(await loadOpsBoard());
  } catch (e) { console.error('ops-export', e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// Compétences (fiches méthode) actives de Maya, triées par nom.
async function loadMayaSkills(): Promise<{ id: number; name: string; trigger: string; body: string }[]> {
  try {
    const r = await pool.query('SELECT id, name, trigger, body FROM maya_skills WHERE enabled = TRUE ORDER BY name');
    return r.rows.map((x: any) => ({ id: x.id, name: x.name, trigger: x.trigger || '', body: x.body || '' }));
  } catch { return []; }
}

// --- Assistant IA « Maya » (DeepSeek, compatible OpenAI) ---
app.post('/api/ai/chat', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const key = process.env.DEEPSEEK_API_KEY;
    if (!key) return res.status(503).json({ error: "Maya n'est pas configurée (clé DeepSeek manquante côté serveur)." });
    const base = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
    const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
    const userMessages = (Array.isArray(req.body?.messages) ? req.body.messages : [])
      .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-12);

    const b = await loadOpsBoard();
    const skills = await loadMayaSkills();
    const today = new Date().toISOString().slice(0, 10);
    // semaine ISO courante (pour les commentaires)
    const dd = new Date(); const dz = new Date(Date.UTC(dd.getFullYear(), dd.getMonth(), dd.getDate()));
    const dow = dz.getUTCDay() || 7; dz.setUTCDate(dz.getUTCDate() + 4 - dow);
    const ys = new Date(Date.UTC(dz.getUTCFullYear(), 0, 1));
    const isoWk = `${dz.getUTCFullYear()}-W${String(Math.ceil((((dz.getTime() - ys.getTime()) / 86400000) + 1) / 7)).padStart(2, '0')}`;

    const ctx = b.projects.map((p: any) => {
      const ms = b.milestones.filter((m: any) => m.projectId === p.id);
      let s = `PROJET "${p.name}" (project_id=${p.id})`;
      for (const m of ms) {
        s += `\n  MILESTONE [id=${m.id}] "${String(m.title).slice(0, 70)}" statut=${m.status} échéance=${m.deadline || '-'}`;
        for (const d of b.deliverables.filter((x: any) => x.milestoneId === m.id)) {
          s += `\n    DELIVERABLE [id=${d.id}] "${String(d.title).slice(0, 70)}" statut=${d.status} échéance=${d.deadline || '-'}`;
        }
      }
      return s;
    }).join('\n');

    const system = `Tu es Maya, l'assistante Ops de Louna Aesthetics. Tu écris en français, style direct, pragmatique, orienté action (esprit startup, leadership), avec quelques emojis pertinents.
Tu peux LIRE et MODIFIER le board via les outils fournis (créer milestones/deliverables, changer statut ou échéance, écrire le commentaire de la semaine). Utilise les id exacts donnés ci-dessous. Statuts valides : complete, in_progress, not_started, delay. Dates au format AAAA-MM-JJ.
Quand tu as fait une action, confirme-la en une phrase claire (ex: "✅ Milestone 3 d'ALBOMED marqué terminé"). Si une demande est ambiguë (plusieurs éléments correspondent), demande de préciser au lieu de deviner.
Date du jour : ${today}. Semaine en cours : ${isoWk}.
Pour un débrief, structure : 📊 Vue d'ensemble · ✅ Réalisations · 🎯 Objectifs S+1 · ⏰ Retards · ↪️ Glissements.

OUTILS ODOO (ERP, LECTURE SEULE) : tu peux interroger Odoo en direct via odoo_search_read(model, domain, fields, limit, order, company) et odoo_read_group(model, domain, fields, groupby, company) — n'importe quel modèle. Sociétés : "aesthetics" (Louna Aesthetics) ou "regenerative" (Louna Regenerative). Repères utiles :
- Stock : modèle product.product, champs default_code, name, qty_available (stock physique), free_qty (dispo non réservé). Stock réservé = qty_available − free_qty.
- Factures : modèle account.move, domaine [["move_type","=","out_invoice"],["state","=","posted"]], champs invoice_date, amount_total (TTC), amount_untaxed (HT), partner_id. Total via odoo_read_group fields ['amount_total:sum'].
- Autres modèles dispo : sale.order, purchase.order, stock.quant, res.partner, etc.
Domaine = liste de conditions, ex. [["default_code","ilike","DB-IHA"]]. Ne JAMAIS inventer un chiffre : si un outil échoue, dis-le franchement. Tu ne peux PAS écrire dans Odoo (lecture seule).

MODULE QMS (Qualité ISO 13485 / MDR) — tu peux LIRE et AGIR :
- Lecture : qms_tracking_list(kind, status, q) pour les NC/CAPA/CC (kind='NC'|'CAPA'|'CC', status='OPEN'|'CLOSED') ; qms_risks_list(category, q) registre des risques (category='PRODUIT'|'PROCESS', criticité=occurrence×severity) ; qms_equipment_list(status, q) équipements + calibrations planifiées ; qms_suppliers_list(status, classification, q) fournisseurs ; qms_documents_list(q) documentation contrôlée (lien OneDrive).
- Action : qms_create_record(kind, description, dueDate?) crée une NC/CAPA/CC (numéro auto, statut OUVERT) ; qms_update_record(kind, extId, status?, dueDate?, description?) met à jour (status='OPEN'|'CLOSED'). Toute action est tracée dans l'audit trail (ALCOA+). Quand tu crées/modifies, confirme avec le numéro (ex. "✅ NC-2026-007 créée"). Si ambigu, demande de préciser. Tu n'inventes jamais un numéro ou un chiffre : si un outil échoue, dis-le.

${skills.length ? `COMPÉTENCES DISPONIBLES (fiches méthode maison) — quand l'une correspond à la demande, APPELLE d'abord charger_competence(nom) pour lire sa méthode, puis applique-la :
${skills.map(s => `- "${s.name}"${s.trigger ? ` — à utiliser ${s.trigger}` : ''}`).join('\n')}
` : ''}
BOARD ACTUEL :
${ctx || '(board vide)'}`;

    const tools = [
      { type: 'function', function: { name: 'create_milestone', description: 'Créer un milestone dans un projet', parameters: { type: 'object', properties: { project_id: { type: 'string' }, title: { type: 'string' }, status: { type: 'string', enum: ['complete', 'in_progress', 'not_started', 'delay'] }, deadline: { type: 'string', description: 'AAAA-MM-JJ' } }, required: ['project_id', 'title'] } } },
      { type: 'function', function: { name: 'create_deliverable', description: 'Créer un deliverable sous un milestone', parameters: { type: 'object', properties: { milestone_id: { type: 'string' }, title: { type: 'string' }, status: { type: 'string', enum: ['complete', 'in_progress', 'not_started', 'delay'] }, deadline: { type: 'string' } }, required: ['milestone_id', 'title'] } } },
      { type: 'function', function: { name: 'update_milestone', description: 'Modifier un milestone (statut, échéance, titre)', parameters: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string', enum: ['complete', 'in_progress', 'not_started', 'delay'] }, deadline: { type: 'string' }, title: { type: 'string' } }, required: ['id'] } } },
      { type: 'function', function: { name: 'update_deliverable', description: 'Modifier un deliverable (statut, échéance, titre)', parameters: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string', enum: ['complete', 'in_progress', 'not_started', 'delay'] }, deadline: { type: 'string' }, title: { type: 'string' } }, required: ['id'] } } },
      { type: 'function', function: { name: 'set_comment', description: "Écrire le commentaire de la semaine en cours sur un milestone ou deliverable", parameters: { type: 'object', properties: { entity_type: { type: 'string', enum: ['milestone', 'deliverable'] }, entity_id: { type: 'string' }, text: { type: 'string' } }, required: ['entity_type', 'entity_id', 'text'] } } },
      { type: 'function', function: { name: 'odoo_search_read', description: "Lire des enregistrements de N'IMPORTE QUEL modèle Odoo (ERP) en direct, lecture seule. Ex: stock produit, factures, commandes, contacts.", parameters: { type: 'object', properties: { model: { type: 'string', description: "ex. 'product.product', 'account.move', 'sale.order', 'res.partner'" }, domain: { type: 'array', description: "Domaine Odoo, ex. [[\"default_code\",\"ilike\",\"DB-IHA\"]]. [] = tout.", items: {} }, fields: { type: 'array', items: { type: 'string' }, description: 'Champs à lire' }, limit: { type: 'number', description: 'défaut 50, max 200' }, order: { type: 'string' }, company: { type: 'string', enum: ['aesthetics', 'regenerative'], description: 'société (optionnel)' } }, required: ['model'] } } },
      { type: 'function', function: { name: 'odoo_read_group', description: "Agréger des enregistrements Odoo (sommes, comptages) groupés. Ex: total TTC des factures. Lecture seule.", parameters: { type: 'object', properties: { model: { type: 'string' }, domain: { type: 'array', items: {} }, fields: { type: 'array', items: { type: 'string' }, description: "ex. ['amount_total:sum']" }, groupby: { type: 'array', items: { type: 'string' } }, company: { type: 'string', enum: ['aesthetics', 'regenerative'] } }, required: ['model', 'fields'] } } },
      { type: 'function', function: { name: 'qms_tracking_list', description: 'Lister les NC / CAPA / Change Control du QMS (registre).', parameters: { type: 'object', properties: { kind: { type: 'string', enum: ['NC', 'CAPA', 'CC'] }, status: { type: 'string', enum: ['OPEN', 'CLOSED'] }, q: { type: 'string', description: 'recherche n° ou sujet' } } } } },
      { type: 'function', function: { name: 'qms_risks_list', description: 'Lister le registre des risques (ISO 14971). Criticité = occurrence × severity.', parameters: { type: 'object', properties: { category: { type: 'string', enum: ['PRODUIT', 'PROCESS'] }, q: { type: 'string' } } } } },
      { type: 'function', function: { name: 'qms_equipment_list', description: 'Lister les équipements + leurs interventions planifiées/réalisées (calibration, maintenance, QO).', parameters: { type: 'object', properties: { status: { type: 'string' }, q: { type: 'string' } } } } },
      { type: 'function', function: { name: 'qms_suppliers_list', description: 'Lister les fournisseurs qualifiés (statut, criticité, expiration certif).', parameters: { type: 'object', properties: { status: { type: 'string' }, classification: { type: 'string' }, q: { type: 'string' } } } } },
      { type: 'function', function: { name: 'qms_documents_list', description: 'Rechercher dans la documentation contrôlée QMS (OneDrive).', parameters: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] } } },
      { type: 'function', function: { name: 'qms_create_record', description: 'Créer une non-conformité (NC), CAPA ou Change Control (CC). Numéro auto, statut OUVERT.', parameters: { type: 'object', properties: { kind: { type: 'string', enum: ['NC', 'CAPA', 'CC'] }, description: { type: 'string' }, dueDate: { type: 'string', description: 'échéance AAAA-MM-JJ (optionnel)' } }, required: ['kind', 'description'] } } },
      { type: 'function', function: { name: 'qms_update_record', description: 'Modifier une NC/CAPA/CC existante (statut, échéance, description).', parameters: { type: 'object', properties: { kind: { type: 'string', enum: ['NC', 'CAPA', 'CC'] }, extId: { type: 'string', description: 'n° ex. NC-2026-007' }, status: { type: 'string', enum: ['OPEN', 'CLOSED'] }, dueDate: { type: 'string' }, description: { type: 'string' } }, required: ['kind', 'extId'] } } },
      { type: 'function', function: { name: 'charger_competence', description: "Charger le contenu d'une fiche méthode (compétence) listée dans COMPÉTENCES DISPONIBLES, pour suivre sa méthode avant de répondre.", parameters: { type: 'object', properties: { nom: { type: 'string', description: 'nom exact de la compétence' } }, required: ['nom'] } } },
    ];

    const execTool = async (name: string, a: any): Promise<any> => {
      try {
        if (name === 'create_milestone') {
          const r = await pool.query('INSERT INTO ops_milestones (project_id,title,status,deadline) VALUES ($1,$2,$3,$4) RETURNING *', [a.project_id, a.title, a.status || 'not_started', a.deadline || null]);
          broadcast('ops:changed', {}); return { ok: true, id: r.rows[0].id };
        }
        if (name === 'create_deliverable') {
          const r = await pool.query('INSERT INTO ops_deliverables (milestone_id,title,status,deadline) VALUES ($1,$2,$3,$4) RETURNING *', [a.milestone_id, a.title, a.status || 'not_started', a.deadline || null]);
          broadcast('ops:changed', {}); return { ok: true, id: r.rows[0].id };
        }
        if (name === 'update_milestone') {
          const row = await opsPatch('ops_milestones', a.id, ['title', 'status', 'deadline'], a, 'milestone');
          broadcast('ops:changed', {}); return { ok: !!row };
        }
        if (name === 'update_deliverable') {
          const row = await opsPatch('ops_deliverables', a.id, ['title', 'status', 'deadline'], a, 'deliverable');
          broadcast('ops:changed', {}); return { ok: !!row };
        }
        if (name === 'set_comment') {
          await pool.query(`INSERT INTO ops_weekly_comments (entity_type,entity_id,iso_week,text) VALUES ($1,$2,$3,$4) ON CONFLICT (entity_type,entity_id,iso_week) DO UPDATE SET text=$4`, [a.entity_type, a.entity_id, isoWk, a.text]);
          broadcast('ops:changed', {}); return { ok: true };
        }
        if (name === 'odoo_search_read') {
          if (!process.env.ODOO_API_KEY) return { ok: false, error: 'Odoo non configuré côté serveur.' };
          const ctx = await odooReadCtx(a.company);
          const rows = await odooKw(String(a.model), 'search_read', [Array.isArray(a.domain) ? a.domain : []], {
            fields: Array.isArray(a.fields) ? a.fields : undefined,
            limit: Math.min(Number(a.limit) || 50, 200), order: a.order || undefined, context: ctx,
          });
          return { ok: true, count: rows.length, rows };
        }
        if (name === 'odoo_read_group') {
          if (!process.env.ODOO_API_KEY) return { ok: false, error: 'Odoo non configuré côté serveur.' };
          const ctx = await odooReadCtx(a.company);
          const groups = await odooKw(String(a.model), 'read_group', [Array.isArray(a.domain) ? a.domain : [], Array.isArray(a.fields) ? a.fields : [], Array.isArray(a.groupby) ? a.groupby : []], { context: ctx });
          return { ok: true, groups };
        }
        // ---- QMS : lecture ----
        if (name === 'qms_tracking_list') {
          const w: string[] = []; const v: any[] = []; let i = 1;
          if (a.kind) { w.push(`kind=$${i++}`); v.push(a.kind); }
          if (a.status) { w.push(`status=$${i++}`); v.push(a.status); }
          if (a.q) { w.push(`(ext_id ILIKE $${i} OR description ILIKE $${i})`); v.push(`%${a.q}%`); i++; }
          const r = await pool.query(`SELECT kind,ext_id,description,status,opening_date,due_date,closure_date FROM qms_tracking ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY (status='OPEN') DESC, due_date ASC NULLS LAST LIMIT 60`, v);
          return { ok: true, count: r.rows.length, rows: r.rows };
        }
        if (name === 'qms_risks_list') {
          const w: string[] = []; const v: any[] = []; let i = 1;
          if (a.category) { w.push(`category=$${i++}`); v.push(a.category); }
          if (a.q) { w.push(`(hazard ILIKE $${i} OR harm ILIKE $${i} OR step ILIKE $${i})`); v.push(`%${a.q}%`); i++; }
          const r = await pool.query(`SELECT category,ext_id,step,hazard,harm,occurrence,severity,(COALESCE(occurrence,0)*COALESCE(severity,0)) AS criticite,risk_eval,occurrence_res,severity_res,residual_risk FROM qms_risk_register ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY criticite DESC LIMIT 60`, v);
          return { ok: true, count: r.rows.length, rows: r.rows };
        }
        if (name === 'qms_equipment_list') {
          const w: string[] = []; const v: any[] = []; let i = 1;
          if (a.status) { w.push(`status=$${i++}`); v.push(a.status); }
          if (a.q) { w.push(`(ext_id ILIKE $${i} OR name ILIKE $${i} OR location ILIKE $${i})`); v.push(`%${a.q}%`); i++; }
          const r = await pool.query(`SELECT ext_id,name,type,location,status,interventions FROM qms_equipment ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY ext_id LIMIT 80`, v);
          return { ok: true, count: r.rows.length, rows: r.rows };
        }
        if (name === 'qms_suppliers_list') {
          const w: string[] = []; const v: any[] = []; let i = 1;
          if (a.status) { w.push(`status=$${i++}`); v.push(a.status); }
          if (a.classification) { w.push(`classification=$${i++}`); v.push(a.classification); }
          if (a.q) { w.push(`(name ILIKE $${i} OR ext_id ILIKE $${i} OR product ILIKE $${i})`); v.push(`%${a.q}%`); i++; }
          const r = await pool.query(`SELECT ext_id,name,status,classification,product,cert_expiration FROM qms_suppliers ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY ext_id NULLS LAST LIMIT 80`, v);
          return { ok: true, count: r.rows.length, rows: r.rows };
        }
        if (name === 'qms_documents_list') {
          const r = await pool.query(`SELECT name,doc_type,process_code,lifecycle_state,web_url,last_modified FROM qms_documents WHERE soft_deleted=FALSE AND is_folder=FALSE AND name ILIKE $1 ORDER BY last_modified DESC NULLS LAST LIMIT 30`, [`%${a.q || ''}%`]);
          return { ok: true, count: r.rows.length, rows: r.rows };
        }
        // ---- QMS : action (écriture dans le registre qms_tracking, audité) ----
        if (name === 'qms_create_record') {
          const kind = (a.kind || '').toUpperCase();
          if (!['NC', 'CAPA', 'CC'].includes(kind)) return { ok: false, error: 'kind invalide' };
          if (!a.description) return { ok: false, error: 'description requise' };
          const year = new Date().getFullYear();
          const last = await pool.query(`SELECT ext_id FROM qms_tracking WHERE kind=$1 AND ext_id LIKE $2 ORDER BY ext_id DESC LIMIT 1`, [kind, `${kind}-${year}-%`]);
          let seq = 1; if (last.rows[0]) { const m = String(last.rows[0].ext_id).match(/(\d+)$/); if (m) seq = parseInt(m[1]) + 1; }
          const extId = `${kind}-${year}-${String(seq).padStart(3, '0')}`;
          await pool.query(`INSERT INTO qms_tracking (kind, ext_id, description, status, raw_status, opening_date, due_date) VALUES ($1,$2,$3,'OPEN','Ouvert',CURRENT_DATE,$4)`, [kind, extId, String(a.description).slice(0, 2000), (typeof a.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.dueDate)) ? a.dueDate : null]);
          await logActivity(req, 'QMS_AI_CREATE', extId, `Maya a créé ${extId} : ${String(a.description).slice(0, 120)}`);
          broadcast('qms:changed', {});
          return { ok: true, extId };
        }
        if (name === 'qms_update_record') {
          const kind = (a.kind || '').toUpperCase();
          const cur = await pool.query('SELECT * FROM qms_tracking WHERE kind=$1 AND ext_id=$2', [kind, a.extId]);
          if (!cur.rows[0]) return { ok: false, error: 'enregistrement introuvable' };
          const sets: string[] = []; const v: any[] = []; let i = 1;
          if (a.status === 'OPEN' || a.status === 'CLOSED') { sets.push(`status=$${i++}`); v.push(a.status); sets.push(`raw_status=$${i++}`); v.push(a.status === 'CLOSED' ? 'Clôturé' : 'Ouvert'); if (a.status === 'CLOSED') { sets.push(`closure_date=CURRENT_DATE`); } }
          if (typeof a.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.dueDate)) { sets.push(`due_date=$${i++}`); v.push(a.dueDate); }
          if (a.description) { sets.push(`description=$${i++}`); v.push(String(a.description).slice(0, 2000)); }
          if (!sets.length) return { ok: false, error: 'rien à modifier' };
          v.push(kind); v.push(a.extId);
          await pool.query(`UPDATE qms_tracking SET ${sets.join(', ')} WHERE kind=$${i++} AND ext_id=$${i}`, v);
          await logActivity(req, 'QMS_AI_UPDATE', a.extId, `Maya a modifié ${a.extId}${a.status ? ` (statut → ${a.status})` : ''}`);
          broadcast('qms:changed', {});
          return { ok: true };
        }
        if (name === 'charger_competence') {
          const wanted = String(a.nom || '').trim().toLowerCase();
          const sk = skills.find(s => s.name.trim().toLowerCase() === wanted)
            || skills.find(s => s.name.trim().toLowerCase().includes(wanted) && wanted.length > 2);
          if (!sk) return { ok: false, error: 'compétence introuvable', disponibles: skills.map(s => s.name) };
          return { ok: true, nom: sk.name, contenu: sk.body };
        }
        return { ok: false, error: 'outil inconnu' };
      } catch (e: any) { return { ok: false, error: String(e.message || e) }; }
    };

    const messages: any[] = [{ role: 'system', content: system }, ...userMessages];
    let reply = '(pas de réponse)';
    for (let i = 0; i < 6; i++) {
      const r = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, messages, tools, stream: false, temperature: 0.3 }),
      });
      const data: any = await r.json();
      if (!r.ok) { console.error('DeepSeek error', data); return res.status(502).json({ error: 'Maya est indisponible (erreur API).' }); }
      const msg = data.choices?.[0]?.message;
      messages.push(msg);
      if (!msg?.tool_calls || msg.tool_calls.length === 0) { reply = msg?.content || '(pas de réponse)'; break; }
      for (const tc of msg.tool_calls) {
        let args = {}; try { args = JSON.parse(tc.function.arguments || '{}'); } catch { /* ignore */ }
        const result = await execTool(tc.function.name, args);
        messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
      }
    }
    res.json({ reply });
  } catch (e) {
    console.error('ai chat', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// --- Compétences de Maya (fiches méthode éditables) ---
const mapMayaSkill = (r: any) => ({ id: r.id, name: r.name, trigger: r.trigger || '', body: r.body || '', enabled: !!r.enabled, updatedAt: r.updated_at });

app.get('/api/maya/skills', authenticateToken, async (_req: AuthRequest, res: Response) => {
  try {
    const r = await pool.query('SELECT * FROM maya_skills ORDER BY name');
    res.json({ skills: r.rows.map(mapMayaSkill) });
  } catch (e) { console.error('maya skills list', e); res.status(500).json({ error: 'Erreur serveur' }); }
});

app.post('/api/maya/skills', authenticateToken, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { name, trigger, body, enabled } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Nom requis' });
    const r = await pool.query(
      'INSERT INTO maya_skills (name, trigger, body, enabled) VALUES ($1,$2,$3,$4) RETURNING *',
      [String(name).trim(), String(trigger || ''), String(body || ''), enabled !== false]
    );
    res.json(mapMayaSkill(r.rows[0]));
  } catch (e) { console.error('maya skills create', e); res.status(500).json({ error: 'Erreur serveur' }); }
});

app.patch('/api/maya/skills/:id', authenticateToken, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const sets: string[] = []; const v: any[] = []; let i = 1;
    for (const [k, col] of [['name', 'name'], ['trigger', 'trigger'], ['body', 'body']] as const) {
      if (req.body?.[k] !== undefined) { sets.push(`${col}=$${i++}`); v.push(String(req.body[k])); }
    }
    if (req.body?.enabled !== undefined) { sets.push(`enabled=$${i++}`); v.push(!!req.body.enabled); }
    if (!sets.length) return res.status(400).json({ error: 'Rien à modifier' });
    sets.push(`updated_at=CURRENT_TIMESTAMP`);
    v.push(req.params.id);
    const r = await pool.query(`UPDATE maya_skills SET ${sets.join(', ')} WHERE id=$${i} RETURNING *`, v);
    if (!r.rows[0]) return res.status(404).json({ error: 'Compétence introuvable' });
    res.json(mapMayaSkill(r.rows[0]));
  } catch (e) { console.error('maya skills update', e); res.status(500).json({ error: 'Erreur serveur' }); }
});

app.delete('/api/maya/skills/:id', authenticateToken, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    await pool.query('DELETE FROM maya_skills WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { console.error('maya skills delete', e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// ===================== Mirage (contrôle visuel / inspection des unités) =====================

// Clé de rationalisation des libellés de défauts : insensible à la casse, aux accents, aux pluriels et aux séparateurs.
const mirageDefectKey = (s: any) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[\s\/\-_,;:.()]+/g, ' ')
  .split(' ').map(w => w.replace(/s$/, '')).filter(Boolean).join(' ');

async function loadMirageDefectTypes(): Promise<string[]> {
  try {
    const r = await pool.query("SELECT value FROM settings WHERE key='mirageDefectTypes'");
    if (Array.isArray(r.rows[0]?.value) && r.rows[0].value.length) return r.rows[0].value.map(String);
  } catch { /* fallback liste par défaut */ }
  return DEFAULT_MIRAGE_DEFECT_TYPES;
}

app.get('/api/mirage/defect-types', authenticateToken, requireView('mirage'), async (_req: AuthRequest, res: Response) => {
  try { res.json({ types: await loadMirageDefectTypes() }); }
  catch (e) { console.error('mirage defect-types', e); res.status(500).json({ error: 'Erreur serveur' }); }
});

app.post('/api/mirage/defect-types', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    const label = String(req.body?.label || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!label) return res.status(400).json({ error: 'Libellé requis' });
    const types = await loadMirageDefectTypes();
    if (!types.some(t => mirageDefectKey(t) === mirageDefectKey(label))) {
      types.push(label);
      await pool.query(`INSERT INTO settings (key, value) VALUES ('mirageDefectTypes', $1) ON CONFLICT (key) DO UPDATE SET value = $1`, [JSON.stringify(types)]);
      await logActivity(req, 'MIRAGE_DEFECT_TYPE_ADD', label, `Type de défaut mirage ajouté au référentiel : ${label}`);
    }
    res.json({ types });
  } catch (e) { console.error('mirage defect-types add', e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// Extraction IA d'une page « mirage » depuis un PDF de dossier de lot (Claude, lecture native des PDF).
// Repli : si la clé ANTHROPIC_API_KEY n'est pas configurée, l'onglet fonctionne en saisie manuelle.
app.post('/api/mirage/extract', authenticateToken, requireView('mirage'), express.raw({ type: '*/*', limit: '50mb' }), async (req: AuthRequest, res: Response) => {
  try {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return res.status(503).json({ error: "Lecture IA non configurée (clé GEMINI_API_KEY manquante côté serveur). Saisie manuelle possible." });
    const buf = req.body as Buffer;
    if (!buf || !buf.length) return res.status(400).json({ error: 'Fichier vide' });
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    // Envoi du PDF via la Files API (gère les gros dossiers scannés, sans la limite ~20 Mo de l'inline).
    const up = await geminiUploadPdf(key, buf, 'dossier_lot', 15);
    if (!up.ok) {
      if (up.stage === 'processing') return res.status(502).json({ error: "Le PDF n'a pas pu être préparé pour la lecture (réessayez)." });
      console.error(up.stage === 'start' ? 'gemini upload start' : 'gemini upload', up.status, up.detail ?? '');
      return res.status(502).json({ error: "Lecture IA indisponible (envoi du PDF)." });
    }
    const { fileUri, fileName } = up;
    // Catalogue Track&Production (settings.productCatalog) : nom commercial → type de produit + référence.
    let catalog: any[] = DEFAULT_PRODUCT_CATALOG;
    try {
      const catRes = await pool.query("SELECT value FROM settings WHERE key='productCatalog'");
      if (Array.isArray(catRes.rows[0]?.value) && catRes.rows[0].value.length) catalog = catRes.rows[0].value;
    } catch { /* fallback catalogue par défaut */ }
    const mappingTable = catalog.map((p: any) => `- "${p.name}" → product_name="${p.type}", product_code="${p.ref}"`).join('\n');
    const dtypes = await loadMirageDefectTypes();
    const prompt = `Tu analyses un dossier de lot pharmaceutique/cosmétique (souvent scanné). Trouve les pages de CONTRÔLE VISUEL, appelées « mirage » : l'inspection des unités (seringues ou flacons) devant une source lumineuse pour détecter les défauts.
ATTENTION : un dossier peut contenir PLUSIEURS feuilles de mirage (contrôle initial + reprises/re-contrôles). Parcours TOUT le document, repère CHAQUE feuille de mirage, puis fais les TOTAUX sur l'ensemble : qty_rejected = somme des rejetés de toutes les feuilles ; defects = somme des quantités par type de défaut sur toutes les feuilles (fusionne les mêmes libellés). Dans notes, indique le nombre de feuilles de mirage trouvées (ex. « 2 feuilles de mirage dont 1 reprise »).
Extrais UNIQUEMENT ces informations, en JSON strict, sans aucun texte autour :
{
 "product_code": string|null,
 "product_name": string|null,
 "lot": string|null,
 "inspection_date": string|null,
 "unit_type": string|null,
 "qty_inspected": number|null,
 "qty_rejected": number|null,
 "defects": [ { "type": string, "count": number } ],
 "notes": string|null
}
Règles : inspection_date au format AAAA-MM-JJ. unit_type = "seringue" ou "flacon".
PRODUIT : le dossier mentionne un nom commercial (ex. « Innovyal Lightening Action », « Hydragel A2 Lift »). Convertis-le via cette table interne : product_name = le TYPE DE PRODUIT interne et product_code = la RÉFÉRENCE interne :
${mappingTable}
Indices : « Lift » ou seringue → variante SYRINGE ; DM vs COS selon la mention sur le dossier. Si aucun produit de la table ne correspond, mets le nom lu tel quel dans product_name et null dans product_code.
QUANTITÉS : qty_rejected = la somme des lignes « total des unités rejetées » de TOUTES les feuilles de mirage (ex. « Quantité totale de flacons rejetés »). qty_inspected = nombre total d'unités contrôlées ; pour les lots FLACONS, prends la ligne « Quantité totale de flacons conformes pour étiquetage » de la feuille FINALE et ADDITIONNE-lui le total des rejetés (contrôlées = conformes finales + tous les rejetés). Vérifie la cohérence : qty_rejected doit être égal à la somme des défauts de toutes les feuilles.
DÉFAUTS (defects) : un objet {type, count} par défaut réel. IMPORTANT — quand une ligne regroupe plusieurs sous-défauts entre parenthèses avec des quantités séparées par des « / » (ex. « Défaut capsule (Déformation / sertissage insuffisant / absence capsule / tâche sur capsule) » avec « 73/160/0/15 »), ÉCLATE-la en un défaut par sous-libellé dans le MÊME ordre : {type:"Capsule - déformation",count:73}, {type:"Capsule - sertissage insuffisant",count:160}, {type:"Capsule - tâche",count:15}. Idem pour bouchon, flacon (ligne d'air/rayure/casse), particules de couleurs (roses/bleus/rouges/jaunes), volume/flacons vides, etc. Utilise aussi les mentions manuscrites (ex. « Déformation flacon ») comme libellé. NE REPORTE PAS les défauts à quantité 0. Ne laisse JAMAIS le type vide ; si un nombre n'a pas de libellé lisible, mets type='Non précisé'. Si une valeur est absente ou illisible, mets null (ou [] pour defects). Ne DEVINE jamais un chiffre.
RÉFÉRENTIEL DES TYPES DE DÉFAUTS : rationalise CHAQUE défaut vers UN type de cette liste EXACTE (recopie le libellé à l'identique) — la formulation varie d'un dossier à l'autre mais le fond est le même (ex. « tache jaune », « particules jaunes », « fibres jaunes » → « Particules/fibres jaunes ») ; ADDITIONNE les quantités des libellés qui pointent vers le même type :
${dtypes.map(t => `- ${t}`).join('\n')}
Si un défaut ne correspond VRAIMENT à aucun type de la liste, garde le libellé lu tel quel (il sera signalé comme nouveau). Réponds par le JSON seul.`;
    // maxOutputTokens relevé à 8192 pour éviter que le JSON soit coupé sur les dossiers riches en défauts.
    const genOnce = (extraText: string) => geminiGenerateJson(key, model, [fileUri], prompt + extraText, { maxOutputTokens: 8192, logLabel: 'gemini mirage' });
    const defectsSum = (p: any) => Array.isArray(p?.defects) ? p.defects.reduce((s: number, d: any) => s + (Number(d?.count) || 0), 0) : 0;
    const coherent = (p: any) => p && p.qty_rejected != null && Array.isArray(p.defects) && p.defects.length > 0 && defectsSum(p) === Number(p.qty_rejected);

    // Garde-fou : la somme des défauts doit égaler les unités rejetées. Sinon → re-scan du dossier, puis avertissement si l'écart persiste.
    let parsed = await genOnce('');
    let warning: string | null = null;
    if (parsed && parsed.qty_rejected != null && !coherent(parsed)) {
      const retry = await genOnce(`\nCONTRÔLE DE COHÉRENCE : lors d'une première lecture, la somme des défauts (${defectsSum(parsed)}) ne correspondait pas aux unités rejetées (${parsed.qty_rejected}). RELIS attentivement TOUTES les feuilles de mirage du dossier (y compris les reprises/re-contrôles) et corrige : la somme des defects doit être ÉGALE à qty_rejected.`);
      if (retry) parsed = retry;
      if (!coherent(parsed)) {
        warning = `Attention : incohérence entre les unités rejetées (${parsed?.qty_rejected ?? '?'}) et le total des défauts répertoriés (${defectsSum(parsed)}), malgré une double lecture. Vérifiez le dossier de lot.`;
      }
    }
    geminiDeleteFile(key, fileName);
    if (!parsed) return res.status(422).json({ error: "L'IA n'a pas réussi à lire cette page. Vous pouvez saisir les valeurs manuellement." });
    // Rationalisation serveur : chaque défaut est ramené au référentiel (même clé = même type, quantités additionnées).
    const newTypes: string[] = [];
    if (Array.isArray(parsed.defects)) {
      const acc: { [k: string]: { type: string; count: number } } = {};
      for (const d of parsed.defects) {
        const k = mirageDefectKey(d?.type);
        if (!k) continue;
        const canonical = dtypes.find(t => mirageDefectKey(t) === k);
        const label = canonical || String(d.type).replace(/\s+/g, ' ').trim();
        if (!canonical && !newTypes.includes(label)) newTypes.push(label);
        if (!acc[k]) acc[k] = { type: label, count: 0 };
        acc[k].count += Number(d?.count) || 0;
      }
      parsed.defects = Object.values(acc);
    }
    // Croisement Track&Production : si le lot existe dans les lots suivis (batches), sa référence + son type font foi.
    try {
      const lot = String(parsed.lot || '').trim();
      if (lot) {
        const b = await pool.query('SELECT reference, product FROM batches WHERE UPPER(id)=UPPER($1) LIMIT 1', [lot]);
        if (b.rows[0]) {
          const ref = b.rows[0].reference || null;
          const entry = ref ? catalog.find((p: any) => String(p.ref).toUpperCase() === String(ref).toUpperCase()) : null;
          if (ref) parsed.product_code = ref;
          if (entry?.type) parsed.product_name = entry.type;
          else if (b.rows[0].product) parsed.product_name = b.rows[0].product;
        }
      }
      // Repli : faire correspondre le nom commercial lu au catalogue (type + référence internes).
      if (parsed.product_name && !catalog.some((p: any) => p.type === parsed.product_name)) {
        const up = String(parsed.product_name).toUpperCase();
        const entry = catalog.find((p: any) => up.includes(String(p.name).toUpperCase()) || String(p.name).toUpperCase().includes(up));
        if (entry) { parsed.product_code = parsed.product_code || entry.ref; parsed.product_name = entry.type; }
      }
    } catch { /* croisement best-effort, l'extraction reste utilisable */ }
    res.json({ extracted: parsed, warning, newTypes });
  } catch (e) { console.error('mirage extract', e); res.status(500).json({ error: 'Erreur serveur' }); }
});

app.get('/api/mirage/records', authenticateToken, requireView('mirage'), async (_req: AuthRequest, res: Response) => {
  try {
    const r = await pool.query(`SELECT id, product_code, product_name, lot, to_char(inspection_date,'YYYY-MM-DD') AS inspection_date, qty_inspected, qty_rejected, unit_type, defects, notes, pdf_filename, created_at FROM mirage_inspections ORDER BY inspection_date ASC NULLS LAST, created_at ASC`);
    res.json({ records: r.rows });
  } catch (e) { console.error('mirage list', e); res.status(500).json({ error: 'Erreur serveur' }); }
});

const sanitizeDefects = (d: any) => Array.isArray(d) ? d.filter((x: any) => x && x.type).map((x: any) => ({ type: String(x.type).replace(/\s+/g, ' ').trim().slice(0, 60), count: Number(x.count) || 0 })) : [];
const validDate = (s: any) => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)) ? s : null;

app.post('/api/mirage/records', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    const b = req.body || {};
    if (!b.lot) return res.status(400).json({ error: 'N° de lot requis' });
    const id = `mir-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const r = await pool.query(
      `INSERT INTO mirage_inspections (id, product_code, product_name, lot, inspection_date, qty_inspected, qty_rejected, unit_type, defects, notes, pdf_filename, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [id, b.product_code || null, b.product_name || null, String(b.lot).slice(0, 60), validDate(b.inspection_date), Number(b.qty_inspected) || 0, Number(b.qty_rejected) || 0, b.unit_type || null, JSON.stringify(sanitizeDefects(b.defects)), b.notes ? String(b.notes).slice(0, 1000) : null, b.pdf_filename || null, req.user?.username || null]
    );
    await logActivity(req, 'MIRAGE_CREATE', id, `Contrôle mirage ajouté (lot ${b.lot})`);
    broadcast('mirage:changed', {});
    res.status(201).json({ id: r.rows[0].id });
  } catch (e) { console.error('mirage create', e); res.status(500).json({ error: 'Erreur serveur' }); }
});

app.put('/api/mirage/records/:id', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    const b = req.body || {};
    const r = await pool.query(
      `UPDATE mirage_inspections SET product_code=$2, product_name=$3, lot=$4, inspection_date=$5, qty_inspected=$6, qty_rejected=$7, unit_type=$8, defects=$9, notes=$10, updated_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING id`,
      [req.params.id, b.product_code || null, b.product_name || null, String(b.lot || '').slice(0, 60), validDate(b.inspection_date), Number(b.qty_inspected) || 0, Number(b.qty_rejected) || 0, b.unit_type || null, JSON.stringify(sanitizeDefects(b.defects)), b.notes ? String(b.notes).slice(0, 1000) : null]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Introuvable' });
    await logActivity(req, 'MIRAGE_UPDATE', req.params.id, `Contrôle mirage modifié (lot ${b.lot})`);
    broadcast('mirage:changed', {});
    res.json({ id: r.rows[0].id });
  } catch (e) { console.error('mirage update', e); res.status(500).json({ error: 'Erreur serveur' }); }
});

app.delete('/api/mirage/records/:id', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    await pool.query('DELETE FROM mirage_inspections WHERE id=$1', [req.params.id]);
    await logActivity(req, 'MIRAGE_DELETE', req.params.id, 'Contrôle mirage supprimé');
    broadcast('mirage:changed', {});
    res.json({ ok: true });
  } catch (e) { console.error('mirage delete', e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// --- Plans d'action Mirage (proposés par l'IA, éditables, suivis) ---
const mapMirageAction = (r: any) => ({ id: r.id, defaut: r.defaut || '', action: r.action, responsable: r.responsable || '', priorite: r.priorite ?? 2, echeance: r.echeance ? String(r.echeance).slice(0, 10) : null, statut: r.statut || 'à faire', analyse: r.synthese || '', createdBy: r.created_by, createdAt: r.created_at });

app.get('/api/mirage/action-plans', authenticateToken, requireView('mirage'), async (_req: AuthRequest, res: Response) => {
  try {
    const r = await pool.query(`SELECT * FROM mirage_action_plans ORDER BY (statut='fait'), priorite, created_at DESC`);
    res.json({ plans: r.rows.map(mapMirageAction) });
  } catch (e) { console.error('mirage action-plans list', e); res.status(500).json({ error: 'Erreur serveur' }); }
});

app.post('/api/mirage/action-plans', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    const { defaut, action, responsable, priorite, echeance, statut, analyse } = req.body || {};
    if (!action || !String(action).trim()) return res.status(400).json({ error: 'Action requise' });
    const ech = (typeof echeance === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(echeance)) ? echeance : null;
    const r = await pool.query(
      `INSERT INTO mirage_action_plans (defaut, action, responsable, priorite, echeance, statut, synthese, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [String(defaut || ''), String(action).trim(), String(responsable || ''), Number(priorite) || 2, ech, String(statut || 'à faire'), String(analyse || ''), req.user?.username || null]
    );
    broadcast('mirage:changed', {});
    res.json(mapMirageAction(r.rows[0]));
  } catch (e) { console.error('mirage action-plans create', e); res.status(500).json({ error: 'Erreur serveur' }); }
});

app.patch('/api/mirage/action-plans/:id', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    const sets: string[] = []; const v: any[] = []; let i = 1;
    for (const [k, col] of [['defaut', 'defaut'], ['action', 'action'], ['responsable', 'responsable'], ['statut', 'statut']] as const) {
      if (req.body?.[k] !== undefined) { sets.push(`${col}=$${i++}`); v.push(String(req.body[k])); }
    }
    if (req.body?.priorite !== undefined) { sets.push(`priorite=$${i++}`); v.push(Number(req.body.priorite) || 2); }
    if (req.body?.echeance !== undefined) { sets.push(`echeance=$${i++}`); v.push((typeof req.body.echeance === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.echeance)) ? req.body.echeance : null); }
    if (!sets.length) return res.status(400).json({ error: 'Rien à modifier' });
    sets.push('updated_at=CURRENT_TIMESTAMP'); v.push(req.params.id);
    const r = await pool.query(`UPDATE mirage_action_plans SET ${sets.join(', ')} WHERE id=$${i} RETURNING *`, v);
    if (!r.rows[0]) return res.status(404).json({ error: 'Introuvable' });
    broadcast('mirage:changed', {});
    res.json(mapMirageAction(r.rows[0]));
  } catch (e) { console.error('mirage action-plans update', e); res.status(500).json({ error: 'Erreur serveur' }); }
});

app.delete('/api/mirage/action-plans/:id', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    await pool.query('DELETE FROM mirage_action_plans WHERE id=$1', [req.params.id]);
    broadcast('mirage:changed', {});
    res.json({ ok: true });
  } catch (e) { console.error('mirage action-plans delete', e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// Génère (sans enregistrer) une analyse + un plan d'action à partir des données Mirage filtrées + une compétence Maya.
app.post('/api/mirage/action-plan/generate', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    const key = process.env.DEEPSEEK_API_KEY;
    if (!key) return res.status(503).json({ error: "IA non configurée (clé DeepSeek manquante côté serveur)." });
    const base = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
    const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
    const contexte = String(req.body?.contexte || '').slice(0, 6000);
    let methode = '';
    if (req.body?.skillId) {
      const s = await pool.query('SELECT name, body FROM maya_skills WHERE id=$1 AND enabled=TRUE', [req.body.skillId]);
      if (s.rows[0]) methode = `\n\nMÉTHODE À SUIVRE (compétence "${s.rows[0].name}") :\n${s.rows[0].body}`;
    }
    const system = `Tu es un ingénieur qualité en dispositifs médicaux (ISO 13485). À partir UNIQUEMENT des données de contrôle visuel (Mirage) fournies, produis une analyse factuelle courte puis un plan d'action concret et actionnable. N'invente aucun chiffre ; si une donnée manque, signale-le.${methode}
Réponds STRICTEMENT en JSON, sans texte hors JSON : {"analyse":"synthèse en quelques phrases","actions":[{"defaut":"type de défaut concerné ou 'général'","action":"action corrective/préventive concrète et mesurable","responsable":"rôle suggéré (ex. Resp. Qualité)","priorite":1}]}. priorite : 1=haute, 2=moyenne, 3=basse. 3 à 6 actions. En français.`;
    const user = `DONNÉES MIRAGE (périmètre filtré) :\n${contexte || '(aucune donnée transmise)'}`;
    const r = await fetch(`${base}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, temperature: 0.3, stream: false, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    });
    if (!r.ok) { console.error('mirage plan gen', r.status, await r.text().catch(() => '')); return res.status(502).json({ error: 'IA indisponible.' }); }
    const d: any = await r.json();
    let parsed: any = null;
    try { parsed = JSON.parse(d.choices?.[0]?.message?.content || ''); } catch { /* invalide */ }
    if (!parsed || !Array.isArray(parsed.actions)) return res.status(502).json({ error: 'Réponse IA invalide, réessaie.' });
    res.json({ analyse: String(parsed.analyse || ''), actions: parsed.actions.slice(0, 12) });
  } catch (e) { console.error('mirage plan generate', e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// ===================== Suivi de rendement de production (depuis un DDL) =====================
// Extraction IA d'un dossier de lot rempli : quantités + dates par étape (répartition → mirage → étiquetage → mise en boîte).
app.post('/api/rendement/extract', authenticateToken, requireView('quality'), async (req: AuthRequest, res: Response) => {
  try {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return res.status(503).json({ error: "Lecture IA non configurée (clé GEMINI_API_KEY manquante). Saisie manuelle possible." });
    // Accepte 1 à 3 fichiers (un même lot peut être réparti sur plusieurs dossiers de lot). Base64 dans { files: [...] }.
    const filesIn: any[] = Array.isArray(req.body?.files) ? req.body.files.slice(0, 3) : [];
    if (!filesIn.length) return res.status(400).json({ error: 'Aucun fichier' });
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    // Téléverse chaque PDF vers la Files API et récupère son file_uri (lecture consolidée dans une seule requête).
    const uploadOne = async (b64: string): Promise<string | null> => {
      const buf = Buffer.from(String(b64 || '').split(',').pop() || '', 'base64');
      if (!buf.length) return null;
      const up = await geminiUploadPdf(key, buf, 'ddl', 20);
      return up.ok ? up.fileUri : null;
    };
    const uris = (await Promise.all(filesIn.map((f: any) => uploadOne(f?.data ?? f)))).filter(Boolean) as string[];
    if (!uris.length) return res.status(502).json({ error: "Lecture IA indisponible (envoi des PDF)." });

    const prompt = `Tu analyses UN OU PLUSIEURS DOSSIERS DE LOT (DDL) d'un MÊME lot (produit injectable en SERINGUES ou FLACONS, souvent scanné/manuscrit). Les données d'une étape peuvent être réparties sur plusieurs documents : CONSOLIDE le tout en UN SEUL jeu de données (prends la valeur trouvée quel que soit le document ; si une donnée n'est présente que dans un document, utilise-la ; si un total est réparti en plusieurs charges/documents, ADDITIONNE). Extrais les données de production, en JSON strict, sans texte autour :
{
 "product_code": string|null, "product_name": string|null, "lot": string|null,
 "unit_type": "seringue"|"flacon"|null, "units_per_box": number|null,
 "date_repartition": "AAAA-MM-JJ"|null, "qty_a_mirer": number|null,
 "date_mirage": "AAAA-MM-JJ"|null, "qty_rejetees": number|null,
 "date_etiquetage": "AAAA-MM-JJ"|null, "qty_etiquete": number|null,
 "date_miseenboite": "AAAA-MM-JJ"|null, "nb_boites": number|null, "nb_cartons": number|null,
 "masse_gel_g": number|null, "vol_moyen_ml": number|null, "masse_moyenne_g": number|null,
 "notes": string|null
}
Ou trouver chaque information :
- qty_a_mirer = nombre de seringues/flacons A MIRER a l'issue de la REPARTITION (remplissage). Si le DDL ne donne pas un total direct, ADDITIONNE les CHARGES DE STERILISATION (chaque charge/cycle d'autoclave) pour obtenir ce total reparti.
- qty_rejetees = nombre de seringues/flacons REJETES au controle visuel (mirage). Les mires conformes = a mirer moins rejetees.
- units_per_box = nombre d'unites par boite si le DDL l'indique (ex. "1 boite = 2 seringues" -> 2). Sinon null.
- date_mirage = date du controle visuel (mirage).
- qty_etiquete = nombre d'unites ETIQUETEES : cherche dans la section CONDITIONNEMENT SECONDAIRE, au niveau du detail de l'etiquetage.
- nb_boites = nombre de BOITES realisees (conditionnement secondaire / mise en boite). nb_cartons = nombre de cartons prepares si indique.
- masse_gel_g = masse de gel mise a disposition pour le remplissage (grammes). vol_moyen_ml = volume moyen de remplissage par unite (ml). masse_moyenne_g = masse moyenne de gel par unite remplie (grammes) si une pesee moyenne est indiquee.
Regles : ne DEVINE jamais un chiffre ; valeur absente ou illisible = null. Dates au format AAAA-MM-JJ. Reponds par le JSON seul.`;

    const parsed = await geminiGenerateJson(key, model, uris, prompt, { maxOutputTokens: 4096, logLabel: 'rendement gemini' });
    if (!parsed) return res.status(422).json({ error: "L'IA n'a pas réussi à lire ce(s) DDL. Vous pouvez saisir les valeurs manuellement." });

    // Application des règles métier pour dériver les 4 quantités de la chaîne.
    const rn = (v: any) => (v == null || v === '' || isNaN(Number(v))) ? null : Number(v);
    const aMirer = rn(parsed.qty_a_mirer);
    const rejetees = rn(parsed.qty_rejetees);
    const nbBoites = rn(parsed.nb_boites);
    const nbCartons = rn(parsed.nb_cartons);
    const upb = rn(parsed.units_per_box) || (parsed.unit_type === 'flacon' ? 3 : 2);   // 2 seringues / 3 flacons par boîte
    const out: any = {
      product_code: parsed.product_code || null, product_name: parsed.product_name || null, lot: parsed.lot || null,
      unit_type: parsed.unit_type || null,
      date_repartition: parsed.date_repartition || null, qty_reparti: aMirer,
      date_mirage: parsed.date_mirage || null, qty_mire_conforme: aMirer != null ? Math.max(0, aMirer - (rejetees || 0)) : null,
      date_etiquetage: parsed.date_etiquetage || null, qty_etiquete: rn(parsed.qty_etiquete),
      date_miseenboite: parsed.date_miseenboite || null, qty_miseenboite: nbBoites != null ? nbBoites * upb : null,
      masse_gel_g: rn(parsed.masse_gel_g), vol_moyen_ml: rn(parsed.vol_moyen_ml), masse_moyenne_g: rn(parsed.masse_moyenne_g),
      notes: [parsed.notes, `Détail extraction — à mirer : ${aMirer ?? '?'} · rejetées : ${rejetees ?? '?'} · boîtes : ${nbBoites ?? '?'} × ${upb}/boîte${nbCartons != null ? ` · cartons : ${nbCartons}` : ''}`].filter(Boolean).join(' | '),
    };
    try {
      const lot = String(out.lot || '').trim();
      if (lot) { const bq = await pool.query('SELECT reference, product FROM batches WHERE UPPER(id)=UPPER($1) LIMIT 1', [lot]); if (bq.rows[0]) { if (bq.rows[0].reference) out.product_code = bq.rows[0].reference; if (bq.rows[0].product) out.product_name = out.product_name || bq.rows[0].product; } }
    } catch { /* croisement best-effort */ }
    res.json({ extracted: out });
  } catch (e) { console.error('rendement extract', e); res.status(500).json({ error: 'Erreur serveur' }); }
});

app.get('/api/rendement/records', authenticateToken, requireView('quality'), async (_req: AuthRequest, res: Response) => {
  try {
    const r = await pool.query(`SELECT id, product_code, product_name, lot, unit_type,
      to_char(date_repartition,'YYYY-MM-DD') AS date_repartition, to_char(date_mirage,'YYYY-MM-DD') AS date_mirage,
      to_char(date_etiquetage,'YYYY-MM-DD') AS date_etiquetage, to_char(date_miseenboite,'YYYY-MM-DD') AS date_miseenboite,
      qty_reparti, qty_mire_conforme, qty_etiquete, qty_miseenboite, cuve_initiale_l, masse_gel_g, vol_moyen_ml, masse_moyenne_g, notes, pdf_filename, created_at
      FROM rendement_ddl ORDER BY date_repartition ASC NULLS LAST, created_at ASC`);
    res.json({ records: r.rows });
  } catch (e) { console.error('rendement records', e); res.status(500).json({ error: 'Erreur serveur' }); }
});

const rendNz = (v: any) => (v === '' || v == null || isNaN(Number(v))) ? null : Number(v);
const rendDz = (v: any) => v ? String(v) : null;
app.post('/api/rendement/records', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    const b = req.body || {};
    if (!b.lot) return res.status(400).json({ error: 'Numéro de lot requis' });
    const id = 'REND-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    await pool.query(
      `INSERT INTO rendement_ddl (id, product_code, product_name, lot, unit_type, date_repartition, date_mirage, date_etiquetage, date_miseenboite, qty_reparti, qty_mire_conforme, qty_etiquete, qty_miseenboite, cuve_initiale_l, masse_gel_g, vol_moyen_ml, masse_moyenne_g, notes, pdf_filename, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
      [id, b.product_code || null, b.product_name || null, b.lot, b.unit_type || null, rendDz(b.date_repartition), rendDz(b.date_mirage), rendDz(b.date_etiquetage), rendDz(b.date_miseenboite), rendNz(b.qty_reparti), rendNz(b.qty_mire_conforme), rendNz(b.qty_etiquete), rendNz(b.qty_miseenboite), rendNz(b.cuve_initiale_l), rendNz(b.masse_gel_g), rendNz(b.vol_moyen_ml), rendNz(b.masse_moyenne_g), b.notes || null, b.pdf_filename || null, req.user?.username || null]
    );
    broadcast('rendement:changed', {});
    res.json({ id });
  } catch (e) { console.error('rendement create', e); res.status(500).json({ error: 'Erreur serveur' }); }
});
app.put('/api/rendement/records/:id', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    const b = req.body || {};
    const r = await pool.query(
      `UPDATE rendement_ddl SET product_code=$2, product_name=$3, lot=$4, unit_type=$5, date_repartition=$6, date_mirage=$7, date_etiquetage=$8, date_miseenboite=$9, qty_reparti=$10, qty_mire_conforme=$11, qty_etiquete=$12, qty_miseenboite=$13, cuve_initiale_l=$14, masse_gel_g=$15, vol_moyen_ml=$16, masse_moyenne_g=$17, notes=$18, updated_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING id`,
      [req.params.id, b.product_code || null, b.product_name || null, b.lot, b.unit_type || null, rendDz(b.date_repartition), rendDz(b.date_mirage), rendDz(b.date_etiquetage), rendDz(b.date_miseenboite), rendNz(b.qty_reparti), rendNz(b.qty_mire_conforme), rendNz(b.qty_etiquete), rendNz(b.qty_miseenboite), rendNz(b.cuve_initiale_l), rendNz(b.masse_gel_g), rendNz(b.vol_moyen_ml), rendNz(b.masse_moyenne_g), b.notes || null]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Introuvable' });
    broadcast('rendement:changed', {});
    res.json({ id: req.params.id });
  } catch (e) { console.error('rendement update', e); res.status(500).json({ error: 'Erreur serveur' }); }
});
app.delete('/api/rendement/records/:id', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try { await pool.query('DELETE FROM rendement_ddl WHERE id=$1', [req.params.id]); broadcast('rendement:changed', {}); res.json({ ok: true }); }
  catch (e) { console.error('rendement delete', e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// ===================== Connecteur Odoo (ERP, lecture seule) =====================
let odooUid: number | null = null;
let odooCompanies: { id: number; name: string }[] | null = null;

async function odooRpc(service: string, method: string, args: any[]): Promise<any> {
  const url = process.env.ODOO_URL;
  const r = await fetch(`${url}/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { service, method, args } }),
  });
  const d: any = await r.json();
  if (d.error) throw new Error(JSON.stringify(d.error).slice(0, 300));
  return d.result;
}
async function odooAuth(): Promise<number> {
  if (odooUid) return odooUid;
  odooUid = await odooRpc('common', 'authenticate', [process.env.ODOO_DB, process.env.ODOO_USER, process.env.ODOO_API_KEY, {}]);
  if (!odooUid) throw new Error('Auth Odoo échouée');
  return odooUid;
}
async function odooKw(model: string, method: string, args: any[], kwargs: any = {}): Promise<any> {
  const uid = await odooAuth();
  return odooRpc('object', 'execute_kw', [process.env.ODOO_DB, uid, process.env.ODOO_API_KEY, model, method, args, kwargs]);
}
async function odooCompanyId(which: string): Promise<number | null> {
  if (!odooCompanies) odooCompanies = await odooKw('res.company', 'search_read', [[]], { fields: ['id', 'name'] });
  const needle = which.toLowerCase().includes('regen') ? 'REGENERATIVE' : 'AESTHETICS';
  return (odooCompanies || []).find(c => c.name.toUpperCase().includes(needle))?.id ?? null;
}
// Contexte société pour les lectures Maya : société précise si demandée, sinon toutes (cross-company).
async function odooReadCtx(company?: string): Promise<any> {
  if (company) { const cid = await odooCompanyId(company); return cid ? { allowed_company_ids: [cid], company_id: cid } : {}; }
  if (!odooCompanies) await odooCompanyId('aesthetics'); // peuple le cache des sociétés
  const ids = (odooCompanies || []).map(c => c.id);
  return ids.length ? { allowed_company_ids: ids } : {};
}
let odooAesPartnerId: number | null = null;
async function odooAesPartner(): Promise<number | null> {
  if (odooAesPartnerId) return odooAesPartnerId;
  const cid = await odooCompanyId('aesthetics');
  if (!cid) return null;
  const c = await odooKw('res.company', 'read', [[cid]], { fields: ['partner_id'] });
  odooAesPartnerId = c && c[0] && Array.isArray(c[0].partner_id) ? c[0].partner_id[0] : null;
  return odooAesPartnerId;
}

// Recherche de stock par réf interne ou nom (contexte société, stock temps réel)
app.get('/api/odoo/stock', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!process.env.ODOO_API_KEY) return res.status(503).json({ error: 'Odoo non configuré côté serveur.' });
    const q = String(req.query.q || '').trim();
    const cid = await odooCompanyId(String(req.query.company || 'aesthetics'));
    const domain: any[] = q ? ['|', ['default_code', 'ilike', q], ['name', 'ilike', q]] : [['default_code', '!=', false]];
    const rows = await odooKw('product.product', 'search_read', [domain], {
      fields: ['default_code', 'name', 'qty_available', 'free_qty', 'uom_id'],
      limit: q ? 80 : 50,
      order: 'default_code',
      context: cid ? { allowed_company_ids: [cid], company_id: cid } : {},
    });
    res.json(rows.map((r: any) => {
      const physique = r.qty_available || 0;
      const restant = r.free_qty || 0; // dispo non réservé = physique - réservé
      return { ref: r.default_code || '', name: r.name, physique, reserve: physique - restant, restant, uom: Array.isArray(r.uom_id) ? r.uom_id[1] : '' };
    }));
  } catch (e: any) { console.error('odoo stock', e); res.status(502).json({ error: 'Odoo indisponible.' }); }
});

// Historique complet des lots Odoo (MP/AC…) avec date d'expiration — recherche par n° de lot, référence interne ou désignation.
// Inclut les lots consommés (quantité restante = 0) : stock.lot conserve tous les lots créés depuis toujours.
app.get('/api/odoo/lot-expirations', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!process.env.ODOO_API_KEY) return res.status(503).json({ error: 'Odoo non configuré côté serveur.' });
    const q = String(req.query.q || '').trim();
    const type = String(req.query.type || 'all');
    const domain: any[] = [];
    if (type === 'MP') domain.push(['product_id.default_code', '=ilike', 'MP-%']);
    else if (type === 'AC') domain.push('|', ['product_id.default_code', '=ilike', 'AC-%'], ['product_id.default_code', '=ilike', 'PAC-%']);
    if (q) domain.push('|', '|', ['name', 'ilike', q], ['product_id.default_code', 'ilike', q], ['product_id.name', 'ilike', q]);
    const rows = await odooKw('stock.lot', 'search_read', [domain], {
      fields: ['name', 'product_id', 'expiration_date', 'create_date', 'product_qty'],
      limit: 500,
      order: 'expiration_date asc, create_date desc',
    });
    res.json({ lots: (rows || []).map((r: any) => {
      const disp = Array.isArray(r.product_id) ? r.product_id[1] : '';
      const s = splitRef(disp);
      return {
        lot: r.name,
        ref: s.code,
        name: s.name,
        expiration: r.expiration_date ? String(r.expiration_date).slice(0, 10) : null,
        created: r.create_date ? String(r.create_date).slice(0, 10) : null,
        qty: r.product_qty ?? 0,
      };
    }) });
  } catch (e: any) { console.error('odoo lot-expirations', e); res.status(502).json({ error: 'Odoo indisponible.' }); }
});

// Commandes fournisseurs en cours de réception (achats confirmés, pas encore totalement reçus).
// Périmètre : UNIQUEMENT les bons d'achat de Louna Aesthetics (pas Louna Regenerative).
// Le pilotage se fait sur date_planned (relance fournisseur). Lien direct : {ODOO_URL}/odoo/purchase/{id}.
app.get('/api/odoo/purchase-orders', authenticateToken, async (_req: AuthRequest, res: Response) => {
  try {
    if (!process.env.ODOO_API_KEY) return res.status(503).json({ error: 'Odoo non configuré côté serveur.' });
    const cid = await odooCompanyId('aesthetics');
    const domain: any[] = [['state', '=', 'purchase'], ['receipt_status', 'in', ['pending', 'partial']]];
    if (cid) domain.push(['company_id', '=', cid]);
    const rows = await odooKw('purchase.order', 'search_read',
      [domain],
      {
        fields: ['name', 'partner_id', 'date_order', 'date_planned', 'amount_total', 'receipt_status'],
        limit: 300,
        order: 'date_planned asc',
      });
    // Articles commandés : toutes les lignes des BC en une seule requête, regroupées par commande.
    const ids = (rows || []).map((r: any) => r.id);
    const itemsByOrder: { [id: number]: string[] } = {};
    if (ids.length) {
      const lines = await odooKw('purchase.order.line', 'search_read', [[['order_id', 'in', ids]]], {
        fields: ['order_id', 'product_id', 'product_qty'],
        limit: 2000,
      });
      for (const l of lines || []) {
        const oid = Array.isArray(l.order_id) ? l.order_id[0] : null;
        if (!oid) continue;
        const pname = Array.isArray(l.product_id) ? l.product_id[1] : '';
        if (!pname) continue;
        (itemsByOrder[oid] = itemsByOrder[oid] || []).push(`${l.product_qty ? Number(l.product_qty).toLocaleString('fr-FR') + '× ' : ''}${pname}`);
      }
    }
    res.json({
      base: process.env.ODOO_URL || '',
      orders: (rows || []).map((r: any) => ({
        id: r.id,
        name: r.name,
        partner: Array.isArray(r.partner_id) ? r.partner_id[1] : '',
        items: itemsByOrder[r.id] || [],
        dateOrder: r.date_order ? String(r.date_order).slice(0, 10) : null,
        datePlanned: r.date_planned ? String(r.date_planned).slice(0, 10) : null,
        amount: r.amount_total || 0,
        receipt: r.receipt_status || 'pending',
      })),
    });
  } catch (e: any) { console.error('odoo purchase-orders', e); res.status(502).json({ error: 'Odoo indisponible.' }); }
});

// Total des factures clients postées depuis une date, pour une société
app.get('/api/odoo/invoices', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!process.env.ODOO_API_KEY) return res.status(503).json({ error: 'Odoo non configuré côté serveur.' });
    const since = req.query.since ? String(req.query.since) : null;
    const until = req.query.until ? String(req.query.until) : null;
    const cid = await odooCompanyId(String(req.query.company || 'regenerative'));
    const domain: any[] = [['move_type', '=', 'out_invoice'], ['state', '=', 'posted']];
    if (since) domain.push(['invoice_date', '>=', since]);
    if (until) domain.push(['invoice_date', '<', until]);
    if (cid) domain.push(['company_id', '=', cid]);
    const customer = String(req.query.customer || '');
    if (customer === 'aesthetics' || customer === 'others') {
      const aesP = await odooAesPartner();
      if (aesP) domain.push(['commercial_partner_id', customer === 'aesthetics' ? '=' : '!=', aesP]);
    }
    const grp = await odooKw('account.move', 'read_group', [domain, ['amount_total:sum', 'amount_untaxed:sum'], []], {});
    const g = grp && grp[0] || {};
    res.json({ totalTTC: g.amount_total || 0, totalHT: g.amount_untaxed || 0, count: g.__count || 0, since, until, companyId: cid });
  } catch (e: any) { console.error('odoo invoices', e); res.status(502).json({ error: 'Odoo indisponible.' }); }
});

// Détail des factures clients d'une société
app.get('/api/odoo/invoices-list', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!process.env.ODOO_API_KEY) return res.status(503).json({ error: 'Odoo non configuré côté serveur.' });
    const cid = await odooCompanyId(String(req.query.company || 'aesthetics'));
    const domain: any[] = [['move_type', '=', 'out_invoice'], ['state', '=', 'posted']];
    if (cid) domain.push(['company_id', '=', cid]);
    if (req.query.since) domain.push(['invoice_date', '>=', String(req.query.since)]);
    const customer = String(req.query.customer || '');
    if (customer === 'aesthetics' || customer === 'others') {
      const aesP = await odooAesPartner();
      if (aesP) domain.push(['commercial_partner_id', customer === 'aesthetics' ? '=' : '!=', aesP]);
    }
    const rows = await odooKw('account.move', 'search_read', [domain], {
      fields: ['name', 'invoice_date', 'partner_id', 'amount_total', 'amount_untaxed', 'invoice_line_ids'],
      limit: 150, order: 'invoice_date desc',
    });

    // Lot(s) par facture : facture → ligne → commande de vente → mouvement de stock → lot.
    // Le lot n'existe pas comme champ direct sur la facture Odoo ; on remonte la chaîne en 3 appels groupés.
    const lotsByInvoice: Record<number, Set<string>> = {};
    const allLineIds = [...new Set(rows.flatMap((r: any) => r.invoice_line_ids || []))];
    if (allLineIds.length) {
      const lines = await odooKw('account.move.line', 'read', [allLineIds], { fields: ['sale_line_ids'] });
      const lineToInvoice: Record<number, number> = {};
      for (const r of rows) for (const lid of (r.invoice_line_ids || [])) lineToInvoice[lid] = r.id;
      const allSaleLineIds = [...new Set(lines.flatMap((l: any) => l.sale_line_ids || []))];
      const saleToMoves: Record<number, number[]> = {};
      const moveToLots: Record<number, string[]> = {};
      if (allSaleLineIds.length) {
        const sls = await odooKw('sale.order.line', 'read', [allSaleLineIds], { fields: ['move_ids'] });
        for (const s of sls) saleToMoves[s.id] = s.move_ids || [];
        const allMoveIds = [...new Set(sls.flatMap((s: any) => s.move_ids || []))];
        if (allMoveIds.length) {
          const sml = await odooKw('stock.move.line', 'search_read', [[['move_id', 'in', allMoveIds], ['lot_id', '!=', false]]], { fields: ['move_id', 'lot_id'] });
          for (const ml of sml) {
            const mid = Array.isArray(ml.move_id) ? ml.move_id[0] : ml.move_id;
            const lot = Array.isArray(ml.lot_id) ? ml.lot_id[1] : null;
            if (lot) (moveToLots[mid] ||= []).push(lot);
          }
        }
      }
      for (const l of lines) {
        const invId = lineToInvoice[l.id];
        if (invId == null) continue;
        for (const slid of (l.sale_line_ids || []))
          for (const mid of (saleToMoves[slid] || []))
            for (const lot of (moveToLots[mid] || []))
              (lotsByInvoice[invId] ||= new Set()).add(lot);
      }
    }

    res.json(rows.map((r: any) => ({ name: r.name, date: r.invoice_date, partner: Array.isArray(r.partner_id) ? r.partner_id[1] : '', ttc: r.amount_total, ht: r.amount_untaxed, lots: lotsByInvoice[r.id] ? [...lotsByInvoice[r.id]] : [] })));
  } catch (e: any) { console.error('odoo invoices-list', e); res.status(502).json({ error: 'Odoo indisponible.' }); }
});

// --- Nomenclatures (BOM) : "[MP-010] Hyaluronate…" -> { code: "MP-010", name: "Hyaluronate…" }
function splitRef(disp: string) {
  const m = /^\s*\[([^\]]+)\]\s*(.*)$/.exec(disp || '');
  return m ? { code: m[1], name: m[2].trim() } : { code: null as string | null, name: (disp || '').trim() };
}

// Produits finis vendus qui ont une nomenclature (on part de mrp.bom → templates ; sale_ok + default_code)
app.get('/api/odoo/bom-products', authenticateToken, requireView('cockpit'), async (_req: AuthRequest, res: Response) => {
  try {
    if (!process.env.ODOO_API_KEY) return res.status(503).json({ error: 'Odoo non configuré côté serveur.' });
    const boms = await odooKw('mrp.bom', 'search_read', [[]], { fields: ['product_tmpl_id'], limit: 500 });
    const tmplIds = [...new Set((boms || []).map((b: any) => Array.isArray(b.product_tmpl_id) ? b.product_tmpl_id[0] : null).filter((id: any) => id))];
    if (!tmplIds.length) return res.json({ products: [] });
    const tmpls = await odooKw('product.template', 'read', [tmplIds], { fields: ['default_code', 'name', 'sale_ok'] });
    const products = (tmpls || [])
      .filter((t: any) => t.sale_ok === true && t.default_code)
      .map((t: any) => ({ tmplId: t.id, code: t.default_code, name: t.name }))
      .sort((a: any, b: any) => String(a.code).localeCompare(String(b.code)));
    res.json({ products });
  } catch (e: any) { console.error('odoo bom-products', e); res.status(502).json({ error: 'Odoo indisponible.' }); }
});

// Arbre des nomenclatures d'un template (récursion via child_bom_id — champ calculé : LU, jamais filtré en domaine)
app.get('/api/odoo/bom-tree', authenticateToken, requireView('cockpit'), async (req: AuthRequest, res: Response) => {
  try {
    if (!process.env.ODOO_API_KEY) return res.status(503).json({ error: 'Odoo non configuré côté serveur.' });
    const tmpl = Number(req.query.tmpl);
    if (!tmpl) return res.status(400).json({ error: 'Paramètre tmpl manquant.' });

    async function expandBom(bomId: number, seen: Set<number>, depth: number): Promise<any> {
      if (depth > 4 || seen.has(bomId)) return null;
      seen.add(bomId);
      const [h] = await odooKw('mrp.bom', 'read', [[bomId]], { fields: ['id', 'code', 'product_qty', 'product_uom_id', 'type'] });
      const lines = await odooKw('mrp.bom.line', 'search_read', [[['bom_id', '=', bomId]]], { fields: ['product_id', 'product_qty', 'product_uom_id', 'child_bom_id', 'sequence'] });
      const out: any[] = [];
      for (const l of lines || []) {
        const ref = splitRef(Array.isArray(l.product_id) ? l.product_id[1] : '');
        const childId = Array.isArray(l.child_bom_id) ? l.child_bom_id[0] : null;
        out.push({
          code: ref.code, name: ref.name,
          qty: l.product_qty, uom: Array.isArray(l.product_uom_id) ? l.product_uom_id[1] : '',
          seq: l.sequence,
          child: childId ? await expandBom(childId, seen, depth + 1) : null,
        });
      }
      out.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
      return { id: h.id, code: h.code || '', productQty: h.product_qty, uom: Array.isArray(h.product_uom_id) ? h.product_uom_id[1] : '', lines: out };
    }

    const heads = await odooKw('mrp.bom', 'search_read', [[['product_tmpl_id', '=', tmpl]]], { fields: ['id', 'code', 'product_qty', 'product_uom_id', 'product_tmpl_id', 'type'] });
    const boms: any[] = [];
    for (const head of heads || []) {
      const tree = await expandBom(head.id, new Set<number>(), 0);
      if (tree) boms.push(tree);
    }
    boms.sort((a, b) => String(a.uom).localeCompare(String(b.uom)) || String(a.code).localeCompare(String(b.code)));
    const [t] = await odooKw('product.template', 'read', [[tmpl]], { fields: ['default_code', 'name'] });
    res.json({ product: { tmplId: tmpl, code: t?.default_code || '', name: t?.name || '' }, boms });
  } catch (e: any) { console.error('odoo bom-tree', e); res.status(502).json({ error: 'Odoo indisponible.' }); }
});

// Prix unitaires (standard_price) des MP/AC par code interne, pour le COGS Filler.
app.get('/api/cogs-filler/prices', authenticateToken, requireView('cockpit'), async (req: AuthRequest, res: Response) => {
  try {
    const codes = String(req.query.codes || '').split(',').map(c => c.trim()).filter(Boolean);
    if (!codes.length) return res.json({ prices: {} });
    const rows = await odooKw('product.product', 'search_read', [[['default_code', 'in', codes]]], { fields: ['default_code', 'standard_price'] });
    const prices: Record<string, number> = {};
    for (const r of rows || []) if (r.default_code != null) prices[r.default_code] = Number(r.standard_price) || 0;
    res.json({ prices });
  } catch (e: any) { console.error('cogs-filler prices', e); res.status(502).json({ error: 'Odoo indisponible.' }); }
});

// ===================== Module CoA Tracking (matières premières) =====================
// "À vérifier" effectif = case manuelle OU (loss drying applicable et > seuil du matériau).
function coaEffectiveVerif(r: any): boolean {
  const auto = r.loss_drying_applicable && r.seuil_loss_drying != null && r.loss_drying != null && r.loss_drying > r.seuil_loss_drying;
  return !!r.a_verifier || !!auto;
}
const mapMateriau = (r: any) => ({ id: r.id, code: r.code, libelle: r.libelle, seuilLossDrying: r.seuil_loss_drying, lossDryingApplicable: r.loss_drying_applicable });
const mapReference = (r: any) => ({ id: r.id, materiauId: r.materiau_id, fournisseur: r.fournisseur, refInterne: r.ref_interne, refClient: r.ref_client });
// Normalise une colonne DATE en 'AAAA-MM-JJ' (sinon pg renvoie un datetime ISO que <input type="date"> rejette).
const isoDay = (v: any) => v == null ? null : String(v).slice(0, 10);
const mapLot = (r: any) => ({
  id: r.id, materiauId: r.materiau_id, materiauCode: r.materiau_code || null, materiauLibelle: r.materiau_libelle || null,
  numeroLot: r.numero_lot, fournisseur: r.fournisseur, referenceInterne: r.reference_interne, referenceClient: r.reference_client,
  numeroCommande: r.numero_commande, dateCommande: isoDay(r.date_commande), dateReception: isoDay(r.date_reception), datePeremption: isoDay(r.date_peremption),
  quantiteG: r.quantite_g, quantiteUnite: r.quantite_unite || 'g', lossDrying: r.loss_drying, seuilLossDrying: r.seuil_loss_drying ?? null,
  aVerifierManuel: !!r.a_verifier, aVerifier: coaEffectiveVerif(r),
  coaFichier: r.coa_fichier, coaLien: r.coa_lien, hasCoaDoc: !!r.has_doc, hasCoa: !!r.has_doc || !!(r.coa_lien && String(r.coa_lien).trim()),
  commentaire: r.commentaire, uploadedBy: r.uploaded_by, createdAt: r.created_at, updatedAt: r.updated_at,
});

// --- Lecture groupée (matériaux + références + lots) pour le frontend ---
app.get('/api/coa/data', authenticateToken, requireView('coa'), async (_req: AuthRequest, res: Response) => {
  try {
    const [mat, ref, lots] = await Promise.all([
      pool.query('SELECT * FROM coa_materiau ORDER BY code'),
      pool.query('SELECT * FROM coa_reference_produit ORDER BY id'),
      pool.query(`SELECT l.*, m.code AS materiau_code, m.libelle AS materiau_libelle, m.seuil_loss_drying, m.loss_drying_applicable,
                    (d.id IS NOT NULL) AS has_doc
                  FROM coa_lot_mp l
                  LEFT JOIN coa_materiau m ON m.id = l.materiau_id
                  LEFT JOIN coa_document d ON d.lot_id = l.id
                  ORDER BY l.date_reception DESC NULLS LAST, l.id DESC`),
    ]);
    res.json({ materiaux: mat.rows.map(mapMateriau), references: ref.rows.map(mapReference), lots: lots.rows.map(mapLot) });
  } catch (e) { console.error('coa data', e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// --- Matériaux ---
app.post('/api/coa/materiaux', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    const { code, libelle, seuilLossDrying, lossDryingApplicable } = req.body;
    if (!code || !libelle) return res.status(400).json({ error: 'Code et libellé requis' });
    const r = await pool.query(
      'INSERT INTO coa_materiau (code, libelle, seuil_loss_drying, loss_drying_applicable) VALUES ($1, $2, $3, $4) RETURNING *',
      [code, libelle, seuilLossDrying ?? null, lossDryingApplicable !== false]
    );
    await logActivity(req, 'COA_MATERIAU_CREATE', r.rows[0].id, `A créé le matériau CoA ${code}`);
    broadcast('coa:changed', {});
    res.status(201).json(mapMateriau(r.rows[0]));
  } catch (e: any) {
    if (e?.code === '23505') return res.status(409).json({ error: 'Ce code matériau existe déjà.' });
    console.error(e); res.status(500).json({ error: 'Erreur serveur' });
  }
});
app.patch('/api/coa/materiaux/:id', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    const map: Record<string, string> = { code: 'code', libelle: 'libelle', seuilLossDrying: 'seuil_loss_drying', lossDryingApplicable: 'loss_drying_applicable' };
    const fields: string[] = []; const values: any[] = []; let i = 1;
    for (const k of Object.keys(map)) if (req.body[k] !== undefined) { fields.push(`${map[k]} = $${i++}`); values.push(req.body[k]); }
    if (!fields.length) return res.status(400).json({ error: 'Rien à modifier' });
    fields.push('updated_at = CURRENT_TIMESTAMP'); values.push(req.params.id);
    const r = await pool.query(`UPDATE coa_materiau SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, values);
    if (!r.rows[0]) return res.status(404).json({ error: 'Matériau introuvable' });
    broadcast('coa:changed', {});
    res.json(mapMateriau(r.rows[0]));
  } catch (e: any) {
    if (e?.code === '23505') return res.status(409).json({ error: 'Ce code matériau existe déjà.' });
    console.error(e); res.status(500).json({ error: 'Erreur serveur' });
  }
});
app.delete('/api/coa/materiaux/:id', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try { await pool.query('DELETE FROM coa_materiau WHERE id = $1', [req.params.id]); await logActivity(req, 'COA_MATERIAU_DELETE', req.params.id, `A supprimé un matériau CoA`); broadcast('coa:changed', {}); res.json({ success: true }); }
  catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// --- Références produit (matériau × fournisseur) ---
app.post('/api/coa/references', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    const { materiauId, fournisseur, refInterne, refClient } = req.body;
    if (!materiauId || !fournisseur) return res.status(400).json({ error: 'Matériau et fournisseur requis' });
    const r = await pool.query(
      'INSERT INTO coa_reference_produit (materiau_id, fournisseur, ref_interne, ref_client) VALUES ($1, $2, $3, $4) RETURNING *',
      [materiauId, fournisseur, refInterne || null, refClient || null]
    );
    broadcast('coa:changed', {});
    res.status(201).json(mapReference(r.rows[0]));
  } catch (e: any) {
    if (e?.code === '23505') return res.status(409).json({ error: 'Cette référence (matériau + fournisseur) existe déjà.' });
    console.error(e); res.status(500).json({ error: 'Erreur serveur' });
  }
});
app.patch('/api/coa/references/:id', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    const map: Record<string, string> = { materiauId: 'materiau_id', fournisseur: 'fournisseur', refInterne: 'ref_interne', refClient: 'ref_client' };
    const fields: string[] = []; const values: any[] = []; let i = 1;
    for (const k of Object.keys(map)) if (req.body[k] !== undefined) { fields.push(`${map[k]} = $${i++}`); values.push(req.body[k]); }
    if (!fields.length) return res.status(400).json({ error: 'Rien à modifier' });
    fields.push('updated_at = CURRENT_TIMESTAMP'); values.push(req.params.id);
    const r = await pool.query(`UPDATE coa_reference_produit SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, values);
    if (!r.rows[0]) return res.status(404).json({ error: 'Référence introuvable' });
    broadcast('coa:changed', {});
    res.json(mapReference(r.rows[0]));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});
app.delete('/api/coa/references/:id', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try { await pool.query('DELETE FROM coa_reference_produit WHERE id = $1', [req.params.id]); broadcast('coa:changed', {}); res.json({ success: true }); }
  catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// --- Lots de matière première ---
const COA_LOT_FIELDS: Record<string, string> = {
  materiauId: 'materiau_id', numeroLot: 'numero_lot', fournisseur: 'fournisseur', referenceInterne: 'reference_interne',
  referenceClient: 'reference_client', numeroCommande: 'numero_commande', dateCommande: 'date_commande', dateReception: 'date_reception',
  datePeremption: 'date_peremption', quantiteG: 'quantite_g', quantiteUnite: 'quantite_unite', lossDrying: 'loss_drying', aVerifierManuel: 'a_verifier',
  coaLien: 'coa_lien', commentaire: 'commentaire',
};
app.post('/api/coa/lots', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.body.numeroLot || !req.body.fournisseur) return res.status(400).json({ error: 'Numéro de lot et fournisseur requis' });
    const cols: string[] = []; const ph: string[] = []; const values: any[] = []; let i = 1;
    for (const k of Object.keys(COA_LOT_FIELDS)) if (req.body[k] !== undefined) { cols.push(COA_LOT_FIELDS[k]); ph.push(`$${i++}`); values.push(req.body[k] === '' ? null : req.body[k]); }
    cols.push('uploaded_by'); ph.push(`$${i++}`); values.push(req.user?.username || null);
    const r = await pool.query(`INSERT INTO coa_lot_mp (${cols.join(', ')}) VALUES (${ph.join(', ')}) RETURNING id`, values);
    await logActivity(req, 'COA_LOT_CREATE', r.rows[0].id, `A créé le lot MP ${req.body.numeroLot}`);
    broadcast('coa:changed', {});
    res.status(201).json({ id: r.rows[0].id });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});
app.patch('/api/coa/lots/:id', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    const fields: string[] = []; const values: any[] = []; let i = 1;
    for (const k of Object.keys(COA_LOT_FIELDS)) if (req.body[k] !== undefined) { fields.push(`${COA_LOT_FIELDS[k]} = $${i++}`); values.push(req.body[k] === '' ? null : req.body[k]); }
    if (!fields.length) return res.status(400).json({ error: 'Rien à modifier' });
    fields.push('updated_at = CURRENT_TIMESTAMP'); values.push(req.params.id);
    const r = await pool.query(`UPDATE coa_lot_mp SET ${fields.join(', ')} WHERE id = $${i} RETURNING id`, values);
    if (!r.rows[0]) return res.status(404).json({ error: 'Lot introuvable' });
    await logActivity(req, 'COA_LOT_UPDATE', req.params.id, `A mis à jour le lot MP ${req.params.id}`);
    broadcast('coa:changed', {});
    res.json({ id: r.rows[0].id });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});
app.delete('/api/coa/lots/:id', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try { await pool.query('DELETE FROM coa_lot_mp WHERE id = $1', [req.params.id]); await logActivity(req, 'COA_LOT_DELETE', req.params.id, `A supprimé le lot MP ${req.params.id}`); broadcast('coa:changed', {}); res.json({ success: true }); }
  catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// --- Document CoA (PDF stocké en base, un par lot) ---
app.post('/api/coa/lots/:id/document', authenticateToken, requireRole('editor'), express.raw({ type: '*/*', limit: '25mb' }), async (req: AuthRequest, res: Response) => {
  try {
    const buf = req.body as Buffer;
    if (!buf || !buf.length) return res.status(400).json({ error: 'Fichier vide' });
    const filename = String(req.query.filename || 'coa.pdf');
    const mime = req.headers['content-type'] && req.headers['content-type'] !== 'application/octet-stream' ? String(req.headers['content-type']) : 'application/pdf';
    const lot = await pool.query('SELECT id FROM coa_lot_mp WHERE id = $1', [req.params.id]);
    if (!lot.rows[0]) return res.status(404).json({ error: 'Lot introuvable' });
    await pool.query(
      `INSERT INTO coa_document (lot_id, nom_fichier, type_mime, taille_octets, contenu, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (lot_id) DO UPDATE SET nom_fichier = $2, type_mime = $3, taille_octets = $4, contenu = $5, uploaded_by = $6, uploaded_at = CURRENT_TIMESTAMP`,
      [req.params.id, filename, mime, buf.length, buf, req.user?.username || null]
    );
    await pool.query('UPDATE coa_lot_mp SET coa_fichier = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [filename, req.params.id]);
    await logActivity(req, 'COA_DOC_UPLOAD', req.params.id, `A téléversé le CoA du lot ${req.params.id} (${filename})`);
    broadcast('coa:changed', {});
    res.status(201).json({ success: true, filename });
  } catch (e) { console.error('coa upload', e); res.status(500).json({ error: 'Erreur serveur' }); }
});
app.get('/api/coa/lots/:id/document', authenticateToken, requireView('coa'), async (req: AuthRequest, res: Response) => {
  try {
    const r = await pool.query('SELECT nom_fichier, type_mime, contenu FROM coa_document WHERE lot_id = $1', [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Aucun document' });
    const doc = r.rows[0];
    res.setHeader('Content-Type', doc.type_mime || 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.nom_fichier || 'coa.pdf')}"`);
    res.send(doc.contenu);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});
app.delete('/api/coa/lots/:id/document', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    await pool.query('DELETE FROM coa_document WHERE lot_id = $1', [req.params.id]);
    await pool.query('UPDATE coa_lot_mp SET coa_fichier = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [req.params.id]);
    broadcast('coa:changed', {});
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// ===================== Forecast Ventes / pilotage CA =====================
const mapVente = (r: any) => ({
  id: r.id, year: r.year, pays: r.pays || '', ligneProduit: r.ligne_produit || '', produit: r.produit || '',
  prixUnitaire: Number(r.prix_unitaire) || 0, qty: Array.isArray(r.qty) ? r.qty.map((n: any) => Number(n) || 0) : Array(12).fill(0),
  codeOdoo: r.code_odoo || '', retire: !!r.retire, archived: !!r.archived,
  dateAttendue: r.date_attendue ? (d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)(r.date_attendue instanceof Date ? r.date_attendue : new Date(r.date_attendue)) : null,
});

async function ventesPatch(table: string, id: string, body: any) {
  const cols: Record<string, string> = { pays: 'pays', ligneProduit: 'ligne_produit', produit: 'produit', codeOdoo: 'code_odoo', prixUnitaire: 'prix_unitaire', qty: 'qty', retire: 'retire', archived: 'archived', dateAttendue: 'date_attendue' };
  const fields: string[] = []; const values: any[] = []; let i = 1;
  for (const [k, col] of Object.entries(cols)) {
    if (body[k] !== undefined) { fields.push(`${col} = $${i++}`); values.push(col === 'qty' ? JSON.stringify(body[k]) : col === 'date_attendue' ? (body[k] || null) : body[k]); }
  }
  if (!fields.length) return null;
  fields.push('updated_at = CURRENT_TIMESTAMP');
  values.push(id);
  const r = await pool.query(`UPDATE ${table} SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, values);
  return r.rows[0];
}

// Données du module : forecast + réalisé manuel pour une année + années disponibles
// ===== Cockpit opérationnel Louna : COGS par lot + référentiel produits =====
const mapCockpitLot = (r: any) => ({
  id: r.id, batchNumber: r.batch_number, productCode: r.product_code, type: r.type, year: r.year, site: r.site,
  dateProdStart: r.date_prod_start, dateProdEnd: r.date_prod_end, datePlannedEnd: r.date_planned_end,
  dateReleaseCmo: r.date_release_cmo, dateReleaseLouna: r.date_release_louna,
  unitsTheoretical: r.units_theoretical, unitsFilled: r.units_filled, unitsConform: r.units_conform,
  unitsRejected: r.units_rejected, unitsSold: r.units_sold, costs: r.costs || {}, status: r.status, comment: r.comment,
});
const mapCockpitProduct = (r: any) => ({
  id: r.id, code: r.code, name: r.name, type: r.type, unitsPerBox: r.units_per_box,
  cogsTarget: r.cogs_target != null ? Number(r.cogs_target) : null,
  priceFr: r.price_fr != null ? Number(r.price_fr) : null, priceCh: r.price_ch != null ? Number(r.price_ch) : null,
});
const COCKPIT_LOT_FIELDS: Record<string, string> = {
  batchNumber: 'batch_number', productCode: 'product_code', type: 'type', year: 'year', site: 'site',
  dateProdStart: 'date_prod_start', dateProdEnd: 'date_prod_end', datePlannedEnd: 'date_planned_end',
  dateReleaseCmo: 'date_release_cmo', dateReleaseLouna: 'date_release_louna',
  unitsTheoretical: 'units_theoretical', unitsFilled: 'units_filled', unitsConform: 'units_conform',
  unitsRejected: 'units_rejected', unitsSold: 'units_sold', status: 'status', comment: 'comment',
};
const COCKPIT_PRODUCT_FIELDS: Record<string, string> = {
  code: 'code', name: 'name', type: 'type', unitsPerBox: 'units_per_box',
  cogsTarget: 'cogs_target', priceFr: 'price_fr', priceCh: 'price_ch',
};

app.get('/api/cockpit/data', authenticateToken, requireView('cockpit'), async (_req: AuthRequest, res: Response) => {
  try {
    const [prods, lots] = await Promise.all([
      pool.query('SELECT * FROM cockpit_products ORDER BY type, code'),
      pool.query('SELECT * FROM cockpit_lots ORDER BY year DESC NULLS LAST, batch_number'),
    ]);
    res.json({ products: prods.rows.map(mapCockpitProduct), lots: lots.rows.map(mapCockpitLot) });
  } catch (e) { console.error('cockpit data', e); res.status(500).json({ error: 'Erreur serveur' }); }
});

app.post('/api/cockpit/lots', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.body.batchNumber) return res.status(400).json({ error: 'Numéro de lot requis' });
    const cols: string[] = []; const ph: string[] = []; const values: any[] = []; let i = 1;
    for (const k of Object.keys(COCKPIT_LOT_FIELDS)) if (req.body[k] !== undefined) { cols.push(COCKPIT_LOT_FIELDS[k]); ph.push(`$${i++}`); values.push(req.body[k] === '' ? null : req.body[k]); }
    if (req.body.costs !== undefined) { cols.push('costs'); ph.push(`$${i++}::jsonb`); values.push(JSON.stringify(req.body.costs || {})); }
    const r = await pool.query(`INSERT INTO cockpit_lots (${cols.join(', ')}) VALUES (${ph.join(', ')}) RETURNING id`, values);
    await logActivity(req, 'COCKPIT_LOT_CREATE', r.rows[0].id, `A créé le lot cockpit ${req.body.batchNumber}`);
    broadcast('cockpit:changed', {});
    res.status(201).json({ id: r.rows[0].id });
  } catch (e: any) {
    if (e?.code === '23505') return res.status(409).json({ error: 'Ce numéro de lot existe déjà.' });
    console.error(e); res.status(500).json({ error: 'Erreur serveur' });
  }
});
app.patch('/api/cockpit/lots/:id', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    const fields: string[] = []; const values: any[] = []; let i = 1;
    for (const k of Object.keys(COCKPIT_LOT_FIELDS)) if (req.body[k] !== undefined) { fields.push(`${COCKPIT_LOT_FIELDS[k]} = $${i++}`); values.push(req.body[k] === '' ? null : req.body[k]); }
    if (req.body.costs !== undefined) { fields.push(`costs = $${i++}::jsonb`); values.push(JSON.stringify(req.body.costs || {})); }
    if (!fields.length) return res.status(400).json({ error: 'Rien à modifier' });
    fields.push('updated_at = CURRENT_TIMESTAMP'); values.push(req.params.id);
    const r = await pool.query(`UPDATE cockpit_lots SET ${fields.join(', ')} WHERE id = $${i} RETURNING id`, values);
    if (!r.rows[0]) return res.status(404).json({ error: 'Lot introuvable' });
    broadcast('cockpit:changed', {});
    res.json({ id: r.rows[0].id });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});
app.delete('/api/cockpit/lots/:id', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try { await pool.query('DELETE FROM cockpit_lots WHERE id = $1', [req.params.id]); await logActivity(req, 'COCKPIT_LOT_DELETE', req.params.id, `A supprimé un lot cockpit`); broadcast('cockpit:changed', {}); res.json({ success: true }); }
  catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

app.post('/api/cockpit/products', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.body.code) return res.status(400).json({ error: 'Code produit requis' });
    const cols: string[] = []; const ph: string[] = []; const values: any[] = []; let i = 1;
    for (const k of Object.keys(COCKPIT_PRODUCT_FIELDS)) if (req.body[k] !== undefined) { cols.push(COCKPIT_PRODUCT_FIELDS[k]); ph.push(`$${i++}`); values.push(req.body[k] === '' ? null : req.body[k]); }
    const r = await pool.query(`INSERT INTO cockpit_products (${cols.join(', ')}) VALUES (${ph.join(', ')}) RETURNING id`, values);
    broadcast('cockpit:changed', {});
    res.status(201).json({ id: r.rows[0].id });
  } catch (e: any) {
    if (e?.code === '23505') return res.status(409).json({ error: 'Ce code produit existe déjà.' });
    console.error(e); res.status(500).json({ error: 'Erreur serveur' });
  }
});
app.patch('/api/cockpit/products/:id', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    const fields: string[] = []; const values: any[] = []; let i = 1;
    for (const k of Object.keys(COCKPIT_PRODUCT_FIELDS)) if (req.body[k] !== undefined) { fields.push(`${COCKPIT_PRODUCT_FIELDS[k]} = $${i++}`); values.push(req.body[k] === '' ? null : req.body[k]); }
    if (!fields.length) return res.status(400).json({ error: 'Rien à modifier' });
    values.push(req.params.id);
    const r = await pool.query(`UPDATE cockpit_products SET ${fields.join(', ')} WHERE id = $${i} RETURNING id`, values);
    if (!r.rows[0]) return res.status(404).json({ error: 'Produit introuvable' });
    broadcast('cockpit:changed', {});
    res.json({ id: r.rows[0].id });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});
app.delete('/api/cockpit/products/:id', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try { await pool.query('DELETE FROM cockpit_products WHERE id = $1', [req.params.id]); broadcast('cockpit:changed', {}); res.json({ success: true }); }
  catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// ===== Simulateur COGS par famille : modèles paramétriques (sous-onglet « COGS par famille » du Cockpit) =====
const mapCogsModel = (r: any) => ({
  id: r.id, code: r.code, family: r.family, label: r.label,
  batchL: r.batch_l != null ? Number(r.batch_l) : null,
  refBatchL: r.ref_batch_l != null ? Number(r.ref_batch_l) : null,
  volUnitMl: r.vol_unit_ml != null ? Number(r.vol_unit_ml) : null,
  density: r.density != null ? Number(r.density) : 1,
  unitsPerBox: r.units_per_box != null ? Number(r.units_per_box) : null,
  yBulk: r.y_bulk != null ? Number(r.y_bulk) : null,
  yFill: r.y_fill != null ? Number(r.y_fill) : null,
  yVisual: r.y_visual != null ? Number(r.y_visual) : null,
  yPack: r.y_pack != null ? Number(r.y_pack) : null,
  lines: typeof r.lines === 'string' ? JSON.parse(r.lines) : (r.lines || []),
  cogsTarget: r.cogs_target != null ? Number(r.cogs_target) : null,
  notes: r.notes,
});
const COGS_MODEL_FIELDS: Record<string, string> = {
  code: 'code', family: 'family', label: 'label',
  batchL: 'batch_l', refBatchL: 'ref_batch_l', volUnitMl: 'vol_unit_ml', density: 'density', unitsPerBox: 'units_per_box',
  yBulk: 'y_bulk', yFill: 'y_fill', yVisual: 'y_visual', yPack: 'y_pack',
  cogsTarget: 'cogs_target', notes: 'notes',
};

app.get('/api/cogs/models', authenticateToken, requireView('cockpit'), async (_req: AuthRequest, res: Response) => {
  try {
    const r = await pool.query('SELECT * FROM cogs_models ORDER BY family, code');
    res.json({ models: r.rows.map(mapCogsModel) });
  } catch (e) { console.error('cogs models', e); res.status(500).json({ error: 'Erreur serveur' }); }
});
app.patch('/api/cogs/models/:id', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    const fields: string[] = []; const values: any[] = []; let i = 1;
    for (const k of Object.keys(COGS_MODEL_FIELDS)) if (req.body[k] !== undefined) { fields.push(`${COGS_MODEL_FIELDS[k]} = $${i++}`); values.push(req.body[k] === '' ? null : req.body[k]); }
    if (req.body.lines !== undefined) { fields.push(`lines = $${i++}::jsonb`); values.push(JSON.stringify(req.body.lines || [])); }
    if (!fields.length) return res.status(400).json({ error: 'Rien à modifier' });
    fields.push('updated_at = NOW()'); values.push(req.params.id);
    const r = await pool.query(`UPDATE cogs_models SET ${fields.join(', ')} WHERE id = $${i} RETURNING id, label`, values);
    if (!r.rows[0]) return res.status(404).json({ error: 'Modèle introuvable' });
    await logActivity(req, 'COGS_UPDATE', r.rows[0].id, `A modifié le modèle COGS ${r.rows[0].label || r.rows[0].id}`);
    broadcast('cockpit:changed', {});
    res.json({ id: r.rows[0].id });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// ============================================================================
// PACKING LIST & FACTURES (vue 'pl') : catalogue, clients, sites, documents
// ============================================================================
const mapPlProduct = (r: any) => ({
  ref: r.ref, designation: r.designation, type: r.type, hsCode: r.hs_code,
  unitPrice: r.unit_price === null ? null : Number(r.unit_price),
  boxWeightKg: r.box_weight_kg === null ? null : Number(r.box_weight_kg),
  capacityPerCarton: r.capacity_per_carton === null ? null : Number(r.capacity_per_carton),
});
const mapPlClient = (r: any) => ({ id: r.id, name: r.name, address: r.address, customerId: r.customer_id });
const mapPlDoc = (r: any) => ({
  id: r.id, invoiceNo: r.invoice_no, docDate: r.doc_date, rev: r.rev,
  clientName: r.client_name, clientAddress: r.client_address,
  pickupName: r.pickup_name, pickupAddress: r.pickup_address,
  lines: typeof r.lines === 'string' ? JSON.parse(r.lines) : (r.lines || []),
  notes: r.notes, createdAt: r.created_at, updatedAt: r.updated_at,
});

app.get('/api/pl/products', authenticateToken, requireView('pl'), async (_req: AuthRequest, res: Response) => {
  try {
    const r = await pool.query('SELECT * FROM pl_products ORDER BY ref');
    res.json({ products: r.rows.map(mapPlProduct) });
  } catch (e) { console.error('pl products', e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// Remplace tout le catalogue (upsert par ref + suppression des réfs absentes du body).
app.put('/api/pl/products', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    const products = Array.isArray(req.body?.products) ? req.body.products : null;
    if (!products) return res.status(400).json({ error: 'Liste de produits requise' });
    const refs: string[] = [];
    for (const p of products) {
      if (!p?.ref) continue;
      refs.push(p.ref);
      await pool.query(
        `INSERT INTO pl_products (ref, designation, type, hs_code, unit_price, box_weight_kg, capacity_per_carton)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (ref) DO UPDATE SET designation = $2, type = $3, hs_code = $4, unit_price = $5, box_weight_kg = $6, capacity_per_carton = $7`,
        [p.ref, p.designation ?? null, p.type ?? null, p.hsCode || null,
         p.unitPrice === '' || p.unitPrice == null ? null : p.unitPrice,
         p.boxWeightKg === '' || p.boxWeightKg == null ? null : p.boxWeightKg,
         p.capacityPerCarton === '' || p.capacityPerCarton == null ? null : p.capacityPerCarton]);
    }
    if (refs.length > 0) await pool.query('DELETE FROM pl_products WHERE ref <> ALL($1::text[])', [refs]);
    await logActivity(req, 'PL_PRODUCTS_UPDATE', null, `A mis à jour le catalogue Packing List (${refs.length} réf.)`);
    broadcast('pl:changed', {});
    res.json({ success: true });
  } catch (e) { console.error('pl products put', e); res.status(500).json({ error: 'Erreur serveur' }); }
});

app.get('/api/pl/clients', authenticateToken, requireView('pl'), async (_req: AuthRequest, res: Response) => {
  try {
    const r = await pool.query('SELECT * FROM pl_clients ORDER BY name');
    res.json({ clients: r.rows.map(mapPlClient) });
  } catch (e) { console.error('pl clients', e); res.status(500).json({ error: 'Erreur serveur' }); }
});
app.post('/api/pl/clients', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    const { name, address, customerId } = req.body;
    if (!name) return res.status(400).json({ error: 'Nom requis' });
    const r = await pool.query(
      'INSERT INTO pl_clients (name, address, customer_id) VALUES ($1,$2,$3) RETURNING *',
      [name, address || '', customerId || '']);
    await logActivity(req, 'PL_CLIENT_CREATE', String(r.rows[0].id), `A créé le client Packing List ${name}`);
    broadcast('pl:changed', {});
    res.status(201).json(mapPlClient(r.rows[0]));
  } catch (e: any) {
    if (e?.code === '23505') return res.status(409).json({ error: 'Ce client existe déjà.' });
    console.error('pl client create', e); res.status(500).json({ error: 'Erreur serveur' });
  }
});
app.patch('/api/pl/clients/:id', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    const map: Record<string, string> = { name: 'name', address: 'address', customerId: 'customer_id' };
    const fields: string[] = []; const values: any[] = []; let i = 1;
    for (const k of Object.keys(map)) if (req.body[k] !== undefined) { fields.push(`${map[k]} = $${i++}`); values.push(req.body[k]); }
    if (!fields.length) return res.status(400).json({ error: 'Rien à modifier' });
    values.push(req.params.id);
    const r = await pool.query(`UPDATE pl_clients SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, values);
    if (!r.rows[0]) return res.status(404).json({ error: 'Client introuvable' });
    await logActivity(req, 'PL_CLIENT_UPDATE', req.params.id, `A mis à jour le client Packing List ${r.rows[0].name}`);
    broadcast('pl:changed', {});
    res.json(mapPlClient(r.rows[0]));
  } catch (e: any) {
    if (e?.code === '23505') return res.status(409).json({ error: 'Ce client existe déjà.' });
    console.error('pl client patch', e); res.status(500).json({ error: 'Erreur serveur' });
  }
});
app.delete('/api/pl/clients/:id', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    await pool.query('DELETE FROM pl_clients WHERE id = $1', [req.params.id]);
    await logActivity(req, 'PL_CLIENT_DELETE', req.params.id, `A supprimé un client Packing List`);
    broadcast('pl:changed', {});
    res.json({ success: true });
  } catch (e) { console.error('pl client delete', e); res.status(500).json({ error: 'Erreur serveur' }); }
});

app.get('/api/pl/sites', authenticateToken, requireView('pl'), async (_req: AuthRequest, res: Response) => {
  try {
    const r = await pool.query('SELECT * FROM pl_pickup_sites ORDER BY id');
    res.json({ sites: r.rows });
  } catch (e) { console.error('pl sites', e); res.status(500).json({ error: 'Erreur serveur' }); }
});
app.patch('/api/pl/sites/:id', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    if (req.body.address === undefined) return res.status(400).json({ error: 'Adresse requise' });
    const r = await pool.query('UPDATE pl_pickup_sites SET address = $1 WHERE id = $2 RETURNING *', [req.body.address, req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Site introuvable' });
    await logActivity(req, 'PL_SITE_UPDATE', req.params.id, `A mis à jour l'adresse du site d'enlèvement ${r.rows[0].name}`);
    broadcast('pl:changed', {});
    res.json(r.rows[0]);
  } catch (e) { console.error('pl site patch', e); res.status(500).json({ error: 'Erreur serveur' }); }
});

app.get('/api/pl/documents', authenticateToken, requireView('pl'), async (_req: AuthRequest, res: Response) => {
  try {
    const r = await pool.query('SELECT * FROM pl_documents ORDER BY updated_at DESC');
    res.json({ documents: r.rows.map(mapPlDoc) });
  } catch (e) { console.error('pl docs', e); res.status(500).json({ error: 'Erreur serveur' }); }
});
app.get('/api/pl/documents/:id', authenticateToken, requireView('pl'), async (req: AuthRequest, res: Response) => {
  try {
    const r = await pool.query('SELECT * FROM pl_documents WHERE id = $1', [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Document introuvable' });
    res.json({ document: mapPlDoc(r.rows[0]) });
  } catch (e) { console.error('pl doc get', e); res.status(500).json({ error: 'Erreur serveur' }); }
});
app.post('/api/pl/documents', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    const b = req.body || {};
    const r = await pool.query(
      `INSERT INTO pl_documents (invoice_no, doc_date, rev, client_name, client_address, pickup_name, pickup_address, lines, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9) RETURNING *`,
      [b.invoiceNo || '', b.docDate || null, b.rev ?? 0, b.clientName || '', b.clientAddress || '',
       b.pickupName || '', b.pickupAddress || '', JSON.stringify(b.lines || []), b.notes || '']);
    await logActivity(req, 'PL_DOC_CREATE', String(r.rows[0].id), `A créé le document Packing List / Facture ${b.invoiceNo || '(sans n°)'}`);
    broadcast('pl:changed', {});
    res.status(201).json(mapPlDoc(r.rows[0]));
  } catch (e) { console.error('pl doc create', e); res.status(500).json({ error: 'Erreur serveur' }); }
});
app.patch('/api/pl/documents/:id', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    const map: Record<string, string> = {
      invoiceNo: 'invoice_no', docDate: 'doc_date', rev: 'rev', clientName: 'client_name', clientAddress: 'client_address',
      pickupName: 'pickup_name', pickupAddress: 'pickup_address', notes: 'notes',
    };
    const fields: string[] = []; const values: any[] = []; let i = 1;
    for (const k of Object.keys(map)) if (req.body[k] !== undefined) { fields.push(`${map[k]} = $${i++}`); values.push(k === 'docDate' && req.body[k] === '' ? null : req.body[k]); }
    if (req.body.lines !== undefined) { fields.push(`lines = $${i++}::jsonb`); values.push(JSON.stringify(req.body.lines || [])); }
    if (!fields.length) return res.status(400).json({ error: 'Rien à modifier' });
    fields.push('updated_at = NOW()'); values.push(req.params.id);
    const r = await pool.query(`UPDATE pl_documents SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, values);
    if (!r.rows[0]) return res.status(404).json({ error: 'Document introuvable' });
    await logActivity(req, 'PL_DOC_UPDATE', req.params.id, `A mis à jour le document Packing List / Facture ${r.rows[0].invoice_no || req.params.id}`);
    broadcast('pl:changed', {});
    res.json(mapPlDoc(r.rows[0]));
  } catch (e) { console.error('pl doc patch', e); res.status(500).json({ error: 'Erreur serveur' }); }
});
app.delete('/api/pl/documents/:id', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    await pool.query('DELETE FROM pl_documents WHERE id = $1', [req.params.id]);
    await logActivity(req, 'PL_DOC_DELETE', req.params.id, `A supprimé un document Packing List / Facture`);
    broadcast('pl:changed', {});
    res.json({ success: true });
  } catch (e) { console.error('pl doc delete', e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// Registre des commandes : lecture du miroir auto-synchronisé (fichier Excel DOC-0014).
app.get('/api/ventes/registre', authenticateToken, async (_req: AuthRequest, res: Response) => {
  try {
    const r = await pool.query('SELECT * FROM registre_commandes ORDER BY year DESC NULLS LAST, country, commercial_name, id');
    res.json({ rows: r.rows.map((x: any) => ({
      id: x.id, year: x.year, country: x.country, productClass: x.product_class, commercialName: x.commercial_name,
      ref: x.ref, units: x.units, batchNo: x.batch_no, expDate: x.exp_date, status: x.status,
    })) });
  } catch (e) { console.error('registre', e); res.status(500).json({ error: 'Erreur serveur' }); }
});

app.get('/api/ventes/data', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const year = Number(req.query.year) || new Date().getFullYear();
    const [f, rl, yrs, meta] = await Promise.all([
      pool.query('SELECT * FROM ventes_forecast WHERE year = $1 ORDER BY pays, ligne_produit, produit', [year]),
      pool.query('SELECT * FROM ventes_realise WHERE year = $1 ORDER BY pays, ligne_produit, produit', [year]),
      pool.query('SELECT DISTINCT year FROM (SELECT year FROM ventes_forecast UNION SELECT year FROM ventes_realise) t ORDER BY year DESC'),
      pool.query('SELECT realized_months, updated_at FROM ventes_forecast_meta WHERE year = $1', [year]),
    ]);
    const all = [...f.rows, ...rl.rows];
    const archived = all.length > 0 && all.every(r => r.archived); // année archivée = lecture seule
    const metaRow = meta.rows[0];
    const realizedMonths = Array.isArray(metaRow?.realized_months) ? metaRow.realized_months.map((b: any) => !!b) : Array(12).fill(false);
    // Date de MAJ auto = dernière modif d'une ligne forecast OU du marquage « réalisé ».
    const times = f.rows.map(r => r.updated_at ? new Date(r.updated_at).getTime() : 0);
    if (metaRow?.updated_at) times.push(new Date(metaRow.updated_at).getTime());
    const maxT = times.length ? Math.max(...times) : 0;
    const forecastUpdatedAt = maxT ? new Date(maxT).toISOString() : null;
    res.json({ year, forecast: f.rows.map(mapVente), realise: rl.rows.map(mapVente), years: yrs.rows.map(r => r.year), archived, realizedMonths, forecastUpdatedAt });
  } catch (e) { console.error('ventes data', e); res.status(500).json({ error: 'Erreur serveur' }); }
});

const ventesCreate = (table: string) => async (req: AuthRequest, res: Response) => {
  try {
    const b = req.body || {};
    const year = Number(b.year) || new Date().getFullYear();
    const qty = Array.isArray(b.qty) && b.qty.length === 12 ? b.qty.map((n: any) => Number(n) || 0) : Array(12).fill(0);
    const r = await pool.query(
      `INSERT INTO ${table} (year, pays, ligne_produit, produit, code_odoo, prix_unitaire, qty) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [year, b.pays || '', b.ligneProduit || '', b.produit || '', b.codeOdoo || '', Number(b.prixUnitaire) || 0, JSON.stringify(qty)]
    );
    broadcast('ventes:changed', {});
    res.json(mapVente(r.rows[0]));
  } catch (e) { console.error('ventes create', e); res.status(500).json({ error: 'Erreur serveur' }); }
};
const ventesUpdate = (table: string) => async (req: AuthRequest, res: Response) => {
  try { const row = await ventesPatch(table, req.params.id, req.body || {}); broadcast('ventes:changed', {}); res.json(row ? mapVente(row) : {}); }
  catch (e) { console.error('ventes update', e); res.status(500).json({ error: 'Erreur serveur' }); }
};
const ventesDelete = (table: string) => async (req: AuthRequest, res: Response) => {
  try { await pool.query(`DELETE FROM ${table} WHERE id = $1`, [req.params.id]); broadcast('ventes:changed', {}); res.json({ ok: true }); }
  catch (e) { console.error('ventes delete', e); res.status(500).json({ error: 'Erreur serveur' }); }
};

app.post('/api/ventes/forecast', authenticateToken, requireRole('editor'), ventesCreate('ventes_forecast'));
app.patch('/api/ventes/forecast/:id', authenticateToken, requireRole('editor'), ventesUpdate('ventes_forecast'));
app.delete('/api/ventes/forecast/:id', authenticateToken, requireRole('editor'), ventesDelete('ventes_forecast'));
app.post('/api/ventes/realise', authenticateToken, requireRole('editor'), ventesCreate('ventes_realise'));
app.patch('/api/ventes/realise/:id', authenticateToken, requireRole('editor'), ventesUpdate('ventes_realise'));
app.delete('/api/ventes/realise/:id', authenticateToken, requireRole('editor'), ventesDelete('ventes_realise'));

// Marquage « réalisé » des mois du forecast (12 booléens) — colonne verte côté UI. Met aussi à jour l'horodatage du tableau.
app.put('/api/ventes/forecast-meta', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    const year = Number(req.body?.year) || new Date().getFullYear();
    const rm = Array.isArray(req.body?.realizedMonths) && req.body.realizedMonths.length === 12
      ? req.body.realizedMonths.map((b: any) => !!b) : Array(12).fill(false);
    await pool.query(
      `INSERT INTO ventes_forecast_meta (year, realized_months, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (year) DO UPDATE SET realized_months = $2, updated_at = CURRENT_TIMESTAMP`,
      [year, JSON.stringify(rm)]
    );
    broadcast('ventes:changed', {});
    res.json({ ok: true, realizedMonths: rm });
  } catch (e) { console.error('ventes meta', e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// Archivage d'une année : passe forecast + réalisé en archived (l'année disparaît des vues actives)
app.post('/api/ventes/archive', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    const year = Number(req.query.year || (req.body && req.body.year));
    if (!year) return res.status(400).json({ error: 'Année requise.' });
    const archived = String(req.query.archived ?? (req.body && req.body.archived) ?? 'true') !== 'false';
    await pool.query('UPDATE ventes_forecast SET archived = $2 WHERE year = $1', [year, archived]);
    await pool.query('UPDATE ventes_realise SET archived = $2 WHERE year = $1', [year, archived]);
    broadcast('ventes:changed', {});
    res.json({ ok: true, archived });
  } catch (e) { console.error('ventes archive', e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// CA réalisé mensuel depuis Odoo (factures clients postées) — total par mois pour une année + société
app.get('/api/ventes/odoo-monthly', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!process.env.ODOO_API_KEY) return res.json({ months: Array(12).fill(0), configured: false });
    const year = Number(req.query.year) || new Date().getFullYear();
    const cid = await odooCompanyId(String(req.query.company || 'regenerative'));
    const domain: any[] = [['move_type', '=', 'out_invoice'], ['state', '=', 'posted'],
      ['invoice_date', '>=', `${year}-01-01`], ['invoice_date', '<=', `${year}-12-31`]];
    if (cid) domain.push(['company_id', '=', cid]);
    // Exclure les factures intercompagnie Regenerative ↔ Aesthetics (client = Louna Aesthetics).
    const aesP = await odooAesPartner();
    if (aesP) domain.push(['commercial_partner_id', '!=', aesP]);
    const grp = await odooKw('account.move', 'read_group', [domain, ['amount_untaxed:sum'], ['invoice_date:month']],
      { context: cid ? { allowed_company_ids: [cid] } : {} });
    const months = Array(12).fill(0);
    for (const g of grp || []) {
      const range = g.__range && g.__range['invoice_date:month'];
      const from = range && range.from ? String(range.from) : '';
      const m = from ? Number(from.slice(5, 7)) - 1 : -1;
      if (m >= 0 && m < 12) months[m] = Math.round((g.amount_untaxed || 0) * 100) / 100;
    }
    res.json({ months, configured: true, companyId: cid });
  } catch (e) { console.error('ventes odoo-monthly', e); res.status(502).json({ error: 'Odoo indisponible.' }); }
});

// Réalisé Odoo DÉTAILLÉ par produit × mois (HT, factures clients externes — hors intercompagnie).
app.get('/api/ventes/odoo-realise', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!process.env.ODOO_API_KEY) return res.json({ rows: [], configured: false });
    const year = Number(req.query.year) || new Date().getFullYear();
    const cid = await odooCompanyId(String(req.query.company || 'regenerative'));
    const aesP = await odooAesPartner();
    const domain: any[] = [
      ['parent_state', '=', 'posted'], ['move_id.move_type', '=', 'out_invoice'],
      ['product_id', '!=', false],
      ['date', '>=', `${year}-01-01`], ['date', '<=', `${year}-12-31`],
    ];
    if (cid) domain.push(['company_id', '=', cid]);
    if (aesP) domain.push(['move_id.commercial_partner_id', '!=', aesP]); // exclure intercompagnie
    const lines = await odooKw('account.move.line', 'search_read', [domain],
      { fields: ['product_id', 'price_subtotal', 'date'], limit: 8000, context: cid ? { allowed_company_ids: [cid] } : {} });
    const pids = [...new Set(lines.map((l: any) => Array.isArray(l.product_id) ? l.product_id[0] : null).filter(Boolean))];
    let prodMap: Record<number, { code: string; name: string }> = {};
    if (pids.length) {
      const prods = await odooKw('product.product', 'read', [pids], { fields: ['default_code', 'name'] });
      prodMap = Object.fromEntries(prods.map((p: any) => [p.id, { code: p.default_code || '', name: (p.name || '').trim() }]));
    }
    const byKey: Record<string, { code: string; produit: string; months: number[] }> = {};
    for (const l of lines) {
      const pid = Array.isArray(l.product_id) ? l.product_id[0] : null;
      const info = pid && prodMap[pid] ? prodMap[pid] : { code: '', name: Array.isArray(l.product_id) ? l.product_id[1] : '?' };
      const m = l.date ? Number(String(l.date).slice(5, 7)) - 1 : -1;
      if (m < 0 || m > 11) continue;
      const key = info.code || info.name;
      if (!byKey[key]) byKey[key] = { code: info.code, produit: info.name, months: Array(12).fill(0) };
      byKey[key].months[m] += l.price_subtotal || 0;
    }
    const rows = Object.values(byKey).map(r => ({
      code: r.code, produit: r.produit,
      months: r.months.map(x => Math.round(x * 100) / 100),
      total: Math.round(r.months.reduce((a, b) => a + b, 0) * 100) / 100,
    })).filter(r => r.total !== 0).sort((a, b) => b.total - a.total);
    res.json({ rows, configured: true });
  } catch (e) { console.error('ventes odoo-realise', e); res.status(502).json({ error: 'Odoo indisponible.' }); }
});

// Catalogue produits Odoo (code ↔ nom) pour l'autofill de la grille.
app.get('/api/ventes/odoo-products', authenticateToken, async (_req: AuthRequest, res: Response) => {
  try {
    if (!process.env.ODOO_API_KEY) return res.json({ products: [] });
    const prods = await odooKw('product.product', 'search_read', [[['default_code', '!=', false]]],
      { fields: ['default_code', 'name'], limit: 1000, order: 'default_code' });
    res.json({ products: prods.map((p: any) => ({ code: p.default_code, name: (p.name || '').trim() })) });
  } catch (e) { console.error('ventes odoo-products', e); res.status(502).json({ error: 'Odoo indisponible.' }); }
});

app.get('/api/audit-logs', authenticateToken, requireView('audit'), async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 500'
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/api/settings/fluxConfig', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query("SELECT value FROM settings WHERE key = 'fluxConfig'");
    const config = result.rows.length > 0 ? result.rows[0].value : FLUX_DEFAULTS;
    res.json(config);
  } catch (error) {
    console.error('Error fetching fluxConfig:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.put('/api/settings/fluxConfig', authenticateToken, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const config = req.body;

    await pool.query(
      `INSERT INTO settings (key, value) VALUES ('fluxConfig', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1`,
      [JSON.stringify(config)]
    );

    broadcast('settings:updated', { key: 'fluxConfig', config });
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating fluxConfig:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/api/settings/clients', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query("SELECT value FROM settings WHERE key = 'clients'");
    const clients = result.rows.length > 0 ? result.rows[0].value : DEFAULT_CLIENTS;
    res.json(clients);
  } catch (error) {
    console.error('Error fetching clients:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.put('/api/settings/clients', authenticateToken, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const clients = req.body;
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ('clients', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1`,
      [JSON.stringify(clients)]
    );
    broadcast('settings:updated', { key: 'clients', clients });
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating clients:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/api/settings/statuses', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query("SELECT value FROM settings WHERE key = 'statuses'");
    const statuses = result.rows.length > 0 ? result.rows[0].value : DEFAULT_STATUSES;
    res.json(statuses);
  } catch (error) {
    console.error('Error fetching statuses:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.put('/api/settings/statuses', authenticateToken, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const statuses = req.body;
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ('statuses', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1`,
      [JSON.stringify(statuses)]
    );
    broadcast('settings:updated', { key: 'statuses', statuses });
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating statuses:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/api/settings/sampleConfig', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query("SELECT value FROM settings WHERE key = 'sampleConfig'");
    const config = result.rows.length > 0 ? result.rows[0].value : DEFAULT_SAMPLE_CONFIG;
    res.json(config);
  } catch (error) {
    console.error('Error fetching sampleConfig:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.put('/api/settings/sampleConfig', authenticateToken, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const config = req.body;
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ('sampleConfig', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1`,
      [JSON.stringify(config)]
    );
    broadcast('settings:updated', { key: 'sampleConfig', config });
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating sampleConfig:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/api/settings/samplePartners', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query("SELECT value FROM settings WHERE key = 'samplePartners'");
    const partners = result.rows.length > 0 ? result.rows[0].value : DEFAULT_SAMPLE_PARTNERS;
    res.json(partners);
  } catch (error) {
    console.error('Error fetching samplePartners:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.put('/api/settings/samplePartners', authenticateToken, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const partners = req.body;
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ('samplePartners', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1`,
      [JSON.stringify(partners)]
    );
    broadcast('settings:updated', { key: 'samplePartners', partners });
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating samplePartners:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/api/settings/productCatalog', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query("SELECT value FROM settings WHERE key = 'productCatalog'");
    const productCatalog = result.rows.length > 0 ? result.rows[0].value : DEFAULT_PRODUCT_CATALOG;
    res.json(productCatalog);
  } catch (error) {
    console.error('Error fetching productCatalog:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.put('/api/settings/productCatalog', authenticateToken, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const productCatalog = req.body;
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ('productCatalog', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1`,
      [JSON.stringify(productCatalog)]
    );
    broadcast('settings:updated', { key: 'productCatalog', productCatalog });
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating productCatalog:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Modèles COGS Filler (paramètres + BOM éditables). GET renvoie null si non défini → le front seed avec ses défauts.
app.get('/api/settings/cogsFillerModels', authenticateToken, requireView('cockpit'), async (_req: AuthRequest, res: Response) => {
  try {
    const r = await pool.query("SELECT value FROM settings WHERE key = 'cogsFillerModels'");
    res.json(r.rows.length ? r.rows[0].value : null);
  } catch (error) {
    console.error('Error fetching cogsFillerModels:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.put('/api/settings/cogsFillerModels', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ('cogsFillerModels', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1`,
      [JSON.stringify(req.body)]
    );
    broadcast('settings:updated', { key: 'cogsFillerModels' });
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating cogsFillerModels:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/reset', authenticateToken, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { password } = req.body;
    const userId = req.user?.userId;

    // Vérifier le mot de passe de l'administrateur actuel
    const userResult = await pool.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Utilisateur non trouvé' });
    }

    const passwordMatch = await bcrypt.compare(password, userResult.rows[0].password_hash);
    if (!passwordMatch) {
      return res.status(403).json({ success: false, error: 'Mot de passe incorrect' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM batches');
      await client.query('DELETE FROM deliveries');
      await client.query(
        `INSERT INTO settings (key, value) VALUES ('fluxConfig', $1)
         ON CONFLICT (key) DO UPDATE SET value = $1`,
        [JSON.stringify(FLUX_DEFAULTS)]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    broadcast('data:reset', {});
    res.json({ success: true });
  } catch (error) {
    console.error('Error resetting data:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

const activeSockets = new Map<string, JWTPayload>();

io.use((socket: Socket, next) => {
  const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];

  if (!token) {
    return next(new Error('Authentification requise'));
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JWTPayload;
    (socket as any).user = decoded;
    next();
  } catch {
    next(new Error('Token invalide'));
  }
});

io.on('connection', (socket: Socket) => {
  const user = (socket as any).user as JWTPayload;
  activeSockets.set(socket.id, user);
  console.log(`📡 Socket connecté: ${user.username} (${user.role})`);

  socket.on('disconnect', () => {
    activeSockets.delete(socket.id);
    console.log(`📡 Socket déconnecté: ${user.username}`);
  });
});

// =============================================================================
// MODULE QMS — Synchronisation Microsoft Graph (OneDrive/SharePoint, lecture seule)
// Défense en profondeur : delta (colonne vertébrale) + webhook (réactivité) + réconciliation (filet).
// =============================================================================
const GRAPH = 'https://graph.microsoft.com/v1.0';
const QMS_SELECT = 'id,name,file,folder,eTag,cTag,size,lastModifiedDateTime,createdDateTime,webUrl,parentReference,deleted,lastModifiedBy';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let qmsRunning = false;
let qmsPending = false;
let _graphTok: { token: string; exp: number } = { token: '', exp: 0 };

function graphConfigured(): boolean {
  return !!(process.env.GRAPH_TENANT_ID && process.env.GRAPH_CLIENT_ID && process.env.GRAPH_CLIENT_SECRET
    && process.env.GRAPH_DRIVE_ID && process.env.GRAPH_ROOT_ITEM_ID);
}

async function graphToken(force = false): Promise<string> {
  const now = Date.now();
  if (!force && _graphTok.token && now < _graphTok.exp - 60000) return _graphTok.token;
  const body = new URLSearchParams({
    client_id: process.env.GRAPH_CLIENT_ID as string,
    client_secret: process.env.GRAPH_CLIENT_SECRET as string,
    grant_type: 'client_credentials',
    scope: 'https://graph.microsoft.com/.default',
  });
  const r = await fetch(`https://login.microsoftonline.com/${process.env.GRAPH_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  });
  const j: any = await r.json();
  if (!r.ok) throw new Error('Graph token: ' + (j.error_description || j.error || r.status));
  _graphTok = { token: j.access_token, exp: now + j.expires_in * 1000 };
  return _graphTok.token;
}

// GET Graph avec gestion 429/5xx (Retry-After + backoff exponentiel).
async function graphGet(url: string, attempt = 0): Promise<any> {
  const token = await graphToken();
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 429 || r.status >= 500) {
    if (attempt >= 5) throw new Error(`Graph ${r.status} après ${attempt} tentatives`);
    const ra = parseInt(r.headers.get('retry-after') || '') || Math.min(60, Math.pow(2, attempt));
    await sleep(ra * 1000);
    return graphGet(url, attempt + 1);
  }
  const j: any = await r.json();
  if (!r.ok) throw new Error(`Graph ${r.status} ${j.error?.code || ''}: ${j.error?.message || ''}`);
  return j;
}

// PATCH Graph (écriture) avec gestion 429/5xx.
async function graphPatch(url: string, body: any, attempt = 0): Promise<any> {
  const token = await graphToken();
  const r = await fetch(url, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (r.status === 429 || r.status >= 500) {
    if (attempt >= 5) throw new Error(`Graph ${r.status} après ${attempt} tentatives`);
    const ra = parseInt(r.headers.get('retry-after') || '') || Math.min(60, Math.pow(2, attempt));
    await sleep(ra * 1000);
    return graphPatch(url, body, attempt + 1);
  }
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Graph ${r.status} ${j.error?.code || ''}: ${j.error?.message || ''}`);
  return j;
}

// Fichier Excel de traçabilité (Batch Follow-up) : résolution de l'item Graph par id ou par chemin.
const PROD_LOT_SHEET = process.env.GRAPH_PROD_LOT_SHEET || 'Batch Follow-up';
let _prodLotItemId: string | null = null;
async function prodLotItemId(): Promise<string> {
  if (process.env.GRAPH_PROD_LOT_ITEM_ID) return process.env.GRAPH_PROD_LOT_ITEM_ID;
  if (_prodLotItemId) return _prodLotItemId;
  const driveId = process.env.GRAPH_DRIVE_ID as string;
  const path = process.env.GRAPH_PROD_LOT_PATH
    || 'General/02_ASSURANCE QUALITÉ/05 - Manufacturing/05 - Records/04- Production lots/LIST-MAN1-01-Manufacturing traceability_rev00.xlsx';
  const enc = path.split('/').map(encodeURIComponent).join('/');
  const j = await graphGet(`${GRAPH}/drives/${driveId}/root:/${enc}`);
  _prodLotItemId = j.id;
  return j.id as string;
}

// ===================== Création de DDL (dossier de lot PDF) depuis les modèles Word approuvés =====================
const DDL_FORMS_PATH = process.env.GRAPH_DDL_FORMS_PATH
  || 'General/02_ASSURANCE QUALITÉ/05 - Manufacturing/03 - Forms/2 - Version word (approved)';
let _ddlFolderId: string | null = null;
async function ddlFolderId(): Promise<string> {
  if (_ddlFolderId) return _ddlFolderId;
  const enc = DDL_FORMS_PATH.split('/').map(encodeURIComponent).join('/');
  const j = await graphGet(`${GRAPH}/drives/${process.env.GRAPH_DRIVE_ID}/root:/${enc}`);
  _ddlFolderId = j.id;
  return j.id as string;
}

async function graphGetBuffer(url: string): Promise<Buffer> {
  const token = await graphToken();
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Graph ${r.status} (téléchargement)`);
  return Buffer.from(await r.arrayBuffer());
}
async function graphPutBuffer(url: string, buf: Buffer, mime: string): Promise<any> {
  const token = await graphToken();
  const r = await fetch(url, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': mime }, body: buf });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Graph ${r.status} (envoi) ${j.error?.message || ''}`);
  return j;
}
async function graphDeleteItem(itemId: string): Promise<void> {
  try {
    const token = await graphToken();
    await fetch(`${GRAPH}/drives/${process.env.GRAPH_DRIVE_ID}/items/${itemId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  } catch { /* nettoyage best-effort */ }
}

// « FORM-MAN2-01 … v03 … » → n° de DDL + version, lus dans le nom du fichier.
function parseDdlName(name: string) {
  const m = /((?:FORM|DOC|EQ)[A-Za-z0-9 _.-]*?)[\s_-]*[vV](\d{1,3})/.exec(name || '');
  return { ddlNumber: m ? m[1].replace(/[\s_.-]+$/, '').trim() : null, version: m ? m[2].padStart(2, '0') : null };
}

// Remplace « BATCH NUMBER » par le n° de lot dans les runs Word, en retirant le surlignage jaune du run modifié.
function ddlReplaceBatchNumber(xml: string, lotEsc: string): { xml: string; n: number } {
  let n = 0;
  const out = xml.replace(/<w:r(?:\s[^>]*)?>(?:(?!<\/w:r>)[\s\S])*?<\/w:r>/g, (run) => {
    if (!/BATCH\s*NUMBER/i.test(run.replace(/<[^>]+>/g, ''))) return run;
    let r2 = run.replace(/(<w:t(?:\s[^>]*)?>)([^<]*)(<\/w:t>)/g, (m0, open, txt, close) => {
      if (!/BATCH\s*NUMBER/i.test(txt)) return m0;
      n++;
      return open + txt.replace(/BATCH\s*NUMBER/gi, lotEsc) + close;
    });
    // retire le surlignage (jaune) et l'ombrage de caractère du run où le lot est inscrit
    if (r2 !== run) r2 = r2.replace(/<w:highlight[^/>]*\/>/g, '').replace(/<w:shd[^/>]*\/>/g, '');
    return r2;
  });
  return { xml: out, n };
}

// Remplit la cellule de tableau VIDE qui suit un libellé « N° DE LOT » / « Numéro de lot » (encadré des 1res pages).
function ddlFillCellAfterLabel(xml: string, lotEsc: string, maxOcc: number): { xml: string; n: number } {
  let n = 0;
  const parts = xml.split(/(<w:tc[\s>][\s\S]*?<\/w:tc>)/g);
  for (let i = 0; i < parts.length; i++) {
    if (n >= maxOcc) break;
    if (!/^<w:tc[\s>]/.test(parts[i])) continue;
    const label = parts[i].replace(/<[^>]+>/g, ' ');
    if (!/n\s*°\s*de\s*lot|num[ée]ro\s*de\s*lot/i.test(label)) continue;
    for (let j = i + 1; j < parts.length; j++) {
      if (!/^<w:tc[\s>]/.test(parts[j])) continue;
      const plain = parts[j].replace(/<[^>]+>/g, '').replace(/\s+/g, '');
      if (!plain) {
        // insère le lot en gras, CENTRÉ horizontalement (jc) et verticalement (vAlign) dans la cellule
        const runXml = `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${lotEsc}</w:t></w:r>`;
        let cell = parts[j];
        if (/<w:tcPr[\s>]/.test(cell) && !/<w:vAlign/.test(cell)) cell = cell.replace(/<\/w:tcPr>/, '<w:vAlign w:val="center"/></w:tcPr>');
        if (/<w:p\b[^>]*\/>/.test(cell)) {
          cell = cell.replace(/<w:p\b([^>]*)\/>/, `<w:p$1><w:pPr><w:jc w:val="center"/></w:pPr>${runXml}</w:p>`);
          n++;
        } else {
          const m0 = /<w:p\b[^>]*>/.exec(cell);
          const pStart = m0 ? m0.index + m0[0].length : -1;
          const pEnd = pStart >= 0 ? cell.indexOf('</w:p>', pStart) : -1;
          if (pEnd !== -1) {
            let inner = cell.slice(pStart, pEnd);
            if (/<w:pPr[\s>]/.test(inner)) {
              inner = /<w:jc\b/.test(inner)
                ? inner.replace(/<w:jc\b[^>]*\/>/, '<w:jc w:val="center"/>')
                : inner.replace(/<\/w:pPr>/, '<w:jc w:val="center"/></w:pPr>');
            } else inner = `<w:pPr><w:jc w:val="center"/></w:pPr>` + inner;
            cell = cell.slice(0, pStart) + inner + runXml + cell.slice(pEnd);
            n++;
          }
        }
        parts[j] = cell;
      }
      break;
    }
  }
  return { xml: parts.join(''), n };
}

// Vraie « ancienne valeur » à purger après le lot : Master, XXXX, N/A, underscores, tirets, vide…
const ddlIsOldValue = (t: string) => /^[\s_\-–—.:]*$/.test(t) || /^\s*(master|x{2,}|n\/a|à\s*compl[ée]ter)\s*$/i.test(t);

// Insère le n° de lot après « Lot : », « N° de lot : », « Numéro de lot : » (repli générique), PAR PARAGRAPHE :
// le lot remplace tout ce qui suit le « : » dans le nœud du libellé, et les runs suivants du même paragraphe
// contenant une ancienne valeur (Master, XXXX, underscores…) sont vidés. maxOcc = nb max (null = tous).
// strict=true : n'accepte QUE le champ produit « N° DE LOT » / « Numéro de lot » (avec « de ») — évite d'écrire
// le lot produit dans les « n°lot : » des matières premières (qui n'ont pas « de »).
function ddlFillLot(xml: string, lotEsc: string, maxOcc: number | null, strict = false): { xml: string; n: number } {
  let n = 0;
  const labelRe = strict
    ? /(?:n\s*°\s*de\s*lot|num[ée]ro\s*de\s*lot)\s*:/i
    : /(?:n\s*°\s*(?:de\s*)?lot|num[ée]ro\s*(?:de\s*)?lot|lot)\s*:/i;
  const out = xml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (para) => {
    if (maxOcc !== null && n >= maxOcc) return para;
    if (!labelRe.test(para.replace(/<[^>]+>/g, ' '))) return para;
    let labelSeen = false;
    const p2 = para.replace(/(<w:t(?:\s[^>]*)?>)([^<]*)(<\/w:t>)/g, (m0, open, txt, close) => {
      if (!labelSeen) {
        if (labelRe.test(txt)) {
          labelSeen = true;
          const idx = txt.lastIndexOf(':');
          return open + txt.slice(0, idx + 1) + ' ' + lotEsc + close;
        }
        return m0;
      }
      // après le libellé : purge de l'ancienne valeur (Master, XXXX, underscores…), le reste est conservé
      return ddlIsOldValue(txt) ? open + close : m0;
    });
    if (labelSeen) n++;
    return p2;
  });
  return { xml: out, n };
}

// Force le n° de lot dans un en-tête sans placeholder : ajouté en gras à la fin du paragraphe au texte le plus long (le titre).
function ddlForceHeaderLot(xml: string, lotEsc: string): { xml: string; n: number } {
  let best: { start: number; end: number; len: number; endsColon: boolean } | null = null;
  const re = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const t = m[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (t.length > (best?.len ?? 0)) best = { start: m.index, end: m.index + m[0].length, len: t.length, endsColon: /:\s*$/.test(t) };
  }
  if (!best || best.len === 0) return { xml, n: 0 };
  const para = xml.slice(best.start, best.end);
  const suffix = best.endsColon ? ` ${lotEsc}` : ` : ${lotEsc}`;
  const p2 = para.replace(/<\/w:p>$/, `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${suffix}</w:t></w:r></w:p>`);
  return { xml: xml.slice(0, best.start) + p2 + xml.slice(best.end), n: 1 };
}

// Liste des modèles Word approuvés, groupés par famille de produit (sous-dossiers SharePoint).
app.get('/api/prepprod/ddl-templates', authenticateToken, requireView('prepprod'), async (_req: AuthRequest, res: Response) => {
  try {
    if (!graphConfigured()) return res.status(503).json({ error: 'Connexion SharePoint non configurée sur ce serveur (fonctionne en production).' });
    const drive = process.env.GRAPH_DRIVE_ID;
    const fid = await ddlFolderId();
    const root = await graphGet(`${GRAPH}/drives/${drive}/items/${fid}/children?$top=200`);
    const families: { name: string; files: any[] }[] = [];
    const rootFiles: any[] = [];
    const mapFile = (f: any) => ({ itemId: f.id, name: f.name, modified: (f.lastModifiedDateTime || '').slice(0, 10), ...parseDdlName(f.name) });
    for (const c of root.value || []) {
      if (c.folder) {
        const sub = await graphGet(`${GRAPH}/drives/${drive}/items/${c.id}/children?$top=200`);
        const files = (sub.value || []).filter((f: any) => /\.docx?$/i.test(f.name)).map(mapFile);
        families.push({ name: c.name, files }); // les dossiers vides restent visibles (nouvelle famille en cours d'alimentation)
      } else if (/\.docx?$/i.test(c.name)) rootFiles.push(mapFile(c));
    }
    if (rootFiles.length) families.push({ name: 'Autres', files: rootFiles });
    families.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    families.forEach(f => f.files.sort((a: any, b: any) => String(a.name).localeCompare(String(b.name), 'fr')));
    res.json({ families });
  } catch (e: any) { console.error('ddl-templates', e); res.status(502).json({ error: 'SharePoint indisponible.' }); }
});

// Génère le PDF : télécharge le Word approuvé, inscrit le n° de lot (1re/2e page + tous les en-têtes), convertit en PDF via Graph.
app.post('/api/prepprod/ddl-generate', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  let tmpId: string | null = null;
  try {
    if (!graphConfigured()) return res.status(503).json({ error: 'Connexion SharePoint non configurée sur ce serveur (fonctionne en production).' });
    const { itemId, lot, family, templateName } = req.body || {};
    if (!itemId || !lot) return res.status(400).json({ error: 'Modèle et n° de lot requis' });
    const lotClean = String(lot).trim().slice(0, 40);
    const lotEsc = lotClean.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const drive = process.env.GRAPH_DRIVE_ID;
    const buf = await graphGetBuffer(`${GRAPH}/drives/${drive}/items/${encodeURIComponent(String(itemId))}/content`);
    // Modification du .docx (zip).
    // En-têtes (toutes pages) : « BATCH NUMBER » → lot (repli : « Lot : »).
    // Corps (1re/2e page) : cellule vide après « N° DE LOT »/« Numéro de lot » + « BATCH NUMBER » éventuel (repli : « Lot : »).
    const zip = new AdmZip(buf);
    let headerHits = 0, bodyHits = 0, plainAll = '';
    for (const entry of zip.getEntries()) {
      if (/^word\/header\d*\.xml$/.test(entry.entryName)) {
        let xml = entry.getData().toString('utf8');
        const rb = ddlReplaceBatchNumber(xml, lotEsc);
        xml = rb.xml; let hits = rb.n;
        if (hits === 0) { const rf = ddlFillLot(xml, lotEsc, null); xml = rf.xml; hits = rf.n; }
        // en-tête sans aucun placeholder : le lot est FORCÉ à la fin du titre (toutes les pages doivent le porter)
        if (hits === 0) { const ff = ddlForceHeaderLot(xml, lotEsc); xml = ff.xml; hits = ff.n; }
        headerHits += hits;
        zip.updateFile(entry.entryName, Buffer.from(xml, 'utf8'));
        plainAll += ' ' + xml.replace(/<[^>]+>/g, ' ');
      } else if (entry.entryName === 'word/document.xml') {
        let xml = entry.getData().toString('utf8');
        const rb = ddlReplaceBatchNumber(xml, lotEsc);
        xml = rb.xml; let hits = rb.n;
        const rc = ddlFillCellAfterLabel(xml, lotEsc, 3);
        xml = rc.xml; hits += rc.n;
        if (hits === 0) { const rf = ddlFillLot(xml, lotEsc, 2, true); xml = rf.xml; hits = rf.n; }
        bodyHits = hits;
        zip.updateFile(entry.entryName, Buffer.from(xml, 'utf8'));
        plainAll += ' ' + xml.replace(/<[^>]+>/g, ' ');
      }
    }
    if (headerHits + bodyHits === 0) return res.status(422).json({ error: "Aucun champ « Lot : » trouvé dans ce modèle — vérifiez le fichier Word." });
    // Date d'application (lue dans le document, best-effort).
    const am = /(?:application\s*date|date\s*d.application)\s*:?\s*(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})/i.exec(plainAll);
    const applicationDate = am ? am[1] : null;
    // On stocke directement le fichier WORD (.docx) rempli — c'est lui qui est joint aux emails (plus de conversion PDF).
    const p = parseDdlName(String(templateName || ''));
    const docxBuf = zip.toBuffer();
    const docName = `DDL_${lotClean}_${(p.ddlNumber || 'DDL').replace(/\s+/g, '')}.docx`;
    const ins = await pool.query(
      `INSERT INTO prepprod_ddl (lot, family, template_name, ddl_number, ddl_version, application_date, pdf_filename, pdf, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [lotClean, family || null, templateName || null, p.ddlNumber, p.version, applicationDate, docName, docxBuf, req.user?.username || null]
    );
    await logActivity(req, 'DDL_GENERATE', String(ins.rows[0].id), `DDL généré (Word) pour le lot ${lotClean} (${templateName || itemId})`);
    broadcast('ddl:changed', {});
    res.status(201).json({ id: ins.rows[0].id, headerHits, bodyHits, applicationDate, pdfName: docName });
  } catch (e: any) {
    if (tmpId) graphDeleteItem(tmpId);
    console.error('ddl-generate', e);
    res.status(502).json({ error: 'Génération impossible : ' + String(e.message || e).slice(0, 160) });
  }
});

app.get('/api/prepprod/ddl', authenticateToken, requireView('prepprod'), async (_req: AuthRequest, res: Response) => {
  try {
    const r = await pool.query(`SELECT id, lot, family, template_name, ddl_number, ddl_version, application_date, pdf_filename, status, created_by, to_char(created_at,'YYYY-MM-DD HH24:MI') AS created_at FROM prepprod_ddl ORDER BY created_at DESC LIMIT 300`);
    res.json({ files: r.rows });
  } catch (e) { console.error('ddl list', e); res.status(500).json({ error: 'Erreur serveur' }); }
});

app.get('/api/prepprod/ddl/:id/pdf', authenticateToken, requireView('prepprod'), async (req: AuthRequest, res: Response) => {
  try {
    const r = await pool.query('SELECT pdf_filename, pdf FROM prepprod_ddl WHERE id=$1', [req.params.id]);
    if (!r.rows[0] || !r.rows[0].pdf) return res.status(404).json({ error: 'Introuvable' });
    res.setHeader('Content-Type', ddlAttMime(r.rows[0].pdf_filename));
    res.setHeader('Content-Disposition', `attachment; filename="${r.rows[0].pdf_filename || 'ddl.docx'}"`);
    res.send(r.rows[0].pdf);
  } catch (e) { console.error('ddl pdf', e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// Demande de validation au PRRC : crée un BROUILLON Outlook (PDF en pièce jointe) dans la boîte pro
// (DDL_MAIL_FROM) via Graph, puis renvoie son webLink. Abdel l'ouvre et clique « Envoyer » lui-même.
// Nécessite la permission Graph « Mail.ReadWrite ».
const DDL_PRRC_EMAIL = process.env.DDL_PRRC_EMAIL || 'f.hadjab@louna-aesthetics.com';
const DDL_MAIL_FROM = process.env.DDL_MAIL_FROM || 'a.hadjab@louna-aesthetics.com';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
// Type de la pièce jointe selon l'extension du fichier stocké (.docx = Word, sinon PDF pour les anciens enregistrements).
const ddlAttMime = (name?: string) => /\.docx$/i.test(String(name || '')) ? DOCX_MIME : 'application/pdf';
app.post('/api/prepprod/ddl/:id/send-validation', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    if (!graphConfigured()) return res.json({ sent: false, reason: 'graph-off' });
    const r = await pool.query('SELECT lot, family, template_name, ddl_number, ddl_version, application_date, pdf_filename, pdf FROM prepprod_ddl WHERE id=$1', [req.params.id]);
    const row = r.rows[0];
    if (!row || !row.pdf) return res.status(404).json({ error: 'PDF introuvable' });
    // Date de début de fabrication du lot (onglet Tracking Production) + échéance de validation à 5 j ouvrés avant.
    let startDate: string | null = null;
    try { const bq = await pool.query('SELECT startdate FROM batches WHERE UPPER(id)=UPPER($1) LIMIT 1', [row.lot]); startDate = bq.rows[0]?.startdate || null; } catch { /* best-effort */ }
    const validBy = startDate ? subBusinessDaysIso(startDate, 5) : null;
    const subject = `Validation DDL – lot ${row.lot}${row.ddl_number ? ` (${row.ddl_number} v${row.ddl_version || '—'})` : ''}${startDate ? ` – production le ${fmtFrDate(startDate)}` : ''}`;
    const content =
`<div style="font-family:Aptos,'Segoe UI',Calibri,sans-serif;font-size:12pt;color:#1e293b;line-height:1.5">
  <p>Bonjour Farid,</p>
  <p>Merci de bien vouloir <b>valider ET imprimer le Dossier de Lot (DDL)</b> ci-joint (fichier Word).</p>
  <p style="margin-bottom:4px"><b>Informations du lot</b></p>
  <ul style="margin:4px 0 16px 22px;padding:0">
    <li style="margin:3px 0"><b>Numéro de lot :</b> ${row.lot}</li>
    <li style="margin:3px 0"><b>Type de produit :</b> ${row.family || '—'}</li>
    <li style="margin:3px 0"><b>Modèle DDL :</b> ${row.ddl_number || row.template_name || '—'} · version ${row.ddl_version || '—'}</li>
    <li style="margin:3px 0"><b>Date de début de fabrication :</b> ${startDate ? fmtFrDate(startDate) : 'à confirmer'}</li>
  </ul>
  <p style="padding:10px 14px;background:#fff7ed;border-left:4px solid #f59e0b;border-radius:4px;margin:12px 0">
    <b>Échéance :</b> merci de <b>valider et imprimer</b> ce DDL <b>au plus tard le ${validBy ? fmtFrDate(validBy) : 'à définir dès que la date de production est connue'}</b>${validBy ? ' (soit <b>5 jours ouvrés avant la date de production</b>)' : ''}, puis de me le <b>mettre à disposition (validé et imprimé)</b> afin que je puisse finaliser le dossier de lot dans les délais.
  </p>
  <p>Merci de me confirmer la <b>validation et l'impression</b>, ou de me signaler toute correction nécessaire.</p>
  <p style="margin-top:16px">Bien cordialement,<br><b>Abdel HADJAB</b><br>Operation Director<br>Louna Aesthetics SAS</p>
</div>`;
    const draftPayload = JSON.stringify({
      subject,
      body: { contentType: 'HTML', content },
      toRecipients: [{ emailAddress: { address: DDL_PRRC_EMAIL } }],
      attachments: [{
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: row.pdf_filename || `DDL_${row.lot}.docx`,
        contentType: ddlAttMime(row.pdf_filename),
        contentBytes: Buffer.from(row.pdf).toString('base64'),
      }],
    });
    // Création d'un brouillon (POST .../messages) — reste dans les Brouillons tant qu'Abdel n'a pas cliqué Envoyer.
    // En cas de 401/403, on refait UNE tentative avec un jeton FRAIS (le droit vient peut-être d'être accordé côté Azure).
    const postDraft = (tok: string) => fetch(`${GRAPH}/users/${encodeURIComponent(DDL_MAIL_FROM)}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      body: draftPayload,
    });
    let resp = await postDraft(await graphToken());
    if (resp.status === 401 || resp.status === 403) resp = await postDraft(await graphToken(true));
    const j: any = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      console.error('ddl create-draft', resp.status, j);
      return res.json({ draft: false, reason: `graph-${resp.status}`, code: j.error?.code || '', detail: String(j.error?.message || '').slice(0, 200) });
    }
    await pool.query("UPDATE prepprod_ddl SET status='EN_VALIDATION' WHERE id=$1", [req.params.id]);
    await logActivity(req, 'DDL_SEND_VALIDATION', req.params.id, `Brouillon de validation créé pour le lot ${row.lot} (PRRC ${DDL_PRRC_EMAIL}, PDF joint)`);
    broadcast('ddl:changed', {});
    res.json({ draft: true, webLink: j.webLink || null, to: DDL_PRRC_EMAIL });
  } catch (e: any) { console.error('ddl send-validation', e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// Packing List : brouillon Outlook « Goods Ready for Collection » (corps HTML Aptos 12 + Packing List & Facture en PDF joints).
app.post('/api/pl/email-draft', authenticateToken, requireView('pl'), async (req: AuthRequest, res: Response) => {
  try {
    if (!graphConfigured()) return res.json({ draft: false, reason: 'graph-off' });
    const { subject, bodyHtml, attachments } = req.body || {};
    const atts = (Array.isArray(attachments) ? attachments : []).filter((a: any) => a && a.contentBytes).slice(0, 6).map((a: any) => ({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: String(a.name || 'document.pdf').slice(0, 120),
      contentType: 'application/pdf',
      contentBytes: String(a.contentBytes),
    }));
    const draftPayload = JSON.stringify({
      subject: String(subject || 'Goods Ready for Collection').slice(0, 300),
      body: { contentType: 'HTML', content: String(bodyHtml || '') },
      attachments: atts,
    });
    const postDraft = (tok: string) => fetch(`${GRAPH}/users/${encodeURIComponent(DDL_MAIL_FROM)}/messages`, {
      method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: draftPayload,
    });
    let resp = await postDraft(await graphToken());
    if (resp.status === 401 || resp.status === 403) resp = await postDraft(await graphToken(true));
    const j: any = await resp.json().catch(() => ({}));
    if (!resp.ok) { console.error('pl email-draft', resp.status, j); return res.json({ draft: false, reason: `graph-${resp.status}`, detail: String(j.error?.message || '').slice(0, 200) }); }
    await logActivity(req, 'PL_EMAIL_DRAFT', j.id || '', 'Brouillon Outlook « Goods Ready for Collection » créé (Packing List + Facture joints)');
    res.json({ draft: true, webLink: j.webLink || null });
  } catch (e: any) { console.error('pl email-draft', e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// Construit un fichier email .eml (RFC 822) prêt à envoyer, avec le PDF EN PIÈCE JOINTE.
// L'en-tête « X-Unsent: 1 » fait ouvrir le fichier dans Outlook comme un nouveau message éditable (destinataire/objet/corps/PJ pré-remplis).
function buildValidationEml(to: string, subject: string, body: string, filename: string, pdf: Buffer): Buffer {
  const boundary = 'LFDDL_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  const wrap = (b64: string) => b64.replace(/(.{76})/g, '$1\r\n');
  const encSubj = '=?UTF-8?B?' + Buffer.from(subject, 'utf8').toString('base64') + '?=';
  const safeName = filename.replace(/[\r\n"]/g, '');
  const lines = [
    'X-Unsent: 1',
    `To: ${to}`,
    `Subject: ${encSubj}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="utf-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap(Buffer.from(body, 'utf8').toString('base64')),
    `--${boundary}`,
    `Content-Type: application/pdf; name="${safeName}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${safeName}"`,
    '',
    wrap(pdf.toString('base64')),
    `--${boundary}--`,
    '',
  ];
  return Buffer.from(lines.join('\r\n'), 'utf8');
}

// Télécharge un email .eml prêt à envoyer (PDF déjà joint) — marche sans aucune permission Graph « Mail.Send ».
app.get('/api/prepprod/ddl/:id/email-eml', authenticateToken, requireView('prepprod'), async (req: AuthRequest, res: Response) => {
  try {
    const r = await pool.query('SELECT lot, family, template_name, ddl_number, ddl_version, application_date, pdf_filename, pdf FROM prepprod_ddl WHERE id=$1', [req.params.id]);
    const row = r.rows[0];
    if (!row || !row.pdf) return res.status(404).json({ error: 'PDF introuvable' });
    const subject = `Validation DDL – lot ${row.lot}${row.ddl_number ? ` (${row.ddl_number} v${row.ddl_version || '—'})` : ''}`;
    const body =
      `Bonjour Farid,\n\nMerci de valider le DDL du lot ${row.lot} (PDF en pièce jointe).\n` +
      `- Modèle : ${row.ddl_number || row.template_name || '—'} · version ${row.ddl_version || '—'}${row.application_date ? ` · date d'application ${row.application_date}` : ''}\n` +
      `- Type de produit : ${row.family || '—'}\n\nMerci !`;
    const filename = row.pdf_filename || `DDL_${row.lot}.pdf`;
    const eml = buildValidationEml(DDL_PRRC_EMAIL, subject, body, filename, Buffer.from(row.pdf));
    res.setHeader('Content-Type', 'message/rfc822');
    res.setHeader('Content-Disposition', `attachment; filename="Validation_DDL_${String(row.lot).replace(/[^A-Za-z0-9_-]/g, '')}.eml"`);
    res.send(eml);
  } catch (e: any) { console.error('ddl email-eml', e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// Envoi GROUPÉ : un seul brouillon Outlook avec TOUS les PDF des lots sélectionnés en pièces jointes.
app.post('/api/prepprod/ddl/send-validation-bulk', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    if (!graphConfigured()) return res.json({ draft: false, reason: 'graph-off' });
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((x: any) => parseInt(x, 10)).filter((x: number) => !isNaN(x)) : [];
    if (!ids.length) return res.status(400).json({ error: 'Aucun lot sélectionné' });
    const r = await pool.query('SELECT id, lot, family, template_name, ddl_number, ddl_version, application_date, pdf_filename, pdf FROM prepprod_ddl WHERE id = ANY($1) ORDER BY lot', [ids]);
    const rows = r.rows.filter((x: any) => x.pdf);
    if (!rows.length) return res.status(404).json({ error: 'Aucun PDF trouvé pour la sélection' });
    const lots = rows.map((x: any) => x.lot);
    const subject = `Validation DDL – ${rows.length > 1 ? `${rows.length} lots` : `lot ${lots[0]}`} : ${lots.join(', ')}`;
    // Dates de début de fabrication (onglet Tracking Production) par lot → échéance de validation 5 j ouvrés avant.
    const startMap: Record<string, string> = {};
    try {
      const bq = await pool.query('SELECT id, startdate FROM batches WHERE UPPER(id) = ANY($1)', [lots.map((l: any) => String(l).toUpperCase())]);
      for (const b of bq.rows) if (b.startdate) startMap[String(b.id).toUpperCase()] = b.startdate;
    } catch { /* best-effort */ }
    const td = 'border:1px solid #cbd5e1;padding:6px 10px;text-align:left';
    const trs = rows.map((x: any) => {
      const sd = startMap[String(x.lot).toUpperCase()] || null;
      const vb = sd ? subBusinessDaysIso(sd, 5) : null;
      return `<tr><td style="${td}">${x.lot}</td><td style="${td}">${x.family || '—'}</td><td style="${td}">${x.ddl_number || x.template_name || '—'} v${x.ddl_version || '—'}</td><td style="${td}">${sd ? fmtFrDate(sd) : 'à confirmer'}</td><td style="${td}"><b>${vb ? fmtFrDate(vb) : '—'}</b></td></tr>`;
    }).join('');
    const content =
`<div style="font-family:Aptos,'Segoe UI',Calibri,sans-serif;font-size:12pt;color:#1e293b;line-height:1.5">
  <p>Bonjour Farid,</p>
  <p>Merci de bien vouloir <b>valider ET imprimer les Dossiers de Lot (DDL)</b> ci-joints (fichiers Word).</p>
  <p>Pour chaque lot, merci de <b>valider et imprimer au plus tard 5 jours ouvrés avant la date de production</b> (colonne « Valider avant »), puis de me les <b>mettre à disposition (validés et imprimés)</b> afin que je puisse finaliser le dossier de lot dans les délais.</p>
  <table style="border-collapse:collapse;font-size:11pt;margin:10px 0">
    <thead><tr style="background:#f1f5f9"><th style="${td}">Lot</th><th style="${td}">Type de produit</th><th style="${td}">Modèle DDL</th><th style="${td}">Début fabrication</th><th style="${td}">Valider avant</th></tr></thead>
    <tbody>${trs}</tbody>
  </table>
  <p>Merci de me confirmer la <b>validation et l'impression</b>, ou de me signaler toute correction nécessaire.</p>
  <p style="margin-top:16px">Bien cordialement,<br><b>Abdel HADJAB</b><br>Operation Director<br>Louna Aesthetics SAS</p>
</div>`;
    const attachments = rows.map((x: any) => ({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: x.pdf_filename || `DDL_${x.lot}.docx`,
      contentType: ddlAttMime(x.pdf_filename),
      contentBytes: Buffer.from(x.pdf).toString('base64'),
    }));
    const payload = JSON.stringify({ subject, body: { contentType: 'HTML', content }, toRecipients: [{ emailAddress: { address: DDL_PRRC_EMAIL } }], attachments });
    const postDraft = (tok: string) => fetch(`${GRAPH}/users/${encodeURIComponent(DDL_MAIL_FROM)}/messages`, {
      method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: payload,
    });
    let resp = await postDraft(await graphToken());
    if (resp.status === 401 || resp.status === 403) resp = await postDraft(await graphToken(true));
    const j: any = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      console.error('ddl bulk draft', resp.status, j);
      return res.json({ draft: false, reason: `graph-${resp.status}`, code: j.error?.code || '', detail: String(j.error?.message || '').slice(0, 200) });
    }
    await pool.query("UPDATE prepprod_ddl SET status='EN_VALIDATION' WHERE id = ANY($1) AND status='GENERE'", [rows.map((x: any) => x.id)]);
    await logActivity(req, 'DDL_SEND_VALIDATION_BULK', null, `Brouillon groupé créé pour ${rows.length} lot(s) : ${lots.join(', ')}`);
    broadcast('ddl:changed', {});
    res.json({ draft: true, webLink: j.webLink || null, to: DDL_PRRC_EMAIL, count: rows.length });
  } catch (e: any) { console.error('ddl bulk', e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// Avancement du suivi : Génération PDF → Validation QA → Validé → Imprimé.
const DDL_STATUSES = ['GENERE', 'EN_VALIDATION', 'VALIDE', 'IMPRIME'];
app.patch('/api/prepprod/ddl/:id', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    const status = String(req.body?.status || '');
    if (!DDL_STATUSES.includes(status)) return res.status(400).json({ error: 'Statut invalide' });
    const r = await pool.query('UPDATE prepprod_ddl SET status=$2 WHERE id=$1 RETURNING lot', [req.params.id, status]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Introuvable' });
    await logActivity(req, 'DDL_STATUS', req.params.id, `DDL du lot ${r.rows[0].lot} → ${status}`);
    broadcast('ddl:changed', {});
    res.json({ ok: true });
  } catch (e) { console.error('ddl status', e); res.status(500).json({ error: 'Erreur serveur' }); }
});

app.delete('/api/prepprod/ddl/:id', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    await pool.query('DELETE FROM prepprod_ddl WHERE id=$1', [req.params.id]);
    await logActivity(req, 'DDL_DELETE', req.params.id, 'DDL généré supprimé');
    broadcast('ddl:changed', {});
    res.json({ ok: true });
  } catch (e) { console.error('ddl delete', e); res.status(500).json({ error: 'Erreur serveur' }); }
});

async function qmsAudit(actionType: string, resourceId: string | null, description: string) {
  try {
    await pool.query(
      `INSERT INTO audit_logs (username, action_type, resource_id, description) VALUES ($1, $2, $3, $4)`,
      ['Système (sync)', actionType, resourceId, description]
    );
    io.emit('audit:logged', { timestamp: new Date(), username: 'Système (sync)', action_type: actionType, resource_id: resourceId, description });
  } catch (e) { console.error('qmsAudit', e); }
}

// Segments du chemin SOUS le dossier Assurance Qualité (le dernier = l'élément lui-même).
function qmsRelSegments(item: any): string[] {
  const raw: string = item.parentReference?.path || '';
  const pp = raw.includes('root:') ? raw.split('root:')[1] : raw;
  const segs = pp.split('/').filter(Boolean).map((s: string) => { try { return decodeURIComponent(s); } catch { return s; } });
  segs.push(item.name);
  const qa = process.env.GRAPH_QA_FOLDER_NAME || '02_ASSURANCE QUALITÉ';
  const idx = segs.findIndex((s) => s === qa);
  return idx >= 0 ? segs.slice(idx + 1) : segs;
}
function qmsCodeFromFolder(name: string): string {
  const m = (name || '').match(/^(\d{2})/);
  if (m) return m[1];
  if (/manual/i.test(name)) return 'MANUAL';
  return (name || '').slice(0, 12).toUpperCase();
}
function qmsDocType(folder: string | null): string {
  const l = (folder || '').toLowerCase();
  if (l.includes('procedure') || l.includes('procédure')) return 'PROCEDURE';
  if (l.includes('instruction')) return 'INSTRUCTION';
  if (l.includes('form')) return 'FORM';
  if (l.includes('list')) return 'LIST';
  if (l.includes('record')) return 'RECORD';
  if (l.includes('manual')) return 'MANUAL';
  return 'AUTRE';
}

async function loadProcessMap(): Promise<Map<string, { id: number; code: string }>> {
  const r = await pool.query(`SELECT id, folder_name, code FROM qms_processes`);
  const m = new Map<string, { id: number; code: string }>();
  for (const row of r.rows) if (row.folder_name) m.set(row.folder_name, { id: row.id, code: row.code });
  return m;
}

// Maîtrise documentaire : on indexe TOUS les fichiers (records inclus). L'état du cycle de vie
// est dérivé du chemin pour permettre le filtrage (approuvé / en modification / archive / record).
function qmsLifecycle(rel: string[]): string {
  const segs = rel.map((s) => s.toLowerCase());
  if (segs.some((s) => s.includes('record'))) return 'RECORD';
  if (segs.some((s) => s.includes('archive'))) return 'ARCHIVE';
  if (segs.some((s) => s.includes('modification'))) return 'IN_MODIF';
  if (segs.some((s) => s.includes('approved'))) return 'APPROVED';
  return 'OTHER';
}

async function qmsApplyItem(item: any, driveId: string, procMap: Map<string, any>, stats: any): Promise<boolean> {
  if (item.deleted) {
    const r = await pool.query(
      `UPDATE qms_documents SET soft_deleted = TRUE, deleted_flag_seen = FALSE, updated_at = CURRENT_TIMESTAMP
       WHERE graph_item_id = $1 AND soft_deleted = FALSE RETURNING name, path`, [item.id]);
    if (r.rows[0]) { stats.deleted++; await qmsAudit('QMS_DOC_DELETED', item.id, `Document supprimé dans OneDrive : ${r.rows[0].path || r.rows[0].name}`); }
    return false;
  }
  const rel = qmsRelSegments(item);
  if (item.folder) return false; // on n'indexe pas les dossiers eux-mêmes, mais on garde tous les fichiers
  const isFolder = false;
  const lifecycle = qmsLifecycle(rel);
  const procFolder = rel.length ? rel[0] : null;
  const typeFolder = rel.length > 1 ? rel[1] : null;
  const procInfo = procFolder ? procMap.get(procFolder) : null;
  const processId = procInfo?.id ?? null;
  const processCode = procInfo?.code ?? (procFolder ? qmsCodeFromFolder(procFolder) : null);
  const docType = isFolder ? null : qmsDocType(typeFolder);
  await pool.query(
    `INSERT INTO qms_documents
       (graph_item_id, drive_id, name, is_folder, doc_type, process_id, process_code, parent_id, path,
        version, etag, web_url, mime_type, size_bytes, last_modified, modified_by, created_date, lifecycle_state, soft_deleted, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,FALSE,CURRENT_TIMESTAMP)
     ON CONFLICT (graph_item_id) DO UPDATE SET
       name=EXCLUDED.name, is_folder=EXCLUDED.is_folder, doc_type=EXCLUDED.doc_type, process_id=EXCLUDED.process_id,
       process_code=EXCLUDED.process_code, parent_id=EXCLUDED.parent_id, path=EXCLUDED.path, version=EXCLUDED.version,
       etag=EXCLUDED.etag, web_url=EXCLUDED.web_url, mime_type=EXCLUDED.mime_type, size_bytes=EXCLUDED.size_bytes,
       last_modified=EXCLUDED.last_modified, modified_by=EXCLUDED.modified_by, created_date=EXCLUDED.created_date, lifecycle_state=EXCLUDED.lifecycle_state, soft_deleted=FALSE, updated_at=CURRENT_TIMESTAMP`,
    [item.id, driveId, item.name, isFolder, docType, processId, processCode, item.parentReference?.id || null,
     rel.join('/'), item.cTag || item.eTag || null, item.eTag || null, item.webUrl || null,
     item.file?.mimeType || null, item.size != null ? item.size : null,
     item.lastModifiedDateTime || null, item.lastModifiedBy?.user?.displayName || null, item.createdDateTime || null, lifecycle]
  );
  stats.upserted++;
  return true;
}

async function ensureSyncStateRow(driveId: string, root: string) {
  await pool.query(`INSERT INTO qms_sync_state (drive_id, root_item_id) VALUES ($1,$2) ON CONFLICT (drive_id, root_item_id) DO NOTHING`, [driveId, root]);
}

// Passe delta : ne traite que les changements depuis le dernier deltaLink (ou catalogue complet si absent).
async function qmsRunDelta(reason: string) {
  if (!graphConfigured()) return;
  if (qmsRunning) { qmsPending = true; return; }
  qmsRunning = true;
  const driveId = process.env.GRAPH_DRIVE_ID as string;
  const root = process.env.GRAPH_ROOT_ITEM_ID as string;
  try {
    await ensureSyncStateRow(driveId, root);
    await pool.query(`UPDATE qms_sync_state SET last_attempt=CURRENT_TIMESTAMP, running=TRUE, last_error=NULL WHERE drive_id=$1 AND root_item_id=$2`, [driveId, root]);
    const procMap = await loadProcessMap();
    const st = await pool.query(`SELECT delta_link FROM qms_sync_state WHERE drive_id=$1 AND root_item_id=$2`, [driveId, root]);
    let url: string | null = st.rows[0]?.delta_link || `${GRAPH}/drives/${driveId}/items/${root}/delta?$select=${QMS_SELECT}`;
    const stats = { upserted: 0, deleted: 0, pages: 0 };
    let deltaLink: string | null = null;
    while (url) {
      const page: any = await graphGet(url);
      stats.pages++;
      for (const item of page.value || []) {
        if (item.id === root) continue;
        await qmsApplyItem(item, driveId, procMap, stats);
      }
      if (page['@odata.nextLink']) { url = page['@odata.nextLink']; }
      else { deltaLink = page['@odata.deltaLink'] || null; url = null; }
    }
    await pool.query(
      `UPDATE qms_sync_state SET delta_link=$3, last_success=CURRENT_TIMESTAMP, running=FALSE,
         full_count=(SELECT COUNT(*) FROM qms_documents WHERE soft_deleted=FALSE AND is_folder=FALSE)
       WHERE drive_id=$1 AND root_item_id=$2`, [driveId, root, deltaLink]);
    if (stats.upserted + stats.deleted > 0) await qmsAudit('QMS_SYNC', null, `Sync (${reason}) : ${stats.upserted} ajout/maj, ${stats.deleted} suppression(s), ${stats.pages} page(s)`);
    broadcast('qms:changed', {});
    console.log(`✅ QMS sync (${reason}) : ${stats.upserted} upsert, ${stats.deleted} suppr, ${stats.pages} page(s)`);
    await qmsRefreshExcelData(); // Option A : re-synchronise les données métier (fournisseurs…) depuis les fichiers Excel
  } catch (e: any) {
    console.error('❌ QMS sync', e);
    await pool.query(`UPDATE qms_sync_state SET running=FALSE, last_error=$3 WHERE drive_id=$1 AND root_item_id=$2`, [driveId, root, String(e?.message || e).slice(0, 500)]).catch(() => {});
  } finally {
    qmsRunning = false;
    if (qmsPending) { qmsPending = false; setTimeout(() => qmsRunDelta('signal'), 1000); }
  }
}

// Réconciliation : énumération complète → soft-delete des éléments absents de OneDrive (filet de sécurité).
async function qmsReconcile(reason: string) {
  if (!graphConfigured()) return;
  if (qmsRunning) { qmsPending = true; return; }
  qmsRunning = true;
  const driveId = process.env.GRAPH_DRIVE_ID as string;
  const root = process.env.GRAPH_ROOT_ITEM_ID as string;
  try {
    const procMap = await loadProcessMap();
    const seen = new Set<string>();
    let url: string | null = `${GRAPH}/drives/${driveId}/items/${root}/delta?$select=${QMS_SELECT}`;
    let deltaLink: string | null = null;
    const stats = { upserted: 0, deleted: 0, pages: 0 };
    while (url) {
      const page: any = await graphGet(url);
      for (const item of page.value || []) {
        if (item.id === root) continue;
        const stored = await qmsApplyItem(item, driveId, procMap, stats);
        if (stored) seen.add(item.id);
      }
      if (page['@odata.nextLink']) { url = page['@odata.nextLink']; }
      else { deltaLink = page['@odata.deltaLink'] || null; url = null; }
    }
    let orphans = 0;
    if (seen.size > 0) {
      const o = await pool.query(`SELECT graph_item_id, path, name FROM qms_documents WHERE soft_deleted=FALSE AND graph_item_id <> ALL($1)`, [Array.from(seen)]);
      for (const row of o.rows) {
        await pool.query(`UPDATE qms_documents SET soft_deleted=TRUE, deleted_flag_seen=FALSE, updated_at=CURRENT_TIMESTAMP WHERE graph_item_id=$1`, [row.graph_item_id]);
        await qmsAudit('QMS_DOC_DELETED', row.graph_item_id, `Réconciliation : élément absent de OneDrive — ${row.path || row.name}`);
        orphans++;
      }
    }
    await pool.query(
      `UPDATE qms_sync_state SET delta_link=$3, last_success=CURRENT_TIMESTAMP, running=FALSE,
         full_count=(SELECT COUNT(*) FROM qms_documents WHERE soft_deleted=FALSE AND is_folder=FALSE)
       WHERE drive_id=$1 AND root_item_id=$2`, [driveId, root, deltaLink]);
    await qmsAudit('QMS_RECONCILE', null, `Réconciliation (${reason}) : ${seen.size} éléments vivants, ${orphans} disparu(s)`);
    broadcast('qms:changed', {});
    console.log(`✅ QMS réconciliation (${reason}) : ${seen.size} vivants, ${orphans} disparu(s)`);
  } catch (e: any) {
    console.error('❌ QMS réconciliation', e);
    await pool.query(`UPDATE qms_sync_state SET running=FALSE, last_error=$3 WHERE drive_id=$1 AND root_item_id=$2`, [driveId, root, String(e?.message || e).slice(0, 500)]).catch(() => {});
  } finally {
    qmsRunning = false;
    if (qmsPending) { qmsPending = false; setTimeout(() => qmsRunDelta('signal'), 1000); }
  }
}

// ---- Auto-sync des données QMS depuis leurs fichiers Excel sources (Option A : rafraîchi à chaque synchro) ----
// Le contenu des fichiers est relu et la table métier est mise en miroir. La présentation front ne change pas.
const qmsClean = (v: any): string | null => { const s = String(v ?? '').replace(/\s+/g, ' ').trim(); return (!s || s.toUpperCase() === 'N/A') ? null : s; };

// Extrait UNE date ISO valide d'une cellule (gère « 2029-07-01 », « 04/03/2028 05/03/2027 » multi-dates, « N/A ») → yyyy-mm-dd ou null.
// Indispensable car cert_expiration est de type DATE : une valeur non-date ferait planter l'INSERT.
function parseCertDate(v: any): string | null {
  const s = String(v ?? '').trim();
  const iso = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const fr = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (fr) return `${fr[3]}-${fr[2].padStart(2, '0')}-${fr[1].padStart(2, '0')}`;
  return null;
}

// Télécharge le contenu d'un fichier Graph par son item id.
async function graphDownloadById(itemId: string): Promise<Buffer> {
  const driveId = process.env.GRAPH_DRIVE_ID as string;
  const token = await graphToken();
  const r = await fetch(`${GRAPH}/drives/${driveId}/items/${itemId}/content`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Graph download ${r.status} item ${itemId}`);
  return Buffer.from(await r.arrayBuffer());
}
// Récupère le fichier source par son NOM via l'index QMS (fiable : l'item Graph est déjà indexé par la synchro).
// Localise le fichier par son NOM via la recherche Graph du drive (robuste : indépendant de l'index et du chemin).
async function qmsFindItemId(name: string): Promise<string> {
  const driveId = process.env.GRAPH_DRIVE_ID as string;
  const j = await graphGet(`${GRAPH}/drives/${driveId}/root/search(q='${encodeURIComponent(name)}')?$select=id,name,file&$top=50`);
  const files = (j.value || []).filter((x: any) => x.file);
  const hit = files.find((x: any) => x.name === name) || files.find((x: any) => String(x.name || '').trim() === name.trim()) || files[0];
  if (!hit) throw new Error(`Fichier « ${name} » introuvable via recherche Graph (drive ${driveId})`);
  return hit.id;
}
async function qmsSourceFileBuffer(name: string): Promise<Buffer> {
  return graphDownloadById(await qmsFindItemId(name));
}
// Dossier SharePoint des NC : résout le lien de partage, liste les sous-dossiers,
// et renvoie une map { numéro NC (majuscules) → webUrl du sous-dossier } + le lien du dossier racine.
const QMS_NC_FOLDER_URL = process.env.QMS_NC_FOLDER_URL ||
  'https://lounaaesthetics.sharepoint.com/:f:/r/sites/LOUNAAESTHETICS/Documents%20partages/General/02_ASSURANCE%20QUALIT%C3%89/03%20-%20Quality/05%20-%20Records/03%20-%20Non-conformities?csf=1&web=1&e=gWGAql';
function shareIdFromUrl(url: string): string {
  const b64 = Buffer.from(url).toString('base64').replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');
  return 'u!' + b64;
}
async function qmsFolderMap(shareUrl: string): Promise<{ base: string | null; byExtId: Map<string, string> }> {
  const byExtId = new Map<string, string>();
  let base: string | null = null;
  try {
    const item: any = await graphGet(`${GRAPH}/shares/${shareIdFromUrl(shareUrl)}/driveItem?$select=id,webUrl,parentReference`);
    base = item?.webUrl || null;
    const driveId = item?.parentReference?.driveId || process.env.GRAPH_DRIVE_ID;
    let url: string | null = `${GRAPH}/drives/${driveId}/items/${item.id}/children?$select=name,webUrl,folder&$top=200`;
    while (url) {
      const j: any = await graphGet(url);
      for (const c of j.value || []) {
        const m = String(c.name || '').match(/NC[-\s_]?(\d[\d\s\-_]*\d)/i);
        if (m && c.webUrl) byExtId.set(m[1].replace(/\D/g, ''), c.webUrl); // clé = chiffres seuls
      }
      url = j['@odata.nextLink'] || null;
    }
  } catch (e) { console.error('qmsFolderMap NC', (e as any)?.message || e); }
  return { base, byExtId };
}

// Lien SharePoint (webUrl) du fichier de suivi — pour rendre les N° NC/CAPA cliquables.
async function qmsSourceFileUrl(name: string): Promise<string | null> {
  try {
    const driveId = process.env.GRAPH_DRIVE_ID as string;
    const j = await graphGet(`${GRAPH}/drives/${driveId}/root/search(q='${encodeURIComponent(name)}')?$select=id,name,file,webUrl&$top=50`);
    const files = (j.value || []).filter((x: any) => x.file);
    const hit = files.find((x: any) => String(x.name || '').trim() === name.trim()) || files[0];
    return hit?.webUrl || null;
  } catch { return null; }
}

const QMS_SUPPLIER_FILE = process.env.QMS_SUPPLIER_FILE_NAME || 'Supplier Tracking List_260617.xlsx';

// Fournisseurs : onglet « Supplier Tracking List », en-tête ligne 17 (index 16), données dès l'index 17.
async function qmsRefreshSuppliers(): Promise<number> {
  const mod: any = await import('xlsx'); const XLSX = mod.default ?? mod;
  const buf = await qmsSourceFileBuffer(QMS_SUPPLIER_FILE);
  const wb = XLSX.read(buf, { type: 'buffer' });
  const ws = wb.Sheets['Supplier Tracking List'];
  if (!ws) throw new Error('Onglet « Supplier Tracking List » introuvable');
  const aoa: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
  const seen: string[] = [];
  let n = 0;
  for (let i = 17; i < aoa.length; i++) {
    const row = aoa[i]; if (!row) continue;
    const name = qmsClean(row[1]); if (!name) continue;
    try {
      await pool.query(
        `INSERT INTO qms_suppliers (ext_id, name, status, classification, type, supply_type, product, cert_ref, cert_expiration, quality_agreement)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (name) DO UPDATE SET ext_id=EXCLUDED.ext_id, status=EXCLUDED.status, classification=EXCLUDED.classification, type=EXCLUDED.type,
           supply_type=EXCLUDED.supply_type, product=EXCLUDED.product, cert_ref=EXCLUDED.cert_ref, cert_expiration=EXCLUDED.cert_expiration,
           quality_agreement=EXCLUDED.quality_agreement, imported_at=CURRENT_TIMESTAMP`,
        [qmsClean(row[0]), name, qmsClean(row[2]), qmsClean(row[5]), qmsClean(row[6]), qmsClean(row[7]), qmsClean(row[8]), qmsClean(row[9]), parseCertDate(row[10]), qmsClean(row[13])]
      );
      seen.push(name); n++;
    } catch (e) { console.error(`QMS supplier upsert « ${name} »`, (e as any)?.message || e); }
  }
  // Miroir : retire les fournisseurs absents du fichier (garde-fou : seulement si on a lu des lignes).
  if (n > 0) await pool.query(`DELETE FROM qms_suppliers WHERE name <> ALL($1)`, [seen]);
  return n;
}

// Orchestrateur : relit tous les fichiers sources et met à jour les tables métier (appelé après chaque synchro Graph).
const QMS_REGISTRE_FILE = process.env.QMS_REGISTRE_FILE_NAME || 'DOC-0014v00_Registre_Commandes.xlsx';

// Registre des commandes : onglet « order follow up », en-tête ligne 6 (index 5), données dès l'index 6.
// Miroir complet (remplacement total) car le fichier n'a pas de clé unique par ligne.
async function qmsRefreshRegistreCommandes(): Promise<number> {
  const mod: any = await import('xlsx'); const XLSX = mod.default ?? mod;
  const buf = await qmsSourceFileBuffer(QMS_REGISTRE_FILE);
  const wb = XLSX.read(buf, { type: 'buffer' });
  const ws = wb.Sheets['order follow up'];
  if (!ws) throw new Error('Onglet « order follow up » introuvable');
  const aoa: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
  const rows: any[][] = [];
  for (let i = 6; i < aoa.length; i++) {
    const r = aoa[i]; if (!r) continue;
    const year = qmsClean(r[0]); const name = qmsClean(r[3]);
    if (!year && !name && !qmsClean(r[1])) continue;
    const u = parseInt(String(r[5] ?? '').replace(/[^\d-]/g, ''), 10);
    rows.push([
      year ? (parseInt(year, 10) || null) : null,
      qmsClean(r[1]), qmsClean(r[2]), name, qmsClean(r[4]),
      isNaN(u) ? null : u, qmsClean(r[6]), qmsClean(r[7]), qmsClean(r[8]),
    ]);
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM registre_commandes');
    for (const row of rows) {
      await client.query(
        `INSERT INTO registre_commandes (year, country, product_class, commercial_name, ref, units, batch_no, exp_date, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, row);
    }
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
  return rows.length;
}

// Date tolérante : ISO, jj/mm/aaaa, ou « MMM-YY » anglais (ex. Nov-21) → yyyy-mm-dd ou null.
const MONTHS_EN: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
function parseAnyDate(v: any): string | null {
  const iso = parseCertDate(v);
  if (iso) return iso;
  const m = String(v ?? '').trim().match(/^([A-Za-z]{3})[a-z]*[- ](\d{2,4})$/);
  if (m && MONTHS_EN[m[1].toLowerCase()]) {
    const y = m[2].length === 2 ? '20' + m[2] : m[2];
    return `${y}-${MONTHS_EN[m[1].toLowerCase()]}-01`;
  }
  return null;
}

const QMS_EQUIPMENT_FILE = process.env.QMS_EQUIPMENT_FILE_NAME || 'LIST-MAN3-02_Listing of Equipments.xlsx';

// Équipements : onglet « List of Equipement », en-tête lignes 10-11, données dès l'index 11.
async function qmsRefreshEquipment(): Promise<number> {
  const mod: any = await import('xlsx'); const XLSX = mod.default ?? mod;
  const buf = await qmsSourceFileBuffer(QMS_EQUIPMENT_FILE);
  const wb = XLSX.read(buf, { type: 'buffer' });
  const sn = wb.SheetNames.find((s: string) => /list of equipement/i.test(s));
  if (!sn) throw new Error('Onglet « List of Equipement » introuvable');
  const aoa: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: false, defval: '' });
  const seen: string[] = []; let n = 0;
  for (let i = 11; i < aoa.length; i++) {
    const r = aoa[i]; if (!r) continue;
    const extId = qmsClean(r[0]); if (!extId) continue;
    const site = qmsClean(r[5]); const room = qmsClean(r[6]);
    try {
      // interventions/calibrations (saisies app) non touchées : absentes de l'UPDATE, elles survivent.
      await pool.query(
        `INSERT INTO qms_equipment (ext_id, name, type, location, model, manufacturer, serial, install_date, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (ext_id) DO UPDATE SET name=EXCLUDED.name, type=EXCLUDED.type, location=EXCLUDED.location, model=EXCLUDED.model,
           manufacturer=EXCLUDED.manufacturer, serial=EXCLUDED.serial, install_date=EXCLUDED.install_date, status=EXCLUDED.status, imported_at=CURRENT_TIMESTAMP`,
        [extId, qmsClean(r[3]), qmsClean(r[2]), site && room ? `${site} · ${room}` : (room || site), qmsClean(r[8]), qmsClean(r[9]), qmsClean(r[10]), parseAnyDate(r[11]), qmsClean(r[14])]
      );
      seen.push(extId); n++;
    } catch (e) { console.error(`QMS equipment upsert « ${extId} »`, (e as any)?.message || e); }
  }
  if (n > 0) await pool.query(`DELETE FROM qms_equipment WHERE ext_id <> ALL($1)`, [seen]);
  return n;
}

// NC / CAPA : statut normalisé (OPEN/CLOSED) pour les filtres de l'app ; le libellé brut est conservé.
const trackStatus = (raw: string | null) => (raw && /clos/i.test(raw) ? 'CLOSED' : 'OPEN');

const QMS_NC_FILE = process.env.QMS_NC_FILE_NAME || 'NC tracking list - 260422.xlsx';

// NC : onglet « NC Tracking List », en-tête ligne 16, données dès l'index 16.
async function qmsRefreshNc(): Promise<number> {
  const mod: any = await import('xlsx'); const XLSX = mod.default ?? mod;
  const buf = await qmsSourceFileBuffer(QMS_NC_FILE);
  const wb = XLSX.read(buf, { type: 'buffer' });
  const ws = wb.Sheets['NC Tracking List'];
  if (!ws) throw new Error('Onglet « NC Tracking List » introuvable');
  const fileUrl = await qmsSourceFileUrl(QMS_NC_FILE);
  const folder = await qmsFolderMap(QMS_NC_FOLDER_URL); // dossiers SharePoint des NC (par numéro)
  console.log(`📁 NC : ${folder.byExtId.size} sous-dossier(s) SharePoint mappé(s), racine ${folder.base ? 'ok' : 'absente'}`);
  const aoa: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
  const seen: string[] = []; let n = 0;
  for (let i = 16; i < aoa.length; i++) {
    const r = aoa[i]; if (!r) continue;
    const extId = qmsClean(r[0]); if (!extId || !/^NC-/i.test(extId)) continue;
    const raw = qmsClean(r[2]);
    // Lien vers le DOSSIER de la NC : sous-dossier SharePoint (par n°) > hyperlien de cellule > dossier racine > fichier de suivi.
    const rowUrl = folder.byExtId.get(extId.replace(/\D/g, '')) || qmsCellLink(ws, XLSX, i) || folder.base || fileUrl;
    try {
      await pool.query(
        `INSERT INTO qms_tracking (kind, ext_id, description, status, raw_status, opening_date, due_date, closure_date, ref, web_url)
         VALUES ('NC',$1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (kind, ext_id) DO UPDATE SET description=EXCLUDED.description, status=EXCLUDED.status, raw_status=EXCLUDED.raw_status,
           opening_date=EXCLUDED.opening_date, due_date=EXCLUDED.due_date, closure_date=EXCLUDED.closure_date, ref=EXCLUDED.ref, web_url=EXCLUDED.web_url, imported_at=CURRENT_TIMESTAMP`,
        [extId, qmsClean(r[1]), trackStatus(raw), raw, parseAnyDate(r[4]), parseAnyDate(r[18]), parseAnyDate(r[21]), qmsClean(r[15]), rowUrl]
      );
      seen.push(extId); n++;
    } catch (e) { console.error(`QMS NC upsert « ${extId} »`, (e as any)?.message || e); }
  }
  if (n > 0) await pool.query(`DELETE FROM qms_tracking WHERE kind='NC' AND ext_id <> ALL($1)`, [seen]);
  return n;
}
// Premier hyperlien trouvé sur une ligne d'un onglet Excel (pointe vers le dossier de l'enregistrement).
function qmsCellLink(ws: any, XLSX: any, row: number): string | null {
  for (let c = 0; c < 30; c++) {
    const cell = ws[XLSX.utils.encode_cell({ r: row, c })];
    const t = cell?.l?.Target;
    if (t && /^https?:\/\//i.test(t)) return t;
  }
  return null;
}

const QMS_CAPA_FILE = process.env.QMS_CAPA_FILE_NAME || 'CAPA Tracking List - 260423.xlsx';

// CAPA : onglet « CAPA Tracking List », en-tête ligne 16, données dès l'index 16.
async function qmsRefreshCapa(): Promise<number> {
  const mod: any = await import('xlsx'); const XLSX = mod.default ?? mod;
  const buf = await qmsSourceFileBuffer(QMS_CAPA_FILE);
  const wb = XLSX.read(buf, { type: 'buffer' });
  const ws = wb.Sheets['CAPA Tracking List'];
  if (!ws) throw new Error('Onglet « CAPA Tracking List » introuvable');
  const fileUrl = await qmsSourceFileUrl(QMS_CAPA_FILE);
  const aoa: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
  const seen: string[] = []; let n = 0;
  for (let i = 16; i < aoa.length; i++) {
    const r = aoa[i]; if (!r) continue;
    const extId = qmsClean(r[0]); if (!extId || !/^CAPA-/i.test(extId)) continue;
    const raw = qmsClean(r[2]);
    const rowUrl = qmsCellLink(ws, XLSX, i) || fileUrl;
    try {
      await pool.query(
        `INSERT INTO qms_tracking (kind, ext_id, description, status, raw_status, opening_date, due_date, closure_date, ref, web_url)
         VALUES ('CAPA',$1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (kind, ext_id) DO UPDATE SET description=EXCLUDED.description, status=EXCLUDED.status, raw_status=EXCLUDED.raw_status,
           opening_date=EXCLUDED.opening_date, due_date=EXCLUDED.due_date, closure_date=EXCLUDED.closure_date, ref=EXCLUDED.ref, web_url=EXCLUDED.web_url, imported_at=CURRENT_TIMESTAMP`,
        [extId, qmsClean(r[1]), trackStatus(raw), raw, parseAnyDate(r[4]), parseAnyDate(r[11]), parseAnyDate(r[19]), qmsClean(r[7]), rowUrl]
      );
      seen.push(extId); n++;
    } catch (e) { console.error(`QMS CAPA upsert « ${extId} »`, (e as any)?.message || e); }
  }
  if (n > 0) await pool.query(`DELETE FROM qms_tracking WHERE kind='CAPA' AND ext_id <> ALL($1)`, [seen]);
  return n;
}

// Orchestrateur : relit chaque fichier source (indépendamment) après chaque synchro Graph. Erreurs remontées au bandeau QMS.
async function qmsRefreshExcelData() {
  if (!graphConfigured()) return;
  const driveId = process.env.GRAPH_DRIVE_ID, root = process.env.GRAPH_ROOT_ITEM_ID;
  const errors: string[] = [];
  try { const n = await qmsRefreshSuppliers(); console.log(`✅ Auto-sync Fournisseurs : ${n} ligne(s)`); }
  catch (e: any) { const m = 'Fournisseurs : ' + (e?.message || e); console.error(m); errors.push(m); }
  try { const n = await qmsRefreshRegistreCommandes(); console.log(`✅ Auto-sync Registre commandes : ${n} ligne(s)`); }
  catch (e: any) { const m = 'Registre commandes : ' + (e?.message || e); console.error(m); errors.push(m); }
  try { const n = await qmsRefreshEquipment(); console.log(`✅ Auto-sync Équipements : ${n} ligne(s)`); }
  catch (e: any) { const m = 'Équipements : ' + (e?.message || e); console.error(m); errors.push(m); }
  try { const n = await qmsRefreshNc(); console.log(`✅ Auto-sync NC : ${n} ligne(s)`); }
  catch (e: any) { const m = 'NC : ' + (e?.message || e); console.error(m); errors.push(m); }
  try { const n = await qmsRefreshCapa(); console.log(`✅ Auto-sync CAPA : ${n} ligne(s)`); }
  catch (e: any) { const m = 'CAPA : ' + (e?.message || e); console.error(m); errors.push(m); }
  if (errors.length) {
    await pool.query(`UPDATE qms_sync_state SET last_error=$3 WHERE drive_id=$1 AND root_item_id=$2`, [driveId, root, ('Auto-sync — ' + errors.join(' | ')).slice(0, 480)]).catch(() => {});
  }
  broadcast('qms:changed', {});
  broadcast('ventes:changed', {});
}

// Subscription webhook (optionnelle : nécessite GRAPH_NOTIFICATION_URL public). driveItem expire en < 3 j → renouvellement.
async function qmsRenewSubscriptions() {
  if (!graphConfigured()) return;
  const notifUrl = process.env.GRAPH_NOTIFICATION_URL;
  if (!notifUrl) return;
  const driveId = process.env.GRAPH_DRIVE_ID as string;
  const resource = `/drives/${driveId}/root`;
  const exp = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
  try {
    const token = await graphToken();
    const existing = await pool.query(`SELECT id FROM qms_subscriptions ORDER BY created_at DESC LIMIT 1`);
    if (existing.rows[0]) {
      const r = await fetch(`${GRAPH}/subscriptions/${existing.rows[0].id}`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ expirationDateTime: exp }),
      });
      if (r.ok) { await pool.query(`UPDATE qms_subscriptions SET expires=$2 WHERE id=$1`, [existing.rows[0].id, exp]); console.log('🔔 QMS subscription renouvelée'); return; }
      await pool.query(`DELETE FROM qms_subscriptions WHERE id=$1`, [existing.rows[0].id]).catch(() => {});
    }
    const r = await fetch(`${GRAPH}/subscriptions`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ changeType: 'updated', notificationUrl: notifUrl, resource, expirationDateTime: exp, clientState: process.env.GRAPH_WEBHOOK_SECRET || '' }),
    });
    const j: any = await r.json();
    if (!r.ok) { console.error('QMS subscription création échec:', j.error?.message); return; }
    await pool.query(`INSERT INTO qms_subscriptions (id, resource, expires) VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET expires=EXCLUDED.expires`, [j.id, resource, exp]);
    console.log('🔔 QMS subscription créée:', j.id);
  } catch (e) { console.error('QMS subscription', e); }
}

function startQmsScheduler() {
  if (!graphConfigured()) { console.log('ℹ️  QMS : Microsoft Graph non configuré — synchronisation désactivée (variables GRAPH_* absentes).'); return; }
  console.log('🗂️  QMS : scheduler de synchronisation activé (delta 10 min, réconciliation 24 h).');
  setTimeout(() => qmsRunDelta('démarrage'), 8000);
  setInterval(() => qmsRunDelta('intervalle'), 10 * 60 * 1000);
  setInterval(() => qmsReconcile('quotidienne'), 24 * 60 * 60 * 1000);
  setTimeout(() => qmsRenewSubscriptions(), 15000);
  setInterval(() => qmsRenewSubscriptions(), 12 * 60 * 60 * 1000);
}

// Webhook Graph (public, sans auth, réponse rapide). Handshake = echo du validationToken.
const qmsGraphWebhook = (req: Request, res: Response) => {
  const vt = req.query.validationToken;
  if (vt) { res.set('Content-Type', 'text/plain').status(200).send(String(vt)); return; }
  const notifs: any[] = (req.body && req.body.value) || [];
  const secret = process.env.GRAPH_WEBHOOK_SECRET || '';
  const ok = notifs.every((n) => !n.clientState || n.clientState === secret);
  res.status(202).send();
  if (ok && notifs.length) qmsRunDelta('webhook');
};
app.get('/integrations/graph/notifications', qmsGraphWebhook);
app.post('/integrations/graph/notifications', qmsGraphWebhook);

// ===== Préparation prod : photocopie LIVE + écriture directe du fichier Excel (via Graph) =====
// Lecture live de l'onglet « Batch Follow-up » (usedRange). Renvoie le texte affiché + les valeurs brutes.
app.get('/api/prepprod/excel', authenticateToken, requireView('prepprod'), async (_req: AuthRequest, res: Response) => {
  if (!graphConfigured()) return res.json({ configured: false });
  try {
    const driveId = process.env.GRAPH_DRIVE_ID as string;
    const itemId = await prodLotItemId();
    const sheet = encodeURIComponent(PROD_LOT_SHEET);
    const j = await graphGet(`${GRAPH}/drives/${driveId}/items/${itemId}/workbook/worksheets('${sheet}')/usedRange?$select=address,text,values,rowCount,columnCount`);
    res.json({ configured: true, sheet: PROD_LOT_SHEET, address: j.address, rowCount: j.rowCount, columnCount: j.columnCount, text: j.text, values: j.values });
  } catch (e: any) { console.error('prepprod excel read', e); res.status(500).json({ error: 'Lecture Excel : ' + (e?.message || e) }); }
});

// Écriture d'une cellule (ex. E20 = incrément, H20 = n° de lot forcé) → Excel recalcule ses formules.
app.post('/api/prepprod/excel/cell', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  if (!graphConfigured()) return res.status(400).json({ error: 'Microsoft Graph non configuré' });
  try {
    const { address, value } = req.body;
    if (!address || !/^[A-Za-z]{1,3}[0-9]{1,7}$/.test(String(address))) return res.status(400).json({ error: 'Adresse de cellule invalide' });
    const driveId = process.env.GRAPH_DRIVE_ID as string;
    const itemId = await prodLotItemId();
    const sheet = encodeURIComponent(PROD_LOT_SHEET);
    const v = (value === '' || value == null) ? null : value;
    await graphPatch(`${GRAPH}/drives/${driveId}/items/${itemId}/workbook/worksheets('${sheet}')/range(address='${address}')`, { values: [[v]] });
    await logActivity(req, 'PROD_EXCEL_WRITE', String(address), `A écrit ${address}="${value}" dans le fichier Excel de traçabilité`);
    broadcast('prepprod:excel', {});
    res.json({ success: true });
  } catch (e: any) { console.error('prepprod excel write', e); res.status(500).json({ error: 'Écriture Excel : ' + (e?.message || e) }); }
});

const mapQmsDoc = (r: any) => ({
  id: r.graph_item_id, name: r.name, docType: r.doc_type, processCode: r.process_code,
  processLibelle: r.process_libelle || null, isoClause: r.iso_clause || null, path: r.path,
  version: r.version, webUrl: r.web_url, mimeType: r.mime_type,
  sizeBytes: r.size_bytes != null ? Number(r.size_bytes) : null, lastModified: r.last_modified,
  modifiedBy: r.modified_by, softDeleted: r.soft_deleted, deletionAcknowledged: r.deleted_flag_seen,
  lifecycleState: r.lifecycle_state, createdDate: r.created_date,
});
const mapQmsProcess = (r: any) => ({
  id: r.id, code: r.code, libelle: r.libelle, isoClause: r.iso_clause, responsable: r.responsable,
  folderName: r.folder_name, docCount: Number(r.doc_count || 0),
});

app.get('/api/qms/sync/status', authenticateToken, requireView('qms'), async (_req: AuthRequest, res: Response) => {
  try {
    const driveId = process.env.GRAPH_DRIVE_ID, root = process.env.GRAPH_ROOT_ITEM_ID;
    const st = await pool.query(`SELECT * FROM qms_sync_state WHERE drive_id=$1 AND root_item_id=$2`, [driveId, root]);
    const row = st.rows[0];
    const staleMin = parseInt(process.env.QMS_SYNC_STALE_MINUTES || '60');
    const lastSuccess = row?.last_success ? new Date(row.last_success) : null;
    const ageMin = lastSuccess ? Math.floor((Date.now() - lastSuccess.getTime()) / 60000) : null;
    res.json({
      configured: graphConfigured(), running: !!row?.running || qmsRunning,
      lastSuccess, lastAttempt: row?.last_attempt || null, lastError: row?.last_error || null,
      ageMinutes: ageMin, staleThreshold: staleMin, stale: ageMin === null || ageMin > staleMin,
      documentCount: row?.full_count ?? null, webhooks: !!process.env.GRAPH_NOTIFICATION_URL,
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

app.get('/api/qms/documents', authenticateToken, requireView('qms'), async (req: AuthRequest, res: Response) => {
  try {
    const { process: proc, type, state, q, includeDeleted } = req.query as any;
    const where: string[] = ['is_folder = FALSE']; const vals: any[] = []; let i = 1;
    if (!includeDeleted || includeDeleted === 'false') where.push('soft_deleted = FALSE');
    if (proc) { where.push(`process_code = $${i++}`); vals.push(proc); }
    if (type) { where.push(`doc_type = $${i++}`); vals.push(type); }
    if (state) { where.push(`lifecycle_state = $${i++}`); vals.push(state); }
    if (q) { where.push(`name ILIKE $${i++}`); vals.push(`%${q}%`); }
    const sql = `SELECT d.*, p.libelle AS process_libelle, p.iso_clause FROM qms_documents d
                 LEFT JOIN qms_processes p ON p.id = d.process_id
                 WHERE ${where.join(' AND ')} ORDER BY d.last_modified DESC NULLS LAST LIMIT 1000`;
    const r = await pool.query(sql, vals);
    res.json(r.rows.map(mapQmsDoc));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

app.get('/api/qms/processes', authenticateToken, requireView('qms'), async (_req: AuthRequest, res: Response) => {
  try {
    const r = await pool.query(`SELECT p.*, (SELECT COUNT(*) FROM qms_documents d WHERE d.process_id=p.id AND d.soft_deleted=FALSE AND d.is_folder=FALSE) AS doc_count FROM qms_processes p ORDER BY p.code`);
    res.json(r.rows.map(mapQmsProcess));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// Registre NC / CAPA / Change (snapshot importé des fichiers de suivi Excel de l'AQ).
app.get('/api/qms/tracking', authenticateToken, requireView('qms'), async (req: AuthRequest, res: Response) => {
  try {
    const { kind, status, q } = req.query as any;
    const where: string[] = []; const vals: any[] = []; let i = 1;
    if (kind) { where.push(`kind = $${i++}`); vals.push(kind); }
    if (status) { where.push(`status = $${i++}`); vals.push(status); }
    if (q) { where.push(`(ext_id ILIKE $${i} OR description ILIKE $${i})`); vals.push(`%${q}%`); i++; }
    const sql = `SELECT * FROM qms_tracking ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY (status = 'OPEN') DESC, due_date ASC NULLS LAST, ext_id`;
    const r = await pool.query(sql, vals);
    res.json(r.rows.map((x: any) => ({ id: x.id, kind: x.kind, extId: x.ext_id, description: x.description, status: x.status, rawStatus: x.raw_status, openingDate: x.opening_date, dueDate: x.due_date, closureDate: x.closure_date, ref: x.ref, webUrl: x.web_url })));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// Import (admin) du registre NC/CAPA/CC depuis les fichiers de suivi Excel (snapshot, idempotent).
app.post('/api/qms/tracking/import', authenticateToken, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const recs: any[] = Array.isArray(req.body?.records) ? req.body.records : [];
    if (!recs.length) return res.status(400).json({ error: 'Aucun enregistrement fourni' });
    let n = 0;
    for (const r of recs) {
      if (!r.kind || !r.extId) continue;
      await pool.query(
        `INSERT INTO qms_tracking (kind, ext_id, description, status, raw_status, opening_date, due_date, closure_date, ref, web_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (kind, ext_id) DO UPDATE SET description=EXCLUDED.description, status=EXCLUDED.status, raw_status=EXCLUDED.raw_status,
           opening_date=EXCLUDED.opening_date, due_date=EXCLUDED.due_date, closure_date=EXCLUDED.closure_date, ref=EXCLUDED.ref,
           web_url=COALESCE(EXCLUDED.web_url, qms_tracking.web_url), imported_at=CURRENT_TIMESTAMP`,
        [r.kind, r.extId, r.description || null, r.status || null, r.rawStatus || null, r.openingDate || null, r.dueDate || null, r.closureDate || null, r.ref || null, r.webUrl || null]
      );
      n++;
    }
    await logActivity(req, 'QMS_TRACKING_IMPORT', null, `A importé ${n} enregistrement(s) de suivi NC/CAPA/CC depuis les fichiers Excel`);
    broadcast('qms:changed', {});
    res.json({ success: true, imported: n });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// --- Documents QA : liste maîtresse lue depuis « LIST-QLT1-01_Quality document tracking list_<date>.xlsx » ---
// Le nom du fichier change à chaque mise à jour (date en suffixe) : recherche Graph par nom, hors Archives, le plus récent gagne.
let _doclistCache: { ts: number; data: any } | null = null;
app.get('/api/qms/doclist', authenticateToken, requireView('qms'), async (req: AuthRequest, res: Response) => {
  try {
    if (!graphConfigured()) return res.status(503).json({ error: 'Connexion SharePoint non configurée sur ce serveur (fonctionne en production).' });
    const force = String(req.query.refresh || '') === '1';
    if (!force && _doclistCache && Date.now() - _doclistCache.ts < 5 * 60 * 1000) return res.json(_doclistCache.data);
    const driveId = process.env.GRAPH_DRIVE_ID as string;
    const qname = process.env.QMS_DOCLIST_QUERY || 'Quality document tracking list';
    const j = await graphGet(`${GRAPH}/drives/${driveId}/root/search(q='${encodeURIComponent(qname)}')?$select=id,name,file,lastModifiedDateTime,parentReference&$top=50`);
    const candidates = (j.value || []).filter((x: any) =>
      x.file && /quality document tracking list/i.test(x.name) && /\.xlsx$/i.test(x.name)
      && !/archive/i.test(String(x.parentReference?.path || '')));
    if (!candidates.length) return res.status(404).json({ error: 'Fichier « Quality document tracking list » introuvable sur SharePoint.' });
    candidates.sort((a: any, b: any) => String(b.lastModifiedDateTime).localeCompare(String(a.lastModifiedDateTime)));
    const fileMeta = candidates[0];
    const buf = await graphDownloadById(fileMeta.id);
    const mod: any = await import('xlsx'); const XLSX = mod.default ?? mod;
    const wb = XLSX.read(buf, { type: 'buffer' });
    // repère la feuille et la ligne d'en-tête (doit contenir Référence + Version + Titre)
    const docs: any[] = [];
    for (const sname of wb.SheetNames) {
      const aoa: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[sname], { header: 1, raw: false, defval: '' });
      let hIdx = -1; let cols: { [k: string]: number } = {};
      for (let i = 0; i < Math.min(aoa.length, 40); i++) {
        const cells = (aoa[i] || []).map((c: any) => String(c || '').toLowerCase().trim());
        const find = (...keys: string[]) => cells.findIndex(c => keys.some(k => c.includes(k)));
        const ref = find('reference', 'référence'); const ver = find('version'); const tit = find('titre', 'title');
        if (ref >= 0 && ver >= 0 && tit >= 0) {
          hIdx = i;
          cols = {
            processus: find('processus', 'process'),
            reference: ref, titre: tit, version: ver,
            statut: find('statut', 'status'),
            application: find('application'),
            review: find('review', 'revue'),
            emplacement: find('access', 'emplacement', 'localisation'),
          };
          break;
        }
      }
      if (hIdx < 0) continue;
      for (let i = hIdx + 1; i < aoa.length; i++) {
        const r = aoa[i] || [];
        const get = (k: string) => cols[k] >= 0 ? String(r[cols[k]] ?? '').trim() : '';
        const reference = get('reference'); const titre = get('titre');
        if (!reference && !titre) continue;
        docs.push({
          processus: get('processus'), reference, titre, version: get('version'),
          statut: get('statut'), application: get('application'), review: get('review'), emplacement: get('emplacement'),
        });
      }
      if (docs.length) break; // la première feuille qui correspond est la liste
    }
    const data = { file: { name: fileMeta.name, modified: String(fileMeta.lastModifiedDateTime || '').slice(0, 10) }, count: docs.length, docs };
    _doclistCache = { ts: Date.now(), data };
    res.json(data);
  } catch (e: any) { console.error('qms doclist', e); res.status(502).json({ error: 'Lecture du fichier impossible : ' + String(e.message || e).slice(0, 140) }); }
});

app.post('/api/qms/sync/run', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  if (!graphConfigured()) return res.status(400).json({ error: 'Microsoft Graph non configuré (variables GRAPH_* manquantes).' });
  await logActivity(req, 'QMS_SYNC_MANUAL', null, 'A lancé une synchronisation QMS manuelle');
  qmsRunDelta('manuel');
  res.json({ success: true, started: true });
});

app.post('/api/qms/documents/:id/ack-deletion', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    await pool.query(`UPDATE qms_documents SET deleted_flag_seen=TRUE WHERE graph_item_id=$1`, [req.params.id]);
    await logActivity(req, 'QMS_DOC_DELETION_ACK', req.params.id, 'A acquitté la suppression d\'un document QMS');
    broadcast('qms:changed', {});
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// =============================================================================
// MODULE QMS Jalon 2 — Non-conformités (§8.3) & CAPA (§8.5)
// Workflows à états (transitions contrôlées), liaisons doc/processus, audit trail, soft-close.
// =============================================================================
const NC_TRANSITIONS: Record<string, string[]> = {
  OUVERTE: ['EN_ANALYSE', 'CLOTUREE'],
  EN_ANALYSE: ['CAPA_OUVERTE', 'CLOTUREE', 'OUVERTE'],
  CAPA_OUVERTE: ['CLOTUREE', 'EN_ANALYSE'],
  CLOTUREE: ['OUVERTE'],
};
const CAPA_TRANSITIONS: Record<string, string[]> = {
  OUVERTE: ['ACTIONS_EN_COURS', 'CLOTUREE'],
  ACTIONS_EN_COURS: ['EN_VERIFICATION', 'OUVERTE'],
  EN_VERIFICATION: ['CLOTUREE', 'ACTIONS_EN_COURS'],
  CLOTUREE: ['ACTIONS_EN_COURS'],
};

async function qmsNextNumero(prefix: 'NC' | 'CAPA' | 'REC' | 'RISK'): Promise<string> {
  const year = new Date().getFullYear();
  const table = prefix === 'NC' ? 'qms_non_conformities' : prefix === 'CAPA' ? 'qms_capa' : prefix === 'REC' ? 'qms_complaints' : 'qms_risks';
  const r = await pool.query(`SELECT numero FROM ${table} WHERE numero LIKE $1 ORDER BY numero DESC LIMIT 1`, [`${prefix}-${year}-%`]);
  let n = 1;
  if (r.rows[0]) { const m = String(r.rows[0].numero).match(/(\d+)$/); if (m) n = parseInt(m[1]) + 1; }
  return `${prefix}-${year}-${String(n).padStart(3, '0')}`;
}

const mapNc = (r: any) => ({
  id: r.id, numero: r.numero, dateDetection: r.date_detection, source: r.source, description: r.description,
  severite: r.severite, processId: r.process_id, processLibelle: r.process_libelle || null, documentId: r.document_id,
  batchId: r.batch_id, statut: r.statut, responsable: r.responsable, capaId: r.capa_id, capaNumero: r.capa_numero || null,
  createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
});
const mapCapa = (r: any) => ({
  id: r.id, numero: r.numero, type: r.type, source: r.source, ncId: r.nc_id, ncNumero: r.nc_numero || null,
  description: r.description, analyseCause: r.analyse_cause, actions: r.actions || [], verificationEfficacite: r.verification_efficacite,
  efficaciteStatut: r.efficacite_statut, echeance: r.echeance, processId: r.process_id, processLibelle: r.process_libelle || null,
  documentId: r.document_id, statut: r.statut, responsable: r.responsable, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
});

// --- Non-conformités ---
app.get('/api/qms/nc', authenticateToken, requireView('qms'), async (req: AuthRequest, res: Response) => {
  try {
    const { statut, severite, q } = req.query as any;
    const where: string[] = []; const vals: any[] = []; let i = 1;
    if (statut) { where.push(`n.statut = $${i++}`); vals.push(statut); }
    if (severite) { where.push(`n.severite = $${i++}`); vals.push(severite); }
    if (q) { where.push(`(n.description ILIKE $${i} OR n.numero ILIKE $${i})`); vals.push(`%${q}%`); i++; }
    const sql = `SELECT n.*, p.libelle AS process_libelle, c.numero AS capa_numero
                 FROM qms_non_conformities n
                 LEFT JOIN qms_processes p ON p.id = n.process_id
                 LEFT JOIN qms_capa c ON c.id = n.capa_id
                 ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                 ORDER BY n.created_at DESC`;
    const r = await pool.query(sql, vals);
    res.json(r.rows.map(mapNc));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

app.post('/api/qms/nc', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    const { dateDetection, source, description, severite, processId, documentId, batchId, responsable } = req.body;
    if (!description) return res.status(400).json({ error: 'Description requise' });
    const numero = await qmsNextNumero('NC');
    const r = await pool.query(
      `INSERT INTO qms_non_conformities (numero, date_detection, source, description, severite, process_id, document_id, batch_id, responsable, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [numero, dateDetection || null, source || null, description, severite || 'MINEURE', processId || null, documentId || null, batchId || null, responsable || null, req.user?.username || null]
    );
    await logActivity(req, 'QMS_NC_CREATE', String(r.rows[0].id), `A créé la non-conformité ${numero}`);
    broadcast('qms:changed', {});
    res.status(201).json(mapNc(r.rows[0]));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

app.patch('/api/qms/nc/:id', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    const cur = await pool.query('SELECT * FROM qms_non_conformities WHERE id = $1', [req.params.id]);
    if (!cur.rows[0]) return res.status(404).json({ error: 'Non-conformité introuvable' });
    if (req.body.statut && req.body.statut !== cur.rows[0].statut) {
      const allowed = NC_TRANSITIONS[cur.rows[0].statut] || [];
      if (!allowed.includes(req.body.statut)) return res.status(400).json({ error: `Transition ${cur.rows[0].statut} → ${req.body.statut} non autorisée.` });
    }
    const map: Record<string, string> = { dateDetection: 'date_detection', source: 'source', description: 'description', severite: 'severite', processId: 'process_id', documentId: 'document_id', batchId: 'batch_id', statut: 'statut', responsable: 'responsable' };
    const fields: string[] = []; const vals: any[] = []; let i = 1;
    for (const k of Object.keys(map)) if (req.body[k] !== undefined) { fields.push(`${map[k]} = $${i++}`); vals.push(req.body[k]); }
    if (!fields.length) return res.status(400).json({ error: 'Rien à modifier' });
    fields.push('updated_at = CURRENT_TIMESTAMP'); vals.push(req.params.id);
    const r = await pool.query(`UPDATE qms_non_conformities SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, vals);
    await logActivity(req, 'QMS_NC_UPDATE', req.params.id, `A modifié la NC ${r.rows[0].numero}${req.body.statut ? ` (statut → ${req.body.statut})` : ''}`);
    broadcast('qms:changed', {});
    res.json(mapNc(r.rows[0]));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// Ouverture d'une CAPA depuis une NC (lie les deux, passe la NC en CAPA_OUVERTE).
app.post('/api/qms/nc/:id/open-capa', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    const nc = await pool.query('SELECT * FROM qms_non_conformities WHERE id = $1', [req.params.id]);
    if (!nc.rows[0]) return res.status(404).json({ error: 'Non-conformité introuvable' });
    if (nc.rows[0].capa_id) return res.status(409).json({ error: 'Une CAPA est déjà liée à cette NC.' });
    const numero = await qmsNextNumero('CAPA');
    const capa = await pool.query(
      `INSERT INTO qms_capa (numero, type, source, nc_id, description, process_id, document_id, responsable, created_by)
       VALUES ($1,'CORRECTIVE','NC',$2,$3,$4,$5,$6,$7) RETURNING *`,
      [numero, nc.rows[0].id, `Issue de la NC ${nc.rows[0].numero} : ${nc.rows[0].description}`, nc.rows[0].process_id, nc.rows[0].document_id, nc.rows[0].responsable, req.user?.username || null]
    );
    await pool.query('UPDATE qms_non_conformities SET capa_id = $1, statut = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3', [capa.rows[0].id, 'CAPA_OUVERTE', nc.rows[0].id]);
    await logActivity(req, 'QMS_CAPA_CREATE', String(capa.rows[0].id), `A ouvert la CAPA ${numero} depuis la NC ${nc.rows[0].numero}`);
    broadcast('qms:changed', {});
    res.status(201).json(mapCapa(capa.rows[0]));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// --- CAPA ---
app.get('/api/qms/capa', authenticateToken, requireView('qms'), async (req: AuthRequest, res: Response) => {
  try {
    const { statut, type, q } = req.query as any;
    const where: string[] = []; const vals: any[] = []; let i = 1;
    if (statut) { where.push(`c.statut = $${i++}`); vals.push(statut); }
    if (type) { where.push(`c.type = $${i++}`); vals.push(type); }
    if (q) { where.push(`(c.description ILIKE $${i} OR c.numero ILIKE $${i})`); vals.push(`%${q}%`); i++; }
    const sql = `SELECT c.*, p.libelle AS process_libelle, n.numero AS nc_numero
                 FROM qms_capa c
                 LEFT JOIN qms_processes p ON p.id = c.process_id
                 LEFT JOIN qms_non_conformities n ON n.id = c.nc_id
                 ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                 ORDER BY c.created_at DESC`;
    const r = await pool.query(sql, vals);
    res.json(r.rows.map(mapCapa));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

app.post('/api/qms/capa', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    const { type, source, description, analyseCause, echeance, processId, documentId, responsable } = req.body;
    if (!description) return res.status(400).json({ error: 'Description requise' });
    const numero = await qmsNextNumero('CAPA');
    const r = await pool.query(
      `INSERT INTO qms_capa (numero, type, source, description, analyse_cause, echeance, process_id, document_id, responsable, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [numero, type || 'CORRECTIVE', source || 'AUTRE', description, analyseCause || null, echeance || null, processId || null, documentId || null, responsable || null, req.user?.username || null]
    );
    await logActivity(req, 'QMS_CAPA_CREATE', String(r.rows[0].id), `A créé la CAPA ${numero}`);
    broadcast('qms:changed', {});
    res.status(201).json(mapCapa(r.rows[0]));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

app.patch('/api/qms/capa/:id', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    const cur = await pool.query('SELECT * FROM qms_capa WHERE id = $1', [req.params.id]);
    if (!cur.rows[0]) return res.status(404).json({ error: 'CAPA introuvable' });
    if (req.body.statut && req.body.statut !== cur.rows[0].statut) {
      const allowed = CAPA_TRANSITIONS[cur.rows[0].statut] || [];
      if (!allowed.includes(req.body.statut)) return res.status(400).json({ error: `Transition ${cur.rows[0].statut} → ${req.body.statut} non autorisée.` });
      // Contrôle qualité : clôture interdite tant que l'efficacité n'est pas vérifiée comme EFFICACE.
      if (req.body.statut === 'CLOTUREE') {
        const eff = req.body.efficaciteStatut ?? cur.rows[0].efficacite_statut;
        if (eff !== 'EFFICACE') return res.status(400).json({ error: 'Clôture impossible : la vérification d\'efficacité doit être « EFFICACE ».' });
      }
    }
    const map: Record<string, string> = { type: 'type', source: 'source', description: 'description', analyseCause: 'analyse_cause', actions: 'actions', verificationEfficacite: 'verification_efficacite', efficaciteStatut: 'efficacite_statut', echeance: 'echeance', processId: 'process_id', documentId: 'document_id', statut: 'statut', responsable: 'responsable' };
    const fields: string[] = []; const vals: any[] = []; let i = 1;
    for (const k of Object.keys(map)) if (req.body[k] !== undefined) {
      if (k === 'actions') { fields.push(`actions = $${i++}::jsonb`); vals.push(JSON.stringify(req.body[k])); }
      else { fields.push(`${map[k]} = $${i++}`); vals.push(req.body[k]); }
    }
    if (!fields.length) return res.status(400).json({ error: 'Rien à modifier' });
    fields.push('updated_at = CURRENT_TIMESTAMP'); vals.push(req.params.id);
    const r = await pool.query(`UPDATE qms_capa SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, vals);
    await logActivity(req, 'QMS_CAPA_UPDATE', req.params.id, `A modifié la CAPA ${r.rows[0].numero}${req.body.statut ? ` (statut → ${req.body.statut})` : ''}`);
    broadcast('qms:changed', {});
    res.json(mapCapa(r.rows[0]));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// =============================================================================
// MODULE QMS Jalon 3 — Réclamations/Vigilance/PMS (§8.2, MDR) & Risques (ISO 14971)
// =============================================================================
const COMPLAINT_TRANSITIONS: Record<string, string[]> = {
  OUVERTE: ['EN_INVESTIGATION', 'CLOTUREE'],
  EN_INVESTIGATION: ['CAPA_OUVERTE', 'CLOTUREE', 'OUVERTE'],
  CAPA_OUVERTE: ['CLOTUREE', 'EN_INVESTIGATION'],
  CLOTUREE: ['OUVERTE'],
};

const mapComplaint = (r: any) => ({
  id: r.id, numero: r.numero, dateReception: r.date_reception, produit: r.produit, lot: r.lot, description: r.description,
  imdrfCodes: r.imdrf_codes, vigilance: r.vigilance, gravite: r.gravite, processId: r.process_id, processLibelle: r.process_libelle || null,
  capaId: r.capa_id, capaNumero: r.capa_numero || null, statut: r.statut, responsable: r.responsable,
  createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
});
const mapRisk = (r: any) => ({
  id: r.id, numero: r.numero, danger: r.danger, situation: r.situation, dommage: r.dommage,
  prob: r.prob, gravite: r.gravite, mesuresMaitrise: r.mesures_maitrise, probRes: r.prob_res, graviteRes: r.gravite_res,
  complaintIds: r.complaint_ids || [], processId: r.process_id, processLibelle: r.process_libelle || null,
  statut: r.statut, responsable: r.responsable, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
});

// --- Réclamations ---
app.get('/api/qms/complaints', authenticateToken, requireView('qms'), async (req: AuthRequest, res: Response) => {
  try {
    const { statut, vigilance, q } = req.query as any;
    const where: string[] = []; const vals: any[] = []; let i = 1;
    if (statut) { where.push(`c.statut = $${i++}`); vals.push(statut); }
    if (vigilance === 'true') where.push(`c.vigilance = TRUE`);
    if (q) { where.push(`(c.description ILIKE $${i} OR c.numero ILIKE $${i} OR c.produit ILIKE $${i})`); vals.push(`%${q}%`); i++; }
    const sql = `SELECT c.*, p.libelle AS process_libelle, ca.numero AS capa_numero
                 FROM qms_complaints c
                 LEFT JOIN qms_processes p ON p.id = c.process_id
                 LEFT JOIN qms_capa ca ON ca.id = c.capa_id
                 ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                 ORDER BY c.created_at DESC`;
    const r = await pool.query(sql, vals);
    res.json(r.rows.map(mapComplaint));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

app.post('/api/qms/complaints', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    const { dateReception, produit, lot, description, imdrfCodes, vigilance, gravite, processId, responsable } = req.body;
    if (!description) return res.status(400).json({ error: 'Description requise' });
    const numero = await qmsNextNumero('REC');
    const r = await pool.query(
      `INSERT INTO qms_complaints (numero, date_reception, produit, lot, description, imdrf_codes, vigilance, gravite, process_id, responsable, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [numero, dateReception || null, produit || null, lot || null, description, imdrfCodes || null, !!vigilance, gravite || 'MINEURE', processId || null, responsable || null, req.user?.username || null]
    );
    await logActivity(req, 'QMS_COMPLAINT_CREATE', String(r.rows[0].id), `A créé la réclamation ${numero}${vigilance ? ' (VIGILANCE)' : ''}`);
    broadcast('qms:changed', {});
    res.status(201).json(mapComplaint(r.rows[0]));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

app.patch('/api/qms/complaints/:id', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    const cur = await pool.query('SELECT * FROM qms_complaints WHERE id = $1', [req.params.id]);
    if (!cur.rows[0]) return res.status(404).json({ error: 'Réclamation introuvable' });
    if (req.body.statut && req.body.statut !== cur.rows[0].statut) {
      const allowed = COMPLAINT_TRANSITIONS[cur.rows[0].statut] || [];
      if (!allowed.includes(req.body.statut)) return res.status(400).json({ error: `Transition ${cur.rows[0].statut} → ${req.body.statut} non autorisée.` });
    }
    const map: Record<string, string> = { dateReception: 'date_reception', produit: 'produit', lot: 'lot', description: 'description', imdrfCodes: 'imdrf_codes', vigilance: 'vigilance', gravite: 'gravite', processId: 'process_id', statut: 'statut', responsable: 'responsable' };
    const fields: string[] = []; const vals: any[] = []; let i = 1;
    for (const k of Object.keys(map)) if (req.body[k] !== undefined) { fields.push(`${map[k]} = $${i++}`); vals.push(req.body[k]); }
    if (!fields.length) return res.status(400).json({ error: 'Rien à modifier' });
    fields.push('updated_at = CURRENT_TIMESTAMP'); vals.push(req.params.id);
    const r = await pool.query(`UPDATE qms_complaints SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, vals);
    await logActivity(req, 'QMS_COMPLAINT_UPDATE', req.params.id, `A modifié la réclamation ${r.rows[0].numero}${req.body.statut ? ` (statut → ${req.body.statut})` : ''}`);
    broadcast('qms:changed', {});
    res.json(mapComplaint(r.rows[0]));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

app.post('/api/qms/complaints/:id/open-capa', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    const co = await pool.query('SELECT * FROM qms_complaints WHERE id = $1', [req.params.id]);
    if (!co.rows[0]) return res.status(404).json({ error: 'Réclamation introuvable' });
    if (co.rows[0].capa_id) return res.status(409).json({ error: 'Une CAPA est déjà liée à cette réclamation.' });
    const numero = await qmsNextNumero('CAPA');
    const capa = await pool.query(
      `INSERT INTO qms_capa (numero, type, source, description, process_id, responsable, created_by)
       VALUES ($1,'CORRECTIVE','RECLAMATION',$2,$3,$4,$5) RETURNING *`,
      [numero, `Issue de la réclamation ${co.rows[0].numero} : ${co.rows[0].description}`, co.rows[0].process_id, co.rows[0].responsable, req.user?.username || null]
    );
    await pool.query('UPDATE qms_complaints SET capa_id = $1, statut = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3', [capa.rows[0].id, 'CAPA_OUVERTE', co.rows[0].id]);
    await logActivity(req, 'QMS_CAPA_CREATE', String(capa.rows[0].id), `A ouvert la CAPA ${numero} depuis la réclamation ${co.rows[0].numero}`);
    broadcast('qms:changed', {});
    res.status(201).json(mapCapa(capa.rows[0]));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// --- Risques (ISO 14971) ---
app.get('/api/qms/risks', authenticateToken, requireView('qms'), async (req: AuthRequest, res: Response) => {
  try {
    const { statut, q } = req.query as any;
    const where: string[] = []; const vals: any[] = []; let i = 1;
    if (statut) { where.push(`r.statut = $${i++}`); vals.push(statut); }
    if (q) { where.push(`(r.danger ILIKE $${i} OR r.numero ILIKE $${i} OR r.dommage ILIKE $${i})`); vals.push(`%${q}%`); i++; }
    const sql = `SELECT r.*, p.libelle AS process_libelle FROM qms_risks r
                 LEFT JOIN qms_processes p ON p.id = r.process_id
                 ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                 ORDER BY (r.prob * r.gravite) DESC, r.created_at DESC`;
    const r = await pool.query(sql, vals);
    res.json(r.rows.map(mapRisk));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

app.post('/api/qms/risks', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    const { danger, situation, dommage, prob, gravite, mesuresMaitrise, probRes, graviteRes, complaintIds, processId, responsable } = req.body;
    if (!danger) return res.status(400).json({ error: 'Danger requis' });
    const numero = await qmsNextNumero('RISK');
    const r = await pool.query(
      `INSERT INTO qms_risks (numero, danger, situation, dommage, prob, gravite, mesures_maitrise, prob_res, gravite_res, complaint_ids, process_id, responsable, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13) RETURNING *`,
      [numero, danger, situation || null, dommage || null, prob || 1, gravite || 1, mesuresMaitrise || null, probRes || null, graviteRes || null, JSON.stringify(complaintIds || []), processId || null, responsable || null, req.user?.username || null]
    );
    await logActivity(req, 'QMS_RISK_CREATE', String(r.rows[0].id), `A créé le risque ${numero} : ${danger}`);
    broadcast('qms:changed', {});
    res.status(201).json(mapRisk(r.rows[0]));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

app.patch('/api/qms/risks/:id', authenticateToken, requireRole('editor'), async (req: AuthRequest, res: Response) => {
  try {
    const map: Record<string, string> = { danger: 'danger', situation: 'situation', dommage: 'dommage', prob: 'prob', gravite: 'gravite', mesuresMaitrise: 'mesures_maitrise', probRes: 'prob_res', graviteRes: 'gravite_res', complaintIds: 'complaint_ids', processId: 'process_id', statut: 'statut', responsable: 'responsable' };
    const fields: string[] = []; const vals: any[] = []; let i = 1;
    for (const k of Object.keys(map)) if (req.body[k] !== undefined) {
      if (k === 'complaintIds') { fields.push(`complaint_ids = $${i++}::jsonb`); vals.push(JSON.stringify(req.body[k])); }
      else { fields.push(`${map[k]} = $${i++}`); vals.push(req.body[k]); }
    }
    if (!fields.length) return res.status(400).json({ error: 'Rien à modifier' });
    fields.push('updated_at = CURRENT_TIMESTAMP'); vals.push(req.params.id);
    const r = await pool.query(`UPDATE qms_risks SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, vals);
    if (!r.rows[0]) return res.status(404).json({ error: 'Risque introuvable' });
    await logActivity(req, 'QMS_RISK_UPDATE', req.params.id, `A modifié le risque ${r.rows[0].numero}`);
    broadcast('qms:changed', {});
    res.json(mapRisk(r.rows[0]));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// Gap Analysis (produits/réglementaire) & Analyses de risque BioSteril (process) — traçabilité via l'index documentaire.
app.get('/api/qms/gap', authenticateToken, requireView('qms'), async (_req: AuthRequest, res: Response) => {
  try {
    const r = await pool.query(
      `SELECT name, path, web_url, created_date, last_modified, lifecycle_state,
         CASE WHEN path ILIKE '%Analyse de risque BioSteril%' OR path ILIKE '%Bio-Steril%' THEN 'BIOSTERIL'
              WHEN path ILIKE '%Gap Analysis%' THEN 'GAP' ELSE 'AUTRE' END AS category
       FROM qms_documents
       WHERE soft_deleted = FALSE AND is_folder = FALSE
         AND (path ILIKE '%Gap Analysis%' OR path ILIKE '%Analyse de risque BioSteril%')
       ORDER BY category, last_modified DESC NULLS LAST`);
    res.json(r.rows.map((x: any) => ({ name: x.name, path: x.path, webUrl: x.web_url, createdDate: x.created_date, lastModified: x.last_modified, lifecycleState: x.lifecycle_state, category: x.category })));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// Équipements (inventaire importé du listing Excel de l'AQ).
app.get('/api/qms/equipment', authenticateToken, requireView('qms'), async (req: AuthRequest, res: Response) => {
  try {
    const { status, type, q } = req.query as any;
    const where: string[] = []; const vals: any[] = []; let i = 1;
    if (status) { where.push(`status = $${i++}`); vals.push(status); }
    if (type) { where.push(`type = $${i++}`); vals.push(type); }
    if (q) { where.push(`(ext_id ILIKE $${i} OR name ILIKE $${i} OR location ILIKE $${i})`); vals.push(`%${q}%`); i++; }
    const r = await pool.query(`SELECT * FROM qms_equipment ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ext_id`, vals);
    res.json(r.rows.map((x: any) => ({ id: x.id, extId: x.ext_id, name: x.name, type: x.type, location: x.location, model: x.model, manufacturer: x.manufacturer, serial: x.serial, installDate: x.install_date, status: x.status, webUrl: x.web_url, interventions: x.interventions || [] })));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

app.post('/api/qms/equipment/import', authenticateToken, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const recs: any[] = Array.isArray(req.body?.records) ? req.body.records : [];
    if (!recs.length) return res.status(400).json({ error: 'Aucun enregistrement' });
    let n = 0;
    for (const r of recs) {
      if (!r.extId) continue;
      await pool.query(
        `INSERT INTO qms_equipment (ext_id, name, type, location, model, manufacturer, serial, install_date, status, web_url, interventions)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
         ON CONFLICT (ext_id) DO UPDATE SET name=EXCLUDED.name, type=EXCLUDED.type, location=EXCLUDED.location, model=EXCLUDED.model,
           manufacturer=EXCLUDED.manufacturer, serial=EXCLUDED.serial, install_date=EXCLUDED.install_date, status=EXCLUDED.status,
           web_url=COALESCE(EXCLUDED.web_url, qms_equipment.web_url),
           interventions=CASE WHEN EXCLUDED.interventions = '[]'::jsonb THEN qms_equipment.interventions ELSE EXCLUDED.interventions END,
           imported_at=CURRENT_TIMESTAMP`,
        [r.extId, r.name || null, r.type || null, r.location || null, r.model || null, r.manufacturer || null, r.serial || null, r.installDate || null, r.status || null, r.webUrl || null, JSON.stringify(Array.isArray(r.interventions) ? r.interventions : [])]
      );
      n++;
    }
    await logActivity(req, 'QMS_EQUIPMENT_IMPORT', null, `A importé ${n} équipement(s)`);
    broadcast('qms:changed', {});
    res.json({ success: true, imported: n });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// Registre des risques ligne par ligne (ISO 14971) — matrices produit & process.
app.get('/api/qms/risk-register', authenticateToken, requireView('qms'), async (req: AuthRequest, res: Response) => {
  try {
    const { category, q } = req.query as any;
    const where: string[] = []; const vals: any[] = []; let i = 1;
    if (category) { where.push(`category = $${i++}`); vals.push(category); }
    if (q) { where.push(`(hazard ILIKE $${i} OR harm ILIKE $${i} OR step ILIKE $${i} OR ext_id ILIKE $${i})`); vals.push(`%${q}%`); i++; }
    const r = await pool.query(`SELECT * FROM qms_risk_register ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY (COALESCE(occurrence,0) * COALESCE(severity,0)) DESC, category, ext_id`, vals);
    res.json(r.rows.map((x: any) => ({ id: x.id, category: x.category, extId: x.ext_id, step: x.step, hazard: x.hazard, situation: x.situation, harm: x.harm, occurrence: x.occurrence, severity: x.severity, riskEval: x.risk_eval, control: x.control, occurrenceRes: x.occurrence_res, severityRes: x.severity_res, residualRisk: x.residual_risk })));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

app.post('/api/qms/risk-register/import', authenticateToken, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const recs: any[] = Array.isArray(req.body?.records) ? req.body.records : [];
    if (!recs.length) return res.status(400).json({ error: 'Aucun enregistrement' });
    // Remplace le registre par catégorie fournie (snapshot complet, évite les orphelins).
    const cats = Array.from(new Set(recs.map((r) => r.category).filter(Boolean)));
    for (const c of cats) await pool.query('DELETE FROM qms_risk_register WHERE category = $1', [c]);
    let n = 0;
    for (const r of recs) {
      if (!r.category || !r.hazard) continue;
      await pool.query(
        `INSERT INTO qms_risk_register (category, ext_id, step, hazard, situation, harm, occurrence, severity, risk_eval, control, occurrence_res, severity_res, residual_risk)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (category, ext_id) DO UPDATE SET step=EXCLUDED.step, hazard=EXCLUDED.hazard, situation=EXCLUDED.situation, harm=EXCLUDED.harm,
           occurrence=EXCLUDED.occurrence, severity=EXCLUDED.severity, risk_eval=EXCLUDED.risk_eval, control=EXCLUDED.control,
           occurrence_res=EXCLUDED.occurrence_res, severity_res=EXCLUDED.severity_res, residual_risk=EXCLUDED.residual_risk, imported_at=CURRENT_TIMESTAMP`,
        [r.category, r.extId || null, r.step || null, r.hazard, r.situation || null, r.harm || null, r.occurrence ?? null, r.severity ?? null, r.riskEval || null, r.control || null, r.occurrenceRes ?? null, r.severityRes ?? null, r.residualRisk || null]
      );
      n++;
    }
    await logActivity(req, 'QMS_RISK_IMPORT', null, `A importé ${n} ligne(s) de risque (${cats.join(', ')})`);
    broadcast('qms:changed', {});
    res.json({ success: true, imported: n });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// Fournisseurs (registre importé du Supplier Tracking List).
app.get('/api/qms/suppliers', authenticateToken, requireView('qms'), async (req: AuthRequest, res: Response) => {
  try {
    const { status, classification, q } = req.query as any;
    const where: string[] = []; const vals: any[] = []; let i = 1;
    if (status) { where.push(`status = $${i++}`); vals.push(status); }
    if (classification) { where.push(`classification = $${i++}`); vals.push(classification); }
    if (q) { where.push(`(name ILIKE $${i} OR ext_id ILIKE $${i} OR product ILIKE $${i})`); vals.push(`%${q}%`); i++; }
    const r = await pool.query(`SELECT * FROM qms_suppliers ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ext_id NULLS LAST, name`, vals);
    res.json(r.rows.map((x: any) => ({ id: x.id, extId: x.ext_id, name: x.name, status: x.status, classification: x.classification, type: x.type, supplyType: x.supply_type, product: x.product, certRef: x.cert_ref, certExpiration: x.cert_expiration, qualityAgreement: x.quality_agreement, webUrl: x.web_url })));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

app.post('/api/qms/suppliers/import', authenticateToken, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const recs: any[] = Array.isArray(req.body?.records) ? req.body.records : [];
    if (!recs.length) return res.status(400).json({ error: 'Aucun enregistrement' });
    let n = 0;
    for (const r of recs) {
      if (!r.name) continue;
      await pool.query(
        `INSERT INTO qms_suppliers (ext_id, name, status, classification, type, supply_type, product, cert_ref, cert_expiration, quality_agreement, web_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (name) DO UPDATE SET ext_id=EXCLUDED.ext_id, status=EXCLUDED.status, classification=EXCLUDED.classification, type=EXCLUDED.type,
           supply_type=EXCLUDED.supply_type, product=EXCLUDED.product, cert_ref=EXCLUDED.cert_ref, cert_expiration=EXCLUDED.cert_expiration,
           quality_agreement=EXCLUDED.quality_agreement, web_url=COALESCE(EXCLUDED.web_url, qms_suppliers.web_url), imported_at=CURRENT_TIMESTAMP`,
        [r.extId || null, r.name, r.status || null, r.classification || null, r.type || null, r.supplyType || null, r.product || null, r.certRef || null, r.certExpiration || null, r.qualityAgreement || null, r.webUrl || null]
      );
      n++;
    }
    await logActivity(req, 'QMS_SUPPLIER_IMPORT', null, `A importé ${n} fournisseur(s)`);
    broadcast('qms:changed', {});
    res.json({ success: true, imported: n });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

// Spécifications techniques : dernière révision de chaque SPEC + date d'application (depuis l'index documentaire).
app.get('/api/qms/specs', authenticateToken, requireView('qms'), async (_req: AuthRequest, res: Response) => {
  try {
    const r = await pool.query(
      `SELECT name, path, web_url, created_date, last_modified, mime_type FROM qms_documents
       WHERE soft_deleted = FALSE AND is_folder = FALSE AND name ILIKE 'SPEC-%'
         AND path ILIKE '%TECH%SPEC%' AND path NOT ILIKE '%archive%'`);
    const byCode = new Map<string, any>();
    for (const x of r.rows as any[]) {
      const m = String(x.name).match(/^(SPEC-[A-Za-z0-9]+)[_ \-]*rev\s*(\d+)/i);
      if (!m) continue;
      const code = m[1].toUpperCase(); const rev = parseInt(m[2]);
      const isPdf = /pdf/i.test(x.mime_type || '') || /\.pdf$/i.test(x.name);
      const cat = /Article MP|MP\b/i.test(x.path) ? 'MP' : /Article AC|AC\b/i.test(x.path) ? 'AC' : /Article AT|AT\b/i.test(x.path) ? 'AT' : '';
      const cur = byCode.get(code);
      if (!cur || rev > cur.revision || (rev === cur.revision && isPdf && !cur.isPdf)) {
        byCode.set(code, { code, revision: rev, name: x.name, webUrl: x.web_url, createdDate: x.created_date, applicationDate: x.last_modified, category: cat, isPdf });
      }
    }
    res.json(Array.from(byCode.values()).map(({ isPdf, ...v }) => v).sort((a, b) => a.code.localeCompare(b.code)));
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur' }); }
});

if (isProduction) {
  app.get('*', (req: Request, res: Response) => {
    const indexPath = path.join(__dirname, 'dist', 'index.html');
    res.sendFile(indexPath);
  });
}

const PORT = process.env.PORT || 3001;

async function startServer() {
  try {
    await initDatabase();

    httpServer.listen(PORT, () => {
      console.log(`🚀 Serveur LounaFlow v2 démarré sur http://localhost:${PORT}`);
      console.log(`📡 Socket.IO prêt`);
      console.log(`👥 Rôles disponibles: admin, editor, viewer`);
      console.log(`🔑 Pour vous connecter: admin / louna2026 (par défaut)`);
      startQmsScheduler();
    });
  } catch (error) {
    console.error('❌ Erreur au démarrage:', error);
    process.exit(1);
  }
}

startServer();
