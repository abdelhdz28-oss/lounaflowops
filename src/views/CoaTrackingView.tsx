import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAuth } from '../AuthContext';
import { cn } from '../utils/cn';
import { formatDate } from '../constants';
import { Plus, Trash2, FileCheck, Upload, FileText, AlertTriangle, FileX, XCircle, Clock, X, Loader2, Pencil, Search, Copy, Printer } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, Cell } from 'recharts';

const API_URL = import.meta.env.VITE_API_URL || '';
const PEREMPTION_JOURS = 60;
// Fenêtre « à surveiller » du design CoA Tracking porté (écran Lots / Dashboard).
const PEREMPTION_SURVEILLANCE_JOURS = 90;
const SEUIL_LOSS_DEFAUT = 10;

interface Materiau { id: number; code: string; libelle: string; seuilLossDrying: number | null; lossDryingApplicable: boolean; }
interface Reference { id: number; materiauId: number; fournisseur: string; refInterne: string | null; refClient: string | null; }
interface Lot {
  id: number; materiauId: number | null; materiauCode: string | null; materiauLibelle: string | null;
  numeroLot: string; fournisseur: string; referenceInterne: string | null; referenceClient: string | null; numeroCommande: string | null;
  dateCommande: string | null; dateReception: string | null; datePeremption: string | null;
  quantiteG: number | null; quantiteUnite?: string; lossDrying: number | null; seuilLossDrying: number | null;
  aVerifierManuel: boolean; aVerifier: boolean; coaFichier: string | null; coaLien: string | null; hasCoaDoc: boolean; hasCoa: boolean; commentaire: string | null;
}
interface Board { materiaux: Materiau[]; references: Reference[]; lots: Lot[]; }

const daysUntil = (iso: string | null) => iso ? Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000) : null;
const isPeremptionProche = (l: Lot) => { const d = daysUntil(l.datePeremption); return d !== null && d <= PEREMPTION_JOURS; };

// ---------- Statuts & formats (design CoA Tracking porté) ----------
type StatutPeremption = 'VALIDE' | 'A_SURVEILLER' | 'EXPIRE' | 'INCONNU';
function statutPeremption(iso: string | null): StatutPeremption {
  const j = daysUntil(iso);
  if (j === null) return 'INCONNU';
  if (j < 0) return 'EXPIRE';
  if (j < PEREMPTION_SURVEILLANCE_JOURS) return 'A_SURVEILLER';
  return 'VALIDE';
}
type StatutLoss = 'OK' | 'ALERTE' | 'NA';
function statutLoss(loss: number | null, seuil: number | null, applicable: boolean): StatutLoss {
  if (!applicable || loss == null || seuil == null) return 'NA';
  return loss > seuil ? 'ALERTE' : 'OK';
}
// Explique pourquoi le pictogramme « à vérifier » s'affiche sur un lot (infobulle F5.2).
function motifAVerifier(l: Lot, lossApplicable: boolean): string {
  const motifs: string[] = [];
  if (l.aVerifierManuel) motifs.push('Marqué « à vérifier » manuellement');
  if (lossApplicable && l.lossDrying != null && l.seuilLossDrying != null && l.lossDrying > l.seuilLossDrying)
    motifs.push(`Loss drying ${fmtPct(l.lossDrying)} supérieur au seuil ${fmtPct(l.seuilLossDrying)}`);
  return motifs.length ? `À vérifier — ${motifs.join(' · ')}` : 'Donnée à vérifier';
}
const fmtKg = (g: number | null) => g == null ? '—' : (g / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' kg';
// Quantité saisie affichée avec son unité (g / kg / L).
const fmtQty = (q: number | null, u?: string) => q == null ? '—' : q.toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' ' + (u || 'g');
// Normalise vers des kg pour les agrégats (kg = kg, L ≈ kg, g / 1000).
const qToKg = (q: number | null, u?: string) => { const v = q ?? 0; return (u === 'kg' || u === 'L') ? v : v / 1000; };
const fmtPct = (p: number | null) => p == null ? '—' : p.toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' %';
const round2 = (n: number) => Math.round(n * 100) / 100;

// Palette des graphiques (cohérente avec le thème slate/blue du nouvel app).
const CHART = { primary: '#2563eb', info: '#0ea5e9', warning: '#f59e0b', error: '#dc2626', neutral: '#94a3b8', grid: '#e2e8f0', tick: '#64748b' };

// Badge couleur par matière.
const MAT_COLORS: Record<string, string> = {
  NAHA: 'bg-blue-100 text-blue-700 border-blue-200',
  PDRN: 'bg-violet-100 text-violet-700 border-violet-200',
  TXA: 'bg-amber-100 text-amber-700 border-amber-200',
  COLLAGENE: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  CAHA: 'bg-cyan-100 text-cyan-700 border-cyan-200',
  LIDO: 'bg-rose-100 text-rose-700 border-rose-200',
};
const matBadge = (code: string | null) => (code && MAT_COLORS[code]) || 'bg-slate-100 text-slate-700 border-slate-200';

// ---------- Agrégations Dashboard (calculées en direct depuis board) ----------
function kgParFournisseur(lots: Lot[]) {
  const m = new Map<string, number>();
  for (const l of lots) m.set(l.fournisseur, (m.get(l.fournisseur) ?? 0) + qToKg(l.quantiteG, l.quantiteUnite));
  return [...m.entries()].map(([fournisseur, kg]) => ({ fournisseur, kg: round2(kg) })).sort((a, b) => b.kg - a.kg);
}
function lossMoyenneParMatiere(lots: Lot[], matById: Record<number, Materiau>) {
  const agg = new Map<string, { somme: number; n: number; seuil: number | null }>();
  for (const l of lots) {
    const mat = l.materiauId != null ? matById[l.materiauId] : undefined;
    if (!mat || !mat.lossDryingApplicable || l.lossDrying == null) continue;
    const a = agg.get(mat.code) ?? { somme: 0, n: 0, seuil: mat.seuilLossDrying };
    a.somme += l.lossDrying; a.n++;
    agg.set(mat.code, a);
  }
  return [...agg.entries()].map(([matiere, a]) => ({ matiere, moyenne: round2(a.somme / a.n), seuil: a.seuil })).sort((a, b) => a.matiere.localeCompare(b.matiere));
}
function quantiteParAn(lots: Lot[]) {
  const m = new Map<string, { NAHA: number; PDRN: number; TXA: number; Autres: number }>();
  for (const l of lots) {
    const d = l.dateReception ?? l.dateCommande;
    if (!d) continue;
    const annee = String(new Date(d).getUTCFullYear());
    const g = m.get(annee) ?? { NAHA: 0, PDRN: 0, TXA: 0, Autres: 0 };
    const kg = qToKg(l.quantiteG, l.quantiteUnite);
    if (l.materiauCode === 'NAHA') g.NAHA += kg;
    else if (l.materiauCode === 'PDRN') g.PDRN += kg;
    else if (l.materiauCode === 'TXA') g.TXA += kg;
    else g.Autres += kg;
    m.set(annee, g);
  }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([annee, g]) => ({
    annee, NAHA: round2(g.NAHA), PDRN: round2(g.PDRN), TXA: round2(g.TXA), Autres: round2(g.Autres),
  }));
}

