import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../AuthContext';
import { cn } from '../utils/cn';
import { Loader2, RefreshCw, ExternalLink, AlertTriangle } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';

// Accueil — cockpit personnel repris de Louna OS : ce qui demande une décision aujourd'hui
// (emails urgents, commandes à relancer, lots en fabrication, qualité, certificats, forecast).

const API_URL = import.meta.env.VITE_API_URL || '';
const MOIS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];

const STAGES: Record<string, [string, string]> = {
  PLANIFIE: ['📅', 'Planifié'], FORMULATION: ['🧪', 'Formulation'], CONDI_PRIM: ['💉', 'Cond. primaire'],
  CONDI_SEC: ['📦', 'Cond. secondaire'], LIBERATION: ['✅', 'Libération'],
  ATTENTE_ENLEVEMENT: ['🚚', 'Attente enlèvement'], EXPEDIE: ['✈️', 'Expédié'],
};
const QUALITY: Record<string, [string, string]> = {
  NOT_STARTED: ['⚪', 'Non démarré'], EN_COURS: ['🟡', 'Contrôle en cours'],
  QUARANTAINE: ['🔴', 'Quarantaine'], LIBERE: ['🟢', 'Libéré'], REJETE: ['⛔', 'Rejeté'],
};
const STAGE_ORDER = ['PLANIFIE', 'FORMULATION', 'CONDI_PRIM', 'CONDI_SEC', 'LIBERATION', 'ATTENTE_ENLEVEMENT', 'EXPEDIE'];
const QUAL_ORDER = ['REJETE', 'QUARANTAINE', 'NOT_STARTED', 'EN_COURS', 'LIBERE'];

