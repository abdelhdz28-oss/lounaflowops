import React, { useState, useEffect } from 'react';
import { X, TestTube2, Plus, RotateCcw, AlertTriangle } from 'lucide-react';
import { useAppContext } from '../AppContext';
import { useAuth } from '../AuthContext';
import { Batch, Sample, FluxConfig, ProcessStage, QualityStatus, SampleStatus } from '../types';
import {
  PROCESS_STAGES, QUALITY_STATUSES, SCHEDULE_HEALTH, computeScheduleHealth,
  SAMPLE_TESTS, SAMPLE_STATUSES,
  computeSampleDates, computeTestsOk, sampleDateBadgeColor, isSampleTransitionAllowed,
  PRODUCTION_MILESTONES, computeMilestoneDates, milestoneStatus, MILESTONE_STATUS_COLOR,
  defaultMilestones, ProductionMilestoneStage
} from '../constants';
import { cn } from '../utils/cn';

// Étapes du mini-stepper de statut (ordonnées). CONFORME/NON_CONFORME = même rang (final).
const SAMPLE_STEPPER: { key: SampleStatus; label: string }[] = [
  { key: 'A_ENVOYER', label: 'À envoyer' },
  { key: 'ENVOYE', label: 'Envoyé' },
  { key: 'RESULTATS_RECUS', label: 'Résultats reçus' },
  { key: 'CONFORME', label: 'Conforme / Non conforme' }
];

function sampleStepperIndex(status: SampleStatus): number {
  if (status === 'NON_CONFORME') return 3;
  const i = SAMPLE_STEPPER.findIndex(s => s.key === status);
  return i < 0 ? 0 : i;
}

// Dérive la clé de flux à partir du type produit catalogue (comparaison en MAJUSCULES).
// Si la clé dérivée n'existe pas dans fluxConfig, retourne null (fallback : garder le fluxKey courant).
function fluxKeyForType(type: string, fluxConfig: Record<string, FluxConfig>): string | null {
  const t = (type || '').toUpperCase();
  let key: string;
  if (t.includes('HYDRAGEL A2 SYRINGE') || t.includes('A2 SERINGUE')) key = 'Hydragel_A2_Seringue';
  else if (t.includes('HYDRAGEL A1')) key = 'Hydragel_A1';
  else if (t.includes('HYDRAGEL A2')) key = 'Hydragel_A2';
  else if (t.includes('HYDRAGEL A3')) key = 'Hydragel_A3';
  else if (t.includes('LOUNA FILLERS')) key = 'HAR_Louna';
  else if (t.includes('ESSENTYAL')) key = 'HAR_Essentyal';
  else key = 'Hydroxyal';
  return fluxConfig[key] ? key : null;
}

// Hint « prochaine action » selon l'étape courante.
function nextActionHint(s: Sample): string {
  switch (s.status) {
    case 'A_ENVOYER': return "→ Saisir la date d'envoi, puis passer à « Envoyé »";
    case 'ENVOYE': return '→ À réception, saisir la date de réception des résultats et passer à « Résultats reçus »';
    case 'RESULTATS_RECUS': return '→ Statuer : « Conforme » ou « Non conforme »';
    case 'NON_CONFORME': return '→ Saisir le motif ; vous pouvez relancer un prélèvement';
    case 'CONFORME': return '✓ Test conforme';
    default: return '';
  }
}

interface BatchDrawerProps {
  batchId: string | null;
  onClose: () => void;
}