// ---------- Graphiques (recharts) ----------
function KgParFournisseurChart({ data }: { data: { fournisseur: string; kg: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={288}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
        <XAxis dataKey="fournisseur" tick={{ fontSize: 11, fill: CHART.tick }} interval={0} angle={-15} textAnchor="end" height={60} />
        <YAxis tick={{ fontSize: 11, fill: CHART.tick }} unit=" kg" width={56} />
        <Tooltip formatter={(v: any) => [`${v} kg`, 'Quantité']} />
        <Bar dataKey="kg" fill={CHART.primary} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
function LossMoyenneChart({ data }: { data: { matiere: string; moyenne: number; seuil: number | null }[] }) {
  const seuil = data.find(d => d.seuil != null)?.seuil ?? SEUIL_LOSS_DEFAUT;
  return (
    <ResponsiveContainer width="100%" height={288}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
        <XAxis dataKey="matiere" tick={{ fontSize: 11, fill: CHART.tick }} />
        <YAxis tick={{ fontSize: 11, fill: CHART.tick }} unit=" %" width={48} />
        <Tooltip formatter={(v: any) => [`${v} %`, 'Loss moyen']} />
        <ReferenceLine y={seuil} stroke={CHART.error} strokeDasharray="4 4" label={{ value: `Seuil ${seuil} %`, fontSize: 10, fill: CHART.error, position: 'insideTopRight' }} />
        <Bar dataKey="moyenne" radius={[4, 4, 0, 0]}>
          {data.map((d, i) => <Cell key={i} fill={d.moyenne > (d.seuil ?? seuil) ? CHART.error : CHART.primary} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
function QuantiteParAnChart({ data }: { data: { annee: string; NAHA: number; PDRN: number; TXA: number; Autres: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={288}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
        <XAxis dataKey="annee" tick={{ fontSize: 11, fill: CHART.tick }} />
        <YAxis tick={{ fontSize: 11, fill: CHART.tick }} unit=" kg" width={56} />
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="NAHA" stackId="a" fill={CHART.primary} />
        <Bar dataKey="PDRN" stackId="a" fill={CHART.info} />
        <Bar dataKey="TXA" stackId="a" fill={CHART.warning} />
        <Bar dataKey="Autres" stackId="a" fill={CHART.neutral} />
      </BarChart>
    </ResponsiveContainer>
  );
}
function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 font-semibold text-slate-800 text-sm">{title}</div>
      <div className="p-4">{children}</div>
    </div>
  );
}

export function CoaTrackingView({ view }: { view: string }) {
  const { token, socket, canEdit } = useAuth();
  const [board, setBoard] = useState<Board>({ materiaux: [], references: [], lots: [] });
  const [loading, setLoading] = useState(true);
  // Drill-down depuis une tuile du tableau de bord : ouvre la liste Lots pré-filtrée (F7).
  const [drill, setDrill] = useState<{ view: string; filter?: any } | null>(null);
  useEffect(() => { setDrill(null); }, [view]);  // un changement d'onglet via la sidebar annule le drill-down

  const load = useCallback(async () => {
    if (!token) return;
    const r = await fetch(`${API_URL}/api/coa/data`, { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) setBoard(await r.json());
    setLoading(false);
  }, [token]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!socket) return; const h = () => load(); socket.on('coa:changed', h); return () => { socket.off('coa:changed', h); }; }, [socket, load]);

  const api = async (method: string, path: string, body?: any) => {
    const r = await fetch(`${API_URL}${path}`, {
      method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) { const e = await r.json().catch(() => ({})); alert(e.error || 'Erreur'); }
    await load();
    return r.ok;
  };

  if (loading) return <div className="p-8 flex-1 flex items-center justify-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Chargement…</div>;

  const effView = drill?.view ?? view;
  return (
    <div className="p-6 flex-1 overflow-auto bg-slate-50">
      {effView === 'coa-dashboard' && <Dashboard board={board} onDrill={(filter) => setDrill({ view: 'coa-lots', filter })} />}
      {effView === 'coa-lots' && <Lots board={board} api={api} token={token} canEdit={canEdit} reload={load} initialFilter={drill?.filter} />}
      {effView === 'coa-alertes' && <Alertes board={board} />}
      {effView === 'coa-parametres' && <Parametres board={board} api={api} canEdit={canEdit} />}
    </div>
  );
}

// ---------- Alertes (calcul partagé) ----------
function buildAlertes(board: Board) {
  const out: { type: 'coa' | 'peremption'; lot: Lot; label: string }[] = [];
  for (const l of board.lots) {
    if (!l.hasCoaDoc) out.push({ type: 'coa', lot: l, label: 'CoA manquant' });
    if (isPeremptionProche(l)) {
      const d = daysUntil(l.datePeremption)!;
      out.push({ type: 'peremption', lot: l, label: d < 0 ? `Périmé depuis ${-d} j` : `Péremption dans ${d} j` });
    }
  }
  return out;
}

// ---------- Dashboard ----------
function Dashboard({ board, onDrill }: { board: Board; onDrill: (filter: any) => void }) {
  const lots = board.lots;
  const matById = useMemo(() => Object.fromEntries(board.materiaux.map(m => [m.id, m])) as Record<number, Materiau>, [board.materiaux]);

  const totalKg = round2(lots.reduce((s, l) => s + qToKg(l.quantiteG, l.quantiteUnite), 0));
  const alertesLoss = lots.filter(l => statutLoss(l.lossDrying, l.seuilLossDrying, l.materiauId != null ? !!matById[l.materiauId]?.lossDryingApplicable : false) === 'ALERTE').length;
  const expires = lots.filter(l => statutPeremption(l.datePeremption) === 'EXPIRE').length;
  const aSurveiller = lots.filter(l => statutPeremption(l.datePeremption) === 'A_SURVEILLER').length;
  const aVerifier = lots.filter(l => l.aVerifier).length;

  const dataFournisseur = useMemo(() => kgParFournisseur(lots), [lots]);
  const dataLoss = useMemo(() => lossMoyenneParMatiere(lots, matById), [lots, matById]);
  const dataAnnee = useMemo(() => quantiteParAn(lots), [lots]);

  const alertes = buildAlertes(board);
  return (
    <div>
      <h3 className="text-lg font-semibold text-slate-800 mb-4">CoA Tracking · Tableau de bord</h3>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
        <Kpi title="LOTS" value={lots.length} onClick={() => onDrill({})} />
        <Kpi title="QUANTITÉ TOTALE" value={`${totalKg} kg`} />
        <Kpi title="LOSS EN ALERTE" value={alertesLoss} color={alertesLoss ? 'text-red-600' : undefined} onClick={() => onDrill({ lossAlerte: true })} />
        <Kpi title="EXPIRÉS" value={expires} color={expires ? 'text-red-600' : undefined} onClick={() => onDrill({ peremption: 'EXPIRE' })} />
        <Kpi title="< 90 JOURS" value={aSurveiller} color={aSurveiller ? 'text-amber-600' : undefined} onClick={() => onDrill({ peremption: 'A_SURVEILLER' })} />
        <Kpi title="À VÉRIFIER" value={aVerifier} color={aVerifier ? 'text-orange-600' : undefined} onClick={() => onDrill({ aVerifier: true })} />
      </div>
      <div className="grid grid-cols-1 gap-4 mb-6">
        <ChartCard title="1 · Quantité reçue par fournisseur (kg)"><KgParFournisseurChart data={dataFournisseur} /></ChartCard>
        <ChartCard title="2 · Loss Drying moyen par matière (seuil 10 %)"><LossMoyenneChart data={dataLoss} /></ChartCard>
        <ChartCard title="3 · Quantités reçues par année (kg)"><QuantiteParAnChart data={dataAnnee} /></ChartCard>
      </div>
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 font-semibold text-slate-800">Alertes en cours <span className="text-xs font-normal text-slate-400">· {alertes.length}</span></div>
        <AlertesList alertes={alertes} />
      </div>
    </div>
  );
}
function Kpi({ title, value, sub, color, onClick }: { title: string; value: React.ReactNode; sub?: string; color?: string; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      title={onClick ? 'Voir les lots concernés' : undefined}
      className={cn('bg-white p-4 rounded-xl border border-slate-200 shadow-sm', onClick && 'cursor-pointer hover:border-blue-400 hover:shadow transition-colors')}
    >
      <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">{title}</div>
      <div className={cn('text-2xl font-bold', sub ? 'mb-0.5' : '', color || 'text-slate-900')}>{value}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

// ---------- Alertes ----------
function Alertes({ board }: { board: Board }) {
  const alertes = buildAlertes(board);
  return (
    <div>
      <h3 className="text-lg font-semibold text-slate-800 mb-4">CoA Tracking · Alertes <span className="text-sm font-normal text-slate-400">· {alertes.length}</span></h3>
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <AlertesList alertes={alertes} />
      </div>
    </div>
  );
}
function AlertesList({ alertes }: { alertes: { type: string; lot: Lot; label: string }[] }) {
  if (!alertes.length) return <div className="px-4 py-10 text-center text-slate-400 text-sm">Aucune alerte. 👍</div>;
  return (
    <table className="w-full text-sm">
      <thead><tr className="bg-slate-50 text-left text-[11px] uppercase text-slate-500">
        <th className="px-4 py-2">Type</th><th className="px-4 py-2">Lot</th><th className="px-4 py-2">Matériau</th><th className="px-4 py-2">Fournisseur</th><th className="px-4 py-2">Détail</th>
      </tr></thead>
      <tbody className="divide-y divide-slate-100">
        {alertes.map((a, i) => (
          <tr key={i} className="hover:bg-slate-50">
            <td className="px-4 py-2">
              {a.type === 'coa'
                ? <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-red-100 border border-red-200 rounded-full px-2 py-0.5"><FileX className="w-3 h-3" /> CoA</span>
                : <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-100 border border-amber-200 rounded-full px-2 py-0.5"><Clock className="w-3 h-3" /> Péremption</span>}
            </td>
            <td className="px-4 py-2 font-mono text-xs text-slate-700">{a.lot.numeroLot}</td>
            <td className="px-4 py-2 text-slate-700">{a.lot.materiauCode || '—'}</td>
            <td className="px-4 py-2 text-slate-600">{a.lot.fournisseur}</td>
            <td className="px-4 py-2 text-slate-600">{a.label}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------- Lots ----------
const EMPTY_LOT = { materiauId: '', numeroLot: '', fournisseur: '', referenceInterne: '', referenceClient: '', numeroCommande: '', dateCommande: '', dateReception: '', datePeremption: '', quantiteG: '', quantiteUnite: 'g', lossDrying: '', aVerifierManuel: false, commentaire: '' };

function Lots({ board, api, token, canEdit, reload, initialFilter }: { board: Board; api: any; token: string | null; canEdit: boolean; reload: () => void; initialFilter?: any }) {
  const [editing, setEditing] = useState<any | null>(null);
  const fileInputs = useRef<Record<number, HTMLInputElement | null>>({});

  const uploadCoa = async (lotId: number, file: File) => {
    const r = await fetch(`${API_URL}/api/coa/lots/${lotId}/document?filename=${encodeURIComponent(file.name)}`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': file.type || 'application/pdf' }, body: file,
    });
    if (!r.ok) alert('Échec du téléversement.');
    reload();
  };
  const viewCoa = async (lotId: number) => {
    const r = await fetch(`${API_URL}/api/coa/lots/${lotId}/document`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return alert('Document indisponible.');
    const blob = await r.blob();
    window.open(URL.createObjectURL(blob), '_blank');
  };
  // Imprime le CoA PDF (ouverture dans un iframe caché + impression).
  const printCoa = async (lotId: number) => {
    const r = await fetch(`${API_URL}/api/coa/lots/${lotId}/document`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return alert('Document indisponible.');
    const url = URL.createObjectURL(await r.blob());
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none'; iframe.src = url;
    document.body.appendChild(iframe);
    iframe.onload = () => { try { iframe.contentWindow?.print(); } catch { window.open(url, '_blank'); } };
  };
  // Ouvre le sélecteur de fichier ; si un CoA existe déjà, on confirme le remplacement.
  const pickCoaFile = (lotId: number, hasDoc: boolean) => {
    if (hasDoc && !confirm('Un CoA est déjà attaché à ce lot.\nLe remplacer par un nouveau fichier ?')) return;
    fileInputs.current[lotId]?.click();
  };
  const deleteCoa = async (lotId: number) => {
    if (!confirm('Supprimer le CoA téléversé pour ce lot ? (le lot restera, seul le fichier est retiré)')) return;
    const r = await fetch(`${API_URL}/api/coa/lots/${lotId}/document`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) alert('Échec de la suppression.');
    reload();
  };

  // Filtres
  const [q, setQ] = useState('');
  const [matiere, setMatiere] = useState('');
  const [fournisseur, setFournisseur] = useState('');
  const [peremption, setPeremption] = useState('');
  const [lossAlerte, setLossAlerte] = useState(false);
  const [sansCoa, setSansCoa] = useState(false);
  const [aVerifierF, setAVerifierF] = useState(false);
  // Applique le filtre transmis par une tuile du tableau de bord (F7).
  useEffect(() => {
    if (!initialFilter) return;
    setQ(''); setMatiere(''); setFournisseur('');
    setPeremption(initialFilter.peremption ?? '');
    setLossAlerte(!!initialFilter.lossAlerte);
    setSansCoa(!!initialFilter.sansCoa);
    setAVerifierF(!!initialFilter.aVerifier);
  }, [initialFilter]);
  const [sortKey, setSortKey] = useState<string>('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const toggleSort = (k: string) => { if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortKey(k); setSortDir('asc'); } };

  const matById = useMemo(() => Object.fromEntries(board.materiaux.map(m => [m.id, m])) as Record<number, Materiau>, [board.materiaux]);
  const lossApplicable = (l: Lot) => l.materiauId != null ? !!matById[l.materiauId]?.lossDryingApplicable : false;
  const matieres = useMemo(() => [...new Set(board.lots.map(l => l.materiauCode).filter(Boolean) as string[])].sort(), [board.lots]);
  const fournisseurs = useMemo(() => [...new Set(board.lots.map(l => l.fournisseur))].sort(), [board.lots]);

  const filtres = useMemo(() => {
    const texte = q.trim().toLowerCase();
    return board.lots.filter(l => {
      if (matiere && l.materiauCode !== matiere) return false;
      if (fournisseur && l.fournisseur !== fournisseur) return false;
      if (peremption && statutPeremption(l.datePeremption) !== peremption) return false;
      if (lossAlerte && statutLoss(l.lossDrying, l.seuilLossDrying, lossApplicable(l)) !== 'ALERTE') return false;
      if (sansCoa && l.hasCoaDoc) return false;
      if (aVerifierF && !l.aVerifier) return false;
      if (texte) {
        const hay = [l.numeroLot, l.fournisseur, l.referenceInterne, l.numeroCommande, l.materiauCode, l.materiauLibelle].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(texte)) return false;
      }
      return true;
    });
  }, [board.lots, q, matiere, fournisseur, peremption, lossAlerte, sansCoa, aVerifierF, matById]);

  const kpis = useMemo(() => {
    let kg = 0, alertesLoss = 0, aSurveiller = 0, expires = 0, sansCoaN = 0;
    for (const l of filtres) {
      kg += qToKg(l.quantiteG, l.quantiteUnite);
      if (statutLoss(l.lossDrying, l.seuilLossDrying, lossApplicable(l)) === 'ALERTE') alertesLoss++;
      const sp = statutPeremption(l.datePeremption);
      if (sp === 'A_SURVEILLER') aSurveiller++;
      if (sp === 'EXPIRE') expires++;
      if (!l.hasCoaDoc) sansCoaN++;
    }
    return { total: filtres.length, kg: round2(kg), alertesLoss, aSurveiller, expires, sansCoaN };
  }, [filtres]);

  // Tri croissant/décroissant sur la colonne active (valeurs vides toujours en bas).
  const sorted = useMemo(() => {
    if (!sortKey) return filtres;
    const dir = sortDir === 'asc' ? 1 : -1;
    const num = new Set(['quantiteG', 'lossDrying', 'coa']);
    const date = new Set(['dateReception', 'datePeremption']);
    const val = (l: Lot): any => {
      switch (sortKey) {
        case 'materiauCode': return l.materiauCode || '';
        case 'referenceInterne': return l.referenceInterne || '';
        case 'numeroLot': return l.numeroLot || '';
        case 'fournisseur': return l.fournisseur || '';
        case 'dateReception': return l.dateReception || '';
        case 'datePeremption': return l.datePeremption || '';
        case 'quantiteG': return l.quantiteG;
        case 'lossDrying': return l.lossDrying;
        case 'coa': return l.hasCoaDoc ? 1 : 0;
        default: return '';
      }
    };
    return [...filtres].sort((a, b) => {
      const va = val(a), vb = val(b);
      if (num.has(sortKey)) {
        const na = va == null || va === '' ? null : Number(va);
        const nb = vb == null || vb === '' ? null : Number(vb);
        if (na == null && nb == null) return 0;
        if (na == null) return 1; if (nb == null) return -1;   // null toujours en bas
        return (na - nb) * dir;
      }
      if (date.has(sortKey)) {
        if (!va && !vb) return 0; if (!va) return 1; if (!vb) return -1;
        return String(va).localeCompare(String(vb)) * dir;
      }
      return String(va).localeCompare(String(vb), 'fr', { numeric: true }) * dir;
    });
  }, [filtres, sortKey, sortDir]);

  const reset = () => { setQ(''); setMatiere(''); setFournisseur(''); setPeremption(''); setLossAlerte(false); setSansCoa(false); setAVerifierF(false); };
  const SortTh = ({ k, label, right }: { k: string; label: string; right?: boolean }) => (
    <th className={cn('px-3 py-2', right && 'text-right')}>
      <button onClick={() => toggleSort(k)} className={cn('inline-flex items-center gap-1 uppercase hover:text-slate-700', sortKey === k && 'text-blue-600')}>
        {label}<span className="text-[9px] leading-none">{sortKey === k ? (sortDir === 'asc' ? '▲' : '▼') : '△'}</span>
      </button>
    </th>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-slate-800">CoA Tracking · Lots <span className="text-sm font-normal text-slate-400">· {board.lots.length}</span></h3>
        {canEdit && <button onClick={() => setEditing({ ...EMPTY_LOT })} className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"><Plus className="w-4 h-4" /> Lot</button>}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
        <Kpi title="LOTS AFFICHÉS" value={kpis.total} />
        <Kpi title="QUANTITÉ TOTALE" value={`${kpis.kg} kg`} />
        <Kpi title="LOSS EN ALERTE" value={kpis.alertesLoss} color={kpis.alertesLoss ? 'text-red-600' : undefined} />
        <Kpi title="EXPIRÉ / < 90 J" value={`${kpis.expires} / ${kpis.aSurveiller}`} color={kpis.expires || kpis.aSurveiller ? 'text-amber-600' : undefined} />
        <Kpi title="SANS COA" value={kpis.sansCoaN} color={kpis.sansCoaN ? 'text-amber-600' : undefined} />
      </div>

      {/* Barre de filtres */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-3 mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Rechercher (lot, fournisseur, réf…)" className="w-full text-sm border border-slate-300 rounded-md pl-9 pr-2 py-1.5 outline-none focus:border-blue-500" />
          </div>
          <select value={matiere} onChange={e => setMatiere(e.target.value)} className="text-sm border border-slate-300 rounded-md px-2 py-1.5 outline-none focus:border-blue-500">
            <option value="">Toutes les matières</option>
            {matieres.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <select value={fournisseur} onChange={e => setFournisseur(e.target.value)} className="text-sm border border-slate-300 rounded-md px-2 py-1.5 outline-none focus:border-blue-500">
            <option value="">Tous les fournisseurs</option>
            {fournisseurs.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
          <select value={peremption} onChange={e => setPeremption(e.target.value)} className="text-sm border border-slate-300 rounded-md px-2 py-1.5 outline-none focus:border-blue-500">
            <option value="">Péremption : toutes</option>
            <option value="VALIDE">Valide</option>
            <option value="A_SURVEILLER">À surveiller (&lt; 90 j)</option>
            <option value="EXPIRE">Expiré</option>
            <option value="INCONNU">Inconnue</option>
          </select>
          <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={lossAlerte} onChange={e => setLossAlerte(e.target.checked)} className="h-4 w-4" /> Loss en alerte</label>
          <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={sansCoa} onChange={e => setSansCoa(e.target.checked)} className="h-4 w-4" /> Sans CoA</label>
          <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={aVerifierF} onChange={e => setAVerifierF(e.target.checked)} className="h-4 w-4" /> À vérifier</label>
          <button onClick={reset} className="text-sm font-medium text-blue-600 hover:underline">Réinitialiser</button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-50 text-left text-[11px] uppercase text-slate-500">
            <SortTh k="materiauCode" label="Matière" /><SortTh k="referenceInterne" label="Réf" /><SortTh k="numeroLot" label="N° lot" /><SortTh k="fournisseur" label="Fournisseur" />
            <SortTh k="dateReception" label="Réception" /><SortTh k="datePeremption" label="Péremption" /><SortTh k="quantiteG" label="Quantité" right />
            <SortTh k="lossDrying" label="Loss Drying" right /><SortTh k="coa" label="CoA" /><th className="px-3 py-2"></th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {sorted.map(l => {
              const sl = statutLoss(l.lossDrying, l.seuilLossDrying, lossApplicable(l));
              return (
              <tr key={l.id} className="hover:bg-slate-50">
                <td className="px-3 py-2"><span title={l.materiauLibelle || undefined} className={cn('inline-block text-[10px] font-semibold border rounded-full px-2 py-0.5', matBadge(l.materiauCode))}>{l.materiauCode || '—'}</span></td>
                <td className="px-3 py-2">
                  <div className="flex flex-col">
                    <span className="font-mono text-xs text-slate-500">{l.referenceInterne ?? '—'}</span>
                    {l.referenceClient && <span className="text-xs text-slate-400">{l.referenceClient}</span>}
                  </div>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-slate-700"><span className="inline-flex items-center gap-1">{l.numeroLot}{l.aVerifier && <span title={motifAVerifier(l, lossApplicable(l))} className="inline-flex cursor-help"><AlertTriangle className="w-3.5 h-3.5 text-amber-500" aria-label={motifAVerifier(l, lossApplicable(l))} /></span>}</span></td>
                <td className="px-3 py-2 text-slate-600">{l.fournisseur}</td>
                <td className="px-3 py-2 text-slate-600">{l.dateReception ? formatDate(l.dateReception) : '—'}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-slate-600">{l.datePeremption ? formatDate(l.datePeremption) : '—'}</span>
                    <PeremptionBadge iso={l.datePeremption} />
                  </div>
                </td>
                <td className="px-3 py-2 text-right text-slate-600 tabular-nums">{fmtQty(l.quantiteG, l.quantiteUnite)}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {sl === 'NA' ? <span className="text-slate-400">N/A</span> : <span className={cn('inline-flex items-center justify-end gap-1.5', sl === 'ALERTE' ? 'font-semibold text-red-600' : 'text-slate-700')}>{fmtPct(l.lossDrying)}{sl === 'ALERTE' && <span title={`Loss drying ${fmtPct(l.lossDrying)} supérieur au seuil ${fmtPct(l.seuilLossDrying)}`} className="inline-flex cursor-help"><AlertTriangle className="w-3.5 h-3.5" aria-label="Loss en alerte" /></span>}</span>}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    {l.hasCoaDoc
                      ? <><button onClick={() => viewCoa(l.id)} title={l.coaFichier || 'Voir le CoA PDF'} className="inline-flex items-center gap-1 text-xs font-semibold text-green-700 hover:underline"><FileText className="w-3.5 h-3.5" /> PDF</button><button onClick={() => printCoa(l.id)} title="Imprimer le CoA" className="text-slate-400 hover:text-blue-600"><Printer className="w-3.5 h-3.5" /></button></>
                      : <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600"><XCircle className="w-3.5 h-3.5" /> manquant</span>}
                    {canEdit && <>
                      <input ref={el => { fileInputs.current[l.id] = el; }} type="file" accept="application/pdf,.pdf" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) uploadCoa(l.id, f); e.target.value = ''; }} />
                      {l.hasCoaDoc
                        ? <>
                            <button onClick={() => pickCoaFile(l.id, true)} title="Remplacer le CoA (corriger une erreur)" className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"><Upload className="w-3.5 h-3.5" /> Remplacer</button>
                            <button onClick={() => deleteCoa(l.id)} title="Supprimer le CoA téléversé" className="text-slate-400 hover:text-red-600"><FileX className="w-3.5 h-3.5" /></button>
                          </>
                        : <button onClick={() => pickCoaFile(l.id, false)} title="Téléverser le CoA PDF" className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"><Upload className="w-3.5 h-3.5" /> Téléverser</button>}
                    </>}
                  </div>
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {canEdit && <>
                    <button onClick={() => setEditing({ id: l.id, materiauId: l.materiauId ?? '', numeroLot: l.numeroLot, fournisseur: l.fournisseur, referenceInterne: l.referenceInterne ?? '', referenceClient: l.referenceClient ?? '', numeroCommande: l.numeroCommande ?? '', dateCommande: l.dateCommande ?? '', dateReception: l.dateReception ?? '', datePeremption: l.datePeremption ?? '', quantiteG: l.quantiteG ?? '', quantiteUnite: l.quantiteUnite ?? 'g', lossDrying: l.lossDrying ?? '', aVerifierManuel: l.aVerifierManuel, commentaire: l.commentaire ?? '' })} className="p-1 text-slate-400 hover:text-blue-600"><Pencil className="w-3.5 h-3.5" /></button>
                    <button onClick={() => setEditing({ ...EMPTY_LOT, materiauId: l.materiauId ?? '', fournisseur: l.fournisseur ?? '', referenceInterne: l.referenceInterne ?? '', referenceClient: l.referenceClient ?? '', numeroCommande: l.numeroCommande ?? '', dateCommande: l.dateCommande ?? '', dateReception: l.dateReception ?? '', datePeremption: l.datePeremption ?? '', quantiteG: l.quantiteG ?? '', quantiteUnite: l.quantiteUnite ?? 'g', lossDrying: l.lossDrying ?? '', aVerifierManuel: l.aVerifierManuel, commentaire: l.commentaire ?? '' })} title="Dupliquer ce lot (nouveau n° de lot à saisir)" className="p-1 text-slate-400 hover:text-emerald-600"><Copy className="w-3.5 h-3.5" /></button>
                    <button onClick={() => confirm(`Supprimer le lot ${l.numeroLot} ?`) && api('DELETE', `/api/coa/lots/${l.id}`)} className="p-1 text-slate-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
                  </>}
                </td>
              </tr>
            );})}
            {filtres.length === 0 && <tr><td colSpan={10} className="px-4 py-10 text-center text-slate-400">{board.lots.length === 0 ? <>Aucun lot. {canEdit && 'Clique « + Lot ».'}</> : 'Aucun lot ne correspond aux filtres.'}</td></tr>}
          </tbody>
        </table>
      </div>
      {editing && <LotModal draft={editing} setDraft={setEditing} materiaux={board.materiaux} references={board.references} onClose={() => setEditing(null)} api={api} />}
    </div>
  );
}

function PeremptionBadge({ iso }: { iso: string | null }) {
  const s = statutPeremption(iso);
  if (s === 'INCONNU') return <span className="text-xs text-slate-400">—</span>;
  const j = daysUntil(iso)!;
  const conf: Record<Exclude<StatutPeremption, 'INCONNU'>, [string, string]> = {
    VALIDE: ['bg-green-100 text-green-700 border-green-200', 'Valide'],
    A_SURVEILLER: ['bg-amber-100 text-amber-700 border-amber-200', `${j} j restants`],
    EXPIRE: ['bg-red-100 text-red-700 border-red-200', `Expiré (${Math.abs(j)} j)`],
  };
  const [cls, txt] = conf[s];
  return <span className={cn('inline-block w-fit text-[10px] font-semibold border rounded-full px-2 py-0.5', cls)}>{txt}</span>;
}

function LotModal({ draft, setDraft, materiaux, references, onClose, api }: { draft: any; setDraft: (d: any) => void; materiaux: Materiau[]; references: Reference[]; onClose: () => void; api: any }) {
  const set = (k: string, v: any) => setDraft({ ...draft, [k]: v });
  // Sélection d'un matériau → pré-remplit fournisseur / réf interne / réf externe depuis sa fiche référence.
  const onMateriau = (v: string) => {
    const ref = references.find(r => String(r.materiauId) === String(v));
    setDraft({ ...draft, materiauId: v, ...(ref ? { fournisseur: ref.fournisseur || draft.fournisseur, referenceInterne: ref.refInterne ?? draft.referenceInterne, referenceClient: ref.refClient ?? draft.referenceClient } : {}) });
  };
  const num = (v: any) => v === '' || v === null ? null : Number(v);
  const save = async () => {
    if (!draft.numeroLot || !draft.fournisseur) return alert('Numéro de lot et fournisseur requis.');
    const payload = {
      materiauId: draft.materiauId === '' ? null : Number(draft.materiauId), numeroLot: draft.numeroLot, fournisseur: draft.fournisseur,
      referenceInterne: draft.referenceInterne, referenceClient: draft.referenceClient, numeroCommande: draft.numeroCommande,
      dateCommande: draft.dateCommande, dateReception: draft.dateReception, datePeremption: draft.datePeremption,
      quantiteG: num(draft.quantiteG), quantiteUnite: draft.quantiteUnite || 'g', lossDrying: num(draft.lossDrying), aVerifierManuel: !!draft.aVerifierManuel, commentaire: draft.commentaire,
    };
    const ok = draft.id ? await api('PATCH', `/api/coa/lots/${draft.id}`, payload) : await api('POST', '/api/coa/lots', payload);
    if (ok) onClose();
  };
  const Field = ({ label, k, type = 'text' }: { label: string; k: string; type?: string }) => (
    <label className="block"><span className="text-xs font-medium text-slate-500">{label}</span>
      <input type={type} value={draft[k] ?? ''} onChange={e => set(k, e.target.value)} className="mt-1 w-full text-sm border border-slate-300 rounded-md px-2 py-1.5 outline-none focus:border-blue-500" /></label>
  );
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[88vh] overflow-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <h4 className="font-semibold text-slate-800">{draft.id ? 'Modifier le lot' : 'Nouveau lot MP'}</h4>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 grid grid-cols-2 gap-4">
          <label className="block"><span className="text-xs font-medium text-slate-500">Matériau</span>
            <select value={draft.materiauId ?? ''} onChange={e => onMateriau(e.target.value)} className="mt-1 w-full text-sm border border-slate-300 rounded-md px-2 py-1.5 outline-none focus:border-blue-500">
              <option value="">—</option>
              {materiaux.map(m => <option key={m.id} value={m.id}>{m.code} · {m.libelle}</option>)}
            </select></label>
          {Field({ label: 'N° de lot *', k: 'numeroLot' })}
          {Field({ label: 'Fournisseur *', k: 'fournisseur' })}
          {Field({ label: 'N° de commande', k: 'numeroCommande' })}
          {Field({ label: 'Référence interne', k: 'referenceInterne' })}
          {Field({ label: 'Référence client', k: 'referenceClient' })}
          {Field({ label: 'Date commande', k: 'dateCommande', type: 'date' })}
          {Field({ label: 'Date réception', k: 'dateReception', type: 'date' })}
          {Field({ label: 'Date péremption', k: 'datePeremption', type: 'date' })}
          <label className="block"><span className="text-xs font-medium text-slate-500">Quantité</span>
            <div className="mt-1 flex gap-1">
              <input type="number" value={draft.quantiteG ?? ''} onChange={e => set('quantiteG', e.target.value)} className="w-full text-sm border border-slate-300 rounded-md px-2 py-1.5 outline-none focus:border-blue-500" />
              <select value={draft.quantiteUnite || 'g'} onChange={e => set('quantiteUnite', e.target.value)} className="text-sm border border-slate-300 rounded-md px-2 py-1.5 bg-white outline-none focus:border-blue-500"><option value="g">g</option><option value="kg">kg</option><option value="L">L</option></select>
            </div></label>
          {Field({ label: 'Loss drying (%)', k: 'lossDrying', type: 'number' })}
          <label className="flex items-center gap-2 mt-5"><input type="checkbox" checked={!!draft.aVerifierManuel} onChange={e => set('aVerifierManuel', e.target.checked)} /> <span className="text-sm text-slate-600">Marquer « à vérifier »</span></label>
          <label className="block col-span-2"><span className="text-xs font-medium text-slate-500">Commentaire</span>
            <textarea value={draft.commentaire ?? ''} onChange={e => set('commentaire', e.target.value)} rows={2} className="mt-1 w-full text-sm border border-slate-300 rounded-md px-2 py-1.5 outline-none focus:border-blue-500" /></label>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-100">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg">Annuler</button>
          <button onClick={save} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700">Enregistrer</button>
        </div>
      </div>
    </div>
  );
}

// ---------- Paramètres ----------
function Parametres({ board, api, canEdit }: { board: Board; api: any; canEdit: boolean }) {
  const [mat, setMat] = useState({ code: '', libelle: '', seuilLossDrying: '', lossDryingApplicable: true });
  const [ref, setRef] = useState({ materiauId: '', fournisseur: '', refInterne: '', refClient: '' });
  const matById = useMemo(() => Object.fromEntries(board.materiaux.map(m => [m.id, m])), [board.materiaux]);

  const addMat = async () => {
    if (!mat.code || !mat.libelle) return alert('Code et libellé requis.');
    const ok = await api('POST', '/api/coa/materiaux', { code: mat.code, libelle: mat.libelle, seuilLossDrying: mat.seuilLossDrying === '' ? null : Number(mat.seuilLossDrying), lossDryingApplicable: mat.lossDryingApplicable });
    if (ok) setMat({ code: '', libelle: '', seuilLossDrying: '', lossDryingApplicable: true });
  };
  const addRef = async () => {
    if (!ref.materiauId || !ref.fournisseur) return alert('Matériau et fournisseur requis.');
    const ok = await api('POST', '/api/coa/references', { materiauId: Number(ref.materiauId), fournisseur: ref.fournisseur, refInterne: ref.refInterne, refClient: ref.refClient });
    if (ok) setRef({ materiauId: '', fournisseur: '', refInterne: '', refClient: '' });
  };

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2"><FileCheck className="w-5 h-5 text-blue-600" /> CoA Tracking · Paramètres</h3>

      {/* Matériaux */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 font-semibold text-slate-800">Matériaux <span className="text-xs font-normal text-slate-400">· {board.materiaux.length}</span></div>
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-50 text-left text-[11px] uppercase text-slate-500">
            <th className="px-4 py-2">Code</th><th className="px-4 py-2">Libellé</th><th className="px-4 py-2 text-right">Seuil loss drying</th><th className="px-4 py-2">Loss drying ?</th><th className="px-4 py-2"></th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {board.materiaux.map(m => (
              <tr key={m.id} className="hover:bg-slate-50">
                <td className="px-4 py-2 font-mono text-xs text-slate-700">{m.code}</td>
                <td className="px-4 py-2 text-slate-700">{m.libelle}</td>
                <td className="px-4 py-2 text-right text-slate-600">{m.seuilLossDrying ?? '—'}{m.seuilLossDrying != null ? ' %' : ''}</td>
                <td className="px-4 py-2 text-slate-600">{m.lossDryingApplicable ? 'Oui' : 'Non'}</td>
                <td className="px-4 py-2 text-right">{canEdit && <button onClick={() => confirm(`Supprimer le matériau ${m.code} ? (ses références et lots liés seront affectés)`) && api('DELETE', `/api/coa/materiaux/${m.id}`)} className="p-1 text-slate-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>}</td>
              </tr>
            ))}
            {canEdit && (
              <tr className="bg-blue-50/40">
                <td className="px-4 py-2"><input value={mat.code} onChange={e => setMat({ ...mat, code: e.target.value })} placeholder="MP-XXX" className="w-full text-xs border border-slate-300 rounded px-2 py-1 font-mono" /></td>
                <td className="px-4 py-2"><input value={mat.libelle} onChange={e => setMat({ ...mat, libelle: e.target.value })} placeholder="Libellé" className="w-full text-xs border border-slate-300 rounded px-2 py-1" /></td>
                <td className="px-4 py-2"><input type="number" value={mat.seuilLossDrying} onChange={e => setMat({ ...mat, seuilLossDrying: e.target.value })} placeholder="ex. 5" className="w-full text-xs border border-slate-300 rounded px-2 py-1 text-right" /></td>
                <td className="px-4 py-2"><label className="flex items-center gap-1 text-xs text-slate-600"><input type="checkbox" checked={mat.lossDryingApplicable} onChange={e => setMat({ ...mat, lossDryingApplicable: e.target.checked })} /> applicable</label></td>
                <td className="px-4 py-2 text-right"><button onClick={addMat} className="text-xs px-2 py-1 text-blue-600 hover:bg-blue-100 rounded font-medium">+ Ajouter</button></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Références */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 font-semibold text-slate-800">Références produit (matériau × fournisseur) <span className="text-xs font-normal text-slate-400">· {board.references.length}</span></div>
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-50 text-left text-[11px] uppercase text-slate-500">
            <th className="px-4 py-2">Matériau</th><th className="px-4 py-2">Fournisseur</th><th className="px-4 py-2">Réf. interne</th><th className="px-4 py-2">Réf. client</th><th className="px-4 py-2"></th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {board.references.map(r => (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="px-4 py-2 text-slate-700">{matById[r.materiauId]?.code || '—'}</td>
                <td className="px-4 py-2 text-slate-600">{r.fournisseur}</td>
                <td className="px-4 py-2 text-slate-600">{r.refInterne || '—'}</td>
                <td className="px-4 py-2 text-slate-600">{r.refClient || '—'}</td>
                <td className="px-4 py-2 text-right">{canEdit && <button onClick={() => api('DELETE', `/api/coa/references/${r.id}`)} className="p-1 text-slate-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>}</td>
              </tr>
            ))}
            {canEdit && (
              <tr className="bg-blue-50/40">
                <td className="px-4 py-2"><select value={ref.materiauId} onChange={e => setRef({ ...ref, materiauId: e.target.value })} className="w-full text-xs border border-slate-300 rounded px-2 py-1"><option value="">—</option>{board.materiaux.map(m => <option key={m.id} value={m.id}>{m.code}</option>)}</select></td>
                <td className="px-4 py-2"><input value={ref.fournisseur} onChange={e => setRef({ ...ref, fournisseur: e.target.value })} placeholder="Fournisseur" className="w-full text-xs border border-slate-300 rounded px-2 py-1" /></td>
                <td className="px-4 py-2"><input value={ref.refInterne} onChange={e => setRef({ ...ref, refInterne: e.target.value })} placeholder="Réf. interne" className="w-full text-xs border border-slate-300 rounded px-2 py-1" /></td>
                <td className="px-4 py-2"><input value={ref.refClient} onChange={e => setRef({ ...ref, refClient: e.target.value })} placeholder="Réf. client" className="w-full text-xs border border-slate-300 rounded px-2 py-1" /></td>
                <td className="px-4 py-2 text-right"><button onClick={addRef} className="text-xs px-2 py-1 text-blue-600 hover:bg-blue-100 rounded font-medium">+ Ajouter</button></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
