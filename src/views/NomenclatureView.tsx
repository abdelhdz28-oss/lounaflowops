import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../AuthContext';
import { cn } from '../utils/cn';
import { Loader2, RefreshCw, ChevronUp, ChevronDown, FlaskConical, Download } from 'lucide-react';
import * as XLSX from 'xlsx';

const API_URL = import.meta.env.VITE_API_URL || '';
const fmtQty = (n: number) => (n || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 });

interface BomProduct { tmplId: number; code: string; name: string }
interface BomLine { code: string | null; name: string; qty: number; uom: string; seq: number; child: BomTree | null }
interface BomTree { id: number; code: string; productQty: number; uom: string; lines: BomLine[] }

// Catégorie d'une ligne de degré 1 (préfixe du code produit).
function catOf(l: BomLine): string {
  if (l.child) return 'Vrac';
  const c = (l.code || '').toUpperCase();
  if (c.startsWith('MP')) return 'Matières premières';
  if (c.startsWith('AC') || c.startsWith('PAC')) return 'Conditionnement';
  if (c.startsWith('AT')) return 'Consommables';
  return 'Autres';
}

const CAT_ORDER = ['Vrac', 'Matières premières', 'Conditionnement', 'Consommables', 'Autres'];

// Le lot Odoo est-il exprimé en boîtes ? (ex. « Box(es) of 3 », « Boite(s) de 2 »)
const uomIsBox = (uom?: string) => /bo[iî]te|box/i.test(uom || '');
// Nb d'unités par boîte, tiré du libellé d'UoM (« Box(es) of 3 » → 3), sinon null.
const boxSizeOf = (uom?: string) => { const m = /(\d+)/.exec(uom || ''); return m ? parseInt(m[1], 10) : null; };

