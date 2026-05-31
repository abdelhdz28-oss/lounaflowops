import React, { useState, useEffect } from 'react';
import { useAppContext } from '../AppContext';
import { cn } from '../utils/cn';
import { FluxConfig } from '../types';

export function SettingsView() {
  const { fluxConfig, updateSettings, resetData } = useAppContext();
  const [localConfig, setLocalConfig] = useState<Record<string, FluxConfig>>({});
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetPassword, setResetPassword] = useState('');

  useEffect(() => {
    setLocalConfig(JSON.parse(JSON.stringify(fluxConfig)));
  }, [fluxConfig]);

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

  const handleSave = async () => {
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
          const totalWeeks = Object.values(flux.durations).reduce((a: number, b: number) => a + b, 0);
          
          let totalColor = 'text-green-600';
          if (totalWeeks > 8) totalColor = 'text-orange-500';
          if (totalWeeks > 10) totalColor = 'text-red-600';

          return (
            <div key={key} className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col shadow-sm">
              <h4 className="text-base font-bold text-blue-600 mb-4">{flux.name}</h4>
              
              <div className="flex-1 flex flex-col gap-3 mb-6">
                {flux.steps.map(step => {
                  const displayLabel = step === '-' ? 'Nettoyage' : step;
                  return (
                    <div key={step} className="flex justify-between items-center pb-3 border-b border-dashed border-slate-200 last:border-0 last:pb-0">
                      <label className="text-sm font-medium text-slate-700">{displayLabel}</label>
                      <div className="flex items-center gap-2">
                        <input 
                          type="number" 
                          min="1" 
                          value={flux.durations[step]} 
                          onChange={(e) => handleDurationChange(key, step, e.target.value)}
                          className="w-16 px-2 py-1 text-center text-sm border border-slate-300 rounded focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                        />
                        <span className="text-xs text-slate-500">semaines</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              
              <div className="bg-blue-50 p-4 rounded-lg flex justify-between items-center border border-blue-100">
                <div className="text-xs font-semibold text-slate-600 uppercase tracking-wider">LEADTIME TOTAL</div>
                <div className={cn("text-2xl font-extrabold", totalColor)}>{totalWeeks} sem</div>
              </div>
            </div>
          );
        })}
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