const fdate = (d?: string | null) => d ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) : '—';
const feur = (n: number) => (n || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' €';
const today = () => new Date().toISOString().slice(0, 10);

type Accueil = {
  lots: any[]; nc: any[]; capa: any[]; cc: any[];
  fournisseurs: any[]; emailsUrgents: any[]; commandes: any[];
  forecast: { year: number; previsionnel: number[]; realise: number[] };
};

function Pill({ tone, children }: { tone: 'red' | 'amber' | 'green' | 'slate'; children: React.ReactNode }) {
  const cls = { red: 'bg-red-50 text-red-700 border-red-200', amber: 'bg-amber-50 text-amber-700 border-amber-200', green: 'bg-emerald-50 text-emerald-700 border-emerald-200', slate: 'bg-slate-100 text-slate-600 border-slate-200' }[tone];
  return <span className={cn('inline-block px-2 py-0.5 rounded-full border text-[11px] font-medium whitespace-nowrap', cls)}>{children}</span>;
}

function Kpi({ value, label, tone, onClick }: { value: number; label: string; tone?: 'red' | 'amber'; onClick?: () => void }) {
  const color = tone === 'red' ? 'text-red-600' : tone === 'amber' ? 'text-amber-600' : 'text-slate-900';
  return (
    <button onClick={onClick} disabled={!onClick}
      className={cn('bg-white border border-slate-200 rounded-xl p-4 text-left', onClick && 'hover:border-blue-300 transition-colors')}>
      <div className={cn('text-3xl font-bold', color)}>{value}</div>
      <div className="text-xs text-slate-500 mt-1 leading-tight">{label}</div>
    </button>
  );
}

function Card({ title, count, children }: { title: string; count?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <h2 className="text-sm font-semibold text-slate-800 mb-3 flex items-baseline gap-2">
        {title}{count && <span className="text-xs font-normal text-slate-400">{count}</span>}
      </h2>
      {children}
    </div>
  );
}

export function AccueilView({ onOpenBatch, onGoEmails }: { onOpenBatch: (id: string) => void; onGoEmails: () => void }) {
  const { token } = useAuth();
  const [data, setData] = useState<Accueil | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sort, setSort] = useState<{ col: number; asc: boolean }>({ col: 4, asc: true }); // livraison

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const r = await fetch(`${API_URL}/api/accueil`, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Erreur ${r.status}`);
      setData(await r.json());
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const cols = useMemo(() => [
    { label: 'N° de lot', sort: (l: any) => (l.id || '').toLowerCase() },
    { label: 'Produit', sort: (l: any) => (l.product || l.reference || '').toLowerCase() },
    { label: 'Étape fabrication', sort: (l: any) => STAGE_ORDER.indexOf(l.process_stage) },
    { label: 'Contrôle qualité', sort: (l: any) => QUAL_ORDER.indexOf(l.quality_status) },
    { label: 'Livraison', sort: (l: any) => l.deliverydate || l.deliveryDate || '9999' },
  ], []);

  const lotsTries = useMemo(() => {
    if (!data) return [];
    const f = cols[sort.col].sort;
    return [...data.lots].sort((a, b) => {
      const va = f(a), vb = f(b);
      const c = va < vb ? -1 : va > vb ? 1 : 0;
      return sort.asc ? c : -c;
    });
  }, [data, sort, cols]);

  if (loading && !data) {
    return <div className="flex-1 flex items-center justify-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Chargement…</div>;
  }
  if (error && !data) {
    return <div className="flex-1 p-8 text-red-600 text-sm">Erreur : {error}</div>;
  }
  if (!data) return null;

  const cmdRetard = data.commandes.filter(o => o.etat === 'RETARD').length;
  const totalQ = data.nc.length + data.capa.length + data.cc.length;
  const qrows = [
    ...data.nc.map(x => ({ ...x, tag: 'NC', tone: 'red' as const })),
    ...data.capa.map(x => ({ ...x, tag: 'CAPA', tone: 'amber' as const })),
    ...data.cc.map(x => ({ ...x, tag: 'CC', tone: 'amber' as const })),
  ].sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'));
  const totalPrev = data.forecast.previsionnel.reduce((a, b) => a + b, 0);
  const totalReal = data.forecast.realise.reduce((a, b) => a + b, 0);
  const chartData = MOIS.map((m, i) => ({ mois: m, Prévisionnel: data.forecast.previsionnel[i] || 0, 'Réalisé (facturé)': data.forecast.realise[i] || 0 }));

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">
      <div className="flex justify-end">
        <button onClick={load} disabled={loading}
          className="inline-flex items-center gap-2 text-xs text-slate-500 hover:text-slate-800 disabled:opacity-50">
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} /> Actualiser
        </button>
      </div>

      {/* Compteurs du jour */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Kpi value={data.emailsUrgents.length} label="emails action urgente" tone={data.emailsUrgents.length ? 'red' : undefined} onClick={onGoEmails} />
        <Kpi value={data.lots.length} label="lots en fabrication" />
        <Kpi value={data.commandes.length} label="commandes à relancer" tone={cmdRetard ? 'red' : data.commandes.length ? 'amber' : undefined} />
        <Kpi value={totalQ} label="NC / CAPA / réclamations" tone={totalQ ? 'amber' : undefined} />
        <Kpi value={data.fournisseurs.length} label="certificats < 120 j" tone={data.fournisseurs.length ? 'amber' : undefined} />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Emails urgents */}
        <Card title="🔴 À traiter en premier" count="top 5 · urgent + important">
          {!data.emailsUrgents.length && <p className="text-sm text-slate-400">Rien d'urgent — profite de ta matinée ☀️</p>}
          <div className="space-y-2">
            {data.emailsUrgents.map(m => (
              <div key={m.id} onClick={() => m.web_link && window.open(m.web_link, '_blank', 'noopener')}
                className={cn('border-l-2 border-red-400 bg-red-50/40 rounded-r-lg px-3 py-2', m.web_link && 'cursor-pointer hover:bg-red-50')}>
                <div className="text-sm font-medium text-slate-800">{m.sujet}</div>
                <div className="text-xs text-slate-500 mt-0.5">{m.expediteur} · {fdate(m.recu_le)}{m.resume ? ` — ${m.resume}` : ''}</div>
              </div>
            ))}
          </div>
        </Card>

        {/* Commandes fournisseurs */}
        <Card title="📦 Commandes à relancer" count="retard + échéance ≤ 2 semaines">
          {!data.commandes.length && <p className="text-sm text-slate-400">Aucune commande fournisseur à relancer ✅</p>}
          {!!data.commandes.length && (
            <table className="w-full text-sm">
              <thead className="text-[11px] uppercase text-slate-400 border-b border-slate-100">
                <tr><th className="text-left py-1.5">Commande</th><th className="text-left">Fournisseur</th><th className="text-right">Échéance</th></tr>
              </thead>
              <tbody>
                {data.commandes.slice(0, 8).map(o => (
                  <tr key={o.id} className="border-b border-slate-50 last:border-0">
                    <td className="py-1.5 font-medium text-slate-800">{o.name}</td>
                    <td className="text-slate-600">{o.partner}</td>
                    <td className="text-right">
                      {o.etat === 'RETARD'
                        ? <Pill tone="red">⚠️ en retard {fdate(o.datePlanned)}</Pill>
                        : <Pill tone="amber">⏳ {fdate(o.datePlanned)}</Pill>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      {/* Lots en fabrication */}
      <Card title="🏭 Lots en fabrication" count={String(data.lots.length)}>
        {!data.lots.length && <p className="text-sm text-slate-400">Aucun lot en fabrication actuellement.</p>}
        {!!data.lots.length && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[11px] uppercase text-slate-400 border-b border-slate-100">
                <tr>
                  {cols.map((c, i) => (
                    <th key={c.label} className="text-left py-1.5 pr-3">
                      <button onClick={() => setSort(s => s.col === i ? { col: i, asc: !s.asc } : { col: i, asc: true })}
                        className={cn('inline-flex items-center gap-1 hover:text-slate-700', sort.col === i && 'text-blue-600')}>
                        {c.label}<span className="text-[9px]">{sort.col === i ? (sort.asc ? '▲' : '▼') : '△'}</span>
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lotsTries.map(l => {
                  const s = STAGES[l.process_stage] || ['⚙️', l.process_stage || '—'];
                  const q = QUALITY[l.quality_status] || ['', l.quality_status || '—'];
                  const liv = l.deliverydate || l.deliveryDate;
                  const retard = liv && String(liv).slice(0, 10) < today();
                  return (
                    <tr key={l.id} onClick={() => onOpenBatch(l.id)} className="border-b border-slate-50 last:border-0 cursor-pointer hover:bg-slate-50">
                      <td className="py-2 pr-3 font-medium text-slate-800">{l.id || '—'}</td>
                      <td className="pr-3 text-slate-600">{l.product || l.reference || '—'}</td>
                      <td className="pr-3">{s[0]} {s[1]}</td>
                      <td className="pr-3">{q[0]} {q[1]}</td>
                      <td className="pr-3">{liv ? (retard ? <Pill tone="red">⚠️ {fdate(liv)}</Pill> : fdate(liv)) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* QMS ouvert */}
        <Card title="🧪 Qualité à traiter" count={`${data.nc.length} NC · ${data.capa.length} CAPA · ${data.cc.length} réclam.`}>
          {!totalQ && <p className="text-sm text-slate-400">Rien d'ouvert ✅</p>}
          <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
            {qrows.map((r, i) => {
              const depasse = r.due_date && String(r.due_date).slice(0, 10) < today();
              return (
                <div key={i} onClick={() => r.web_url && window.open(r.web_url, '_blank', 'noopener')}
                  className={cn('px-3 py-2 rounded-lg bg-slate-50', r.web_url && 'cursor-pointer hover:bg-slate-100')}>
                  <div className="text-sm text-slate-700 flex items-start gap-2">
                    <Pill tone={r.tone}>{r.tag} {r.ext_id || ''}</Pill>
                    <span className="flex-1">{(r.description || '').slice(0, 90)}</span>
                    {r.web_url && <ExternalLink className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />}
                  </div>
                  {r.due_date && (
                    <div className="text-xs mt-1">
                      {depasse ? <Pill tone="red">échéance dépassée {fdate(r.due_date)}</Pill> : <span className="text-slate-500">échéance {fdate(r.due_date)}</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>

        {/* Certificats fournisseurs */}
        <Card title="📜 Certificats fournisseurs à surveiller">
          {!data.fournisseurs.length && <p className="text-sm text-slate-400">Aucun certificat n'expire dans les 120 jours ✅</p>}
          {!!data.fournisseurs.length && (
            <table className="w-full text-sm">
              <thead className="text-[11px] uppercase text-slate-400 border-b border-slate-100">
                <tr><th className="text-left py-1.5">Fournisseur</th><th className="text-left">Certificat</th><th className="text-right">Expire</th></tr>
              </thead>
              <tbody>
                {data.fournisseurs.slice(0, 8).map((f, i) => {
                  const jours = Math.round((new Date(f.cert_expiration).getTime() - Date.now()) / 86400000);
                  const tone = jours < 30 ? 'red' : jours < 60 ? 'amber' : 'green';
                  return (
                    <tr key={i} className="border-b border-slate-50 last:border-0">
                      <td className="py-1.5 text-slate-700">{f.name}</td>
                      <td className="text-slate-500">{f.cert_ref || ''}</td>
                      <td className="text-right"><Pill tone={tone}>{fdate(f.cert_expiration)} ({jours} j)</Pill></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      {/* Forecast ventes */}
      <Card title={`📈 Forecast ventes ${data.forecast.year}`} count={`prévu ${feur(totalPrev)} · réalisé/facturé ${feur(totalReal)}`}>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="mois" tick={{ fontSize: 11, fill: '#64748b' }} />
            <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={(v: number) => `${Math.round(v / 1000)}k€`} />
            <Tooltip formatter={(v: any) => feur(Number(v))} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="Prévisionnel" fill="#818cf8" radius={[4, 4, 0, 0]} />
            <Bar dataKey="Réalisé (facturé)" fill="#059669" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {error && (
        <p className="text-xs text-amber-600 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> {error}</p>
      )}
    </div>
  );
}
