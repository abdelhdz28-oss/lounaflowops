// Tri intelligent Gmail perso — fonctions pures (testables sans réseau ni base).
// Axe 1 : catégorie · Axe 2 : niveau d'action · + enfant concerné + confiance.

export const CATEGORIES_PERSO = [
  'enfants_ecole', 'enfants_sport', 'enfants_sante', 'enfants_periscolaire',
  'admin_impots', 'banque_assurances', 'maison_logement', 'vehicule',
  'sante_longevite', 'suivi_commande', 'abonnements', 'a_verifier', 'ecarte_pub',
] as const;
export const NIVEAUX_ACTION = ['action_requise', 'info', 'archive'] as const;
export const ENFANTS = ['Mohammed-Ayyoub', 'Ibrahim', 'Meriem', 'Isaaq'] as const;
// L'IA (ou une école…) écrit parfois les prénoms autrement : on tolère les variantes courantes.
const ALIAS_ENFANTS: Record<string, string> = {
  'mohammedayyoub': 'Mohammed-Ayyoub', 'mohamedayyoub': 'Mohammed-Ayyoub', 'ayyoub': 'Mohammed-Ayyoub', 'ayoub': 'Mohammed-Ayyoub', 'mohammed': 'Mohammed-Ayyoub', 'mohamed': 'Mohammed-Ayyoub',
  'ibrahim': 'Ibrahim', 'brahim': 'Ibrahim',
  'meriem': 'Meriem', 'mariam': 'Meriem', 'meryem': 'Meriem', 'myriam': 'Meriem', 'marie': 'Meriem',
  'isaaq': 'Isaaq', 'isaac': 'Isaaq', 'ishaq': 'Isaaq', 'ishak': 'Isaaq',
};
export function normaliseEnfant(v: unknown): string | null {
  if (!v) return null;
  const cle = String(v).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
  return ALIAS_ENFANTS[cle] || null;
}
export const SEUIL_CONFIANCE = 0.6;

export type PrefiltreInput = {
  labelIds?: string[];
  listUnsubscribe?: string;      // valeur de l'en-tête List-Unsubscribe ('' si absent)
  expediteurAdresse?: string;
  sujet?: string;
};

