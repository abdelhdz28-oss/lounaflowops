import React, { useState, useEffect } from 'react';
import { useAppContext } from '../AppContext';
import { cn } from '../utils/cn';
import { FluxConfig, SampleConfig, ProcessStage, ProductCatalogEntry } from '../types';
import { SAMPLE_TESTS, PROCESS_STAGES, DEFAULT_SAMPLE_CONFIG } from '../constants';
import { Plus, Trash2 } from 'lucide-react';
import { MayaSkillsPanel } from '../components/MayaSkillsPanel';

// Étapes de prélèvement sélectionnables pour les tests labo
const SAMPLE_STAGE_OPTIONS = PROCESS_STAGES.filter(p => p.value !== 'EXPEDIE');

// F9 : étapes par défaut d'une carte lead time créée à la volée (éditables ensuite).
const DEFAULT_LEADTIME_STEPS = ['Nettoyage', 'Formulation', 'Mirage', 'Conditionnement', 'Libération'];
const fluxSlug = (s: string) => s.trim().replace(/\s+/g, '_').replace(/[^0-9A-Za-zÀ-ÿ_-]/g, '') || 'Produit';

export function SettingsView() {
  const { fluxConfig, sampleConfig, samplePartners, productCatalog, updateSettings, updateSampleConfig, updateSamplePartners, updateProductCatalog, resetData } = useAppContext();
  const [localConfig, setLocalConfig] = useState<Record<string, FluxConfig>>({});
  const [localSampleConfig, setLocalSampleConfig] = useState<SampleConfig>(DEFAULT_SAMPLE_CONFIG);
  const [localPartners, setLocalPartners] = useState<string[]>([]);
  const [newPartner, setNewPartner] = useState('');
  const [localCatalog, setLocalCatalog] = useState<ProductCatalogEntry[]>([]);
  const [leadTimeFor, setLeadTimeFor] = useState<Set<number>>(new Set());  // F9 : lignes catalogue à doter d'une carte lead time
  const [highlightFlux, setHighlightFlux] = useState<string | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetPassword, setResetPassword] = useState('');

  useEffect(() => {
    if (fluxConfig) {
      // Map any "-" step to "Nettoyage" on load so the internal state aligns with display
      const mapped = JSON.parse(JSON.stringify(fluxConfig));
      Object.keys(mapped).forEach(key => {
        const flux = mapped[key];
        flux.steps = flux.steps.map((step: string) => {
          if (step === '-') {
            if (flux.durations['-'] !== undefined) {
              flux.durations['Nettoyage'] = flux.durations['-'];
              delete flux.durations['-'];
            }
            return 'Nettoyage';
          }
          return step;
        });
      });
      setLocalConfig(mapped);
    }
  }, [fluxConfig]);

  useEffect(() => {
    if (sampleConfig) {
      setLocalSampleConfig(JSON.parse(JSON.stringify(sampleConfig)));
    }
  }, [sampleConfig]);

  useEffect(() => {
    setLocalPartners([...(samplePartners || [])]);
  }, [samplePartners]);

  useEffect(() => {
    setLocalCatalog(JSON.parse(JSON.stringify(productCatalog || [])));
  }, [productCatalog]);

  const handleCatalogChange = (idx: number, field: keyof ProductCatalogEntry, value: string) => {
    setLocalCatalog(prev => {
      const next = [...prev];
      const entry = { ...next[idx] };
      if (field === 'condit' || field === 'volume') {
        const num = parseFloat(value);
        (entry[field] as number) = isNaN(num) ? 0 : num;
      } else if (field === 'contenant') {
        entry.contenant = value as ProductCatalogEntry['contenant'];
      } else {
        (entry[field] as string) = value;
      }
      next[idx] = entry;
      return next;
    });
  };

  const handleAddCatalogRow = () => {
    setLocalCatalog(prev => [...prev, { type: '', name: '', ref: '', condit: 1, contenant: 'FLACON', volume: 0 }]);
  };

  const handleDeleteCatalogRow = (idx: number) => {
    setLocalCatalog(prev => prev.filter((_, i) => i !== idx));
    setLeadTimeFor(prev => { const n = new Set<number>(); prev.forEach(i => { if (i < idx) n.add(i); else if (i > idx) n.add(i - 1); }); return n; });
  };

  const toggleLeadTime = (idx: number) => {
    setLeadTimeFor(prev => { const n = new Set(prev); n.has(idx) ? n.delete(idx) : n.add(idx); return n; });
  };

  const handleSaveCatalog = async () => {
    const ok = await updateProductCatalog(localCatalog);
    if (!ok) { alert('Erreur lors de l\'enregistrement.'); return; }
    // F9 : créer les cartes lead time demandées pour les produits cochés.
    const wanted = [...leadTimeFor].map(idx => localCatalog[idx]).filter(Boolean)
      .filter(e => (e.name || e.type || e.ref || '').trim());
    if (wanted.length === 0) { alert('Catalogue produits enregistré !'); return; }
    const nextFlux: Record<string, FluxConfig> = { ...localConfig };
    const created: string[] = [];
    let skipped = 0;
    for (const e of wanted) {
      const label = (e.name || e.type || e.ref).trim();
      if (Object.values(nextFlux).some(f => f.name.trim().toLowerCase() === label.toLowerCase())) { skipped++; continue; }
      let key = fluxSlug(label); let n = 2;
      while (nextFlux[key]) { key = `${fluxSlug(label)}_${n}`; n++; }
      nextFlux[key] = { name: label, steps: [...DEFAULT_LEADTIME_STEPS], durations: Object.fromEntries(DEFAULT_LEADTIME_STEPS.map(s => [s, 1])) };
      created.push(key);
    }
    setLeadTimeFor(new Set());
    if (created.length === 0) { alert(`Catalogue enregistré. Carte(s) lead time déjà existante(s) pour ce(s) produit(s).`); return; }
    const ok2 = await updateSettings(nextFlux);
    if (ok2) {
      setHighlightFlux(created[0]);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    const suffix = skipped ? ` (${skipped} déjà existante(s))` : '';
    alert(ok2 ? `Catalogue enregistré. ${created.length} carte(s) lead time créée(s)${suffix}.` : 'Catalogue enregistré, mais échec de création des cartes lead time.');
  };

  const handleAddPartner = () => {
    const trimmed = newPartner.trim();
    if (!trimmed) return;
    if (localPartners.includes(trimmed)) {
      alert('Ce partenaire existe déjà !');
      return;
    }
    setLocalPartners(prev => [...prev, trimmed]);
    setNewPartner('');
  };

  const handleDeletePartner = (name: string) => {
    setLocalPartners(prev => prev.filter(p => p !== name));
  };

  const handleSavePartners = async () => {
    const ok = await updateSamplePartners(localPartners);
    alert(ok ? 'Partenaires enregistrés !' : 'Erreur lors de l\'enregistrement.');
  };

  const handleSampleMappingChange = (testKey: string, stage: ProcessStage) => {
    setLocalSampleConfig(prev => ({
      ...prev,
      mapping: { ...prev.mapping, [testKey]: stage }
    }));
  };

  const handleSampleLeadChange = (testKey: string, value: string) => {
    const num = parseInt(value, 10);
    setLocalSampleConfig(prev => ({
      ...prev,
      analysisLeadDays: { ...prev.analysisLeadDays, [testKey]: isNaN(num) ? 0 : num }
    }));
  };

  const handleSaveSampleConfig = async () => {
    const ok = await updateSampleConfig(localSampleConfig);
    alert(ok ? 'Paramètres échantillons enregistrés !' : 'Erreur lors de l\'enregistrement.');
  };

  const handleDurationChange = (key: string, step: string, value: string) => {
    const num = parseInt(value, 10);
    if (!isNaN(num)) {
      setLocalConfig(prev => ({
        ...prev,
        [key]: {
          ...prev[key],
          durations: {
            ...prev[key].durations,
            [step]: num
          }
        }
      }));
    }
  };

  const handleStepNameChange = (fluxKey: string, idx: number, newName: string) => {
    setLocalConfig(prev => {
      const current = prev[fluxKey];
      if (!current) return prev;

      const oldName = current.steps[idx];
      if (oldName === newName) return prev;

      const newSteps = [...current.steps];
      newSteps[idx] = newName;

      const newDurations = { ...current.durations };
      if (oldName in newDurations) {
        newDurations[newName] = newDurations[oldName];
        delete newDurations[oldName];
      } else {
        newDurations[newName] = 1;
      }

      return {
        ...prev,
        [fluxKey]: {
          ...current,
          steps: newSteps,
          durations: newDurations
        }
      };
    });
  };

  const handleAddStep = (fluxKey: string) => {
    setLocalConfig(prev => {
      const current = prev[fluxKey];
      if (!current) return prev;

      let baseName = "Nouvelle étape";
      let name = baseName;
      let counter = 1;
      while (current.steps.includes(name)) {
        name = `${baseName} ${counter}`;
        counter++;
      }

      return {
        ...prev,
        [fluxKey]: {
          ...current,
          steps: [...current.steps, name],
          durations: {
            ...current.durations,
            [name]: 1
          }
        }
      };
    });
  };

  const handleDeleteStep = (fluxKey: string, idx: number) => {
    setLocalConfig(prev => {
      const current = prev[fluxKey];
      if (!current) return prev;
      if (current.steps.length <= 1) {
        alert("Impossible de supprimer la seule étape restante d'un flux.");
        return prev;
      }
      const stepToDelete = current.steps[idx];
      const newSteps = current.steps.filter((_, i) => i !== idx);
      const newDurations = { ...current.durations };
      delete newDurations[stepToDelete];

      return {
        ...prev,
        [fluxKey]: {
          ...current,
          steps: newSteps,
          durations: newDurations
        }
      };
    });
  };

  const handleSave = async () => {
    // Validate that no step name is empty and there are no duplicates
    for (const [key, flux] of Object.entries(localConfig) as [string, FluxConfig][]) {
      if (flux.steps.some(step => !step.trim())) {
        alert(`Veuillez renseigner tous les noms d'étapes pour le produit "${flux.name}".`);
        return;
      }
      const uniqueSteps = new Set(flux.steps.map(s => s.trim()));
      if (uniqueSteps.size !== flux.steps.length) {
        alert(`Chaque étape doit avoir un nom unique pour le produit "${flux.name}".`);
        return;
      }
    }

    await updateSettings(localConfig);
    alert('Paramètres enregistrés !');
  };

  // Génère une carte lead time pour chaque produit du catalogue enregistré qui n'en a pas encore.
  const handleGenerateLeadtimesFromCatalog = async () => {
    const source = productCatalog || [];
    if (source.length === 0) { alert('Le catalogue produits est vide. Ajoute d\'abord des produits (et enregistre-les).'); return; }
    const nextFlux: Record<string, FluxConfig> = { ...localConfig };
    const created: string[] = [];
    let skipped = 0;
    for (const e of source) {
      const label = (e.name || e.type || e.ref || '').trim();
      if (!label) continue;
      if (Object.values(nextFlux).some(f => f.name.trim().toLowerCase() === label.toLowerCase())) { skipped++; continue; }
      let key = fluxSlug(label); let n = 2;
      while (nextFlux[key]) { key = `${fluxSlug(label)}_${n}`; n++; }
      nextFlux[key] = { name: label, steps: [...DEFAULT_LEADTIME_STEPS], durations: Object.fromEntries(DEFAULT_LEADTIME_STEPS.map(s => [s, 1])) };
      created.push(key);
    }
    if (created.length === 0) { alert('Toutes les cartes lead time existent déjà pour les produits du catalogue.'); return; }
    if (!confirm(`Créer ${created.length} carte(s) lead time depuis le catalogue produits ?${skipped ? ` (${skipped} produit(s) ont déjà une carte)` : ''}`)) return;
    const ok = await updateSettings(nextFlux);
    if (ok) { setHighlightFlux(created[0]); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    alert(ok ? `${created.length} carte(s) lead time créée(s) depuis le catalogue.` : 'Échec de la création.');
  };

  const handleReset = async () => {
    const success = await resetData(resetPassword);
    if (success) {
      alert('Données réinitialisées avec succès.');
      setShowResetConfirm(false);
      setResetPassword('');
    } else {
      alert('Mot de passe incorrect.');
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 flex-1 overflow-y-auto bg-slate-50">
      <div className="flex flex-wrap justify-between items-center gap-2 mb-6">
        <h3 className="text-lg font-semibold text-slate-800">Configuration des Produits & Leadtimes</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={handleGenerateLeadtimesFromCatalog}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 transition-colors"
            title="Créer une carte lead time pour chaque produit du catalogue qui n'en a pas encore"
          >
            <Plus className="w-4 h-4" /> Générer depuis le catalogue produits
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors"
          >
            Enregistrer les modifications
          </button>
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 mb-8">
        {Object.entries(localConfig).map(([key, flux]: [string, FluxConfig]) => {
          const totalWeeks = flux.steps.reduce((acc, step) => acc + (flux.durations[step] || 0), 0);
          
          let totalColor = 'text-green-600';
          if (totalWeeks > 8) totalColor = 'text-orange-500';
          if (totalWeeks > 10) totalColor = 'text-red-600';

          return (
            <div key={key} className={cn("bg-white border rounded-xl p-6 flex flex-col shadow-sm transition-colors", highlightFlux === key ? "border-blue-500 ring-2 ring-blue-300" : "border-slate-200")}>
              <h4 className="text-base font-bold text-blue-600 mb-4">{flux.name}{highlightFlux === key && <span className="ml-2 text-xs font-normal text-blue-500">· nouvelle carte</span>}</h4>
              
              <div className="flex-1 flex flex-col gap-3 mb-6">
                {flux.steps.map((step, idx) => {
                  return (
                    <div key={idx} className="flex justify-between items-center gap-2 pb-3 border-b border-dashed border-slate-200 last:border-0 last:pb-0">
                      <input 
                        type="text" 
                        value={step} 
                        onChange={(e) => handleStepNameChange(key, idx, e.target.value)}
                        className="flex-1 min-w-0 px-2 py-1 text-sm border border-slate-200 rounded focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none font-medium text-slate-700"
                        placeholder="Nom de l'étape"
                      />
                      <div className="flex items-center gap-1.5 shrink-0">
                        <input 
                          type="number" 
                          min="1" 
                          value={flux.durations[step] !== undefined ? flux.durations[step] : 1} 
                          onChange={(e) => handleDurationChange(key, step, e.target.value)}
                          className="w-14 px-1.5 py-1 text-center text-sm border border-slate-300 rounded focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                        />
                        <span className="text-xs text-slate-500">sem</span>
                      </div>
                      <button 
                        type="button"
                        onClick={() => handleDeleteStep(key, idx)}
                        className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors shrink-0"
                        title="Supprimer cette étape"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}

                <button
                  type="button"
                  onClick={() => handleAddStep(key)}
                  className="w-full py-2 border border-dashed border-slate-300 rounded-lg text-slate-500 hover:text-blue-600 hover:border-blue-500 hover:bg-blue-50/50 flex justify-center items-center gap-1.5 transition-all text-xs font-medium mt-2"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Ajouter une étape
                </button>
              </div>
              
              <div className="bg-blue-50 p-4 rounded-lg flex justify-between items-center border border-blue-100">
                <div className="text-xs font-semibold text-slate-600 uppercase tracking-wider">LEADTIME TOTAL</div>
                <div className={cn("text-2xl font-extrabold", totalColor)}>{totalWeeks} sem</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm mb-8">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-slate-800">Paramètres Échantillons / Tests</h3>
          <button
            onClick={handleSaveSampleConfig}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors"
          >
            Enregistrer
          </button>
        </div>
        <p className="text-sm text-slate-500 mb-4">
          Étape de prélèvement (où l'échantillon est prélevé dans le flux) et délai d'analyse (envoi → résultats) pour chaque test labo.
        </p>
        <label className="flex items-start gap-2 mb-4 p-3 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer">
          <input
            type="checkbox"
            checked={!!localSampleConfig.businessDays}
            onChange={e => setLocalSampleConfig(prev => ({ ...prev, businessDays: e.target.checked }))}
            className="mt-0.5"
          />
          <span className="text-sm text-slate-700">
            <span className="font-semibold">Calcul des dates en jours ouvrés</span>
            <span className="block text-xs text-slate-500">
              Si activé, les calculs de dates (réception et résultats) sautent les samedis et dimanches. Les jours fériés ne sont pas gérés.
            </span>
          </span>
        </label>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {SAMPLE_TESTS.map(t => (
            <div key={t.key} className="border border-slate-200 rounded-lg p-4 flex flex-col gap-3">
              <h4 className="text-sm font-bold text-blue-600">{t.label}</h4>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-600">Étape de prélèvement</label>
                <select
                  value={localSampleConfig.mapping?.[t.key] || t.defaultStage}
                  onChange={e => handleSampleMappingChange(t.key, e.target.value as ProcessStage)}
                  className="px-2 py-1.5 text-sm border border-slate-300 rounded focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                >
                  {SAMPLE_STAGE_OPTIONS.map(ps => (
                    <option key={ps.value} value={ps.value}>{ps.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-600">Délai d'analyse (jours)</label>
                <input
                  type="number"
                  min="0"
                  value={localSampleConfig.analysisLeadDays?.[t.key] ?? 0}
                  onChange={e => handleSampleLeadChange(t.key, e.target.value)}
                  className="w-24 px-2 py-1.5 text-sm border border-slate-300 rounded focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm mb-8">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-slate-800">Partenaires / Laboratoires</h3>
          <button
            onClick={handleSavePartners}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors"
          >
            Enregistrer
          </button>
        </div>
        <p className="text-sm text-slate-500 mb-4">
          Liste des partenaires / laboratoires sélectionnables pour chaque test d'échantillon.
        </p>
        <div className="flex flex-col gap-2 mb-4">
          {localPartners.length === 0 && (
            <p className="text-sm text-slate-400 italic">Aucun partenaire configuré.</p>
          )}
          {localPartners.map(p => (
            <div key={p} className="flex justify-between items-center gap-2 px-3 py-2 border border-slate-200 rounded-lg">
              <span className="text-sm font-medium text-slate-700">{p}</span>
              <button
                type="button"
                onClick={() => handleDeletePartner(p)}
                className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors shrink-0"
                title="Supprimer ce partenaire"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={newPartner}
            onChange={e => setNewPartner(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddPartner(); } }}
            placeholder="Nom du partenaire / laboratoire"
            className="flex-1 px-3 py-2 text-sm border border-slate-300 rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
          />
          <button
            type="button"
            onClick={handleAddPartner}
            className="px-3 py-2 bg-blue-50 border border-blue-200 text-blue-600 rounded-md hover:bg-blue-100 transition-colors flex items-center gap-1.5 shrink-0 text-sm font-medium"
          >
            <Plus className="w-4 h-4" />
            Ajouter
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm mb-8">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-slate-800">Catalogue Produits</h3>
          <button
            onClick={handleSaveCatalog}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors"
          >
            Enregistrer
          </button>
        </div>
        <p className="text-sm text-slate-500 mb-3">
          Types de produits, références et variantes de conditionnement. Utilisé pour l'auto-remplissage des fiches lot et le calcul du rendement de production.
          Cochez « Carte lead time » sur un produit pour créer automatiquement sa fiche de délais (en haut de page) à l'enregistrement.
        </p>
        <p className="text-sm text-slate-600 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 mb-3">
          <b>« Contenants par boîte »</b> sert à calculer les boîtes produites de chaque lot : 3 flacons par boîte,
          1 ou 2 seringues selon la référence. Sans ce nombre, le calcul est désactivé et les boîtes doivent être saisies à la main.
        </p>
        {(() => {
          const sansCondit = localCatalog.filter(e => !(Number(e.condit) > 0));
          if (!sansCondit.length) return null;
          return (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
              <b>{sansCondit.length} produit(s) sans conditionnement</b> — le calcul des boîtes est désactivé pour leurs lots :{' '}
              {sansCondit.map(e => e.name || e.ref || e.type || '(sans nom)').join(', ')}
            </p>
          );
        })()}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="py-2 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Type</th>
                <th className="py-2 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Nom</th>
                <th className="py-2 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Référence</th>
                <th className="py-2 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider" title="Nombre de flacons ou de seringues dans une boîte">Contenants par boîte</th>
                <th className="py-2 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Contenant</th>
                <th className="py-2 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Volume contenant (mL)</th>
                <th className="py-2 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider text-center">Carte lead time</th>
                <th className="py-2 px-3"></th>
              </tr>
            </thead>
            <tbody>
              {localCatalog.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-3 px-3 text-sm text-slate-400 italic">Aucun produit configuré.</td>
                </tr>
              )}
              {localCatalog.map((entry, idx) => (
                <tr key={idx} className="border-b border-slate-100">
                  <td className="py-2 px-3">
                    <input
                      type="text"
                      value={entry.type}
                      onChange={e => handleCatalogChange(idx, 'type', e.target.value)}
                      className="w-full px-2 py-1 text-sm border border-slate-300 rounded focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                    />
                  </td>
                  <td className="py-2 px-3">
                    <input
                      type="text"
                      value={entry.name}
                      onChange={e => handleCatalogChange(idx, 'name', e.target.value)}
                      className="w-full px-2 py-1 text-sm border border-slate-300 rounded focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                    />
                  </td>
                  <td className="py-2 px-3">
                    <input
                      type="text"
                      value={entry.ref}
                      onChange={e => handleCatalogChange(idx, 'ref', e.target.value)}
                      className="w-full px-2 py-1 text-sm border border-slate-300 rounded focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none font-mono"
                    />
                  </td>
                  <td className="py-2 px-3">
                    <input
                      type="number"
                      min="0"
                      value={entry.condit}
                      onChange={e => handleCatalogChange(idx, 'condit', e.target.value)}
                      title={Number(entry.condit) > 0 ? 'Nombre de contenants dans une boîte' : 'À renseigner : sans ce nombre, les boîtes produites ne se calculent pas'}
                      className={cn('w-20 px-2 py-1 text-sm border rounded focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none',
                        Number(entry.condit) > 0 ? 'border-slate-300' : 'border-amber-400 bg-amber-50')}
                    />
                  </td>
                  <td className="py-2 px-3">
                    <select
                      value={entry.contenant}
                      onChange={e => handleCatalogChange(idx, 'contenant', e.target.value)}
                      className="px-2 py-1 text-sm border border-slate-300 rounded focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                    >
                      <option value="FLACON">FLACON</option>
                      <option value="SERINGUE">SERINGUE</option>
                    </select>
                  </td>
                  <td className="py-2 px-3">
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={entry.volume}
                      onChange={e => handleCatalogChange(idx, 'volume', e.target.value)}
                      className="w-24 px-2 py-1 text-sm border border-slate-300 rounded focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                    />
                  </td>
                  <td className="py-2 px-3 text-center">
                    <input
                      type="checkbox"
                      checked={leadTimeFor.has(idx)}
                      onChange={() => toggleLeadTime(idx)}
                      title="Créer une carte lead time associée à ce produit lors de l'enregistrement"
                      className="h-4 w-4 cursor-pointer"
                    />
                  </td>
                  <td className="py-2 px-3">
                    <button
                      type="button"
                      onClick={() => handleDeleteCatalogRow(idx)}
                      className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                      title="Supprimer cette ligne"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          type="button"
          onClick={handleAddCatalogRow}
          className="mt-4 w-full py-2 border border-dashed border-slate-300 rounded-lg text-slate-500 hover:text-blue-600 hover:border-blue-500 hover:bg-blue-50/50 flex justify-center items-center gap-1.5 transition-all text-sm font-medium"
        >
          <Plus className="w-4 h-4" />
          Ajouter un type de produit
        </button>
      </div>

      <MayaSkillsPanel />

      <div className="bg-red-50 border border-red-200 rounded-xl p-6 shadow-sm">
        <h4 className="text-base font-bold text-red-600 mb-2">Zone de danger</h4>
        <p className="text-sm text-red-800 mb-4">
          La réinitialisation supprimera tous les lots et livraisons, et remettra les paramètres à zéro. Cette action est irréversible.
        </p>
        
        {!showResetConfirm ? (
          <button 
            onClick={() => setShowResetConfirm(true)}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 transition-colors"
          >
            Réinitialiser toutes les données
          </button>
        ) : (
          <div className="flex items-center gap-3">
            <input 
              type="password" 
              placeholder="Mot de passe" 
              value={resetPassword}
              onChange={(e) => setResetPassword(e.target.value)}
              className="px-3 py-2 text-sm border border-red-300 rounded-md focus:border-red-500 focus:ring-1 focus:ring-red-500 outline-none"
            />
            <button 
              onClick={handleReset}
              className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 transition-colors"
            >
              Confirmer
            </button>
            <button 
              onClick={() => { setShowResetConfirm(false); setResetPassword(''); }}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors"
            >
              Annuler
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
