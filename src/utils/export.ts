import { Batch, Delivery, FluxConfig } from '../types';
import { SAMPLE_TESTS, SAMPLE_STATUSES } from '../constants';
import * as XLSX from 'xlsx';

const SAMPLE_STATUS_LABELS: Record<string, string> = Object.fromEntries(SAMPLE_STATUSES.map(s => [s.value, s.label]));

// Feuille dédiée « Échantillons » : une ligne par lot × test applicable.
function buildSamplesSheet(batches: Batch[]) {
  const headers = [
    'Lot', 'Test', 'Partenaire', 'Statut',
    'Réception théorique', 'Date envoi', 'Prélèvement réel',
    'Résultats attendus', 'Résultats reçus', 'N° rapport', 'Lien certificat',
    'Conformité', 'Motif non conforme'
  ];
  const rows: any[][] = [];
  batches.forEach(b => {
    (b.samples || []).forEach(s => {
      if (!s || !s.applicable) return;
      const label = SAMPLE_TESTS.find(t => t.key === s.type)?.label || s.type;
      const conformite = s.status === 'CONFORME' ? 'Conforme' : s.status === 'NON_CONFORME' ? 'Non conforme' : '-';
      rows.push([
        b.id, label, s.partner || '', SAMPLE_STATUS_LABELS[s.status] || s.status,
        s.dateReceptionEchantillon || '', s.dateEnvoi || '', s.datePrelevementReel || '',
        s.dateResultatsAttendue || '', s.dateResultatsRecus || '', s.rapportRef || '', s.rapportUrl || '',
        conformite, s.motifNonConforme || ''
      ]);
    });
  });
  return XLSX.utils.aoa_to_sheet([headers, ...rows]);
}

export function exportCurrentView(view: string, data: { batches: Batch[], deliveries: Delivery[], fluxConfig: Record<string, FluxConfig> }) {
  let headers: string[] = [];
  let rows: any[][] = [];

  const { batches, deliveries, fluxConfig } = data;

  if (view === 'dashboard') {
    headers = ["Lot", "Reference", "Produit", "Client", "Etape", "Statut", "Progression"];
    rows = batches.map(b => [b.id, b.reference, b.product, b.client, fluxConfig[b.fluxKey]?.steps[b.stepIndex] || '-', b.status, b.progress + '%']);
  } else if (view === 'planning') {
    headers = ["Lot", "Reference", "Produit", "Debut", "Fin", "Progression"];
    rows = batches.map(b => [b.id, b.reference, b.product, b.startDate, b.endDate, b.progress + '%']);
  } else if (view === 'quality') {
    headers = ["Lot", "Reference", "Produit", "Biocharge", "EPC", "Endotoxine", "Taux Rejet"];
    const findStatus = (b: Batch, key: string) => {
      const s = b.samples.find(x => x.type === key);
      if (!s || !s.applicable) return 'N/A';
      return s.status;
    };
    rows = batches.map(b => {
      const r = b.distributed > 0 ? ((b.distributed - b.conform) / b.distributed * 100).toFixed(2) + '%' : '-';
      return [b.id, b.reference, b.product, findStatus(b, 'INTERTEK_BIO'), findStatus(b, 'INTERTEK_EPC'), findStatus(b, 'CHARLES_RIVERS_ENDO'), r];
    });
  } else if (view === 'data') {
    headers = ["Lot", "Reference", "Produit", "Leadtime", "Repartis", "Conforme", "Taux Rejet", "Yield"];
    rows = batches.map(b => {
      const r = b.distributed > 0 ? ((b.distributed - b.conform) / b.distributed * 100).toFixed(2) + '%' : '-';
      const y = b.distributed > 0 ? (b.conform / b.distributed * 100).toFixed(2) + '%' : '-';
      const leadtime = Object.values(fluxConfig[b.fluxKey]?.durations || {}).reduce((a: number, v: number) => a + v, 0);
      return [b.id, b.reference, b.product, leadtime + ' sem', b.distributed, b.conform, r, y];
    });
  } else if (view === 'deliveries') {
    headers = ["Client", "Lot", "Date", "Boites", "Palettes", "Statut"];
    rows = deliveries.map(d => [d.client, d.batchId, d.date, d.boxesSold, d.palettes, d.status]);
  }

  const worksheetData = [headers, ...rows];
  const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Export");

  // Feuille dédiée « Échantillons » pour les vues centrées sur les lots
  if (view === 'dashboard' || view === 'quality' || view === 'data') {
    XLSX.utils.book_append_sheet(workbook, buildSamplesSheet(batches), "Échantillons");
  }

  XLSX.writeFile(workbook, `lounaflow_export_${view}.xlsx`);
}
