'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { signOut } from 'next-auth/react';
import {
  Mic, MicOff, Loader2, Settings, Trash2,
  X, Activity, Volume2, VolumeX,
  Building2, Wrench, Shield, LogOut, Sparkles, Users,
} from 'lucide-react';
import type { PublicTenantConfig } from '@/lib/tenants';
import { useSpeechSynthesis } from '@/lib/use-speech-synthesis';
import VoicePicker from './VoicePicker';

type VoiceState = 'idle' | 'connecting' | 'recording' | 'processing' | 'responding' | 'error';

interface Turn {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
  toolCalls?: { id: string; label: string }[];
}

interface User {
  id: string;
  email: string;
  name?: string;
  role?: string;
  isDemoUser: boolean;
}

interface Props {
  tenant: PublicTenantConfig;
  user: User;
}

function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Demo-Dialoge pro Tenant - werden für Demo-User abgespielt
const DEMO_FLOWS: Record<string, Array<{ user: string; assistant: string; tool?: any }>> = {
  'pflegeheim-sonnenblick': [
    {
      user: 'Frau Müller, Blutdruck 130 zu 85, Puls 72.',
      assistant: 'Vitalwerte für Frau Müller gespeichert: 130 zu 85, Puls 72. Werte im Normbereich.',
      tool: { id: 'pms_vitalwerte_speichern', label: 'Vitalwerte speichern' },
    },
    {
      user: 'Hat Frau Schulze Allergien?',
      assistant: 'Frau Schulze hat dokumentierte Erdbeer-Allergie. Sonst keine bekannten Allergien.',
      tool: { id: 'lookup_allergien', label: 'Allergien nachschlagen' },
    },
    {
      user: 'Wie ist der Hausstandard für Dekubitus Grad zwei?',
      assistant: 'Hausstandard: Druckentlastung, hydroaktiver Wundverband, Verbandwechsel alle zwei Tage.',
      tool: { id: 'search_hausstandards', label: 'Hausstandards' },
    },
    {
      user: 'Notiz für Spätschicht: Frau Klein hatte heute schlechten Appetit.',
      assistant: 'Übergabe-Notiz für Spätschicht hinterlegt: Frau Klein, schlechter Appetit.',
      tool: { id: 'uebergabe_notiz', label: 'Übergabe-Notiz' },
    },
  ],
  'home-care-hamburg': [
    {
      user: 'War heute drei Stunden bei Frau Hansen, haben gemeinsam Mittag gekocht und einen Spaziergang an der Alster gemacht. Sie war sehr aufgeräumt.',
      assistant: 'Schön zu hören. Einsatz bei Frau Hansen dokumentiert: drei Stunden, Kochen und Spaziergang an der Alster. Stimmung notiert: aufgeräumt.',
      tool: { id: 'einsatz_dokumentieren', label: 'Einsatz dokumentieren' },
    },
    {
      user: 'Wer ist mein nächster Kunde heute?',
      assistant: 'Ihr nächster Termin: Herr Brandt in der Eppendorfer Landstraße, in 25 Minuten. Geplant sind zwei Stunden Gesellschaft und Hilfe bei der Mittagsmahlzeit. Er mag besonders Gespräche über seine Zeit bei der Marine.',
      tool: { id: 'naechster_einsatz', label: 'Nächster Einsatz' },
    },
    {
      user: 'Frau Meier war heute sehr unruhig, hat mich zweimal nicht erkannt.',
      assistant: 'Verstanden. Notiz zu Frau Meier hinterlegt. Möchten Sie Tipps zur Validation bei Demenz-Unruhe abrufen?',
      tool: { id: 'kundennotiz', label: 'Kundennotiz' },
    },
    {
      user: 'Ja bitte, was kann ich tun wenn sie mich nicht erkennt?',
      assistant: 'Validation: Sich vorstellen, ohne zu korrigieren. Ruhig bleiben, Augenkontakt suchen. Über vertraute Themen sprechen, bei Frau Meier ist das ihre Tochter Karin und der Garten.',
      tool: { id: 'search_demenz_tipps', label: 'Demenz-Begleitung' },
    },
  ],
  'reha-waldblick': [
    {
      user: 'Therapie bei Herrn Krause, 30 Minuten Gangschule, drei Sätze Treppensteigen.',
      assistant: 'Therapie-Einheit für Herrn Krause dokumentiert: 30 Minuten Gangschule, drei Sätze Treppensteigen.',
      tool: { id: 'therapie_protokoll', label: 'Therapie dokumentieren' },
    },
    {
      user: 'Frau Bauer hat heute Schmerzen, NRS sieben, Knie rechts.',
      assistant: 'Schmerz-NRS für Frau Bauer erfasst: 7 von 10, rechtes Knie.',
      tool: { id: 'schmerzskala_erfassen', label: 'Schmerz-NRS' },
    },
    {
      user: 'Welche Diagnosen hat Herr Krause?',
      assistant: 'Hauptdiagnose: Z96.6, Hüft-TEP rechts. Nebendiagnosen: I10 essentielle Hypertonie, E11.9 Diabetes mellitus Typ 2.',
      tool: { id: 'lookup_diagnosen', label: 'Diagnosen + ICD' },
    },
    {
      user: 'Was sagt die Leitlinie zur Reha nach Hüft-TEP?',
      assistant: 'Leitlinie: Frühmobilisation ab Tag eins, Vollbelastung meist ab Tag drei, MTT zur Kraftaufbau, Treppensteigen ab zweiter Woche.',
      tool: { id: 'search_leitlinien', label: 'Reha-Leitlinien' },
    },
  ],
};

