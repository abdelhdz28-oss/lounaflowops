import React, { useState, useEffect } from 'react';
import { X, TestTube2, Plus, RotateCcw, AlertTriangle, Mail } from 'lucide-react';
import { useAppContext } from '../AppContext';
import { useAuth } from '../AuthContext';
import { Batch, Sample, FluxConfig, ProcessStage, QualityStatus, SampleStatus } from '../types';
import {
  PROCESS_STAGES, QUALITY_STATUSES, SCHEDULE_HEALTH, computeScheduleHealth,
  SAMPLE_TESTS, SAMPLE_STATUSES,
  computeSampleDates, computeTestsOk, isSampleTransitionAllowed,
  PRODUCTION_MILESTONES, computeMilestoneDates, milestoneStatus, MILESTONE_STATUS_COLOR,
  defaultMilestones, ProductionMilestoneStage, formatDate, ageEtapeLot, boitesProduites, quantiteTheorique
} from '../constants';
import { cn } from '../utils/cn';

const API_URL = import.meta.env.VITE_API_URL || '';
// Date + heure en français : « 13/08/2026 à 14h32 ».
const fmtDateTime = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return `${d.toLocaleDateString('fr-FR')} à ${String(d.getHours()).padStart(2, '0')}h${String(d.getMinutes()).padStart(2, '0')}`;
};

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


// Formatte un ISO datetime en FR lisible : 21/06/2026 21:30
function formatNoteDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

interface BatchDrawerProps {
  batchId: string | null;
  onClose: () => void;
  /** Ouvre Paramètres → Catalogue Produits, là où se règle le conditionnement. */
  onOpenCatalogue?: () => void;
}

