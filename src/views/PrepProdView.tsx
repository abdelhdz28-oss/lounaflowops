import React, { useState, useEffect, useCallback } from 'react';
import { useAppContext } from '../AppContext';
import { useAuth } from '../AuthContext';
import { PREP_TASKS, prepTaskStatus, formatDate, PrepStatus } from '../constants';
import { cn } from '../utils/cn';
import { Check, AlertTriangle, Clock, Minus, ChevronUp, ChevronDown, ChevronsUpDown, Plus, Loader2, RefreshCw, CloudOff, FileText, Download, Trash2, Mail } from 'lucide-react';
import { Batch } from '../types';

const API_URL = import.meta.env.VITE_API_URL || '';

interface PrepProdViewProps {
  view: string;
  onOpenBatch: (id: string) => void;
}

// ============================================================================
// Conteneur : 2 onglets (Suivi BC + Affectation n° de lot)
// ============================================================================
export function PrepProdView({ view, onOpenBatch }: PrepProdViewProps) {
  return (
    <div className="p-6 flex-1 overflow-auto bg-slate-50">
      {view === 'prepprod-lots' ? <ExcelLotsTab />
        : view === 'prepprod-ddl' ? <DdlTab />
        : <SuiviTab onOpenBatch={onOpenBatch} />}
    </div>
  );
}

// ============================================================================
// Onglet 1 — Suivi BC (checklist : BC commande, BC CMO, BC Sylexia…)
// ============================================================================
const CELL: Record<PrepStatus, { cls: string; icon: React.ReactNode; title: string }> = {
  done:    { cls: 'bg-green-100 text-green-700 hover:bg-green-200', icon: <Check className="w-4 h-4" />, title: 'Fait' },
  overdue: { cls: 'bg-red-100 text-red-700 hover:bg-red-200', icon: <AlertTriangle className="w-4 h-4" />, title: 'En retard' },
  soon:    { cls: 'bg-orange-100 text-orange-700 hover:bg-orange-200', icon: <Clock className="w-4 h-4" />, title: 'Échéance proche (≤ 7 j)' },
  pending: { cls: 'bg-slate-50 text-slate-300 hover:bg-slate-100', icon: <Minus className="w-4 h-4" />, title: 'À faire' },
  na:      { cls: 'bg-slate-50 text-slate-200', icon: <Minus className="w-4 h-4" />, title: 'Date de fabrication non définie' },
};

