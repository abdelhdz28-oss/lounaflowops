import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useAuth } from '../AuthContext';
import { cn } from '../utils/cn';
import { Upload, Plus, Trash2, Pencil, X, Loader2, AlertTriangle, CheckCircle2, Gauge } from 'lucide-react';
import { formatDate } from '../constants';

const API_URL = import.meta.env.VITE_API_URL || '';
const nz = (v: any) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isNaN(n) ? 0 : n; };
const pctTxt = (r: number | null) => r == null ? '—' : `${(r * 100).toFixed(1)} %`;

interface Rec {
  id?: string; product_code?: string; product_name?: string; lot: string; unit_type?: string;
  date_repartition?: string; date_mirage?: string; date_etiquetage?: string; date_miseenboite?: string;
  qty_reparti?: number; qty_mire_conforme?: number; qty_etiquete?: number; qty_miseenboite?: number;
  cuve_initiale_l?: number | string; masse_gel_g?: number | string; vol_moyen_ml?: number | string; masse_moyenne_g?: number | string;
  notes?: string; pdf_filename?: string;
}
// Masse de gel mise à disposition (g) : cuve initiale saisie (L) × 1000 (ratio 1:1) ; repli sur masse_gel_g si pas de cuve.
function masseDispo(r: Rec): number | null {
  const cuve = val(r.cuve_initiale_l);
  if (cuve && cuve > 0) return cuve * 1000;
  return val(r.masse_gel_g);
}

// Valeur numérique ou null si l'étape n'est pas renseignée (distinct d'un vrai 0).
const val = (v: any): number | null => (v == null || v === '' || isNaN(Number(v))) ? null : Number(v);
// Rendements de la chaîne : gel → répartis → mirés conformes → étiquetés → mis en boîte.
// Renvoie null (affiché « — ») dès qu'un intrant manque, pour ne pas fausser les moyennes avec de faux 0 %.
function yieldsOf(r: Rec) {
  const rep = val(r.qty_reparti), mir = val(r.qty_mire_conforme), eti = val(r.qty_etiquete), box = val(r.qty_miseenboite);
  const gel = masseDispo(r), vol = val(r.vol_moyen_ml), masse = val(r.masse_moyenne_g);
  return {
    formulation: gel && rep && vol ? (rep * vol) / gel : null,                       // (répartis × vol moyen) ÷ (cuve initiale × 1000)
    repartition: gel && rep && masse ? (rep * masse) / gel : null,                   // (répartis × masse moyenne) ÷ (cuve initiale × 1000)
    mirage: rep && rep > 0 && mir != null ? mir / rep : null,                        // conformes ÷ répartis
    etiquetage: mir && mir > 0 && eti != null ? eti / mir : null,                    // étiquetés ÷ conformes
    condSec: mir && mir > 0 && box != null ? box / mir : null,                       // mis en boîte ÷ conformes
  };
}
// Incohérences à vérifier dans le DDL.
function coherenceOf(r: Rec): string[] {
  const issues: string[] = [];
  const rep = nz(r.qty_reparti), mir = nz(r.qty_mire_conforme), eti = nz(r.qty_etiquete), box = nz(r.qty_miseenboite);
  if (rep > 0 && mir > rep) issues.push('Mirés conformes > répartis');
  if (mir > 0 && eti > mir) issues.push('Étiquetés > mirés conformes');
  if (eti > 0 && box > eti) issues.push('Mis en boîte > étiquetés');
  if (mir > 0 && box > mir) issues.push('Mis en boîte > mirés conformes');
  const y = yieldsOf(r);
  (['formulation', 'repartition', 'mirage', 'etiquetage', 'condSec'] as const).forEach(k => { if (y[k] != null && y[k]! > 1.001) issues.push(`Rendement ${k} > 100 %`); });
  const ds = [r.date_repartition, r.date_mirage, r.date_etiquetage, r.date_miseenboite].filter(Boolean) as string[];
  for (let i = 1; i < ds.length; i++) if (ds[i] < ds[i - 1]) { issues.push('Dates dans le désordre'); break; }
  return issues;
}

