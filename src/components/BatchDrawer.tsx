import React, { useState, useEffect } from 'react';
import { X, Info, TestTube2, Plus, Trash2 } from 'lucide-react';
import { useAppContext } from '../AppContext';
import { useAuth } from '../AuthContext';
import { Batch, Sample, FluxConfig } from '../types';
import { cn } from '../utils/cn';

interface BatchDrawerProps {
  batchId: string | null;
  onClose: () => void;
}

export function BatchDrawer({ batchId, onClose }: BatchDrawerProps) {
  const { 
    batches, fluxConfig, catalog, updateBatch, createBatch, createDelivery,
    clients, updateClients, statuses, updateStatuses, updateSettings
  } = useAppContext();
  const { isAdmin, canEdit } = useAuth();
  const [localBatch, setLocalBatch] = useState<Batch | null>(null);
  const [isNew, setIsNew] = useState(false);

  useEffect(() => {
    if (batchId) {
      if (batchId.startsWith('NEW')) {
        setIsNew(true);
        const today = new Date().toISOString().split('T')[0];
        setLocalBatch({
          id: batchId,
          fluxKey: 'Hydragel_A1',
          reference: '',
          client: '',
          product: '',
          stepIndex: 0,
          status: 'UPCOMING',
          progress: 0,
          startDate: today,
          endDate: today,
          notes: '',
          volume: 0,
          boxesTarget: 0,
          distributed: 0,
          conform: 0,
          sold: 0,
          palettes: 0,
          samples: [
            { type: 'Intertek-Biocharge', applicable: false, sent: false, sendDate: '', expectedDate: '' },
            { type: 'Intertek-EPC', applicable: false, sent: false, sendDate: '', expectedDate: '' },
            { type: 'Charles Rivers-Endotoxine', applicable: false, sent: false, sendDate: '', expectedDate: '' },
            { type: 'Interne', applicable: false, sent: false, sendDate: '', expectedDate: '' }
          ]
        });
      } else {
        setIsNew(false);
        const b = batches.find(x => x.id === batchId);
        if (b) setLocalBatch(JSON.parse(JSON.stringify(b)));
      }
    } else {
      setLocalBatch(null);
    }
  }, [batchId, batches]);

  if (!localBatch) return null;

  const flux = fluxConfig[localBatch.fluxKey];

  const handleChange = (field: keyof Batch, value: any) => {
    setLocalBatch(prev => prev ? { ...prev, [field]: value } : null);
  };

  const handleProductChange = (name: string) => {
    const product = catalog.find(p => p.name.toUpperCase() === name.toUpperCase());
    if (product) {
      setLocalBatch(prev => {
        if (!prev) return null;
        let newFluxKey = prev.fluxKey;
        const foundKey = Object.keys(fluxConfig).find(k => fluxConfig[k].name.includes(product.name.split(' ')[0]));
        if (foundKey) newFluxKey = foundKey;
        return { ...prev, product: name, reference: product.ref, fluxKey: newFluxKey };
      });
    } else {
      handleChange('product', name);
    }
  };

  const handleSampleChange = (index: number, field: keyof Sample, value: any) => {
    setLocalBatch(prev => {
      if (!prev) return null;
      const newSamples = [...prev.samples];
      newSamples[index] = { ...newSamples[index], [field]: value };
      
      if (field === 'applicable' && !value) {
        newSamples[index].sent = false;
        newSamples[index].sendDate = '';
      }

      // Recalculate dates
      if (field === 'applicable' || field === 'sendDate') {
        const startDateStr = prev.startDate;
        if (startDateStr) {
          const startDate = new Date(startDateStr);
          newSamples.forEach(s => {
            if (s.applicable) {
              let daysToAdd = 0;
              if (s.type.includes('Biocharge')) daysToAdd = 7;
              else if (s.type.includes('EPC') || s.type.includes('Endotoxine')) daysToAdd = 21;
              
              if (daysToAdd > 0) {
                const expDate = new Date(startDate);
                expDate.setDate(expDate.getDate() + daysToAdd);
                s.expectedDate = expDate.toISOString().split('T')[0];
              }
            } else {
              s.expectedDate = '';
            }
          });
        }
      }
      return { ...prev, samples: newSamples };
    });
  };

  const handleAddClient = async () => {
    const newClient = prompt("Saisissez le nom du nouveau client :");
    if (newClient && newClient.trim()) {
      const trimmed = newClient.trim().toUpperCase();
      if (clients.includes(trimmed)) {
        alert("Ce client existe déjà !");
        return;
      }
      const success = await updateClients([...clients, trimmed]);
      if (success) {
        handleChange('client', trimmed);
      } else {
        alert("Erreur lors de l'ajout du client.");
      }
    }
  };

  const handleAddStep = async () => {
    const newStep = prompt("Saisissez le nom de la nouvelle étape :");
    if (newStep && newStep.trim() && localBatch.fluxKey) {
      const trimmed = newStep.trim();
      const currentFlux = fluxConfig[localBatch.fluxKey];
      if (!currentFlux) return;
      if (currentFlux.steps.includes(trimmed)) {
        alert("Cette étape existe déjà dans ce flux !");
        return;
      }
      const updatedConfig = {
        ...fluxConfig,
        [localBatch.fluxKey]: {
          ...currentFlux,
          steps: [...currentFlux.steps, trimmed],
          durations: {
            ...currentFlux.durations,
            [trimmed]: 1
          }
        }
      };
      const success = await updateSettings(updatedConfig);
      if (success) {
        handleChange('stepIndex', currentFlux.steps.length);
      } else {
        alert("Erreur lors de l'ajout de l'étape.");
      }
    }
  };

  const handleDeleteStep = async () => {
    if (!localBatch.fluxKey) return;
    const currentFlux = fluxConfig[localBatch.fluxKey];
    if (!currentFlux) return;
    if (currentFlux.steps.length <= 1) {
      alert("Impossible de supprimer la seule étape restante d'un flux.");
      return;
    }
    const stepToDelete = currentFlux.steps[localBatch.stepIndex];
    if (confirm(`Voulez-vous vraiment supprimer l'étape "${stepToDelete}" de ce flux ?`)) {
      const updatedSteps = currentFlux.steps.filter((_, idx) => idx !== localBatch.stepIndex);
      const updatedDurations = { ...currentFlux.durations };
      delete updatedDurations[stepToDelete];

      const updatedConfig = {
        ...fluxConfig,
        [localBatch.fluxKey]: {
          ...currentFlux,
          steps: updatedSteps,
          durations: updatedDurations
        }
      };
      const success = await updateSettings(updatedConfig);
      if (success) {
        const newIdx = Math.max(0, localBatch.stepIndex - 1);
        handleChange('stepIndex', newIdx);
      } else {
        alert("Erreur lors de la suppression de l'étape.");
      }
    }
  };

  const handleAddStatus = async () => {
    const newStatus = prompt("Saisissez le nom du nouveau statut global (ex: EN_ATTENTE) :");
    if (newStatus && newStatus.trim()) {
      const trimmed = newStatus.trim().toUpperCase().replace(/\s+/g, '_');
      if (statuses.includes(trimmed)) {
        alert("Ce statut existe déjà !");
        return;
      }
      const success = await updateStatuses([...statuses, trimmed]);
      if (success) {
        handleChange('status', trimmed);
      } else {
        alert("Erreur lors de l'ajout du statut.");
      }
    }
  };

  const handleDeleteStatus = async () => {
    if (statuses.length <= 1) {
      alert("Impossible de supprimer le seul statut restant.");
      return;
    }
    const statusToDelete = localBatch.status;
    if (confirm(`Voulez-vous vraiment supprimer le statut "${statusToDelete}" ?`)) {
      const updatedStatuses = statuses.filter(s => s !== statusToDelete);
      const success = await updateStatuses(updatedStatuses);
      if (success) {
        handleChange('status', updatedStatuses[0]);
      } else {
        alert("Erreur lors de la suppression du statut.");
      }
    }
  };

  const handleSave = async () => {
    try {
      const stepsLength = flux?.steps?.length || 1;
      const progress = Math.round(((localBatch.stepIndex + 1) / stepsLength) * 100);

      if (isNew) {
        if (localBatch.id.startsWith('NEW')) {
          alert("Veuillez renommer le lot avant de sauvegarder.");
          return;
        }
        
        const success = await createBatch({ ...localBatch, progress });
        if (!success) {
          alert("Erreur lors de la création du lot. Veuillez vérifier si l'identifiant de lot n'existe pas déjà ou si vos droits d'accès sont suffisants.");
          return;
        }
        
        if (localBatch.deliveryDate) {
          await createDelivery({
            batchId: localBatch.id,
            client: localBatch.client || 'N/A',
            date: localBatch.deliveryDate,
            boxesSold: localBatch.boxesTarget || 0,
            palettes: localBatch.palettes || 0,
            status: 'PLANIFIÉ'
          });
        }
      } else {
        const success = await updateBatch(batchId!, { ...localBatch, progress });
        if (!success) {
          alert("Erreur lors de la modification du lot. Veuillez vérifier vos droits d'accès.");
          return;
        }
      }
      onClose();
    } catch (err) {
      console.error(err);
      alert("Une erreur inattendue est survenue lors de l'enregistrement.");
    }
  };

  return (
    <>
      <div 
        className="fixed inset-0 bg-black/30 z-40 transition-opacity"
        onClick={onClose}
      />
      <aside className="fixed top-0 right-0 w-[700px] h-full bg-white shadow-2xl z-50 flex flex-col transform transition-transform duration-300 ease-out translate-x-0">
        <div className="p-6 border-b border-slate-200 flex justify-between items-start bg-slate-50">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">{localBatch.id}</h2>
            <span className="text-sm text-slate-500">Détails Lot</span>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-full transition-colors">
            <X className="w-6 h-6 text-slate-500" />
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-8">
          {/* SECTION 1: IDENTIFICATION */}
          <div className="mb-8">
            <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-4 border-b-2 border-slate-200 pb-2">Identification & Dates</h3>
            <div className="grid grid-cols-2 gap-4">
              <FormGroup label="Numéro de Lot">
                <input 
                  type="text" 
                  value={localBatch.id} 
                  onChange={e => handleChange('id', e.target.value)} 
                  className="form-input" 
                />
              </FormGroup>
              <FormGroup label="Type de Produit">
                <select value={localBatch.fluxKey} onChange={e => handleChange('fluxKey', e.target.value)} className="form-input">
                  {Object.entries(fluxConfig).map(([k, v]: [string, FluxConfig]) => (
                    <option key={k} value={k}>{v.name}</option>
                  ))}
                </select>
              </FormGroup>
              <FormGroup label="Client">
                <div className="flex gap-2">
                  <select 
                    value={localBatch.client} 
                    onChange={e => handleChange('client', e.target.value)} 
                    className="form-input flex-1"
                  >
                    <option value="">-- Sélectionner un client --</option>
                    {Array.from(new Set([...clients, localBatch.client || ''])).filter(Boolean).map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  {isAdmin && (
                    <button 
                      type="button" 
                      onClick={handleAddClient} 
                      className="px-3 py-2 bg-blue-50 border border-blue-200 text-blue-600 rounded-md hover:bg-blue-100 transition-colors flex items-center justify-center shrink-0"
                      title="Ajouter un nouveau client"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </FormGroup>
              <FormGroup label="Nom Produit (Auto)">
                <input 
                  type="text" 
                  list="product-list" 
                  value={localBatch.product} 
                  onChange={e => handleProductChange(e.target.value)} 
                  placeholder="Tapez ou choisissez..." 
                  className="form-input" 
                />
                <datalist id="product-list">
                  {catalog.map(p => <option key={p.ref} value={p.name} />)}
                </datalist>
              </FormGroup>
              <FormGroup label="Référence">
                <input type="text" value={localBatch.reference} onChange={e => handleChange('reference', e.target.value)} placeholder="S'auto-remplit" className="form-input bg-slate-50" />
              </FormGroup>
              <FormGroup label="Début Fabrication">
                <input type="date" value={localBatch.startDate} onChange={e => handleChange('startDate', e.target.value)} className="form-input" />
              </FormGroup>
              <FormGroup label="Fin Fabrication">
                <input type="date" value={localBatch.endDate} onChange={e => handleChange('endDate', e.target.value)} className="form-input" />
              </FormGroup>
              <FormGroup label="Date Livraison Souhaitée">
                <input type="date" value={localBatch.deliveryDate || ''} onChange={e => handleChange('deliveryDate', e.target.value)} className="form-input" />
              </FormGroup>
            </div>
          </div>

          {/* SECTION 2: FLUX VISUALISATION */}
          <div className="mb-8">
            {isNew ? (
              <>
                <div className="text-sm text-slate-500 mb-4">
                  Veuillez définir l'état d'avancement initial pour ce nouveau lot. Une fois le lot créé, vous pourrez visualiser l'avancement visuel ici.
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <FormGroup label="Étape Actuelle">
                    <select value={localBatch.stepIndex} onChange={e => handleChange('stepIndex', parseInt(e.target.value))} className="form-input">
                      {flux?.steps.map((s, i) => (
                        <option key={i} value={i}>{s === '-' ? '- (Nettoyage)' : s}</option>
                      ))}
                    </select>
                  </FormGroup>
                  <FormGroup label="Statut Global">
                    <div className="flex gap-2">
                      <select 
                        value={localBatch.status} 
                        onChange={e => handleChange('status', e.target.value)} 
                        className="form-input flex-1"
                      >
                        {Array.from(new Set([...statuses, localBatch.status])).filter(Boolean).map(s => (
                          <option key={s} value={s}>
                            {s === 'UPCOMING' ? 'À VENIR' : s === 'ON_TRACK' ? 'ON TRACK' : s === 'AT_RISK' ? 'AT RISK' : s === 'COMPLETED' ? 'TERMINÉ' : s}
                          </option>
                        ))}
                      </select>
                      {isAdmin && (
                        <div className="flex gap-1 shrink-0">
                          <button 
                            type="button" 
                            onClick={handleAddStatus} 
                            className="px-2 py-1 bg-blue-50 border border-blue-200 text-blue-600 rounded-md hover:bg-blue-100 transition-colors"
                            title="Ajouter un statut"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                          <button 
                            type="button" 
                            onClick={handleDeleteStatus} 
                            className="px-2 py-1 bg-red-50 border border-red-200 text-red-600 rounded-md hover:bg-red-100 transition-colors"
                            title="Supprimer le statut actuel"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  </FormGroup>
                </div>
                <div className="mt-6 p-4 border border-slate-200 rounded-lg bg-slate-50 flex gap-3 items-start">
                  <Info className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                  <div className="text-sm text-slate-600">
                    Une fois le lot créé, vous pourrez visualiser l'avancement visuel ici.
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-4 mb-6">
                  <FormGroup label="Étape Actuelle">
                    <div className="flex gap-2">
                      <select 
                        value={localBatch.stepIndex} 
                        onChange={e => handleChange('stepIndex', parseInt(e.target.value))} 
                        disabled={!canEdit}
                        className={cn("form-input flex-1", !canEdit && "bg-slate-50 cursor-not-allowed text-slate-500")}
                      >
                        {flux?.steps.map((s, i) => (
                          <option key={i} value={i}>{s === '-' ? '- (Nettoyage)' : s}</option>
                        ))}
                      </select>
                      {isAdmin && (
                        <div className="flex gap-1 shrink-0">
                          <button 
                            type="button" 
                            onClick={handleAddStep} 
                            className="px-2 py-1 bg-blue-50 border border-blue-200 text-blue-600 rounded-md hover:bg-blue-100 transition-colors"
                            title="Ajouter une étape à ce flux"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                          <button 
                            type="button" 
                            onClick={handleDeleteStep} 
                            className="px-2 py-1 bg-red-50 border border-red-200 text-red-600 rounded-md hover:bg-red-100 transition-colors"
                            title="Supprimer l'étape actuelle de ce flux"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  </FormGroup>
                  <FormGroup label="Statut Global">
                    <div className="flex gap-2">
                      <select 
                        value={localBatch.status} 
                        onChange={e => handleChange('status', e.target.value)} 
                        className="form-input flex-1"
                      >
                        {Array.from(new Set([...statuses, localBatch.status])).filter(Boolean).map(s => (
                          <option key={s} value={s}>
                            {s === 'UPCOMING' ? 'À VENIR' : s === 'ON_TRACK' ? 'ON TRACK' : s === 'AT_RISK' ? 'AT RISK' : s === 'COMPLETED' ? 'TERMINÉ' : s}
                          </option>
                        ))}
                      </select>
                      {isAdmin && (
                        <div className="flex gap-1 shrink-0">
                          <button 
                            type="button" 
                            onClick={handleAddStatus} 
                            className="px-2 py-1 bg-blue-50 border border-blue-200 text-blue-600 rounded-md hover:bg-blue-100 transition-colors"
                            title="Ajouter un statut"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                          <button 
                            type="button" 
                            onClick={handleDeleteStatus} 
                            className="px-2 py-1 bg-red-50 border border-red-200 text-red-600 rounded-md hover:bg-red-100 transition-colors"
                            title="Supprimer le statut actuel"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  </FormGroup>
                </div>
                <div className="relative flex justify-between mt-8 mb-4">
                  <div className="absolute top-3 left-0 right-0 h-0.5 bg-slate-200 z-0" />
                  {flux?.steps.map((step, idx) => {
                    const isCompleted = idx < localBatch.stepIndex;
                    const isActive = idx === localBatch.stepIndex;
                    return (
                      <div key={idx} className="relative z-10 text-center flex flex-col items-center w-16">
                        <div className={cn(
                          "w-6 h-6 rounded-full border-2 flex items-center justify-center text-[10px] font-bold transition-colors mb-2 bg-white",
                          isCompleted ? "border-green-500 bg-green-500 text-white" : 
                          isActive ? "border-blue-600 bg-blue-600 text-white" : 
                          "border-slate-300 text-slate-400"
                        )}>
                          {idx + 1}
                        </div>
                        <div className="text-[10px] text-slate-500 leading-tight">{step}</div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* SECTION 3: QUALITÉ */}
          <div className="mb-8">
            <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-2 border-b-2 border-slate-200 pb-2">Suivi Échantillons (Tests)</h3>
            <div className="text-xs text-slate-500 mb-4 flex items-center gap-1.5">
              <Info className="w-4 h-4" />
              Les dates de réception sont calculées automatiquement (Bio: +1sem, EPC/Endo: +3sem).
            </div>
            <div className="flex flex-col gap-3">
              {localBatch.samples.map((s, idx) => (
                <div key={idx} className="border border-slate-200 rounded-lg p-4 bg-white grid grid-cols-[2fr_1fr_1fr_1fr_1.5fr] gap-4 items-center">
                  <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                    <TestTube2 className="w-4 h-4 text-slate-400" />
                    {s.type}
                  </div>
                  <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                    <input type="checkbox" checked={s.applicable} onChange={e => handleSampleChange(idx, 'applicable', e.target.checked)} className="rounded text-blue-600 focus:ring-blue-500" />
                    Applicable
                  </label>
                  <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                    <input type="checkbox" checked={s.sent} disabled={!s.applicable} onChange={e => handleSampleChange(idx, 'sent', e.target.checked)} className="rounded text-blue-600 focus:ring-blue-500 disabled:opacity-50" />
                    Envoyé
                  </label>
                  <input 
                    type="date" 
                    value={s.sendDate} 
                    disabled={!s.applicable} 
                    onChange={e => handleSampleChange(idx, 'sendDate', e.target.value)}
                    className="px-2 py-1 text-xs border border-slate-300 rounded focus:border-blue-500 outline-none disabled:opacity-50 disabled:bg-slate-50"
                  />
                  <div className="text-xs text-blue-700 bg-blue-50 px-2 py-1 rounded text-center">
                    {s.applicable && s.expectedDate ? `Réception: ${s.expectedDate}` : 'N/A'}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* SECTION 4: DONNÉES PRODUCTION */}
          <div className="mb-8">
            <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-4 border-b-2 border-slate-200 pb-2">Données de Production</h3>
            <div className="grid grid-cols-2 gap-4">
              <FormGroup label="Volume Lot (L)">
                <input type="number" value={localBatch.volume} onChange={e => handleChange('volume', parseFloat(e.target.value) || 0)} className="form-input" />
              </FormGroup>
              <FormGroup label="Boites Attendues">
                <input type="number" value={localBatch.boxesTarget} onChange={e => handleChange('boxesTarget', parseFloat(e.target.value) || 0)} className="form-input" />
              </FormGroup>
              <FormGroup label="Quantité Répartie">
                <input type="number" value={localBatch.distributed} onChange={e => handleChange('distributed', parseFloat(e.target.value) || 0)} className="form-input" />
              </FormGroup>
              <FormGroup label="Miré Conforme">
                <input type="number" value={localBatch.conform} onChange={e => handleChange('conform', parseFloat(e.target.value) || 0)} className="form-input" />
              </FormGroup>
              <FormGroup label="Vendu (Boîtes)">
                <input type="number" value={localBatch.sold} onChange={e => handleChange('sold', parseFloat(e.target.value) || 0)} className="form-input" />
              </FormGroup>
              <FormGroup label="Palettes">
                <input type="number" value={localBatch.palettes} onChange={e => handleChange('palettes', parseFloat(e.target.value) || 0)} className="form-input" />
              </FormGroup>
            </div>
          </div>

          {/* NOTES */}
          <div className="mb-8">
            <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-4 border-b-2 border-slate-200 pb-2">Notes & Observations</h3>
            <textarea 
              rows={3} 
              value={localBatch.notes} 
              onChange={e => handleChange('notes', e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none resize-y"
            />
          </div>

        </div>
        
        <div className="p-6 border-t border-slate-200 bg-slate-50 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors">
            Annuler
          </button>
          <button onClick={handleSave} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors">
            Enregistrer
          </button>
        </div>
      </aside>
    </>
  );
}

function FormGroup({ label, children }: { label: string, children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-semibold text-slate-600">{label}</label>
      {children}
    </div>
  );
}