function SuiviTab({ onOpenBatch }: { onOpenBatch: (id: string) => void }) {
  const { batches, productCatalog, updateBatch } = useAppContext();
  const { canEdit } = useAuth();
  const [lotSort, setLotSort] = useState<'asc' | 'desc'>('asc');
  const list = (Array.isArray(batches) ? batches : [])
    .slice()
    .sort((a, b) => {
      const cmp = (a.id || '').localeCompare(b.id || '');
      return lotSort === 'asc' ? cmp : -cmp;
    });

  const toggle = async (b: Batch, taskId: string, current: boolean) => {
    if (!canEdit) return;
    const prep = { ...(b.prepTasks || {}), [taskId]: !current };
    await updateBatch(b.id, { prepTasks: prep });
  };

  return (
    <>
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-auto">
        <table className="text-sm border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="sticky left-0 z-10 bg-slate-50 px-4 py-3 text-left text-[11px] font-semibold text-slate-500 uppercase border-r border-slate-200">
                <button
                  onClick={() => setLotSort(d => (d === 'asc' ? 'desc' : 'asc'))}
                  className="inline-flex items-center gap-1 uppercase hover:text-slate-700 transition-colors"
                >
                  Lot
                  {lotSort === 'asc'
                    ? <ChevronUp className="w-3 h-3 text-blue-600" />
                    : <ChevronDown className="w-3 h-3 text-blue-600" />}
                </button>
              </th>
              {PREP_TASKS.map(t => (
                <th
                  key={t.id}
                  title={`${t.label} — attendu ${t.daysBefore === 14 ? '2 semaines' : '1 semaine'} avant la fabrication`}
                  className="px-3 py-3 text-center text-[11px] font-semibold text-slate-500 whitespace-nowrap"
                >
                  {t.short}
                  <div className="text-[9px] font-normal text-slate-400">{t.daysBefore === 14 ? 'J-14' : 'J-7'}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.map(b => {
              const type = productCatalog.find(p => p.ref === b.reference)?.type || b.product || '';
              return (
                <tr key={b.id} className="hover:bg-slate-50">
                  <td className="sticky left-0 z-10 bg-white px-4 py-2 border-r border-slate-100">
                    <button onClick={() => onOpenBatch(b.id)} className="text-left">
                      <div className="font-bold text-blue-600 text-sm">{b.id}</div>
                      <div className="text-[11px] text-slate-500">{type}</div>
                      <div className="text-[10px] text-slate-400 font-mono">Fab. {formatDate(b.startDate)}</div>
                    </button>
                  </td>
                  {PREP_TASKS.map(t => {
                    const done = !!(b.prepTasks && b.prepTasks[t.id]);
                    const st = prepTaskStatus(done, b.startDate, t.daysBefore);
                    const c = CELL[st];
                    return (
                      <td key={t.id} className="px-2 py-2 text-center">
                        <button
                          onClick={() => toggle(b, t.id, done)}
                          disabled={!canEdit}
                          title={c.title}
                          className={cn(
                            'inline-flex items-center justify-center w-9 h-9 rounded-md transition-colors',
                            c.cls, !canEdit && 'cursor-default'
                          )}
                        >
                          {c.icon}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {list.length === 0 && (
              <tr>
                <td colSpan={PREP_TASKS.length + 1} className="px-4 py-8 text-center text-slate-400">
                  Aucun lot.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-4 mt-4 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-green-400" /> Fait</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-orange-400" /> Échéance proche (≤ 7 j)</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-400" /> En retard</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-slate-200" /> À faire</span>
        <span className="text-slate-400">· Clique une case pour basculer fait / à faire · J-14 = 2 sem. avant fab, J-7 = 1 sem.</span>
      </div>
    </>
  );
}

// ============================================================================
// Onglet 2 — Affectation n° de lot : photocopie LIVE du fichier Excel (via Graph)
// ============================================================================
interface ExcelData {
  configured: boolean; sheet?: string; address?: string; rowCount?: number; columnCount?: number;
  text?: string[][]; values?: any[][];
}

// Convertit un index de colonne (0-based) en lettres Excel (0→A, 26→AA…).
function colName(index: number): string {
  let s = ''; let n = index;
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
}
// Parse le coin haut-gauche d'une adresse « Sheet!A1:CV202 » → { col: 0, row: 1 }.
function parseStart(address?: string): { col: number; row: number } {
  const a = (address || '').split('!').pop() || 'A1';
  const first = a.split(':')[0];
  const m = first.match(/^([A-Za-z]+)(\d+)$/);
  if (!m) return { col: 0, row: 1 };
  let col = 0; for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col: col - 1, row: parseInt(m[2], 10) };
}

// ============================================================================
// Onglet « Affectation n° de lot » : données du fichier Excel (via Graph), présentation app.
// Chaque cellule modifiée est écrite DANS le fichier Excel ; le n° de lot (col H) reste calculé par Excel.
// ============================================================================
interface LotXRow { excelRow: number; year: string; site: string; increment: string; product: string; lot: string; dateProd: string; dateFin: string; taille: string; comment: string; }

// Filtre multichoix (cases à cocher dans un menu déroulant).
function PrepMultiSelect({ label, options, selected, onChange }: { label: string; options: string[]; selected: Set<string>; onChange: (s: Set<string>) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)} className="text-sm border border-slate-300 rounded-md px-3 py-1.5 bg-white flex items-center gap-1.5 hover:bg-slate-50">
        {label}{selected.size > 0 && <span className="bg-blue-100 text-blue-700 rounded-full px-1.5 text-[10px] font-medium">{selected.size}</span>}
        <ChevronDown className="w-3 h-3 text-slate-400" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 w-72 max-h-72 overflow-auto bg-white border border-slate-200 rounded-lg shadow-lg p-2">
            <div className="flex justify-between items-center px-1 pb-1 mb-1 border-b border-slate-100">
              <span className="text-[11px] text-slate-400">{selected.size} sélectionné(s)</span>
              {selected.size > 0 && <button onClick={() => onChange(new Set())} className="text-[11px] text-blue-600 hover:underline">Tout effacer</button>}
            </div>
            {options.map(o => (
              <label key={o} className="flex items-center gap-2 px-1 py-1 text-xs hover:bg-slate-50 rounded cursor-pointer">
                <input type="checkbox" checked={selected.has(o)} onChange={() => { const n = new Set(selected); n.has(o) ? n.delete(o) : n.add(o); onChange(n); }} className="accent-blue-600" />
                <span className="truncate" title={o}>{o}</span>
              </label>
            ))}
            {options.length === 0 && <div className="text-xs text-slate-400 px-1 py-2">Aucune option</div>}
          </div>
        </>
      )}
    </div>
  );
}

function ExcelLotsTab() {
  const { token, socket, canEdit } = useAuth();
  const [data, setData] = useState<ExcelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0); // remonte les inputs après relecture (valeurs Excel recalculées)
  const [saving, setSaving] = useState<string | null>(null);
  const [yearF, setYearF] = useState('');
  const [prodSel, setProdSel] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<{ k: keyof LotXRow; dir: 'asc' | 'desc' } | null>(null);
  const [extraRows, setExtraRows] = useState(0);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    const r = await fetch(`${API_URL}/api/prepprod/excel`, { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) { setData(await r.json()); setVersion(v => v + 1); }
    setLoading(false);
  }, [token]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!socket) return; const h = () => load(); socket.on('prepprod:excel', h); return () => { socket.off('prepprod:excel', h); }; }, [socket, load]);

  const writeCell = async (address: string, value: string) => {
    setSaving(address);
    const r = await fetch(`${API_URL}/api/prepprod/excel/cell`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ address, value }),
    });
    setSaving(null);
    if (!r.ok) { const e = await r.json().catch(() => ({})); alert(e.error || 'Erreur écriture Excel'); }
    await load(); // relecture → le n° de lot recalculé par Excel réapparaît
  };

  if (loading && !data) return <div className="p-4 sm:p-6 lg:p-8 flex items-center justify-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Lecture du fichier Excel…</div>;

  if (data && data.configured === false) {
    return (
      <div className="max-w-2xl mx-auto mt-8 bg-white border border-amber-200 rounded-xl shadow-sm p-6 text-center">
        <CloudOff className="w-10 h-10 text-amber-400 mx-auto mb-3" />
        <h3 className="font-semibold text-slate-800 mb-1">Synchronisation Excel indisponible ici</h3>
        <p className="text-sm text-slate-500">
          Cet onglet lit le fichier Excel via <b>Microsoft Graph</b>, configuré uniquement en <b>production</b>.
          En local, les variables <span className="font-mono">GRAPH_*</span> sont absentes.
        </p>
      </div>
    );
  }

  // ---- Parsing du tableau « Batch Follow-up » (en-tête = ligne « Production YEAR ») ----
  const grid = data?.text || [];
  const start = parseStart(data?.address);
  const ix = (c: number) => c - start.col; // index tableau ← colonne Excel (A=0)
  const headerI = grid.findIndex(r => String(r?.[ix(0)] ?? '').trim() === 'Production YEAR');
  const parsed: LotXRow[] = [];
  if (headerI >= 0) {
    for (let i = headerI + 1; i < grid.length; i++) {
      const g = grid[i] || [];
      const v = (c: number) => String(g[ix(c)] ?? '').trim();
      const row: LotXRow = { excelRow: start.row + i, year: v(0), site: v(2), increment: v(4), product: v(5), lot: v(7), dateProd: v(8), dateFin: v(9), taille: v(10), comment: v(11) };
      if (row.year || row.product || row.lot) parsed.push(row);
    }
  }
  const lastExcelRow = parsed.length ? Math.max(...parsed.map(r => r.excelRow)) : (headerI >= 0 ? start.row + headerI + 1 : 17);

  const years = [...new Set(parsed.map(r => r.year).filter(Boolean))].sort();
  const prods = [...new Set(parsed.map(r => r.product).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
  const filtered = parsed.filter(r => (!yearF || r.year === yearF) && (!prodSel.size || prodSel.has(r.product)));

  const COLS: { k: keyof LotXRow; label: string; col: number; num?: boolean; cls?: string }[] = [
    { k: 'year', label: 'Année', col: 0, num: true },
    { k: 'site', label: 'Site', col: 2 },
    { k: 'increment', label: 'Incr.', col: 4, num: true },
    { k: 'product', label: 'Produit', col: 5 },
    { k: 'lot', label: 'N° de lot', col: 7, cls: 'font-mono font-semibold text-blue-700' },
    { k: 'dateProd', label: 'Date prod.', col: 8 },
    { k: 'dateFin', label: 'Date fin', col: 9 },
    { k: 'taille', label: 'Taille', col: 10 },
    { k: 'comment', label: 'Commentaire', col: 11 },
  ];
  const sorted = sort ? [...filtered].sort((a, b) => {
    const col = COLS.find(c => c.k === sort.k);
    const va = String(a[sort.k] ?? ''), vb = String(b[sort.k] ?? '');
    if (!va && !vb) return 0; if (!va) return 1; if (!vb) return -1;
    const s = sort.dir === 'asc' ? 1 : -1;
    if (col?.num) return (Number(va) - Number(vb)) * s;
    return va.localeCompare(vb, 'fr', { numeric: true }) * s;
  }) : filtered;
  const toggleSort = (k: keyof LotXRow) => setSort(s => (s && s.k === k ? { k, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { k, dir: 'asc' }));

  // Lignes vides ajoutées en bas (écrites dans l'Excel dès qu'une cellule est saisie).
  const extras: LotXRow[] = Array.from({ length: extraRows }, (_, i) => ({
    excelRow: lastExcelRow + 1 + i, year: '', site: '', increment: '', product: '', lot: '', dateProd: '', dateFin: '', taille: '', comment: '',
  }));

  const renderRow = (r: LotXRow) => (
    <tr key={r.excelRow} className="hover:bg-slate-50">
      {COLS.map(c => {
        const addr = `${colName(c.col)}${r.excelRow}`;
        const val = String(r[c.k] ?? '');
        return (
          <td key={c.k} className="px-1.5 py-0.5">
            <input
              key={`${version}-${addr}`}
              defaultValue={val}
              disabled={!canEdit || saving === addr}
              onBlur={e => { if (e.target.value !== val) writeCell(addr, e.target.value); }}
              className={cn(
                'w-full min-w-[64px] bg-transparent border border-transparent hover:border-slate-200 focus:border-blue-400 focus:bg-blue-50 rounded px-1.5 py-1 outline-none text-xs',
                c.cls, saving === addr && 'opacity-50'
              )}
            />
          </td>
        );
      })}
    </tr>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select value={yearF} onChange={e => setYearF(e.target.value)} className="text-sm border border-slate-300 rounded-md px-2 py-1.5 outline-none focus:border-blue-500">
          <option value="">Toutes années</option>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <PrepMultiSelect label="Produits" options={prods} selected={prodSel} onChange={setProdSel} />
        {(yearF || prodSel.size > 0) && <button onClick={() => { setYearF(''); setProdSel(new Set()); }} className="text-xs text-slate-500 hover:text-blue-600 underline">Réinitialiser</button>}
        <div className="ml-auto flex items-center gap-2">
          {canEdit && <button onClick={() => setExtraRows(n => n + 1)} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"><Plus className="w-4 h-4" /> Ligne</button>}
          <button onClick={load} className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-slate-300 bg-white rounded-lg text-sm font-medium hover:bg-slate-50">
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} /> Rafraîchir
          </button>
        </div>
      </div>
      <div className="text-sm text-slate-500">{filtered.length} lot(s) · <span className="text-xs text-slate-400">🔄 synchronisé avec le fichier Excel — chaque saisie est écrite dans le fichier ; le n° de lot est recalculé par Excel</span></div>
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="bg-slate-100 text-left text-[10px] uppercase text-slate-500">
            {COLS.map(c => (
              <th key={c.k} className="px-2 py-2 select-none">
                <button onClick={() => toggleSort(c.k)} className="inline-flex items-center gap-1 uppercase hover:text-slate-700">
                  {c.label}
                  {sort?.k === c.k ? (sort.dir === 'asc' ? <ChevronUp className="w-3 h-3 text-blue-600" /> : <ChevronDown className="w-3 h-3 text-blue-600" />) : <ChevronsUpDown className="w-3 h-3 text-slate-300" />}
                </button>
              </th>
            ))}
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {sorted.map(renderRow)}
            {extras.map(renderRow)}
            {sorted.length + extras.length === 0 && <tr><td colSpan={COLS.length} className="px-4 py-10 text-center text-slate-400">Aucun lot{yearF || prodSel.size ? ' pour ces filtres' : ''}.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================================
// Onglet 3 — Création DDL : modèle Word approuvé (SharePoint) + n° de lot → fichier Word rempli
// ============================================================================
type DdlFile = { itemId: string; name: string; modified: string; ddlNumber: string | null; version: string | null };
type DdlFamily = { name: string; files: DdlFile[] };
type DdlRecord = {
  id: number; lot: string; family: string | null; template_name: string | null;
  ddl_number: string | null; ddl_version: string | null; application_date: string | null;
  pdf_filename: string | null; status: string | null; created_by: string | null; created_at: string;
};

// PRRC Louna Aesthetics : destinataire de la demande de validation des DDL.
const PRRC_EMAIL = 'f.hadjab@louna-aesthetics.com';

// Cycle de vie d'un DDL (suivi visuel, étapes cliquables).
const DDL_STEPS = [
  { id: 'GENERE', label: 'Word généré' },
  { id: 'EN_VALIDATION', label: 'Validation QA' },
  { id: 'VALIDE', label: 'DDL validé' },
  { id: 'IMPRIME', label: 'DDL imprimé' },
];

function DdlStepper({ status, canEdit, onSet }: { status: string | null; canEdit: boolean; onSet: (s: string) => void }) {
  const idx = Math.max(0, DDL_STEPS.findIndex(s => s.id === (status || 'GENERE')));
  return (
    <div className="flex items-center gap-0.5">
      {DDL_STEPS.map((s, i) => (
        <React.Fragment key={s.id}>
          {i > 0 && <div className={cn('w-3 h-0.5 shrink-0', i <= idx ? 'bg-green-400' : 'bg-slate-200')} />}
          <button onClick={() => canEdit && onSet(s.id)} disabled={!canEdit} title={canEdit ? `Marquer « ${s.label} »` : s.label}
            className={cn('flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium whitespace-nowrap border transition-colors',
              i < idx ? 'bg-green-50 text-green-700 border-green-200'
                : i === idx && s.id === 'IMPRIME' ? 'bg-green-600 text-white border-green-600'
                : i === idx ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-slate-400 border-slate-200',
              canEdit && 'hover:ring-2 hover:ring-blue-200')}>
            {(i < idx || (i === idx && s.id === 'IMPRIME')) && <Check className="w-3 h-3" />}{s.label}
          </button>
        </React.Fragment>
      ))}
    </div>
  );
}

function DdlTab() {
  const { token, canEdit } = useAuth();
  const { batches } = useAppContext();
  const auth = { headers: { Authorization: `Bearer ${token}` } };
  // Le n° de lot se choisit parmi les lots existants : plus de saisie libre, donc plus de dossier orphelin.
  const lotsConnus = (Array.isArray(batches) ? batches : []).map((b: Batch) => b.id).filter(Boolean).sort();

  const [families, setFamilies] = useState<DdlFamily[] | null>(null);
  const [banner, setBanner] = useState('');
  const [family, setFamily] = useState('');
  const [itemId, setItemId] = useState('');
  const [lot, setLot] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  // « EA130A », « ea130 a » et « EA-130A » désignent le même lot (même règle que côté serveur).
  const normLot = (v: string) => v.toUpperCase().replace(/[\s\-_.]/g, '').trim();
  const lotReconnu = lotsConnus.some(id => normLot(id) === normLot(lot));
  const [list, setList] = useState<DdlRecord[]>([]);
  const [selected, setSelected] = useState<number[]>([]);

  const loadTemplates = useCallback(async () => {
    try {
      const r = await fetch(`${API_URL}/api/prepprod/ddl-templates`, auth);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setBanner(d.error || 'Modèles indisponibles.'); setFamilies([]); return; }
      setBanner(''); setFamilies(d.families || []);
    } catch { setBanner('Modèles indisponibles.'); setFamilies([]); }
  }, [token]);

  const loadList = useCallback(async () => {
    try {
      const r = await fetch(`${API_URL}/api/prepprod/ddl`, auth);
      if (r.ok) { const d = await r.json(); setList(d.files || []); }
    } catch { /* silencieux */ }
  }, [token]);

  useEffect(() => { loadTemplates(); loadList(); }, [loadTemplates, loadList]);

  const fam = (families || []).find(f => f.name === family) || null;
  const file = fam?.files.find(f => f.itemId === itemId) || null;

  const generate = async () => {
    if (!file || !lot.trim()) { setMsg('Choisissez un modèle et saisissez le n° de lot.'); return; }
    setBusy(true); setMsg('');
    try {
      const r = await fetch(`${API_URL}/api/prepprod/ddl-generate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: file.itemId, lot: lot.trim(), family, templateName: file.name }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(d.error || `Génération impossible (HTTP ${r.status}).`); return; }
      setMsg(`✅ Fichier Word généré pour le lot ${lot.trim()} — n° de lot inscrit dans ${d.headerHits} en-tête(s) et ${d.bodyHits} champ(s) du corps.`);
      setLot('');
      await loadList();
    } catch { setMsg('Erreur pendant la génération.'); }
    finally { setBusy(false); }
  };

  const download = async (r: DdlRecord) => {
    const resp = await fetch(`${API_URL}/api/prepprod/ddl/${r.id}/pdf`, auth);
    if (!resp.ok) return;
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = r.pdf_filename || 'ddl.docx'; a.click();
    URL.revokeObjectURL(url);
  };

  const remove = async (id: number) => {
    if (!confirm('Supprimer ce dossier de lot généré ?')) return;
    await fetch(`${API_URL}/api/prepprod/ddl/${id}`, { method: 'DELETE', ...auth });
    await loadList();
  };

  const setStatus = async (id: number, status: string) => {
    await fetch(`${API_URL}/api/prepprod/ddl/${id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    await loadList();
  };

  // Envoi au PRRC : crée un BROUILLON dans Outlook (fichier Word en pièce jointe) et l'ouvre.
  // Abdel vérifie et clique « Envoyer » lui-même (aucun envoi auto, aucun fichier .eml).
  const sendToPrrc = async (r: DdlRecord) => {
    setMsg('');
    try {
      const resp = await fetch(`${API_URL}/api/prepprod/ddl/${r.id}/send-validation`, { method: 'POST', ...auth });
      const d = await resp.json().catch(() => ({}));
      if (resp.ok && d.draft) {
        if (d.webLink) window.open(d.webLink, '_blank');
        setMsg(`✅ Brouillon créé dans Outlook (${d.to || PRRC_EMAIL}) avec le fichier Word du lot ${r.lot} en pièce jointe — vérifie et clique « Envoyer ».`);
        await loadList();
        return;
      }
      setMsg(`⚠️ Brouillon impossible à créer${d.code ? ` (${d.code})` : ''} : l'application a besoin du droit Azure « Mail.ReadWrite ».${d.detail ? ` — ${d.detail}` : ''}`);
    } catch {
      setMsg('⚠️ Impossible de joindre le serveur pour créer le brouillon.');
    }
  };

  // « DDL imprimé » : télécharge le fichier Word pour impression.
  // Le DDL est désormais un fichier Word (.docx) : on le télécharge (à ouvrir puis imprimer depuis Word).
  const printPdf = async (r: DdlRecord) => {
    try {
      const resp = await fetch(`${API_URL}/api/prepprod/ddl/${r.id}/pdf`, auth);
      if (!resp.ok) return;
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = r.pdf_filename || 'ddl.docx'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch { /* silencieux */ }
  };

  const onStep = async (r: DdlRecord, s: string) => {
    // « Validation QA » : crée automatiquement l'email au PRRC avec le fichier Word en pièce jointe.
    if (s === 'EN_VALIDATION') { await sendToPrrc(r); return; }
    if (s === 'IMPRIME') await printPdf(r);
    await setStatus(r.id, s);
  };

  // Sélection multiple + envoi groupé : un seul brouillon Outlook avec tous les fichiers Word joints.
  const toggleSel = (id: number) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  const allSelected = list.length > 0 && selected.length === list.length;
  const toggleAll = () => setSelected(allSelected ? [] : list.map(r => r.id));
  const sendBulk = async () => {
    if (!selected.length) return;
    setMsg('');
    try {
      const resp = await fetch(`${API_URL}/api/prepprod/ddl/send-validation-bulk`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selected }),
      });
      const d = await resp.json().catch(() => ({}));
      if (resp.ok && d.draft) {
        if (d.webLink) window.open(d.webLink, '_blank');
        setMsg(`✅ Brouillon créé dans Outlook (${d.to || PRRC_EMAIL}) avec ${d.count} DDL en pièces jointes — vérifie et clique « Envoyer ».`);
        setSelected([]); await loadList();
        return;
      }
      setMsg(`⚠️ Brouillon groupé impossible${d.code ? ` (${d.code})` : ''} : l'application a besoin du droit Azure « Mail.ReadWrite ».${d.detail ? ` — ${d.detail}` : ''}`);
    } catch { setMsg('⚠️ Impossible de joindre le serveur pour créer le brouillon groupé.'); }
  };

  return (
    <div className="space-y-6">
      {/* Création */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center gap-2 mb-4">
          <FileText className="w-5 h-5 text-blue-600" />
          <h3 className="font-semibold text-slate-800">Créer un dossier de lot (DDL)</h3>
          <span className="text-xs text-slate-400">modèles Word approuvés · SharePoint</span>
          <button onClick={loadTemplates} title="Resynchroniser le dossier SharePoint (familles + modèles)"
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100">
            <RefreshCw className="w-3.5 h-3.5" /> Synchroniser
          </button>
        </div>
        {banner && (
          <div className="mb-4 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-center gap-2">
            <CloudOff className="w-4 h-4 shrink-0" /> {banner}
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <label className="block">
            <span className="text-xs font-medium text-slate-500 block mb-1">1 · Famille de produit</span>
            <select value={family} onChange={e => { setFamily(e.target.value); setItemId(''); }} className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white">
              <option value="">— choisir —</option>
              {(families || []).map(f => <option key={f.name} value={f.name}>{f.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-500 block mb-1">2 · Modèle DDL (dernière révision)</span>
            <select value={itemId} onChange={e => setItemId(e.target.value)} disabled={!fam} className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white disabled:opacity-50">
              <option value="">— choisir —</option>
              {(fam?.files || []).map(f => <option key={f.itemId} value={f.itemId}>{f.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-500 block mb-1">3 · N° de lot</span>
            <input list="ddl-lots" value={lot} onChange={e => setLot(e.target.value)} placeholder="choisir un lot" className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2" />
            <datalist id="ddl-lots">{lotsConnus.map(id => <option key={id} value={id} />)}</datalist>
            {lot.trim() && !lotReconnu && <span className="block mt-1 text-[11px] text-amber-600">Ce lot n'existe pas dans le suivi de production — choisis-le dans la liste.</span>}
          </label>
          <button onClick={generate} disabled={busy || !canEdit || !file || !lot.trim() || !lotReconnu}
            className="h-[38px] px-4 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
            {busy ? 'Génération…' : 'Générer le Word'}
          </button>
        </div>
        {file && (
          <p className="text-xs text-slate-400 mt-2">
            Sélection : <span className="font-medium text-slate-500">{file.ddlNumber || file.name}</span>
            {file.version && <> · version {file.version}</>} · fichier du {file.modified}
          </p>
        )}
        {msg && (
          <div className={cn('mt-3 text-sm rounded-lg px-3 py-2', msg.startsWith('✅') ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700')}>
            {msg}
          </div>
        )}
      </div>

      {/* Historique des dossiers générés */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-2">
          <h3 className="font-semibold text-slate-800">DDL générés <span className="text-xs font-normal text-slate-400">· {list.length}</span></h3>
          <div className="flex items-center gap-2">
            {canEdit && selected.length > 0 && (
              <button onClick={sendBulk} className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg bg-violet-600 text-white hover:bg-violet-700">
                <Mail className="w-4 h-4" /> Envoyer la sélection ({selected.length})
              </button>
            )}
            <button onClick={loadList} className="text-slate-400 hover:text-blue-600"><RefreshCw className="w-4 h-4" /></button>
          </div>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="px-3 py-2.5 w-8">{canEdit && <input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded border-slate-300 text-violet-600 focus:ring-violet-500/30" />}</th>
              <th className="text-left px-4 py-2.5">Créé le</th>
              <th className="text-left px-4 py-2.5">N° de lot</th>
              <th className="text-left px-4 py-2.5">Type de produit</th>
              <th className="text-left px-4 py-2.5">N° DDL · version · application</th>
              <th className="text-left px-4 py-2.5">Suivi</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.map(r => (
              <tr key={r.id} className={cn('hover:bg-slate-50', selected.includes(r.id) && 'bg-violet-50/40')}>
                <td className="px-3 py-2.5">{canEdit && <input type="checkbox" checked={selected.includes(r.id)} onChange={() => toggleSel(r.id)} className="rounded border-slate-300 text-violet-600 focus:ring-violet-500/30" />}</td>
                <td className="px-4 py-2.5 text-slate-500 text-xs">{r.created_at}</td>
                <td className="px-4 py-2.5 font-semibold text-slate-700">{r.lot}</td>
                <td className="px-4 py-2.5 text-slate-600">{r.family || '—'}</td>
                <td className="px-4 py-2.5 text-slate-600 text-xs">
                  {r.ddl_number || '—'}{r.ddl_version && <> · v{r.ddl_version}</>}{r.application_date && <> · appliqué le {r.application_date}</>}
                </td>
                <td className="px-4 py-2.5"><DdlStepper status={r.status} canEdit={canEdit} onSet={s => onStep(r, s)} /></td>
                <td className="px-4 py-2.5 text-right">
                  <div className="flex items-center gap-1 justify-end">
                    <button onClick={() => download(r)} title="Télécharger le fichier Word" className="p-1.5 rounded hover:bg-blue-50 text-blue-600"><Download className="w-4 h-4" /></button>
                    {canEdit && (
                      <button onClick={() => sendToPrrc(r)} title={`Envoyer au PRRC (${PRRC_EMAIL}) pour validation`}
                        className="p-1.5 rounded hover:bg-violet-50 text-violet-600"><Mail className="w-4 h-4" /></button>
                    )}
                    {canEdit && <button onClick={() => remove(r.id)} title="Supprimer" className="p-1.5 rounded hover:bg-red-100 text-red-500"><Trash2 className="w-4 h-4" /></button>}
                  </div>
                </td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">Aucun DDL généré pour l'instant.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
