// Moteur « Emails » — repris de Louna OS lors de l'intégration dans LounaFlow.
//
// Ce module est autonome : il crée ses tables (préfixe `los_`, déjà présentes en base
// puisque Louna OS partageait la même base), relève les emails (Outlook + Gmail),
// les fait trier par l'IA, suit les relances, et expose les routes /api/mail*, /api/emails*,
// /api/relances*.
//
// Sécurité : toutes les routes sont réservées au PROPRIÉTAIRE des boîtes (variable
// d'environnement MAIL_OWNER, par défaut « admin »). Un autre utilisateur — même
// administrateur — reçoit un 403.
//
// ⚠️ Les jetons OAuth sont chiffrés avec une clé dérivée de MAIL_ENC_SECRET (repli :
// JWT_SECRET). Pour réutiliser les boîtes déjà connectées dans Louna OS, MAIL_ENC_SECRET
// doit valoir le JWT_SECRET du service louna-os ; sinon il suffit de reconnecter les boîtes.

import crypto from 'crypto';
import type { Express, Request, Response, NextFunction } from 'express';
import { REGLES_PERSO_V2, prefiltreGmail, parseClassificationPerso } from './mailRules';

type Pool = any;

// App Azure utilisée pour la boîte Outlook personnelle. On accepte une app DÉDIÉE
// (MAIL_GRAPH_*) afin de ne pas toucher à celle du QMS / des DDL : la connexion par code
// d'appareil exige « Allow public client flows », ce que l'app du QMS n'a pas forcément.
const GRAPH_CLIENT_ID = process.env.MAIL_GRAPH_CLIENT_ID || process.env.GRAPH_CLIENT_ID || '';
const GRAPH_TENANT_ID = process.env.MAIL_GRAPH_TENANT_ID || process.env.GRAPH_TENANT_ID || 'common';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
const DEEPSEEK_BASE = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GL = 'https://generativelanguage.googleapis.com';

let pool: Pool;

// ─── Chiffrement des jetons mail (AES-256-GCM) ───────────────────────────────
function encKey(): Buffer {
  const secret = process.env.MAIL_ENC_SECRET || process.env.JWT_SECRET || 'dev-secret-change-me';
  return crypto.createHash('sha256').update('louna-os-mail:' + secret).digest();
}
function enc(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', encKey(), iv);
  const out = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), out]).toString('base64');
}
function dec(blob: string): string {
  const b = Buffer.from(blob, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', encKey(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}

// ─── Tables (additif, idempotent) ────────────────────────────────────────────
export async function initMailTables(p: Pool) {
  pool = p;
  const c = await pool.connect();
  try {
    await c.query(`
      CREATE TABLE IF NOT EXISTS los_mail_accounts (
        id SERIAL PRIMARY KEY,
        adresse TEXT UNIQUE NOT NULL,
        kind TEXT NOT NULL,                          -- 'pro' | 'perso'
        provider TEXT NOT NULL,                      -- 'microsoft' | 'google'
        token_blob TEXT,                             -- jetons chiffrés (JSON)
        statut TEXT DEFAULT 'NON_CONNECTE',          -- NON_CONNECTE | CONNECTE | ERREUR
        last_sync TIMESTAMP,
        last_error TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`);
    await c.query(`
      CREATE TABLE IF NOT EXISTS los_emails (
        id SERIAL PRIMARY KEY,
        account_id INTEGER REFERENCES los_mail_accounts(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        sujet TEXT, expediteur TEXT, expediteur_adresse TEXT,
        recu_le TIMESTAMP, apercu TEXT, corps TEXT,
        lu BOOLEAN DEFAULT FALSE,
        web_link TEXT,
        quadrant TEXT,                               -- pro : UI | InotU | UnotI | NN
        categorie TEXT,                              -- perso
        action_requise BOOLEAN DEFAULT FALSE,
        action_done BOOLEAN DEFAULT FALSE,
        resume TEXT,
        corrige BOOLEAN DEFAULT FALSE,               -- classement corrigé à la main
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (account_id, provider_id)
      )`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_los_emails_kind ON los_emails(kind, quadrant, action_done)`);
    await c.query(`ALTER TABLE los_emails ADD COLUMN IF NOT EXISTS niveau_action TEXT`);
    await c.query(`ALTER TABLE los_emails ADD COLUMN IF NOT EXISTS confiance REAL`);
    await c.query(`ALTER TABLE los_emails ADD COLUMN IF NOT EXISTS enfant TEXT`);
    await c.query(`ALTER TABLE los_emails ADD COLUMN IF NOT EXISTS raison TEXT`);
    await c.query(`ALTER TABLE los_emails ADD COLUMN IF NOT EXISTS ecarte_pub BOOLEAN DEFAULT FALSE`);
    await c.query(`ALTER TABLE los_emails ADD COLUMN IF NOT EXISTS theme TEXT`);
    await c.query(`ALTER TABLE los_emails ADD COLUMN IF NOT EXISTS action TEXT`);
    await c.query(`
      CREATE TABLE IF NOT EXISTS los_relances (
        id SERIAL PRIMARY KEY,
        account_id INTEGER REFERENCES los_mail_accounts(id) ON DELETE CASCADE,
        provider_id TEXT UNIQUE NOT NULL,
        conversation_id TEXT,
        sujet TEXT, destinataire TEXT,
        envoye_le TIMESTAMP, apercu TEXT, web_link TEXT,
        est_demande BOOLEAN,
        type_demande TEXT,                           -- 'info' | 'action' | 'aucune'
        resume TEXT,
        repondu BOOLEAN DEFAULT FALSE,
        repondu_le TIMESTAMP,
        relance_faite BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_los_relances ON los_relances(est_demande, repondu, relance_faite)`);
    const seed: [string, string, string][] = [
      ['a.hadjab@louna-aesthetics.com', 'pro', 'microsoft'],
      ['hadjab.job@gmail.com', 'perso', 'google'],
      ['abdelhdz28@gmail.com', 'perso', 'google'],
      ['abdelh2874@gmail.com', 'perso', 'google'],
    ];
    for (const [adresse, kind, provider] of seed) {
      await c.query(`INSERT INTO los_mail_accounts (adresse, kind, provider) VALUES ($1,$2,$3) ON CONFLICT (adresse) DO NOTHING`, [adresse, kind, provider]);
    }
    console.log('✅ Tables emails (los_*) prêtes');
  } finally { c.release(); }
}

// ─── Moteurs IA (DeepSeek en premier, Gemini en secours) ─────────────────────
async function dsChat(messages: any[], maxTokens: number): Promise<any | null> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) return null;
  for (let a = 0; a < 3; a++) {
    if (a > 0) await new Promise(z => setTimeout(z, 700 * a));
    try {
      const r = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: DEEPSEEK_MODEL, messages, temperature: 0.2, max_tokens: maxTokens, response_format: { type: 'json_object' } }),
      });
      const d: any = await r.json();
      if (d?.choices?.[0]?.message) return d.choices[0].message;
    } catch (e) { if (a === 2) console.error('dsChat', e); }
  }
  return null;
}
async function geminiJson(system: string, user: string, maxTokens: number): Promise<any | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  for (let a = 0; a < 3; a++) {
    if (a > 0) await new Promise(z => setTimeout(z, 700 * a));
    try {
      const r = await fetch(`${GL}/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { temperature: 0, maxOutputTokens: maxTokens, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } },
        }),
      });
      const d: any = await r.json();
      const txt = d?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('') || '';
      const m = txt.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
      if (m) return JSON.parse(m[0]);
    } catch (e) { if (a === 2) console.error('geminiJson', e); }
  }
  return null;
}
async function llmJson(system: string, user: string, maxTokens = 2000): Promise<any | null> {
  const m = await dsChat([{ role: 'system', content: system }, { role: 'user', content: user }], maxTokens);
  if (m?.content) {
    try { const j = m.content.match(/\{[\s\S]*\}|\[[\s\S]*\]/); if (j) return JSON.parse(j[0]); } catch { /* on tente Gemini */ }
  }
  return geminiJson(system, user, maxTokens);
}
function iaDisponible(): boolean { return !!(process.env.DEEPSEEK_API_KEY || process.env.GEMINI_API_KEY); }

