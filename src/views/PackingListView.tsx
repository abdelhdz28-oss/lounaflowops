import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../AuthContext';
import { cn } from '../utils/cn';
import { Plus, Trash2, Loader2, Save, FileDown, PackagePlus, X, FilePlus, FolderOpen, Mail } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || '';

// Émetteur (repris de l'Excel) — utilisé dans les 2 PDF, non éditable.
const SENDER = {
  company: 'SAS LOUNA AESTHETICS',
  address: '30 route des Creusettes\n74330 Poisy, France',
  contact: 'Abdel HADJAB — Operation Director',
  tel: '+33 6 47 64 89 32',
  mail: 'a.hadjab@louna-aesthetics.com',
  site: 'www.louna-aesthetics.com',
  iban: 'FR76 1009 6180 2800 0745 1120 167',
  bic: 'CMCIFRPP',
};

interface PlProduct { ref: string; designation: string; type: string; hsCode: string | null; unitPrice: number | null; boxWeightKg: number | null; capacityPerCarton: number | null; }
interface PlClient { id: number; name: string; address: string; customerId: string; }
interface PlSite { id: number; name: string; address: string; }
interface PlDoc { id: number; invoiceNo: string; docDate: string | null; rev: number; clientName: string; clientAddress: string; pickupName: string; pickupAddress: string; lines: Line[]; notes: string; updatedAt?: string; }
// Shape d'une ligne (JSONB `lines`). cartons/dimension/grossWeight vides = calcul auto (surchargeables).
interface Line { ref: string; product: string; qty: string | number; lot: string; expiry: string; unitPrice: string | number; boxWeight: string | number; capacity: string | number; cartons: string | number; dimension: string; grossWeight: string | number; palette: string | number; }

const num = (v: any) => { const n = Number(v); return isNaN(n) ? 0 : n; };
const pad2 = (n: number) => String(n).padStart(2, '0');
const today = () => new Date().toISOString().split('T')[0];
const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const nl2br = (s: any) => esc(s).replace(/\n/g, '<br>');
const eur = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

