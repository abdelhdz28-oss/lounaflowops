import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../AuthContext';
import { cn } from '../utils/cn';
import { formatDate, PROCESS_STAGES, PREP_TASKS } from '../constants';
import { Loader2, RefreshCw, AlertTriangle, Clock, Ban, ClipboardCheck, FileText, Truck, Receipt, Mail } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || '';

interface Pilotage {
  enRetard: any[]; figes: any[]; bloques: any[]; prepIncomplete: any[];
  ddlEnAttente: any[]; expeditions: any[]; nonFactures: any[]; seuilFigeJours: number;
}

const VIDE: Pilotage = { enRetard: [], figes: [], bloques: [], prepIncomplete: [], ddlEnAttente: [], expeditions: [], nonFactures: [], seuilFigeJours: 21 };

const etapeLabel = (v: string) => PROCESS_STAGES.find(s => s.value === v)?.label || v || '—';
const prepLabel = (id: string) => PREP_TASKS.find(t => t.id === id)?.short || id;
const qui = (r: any) => r.responsable ? <span className="text-slate-600">{r.responsable}</span> : <span className="text-slate-300">non assigné</span>;

export function PilotageView({ onOpenBatch }: { onOpenBatch?: (id: string) => void }) {
  const { token } = useAuth();
  const [d, setD] = useState<Pilotage>(VIDE);
  const [loading, setLoading] = useState(true);
  const [envoi, setEnvoi] = useState(false);

  // Envoi immédiat du récapitulatif (il part sinon tout seul chaque lundi matin).
  const envoyerRecap = async () => {
    setEnvoi(true);
    try {
      const r = await fetch(`${API_URL}/api/pilotage/recap/envoyer`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      const j = await r.json().catch(() => ({}));
      alert(r.ok
        ? (j.total ? `Récapitulatif envoyé par e-mail (${j.total} point(s)).` : 'Rien à signaler : aucun e-mail envoyé.')
        : (j.error || "Envoi impossible."));
    } finally { setEnvoi(false); }
  };

  const load = useCallback(async () => {
    if (!token) return;
    const r = await fetch(`${API_URL}/api/pilotage`, { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) setD({ ...VIDE, ...(await r.json()) });
    setLoading(false);
  }, [token]);
  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="p-8 flex-1 flex items-center justify-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Chargement…</div>;

  const total = d.enRetard.length + d.figes.length + d.bloques.length + d.prepIncomplete.length + d.ddlEnAttente.length + d.nonFactures.length;
  const lot = (id: string) => (
    <button onClick={() => onOpenBatch?.(id)} className="font-bold text-blue-600 hover:underline">{id}</button>
  );

  return (
    <div className="p-6 flex-1 overflow-auto bg-slate-50">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-slate-800">
          Aujourd'hui
          <span className={cn('ml-2 text-sm font-normal', total ? 'text-amber-600' : 'text-green-600')}>
            · {total ? `${total} point(s) à traiter` : 'rien à signaler'}
          </span>
        </h3>
        <div className="flex items-center gap-2">
          <button onClick={envoyerRecap} disabled={envoi}
            title="Envoyer dès maintenant le récapitulatif par e-mail (il part sinon automatiquement chaque lundi matin)"
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50">
            {envoi ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />} Envoyer le récapitulatif
          </button>
          <button onClick={load} className="text-slate-400 hover:text-blue-600" title="Rafraîchir"><RefreshCw className="w-4 h-4" /></button>
        </div>
      </div>

      {total === 0 && d.expeditions.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-slate-400">
          Rien ne réclame ton attention aujourd'hui. 👍
        </div>
      )}

      <div className="space-y-4">
        <Bloc titre="Fabrication en retard" icone={<AlertTriangle className="w-4 h-4" />} ton="rouge" n={d.enRetard.length}
          vide="Aucun lot ne dépasse sa date de fin de fabrication.">
          <Table entetes={['Lot', 'Client', 'Fin prévue', 'Étape', 'Responsable']} lignes={d.enRetard.map(r => [
            lot(r.id), r.client || '—', formatDate(r.enddate), etapeLabel(r.process_stage), qui(r),
          ])} />
        </Bloc>

        <Bloc titre={`Lots figés (plus de ${d.seuilFigeJours} jours sans changement d'étape)`} icone={<Clock className="w-4 h-4" />} ton="rouge" n={d.figes.length}
          vide="Aucun lot ne stagne.">
          <Table entetes={['Lot', 'Client', 'Étape', 'Depuis', 'Responsable']} lignes={d.figes.map(r => [
            lot(r.id), r.client || '—', etapeLabel(r.process_stage), `${r.jours} jours`, qui(r),
          ])} />
        </Bloc>

        <Bloc titre="Lots déclarés bloqués" icone={<Ban className="w-4 h-4" />} ton="rouge" n={d.bloques.length}
          vide="Aucun blocage déclaré.">
          <Table entetes={['Lot', 'Client', 'Étape', 'Motif', 'Responsable']} lignes={d.bloques.map(r => [
            lot(r.id), r.client || '—', etapeLabel(r.process_stage), <span className="text-red-600">{r.blocage_motif}</span>, qui(r),
          ])} />
        </Bloc>

        <Bloc titre="Préparation incomplète à moins de 7 jours de la production" icone={<ClipboardCheck className="w-4 h-4" />} ton="orange" n={d.prepIncomplete.length}
          vide="Toutes les préparations imminentes sont complètes.">
          <Table entetes={['Lot', 'Client', 'Début fab.', 'Il manque', 'Responsable']} lignes={d.prepIncomplete.map(r => [
            lot(r.id), r.client || '—', formatDate(r.startdate),
            <span className="text-amber-700">{r.manquantes.map(prepLabel).join(', ')}</span>, qui(r),
          ])} />
        </Bloc>

        <Bloc titre="Dossiers de lot pas encore validés" icone={<FileText className="w-4 h-4" />} ton="orange" n={d.ddlEnAttente.length}
          vide="Aucun dossier de lot en attente pour une production proche.">
          <Table entetes={['Lot', 'Dossier', 'Statut', 'Début fab.']} lignes={d.ddlEnAttente.map(r => [
            lot(r.lot), r.ddl_number || '—',
            <span className={cn('text-xs font-semibold', r.status === 'EN_VALIDATION' ? 'text-amber-700' : 'text-slate-500')}>
              {r.status === 'EN_VALIDATION' ? 'en attente de validation' : 'généré, pas envoyé'}
            </span>,
            r.startdate ? formatDate(r.startdate) : '—',
          ])} />
        </Bloc>

        <Bloc titre="Lots expédiés sans document de facturation" icone={<Receipt className="w-4 h-4" />} ton="orange" n={d.nonFactures.length}
          vide="Tous les lots expédiés portent un document de facturation.">
          <Table entetes={['Lot', 'Client', 'Livraison']} lignes={d.nonFactures.map(r => [
            lot(r.id), r.client || '—', r.deliverydate ? formatDate(r.deliverydate) : '—',
          ])} />
        </Bloc>

        <Bloc titre="À expédier cette semaine" icone={<Truck className="w-4 h-4" />} ton="bleu" n={d.expeditions.length}
          vide="Aucune expédition prévue dans les 7 jours.">
          <Table entetes={['Lot', 'Client', 'Livraison souhaitée', 'Étape', 'Responsable']} lignes={d.expeditions.map(r => [
            lot(r.id), r.client || '—', formatDate(r.deliverydate), etapeLabel(r.process_stage), qui(r),
          ])} />
        </Bloc>
      </div>
    </div>
  );
}

function Bloc({ titre, icone, ton, n, vide, children }:
  { titre: string; icone: React.ReactNode; ton: 'rouge' | 'orange' | 'bleu'; n: number; vide: string; children: React.ReactNode }) {
  const couleur = n === 0 ? 'bg-slate-100 text-slate-500 border-slate-200'
    : ton === 'rouge' ? 'bg-red-100 text-red-700 border-red-200'
    : ton === 'orange' ? 'bg-amber-100 text-amber-700 border-amber-200'
    : 'bg-blue-100 text-blue-700 border-blue-200';
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
        <span className={cn('inline-flex items-center justify-center w-7 h-7 rounded-lg border', couleur)}>{icone}</span>
        <span className="font-semibold text-slate-800 text-sm">{titre}</span>
        <span className={cn('text-xs font-semibold rounded-full px-2 py-0.5 border', couleur)}>{n}</span>
      </div>
      {n === 0 ? <div className="px-4 py-4 text-sm text-slate-400">{vide}</div> : <div className="overflow-x-auto">{children}</div>}
    </div>
  );
}

function Table({ entetes, lignes }: { entetes: string[]; lignes: React.ReactNode[][] }) {
  return (
    <table className="w-full text-sm">
      <thead><tr className="bg-slate-50 text-left text-[11px] uppercase text-slate-500">
        {entetes.map(h => <th key={h} className="px-4 py-2">{h}</th>)}
      </tr></thead>
      <tbody className="divide-y divide-slate-100">
        {lignes.map((l, i) => (
          <tr key={i} className="hover:bg-slate-50">
            {l.map((c, j) => <td key={j} className="px-4 py-2 text-slate-600">{c}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
