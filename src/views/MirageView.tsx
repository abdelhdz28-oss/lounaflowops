import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../AuthContext';
import {
  ResponsiveContainer, LineChart, Line, ComposedChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ReferenceLine, Cell,
} from 'recharts';
import {
  Eye, Plus, Upload, Loader2, Trash2, Pencil, X, AlertTriangle,
  CheckCircle2, ClipboardList, RefreshCw,
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || '';
const CHART = { primary: '#2563eb', ok: '#16a34a', warn: '#f59e0b', bad: '#dc2626', grid: '#e2e8f0', tick: '#64748b' };

// Seuil d'alerte du taux de rejet au mirage (%). Au-delà → plan d'action suggéré.
const THRESHOLD = 5;
// Code couleur : vert ≤ 5 % · orange entre 5 et 10 % · rouge ≥ 10 %.
const rateTone = (t: number): 'ok' | 'warn' | 'bad' => t <= THRESHOLD ? 'ok' : t < 10 ? 'warn' : 'bad';
const rateTextCls = (t: number) => ({ ok: 'text-green-600', warn: 'text-amber-500', bad: 'text-red-600' }[rateTone(t)]);

const DEFECT_TYPES = [
  'Particules', "Bulles d'air", 'Volume / Remplissage', 'Défaut cosmétique',
  'Fuite / Étanchéité', 'Bouchon / Piston', 'Corps étranger', 'Aspect / Couleur',
  'Étiquetage', 'Autre',
];

type Defect = { type: string; count: number };
type Record = {
  id: string;
  product_code: string | null;
  product_name: string | null;
  lot: string;
  inspection_date: string | null;
  qty_inspected: number;
  qty_rejected: number;
  unit_type: string | null;
  defects: Defect[];
  notes: string | null;
  pdf_filename: string | null;
};

type FormState = {
  id: string | null;
  product_code: string;
  product_name: string;
  lot: string;
  inspection_date: string;
  unit_type: string;
  qty_inspected: string;
  qty_rejected: string;
  defects: Defect[];
  notes: string;
  pdf_filename: string;
};

const emptyForm: FormState = {
  id: null, product_code: '', product_name: '', lot: '', inspection_date: '',
  unit_type: '', qty_inspected: '', qty_rejected: '', defects: [], notes: '', pdf_filename: '',
};

const rate = (r: { qty_inspected: number; qty_rejected: number }) =>
  r.qty_inspected > 0 ? +((r.qty_rejected / r.qty_inspected) * 100).toFixed(2) : 0;

// Rationalisation des types de défauts : « particule/fibre blanche », « Particules/Fibres blanches »…
// = même défaut. Clé insensible à la casse, aux accents, aux pluriels et aux séparateurs.
const defectKey = (s: string) => (s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/[\s\/\-_,;:.]+/g, ' ')
  .split(' ')
  .map(w => w.replace(/s$/, ''))
  .filter(Boolean)
  .join(' ');
// Libellé d'affichage : espaces propres + 1re lettre en majuscule.
const defectLabel = (s: string) => {
  const t = (s || '').replace(/\s+/g, ' ').trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
};

const productLabel = (r: { product_code: string | null; product_name: string | null }) =>
  r.product_name || r.product_code || '—';

export function MirageView() {
  const { token, canEdit } = useAuth();
  const auth = { headers: { Authorization: `Bearer ${token}` } };

  const [records, setRecords] = useState<Record[]>([]);
  const [catalog, setCatalog] = useState<{ type: string; ref: string }[]>([]);
  const [defectTypes, setDefectTypes] = useState<string[]>(DEFECT_TYPES);
  const [savedMsg, setSavedMsg] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selProducts, setSelProducts] = useState<string[]>([]);
  const [selYears, setSelYears] = useState<string[]>([]);
  const [selUnits, setSelUnits] = useState<string[]>([]);
  const [selLots, setSelLots] = useState<string[]>([]);
  const [selDefects, setSelDefects] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const onSort = (k: string) => {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir('asc'); }
  };

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [extracting, setExtracting] = useState(false);
  const [extractMsg, setExtractMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const r = await fetch(`${API_URL}/api/mirage/records`, auth);
      if (!r.ok) throw new Error();
      const d = await r.json();
      setRecords((d.records || []).map((x: Record) => ({ ...x, defects: Array.isArray(x.defects) ? x.defects : [] })));
    } catch { setError("Impossible de charger les contrôles mirage."); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [token]);

  // Catalogue Track&Production (type de produit → référence) pour la liste déroulante du formulaire.
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API_URL}/api/settings/productCatalog`, auth);
        if (r.ok) {
          const d = await r.json();
          if (Array.isArray(d)) setCatalog(d.filter((p: any) => p && p.type).map((p: any) => ({ type: String(p.type), ref: String(p.ref || '') })));
        }
      } catch { /* liste facultative */ }
    })();
  }, [token]);

  // Référentiel des types de défauts (liste stable, extensible).
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API_URL}/api/mirage/defect-types`, auth);
        if (r.ok) {
          const d = await r.json();
          if (Array.isArray(d.types) && d.types.length) setDefectTypes(d.types.map(String));
        }
      } catch { /* fallback liste locale */ }
    })();
  }, [token]);

  // Ajout d'un nouveau type de défaut au référentiel (puis sélection sur la ligne).
  const addNewType = async (i: number) => {
    const label = window.prompt('Nouveau type de défaut à ajouter au référentiel :');
    if (!label || !label.trim()) return;
    try {
      const r = await fetch(`${API_URL}/api/mirage/defect-types`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label.trim() }),
      });
      const d = await r.json();
      if (r.ok && Array.isArray(d.types)) { setDefectTypes(d.types.map(String)); setDefect(i, { type: label.trim() }); }
    } catch { /* silencieux */ }
  };

  // Choix d'un type de produit → remplit automatiquement la référence associée.
  const pickType = (t: string) => {
    const entry = catalog.find(p => p.type === t);
    setForm(f => ({ ...f, product_name: t, product_code: entry?.ref || f.product_code }));
  };

  const products = useMemo(() => {
    const s = new Set<string>();
    records.forEach(r => s.add(productLabel(r)));
    return [...s].sort();
  }, [records]);

  const years = useMemo(() => {
    const s = new Set<string>();
    records.forEach(r => { if (r.inspection_date) s.add(r.inspection_date.slice(0, 4)); });
    return [...s].sort().reverse();
  }, [records]);

  const unitLabel = (r: Record) => r.unit_type ? r.unit_type.charAt(0).toUpperCase() + r.unit_type.slice(1) : 'Non précisé';
  const unitTypes = useMemo(() => {
    const s = new Set<string>();
    records.forEach(r => s.add(unitLabel(r)));
    return [...s].sort();
  }, [records]);

  const lots = useMemo(() => {
    const s = new Set<string>();
    records.forEach(r => { if (r.lot) s.add(r.lot); });
    return [...s].sort();
  }, [records]);

  // Types de défauts présents dans les contrôles (fusionnés via defectKey, comme le Pareto).
  const defectOptions = useMemo(() => {
    const m = new Map<string, string>();
    records.forEach(r => (r.defects || []).forEach(d => {
      const k = defectKey(d.type);
      if (k && !m.has(k)) m.set(k, defectLabel(d.type));
    }));
    return [...m.values()].sort((a, b) => a.localeCompare(b, 'fr'));
  }, [records]);

  const selDefectKeys = useMemo(() => new Set(selDefects.map(defectKey)), [selDefects]);

  const filtered = useMemo(
    () => records.filter(r =>
      (selProducts.length === 0 || selProducts.includes(productLabel(r))) &&
      (selYears.length === 0 || selYears.includes((r.inspection_date || '').slice(0, 4))) &&
      (selUnits.length === 0 || selUnits.includes(unitLabel(r))) &&
      (selLots.length === 0 || selLots.includes(r.lot)) &&
      (selDefects.length === 0 || (r.defects || []).some(d => selDefectKeys.has(defectKey(d.type))))
    ),
    [records, selProducts, selYears, selUnits, selLots, selDefectKeys]
  );

  // Courbe du taux de rejet, lot après lot (ordre chronologique déjà renvoyé par l'API).
  const trend = useMemo(() => filtered.map(r => ({
    lot: r.lot,
    taux: rate(r),
    produit: productLabel(r),
    date: r.inspection_date || '',
  })), [filtered]);

  // Pareto des défauts (agrégé sur le périmètre filtré) + cumul %.
  // Les libellés équivalents (casse/accents/pluriels différents) sont fusionnés via defectKey.
  const pareto = useMemo(() => {
    const acc: { [k: string]: { type: string; count: number } } = {};
    filtered.forEach(r => (r.defects || []).forEach(d => {
      const key = defectKey(d.type);
      if (!key) return;
      if (!acc[key]) acc[key] = { type: defectLabel(d.type), count: 0 };
      acc[key].count += Number(d.count) || 0;
    }));
    const rows = Object.values(acc).sort((a, b) => b.count - a.count);
    const total = rows.reduce((s, x) => s + x.count, 0);
    let cum = 0;
    return rows.map(x => { cum += x.count; return { ...x, cumul: total ? +((cum / total) * 100).toFixed(1) : 0 }; });
  }, [filtered]);

  // Tri du tableau (les graphiques restent en ordre chronologique).
  const sorted = useMemo(() => {
    const val = (r: Record): string | number =>
      sortKey === 'lot' ? r.lot
      : sortKey === 'produit' ? productLabel(r)
      : sortKey === 'date' ? (r.inspection_date || '')
      : sortKey === 'insp' ? r.qty_inspected
      : sortKey === 'rej' ? r.qty_rejected
      : rate(r);
    const arr = [...filtered];
    arr.sort((a, b) => {
      const va = val(a), vb = val(b);
      const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'fr');
      return sortDir === 'asc' ? c : -c;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  // Indicateurs.
  const kpis = useMemo(() => {
    const n = filtered.length;
    const totInsp = filtered.reduce((s, r) => s + r.qty_inspected, 0);
    const totRej = filtered.reduce((s, r) => s + r.qty_rejected, 0);
    const avg = totInsp ? +((totRej / totInsp) * 100).toFixed(2) : 0;
    const last = trend.length ? trend[trend.length - 1].taux : 0;
    return { n, avg, last, totRej };
  }, [filtered, trend]);

  // Plan d'action déterministe (bonnes pratiques ISO 13485 / GMP), déclenché sur seuil / tendance.
  const actionPlan = useMemo(() => {
    if (!filtered.length) return null;
    const last = trend[trend.length - 1];
    const last3 = trend.slice(-3).map(t => t.taux);
    const rising = last3.length === 3 && last3[0] < last3[1] && last3[1] < last3[2];
    const topDefect = pareto[0]?.type;
    const over = last.taux > THRESHOLD;
    if (!over && !rising) return null;
    const actions: string[] = [];
    if (over) {
      actions.push(`Taux de rejet du dernier lot (${last.lot}) = ${last.taux}% > seuil ${THRESHOLD}% : ouvrir une **non-conformité (NC)** et mettre le lot en **quarantaine** le temps de la décision.`);
      actions.push(`Réaliser une **investigation / analyse de cause racine** (5M : Matière, Machine, Méthode, Main-d'œuvre, Milieu) et une **ré-inspection à 100%** si nécessaire.`);
      actions.push(`Déclencher une **CAPA** (action corrective) et suivre l'efficacité sur les 3 lots suivants — ISO 13485 §8.5.`);
    }
    if (rising) {
      actions.push(`Tendance **à la hausse** sur les 3 derniers lots (${last3.join('% → ')}%) : ouvrir une **revue de tendance qualité** avant dépassement du seuil (détection précoce).`);
    }
    if (topDefect) {
      actions.push(`Défaut dominant : **${topDefect}** — cibler l'action corrective sur cette famille (paramètre process, formation opérateur, contrôle en amont).`);
    }
    return { over, rising, actions };
  }, [filtered, trend, pareto]);

  // --- Formulaire ---
  const openNew = () => { setForm(emptyForm); setExtractMsg(''); setShowForm(true); };
  const openEdit = (r: Record) => {
    setForm({
      id: r.id, product_code: r.product_code || '', product_name: r.product_name || '',
      lot: r.lot, inspection_date: r.inspection_date || '', unit_type: r.unit_type || '',
      qty_inspected: String(r.qty_inspected ?? ''), qty_rejected: String(r.qty_rejected ?? ''),
      defects: r.defects || [], notes: r.notes || '', pdf_filename: r.pdf_filename || '',
    });
    setExtractMsg(''); setShowForm(true);
  };

  const onPickPdf = async (file: File) => {
    setExtracting(true); setExtractMsg('');
    try {
      const r = await fetch(`${API_URL}/api/mirage/extract`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': file.type || 'application/pdf' },
        body: file,
      });
      const raw = await r.text();
      let d: any = {};
      try { d = raw ? JSON.parse(raw) : {}; } catch { d = {}; }
      if (!r.ok) { setExtractMsg(d.error || `Lecture IA impossible (HTTP ${r.status}) — saisie manuelle possible.`); setForm(f => ({ ...f, pdf_filename: file.name })); return; }
      const e = d.extracted || {};
      setForm(f => ({
        ...f,
        product_code: e.product_code || f.product_code,
        product_name: e.product_name || f.product_name,
        lot: e.lot || f.lot,
        inspection_date: e.inspection_date || f.inspection_date,
        unit_type: e.unit_type || f.unit_type,
        qty_inspected: e.qty_inspected != null ? String(e.qty_inspected) : f.qty_inspected,
        qty_rejected: e.qty_rejected != null ? String(e.qty_rejected) : f.qty_rejected,
        defects: Array.isArray(e.defects) && e.defects.length ? e.defects.map((x: any) => ({ type: String(x.type || 'Autre'), count: Number(x.count) || 0 })) : f.defects,
        notes: e.notes || f.notes,
        pdf_filename: file.name,
      }));
      const newT = Array.isArray(d.newTypes) && d.newTypes.length
        ? `Nouveau(x) type(s) de défaut hors référentiel : ${d.newTypes.join(', ')} — utilisez « ➕ Ajouter un nouveau type… » sur la ligne pour les intégrer à la liste.`
        : '';
      setExtractMsg(d.warning || newT
        ? `⚠️ ${[d.warning, newT].filter(Boolean).join(' · ')}`
        : '✅ Lecture IA terminée — vérifiez et corrigez les valeurs avant d\'enregistrer.');
    } catch { setExtractMsg("Erreur pendant la lecture du PDF."); }
    finally { setExtracting(false); }
  };

  // Garde-fou : le total des défauts saisis doit correspondre aux unités rejetées.
  const defSum = form.defects.reduce((t, d) => t + (Number(d.count) || 0), 0);
  const rejNum = Number(form.qty_rejected) || 0;
  const mismatch = form.defects.length > 0 && defSum !== rejNum;

  const setDefect = (i: number, patch: Partial<Defect>) =>
    setForm(f => ({ ...f, defects: f.defects.map((d, k) => k === i ? { ...d, ...patch } : d) }));
  const addDefect = () => setForm(f => ({ ...f, defects: [...f.defects, { type: defectTypes[0] || 'Non précisé', count: 0 }] }));
  const rmDefect = (i: number) => setForm(f => ({ ...f, defects: f.defects.filter((_, k) => k !== i) }));

  const save = async () => {
    if (!form.lot.trim()) { setExtractMsg('Le n° de lot est requis.'); return; }
    // Vérification finale avant enregistrement : total des défauts vs unités rejetées.
    if (mismatch && !window.confirm(`Le total des défauts (${defSum}) ne correspond pas aux unités rejetées (${rejNum}).\n\nEnregistrer quand même ?`)) return;
    setSaving(true);
    try {
      const body = {
        product_code: form.product_code || null, product_name: form.product_name || null,
        lot: form.lot.trim(), inspection_date: form.inspection_date || null, unit_type: form.unit_type || null,
        qty_inspected: Number(form.qty_inspected) || 0, qty_rejected: Number(form.qty_rejected) || 0,
        defects: form.defects, notes: form.notes || null, pdf_filename: form.pdf_filename || null,
      };
      const url = form.id ? `${API_URL}/api/mirage/records/${form.id}` : `${API_URL}/api/mirage/records`;
      const r = await fetch(url, {
        method: form.id ? 'PUT' : 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); setExtractMsg(d.error || "Enregistrement impossible."); return; }
      setShowForm(false);
      // Confirmation explicite : les totaux ont été recalculés au moment de l'enregistrement.
      setSavedMsg(form.defects.length === 0
        ? `✅ Contrôle du lot ${form.lot.trim()} enregistré.`
        : mismatch
          ? `⚠️ Contrôle du lot ${form.lot.trim()} enregistré, MAIS l'incohérence demeure : ${defSum} défauts répertoriés pour ${rejNum} unités rejetées. À vérifier.`
          : `✅ Contrôle du lot ${form.lot.trim()} enregistré — vérification faite : total des défauts (${defSum}) = unités rejetées (${rejNum}). Tout est cohérent, vous pouvez passer à autre chose.`);
      window.setTimeout(() => setSavedMsg(''), 12000);
      await load();
    } catch { setExtractMsg("Erreur pendant l'enregistrement."); }
    finally { setSaving(false); }
  };

  const remove = async (id: string) => {
    if (!confirm('Supprimer ce contrôle mirage ?')) return;
    await fetch(`${API_URL}/api/mirage/records/${id}`, { method: 'DELETE', ...auth });
    await load();
  };

  return (
    <div className="flex-1 overflow-auto bg-slate-50 p-6">
      {/* En-tête */}
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-blue-600 text-white flex items-center justify-center"><Eye className="w-6 h-6" /></div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Analyse des mirages</h1>
            <p className="text-sm text-slate-500">Contrôle visuel des unités · tendance du taux de rejet & Pareto des défauts</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100">
            <RefreshCw className="w-4 h-4" /> Rafraîchir
          </button>
          {canEdit && (
            <button onClick={openNew} className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700">
              <Plus className="w-4 h-4" /> Nouveau contrôle
            </button>
          )}
        </div>
      </div>

      {/* Confirmation après enregistrement (totaux vérifiés) */}
      {savedMsg && (
        <div className={`mb-4 text-sm rounded-lg px-4 py-3 flex items-start gap-2 border ${savedMsg.startsWith('✅') ? 'bg-green-50 text-green-700 border-green-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
          {savedMsg.startsWith('✅') ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />}
          <span>{savedMsg}</span>
          <button onClick={() => setSavedMsg('')} className="ml-auto opacity-60 hover:opacity-100"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Filtre produit */}
      <div className="mb-5 flex items-center gap-3 flex-wrap">
        <MultiSelect label="Produits" options={products} selected={selProducts} onChange={setSelProducts} allLabel="Tous les produits" />
        <MultiSelect label="Années" options={years} selected={selYears} onChange={setSelYears} allLabel="Toutes les années" />
        <MultiSelect label="Type d'unité" options={unitTypes} selected={selUnits} onChange={setSelUnits} allLabel="Tous les types" />
        <MultiSelect label="N° de lot" options={lots} selected={selLots} onChange={setSelLots} allLabel="Tous les lots" />
        <MultiSelect label="Type de défaut" options={defectOptions} selected={selDefects} onChange={setSelDefects} allLabel="Tous les défauts" />
        {(selProducts.length > 0 || selYears.length > 0 || selUnits.length > 0 || selLots.length > 0 || selDefects.length > 0) && (
          <button onClick={() => { setSelProducts([]); setSelYears([]); setSelUnits([]); setSelLots([]); setSelDefects([]); }} className="text-xs text-slate-400 underline">Tout effacer</button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500 py-20 justify-center"><Loader2 className="w-5 h-5 animate-spin" /> Chargement…</div>
      ) : error ? (
        <div className="text-red-600 bg-red-50 border border-red-200 rounded-lg p-4">{error}</div>
      ) : records.length === 0 ? (
        <div className="text-center py-20 text-slate-400">
          <Eye className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p>Aucun contrôle mirage enregistré.</p>
          {canEdit && <p className="text-sm mt-1">Cliquez sur « Nouveau contrôle » pour téléverser un dossier de lot ou saisir les valeurs.</p>}
        </div>
      ) : (
        <>
          {/* Indicateurs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <Kpi label="Contrôles suivis" value={String(kpis.n)} />
            <Kpi label="Taux de rejet moyen" value={`${kpis.avg} %`} tone={rateTone(kpis.avg)} />
            <Kpi label="Dernier taux" value={`${kpis.last} %`} tone={rateTone(kpis.last)} />
            <Kpi label="Unités rejetées (cumul)" value={String(kpis.totRej)} />
          </div>

          {/* Plan d'action */}
          {actionPlan && (
            <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <div className="flex items-center gap-2 font-semibold text-amber-800 mb-2">
                <AlertTriangle className="w-5 h-5" /> Plan d'action recommandé (ISO 13485 / bonnes pratiques GMP)
              </div>
              <ul className="space-y-1.5 text-sm text-amber-900">
                {actionPlan.actions.map((a, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-amber-500 mt-0.5">•</span>
                    <span dangerouslySetInnerHTML={{ __html: a.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>') }} />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Graphiques */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">Taux de rejet (%) par lot</h3>
              {trend.length === 0 ? <Empty /> : (
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={trend} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
                    <XAxis dataKey="lot" tick={{ fontSize: 10, fill: CHART.tick }} />
                    <YAxis tick={{ fontSize: 11, fill: CHART.tick }} unit=" %" width={44} />
                    <Tooltip formatter={(v: any) => [`${v} %`, 'Taux de rejet']} labelFormatter={(l: any) => `Lot ${l}`} />
                    <ReferenceLine y={THRESHOLD} stroke={CHART.bad} strokeDasharray="4 4" label={{ value: `Seuil ${THRESHOLD}%`, fontSize: 10, fill: CHART.bad, position: 'right' }} />
                    <Line dataKey="taux" stroke={CHART.primary} strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">Pareto des types de défauts</h3>
              {pareto.length === 0 ? <Empty text="Aucun défaut détaillé saisi." /> : (
                <ResponsiveContainer width="100%" height={280}>
                  <ComposedChart data={pareto} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
                    <XAxis dataKey="type" tick={{ fontSize: 9, fill: CHART.tick }} interval={0} angle={-20} textAnchor="end" height={60} />
                    <YAxis yAxisId="l" tick={{ fontSize: 11, fill: CHART.tick }} width={36} />
                    <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11, fill: CHART.tick }} unit=" %" domain={[0, 100]} width={44} />
                    <Tooltip />
                    <Bar yAxisId="l" dataKey="count" name="Défauts" radius={[4, 4, 0, 0]}>
                      {pareto.map((_, i) => <Cell key={i} fill={i === 0 ? CHART.bad : CHART.primary} />)}
                    </Bar>
                    <Line yAxisId="r" dataKey="cumul" name="Cumul %" stroke={CHART.warn} strokeWidth={2} dot={{ r: 2 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Tableau */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <Th label="Lot" k="lot" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                  <Th label="Produit" k="produit" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                  <Th label="Date" k="date" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                  <Th label="Contrôlées" k="insp" sortKey={sortKey} sortDir={sortDir} onSort={onSort} right />
                  <Th label="Rejetées" k="rej" sortKey={sortKey} sortDir={sortDir} onSort={onSort} right />
                  <Th label="Taux" k="taux" sortKey={sortKey} sortDir={sortDir} onSort={onSort} right />
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(r => {
                  const t = rate(r);
                  return (
                    <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-medium text-slate-700">{r.lot}</td>
                      <td className="px-4 py-2.5 text-slate-600">{productLabel(r)}</td>
                      <td className="px-4 py-2.5 text-slate-500">{r.inspection_date || '—'}</td>
                      <td className="px-4 py-2.5 text-right text-slate-600">{r.qty_inspected}</td>
                      <td className="px-4 py-2.5 text-right text-slate-600">{r.qty_rejected}</td>
                      <td className={`px-4 py-2.5 text-right font-semibold ${rateTextCls(t)}`}>{t} %</td>
                      <td className="px-4 py-2.5 text-right">
                        {canEdit && (
                          <div className="flex items-center gap-1 justify-end">
                            <button onClick={() => openEdit(r)} className="p-1.5 rounded hover:bg-slate-200 text-slate-500"><Pencil className="w-4 h-4" /></button>
                            <button onClick={() => remove(r.id)} className="p-1.5 rounded hover:bg-red-100 text-red-500"><Trash2 className="w-4 h-4" /></button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Modal formulaire */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[92vh] overflow-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 sticky top-0 bg-white">
              <h2 className="font-semibold text-slate-800">{form.id ? 'Modifier le contrôle mirage' : 'Nouveau contrôle mirage'}</h2>
              <button onClick={() => setShowForm(false)} className="p-1.5 rounded hover:bg-slate-100 text-slate-500"><X className="w-5 h-5" /></button>
            </div>

            <div className="p-5 space-y-4">
              {/* Upload PDF */}
              {!form.id && (
                <div className="rounded-xl border-2 border-dashed border-slate-200 p-4 text-center bg-slate-50">
                  <input ref={fileRef} type="file" accept="application/pdf" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) onPickPdf(f); e.target.value = ''; }} />
                  <button onClick={() => fileRef.current?.click()} disabled={extracting}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-white border border-slate-300 hover:bg-slate-100 disabled:opacity-60">
                    {extracting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    {extracting ? 'Lecture IA en cours…' : 'Téléverser le dossier de lot (PDF)'}
                  </button>
                  <p className="text-xs text-slate-400 mt-2">L'IA pré-remplit les champs — vous validez ensuite. Optionnel : vous pouvez tout saisir à la main.</p>
                </div>
              )}
              {extractMsg && (
                <div className={`text-sm rounded-lg px-3 py-2 flex items-start gap-2 ${extractMsg.startsWith('✅') ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
                  {extractMsg.startsWith('✅') ? <CheckCircle2 className="w-4 h-4 mt-0.5" /> : <AlertTriangle className="w-4 h-4 mt-0.5" />}
                  <span>{extractMsg}</span>
                </div>
              )}

              {/* Champs */}
              <div className="grid grid-cols-2 gap-3">
                <Field label="N° de lot *"><input value={form.lot} onChange={e => setForm(f => ({ ...f, lot: e.target.value }))} className={inp} placeholder="EA103B" /></Field>
                <Field label="Date d'inspection"><input type="date" value={form.inspection_date} onChange={e => setForm(f => ({ ...f, inspection_date: e.target.value }))} className={inp} /></Field>
                <Field label="Type de produit">
                  <select value={form.product_name} onChange={e => pickType(e.target.value)} className={inp}>
                    <option value="">— choisir —</option>
                    {catalog.map(p => <option key={p.type} value={p.type}>{p.type}</option>)}
                    {form.product_name && !catalog.some(p => p.type === form.product_name) && (
                      <option value={form.product_name}>{form.product_name}</option>
                    )}
                  </select>
                </Field>
                <Field label="Référence (auto)"><input value={form.product_code} onChange={e => setForm(f => ({ ...f, product_code: e.target.value }))} className={inp} placeholder="DB-ILA" /></Field>
                <Field label="Type d'unité">
                  <select value={form.unit_type} onChange={e => setForm(f => ({ ...f, unit_type: e.target.value }))} className={inp}>
                    <option value="">—</option><option value="seringue">Seringue</option><option value="flacon">Flacon</option>
                  </select>
                </Field>
                <div />
                <Field label="Unités contrôlées"><input type="number" value={form.qty_inspected} onChange={e => setForm(f => ({ ...f, qty_inspected: e.target.value }))} className={inp} /></Field>
                <Field label="Unités rejetées"><input type="number" value={form.qty_rejected} onChange={e => setForm(f => ({ ...f, qty_rejected: e.target.value }))} className={inp} /></Field>
              </div>

              {/* Défauts */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-slate-600 flex items-center gap-1.5"><ClipboardList className="w-4 h-4" /> Détail des défauts</label>
                  <button onClick={addDefect} className="text-xs text-blue-600 hover:underline flex items-center gap-1"><Plus className="w-3 h-3" /> Ajouter</button>
                </div>
                {form.defects.length === 0 && <p className="text-xs text-slate-400">Aucun défaut détaillé (facultatif — sert au Pareto).</p>}
                {form.defects.length > 0 && (
                  <div className="flex items-center gap-2 px-1 mb-1 text-[11px] font-medium text-slate-400">
                    <span className="flex-1">Type / description du défaut</span>
                    <span className="w-20 text-right">Qté</span>
                    <span className="w-7" />
                  </div>
                )}
                <div className="space-y-2">
                  {form.defects.map((d, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <select value={d.type}
                        onChange={e => e.target.value === '__new__' ? addNewType(i) : setDefect(i, { type: e.target.value })}
                        className="flex-1 min-w-0 text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/30">
                        {defectTypes.map(t => <option key={t} value={t}>{t}</option>)}
                        {d.type && !defectTypes.includes(d.type) && <option value={d.type}>⚠️ {d.type} (nouveau)</option>}
                        <option value="__new__">➕ Ajouter un nouveau type…</option>
                      </select>
                      <input type="number" value={d.count} onChange={e => setDefect(i, { count: Number(e.target.value) || 0 })}
                        className="w-20 shrink-0 text-sm text-right border border-slate-200 rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                        placeholder="Nb" />
                      <button onClick={() => rmDefect(i)} className="w-7 shrink-0 flex justify-center p-1.5 rounded hover:bg-red-100 text-red-500"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  ))}
                </div>
                {mismatch && (
                  <div className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>Attention : le total des défauts ({defSum}) ne correspond pas aux unités rejetées ({rejNum}).</span>
                  </div>
                )}
              </div>

              <Field label="Remarque"><textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className={`${inp} h-20`} /></Field>
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-200 sticky bottom-0 bg-white">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100">Annuler</button>
              <button onClick={save} disabled={saving} className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 flex items-center gap-2">
                {saving && <Loader2 className="w-4 h-4 animate-spin" />} Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const inp = 'w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/30';

// Menu déroulant à choix multiples (cases à cocher). Rien de coché = tout.
function MultiSelect({ label, options, selected, onChange, allLabel }: {
  label: string; options: string[]; selected: string[];
  onChange: (v: string[]) => void; allLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v]);
  const summary = selected.length === 0 ? allLabel : selected.length === 1 ? selected[0] : `${selected.length} sélectionnés`;
  return (
    <div ref={ref} className="relative">
      <span className="text-xs font-medium text-slate-400 block mb-0.5">{label}</span>
      <button onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-2 text-sm border rounded-lg px-3 py-2 bg-white min-w-[170px] justify-between ${selected.length ? 'border-blue-400 text-blue-700' : 'border-slate-200 text-slate-600'} hover:bg-slate-50`}>
        <span className="truncate max-w-[180px]">{summary}</span>
        <svg className={`w-3.5 h-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" /></svg>
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full min-w-[200px] max-h-64 overflow-auto bg-white border border-slate-200 rounded-lg shadow-lg p-1">
          {options.length === 0 && <div className="px-3 py-2 text-xs text-slate-400">Aucune option</div>}
          {options.map(o => (
            <label key={o} className="flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-slate-50 cursor-pointer text-sm text-slate-700">
              <input type="checkbox" checked={selected.includes(o)} onChange={() => toggle(o)} className="rounded border-slate-300 text-blue-600 focus:ring-blue-500/30" />
              <span className="truncate">{o}</span>
            </label>
          ))}
          {selected.length > 0 && (
            <button onClick={() => onChange([])} className="w-full text-left px-3 py-1.5 text-xs text-slate-400 hover:text-slate-600 underline">Effacer ({allLabel.toLowerCase()})</button>
          )}
        </div>
      )}
    </div>
  );
}

// En-tête de colonne triable : clic = croissant, re-clic = décroissant.
function Th({ label, k, sortKey, sortDir, onSort, right }: {
  label: string; k: string; sortKey: string; sortDir: 'asc' | 'desc';
  onSort: (k: string) => void; right?: boolean;
}) {
  const active = sortKey === k;
  return (
    <th className={`px-4 py-3 ${right ? 'text-right' : 'text-left'}`}>
      <button onClick={() => onSort(k)}
        className={`inline-flex items-center gap-1 uppercase hover:text-slate-700 ${active ? 'text-blue-600' : ''}`}>
        {label}
        <span className="text-[9px] leading-none">{active ? (sortDir === 'asc' ? '▲' : '▼') : '△'}</span>
      </button>
    </th>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="text-xs font-medium text-slate-500 block mb-1">{label}</span>{children}</label>;
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'warn' | 'bad' }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="text-xs text-slate-500 mb-1">{label}</div>
      <div className={`text-2xl font-bold ${tone === 'bad' ? 'text-red-600' : tone === 'warn' ? 'text-amber-500' : tone === 'ok' ? 'text-green-600' : 'text-slate-800'}`}>{value}</div>
    </div>
  );
}

function Empty({ text = 'Pas encore de données.' }: { text?: string }) {
  return <div className="h-[280px] flex items-center justify-center text-sm text-slate-400">{text}</div>;
}
