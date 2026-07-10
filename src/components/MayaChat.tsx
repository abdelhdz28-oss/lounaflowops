import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../AuthContext';
import { cn } from '../utils/cn';
import { Sparkles, Send, X, Loader2 } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || '';

interface Msg { role: 'user' | 'assistant'; content: string; }

const HELLO: Msg = {
  role: 'assistant',
  content: "Salut, moi c'est Maya 👋 Ton assistante Ops. Demande-moi un point projet, un débrief hebdo, ou des infos Odoo (stock, factures…) — je connais ton board et l'ERP.",
};

export function MayaChat() {
  const { token } = useAuth();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([HELLO]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs, open, loading]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    const next: Msg[] = [...msgs, { role: 'user', content: text }];
    setMsgs(next);
    setInput('');
    setLoading(true);
    try {
      const r = await fetch(`${API_URL}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messages: next.slice(1) }),
      });
      const d = await r.json();
      setMsgs(m => [...m, { role: 'assistant', content: r.ok ? d.reply : (d.error || "Je suis indisponible là, réessaie.") }]);
    } catch {
      setMsgs(m => [...m, { role: 'assistant', content: "Erreur réseau — je n'ai pas pu répondre." }]);
    } finally {
      setLoading(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-full shadow-lg hover:bg-blue-700 transition-colors"
      >
        <Sparkles className="w-5 h-5" /> Maya
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 w-96 max-w-[92vw] h-[32rem] bg-white border border-slate-200 rounded-2xl shadow-2xl flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <div className="flex items-center gap-2 font-semibold text-slate-800">
          <Sparkles className="w-4 h-4 text-blue-600" /> Maya
          <span className="text-xs font-normal text-slate-400">assistante Ops</span>
        </div>
        <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {msgs.map((m, i) => (
          <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
            <div className={cn(
              'max-w-[85%] px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap',
              m.role === 'user' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700'
            )}>{m.content}</div>
          </div>
        ))}
        {loading && <div className="flex items-center gap-2 text-slate-400 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Maya réfléchit…</div>}
        <div ref={endRef} />
      </div>

      <div className="p-3 border-t border-slate-100 flex gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send()}
          placeholder="Écris à Maya…"
          className="flex-1 text-sm border border-slate-300 rounded-lg px-3 py-2 outline-none focus:border-blue-500"
        />
        <button onClick={send} disabled={loading} className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
