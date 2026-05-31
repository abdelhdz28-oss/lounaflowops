import React from 'react';
import { Truck, Plus } from 'lucide-react';
import { useAppContext } from '../AppContext';
import { cn } from '../utils/cn';

export function DeliveriesView() {
  const { deliveries, createDelivery } = useAppContext();

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

  return (
    <div className="p-8 flex-1 overflow-y-auto bg-slate-50">
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-lg font-semibold text-slate-800">Planning Livraisons Clients</h3>
        <button 
          onClick={handleAddDelivery}
          className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Ajouter Livraison
        </button>
      </div>
      
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden flex flex-col">
        <div className="flex items-center p-4 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wider">
          <div className="w-16 flex justify-center"></div>
          <div className="flex-1 grid grid-cols-6 gap-4 items-center">
            <div>CLIENT</div>
            <div>DATE LIVRAISON</div>
            <div>NUMÉRO DE LOT</div>
            <div>BOÎTES VENDUES</div>
            <div>PALETTES</div>
            <div>STATUT</div>
          </div>
        </div>
        
        <div className="flex flex-col">
          {deliveries.map((d) => (
            <div key={d.id} className="flex items-center p-4 border-b border-slate-100 hover:bg-slate-50 transition-colors last:border-0">
              <div className="w-16 flex justify-center text-blue-600">
                <Truck className="w-6 h-6" />
              </div>
              <div className="flex-1 grid grid-cols-6 gap-4 items-center text-sm text-slate-700">
                <div className="font-medium text-slate-900">{d.client}</div>
                <div>{d.date}</div>
                <div className="font-mono font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded w-fit">{d.batchId}</div>
                <div>{d.boxesSold.toLocaleString()} boîtes</div>
                <div>{d.palettes} Palette(s)</div>
                <div>
                  <span className={cn(
                    "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold",
                    d.status === 'PRÊT' ? "bg-green-100 text-green-800" : 
                    d.status === 'EXPÉDIÉ' ? "bg-blue-100 text-blue-800" :
                    d.status === 'RETARDÉ' ? "bg-red-100 text-red-800" :
                    "bg-slate-100 text-slate-800"
                  )}>
                    {d.status}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