// ─── Règles de classement ────────────────────────────────────────────────────
const REGLES_PRO = `Tu classes les emails PROFESSIONNELS d'Abdel Hadjab (fondateur de Louna Aesthetics, dispositifs médicaux injectables, ISO 13485) selon la matrice d'Eisenhower.
Quadrants : "UI" = urgent ET important, "InotU" = important pas urgent, "UnotI" = urgent pas important, "NN" = ni urgent ni important.
URGENT+IMPORTANT (UI) pour Abdel, c'est typiquement : un arbitrage demandé sur un lot en fabrication ; une commande d'achat bloquée (information manquante ou paiement attendu) ; un sous-traitant de production qui attend une action de sa part (ex. le CMO Bio-Steril met un lot en hold/quarantaine faute d'information, un fournisseur attend un paiement pour débloquer un transport) ; les études cliniques HAR.
Important pas urgent (InotU) : stratégie, qualité/QMS de fond, réglementaire sans échéance immédiate, projets. UnotI : sollicitations à échéance courte mais faible enjeu (relances commerciales de prestataires, invitations). NN : newsletters, publicité, notifications automatiques.
Donne AUSSI une "theme" (une seule, exactement) parmi : "production_lots" (fabrication, CMO, lots, planning), "achats_fournisseurs" (commandes, matières premières, transport, paiements fournisseurs), "qualite_reglementaire" (QMS, ISO, MDR, NC/CAPA, audits, notified body), "commercial_clients" (ventes, distributeurs, clients, devis), "finance_admin" (banque, compta, factures clients, juridique, RH), "etudes_cliniques" (HAR, investigations cliniques, CRO), "autre".
Et "action" = l'action concrète qu'Abdel doit mener, formulée en 1 courte phrase à l'impératif (ex. "Valider le devis seringues", "Débloquer le paiement du transporteur"). Si aucune action : "Aucune action".
Réponds UNIQUEMENT en JSON : {"items":[{"id":"...","quadrant":"UI|InotU|UnotI|NN","action_requise":true|false,"theme":"...","action":"...","resume":"1 ligne en français"}]}`;

const REGLES_RELANCE = `Tu analyses des emails que Abdel Hadjab (fondateur de Louna Aesthetics) a ENVOYÉS. Pour chacun, dis s'il ATTEND une réponse : est-ce qu'Abdel y demande une INFORMATION ou une ACTION à son interlocuteur ?
"est_demande" = true uniquement si Abdel pose une question, réclame un document/une information, ou demande à quelqu'un de faire quelque chose et attend un retour. false pour : simple envoi d'info, confirmation, remerciement, accusé de réception, email automatique, ou une réponse qui clôt un sujet.
"type" = "info" (il demande une information ou un document) | "action" (il demande une action concrète) | "aucune".
"resume" = 1 courte phrase à l'infinitif : ce qu'Abdel attend (ex. "Obtenir le CoA du lot EA-2024-018", "Relancer le paiement du transporteur").
Réponds UNIQUEMENT en JSON : {"items":[{"id":"...","est_demande":true|false,"type":"info|action|aucune","resume":"..."}]}`;

const THEMES_PRO = ['production_lots', 'achats_fournisseurs', 'qualite_reglementaire', 'commercial_clients', 'finance_admin', 'etudes_cliniques', 'autre'];

