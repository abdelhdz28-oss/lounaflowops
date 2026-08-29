import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../AuthContext';
import { cn } from '../utils/cn';
import { Loader2, RefreshCw, ExternalLink, Copy, Check } from 'lucide-react';

// Emails — repris de Louna OS. Pro : matrice d'Eisenhower, vue par thématique, relances
// (avec brouillon rédigé par l'IA). Perso : digest par catégorie, pub et abonnements masqués.
// Seuls les emails NON LUS sont affichés : lire un email dans Outlook/Gmail le fait disparaître ici.

const API_URL = import.meta.env.VITE_API_URL || '';

const QUADS: Record<string, string> = {
  UI: '🔴 Urgent + Important', InotU: '🟢 Important, pas urgent',
  UnotI: '🟡 Urgent, pas important', NN: "⚪ Ni l'un ni l'autre",
};
const CATS: Record<string, string> = {
  enfants_ecole: '🏫 École', enfants_sport: '⚽ Sport enfants', enfants_sante: '🩺 Santé enfants', enfants_periscolaire: '🎨 Périscolaire',
  admin_impots: '🧾 Impôts/Admin', banque_assurances: '🏦 Banque/Assur.', maison_logement: '🏠 Maison/Logement', vehicule: '🚗 Véhicule',
  sante_longevite: '💪 Santé/Longévité', suivi_commande: '📦 Suivi de commande', abonnements: '📱 Abonnements', a_verifier: '❓ À vérifier',
};
const NIVEAUX: Record<string, string> = { action_requise: '🔴 Action requise', info: '🔵 Info', archive: '📦 Archive' };
const THEMES: Record<string, string> = {
  production_lots: '🏭 Production / Lots', achats_fournisseurs: '📦 Achats / Fournisseurs', qualite_reglementaire: '🧪 Qualité / Réglementaire',
  etudes_cliniques: '🔬 Études cliniques', commercial_clients: '🤝 Commercial / Clients', finance_admin: '💶 Finance / Admin', autre: '📌 Autre',
};
const ORDRE_THEMES = ['production_lots', 'achats_fournisseurs', 'qualite_reglementaire', 'etudes_cliniques', 'commercial_clients', 'finance_admin', 'autre'];
const ENFANTS = ['Mohammed-Ayyoub', 'Ibrahim', 'Meriem', 'Isaaq'];
const TONS: [string, string][] = [['amical', 'Amical (tutoiement)'], ['courtois', 'Courtois'], ['direct', 'Direct'], ['ferme', 'Ferme']];
const FILTER_KEY = 'louna_mail_filter_v1';

const fdate = (d?: string | null) => d ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) : '—';
const fheure = (d?: string | null) => d ? new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';

type Email = {
  id: number; sujet: string; expediteur: string; expediteur_adresse: string; recu_le: string;
  apercu: string; lu: boolean; web_link: string | null; quadrant: string | null; categorie: string | null;
  niveau_action: string | null; confiance: number | null; enfant: string | null; raison: string | null;
  theme: string | null; action: string | null; action_requise: boolean; action_done: boolean;
  resume: string | null; compte: string;
};
type Compte = { id: number; adresse: string; kind: string; provider: string; statut: string; last_sync: string | null; last_error: string | null };
type Relance = { id: number; sujet: string; destinataire: string; envoye_le: string; apercu: string; web_link: string | null; type_demande: string; resume: string | null; jours: number };

// `key` est déclaré explicitement : le projet n'embarque pas @types/react, TypeScript ne
// connaît donc pas les attributs JSX implicites.
function Chip({ active, onClick, children }: { active?: boolean; onClick: () => void; children: React.ReactNode; key?: React.Key }) {
  return (
    <button onClick={onClick} className={cn(
      'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
      active ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
    )}>{children}</button>
  );
}

