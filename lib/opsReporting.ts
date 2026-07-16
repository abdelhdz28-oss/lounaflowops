// Logique pure du module Reporting Ops, isolée pour être testable unitairement (F1 renumérotation, F4 parsing JSON).

// F1 — Détermine l'index cible d'un déplacement de livrable.
// { position: n } (1-based, borné à la liste) l'emporte ; sinon { direction }. Renvoie -1 si la position est invalide.
export function resolveMoveTarget(
  idx: number,
  len: number,
  opts: { direction?: string; position?: number | string },
): number {
  if (opts.position !== undefined) {
    const p = parseInt(String(opts.position), 10);
    if (Number.isNaN(p)) return -1;
    return Math.max(0, Math.min(len - 1, p - 1));
  }
  return opts.direction === 'up' ? idx - 1 : idx + 1;
}

// F1 — Déplace l'élément d'index `idx` vers `target` (déplacement, pas un simple échange). Renvoie un nouveau tableau.
export function reorderIds<T>(ids: T[], idx: number, target: number): T[] {
  const a = ids.slice();
  a.splice(target, 0, a.splice(idx, 1)[0]);
  return a;
}

// F4 — Extrait et valide le JSON du bilan renvoyé par l'IA (tolère les ``` et le texte parasite autour).
// Renvoie l'objet seulement s'il a la forme attendue { bilan: [], objectifs_hebdo: [] }, sinon null.
export function extractBilanJson(text: string): any | null {
  if (!text) return null;
  let s = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = s.indexOf('{'); const b = s.lastIndexOf('}');
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  let parsed: any;
  try { parsed = JSON.parse(s); } catch { return null; }
  if (parsed && Array.isArray(parsed.bilan) && Array.isArray(parsed.objectifs_hebdo)) return parsed;
  return null;
}