async function classifyBatch(kind: 'pro' | 'perso', rows: any[]) {
  if (!rows.length || !iaDisponible()) return;
  // Few-shot : jusqu'à 6 corrections récentes d'Abdel du même type
  const ex = await pool.query(
    `SELECT sujet, expediteur_adresse, quadrant, categorie FROM los_emails WHERE kind=$1 AND corrige=TRUE ORDER BY created_at DESC LIMIT 6`, [kind]);
  const fewshot = ex.rows.length
    ? `\nExemples de classements corrigés par Abdel (à imiter) :\n` + ex.rows.map((r: any) =>
        `- "${(r.sujet || '').slice(0, 80)}" de ${r.expediteur_adresse} → ${kind === 'pro' ? r.quadrant : r.categorie}`).join('\n')
    : '';
  const payload = rows.map(r => ({ id: String(r.id), de: `${r.expediteur || ''} <${r.expediteur_adresse || ''}>`, sujet: r.sujet || '', apercu: (r.apercu || r.corps || '').slice(0, 400) }));
  const out = await llmJson((kind === 'pro' ? REGLES_PRO : REGLES_PERSO_V2) + fewshot, JSON.stringify(payload), 6000);
  if (kind === 'pro') {
    for (const it of out?.items || []) {
      await pool.query(`UPDATE los_emails SET quadrant=$1, action_requise=$2, resume=$3, theme=$4, action=$5 WHERE id=$6 AND corrige=FALSE`,
        [['UI', 'InotU', 'UnotI', 'NN'].includes(it.quadrant) ? it.quadrant : 'NN', !!it.action_requise, it.resume || null,
         THEMES_PRO.includes(it.theme) ? it.theme : 'autre', it.action || null, Number(it.id)]);
    }
  } else {
    for (const it of parseClassificationPerso(out)) {
      await pool.query(
        `UPDATE los_emails SET categorie=$1, niveau_action=$2, confiance=$3, enfant=$4, raison=$5, resume=$5,
                action_requise=$6 WHERE id=$7 AND corrige=FALSE`,
        [it.categorie, it.niveau_action, it.confiance, it.enfant, it.raison, it.niveau_action === 'action_requise', it.id]);
    }
  }
}

async function classifyRelances(rows: any[]) {
  if (!rows.length || !iaDisponible()) return;
  const payload = rows.map(r => ({ id: String(r.id), a: r.destinataire || '', sujet: r.sujet || '', apercu: (r.apercu || '').slice(0, 400) }));
  const out = await llmJson(REGLES_RELANCE, JSON.stringify(payload), 4000);
  for (const it of out?.items || []) {
    const type = ['info', 'action', 'aucune'].includes(it.type) ? it.type : 'aucune';
    await pool.query(`UPDATE los_relances SET est_demande=$1, type_demande=$2, resume=$3 WHERE id=$4`,
      [!!it.est_demande, type, it.resume || null, Number(it.id)]);
  }
}

// ─── Microsoft (Outlook) ─────────────────────────────────────────────────────
const MS_SCOPES = 'offline_access User.Read Mail.Read';
const MS_SCOPES_RW = 'offline_access User.Read Mail.ReadWrite';   // brouillons de relance
let msEcriture = true;
const pendingDevice = new Map<number, { device_code: string; interval: number; timer?: any }>();

async function saveTokens(accountId: number, d: any) {
  const blob = enc(JSON.stringify({ access_token: d.access_token, refresh_token: d.refresh_token, access_expires: Date.now() + (Number(d.expires_in || 3600) - 120) * 1000 }));
  await pool.query(`UPDATE los_mail_accounts SET token_blob=$1, statut='CONNECTE', last_error=NULL WHERE id=$2`, [blob, accountId]);
}

