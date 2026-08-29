import React, { useState } from 'react';
import { useAppContext } from '../AppContext';
import { useAuth } from '../AuthContext';
import { PROCESS_STAGES } from '../constants';
import { cn } from '../utils/cn';
import { Batch, ProcessStage } from '../types';

interface KanbanViewProps {
  onOpenBatch: (id: string) => void;
}

// Couleur de la carte selon l'OTD : vert = on track, orange = à risque, rouge = en retard.
const HEALTH_CARD: Record<string, { border: string; bg: string; bar: string }> = {
  ON_TRACK: { border: 'border-l-green-500', bg: 'bg-green-50', bar: 'bg-green-500' },
  AT_RISK: { border: 'border-l-orange-500', bg: 'bg-orange-50', bar: 'bg-orange-500' },
  EN_RETARD: { border: 'border-l-red-500', bg: 'bg-red-50', bar: 'bg-red-500' },
};

export function KanbanView({ onOpenBatch }: KanbanViewProps) {
  const { batches, productCatalog, updateBatch } = useAppContext();
  const { canEdit } = useAuth();
  // Un lot clôturé est terminé : il n'a plus sa place sur le tableau d'avancement.
  const list = (Array.isArray(batches) ? batches : []).filter(b => !b.cloture);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);

  const handleDrop = async (targetStage: ProcessStage) => {
    const id = draggingId;
    setDragOverStage(null);
    setDraggingId(null);
    if (!id) return;
    const batch = list.find(b => b.id === id);
    if (!batch || batch.process_stage === targetStage) return;

    // Progression alignée sur l'étape (même calcul que la fiche).
    const stageIdx = PROCESS_STAGES.findIndex(s => s.value === targetStage);
    const progress = Math.round((stageIdx / (PROCESS_STAGES.length - 1)) * 100);

    const updates: Partial<Batch> = { process_stage: targetStage, progress };
    // Auto-lien statut qualité (miroir de la fiche) : Planifié = non démarré ; sinon on démarre.
    if (targetStage === 'PLANIFIE') updates.quality_status = 'NOT_STARTED';
    else if (batch.quality_status === 'NOT_STARTED') updates.quality_status = 'EN_COURS';

    const res = await updateBatch(id, updates);
    if (!res.ok) {
      alert(res.error || "Déplacement refusé. L'étape « Expédié » exige un lot « Libéré ». Vérifie le statut qualité ou tes droits d'accès.");
    }
  };

  return (
    <div className="p-6 flex-1 overflow-auto bg-slate-50">
      <div className="flex gap-4 min-w-max items-start">
        {PROCESS_STAGES.map(stage => {
          const cards = list.filter(b => b && b.process_stage === stage.value);
          const isDropTarget = dragOverStage === stage.value;
          return (
            <div
              key={stage.value}
              className="w-72 shrink-0 flex flex-col"
              onDragOver={canEdit ? (e) => { e.preventDefault(); setDragOverStage(stage.value); } : undefined}
              onDragLeave={() => { if (dragOverStage === stage.value) setDragOverStage(null); }}
              onDrop={canEdit ? () => handleDrop(stage.value) : undefined}
            >
              <div className="flex items-center justify-between px-3 py-2 mb-3 bg-white border border-slate-200 rounded-lg">
                <span className="text-sm font-semibold text-slate-700">{stage.label}</span>
                <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">{cards.length}</span>
              </div>

              <div className={cn(
                'flex flex-col gap-3 rounded-lg min-h-[80px] transition-colors',
                isDropTarget && 'bg-blue-50 ring-2 ring-blue-300 ring-inset p-1'
              )}>
                {cards.map(b => {
                  const health = HEALTH_CARD[b.schedule_health] || HEALTH_CARD.ON_TRACK;
                  const type = productCatalog.find(p => p.ref === b.reference)?.type || b.product || '—';
                  const progress = b.progress ?? 0;
                  return (
                    <button
                      key={b.id}
                      draggable={canEdit}
                      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; setDraggingId(b.id); }}
                      onDragEnd={() => { setDraggingId(null); setDragOverStage(null); }}
                      onClick={() => onOpenBatch(b.id)}
                      className={cn(
                        'text-left w-full border border-slate-200 border-l-4 rounded-lg p-3 shadow-sm hover:shadow-md transition-shadow',
                        canEdit && 'cursor-grab active:cursor-grabbing',
                        health.border, health.bg,
                        draggingId === b.id && 'opacity-40'
                      )}
                    >
                      <div className="font-bold text-blue-600 text-sm">{b.id}</div>
                      <div className="text-xs font-medium text-slate-800 mt-1">{type}</div>
                      <div className="text-xs text-slate-500">{b.client || '—'}</div>
                      <div className="text-xs text-slate-500 mt-1">
                        Boîtes cible : <span className="font-medium text-slate-700">{(b.boxesTarget ?? 0).toLocaleString()}</span>
                      </div>
                      <div className="mt-2">
                        <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
                          <div className={cn('h-full rounded-full', health.bar)} style={{ width: `${progress}%` }} />
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5">{progress}%</div>
                      </div>
                    </button>
                  );
                })}

                {cards.length === 0 && (
                  <div className="text-xs text-slate-300 text-center py-6 border border-dashed border-slate-200 rounded-lg">
                    Aucun lot
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
