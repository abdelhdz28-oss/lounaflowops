import React, { useState } from 'react';
import { Truck, Plus, Search, ArrowUp, ArrowDown, ArrowUpDown, Download, FileDown } from 'lucide-react';
import * as XLSX from 'xlsx';
import { useAppContext } from '../AppContext';
import { cn } from '../utils/cn';
import { DELIVERY_STATUSES, deliveryStatusFromBatch, formatDate, boitesProduites } from '../constants';

const DELIVERY_STATUS_MAP = Object.fromEntries(DELIVERY_STATUSES.map(s => [s.value, s]));

export function DeliveriesView() {
  const { deliveries, createDelivery, batches, productCatalog } = useAppContext();
  const [search, setSearch] = useState('');

  const [sortField, setSortField] = useState<'client' | 'date' | 'batchId' | 'boxesSold' | 'palettes' | 'status'>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const toggleSort = (f: typeof sortField) => {
    if (f === sortField) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortField(f); setSortDir('asc'); }
  };

  const q = search.toLowerCase();
  // Filtres d'export : un client, une année. C'est ce qui part dans le document remis au client.
  const [client, setClient] = useState('');
  const [annee, setAnnee] = useState('');
  const clientsListe = [...new Set(deliveries.map(d => d.client).filter(Boolean))].sort();
  const anneesListe = [...new Set(deliveries.map(d => String(d.date || '').slice(0, 4)).filter(Boolean))].sort().reverse();
  const filteredDeliveries = deliveries.filter(d =>
    ((d.batchId || '').toLowerCase().includes(q) || (d.client || '').toLowerCase().includes(q)) &&
    (!client || d.client === client) &&
    (!annee || String(d.date || '').startsWith(annee))
  );

  const STATUS_ORDER: Record<string, number> = { A_PLANIFIER: 0, EN_PRODUCTION: 1, EN_LIBERATION: 2, PRET: 3, ENLEVE: 4 };
  const sortVal = (d: typeof deliveries[number]): string | number => {
    switch (sortField) {
      case 'client': return (d.client || '').toLowerCase();
      case 'date': return d.date || '';
      case 'batchId': return (d.batchId || '').toLowerCase();
      case 'boxesSold': return d.boxesSold ?? 0;
      case 'palettes': return d.palettes ?? 0;
      case 'status': return STATUS_ORDER[deliveryStatusFromBatch(batches.find(b => b.id === d.batchId))] ?? 0;
    }
  };
  const sortedDeliveries = [...filteredDeliveries].sort((a, b) => {
    const av = sortVal(a), bv = sortVal(b);
    let cmp: number;
    if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
    else {
      const as = String(av), bs = String(bv);
      if (!as && bs) return 1;   // valeurs vides toujours en fin
      if (as && !bs) return -1;
      cmp = as.localeCompare(bs);
    }
    return cmp * (sortDir === 'asc' ? 1 : -1);
  });

  const SortHead = ({ field, label }: { field: typeof sortField; label: string }) => (
    <button
      onClick={() => toggleSort(field)}
      className="flex items-center gap-1 uppercase tracking-wider hover:text-slate-700 text-left"
    >
      {label}
      {sortField === field
        ? (sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)
        : <ArrowUpDown className="w-3 h-3 opacity-30" />}
    </button>
  );

  const handleAddDelivery = () => {
    const client = prompt("Nom du client :");
    if (client) {
      const lot = prompt("Numéro de Lot :");
      const boxes = prompt("Quantité de boîtes vendues :");
      const pal = prompt("Nombre de palettes :");
      
      createDelivery({
        batchId: lot || 'N/A',
        client: client,
        date: new Date().toISOString().split('T')[0],
        boxesSold: parseInt(boxes || '0', 10),
        palettes: parseInt(pal || '0', 10),
        status: 'PLANIFIÉ'
      });
    }
  };

  // Lignes de l'export : ce que le client peut voir, rien de plus (aucun coût, aucun responsable).
  const lignesExport = () => sortedDeliveries.map(d => {
    const b = batches.find(x => x.id === d.batchId);
    const bo = b ? boitesProduites(b, productCatalog as any) : null;
    const st = DELIVERY_STATUS_MAP[deliveryStatusFromBatch(b)];
    return {
      lot: d.batchId || '',
      produit: b?.product || '',
      client: d.client || '',
      dateSouhaitee: d.date || '',
      enlevement: b?.pickup_date || '',
      boites: bo?.valeur ?? d.boxesSold ?? 0,
      palettes: d.palettes ?? 0,
      etat: st?.label || '',
    };
  });
  const intitule = `${client || 'Tous clients'}${annee ? ` · ${annee}` : ''}`;

  const exportExcel = () => {
    const l = lignesExport();
    const entetes = ['N° de lot', 'Produit', 'Client', 'Date souhaitée', 'Date d\'enlèvement', 'Boîtes', 'Palettes', 'État'];
    const rows = l.map(x => [x.lot, x.produit, x.client, x.dateSouhaitee, x.enlevement, x.boites, x.palettes, x.etat]);
    const total = ['TOTAL', '', '', '', '', l.reduce((s, x) => s + (Number(x.boites) || 0), 0), l.reduce((s, x) => s + (Number(x.palettes) || 0), 0), ''];
    const ws = XLSX.utils.aoa_to_sheet([entetes, ...rows, total]);
    ws['!cols'] = [{ wch: 14 }, { wch: 28 }, { wch: 20 }, { wch: 14 }, { wch: 16 }, { wch: 10 }, { wch: 10 }, { wch: 16 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Livraisons');
    XLSX.writeFile(wb, `Livraisons_${intitule.replace(/[^\w]+/g, '_')}.xlsx`);
  };

  const exportPDF = () => {
    const l = lignesExport();
    const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const jour = (d: string) => d ? formatDate(d) : '—';
    const totB = l.reduce((s, x) => s + (Number(x.boites) || 0), 0);
    const totP = l.reduce((s, x) => s + (Number(x.palettes) || 0), 0);
    const rows = l.map(x => `<tr><td><b>${esc(x.lot)}</b></td><td>${esc(x.produit)}</td><td class=c>${jour(x.dateSouhaitee)}</td><td class=c>${jour(x.enlevement)}</td><td class=r>${Number(x.boites).toLocaleString('fr-FR')}</td><td class=r>${x.palettes}</td><td class=c>${esc(x.etat)}</td></tr>`).join('');
    const html = `<!doctype html><html lang=fr><head><meta charset=utf-8><title>Livraisons ${esc(intitule)}</title>
<style>body{font-family:system-ui,Arial;max-width:900px;margin:24px auto;color:#1e293b}
h1{font-size:19px;margin:0 0 2px}.sub{color:#64748b;font-size:12px;margin-bottom:16px}
table{width:100%;border-collapse:collapse;font-size:12px;margin-top:8px}
th,td{border:1px solid #e2e8f0;padding:6px 8px}th{background:#f1f5f9;text-align:left;font-size:11px;text-transform:uppercase}
.c{text-align:center}.r{text-align:right}tfoot td{font-weight:bold;background:#f8fafc}
@media print{.np{display:none}}</style></head><body>
<button class=np onclick="print()" style="float:right;padding:6px 12px;cursor:pointer">Imprimer / PDF</button>
<h1>Planning de livraisons — ${esc(client || 'tous clients')}</h1>
<div class="sub">${annee ? `Année ${esc(annee)} · ` : ''}${l.length} livraison(s) · document établi le ${new Date().toLocaleDateString('fr-FR')} par SAS LOUNA AESTHETICS</div>
<table><thead><tr><th>N° de lot</th><th>Produit</th><th class=c>Date souhaitée</th><th class=c>Enlèvement</th><th class=r>Boîtes</th><th class=r>Palettes</th><th class=c>État</th></tr></thead>
<tbody>${rows}</tbody>
<tfoot><tr><td colspan="4">Total</td><td class=r>${totB.toLocaleString('fr-FR')}</td><td class=r>${totP}</td><td></td></tr></tfoot></table>
</body></html>`;
    const w = window.open('', '_blank'); if (w) { w.document.write(html); w.document.close(); }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 flex-1 overflow-y-auto bg-slate-50">
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-lg font-semibold text-slate-800">Planning Livraisons Clients</h3>
        <div className="flex items-center gap-3">
          <div className="relative w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Rechercher un numéro de lot..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            />
          </div>
          <select value={client} onChange={e => setClient(e.target.value)}
            className="text-sm border border-slate-300 rounded-md px-2 py-2 outline-none focus:border-blue-500">
            <option value="">Tous les clients</option>
            {clientsListe.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={annee} onChange={e => setAnnee(e.target.value)}
            className="text-sm border border-slate-300 rounded-md px-2 py-2 outline-none focus:border-blue-500">
            <option value="">Toutes les années</option>
            {anneesListe.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <button onClick={exportExcel} disabled={!sortedDeliveries.length}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-40">
            <Download className="w-4 h-4" /> Excel
          </button>
          <button onClick={exportPDF} disabled={!sortedDeliveries.length}
            title="Document présentable au client"
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-40">
            <FileDown className="w-4 h-4" /> PDF client
          </button>
          <button
            onClick={handleAddDelivery}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Ajouter Livraison
          </button>
        </div>
      </div>
      
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden flex flex-col">
        <div className="flex items-center p-4 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wider">
          <div className="w-16 flex justify-center"></div>
          <div className="flex-1 grid grid-cols-6 gap-4 items-center">
            <SortHead field="client" label="Client" />
            <SortHead field="date" label="Date livraison" />
            <SortHead field="batchId" label="Numéro de lot" />
            <SortHead field="boxesSold" label="Boîtes vendues" />
            <SortHead field="palettes" label="Palettes" />
            <SortHead field="status" label="Statut" />
          </div>
        </div>
        
        <div className="flex flex-col">
          {sortedDeliveries.map((d) => {
            const batch = batches.find(b => b.id === d.batchId);
            const derived = DELIVERY_STATUS_MAP[deliveryStatusFromBatch(batch)];
            return (
            <div key={d.id} className="flex items-center p-4 border-b border-slate-100 hover:bg-slate-50 transition-colors last:border-0">
              <div className="w-16 flex justify-center text-blue-600">
                <Truck className="w-6 h-6" />
              </div>
              <div className="flex-1 grid grid-cols-6 gap-4 items-center text-sm text-slate-700">
                <div className="font-medium text-slate-900">{d.client}</div>
                <div>{formatDate(d.date)}</div>
                <div className="font-mono font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded w-fit">{d.batchId}</div>
                <div>{(d.boxesSold ?? 0).toLocaleString()} boîtes</div>
                <div>{d.palettes ?? 0} Palette(s)</div>
                <div>
                  <span className={cn(
                    "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border",
                    derived.color
                  )}>
                    {derived.label}
                  </span>
                </div>
              </div>
            </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
