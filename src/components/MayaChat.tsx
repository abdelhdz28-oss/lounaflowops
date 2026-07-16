import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../AuthContext';
import { cn } from '../utils/cn';
import { Sparkles, Send, X, Loader2, Mic, Volume2, VolumeX } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || '';

// Reconnaissance vocale du navigateur (Chrome/Edge). Absent sur d'autres → micro masqué.
const SpeechRec: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
const VOICE_INPUT_OK = !!SpeechRec;
const VOICE_OUTPUT_OK = typeof window !== 'undefined' && 'speechSynthesis' in window;

// Nettoie le texte avant lecture à voix haute (retire emojis et markdown simple).
function cleanForSpeech(text: string): string {
  return text
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}]/gu, '') // emojis
    .replace(/[*_#`>]/g, '')                                   // markdown
    .replace(/\s+/g, ' ')
    .trim();
}

interface Msg { role: 'user' | 'assistant'; content: string; }

const HELLO: Msg = {
  role: 'assistant',
  content: "Salut, moi c'est Maya 👋 Ton assistante Ops. Demande-moi un point projet, un débrief hebdo, ou des infos Odoo (stock, factures…) — je connais ton board et l'ERP.",
};

// « Fais-moi le point » : demande à Maya un état des lieux parlé de la situation.
const BRIEF_PROMPT = "Fais-moi un point rapide et parlé de la situation actuelle : les factures fournisseurs en attente ou en retard, les niveaux de stock bas, et les lots à surveiller (péremption proche ou non libérés). Reste synthétique, quelques phrases claires, en priorisant ce qui demande mon attention.";

export function MayaChat({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { token } = useAuth();
  const [msgs, setMsgs] = useState<Msg[]>([HELLO]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true); // Maya lit ses réponses à voix haute
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs, open, loading]);

  // Lit un texte à voix haute (voix française si disponible).
  const speak = (text: string) => {
    if (!VOICE_OUTPUT_OK) return;
    const clean = cleanForSpeech(text);
    if (!clean) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(clean);
    utter.lang = 'fr-FR';
    const frVoice = window.speechSynthesis.getVoices().find(v => v.lang && v.lang.startsWith('fr'));
    if (frVoice) utter.voice = frVoice;
    window.speechSynthesis.speak(utter);
  };

  const toggleVoice = () => {
    setVoiceOn(v => {
      if (v && VOICE_OUTPUT_OK) window.speechSynthesis.cancel(); // on coupe si on désactive
      return !v;
    });
  };

  const send = async (override?: string) => {
    const text = (override ?? input).trim();
    if (!text || loading) return;
    if (VOICE_OUTPUT_OK) window.speechSynthesis.cancel(); // on coupe une lecture en cours
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
      const reply = r.ok ? d.reply : (d.error || "Je suis indisponible là, réessaie.");
      setMsgs(m => [...m, { role: 'assistant', content: reply }]);
      if (r.ok && voiceOn) speak(reply);
    } catch {
      setMsgs(m => [...m, { role: 'assistant', content: "Erreur réseau — je n'ai pas pu répondre." }]);
    } finally {
      setLoading(false);
    }
  };

  // Démarre l'écoute du micro ; le texte reconnu est envoyé automatiquement.
  const startListening = () => {
    if (!VOICE_INPUT_OK || listening) return;
    if (VOICE_OUTPUT_OK) window.speechSynthesis.cancel(); // pas parler pendant qu'on écoute
    const rec = new SpeechRec();
    rec.lang = 'fr-FR';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e: any) => {
      const transcript = e.results?.[0]?.[0]?.transcript?.trim();
      if (transcript) send(transcript);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    setListening(true);
    rec.start();
  };

  if (!open) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 w-96 max-w-[92vw] h-[32rem] bg-white border border-slate-200 rounded-2xl shadow-2xl flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <div className="flex items-center gap-2 font-semibold text-slate-800">
          <Sparkles className="w-4 h-4 text-blue-600" /> Maya
          <span className="text-xs font-normal text-slate-400">assistante Ops</span>
        </div>
        <div className="flex items-center gap-1">
          {VOICE_OUTPUT_OK && (
            <button
              onClick={toggleVoice}
              title={voiceOn ? 'Maya parle à voix haute (cliquer pour couper)' : 'Voix coupée (cliquer pour activer)'}
              className={cn('p-1.5 rounded-lg hover:bg-slate-100', voiceOn ? 'text-blue-600' : 'text-slate-400')}
            >
              {voiceOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>
          )}
          <button onClick={() => { if (VOICE_OUTPUT_OK) window.speechSynthesis.cancel(); onClose(); }} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>
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

      <div className="px-3 pt-2">
        <button
          onClick={() => send(BRIEF_PROMPT)}
          disabled={loading}
          className="text-xs px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 disabled:opacity-50"
        >
          📋 Fais-moi le point
        </button>
      </div>

      <div className="p-3 border-t border-slate-100 flex gap-2">
        {VOICE_INPUT_OK && (
          <button
            onClick={startListening}
            disabled={loading}
            title={listening ? 'À l\'écoute… parle maintenant' : 'Parler à Maya'}
            className={cn(
              'px-3 py-2 rounded-lg disabled:opacity-50',
              listening ? 'bg-red-500 text-white animate-pulse' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            )}
          >
            <Mic className="w-4 h-4" />
          </button>
        )}
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send()}
          placeholder={listening ? 'À l\'écoute…' : 'Écris ou parle à Maya…'}
          className="flex-1 text-sm border border-slate-300 rounded-lg px-3 py-2 outline-none focus:border-blue-500"
        />
        <button onClick={() => send()} disabled={loading} className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
