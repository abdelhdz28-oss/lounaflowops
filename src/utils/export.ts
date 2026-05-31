import { Batch, Delivery, FluxConfig } from '../types';
import * as XLSX from 'xlsx';

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
    headers = ["Lot", "Reference", "Produit", "IPC", "EPC", "Endotoxine", "Interne", "Taux Rejet"];
    rows = batches.map(b => {
      const s = b.samples;
      const r = b.distributed > 0 ? ((b.distributed - b.conform) / b.distributed * 100).toFixed(2) + '%' : '-';
      return [b.id, b.reference, b.product, s[0]?.sent ? 'O' : 'N', s[1]?.sent ? 'O' : 'N', s[2]?.sent ? 'O' : 'N', s[3]?.sent ? 'O' : 'N', r];
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

  XLSX.writeFile(workbook, `lounaflow_export_${view}.xlsx`);
}