export function EmailsView() {
  const { token } = useAuth();
  const api = useCallback(async (p: string, opt: RequestInit = {}) => {
    const r = await fetch(`${API_URL}${p}`, {
      ...opt, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(opt.headers || {}) },
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((d as any).error || `Erreur ${r.status}`);
    return d as any;
  }, [token]);

  // Filtres (mémorisés d'une session à l'autre)
  const [kind, setKind] = useState<'pro' | 'perso'>('pro');
  const [proVue, setProVue] = useState<'eisenhower' | 'theme' | 'relance'>('eisenhower');
  const [cats, setCats] = useState<string[]>([]);
  const [niveaux, setNiveaux] = useState<string[]>([]);
  const [enfants, setEnfants] = useState<string[]>([]);
  const [periode, setPeriode] = useState(0);
  const [filtreMemo, setFiltreMemo] = useState(!!localStorage.getItem(FILTER_KEY));

  useEffect(() => {
    try {
      const f = JSON.parse(localStorage.getItem(FILTER_KEY) || 'null');
      if (!f) return;
      setKind(f.mailKind === 'perso' ? 'perso' : 'pro');
      setProVue(['eisenhower', 'theme', 'relance'].includes(f.mailProVue) ? f.mailProVue : 'eisenhower');
      setCats(Array.isArray(f.mailCat) ? f.mailCat : []);
      setNiveaux(Array.isArray(f.mailNiveau) ? f.mailNiveau : []);
      setEnfants(Array.isArray(f.mailEnfant) ? f.mailEnfant : []);
      setPeriode(Number(f.mailPeriode) || 0);
    } catch { /* filtre corrompu : on ignore */ }
  }, []);

  const [emails, setEmails] = useState<Email[]>([]);
  const [comptes, setComptes] = useState<Compte[]>([]);
  const [relances, setRelances] = useState<Relance[]>([]);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const acc = await api('/api/mail/accounts');
      setComptes(acc);
      if (kind === 'pro' && proVue === 'relance') {
        setRelances(await api('/api/relances'));
      } else {
        const qs = new URLSearchParams({ kind });
        if (kind === 'perso') {
          if (cats.length) qs.set('categorie', cats.join(','));
          if (niveaux.length) qs.set('niveau', niveaux.join(','));
          if (enfants.length) qs.set('enfant', enfants.join(','));
          if (periode) qs.set('periode', String(periode));
        }
        setEmails(await api(`/api/emails?${qs}`));
      }
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [api, kind, proVue, cats, niveaux, enfants, periode]);
  useEffect(() => { load(); }, [load]);

  const patch = async (id: number, body: any) => { await api(`/api/emails/${id}`, { method: 'PATCH', body: JSON.stringify(body) }); load(); };
  const toggleSel = (id: number) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const bulkDone = async () => {
    await api('/api/emails/bulk', { method: 'POST', body: JSON.stringify({ ids: [...sel], action_done: true }) });
    setSel(new Set()); load();
  };
  const relever = async () => { await api('/api/mail/sync', { method: 'POST' }); setMsg('Relève lancée — recharge dans ~30 s.'); setTimeout(() => setMsg(''), 6000); };
  const toggleIn = (arr: string[], set: (v: string[]) => void, k: string) => set(arr.includes(k) ? arr.filter(x => x !== k) : [...arr, k]);

  const sauverFiltre = () => {
    localStorage.setItem(FILTER_KEY, JSON.stringify({ mailKind: kind, mailProVue: proVue, mailCat: cats, mailNiveau: niveaux, mailEnfant: enfants, mailPeriode: periode }));
    setFiltreMemo(true); setMsg('Filtre enregistré ✅'); setTimeout(() => setMsg(''), 2500);
  };
  const oublierFiltre = () => {
    localStorage.removeItem(FILTER_KEY); setFiltreMemo(false);
    setKind('pro'); setProVue('eisenhower'); setCats([]); setNiveaux([]); setEnfants([]); setPeriode(0);
  };

  // ── Carte d'un email ──────────────────────────────────────────────────────
  const Carte = ({ m }: { m: Email; key?: React.Key }) => {
    const actionEnCours = kind === 'perso' ? m.niveau_action === 'action_requise' : m.action_requise;
    const opts = kind === 'pro' ? QUADS : CATS;
    return (
      <div className={cn('bg-white border border-slate-200 rounded-lg p-3 space-y-1.5', m.action_done && 'opacity-50')}>
        <div className="flex items-start gap-2">
          <input type="checkbox" checked={sel.has(m.id)} onChange={() => toggleSel(m.id)} className="mt-1 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] text-slate-400 truncate">
              {m.expediteur || m.expediteur_adresse} · {fdate(m.recu_le)} · {m.compte}
              {kind === 'perso' && m.enfant && <span className="ml-1 text-emerald-600">👦 {m.enfant}</span>}
              {kind === 'perso' && m.categorie === 'a_verifier' && <span className="ml-1 text-amber-600">❓ IA pas sûre{m.confiance ? ` (${Math.round(m.confiance * 100)} %)` : ''}</span>}
            </div>
            <div onClick={() => m.web_link && window.open(m.web_link, '_blank', 'noopener')}
              className={cn('text-sm font-medium text-slate-800 leading-snug', m.web_link && 'cursor-pointer hover:text-blue-700')}>
              {m.sujet}
            </div>
            {m.action && m.action !== 'Aucune action'
              ? <div className="text-xs text-slate-600 mt-0.5">👉 <b>{m.action}</b></div>
              : (m.resume || m.raison) && <div className="text-xs text-slate-500 mt-0.5">🤖 {m.resume || m.raison}</div>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 pl-6">
          <select value={(kind === 'pro' ? m.quadrant : m.categorie) || ''} onChange={e => patch(m.id, kind === 'pro' ? { quadrant: e.target.value } : { categorie: e.target.value })}
            className="text-[11px] border border-slate-200 rounded px-1.5 py-1 bg-white text-slate-600">
            {Object.entries(opts).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          {kind === 'perso' && (
            <select value={m.niveau_action || ''} onChange={e => patch(m.id, { niveau_action: e.target.value })}
              className="text-[11px] border border-slate-200 rounded px-1.5 py-1 bg-white text-slate-600">
              {Object.entries(NIVEAUX).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          )}
          {actionEnCours && (
            <button onClick={() => patch(m.id, { action_done: !m.action_done })}
              className="text-[11px] px-2 py-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-50">
              {m.action_done ? '↩︎ Rouvrir' : '✓ Traité'}
            </button>
          )}
          {m.web_link && <a href={m.web_link} target="_blank" rel="noopener noreferrer" className="text-slate-300 hover:text-blue-600"><ExternalLink className="w-3.5 h-3.5" /></a>}
        </div>
      </div>
    );
  };

  const Colonne = ({ titre, compte, children }: { titre: string; compte: number; children: React.ReactNode; key?: React.Key }) => (
    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
      <h3 className="text-xs font-semibold text-slate-700 mb-2 flex items-baseline gap-1.5">{titre}<span className="text-slate-400 font-normal">{compte}</span></h3>
      <div className="space-y-2">{children}</div>
    </div>
  );

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">
      {/* Bascule pro / perso + mémorisation du filtre */}
      <div className="flex flex-wrap items-center gap-2">
        <Chip active={kind === 'pro'} onClick={() => setKind('pro')}>💼 Pro — Eisenhower</Chip>
        <Chip active={kind === 'perso'} onClick={() => setKind('perso')}>🏠 Perso — catégories</Chip>
        <div className="flex-1" />
        <button onClick={sauverFiltre} className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">💾 Enregistrer ce filtre</button>
        {filtreMemo && <button onClick={oublierFiltre} className="text-xs px-2.5 py-1.5 rounded-lg text-slate-400 hover:text-slate-700">🗑️ Oublier</button>}
        <button onClick={load} disabled={loading} className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 disabled:opacity-50">
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} /> Actualiser
        </button>
      </div>

      {msg && <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{msg}</p>}
      {error && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

      {kind === 'pro' ? (
        <>
          <div className="flex flex-wrap gap-2">
            <Chip active={proVue === 'eisenhower'} onClick={() => setProVue('eisenhower')}>🎯 Matrice Eisenhower</Chip>
            <Chip active={proVue === 'theme'} onClick={() => setProVue('theme')}>🗂️ Par thématique + action</Chip>
            <Chip active={proVue === 'relance'} onClick={() => setProVue('relance')}>📮 Relances</Chip>
          </div>

          {loading && <div className="text-slate-400 text-sm flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Chargement…</div>}

          {!loading && proVue === 'eisenhower' && (
            <div className="grid md:grid-cols-2 gap-3">
              {Object.entries(QUADS).map(([q, label]) => {
                const list = emails.filter(m => (m.quadrant || 'NN') === q);
                return (
                  <Colonne key={q} titre={label} compte={list.length}>
                    {!list.length && <p className="text-xs text-slate-400">Rien ici.</p>}
                    {list.slice(0, 25).map(m => <Carte key={m.id} m={m} />)}
                  </Colonne>
                );
              })}
            </div>
          )}

          {!loading && proVue === 'theme' && (
            <div className="grid md:grid-cols-2 gap-3">
              {ORDRE_THEMES.map(th => {
                const list = emails.filter(m => (m.theme || 'autre') === th);
                const nbAct = list.filter(m => m.action_requise && !m.action_done).length;
                return (
                  <Colonne key={th} titre={`${THEMES[th]}${nbAct ? ` · ${nbAct} action(s)` : ''}`} compte={list.length}>
                    {!list.length && <p className="text-xs text-slate-400">Rien ici.</p>}
                    {list.slice(0, 30).map(m => <Carte key={m.id} m={m} />)}
                  </Colonne>
                );
              })}
            </div>
          )}

          {!loading && proVue === 'relance' && <Relances relances={relances} api={api} reload={load} />}
        </>
      ) : (
        <>
          {/* Filtres perso : plusieurs valeurs possibles par ligne */}
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              <Chip active={!cats.length} onClick={() => setCats([])}>🗂️ Toutes catégories</Chip>
              {Object.entries(CATS).filter(([k]) => k !== 'abonnements').map(([k, l]) => (
                <Chip key={k} active={cats.includes(k)} onClick={() => toggleIn(cats, setCats, k)}>{l}</Chip>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Chip active={!niveaux.length} onClick={() => setNiveaux([])}>📊 Tous niveaux</Chip>
              {Object.entries(NIVEAUX).map(([k, l]) => (
                <Chip key={k} active={niveaux.includes(k)} onClick={() => toggleIn(niveaux, setNiveaux, k)}>{l}</Chip>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Chip active={!enfants.length} onClick={() => setEnfants([])}>👨‍👩‍👧‍👦 Tous les enfants</Chip>
              {ENFANTS.map(e => <Chip key={e} active={enfants.includes(e)} onClick={() => toggleIn(enfants, setEnfants, e)}>👦 {e}</Chip>)}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Chip active={!periode} onClick={() => setPeriode(0)}>Toute période</Chip>
              <Chip active={periode === 7} onClick={() => setPeriode(7)}>7 jours</Chip>
              <Chip active={periode === 30} onClick={() => setPeriode(30)}>30 jours</Chip>
            </div>
          </div>

          <div className="text-xs text-slate-500">
            <b className="text-slate-700">📮 Digest perso</b> — {emails.length} non-lus ·{' '}
            {emails.filter(m => m.niveau_action === 'action_requise' && !m.action_done).length} action(s) requise(s) · pub + abonnements masqués
          </div>

          {loading && <div className="text-slate-400 text-sm flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Chargement…</div>}
          {!loading && (
            <div className="grid md:grid-cols-3 gap-3">
              {comptes.filter(a => a.kind === 'perso').map(a => {
                const list = emails.filter(m => m.compte === a.adresse);
                return (
                  <Colonne key={a.id} titre={`📮 ${a.adresse.replace('@gmail.com', '')}`} compte={list.length}>
                    {!list.length && <p className="text-xs text-slate-400">{a.statut === 'CONNECTE' ? 'Rien pour ces filtres.' : 'Boîte non connectée (voir en bas de page).'}</p>}
                    {list.slice(0, 40).map(m => <Carte key={m.id} m={m} />)}
                  </Colonne>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Boîtes connectées */}
      <Boites comptes={comptes} api={api} onRelever={relever} />

      {/* Barre d'action groupée */}
      {sel.size > 0 && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-40 bg-slate-900 text-white rounded-full shadow-lg px-4 py-2.5 flex items-center gap-3 text-sm">
          <span>{sel.size} sélectionné(s)</span>
          <button onClick={bulkDone} className="px-3 py-1 rounded-full bg-blue-600 hover:bg-blue-500 text-xs font-medium">✓ Marquer traités</button>
          <button onClick={() => setSel(new Set())} className="text-xs text-slate-300 hover:text-white">Tout désélectionner</button>
        </div>
      )}
    </div>
  );
}

// ── Vue « Relances » : emails envoyés en attente de réponse ──────────────────
function Relances({ relances, api, reload }: { relances: Relance[]; api: (p: string, o?: RequestInit) => Promise<any>; reload: () => void }) {
  const [brouillons, setBrouillons] = useState<Record<number, any>>({});
  const [enCours, setEnCours] = useState<number | null>(null);
  const [copie, setCopie] = useState<number | null>(null);

  const proposer = async (id: number, ton: string) => {
    setEnCours(id);
    setBrouillons(b => ({ ...b, [id]: { chargement: true } }));
    try {
      const d = await api(`/api/relances/${id}/brouillon`, { method: 'POST', body: JSON.stringify({ ton }) });
      setBrouillons(b => ({ ...b, [id]: d }));
    } catch (e: any) {
      setBrouillons(b => ({ ...b, [id]: { erreur: e.message } }));
    } finally { setEnCours(null); }
  };

  if (!relances.length) {
    return <p className="text-sm text-slate-400">Rien en attente — tout le monde t'a répondu ✅ (ou le compte pro n'est pas connecté / pas encore synchronisé).</p>;
  }

  return (
    <div className="space-y-3">
      <div className="text-xs text-slate-500">
        <b className="text-slate-700">📮 En attente de réponse</b> — {relances.length} email(s) envoyé(s) sans retour · tu demandes, personne n'a répondu
      </div>
      {relances.map(m => {
        const j = Number(m.jours) || 0;
        const tone = j >= 7 ? 'border-red-300 bg-red-50/40' : j >= 3 ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200';
        const b = brouillons[m.id];
        return (
          <div key={m.id} className={cn('bg-white border rounded-xl p-4 space-y-2', tone)}>
            <div className="text-[11px] text-slate-400">à {m.destinataire || '?'} · envoyé il y a {j} j</div>
            <div className="text-sm font-medium text-slate-800">{m.sujet}</div>
            {m.resume && <div className="text-xs text-slate-600">👉 {m.resume}</div>}
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn('text-[11px] px-2 py-0.5 rounded-full border', j >= 7 ? 'bg-red-50 text-red-700 border-red-200' : 'bg-slate-100 text-slate-600 border-slate-200')}>
                {m.type_demande === 'action' ? 'action demandée' : 'info demandée'}
              </span>
              {m.web_link && <a href={m.web_link} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1">↗︎ Voir l'email</a>}
              <button onClick={async () => { await api(`/api/relances/${m.id}`, { method: 'PATCH', body: JSON.stringify({ relance_faite: true }) }); reload(); }}
                className="text-xs px-2 py-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-50">✅ Relancé / Masquer</button>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-100">
              <span className="text-xs text-slate-500">✍️ Proposer une relance :</span>
              {TONS.map(([ton, libelle]) => (
                <button key={ton} disabled={enCours === m.id} onClick={() => proposer(m.id, ton)}
                  className="text-xs px-2 py-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                  {libelle}
                </button>
              ))}
            </div>

            {b?.chargement && <p className="text-xs text-slate-400 flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> L'IA lit la discussion et rédige…</p>}
            {b?.erreur && <p className="text-xs text-red-600">{b.erreur}</p>}
            {b?.corps && (
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
                <div className="text-[11px] text-slate-400">Ton {b.ton} · {b.messages_fil} message(s) lus dans le fil</div>
                <div className="text-xs font-medium text-slate-700">Objet : {b.objet}</div>
                <pre className="text-xs text-slate-700 whitespace-pre-wrap font-sans leading-relaxed">{b.corps}</pre>
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={() => { navigator.clipboard.writeText(b.corps); setCopie(m.id); setTimeout(() => setCopie(null), 1800); }}
                    className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-500 inline-flex items-center gap-1">
                    {copie === m.id ? <><Check className="w-3 h-3" /> Copié</> : <><Copy className="w-3 h-3" /> Copier</>}
                  </button>
                  {b.brouillon?.ok && (
                    <>
                      <a href={b.brouillon.lien} target="_blank" rel="noopener noreferrer"
                        className="text-xs px-2 py-1 rounded border border-slate-200 text-slate-600 hover:bg-white">↗︎ Ouvrir le brouillon Outlook</a>
                      <span className="text-xs text-slate-400">Brouillon créé dans Outlook ✅</span>
                    </>
                  )}
                  {b.brouillon?.raison === 'permission' && (
                    <span className="text-xs text-slate-400">Brouillon Outlook indisponible : reconnecte ton compte pro pour l'activer.</span>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Boîtes connectées ────────────────────────────────────────────────────────
function Boites({ comptes, api, onRelever }: { comptes: Compte[]; api: (p: string, o?: RequestInit) => Promise<any>; onRelever: () => void }) {
  const [infos, setInfos] = useState<Record<number, string>>({});

  const connecter = async (a: Compte) => {
    try {
      if (a.provider === 'microsoft') {
        const d = await api('/api/mail/ms/device-start', { method: 'POST' });
        setInfos(i => ({ ...i, [a.id]: `Va sur ${d.verification_uri} et entre le code ${d.user_code} — la connexion est détectée automatiquement.` }));
      } else {
        const d = await api(`/api/mail/google/auth?adresse=${encodeURIComponent(a.adresse)}`);
        window.open(d.url, '_blank', 'noopener');
      }
    } catch (e: any) { setInfos(i => ({ ...i, [a.id]: `Erreur : ${e.message}` })); }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 mt-6">
      <h2 className="text-sm font-semibold text-slate-800 mb-3">🔌 Boîtes connectées</h2>
      <div className="space-y-2">
        {comptes.map(a => (
          <div key={a.id} className="flex flex-wrap items-center gap-2 text-sm border-b border-slate-50 last:border-0 pb-2 last:pb-0">
            <span className="font-medium text-slate-700">{a.kind === 'pro' ? '💼' : '🏠'} {a.adresse}</span>
            {a.statut === 'CONNECTE' ? (
              <span className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                connectée · relève {a.last_sync ? `${fdate(a.last_sync)} ${fheure(a.last_sync)}` : '—'}
              </span>
            ) : a.statut === 'ERREUR' ? (
              <span className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">erreur : {a.last_error || ''}</span>
            ) : (
              <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">non connectée</span>
            )}
            {a.statut !== 'CONNECTE' && (
              <button onClick={() => connecter(a)} className="text-xs px-2 py-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-50">Connecter</button>
            )}
            {infos[a.id] && <span className="w-full text-xs text-slate-600 bg-slate-50 rounded px-2 py-1">{infos[a.id]}</span>}
          </div>
        ))}
      </div>
      <button onClick={onRelever} className="mt-3 text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">🔄 Relever maintenant</button>
    </div>
  );
}