export function BatchDrawer({ batchId, onClose }: BatchDrawerProps) {
  const {
    batches, fluxConfig, sampleConfig, catalog, productCatalog, updateBatch, createBatch, createDelivery,
    clients, updateClients, samplePartners
  } = useAppContext();
  const { isAdmin, canEdit } = useAuth();
  const [localBatch, setLocalBatch] = useState<Batch | null>(null);
  const [isNew, setIsNew] = useState(false);

  useEffect(() => {
    if (batchId) {
      const defaultFluxKey = Object.keys(fluxConfig)[0] || 'Hydragel_A1';
      if (batchId.startsWith('NEW')) {
        setIsNew(true);
        const today = new Date().toISOString().split('T')[0];
        setLocalBatch({
          id: batchId,
          fluxKey: defaultFluxKey,
          reference: '',
          client: '',
          product: '',
          stepIndex: 0,
          status: 'UPCOMING',
          process_stage: 'PLANIFIE',
          quality_status: 'NOT_STARTED',
          schedule_health: 'ON_TRACK',
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
          samples: SAMPLE_TESTS.map(t => ({
            type: t.key,
            partner: t.defaultPartner,
            applicable: true,
            status: 'A_ENVOYER' as SampleStatus,
            dateEnvoi: '',
            dateReceptionEchantillon: '',
            dateResultatsAttendue: '',
            configError: false,
            datePrelevementReel: '',
            dateResultatsRecus: '',
            rapportRef: '',
            rapportUrl: '',
            motifNonConforme: '',
            history: []
          })),
          milestones: defaultMilestones()
        });
      } else {
        setIsNew(false);
        const b = batches.find(x => x.id === batchId);
        if (b) {
          const cloned = JSON.parse(JSON.stringify(b));
          if (!cloned.fluxKey || !fluxConfig[cloned.fluxKey]) {
            cloned.fluxKey = defaultFluxKey;
          }
          setLocalBatch(cloned);
        }
      }
    } else {
      setLocalBatch(null);
    }
  }, [batchId, batches, fluxConfig]);

  if (!localBatch) return null;

  // Entrée catalogue du lot : match par référence (lots existants), sinon par type/nom sélectionné.
  const catalogEntry =
    productCatalog.find(p => p.ref === localBatch.reference) ||
    productCatalog.find(p => p.name === localBatch.product) ||
    null;
  // Type catalogue courant (pour le sélecteur) : dérivé de l'entrée matchée.
  const selectedCatalogType = catalogEntry?.type || '';

  const handleChange = (field: keyof Batch, value: any) => {
    setLocalBatch(prev => {
      if (!prev) return null;
      let updated = { ...prev, [field]: value };
      if (field === 'process_stage') {
        // Auto-lien : un lot planifié n'est pas démarré → statut qualité « Non démarré ».
        if (value === 'PLANIFIE') {
          updated.quality_status = 'NOT_STARTED';
        } else if (prev.quality_status === 'NOT_STARTED') {
          // En quittant PLANIFIE, le lot démarre : on repasse à « En cours ».
          updated.quality_status = 'EN_COURS';
        }
      }
      if (field === 'startDate') {
        const startDateStr = value;
        if (startDateStr) {
          const startDate = new Date(startDateStr);
          if (!isNaN(startDate.getTime())) {
            // 1. Recalculate samples calculated dates (Calcul 1 + 2)
            const fluxForSamples = fluxConfig[prev.fluxKey];
            updated.samples = prev.samples.map(s =>
              computeSampleDates({ ...s }, fluxForSamples, value, sampleConfig)
            );

            // 2. Recalculate endDate based on lead time
            const currentFlux = fluxConfig[prev.fluxKey] || Object.values(fluxConfig)[0];
            if (currentFlux) {
              const leadTimeWeeks = (Object.values(currentFlux.durations || {}) as number[]).reduce((sum: number, val: number) => sum + val, 0);
              const endDate = new Date(startDate);
              endDate.setDate(endDate.getDate() + leadTimeWeeks * 7);
              updated.endDate = endDate.toISOString().split('T')[0];
            }
          }
        }
      }
      if (field === 'fluxKey') {
        const newFluxKey = value;
        const currentFlux = fluxConfig[newFluxKey];
        // Recompute sample calculated dates against the new flux
        updated.samples = prev.samples.map(s =>
          computeSampleDates({ ...s }, currentFlux, prev.startDate, sampleConfig)
        );
        if (currentFlux && prev.startDate) {
          const startDate = new Date(prev.startDate);
          if (!isNaN(startDate.getTime())) {
            const leadTimeWeeks = (Object.values(currentFlux.durations || {}) as number[]).reduce((sum: number, val: number) => sum + val, 0);
            const endDate = new Date(startDate);
            endDate.setDate(endDate.getDate() + leadTimeWeeks * 7);
            updated.endDate = endDate.toISOString().split('T')[0];
          }
        }
      }
      return updated;
    });
  };

  const handleProductChange = (name: string) => {
    const product = catalog.find(p => p.name.toUpperCase() === name.toUpperCase());
    if (product) {
      setLocalBatch(prev => {
        if (!prev) return null;
        let newFluxKey = prev.fluxKey;
        const foundKey = Object.keys(fluxConfig).find(k => fluxConfig[k].name.includes(product.name.split(' ')[0]));
        if (foundKey) newFluxKey = foundKey;
        
        let updated = { ...prev, product: name, reference: product.ref, fluxKey: newFluxKey };

        // Recalculate endDate based on new fluxKey
        const currentFlux = fluxConfig[newFluxKey];
        updated.samples = prev.samples.map(s =>
          computeSampleDates({ ...s }, currentFlux, prev.startDate, sampleConfig)
        );
        if (currentFlux && prev.startDate) {
          const startDate = new Date(prev.startDate);
          if (!isNaN(startDate.getTime())) {
            const leadTimeWeeks = (Object.values(currentFlux.durations || {}) as number[]).reduce((sum: number, val: number) => sum + val, 0);
            const endDate = new Date(startDate);
            endDate.setDate(endDate.getDate() + leadTimeWeeks * 7);
            updated.endDate = endDate.toISOString().split('T')[0];
          }
        }
        return updated;
      });
    } else {
      handleChange('product', name);
    }
  };

  // Sélection d'un type de produit depuis le catalogue : remplit product (= name), reference (= ref)
  // et pilote le flux (fluxKey dérivé du type) → recalcule endDate + dates échantillons.
  const handleCatalogTypeChange = (type: string) => {
    const entry = productCatalog.find(p => p.type === type);
    if (!entry) return;
    setLocalBatch(prev => {
      if (!prev) return null;
      const derivedKey = fluxKeyForType(entry.type, fluxConfig);
      const newFluxKey = derivedKey || prev.fluxKey;
      let updated = { ...prev, product: entry.name, reference: entry.ref, fluxKey: newFluxKey };

      // Recalculate sample dates and endDate against the new flux (comme un changement de flux)
      const currentFlux = fluxConfig[newFluxKey];
      updated.samples = prev.samples.map(s =>
        computeSampleDates({ ...s }, currentFlux, prev.startDate, sampleConfig)
      );
      if (currentFlux && prev.startDate) {
        const startDate = new Date(prev.startDate);
        if (!isNaN(startDate.getTime())) {
          const leadTimeWeeks = (Object.values(currentFlux.durations || {}) as number[]).reduce((sum: number, val: number) => sum + val, 0);
          const endDate = new Date(startDate);
          endDate.setDate(endDate.getDate() + leadTimeWeeks * 7);
          updated.endDate = endDate.toISOString().split('T')[0];
        }
      }
      return updated;
    });
  };

  const handleSampleChange = (index: number, field: keyof Sample, value: any) => {
    setLocalBatch(prev => {
      if (!prev) return null;
      const newSamples = [...prev.samples];
      let s = { ...newSamples[index], [field]: value };

      // Le partenaire pilote l'applicabilité : applicable = partner non vide
      if (field === 'partner') {
        s.applicable = !!value;
        // Si on rend non-applicable (partner vide) : statut figé à A_ENVOYER, envoi effacé
        if (!value) {
          s.status = 'A_ENVOYER';
          s.dateEnvoi = '';
        }
      }

      // Recalcul Calcul 1 + Calcul 2 pour cette ligne
      const flux = fluxConfig[prev.fluxKey];
      s = computeSampleDates(s, flux, prev.startDate, sampleConfig);
      newSamples[index] = s;
      return { ...prev, samples: newSamples };
    });
  };

  // Re-test : archive l'essai courant dans history, réinitialise la ligne (garde partner), recalcule.
  const handleRetest = (index: number) => {
    setLocalBatch(prev => {
      if (!prev) return null;
      const newSamples = [...prev.samples];
      const cur = newSamples[index];
      const snapshot = {
        status: cur.status,
        dateEnvoi: cur.dateEnvoi,
        datePrelevementReel: cur.datePrelevementReel || '',
        dateReceptionEchantillon: cur.dateReceptionEchantillon,
        dateResultatsAttendue: cur.dateResultatsAttendue,
        dateResultatsRecus: cur.dateResultatsRecus || '',
        rapportRef: cur.rapportRef || '',
        rapportUrl: cur.rapportUrl || '',
        motifNonConforme: cur.motifNonConforme || '',
        archivedAt: new Date().toISOString().split('T')[0]
      };
      let reset: Sample = {
        ...cur,
        status: 'A_ENVOYER',
        dateEnvoi: '',
        datePrelevementReel: '',
        dateResultatsRecus: '',
        rapportRef: '',
        rapportUrl: '',
        motifNonConforme: '',
        history: [...(cur.history || []), snapshot]
      };
      reset = computeSampleDates(reset, fluxConfig[prev.fluxKey], prev.startDate, sampleConfig);
      newSamples[index] = reset;
      return { ...prev, samples: newSamples };
    });
  };

  // Coche « Fait » d'un jalon : set done + doneDate (aujourd'hui par défaut, modifiable).
  const handleMilestoneDone = (stage: ProductionMilestoneStage, done: boolean) => {
    setLocalBatch(prev => {
      if (!prev) return null;
      const ms = prev.milestones || defaultMilestones();
      const today = new Date().toISOString().split('T')[0];
      return {
        ...prev,
        milestones: {
          ...ms,
          [stage]: done ? { done: true, doneDate: ms[stage]?.doneDate || today } : { done: false }
        }
      };
    });
  };

  const handleMilestoneDate = (stage: ProductionMilestoneStage, value: string) => {
    setLocalBatch(prev => {
      if (!prev) return null;
      const ms = prev.milestones || defaultMilestones();
      return {
        ...prev,
        milestones: { ...ms, [stage]: { done: true, doneDate: value } }
      };
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

  const handleSave = async () => {
    try {
      const stageIdx = Math.max(0, PROCESS_STAGES.findIndex(s => s.value === localBatch.process_stage));
      const progress = Math.round((stageIdx / (PROCESS_STAGES.length - 1)) * 100);

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
          {/* BANDEAU JALONS DE PRODUCTION (pire statut des 3 jalons) */}
          {(() => {
            const flux = fluxConfig[localBatch.fluxKey];
            const dates = computeMilestoneDates(flux, localBatch.startDate);
            const ms = localBatch.milestones || defaultMilestones();
            const planifie = localBatch.process_stage === 'PLANIFIE';
            const states = PRODUCTION_MILESTONES.map(m =>
              planifie ? 'na' as const : milestoneStatus(dates[m.key], !!ms[m.key]?.done)
            );
            const lateCount = states.filter(s => s === 'late').length;
            const hasWarn = states.some(s => s === 'warn');
            const allNa = states.every(s => s === 'na');

            let cls: string;
            let text: string;
            if (planifie || allNa) {
              cls = 'bg-slate-100 text-slate-600 border-slate-200';
              text = 'Jalons : non démarré';
            } else if (lateCount > 0) {
              cls = 'bg-red-100 text-red-700 border-red-200';
              text = `Jalons : ${lateCount} en retard`;
            } else if (hasWarn) {
              cls = 'bg-orange-100 text-orange-700 border-orange-200';
              text = 'Jalons : échéance proche';
            } else {
              cls = 'bg-green-100 text-green-700 border-green-200';
              text = 'Jalons : à jour';
            }
            return (
              <div className={cn('mb-6 px-4 py-2.5 rounded-md border text-sm font-semibold', cls)}>
                {text}
              </div>
            );
          })()}

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
                <select value={selectedCatalogType} onChange={e => handleCatalogTypeChange(e.target.value)} className="form-input">
                  <option value="">-- Sélectionner un type --</option>
                  {productCatalog.map(p => (
                    <option key={p.type} value={p.type}>{p.type}</option>
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

          {/* SECTION JALONS DE PRODUCTION */}
          <div className="mb-8">
            <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-4 border-b-2 border-slate-200 pb-2">Jalons de production</h3>
            {(() => {
              const flux = fluxConfig[localBatch.fluxKey];
              const dates = computeMilestoneDates(flux, localBatch.startDate);
              const ms = localBatch.milestones || defaultMilestones();
              const planifie = localBatch.process_stage === 'PLANIFIE';
              return (
                <div className="flex flex-col gap-3">
                  {PRODUCTION_MILESTONES.map(m => {
                    const datePrevue = dates[m.key];
                    const check = ms[m.key] || { done: false };
                    const state = planifie ? 'na' : milestoneStatus(datePrevue, !!check.done);
                    return (
                      <div key={m.key} className="grid grid-cols-12 items-center gap-3 border border-slate-200 rounded-lg px-4 py-3 bg-white">
                        <div className="col-span-4 text-sm font-medium text-slate-700">{m.label}</div>
                        <div className="col-span-4">
                          <span className={cn(
                            'inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold border',
                            MILESTONE_STATUS_COLOR[state]
                          )}>
                            {datePrevue ? `Prévu : ${datePrevue}` : 'Date non calculée'}
                          </span>
                        </div>
                        <div className="col-span-2 flex items-center">
                          <label className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={!!check.done}
                              disabled={!canEdit}
                              onChange={e => handleMilestoneDone(m.key, e.target.checked)}
                              className="rounded border-slate-300"
                            />
                            Fait
                          </label>
                        </div>
                        <div className="col-span-2">
                          {check.done && (
                            <input
                              type="date"
                              value={check.doneDate || ''}
                              disabled={!canEdit}
                              onChange={e => handleMilestoneDate(m.key, e.target.value)}
                              className="w-full px-2 py-1 text-xs border border-slate-300 rounded focus:border-blue-500 outline-none"
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>

          {/* SECTION 2: DONNÉES PRODUCTION */}
          <div className="mb-8">
            <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-4 border-b-2 border-slate-200 pb-2">Données de Production</h3>
            <div className="grid grid-cols-3 gap-4 mb-4">
              <FormGroup label="Contenant">
                <input
                  type="text"
                  value={catalogEntry?.contenant || '—'}
                  disabled
                  className="form-input bg-slate-100 text-slate-500 cursor-not-allowed"
                />
              </FormGroup>
              <FormGroup label="Conditionnement (par boîte)">
                <input
                  type="text"
                  value={catalogEntry ? String(catalogEntry.condit) : '—'}
                  disabled
                  className="form-input bg-slate-100 text-slate-500 cursor-not-allowed"
                />
              </FormGroup>
              <FormGroup label="Volume contenant (mL)">
                <input
                  type="text"
                  value={catalogEntry ? String(catalogEntry.volume) : '—'}
                  disabled
                  className="form-input bg-slate-100 text-slate-500 cursor-not-allowed"
                />
              </FormGroup>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormGroup label="Volume Lot (L)">
                <input type="number" value={localBatch.volume} onChange={e => handleChange('volume', parseFloat(e.target.value) || 0)} className="form-input" />
              </FormGroup>
              <FormGroup label="Boîtes cible">
                <input type="number" value={localBatch.boxesTarget} onChange={e => handleChange('boxesTarget', parseFloat(e.target.value) || 0)} className="form-input" />
              </FormGroup>
              <FormGroup label="Quantité Répartie">
                <input type="number" value={localBatch.distributed} onChange={e => handleChange('distributed', parseFloat(e.target.value) || 0)} className="form-input" />
              </FormGroup>
              <FormGroup label="Quantité Mirés Conforme">
                <input type="number" value={localBatch.conform} onChange={e => handleChange('conform', parseFloat(e.target.value) || 0)} className="form-input" />
              </FormGroup>
              <FormGroup label="Boîtes produites">
                <input type="number" value={localBatch.sold} onChange={e => handleChange('sold', parseFloat(e.target.value) || 0)} className="form-input" />
              </FormGroup>
              <FormGroup label="Palettes à expédier">
                <input type="number" value={localBatch.palettes} onChange={e => handleChange('palettes', parseFloat(e.target.value) || 0)} className="form-input" />
              </FormGroup>
            </div>
          </div>

          {/* SECTION 3: NOTES */}
          <div className="mb-8">
            <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-4 border-b-2 border-slate-200 pb-2">Notes & Observations</h3>
            <textarea
              rows={3}
              value={localBatch.notes}
              onChange={e => handleChange('notes', e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none resize-y"
            />
          </div>

          {/* SECTION 4: SUIVI 3 AXES (Étape process / Statut qualité / Santé délai) */}
          <div className="mb-8">
            <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-4 border-b-2 border-slate-200 pb-2">Suivi du Lot</h3>
            <div className="grid grid-cols-3 gap-4">
              {/* Axe 1 : Étape process */}
              <FormGroup label="Étape process">
                <select
                  value={localBatch.process_stage}
                  onChange={e => handleChange('process_stage', e.target.value as ProcessStage)}
                  disabled={!canEdit}
                  className={cn("form-input", !canEdit && "bg-slate-50 cursor-not-allowed text-slate-500")}
                >
                  {PROCESS_STAGES.map(ps => {
                    const disabled = ps.value === 'EXPEDIE' && localBatch.quality_status !== 'LIBERE';
                    return (
                      <option key={ps.value} value={ps.value} disabled={disabled}>
                        {ps.label}{disabled ? ' (Requiert statut Libéré)' : ''}
                      </option>
                    );
                  })}
                </select>
              </FormGroup>

              {/* Axe 2 : Statut qualité */}
              <FormGroup label="Statut qualité">
                <select
                  value={localBatch.quality_status}
                  onChange={e => handleChange('quality_status', e.target.value as QualityStatus)}
                  disabled={!canEdit}
                  className={cn("form-input", !canEdit && "bg-slate-50 cursor-not-allowed text-slate-500")}
                >
                  {QUALITY_STATUSES.map(qs => {
                    const disabled = qs.value === 'LIBERE'
                      && localBatch.process_stage !== 'LIBERATION'
                      && localBatch.process_stage !== 'EXPEDIE';
                    return (
                      <option key={qs.value} value={qs.value} disabled={disabled}>
                        {qs.label}{disabled ? ' (Requiert Libération/Expédié)' : ''}
                      </option>
                    );
                  })}
                </select>
              </FormGroup>

              {/* Axe 3 : OTD (calculé, lecture seule) */}
              <FormGroup label="OTD (On-Time Delivery)">
                {(() => {
                  const computed = computeScheduleHealth(localBatch.endDate, localBatch.deliveryDate, localBatch.process_stage);
                  const sh = SCHEDULE_HEALTH.find(s => s.value === computed);
                  return (
                    <span className={cn(
                      "inline-flex items-center justify-center px-2.5 py-2 rounded-md text-sm font-semibold border",
                      sh?.color || 'bg-slate-100 text-slate-500 border-slate-200'
                    )}>
                      {sh?.label || computed || '—'}
                    </span>
                  );
                })()}
              </FormGroup>
            </div>

            {/* Barre de progression alignée sur l'Axe 1 (process_stage) */}
            <div className="relative flex justify-between mt-8 mb-4">
              <div className="absolute top-3 left-0 right-0 h-0.5 bg-slate-200 z-0" />
              {PROCESS_STAGES.map((stage, idx) => {
                const currentIdx = PROCESS_STAGES.findIndex(s => s.value === localBatch.process_stage);
                const isCompleted = idx < currentIdx;
                const isActive = idx === currentIdx;
                return (
                  <div key={stage.value} className="relative z-10 text-center flex flex-col items-center w-20">
                    <div className={cn(
                      "w-6 h-6 rounded-full border-2 flex items-center justify-center text-[10px] font-bold transition-colors mb-2 bg-white",
                      isCompleted ? "border-green-500 bg-green-500 text-white" :
                      isActive ? "border-blue-600 bg-blue-600 text-white" :
                      "border-slate-300 text-slate-400"
                    )}>
                      {idx + 1}
                    </div>
                    <div className="text-[10px] text-slate-500 leading-tight">{stage.label}</div>
                  </div>
                );
              })}
            </div>

            {/* Avertissement non bloquant : libération avec tests labo incomplets */}
            {localBatch.quality_status === 'LIBERE' && !computeTestsOk(localBatch.samples) && (
              <div className="mt-2 flex items-start gap-2 px-3 py-2 bg-orange-50 border border-orange-200 rounded-md text-sm text-orange-800">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-orange-500" />
                <span>Libération avec tests labo incomplets (tous les tests applicables ne sont pas encore « Conforme »).</span>
              </div>
            )}
          </div>

          {/* SECTION 3: SUIVI ÉCHANTILLONS — cartes guidées (saisie vs calculé) */}
          <div className="mb-8">
            <div className="flex items-center justify-between mb-2 border-b-2 border-slate-200 pb-2">
              <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider">Suivi Échantillons (Tests)</h3>
              {(() => {
                const ok = computeTestsOk(localBatch.samples);
                return (
                  <span className={cn(
                    "inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold border",
                    ok ? 'bg-green-100 text-green-700 border-green-200' : 'bg-slate-100 text-slate-500 border-slate-200'
                  )}>
                    {ok ? 'Tests labo : OK' : 'Tests labo : incomplets'}
                  </span>
                );
              })()}
            </div>

            {/* Légende couleurs (affichée une seule fois) */}
            <div className="mb-4">
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
                <span className="font-semibold text-slate-500">Pastilles des dates calculées —</span>
                <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-green-500" /> Dans les temps</span>
                <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-orange-500" /> Échéance proche (≤ 7 j)</span>
                <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-500" /> En retard (action requise)</span>
              </div>
              <p className="text-[10px] text-slate-400 mt-1">La pastille indique si l'échéance de la date est dépassée.</p>
            </div>

            <div className="flex flex-col gap-4">
              {localBatch.samples.map((s, idx) => {
                const testDef = SAMPLE_TESTS.find(t => t.key === s.type);
                const testLabel = testDef?.label || s.type;
                const recNotDone = s.status === 'A_ENVOYER';
                const resNotDone = !['RESULTATS_RECUS', 'CONFORME', 'NON_CONFORME'].includes(s.status);
                // Production démarrée = pas planifié, date de début de fab renseignée et déjà passée (sinon badges neutres)
                const prodStarted = localBatch.process_stage !== 'PLANIFIE'
                  && !!localBatch.startDate && localBatch.startDate <= new Date().toISOString().slice(0, 10);
                const stepIdx = sampleStepperIndex(s.status);
                const histCount = (s.history || []).length;

                // Carte non applicable : grisée, badge N/A, partenaire seul
                if (!s.applicable) {
                  return (
                    <div key={idx} className="border border-slate-200 rounded-lg p-4 bg-slate-50 opacity-70 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-sm font-medium text-slate-600">
                        <TestTube2 className="w-4 h-4 text-slate-400 shrink-0" />
                        {testLabel}
                      </div>
                      <div className="flex items-center gap-2">
                        <select
                          value={s.partner}
                          onChange={e => handleSampleChange(idx, 'partner', e.target.value)}
                          title="Partenaire / Laboratoire"
                          className="px-2 py-1 text-xs border border-slate-300 rounded focus:border-blue-500 outline-none"
                        >
                          <option value="">— Non applicable</option>
                          {Array.from(new Set([...samplePartners, s.partner].filter(Boolean))).map(p => (
                            <option key={p} value={p}>{p}</option>
                          ))}
                        </select>
                        <span className="inline-flex items-center px-2 py-1 rounded text-xs font-semibold bg-slate-200 text-slate-500 border border-slate-300">N/A</span>
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={idx} className="border border-slate-200 rounded-lg bg-white overflow-hidden">
                    {/* En-tête : test + partenaire + mini-stepper */}
                    <div className="p-4 border-b border-slate-100">
                      <div className="flex items-center justify-between gap-3 mb-3">
                        <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                          <TestTube2 className="w-4 h-4 text-blue-500 shrink-0" />
                          {testLabel}
                        </div>
                        <select
                          value={s.partner}
                          onChange={e => handleSampleChange(idx, 'partner', e.target.value)}
                          title="Partenaire / Laboratoire"
                          className="px-2 py-1 text-xs border border-slate-300 rounded focus:border-blue-500 outline-none"
                        >
                          <option value="">— Non applicable</option>
                          {Array.from(new Set([...samplePartners, s.partner].filter(Boolean))).map(p => (
                            <option key={p} value={p}>{p}</option>
                          ))}
                        </select>
                      </div>
                      {/* Mini-stepper de statut */}
                      <div className="flex items-center">
                        {SAMPLE_STEPPER.map((st, i) => {
                          const done = i < stepIdx;
                          const active = i === stepIdx;
                          const isFinalNonConf = i === 3 && s.status === 'NON_CONFORME';
                          return (
                            <React.Fragment key={st.key}>
                              <div className="flex flex-col items-center text-center w-24">
                                <div className={cn(
                                  "w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold border-2",
                                  isFinalNonConf ? "bg-red-500 border-red-500 text-white" :
                                  done ? "bg-green-500 border-green-500 text-white" :
                                  active ? "bg-blue-600 border-blue-600 text-white" :
                                  "bg-white border-slate-300 text-slate-400"
                                )}>{i + 1}</div>
                                <span className="text-[9px] leading-tight text-slate-500 mt-1">
                                  {isFinalNonConf ? 'Non conforme' : st.label}
                                </span>
                              </div>
                              {i < SAMPLE_STEPPER.length - 1 && (
                                <div className={cn("flex-1 h-0.5 -mt-4", i < stepIdx ? "bg-green-400" : "bg-slate-200")} />
                              )}
                            </React.Fragment>
                          );
                        })}
                      </div>
                    </div>

                    {/* Zone À RENSEIGNER */}
                    <div className="p-4 bg-blue-50/40">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-blue-700">À renseigner</span>
                        <span className="text-[11px] text-blue-700 font-medium">{nextActionHint(s)}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <FieldLabel label="Statut">
                          <select
                            value={s.status}
                            onChange={e => handleSampleChange(idx, 'status', e.target.value as SampleStatus)}
                            className="w-full px-2 py-1 text-xs border border-slate-300 rounded focus:border-blue-500 outline-none bg-white"
                          >
                            {SAMPLE_STATUSES.map(st => {
                              const transitionOk = isSampleTransitionAllowed(s.status, st.value);
                              const needsEnvoi = st.value === 'ENVOYE' && !s.dateEnvoi;
                              const needsRecus = st.value === 'RESULTATS_RECUS' && !s.dateResultatsRecus;
                              const disabled = !transitionOk || needsEnvoi || needsRecus;
                              let suffix = '';
                              if (!transitionOk && s.status !== st.value) suffix = ' (transition non permise)';
                              else if (needsEnvoi) suffix = " (date d'envoi requise)";
                              else if (needsRecus) suffix = ' (date résultats requise)';
                              return (
                                <option key={st.value} value={st.value} disabled={disabled}>
                                  {st.label}{suffix}
                                </option>
                              );
                            })}
                          </select>
                        </FieldLabel>

                        <FieldLabel label="Date d'envoi">
                          <input
                            type="date"
                            value={s.dateEnvoi}
                            onChange={e => handleSampleChange(idx, 'dateEnvoi', e.target.value)}
                            className="w-full px-2 py-1 text-xs border border-slate-300 rounded focus:border-blue-500 outline-none bg-white"
                          />
                        </FieldLabel>

                        <FieldLabel label="Date de réception échantillon">
                          <input
                            type="date"
                            value={s.datePrelevementReel || ''}
                            onChange={e => handleSampleChange(idx, 'datePrelevementReel', e.target.value)}
                            className="w-full px-2 py-1 text-xs border border-slate-300 rounded focus:border-blue-500 outline-none bg-white"
                          />
                        </FieldLabel>

                        <FieldLabel label="Date réception des résultats">
                          <input
                            type="date"
                            value={s.dateResultatsRecus || ''}
                            onChange={e => handleSampleChange(idx, 'dateResultatsRecus', e.target.value)}
                            className="w-full px-2 py-1 text-xs border border-slate-300 rounded focus:border-blue-500 outline-none bg-white"
                          />
                        </FieldLabel>

                        {s.status === 'NON_CONFORME' && (
                          <div className="col-span-2">
                            <FieldLabel label="Motif de non-conformité (obligatoire)">
                              <textarea
                                rows={2}
                                value={s.motifNonConforme || ''}
                                onChange={e => handleSampleChange(idx, 'motifNonConforme', e.target.value)}
                                placeholder="Décrire le motif de non-conformité…"
                                className="w-full px-2 py-1 text-xs border border-red-300 rounded focus:border-red-500 outline-none bg-white resize-y"
                              />
                            </FieldLabel>
                          </div>
                        )}
                      </div>

                      {s.status === 'NON_CONFORME' && (
                        <button
                          type="button"
                          onClick={() => handleRetest(idx)}
                          className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded hover:bg-amber-100 transition-colors"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          Relancer un prélèvement
                        </button>
                      )}
                    </div>

                    {/* Zone CALCULÉ (auto, lecture seule) */}
                    <div className="p-4">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-2">Calculé (auto, lecture seule)</span>
                      {s.configError ? (
                        <span className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded leading-tight block">
                          Étape de prélèvement absente de la fiche produit — impossible de calculer les dates.
                        </span>
                      ) : (
                        <div className="grid grid-cols-2 gap-2">
                          <span className={cn(
                            "text-[11px] px-2 py-1 rounded border text-center leading-tight",
                            sampleDateBadgeColor(s.dateReceptionEchantillon, recNotDone, prodStarted)
                          )}>
                            Réception théorique : {s.dateReceptionEchantillon || '—'}
                          </span>
                          <span className={cn(
                            "text-[11px] px-2 py-1 rounded border text-center leading-tight",
                            sampleDateBadgeColor(s.dateResultatsAttendue, resNotDone, prodStarted)
                          )}>
                            Résultats attendus : {s.dateResultatsAttendue || '—'}
                            {s.status === 'A_ENVOYER' && s.dateResultatsAttendue ? ' (prévisionnel)' : ''}
                          </span>
                        </div>
                      )}

                      {/* Historique des essais précédents (re-test) */}
                      {histCount > 0 && (
                        <div className="mt-3 text-[11px] text-slate-500">
                          <div className="font-semibold text-slate-600 mb-1">Essais précédents : {histCount}</div>
                          <ul className="flex flex-col gap-0.5">
                            {(s.history || []).map((h: any, hi: number) => (
                              <li key={hi} className="flex items-center gap-2">
                                <span className="text-slate-400">#{hi + 1}</span>
                                <span>{h.archivedAt || '—'}</span>
                                <span className="text-slate-400">·</span>
                                <span>{SAMPLE_STATUSES.find(st => st.value === h.status)?.label || h.status}</span>
                                {h.motifNonConforme ? <span className="text-red-600">· {h.motifNonConforme}</span> : null}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
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

function FieldLabel({ label, children }: { label: string, children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-medium text-slate-500">{label}</label>
      {children}
    </div>
  );
}