const EMPTY: Rec = { lot: '', unit_type: 'seringue' };

export function ProductionYieldView() {
  const { token, canEdit } = useAuth();
  const auth = useMemo(() => ({ headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } }), [token]);
  const [records, setRecords] = useState<Rec[]>([]);
  const [form, setForm] = useState<Rec | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const r = await fetch(`${API_URL}/api/rendement/records`, auth);
    if (r.ok) { const d = await r.json(); setRecords(d.records || []); }
  }, [auth]);
  useEffect(() => { load(); }, [load]);

  // Édition directe dans le tableau : maj locale (rendements recalculés en direct) + sauvegarde auto au blur.
  const recordsRef = useRef<Rec[]>([]);
  useEffect(() => { recordsRef.current = records; }, [records]);
  const editCell = (id: string, patch: Partial<Rec>) => setRecords(rs => rs.map(x => x.id === id ? { ...x, ...patch } : x));
  const saveRow = async (id?: string) => {
    const rec = recordsRef.current.find(x => x.id === id);
    if (!rec || !canEdit) return;
    await fetch(`${API_URL}/api/rendement/records/${id}`, { method: 'PUT', ...auth, body: JSON.stringify(rec) });
  };

  const fileToB64 = (file: File) => new Promise<string>((resolve, reject) => { const rd = new FileReader(); rd.onload = () => resolve(String(rd.result)); rd.onerror = reject; rd.readAsDataURL(file); });
  // Importe 1 à 3 dossiers de lot : l'IA les lit ensemble et consolide (données parfois réparties sur plusieurs dossiers).
  const upload = async (files: File[]) => {
    if (!files.length) return;
    const sel = files.slice(0, 3);
    const names = sel.map(f => f.name).join(', ');
    setExtracting(true); setMsg('');
    try {
      const payload = await Promise.all(sel.map(async f => ({ name: f.name, data: await fileToB64(f) })));
      const r = await fetch(`${API_URL}/api/rendement/extract`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ files: payload }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg('⚠️ ' + (d.error || 'Extraction impossible. Saisie manuelle possible.')); setForm({ ...EMPTY, pdf_filename: names }); return; }
      const e = d.extracted || {};
      setForm({ ...EMPTY, ...e, pdf_filename: names });
      setMsg(`✅ ${sel.length > 1 ? `${sel.length} dossiers lus et consolidés` : 'DDL lu'} — vérifie et corrige les valeurs si besoin, puis enregistre.`);
    } catch { setMsg('⚠️ Erreur pendant la lecture du/des dossier(s).'); } finally { setExtracting(false); }
  };

  const save = async () => {
    if (!form || !form.lot.trim()) { setMsg('⚠️ Le numéro de lot est obligatoire.'); return; }
    setSaving(true);
    try {
      const url = form.id ? `${API_URL}/api/rendement/records/${form.id}` : `${API_URL}/api/rendement/records`;
      const r = await fetch(url, { method: form.id ? 'PUT' : 'POST', ...auth, body: JSON.stringify(form) });
      if (!r.ok) { const d = await r.json().catch(() => ({})); setMsg('⚠️ ' + (d.error || 'Erreur à l\'enregistrement.')); return; }
      const issues = coherenceOf(form);
      setForm(null);
      setMsg(issues.length ? `⚠️ Enregistré, mais incohérences à vérifier : ${issues.join(' · ')}` : '✅ Rendement enregistré.');
      await load();
    } finally { setSaving(false); }
  };

  const remove = async (id?: string) => { if (!id || !confirm('Supprimer ce relevé ?')) return; await fetch(`${API_URL}/api/rendement/records/${id}`, { method: 'DELETE', ...auth }); load(); };

  // KPIs = moyennes de rendement sur les relevés.
  const kpis = useMemo(() => {
    const acc = { formulation: [] as number[], repartition: [] as number[], mirage: [] as number[], condSec: [] as number[] };
    records.forEach(r => { const y = yieldsOf(r); (['formulation', 'repartition', 'mirage', 'condSec'] as const).forEach(k => { if (y[k] != null) acc[k].push(y[k]!); }); });
    const avg = (a: number[]) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
    return { formulation: avg(acc.formulation), repartition: avg(acc.repartition), mirage: avg(acc.mirage), condSec: avg(acc.condSec), n: records.length };
  }, [records]);

  const setF = (patch: Partial<Rec>) => setForm(f => f ? { ...f, ...patch } : f);
  const liveIssues = form ? coherenceOf(form) : [];

  return (
    <div>
      {msg && (
        <div className={cn('mb-4 text-sm rounded-lg px-4 py-3 flex items-start gap-2 border', msg.startsWith('✅') ? 'bg-green-50 text-green-700 border-green-200' : 'bg-amber-50 text-amber-700 border-amber-200')}>
          {msg.startsWith('✅') ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />}<span>{msg}</span>
        </div>
      )}

      {/* Dashboard : rendements moyens */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        <YieldKpi title="Rdt formulation" value={kpis.formulation} hint="gel → répartis (volume)" />
        <YieldKpi title="Rdt répartition" value={kpis.repartition} hint="gel → répartis (masse)" />
        <YieldKpi title="Rdt mirage" value={kpis.mirage} hint="conformes ÷ répartis" />
        <YieldKpi title="Rdt cond. secondaire" value={kpis.condSec} hint="mis en boîte ÷ conformes" />
      </div>

      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold text-slate-800">Relevés de rendement <span className="text-sm font-normal text-slate-400">· {records.length}</span></h3>
        {canEdit && (
          <div className="flex gap-2">
            <input ref={fileRef} type="file" accept="application/pdf,.pdf" multiple className="hidden" onChange={e => { const fs = e.target.files ? (Array.from(e.target.files) as File[]) : []; if (fs.length) upload(fs); e.target.value = ''; }} />
            <button onClick={() => fileRef.current?.click()} disabled={extracting} title="Sélectionne 1 à 3 dossiers de lot (Ctrl/Cmd + clic pour en choisir plusieurs)" className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
              {extracting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} {extracting ? 'Lecture des dossiers…' : 'Importer des DDL (1 à 3)'}
            </button>
            <button onClick={() => { setForm({ ...EMPTY }); setMsg(''); }} className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"><Plus className="w-4 h-4" /> Saisie manuelle</button>
          </div>
        )}
      </div>

      {/* Tableau des relevés + rendements */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead><tr className="bg-slate-50 text-left text-[11px] uppercase text-slate-500 border-b border-slate-200">
            <th className="px-3 py-2">Lot</th><th className="px-3 py-2">Produit</th><th className="px-3 py-2">Unité</th>
            <th className="px-3 py-2 text-right">Répartis</th><th className="px-3 py-2 text-right">Mirés conf.</th><th className="px-3 py-2 text-right">Étiquetés</th><th className="px-3 py-2 text-right">En boîte</th>
            <th className="px-3 py-2 text-right">Rdt formul.</th><th className="px-3 py-2 text-right">Rdt répart.</th><th className="px-3 py-2 text-right">Rdt mirage</th><th className="px-3 py-2 text-right">Rdt cond.</th>
            <th className="px-3 py-2 text-center">Cohérence</th><th className="px-3 py-2"></th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {records.length === 0 && <tr><td colSpan={13} className="px-3 py-8 text-center text-slate-400">Aucun relevé. Importe un DDL ou saisis manuellement.</td></tr>}
            {records.map(r => {
              const y = yieldsOf(r); const issues = coherenceOf(r);
              return (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 font-mono text-xs font-semibold text-slate-700">{r.lot}</td>
                  <td className="px-3 py-2 text-slate-600">{r.product_name || r.product_code || '—'}</td>
                  <td className="px-3 py-2 text-slate-500 capitalize">{r.unit_type || '—'}</td>
                  <td className="px-2 py-1"><QtyCell v={r.qty_reparti} onChange={val => editCell(r.id!, { qty_reparti: val })} onBlur={() => saveRow(r.id)} disabled={!canEdit} /></td>
                  <td className="px-2 py-1"><QtyCell v={r.qty_mire_conforme} onChange={val => editCell(r.id!, { qty_mire_conforme: val })} onBlur={() => saveRow(r.id)} disabled={!canEdit} /></td>
                  <td className="px-2 py-1"><QtyCell v={r.qty_etiquete} onChange={val => editCell(r.id!, { qty_etiquete: val })} onBlur={() => saveRow(r.id)} disabled={!canEdit} /></td>
                  <td className="px-2 py-1"><QtyCell v={r.qty_miseenboite} onChange={val => editCell(r.id!, { qty_miseenboite: val })} onBlur={() => saveRow(r.id)} disabled={!canEdit} bold /></td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">{pctTxt(y.formulation)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">{pctTxt(y.repartition)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">{pctTxt(y.mirage)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-800">{pctTxt(y.condSec)}</td>
                  <td className="px-3 py-2 text-center">
                    {issues.length
                      ? <span title={issues.join(' · ')} className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-700 bg-red-100 border border-red-200 rounded-full px-2 py-0.5"><AlertTriangle className="w-3 h-3" /> {issues.length}</span>
                      : <CheckCircle2 className="w-4 h-4 text-green-500 inline" />}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {canEdit && <><button onClick={() => { setForm({ ...r }); setMsg(''); }} className="p-1 text-slate-400 hover:text-blue-600"><Pencil className="w-3.5 h-3.5" /></button>
                    <button onClick={() => remove(r.id)} className="p-1 text-slate-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button></>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Modale de saisie / validation */}
      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setForm(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
              <h4 className="font-semibold text-slate-800">{form.id ? 'Modifier le relevé' : 'Nouveau relevé de rendement'}{form.pdf_filename ? ` · ${form.pdf_filename}` : ''}</h4>
              <button onClick={() => setForm(null)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Field label="N° de lot *"><input className="inp" value={form.lot} onChange={e => setF({ lot: e.target.value })} /></Field>
                <Field label="Produit"><input className="inp" value={form.product_name || ''} onChange={e => setF({ product_name: e.target.value })} /></Field>
                <Field label="Référence"><input className="inp" value={form.product_code || ''} onChange={e => setF({ product_code: e.target.value })} /></Field>
                <Field label="Type d'unité">
                  <select className="inp" value={form.unit_type || 'seringue'} onChange={e => setF({ unit_type: e.target.value })}><option value="seringue">Seringue</option><option value="flacon">Flacon</option></select>
                </Field>
              </div>

              <div className="border border-slate-100 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead><tr className="bg-slate-50 text-left text-[11px] uppercase text-slate-500"><th className="px-3 py-2">Étape</th><th className="px-3 py-2">Date</th><th className="px-3 py-2">Quantité</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    <StageRow label="Répartis (remplis)" d={form.date_repartition} q={form.qty_reparti} onD={v => setF({ date_repartition: v })} onQ={v => setF({ qty_reparti: v })} />
                    <StageRow label="Mirés conformes" d={form.date_mirage} q={form.qty_mire_conforme} onD={v => setF({ date_mirage: v })} onQ={v => setF({ qty_mire_conforme: v })} />
                    <StageRow label="Étiquetés" d={form.date_etiquetage} q={form.qty_etiquete} onD={v => setF({ date_etiquetage: v })} onQ={v => setF({ qty_etiquete: v })} />
                    <StageRow label="Mis en boîte" d={form.date_miseenboite} q={form.qty_miseenboite} onD={v => setF({ date_miseenboite: v })} onQ={v => setF({ qty_miseenboite: v })} />
                  </tbody>
                </table>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <Field label="Cuve initiale (L)"><input type="number" step="any" className="inp" value={form.cuve_initiale_l ?? ''} onChange={e => setF({ cuve_initiale_l: e.target.value })} placeholder="ex. 10" /></Field>
                <Field label="Vol. moyen remplissage (ml)"><input type="number" step="any" className="inp" value={form.vol_moyen_ml ?? ''} onChange={e => setF({ vol_moyen_ml: e.target.value })} /></Field>
                <Field label="Masse moyenne / unité (g)"><input type="number" step="any" className="inp" value={form.masse_moyenne_g ?? ''} onChange={e => setF({ masse_moyenne_g: e.target.value })} /></Field>
              </div>
              <p className="text-[11px] text-slate-400 -mt-2">La cuve initiale (L) est convertie en masse ×1000 (ratio 1:1) = masse de gel mise à disposition, dénominateur des rendements formulation & répartition.</p>

              {/* Aperçu rendements + incohérences */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-center">
                {(() => { const y = yieldsOf(form); return (['formulation', 'repartition', 'mirage', 'condSec'] as const).map(k => (
                  <div key={k} className="bg-slate-50 rounded-lg py-2"><div className="text-[10px] uppercase text-slate-400">{k === 'condSec' ? 'Cond. sec.' : k}</div><div className="text-sm font-semibold text-slate-700">{pctTxt(y[k])}</div></div>
                )); })()}
              </div>
              {liveIssues.length > 0 && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /><span><b>À vérifier dans le DDL :</b> {liveIssues.join(' · ')}</span></div>
              )}

              <Field label="Notes"><textarea className="inp h-16 resize-none" value={form.notes || ''} onChange={e => setF({ notes: e.target.value })} /></Field>
            </div>
            <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2">
              <button onClick={() => setForm(null)} className="px-3 py-2 text-sm text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50">Annuler</button>
              <button onClick={save} disabled={saving} className="px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
            </div>
          </div>
        </div>
      )}

      <style>{`.inp{width:100%;font-size:0.875rem;border:1px solid #cbd5e1;border-radius:0.375rem;padding:0.375rem 0.5rem;outline:none}.inp:focus{border-color:#3b82f6}`}</style>
    </div>
  );
}

function YieldKpi({ title, value, hint }: { title: string; value: number | null; hint: string }) {
  const tone = value == null ? 'text-slate-400' : value >= 0.95 ? 'text-green-600' : value >= 0.85 ? 'text-amber-500' : 'text-red-600';
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1"><Gauge className="w-3.5 h-3.5" /> {title}</div>
      <div className={cn('text-2xl font-bold', tone)}>{value == null ? '—' : `${(value * 100).toFixed(1)} %`}</div>
      <div className="text-[11px] text-slate-400 mt-0.5">{hint}</div>
    </div>
  );
}

// Cellule numérique éditable en place (recalcul en direct, sauvegarde au blur).
function QtyCell({ v, onChange, onBlur, disabled, bold, step }: { v?: number | string; onChange: (val: number) => void; onBlur: () => void; disabled?: boolean; bold?: boolean; step?: string }) {
  return (
    <input type="number" min={0} step={step || '1'} disabled={disabled}
      className={cn('w-20 text-right text-sm rounded px-1.5 py-1 outline-none bg-transparent border border-transparent tabular-nums', !disabled && 'hover:border-slate-300 focus:border-blue-500 focus:bg-white', bold && 'font-semibold text-slate-800')}
      value={v ?? ''} onChange={e => onChange(nz(e.target.value))} onBlur={onBlur} />
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="text-xs font-medium text-slate-500 block mb-1">{label}</span>{children}</label>;
}

function StageRow({ label, d, q, onD, onQ }: { label: string; d?: string; q?: number; onD: (v: string) => void; onQ: (v: number) => void }) {
  return (
    <tr>
      <td className="px-3 py-2 font-medium text-slate-700">{label}</td>
      <td className="px-3 py-2"><input type="date" className="inp" value={d || ''} onChange={e => onD(e.target.value)} /></td>
      <td className="px-3 py-2"><input type="number" min={0} className="inp" value={q ?? ''} onChange={e => onQ(nz(e.target.value))} /></td>
    </tr>
  );
}
