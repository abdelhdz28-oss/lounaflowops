import React, { useState, useEffect } from 'react';
import { useAppContext } from '../AppContext';
import { cn } from '../utils/cn';
import { FluxConfig, SampleConfig, ProcessStage } from '../types';
import { SAMPLE_TESTS, PROCESS_STAGES, DEFAULT_SAMPLE_CONFIG } from '../constants';
import { Plus, Trash2 } from 'lucide-react';

// Étapes de prélèvement sélectionnables pour les tests labo
const SAMPLE_STAGE_OPTIONS = PROCESS_STAGES.filter(p => p.value !== 'EXPEDIE');

export function SettingsView() {
  const { fluxConfig, sampleConfig, samplePartners, updateSettings, updateSampleConfig, updateSamplePartners, resetData } = useAppContext();
  const [localConfig, setLocalConfig] = useState<Record<string, FluxConfig>>({});
  const [localSampleConfig, setLocalSampleConfig] = useState<SampleConfig>(DEFAULT_SAMPLE_CONFIG);
  const [localPartners, setLocalPartners] = useState<string[]>([]);
  const [newPartner, setNewPartner] = useState('');
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
    <div className="p-8 flex-1 overflow-y-auto bg-slate-50">
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-lg font-semibold text-slate-800">Configuration des Produits & Leadtimes</h3>
        <button 
          onClick={handleSave}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors"
        >
          Enregistrer les modifications
        </button>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 mb-8">
        {Object.entries(localConfig).map(([key, flux]: [string, FluxConfig]) => {
          const totalWeeks = flux.steps.reduce((acc, step) => acc + (flux.durations[step] || 0), 0);
          
          let totalColor = 'text-green-600';
          if (totalWeeks > 8) totalColor = 'text-orange-500';
          if (totalWeeks > 10) totalColor = 'text-red-600';

          return (
            <div key={key} className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col shadow-sm">
              <h4 className="text-base font-bold text-blue-600 mb-4">{flux.name}</h4>
              
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