async function msTokenFromRefresh(accountId: number): Promise<string | null> {
  const a = await pool.query(`SELECT token_blob FROM los_mail_accounts WHERE id=$1`, [accountId]);
  if (!a.rows[0]?.token_blob) return null;
  let tok: any;
  try { tok = JSON.parse(dec(a.rows[0].token_blob)); }
  catch {
    await pool.query(`UPDATE los_mail_accounts SET statut='ERREUR', last_error=$1 WHERE id=$2`,
      ['Jeton illisible (clé de chiffrement différente) — reconnecte cette boîte.', accountId]);
    return null;
  }
  if (tok.access_expires > Date.now() + 60000) return tok.access_token;
  const demander = async (scope: string) => {
    const r = await fetch(`https://login.microsoftonline.com/${GRAPH_TENANT_ID}/oauth2/v2.0/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: GRAPH_CLIENT_ID, grant_type: 'refresh_token', refresh_token: tok.refresh_token, scope }),
    });
    return r.json() as Promise<any>;
  };
  let d: any = await demander(msEcriture ? MS_SCOPES_RW : MS_SCOPES);
  if (!d.access_token && msEcriture) { msEcriture = false; d = await demander(MS_SCOPES); }
  if (!d.access_token) { await pool.query(`UPDATE los_mail_accounts SET statut='ERREUR', last_error=$1 WHERE id=$2`, [String(d.error || 'refresh failed'), accountId]); return null; }
  await saveTokens(accountId, d);
  return d.access_token;
}

async function syncMicrosoft(account: any) {
  const at = await msTokenFromRefresh(account.id);
  if (!at) return;
  const since = account.last_sync ? new Date(account.last_sync) : new Date(Date.now() - 7 * 86400000);
  const url = `https://graph.microsoft.com/v1.0/me/messages?$top=50&$orderby=receivedDateTime desc&$filter=receivedDateTime ge ${since.toISOString()}&$select=id,subject,from,receivedDateTime,bodyPreview,isRead,webLink`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${at}` } });
  if (!r.ok) { await pool.query(`UPDATE los_mail_accounts SET last_error=$1 WHERE id=$2`, [`graph ${r.status}`, account.id]); return; }
  const d: any = await r.json();
  const fresh: any[] = [];
  for (const m of d.value || []) {
    const ins = await pool.query(
      `INSERT INTO los_emails (account_id, kind, provider_id, sujet, expediteur, expediteur_adresse, recu_le, apercu, lu, web_link)
       VALUES ($1,'pro',$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (account_id, provider_id) DO UPDATE SET lu=EXCLUDED.lu
       RETURNING id, (xmax = 0) AS inserted, sujet, expediteur, expediteur_adresse, apercu, corps`,
      [account.id, m.id, m.subject || '(sans sujet)', m.from?.emailAddress?.name || '', m.from?.emailAddress?.address || '', m.receivedDateTime, m.bodyPreview || '', !!m.isRead, m.webLink || null]);
    if (ins.rows[0]?.inserted) fresh.push(ins.rows[0]);
  }
  // Réconcilie le statut « lu » : la vue pro n'affiche que les non-lus. Un email lu dans
  // Outlook doit disparaître ici.
  try {
    const ur = await fetch(`https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$top=200&$select=id&$filter=isRead eq false`, { headers: { Authorization: `Bearer ${at}` } });
    if (ur.ok) {
      const ud: any = await ur.json();
      const nonLus: string[] = (ud.value || []).map((m: any) => m.id);
      await pool.query(`UPDATE los_emails SET lu=TRUE  WHERE account_id=$1 AND kind='pro' AND lu=FALSE AND NOT (provider_id = ANY($2::text[]))`, [account.id, nonLus]);
      await pool.query(`UPDATE los_emails SET lu=FALSE WHERE account_id=$1 AND kind='pro' AND provider_id = ANY($2::text[])`, [account.id, nonLus]);
    }
  } catch (e) { console.error('reconcile lu', e); }
  await pool.query(`UPDATE los_mail_accounts SET last_sync=NOW() WHERE id=$1`, [account.id]);
  await classifyBatch('pro', fresh);
}

// Relances : emails PRO envoyés (45 j) restés sans réponse
async function syncSentMicrosoft(account: any) {
  const at = await msTokenFromRefresh(account.id);
  if (!at) return;
  const since = new Date(Date.now() - 45 * 86400000);
  const sentUrl = `https://graph.microsoft.com/v1.0/me/mailFolders/sentitems/messages?$top=50&$orderby=sentDateTime desc&$filter=sentDateTime ge ${since.toISOString()}&$select=id,subject,toRecipients,sentDateTime,bodyPreview,conversationId,webLink`;
  const r = await fetch(sentUrl, { headers: { Authorization: `Bearer ${at}` } });
  if (!r.ok) { await pool.query(`UPDATE los_mail_accounts SET last_error=$1 WHERE id=$2`, [`graph sent ${r.status}`, account.id]); return; }
  const d: any = await r.json();
  const fresh: any[] = [];
  for (const m of d.value || []) {
    const dest = (m.toRecipients || []).map((t: any) => t.emailAddress?.name || t.emailAddress?.address).filter(Boolean).join(', ');
    const ins = await pool.query(
      `INSERT INTO los_relances (account_id, provider_id, conversation_id, sujet, destinataire, envoye_le, apercu, web_link)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (provider_id) DO NOTHING
       RETURNING id, sujet, destinataire, apercu`,
      [account.id, m.id, m.conversationId || null, m.subject || '(sans sujet)', dest,
       m.sentDateTime, (m.bodyPreview || '').slice(0, 500), m.webLink || null]);
    if (ins.rows[0]) fresh.push(ins.rows[0]);
  }
  await classifyRelances(fresh);
  // Détection des réponses : messages reçus dans les mêmes fils
  const recu = await fetch(
    `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$top=250&$orderby=receivedDateTime desc&$filter=receivedDateTime ge ${since.toISOString()}&$select=conversationId,receivedDateTime`,
    { headers: { Authorization: `Bearer ${at}` } });
  if (recu.ok) {
    const rd: any = await recu.json();
    const derniereReponse = new Map<string, string>();
    for (const m of rd.value || []) {
      if (!m.conversationId) continue;
      const prev = derniereReponse.get(m.conversationId);
      if (!prev || m.receivedDateTime > prev) derniereReponse.set(m.conversationId, m.receivedDateTime);
    }
    const ouverts = await pool.query(
      `SELECT id, conversation_id, envoye_le FROM los_relances WHERE account_id=$1 AND repondu=FALSE AND conversation_id IS NOT NULL`, [account.id]);
    for (const row of ouverts.rows) {
      const rep = derniereReponse.get(row.conversation_id);
      if (rep && new Date(rep) > new Date(row.envoye_le)) {
        await pool.query(`UPDATE los_relances SET repondu=TRUE, repondu_le=$1 WHERE id=$2`, [rep, row.id]);
      }
    }
  }
}

// ─── Google (Gmail) ──────────────────────────────────────────────────────────
async function googleTokenFromRefresh(accountId: number): Promise<string | null> {
  const a = await pool.query(`SELECT token_blob FROM los_mail_accounts WHERE id=$1`, [accountId]);
  if (!a.rows[0]?.token_blob) return null;
  let tok: any;
  try { tok = JSON.parse(dec(a.rows[0].token_blob)); }
  catch {
    await pool.query(`UPDATE los_mail_accounts SET statut='ERREUR', last_error=$1 WHERE id=$2`,
      ['Jeton illisible (clé de chiffrement différente) — reconnecte cette boîte.', accountId]);
    return null;
  }
  if (tok.access_expires > Date.now() + 60000) return tok.access_token;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, grant_type: 'refresh_token', refresh_token: tok.refresh_token }),
  });
  const d: any = await r.json();
  if (!d.access_token) { await pool.query(`UPDATE los_mail_accounts SET statut='ERREUR', last_error=$1 WHERE id=$2`, [String(d.error || 'refresh failed'), accountId]); return null; }
  d.refresh_token = d.refresh_token || tok.refresh_token;
  await saveTokens(accountId, d);
  return d.access_token;
}

