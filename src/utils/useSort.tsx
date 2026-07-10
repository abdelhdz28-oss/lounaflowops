import React, { useMemo, useState } from 'react';

// Tri générique d'un tableau d'objets par clé, avec bascule asc/desc.
// Gère nombres, dates ISO et chaînes (tri naturel FR), valeurs nulles en dernier.
export function useSort<T extends Record<string, any>>(rows: T[], initialKey: string | null = null, initialDir: 'asc' | 'desc' = 'asc') {
  const [sortKey, setSortKey] = useState<string | null>(initialKey);
  const [dir, setDir] = useState<'asc' | 'desc'>(initialDir);

  const toggle = (key: string) => {
    if (sortKey === key) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setDir('asc'); }
  };

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    const arr = [...rows];
    arr.sort((a, b) => {
      const av = a[sortKey]; const bv = b[sortKey];
      const an = av == null || av === ''; const bn = bv == null || bv === '';
      if (an && bn) return 0; if (an) return 1; if (bn) return -1;
      let cmp: number;
      if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
      else {
        const ad = Date.parse(av); const bd = Date.parse(bv);
        if (!isNaN(ad) && !isNaN(bd)) cmp = ad - bd;
        else cmp = String(av).localeCompare(String(bv), 'fr', { numeric: true, sensitivity: 'base' });
      }
      return dir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [rows, sortKey, dir]);

  return { sorted, sortKey, dir, toggle };
}

export type SortState = ReturnType<typeof useSort>;

// En-tête de colonne triable (clic = bascule asc/desc).
export function SortTh({ k, label, sort, className = 'px-4 py-3 font-medium', align = 'left' }: { k: string; label: string; sort: SortState; className?: string; align?: 'left' | 'right' }) {
  const active = sort.sortKey === k;
  return (
    <th className={className}>
      <button onClick={() => sort.toggle(k)} className={`inline-flex items-center gap-1 hover:text-slate-700 ${align === 'right' ? 'justify-end w-full' : ''} ${active ? 'text-slate-800' : ''}`}>
        {label}<span className="text-[9px] text-slate-400">{active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
      </button>
    </th>
  );
}