const RE_EXPEDITEUR_PUB = /(^|[.<_-])(no-?reply|newsletter|news|marketing|promo|notifications?|mailer|donotreply|noreply)([@.\]_-]|$)/i;
const RE_SUJET_PUB = /(soldes|promotions?|% de r[ée]duction|-\d{2}\s?%|offre sp[ée]ciale|vente flash|black friday|derni[èe]res? heures?|code promo|d[ée]couvrez notre|exclusivit[ée])/i;
// Emails transactionnels de suivi de commande : marchands + transporteurs + langage « commande/expédition ».
const RE_COMMANDE_EXPEDITEUR = /(amazon|aliexpress|cdiscount|fnac|darty|zalando|shein|temu|ebay|vinted|shopify|paypal|leboncoin|manomano|backmarket|ups\.com|dhl|chronopost|colissimo|mondialrelay|laposte|dpd|gls|fedex|boxtal)/i;
const RE_COMMANDE_SUJET = /(commande|order\b|exp[ée]di|shipp(ed|ing)|dispatch|tracking|suivi de (votre )?colis|colis|parcel|livraison|delivered|en cours d'acheminement|confirmation de (votre )?commande|votre commande|order confirmation|facture de votre commande|retour|remboursement)/i;

// Détecte un email de suivi de commande d'après le sujet/expéditeur seuls
// (utilisé pour récupérer a posteriori les emails déjà stockés comme « pub »).
export function estSuiviCommande(sujet?: string, expediteur?: string): boolean {
  return !!((sujet && RE_COMMANDE_SUJET.test(sujet)) || (expediteur && RE_COMMANDE_EXPEDITEUR.test(expediteur) && sujet && RE_COMMANDE_SUJET.test(sujet)));
}

// Pré-filtre déterministe : décide AVANT l'IA si un email est de la pub/newsletter.
export function prefiltreGmail(m: PrefiltreInput): 'ecarte_pub' | 'a_classer' {
  const labels = m.labelIds || [];
  // Suivi de commande = transactionnel : passe TOUJOURS, même si l'expéditeur est « no-reply »
  // ou porte un lien de désabonnement (sauf s'il est explicitement rangé en Promotions par Gmail).
  const commande = (m.sujet && RE_COMMANDE_SUJET.test(m.sujet)) || (m.expediteurAdresse && RE_COMMANDE_EXPEDITEUR.test(m.expediteurAdresse) && m.sujet && RE_COMMANDE_SUJET.test(m.sujet));
  if (commande && !labels.includes('CATEGORY_PROMOTIONS')) return 'a_classer';
  if (labels.includes('CATEGORY_PROMOTIONS') || labels.includes('CATEGORY_SOCIAL')) return 'ecarte_pub';
  if (m.listUnsubscribe && m.listUnsubscribe.trim() !== '') return 'ecarte_pub';
  if (m.expediteurAdresse && RE_EXPEDITEUR_PUB.test(m.expediteurAdresse)) return 'ecarte_pub';
  if (m.sujet && RE_SUJET_PUB.test(m.sujet)) return 'ecarte_pub';
  return 'a_classer';
}

export type ClassifItem = {
  id: number;
  categorie: string;
  niveau_action: string;
  confiance: number;
  enfant: string | null;
  raison: string;
};

// Normalise et valide la sortie JSON de l'IA. Tolère les champs manquants/farfelus.
// Applique le seuil de confiance : < 0.6 → a_verifier.
export function parseClassificationPerso(raw: any): ClassifItem[] {
  const items = Array.isArray(raw?.items) ? raw.items : [];
  const out: ClassifItem[] = [];
  for (const it of items) {
    const id = Number(it?.id);
    if (!Number.isFinite(id)) continue;
    let categorie = String(it?.categorie || '').toLowerCase().trim();
    if (!(CATEGORIES_PERSO as readonly string[]).includes(categorie)) categorie = 'a_verifier';
    let niveau = String(it?.niveau_action || '').toLowerCase().trim();
    if (!(NIVEAUX_ACTION as readonly string[]).includes(niveau)) niveau = 'info';
    let confiance = Number(it?.confiance);
    if (!Number.isFinite(confiance)) confiance = 0;
    confiance = Math.max(0, Math.min(1, confiance));
    if (confiance < SEUIL_CONFIANCE && categorie !== 'ecarte_pub') categorie = 'a_verifier';
    const enfant = normaliseEnfant(it?.enfant);
    out.push({ id, categorie, niveau_action: niveau, confiance, enfant, raison: String(it?.raison || '').slice(0, 300) });
  }
  return out;
}

// Prompt système de classification perso (few-shot ajouté par l'appelant).
export const REGLES_PERSO_V2 = `Tu classes les emails PERSONNELS d'Abdel Hadjab selon DEUX axes, en français.

AXE 1 — categorie (une seule, exactement parmi) :
- "enfants_ecole" : scolarité des enfants (Mohammed-Ayyoub, Ibrahim, Meriem, Isaaq) — école, collège, cantine scolaire, Pronote, réunions parents
- "enfants_sport" : sport des enfants — FFF, US Pringy, clubs, licences, convocations, entraînements
- "enfants_sante" : santé des enfants — pédiatre, orthodontiste, vaccins, CPAM les concernant
- "enfants_periscolaire" : activités périscolaires — centre de loisirs, garderie, colonies, stages vacances
- "admin_impots" : impôts et administration — DGFiP, CAF, préfecture, ANTS, service-public
- "banque_assurances" : comptes, cartes, virements, crédits, assurances (auto/habitation/vie)
- "maison_logement" : location d'appartement, propriétaire, agence, électricité, gaz, internet, téléphone, eau, travaux
- "vehicule" : voiture — entretien, contrôle technique, amendes, carte grise, parking
- "sante_longevite" : santé d'Abdel — médecin, mutuelle, sport perso, nutrition, longévité
- "suivi_commande" : suivi de commandes et achats en ligne — Amazon, AliExpress, Cdiscount, Fnac, Shein, Temu, Vinted, etc. : confirmations de commande, expéditions, suivi de colis, transporteurs (Colissimo, Chronopost, UPS, DHL…), retours et remboursements
- "abonnements" : abonnements et services numériques (streaming, presse, apps, cloud)
- "a_verifier" : impossible à classer avec certitude
- "ecarte_pub" : pur marketing/newsletter sans valeur personnelle

AXE 2 — niveau_action (un seul) :
- "action_requise" : Abdel doit FAIRE quelque chose (payer, signer, répondre, fournir un document, s'inscrire, se déplacer) — y compris les relances et échéances de paiement
- "info" : bon à savoir, aucune action attendue
- "archive" : sans intérêt, à classer sans lire

Aussi : "enfant" = prénom concerné (Mohammed-Ayyoub, Ibrahim, Meriem ou Isaaq) ou null ; "confiance" = 0 à 1 ; "raison" = 1 courte phrase.
Réponds UNIQUEMENT en JSON strict : {"items":[{"id":"...","categorie":"...","niveau_action":"...","confiance":0.85,"enfant":null,"raison":"..."}]}`;