// Convertit une page HTML (Packing List / Facture) en PDF base64, côté navigateur (pour joindre au mail).
async function htmlToPdfBase64(html: string): Promise<string> {
  const html2pdf: any = (await import('html2pdf.js')).default;
  const clean = html.replace(/<button class=np[\s\S]*?<\/button>/gi, '');   // retire le bouton « Imprimer »
  // Échelle et qualité modérées : PDF lisible mais léger, pour rester sous la limite de taille d'un message Outlook.
  const opt: any = { margin: 6, image: { type: 'jpeg', quality: 0.72 }, html2canvas: { scale: 1.5, useCORS: true }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait', compress: true } };
  const dataUri: string = await html2pdf().set(opt).from(clean, 'string').outputPdf('datauristring');
  return dataUri.split(',')[1] || '';
}

const emptyLine = (palette: number): Line => ({ ref: '', product: '', qty: '', lot: '', expiry: '', unitPrice: '', boxWeight: '', capacity: '', cartons: '', dimension: '', grossWeight: '', palette });

// Au-delà de 20 cartons, la palette passe « Hors Gabarit » → on répartit sur plusieurs palettes.
const MAX_CARTONS_PER_PALLET = 20;
// Découpe une quantité de boîtes en palettes pleines (max capacité×20) + le reste sur la dernière.
// Ex. Hydragel (56 boîtes/carton → 1120 boîtes/palette) : 3360 boîtes → [1120, 1120, 1120].
function splitQtyIntoPallets(qty: number, capacity: number): number[] {
  if (!(capacity > 0) || !(qty > 0)) return [qty];
  const maxPerPallet = capacity * MAX_CARTONS_PER_PALLET;
  if (qty <= maxPerPallet) return [qty];
  const chunks: number[] = [];
  let rest = qty;
  while (rest > 0) { const take = Math.min(maxPerPallet, rest); chunks.push(take); rest -= take; }
  return chunks;
}

// --- Le calculateur (formules exactes de l'Excel) ---
function effectiveLine(l: Line) {
  const qty = num(l.qty);
  const capacity = num(l.capacity);
  const autoCartons = capacity > 0 ? Math.ceil(qty / capacity) : 0;
  const cartons = l.cartons !== '' && l.cartons != null ? num(l.cartons) : autoCartons;
  // Hauteur palette selon le nb de cartons : ≤4→50, ≤8→75, ≤12→100, ≤20→150, sinon Hors Gabarit.
  const h = cartons <= 4 ? 50 : cartons <= 8 ? 75 : cartons <= 12 ? 100 : cartons <= 20 ? 150 : null;
  const autoDimension = h !== null ? `120x80x${h}` : 'Hors Gabarit';
  const dimension = l.dimension ? l.dimension : autoDimension;
  const boxWeight = num(l.boxWeight);
  // Poids brut palette = ROUNDUP(25 + Q×poids_boîte + cartons×1)
  const autoGross = Math.ceil(25 + qty * boxWeight + cartons * 1);
  const grossWeight = l.grossWeight !== '' && l.grossWeight != null ? num(l.grossWeight) : autoGross;
  return { qty, cartons, autoCartons, dimension, autoDimension, grossWeight, autoGross, totalHT: num(l.unitPrice) * qty };
}

export function PackingListView() {
  const { token, socket, canEdit } = useAuth();
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'doc' | 'catalog'>('doc');
  const [products, setProducts] = useState<PlProduct[]>([]);
  const [clients, setClients] = useState<PlClient[]>([]);
  const [sites, setSites] = useState<PlSite[]>([]);
  const [documents, setDocuments] = useState<PlDoc[]>([]);

  // Document en cours d'édition
  const [docId, setDocId] = useState<number | null>(null);
  const [invoiceNo, setInvoiceNo] = useState('');
  const [docDate, setDocDate] = useState(today());
  const [rev, setRev] = useState(0);
  const [clientName, setClientName] = useState('');
  const [clientAddress, setClientAddress] = useState('');
  const [pickupName, setPickupName] = useState('');
  const [pickupAddress, setPickupAddress] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [saving, setSaving] = useState(false);
  const [emailBusy, setEmailBusy] = useState(false);

  // Modale de sélection des lots
  const [batchModal, setBatchModal] = useState(false);
  const [batches, setBatches] = useState<any[]>([]);
  const [batchesLoading, setBatchesLoading] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const headers = useMemo(() => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }), [token]);
  const productByRef = useMemo(() => new Map(products.map(p => [p.ref, p])), [products]);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [p, c, s, d] = await Promise.all([
        fetch(`${API_URL}/api/pl/products`, { headers }).then(r => r.ok ? r.json() : null),
        fetch(`${API_URL}/api/pl/clients`, { headers }).then(r => r.ok ? r.json() : null),
        fetch(`${API_URL}/api/pl/sites`, { headers }).then(r => r.ok ? r.json() : null),
        fetch(`${API_URL}/api/pl/documents`, { headers }).then(r => r.ok ? r.json() : null),
      ]);
      if (p?.products) setProducts(p.products);
      if (c?.clients) setClients(c.clients);
      if (s?.sites) setSites(s.sites);
      if (d?.documents) setDocuments(d.documents);
    } finally { setLoading(false); }
  }, [token, headers]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!socket) return; const h = () => load(); socket.on('pl:changed', h); return () => { socket.off('pl:changed', h); }; }, [socket, load]);

  const totals = useMemo(() => {
    let boxes = 0, cartons = 0, gross = 0;
    for (const l of lines) { const e = effectiveLine(l); boxes += e.qty; cartons += e.cartons; gross += e.grossWeight; }
    const palettes = lines.length;
    const say = `SAY ${pad2(palettes)} PALETTES CONTAINING ${cartons} CARTONS, ${boxes} BOXES`;
    const totalHT = lines.reduce((a, l) => a + effectiveLine(l).totalHT, 0);
    return { boxes, cartons, gross, palettes, say, totalHT };
  }, [lines]);

  const newDoc = () => {
    // Garde-fou : ne pas perdre un brouillon non enregistré par mégarde.
    if (!docId && lines.length > 0 && !confirm('Créer un nouveau document ? Les modifications non enregistrées seront perdues.')) return;
    setDocId(null); setInvoiceNo(''); setDocDate(today()); setRev(0);
    setClientName(''); setClientAddress(''); setPickupName(''); setPickupAddress(''); setLines([]);
  };

  const openDoc = async (id: number) => {
    const r = await fetch(`${API_URL}/api/pl/documents/${id}`, { headers });
    if (!r.ok) { alert('Document introuvable'); return; }
    const { document: d } = await r.json();
    setDocId(d.id); setInvoiceNo(d.invoiceNo || ''); setDocDate(d.docDate ? String(d.docDate).split('T')[0] : today());
    setRev(d.rev ?? 0); setClientName(d.clientName || ''); setClientAddress(d.clientAddress || '');
    setPickupName(d.pickupName || ''); setPickupAddress(d.pickupAddress || '');
    setLines(Array.isArray(d.lines) ? d.lines.map((l: any) => ({ ...emptyLine(0), ...l })) : []);
  };

  const saveDoc = async () => {
    setSaving(true);
    try {
      const body = { invoiceNo, docDate: docDate || null, rev, clientName, clientAddress, pickupName, pickupAddress, lines, notes: '' };
      const r = docId
        ? await fetch(`${API_URL}/api/pl/documents/${docId}`, { method: 'PATCH', headers, body: JSON.stringify(body) })
        : await fetch(`${API_URL}/api/pl/documents`, { method: 'POST', headers, body: JSON.stringify(body) });
      if (!r.ok) { const e = await r.json().catch(() => ({})); alert(e.error || 'Erreur lors de l\'enregistrement'); return; }
      const d = await r.json();
      if (!docId) setDocId(d.id);
      await load();
      alert('Document enregistré ✓');
    } finally { setSaving(false); }
  };

  const deleteDoc = async () => {
    if (!docId || !confirm('Supprimer ce document enregistré ?')) return;
    await fetch(`${API_URL}/api/pl/documents/${docId}`, { method: 'DELETE', headers });
    newDoc(); await load();
  };

  // --- Sélection des lots ---
  const openBatchModal = async () => {
    setBatchModal(true); setChecked(new Set()); setBatchesLoading(true);
    try {
      const r = await fetch(`${API_URL}/api/batches`, { headers });
      if (r.ok) { const d = await r.json(); setBatches(Array.isArray(d) ? d : []); }
    } finally { setBatchesLoading(false); }
  };

  const addBatchLines = () => {
    const added: Line[] = [];
    for (const b of batches) {
      if (!checked.has(b.id)) continue;
      const p = productByRef.get(b.reference);
      const capacity = num(p?.capacityPerCarton ?? 0);
      const qty = num(b.sold ?? 0);
      // Répartit automatiquement le lot sur autant de palettes que nécessaire (max capacité×20 par palette).
      const chunks = qty > 0 ? splitQtyIntoPallets(qty, capacity) : [b.sold ?? ''];
      for (const cq of chunks) {
        added.push({
          ref: b.reference || '', product: b.product || '', qty: cq, lot: b.id, expiry: '',
          unitPrice: p?.unitPrice ?? '', boxWeight: p?.boxWeightKg ?? '', capacity: p?.capacityPerCarton ?? '',
          cartons: '', dimension: '', grossWeight: '', palette: 0,
        });
      }
    }
    setLines(prev => {
      const merged = [...prev, ...added];
      return merged.map((l, i) => ({ ...l, palette: l.palette || i + 1 }));
    });
    setBatchModal(false);
  };

  const addManualLine = () => setLines(prev => [...prev, emptyLine(prev.length + 1)]);

  const setLine = (idx: number, patch: Partial<Line>) => setLines(prev => prev.map((l, i) => {
    if (i !== idx) return l;
    const n = { ...l, ...patch };
    // Changement de réf : re-remplir depuis le catalogue produits.
    if (patch.ref !== undefined) {
      const p = productByRef.get(patch.ref as string);
      if (p) { n.product = p.designation; n.unitPrice = p.unitPrice ?? ''; n.boxWeight = p.boxWeightKg ?? ''; n.capacity = p.capacityPerCarton ?? ''; }
    }
    return n;
  }));

  const removeLine = (idx: number) => setLines(prev => prev.filter((_, i) => i !== idx));

  // --- Génération PDF (pattern VentesView : window.open + document.write + bouton print masqué à l'impression) ---
  const senderBlock = () => `<div style="font-size:11px;line-height:1.5"><b>${esc(SENDER.company)}</b><br>${nl2br(SENDER.address)}<br>${esc(SENDER.contact)}<br>Tél : ${esc(SENDER.tel)} — Mail : ${esc(SENDER.mail)}<br>${esc(SENDER.site)}</div>`;
  const openPdf = (html: string) => { const w = window.open('', '_blank'); if (w) { w.document.write(html); w.document.close(); } };
  const pdfStyle = `<style>body{font-family:system-ui,Arial;max-width:1000px;margin:24px auto;color:#1e293b;font-size:12px}h1{font-size:22px;letter-spacing:1px}table{width:100%;border-collapse:collapse;font-size:11px;margin-top:10px}th,td{border:1px solid #64748b;padding:4px 6px}th{background:#e2e8f0}.r{text-align:right}.c{text-align:center}.tot{font-weight:bold;background:#f1f5f9}.box{border:1px solid #64748b;padding:8px 10px;margin-top:8px}@media print{.np{display:none}}</style>`;

  const buildPackingListHtml = () => {
    const rows = lines.map(l => {
      const e = effectiveLine(l);
      return `<tr><td>${esc(l.ref)}</td><td>${esc(l.product)}${l.lot ? ' – Lot ' + esc(l.lot) : ''}</td><td class=c>${l.boxWeight !== '' ? esc(l.boxWeight) : ''}</td><td class=c>${l.capacity !== '' ? esc(l.capacity) : ''}</td><td class=c>${e.qty}</td><td class=c>${esc(l.lot)}</td><td class=c>${esc(l.expiry)}</td><td class=c>${e.cartons}</td><td class=c>${esc(e.dimension)}</td><td class=c>${e.grossWeight}</td><td class=c>${esc(l.palette)}</td></tr>`;
    }).join('');
    const plLots = [...new Set(lines.map(l => String(l.lot || '').trim()).filter(Boolean))].join(', ');
    const html = `<!doctype html><html lang=fr><head><meta charset=utf-8><title>Packing List ${esc(invoiceNo)}${plLots ? ' - Lot ' + esc(plLots) : ''}</title>${pdfStyle}</head><body>
<button class=np onclick="print()" style="float:right;padding:6px 12px;cursor:pointer">Imprimer / PDF</button>
<h1>PACKING LIST</h1>
<div style="display:flex;justify-content:space-between;gap:20px">
  ${senderBlock()}
  <div style="font-size:11px;text-align:right">REV : <b>${esc(rev)}</b><br>Date : <b>${esc(docDate)}</b>${invoiceNo ? `<br>Réf : <b>${esc(invoiceNo)}</b>` : ''}</div>
</div>
<div class=box style="width:48%"><b>To :</b><br><b>${esc(clientName)}</b><br>${nl2br(clientAddress)}</div>
<div class=box style="width:48%;background:#f8fafc"><b>Pickup / Lieu d'enlèvement :</b><br><b>${esc(pickupName)}</b><br>${nl2br(pickupAddress)}</div>
<div class=box style="display:inline-block"><b>Gross Weight :</b> ${totals.gross} kg &nbsp;·&nbsp; <b>Total Packages :</b> ${totals.cartons} cartons &nbsp;·&nbsp; <b>Total boxes :</b> ${totals.boxes}</div>
<table><thead><tr><th>REFERENCE</th><th>PRODUCT</th><th>BOX WEIGHT (KG)</th><th>CAPACITY PER CARTON</th><th>Quantity</th><th>BATCH</th><th>EXPIRY DATE</th><th>BOXES</th><th>DIMENSION LxlxH</th><th>Gross WEIGHT (kg)</th><th>PALETT</th></tr></thead>
<tbody>${rows}
<tr class=tot><td colspan=4>TOTAL</td><td class=c>${totals.boxes}</td><td></td><td></td><td class=c>${totals.cartons}</td><td></td><td class=c>${totals.gross}</td><td class=c>${totals.palettes}</td></tr>
</tbody></table>
<p style="font-weight:bold">${esc(totals.say)}</p>
<div style="margin-top:50px"><b>Signature and Company Stamp</b><div style="border:1px solid #64748b;width:260px;height:90px;margin-top:6px"></div></div>
</body></html>`;
    return html;
  };
  const exportPackingListPDF = () => openPdf(buildPackingListHtml());

  const buildInvoiceHtml = () => {
    const client = clients.find(c => c.name === clientName);
    const hsCodes = [...new Set(lines.map(l => productByRef.get(l.ref)?.hsCode).filter(Boolean))];
    const rows = lines.map(l => {
      const e = effectiveLine(l);
      return `<tr><td>${esc(l.ref)}</td><td class=c>${esc(l.lot)}</td><td class=c>${esc(l.expiry)}</td><td class=c>${e.qty}</td><td>${esc(l.product)}${l.lot ? ' – Lot ' + esc(l.lot) : ''}</td><td class=r>${eur(num(l.unitPrice))}</td><td class=r>${eur(e.totalHT)}</td></tr>`;
    }).join('');
    const invLots = [...new Set(lines.map(l => String(l.lot || '').trim()).filter(Boolean))].join(', ');
    const html = `<!doctype html><html lang=fr><head><meta charset=utf-8><title>Facture ${esc(invoiceNo)}${invLots ? ' - Lot ' + esc(invLots) : ''}</title>${pdfStyle}</head><body>
<button class=np onclick="print()" style="float:right;padding:6px 12px;cursor:pointer">Imprimer / PDF</button>
<h1>INVOICE</h1>
<div style="display:flex;justify-content:space-between;gap:20px">
  ${senderBlock()}
  <div style="font-size:11px;text-align:right">Invoice N° : <b>${esc(invoiceNo)}</b><br>Date : <b>${esc(docDate)}</b>${rev ? `<br>REV : <b>${esc(rev)}</b>` : ''}${client?.customerId ? `<br>Customer : <b>${esc(client.customerId)}</b>` : ''}</div>
</div>
<div class=box style="width:48%"><b>To :</b><br><b>${esc(clientName)}</b><br>${nl2br(clientAddress)}</div>
<table><thead><tr><th>REF</th><th>Batch N°</th><th>Expiry Date</th><th>Qty</th><th>Description</th><th>Unit Price (€)</th><th>Total HT (€)</th></tr></thead>
<tbody>${rows}
<tr class=tot><td colspan=6 class=r>TOTAL HT</td><td class=r>${eur(totals.totalHT)}</td></tr>
<tr><td colspan=6 class=r>VAT 0%</td><td class=r>${eur(0)}</td></tr>
<tr class=tot><td colspan=6 class=r>TOTAL TTC</td><td class=r>${eur(totals.totalHT)}</td></tr>
</tbody></table>
<div class=box style="font-size:11px;line-height:1.7">
Payment terms : 1 month after shipment<br>
Incoterm : Ex work<br>
${hsCodes.length ? `HS Code${hsCodes.length > 1 ? 's' : ''} : ${hsCodes.map(esc).join(' / ')}<br>` : ''}
IBAN : ${esc(SENDER.iban)}<br>
BIC/SWIFT : ${esc(SENDER.bic)}
</div>
<p style="margin-top:24px"><i>Thank you for your business / Merci de votre confiance.</i></p>
</body></html>`;
    return html;
  };
  const exportInvoicePDF = () => openPdf(buildInvoiceHtml());

  // Ouvre un brouillon Outlook (depuis la boîte connectée) « Goods Ready for Collection », pré-rempli depuis le Packing List.
  const emailReady = async () => {
    const products = [...new Set(lines.map(l => String(l.product || '').trim()).filter(Boolean))].join(', ');
    const lots = [...new Set(lines.map(l => String(l.lot || '').trim()).filter(Boolean))].join(', ');
    const orderRef = invoiceNo || '—';
    const readyDate = docDate || today();
    const collection = [pickupName, pickupAddress].filter(Boolean).join(' — ') || '—';
    const qty = `${totals.boxes} boxes (${totals.cartons} cartons, ${pad2(totals.palettes)} pallets)`;
    const subject = `Goods Ready for Collection – ${products || '[Product]'} – Batch ${lots || '[Lot]'} – Order Ref ${orderRef}`;
    const body =
`Dear ${clientName || '[Client Name / Contact Name]'},

We are pleased to inform you that your order is now ready for collection.
Please find attached the following documents for your reference:

- Packing List
- Freight Invoice
- Commercial Invoice

Shipment details:
- Product: ${products || '[Commercial name as per packing list]'}
- Batch/Lot number: ${lots || '[Lot Number]'}
- Quantity: ${qty}
- Ready date: ${readyDate}
- Collection point: ${collection}

Please arrange for collection at your earliest convenience, and let us know the expected pickup date so we can prepare accordingly. Should you need any additional documentation (e.g., Certificate of Analysis, Certificate of Conformity) for customs clearance, don't hesitate to reach out.

We remain available for any questions regarding this shipment.

Best regards,
${SENDER.contact}
${SENDER.company}
Tel: ${SENDER.tel} — ${SENDER.mail}
${SENDER.site}`;
    // Repli : lien de composition simple (sans police ni pièces jointes) si le brouillon Graph échoue.
    const deeplink = () => {
      const url = `https://outlook.office.com/mail/deeplink/compose?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      const w = window.open('', '_blank'); if (w) w.location.href = url; else window.open(url, '_blank');
    };
    // Brouillon Outlook réel via Graph : corps HTML aéré en Aptos 12 + Packing List et Facture en PDF joints.
    const li = 'margin:3px 0';
    const bodyHtml =
`<div style="font-family:Aptos,'Segoe UI',Calibri,sans-serif;font-size:12pt;color:#1e293b;line-height:1.5">
  <p>Dear ${esc(clientName || '[Client Name / Contact Name]')},</p>
  <p>We are pleased to inform you that your order is now ready for collection.</p>
  <p>Please find attached the following documents for your reference:</p>
  <ul style="margin:6px 0 16px 22px;padding:0">
    <li style="${li}">Packing List</li>
    <li style="${li}">Freight Invoice</li>
    <li style="${li}">Commercial Invoice</li>
  </ul>
  <p style="margin-bottom:4px"><b>Shipment details</b></p>
  <ul style="margin:4px 0 16px 22px;padding:0">
    <li style="${li}"><b>Product:</b> ${esc(products || '[Commercial name as per packing list]')}</li>
    <li style="${li}"><b>Batch/Lot number:</b> ${esc(lots || '[Lot Number]')}</li>
    <li style="${li}"><b>Quantity:</b> ${esc(qty)}</li>
    <li style="${li}"><b>Ready date:</b> ${esc(readyDate)}</li>
    <li style="${li}"><b>Collection point:</b> ${esc(collection)}</li>
  </ul>
  <p>Please arrange for collection at your earliest convenience, and let us know the expected pickup date so we can prepare accordingly. Should you need any additional documentation (e.g., Certificate of Analysis, Certificate of Conformity) for customs clearance, don't hesitate to reach out.</p>
  <p>We remain available for any questions regarding this shipment.</p>
  <p style="margin-top:18px;margin-bottom:0">Best regards,</p>
  <p style="margin-top:2px">
    <b>${esc(SENDER.contact)}</b><br>
    ${esc(SENDER.company)}<br>
    Tel: ${esc(SENDER.tel)} — ${esc(SENDER.mail)}<br>
    ${esc(SENDER.site)}
  </p>
</div>`;
    setEmailBusy(true);
    try {
      const [plPdf, invPdf] = await Promise.all([htmlToPdfBase64(buildPackingListHtml()), htmlToPdfBase64(buildInvoiceHtml())]);
      const tag = `${invoiceNo || ''}${lots ? ' - Lot ' + lots : ''}`.trim();
      const r = await fetch(`${API_URL}/api/pl/email-draft`, {
        method: 'POST', headers,
        body: JSON.stringify({ subject, bodyHtml, attachments: [
          { name: `Packing List ${tag}.pdf`.replace(/\s+/g, ' ').trim(), contentBytes: plPdf },
          { name: `Facture ${tag}.pdf`.replace(/\s+/g, ' ').trim(), contentBytes: invPdf },
        ] }),
      });
      const d = await r.json().catch(() => ({}));
      if (d.draft && d.webLink) window.open(d.webLink, '_blank');
      else { alert(`Brouillon Outlook indisponible${d.reason ? ` (${d.reason})` : ''}${d.detail ? ` : ${d.detail}` : ''}. J’ouvre un email simple, sans pièces jointes.`); deeplink(); }
    } catch { deeplink(); } finally { setEmailBusy(false); }
  };

  if (loading) return <div className="p-8 flex-1 flex items-center justify-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Chargement…</div>;

  const inputCls = 'w-full text-sm border border-slate-300 rounded-md px-2 py-1.5 outline-none focus:border-blue-500 disabled:bg-slate-50';
  const cellCls = 'w-full text-xs border border-transparent hover:border-slate-300 focus:border-blue-500 rounded px-1.5 py-1 outline-none bg-transparent';

  return (
    <div className="p-6 flex-1 overflow-auto bg-slate-50">
      <div className="flex gap-1 mb-4 border-b border-slate-200">
        {([['doc', 'Document'], ['catalog', 'Catalogue & sites']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={cn('px-4 py-2 text-sm font-medium border-b-2 -mb-px', tab === k ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700')}>{l}</button>
        ))}
      </div>

      {tab === 'doc' && (
        <div className="space-y-4">
          {/* Barre d'en-tête */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="col-span-2 lg:col-span-4 flex flex-wrap items-center gap-2">
              {canEdit && <button onClick={newDoc} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700"><FilePlus className="w-4 h-4" /> Nouveau document</button>}
              <div className="relative flex items-center">
                <FolderOpen className="w-4 h-4 text-slate-400 absolute left-2.5 pointer-events-none" />
                <select className={cn(inputCls, 'w-auto pl-8')} value={docId ?? ''} onChange={e => { if (e.target.value !== '') openDoc(Number(e.target.value)); }}>
                  <option value="">📂 Archives ({documents.length}) — ouvrir…</option>
                  {documents.map(d => <option key={d.id} value={d.id}>{d.invoiceNo || '(sans n°)'} — {d.clientName || '(sans client)'} — {d.docDate ? String(d.docDate).split('T')[0] : ''}</option>)}
                </select>
              </div>
              {canEdit && <button onClick={saveDoc} disabled={saving} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"><Save className="w-4 h-4" /> {docId ? 'Enregistrer' : 'Enregistrer (nouveau)'}</button>}
              {canEdit && docId && <button onClick={deleteDoc} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-600 bg-white border border-red-200 rounded-lg hover:bg-red-50"><Trash2 className="w-4 h-4" /> Supprimer</button>}
              <span className={cn('text-xs px-2 py-1 rounded-full font-medium', docId ? 'bg-slate-100 text-slate-500' : 'bg-amber-100 text-amber-700')}>{docId ? '✓ enregistré' : '● brouillon non enregistré'}</span>
              <div className="flex-1" />
              <button onClick={exportPackingListPDF} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"><FileDown className="w-4 h-4" /> 📦 Packing List PDF</button>
              <button onClick={exportInvoicePDF} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"><FileDown className="w-4 h-4" /> 🧾 Facture PDF</button>
              <button onClick={emailReady} disabled={emailBusy} title="Crée un brouillon Outlook « Goods Ready for Collection » (Aptos 12) avec Packing List + Facture joints" className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60">{emailBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />} {emailBusy ? 'Préparation…' : '✉️ Email mise à dispo'}</button>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500">N° Facture</label>
              <input className={inputCls} value={invoiceNo} onChange={e => setInvoiceNo(e.target.value)} placeholder="ex. FA-2026-001" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500">Date</label>
              <input type="date" className={inputCls} value={docDate} onChange={e => setDocDate(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500">REV</label>
              <input type="number" className={inputCls} value={rev} onChange={e => setRev(num(e.target.value))} />
            </div>
            <div />
            <div className="col-span-2">
              <label className="text-xs font-medium text-slate-500">Client destinataire</label>
              <select className={inputCls} value={clientName} onChange={e => { setClientName(e.target.value); const c = clients.find(x => x.name === e.target.value); setClientAddress(c?.address || ''); }}>
                <option value="">— Choisir un client —</option>
                {clients.map(c => <option key={c.id} value={c.name}>{c.name}{c.customerId ? ` (${c.customerId})` : ''}</option>)}
              </select>
              <textarea className={cn(inputCls, 'mt-1 h-20 resize-none')} value={clientAddress} onChange={e => setClientAddress(e.target.value)} placeholder="Adresse du client (modifiable pour ce document)" />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-slate-500">Lieu d'enlèvement</label>
              <select className={inputCls} value={pickupName} onChange={e => { setPickupName(e.target.value); const s = sites.find(x => x.name === e.target.value); setPickupAddress(s?.address || ''); }}>
                <option value="">— Choisir un site —</option>
                {sites.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
              <textarea className={cn(inputCls, 'mt-1 h-20 resize-none')} value={pickupAddress} onChange={e => setPickupAddress(e.target.value)} placeholder="Adresse complète du site d'enlèvement" />
            </div>
          </div>

          {/* Lignes */}
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <h3 className="text-sm font-semibold text-slate-700 flex-1">Lignes du document</h3>
              <button onClick={openBatchModal} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"><PackagePlus className="w-4 h-4" /> + Ajouter des lots</button>
              <button onClick={addManualLine} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"><Plus className="w-4 h-4" /> + Ligne manuelle</button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-200">
                    {['Réf', 'Produit', 'Qté (boîtes)', 'N° Lot', 'Péremption', 'Prix U. (€)', 'Cartons', 'Poids/boîte', 'Dim. palette', 'Poids brut', 'N° palette', ''].map((h, i) => <th key={i} className="px-1.5 py-2 font-medium whitespace-nowrap">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {lines.length === 0 && <tr><td colSpan={12} className="text-center text-slate-400 py-6">Aucune ligne — ajoutez des lots ou une ligne manuelle.</td></tr>}
                  {lines.map((l, i) => {
                    const e = effectiveLine(l);
                    return (
                      <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="w-28"><input className={cellCls} list="pl-refs" value={l.ref} onChange={ev => setLine(i, { ref: ev.target.value })} /></td>
                        <td className="min-w-[160px]"><input className={cellCls} value={l.product} onChange={ev => setLine(i, { product: ev.target.value })} /></td>
                        <td className="w-20"><input type="number" className={cellCls} value={l.qty} onChange={ev => setLine(i, { qty: ev.target.value })} /></td>
                        <td className="w-24"><input className={cellCls} value={l.lot} onChange={ev => setLine(i, { lot: ev.target.value })} /></td>
                        <td className="w-28"><input className={cellCls} value={l.expiry} onChange={ev => setLine(i, { expiry: ev.target.value })} placeholder="MM/AAAA" /></td>
                        <td className="w-20"><input type="number" className={cellCls} value={l.unitPrice} onChange={ev => setLine(i, { unitPrice: ev.target.value })} /></td>
                        <td className="w-20"><input type="number" className={cn(cellCls, l.cartons === '' && 'text-blue-700 font-medium')} value={l.cartons === '' ? e.cartons : l.cartons} onChange={ev => setLine(i, { cartons: ev.target.value })} title="Calculé automatiquement — tapez une valeur pour surcharger" /></td>
                        <td className="w-20"><input type="number" step="0.001" className={cellCls} value={l.boxWeight} onChange={ev => setLine(i, { boxWeight: ev.target.value })} /></td>
                        <td className="w-28"><input className={cn(cellCls, !l.dimension && 'text-blue-700 font-medium')} value={l.dimension || e.dimension} onChange={ev => setLine(i, { dimension: ev.target.value === e.autoDimension ? '' : ev.target.value })} title="Calculé automatiquement — tapez une valeur pour surcharger" /></td>
                        <td className="w-20"><input type="number" className={cn(cellCls, l.grossWeight === '' && 'text-blue-700 font-medium')} value={l.grossWeight === '' ? e.grossWeight : l.grossWeight} onChange={ev => setLine(i, { grossWeight: ev.target.value })} title="Calculé automatiquement — tapez une valeur pour surcharger" /></td>
                        <td className="w-16"><input className={cellCls} value={l.palette} onChange={ev => setLine(i, { palette: ev.target.value })} /></td>
                        <td className="w-8"><button onClick={() => removeLine(i)} className="text-slate-300 hover:text-red-500 p-1" title="Supprimer la ligne"><Trash2 className="w-3.5 h-3.5" /></button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <datalist id="pl-refs">{products.map(p => <option key={p.ref} value={p.ref}>{p.designation}</option>)}</datalist>
            </div>
            {lines.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                <div className="bg-slate-100 rounded-lg px-3 py-1.5">Boîtes : <b>{totals.boxes}</b></div>
                <div className="bg-slate-100 rounded-lg px-3 py-1.5">Cartons : <b>{totals.cartons}</b></div>
                <div className="bg-slate-100 rounded-lg px-3 py-1.5">Poids brut : <b>{totals.gross} kg</b></div>
                <div className="bg-slate-100 rounded-lg px-3 py-1.5">Palettes : <b>{totals.palettes}</b></div>
                <div className="bg-blue-50 text-blue-800 rounded-lg px-3 py-1.5">Total HT : <b>{eur(totals.totalHT)}</b></div>
                <div className="text-xs text-slate-500 italic w-full">{totals.say}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'catalog' && <CatalogTab products={products} sites={sites} clients={clients} canEdit={canEdit} headers={headers} onReload={load} />}

      {/* Modale de sélection des lots */}
      {batchModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-6" onClick={() => setBatchModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-slate-200">
              <h3 className="text-sm font-semibold text-slate-800">Sélectionner des lots</h3>
              <button onClick={() => setBatchModal(false)} className="text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              {batchesLoading ? <div className="text-slate-400 text-sm flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Chargement des lots…</div> : (
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-slate-500 border-b border-slate-200"><th className="px-2 py-2"></th><th className="px-2 py-2">N° Lot</th><th className="px-2 py-2">Produit</th><th className="px-2 py-2">Réf</th><th className="px-2 py-2">Client</th><th className="px-2 py-2 text-right">Boîtes vendues</th></tr></thead>
                  <tbody>
                    {batches.map(b => (
                      <tr key={b.id} className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => setChecked(s => { const n = new Set(s); n.has(b.id) ? n.delete(b.id) : n.add(b.id); return n; })}>
                        <td className="px-2 py-1.5"><input type="checkbox" checked={checked.has(b.id)} readOnly /></td>
                        <td className="px-2 py-1.5 font-medium">{b.id}</td>
                        <td className="px-2 py-1.5">{b.product}</td>
                        <td className="px-2 py-1.5">{b.reference}</td>
                        <td className="px-2 py-1.5">{b.client}</td>
                        <td className="px-2 py-1.5 text-right">{b.sold}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="p-4 border-t border-slate-200 flex items-center justify-between gap-2">
              <span className="text-[11px] text-slate-400 italic">Chaque lot est réparti automatiquement sur autant de palettes que nécessaire (max 20 cartons / palette).</span>
              <div className="flex gap-2">
                <button onClick={() => setBatchModal(false)} className="px-3 py-1.5 text-sm text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50">Annuler</button>
                <button onClick={addBatchLines} disabled={checked.size === 0} className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">Ajouter {checked.size} lot(s)</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Onglet catalogue : produits (prix / poids / HS), adresses des sites, clients ---
function CatalogTab({ products, sites, clients, canEdit, headers, onReload }: {
  products: PlProduct[]; sites: PlSite[]; clients: PlClient[]; canEdit: boolean;
  headers: Record<string, string>; onReload: () => Promise<void>;
}) {
  const [rows, setRows] = useState<PlProduct[]>(products);
  const [siteRows, setSiteRows] = useState<PlSite[]>(sites);
  const [savingProducts, setSavingProducts] = useState(false);
  useEffect(() => setRows(products), [products]);
  useEffect(() => setSiteRows(sites), [sites]);

  const setRow = (i: number, patch: Partial<PlProduct>) => setRows(prev => prev.map((r, j) => j === i ? { ...r, ...patch } : r));
  const cellCls = 'w-full text-xs border border-transparent hover:border-slate-300 focus:border-blue-500 rounded px-1.5 py-1 outline-none bg-transparent disabled:text-slate-500';

  const saveProducts = async () => {
    setSavingProducts(true);
    try {
      const r = await fetch(`${API_URL}/api/pl/products`, { method: 'PUT', headers, body: JSON.stringify({ products: rows.filter(p => p.ref) }) });
      if (!r.ok) { const e = await r.json().catch(() => ({})); alert(e.error || 'Erreur'); return; }
      await onReload();
      alert('Catalogue enregistré ✓');
    } finally { setSavingProducts(false); }
  };

  const saveSite = async (s: PlSite) => {
    const r = await fetch(`${API_URL}/api/pl/sites/${s.id}`, { method: 'PATCH', headers, body: JSON.stringify({ address: s.address }) });
    if (!r.ok) { alert('Erreur'); return; }
    await onReload();
  };

  const addClient = async () => {
    const name = prompt('Nom du client :');
    if (!name) return;
    const r = await fetch(`${API_URL}/api/pl/clients`, { method: 'POST', headers, body: JSON.stringify({ name, address: '', customerId: '' }) });
    if (!r.ok) { const e = await r.json().catch(() => ({})); alert(e.error || 'Erreur'); }
    await onReload();
  };
  const patchClient = async (id: number, patch: any) => {
    await fetch(`${API_URL}/api/pl/clients/${id}`, { method: 'PATCH', headers, body: JSON.stringify(patch) });
    await onReload();
  };
  const deleteClient = async (c: PlClient) => {
    if (!confirm(`Supprimer le client ${c.name} ?`)) return;
    await fetch(`${API_URL}/api/pl/clients/${c.id}`, { method: 'DELETE', headers });
    await onReload();
  };

  return (
    <div className="space-y-5">
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-sm font-semibold text-slate-700 flex-1">Catalogue produits</h3>
          {canEdit && <button onClick={() => setRows(prev => [...prev, { ref: '', designation: '', type: 'DM', hsCode: '', unitPrice: null, boxWeightKg: null, capacityPerCarton: null }])} className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"><Plus className="w-4 h-4" /> Ajouter</button>}
          {canEdit && <button onClick={saveProducts} disabled={savingProducts} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"><Save className="w-4 h-4" /> Enregistrer le catalogue</button>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-slate-500 border-b border-slate-200">{['Réf', 'Désignation', 'Type', 'Code HS', 'Prix U. (€)', 'Poids boîte (kg)', 'Boîtes/carton', ''].map((h, i) => <th key={i} className="px-1.5 py-2 font-medium whitespace-nowrap">{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((p, i) => (
                <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="w-32"><input disabled={!canEdit} className={cellCls} value={p.ref} onChange={e => setRow(i, { ref: e.target.value })} /></td>
                  <td className="min-w-[180px]"><input disabled={!canEdit} className={cellCls} value={p.designation || ''} onChange={e => setRow(i, { designation: e.target.value })} /></td>
                  <td className="w-24">
                    <select disabled={!canEdit} className={cellCls} value={p.type || 'DM'} onChange={e => setRow(i, { type: e.target.value })}>
                      <option value="DM">DM</option><option value="Cosmetic">Cosmetic</option>
                    </select>
                  </td>
                  <td className="w-32"><input disabled={!canEdit} className={cellCls} value={p.hsCode || ''} onChange={e => setRow(i, { hsCode: e.target.value })} /></td>
                  <td className="w-20"><input disabled={!canEdit} type="number" className={cellCls} value={p.unitPrice ?? ''} onChange={e => setRow(i, { unitPrice: e.target.value === '' ? null : Number(e.target.value) })} /></td>
                  <td className="w-24"><input disabled={!canEdit} type="number" step="0.001" className={cellCls} value={p.boxWeightKg ?? ''} onChange={e => setRow(i, { boxWeightKg: e.target.value === '' ? null : Number(e.target.value) })} /></td>
                  <td className="w-24"><input disabled={!canEdit} type="number" className={cellCls} value={p.capacityPerCarton ?? ''} onChange={e => setRow(i, { capacityPerCarton: e.target.value === '' ? null : Number(e.target.value) })} /></td>
                  <td className="w-8">{canEdit && <button onClick={() => setRows(prev => prev.filter((_, j) => j !== i))} className="text-slate-300 hover:text-red-500 p-1"><Trash2 className="w-3.5 h-3.5" /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {canEdit && <p className="text-[11px] text-slate-400 mt-2">Les suppressions et ajouts ne sont appliqués qu'au clic sur « Enregistrer le catalogue ».</p>}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Lieux d'enlèvement (adresses)</h3>
        <div className="grid gap-3 md:grid-cols-2">
          {siteRows.map((s, i) => (
            <div key={s.id} className="border border-slate-200 rounded-lg p-3">
              <div className="flex items-center justify-between mb-1">
                <div className="text-sm font-medium text-slate-700">{s.name}</div>
                {canEdit && <button onClick={() => saveSite(s)} className="text-xs font-medium text-blue-600 hover:text-blue-800">Enregistrer</button>}
              </div>
              <textarea disabled={!canEdit} className="w-full text-xs border border-slate-300 rounded-md px-2 py-1.5 h-20 resize-none outline-none focus:border-blue-500 disabled:bg-slate-50" value={s.address || ''} onChange={e => setSiteRows(prev => prev.map((x, j) => j === i ? { ...x, address: e.target.value } : x))} />
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-sm font-semibold text-slate-700 flex-1">Clients</h3>
          {canEdit && <button onClick={addClient} className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"><Plus className="w-4 h-4" /> Ajouter</button>}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {clients.map(c => (
            <div key={c.id} className="border border-slate-200 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1">
                <div className="text-sm font-medium text-slate-700 flex-1">{c.name}</div>
                <span className="text-xs text-slate-400">{c.customerId}</span>
                {canEdit && <button onClick={() => { const v = prompt('Customer ID :', c.customerId || ''); if (v !== null) patchClient(c.id, { customerId: v }); }} className="text-xs font-medium text-blue-600 hover:text-blue-800">ID</button>}
                {canEdit && <button onClick={() => deleteClient(c)} className="text-slate-300 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>}
              </div>
              <textarea disabled={!canEdit} className="w-full text-xs border border-slate-300 rounded-md px-2 py-1.5 h-20 resize-none outline-none focus:border-blue-500 disabled:bg-slate-50" defaultValue={c.address || ''} onBlur={e => { if (canEdit && e.target.value !== c.address) patchClient(c.id, { address: e.target.value }); }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