export function NomenclatureView() {
  const { token } = useAuth();
  const auth = { headers: { Authorization: `Bearer ${token}` } };

  const [products, setProducts] = useState<BomProduct[] | null>(null);
  const [prodError, setProdError] = useState('');
  const [tmpl, setTmpl] = useState('');

  const [tree, setTree] = useState<{ product: BomProduct; boms: BomTree[] } | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeError, setTreeError] = useState('');
  const [bomIdx, setBomIdx] = useState(0);
  const [desired, setDesired] = useState('');
  const [mode, setMode] = useState<'box' | 'unit'>('box');
  const [openVrac, setOpenVrac] = useState<Set<number>>(new Set());

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API_URL}/api/odoo/bom-products`, auth);
        if (!r.ok) { const e = await r.json().catch(() => ({})); setProdError(e.error || 'Erreur de chargement.'); setProducts([]); return; }
        const d = await r.json();
        setProducts(d.products || []);
      } catch { setProdError('Erreur de chargement.'); setProducts([]); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const loadTree = useCallback(async (tmplId: string) => {
    if (!tmplId) { setTree(null); return; }
    setTreeLoading(true); setTreeError('');
    try {
      const r = await fetch(`${API_URL}/api/odoo/bom-tree?tmpl=${encodeURIComponent(tmplId)}`, auth);
      if (!r.ok) { const e = await r.json().catch(() => ({})); setTreeError(e.error || 'Odoo indisponible.'); setTree(null); return; }
      const d = await r.json();
      setTree(d);
      setBomIdx(0);
      const b0: BomTree | undefined = d.boms && d.boms[0];
      setMode(uomIsBox(b0?.uom) ? 'box' : 'unit');
      setDesired(b0 ? String(b0.productQty) : '');
      setOpenVrac(new Set((b0 ? b0.lines : []).filter((l: BomLine) => l.child).map((l: BomLine) => l.seq)));
    } catch { setTreeError('Odoo indisponible.'); setTree(null); } finally { setTreeLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const selectProduct = (id: string) => { setTmpl(id); loadTree(id); };
  const selectBom = (idx: number) => {
    setBomIdx(idx);
    const b = tree?.boms[idx];
    setMode(uomIsBox(b?.uom) ? 'box' : 'unit');
    setDesired(b ? String(b.productQty) : '');
    setOpenVrac(new Set((b?.lines || []).filter(l => l.child).map(l => l.seq)));
  };

  const bom = tree && tree.boms.length ? tree.boms[Math.min(bomIdx, tree.boms.length - 1)] : null;
  const desiredNum = parseFloat(desired.replace(',', '.'));
  // Quantités de référence du lot, en boîtes ET en unités (conversion via la taille de boîte Odoo).
  const isBox = uomIsBox(bom?.uom);
  const boxSize = bom && isBox ? boxSizeOf(bom.uom) : null;
  const batchBoxes = bom ? (isBox ? bom.productQty : null) : null;
  const batchUnits = bom ? (isBox ? (boxSize ? bom.productQty * boxSize : null) : bom.productQty) : null;
  const boxAvailable = batchBoxes != null;
  const unitAvailable = batchUnits != null;
  const base = mode === 'box' ? batchBoxes : batchUnits;
  const factor = base && base > 0 && !isNaN(desiredNum) ? desiredNum / base : 1;
  const qtyLabel = mode === 'box' ? 'Nombre de boîtes' : "Nombre d'unités";

  const changeMode = (m: 'box' | 'unit') => {
    setMode(m);
    const nb = m === 'box' ? batchBoxes : batchUnits;
    setDesired(nb != null ? String(nb) : '');
  };

  const bomLabel = (b: BomTree) => b.code || b.uom || `BOM ${b.id}`;

  const LineTable = ({ lines }: { lines: BomLine[] }) => (
    <table className="w-full text-sm">
      <thead>
        <tr className="bg-slate-50 text-left text-[11px] uppercase text-slate-500">
          <th className="px-4 py-2">Code</th>
          <th className="px-4 py-2">Désignation</th>
          <th className="px-4 py-2 text-right">Qté Odoo</th>
          <th className="px-4 py-2">Unité</th>
          <th className="px-4 py-2 text-right">Qté calculée</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {lines.map((l, i) => (
          <tr key={i} className="hover:bg-slate-50">
            <td className="px-4 py-2 font-mono text-xs text-slate-600">{l.code || '—'}</td>
            <td className="px-4 py-2 text-slate-800">{l.name}</td>
            <td className="px-4 py-2 text-right text-slate-400 tabular-nums text-xs">{fmtQty(l.qty)}</td>
            <td className="px-4 py-2 text-xs text-slate-500">{l.uom}</td>
            <td className="px-4 py-2 text-right font-semibold text-slate-800 tabular-nums">{fmtQty(l.qty * factor)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  // Groupes du degré 1 par catégorie
  const groups: Record<string, BomLine[]> = {};
  for (const l of bom?.lines || []) (groups[catOf(l)] ||= []).push(l);

  // Export Excel de la nomenclature affichée (avec les quantités recalculées).
  const exportExcel = () => {
    if (!bom || !tree) return;
    const arrondi = (n: number) => Math.round(n * 10000) / 10000;
    const qteDemandee = !isNaN(desiredNum) ? desiredNum : bom.productQty;
    const rows: any[][] = [
      ['Nomenclature Odoo'],
      ['Produit', `${tree.product.code} — ${tree.product.name}`],
      ['Nomenclature', bomLabel(bom)],
      ['Lot de référence Odoo', bom.productQty, bom.uom],
      ['Quantité demandée', qteDemandee, mode === 'box' ? 'boîtes' : 'unités'],
      ['Exporté le', new Date().toLocaleString('fr-FR')],
      [],
      ['Catégorie', 'Code', 'Désignation', 'Qté Odoo', 'Unité', 'Qté calculée'],
    ];
    CAT_ORDER.filter(cat => groups[cat]?.length).forEach(cat => {
      groups[cat].forEach(l => {
        rows.push([cat, l.code || '', l.name, arrondi(l.qty), l.uom, arrondi(l.qty * factor)]);
        // Détail de la formule matières sous chaque vrac : les quantités suivent le vrac recalculé.
        if (l.child) {
          const fEnfant = l.child.productQty > 0 ? (l.qty * factor) / l.child.productQty : 0;
          l.child.lines.forEach(c => {
            rows.push([`${cat} ▸ ${l.name}`, c.code || '', c.name, arrondi(c.qty), c.uom, arrondi(c.qty * fEnfant)]);
          });
        }
      });
    });
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 32 }, { wch: 16 }, { wch: 48 }, { wch: 12 }, { wch: 14 }, { wch: 14 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Nomenclature');
    const nom = `Nomenclature_${tree.product.code}_${qteDemandee}${mode === 'box' ? 'boites' : 'unites'}`.replace(/[^\w.-]+/g, '_');
    XLSX.writeFile(wb, `${nom}.xlsx`);
  };

  return (
    <div className="space-y-6">
      {/* Sélection produit + taille + quantité */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Produit fini</label>
            {products === null ? (
              <div className="text-sm text-slate-400 py-2"><Loader2 className="w-4 h-4 animate-spin inline mr-1" /> Chargement des produits…</div>
            ) : (
              <select value={tmpl} onChange={e => selectProduct(e.target.value)}
                className="text-sm border border-slate-300 rounded-md px-3 py-2 bg-white outline-none focus:border-blue-500 min-w-[280px]">
                <option value="">— Choisir un produit —</option>
                {products.map(p => <option key={p.tmplId} value={p.tmplId}>{p.code} — {p.name}</option>)}
              </select>
            )}
          </div>
          {tree && tree.boms.length > 1 && (
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Taille / nomenclature</label>
              <select value={bomIdx} onChange={e => selectBom(Number(e.target.value))}
                className="text-sm border border-slate-300 rounded-md px-3 py-2 bg-white outline-none focus:border-blue-500">
                {tree.boms.map((b, i) => <option key={b.id} value={i}>{bomLabel(b)}</option>)}
              </select>
            </div>
          )}
          {bom && (
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">{qtyLabel}</label>
              <div className="flex items-center gap-2">
                <div className="inline-flex rounded-md border border-slate-300 overflow-hidden">
                  <button onClick={() => changeMode('box')} disabled={!boxAvailable}
                    className={cn('px-2.5 py-2 text-xs font-medium transition-colors', mode === 'box' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50', !boxAvailable && 'opacity-40 cursor-not-allowed')}>Boîtes</button>
                  <button onClick={() => changeMode('unit')} disabled={!unitAvailable}
                    className={cn('px-2.5 py-2 text-xs font-medium border-l border-slate-300 transition-colors', mode === 'unit' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50', !unitAvailable && 'opacity-40 cursor-not-allowed')}>Unités</button>
                </div>
                <input type="number" min="0" value={desired} onChange={e => setDesired(e.target.value)}
                  className="text-sm border border-slate-300 rounded-md px-3 py-2 w-32 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 tabular-nums" />
                <button onClick={() => setDesired(base != null ? String(base) : '')} className="text-xs text-slate-500 hover:text-blue-600 underline">Réinitialiser</button>
              </div>
            </div>
          )}
          {tmpl && (
            <div className="ml-auto flex items-center gap-2">
              {bom && (
                <button onClick={exportExcel} className="inline-flex items-center gap-1.5 px-3 py-2 border border-slate-300 bg-white rounded-lg text-sm font-medium hover:bg-slate-50">
                  <Download className="w-4 h-4" /> Exporter Excel
                </button>
              )}
              <button onClick={() => loadTree(tmpl)} className="inline-flex items-center gap-1.5 px-3 py-2 border border-slate-300 bg-white rounded-lg text-sm font-medium hover:bg-slate-50">
                <RefreshCw className={cn('w-4 h-4', treeLoading && 'animate-spin')} /> Rafraîchir
              </button>
            </div>
          )}
        </div>
        {prodError && <div className="text-sm text-red-600">{prodError}</div>}
        <div className="text-xs text-slate-400">Données lues en direct depuis Odoo (Fabrication ▸ Nomenclatures).</div>
      </div>

      {treeLoading && <div className="p-4 sm:p-6 lg:p-8 flex items-center justify-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Lecture des nomenclatures Odoo…</div>}
      {treeError && !treeLoading && <div className="bg-white border border-red-200 rounded-xl p-5 shadow-sm text-sm text-red-600">{treeError}</div>}
      {tree && !treeLoading && !treeError && tree.boms.length === 0 && (
        <div className="bg-white border border-amber-200 rounded-xl p-5 shadow-sm text-sm text-slate-500">Ce produit n'a pas de nomenclature dans Odoo.</div>
      )}

      {bom && !treeLoading && !treeError && (
        <>
          {/* Bandeau produit */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-wrap items-center gap-x-6 gap-y-2">
            <div className="flex items-center gap-3">
              <FlaskConical className="w-6 h-6 text-blue-600" />
              <div>
                <div className="font-semibold text-slate-800">{tree!.product.code} — {tree!.product.name}</div>
                <div className="text-xs text-slate-500">Lot de référence Odoo : {fmtQty(bom.productQty)} {bom.uom}{bom.code ? ` · ${bom.code}` : ''}</div>
              </div>
            </div>
          </div>

          {/* Sections par catégorie */}
          {CAT_ORDER.filter(cat => groups[cat]?.length).map(cat => (
            <div key={cat} className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
              <div className="p-4 border-b border-slate-100 flex items-center gap-2">
                <span className="font-semibold text-slate-800">{cat}</span>
                <span className="text-xs text-slate-400">{groups[cat].length} ligne(s)</span>
              </div>
              {cat === 'Vrac' ? (
                <div className="divide-y divide-slate-100">
                  {groups[cat].map(l => {
                    const open = openVrac.has(l.seq);
                    return (
                      <div key={l.seq}>
                        <button onClick={() => setOpenVrac(s => { const n = new Set(s); n.has(l.seq) ? n.delete(l.seq) : n.add(l.seq); return n; })}
                          className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors text-left">
                          <span className="text-sm">
                            <span className="font-mono text-xs text-slate-500 mr-2">{l.code || '—'}</span>
                            <span className="font-medium text-slate-800">{l.name}</span>
                          </span>
                          <span className="flex items-center gap-4">
                            <span className="text-xs text-slate-400 tabular-nums">Qté Odoo : {fmtQty(l.qty)} {l.uom}</span>
                            <span className="text-sm font-semibold text-slate-800 tabular-nums">Qté calculée : {fmtQty(l.qty * factor)} {l.uom}</span>
                            {open ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                          </span>
                        </button>
                        {open && l.child && (
                          <div className="border-t border-slate-100 bg-slate-50/50">
                            <div className="px-4 pt-3 text-[11px] uppercase text-slate-400">
                              Formule matières · lot PSO de {fmtQty(l.child.productQty)} {l.child.uom}{l.child.code ? ` · ${l.child.code}` : ''}
                            </div>
                            <LineTable lines={l.child.lines} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <LineTable lines={groups[cat]} />
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
