// Formats de dates FR partagés (affichage « 10/07/2026 » / « juil. 2026 », — si vide/invalide).
export const fmtDate = (iso: string | null) => { if (!iso) return '—'; const d = new Date(iso); return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR'); };
export const fmtMonth = (iso: string | null) => { if (!iso) return '—'; const d = new Date(iso); return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' }); };
