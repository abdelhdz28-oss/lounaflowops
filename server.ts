import express, { Request, Response, NextFunction } from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import cors from 'cors';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

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

app.use(express.json());

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
}

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

// --- Refonte du suivi des lots : 3 axes orthogonaux ---
type ProcessStage = 'FORMULATION' | 'CONDI_PRIM' | 'CONDI_SEC' | 'LIBERATION' | 'EXPEDIE';
type QualityStatus = 'EN_COURS' | 'QUARANTAINE' | 'LIBERE' | 'REJETE';
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

// Transitions de statut autorisées (séquence verrouillée, miroir front).
const SAMPLE_STATUS_TRANSITIONS: Record<string, string[]> = {
  A_ENVOYER: ['ENVOYE'],
  ENVOYE: ['A_ENVOYER', 'RESULTATS_RECUS'],
  RESULTATS_RECUS: ['ENVOYE', 'CONFORME', 'NON_CONFORME'],
  CONFORME: ['RESULTATS_RECUS'],
  NON_CONFORME: ['RESULTATS_RECUS']
};

const STATUS_AFTER_ENVOI: SampleStatus[] = ['ENVOYE', 'RESULTATS_RECUS', 'CONFORME', 'NON_CONFORME'];

// Partenaires / laboratoires sélectionnables pour les tests. Éditable via Réglages.
const DEFAULT_SAMPLE_PARTNERS = ['Intertek', 'Charles River'];

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

// Valide la cohérence inter-axes. Retourne un message d'erreur FR ou null si OK.
function validateAxes(process_stage: string | undefined, quality_status: string | undefined): string | null {
  if (quality_status === 'LIBERE' && process_stage !== 'LIBERATION' && process_stage !== 'EXPEDIE') {
    return 'Le statut qualité « Libéré » nécessite une étape process « Libération » ou « Expédié ».';
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
    await client.query("ALTER TABLE batches ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP");

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

    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN as any }
    );

    const reqWithUser = req as Request & { user?: JWTPayload };
    reqWithUser.user = { userId: user.id, username: user.username, role: user.role };
    await logActivity(reqWithUser, 'LOGIN_SUCCESS', user.id, `Connexion réussie de l'utilisateur ${user.username} (Rôle: ${user.role})`);

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role
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
      'SELECT id, username, role, created_at FROM users ORDER BY created_at'
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/users', authenticateToken, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { username, password, role } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Nom d\'utilisateur et mot de passe requis' });
    }

    const validRoles: UserRole[] = ['admin', 'editor', 'viewer'];
    if (role && !validRoles.includes(role)) {
      return res.status(400).json({ error: 'Rôle invalide' });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const userRole = role || 'viewer';

    const result = await pool.query(
      'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING id, username, role, created_at',
      [username, passwordHash, userRole]
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
    const { password, role } = req.body;

    if (!password && !role) {
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

    values.push(id);

    const result = await pool.query(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING id, username, role, created_at`,
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
    volume: row.volume,
    boxesTarget: row.boxestarget,
    distributed: row.distributed,
    conform: row.conform,
    sold: row.sold,
    palettes: row.palettes,
    samples: typeof row.samples === 'string' ? JSON.parse(row.samples) : (row.samples || [])
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
      const delCheck = await client.query('SELECT id FROM deliveries WHERE batchId = $1', [batch.id]);
      if (delCheck.rows.length > 0) {
        // Update existing delivery
        await client.query(
          `UPDATE deliveries 
           SET date = $1, client = $2, boxesSold = $3, palettes = $4 
           WHERE batchId = $5`,
          [batch.deliveryDate, batch.client || 'N/A', batch.boxesTarget || 0, batch.palettes || 0, batch.id]
        );
        // Fetch and broadcast update
        const updatedDel = await client.query('SELECT * FROM deliveries WHERE batchId = $1', [batch.id]);
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
          boxesTarget, distributed, conform, sold, palettes, samples
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
        RETURNING *`,
        [
          batch.id, batch.fluxKey, batch.reference, batch.client, batch.product,
          batch.stepIndex, batch.status, batch.process_stage, batch.quality_status,
          batch.progress, batch.startDate, batch.endDate,
          batch.deliveryDate, batch.notes, batch.volume, batch.boxesTarget,
          batch.distributed, batch.conform, batch.sold, batch.palettes,
          JSON.stringify(batch.samples || [])
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
      'boxesTarget', 'distributed', 'conform', 'sold', 'palettes', 'samples'
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
          if (key === 'samples') {
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

    await logActivity(req, 'BATCH_DELETE', id, `A supprimé le lot ${id}`);

    broadcast('batch:deleted', { id });
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting batch:', error);
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

app.get('/api/audit-logs', authenticateToken, requireRole('admin'), async (req: AuthRequest, res: Response) => {
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
    });
  } catch (error) {
    console.error('❌ Erreur au démarrage:', error);
    process.exit(1);
  }
}

startServer();
