import React, { useState } from 'react';
import { Plus, Pencil, Trash2, ArrowRightCircle, X, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { useAppContext } from '../AppContext';
import { useAuth } from '../AuthContext';
import { FORECAST_STATUSES, formatDate } from '../constants';
import { Forecast, ForecastStatus } from '../types';

interface ForecastsViewProps {
  onOpenBatch: (id: string) => void;
}

interface FormState {
  productType: string;
  product: string;
  reference: string;
  client: string;
  plannedQuantity: number;
  targetStart: string;
  targetEnd: string;
  status: ForecastStatus;
  notes: string;
}

const EMPTY_FORM: FormState = {
  productType: '',
  product: '',
  reference: '',
  client: '',
  plannedQuantity: 0,
  targetStart: '',
  targetEnd: '',
  status: 'EN_DISCUSSION',
  notes: ''
};

function statusMeta(status: string) {
  return FORECAST_STATUSES.find(s => s.value === status) || FORECAST_STATUSES[0];
}

type SortField = 'productType' | 'client' | 'plannedQuantity' | 'targetStart' | 'targetEnd' | 'status';

export function ForecastsView({ onOpenBatch }: ForecastsViewProps) {
  const { forecasts, batches, productCatalog, clients, createForecast, updateForecast, deleteForecast, convertForecast } = useAppContext();
  const { canEdit, isAdmin } = useAuth();

  const [editingId, setEditingId] = useState<string | null>(null); // id ou 'NEW'
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  // Boîte de dialogue de conversion en lot
  const [convertTarget, setConvertTarget] = useState<Forecast | null>(null);
  const [lotNumber, setLotNumber] = useState('');
  const [convertError, setConvertError] = useState('');

  // Tri par colonne
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortField(field); setSortDir('asc'); }
  };

  const sortedForecasts = React.useMemo(() => {
    if (!sortField) return forecasts;
    return [...forecasts].sort((a, b) => {
      let av: number | string;
      let bv: number | string;
      if (sortField === 'plannedQuantity') {
        av = a.plannedQuantity || 0; bv = b.plannedQuantity || 0;
      } else if (sortField === 'status') {
        av = FORECAST_STATUSES.findIndex(s => s.value === a.status);
        bv = FORECAST_STATUSES.findIndex(s => s.value === b.status);
      } else {
        av = (a[sortField] || '') as string; bv = (b[sortField] || '') as string;
      }
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDir === 'asc' ? av - bv : bv - av;
      }
      const as = String(av).toLowerCase();
      const bs = String(bv).toLowerCase();
      if (!as && bs) return 1;   // valeurs vides toujours en fin
      if (as && !bs) return -1;
      return sortDir === 'asc' ? as.localeCompare(bs) : bs.localeCompare(as);
    });
  }, [forecasts, sortField, sortDir]);

  // Fonction de rendu (et non composant interne) pour éviter tout remontage des en-têtes à chaque render.
  const renderSortHeader = (field: SortField, label: string, className?: string) => (
    <th className={`px-4 py-3 ${className || ''}`}>
      <button
        onClick={() => toggleSort(field)}
        className="inline-flex items-center gap-1 uppercase hover:text-slate-700 transition-colors"
      >
        {label}
        {sortField === field
          ? (sortDir === 'asc' ? <ChevronUp className="w-3 h-3 text-blue-600" /> : <ChevronDown className="w-3 h-3 text-blue-600" />)
          : <ChevronsUpDown className="w-3 h-3 text-slate-300" />}
      </button>
    </th>
  );

  const openNew = () => {
    setForm(EMPTY_FORM);
    setEditingId('NEW');
  };

  const openEdit = (f: Forecast) => {
    setForm({
      productType: f.productType || '',
      product: f.product || '',
      reference: f.reference || '',
      client: f.client || '',
      plannedQuantity: f.plannedQuantity || 0,
      targetStart: f.targetStart || '',
      targetEnd: f.targetEnd || '',
      // CONVERTI est un état système : un forecast édité repart d'un statut choisissable
      status: f.status === 'CONVERTI' ? 'EN_DISCUSSION' : (f.status || 'EN_DISCUSSION'),
      notes: f.notes || ''
    });
    setEditingId(f.id);
  };

  const cancel = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const onSelectType = (type: string) => {
    const entry = productCatalog.find(p => p.type === type);
    setForm(prev => ({
      ...prev,
      productType: type,
      product: entry ? entry.name : prev.product,
      reference: entry ? entry.ref : prev.reference
    }));
  };

  const save = async () => {
    const payload = { ...form, plannedQuantity: Number(form.plannedQuantity) || 0 };
    const ok = editingId === 'NEW'
      ? await createForecast(payload)
      : await updateForecast(editingId as string, payload);
    if (ok) cancel();
  };

  const openConvert = (f: Forecast) => {
    setConvertTarget(f);
    setLotNumber('');
    setConvertError('');
  };

  const confirmConvert = async () => {
    if (!convertTarget) return;
    const lot = lotNumber.trim();
    if (!lot) {
      setConvertError('Le numéro de lot est obligatoire.');
      return;
    }
    if (batches.some(b => (b.id || '').toLowerCase() === lot.toLowerCase())) {
      setConvertError(`Le lot « ${lot} » existe déjà.`);
      return;
    }
    const ok = await convertForecast(convertTarget.id, lot);
    if (ok) {
      setConvertTarget(null);
      onOpenBatch(lot); // ouvre directement la fiche du lot créé
    } else {
      setConvertError('La conversion a échoué. Vérifie le numéro de lot.');
    }
  };

  const handleDelete = async (f: Forecast) => {
    if (window.confirm(`Supprimer le forecast « ${f.product || f.productType} » ?`)) {
      await deleteForecast(f.id);
    }
  };

  return (
    <div className="p-8 flex-1 overflow-y-auto bg-slate-50">
      <div className="flex flex-wrap justify-between items-center gap-3 mb-6">
        <h3 className="text-lg font-semibold text-slate-800">Forecasts</h3>
        {canEdit && (
          <button
            onClick={openNew}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" /> Ajouter un forecast
          </button>
        )}
      </div>

      {editingId && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm mb-6">
          <div className="flex items-center justify-between mb-4">
            <h4 className="font-semibold text-slate-800">
              {editingId === 'NEW' ? 'Nouveau forecast' : 'Modifier le forecast'}
            </h4>
            <button onClick={cancel} className="text-slate-400 hover:text-slate-600">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Type de produit</label>
              <select
                value={form.productType}
                onChange={e => onSelectType(e.target.value)}
                className="w-full px-2 py-2 text-sm border border-slate-300 rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none bg-white"
              >
                <option value="">— Sélectionner —</option>
                {productCatalog.map(p => (
                  <option key={p.type} value={p.type}>{p.type}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Produit</label>
              <input
                type="text"
                value={form.product}
                onChange={e => setForm({ ...form, product: e.target.value })}
                className="w-full px-2 py-2 text-sm border border-slate-300 rounded-md bg-slate-50 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Référence</label>
              <input
                type="text"
                value={form.reference}
                onChange={e => setForm({ ...form, reference: e.target.value })}
                className="w-full px-2 py-2 text-sm border border-slate-300 rounded-md bg-slate-50 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Client</label>
              <input
                type="text"
                list="forecast-clients"
                value={form.client}
                onChange={e => setForm({ ...form, client: e.target.value })}
                className="w-full px-2 py-2 text-sm border border-slate-300 rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              />
              <datalist id="forecast-clients">
                {clients.map(c => <option key={c} value={c} />)}
              </datalist>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Quantité prévue (boîtes)</label>
              <input
                type="number"
                min={0}
                value={form.plannedQuantity}
                onChange={e => setForm({ ...form, plannedQuantity: Number(e.target.value) })}
                className="w-full px-2 py-2 text-sm border border-slate-300 rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Statut</label>
              <select
                value={form.status}
                onChange={e => setForm({ ...form, status: e.target.value as ForecastStatus })}
                className="w-full px-2 py-2 text-sm border border-slate-300 rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none bg-white"
              >
                {FORECAST_STATUSES.filter(s => s.value !== 'CONVERTI').map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Début cible</label>
              <input
                type="date"
                value={form.targetStart}
                onChange={e => setForm({ ...form, targetStart: e.target.value })}
                className="w-full px-2 py-2 text-sm border border-slate-300 rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Fin cible</label>
              <input
                type="date"
                value={form.targetEnd}
                onChange={e => setForm({ ...form, targetEnd: e.target.value })}
                className="w-full px-2 py-2 text-sm border border-slate-300 rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              />
            </div>
            <div className="md:col-span-3">
              <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Notes</label>
              <textarea
                value={form.notes}
                onChange={e => setForm({ ...form, notes: e.target.value })}
                rows={2}
                className="w-full px-2 py-2 text-sm border border-slate-300 rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button
              onClick={cancel}
              className="px-4 py-2 text-sm font-medium text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Annuler
            </button>
            <button
              onClick={save}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
            >
              Enregistrer
            </button>
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-left text-[11px] font-semibold text-slate-500 uppercase">
              {renderSortHeader('productType', 'Type de produit')}
              {renderSortHeader('client', 'Client')}
              {renderSortHeader('plannedQuantity', 'Quantité prévue')}
              {renderSortHeader('targetStart', 'Début cible')}
              {renderSortHeader('targetEnd', 'Fin cible')}
              {renderSortHeader('status', 'Statut')}
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {forecasts.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                  Aucun forecast pour le moment.
                </td>
              </tr>
            )}
            {sortedForecasts.map(f => {
              const meta = statusMeta(f.status);
              // Converti = état système posé par l'action Convertir (un vrai lot existe)
              const converted = f.status === 'CONVERTI' && !!f.convertedBatchId;
              return (
                <tr key={f.id} className={converted ? 'bg-slate-50/60' : 'hover:bg-slate-50'}>
                  <td className="px-4 py-3">
                    <div className={`font-medium ${converted ? 'text-slate-400' : 'text-slate-800'}`}>{f.productType || '—'}</div>
                    {f.product && (
                      <div className="text-xs text-slate-400">{f.product}
                        {f.reference && <span className="ml-1 text-[10px] bg-slate-100 text-slate-400 px-1.5 py-0.5 rounded font-mono">{f.reference}</span>}
                      </div>
                    )}
                  </td>
                  <td className={`px-4 py-3 ${converted ? 'text-slate-400' : 'text-slate-700'}`}>{f.client || '—'}</td>
                  <td className={`px-4 py-3 ${converted ? 'text-slate-400' : 'text-slate-700'}`}>{f.plannedQuantity || 0}</td>
                  <td className={`px-4 py-3 ${converted ? 'text-slate-400' : 'text-slate-700'}`}>{formatDate(f.targetStart, '—')}</td>
                  <td className={`px-4 py-3 ${converted ? 'text-slate-400' : 'text-slate-700'}`}>{formatDate(f.targetEnd, '—')}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block text-xs font-medium px-2 py-1 rounded-full border ${meta.color}`}>
                      {meta.label}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      {converted ? (
                        <button
                          onClick={() => onOpenBatch(f.convertedBatchId as string)}
                          className="text-blue-600 hover:underline font-mono text-xs"
                          title="Ouvrir la fiche du lot"
                        >
                          → {f.convertedBatchId}
                        </button>
                      ) : (
                        canEdit && (
                          <>
                            <button
                              onClick={() => openEdit(f)}
                              title="Éditer"
                              className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => openConvert(f)}
                              title="Convertir en lot"
                              className="p-1.5 text-slate-500 hover:text-green-600 hover:bg-green-50 rounded transition-colors"
                            >
                              <ArrowRightCircle className="w-4 h-4" />
                            </button>
                          </>
                        )
                      )}
                      {isAdmin && (
                        <button
                          onClick={() => handleDelete(f)}
                          title="Supprimer"
                          className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {convertTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setConvertTarget(null)}
        >
          <div
            className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-1">
              <h4 className="font-semibold text-slate-800">Convertir en lot</h4>
              <button onClick={() => setConvertTarget(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-slate-500 mb-4">
              {convertTarget.productType}{convertTarget.product ? ` — ${convertTarget.product}` : ''}
            </p>
            <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Numéro de lot</label>
            <input
              type="text"
              autoFocus
              value={lotNumber}
              onChange={e => { setLotNumber(e.target.value); setConvertError(''); }}
              onKeyDown={e => { if (e.key === 'Enter') confirmConvert(); }}
              placeholder="ex. DA105B"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            />
            {convertError && <p className="text-xs text-red-600 mt-2">{convertError}</p>}
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setConvertTarget(null)}
                className="px-4 py-2 text-sm font-medium text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={confirmConvert}
                className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors"
              >
                Convertir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
