import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../AuthContext';
import { cn } from '../utils/cn';
import { Plus, Trash2, FileText, Mail, History, X, ChevronRight, ChevronDown, ChevronUp, Check, Sparkles } from 'lucide-react';
import { formatDate } from '../constants';

// Lundi (ISO) d'une chaîne semaine "2026-W26" -> "2026-06-22"
function isoMonday(weekStr: string): string {
  const [y, w] = weekStr.split('-W').map(Number);
  const simple = new Date(Date.UTC(y, 0, 1 + (w - 1) * 7));
  const dow = simple.getUTCDay();
  if (dow <= 4) simple.setUTCDate(simple.getUTCDate() - dow + 1);
  else simple.setUTCDate(simple.getUTCDate() + 8 - dow);
  return simple.toISOString().slice(0, 10);
}

const API_URL = import.meta.env.VITE_API_URL || '';

// CA : objectif = forecast (qty × prix), réalisé = realise (qty = € directement). Miroir de VentesView.
const monthlyCA = (rows: any[]) => { const m = Array(12).fill(0); for (const v of rows || []) for (let i = 0; i < 12; i++) m[i] += (v.qty?.[i] || 0) * (v.prixUnitaire || 0); return m; };
const monthlyEur = (rows: any[]) => { const m = Array(12).fill(0); for (const v of rows || []) for (let i = 0; i < 12; i++) m[i] += (v.qty?.[i] || 0); return m; };
const eur = (n: number) => (n || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' €';

const OPS_STATUSES = [
  { value: 'complete', label: 'Terminé', color: 'bg-green-100 text-green-700 border-green-200', bar: 'bg-green-500' },
  { value: 'in_progress', label: 'En cours', color: 'bg-blue-100 text-blue-700 border-blue-200', bar: 'bg-blue-500' },
  { value: 'not_started', label: 'Pas commencé', color: 'bg-slate-100 text-slate-600 border-slate-200', bar: 'bg-slate-300' },
  { value: 'delay', label: 'En retard', color: 'bg-red-100 text-red-700 border-red-200', bar: 'bg-red-500' },
];
const statusColor = (s: string) => OPS_STATUSES.find(x => x.value === s)?.color || OPS_STATUSES[2].color;

function isoWeek(d = new Date()): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
const todayStr = () => new Date().toISOString().slice(0, 10);
function addDays(iso: string, n: number) { const d = new Date(iso); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }

interface Board {
  projects: any[]; milestones: any[]; deliverables: any[]; weeklyComments: any[]; deadlineHistory: any[]; synthesisNotes?: any[];
}

export function OpsReportingView() {
  const { token, socket, canEdit, isAdmin } = useAuth();
  const [board, setBoard] = useState<Board>({ projects: [], milestones: [], deliverables: [], weeklyComments: [], deadlineHistory: [], synthesisNotes: [] });
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const [historyItem, setHistoryItem] = useState<{ type: string; id: string; title: string } | null>(null);
  // Archivage justifié d'un projet + import d'un planning
  const [afficherArchives, setAfficherArchives] = useState(false);
  const [archiveProjet, setArchiveProjet] = useState<any | null>(null);
  const [importProjet, setImportProjet] = useState<any | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [trend, setTrend] = useState<any>(null);   // chiffres clés de la semaine précédente (tendance N vs N-1)
  const toggleCollapse = (id: string) => setCollapsed(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const week = isoWeek();
  const weekLabel = 'semaine du ' + formatDate(isoMonday(week));

  const load = useCallback(async () => {
    if (!token) return;
    const r = await fetch(`${API_URL}/api/ops/board`, { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) setBoard(await r.json());
  }, [token]);

  useEffect(() => { load(); }, [load]);

  // Récupère les données fraîches (QMS + CA) au moment EXACT de générer le débrief.
  // Évite le décalage où l'Odoo (réalisé) n'est pas encore chargé → réalisé erroné (~0 €).
  const buildCaQmsCtx = async () => {
    const y = new Date().getFullYear();
    const tt = todayStr();
    let qms: any[] = [], vF: any[] = [], vR: any[] = [], odoo: any[] = [];
    try {
      const [a, b, c] = await Promise.all([
        fetch(`${API_URL}/api/qms/tracking?status=OPEN`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_URL}/api/ventes/data?year=${y}`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_URL}/api/ventes/odoo-realise?year=${y}`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (a.ok) qms = await a.json();
      if (b.ok) { const d = await b.json(); vF = d.forecast || []; vR = d.realise || []; }
      if (c.ok) { const d = await c.json(); odoo = Array.isArray(d.rows) ? d.rows : []; }
    } catch { /* synthèse optionnelle */ }
    const caObj = monthlyCA(vF);
    const caOdoo = (() => { const m = Array(12).fill(0); for (const r of odoo) for (let i = 0; i < 12; i++) m[i] += r.months?.[i] || 0; return m; })();
    const caManual = monthlyEur(vR);
    const caRea = caOdoo.map((v, i) => v + (caManual[i] || 0));            // réalisé = Odoo + ajustements (comme le dashboard)
    const caTotO = caObj.reduce((a, b) => a + b, 0); const caTotR = caRea.reduce((a, b) => a + b, 0);
    const caProg = caTotO ? Math.round((caTotR / caTotO) * 100) : 0;
    const qmsDue = qms.filter((x: any) => x.dueDate).sort((a: any, b: any) => (a.dueDate || '').localeCompare(b.dueDate || ''));
    return {
      caObj, caRea, caTotO, caTotR, caProg, curYear: y,
      ncOpen: qms.filter((x: any) => x.kind === 'NC').length,
      capaOpen: qms.filter((x: any) => x.kind === 'CAPA').length,
      ccOpen: qms.filter((x: any) => x.kind === 'CC').length,
      qmsDue, qmsOverdue: qmsDue.filter((x: any) => x.dueDate < tt),
    };
  };
  useEffect(() => {
    if (!socket) return;
    const h = () => load();
    socket.on('ops:changed', h);
    return () => { socket.off('ops:changed', h); };
  }, [socket, load]);

  const api = async (method: string, path: string, body?: any) => {
    await fetch(`${API_URL}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    load();
  };

  const commentOf = (type: string, id: string) =>
    board.weeklyComments.find(c => c.entityType === type && c.entityId === id && c.isoWeek === week)?.text || '';
  const commentStatutOf = (type: string, id: string) =>
    board.weeklyComments.find(c => c.entityType === type && c.entityId === id && c.isoWeek === week)?.statut || 'ouvert';

  // F2 — Note de synthèse de la semaine (corps éditable + garde-fou de concurrence par version).
  const curNote = (board.synthesisNotes || []).find((x: any) => x.isoWeek === week) || { corps: '', version: 0, updatedBy: null, updatedAt: null };
  const saveNote = async () => {
    const corps = noteRef.current?.value ?? '';
    const r = await fetch(`${API_URL}/api/ops/synthesis`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ isoWeek: week, corps, version: curNote.version }),
    });
    if (r.status === 409) { alert("La note a été modifiée entre-temps par quelqu'un d'autre. Je recharge la dernière version — reporte tes ajouts si besoin."); load(); return; }
    if (!r.ok) { alert("Enregistrement de la note impossible."); return; }
    load();
  };
  const integrateComment = (type: string, id: string) => api('POST', '/api/ops/comments/integrate', { entityType: type, entityId: id, isoWeek: week });

  // F4 — Bilan IA : génération (anti double-clic), édition, puis enregistrement.
  const [bilan, setBilan] = useState<any | null>(null);
  const [bilanOpen, setBilanOpen] = useState(false);
  const [bilanBusy, setBilanBusy] = useState(false);
  const generateBilan = async () => {
    if (bilanBusy) return;
    setBilanBusy(true);
    try {
      const r = await fetch(`${API_URL}/api/ops/ia-bilan/generate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ isoWeek: week }),
      });
      if (r.status === 503) { alert("Le bilan IA n'est pas encore activé : la clé DeepSeek doit être configurée côté serveur."); return; }
      if (!r.ok) { alert("Le bilan IA n'a pas pu être généré. Réessaie dans un instant."); return; }
      setBilan(await r.json());
      setBilanOpen(true);
    } catch { alert("Le bilan IA n'a pas pu être généré (réseau)."); }
    finally { setBilanBusy(false); }
  };
  // Historique des bilans enregistrés (horodaté) : liste + réouverture d'une version passée.
  const [bilanHistory, setBilanHistory] = useState<any[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const loadBilanHistory = useCallback(async () => {
    if (!token) return;
    try { const r = await fetch(`${API_URL}/api/ops/ia-bilan/history`, { headers: { Authorization: `Bearer ${token}` } }); if (r.ok) { const d = await r.json(); setBilanHistory(d.history || []); } } catch { /* ignore */ }
  }, [token]);
  useEffect(() => { loadBilanHistory(); }, [loadBilanHistory]);
  const openBilanFromHistory = async (id: number) => {
    try {
      const r = await fetch(`${API_URL}/api/ops/ia-bilan/history/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) { alert("Impossible d'ouvrir ce bilan."); return; }
      const d = await r.json();
      setBilan(d.contenu); setBilanOpen(true);
    } catch { alert("Impossible d'ouvrir ce bilan (réseau)."); }
  };

  const saveBilan = async () => {
    const r = await fetch(`${API_URL}/api/ops/ia-bilan`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ isoWeek: week, contenu: bilan }),
    });
    if (!r.ok) { alert("Enregistrement du bilan impossible."); return; }
    setBilanOpen(false);
    loadBilanHistory();
  };

  // Glissement (report d'échéance vers le futur) propre à une entité — alimente le badge de ligne.
  const slipInfo = (type: string, id: string, current: string | null) => {
    const fwd = (board.deadlineHistory || [])
      .filter(h => h.entityType === type && h.entityId === id && h.oldDeadline && h.newDeadline && h.newDeadline > h.oldDeadline && h.isSlip !== false)
      .sort((a, b) => (a.changedAt || '').localeCompare(b.changedAt || ''));
    if (!fwd.length) return null;
    const original = fwd[0].oldDeadline;
    const ref = current || fwd[fwd.length - 1].newDeadline;
    const days = Math.round((new Date(ref).getTime() - new Date(original).getTime()) / 86400000);
    if (days <= 0) return null;
    return { count: fwd.length, days, original };
  };

  // ---- KPI ----
  const milestones = board.milestones.filter(m => !m.archived);
  const deliverables = board.deliverables;
  const allItems = [...milestones.map(m => ({ ...m, _t: 'milestone' })), ...deliverables.map(d => ({ ...d, _t: 'deliverable' }))];
  const mDone = milestones.filter(m => m.status === 'complete').length;
  const dDone = deliverables.filter(d => d.status === 'complete').length;
  const t = todayStr();
  const late = allItems.filter(x => x.status !== 'complete' && x.deadline && x.deadline < t).length;
  const slippage = (board.deadlineHistory || []).filter(h => h.oldDeadline && h.newDeadline && h.newDeadline > h.oldDeadline && h.isSlip !== false).length;
  const pct = (done: number, total: number) => (total ? Math.round((done / total) * 100) : 0);

  // Tendance : enregistre la photo de la semaine courante et récupère celle de la semaine précédente.
  useEffect(() => {
    if (!token) return;
    if (!board.milestones.length && !board.projects.length) return;
    const snap = { isoWeek: week, milestonesDone: mDone, milestonesTotal: milestones.length, deliverablesDone: dDone, deliverablesTotal: deliverables.length, retards: late, glissements: slippage };
    (async () => {
      try {
        if (canEdit) await fetch(`${API_URL}/api/ops/kpi-snapshot`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(snap) });
        const r = await fetch(`${API_URL}/api/ops/kpi-prev?week=${week}`, { headers: { Authorization: `Bearer ${token}` } });
        if (r.ok) setTrend(await r.json());
      } catch { /* tendance optionnelle */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, token]);

  // Flèche de tendance pour un chiffre clé. goodUp=true : monter est positif (vert), sinon monter est négatif (rouge).
  const trendArrow = (curVal: number, prevVal: number | undefined, goodUp: boolean) => {
    if (prevVal === undefined || prevVal === null) return null;
    const delta = curVal - prevVal;
    if (delta === 0) return { txt: '→ =', cls: 'text-slate-400' };
    const up = delta > 0;
    const good = up === goodUp;
    return { txt: `${up ? '↑' : '↓'} ${delta > 0 ? '+' : ''}${delta}`, cls: good ? 'text-green-600' : 'text-red-600' };
  };

  // Statuts lisibles + marqueur retard, partagés par les deux débriefs.
  const STATUS_LABEL: Record<string, string> = { complete: '✅ Terminé', in_progress: '🔵 En cours', not_started: '⚪ Pas commencé', delay: '🔴 En retard' };
  const isLate = (x: any) => x.status !== 'complete' && x.deadline && x.deadline < t;
  const retardsCount = () => allItems.filter(isLate).length;
  const slipsOf = () => (board.deadlineHistory || []).filter(h => h.oldDeadline && h.newDeadline && h.newDeadline > h.oldDeadline && h.isSlip !== false);
  const chronicOf = (slips: any[]) => { const m: Record<string, number> = {}; slips.forEach(h => { m[h.entityId] = (m[h.entityId] || 0) + 1; }); return Object.values(m).filter(n => n >= 2).length; };

  // Décrit un glissement par l'entité concernée : Projet › Milestone › Deliverable.
  const projName = (id: string) => board.projects.find((p: any) => p.id === id)?.name || '';
  const slipDesc = (h: any) => {
    if (h.entityType === 'milestone') {
      const m = board.milestones.find((x: any) => x.id === h.entityId);
      return m ? `${projName(m.projectId)} › ${m.title}` : 'Milestone';
    }
    const d = board.deliverables.find((x: any) => x.id === h.entityId);
    if (!d) return 'Deliverable';
    const m = board.milestones.find((x: any) => x.id === d.milestoneId);
    return `${m ? `${projName(m.projectId)} › ${m.title} › ` : ''}${d.title}`;
  };

  const qmsCaHtml = (c: any) => {
    const { caObj, caRea, caTotO, caTotR, caProg, ncOpen, capaOpen, ccOpen, qmsDue, qmsOverdue, curYear } = c;
    const due = qmsDue.slice(0, 12).map((x) => `<li>${x.extId} — ${x.kind} — ${x.dueDate}${x.dueDate < t ? ' <span style="color:#dc2626">⚠ en retard</span>' : ''}</li>`).join('') || '<li style="color:#aaa">Aucune échéance datée</li>';
    // Histogramme Prévu (bleu) vs Réalisé (vert) par mois — identique au graphe du dashboard Forecast Ventes.
    const M = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];
    const max = Math.max(1, ...caObj, ...caRea), h = 150, bw = 46;
    const bars = M.map((m, i) => { const x = i * bw + 34; const fh = caObj[i] / max * h, rh = caRea[i] / max * h; return `<rect x="${x}" y="${(20 + h - fh).toFixed(1)}" width="17" height="${fh.toFixed(1)}" fill="#2563eb"><title>Prévu ${m} : ${eur(caObj[i])}</title></rect><rect x="${x + 19}" y="${(20 + h - rh).toFixed(1)}" width="17" height="${rh.toFixed(1)}" fill="#16a34a"><title>Réalisé ${m} : ${eur(caRea[i])}</title></rect><text x="${x + 18}" y="${20 + h + 12}" font-size="9" text-anchor="middle" fill="#64748b">${m}</text>`; }).join('');
    const svg = `<svg width="${M.length * bw + 50}" height="${h + 40}" style="max-width:100%"><text x="34" y="12" font-size="10" fill="#2563eb">■ Prévu</text><text x="90" y="12" font-size="10" fill="#16a34a">■ Réalisé</text>${bars}</svg>`;
    return `<h2>🏭 Synthèse Qualité (QMS)</h2>
<div class="kpi"><div>NC ouvertes : <b>${ncOpen}</b></div><div>CAPA ouvertes : <b>${capaOpen}</b></div><div>CC ouverts : <b>${ccOpen}</b></div><div>Échéances en retard : <b style="color:${qmsOverdue.length ? '#dc2626' : '#1e293b'}">${qmsOverdue.length}</b></div></div>
<h3>Prochaines échéances</h3><ul>${due}</ul>
<h2>📈 Évolution du chiffre d'affaires ${curYear}</h2>
<div class="kpi"><div>Objectif : <b>${eur(caTotO)}</b></div><div>Réalisé : <b>${eur(caTotR)}</b></div><div>Progression : <b style="color:${caProg >= 100 ? '#16a34a' : caProg >= 60 ? '#ca8a04' : '#dc2626'}">${caProg}% de l'objectif</b></div><div>Reste à faire : <b>${eur(Math.max(0, caTotO - caTotR))}</b></div></div>
${svg}
<div style="font-size:11px;color:#64748b;margin-top:6px"><span style="display:inline-block;width:10px;height:10px;background:#2563eb;vertical-align:middle;margin-right:4px"></span>Prévu&nbsp;&nbsp;<span style="display:inline-block;width:10px;height:10px;background:#16a34a;vertical-align:middle;margin-right:4px"></span>Réalisé</div>`;
  };

  const qmsCaText = (c: any) => {
    const { caObj, caRea, caTotO, caTotR, caProg, ncOpen, capaOpen, ccOpen, qmsDue, qmsOverdue, curYear } = c;
    const max = Math.max(1, ...caRea, ...caObj);
    const blocks = '▁▂▃▄▅▆▇█';
    const spark = caRea.map((r) => blocks[Math.min(7, Math.floor(r / max * 7))]).join('');
    const due = qmsDue.slice(0, 8).map((x) => `• ${x.extId} (${x.kind}) — ${x.dueDate}${x.dueDate < t ? ' ⚠ en retard' : ''}`).join('\n') || '• Aucune échéance datée';
    return `
🏭 Synthèse Qualité (QMS)
• NC ouvertes : ${ncOpen}  ·  CAPA ouvertes : ${capaOpen}  ·  CC ouverts : ${ccOpen}
• Échéances en retard : ${qmsOverdue.length}
Prochaines échéances :
${due}

📈 Évolution du chiffre d'affaires ${curYear}
• Objectif : ${eur(caTotO)}  ·  Réalisé : ${eur(caTotR)}  ·  Progression : ${caProg}% de l'objectif
• Réalisé mensuel : ${spark}`;
  };

  const daysLate = (x: any) => Math.round((new Date(t).getTime() - new Date(x.deadline).getTime()) / 86400000);

  // Regroupement des points à arbitrer PAR PROJET (retards + dérives chroniques), pour un rendu structuré et non mélangé.
  const projectOf = (x: any) => x._t === 'milestone' ? x.projectId : board.milestones.find((m: any) => m.id === x.milestoneId)?.projectId;
  const pathInProject = (x: any) => {
    if (x._t === 'milestone') return x.title;
    const m = board.milestones.find((mm: any) => mm.id === x.milestoneId);
    return `${m ? `${m.title} › ` : ''}${x.title}`;
  };
  const entityProject = (h: any) => {
    if (h.entityType === 'milestone') return board.milestones.find((m: any) => m.id === h.entityId)?.projectId;
    const d = board.deliverables.find((dd: any) => dd.id === h.entityId);
    return d ? board.milestones.find((m: any) => m.id === d.milestoneId)?.projectId : undefined;
  };
  const entityPathInProject = (h: any) => {
    if (h.entityType === 'milestone') return board.milestones.find((m: any) => m.id === h.entityId)?.title || 'Jalon';
    const d = board.deliverables.find((dd: any) => dd.id === h.entityId);
    if (!d) return 'Livrable';
    const m = board.milestones.find((mm: any) => mm.id === d.milestoneId);
    return `${m ? `${m.title} › ` : ''}${d.title}`;
  };
  const arbitragesByProject = () => {
    const slips = slipsOf();
    const chronicMap: Record<string, number> = {};
    slips.forEach(h => { chronicMap[h.entityId] = (chronicMap[h.entityId] || 0) + 1; });
    return board.projects.filter((p: any) => !p.archived).map((p: any) => {
      const late = allItems.filter(isLate).filter(x => projectOf(x) === p.id)
        .map(x => ({ path: pathInProject(x), days: daysLate(x), deadline: x.deadline })).sort((a, b) => b.days - a.days);
      const chronic = Object.entries(chronicMap).filter(([, n]) => n >= 2)
        .filter(([id]) => { const h = slips.find(s => s.entityId === id); return h && entityProject(h) === p.id; })
        .map(([id, n]) => ({ path: entityPathInProject(slips.find(s => s.entityId === id)), n }));
      return { id: p.id, name: p.name, late, chronic };
    }).filter(g => g.late.length || g.chronic.length);
  };

  // Verdict global du reporting (le « on est dans les clous ? » en 3 secondes).
  const globalVerdict = (retards: number, chronic: number, nbSlips: number) => {
    if (chronic > 0 || retards >= 3) return { emoji: '🔴', label: 'Sous tension', color: '#dc2626', bg: '#fef2f2', phrase: 'Plusieurs chantiers appellent votre attention et un arbitrage cette semaine afin de sécuriser la trajectoire.' };
    if (retards > 0 || nbSlips > 0) return { emoji: '🟠', label: 'Vigilance', color: '#ca8a04', bg: '#fffbeb', phrase: "La dynamique d'ensemble demeure maîtrisée ; quelques échéances méritent néanmoins une vigilance particulière." };
    return { emoji: '🟢', label: 'Sur les rails', color: '#16a34a', bg: '#f0fdf4', phrase: "L'ensemble des jalons est tenu : la trajectoire est pleinement sous contrôle." };
  };
  const htmlTrend = (cur: number, prev: number | undefined, goodUp: boolean) => {
    if (prev === undefined || prev === null) return '';
    const d = cur - prev;
    if (d === 0) return ' <span style="color:#94a3b8;font-size:11px">→ =</span>';
    const good = (d > 0) === goodUp;
    return ` <span style="color:${good ? '#16a34a' : '#dc2626'};font-size:11px">${d > 0 ? '↑ +' : '↓ '}${d} vs S-1</span>`;
  };

  const generateDebrief = async () => {
    const w = window.open('', '_blank');
    if (w) { w.document.write('<!doctype html><meta charset=utf-8><p style="font-family:system-ui;margin:40px;color:#64748b">Génération du debrief…</p>'); }
    const ctx = await buildCaQmsCtx();
    const slips = slipsOf();
    const chronic = chronicOf(slips);
    const retards = retardsCount();
    const v = globalVerdict(retards, chronic, slips.length);

    // 1. Points à arbitrer : regroupés PAR PROJET, avec une phrase de synthèse et une rédaction soutenue.
    const groups = arbitragesByProject();
    const arbitrages = groups.length
      ? groups.map(g => {
        const n = g.late.length, c = g.chronic.length;
        const synth = `Le projet <b>${g.name}</b> compte ${n ? `${n} action${n > 1 ? 's' : ''} en retard` : 'aucun retard'}${c ? `${n ? ' et ' : ' mais présente '}${c} dérive${c > 1 ? 's' : ''} structurelle${c > 1 ? 's' : ''}` : ''}. ${n ? "Un arbitrage est attendu pour rétablir l'échéancier." : 'Une attention est requise sur les reports répétés.'}`;
        const lateLis = g.late.map(x => `<li>L'action « <b>${x.path}</b> », attendue pour le ${formatDate(x.deadline)}, accuse un retard de <span style="color:#dc2626">${x.days} jour${x.days > 1 ? 's' : ''}</span> et appelle une décision.</li>`).join('');
        const chronicLis = g.chronic.map(x => `<li>Le jalon « <b>${x.path}</b> » a été reporté à <span style="color:#b45309">${x.n} reprises</span> ; cette dérive répétée mérite un arbitrage de fond.</li>`).join('');
        return `<div style="margin:12px 0 6px"><div style="font-weight:600;color:#1e293b;font-size:13px;border-left:3px solid #94a3b8;padding-left:8px;margin-bottom:4px">${g.name}</div><p style="font-size:13px;color:#475569;margin:4px 0">${synth}</p><ul>${lateLis}${chronicLis}</ul></div>`;
      }).join('')
      : '<p style="font-size:13px;color:#16a34a;margin:6px 0">Aucun point ne requiert d\'arbitrage cette semaine : les échéances sont tenues sur l\'ensemble des projets. 👍</p>';

    // 2. Faits marquants : progression vs semaine précédente (tendance).
    let faits: string;
    if (!trend) faits = '<li style="color:#888">Première semaine de suivi — la tendance apparaîtra au prochain point.</li>';
    else {
      const dM = mDone - (trend.milestonesDone || 0);
      const dD = dDone - (trend.deliverablesDone || 0);
      faits = (dM > 0 || dD > 0)
        ? `<li><b>${dM > 0 ? `${dM} jalon${dM > 1 ? 's' : ''}` : ''}${dM > 0 && dD > 0 ? ' et ' : ''}${dD > 0 ? `${dD} livrable${dD > 1 ? 's' : ''}` : ''}</b> bouclé${(dM + dD) > 1 ? 's' : ''} depuis la semaine dernière. 🎉</li>`
        : '<li style="color:#888">Aucun jalon bouclé cette semaine — priorité à débloquer les points ci-dessus.</li>';
    }

    // 3. État par projet condensé : barre d'avancement + prochain jalon.
    const projRows = board.projects.filter((p: any) => !p.archived).map((p: any) => {
      const pms = milestones.filter(m => m.projectId === p.id);
      const pdel = deliverables.filter(d => pms.some(m => m.id === d.milestoneId));
      const items = [...pms, ...pdel];
      const done = items.filter(x => x.status === 'complete').length;
      const prog = pct(done, items.length);
      const remaining = pms.filter(m => m.status !== 'complete').length;
      const next = pms.filter(m => m.status !== 'complete' && m.deadline).sort((a, b) => (a.deadline || '').localeCompare(b.deadline || ''))[0];
      const nextTxt = next ? `prochain jalon : <b>${next.title}</b> <span style="color:#888">(${next.deadline})${next.deadline < t ? ' <span style="color:#dc2626">⚠</span>' : ''}</span>` : (remaining ? 'prochain jalon : <span style="color:#888">échéance non datée</span>' : '<span style="color:#16a34a">tous les jalons terminés ✅</span>');
      const barColor = prog === 100 ? '#16a34a' : '#2563eb';
      return `<div style="margin:10px 0"><div style="display:flex;justify-content:space-between;font-size:13px"><b>${p.name}</b><span style="color:#64748b">${done}/${items.length} · ${prog}%</span></div>
<div style="background:#e2e8f0;border-radius:6px;height:7px;margin:4px 0"><div style="width:${prog}%;height:7px;border-radius:6px;background:${barColor}"></div></div>
<div style="font-size:12px;color:#475569">${nextTxt}</div></div>`;
    }).join('') || '<p style="color:#aaa">Aucun projet.</p>';

    const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Debrief ${week}</title>
<style>body{font-family:system-ui,Arial;max-width:760px;margin:32px auto;color:#1e293b}h1{font-size:20px;margin-bottom:2px}h2{font-size:15px;border-bottom:2px solid #e2e8f0;padding-bottom:4px;margin-top:22px}ul{margin:6px 0 0 0;padding-left:20px}li{margin:4px 0;font-size:13px}.kpi{display:flex;gap:12px;margin:12px 0;flex-wrap:wrap}.kpi div{background:#f1f5f9;border-radius:8px;padding:10px 14px;font-size:13px}@media print{.np{display:none}}</style></head>
<body><button class=np onclick="print()" style="float:right;padding:6px 12px;cursor:pointer;border:1px solid #cbd5e1;border-radius:6px;background:#fff">📄 Enregistrer en PDF</button>
<h1>Debrief Ops — semaine ${week}</h1>
<div style="color:#64748b;font-size:12px;margin-bottom:10px">${weekLabel}</div>
<div style="background:${v.bg};border:1px solid ${v.color}33;border-left:4px solid ${v.color};border-radius:8px;padding:12px 16px;margin:12px 0"><span style="font-size:15px;font-weight:700;color:${v.color}">${v.emoji} ${v.label}</span><div style="font-size:13px;color:#475569;margin-top:2px">${v.phrase}</div></div>
<div class="kpi"><div>Milestones : <b>${mDone}/${milestones.length}</b> (${pct(mDone, milestones.length)}%)${htmlTrend(mDone, trend?.milestonesDone, true)}</div><div>Deliverables : <b>${dDone}/${deliverables.length}</b> (${pct(dDone, deliverables.length)}%)${htmlTrend(dDone, trend?.deliverablesDone, true)}</div><div>Retards : <b style="color:${retards ? '#dc2626' : '#1e293b'}">${retards}</b>${htmlTrend(retards, trend?.retards, false)}</div><div>Glissements : <b>${slippage}</b>${chronic ? ` · dérive chronique : ${chronic}` : ''}${htmlTrend(slippage, trend?.glissements, false)}</div></div>
<h2>⚠️ Points à arbitrer</h2>${arbitrages}
<h2>✅ Faits marquants de la semaine</h2><ul>${faits}</ul>
<h2>📊 État par projet</h2>${projRows}
${qmsCaHtml(ctx)}
<script>window.onload=function(){setTimeout(function(){window.print();},500);};</script>
</body></html>`;
    if (w) { w.document.open(); w.document.write(html); w.document.close(); }
  };

  // Ouvre Outlook (client mail par défaut) avec le débrief pré-rempli — emojis + ton leadership pragmatique.
  const emailDebrief = async () => {
    const w = window.open('', '_blank');
    const ctx = await buildCaQmsCtx();
    const slips = slipsOf();
    const chronic = chronicOf(slips);
    const retards = retardsCount();
    const v = globalVerdict(retards, chronic, slips.length);
    // Points à arbitrer (texte) : regroupés PAR PROJET, avec une phrase de synthèse et une rédaction soutenue.
    const groups = arbitragesByProject();
    const arbitrages = groups.length
      ? groups.map(g => {
        const n = g.late.length, c = g.chronic.length;
        const synth = `▸ ${g.name} — ${n ? `${n} action${n > 1 ? 's' : ''} en retard` : 'aucun retard'}${c ? `${n ? ', ' : ', '}${c} dérive${c > 1 ? 's' : ''} structurelle${c > 1 ? 's' : ''}` : ''}.`;
        const lines = [
          ...g.late.map(x => `   • L'action « ${x.path} », attendue pour le ${formatDate(x.deadline)}, accuse un retard de ${x.days} jour${x.days > 1 ? 's' : ''} et appelle une décision.`),
          ...g.chronic.map(x => `   • Le jalon « ${x.path} » a été reporté à ${x.n} reprises ; cette dérive répétée mérite un arbitrage de fond.`),
        ].join('\n');
        return `${synth}\n${lines}`;
      }).join('\n\n')
      : "Aucun point ne requiert d'arbitrage cette semaine : les échéances sont tenues sur l'ensemble des projets. 👍";
    // Faits marquants (tendance N vs N-1).
    let faits: string;
    if (!trend) faits = '• Première semaine de suivi — tendance disponible au prochain point.';
    else { const dM = mDone - (trend.milestonesDone || 0); const dD = dDone - (trend.deliverablesDone || 0);
      faits = (dM > 0 || dD > 0) ? `• ${dM > 0 ? `${dM} jalon(s)` : ''}${dM > 0 && dD > 0 ? ' et ' : ''}${dD > 0 ? `${dD} livrable(s)` : ''} bouclé(s) depuis la semaine dernière. 🎉` : '• Aucun jalon bouclé cette semaine — priorité aux points à arbitrer ci-dessus.'; }
    const dd = (x: any) => x.deadline ? ` (${x.deadline})` : '';
    const mark = (x: any) => isLate(x) ? ' ⚠ en retard' : '';
    const etat = board.projects.filter((p: any) => !p.archived).map((p: any) => {
      const pms = milestones.filter(m => m.projectId === p.id && m.status !== 'complete');
      if (!pms.length) return '';
      const ms = pms.map(m => {
        const md = deliverables.filter(d => d.milestoneId === m.id && d.status !== 'complete');
        const dels = md.length ? md.map(d => `      • ${d.title} — ${STATUS_LABEL[d.status] || d.status}${dd(d)}${mark(d)}`).join('\n') : '      • (aucune action en cours)';
        return `  ▸ ${m.title} — ${STATUS_LABEL[m.status] || m.status}${dd(m)}${mark(m)}\n${dels}`;
      }).join('\n');
      return `${p.name}\n${ms}`;
    }).filter(Boolean).join('\n\n') || 'Rien à signaler — tout est à jour. 🎉';

    const body =
`Salut 👋

Voici le point Ops de la semaine ${week} — clair et sans détour.

${v.emoji} ${v.label.toUpperCase()} — ${v.phrase}

📊 Vue d'ensemble
• Milestones : ${mDone}/${milestones.length} (${pct(mDone, milestones.length)}%)
• Deliverables : ${dDone}/${deliverables.length} (${pct(dDone, deliverables.length)}%)
• Retards : ${retards}  ·  Glissements : ${slippage}${chronic ? ` (dont ${chronic} en dérive chronique ⚠️)` : ''}

⚠️ Points à arbitrer
${arbitrages}

✅ Faits marquants de la semaine
${faits}

📋 État par projet
${etat}

↪️ Glissements à surveiller
${slips.length ? slips.map(h => `• ${slipDesc(h)} — ${h.oldDeadline} → ${h.newDeadline}`).join('\n') : '• Aucun 👍'}
${qmsCaText(ctx)}

On garde le cap. 🚀

Assistant Maya
Agent IA travaillant avec Abdel HADJAB`;

    const subject = `Debrief Ops — semaine ${week}`;
    const to = 'contact@louna-aesthetics.com;developpement@louna-aesthetics.com;f.hadjab@louna-aesthetics.com;a.porcello@louna-aesthetics.com';
    // Outlook Web (boîte pro O365) : ouvre la rédaction avec destinataires + débrief pré-remplis (fiable quel que soit le réglage du Mac).
    const url = `https://outlook.office.com/mail/deeplink/compose?to=${encodeURIComponent(to)}&cc=a.jebari@louna-aesthetics.com&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    if (w) w.location.href = url; else window.open(url, '_blank');
  };

  return (
    <div className="p-6 flex-1 overflow-auto bg-slate-50">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        <KpiCard title="MILESTONES" value={`${mDone}/${milestones.length}`} sub={`${pct(mDone, milestones.length)}% terminés`} trend={trendArrow(mDone, trend?.milestonesDone, true)} />
        <KpiCard title="DELIVERABLES" value={`${dDone}/${deliverables.length}`} sub={`${pct(dDone, deliverables.length)}% terminés`} trend={trendArrow(dDone, trend?.deliverablesDone, true)} />
        <KpiCard title="RETARDS" value={late} sub="échéance dépassée" color={late ? 'text-red-600' : undefined} trend={trendArrow(late, trend?.retards, false)} />
        <KpiCard title="GLISSEMENTS" value={slippage} sub="reports d'échéance" color={slippage ? 'text-orange-600' : undefined} trend={trendArrow(slippage, trend?.glissements, false)} />
      </div>

      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-slate-800">Board projets <span className="text-sm font-normal text-slate-400">· semaine {week}</span></h3>
        <div className="flex gap-2">
          <button onClick={generateDebrief} className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50">
            <FileText className="w-4 h-4" /> Générer le debrief (PDF)
          </button>
          <button onClick={emailDebrief} className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50">
            <Mail className="w-4 h-4" /> Envoyer le débrief par email
          </button>
          {canEdit && (
            <button onClick={generateBilan} disabled={bilanBusy} className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-violet-600 rounded-lg hover:bg-violet-700 disabled:opacity-60">
              <Sparkles className="w-4 h-4" /> {bilanBusy ? 'Génération…' : 'Générer le bilan'}
            </button>
          )}
          <button onClick={() => setHistoryOpen(o => !o)} className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50">
            <History className="w-4 h-4" /> Historique des bilans {bilanHistory.length > 0 && <span className="text-xs text-slate-400">· {bilanHistory.length}</span>}
          </button>
          {canEdit && (
            <button onClick={() => api('POST', '/api/ops/projects', { name: 'Nouveau projet' })} className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700">
              <Plus className="w-4 h-4" /> Projet
            </button>
          )}
        </div>
      </div>

      {historyOpen && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 mb-5">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-slate-800 flex items-center gap-2"><History className="w-4 h-4 text-slate-500" /> Historique des bilans générés</h4>
            <button onClick={() => setHistoryOpen(false)} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
          </div>
          {bilanHistory.length === 0 ? (
            <p className="text-sm text-slate-400 py-2">Aucun bilan enregistré pour l'instant. Génère un bilan puis clique « Enregistrer le bilan » — il apparaîtra ici, daté.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {bilanHistory.map((h: any) => (
                <div key={h.id} className="flex items-center justify-between gap-2 py-2">
                  <div className="text-sm text-slate-700">
                    <span className="font-medium">Semaine {h.isoWeek}</span>
                    <span className="text-slate-400 ml-2">{new Date(h.createdAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</span>
                    {h.createdBy && <span className="text-xs text-slate-400 ml-2">· {h.createdBy}</span>}
                  </div>
                  <button onClick={() => openBilanFromHistory(h.id)} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-violet-700 bg-violet-50 border border-violet-200 rounded-lg hover:bg-violet-100">
                    <Sparkles className="w-3.5 h-3.5" /> Ouvrir (envoyer / PDF)
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 mb-5">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-slate-800">Note de synthèse <span className="text-xs font-normal text-slate-400">· {weekLabel}</span></h3>
          {curNote.updatedBy && <span className="text-[11px] text-slate-400">Dernière modif : {curNote.updatedBy}{curNote.updatedAt ? ` · ${formatDate(String(curNote.updatedAt).slice(0, 10))}` : ''}</span>}
        </div>
        <textarea ref={noteRef} key={`note-${week}-${curNote.version}`} defaultValue={curNote.corps} disabled={!canEdit}
          placeholder="Corps du reporting de la semaine… (les commentaires « Intégrer » viennent s'ajouter ici)"
          className="w-full h-32 text-sm border border-slate-200 rounded-lg p-2 outline-none focus:border-blue-400 resize-y text-slate-700" />
        {canEdit && <div className="flex justify-end mt-2"><button onClick={saveNote} className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700">Enregistrer la note</button></div>}
      </div>

      <div className="space-y-5">
        {board.projects.filter((p: any) => afficherArchives || !p.archived).map(project => {
          const pms = milestones.filter(m => m.projectId === project.id);
          const pdel = deliverables.filter(d => pms.some(m => m.id === d.milestoneId));
          const items = [...pms, ...pdel];
          const done = items.filter(x => x.status === 'complete').length;
          const p = pct(done, items.length);
          return (
            <div key={project.id} className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100">
                <span className="w-3 h-3 rounded-full shrink-0" style={{ background: project.color || '#64748b' }} />
                <input
                  defaultValue={project.name}
                  disabled={!canEdit}
                  onBlur={e => e.target.value !== project.name && api('PATCH', `/api/ops/projects/${project.id}`, { name: e.target.value })}
                  className="font-semibold text-slate-800 bg-transparent outline-none focus:bg-slate-50 rounded px-1"
                />
                <div className="flex-1 max-w-xs flex items-center gap-2">
                  <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className={cn('h-full rounded-full', p === 100 ? 'bg-green-500' : 'bg-blue-500')} style={{ width: `${p}%` }} />
                  </div>
                  <span className="text-xs font-medium text-slate-500 whitespace-nowrap">{done}/{items.length}</span>
                </div>
                {canEdit && (
                  <div className="flex items-center gap-1">
                    {!project.archived && <>
                      <button onClick={() => api('POST', '/api/ops/milestones', { projectId: project.id, title: 'Nouveau milestone' })} className="text-xs px-2 py-1 text-blue-600 hover:bg-blue-50 rounded">+ Milestone</button>
                      <button onClick={() => setImportProjet(project)} title="Importer un planning Excel ou Word" className="text-xs px-2 py-1 text-slate-600 hover:bg-slate-100 rounded">Importer planning</button>
                      <button onClick={() => setArchiveProjet(project)} title="Archiver ce projet (terminé ou annulé)" className="text-xs px-2 py-1 text-slate-600 hover:bg-slate-100 rounded">Archiver</button>
                    </>}
                    {project.archived && (
                      <button onClick={() => { if (confirm(`Réactiver le projet « ${project.name} » ?`)) api('POST', `/api/ops/projects/${project.id}/reactiver`); }} className="text-xs px-2 py-1 text-blue-600 hover:bg-blue-50 rounded">Réactiver</button>
                    )}
                    <button onClick={() => { if (confirm(`Supprimer le projet « ${project.name} » et tout son contenu ?`)) api('DELETE', `/api/ops/projects/${project.id}`); }} className="p-1 text-slate-400 hover:text-red-600 rounded"><Trash2 className="w-4 h-4" /></button>
                  </div>
                )}
              </div>

              {project.archived && (
                <div className="px-4 py-2 bg-slate-100 border-b border-slate-200 text-xs text-slate-600">
                  <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border mr-2',
                    project.archiveStatut === 'ANNULE' ? 'bg-red-100 text-red-700 border-red-200' : 'bg-green-100 text-green-700 border-green-200')}>
                    {project.archiveStatut === 'ANNULE' ? 'Projet annulé' : 'Projet terminé'}
                  </span>
                  {project.archiveMotif}
                  <span className="text-slate-400"> — archivé{project.archivePar ? ` par ${project.archivePar}` : ''}{project.archiveAt ? ` le ${new Date(project.archiveAt).toLocaleDateString('fr-FR')}` : ''}</span>
                </div>
              )}

              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase text-slate-400 bg-slate-50/60">
                    <th className="text-left font-semibold px-4 py-2 w-[34%]">Milestone / Deliverable</th>
                    <th className="text-left font-semibold px-2 py-2 w-32">Statut</th>
                    <th className="text-left font-semibold px-2 py-2 w-32">Échéance</th>
                    <th className="text-left font-semibold px-2 py-2">Commentaire ({weekLabel})</th>
                    <th className="px-2 py-2 w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pms.map((m, mi) => {
                    const md = deliverables.filter(d => d.milestoneId === m.id);
                    const isCol = collapsed.has(m.id);
                    return (
                    <React.Fragment key={m.id}>
                      <Row
                        canEdit={canEdit} indent={0} bold derived={md.length > 0}
                        onMoveUp={() => api('POST', `/api/ops/milestones/${m.id}/move`, { direction: 'up' })}
                        onMoveDown={() => api('POST', `/api/ops/milestones/${m.id}/move`, { direction: 'down' })}
                        canMoveUp={mi > 0} canMoveDown={mi < pms.length - 1}
                        collapsed={isCol} onToggle={() => toggleCollapse(m.id)}
                        title={m.title} status={m.status} deadline={m.deadline}
                        slip={slipInfo('milestone', m.id, m.deadline)}
                        comment={commentOf('milestone', m.id)}
                        commentStatut={commentStatutOf('milestone', m.id)}
                        onIntegrate={canEdit ? () => integrateComment('milestone', m.id) : undefined}
                        onTitle={v => api('PATCH', `/api/ops/milestones/${m.id}`, { title: v })}
                        onStatus={v => api('PATCH', `/api/ops/milestones/${m.id}`, { status: v })}
                        onDeadline={(v, isSlip) => api('PATCH', `/api/ops/milestones/${m.id}`, { deadline: v, deadlineIsSlip: isSlip })}
                        onComment={v => api('PUT', '/api/ops/comments', { entityType: 'milestone', entityId: m.id, isoWeek: week, text: v })}
                        onHistory={() => setHistoryItem({ type: 'milestone', id: m.id, title: m.title })}
                        onDelete={() => confirm('Supprimer ce milestone et ses deliverables ?') && api('DELETE', `/api/ops/milestones/${m.id}`)}
                        extra={canEdit && <button onClick={() => api('POST', '/api/ops/deliverables', { milestoneId: m.id, title: 'Nouveau deliverable' })} className="text-[10px] px-1.5 py-0.5 text-blue-600 hover:bg-blue-50 rounded ml-1">+ livr.</button>}
                      />
                      {!isCol && md.map((d, di) => (
                        <React.Fragment key={d.id}><Row
                          canEdit={canEdit} indent={1}
                          title={d.title} status={d.status} deadline={d.deadline}
                          slip={slipInfo('deliverable', d.id, d.deadline)}
                          comment={commentOf('deliverable', d.id)}
                          commentStatut={commentStatutOf('deliverable', d.id)}
                          onIntegrate={canEdit ? () => integrateComment('deliverable', d.id) : undefined}
                          onTitle={v => api('PATCH', `/api/ops/deliverables/${d.id}`, { title: v })}
                          onStatus={v => api('PATCH', `/api/ops/deliverables/${d.id}`, { status: v })}
                          onDeadline={(v, isSlip) => api('PATCH', `/api/ops/deliverables/${d.id}`, { deadline: v, deadlineIsSlip: isSlip })}
                          onComment={v => api('PUT', '/api/ops/comments', { entityType: 'deliverable', entityId: d.id, isoWeek: week, text: v })}
                          onHistory={() => setHistoryItem({ type: 'deliverable', id: d.id, title: d.title })}
                          onDelete={() => api('DELETE', `/api/ops/deliverables/${d.id}`)}
                          onMoveUp={isAdmin ? () => api('POST', `/api/ops/deliverables/${d.id}/move`, { direction: 'up' }) : undefined}
                          onMoveDown={isAdmin ? () => api('POST', `/api/ops/deliverables/${d.id}/move`, { direction: 'down' }) : undefined}
                          canMoveUp={di > 0} canMoveDown={di < md.length - 1}
                          onSetPosition={isAdmin ? (n) => api('POST', `/api/ops/deliverables/${d.id}/move`, { position: n }) : undefined}
                          position={di + 1} posMax={md.length}
                        /></React.Fragment>
                      ))}
                    </React.Fragment>
                  ); })}
                  {pms.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-4 text-center text-xs text-slate-300">Aucun milestone. {canEdit && 'Clique « + Milestone ».'}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          );
        })}
        {board.projects.length === 0 && <div className="text-center text-slate-400 py-10">Aucun projet.</div>}
        {(() => {
          const nArchives = board.projects.filter((p: any) => p.archived).length;
          if (!nArchives) return null;
          return (
            <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer pt-1">
              <input type="checkbox" checked={afficherArchives} onChange={e => setAfficherArchives(e.target.checked)} className="h-4 w-4" />
              Afficher les projets archivés <span className="text-xs text-slate-400">({nArchives})</span>
            </label>
          );
        })()}
      </div>

      {archiveProjet && <ArchiveProjetModal projet={archiveProjet} token={token} onClose={() => setArchiveProjet(null)} onFini={load} />}
      {importProjet && <ImportPlanningModal projet={importProjet} token={token} onClose={() => setImportProjet(null)} onFini={load} />}

      {historyItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setHistoryItem(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
              <h4 className="font-semibold text-slate-800 text-sm">Historique des commentaires</h4>
              <button onClick={() => setHistoryItem(null)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="px-5 py-2 text-xs text-slate-500 border-b border-slate-100">{historyItem.title}</div>
            <div className="p-5 space-y-3">
              {board.weeklyComments
                .filter(c => c.entityType === historyItem.type && c.entityId === historyItem.id)
                .sort((a, b) => (b.isoWeek || '').localeCompare(a.isoWeek || ''))
                .map(c => (
                  <div key={c.isoWeek} className="text-sm">
                    <div className="text-[11px] font-semibold text-slate-400 uppercase">semaine du {formatDate(isoMonday(c.isoWeek))}</div>
                    <div className="text-slate-700 whitespace-pre-wrap">{c.text}</div>
                  </div>
                ))}
              {board.weeklyComments.filter(c => c.entityType === historyItem.type && c.entityId === historyItem.id).length === 0 &&
                <div className="text-sm text-slate-400">Aucun commentaire pour l'instant.</div>}
            </div>
          </div>
        </div>
      )}

      {bilanOpen && bilan && <BilanEditor bilan={bilan} setBilan={setBilan} week={week} onClose={() => setBilanOpen(false)} onSave={saveBilan} />}

    </div>
  );
}

// F4 — Édition du bilan IA avant enregistrement (bilan par projet + objectifs SMART).
function BilanEditor({ bilan, setBilan, week, onClose, onSave }: { bilan: any; setBilan: (b: any) => void; week: string; onClose: () => void; onSave: () => void }) {
  const upd = (fn: (b: any) => void) => { const c = JSON.parse(JSON.stringify(bilan)); fn(c); setBilan(c); };
  const lines = (arr: string[]) => (arr || []).join('\n');
  const toArr = (s: string) => s.split('\n').map(x => x.trim()).filter(Boolean);
  const [sending, setSending] = useState(false);

  // Bilan en texte simple (corps de l'e-mail) et en HTML (source du PDF).
  const buildText = () => {
    let t = `BILAN HEBDOMADAIRE — Semaine ${week}\n`;
    t += `\n=== BILAN PAR PROJET ===\n`;
    for (const b of bilan.bilan || []) {
      t += `\n▸ ${b.projet || 'Projet'}\n`;
      if (b.avancement) t += `Avancement : ${b.avancement}\n`;
      if ((b.faits_marquants || []).length) t += `Faits marquants :\n${(b.faits_marquants || []).map((x: string) => `  - ${x}`).join('\n')}\n`;
      if ((b.risques_retards || []).length) t += `Risques / retards :\n${(b.risques_retards || []).map((x: string) => `  - ${x}`).join('\n')}\n`;
    }
    t += `\n=== OBJECTIFS DE LA SEMAINE ===\n`;
    for (const g of bilan.objectifs_hebdo || []) {
      t += `\n▸ ${g.projet || 'Projet'}\n`;
      for (const o of g.objectifs || []) {
        t += `  [P${o.priorite || 1}] ${o.intitule || ''}${o.critere_succes ? ` — succès : ${o.critere_succes}` : ''}\n`;
        if ((o.actions_liees || []).length) t += `        liés : ${(o.actions_liees || []).join(', ')}\n`;
      }
    }
    return t;
  };
  const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const buildHtml = () => {
    const projBloc = (bilan.bilan || []).map((b: any) => `
      <div style="margin:0 0 14px;padding:10px 12px;border:1px solid #e2e8f0;border-radius:8px">
        <div style="font-weight:700;color:#1e293b;font-size:14px">${esc(b.projet)}</div>
        ${b.avancement ? `<div style="margin-top:4px"><b>Avancement :</b> ${esc(b.avancement)}</div>` : ''}
        ${(b.faits_marquants || []).length ? `<div style="margin-top:4px"><b>Faits marquants</b><ul style="margin:2px 0 0 18px">${(b.faits_marquants || []).map((x: string) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
        ${(b.risques_retards || []).length ? `<div style="margin-top:4px;color:#b91c1c"><b>Risques / retards</b><ul style="margin:2px 0 0 18px">${(b.risques_retards || []).map((x: string) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      </div>`).join('');
    const objBloc = (bilan.objectifs_hebdo || []).map((g: any) => `
      <div style="margin:0 0 14px;padding:10px 12px;border:1px solid #e2e8f0;border-radius:8px">
        <div style="font-weight:700;color:#1e293b;font-size:14px">${esc(g.projet)}</div>
        <ul style="margin:4px 0 0 18px">${(g.objectifs || []).map((o: any) => `<li><b>P${esc(o.priorite || 1)}</b> ${esc(o.intitule)}${o.critere_succes ? ` <i>(succès : ${esc(o.critere_succes)})</i>` : ''}${(o.actions_liees || []).length ? `<br><span style="color:#64748b;font-size:12px">liés : ${esc((o.actions_liees || []).join(', '))}</span>` : ''}</li>`).join('')}</ul>
      </div>`).join('');
    return `<div style="font-family:Arial,sans-serif;color:#334155;font-size:13px;padding:8px">
      <h2 style="color:#6d28d9;margin:0 0 4px">Bilan hebdomadaire</h2>
      <div style="color:#64748b;margin:0 0 14px">Semaine ${esc(week)}</div>
      <h3 style="color:#1e293b;border-bottom:2px solid #ede9fe;padding-bottom:3px">Bilan par projet</h3>${projBloc}
      <h3 style="color:#1e293b;border-bottom:2px solid #ede9fe;padding-bottom:3px">Objectifs de la semaine</h3>${objBloc}
    </div>`;
  };
  const downloadPdf = async () => {
    setSending(true);
    try {
      const html2pdf: any = (await import('html2pdf.js')).default;
      const opt: any = { margin: 8, filename: `Bilan-${week}.pdf`, image: { type: 'jpeg', quality: 0.8 }, html2canvas: { scale: 1.5 }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait', compress: true } };
      await html2pdf().set(opt).from(buildHtml(), 'string').save();
    } catch { alert('Génération du PDF impossible.'); }
    finally { setSending(false); }
  };
  const openEmail = () => {
    let body = buildText();
    if (body.length > 1800) body = body.slice(0, 1800) + '\n\n… (bilan complet dans le PDF joint)';
    window.location.href = `mailto:?subject=${encodeURIComponent(`Bilan hebdomadaire — Semaine ${week}`)}&body=${encodeURIComponent(body)}`;
  };
  const sendBilan = async () => { await downloadPdf(); openEmail(); };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[85vh] overflow-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 sticky top-0 bg-white z-10">
          <h4 className="font-semibold text-slate-800 text-sm flex items-center gap-2"><Sparkles className="w-4 h-4 text-violet-600" /> Bilan IA — modifiable avant enregistrement</h4>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-5">
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase mb-2">Bilan par projet</div>
            {(bilan.bilan || []).map((b: any, i: number) => (
              <div key={i} className="border border-slate-200 rounded-lg p-3 mb-3">
                <input value={b.projet || ''} onChange={e => upd(c => { c.bilan[i].projet = e.target.value; })} className="font-semibold text-slate-800 w-full mb-2 outline-none border-b border-transparent focus:border-slate-300" />
                <label className="text-[11px] text-slate-500">Avancement</label>
                <textarea value={b.avancement || ''} onChange={e => upd(c => { c.bilan[i].avancement = e.target.value; })} className="w-full text-sm border border-slate-200 rounded p-2 mb-2 h-16 resize-y" />
                <label className="text-[11px] text-slate-500">Faits marquants (un par ligne)</label>
                <textarea value={lines(b.faits_marquants)} onChange={e => upd(c => { c.bilan[i].faits_marquants = toArr(e.target.value); })} className="w-full text-sm border border-slate-200 rounded p-2 mb-2 h-16 resize-y" />
                <label className="text-[11px] text-slate-500">Risques / retards (un par ligne)</label>
                <textarea value={lines(b.risques_retards)} onChange={e => upd(c => { c.bilan[i].risques_retards = toArr(e.target.value); })} className="w-full text-sm border border-slate-200 rounded p-2 h-16 resize-y" />
              </div>
            ))}
          </div>
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase mb-2">Objectifs de la semaine</div>
            {(bilan.objectifs_hebdo || []).map((g: any, gi: number) => (
              <div key={gi} className="border border-slate-200 rounded-lg p-3 mb-3">
                <input value={g.projet || ''} onChange={e => upd(c => { c.objectifs_hebdo[gi].projet = e.target.value; })} className="font-semibold text-slate-800 w-full mb-2 outline-none border-b border-transparent focus:border-slate-300" />
                {(g.objectifs || []).map((o: any, oi: number) => (
                  <div key={oi} className="bg-slate-50 rounded p-2 mb-2">
                    <div className="flex gap-2 items-center mb-1">
                      <span className="text-[11px] text-slate-400">P</span>
                      <input type="number" min={1} value={o.priorite || 1} onChange={e => upd(c => { c.objectifs_hebdo[gi].objectifs[oi].priorite = Number(e.target.value); })} className="w-12 text-sm border border-slate-200 rounded px-1" />
                      <input value={o.intitule || ''} onChange={e => upd(c => { c.objectifs_hebdo[gi].objectifs[oi].intitule = e.target.value; })} placeholder="Objectif SMART" className="flex-1 text-sm border border-slate-200 rounded px-2 py-1" />
                    </div>
                    <input value={lines(o.actions_liees)} onChange={e => upd(c => { c.objectifs_hebdo[gi].objectifs[oi].actions_liees = toArr(e.target.value); })} placeholder="Actions/livrables liés (un par ligne)" className="w-full text-xs border border-slate-200 rounded px-2 py-1 mb-1" />
                    <input value={o.critere_succes || ''} onChange={e => upd(c => { c.objectifs_hebdo[gi].objectifs[oi].critere_succes = e.target.value; })} placeholder="Critère de succès mesurable" className="w-full text-xs border border-slate-200 rounded px-2 py-1" />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2 px-5 py-3 border-t border-slate-100 sticky bottom-0 bg-white">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50">Annuler</button>
          <button onClick={downloadPdf} disabled={sending} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-60"><FileText className="w-4 h-4" /> PDF</button>
          <button onClick={sendBilan} disabled={sending} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-white bg-violet-600 rounded-lg hover:bg-violet-700 disabled:opacity-60"><Mail className="w-4 h-4" /> Envoyer le bilan</button>
          <button onClick={onSave} className="px-3 py-1.5 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700">Enregistrer le bilan</button>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ title, value, sub, color, trend }: { title: string; value: string | number; sub: string; color?: string; trend?: { txt: string; cls: string } | null }) {
  return (
    <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
      <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">{title}</div>
      <div className="flex items-baseline gap-2">
        <div className={cn('text-2xl font-bold mb-0.5', color || 'text-slate-900')}>{value}</div>
        {trend && <span className={cn('text-xs font-semibold', trend.cls)} title="vs semaine précédente">{trend.txt}</span>}
      </div>
      <div className="text-xs text-slate-500">{sub}</div>
    </div>
  );
}

interface RowProps {
  canEdit: boolean; indent: number; bold?: boolean;
  title: string; status: string; deadline: string | null; comment: string;
  onTitle: (v: string) => void; onStatus: (v: string) => void; onDeadline: (v: string, isSlip?: boolean) => void;
  onComment: (v: string) => void; onHistory: () => void; onDelete: () => void;
  collapsed?: boolean; onToggle?: () => void; derived?: boolean;
  extra?: React.ReactNode;
  slip?: { count: number; days: number; original: string } | null;
  onMoveUp?: () => void; onMoveDown?: () => void; canMoveUp?: boolean; canMoveDown?: boolean;
  onSetPosition?: (n: number) => void; position?: number; posMax?: number;
  commentStatut?: string; onIntegrate?: () => void;
}
function Row(p: RowProps) {
  const showMove = p.canEdit && (p.onMoveUp || p.onMoveDown);
  return (
    <tr className="hover:bg-slate-50">
      <td className="px-4 py-1.5" style={{ paddingLeft: 16 + p.indent * 20 }}>
        <span className="inline-flex items-center w-full">
          {showMove && (
            <span className="inline-flex flex-col mr-1 shrink-0">
              <button onClick={p.onMoveUp} disabled={!p.canMoveUp} title="Monter" className="text-slate-300 hover:text-blue-600 disabled:opacity-30 disabled:hover:text-slate-300 leading-none"><ChevronUp className="w-3.5 h-3.5" /></button>
              <button onClick={p.onMoveDown} disabled={!p.canMoveDown} title="Descendre" className="text-slate-300 hover:text-blue-600 disabled:opacity-30 disabled:hover:text-slate-300 leading-none"><ChevronDown className="w-3.5 h-3.5" /></button>
            </span>
          )}
          {p.onSetPosition && (
            <input type="number" min={1} max={p.posMax} defaultValue={p.position} key={`pos-${p.position}`}
              title="Position du livrable dans le jalon (saisie directe)"
              onBlur={e => { const n = parseInt(e.target.value, 10); if (!Number.isNaN(n) && n !== p.position) p.onSetPosition!(n); }}
              className="w-8 mr-1 text-[11px] text-center text-slate-500 border border-slate-200 rounded px-0.5 py-0.5 outline-none focus:border-blue-400 shrink-0" />
          )}
          {p.indent === 1 && <span className="text-slate-300 mr-1">↳</span>}
          {p.onToggle && (
            <button onClick={p.onToggle} title={p.collapsed ? 'Déplier' : 'Replier'} className="mr-1 text-slate-400 hover:text-slate-700 shrink-0">
              {p.collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          )}
          <input
            defaultValue={p.title} disabled={!p.canEdit}
            onBlur={e => e.target.value !== p.title && p.onTitle(e.target.value)}
            className={cn('bg-transparent outline-none focus:bg-white rounded px-1 w-full', p.bold ? 'font-medium text-slate-800' : 'text-slate-600')}
          />
          {p.extra}
        </span>
      </td>
      <td className="px-2 py-1.5">
        <select value={p.status} disabled={!p.canEdit || p.derived} onChange={e => p.onStatus(e.target.value)}
          title={p.derived ? 'Statut calculé automatiquement depuis les deliverables' : undefined}
          className={cn('text-xs font-medium border rounded-full px-2 py-1 outline-none', statusColor(p.status), (p.derived || !p.canEdit) ? 'cursor-default opacity-90' : 'cursor-pointer')}>
          {OPS_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </td>
      <td className="px-2 py-1.5">
        <div className="flex items-center gap-1">
          <input type="date" key={p.derived ? p.deadline || '' : undefined} defaultValue={p.deadline || ''} disabled={!p.canEdit || p.derived}
            title={p.derived ? "Échéance calculée automatiquement : la plus tardive des livrables de ce jalon" : undefined}
            onChange={e => {
              const v = e.target.value;
              // Repoussée vers une date plus tardive → demander : glissement à comptabiliser, ou simple correction ?
              const later = !!(v && p.deadline && v > p.deadline);
              const isSlip = later ? window.confirm("Échéance repoussée.\n\nOK = glissement (à comptabiliser)\nAnnuler = simple correction (mauvaise estimation initiale, non comptée)") : undefined;
              p.onDeadline(v, isSlip);
            }}
            className={cn('text-xs border border-slate-200 rounded px-1.5 py-1 outline-none focus:border-blue-400', p.derived && 'cursor-default opacity-90 bg-slate-50')} />
          {p.slip && (
            <span title={`Reporté ${p.slip.count} fois · échéance initiale ${formatDate(p.slip.original)}`}
              className="inline-flex items-center text-[10px] font-semibold text-orange-700 bg-orange-100 border border-orange-200 rounded-full px-1.5 py-0.5 whitespace-nowrap shrink-0">
              ↪ +{p.slip.days}j{p.slip.count > 1 ? ` ×${p.slip.count}` : ''}
            </span>
          )}
        </div>
      </td>
      <td className="px-2 py-1.5">
        <div className="flex items-center gap-1">
          <input defaultValue={p.comment} disabled={!p.canEdit} placeholder="Commentaire de la semaine…"
            key={p.comment}
            onBlur={e => e.target.value !== p.comment && p.onComment(e.target.value)}
            className="text-xs flex-1 bg-transparent outline-none focus:bg-white rounded px-1 text-slate-600" />
          {p.commentStatut === 'intégré'
            ? <span title="Commentaire intégré à la note de synthèse" className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-green-600 shrink-0"><Check className="w-3 h-3" />intégré</span>
            : (p.onIntegrate && p.comment && <button onClick={p.onIntegrate} title="Intégrer ce commentaire à la note de synthèse" className="text-slate-300 hover:text-green-600 shrink-0"><Check className="w-3.5 h-3.5" /></button>)}
          <button onClick={p.onHistory} title="Historique des commentaires" className="text-slate-300 hover:text-blue-600 shrink-0"><History className="w-3.5 h-3.5" /></button>
        </div>
      </td>
      <td className="px-2 py-1.5 text-right">
        {p.canEdit && <button onClick={p.onDelete} className="p-1 text-slate-300 hover:text-red-600 rounded"><Trash2 className="w-3.5 h-3.5" /></button>}
      </td>
    </tr>
  );
}

// ---- Archiver un projet : terminé ou annulé, justificatif obligatoire ----
function ArchiveProjetModal({ projet, token, onClose, onFini }: { projet: any; token: string | null; onClose: () => void; onFini: () => void }) {
  const [statut, setStatut] = useState<'TERMINE' | 'ANNULE'>('TERMINE');
  const [motif, setMotif] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const valider = async () => {
    if (motif.trim().length < 3) return setErr('Le justificatif est obligatoire.');
    setBusy(true); setErr('');
    try {
      const r = await fetch(`${API_URL}/api/ops/projects/${projet.id}/archiver`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ statut, motif: motif.trim() }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return setErr(j.error || 'Archivage impossible.');
      onFini(); onClose();
    } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <h4 className="font-semibold text-slate-800">Archiver « {projet.name} »</h4>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <span className="text-xs font-medium text-slate-500 block mb-2">Pourquoi ce projet quitte-t-il le suivi actif ?</span>
            <div className="flex gap-2">
              {([['TERMINE', 'Projet terminé'], ['ANNULE', 'Projet annulé']] as const).map(([v, l]) => (
                <button key={v} onClick={() => setStatut(v)}
                  className={cn('flex-1 px-3 py-2 text-sm font-medium rounded-lg border',
                    statut === v ? (v === 'ANNULE' ? 'bg-red-50 text-red-700 border-red-300' : 'bg-green-50 text-green-700 border-green-300')
                      : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50')}>{l}</button>
              ))}
            </div>
          </div>
          <label className="block">
            <span className="text-xs font-medium text-slate-500">Justificatif <span className="text-red-500">*</span></span>
            <textarea value={motif} onChange={e => setMotif(e.target.value)} rows={3} autoFocus
              placeholder={statut === 'ANNULE' ? "ex. Abandonné : le fournisseur ne peut pas tenir les délais." : "ex. Tous les jalons sont livrés et validés le 12/08."}
              className="mt-1 w-full text-sm border border-slate-300 rounded-md px-2 py-1.5 outline-none focus:border-blue-500" />
            <span className="text-[11px] text-slate-400">Il restera visible sur le projet archivé — c'est la mémoire de la décision.</span>
          </label>
          {err && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}
          <p className="text-xs text-slate-500">Le projet sortira du suivi actif et du débrief hebdomadaire. Rien n'est supprimé : tu pourras le réactiver.</p>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-100">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg">Annuler</button>
          <button onClick={valider} disabled={busy || motif.trim().length < 3}
            className="px-4 py-2 text-sm font-medium text-white bg-slate-800 rounded-lg hover:bg-slate-900 disabled:opacity-40">
            {busy ? 'Archivage…' : 'Archiver le projet'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Importer un planning Excel ou Word : lecture, aperçu, puis création des jalons ----
function ImportPlanningModal({ projet, token, onClose, onFini }: { projet: any; token: string | null; onClose: () => void; onFini: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [apercu, setApercu] = useState<any | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const lire = async (f: File) => {
    setBusy(true); setErr(''); setApercu(null);
    try {
      const r = await fetch(`${API_URL}/api/ops/projects/${projet.id}/import-planning?filename=${encodeURIComponent(f.name)}`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: f,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setErr(j.error || 'Lecture impossible.'); else setApercu(j);
    } catch { setErr('Lecture impossible.'); } finally { setBusy(false); }
  };
  const setJalon = (i: number, patch: any) =>
    setApercu((a: any) => ({ ...a, jalons: a.jalons.map((j: any, k: number) => k === i ? { ...j, ...patch } : j) }));
  const retirer = (i: number) => setApercu((a: any) => ({ ...a, jalons: a.jalons.filter((_: any, k: number) => k !== i) }));

  const confirmer = async () => {
    setBusy(true);
    try {
      const r = await fetch(`${API_URL}/api/ops/projects/${projet.id}/import-planning/confirmer`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ jalons: apercu.jalons }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return setErr(j.error || 'Import impossible.');
      alert(`${j.crees} jalon(s) ajouté(s) au projet « ${projet.name} ».`);
      onFini(); onClose();
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[88vh] overflow-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <h4 className="font-semibold text-slate-800">Importer un planning · {projet.name}</h4>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          {!apercu && (
            <>
              <p className="text-sm text-slate-600">
                Choisis ton fichier de planning : <b>Excel (.xlsx)</b> ou <b>Word (.docx)</b>.
                Le fichier doit contenir un tableau avec au moins une colonne d'intitulés (jalon, étape, tâche…)
                et une colonne de dates (échéance, date de fin…). Une colonne « responsable » est reprise si elle existe.
              </p>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.docx" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) lire(f); e.target.value = ''; }} />
              <button onClick={() => fileRef.current?.click()} disabled={busy}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {busy ? 'Lecture…' : 'Choisir un fichier'}
              </button>
              <p className="text-xs text-slate-400">Rien n'est enregistré à cette étape : tu verras d'abord ce qui a été lu.</p>
            </>
          )}
          {err && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}

          {apercu && (
            <>
              <div className="text-sm text-slate-600">
                <b>{apercu.jalons.length} jalon(s)</b> lus{apercu.ignorees ? ` · ${apercu.ignorees} ligne(s) ignorée(s)` : ''}
                {apercu.sansDate ? <span className="text-amber-600"> · {apercu.sansDate} sans date</span> : ''}
                {apercu.entetes?.length ? <div className="text-xs text-slate-400 mt-0.5">Colonnes reconnues : {apercu.entetes.filter(Boolean).join(' · ')}</div> : null}
              </div>
              <div className="border border-slate-200 rounded-lg overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="bg-slate-50 text-left text-[11px] uppercase text-slate-500">
                    <th className="px-3 py-2 w-10">#</th><th className="px-3 py-2">Jalon</th>
                    <th className="px-3 py-2 w-36">Échéance</th><th className="px-3 py-2 w-40">Responsable</th><th className="px-3 py-2 w-8"></th>
                  </tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {apercu.jalons.map((j: any, i: number) => (
                      <tr key={i} className="hover:bg-slate-50">
                        <td className="px-3 py-1.5 text-slate-400">{i + 1}</td>
                        <td className="px-3 py-1.5">
                          <input value={j.titre} onChange={e => setJalon(i, { titre: e.target.value })}
                            className="w-full text-sm border border-transparent hover:border-slate-300 focus:border-blue-500 rounded px-1 py-0.5 outline-none" />
                        </td>
                        <td className="px-3 py-1.5">
                          <input type="date" value={j.echeance || ''} onChange={e => setJalon(i, { echeance: e.target.value })}
                            className={cn('w-full text-sm border rounded px-1 py-0.5 outline-none', j.echeance ? 'border-transparent hover:border-slate-300' : 'border-amber-300 bg-amber-50')} />
                        </td>
                        <td className="px-3 py-1.5">
                          <input value={j.responsable || ''} onChange={e => setJalon(i, { responsable: e.target.value })}
                            className="w-full text-sm border border-transparent hover:border-slate-300 focus:border-blue-500 rounded px-1 py-0.5 outline-none" />
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <button onClick={() => retirer(i)} title="Ne pas importer cette ligne" className="text-slate-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-slate-500">Corrige ce qui doit l'être avant de valider. Les jalons s'ajouteront à la suite de ceux déjà présents.</p>
            </>
          )}
        </div>
        {apercu && (
          <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-100">
            <button onClick={() => setApercu(null)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg">Choisir un autre fichier</button>
            <button onClick={confirmer} disabled={busy || !apercu.jalons.length}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-40">
              {busy ? 'Import…' : `Importer ${apercu.jalons.length} jalon(s)`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
