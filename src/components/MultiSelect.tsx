import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';

// Menu déroulant à choix multiples (cases à cocher) partagé.
// Rien de coché = tout. `width` = largeur du panneau (seule variation entre les vues).
export function MultiSelect({ label, options, selected, onChange, width = 'w-64' }: {
  label: string; options: string[]; selected: Set<string>; onChange: (s: Set<string>) => void; width?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)} className="text-sm border border-slate-300 rounded-md px-3 py-1.5 bg-white flex items-center gap-1.5 hover:bg-slate-50">
        {label}{selected.size > 0 && <span className="bg-blue-100 text-blue-700 rounded-full px-1.5 text-[10px] font-medium">{selected.size}</span>}
        <ChevronDown className="w-3 h-3 text-slate-400" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className={`absolute z-20 mt-1 ${width} max-h-72 overflow-auto bg-white border border-slate-200 rounded-lg shadow-lg p-2`}>
            <div className="flex justify-between items-center px-1 pb-1 mb-1 border-b border-slate-100">
              <span className="text-[11px] text-slate-400">{selected.size} sélectionné(s)</span>
              {selected.size > 0 && <button onClick={() => onChange(new Set())} className="text-[11px] text-blue-600 hover:underline">Tout effacer</button>}
            </div>
            {options.map(o => (
              <label key={o} className="flex items-center gap-2 px-1 py-1 text-xs hover:bg-slate-50 rounded cursor-pointer">
                <input type="checkbox" checked={selected.has(o)} onChange={() => { const n = new Set(selected); n.has(o) ? n.delete(o) : n.add(o); onChange(n); }} className="accent-blue-600" />
                <span className="truncate" title={o}>{o}</span>
              </label>
            ))}
            {options.length === 0 && <div className="text-xs text-slate-400 px-1 py-2">Aucune option</div>}
          </div>
        </>
      )}
    </div>
  );
}