export default function VoiceApp({ tenant, user }: Props) {
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [audioLevel, setAudioLevel] = useState(0);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [demoStep, setDemoStep] = useState(0);
  const [error, setError] = useState('');

  const idCounter = useRef(0);
  const dialogEndRef = useRef<HTMLDivElement>(null);
  const audioLevelTimer = useRef<number | null>(null);

  // Production-Mode (OpenAI Realtime) Refs
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const currentUserTurnRef = useRef<Turn | null>(null);
  const currentAssistantTurnRef = useRef<Turn | null>(null);

  const primary = tenant.branding.primary_color;
  const secondary = tenant.branding.secondary_color;
  const isDemoUser = user.isDemoUser;

  // Auto-scroll im Dialog-Container, nicht im Window
  useEffect(() => {
    const el = dialogEndRef.current;
    if (el && el.parentElement) {
      el.parentElement.scrollTop = el.parentElement.scrollHeight;
    }
  }, [turns]);

  // Audio-Level Animation für recording state
  useEffect(() => {
    if (voiceState === 'recording' && isDemoUser) {
      const tick = () => {
        setAudioLevel(20 + Math.random() * 60);
        audioLevelTimer.current = window.setTimeout(tick, 100);
      };
      tick();
      return () => { if (audioLevelTimer.current) clearTimeout(audioLevelTimer.current); };
    } else if (voiceState !== 'recording') {
      setAudioLevel(0);
    }
  }, [voiceState, isDemoUser]);

  // Spacebar push-to-talk
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.code === 'Space' && !e.repeat &&
          target?.tagName !== 'INPUT' && target?.tagName !== 'BUTTON' &&
          target?.tagName !== 'SELECT' && target?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        handleTap();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [voiceState, demoStep]);

  // ─────────── Web Speech API via Hook (mit iOS-Fixes) ───────────
  const preferredLang = tenant.default_language === 'de' ? 'de-DE' : 'en-US';
  const speech = useSpeechSynthesis({ preferredLang });

  const speak = useCallback((text: string) => {
    if (!audioEnabled) return;
    speech.speak(text, { rate: 1.05, pitch: 1.0, volume: 1.0 });
  }, [audioEnabled, speech]);

  const stopSpeech = useCallback(() => {
    speech.cancel();
  }, [speech]);

  // ─────────── Demo-Flow für Demo-User ───────────
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

  const runDemoFlow = async () => {
    const flow = DEMO_FLOWS[tenant.id] || [];
    if (flow.length === 0) return;
    const step = flow[demoStep % flow.length];

    setVoiceState('connecting');
    await sleep(400);

    setVoiceState('recording');
    const userTurn: Turn = { id: ++idCounter.current, role: 'user', text: '', timestamp: Date.now() };
    setTurns(prev => [...prev, userTurn]);

    const words = step.user.split(' ');
    for (let i = 1; i <= words.length; i++) {
      await sleep(150);
      setTurns(prev => prev.map(t => t.id === userTurn.id ? { ...t, text: words.slice(0, i).join(' ') } : t));
    }
    await sleep(400);
    processDemoResponse(step);
  };

  const processDemoResponse = async (step: any) => {
    setVoiceState('processing');
    await sleep(600);
    setVoiceState('responding');

    if (audioEnabled) speak(step.assistant);

    const assistTurn: Turn = {
      id: ++idCounter.current,
      role: 'assistant',
      text: '',
      timestamp: Date.now(),
      toolCalls: step.tool ? [step.tool] : undefined,
    };
    setTurns(prev => [...prev, assistTurn]);

    const words = step.assistant.split(' ');
    for (let i = 1; i <= words.length; i++) {
      await sleep(70);
      setTurns(prev => prev.map(t => t.id === assistTurn.id ? { ...t, text: words.slice(0, i).join(' ') } : t));
    }

    await sleep(Math.max(800, step.assistant.length * 35));
    setVoiceState('idle');
    setDemoStep(s => s + 1);
  };

  // ─────────── OpenAI Realtime API für echte User ───────────
  const startVisualizer = useCallback((stream: MediaStream) => {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    const ctx = new Ctx();
    audioCtxRef.current = ctx;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      setAudioLevel(Math.min(100, (avg / 128) * 100));
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();
  }, []);

  const cleanupRealtime = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close().catch(() => {});
    }
    if (dcRef.current) try { dcRef.current.close(); } catch {}
    if (pcRef.current) try { pcRef.current.close(); } catch {}
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current.srcObject = null;
    }
    pcRef.current = null;
    dcRef.current = null;
    streamRef.current = null;
    setAudioLevel(0);
  }, []);

  const handleRealtimeEvent = (ev: any) => {
    switch (ev.type) {
      case 'input_audio_buffer.speech_started':
        setVoiceState('recording');
        if (!currentUserTurnRef.current) {
          const turn: Turn = { id: ++idCounter.current, role: 'user', text: '...', timestamp: Date.now() };
          currentUserTurnRef.current = turn;
          setTurns(prev => [...prev, turn]);
        }
        break;
      case 'input_audio_buffer.speech_stopped':
        setVoiceState('processing');
        break;
      case 'conversation.item.input_audio_transcription.completed':
        if (currentUserTurnRef.current) {
          const id = currentUserTurnRef.current.id;
          setTurns(prev => prev.map(t => t.id === id ? { ...t, text: ev.transcript } : t));
          currentUserTurnRef.current = null;
        }
        break;
      case 'response.created':
        const assistTurn: Turn = { id: ++idCounter.current, role: 'assistant', text: '', timestamp: Date.now() };
        currentAssistantTurnRef.current = assistTurn;
        setTurns(prev => [...prev, assistTurn]);
        setVoiceState('responding');
        break;
      case 'response.audio_transcript.delta':
        if (currentAssistantTurnRef.current) {
          const id = currentAssistantTurnRef.current.id;
          setTurns(prev => prev.map(t => t.id === id ? { ...t, text: t.text + ev.delta } : t));
        }
        break;
      case 'response.function_call_arguments.done':
        if (currentAssistantTurnRef.current) {
          const id = currentAssistantTurnRef.current.id;
          const toolName = ev.name;
          const tool = tenant.tools.find(t => t.id === toolName);
          setTurns(prev => prev.map(t =>
            t.id === id
              ? { ...t, toolCalls: [...(t.toolCalls || []), { id: toolName, label: tool?.label || toolName }] }
              : t
          ));
          // Tool-Call an Backend dispatchen
          let args = {};
          try { args = JSON.parse(ev.arguments); } catch {}
          fetch('/api/tools/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ toolId: toolName, args }),
          }).catch(() => {});
        }
        break;
      case 'response.done':
        currentAssistantTurnRef.current = null;
        setTimeout(() => {
          cleanupRealtime();
          setVoiceState('idle');
        }, 800);
        break;
      case 'error':
        setError(ev.error?.message || 'Realtime-Fehler');
        setVoiceState('error');
        cleanupRealtime();
        break;
    }
  };

  const startRealtimeSession = async () => {
    setError('');
    setVoiceState('connecting');

    try {
      const tokenRes = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      if (!tokenRes.ok) {
        const err = await tokenRes.json().catch(() => ({}));
        throw new Error(err.error || 'Session konnte nicht gestartet werden');
      }
      const session = await tokenRes.json();

      // Wenn Backend "demo" zurückgibt, ist das ein Konfigurationsfehler:
      // Echte User dürfen nie Demo-Inhalte sehen. Wir zeigen eine klare
      // Meldung statt stillschweigend Demo-Dialoge abzuspielen.
      if (session.mode === 'demo') {
        throw new Error(
          'Sprach-Backend ist nicht aktiviert. Bitte einen Administrator kontaktieren.'
        );
      }

      const ephemeralKey = session.ephemeralToken;
      if (!ephemeralKey) throw new Error('Kein Token erhalten');

      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      const audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      audioElRef.current = audioEl;
      pc.ontrack = (e) => { audioEl.srcObject = e.streams[0]; };

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      stream.getTracks().forEach(t => pc.addTrack(t, stream));
      startVisualizer(stream);

      const dc = pc.createDataChannel('oai-events');
      dcRef.current = dc;
      dc.onopen = () => setVoiceState('recording');
      dc.onmessage = (e) => {
        try { handleRealtimeEvent(JSON.parse(e.data)); }
        catch (err) { console.error(err); }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpRes = await fetch(session.endpoint, {
        method: 'POST',
        body: offer.sdp,
        headers: { Authorization: `Bearer ${ephemeralKey}`, 'Content-Type': 'application/sdp' },
      });
      if (!sdpRes.ok) throw new Error('OpenAI-Verbindung fehlgeschlagen');
      const answerSdp = await sdpRes.text();
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
    } catch (err: any) {
      setError(err.message || 'Session-Fehler');
      setVoiceState('error');
      cleanupRealtime();
    }
  };

  const commitRealtimeRecording = () => {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== 'open') return;
    dc.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
    dc.send(JSON.stringify({ type: 'response.create' }));
    setVoiceState('processing');
  };

  // ─────────── Unified Tap-Handler ───────────
  const handleTap = () => {
    // iOS Speech-Engine entsperren - muss synchron im Touch-Event passieren.
    // Idempotent: nach dem ersten Mal No-Op.
    if (isDemoUser) {
      speech.primeForUserInteraction();
    }

    if (isDemoUser) {
      // Demo-User: simulierter Flow mit Web Speech
      if (voiceState === 'idle' || voiceState === 'error') runDemoFlow();
      else if (voiceState === 'recording') {
        // Bei Demo: zum Demo-Flow vorrücken
      }
      else if (voiceState === 'responding') {
        stopSpeech();
        setVoiceState('idle');
        setTimeout(() => runDemoFlow(), 200);
      }
    } else {
      // Echte User: OpenAI Realtime
      if (voiceState === 'idle' || voiceState === 'error') startRealtimeSession();
      else if (voiceState === 'recording') commitRealtimeRecording();
      else if (voiceState === 'responding') {
        cleanupRealtime();
        setVoiceState('idle');
        setTimeout(() => startRealtimeSession(), 200);
      }
    }
  };

  const clearDialog = () => {
    setTurns([]);
    setDemoStep(0);
    stopSpeech();
  };

  const handleLogout = async () => {
    await signOut({ callbackUrl: '/login' });
  };

  const buttonLabel = (() => {
    switch (voiceState) {
      case 'idle': return isDemoUser ? 'Tippen für Demo-Beispiel' : 'Tippen zum Sprechen';
      case 'connecting': return 'Verbinde…';
      case 'recording': return isDemoUser ? 'Demo läuft…' : 'Sprich jetzt';
      case 'processing': return 'Verarbeite…';
      case 'responding': return 'Antwortet…';
      case 'error': return 'Fehler · neu versuchen';
    }
  })();

  return (
    <div
      className="flex flex-col fixed inset-0 overflow-hidden"
      style={{
        height: '100dvh',
        background: `linear-gradient(180deg, ${secondary} 0%, #FFFFFF 30%, #FFFFFF 100%)`,
      }}
    >
      {/* Header */}
      <header className="flex-shrink-0 px-4 py-3.5 flex items-center justify-between bg-white/80 backdrop-blur border-b border-stone-100 z-30">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center text-xl shadow-sm shrink-0" style={{ background: secondary }}>
            {tenant.branding.logo_emoji}
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-semibold text-stone-800 leading-tight truncate">
              {tenant.branding.app_name}
              {isDemoUser && <span className="ml-1.5 text-[10px] font-mono px-1.5 py-0.5 rounded bg-stone-100 text-stone-500 align-middle">DEMO</span>}
            </h1>
            <p className="text-xs text-stone-500 truncate">
              {user.name || user.email}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => {
              const next = !audioEnabled;
              setAudioEnabled(next);
              // Beim Aktivieren: Engine entsperren (User-Interaction)
              if (next && isDemoUser) speech.primeForUserInteraction();
            }}
            className={`w-10 h-10 rounded-2xl flex items-center justify-center transition ${audioEnabled ? 'bg-stone-100 hover:bg-stone-200 text-stone-700' : 'bg-stone-50 text-stone-400'}`}
          >
            {audioEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </button>
          {turns.length > 0 && (
            <button onClick={clearDialog} className="w-10 h-10 rounded-2xl bg-stone-100 hover:bg-stone-200 text-stone-700 flex items-center justify-center transition">
              <Trash2 size={16} />
            </button>
          )}
          <button onClick={() => setShowSettings(true)} className="w-10 h-10 rounded-2xl bg-stone-100 hover:bg-stone-200 text-stone-700 flex items-center justify-center transition">
            <Settings size={16} />
          </button>
        </div>
      </header>

      {/* Mode Indicator */}
      <div className="flex-shrink-0 px-4 py-2 bg-white border-b border-stone-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#10B981' }} />
          <span className="text-[11px] text-stone-600">
            <span className="font-semibold">Standard-Modus</span>
            <span className="text-stone-400"> · KI wählt automatisch passendes Tool</span>
          </span>
        </div>
      </div>

      {/* Tools Strip */}
      <div className="flex-shrink-0 px-4 py-2.5 bg-white border-b border-stone-100">
        <div className="flex items-center gap-1.5 mb-1.5">
          <Wrench size={11} className="text-stone-400" />
          <span className="text-[10px] uppercase tracking-wider text-stone-500 font-semibold">
            {tenant.tools.length} Tools verfügbar
          </span>
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {tenant.tools.map(tool => (
            <div
              key={tool.id}
              title={tool.description}
              className="px-2.5 py-1 rounded-full text-[10px] whitespace-nowrap shrink-0 font-medium border"
              style={{
                background: secondary,
                color: primary,
                borderColor: withAlpha(primary, 0.15),
              }}
            >
              {tool.label}
            </div>
          ))}
        </div>
      </div>

      {/* Dialog History */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-5 space-y-3">
        {turns.length === 0 ? (
          <EmptyState tenant={tenant} primary={primary} secondary={secondary} isDemoUser={isDemoUser} />
        ) : (
          turns.map(turn => <TurnCard key={turn.id} turn={turn} primary={primary} />)
        )}
        <div ref={dialogEndRef} />
      </div>

      {/* Error Banner */}
      {error && (
        <div className="flex-shrink-0 mx-4 mb-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-rose-700 mb-0.5">Fehler</p>
            <p className="text-xs text-rose-600 break-words">{error}</p>
          </div>
          <button onClick={() => { setError(''); setVoiceState('idle'); }} className="text-rose-500">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Push-to-Talk Footer */}
      <div className="flex-shrink-0 px-4 py-5 bg-white border-t border-stone-100">
        <div className="flex flex-col items-center">
          <TalkButton voiceState={voiceState} audioLevel={audioLevel} primary={primary} onTap={handleTap} />
          <p className="text-sm text-stone-700 mt-3 font-semibold">{buttonLabel}</p>
          <p className="text-[11px] text-stone-400 mt-1">AirPods · Headset · Spacebar</p>
        </div>
      </div>

      {showSettings && (
        <SettingsModal
          tenant={tenant}
          user={user}
          primary={primary}
          speech={speech}
          onLogout={handleLogout}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

/* ─────────── Talk Button ─────────── */

function TalkButton({ voiceState, audioLevel, primary, onTap }: any) {
  const isListening = voiceState === 'recording';
  const isResponding = voiceState === 'responding';
  const isLoading = voiceState === 'connecting' || voiceState === 'processing';

  return (
    <div className="relative">
      {isListening && (
        <>
          <div
            className="absolute inset-0 rounded-full border-2"
            style={{
              borderColor: withAlpha(primary, 0.4),
              transform: `scale(${1 + audioLevel / 200})`,
              opacity: 0.6 + audioLevel / 300,
              transition: 'transform 80ms ease-out',
            }}
          />
          <div
            className="absolute inset-0 rounded-full border"
            style={{
              borderColor: withAlpha(primary, 0.2),
              transform: `scale(${1.2 + audioLevel / 150})`,
              transition: 'transform 80ms ease-out',
            }}
          />
        </>
      )}
      {isResponding && (
        <div className="absolute inset-0 rounded-full border-2 animate-ping opacity-60" style={{ borderColor: primary }} />
      )}

      <button
        onClick={onTap}
        disabled={isLoading}
        aria-label="Push to talk"
        className="relative w-24 h-24 rounded-full flex items-center justify-center transition-all duration-200 active:scale-95 shadow-lg"
        style={{
          background: isListening || isResponding ? primary : '#FFFFFF',
          color: isListening || isResponding ? '#FFFFFF' : primary,
          border: `2px solid ${isListening || isResponding ? primary : withAlpha(primary, 0.2)}`,
          boxShadow: isListening ? `0 8px 32px -4px ${withAlpha(primary, 0.4)}` : '0 4px 12px rgba(0,0,0,0.08)',
        }}
      >
        {isLoading ? <Loader2 size={28} className="animate-spin" strokeWidth={2.5} /> :
         isListening ? <MicOff size={28} strokeWidth={2.5} /> :
         isResponding ? <Activity size={28} strokeWidth={2.5} className="animate-pulse" /> :
         <Mic size={28} strokeWidth={2.5} />}
      </button>
    </div>
  );
}

/* ─────────── Turn Card ─────────── */

function TurnCard({ turn, primary }: { turn: Turn; primary: string }) {
  const isUser = turn.role === 'user';
  const time = new Date(turn.timestamp).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className="max-w-[85%] rounded-3xl px-4 py-3 shadow-sm"
        style={{
          background: isUser ? primary : '#FFFFFF',
          color: isUser ? '#FFFFFF' : '#292524',
          border: isUser ? 'none' : '1px solid #F5F5F4',
        }}
      >
        <div className={`flex items-center gap-2 mb-1 ${isUser ? 'justify-end' : ''}`}>
          <span className="text-[10px] uppercase tracking-wider font-semibold" style={{
            color: isUser ? 'rgba(255,255,255,0.75)' : '#A8A29E',
          }}>
            {isUser ? 'Du' : 'Assistent'}
          </span>
          <span className="text-[10px] font-mono" style={{
            color: isUser ? 'rgba(255,255,255,0.65)' : '#D6D3D1',
          }}>{time}</span>
        </div>
        <p className="text-sm leading-relaxed whitespace-pre-wrap">
          {turn.text || (isUser ? '...' : '')}
        </p>
        {turn.toolCalls && turn.toolCalls.length > 0 && (
          <div
            className="mt-2 pt-2 border-t space-y-1"
            style={{ borderColor: isUser ? 'rgba(255,255,255,0.2)' : '#F5F5F4' }}
          >
            {turn.toolCalls.map((tc, i) => (
              <div
                key={i}
                className="text-[11px] flex items-center gap-1.5"
                style={{ color: isUser ? 'rgba(255,255,255,0.85)' : primary }}
              >
                <Wrench size={10} className="opacity-70" />
                <span className="font-medium">{tc.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────── Empty State ─────────── */

function EmptyState({ tenant, primary, secondary, isDemoUser }: any) {
  return (
    <div className="flex flex-col items-center justify-center text-center pt-6 pb-6 px-4">
      <div
        className="w-20 h-20 rounded-3xl flex items-center justify-center text-4xl mb-4 shadow-sm"
        style={{ background: secondary }}
      >
        {tenant.branding.logo_emoji}
      </div>
      <h2 className="text-lg font-semibold text-stone-800 mb-2">{tenant.branding.greeting}</h2>
      {tenant.branding.tagline && (
        <p className="text-sm italic mb-2" style={{ color: primary }}>
          {tenant.branding.tagline}
        </p>
      )}
      <p className="text-sm text-stone-500 max-w-xs leading-relaxed mb-2">
        {tenant.agent.persona}
      </p>
      <p className="text-xs text-stone-400 mt-4">
        Tippe den Button und sprich. Ich finde das richtige Tool.
      </p>
      {isDemoUser && (
        <div
          className="mt-4 px-3 py-2 rounded-full text-[11px] font-medium"
          style={{ background: secondary, color: primary }}
        >
          💡 Demo-Modus: Beispiel-Dialoge werden simuliert
        </div>
      )}
    </div>
  );
}

/* ─────────── Settings Modal ─────────── */

function SettingsModal({ tenant, user, primary, onLogout, onClose, speech }: any) {
  return (
    <div className="fixed inset-0 z-50 bg-stone-900/30 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white sm:rounded-3xl rounded-t-3xl max-w-md w-full max-h-[90vh] overflow-y-auto shadow-2xl">
        <header className="px-5 py-4 border-b border-stone-100 flex items-center justify-between sticky top-0 bg-white z-10">
          <h3 className="font-semibold text-stone-800">Einstellungen</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-xl bg-stone-100 hover:bg-stone-200 flex items-center justify-center transition">
            <X size={16} />
          </button>
        </header>

        <div className="p-5 space-y-5">
          <section>
            <h4 className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-2 flex items-center gap-1.5">
              <Users size={12} /> Angemeldet als
            </h4>
            <div className="rounded-2xl border border-stone-200 bg-stone-50 p-3">
              <p className="text-sm font-semibold text-stone-800">{user.name || user.email}</p>
              <p className="text-xs text-stone-500 mt-0.5">{user.email}</p>
              {user.role && <p className="text-xs mt-1" style={{ color: primary }}>{user.role}</p>}
              {user.isDemoUser && (
                <p className="text-[10px] mt-2 font-mono px-2 py-0.5 rounded bg-stone-200 text-stone-600 inline-block">
                  Demo-Modus aktiv
                </p>
              )}
            </div>
          </section>

          {/* Voice-Picker - nur sichtbar wenn Web Speech genutzt wird (Demo-User) */}
          {user.isDemoUser && speech?.isSupported && (
            <section>
              <h4 className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-2 flex items-center gap-1.5">
                <Volume2 size={12} /> Stimme der Sprachausgabe
              </h4>
              <p className="text-[11px] text-stone-500 mb-3">
                Wähle eine Stimme. Tippe auf eine Option, um sie sofort zu hören.
              </p>
              <VoicePicker
                voices={speech.voices}
                allVoices={speech.allVoices}
                selectedVoiceId={speech.selectedVoiceId}
                onSelect={speech.selectVoice}
                onPreview={(id: string | null) => {
                  // Engine entsperren falls noch nicht passiert
                  speech.primeForUserInteraction();
                  // selectVoice wirkt asynchron - wir geben dem State-Update einen Tick
                  setTimeout(() => {
                    speech.speak('Hallo, ich bin Anni. So klinge ich.', {
                      rate: 1.0,
                    });
                  }, 100);
                }}
                primary={primary}
              />
            </section>
          )}

          <section>
            <h4 className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-2 flex items-center gap-1.5">
              <Building2 size={12} /> Einrichtung
            </h4>
            <div className="rounded-2xl border border-stone-200 bg-stone-50 p-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">{tenant.branding.logo_emoji}</span>
                <p className="text-sm font-semibold text-stone-800">{tenant.name}</p>
              </div>
              <p className="text-xs text-stone-600 mb-2">{tenant.industry}</p>
              {tenant.region && <p className="text-xs text-stone-600 mb-2">📍 {tenant.region.city}</p>}
              <div className="space-y-1 text-[11px] text-stone-500">
                <p>ID: <code className="text-stone-700">{tenant.id}</code></p>
                <p>Email-Domains: {tenant.email_domains.join(', ')}</p>
              </div>
            </div>
          </section>

          <section>
            <h4 className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-2 flex items-center gap-1.5">
              <Wrench size={12} /> Verfügbare Tools ({tenant.tools.length})
            </h4>
            <div className="space-y-1.5">
              {tenant.tools.map((tool: any) => (
                <div key={tool.id} className="rounded-xl border border-stone-200 bg-stone-50 p-2.5">
                  <div className="flex items-center justify-between mb-0.5">
                    <p className="text-xs font-semibold text-stone-800">{tool.label}</p>
                    <span className="text-[9px] uppercase tracking-wider font-mono text-stone-400">{tool.type}</span>
                  </div>
                  <p className="text-[11px] text-stone-500 leading-relaxed">{tool.description}</p>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h4 className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-2 flex items-center gap-1.5">
              <Shield size={12} /> Datenschutz
            </h4>
            <div className="rounded-2xl border border-stone-200 bg-stone-50 p-3 space-y-1.5 text-xs text-stone-600">
              <p>Hosting: <span className="font-semibold text-stone-800">{tenant.compliance.data_residency}-Region</span></p>
              <p>Audit-Aufbewahrung: <span className="font-semibold text-stone-800">{tenant.compliance.audit_retention_days} Tage</span></p>
            </div>
          </section>

          <button
            onClick={onLogout}
            className="w-full py-3 rounded-2xl border-2 border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 font-semibold transition flex items-center justify-center gap-2"
          >
            <LogOut size={16} />
            Abmelden
          </button>
        </div>
      </div>
    </div>
  );
}