async function syncGoogle(account: any) {
  const at = await googleTokenFromRefresh(account.id);
  if (!at) return;
  const q = account.last_sync ? `newer_than:2d in:inbox` : `newer_than:7d in:inbox`;
  const list = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=40&q=${encodeURIComponent(q)}`, { headers: { Authorization: `Bearer ${at}` } });
  if (!list.ok) { await pool.query(`UPDATE los_mail_accounts SET last_error=$1 WHERE id=$2`, [`gmail ${list.status}`, account.id]); return; }
  const ids: any = await list.json();
  const fresh: any[] = [];
  for (const it of ids.messages || []) {
    const exists = await pool.query(`SELECT 1 FROM los_emails WHERE account_id=$1 AND provider_id=$2`, [account.id, it.id]);
    if (exists.rows.length) continue;
    const mr = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${it.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date&metadataHeaders=List-Unsubscribe`, { headers: { Authorization: `Bearer ${at}` } });
    if (!mr.ok) continue;
    const m: any = await mr.json();
    const h = (n: string) => (m.payload?.headers || []).find((x: any) => x.name.toLowerCase() === n.toLowerCase())?.value || '';
    const fromRaw = h('From'); const fm = fromRaw.match(/^(.*?)\s*<(.+?)>$/);
    const sujet = h('Subject') || '(sans sujet)';
    const adresse = fm ? fm[2] : fromRaw;
    // Pré-filtre déterministe : la pub/newsletter est écartée AVANT l'IA (coût zéro)
    const verdict = prefiltreGmail({ labelIds: m.labelIds, listUnsubscribe: h('List-Unsubscribe'), expediteurAdresse: adresse, sujet });
    const pub = verdict === 'ecarte_pub';
    const ins = await pool.query(
      `INSERT INTO los_emails (account_id, kind, provider_id, sujet, expediteur, expediteur_adresse, recu_le, apercu, lu, web_link,
                               ecarte_pub, categorie, niveau_action, confiance)
       VALUES ($1,'perso',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (account_id, provider_id) DO NOTHING
       RETURNING id, sujet, expediteur, expediteur_adresse, apercu, corps`,
      [account.id, it.id, sujet, fm ? fm[1].replace(/"/g, '') : fromRaw, adresse,
       new Date(Number(m.internalDate || Date.now())), (m.snippet || '').slice(0, 500),
       !(m.labelIds || []).includes('UNREAD'), `https://mail.google.com/mail/?authuser=${encodeURIComponent(account.adresse)}#all/${m.threadId}`,
       pub, pub ? 'ecarte_pub' : null, pub ? 'archive' : null, pub ? 1 : null]);
    if (ins.rows[0] && !pub) fresh.push(ins.rows[0]);
  }
  // Réconcilie le statut « lu » (comme le pro)
  try {
    const uq = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=200&q=${encodeURIComponent('is:unread in:inbox')}`, { headers: { Authorization: `Bearer ${at}` } });
    if (uq.ok) {
      const ud: any = await uq.json();
      const nonLus: string[] = (ud.messages || []).map((x: any) => x.id);
      await pool.query(`UPDATE los_emails SET lu=TRUE  WHERE account_id=$1 AND kind='perso' AND lu=FALSE AND NOT (provider_id = ANY($2::text[]))`, [account.id, nonLus]);
      await pool.query(`UPDATE los_emails SET lu=FALSE WHERE account_id=$1 AND kind='perso' AND provider_id = ANY($2::text[])`, [account.id, nonLus]);
    }
  } catch (e) { console.error('reconcile lu perso', e); }
  await pool.query(`UPDATE los_mail_accounts SET last_sync=NOW() WHERE id=$1`, [account.id]);
  await classifyBatch('perso', fresh);
}

async function syncAllMail() {
  try {
    const accs = await pool.query(`SELECT * FROM los_mail_accounts WHERE statut='CONNECTE'`);
    for (const a of accs.rows) {
      try { if (a.provider === 'microsoft') { await syncMicrosoft(a); await syncSentMicrosoft(a); } else await syncGoogle(a); }
      catch (e: any) { console.error('sync', a.adresse, e.message); }
    }
  } catch (e) { console.error('syncAllMail', e); }
}

// Relève automatique toutes les 5 minutes (comme dans Louna OS)
export function startMailScheduler() {
  setInterval(syncAllMail, 5 * 60000);
  setTimeout(syncAllMail, 20000);
  console.log('📬 Relève automatique des emails : toutes les 5 min');
}

// ─── Rédaction d'une relance (lit tout le fil, puis rédige) ──────────────────
const TONS: Record<string, string> = {
  amical: "Ton AMICAL : TUTOIE le destinataire. Registre chaleureux et détendu, phrases courtes, pas de formule de politesse guindée. C'est le SEUL ton qui tutoie — ignore ici la consigne de continuité de registre.",
  courtois: "Ton COURTOIS : vouvoiement, chaleureux et compréhensif, on suppose un simple oubli. Formule de politesse complète.",
  direct: "Ton DIRECT : vouvoiement, cordial mais sans détour. On rappelle la demande et on demande une réponse datée. Court.",
  ferme: "Ton FERME : vouvoiement, professionnel et sans agressivité, mais on souligne l'attente, l'impact sur l'activité et on fixe une échéance claire.",
};
const REGLES_BROUILLON = `Tu es Maya, l'assistante d'Abdel Hadjab (fondateur de Louna Aesthetics, laboratoire pharmaceutique/dispositifs médicaux). Tu rédiges pour lui un email de RELANCE en français.
On te donne le fil de discussion complet et ce qu'Abdel attend. Rédige une relance courte (5 à 10 lignes max) qui :
- rappelle en une phrase le contexte et la demande initiale (sans recopier tout l'historique),
- mentionne le temps écoulé de façon factuelle,
- se termine par une demande de réponse claire.
CONTINUITÉ : sauf en ton amical, calque le registre, le niveau de formalité et les formules de l'email initialement envoyé par Abdel, pour que la relance soit dans la continuité naturelle du fil.
SIGNATURE : termine TOUJOURS l'email par ces deux lignes EXACTES, sans rien y changer et sans rien ajouter après :
Maya Assistant
IA agent travaillant avec Abdel HADJAB
N'invente AUCUN fait, chiffre ou engagement absent du fil.
Réponds UNIQUEMENT en JSON : {"objet":"...","corps":"..."} — le corps en texte brut, avec de vrais retours à la ligne.`;

async function filDiscussion(at: string, conversationId: string | null): Promise<any[]> {
  if (!conversationId) return [];
  const url = `https://graph.microsoft.com/v1.0/me/messages?$top=30&$select=subject,from,toRecipients,sentDateTime,receivedDateTime,bodyPreview&$filter=${encodeURIComponent(`conversationId eq '${conversationId.replace(/'/g, "''")}'`)}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${at}` } });
  if (!r.ok) return [];
  const d: any = await r.json();
  return (d.value || [])
    .map((m: any) => ({
      date: (m.sentDateTime || m.receivedDateTime || '').slice(0, 10),
      de: m.from?.emailAddress?.name || m.from?.emailAddress?.address || '?',
      objet: m.subject || '',
      apercu: (m.bodyPreview || '').slice(0, 700),
    }))
    .sort((a: any, b: any) => a.date.localeCompare(b.date));
}

// ─── Données « emails » de l'onglet Accueil ──────────────────────────────────
export async function emailsUrgents(p: Pool): Promise<any[]> {
  const r = await p.query(
    `SELECT id, sujet, expediteur, recu_le, resume, web_link FROM los_emails
     WHERE kind='pro' AND quadrant='UI' AND action_done=FALSE AND lu IS NOT TRUE
     ORDER BY recu_le DESC LIMIT 5`);
  return r.rows;
}

// ─── Routes ──────────────────────────────────────────────────────────────────
type Deps = {
  app: Express;
  pool: Pool;
  authenticateToken: (req: any, res: Response, next: NextFunction) => void;
  requireOwner: (req: any, res: Response, next: NextFunction) => void;
};

export function registerMailRoutes({ app, pool: p, authenticateToken, requireOwner }: Deps) {
  pool = p;
  const owner = [authenticateToken, requireOwner];

  // Boîtes connectées
  app.get('/api/mail/accounts', owner, async (_req: Request, res: Response) => {
    const r = await pool.query(`SELECT id, adresse, kind, provider, statut, last_sync, last_error FROM los_mail_accounts ORDER BY kind DESC, adresse`);
    res.json(r.rows);
  });

  // Liste des emails (filtres multi-valeurs en CSV)
  app.get('/api/emails', owner, async (req: Request, res: Response) => {
    const kind = req.query.kind === 'perso' ? 'perso' : 'pro';
    const vals: any[] = [kind]; const where = ['e.kind=$1'];
    const inClause = (col: string, csv: any) => {
      const list = String(csv || '').split(',').map(s => s.trim()).filter(Boolean);
      if (!list.length) return;
      const ph = list.map(x => { vals.push(x); return `$${vals.length}`; });
      where.push(`${col} IN (${ph.join(',')})`);
    };
    // perso : jamais la pub ni les abonnements, et seulement les non-lus (un email lu = déjà traité)
    if (kind === 'perso') where.push(`(e.ecarte_pub IS NOT TRUE AND e.categorie IS DISTINCT FROM 'ecarte_pub' AND e.categorie IS DISTINCT FROM 'abonnements' AND e.lu IS NOT TRUE)`);
    if (kind === 'pro') where.push(`e.lu IS NOT TRUE`);
    inClause('e.categorie', req.query.categorie);
    inClause('e.niveau_action', req.query.niveau);
    inClause('e.theme', req.query.theme);
    inClause('e.enfant', req.query.enfant);
    const periode = Number(req.query.periode || 0);
    if (periode > 0) { vals.push(periode); where.push(`e.recu_le >= NOW() - ($${vals.length} || ' days')::interval`); }
    const ordre = kind === 'perso'
      ? `ORDER BY (e.niveau_action='action_requise' AND e.action_done=FALSE) DESC, e.recu_le DESC`
      : `ORDER BY e.recu_le DESC`;
    const r = await pool.query(
      `SELECT e.id, e.sujet, e.expediteur, e.expediteur_adresse, e.recu_le, e.apercu, e.lu, e.web_link,
              e.quadrant, e.categorie, e.niveau_action, e.confiance, e.enfant, e.raison, e.theme, e.action,
              e.action_requise, e.action_done, e.resume, a.adresse AS compte
       FROM los_emails e JOIN los_mail_accounts a ON a.id=e.account_id
       WHERE ${where.join(' AND ')} ${ordre} LIMIT 200`, vals);
    res.json(r.rows);
  });

  // Reclassement manuel / « traité »
  app.patch('/api/emails/:id', owner, async (req: Request, res: Response) => {
    const { quadrant, categorie, niveau_action, action_done } = req.body || {};
    const sets: string[] = []; const vals: any[] = [];
    if (quadrant) { vals.push(quadrant); sets.push(`quadrant=$${vals.length}`, `corrige=TRUE`); }
    if (categorie) { vals.push(categorie); sets.push(`categorie=$${vals.length}`, `corrige=TRUE`, `ecarte_pub=${categorie === 'ecarte_pub' ? 'TRUE' : 'FALSE'}`); }
    if (niveau_action) { vals.push(niveau_action); sets.push(`niveau_action=$${vals.length}`, `corrige=TRUE`); vals.push(niveau_action === 'action_requise'); sets.push(`action_requise=$${vals.length}`); }
    if (action_done !== undefined) { vals.push(!!action_done); sets.push(`action_done=$${vals.length}`); }
    if (!sets.length) return res.status(400).json({ error: 'Rien à modifier' });
    vals.push(req.params.id);
    const r = await pool.query(`UPDATE los_emails SET ${sets.join(', ')} WHERE id=$${vals.length} RETURNING id`, vals);
    res.json({ ok: !!r.rows[0] });
  });

  // Action groupée : marquer plusieurs emails traités d'un coup
  app.post('/api/emails/bulk', owner, async (req: Request, res: Response) => {
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter(Number.isFinite).slice(0, 500);
    if (!ids.length) return res.status(400).json({ error: 'Aucun email sélectionné' });
    const r = await pool.query(`UPDATE los_emails SET action_done=$1 WHERE id = ANY($2::int[]) RETURNING id`, [req.body?.action_done !== false, ids]);
    res.json({ ok: true, modifies: r.rows.length });
  });

  // Relève manuelle
  app.post('/api/mail/sync', owner, async (_req: Request, res: Response) => { syncAllMail(); res.json({ ok: true, message: 'Synchronisation lancée' }); });

  // Relances — emails envoyés en attente de réponse
  app.get('/api/relances', owner, async (_req: Request, res: Response) => {
    const r = await pool.query(
      `SELECT id, sujet, destinataire, envoye_le, apercu, web_link, type_demande, resume,
              EXTRACT(DAY FROM NOW() - envoye_le)::int AS jours
       FROM los_relances
       WHERE est_demande=TRUE AND repondu=FALSE AND relance_faite=FALSE
       ORDER BY envoye_le ASC LIMIT 200`);
    res.json(r.rows);
  });
  app.patch('/api/relances/:id', owner, async (req: Request, res: Response) => {
    const { relance_faite, repondu } = req.body || {};
    const sets: string[] = []; const vals: any[] = [];
    if (relance_faite !== undefined) { vals.push(!!relance_faite); sets.push(`relance_faite=$${vals.length}`); }
    if (repondu !== undefined) { vals.push(!!repondu); sets.push(`repondu=$${vals.length}`); }
    if (!sets.length) return res.status(400).json({ error: 'Rien à modifier' });
    vals.push(req.params.id);
    const r = await pool.query(`UPDATE los_relances SET ${sets.join(', ')} WHERE id=$${vals.length} RETURNING id`, vals);
    res.json({ ok: !!r.rows[0] });
  });

  // Proposition d'email de relance rédigée par l'IA (+ brouillon Outlook si possible)
  app.post('/api/relances/:id/brouillon', owner, async (req: Request, res: Response) => {
    try {
      const ton = String(req.body?.ton || 'courtois');
      if (!TONS[ton]) return res.status(400).json({ error: 'Ton inconnu' });
      const q = await pool.query(
        `SELECT id, account_id, provider_id, conversation_id, sujet, destinataire, envoye_le, apercu, resume, type_demande,
                EXTRACT(DAY FROM NOW() - envoye_le)::int AS jours
         FROM los_relances WHERE id=$1`, [req.params.id]);
      const rel = q.rows[0];
      if (!rel) return res.status(404).json({ error: 'Relance introuvable' });

      const at = await msTokenFromRefresh(rel.account_id);
      if (!at) return res.status(502).json({ error: 'Compte Outlook non connecté — reconnecte-le dans l\'onglet Emails.' });

      const fil = await filDiscussion(at, rel.conversation_id);
      const contexte = [
        `Objet du fil : ${rel.sujet}`,
        `Destinataire : ${rel.destinataire || '?'}`,
        `Ce qu'Abdel attend : ${rel.resume || rel.apercu || '(non précisé)'}`,
        `Envoyé il y a ${rel.jours} jour(s), sans réponse.`,
        TONS[ton],
        '',
        fil.length ? 'Fil de discussion complet :' : 'Fil indisponible, voici l\'email envoyé :',
        fil.length
          ? fil.map(m => `[${m.date}] ${m.de} — ${m.objet}\n${m.apercu}`).join('\n---\n')
          : (rel.apercu || ''),
      ].join('\n');

      const j = await llmJson(REGLES_BROUILLON, contexte, 1200);
      if (!j?.corps) return res.status(502).json({ error: "L'IA n'a pas réussi à rédiger la relance. Réessaie." });
      const objet = String(j.objet || `Relance — ${rel.sujet}`);
      const corps = String(j.corps);

      // Brouillon Outlook (si le compte a le droit d'écriture)
      let brouillon: { ok: boolean; lien?: string; raison?: string } = { ok: false, raison: 'permission' };
      if (msEcriture) {
        try {
          const orig = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${rel.provider_id}?$select=toRecipients`, { headers: { Authorization: `Bearer ${at}` } });
          const dests = orig.ok ? ((await orig.json()) as any).toRecipients || [] : [];
          const cr = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${rel.provider_id}/createReply`, { method: 'POST', headers: { Authorization: `Bearer ${at}` } });
          if (cr.ok) {
            const draft: any = await cr.json();
            const up = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${draft.id}`, {
              method: 'PATCH', headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ subject: objet, body: { contentType: 'Text', content: corps }, ...(dests.length ? { toRecipients: dests } : {}) }),
            });
            brouillon = up.ok ? { ok: true, lien: draft.webLink } : { ok: false, raison: `maj brouillon ${up.status}` };
          } else {
            if (cr.status === 403 || cr.status === 401) msEcriture = false;
            brouillon = { ok: false, raison: cr.status === 403 || cr.status === 401 ? 'permission' : `createReply ${cr.status}` };
          }
        } catch (e: any) { brouillon = { ok: false, raison: e.message }; }
      }
      res.json({ objet, corps, ton, messages_fil: fil.length, brouillon });
    } catch (e: any) { console.error('brouillon relance', e); res.status(500).json({ error: e.message }); }
  });

  // Connexion Outlook (device code flow)
  app.post('/api/mail/ms/device-start', owner, async (_req: Request, res: Response) => {
    try {
      if (!GRAPH_CLIENT_ID) return res.status(503).json({ error: 'GRAPH_CLIENT_ID non configuré côté serveur.' });
      const acc = await pool.query(`SELECT id FROM los_mail_accounts WHERE provider='microsoft' LIMIT 1`);
      if (!acc.rows[0]) return res.status(404).json({ error: 'Aucun compte Outlook enregistré.' });
      const accountId = acc.rows[0].id;
      const r = await fetch(`https://login.microsoftonline.com/${GRAPH_TENANT_ID}/oauth2/v2.0/devicecode`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: GRAPH_CLIENT_ID, scope: MS_SCOPES_RW }),
      });
      const d: any = await r.json();
      if (!d.device_code) return res.status(502).json({ error: d.error_description || 'Code d\'appareil refusé (activer « Allow public client flows » sur l\'app Azure)' });
      const prev = pendingDevice.get(accountId); if (prev?.timer) clearInterval(prev.timer);
      const entry = { device_code: d.device_code, interval: Number(d.interval || 5) * 1000, timer: null as any };
      entry.timer = setInterval(async () => {
        try {
          const t = await fetch(`https://login.microsoftonline.com/${GRAPH_TENANT_ID}/oauth2/v2.0/token`, {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ client_id: GRAPH_CLIENT_ID, grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: entry.device_code }),
          });
          const td: any = await t.json();
          if (td.access_token) {
            clearInterval(entry.timer); pendingDevice.delete(accountId);
            msEcriture = true;
            await saveTokens(accountId, td);
            const a = await pool.query(`SELECT * FROM los_mail_accounts WHERE id=$1`, [accountId]);
            syncMicrosoft(a.rows[0]);
          } else if (td.error && td.error !== 'authorization_pending' && td.error !== 'slow_down') {
            clearInterval(entry.timer); pendingDevice.delete(accountId);
            await pool.query(`UPDATE los_mail_accounts SET last_error=$1 WHERE id=$2`, [td.error, accountId]);
          }
        } catch { /* réessaie au tick suivant */ }
      }, entry.interval);
      setTimeout(() => { if (entry.timer) clearInterval(entry.timer); pendingDevice.delete(accountId); }, 15 * 60000);
      pendingDevice.set(accountId, entry);
      res.json({ user_code: d.user_code, verification_uri: d.verification_uri, message: d.message });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Connexion Gmail (OAuth). Le `state` est un jeton à usage unique : le retour Google
  // (qui arrive sans session) n'est accepté que s'il correspond à une demande récente.
  const googleStates = new Map<string, { adresse: string; expire: number }>();
  app.get('/api/mail/google/auth', owner, (req: Request, res: Response) => {
    if (!GOOGLE_CLIENT_ID || !PUBLIC_URL) return res.status(503).json({ error: 'GOOGLE_CLIENT_ID / PUBLIC_URL non configurés côté serveur.' });
    const adresse = String(req.query.adresse || '');
    const state = crypto.randomBytes(16).toString('hex');
    googleStates.set(state, { adresse, expire: Date.now() + 10 * 60000 });
    const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    u.searchParams.set('client_id', GOOGLE_CLIENT_ID);
    u.searchParams.set('redirect_uri', `${PUBLIC_URL}/api/mail/google/callback`);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', 'https://www.googleapis.com/auth/gmail.readonly');
    u.searchParams.set('access_type', 'offline');
    u.searchParams.set('prompt', 'consent');
    u.searchParams.set('login_hint', adresse);
    u.searchParams.set('state', state);
    res.json({ url: u.toString() });
  });
  app.get('/api/mail/google/callback', async (req: Request, res: Response) => {
    try {
      const code = String(req.query.code || '');
      const st = googleStates.get(String(req.query.state || ''));
      googleStates.delete(String(req.query.state || ''));
      if (!st || st.expire < Date.now()) return res.status(400).send('Demande de connexion expirée — relance la connexion depuis LounaFlow.');
      const r = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, redirect_uri: `${PUBLIC_URL}/api/mail/google/callback`, grant_type: 'authorization_code' }),
      });
      const d: any = await r.json();
      if (!d.access_token) return res.status(502).send('Échec OAuth Google : ' + (d.error_description || d.error));
      const acc = await pool.query(`SELECT * FROM los_mail_accounts WHERE adresse=$1`, [st.adresse]);
      if (!acc.rows[0]) return res.status(404).send('Compte inconnu : ' + st.adresse);
      await saveTokens(acc.rows[0].id, d);
      syncGoogle({ ...acc.rows[0], last_sync: null });
      res.send('<meta charset="utf-8"><body style="font-family:sans-serif;display:grid;place-items:center;height:100vh"><div>✅ ' + st.adresse + ' connectée. Tu peux fermer cet onglet et revenir à LounaFlow.</div></body>');
    } catch (e: any) { res.status(500).send(e.message); }
  });
}