export function BatchDrawer({ batchId, onClose, onOpenCatalogue }: BatchDrawerProps) {
  const {
    batches, fluxConfig, sampleConfig, productCatalog, updateBatch, createBatch,
    clients, updateClients, samplePartners, addBatchNote, deleteBatch, refreshData
  } = useAppContext();
  const { token, isAdmin, canEdit: peutEditer } = useAuth();
  const [localBatch, setLocalBatch] = useState<Batch | null>(null);
  // Responsables déjà saisis sur d'autres lots : proposés en autocomplétion, sans référentiel à gérer.
  const responsablesConnus = [...new Set((batches || []).map(b => (b.responsable || '').trim()).filter(Boolean))].sort();
  const ageEtape = ageEtapeLot(localBatch?.stage_since);
  // Un lot clôturé est en lecture seule : ce seul const verrouille tous les champs de la fiche.
  const canEdit = peutEditer && !localBatch?.cloture;
  const [tab, setTab] = useState<'synthese' | 'production' | 'controles' | 'journal'>('synthese');
  const [cloturing, setCloturing] = useState(false);
  const [isNew, setIsNew] = useState(false);
  const [newNote, setNewNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  // Notification PRRC + recherche du document de libération sur SharePoint.
  const [notifiedAt, setNotifiedAt] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState('');

  // Réinitialise l'affichage « Notifié le… » et le message d'analyse à chaque changement de lot.
  useEffect(() => {
    setNotifiedAt(batches.find(b => b.id === batchId)?.prrcNotifiedAt || null);
    setScanMsg('');
  }, [batchId, batches]);

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

  const cloturerLot = async () => {
    if (!localBatch) return;
    if (!confirm(`Clôturer le lot ${localBatch.id} ?\n\nIl sortira des listes actives et sa fiche passera en lecture seule.\nTu pourras le rouvrir si besoin.`)) return;
    setCloturing(true);
    try {
      const r = await fetch(`${API_URL}/api/batches/${encodeURIComponent(localBatch.id)}/cloturer`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return alert(j.error || 'Clôture impossible.');
      await refreshData();
    } finally { setCloturing(false); }
  };
  const rouvrirLot = async () => {
    if (!localBatch) return;
    if (!confirm(`Rouvrir le lot ${localBatch.id} ? Il reviendra dans les listes actives.`)) return;
    setCloturing(true);
    try {
      const r = await fetch(`${API_URL}/api/batches/${encodeURIComponent(localBatch.id)}/rouvrir`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) return alert('Réouverture impossible.');
      await refreshData();
    } finally { setCloturing(false); }
  };

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

  const handleAddNote = async () => {
    if (!localBatch || !newNote.trim()) return;
    setSavingNote(true);
    const ok = await addBatchNote(localBatch.id, newNote.trim());
    setSavingNote(false);
    if (ok) {
      setNewNote('');
    } else {
      alert("Erreur lors de l'ajout du commentaire. Vérifiez vos droits d'accès.");
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
        // La livraison est créée et synchronisée côté serveur (syncDeliveryForBatch) à partir de la date de livraison du lot —
        // ne pas la créer aussi ici, sinon le lot reçoit deux lignes de livraison.
      } else {
        const res = await updateBatch(batchId!, { ...localBatch, progress });
        if (!res.ok) {
          alert(res.error || "Erreur lors de la modification du lot. Veuillez vérifier vos droits d'accès.");
          return;
        }
      }
      onClose();
    } catch (err) {
      console.error(err);
      alert("Une erreur inattendue est survenue lors de l'enregistrement.");
    }
  };

  const handleDelete = async () => {
    if (isNew || !batchId) return;
    if (!window.confirm(
      `Supprimer définitivement le lot ${localBatch.id} ?\nCette action est irréversible et retire aussi ses livraisons liées.`
    )) return;
    const success = await deleteBatch(batchId);
    if (success) {
      onClose();
    } else {
      alert("Erreur lors de la suppression du lot. Veuillez vérifier vos droits d'accès.");
    }
  };

  return (
    <>
      <div 
        className="fixed inset-0 bg-black/30 z-40 transition-opacity"
        onClick={onClose}
      />
      <aside className="fixed top-0 right-0 w-full sm:w-[700px] max-w-full h-full bg-white shadow-2xl z-50 flex flex-col transform transition-transform duration-300 ease-out translate-x-0">
        {/* BANDEAU DE TÊTE : répond en un coup d'œil à « où en est ce lot ? » */}
        <div className="px-6 pt-5 pb-3 border-b border-slate-200 bg-slate-50">
          <div className="flex justify-between items-start">
            <div className="min-w-0">
              <h2 className="text-2xl font-bold text-slate-900 truncate">
                {localBatch.id}
                <span className="ml-2 text-base font-normal text-slate-500">
                  {(catalogEntry?.type || localBatch.product) || '—'}{localBatch.client ? ` · ${localBatch.client}` : ''}
                </span>
              </h2>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {!localBatch.cloture && peutEditer && (
                <button onClick={() => setTab('production')} className="px-3 py-1.5 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100">Modifier</button>
              )}
              <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-full transition-colors">
                <X className="w-6 h-6 text-slate-500" />
              </button>
            </div>
          </div>

          {/* Pastilles d'état */}
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <Pastille texte={PROCESS_STAGES.find(p => p.value === localBatch.process_stage)?.label || localBatch.process_stage} ton="bleu" />
            <Pastille texte={QUALITY_STATUSES.find(q => q.value === localBatch.quality_status)?.label || localBatch.quality_status} ton="gris" />
            {(() => {
              const c = computeScheduleHealth(localBatch.endDate, localBatch.deliveryDate, localBatch.process_stage);
              const sh = SCHEDULE_HEALTH.find(x => x.value === c);
              return <Pastille texte={sh?.label || c || '—'} ton={c === 'EN_RETARD' ? 'rouge' : c === 'AT_RISK' ? 'orange' : 'vert'} />;
            })()}
            <Pastille texte={`${ageEtape.texte} à cette étape`} ton={ageEtape.j != null && ageEtape.j >= 21 ? 'rouge' : ageEtape.j != null && ageEtape.j >= 10 ? 'orange' : 'gris'} />
            <span className="text-sm text-slate-500 ml-1">
              Responsable : {localBatch.responsable ? <span className="font-medium text-slate-700">{localBatch.responsable}</span> : <span className="text-slate-400">non assigné</span>}
            </span>
          </div>

          {localBatch.blocage_motif && (
            <div className="mt-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-1.5">⛔ Bloqué : {localBatch.blocage_motif}</div>
          )}
          {localBatch.cloture && (
            <div className="mt-2 flex items-center justify-between gap-3 text-sm text-slate-700 bg-slate-200/70 border border-slate-300 rounded-md px-3 py-1.5">
              <span>🔒 Lot clôturé{localBatch.cloture_at ? ` le ${fmtDateTime(localBatch.cloture_at)}` : ''}{localBatch.cloture_par ? ` par ${localBatch.cloture_par}` : ''} — fiche en lecture seule.</span>
              {peutEditer && <button onClick={rouvrirLot} disabled={cloturing} className="shrink-0 text-xs font-semibold text-blue-700 hover:underline">Rouvrir</button>}
            </div>
          )}

          {/* ONGLETS */}
          <div className="flex gap-1 mt-3 -mb-3">
            {([['synthese', 'Synthèse'], ['production', 'Production'], ['controles', 'Contrôles'], ['journal', 'Journal']] as const).map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)}
                className={cn('px-4 py-2 text-sm font-medium border-b-2', tab === k ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700')}>{l}</button>
            ))}
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-8">
          {/* SYNTHÈSE : 9 informations, rien de plus. Dates à gauche, quantités à droite. */}
          {tab === 'synthese' && (() => {
            const joursRestants = (d?: string | null) => {
              if (!d) return null;
              const n = Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
              return isNaN(n) ? null : n;
            };
            const rLivr = joursRestants(localBatch.deliveryDate);
            const nb = (v: any) => (v === null || v === undefined || v === '') ? '—' : Number(v).toLocaleString('fr-FR');
            const pct = (a: any, b: any) => {
              const x = Number(a) || 0, y = Number(b) || 0;
              return y > 0 && x > 0 ? `${Math.round(x / y * 100)} %` : null;
            };
            const theorique = quantiteTheorique(localBatch, productCatalog as any);
            const bo = boitesProduites(localBatch, productCatalog as any);
            return (
              <div className="mb-8 space-y-4">
                <TableauResume titre="Dates" lignes={[
                  ['Début de fabrication', formatDate(localBatch.startDate), null],
                  ['Libération du lot', localBatch.releaseDate ? formatDate(localBatch.releaseDate) : '—',
                    localBatch.quality_status === 'LIBERE' ? { texte: 'libéré', ton: 'vert' as const }
                      : { texte: 'pas encore libéré', ton: 'gris' as const }],
                  ['Date souhaitée', formatDate(localBatch.deliveryDate),
                    rLivr === null ? null : rLivr < 0
                      ? { texte: `dépassée de ${Math.abs(rLivr)} j`, ton: 'rouge' as const }
                      : { texte: `dans ${rLivr} j`, ton: rLivr <= 7 ? 'orange' as const : 'gris' as const }],
                  ["Date d'enlèvement", localBatch.pickup_date ? formatDate(localBatch.pickup_date) : '—',
                    localBatch.pickup_date ? null : { texte: 'à renseigner', ton: 'orange' as const }],
                ]} />

                <TableauResume titre={`Quantités (${bo.contenant})`} lignes={[
                  ['Quantité théorique du lot', nb(theorique), theorique === null ? { texte: 'conditionnement inconnu', ton: 'gris' as const } : null],
                  [`${bo.contenant === 'seringues' ? 'Seringues remplies' : 'Flacons remplis'}`, nb(localBatch.distributed),
                    pct(localBatch.distributed, theorique) ? { texte: `${pct(localBatch.distributed, theorique)} du théorique`, ton: 'gris' as const } : null],
                  [`${bo.contenant === 'seringues' ? 'Seringues conformes' : 'Flacons conformes'}`, nb(localBatch.conform),
                    pct(localBatch.conform, localBatch.distributed) ? { texte: `${pct(localBatch.conform, localBatch.distributed)} des remplis`, ton: 'gris' as const } : null],
                ]} />

                {/* Boîtes produites : calculées, mais corrigeables si la réalité diffère. */}
                <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                  <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                    <span className="text-sm font-bold text-slate-500 uppercase tracking-wider">Boîtes produites</span>
                    <span className={cn('text-[11px] font-semibold px-2 py-0.5 rounded-full border',
                      bo.forcee ? TONS.orange : TONS.bleu)}>{bo.forcee ? 'corrigé à la main' : 'calculé'}</span>
                  </div>
                  <div className="px-4 py-3 flex flex-wrap items-center gap-4">
                    <input type="number" value={localBatch.sold ?? ''} disabled={!canEdit}
                      onChange={e => { handleChange('sold', e.target.value === '' ? 0 : Number(e.target.value)); handleChange('sold_manuel' as any, true); }}
                      className={cn('w-32 text-lg font-semibold text-slate-800 border border-slate-300 rounded-md px-2 py-1 tabular-nums',
                        !canEdit && 'bg-slate-50 cursor-not-allowed')} />
                    <div className="text-xs text-slate-500 flex-1 min-w-[16rem]">
                      {bo.condit > 0
                        ? <>Calcul : {nb(localBatch.conform)} {bo.contenant} conformes ÷ {bo.condit} par boîte = <b className="text-slate-700">{nb(bo.calculee)}</b> boîtes.</>
                        : <>Conditionnement inconnu pour ce produit : les boîtes doivent être saisies à la main. {onOpenCatalogue ? <button onClick={onOpenCatalogue} className="font-semibold text-blue-600 hover:underline">Régler le conditionnement</button> : <span className="font-medium">Paramètres → Catalogue Produits</span>}</>}
                    </div>
                    {canEdit && bo.forcee && bo.calculee !== null && (
                      <button onClick={() => { handleChange('sold', bo.calculee); handleChange('sold_manuel' as any, false); }}
                        className="text-xs font-semibold text-blue-600 hover:underline">Revenir au calcul</button>
                    )}
                  </div>
                </div>

                {/* CLÔTURE : la date d'enlèvement réelle ouvre le droit de clôturer */}
                {!localBatch.cloture && (
                  <div className="bg-white border border-slate-200 rounded-lg p-4">
                    <div className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-3">Clôture du lot</div>
                    <div className="flex flex-wrap items-end gap-4">
                      <label className="block">
                        <span className="text-xs font-medium text-slate-500 block mb-1">Date d'enlèvement réelle</span>
                        <input type="date" value={localBatch.pickup_date || ''} disabled={!canEdit}
                          onChange={e => handleChange('pickup_date' as any, e.target.value)}
                          className={cn('form-input', !canEdit && 'bg-slate-50 cursor-not-allowed text-slate-500')} />
                      </label>
                      <button onClick={cloturerLot} disabled={!canEdit || cloturing || !localBatch.pickup_date}
                        title={localBatch.pickup_date ? 'Clôturer et archiver ce lot' : "Renseigne d'abord la date d'enlèvement réelle"}
                        className="h-[38px] px-4 text-sm font-medium rounded-lg bg-slate-800 text-white hover:bg-slate-900 disabled:opacity-40 disabled:cursor-not-allowed">
                        {cloturing ? 'Clôture…' : 'Clôturer ce lot'}
                      </button>
                      <p className="text-xs text-slate-400 flex-1 min-w-[14rem]">
                        Le lot sortira du Tracking, du Kanban et de l'onglet Aujourd'hui. Sa fiche passera en lecture seule.
                      </p>
                    </div>
                    {!localBatch.pickup_date && <p className="text-xs text-amber-600 mt-2">Enregistre la fiche après avoir saisi la date, puis clôture.</p>}
                  </div>
                )}
              </div>
            );
          })()}

          {/* BANDEAU JALONS DE PRODUCTION (pire statut des 3 jalons) */}
          {tab === 'synthese' && (() => {
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
          {/* ONGLET PRODUCTION — frise cliquable + tableaux modifiables sur place. Rien n'est masqué. */}
          {tab === 'production' && (() => {
            const flux = fluxConfig[localBatch.fluxKey];
            const prevues = computeMilestoneDates(flux, localBatch.startDate);
            const ms = localBatch.milestones || defaultMilestones();
            const auj = new Date(); auj.setHours(0, 0, 0, 0);
            const aujIso = new Date().toISOString().split('T')[0];
            const passee = (d?: string | null) => !!d && new Date(d).getTime() <= auj.getTime();
            const stageIdx = PROCESS_STAGES.findIndex(x => x.value === localBatch.process_stage);
            const idx = (v: string) => PROCESS_STAGES.findIndex(x => x.value === v);

            const etapes: { lb: string; prevue: string | null; reelle: string | null; faite: boolean; enCours: boolean; jalon?: ProductionMilestoneStage }[] = [
              { lb: 'Début fab.', prevue: localBatch.startDate, reelle: null,
                faite: passee(localBatch.startDate) && localBatch.process_stage !== 'PLANIFIE',
                enCours: localBatch.process_stage === 'PLANIFIE' },
              ...PRODUCTION_MILESTONES.map(m => ({
                lb: m.label.replace(/^Fin /, ''),
                prevue: prevues[m.key] || null,
                reelle: ms[m.key]?.doneDate || null,
                faite: !!ms[m.key]?.done,
                enCours: !ms[m.key]?.done && stageIdx >= idx(m.key),
                jalon: m.key,
              })),
              { lb: 'Enlèvement', prevue: localBatch.deliveryDate || null, reelle: localBatch.pickup_date || null,
                faite: !!localBatch.pickup_date, enCours: localBatch.process_stage === 'ATTENTE_ENLEVEMENT' },
            ];
            const iEnCours = etapes.findIndex(e => !e.faite && e.enCours);
            etapes.forEach((e, i) => { e.enCours = i === iEnCours; });
            const nbFaites = etapes.filter(e => e.faite).length;
            const remplissage = etapes.length > 1 ? Math.min(100, Math.max(0, (nbFaites - 0.5) / (etapes.length - 1) * 100)) : 0;
            const jour = (d?: string | null) => d ? formatDate(d) : '—';
            const retard = (e: typeof etapes[number]) => (!e.prevue || !e.reelle) ? 0
              : Math.round((new Date(e.reelle).getTime() - new Date(e.prevue).getTime()) / 86400000);

            // Clic sur une étape de la frise : on déclare le jalon réalisé (ou on annule).
            const clicEtape = (e: typeof etapes[number]) => {
              if (!canEdit || !e.jalon) return;
              if (e.faite) {
                if (confirm(`Annuler la réalisation de « ${e.lb} » ?`)) handleMilestoneDone(e.jalon, false);
                return;
              }
              const d = prompt(`Date de réalisation de « ${e.lb} » :`, e.prevue && new Date(e.prevue) <= auj ? e.prevue : aujIso);
              if (d === null) return;
              handleMilestoneDone(e.jalon, true);
              if (d.trim()) handleMilestoneDate(e.jalon, d.trim());
            };

            // Cellule modifiable sur place : valeur en gras, cadre au survol.
            const cell = 'w-full font-semibold text-slate-800 bg-transparent border border-transparent rounded px-1.5 py-0.5 -mx-1.5 outline-none hover:border-slate-300 hover:bg-slate-50 focus:border-blue-500 focus:bg-white disabled:bg-transparent disabled:hover:border-transparent disabled:text-slate-500';
            const Ligne = ({ k, children }: { k: string; children: React.ReactNode }) => (
              <tr><td className="px-3 py-1.5 text-slate-500 align-middle w-[46%]">{k}</td><td className="px-3 py-1 align-middle">{children}</td></tr>
            );
            const Fige = ({ v }: { v: React.ReactNode }) => <span className="font-semibold text-slate-500 px-1.5">{v}</span>;
            const Tab = ({ titre, children }: { titre: string; children: React.ReactNode }) => (
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="px-3 py-1.5 bg-slate-50 border-b border-slate-200 text-[10px] font-bold uppercase tracking-wider text-slate-500">{titre}</div>
                <table className="w-full text-sm"><tbody className="divide-y divide-slate-100">{children}</tbody></table>
              </div>
            );
            const bo = boitesProduites(localBatch, productCatalog as any);
            const cat = catalogEntry;

            return (
              <div className="mb-8">
                <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-1 border-b-2 border-slate-200 pb-2">Avancement de la fabrication</h3>
                <p className="text-[11px] text-slate-400 mb-3">{canEdit ? 'Clique sur une étape pour déclarer qu\'elle est réalisée.' : 'Avancement du lot.'}</p>

                <div className="relative pt-2 pb-1 mb-6">
                  <div className="absolute left-[9px] right-[9px] top-[15px] h-[3px] bg-slate-200 rounded" />
                  <div className="absolute left-[9px] top-[15px] h-[3px] bg-green-500 rounded transition-all" style={{ width: `calc(${remplissage}% - 9px)` }} />
                  <div className="relative flex justify-between">
                    {etapes.map((e, i) => {
                      const r = retard(e);
                      const enRetard = !e.faite && !!e.prevue && new Date(e.prevue) < auj;
                      const cliquable = canEdit && !!e.jalon;
                      return (
                        <div key={i} onClick={() => clicEtape(e)}
                          title={cliquable ? (e.faite ? 'Cliquer pour annuler la réalisation' : 'Cliquer pour déclarer cette étape réalisée') : undefined}
                          className={cn('flex-1 text-center px-0.5 rounded-lg py-1', cliquable && 'cursor-pointer hover:bg-slate-50')}>
                          <div className={cn('w-5 h-5 rounded-full mx-auto mt-[5px] mb-2 border-[3px] border-white',
                            e.faite ? 'bg-green-500 ring-2 ring-green-500'
                              : e.enCours ? 'bg-amber-500 ring-2 ring-amber-500 animate-pulse'
                              : enRetard ? 'bg-red-500 ring-2 ring-red-500'
                              : 'bg-white ring-2 ring-slate-300')} />
                          <div className="text-[11px] font-bold text-slate-700 leading-tight">{e.lb}</div>
                          <div className="text-[11px] text-slate-500 mt-0.5">{jour(e.prevue)}</div>
                          <div className={cn('text-[10px] font-bold mt-0.5',
                            e.faite ? (r > 0 ? 'text-amber-600' : 'text-green-700')
                              : e.enCours ? 'text-amber-700' : enRetard ? 'text-red-600' : 'text-slate-400')}>
                            {e.faite ? (e.reelle ? `fait le ${jour(e.reelle)}${r > 0 ? ` (+${r} j)` : ''}` : 'fait')
                              : e.enCours ? 'en cours' : enRetard ? 'en retard' : 'prévu'}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-3 border-b-2 border-slate-200 pb-2">Identité du lot</h3>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <Tab titre="Identification">
                    <Ligne k="N° de lot">
                      <input value={localBatch.id} disabled={!canEdit || !isNew} onChange={e => handleChange('id', e.target.value)}
                        title={isNew ? undefined : 'Le numéro de lot ne se modifie pas après création'} className={cell} />
                    </Ligne>
                    <Ligne k="Type de produit">
                      <select value={selectedCatalogType} disabled={!canEdit} onChange={e => handleCatalogTypeChange(e.target.value)} className={cell}>
                        <option value="">—</option>
                        {[...new Set(productCatalog.map(p => p.type))].map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </Ligne>
                    <Ligne k="Nom produit"><Fige v={cat?.name || localBatch.product || '—'} /></Ligne>
                    <Ligne k="Référence"><Fige v={localBatch.reference || '—'} /></Ligne>
                    <Ligne k="Client">
                      <input list="batch-clients" value={localBatch.client || ''} disabled={!canEdit}
                        onChange={e => handleChange('client', e.target.value)} className={cell} />
                      <datalist id="batch-clients">{(clients || []).map(c => <option key={c} value={c} />)}</datalist>
                    </Ligne>
                  </Tab>

                  <Tab titre="Dates">
                    <Ligne k="Début fabrication">
                      <input type="date" value={localBatch.startDate || ''} disabled={!canEdit}
                        onChange={e => handleChange('startDate', e.target.value)} className={cell} />
                    </Ligne>
                    <Ligne k="Fin fabrication">
                      <input type="date" value={localBatch.endDate || ''} disabled={!canEdit}
                        onChange={e => handleChange('endDate', e.target.value)} className={cell} />
                    </Ligne>
                    <Ligne k="Livraison souhaitée">
                      <input type="date" value={localBatch.deliveryDate || ''} disabled={!canEdit}
                        onChange={e => handleChange('deliveryDate', e.target.value)} className={cell} />
                    </Ligne>
                    <Ligne k="Contenant"><Fige v={cat ? `${cat.contenant === 'SERINGUE' ? 'Seringue' : 'Flacon'} · ${cat.volume} mL` : '—'} /></Ligne>
                    <Ligne k="Conditionnement">
                      <Fige v={bo.condit > 0 ? `${bo.condit} par boîte` : <span className="text-amber-600">à renseigner</span>} />
                    </Ligne>
                  </Tab>
                </div>

                <Tab titre="Données de production">
                  <tr>
                    <td className="px-3 py-1.5 text-slate-500 w-[23%]">Volume du lot (L)</td>
                    <td className="px-3 py-1 w-[27%]"><input type="number" value={localBatch.volume ?? ''} disabled={!canEdit} onChange={e => handleChange('volume', Number(e.target.value))} className={cell} /></td>
                    <td className="px-3 py-1.5 text-slate-500 w-[23%]">Boîtes cible</td>
                    <td className="px-3 py-1 w-[27%]"><input type="number" value={localBatch.boxesTarget ?? ''} disabled={!canEdit} onChange={e => handleChange('boxesTarget', Number(e.target.value))} className={cell} /></td>
                  </tr>
                  <tr>
                    <td className="px-3 py-1.5 text-slate-500">{bo.contenant === 'seringues' ? 'Seringues remplies' : 'Flacons remplis'}</td>
                    <td className="px-3 py-1"><input type="number" value={localBatch.distributed ?? ''} disabled={!canEdit} onChange={e => handleChange('distributed', Number(e.target.value))} className={cell} /></td>
                    <td className="px-3 py-1.5 text-slate-500">{bo.contenant === 'seringues' ? 'Seringues conformes' : 'Flacons conformes'}</td>
                    <td className="px-3 py-1"><input type="number" value={localBatch.conform ?? ''} disabled={!canEdit} onChange={e => handleChange('conform', Number(e.target.value))} className={cell} /></td>
                  </tr>
                  <tr>
                    <td className="px-3 py-1.5 text-slate-500">Boîtes produites</td>
                    <td className="px-3 py-1">
                      <div className="flex items-center gap-2">
                        <input type="number" value={localBatch.sold ?? ''} disabled={!canEdit}
                          onChange={e => { handleChange('sold', Number(e.target.value)); handleChange('sold_manuel' as any, true); }} className={cell} />
                        <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded-full border whitespace-nowrap', bo.forcee ? TONS.orange : TONS.bleu)}>
                          {bo.forcee ? 'corrigé' : 'calculé'}
                        </span>
                        {canEdit && bo.forcee && bo.calculee !== null && (
                          <button onClick={() => { handleChange('sold', bo.calculee); handleChange('sold_manuel' as any, false); }}
                            title={`Revenir au calcul : ${bo.calculee}`} className="text-[11px] font-semibold text-blue-600 hover:underline whitespace-nowrap">recalculer</button>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-1.5 text-slate-500">Palettes à expédier</td>
                    <td className="px-3 py-1"><input type="number" value={localBatch.palettes ?? ''} disabled={!canEdit} onChange={e => handleChange('palettes', Number(e.target.value))} className={cell} /></td>
                  </tr>
                </Tab>
              </div>
            );
          })()}


          {/* SECTION 3: NOTES & OBSERVATIONS — fil de commentaires horodaté */}
          {tab === 'journal' && (
          <div className="mb-8">
            <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-4 border-b-2 border-slate-200 pb-2">Notes & Observations</h3>
            {(() => {
              // Lecture du fil depuis le lot live (rafraîchi après ajout), fallback sur le clone local.
              const liveBatch = batches.find(x => x.id === localBatch.id);
              const entries = (liveBatch?.noteEntries ?? localBatch.noteEntries) || [];
              const ordered = [...entries].reverse(); // plus récent en premier
              const isNewBatch = localBatch.id.startsWith('NEW');
              return (
                <>
                  {/* Fil de commentaires */}
                  {ordered.length === 0 ? (
                    <p className="text-sm text-slate-400 italic mb-4">Aucun commentaire pour l'instant.</p>
                  ) : (
                    <div className="flex flex-col gap-3 mb-4">
                      {ordered.map((entry, i) => (
                        <div key={i} className="border border-slate-200 rounded-lg px-4 py-3 bg-slate-50">
                          <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
                            <span className="font-bold text-slate-700">{entry.user}</span>
                            <span className="text-slate-300">·</span>
                            <span>{formatNoteDate(entry.at)}</span>
                          </div>
                          <p className="text-sm text-slate-700 whitespace-pre-wrap">{entry.text}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Zone d'ajout */}
                  <div className="flex flex-col gap-2">
                    <textarea
                      rows={2}
                      value={newNote}
                      onChange={e => setNewNote(e.target.value)}
                      disabled={isNewBatch || !canEdit}
                      placeholder="Ajouter un commentaire…"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none resize-y disabled:bg-slate-50 disabled:cursor-not-allowed"
                    />
                    {isNewBatch && (
                      <p className="text-xs text-slate-400">Enregistrez d'abord le lot pour ajouter des commentaires.</p>
                    )}
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={handleAddNote}
                        disabled={isNewBatch || !canEdit || savingNote || !newNote.trim()}
                        className="px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {savingNote ? 'Ajout…' : 'Ajouter le commentaire'}
                      </button>
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
          )}

          {/* SECTION 4: SUIVI 3 AXES (Étape process / Statut qualité / Santé délai) */}
          {tab === 'synthese' && (
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
                    const disabled = (ps.value === 'EXPEDIE' || ps.value === 'ATTENTE_ENLEVEMENT') && localBatch.quality_status !== 'LIBERE';
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
                      && localBatch.process_stage !== 'ATTENTE_ENLEVEMENT'
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

            {/* Fil de vie : qui s'en occupe, depuis quand, et ce qui bloque. */}
            <div className="grid grid-cols-3 gap-4 mt-4">
              <FormGroup label="Responsable">
                <input
                  list="batch-responsables"
                  value={localBatch.responsable || ''}
                  onChange={e => handleChange('responsable', e.target.value)}
                  disabled={!canEdit}
                  placeholder="qui s'occupe de ce lot ?"
                  className={cn("form-input", !canEdit && "bg-slate-50 cursor-not-allowed text-slate-500")}
                />
                <datalist id="batch-responsables">{responsablesConnus.map(r => <option key={r} value={r} />)}</datalist>
              </FormGroup>
              <FormGroup label="Dans cette étape depuis">
                <span className={cn(
                  "inline-flex items-center px-2.5 py-2 rounded-md text-sm font-semibold border",
                  ageEtape.j == null ? 'bg-slate-100 text-slate-500 border-slate-200'
                    : ageEtape.j >= 21 ? 'bg-red-100 text-red-700 border-red-200'
                    : ageEtape.j >= 10 ? 'bg-amber-100 text-amber-700 border-amber-200'
                    : 'bg-green-100 text-green-700 border-green-200'
                )}>{ageEtape.texte}</span>
              </FormGroup>
              <FormGroup label="Motif de blocage">
                <input
                  value={localBatch.blocage_motif || ''}
                  onChange={e => handleChange('blocage_motif', e.target.value)}
                  disabled={!canEdit}
                  placeholder="vide si rien ne bloque"
                  className={cn("form-input", !canEdit && "bg-slate-50 cursor-not-allowed text-slate-500")}
                />
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

            {/* Notification PRRC : étape Libération + qualité En cours → proposer d'alerter Farid (libération sous 5 j ouvrés). */}
            {localBatch.process_stage === 'LIBERATION' && localBatch.quality_status === 'EN_COURS' && (
              <div className="mt-4 flex items-center justify-between gap-3 px-3 py-3 bg-blue-50 border border-blue-200 rounded-md">
                <span className="text-sm text-blue-800">
                  Le lot est en <b>Libération</b> (qualité en cours). Notifie Farid que le DDL est prêt à libérer.
                  {notifiedAt
                    ? <span className="block mt-1 text-blue-900"><b>Notifié le {fmtDateTime(notifiedAt)}</b>{localBatch.prrcNotifiedBy ? ` par ${localBatch.prrcNotifiedBy}` : ''}.</span>
                    : <span className="block mt-1 text-blue-600">Pas encore notifié.</span>}
                </span>
                <button
                  onClick={() => {
                    // Trace du clic (l'email s'ouvre ensuite dans Outlook, l'envoi final reste manuel).
                    fetch(`${API_URL}/api/batches/${encodeURIComponent(localBatch.id)}/notify-prrc`, {
                      method: 'POST', headers: { Authorization: `Bearer ${token}` },
                    }).then(r => r.ok ? r.json() : null).then(d => { if (d?.notifiedAt) setNotifiedAt(d.notifiedAt); }).catch(() => {});
                    const type = productCatalog.find(p => p.ref === localBatch.reference)?.type || localBatch.product || '—';
                    const subject = `Libération requise sous 5 jours ouvrés – Lot ${localBatch.id} (${type})`;
                    const body =
`Bonjour Farid,

Le dossier de lot (DDL) du lot ci-dessous est désormais chargé dans le dossier OneDrive dédié. Merci de procéder à la libération du lot sous 5 jours ouvrés.

Détails du lot :
- Numéro de lot : ${localBatch.id}
- Type de produit : ${type}
- Nom du produit : ${localBatch.product || '—'}
- Client : ${localBatch.client || '—'}
- Référence : ${localBatch.reference || '—'}
- Début de fabrication : ${localBatch.startDate || '—'}

Le DDL est disponible dans le dossier OneDrive pour revue et validation. Merci de me confirmer la libération dans le délai imparti, ou de me signaler tout point bloquant.

Bien cordialement,
Assistant Maya
Agent IA travaillant avec Abdel HADJAB
Louna Aesthetics SAS`;
                    const url = `https://outlook.office.com/mail/deeplink/compose?to=${encodeURIComponent('f.hadjab@louna-aesthetics.com')}&cc=a.jebari@louna-aesthetics.com&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
                    const w = window.open('', '_blank'); if (w) w.location.href = url; else window.open(url, '_blank');
                  }}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 shrink-0"
                >
                  <Mail className="w-4 h-4" /> Notifier Farid — Libération sous 5 j
                </button>
              </div>
            )}

            {/* Libération qualité : le PRRC dépose un PDF dans le dossier 07-LIBERATION du lot sur SharePoint.
                Le bouton relit ces dossiers pour tous les lots et bascule en « Libéré » ceux qui sont en Libération / qualité En cours. */}
            {(localBatch.process_stage === 'LIBERATION' || localBatch.releaseDocUrl) && (
              <div className="mt-2 px-3 py-3 bg-slate-50 border border-slate-200 rounded-md">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-slate-700">
                    {localBatch.releaseDocUrl
                      ? <>Document de libération trouvé : <a href={localBatch.releaseDocUrl} target="_blank" rel="noopener noreferrer" className="text-blue-700 hover:underline font-medium">{localBatch.releaseDocName || 'PDF de libération'}</a></>
                      : <>Aucun document de libération trouvé pour ce lot sur SharePoint.</>}
                    {scanMsg && <span className="block mt-1 text-slate-500">{scanMsg}</span>}
                  </span>
                  {canEdit && (
                    <button
                      onClick={async () => {
                        setScanning(true); setScanMsg('');
                        try {
                          const r = await fetch(`${API_URL}/api/batches/scan-liberation`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
                          const d = await r.json().catch(() => ({}));
                          setScanMsg(r.ok
                            ? `${d.scanned} dossier(s) analysé(s) · ${d.released?.length || 0} lot(s) passé(s) en Libéré${d.released?.length ? ' : ' + d.released.join(', ') : ''}.`
                            : (d.error || 'Analyse impossible.'));
                          if (r.ok) await refreshData();
                        } catch { setScanMsg('Analyse impossible.'); }
                        finally { setScanning(false); }
                      }}
                      disabled={scanning}
                      className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50 shrink-0"
                    >
                      <RotateCcw className={cn('w-4 h-4', scanning && 'animate-spin')} />{scanning ? 'Analyse…' : 'Vérifier les libérations'}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Avertissement non bloquant : libération avec tests labo incomplets */}
            {localBatch.quality_status === 'LIBERE' && !computeTestsOk(localBatch.samples) && (
              <div className="mt-2 flex items-start gap-2 px-3 py-2 bg-orange-50 border border-orange-200 rounded-md text-sm text-orange-800">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-orange-500" />
                <span>Libération avec tests labo incomplets (tous les tests applicables ne sont pas encore « Conforme »).</span>
              </div>
            )}
          </div>
          )}

          {/* CONTRÔLES — vue résumée : 3 tests, 3 lignes. Le détail reste accessible en dessous. */}
          {/* ONGLET CONTRÔLES — une frise par test : théorique en gris, réel en gras. */}
          {tab === 'controles' && (() => {
            const auj = new Date().toISOString().split('T')[0];
            const jour = (d?: string | null) => d ? formatDate(d) : null;

            // Saisir une date fait avancer le statut, si la règle de transition l'autorise.
            const statutApres = (s: Sample, champ: string): SampleStatus | null => {
              if (champ === 'dateEnvoi' && s.status === 'A_ENVOYER' && isSampleTransitionAllowed(s.status, 'ENVOYE')) return 'ENVOYE';
              if (champ === 'dateResultatsRecus' && s.status === 'ENVOYE' && isSampleTransitionAllowed(s.status, 'RESULTATS_RECUS')) return 'RESULTATS_RECUS';
              return null;
            };
            const saisirDate = (i: number, s: Sample, champ: keyof Sample, libelle: string, defaut?: string | null) => {
              if (!canEdit) return;
              const d = prompt(`${libelle} — date :`, (s[champ] as string) || defaut || auj);
              if (d === null) return;
              handleSampleChange(i, champ, d.trim());
              const suite = d.trim() ? statutApres(s, champ as string) : null;
              if (suite) handleSampleChange(i, 'status', suite);
            };
            const verdict = (i: number, s: Sample, cible: SampleStatus) => {
              if (!canEdit) return;
              if (!isSampleTransitionAllowed(s.status, cible)) {
                alert(cible === 'CONFORME' || cible === 'NON_CONFORME'
                  ? "Saisis d'abord la date de réception des résultats."
                  : 'Transition non autorisée.');
                return;
              }
              if (cible === 'NON_CONFORME') {
                const m = prompt('Motif de non-conformité (obligatoire) :', s.motifNonConforme || '');
                if (m === null || !m.trim()) return;
                handleSampleChange(i, 'motifNonConforme', m.trim());
              }
              handleSampleChange(i, 'status', cible);
            };

            const applicables = (localBatch.samples || []).map((s, i) => ({ s, i })).filter(x => x.s.applicable);
            const conformes = applicables.filter(x => x.s.status === 'CONFORME').length;
            const petit = 'w-full text-xs border border-transparent rounded px-1.5 py-0.5 -mx-1.5 outline-none hover:border-slate-300 hover:bg-slate-50 focus:border-blue-500 focus:bg-white';

            return (
              <div className="mb-8">
                <div className="flex items-center justify-between mb-1 border-b-2 border-slate-200 pb-2">
                  <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider">Contrôles laboratoire</h3>
                  <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full border',
                    applicables.length && conformes === applicables.length ? TONS.vert : TONS.gris)}>
                    {applicables.length ? `${conformes}/${applicables.length} conformes` : 'aucun test applicable'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mb-4">
                  {canEdit ? 'Clique sur une étape pour saisir sa date. Le statut avance tout seul ; le verdict final reste ton choix.' : 'Avancement des tests.'}
                </p>

                <div className="space-y-3">
                  {applicables.map(({ s, i }) => {
                    const libelle = SAMPLE_TESTS.find(t => t.key === s.type)?.label || s.type;
                    const fini = s.status === 'CONFORME' || s.status === 'NON_CONFORME';
                    // 4 étapes : prélèvement, envoi, résultats, verdict. Prévu en gris, réel en gras.
                    const etapes = [
                      { lb: 'Prélèvement', prevu: s.dateReceptionEchantillon, reel: s.datePrelevementReel,
                        champ: 'datePrelevementReel' as keyof Sample, faite: !!s.datePrelevementReel },
                      { lb: 'Envoi labo', prevu: null, reel: s.dateEnvoi,
                        champ: 'dateEnvoi' as keyof Sample, faite: !!s.dateEnvoi },
                      { lb: 'Résultats', prevu: s.dateResultatsAttendue, reel: s.dateResultatsRecus,
                        champ: 'dateResultatsRecus' as keyof Sample, faite: !!s.dateResultatsRecus },
                    ];
                    const nbFaites = etapes.filter(e => e.faite).length + (fini ? 1 : 0);
                    const remplissage = Math.min(100, Math.max(0, (nbFaites - 0.5) / 3 * 100));
                    return (
                      <div key={s.type} className={cn('border rounded-lg overflow-hidden',
                        s.status === 'NON_CONFORME' ? 'border-red-300' : 'border-slate-200')}>
                        <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b border-slate-100">
                          <div>
                            <span className="text-sm font-semibold text-slate-800">{libelle}</span>
                            <span className="text-[11px] text-slate-400 ml-2">{s.partner}</span>
                          </div>
                          <Pastille texte={SAMPLE_STATUSES.find(st => st.value === s.status)?.label || s.status}
                            ton={s.status === 'CONFORME' ? 'vert' : s.status === 'NON_CONFORME' ? 'rouge' : s.status === 'A_ENVOYER' ? 'gris' : 'orange'} />
                        </div>

                        <div className="relative px-3 pt-3 pb-2">
                          <div className="absolute left-[calc(12.5%+12px)] right-[calc(12.5%+12px)] top-[22px] h-[3px] bg-slate-200 rounded" />
                          <div className="absolute left-[calc(12.5%+12px)] top-[22px] h-[3px] bg-green-500 rounded transition-all"
                            style={{ width: `calc((75% - 24px) * ${remplissage / 100})` }} />
                          <div className="relative flex justify-between">
                            {etapes.map((e, k) => (
                              <div key={k} onClick={() => saisirDate(i, s, e.champ, `${libelle} · ${e.lb}`, e.prevu)}
                                title={canEdit ? 'Cliquer pour saisir la date' : undefined}
                                className={cn('flex-1 text-center rounded-lg py-1', canEdit && 'cursor-pointer hover:bg-slate-50')}>
                                <div className={cn('w-4 h-4 rounded-full mx-auto mb-1.5 border-[3px] border-white',
                                  e.faite ? 'bg-green-500 ring-2 ring-green-500' : 'bg-white ring-2 ring-slate-300')} />
                                <div className="text-[11px] font-bold text-slate-700">{e.lb}</div>
                                {e.prevu && <div className="text-[10px] text-slate-400">prévu {jour(e.prevu)}</div>}
                                <div className={cn('text-[11px] font-bold', e.faite ? 'text-green-700' : 'text-slate-300')}>
                                  {e.faite ? jour(e.reel) : '—'}
                                </div>
                              </div>
                            ))}
                            {/* Verdict : décision qualité, jamais automatique. */}
                            <div className="flex-1 text-center py-1">
                              <div className={cn('w-4 h-4 rounded-full mx-auto mb-1.5 border-[3px] border-white',
                                s.status === 'CONFORME' ? 'bg-green-500 ring-2 ring-green-500'
                                  : s.status === 'NON_CONFORME' ? 'bg-red-500 ring-2 ring-red-500'
                                  : 'bg-white ring-2 ring-slate-300')} />
                              <div className="text-[11px] font-bold text-slate-700">Verdict</div>
                              {fini
                                ? <button onClick={() => verdict(i, s, 'RESULTATS_RECUS')} disabled={!canEdit}
                                    className={cn('text-[11px] font-bold', s.status === 'CONFORME' ? 'text-green-700' : 'text-red-600')}>
                                    {s.status === 'CONFORME' ? 'conforme' : 'non conforme'}
                                  </button>
                                : <div className="flex items-center justify-center gap-1 mt-0.5">
                                    <button onClick={() => verdict(i, s, 'CONFORME')} disabled={!canEdit}
                                      className="text-[10px] font-bold px-1.5 py-0.5 rounded border border-green-200 bg-green-50 text-green-700 hover:bg-green-100 disabled:opacity-40">Conforme</button>
                                    <button onClick={() => verdict(i, s, 'NON_CONFORME')} disabled={!canEdit}
                                      className="text-[10px] font-bold px-1.5 py-0.5 rounded border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-40">Non conf.</button>
                                  </div>}
                            </div>
                          </div>
                        </div>

                        {/* Traçabilité : rapport et certificat, discrets mais toujours là (exigence ISO 13485). */}
                        <div className="flex items-center gap-3 px-3 py-1.5 border-t border-slate-100 bg-slate-50/60">
                          <span className="text-[11px] text-slate-500 whitespace-nowrap">N° rapport</span>
                          <input value={s.rapportRef || ''} disabled={!canEdit} placeholder="—"
                            onChange={e => handleSampleChange(i, 'rapportRef', e.target.value)} className={cn(petit, 'max-w-[9rem]')} />
                          <span className="text-[11px] text-slate-500 whitespace-nowrap">Certificat</span>
                          <input value={s.rapportUrl || ''} disabled={!canEdit} placeholder="lien vers le document"
                            onChange={e => handleSampleChange(i, 'rapportUrl', e.target.value)} className={petit} />
                          {s.rapportUrl && <a href={s.rapportUrl} target="_blank" rel="noreferrer"
                            className="text-[11px] font-semibold text-blue-600 hover:underline whitespace-nowrap">ouvrir</a>}
                        </div>

                        {s.status === 'NON_CONFORME' && (
                          <div className="px-3 py-1.5 border-t border-red-200 bg-red-50 text-xs text-red-700">
                            <b>Motif :</b> {s.motifNonConforme || <span className="italic">non renseigné</span>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {!applicables.length && (
                    <div className="border border-slate-200 rounded-lg px-4 py-6 text-center text-sm text-slate-400">
                      Aucun test applicable pour ce produit.
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

        </div>
        
        <div className="p-6 border-t border-slate-200 bg-slate-50 flex justify-between items-center gap-3">
          <div>
            {isAdmin && !isNew && (
              <button onClick={handleDelete} className="px-4 py-2 text-sm font-medium text-red-600 bg-white border border-red-200 rounded-md hover:bg-red-50 transition-colors">
                Supprimer ce lot
              </button>
            )}
          </div>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors">
              Annuler
            </button>
            <button onClick={handleSave} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors">
              Enregistrer
            </button>
          </div>
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

// ---- Petits composants de présentation de la fiche ----
const TONS = {
  vert: 'bg-green-100 text-green-700 border-green-200',
  rouge: 'bg-red-100 text-red-700 border-red-200',
  orange: 'bg-amber-100 text-amber-700 border-amber-200',
  bleu: 'bg-blue-100 text-blue-700 border-blue-200',
  gris: 'bg-slate-100 text-slate-600 border-slate-200',
};

function Pastille({ texte, ton }: { texte: string; ton: keyof typeof TONS }) {
  return <span className={cn('inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border', TONS[ton])}>{texte}</span>;
}

// Tableau de synthèse : libellé, valeur, et une remarque colorée facultative.
function TableauResume({ titre, badge, lignes }:
  { titre: string; badge?: string; lignes: [string, string, { texte: string; ton: keyof typeof TONS } | null][] }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
        <span className="text-sm font-bold text-slate-500 uppercase tracking-wider">{titre}</span>
        {badge && <span className="text-xs font-semibold text-slate-600">{badge}</span>}
      </div>
      <table className="w-full text-sm">
        <tbody className="divide-y divide-slate-100">
          {lignes.map(([label, valeur, note], i) => (
            <tr key={i}>
              <td className="px-4 py-2 text-slate-500 w-1/2">{label}</td>
              <td className="px-4 py-2 font-medium text-slate-800 tabular-nums">{valeur}</td>
              <td className="px-4 py-2 text-right">
                {note && <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border', TONS[note.ton])}>{note.texte}</span>}
              </td>
            </tr>
          ))}
          {lignes.length === 0 && <tr><td colSpan={3} className="px-4 py-3 text-slate-400 text-sm">—</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
