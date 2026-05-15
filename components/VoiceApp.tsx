'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { signOut } from 'next-auth/react';
import {
  Mic, MicOff, Loader2, Settings, Trash2,
  X, Activity, Volume2, VolumeX,
  Building2, Wrench, Shield, LogOut, Sparkles, Users,
  Languages, ArrowLeftRight, Globe, Check,
} from 'lucide-react';
import type { PublicTenantConfig } from '@/lib/tenants';
import { useSpeechSynthesis } from '@/lib/use-speech-synthesis';
import { useUserSettings, OPENAI_VOICES, LISTEN_TIMEOUT_MIN, LISTEN_TIMEOUT_MAX, vadSensitivityToParams } from '@/lib/use-user-settings';
import { useHeadsetMediaKeys } from '@/lib/use-headset-mediakeys';
import { useI18n, SUPPORTED_LOCALES, buildVoicePreviewText, type Locale } from '@/lib/i18n';
import VoicePicker from './VoicePicker';

type VoiceState = 'idle' | 'connecting' | 'recording' | 'processing' | 'responding' | 'error';

/**
 * Im Translator-Mode wird ein Turn als Übersetzungs-Pärchen dargestellt:
 * sourceText = was gesagt wurde, sourceLang = welche Sprache
 * targetText = die Übersetzung, targetLang = wohin übersetzt
 */
interface Turn {
  id: number;
  role: 'user' | 'assistant' | 'system';
  text: string;
  timestamp: number;
  toolCalls?: { id: string; label: string; status?: 'pending' | 'confirmed' | 'cancelled' | 'executed' | 'failed' }[];
  /** Im Translator-Mode: Sprache des Originals (BCP-47 oder freier Name) */
  sourceLang?: string;
  /** Im Translator-Mode: nach diesem Turn wurde die Übersetzung (assistant) gemerged */
  translation?: string;

  /**
   * Bestätigungs-Card für ein schreibendes Tool (Human-in-the-Loop).
   * Wird vom Frontend gerendert sobald Modell ein Tool aufrufen will.
   */
  toolConfirmation?: {
    toolId: string;
    toolLabel: string;
    summary: string;
    args: any;
    status: 'pending' | 'confirmed' | 'cancelled';
  };

  /**
   * Wissens-Card mit Quellen-Audit-Trail.
   * Wird vom Frontend gerendert wenn das Modell Pflegewissen abfragt.
   */
  knowledge?: {
    query: string;
    answer: string;
    citations: { url: string; title: string; domain: string; isTrusted: boolean }[];
    hasTrustedSources: boolean;
  };
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

/**
 * Formatiert Tool-Args als gut lesbare Liste für die Bestätigungs-Card.
 * Aus { bewohner: "Frau Müller", blutdruck: "130/85", puls: 72 } wird:
 *   - Bewohner: Frau Müller
 *   - Blutdruck: 130/85
 *   - Puls: 72
 *
 * Key-Namen werden hübsch gemacht (snake_case → Title Case mit DE-Übersetzungen
 * für gängige Pflege-Begriffe).
 */
const KEY_LABELS_DE: Record<string, string> = {
  bewohner: 'Bewohner', patient: 'Patient', kunde: 'Kunde',
  blutdruck: 'Blutdruck', puls: 'Puls', temperatur: 'Temperatur',
  sauerstoff: 'Sauerstoffsättigung', medikament: 'Medikament', dosierung: 'Dosierung',
  zeit: 'Zeit', datum: 'Datum', notiz: 'Notiz', beobachtung: 'Beobachtung',
  sturzort: 'Sturzort', verletzung: 'Verletzung', massnahme: 'Maßnahme',
  einsatz: 'Einsatz', dauer: 'Dauer', taetigkeit: 'Tätigkeit',
};

function formatToolArgsAsSummary(args: any): string {
  if (!args || typeof args !== 'object') return '';
  const entries = Object.entries(args)
    .filter(([_, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => {
      const label = KEY_LABELS_DE[k.toLowerCase()] ||
        k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      const value = typeof v === 'object' ? JSON.stringify(v) : String(v);
      return `${label}: ${value}`;
    });
  return entries.join('\n');
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
  const { t, locale, setLocale, setAgentName } = useI18n();

  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [audioLevel, setAudioLevel] = useState(0);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [demoStep, setDemoStep] = useState(0);
  const [error, setError] = useState('');

  // Debug-Log direkt in der UI sichtbar - hilft beim Diagnostizieren von
  // Tool-Call-Problemen ohne DevTools-Console.
  // Aktiviert per ?debug=1 in URL ODER wenn translator wird gerade aktiviert.
  const [debugLog, setDebugLog] = useState<string[]>([]);
  const [debugVisible, setDebugVisible] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (new URLSearchParams(window.location.search).get('debug') === '1') {
      setDebugVisible(true);
    }
  }, []);
  const debugAdd = useCallback((msg: string) => {
    const ts = new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setDebugLog(prev => [...prev.slice(-49), `${ts} ${msg}`]);
  }, []);

  // Translator-Mode-State
  const [translatorActive, setTranslatorActive] = useState(false);
  const [translatorTarget, setTranslatorTarget] = useState<{
    label: string;
    code?: string;
    flag?: string;
    nativeLabel?: string;
  } | null>(null);

  // Tool-Bestätigung: wenn das Modell ein schreibendes Tool aufrufen will,
  // halten wir den Call hier zwischen bis der User per Voice ("Ja"/"Nein")
  // oder per Klick auf der Card bestätigt/ablehnt.
  // null = nichts pending, sonst die Tool-Call-Daten + visible Card-ID
  const [pendingTool, setPendingTool] = useState<{
    callId: string;
    toolId: string;
    toolLabel: string;
    args: any;
    summary: string;       // Strukturierte Zusammenfassung was getan wird
    cardTurnId: number;    // Welcher Turn die Bestätigungs-Card rendert
  } | null>(null);

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

  // Tracking der aktuellen Server-Response-ID, damit interrupt nur dann
  // 'response.cancel' sendet wenn eine Response wirklich aktiv ist.
  // Wird auf die ID gesetzt bei 'response.created' und auf null geräumt
  // bei 'response.done' oder nach erfolgtem cancel.
  const activeResponseIdRef = useRef<string | null>(null);

  // Idle-Timer für kontinuierlichen Dialog: nach X Sekunden Stille
  // wird die Session automatisch geschlossen.
  const idleTimerRef = useRef<number | null>(null);

  // User-Settings (Voice-Override, Lausch-Timeout, Voice-Mode)
  const { settings, update: updateSettings } = useUserSettings();

  // Agent-Name aus Settings in den i18n-Context übertragen, damit alle
  // {name}-Platzhalter in t() automatisch den richtigen Namen bekommen.
  // Wirkt sich auf UI-Strings, Stimmprobe, Voice-Trigger gleichermaßen aus.
  useEffect(() => {
    setAgentName(settings.agentName);
  }, [settings.agentName, setAgentName]);

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

  // Browser-Tab-Title an den aktuellen Modus anpassen.
  // Wichtig wenn der User in einem anderen Tab ist und zurückkommt -
  // beim Tab-Wechsel sieht er sofort dass Anni im Übersetzungsmodus ist.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const baseTitle = 'Anni';
    if (translatorActive && translatorTarget) {
      document.title = `🌐 ${translatorTarget.nativeLabel || translatorTarget.label} · ${baseTitle}`;
    } else {
      document.title = baseTitle;
    }
    return () => {
      // Beim Unmount Title zurücksetzen
      document.title = baseTitle;
    };
  }, [translatorActive, translatorTarget]);

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
    // Idle-Timer canceln, falls einer läuft
    if (idleTimerRef.current !== null) {
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close().catch(() => {});
    }
    if (dcRef.current) try { dcRef.current.close(); } catch {}
    if (pcRef.current) try { pcRef.current.close(); } catch {}
    if (audioElRef.current) {
      const el = audioElRef.current;
      el.pause();
      el.srcObject = null;
      try { el.remove(); } catch {}
    }
    pcRef.current = null;
    dcRef.current = null;
    streamRef.current = null;
    audioElRef.current = null;
    setAudioLevel(0);
  }, []);

  /**
   * Idle-Timer-Helfer für kontinuierlichen Dialog.
   * Startet einen Countdown nach Annis Antwort - wenn der User innerhalb
   * der konfigurierten Zeit nichts sagt, wird die Session geschlossen.
   * Wird gecancelt sobald der User wieder spricht (speech_started).
   */
  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current !== null) {
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  const startIdleTimer = useCallback(() => {
    clearIdleTimer();
    const timeoutMs = settings.listenTimeoutSec * 1000;
    idleTimerRef.current = window.setTimeout(() => {
      // User war zu lange still - Session beenden
      cleanupRealtime();
      setVoiceState('idle');
    }, timeoutMs);
  }, [settings.listenTimeoutSec, cleanupRealtime, clearIdleTimer]);

  /**
   * Wartet darauf, dass der Audio-Buffer auf dem Client fertig ist mit Abspielen,
   * und kehrt dann in den 'recording'-State zurück, damit kontinuierlicher Dialog
   * möglich ist. Startet den Idle-Timer.
   *
   * Schützt vor abgeschnittenem Audio-Ende, das war ein realer Bug in
   * früheren Versionen wo cleanup direkt nach response.done lief.
   */
  const scheduleReturnToListening = useCallback(() => {
    const finalize = () => {
      // Session bleibt offen - wir hören weiter zu.
      // Kein cleanupRealtime hier, das passiert nur bei explizitem Abbruch
      // oder wenn der Idle-Timer abläuft.
      if (pcRef.current) {
        setVoiceState('recording');
        startIdleTimer();
      } else {
        setVoiceState('idle');
      }
    };

    // WICHTIG: Bei WebRTC (srcObject = MediaStream) ist die buffered/ended/paused
    // API NICHT zuverlässig - audioEl.buffered ist oft leer, .ended geht nie auf
    // true weil der Stream weiterläuft. Frühere Versionen hatten daher das Audio
    // abgeschnitten, weil die Logik zu früh "fertig" gemeldet hat.
    //
    // OpenAI sendet output_audio_buffer.stopped erst, wenn der Server-seitige
    // Buffer komplett geleert ist. Der Client braucht dann typisch 300-800ms
    // im Jitter-Buffer bis das letzte Audio-Paket abgespielt ist - bei
    // schwacher Mobilverbindung auch mehr.
    //
    // Wir warten daher 1.500ms PAUSCHAL nach 'output_audio_buffer.stopped'.
    // Das ist ein wenig konservativ, aber zuverlässig - lieber 1s "Stille"
    // am Ende als ein abgehacktes Wort.
    const SAFE_TAIL_MS = 1500;
    window.setTimeout(finalize, SAFE_TAIL_MS);
  }, [startIdleTimer]);

  // Tool-Call-Dispatcher mit Idempotenz. Wird aus DREI verschiedenen Events
  // aufgerufen (function_call_arguments.done, output_item.done, response.done) -
  // um sicherzustellen dass wir Tool-Calls nicht verpassen, egal welches Event
  // OpenAI gerade schickt. Idempotenz via call_id verhindert dass derselbe
  // Tool-Call mehrfach ausgeführt wird.
  const handledToolCallsRef = useRef<Set<string>>(new Set());

  // Wenn der User über die Tools-Pille einen Dialog startet, schicken wir
  // beim Connection-Open eine simulierte User-Aussage ans Modell. Dieser
  // Ref hält die Aussage zwischen startRealtimeSession und dc.onopen.
  const pendingInitialMessageRef = useRef<string | undefined>(undefined);

  // Letztes vollständiges User-Transkript - wird benutzt um zu prüfen ob
  // der Agent-Name als Trigger-Prefix gesagt wurde, bevor wir
  // start_/stop_translation_mode wirklich ausführen.
  // Das Modell hält sich nicht zuverlässig an die "nur mit Prefix"-Anweisung
  // im Prompt, also enforcement im Code.
  const lastUserTranscriptRef = useRef<string>('');

  /**
   * Antwort an OpenAI nach abgelehntem Tool-Call: Tool-Output mit Fehler-Hinweis,
   * damit das Modell normal weiterredet statt zu warten oder zu wiederholen.
   * Ohne diesen Output bleibt das Modell hängen und sendet nichts mehr.
   */
  const sendToolRejection = useCallback((callId: string | undefined, reason: string) => {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== 'open' || !callId) return;
    try {
      // Function-Output mit Fehler an die Conversation hängen
      dc.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify({ error: reason, action: 'continue_conversation' }),
        },
      }));
      // Modell anweisen, eine normale Sprach-Antwort zu generieren
      dc.send(JSON.stringify({ type: 'response.create' }));
      debugAdd(`tool rejected: ${reason}`);
    } catch (err) {
      debugAdd(`reject failed: ${err}`);
    }
  }, [debugAdd]);

  /**
   * User bestätigt einen pending Tool-Call (per Klick oder per Voice "Ja").
   * Wir führen das Tool aus, updaten die Card, und schicken function_call_output ans Modell.
   */
  const confirmPendingTool = useCallback(() => {
    const p = pendingTool;
    if (!p) return;
    debugAdd(`✓ confirmed: ${p.toolLabel}`);

    // Card auf "confirmed" setzen
    setTurns(prev => prev.map(t =>
      t.id === p.cardTurnId && t.toolConfirmation
        ? { ...t, toolConfirmation: { ...t.toolConfirmation, status: 'confirmed' } }
        : t
    ));

    // Tool jetzt ausführen
    fetch('/api/tools/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toolId: p.toolId, args: p.args }),
    })
      .then(r => r.json())
      .then((data: any) => {
        // Modell informieren
        const dc = dcRef.current;
        if (dc && dc.readyState === 'open' && p.callId) {
          dc.send(JSON.stringify({
            type: 'conversation.item.create',
            item: {
              type: 'function_call_output',
              call_id: p.callId,
              output: JSON.stringify({ ...data, confirmedByUser: true }),
            },
          }));
          dc.send(JSON.stringify({ type: 'response.create' }));
        }
      })
      .catch((err: any) => {
        debugAdd(`tool exec failed: ${err?.message}`);
        sendToolRejection(p.callId, `Tool execution failed: ${err?.message || 'unknown'}`);
      });

    setPendingTool(null);
  }, [pendingTool, debugAdd, sendToolRejection]);

  /**
   * User lehnt einen pending Tool-Call ab (per Klick oder per Voice "Nein").
   * Wir markieren die Card als cancelled und informieren das Modell.
   */
  const cancelPendingTool = useCallback(() => {
    const p = pendingTool;
    if (!p) return;
    debugAdd(`✗ cancelled: ${p.toolLabel}`);

    setTurns(prev => prev.map(t =>
      t.id === p.cardTurnId && t.toolConfirmation
        ? { ...t, toolConfirmation: { ...t.toolConfirmation, status: 'cancelled' } }
        : t
    ));

    // Modell informieren dass abgelehnt - es soll korrigieren oder weiterfragen
    sendToolRejection(
      p.callId,
      'User cancelled this action. Ask the user how they would like to proceed or what should be corrected.'
    );

    setPendingTool(null);
  }, [pendingTool, debugAdd, sendToolRejection]);

  // Refs auf die confirm/cancel-Funktionen, damit handleRealtimeEvent
  // (das kein useCallback ist) immer die aktuelle Version sieht.
  const pendingToolRef = useRef(pendingTool);
  const confirmPendingToolRef = useRef<() => void>(() => {});
  const cancelPendingToolRef = useRef<() => void>(() => {});
  useEffect(() => { pendingToolRef.current = pendingTool; }, [pendingTool]);
  useEffect(() => { confirmPendingToolRef.current = confirmPendingTool; }, [confirmPendingTool]);
  useEffect(() => { cancelPendingToolRef.current = cancelPendingTool; }, [cancelPendingTool]);

  const dispatchToolCall = useCallback((toolName: string, args: any, callId?: string) => {
    if (!toolName) return;

    // Idempotenz: jeder call_id nur einmal verarbeiten
    const key = callId || `${toolName}-${JSON.stringify(args)}`;
    if (handledToolCallsRef.current.has(key)) {
      debugAdd(`tool ${toolName} duplicate (skip)`);
      return;
    }
    handledToolCallsRef.current.add(key);

    debugAdd(`→ DISPATCH ${toolName}`);

    // System-Tool: Translator starten
    if (toolName === 'start_translation_mode') {
      const target = typeof args?.targetLanguage === 'string' && args.targetLanguage.length > 0
        ? args.targetLanguage
        : 'unknown';
      debugAdd(`→ start_translation_mode target="${target}"`);
      setVoiceState('connecting');
      cleanupRealtime();
      setTimeout(() => {
        startRealtimeSession({ translatorTarget: target });
      }, 200);
      return;
    }

    // System-Tool: Translator beenden
    if (toolName === 'stop_translation_mode') {
      debugAdd('→ stop_translation_mode');
      cleanupRealtime();
      setTranslatorActive(false);
      setTranslatorTarget(null);
      setTurns([]);
      setVoiceState('idle');
      return;
    }

    // System-Tool: Pflegewissen abfragen.
    // Direkt durchführen, keine Bestätigung (Lese-Tool).
    if (toolName === 'lookup_pflegewissen') {
      const query = typeof args?.query === 'string' ? args.query : '';
      if (!query) {
        sendToolRejection(callId, 'No query provided');
        return;
      }
      debugAdd(`→ lookup_pflegewissen query="${query.slice(0, 60)}"`);

      // Platzhalter-Card sofort einfügen damit der User Feedback sieht
      const turnId = ++idCounter.current;
      setTurns(prev => [...prev, {
        id: turnId,
        role: 'assistant',
        text: '',
        timestamp: Date.now(),
        knowledge: {
          query,
          answer: '__loading__',
          citations: [],
          hasTrustedSources: false,
        },
      }]);

      // Request an unsere API
      fetch('/api/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, locale }),
      })
        .then(r => r.json())
        .then((data: any) => {
          if (data.error) throw new Error(data.error);
          // Card mit Antwort updaten
          setTurns(prev => prev.map(t =>
            t.id === turnId
              ? {
                  ...t,
                  knowledge: {
                    query,
                    answer: data.answer || '',
                    citations: data.citations || [],
                    hasTrustedSources: !!data.hasTrustedSources,
                  },
                }
              : t
          ));
          // Modell informieren dass Knowledge-Abruf fertig - mit gekürzter Antwort,
          // damit es dem User die Kernaussage vorlesen kann ohne die Quellen-Box.
          const dc = dcRef.current;
          if (dc && dc.readyState === 'open' && callId) {
            try {
              dc.send(JSON.stringify({
                type: 'conversation.item.create',
                item: {
                  type: 'function_call_output',
                  call_id: callId,
                  output: JSON.stringify({
                    answer: data.answer,
                    hasTrustedSources: data.hasTrustedSources,
                    sourceCount: (data.citations || []).length,
                  }),
                },
              }));
              dc.send(JSON.stringify({ type: 'response.create' }));
            } catch {}
          }
          debugAdd(`knowledge: ${(data.citations || []).length} sources, trusted=${data.hasTrustedSources}`);
        })
        .catch((err: any) => {
          debugAdd(`knowledge FAILED: ${err?.message || err}`);
          // Card mit Fehler updaten
          setTurns(prev => prev.map(t =>
            t.id === turnId
              ? {
                  ...t,
                  knowledge: {
                    query,
                    answer: `⚠ Fehler beim Nachschlagen: ${err?.message || 'Unbekannt'}`,
                    citations: [],
                    hasTrustedSources: false,
                  },
                }
              : t
          ));
          sendToolRejection(callId, `Knowledge lookup failed: ${err?.message || 'unknown'}`);
        });
      return;
    }

    // Tenant-Tool: Bestätigungs-Flow je nach require_confirmation
    const tool = tenant.tools.find(t => t.id === toolName);
    if (!tool) {
      debugAdd(`unknown tool ${toolName}`);
      sendToolRejection(callId, `Unknown tool: ${toolName}`);
      return;
    }

    if (tool.require_confirmation) {
      // SCHREIBENDES Tool - User muss bestätigen.
      // Wir bauen eine strukturierte Zusammenfassung aus args (key-value als Liste).
      const summary = formatToolArgsAsSummary(args);
      const turnId = ++idCounter.current;

      setTurns(prev => [...prev, {
        id: turnId,
        role: 'system',
        text: '',
        timestamp: Date.now(),
        toolConfirmation: {
          toolId: tool.id,
          toolLabel: tool.label,
          summary,
          args,
          status: 'pending',
        },
      }]);

      setPendingTool({
        callId: callId || '',
        toolId: tool.id,
        toolLabel: tool.label,
        args,
        summary,
        cardTurnId: turnId,
      });

      debugAdd(`pending confirmation: ${tool.label}`);
      // WICHTIG: keine function_call_output schicken! Das Modell wartet
      // auf die Antwort. Nach Bestätigung/Ablehnung schicken wir die Antwort.
      return;
    }

    // LESE-Tool (kein require_confirmation) - direkt ausführen
    debugAdd(`→ execute ${tool.label} (no confirm)`);
    if (currentAssistantTurnRef.current) {
      const id = currentAssistantTurnRef.current.id;
      setTurns(prev => prev.map(t =>
        t.id === id
          ? { ...t, toolCalls: [...(t.toolCalls || []), { id: toolName, label: tool.label, status: 'executed' }] }
          : t
      ));
    }
    fetch('/api/tools/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toolId: toolName, args }),
    })
      .then(r => r.json())
      .then((data: any) => {
        const dc = dcRef.current;
        if (dc && dc.readyState === 'open' && callId) {
          dc.send(JSON.stringify({
            type: 'conversation.item.create',
            item: {
              type: 'function_call_output',
              call_id: callId,
              output: JSON.stringify(data),
            },
          }));
          dc.send(JSON.stringify({ type: 'response.create' }));
        }
      })
      .catch((err: any) => {
        debugAdd(`tool ${toolName} failed: ${err?.message}`);
        sendToolRejection(callId, `Tool execution failed: ${err?.message || 'unknown'}`);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant, debugAdd, sendToolRejection, locale]);

  const handleRealtimeEvent = (ev: any) => {
    // Jeder Event-Typ kommt ins Debug-Log. So sehen wir genau was OpenAI sendet.
    // Wir filtern die hochfrequenten Audio-Delta-Events raus damit das Log
    // lesbar bleibt - die geben keine Aufschlüsse über Tool-Calls.
    if (ev?.type &&
        !ev.type.startsWith('response.audio.') &&
        !ev.type.startsWith('response.audio_transcript.delta') &&
        !ev.type.startsWith('response.text.delta') &&
        ev.type !== 'response.function_call_arguments.delta' &&
        ev.type !== 'output_audio_buffer.audio_started' &&
        ev.type !== 'output_audio_buffer.audio_stopped') {
      debugAdd(`ev: ${ev.type}`);
    }

    switch (ev.type) {
      case 'input_audio_buffer.speech_started':
        // User redet - Idle-Timer abbrechen, sonst würde Session
        // mitten in der Frage geschlossen
        clearIdleTimer();
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
        if (typeof ev.transcript === 'string') {
          lastUserTranscriptRef.current = ev.transcript;
          debugAdd(`transcript: "${ev.transcript.slice(0, 60)}"`);

          // Voice-Confirmation: wenn ein Tool-Call pending ist und der User
          // "Ja"/"Nein" sagt, automatisch bestätigen/ablehnen.
          // Wir hören auf möglichst eindeutige Phrasen über mehrere Sprachen.
          if (pendingToolRef.current) {
            const t = ev.transcript.toLowerCase().trim();
            const confirmWords = /\b(ja|jawohl|bestätige|bestätigt|bestätigung|okay|ok|eintragen|speichern|durchführen|yes|confirm|sì|si|oui|sí)\b/i;
            const cancelWords = /\b(nein|abbrechen|stopp|stop|abbruch|löschen|verwerfen|no|cancel|non|nicht)\b/i;
            if (confirmWords.test(t) && !cancelWords.test(t)) {
              debugAdd(`voice confirm detected in: "${t.slice(0, 40)}"`);
              confirmPendingToolRef.current?.();
            } else if (cancelWords.test(t)) {
              debugAdd(`voice cancel detected in: "${t.slice(0, 40)}"`);
              cancelPendingToolRef.current?.();
            }
          }
        }
        break;
      case 'response.created':
        const assistTurn: Turn = { id: ++idCounter.current, role: 'assistant', text: '', timestamp: Date.now() };
        currentAssistantTurnRef.current = assistTurn;
        // Aktive Response-ID merken für sauberen Interrupt
        activeResponseIdRef.current = ev.response?.id || 'pending';
        setTurns(prev => [...prev, assistTurn]);
        setVoiceState('responding');
        break;
      case 'response.audio_transcript.delta':
        if (currentAssistantTurnRef.current) {
          const id = currentAssistantTurnRef.current.id;
          setTurns(prev => prev.map(t => t.id === id ? { ...t, text: t.text + ev.delta } : t));
        }
        break;
      case 'response.function_call_arguments.delta':
        // Argumente streamen rein, Stück für Stück. Wir sammeln sie nicht
        // selbst, das macht die `done`-Variante (siehe unten) bequemer.
        debugAdd(`fn-args.delta name=${ev.name || '?'}`);
        break;
      case 'response.function_call_arguments.done': {
        debugAdd(`fn-args.done name=${ev.name || '?'} args=${(ev.arguments || '').slice(0, 80)}`);
        let args: any = {};
        try { args = JSON.parse(ev.arguments); } catch {}
        dispatchToolCall(ev.name, args, ev.call_id);
        break;
      }
      case 'response.output_item.done': {
        // Fallback: dieses Event kommt zuverlässiger als fn-args.done und
        // enthält das gesamte function_call-Item. Wir nutzen es als Backup.
        const item = ev.item;
        if (item && item.type === 'function_call') {
          debugAdd(`output_item.done function_call name=${item.name} args=${(item.arguments || '').slice(0, 80)}`);
          let args: any = {};
          try { args = JSON.parse(item.arguments || '{}'); } catch {}
          dispatchToolCall(item.name, args, item.call_id);
        } else if (item) {
          debugAdd(`output_item.done type=${item.type}`);
        }
        break;
      }
      case 'response.done': {
        // Letzte Sicherheit: response.done enthält das vollständige Output.
        // Falls die anderen Events übersprungen wurden (z.B. weil das Modell
        // nur einen function_call ohne Streaming geliefert hat), finden wir
        // den Tool-Call hier.
        const output = ev.response?.output || [];
        for (const item of output) {
          if (item?.type === 'function_call' && item.name) {
            debugAdd(`response.done found function_call name=${item.name}`);
            let args: any = {};
            try { args = JSON.parse(item.arguments || '{}'); } catch {}
            dispatchToolCall(item.name, args, item.call_id);
          }
        }
        currentAssistantTurnRef.current = null;
        activeResponseIdRef.current = null;
        break;
      }
      case 'output_audio_buffer.stopped':
        // Audio durchgespielt → zurück in recording, Idle-Timer starten.
        // Session bleibt offen für nächsten User-Input.
        scheduleReturnToListening();
        break;
      case 'output_audio_buffer.cleared':
        // Audio wurde durch User-Interrupt gestoppt → direkt zurück zu recording
        // (Server fängt schon wieder zu lauschen an, weil Server-VAD aktiv ist)
        activeResponseIdRef.current = null;
        if (pcRef.current) {
          setVoiceState('recording');
          startIdleTimer();
        } else {
          setVoiceState('idle');
        }
        break;
      case 'error':
        // Differenzierung zwischen kritischen und harmlosen Fehlern.
        // 'Cancellation failed: no active response found' ist eine Race-Condition
        // (User hat unterbrochen genau in dem Moment wo Response fertig wurde) -
        // kein Grund die ganze Session zu schließen.
        const errMsg = ev.error?.message || 'Realtime-Fehler';
        const isHarmless =
          errMsg.includes('no active response') ||
          errMsg.includes('Cancellation failed') ||
          ev.error?.code === 'response_cancel_not_active';

        if (isHarmless) {
          // Stille loggen, Session läuft weiter
          console.warn('[realtime] harmless error ignored:', errMsg);
        } else {
          setError(errMsg);
          setVoiceState('error');
          cleanupRealtime();
        }
        break;
    }
  };

  const startRealtimeSession = async (opts?: {
    translatorTarget?: string;
    /**
     * Optional: nach Connection-Open eine User-Message ins Conversation-Item
     * einspielen. Wird genutzt wenn der User auf eine Tool-Pille klickt -
     * dann simulieren wir "User hat das Kommando gesagt".
     */
    initialUserMessage?: string;
  }) => {
    setError('');
    setVoiceState('connecting');
    // Idempotenz-Set leeren - neue Session, frische Tool-Calls erwartet
    handledToolCallsRef.current.clear();
    // Stale Transkript räumen - sonst würde ein altes Transkript der vorherigen
    // Session den Prefix-Check für die neue Session beeinflussen.
    lastUserTranscriptRef.current = '';
    debugAdd(`session.start translator=${opts?.translatorTarget || '-'}${opts?.initialUserMessage ? ' withMsg' : ''}`);

    // initialUserMessage merken für dc.onopen
    pendingInitialMessageRef.current = opts?.initialUserMessage;

    try {
      const tokenRes = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // User-Auswahl der Stimme (oder null für Tenant-Default)
          voiceId: settings.voiceId,
          // App-Sprache → Agent antwortet darin
          locale,
          // Agent-Name: wird als Trigger-Wort für Modus-Wechsel im Prompt
          // eingebaut, daher muss er bei jeder Session mitgegeben werden.
          agentName: settings.agentName,
          // VAD-Empfindlichkeit: bestimmt wie laut/lange der User reden muss
          // damit die KI das als Sprache erkennt (vs. Hintergrundgeräusch).
          vadParams: vadSensitivityToParams(settings.vadSensitivity),
          // Translator-Mode: wenn gesetzt, erzeugt Backend Dolmetscher-Session
          translatorTarget: opts?.translatorTarget,
        }),
      });

      if (!tokenRes.ok) {
        const err = await tokenRes.json().catch(() => ({}));
        throw new Error(err.error || 'Session konnte nicht gestartet werden');
      }
      const session = await tokenRes.json();

      if (session.mode === 'demo') {
        throw new Error(
          'Sprach-Backend ist nicht aktiviert. Bitte einen Administrator kontaktieren.'
        );
      }

      // Translator-Info aus Response übernehmen damit die UI sie anzeigen kann
      if (session.isTranslator && session.targetLanguage) {
        setTranslatorActive(true);
        setTranslatorTarget({
          label: session.targetLanguage,
          code: session.targetLanguageCode,
          flag: session.targetLanguageFlag,
          nativeLabel: session.targetLanguageNative,
        });
        // Im Translator-Mode den Dialog-Verlauf NICHT übernehmen (eigener Kontext)
        setTurns([]);
      }

      const ephemeralKey = session.ephemeralToken;
      if (!ephemeralKey) throw new Error('Kein Token erhalten');

      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      const audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      // iOS Safari: ohne playsinline wird das Audio im Vollbild abgespielt oder
      // gar nicht. Außerdem hilft 'controls=false' bei manchen Mobile-Browsern.
      audioEl.setAttribute('playsinline', 'true');
      audioEl.setAttribute('webkit-playsinline', 'true');
      // WICHTIG: Element MUSS im DOM hängen, sonst pausiert/garbage-collected
      // der Browser das Element früh - genau das verursacht abgeschnittenes Audio.
      audioEl.style.display = 'none';
      document.body.appendChild(audioEl);
      audioElRef.current = audioEl;
      pc.ontrack = (e) => {
        audioEl.srcObject = e.streams[0];
        // Sicherheitshalber explizit play() aufrufen - autoplay kann auf
        // mobilen Browsern manchmal überstimmt werden.
        audioEl.play().catch(err => {
          console.warn('[realtime] audio play() blocked:', err);
        });
      };

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      stream.getTracks().forEach(t => pc.addTrack(t, stream));
      startVisualizer(stream);

      const dc = pc.createDataChannel('oai-events');
      dcRef.current = dc;
      dc.onopen = () => {
        setVoiceState('recording');

        // DOPPEL-SICHERUNG: Tools und Instructions noch mal explizit per
        // session.update setzen. Manchmal verwirft die Realtime-Beta-API
        // die Tools die im REST-Endpoint mitgegeben wurden - dann redet
        // das Modell ohne sie. Hier schieben wir sie nach.
        try {
          const updateMsg = {
            type: 'session.update',
            session: {
              instructions: session.systemPrompt,
              tools: session.tools || [],
              tool_choice: 'auto',
            },
          };
          dc.send(JSON.stringify(updateMsg));
          debugAdd(`session.update sent: ${(session.tools || []).length} tools, translator=${session.isTranslator}`);
        } catch (err) {
          debugAdd(`session.update FAILED: ${err}`);
        }

        // Wenn der User über eine Tool-Pille gestartet hat: simulierte
        // User-Message ins Conversation-Item schicken und Response triggern.
        // Das Modell verhält sich dann so, als hätte der User das Kommando
        // tatsächlich gesprochen - ruft also das passende Tenant-Tool auf.
        const initialMsg = pendingInitialMessageRef.current;
        if (initialMsg) {
          pendingInitialMessageRef.current = undefined;
          try {
            // Kleine Verzögerung damit session.update sicher verarbeitet ist
            setTimeout(() => {
              if (!dcRef.current || dcRef.current.readyState !== 'open') return;
              dcRef.current.send(JSON.stringify({
                type: 'conversation.item.create',
                item: {
                  type: 'message',
                  role: 'user',
                  content: [{ type: 'input_text', text: initialMsg }],
                },
              }));
              dcRef.current.send(JSON.stringify({ type: 'response.create' }));
              debugAdd(`initial message sent: "${initialMsg.slice(0, 40)}..."`);
            }, 150);
          } catch (err) {
            debugAdd(`initial message FAILED: ${err}`);
          }
        }
      };
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

  /**
   * Unterbricht eine laufende Antwort der KI.
   *
   * Wichtig: Wir tracken die aktuelle response-ID server-side, weil
   * 'response.cancel' nur sinnvoll ist solange eine Response wirklich aktiv
   * ist. Sobald response.done eintrifft, gibt es nichts mehr zu cancellen
   * - selbst wenn das Audio noch ausspielt (das wird über output_audio_buffer.clear
   * separat gestoppt).
   *
   * Reihenfolge ist wichtig:
   * 1. output_audio_buffer.clear → User hört sofort Stille
   * 2. response.cancel → nur wenn noch nicht response.done eingetroffen ist
   *
   * Idempotent: zweiter Aufruf ist No-Op (verhindert "Cancellation failed"-Fehler)
   */
  const interruptRealtimeResponse = () => {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== 'open') return;

    try {
      // 1. Audio-Buffer immer leeren - das ist immer sicher und sofort wirksam
      dc.send(JSON.stringify({ type: 'output_audio_buffer.clear' }));

      // 2. Response cancellen NUR wenn eine aktive ID gesetzt ist
      // (wird auf null gesetzt sobald response.done eintrifft oder bereits gecancelt)
      if (activeResponseIdRef.current) {
        dc.send(JSON.stringify({ type: 'response.cancel' }));
        activeResponseIdRef.current = null;
      }
    } catch (err) {
      console.warn('[realtime] interrupt failed:', err);
    }
  };

  // ─────────── Unified Tap-Handler ───────────
  const handleTap = () => {
    // iOS Speech-Engine entsperren - muss synchron im Touch-Event passieren.
    if (isDemoUser) {
      speech.primeForUserInteraction();
    }

    if (isDemoUser) {
      // Demo-User: simulierter Flow mit Web Speech
      if (voiceState === 'idle' || voiceState === 'error') runDemoFlow();
      else if (voiceState === 'recording') {
        // Bei Demo: nichts tun (Demo-Sequenz läuft)
      }
      else if (voiceState === 'responding') {
        stopSpeech();
        setVoiceState('idle');
        setTimeout(() => runDemoFlow(), 200);
      }
    } else {
      // Echte User: OpenAI Realtime mit Server-VAD und kontinuierlichem Dialog
      if (voiceState === 'idle' || voiceState === 'error') {
        // Session starten - bleibt offen für mehrere Turns
        startRealtimeSession();
      } else if (voiceState === 'recording') {
        // Tap während Recording = User möchte Session beenden
        cleanupRealtime();
        setVoiceState('idle');
      } else if (voiceState === 'processing') {
        cleanupRealtime();
        setVoiceState('idle');
      } else if (voiceState === 'responding') {
        // Tap während Antwort = Antwort unterbrechen, Session offen lassen
        interruptRealtimeResponse();
      }
    }
  };

  const clearDialog = () => {
    setTurns([]);
    setDemoStep(0);
    stopSpeech();
  };

  // Headset Media-Keys: Bluetooth-Play/Pause-Taste löst handleTap aus,
  // genauso als hätte der User auf den Tap-Button gedrückt.
  // Aktiviert nach erster User-Interaktion (Browser-Audio-Restriktion).
  const headset = useHeadsetMediaKeys({
    onTap: handleTap,
    voiceState,
    enabled: settings.headsetMediaKeys && !isDemoUser, // Demo nutzt Web Speech, hat eigenes Audio
  });

  const handleLogout = async () => {
    await signOut({ callbackUrl: '/login' });
  };

  const buttonLabel = (() => {
    switch (voiceState) {
      case 'idle': return isDemoUser ? t('ptt.idle.demo') : t('ptt.idle.real');
      case 'connecting': return translatorActive ? t('translator.connecting') : t('ptt.connecting');
      case 'recording': return isDemoUser ? t('ptt.recording.demo') : t('ptt.recording.real');
      case 'processing': return t('ptt.processing');
      case 'responding': return isDemoUser ? t('ptt.responding.demo') : t('ptt.responding.real');
      case 'error': return t('ptt.error');
    }
  })();

  return (
    <div
      className="flex flex-col fixed inset-0 overflow-hidden"
      style={{
        height: '100dvh',
        // Translator-Modus: erkennbar getönter Hintergrund (lila/rosa-Anflug),
        // damit der User auch beim Scrollen weiß "ich bin im Übersetzungs-Modus".
        // Normal-Modus: tenant-spezifischer warmer Hintergrund.
        background: translatorActive
          ? 'linear-gradient(180deg, #EEF2FF 0%, #FAF5FF 50%, #FDF2F8 100%)'
          : `linear-gradient(180deg, ${secondary} 0%, #FFFFFF 30%, #FFFFFF 100%)`,
        transition: 'background 300ms ease',
      }}
    >
      {/* Header - Standard ODER Translator-Banner */}
      {translatorActive && translatorTarget ? (
        <header
          className="flex-shrink-0 px-4 py-3.5 flex items-center justify-between border-b z-30 shadow-md"
          style={{
            background: 'linear-gradient(135deg, #6366F1 0%, #8B5CF6 50%, #EC4899 100%)',
            borderColor: 'rgba(255,255,255,0.2)',
          }}
        >
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="w-11 h-11 rounded-2xl flex items-center justify-center bg-white/20 backdrop-blur shrink-0 relative">
              <Languages size={20} className="text-white" />
              {/* Pulsierender Aktiv-Indikator */}
              <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-300 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400 border-2 border-white" />
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <p className="text-[10px] uppercase tracking-wider text-white font-bold">
                  ● {t('translator.banner')}
                </p>
                <span className="text-[9px] uppercase tracking-wider text-emerald-300 font-bold animate-pulse">
                  {t('translator.activeLabel')}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-white text-sm font-semibold mt-0.5">
                <span className="text-base">{SUPPORTED_LOCALES.find(l => l.code === locale)?.flag || '🌐'}</span>
                <span className="truncate">{SUPPORTED_LOCALES.find(l => l.code === locale)?.nativeLabel}</span>
                <ArrowLeftRight size={12} className="text-white/70 mx-0.5" />
                <span className="text-base">{translatorTarget.flag || '🌐'}</span>
                <span className="truncate">{translatorTarget.nativeLabel || translatorTarget.label}</span>
              </div>
            </div>
          </div>
          <button
            onClick={() => {
              cleanupRealtime();
              setTranslatorActive(false);
              setTranslatorTarget(null);
              setTurns([]);
              setVoiceState('idle');
            }}
            className="px-3 py-1.5 rounded-full bg-white/20 hover:bg-white/30 backdrop-blur text-white text-xs font-medium transition flex items-center gap-1.5 shrink-0"
          >
            <X size={12} />
            {t('translator.exitButton')}
          </button>
        </header>
      ) : (
        <header className="flex-shrink-0 px-4 py-3.5 flex items-center justify-between bg-white/80 backdrop-blur border-b border-stone-100 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl flex items-center justify-center text-xl shadow-sm shrink-0" style={{ background: secondary }}>
              {tenant.branding.logo_emoji}
            </div>
            <div className="min-w-0">
              <h1 className="text-sm font-semibold text-stone-800 leading-tight truncate">
                {tenant.branding.app_name}
                {isDemoUser && <span className="ml-1.5 text-[10px] font-mono px-1.5 py-0.5 rounded bg-stone-100 text-stone-500 align-middle">{t('app.demo_badge')}</span>}
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
      )}

      {/* Hinweis: der frühere Sticky-Status-Streifen wurde entfernt - er war
          redundant zum Translator-Banner oben (zeigte dieselbe Info zweimal).
          Der Banner und der getönte App-Hintergrund signalisieren den Modus
          jetzt klar genug. */}

      {/* Tools-Strip im Normal-Modus.
          Standard-Modus-Anzeige wurde entfernt - der User sieht beim
          Mode-Wechsel sowieso einen ganz anderen Bildschirm (Translator-UI),
          deshalb braucht der Normal-Modus keine "ich bin Standard"-Anzeige.
          Tools sind klickbar - ein Klick simuliert "${name}, [Tool-Label]"
          als User-Aussage und startet dadurch einen Voice-Dialog mit dem Tool. */}
      {!translatorActive && (
        <div className="flex-shrink-0 px-4 py-2.5 bg-white border-b border-stone-100">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Wrench size={11} className="text-stone-400" />
            <span className="text-[10px] uppercase tracking-wider text-stone-500 font-semibold">
              {tenant.tools.length} {t('app.tools.available')}
            </span>
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {tenant.tools.map(tool => (
              <button
                key={tool.id}
                title={tool.description}
                onClick={() => {
                  if (voiceState !== 'idle' && voiceState !== 'error') return;
                  // Trigger-Phrase: "[AgentName], [Tool-Label]"
                  // Das Modell wird darauf wie auf eine echte Sprach-Aussage
                  // reagieren und das passende Tool aufrufen.
                  const trigger = `${settings.agentName}, ${tool.label}`;
                  startRealtimeSession({ initialUserMessage: trigger });
                }}
                disabled={voiceState !== 'idle' && voiceState !== 'error'}
                className="px-2.5 py-1 rounded-full text-[10px] whitespace-nowrap shrink-0 font-medium border transition hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background: secondary,
                  color: primary,
                  borderColor: withAlpha(primary, 0.15),
                }}
              >
                {tool.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Dialog History */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-5 space-y-3">
        {turns.length === 0 ? (
          translatorActive && translatorTarget ? (
            <TranslatorEmptyState
              sourceLocale={locale}
              targetLabel={translatorTarget.nativeLabel || translatorTarget.label}
              t={t}
            />
          ) : (
            <EmptyState tenant={tenant} primary={primary} secondary={secondary} isDemoUser={isDemoUser} t={t} />
          )
        ) : (
          translatorActive
            ? renderTranslatorTurns(turns, locale, translatorTarget, t)
            : turns.map(turn => {
                // Tool-Bestätigung
                if (turn.toolConfirmation) {
                  return (
                    <ToolConfirmCard
                      key={turn.id}
                      turn={turn}
                      primary={primary}
                      t={t}
                      onConfirm={confirmPendingTool}
                      onCancel={cancelPendingTool}
                      isPending={pendingTool?.cardTurnId === turn.id}
                    />
                  );
                }
                // Wissens-Card
                if (turn.knowledge) {
                  return <KnowledgeCard key={turn.id} turn={turn} primary={primary} t={t} />;
                }
                // Standard Turn
                return <TurnCard key={turn.id} turn={turn} primary={primary} t={t} />;
              })
        )}
        <div ref={dialogEndRef} />
      </div>

      {/* Error Banner */}
      {error && (
        <div className="flex-shrink-0 mx-4 mb-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-rose-700 mb-0.5">{t('app.error')}</p>
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
          <TalkButton voiceState={voiceState} audioLevel={audioLevel} primary={translatorActive ? '#6366F1' : primary} onTap={handleTap} />
          <p className="text-sm text-stone-700 mt-3 font-semibold">{buttonLabel}</p>
          {translatorActive ? (
            <p className="text-[11px] text-stone-400 mt-1">{t('translator.endHint')}</p>
          ) : (
            <div className="flex items-center gap-1.5 mt-1">
              <p className="text-[11px] text-stone-400">{t('ptt.hint')}</p>
              {headset.isActive && (
                <span
                  className="text-[10px] flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700"
                  title={t('headset.activeHint')}
                >
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 1a9 9 0 0 0-9 9v7c0 1.66 1.34 3 3 3h3v-8H5v-2a7 7 0 0 1 14 0v2h-4v8h3c1.66 0 3-1.34 3-3v-7a9 9 0 0 0-9-9z"/>
                  </svg>
                  {t('headset.active')}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {showSettings && (
        <SettingsModal
          tenant={tenant}
          user={user}
          primary={primary}
          speech={speech}
          settings={settings}
          updateSettings={updateSettings}
          onLogout={handleLogout}
          onClose={() => setShowSettings(false)}
          locale={locale}
          setLocale={setLocale}
          t={t}
          headsetIsActive={headset.isActive}
          isDemoUser={isDemoUser}
        />
      )}

      {/* Debug-Panel: zeigt alle Realtime-Events live an. Nur sichtbar wenn
          die App mit ?debug=1 aufgerufen wurde. Zur Diagnose von Tool-Call-
          Problemen (siehst was OpenAI tatsächlich schickt). */}
      {debugVisible && (
        <div className="fixed bottom-2 right-2 left-2 sm:left-auto sm:w-96 max-h-[40vh] bg-black/90 text-emerald-300 rounded-2xl p-3 z-50 font-mono text-[10px] flex flex-col shadow-2xl">
          <div className="flex items-center justify-between mb-2 text-white">
            <span className="font-bold">🐞 DEBUG · {debugLog.length} events</span>
            <div className="flex gap-1">
              <button
                onClick={() => setDebugLog([])}
                className="px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-[10px]"
              >clear</button>
              <button
                onClick={() => setDebugVisible(false)}
                className="px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-[10px]"
              >×</button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto space-y-0.5">
            {debugLog.length === 0 && <p className="text-stone-500 italic">No events yet</p>}
            {debugLog.map((line, i) => (
              <div key={i} className={
                line.includes('DISPATCH') ? 'text-yellow-300 font-bold' :
                line.includes('start_translation') ? 'text-pink-300 font-bold' :
                line.includes('stop_translation') ? 'text-pink-300' :
                line.includes('fn-args') || line.includes('function_call') ? 'text-cyan-300' :
                'text-emerald-300/70'
              }>{line}</div>
            ))}
          </div>
        </div>
      )}

      {/* Floating Debug-Toggle wenn Panel zu, aber Param gesetzt.
          debugVisible ist nach hydrierten useEffect schon korrekt - hier
          aber zusätzlich die Floating-Variante wenn Panel manuell geschlossen.
          Wir nutzen NUR debugVisible-State hier, kein direkter window-Zugriff
          (sonst Hydration-Mismatch). */}
      {!debugVisible && debugLog.length > 0 && (
        <button
          onClick={() => setDebugVisible(true)}
          className="fixed bottom-2 right-2 w-10 h-10 rounded-full bg-black/80 text-emerald-300 z-50 shadow-lg text-base"
        >🐞</button>
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

/* ─────────── Tool-Bestätigungs-Card (Human-in-the-Loop) ─────────── */

function ToolConfirmCard({ turn, primary, t, onConfirm, onCancel, isPending }: any) {
  const c = turn.toolConfirmation;
  if (!c) return null;
  const status: 'pending' | 'confirmed' | 'cancelled' = c.status;

  // Visuelle Variante je Status
  const isPendingStatus = status === 'pending';
  const isConfirmed = status === 'confirmed';
  const isCancelled = status === 'cancelled';

  const time = new Date(turn.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  return (
    <div
      className="rounded-2xl border-2 shadow-sm overflow-hidden"
      style={{
        borderColor: isConfirmed ? '#34D399' : isCancelled ? '#FDA4AF' : primary,
        background: isConfirmed ? '#F0FDF4' : isCancelled ? '#FFF1F2' : '#FFFFFF',
      }}
    >
      <div className="px-4 py-2.5 flex items-center justify-between gap-2 border-b" style={{ borderColor: isConfirmed ? '#D1FAE5' : isCancelled ? '#FECDD3' : '#E7E5E4' }}>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Wrench size={14} style={{ color: isConfirmed ? '#059669' : isCancelled ? '#E11D48' : primary }} />
          <span className="text-xs font-semibold text-stone-800 truncate">{c.toolLabel}</span>
        </div>
        <span className="text-[10px] font-mono text-stone-400 shrink-0">{time}</span>
      </div>

      <div className="px-4 py-3">
        <p className="text-[10px] uppercase tracking-wider text-stone-500 font-semibold mb-1.5">
          {t('tool.confirmSummary')}
        </p>
        <pre className="text-[13px] text-stone-800 leading-snug whitespace-pre-wrap font-sans">{c.summary}</pre>
      </div>

      {isPendingStatus && isPending && (
        <div className="px-4 py-2.5 border-t border-stone-200 bg-stone-50 flex items-center gap-2">
          <button
            onClick={onConfirm}
            className="flex-1 py-2 rounded-xl font-semibold text-sm text-white transition"
            style={{ background: primary }}
          >
            ✓ {t('tool.confirm')}
          </button>
          <button
            onClick={onCancel}
            className="flex-1 py-2 rounded-xl font-semibold text-sm border-2 border-stone-300 text-stone-600 hover:bg-stone-100 transition"
          >
            ✗ {t('tool.cancel')}
          </button>
        </div>
      )}

      {isConfirmed && (
        <div className="px-4 py-2 bg-emerald-50 border-t border-emerald-100 flex items-center gap-1.5">
          <span className="text-emerald-700 text-[11px] font-semibold">✓ {t('tool.confirmed')}</span>
        </div>
      )}

      {isCancelled && (
        <div className="px-4 py-2 bg-rose-50 border-t border-rose-100 flex items-center gap-1.5">
          <span className="text-rose-700 text-[11px] font-semibold">✗ {t('tool.cancelled')}</span>
        </div>
      )}
    </div>
  );
}

/* ─────────── Wissens-Card mit Quellen-Audit ─────────── */

function KnowledgeCard({ turn, primary, t }: any) {
  const k = turn.knowledge;
  if (!k) return null;
  const isLoading = k.answer === '__loading__';

  const time = new Date(turn.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="rounded-2xl border border-stone-200 bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-4 py-2.5 flex items-center justify-between gap-2 border-b border-stone-100" style={{ background: 'linear-gradient(90deg, #EFF6FF 0%, #EEF2FF 100%)' }}>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-blue-600 shrink-0">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-xs font-semibold text-stone-800 truncate">{t('knowledge.title')}</span>
        </div>
        <span className="text-[10px] font-mono text-stone-400 shrink-0">{time}</span>
      </div>

      {/* Query */}
      <div className="px-4 py-2 bg-stone-50 border-b border-stone-100">
        <p className="text-[10px] uppercase tracking-wider text-stone-500 font-semibold">{t('knowledge.question')}</p>
        <p className="text-[13px] text-stone-700 mt-0.5 italic">"{k.query}"</p>
      </div>

      {/* Antwort */}
      <div className="px-4 py-3">
        {isLoading ? (
          <div className="flex items-center gap-2 text-stone-500 text-sm">
            <Loader2 size={14} className="animate-spin" />
            <span>{t('knowledge.searching')}</span>
          </div>
        ) : (
          <div className="text-[13px] text-stone-800 leading-relaxed whitespace-pre-wrap">{k.answer}</div>
        )}
      </div>

      {/* Quellen / Audit-Trail */}
      {!isLoading && k.citations && k.citations.length > 0 && (
        <div className="px-4 py-2.5 bg-stone-50 border-t border-stone-100">
          <p className="text-[10px] uppercase tracking-wider text-stone-500 font-semibold mb-1.5">
            {t('knowledge.sources')} ({k.citations.length})
          </p>
          <div className="space-y-1">
            {k.citations.map((cite: any, i: number) => (
              <a
                key={i}
                href={cite.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-[11px] hover:underline group"
              >
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: cite.isTrusted ? '#10B981' : '#A8A29E' }}
                  title={cite.isTrusted ? t('knowledge.trusted') : t('knowledge.general')}
                />
                <span className="font-medium text-stone-700 truncate flex-1">{cite.title}</span>
                <span className="text-stone-400 font-mono shrink-0">{cite.domain}</span>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Disclaimer */}
      {!isLoading && (
        <div className="px-4 py-2 bg-amber-50 border-t border-amber-100">
          <p className="text-[10px] text-amber-800 leading-tight">{t('knowledge.disclaimer')}</p>
        </div>
      )}
    </div>
  );
}

function TurnCard({ turn, primary, t }: { turn: Turn; primary: string; t: (k: string) => string }) {
  const isUser = turn.role === 'user';
  const time = new Date(turn.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

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
            {isUser ? t('turn.you') : t('turn.assistant')}
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

/* ─────────── Translator: Empty-State + Übersetzungs-Pärchen ─────────── */

function TranslatorEmptyState({ sourceLocale, targetLabel, t }: any) {
  const sourceFlag = SUPPORTED_LOCALES.find((l: any) => l.code === sourceLocale)?.flag || '🌐';
  const sourceName = SUPPORTED_LOCALES.find((l: any) => l.code === sourceLocale)?.nativeLabel || sourceLocale;
  return (
    <div className="flex flex-col items-center justify-center text-center pt-12 pb-6 px-4">
      <div
        className="w-20 h-20 rounded-3xl flex items-center justify-center mb-5 shadow-md"
        style={{ background: 'linear-gradient(135deg, #6366F1 0%, #EC4899 100%)' }}
      >
        <Languages size={32} className="text-white" />
      </div>
      <div className="flex items-center gap-2 mb-2 text-base font-semibold text-stone-700">
        <span className="text-xl">{sourceFlag}</span>
        <span>{sourceName}</span>
        <ArrowLeftRight size={14} className="text-stone-400 mx-1" />
        <span className="text-xl">🌐</span>
        <span>{targetLabel}</span>
      </div>
      <p className="text-sm text-stone-500 max-w-xs leading-relaxed">
        {t('translator.placeholder', { source: sourceName, target: targetLabel })}
      </p>
      <p className="text-xs text-stone-400 mt-3 italic">
        {t('translator.endHint')}
      </p>
    </div>
  );
}

/**
 * Im Translator-Mode: Turns als Pärchen rendern (Original + Übersetzung).
 * Logik: jeder User-Turn ist ein "Original", der direkt folgende Assistant-Turn
 * ist die "Übersetzung". Wir gruppieren sie zu Paaren.
 */
function renderTranslatorTurns(turns: Turn[], sourceLocale: string, target: any, t: (k: string, p?: any) => string) {
  // Pairs bauen: jeder User-Turn startet einen neuen Pair, der nächste
  // Assistant-Turn füllt ihn auf. Die Reihenfolge im Translator-Modus ist
  // immer: User-Aussage → Übersetzung. Wenn zwei User-Turns hintereinander
  // kommen (z.B. weil der Assistant noch lädt) wird das als zwei separate
  // Pairs gerendert.
  //
  // Verwaiste Assistant-Turns (ohne vorhergehenden User-Turn) sollten im
  // Translator-Modus durch den verschärften Prompt nicht mehr auftreten.
  // Wenn sie doch mal kommen (z.B. weil das Modell trotzdem von sich aus
  // was sagt), filtern wir sie raus - sie passen nicht ins Pärchen-Schema.
  type Pair = { user: Turn | null; assistant: Turn | null };
  const pairs: Pair[] = [];
  let current: Pair = { user: null, assistant: null };
  for (const turn of turns) {
    if (turn.role === 'user') {
      if (current.user) pairs.push(current);
      current = { user: turn, assistant: null };
    } else {
      // assistant
      if (current.user && !current.assistant) {
        current.assistant = turn;
        pairs.push(current);
        current = { user: null, assistant: null };
      } else if (current.user && current.assistant) {
        // Schon ein Pärchen voll - der zweite Assistant-Output ist eine
        // erweiterte/korrigierte Übersetzung. Wir verlängern den Text.
        current = { user: null, assistant: null };
        const last = pairs[pairs.length - 1];
        if (last?.assistant) {
          last.assistant = { ...last.assistant, text: last.assistant.text + ' ' + turn.text };
        }
      }
      // Verwaiste Assistant-Turns ohne User-Vorgänger: ignorieren
    }
  }
  if (current.user) pairs.push(current);

  return (
    <div className="space-y-3">
      {pairs.map((pair, i) => (
        <TranslatorPair key={i} pair={pair} sourceLocale={sourceLocale} target={target} t={t} />
      ))}
    </div>
  );
}

function TranslatorPair({ pair, sourceLocale, target, t }: any) {
  const time = pair.user
    ? new Date(pair.user.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : pair.assistant
      ? new Date(pair.assistant.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
      : '';

  // EINE zusammenhängende Karte mit zwei Sektionen.
  // Bewusste UX-Entscheidung: oben ist IMMER die Eingabe (was reingekommen ist),
  // unten IMMER die Ausgabe (Übersetzung). Wir zeigen NICHT die jeweilige
  // Sprache - das wäre fehleranfällig (welche Sprache war's? schwer
  // zuverlässig zu erkennen). "Eingabe" und "Ausgabe" sind neutral und immer
  // korrekt, egal welche Richtung gerade übersetzt wurde.

  return (
    <div className="rounded-2xl bg-white border border-stone-200 shadow-sm overflow-hidden">
      {/* Eingabe-Sektion */}
      {pair.user && (
        <div className="px-4 py-3">
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="text-[10px] uppercase tracking-wider text-stone-400 font-semibold">
              {t('translator.input')}
            </span>
            {time && <span className="text-[10px] font-mono text-stone-300 ml-auto">{time}</span>}
          </div>
          <p className="text-[15px] text-stone-800 leading-snug">{pair.user.text || '…'}</p>
        </div>
      )}

      {/* Trenn-Linie zwischen Eingabe und Ausgabe */}
      {pair.user && pair.assistant && (
        <div className="border-t border-stone-100" />
      )}

      {/* Ausgabe-Sektion */}
      {pair.assistant && (
        <div
          className="px-4 py-3"
          style={{ background: 'linear-gradient(135deg, #FAFAFC 0%, #FDF8FB 100%)' }}
        >
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="text-[10px] uppercase tracking-wider text-indigo-600 font-semibold">
              {t('translator.output')}
            </span>
          </div>
          <p className="text-[15px] text-stone-800 leading-snug">{pair.assistant.text || '…'}</p>
        </div>
      )}
    </div>
  );
}

/* ─────────── Empty State ─────────── */

function EmptyState({ tenant, primary, secondary, isDemoUser, t }: any) {
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
        {t('empty.tapHint')}
      </p>
      {isDemoUser && (
        <div
          className="mt-4 px-3 py-2 rounded-full text-[11px] font-medium"
          style={{ background: secondary, color: primary }}
        >
          {t('empty.demoHint')}
        </div>
      )}
    </div>
  );
}

/* ─────────── Settings Modal ─────────── */

function SettingsModal({ tenant, user, primary, onLogout, onClose, speech, settings, updateSettings, locale, setLocale, t, headsetIsActive, isDemoUser: isDemoUserFromProps }: any) {
  return (
    <div className="fixed inset-0 z-50 bg-stone-900/30 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white sm:rounded-3xl rounded-t-3xl max-w-md w-full max-h-[90vh] overflow-y-auto shadow-2xl">
        <header className="px-5 py-4 border-b border-stone-100 flex items-center justify-between sticky top-0 bg-white z-10">
          <h3 className="font-semibold text-stone-800">{t('settings.title')}</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-xl bg-stone-100 hover:bg-stone-200 flex items-center justify-center transition">
            <X size={16} />
          </button>
        </header>

        <div className="p-5 space-y-5">
          {/* Agent-Name ganz oben - persönlichste Einstellung, beeinflusst
              Trigger-Wörter, Stimmprobe und alle UI-Texte mit Namens-Bezug. */}
          <AgentNameSetting
            value={settings.agentName}
            onChange={(name: string) => updateSettings({ agentName: name })}
            primary={primary}
            t={t}
          />

          {/* Sprach-Wahl - beeinflusst alle Texte und Stimm-Proben */}
          <LanguagePickerSetting
            value={locale}
            onChange={setLocale}
            primary={primary}
            t={t}
          />

          {/* Headset Media-Keys: nur für echte User (Demo nutzt Web Speech,
              hat keine OpenAI-Realtime-Session zum togglen). */}
          {!isDemoUserFromProps && (
            <HeadsetSetting
              value={settings.headsetMediaKeys}
              onChange={(v: boolean) => updateSettings({ headsetMediaKeys: v })}
              primary={primary}
              t={t}
              isActive={headsetIsActive}
            />
          )}

          <section>
            <h4 className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-2 flex items-center gap-1.5">
              <Users size={12} /> {t('settings.account')}
            </h4>
            <div className="rounded-2xl border border-stone-200 bg-stone-50 p-3">
              <p className="text-sm font-semibold text-stone-800">{user.name || user.email}</p>
              <p className="text-xs text-stone-500 mt-0.5">{user.email}</p>
              {user.role && <p className="text-xs mt-1" style={{ color: primary }}>{user.role}</p>}
              {user.isDemoUser && (
                <p className="text-[10px] mt-2 font-mono px-2 py-0.5 rounded bg-stone-200 text-stone-600 inline-block">
                  {t('settings.demoActive')}
                </p>
              )}
            </div>
          </section>

          {/* OpenAI-Voice-Picker für echte User */}
          {!user.isDemoUser && (
            <OpenAIVoicePicker
              tenant={tenant}
              selectedVoiceId={settings.voiceId}
              onSelect={(id: string | null) => updateSettings({ voiceId: id })}
              primary={primary}
              locale={locale}
              agentName={settings.agentName}
              t={t}
            />
          )}

          {/* Browser-Voice-Picker für Demo-User */}
          {user.isDemoUser && speech?.isSupported && (
            <section>
              <h4 className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-2 flex items-center gap-1.5">
                <Volume2 size={12} /> {t('settings.demoVoice.title')}
              </h4>
              <p className="text-[11px] text-stone-500 mb-3">
                {t('settings.demoVoice.desc')}
              </p>
              <VoicePicker
                voices={speech.voices}
                allVoices={speech.allVoices}
                selectedVoiceId={speech.selectedVoiceId}
                onSelect={speech.selectVoice}
                onPreview={(id: string | null) => {
                  speech.primeForUserInteraction();
                  setTimeout(() => {
                    speech.speak(buildVoicePreviewText(locale as Locale, settings.agentName), {
                      rate: 1.0,
                    });
                  }, 100);
                }}
                primary={primary}
              />
            </section>
          )}

          {/* VAD-Empfindlichkeit: nur für echte User, weil nur Realtime-API VAD nutzt */}
          {!user.isDemoUser && (
            <VadSensitivitySetting
              value={settings.vadSensitivity}
              onChange={(sens: any) => updateSettings({ vadSensitivity: sens })}
              primary={primary}
              t={t}
            />
          )}

          {/* Lausch-Timeout nach Antwort (für echte User mit Realtime) */}
          {!user.isDemoUser && (
            <ListenTimeoutSetting
              valueSec={settings.listenTimeoutSec}
              onChange={(sec: number) => updateSettings({ listenTimeoutSec: sec })}
              primary={primary}
              t={t}
            />
          )}

          <section>
            <h4 className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-2 flex items-center gap-1.5">
              <Building2 size={12} /> {t('settings.tenant')}
            </h4>
            <div className="rounded-2xl border border-stone-200 bg-stone-50 p-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">{tenant.branding.logo_emoji}</span>
                <p className="text-sm font-semibold text-stone-800">{tenant.name}</p>
              </div>
              <p className="text-xs text-stone-600 mb-2">{tenant.industry}</p>
              {tenant.region && <p className="text-xs text-stone-600 mb-2">📍 {tenant.region.city}</p>}
              <div className="space-y-1 text-[11px] text-stone-500">
                <p>{t('settings.id')}: <code className="text-stone-700">{tenant.id}</code></p>
                <p>{t('settings.emailDomains')}: {tenant.email_domains.join(', ')}</p>
              </div>
            </div>
          </section>

          <ToolsListSetting tools={tenant.tools} primary={primary} t={t} />

          <section>
            <h4 className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-2 flex items-center gap-1.5">
              <Shield size={12} /> {t('settings.privacy')}
            </h4>
            <div className="rounded-2xl border border-stone-200 bg-stone-50 p-3 space-y-1.5 text-xs text-stone-600">
              <p>{t('settings.privacy.hosting')}: <span className="font-semibold text-stone-800">{t('settings.privacy.region', { region: tenant.compliance.data_residency })}</span></p>
              <p>{t('settings.privacy.audit')}: <span className="font-semibold text-stone-800">{t('settings.privacy.days', { days: tenant.compliance.audit_retention_days })}</span></p>
            </div>
          </section>

          <button
            onClick={onLogout}
            className="w-full py-3 rounded-2xl border-2 border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 font-semibold transition flex items-center justify-center gap-2"
          >
            <LogOut size={16} />
            {t('settings.logout')}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────── OpenAI Voice Picker (für echte User) ─────────── */

function OpenAIVoicePicker({ tenant, selectedVoiceId, onSelect, primary, locale, agentName, t }: any) {
  const tenantDefault = tenant.agent.voice_id;

  // Welche Stimme lädt gerade eine Probe (für Loading-Spinner)
  const [previewLoadingFor, setPreviewLoadingFor] = useState<string | null>(null);

  // Recycelbares Audio-Element + Abort-Controller für vorherige Proben
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewAbortRef = useRef<AbortController | null>(null);

  // Beim Unmount aufräumen
  useEffect(() => {
    return () => {
      previewAbortRef.current?.abort();
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
        previewAudioRef.current.src = '';
        try { previewAudioRef.current.remove(); } catch {}
      }
    };
  }, []);

  /**
   * Probe einer Stimme abspielen.
   *
   * Bricht alle vorherigen Proben ab (User klickt schnell durch),
   * lädt MP3 vom /api/tts-preview Endpoint, spielt direkt ab.
   *
   * Bei Fehler: still loggen. Probe ist Komfort, kein kritischer Pfad -
   * wir wollen keinen roten Banner werfen wenn TTS-API mal hakt.
   */
  const playPreview = async (voiceId: string) => {
    // Vorherige Probe abbrechen
    previewAbortRef.current?.abort();
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current.src = '';
    }

    const controller = new AbortController();
    previewAbortRef.current = controller;
    setPreviewLoadingFor(voiceId);

    try {
      // Locale-aware Probe-Text damit die Stimme in der App-Sprache klingt
      const previewText = buildVoicePreviewText(locale as Locale, agentName || 'Anni');
      const res = await fetch('/api/tts-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voice: voiceId,
          text: previewText,
          locale,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        console.warn('[voice-preview] failed:', res.status);
        return;
      }

      const blob = await res.blob();
      // Wenn zwischenzeitlich abgebrochen wurde, hier raus
      if (controller.signal.aborted) return;

      const url = URL.createObjectURL(blob);

      // Audio-Element wiederverwenden wenn möglich
      let audio = previewAudioRef.current;
      if (!audio) {
        audio = new Audio();
        audio.setAttribute('playsinline', 'true');
        previewAudioRef.current = audio;
      }
      // Cleanup vorherige Object-URL nach Wiedergabe
      audio.onended = () => URL.revokeObjectURL(url);
      audio.onerror = () => URL.revokeObjectURL(url);
      audio.src = url;
      await audio.play().catch(err => {
        console.warn('[voice-preview] play failed:', err);
      });
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        console.warn('[voice-preview] error:', err);
      }
    } finally {
      // Loading-State nur räumen wenn das die aktuelle Probe ist
      // (sonst überschreibt diese das State des nächsten Klicks)
      if (previewAbortRef.current === controller) {
        setPreviewLoadingFor(null);
      }
    }
  };

  const handleSelect = (id: string | null) => {
    onSelect(id);
    // Beim Wechsel über das Dropdown gibt es bewusst KEINE automatische Probe.
    // Der User klickt explizit auf "Probe hören" - das war der Wunsch
    // (Option B in der Designdiskussion).
  };

  // Welche Voice-ID ist aktuell effektiv aktiv (für Probe-Button)
  const effectiveVoiceId = selectedVoiceId || tenantDefault;
  const isPreviewLoading = previewLoadingFor === effectiveVoiceId;

  // Optionen-Liste: Tenant-Default zuerst, dann alle Stimmen
  const options = [
    { id: null, label: t('settings.voice.tenantDefault', { tenant: tenant.name }), description: OPENAI_VOICES.find((v: any) => v.id === tenantDefault)?.label || tenantDefault },
    ...OPENAI_VOICES.map((v: any) => ({ id: v.id, label: v.label, description: v.description })),
  ];

  return (
    <section>
      <h4 className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-2 flex items-center gap-1.5">
        <Volume2 size={12} /> {t('settings.voice.title')}
      </h4>
      <p className="text-[11px] text-stone-500 mb-2">
        {t('settings.voice.desc')}
      </p>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <select
            value={selectedVoiceId ?? '__default__'}
            onChange={(e) => {
              const v = e.target.value;
              handleSelect(v === '__default__' ? null : v);
            }}
            className="w-full appearance-none p-3 pr-10 rounded-2xl border border-stone-200 bg-white text-sm text-stone-800 cursor-pointer focus:outline-none focus:ring-2 focus:ring-offset-1"
            style={{ borderColor: '#E7E5E4', '--tw-ring-color': primary } as any}
          >
            {options.map(opt => (
              <option key={opt.id ?? '__default__'} value={opt.id ?? '__default__'}>
                {opt.label} {opt.description ? `· ${opt.description}` : ''}
              </option>
            ))}
          </select>
          <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-stone-400">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>
        <button
          onClick={() => effectiveVoiceId && playPreview(effectiveVoiceId)}
          disabled={!effectiveVoiceId || isPreviewLoading}
          title={t('settings.voice.preview')}
          className="px-3 rounded-2xl border-2 flex items-center gap-1.5 text-xs font-semibold transition disabled:opacity-50"
          style={{
            borderColor: primary,
            background: `${primary}10`,
            color: primary,
          }}
        >
          {isPreviewLoading ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Volume2 size={14} />
          )}
          <span className="hidden sm:inline">{t('settings.voice.preview')}</span>
        </button>
      </div>
    </section>
  );
}

/* ─────────── Lausch-Timeout Slider ─────────── */

/* ─────────── App-Sprache (i18n) ─────────── */

/* ─────────── Tools-Liste in Settings (Aufklapp-Variante) ─────────── */

function ToolsListSetting({ tools, primary, t }: any) {
  // Welche Tool-IDs sind gerade aufgeklappt
  const [expandedIds, setExpandedIds] = React.useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <section>
      <h4 className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-2 flex items-center gap-1.5">
        <Wrench size={12} /> {t('settings.tools')} ({tools.length})
      </h4>
      <div className="rounded-2xl border border-stone-200 bg-stone-50 overflow-hidden divide-y divide-stone-200">
        {tools.map((tool: any) => {
          const isExpanded = expandedIds.has(tool.id);
          return (
            <div key={tool.id}>
              <button
                onClick={() => toggle(tool.id)}
                className="w-full px-3 py-2.5 flex items-center justify-between gap-2 hover:bg-stone-100 transition text-left"
              >
                <span className="text-xs font-semibold text-stone-800 truncate flex-1">{tool.label}</span>
                <span className="text-[9px] uppercase tracking-wider font-mono text-stone-400 shrink-0">{tool.type}</span>
                <svg
                  width="12" height="12" viewBox="0 0 12 12" fill="none"
                  className="shrink-0 text-stone-400 transition-transform"
                  style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
                >
                  <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {isExpanded && (
                <div className="px-3 pb-2.5 -mt-0.5">
                  <p className="text-[11px] text-stone-500 leading-relaxed">{tool.description}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ─────────── Headset Media-Keys Toggle ─────────── */

function HeadsetSetting({ value, onChange, primary, t, isActive }: any) {
  return (
    <section>
      <h4 className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-2 flex items-center gap-1.5">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 1a9 9 0 0 0-9 9v7c0 1.66 1.34 3 3 3h3v-8H5v-2a7 7 0 0 1 14 0v2h-4v8h3c1.66 0 3-1.34 3-3v-7a9 9 0 0 0-9-9z"/>
        </svg>
        {t('settings.headset.title')}
      </h4>
      <p className="text-[11px] text-stone-500 mb-2 leading-relaxed">
        {t('settings.headset.desc')}
      </p>
      <button
        onClick={() => onChange(!value)}
        className="w-full p-3 rounded-2xl border-2 transition flex items-center gap-3 text-left"
        style={{
          borderColor: value ? primary : '#E7E5E4',
          background: value ? `${primary}10` : '#FAFAF9',
        }}
      >
        {/* Toggle Switch */}
        <div
          className="relative w-10 h-6 rounded-full transition shrink-0"
          style={{ background: value ? primary : '#D6D3D1' }}
        >
          <div
            className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform"
            style={{ transform: value ? 'translateX(18px)' : 'translateX(2px)' }}
          />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-stone-800">
            {value ? t('settings.headset.on') : t('settings.headset.off')}
          </p>
          {value && isActive && (
            <p className="text-[11px] text-emerald-600 mt-0.5 font-medium">
              ● {t('settings.headset.activeStatus')}
            </p>
          )}
          {value && !isActive && (
            <p className="text-[11px] text-stone-400 mt-0.5">
              {t('settings.headset.pendingActivation')}
            </p>
          )}
        </div>
      </button>
      <p className="text-[10px] text-stone-400 mt-2 leading-relaxed">
        {t('settings.headset.hint')}
      </p>
    </section>
  );
}

/* ─────────── Agent-Name (persönlicher Name des Voice-Agents) ─────────── */

function AgentNameSetting({ value, onChange, primary, t }: any) {
  // Lokaler State für tippen, damit jedes Zeichen nicht sofort propagiert
  // (sonst würde jeder Tastendruck einen i18n-Re-Render auslösen).
  const [draft, setDraft] = React.useState<string>(value);
  React.useEffect(() => { setDraft(value); }, [value]);

  // Validierung: nur Buchstaben/Leerzeichen/Apostrophe/Bindestriche, max 30
  const isValid = /^[\p{L}\s'-]{1,30}$/u.test(draft.trim());
  const isDirty = draft.trim() !== value.trim();

  const commit = () => {
    if (isValid && isDirty) {
      onChange(draft.trim());
    } else if (!isValid) {
      // Bei Ungültigem auf Default zurück
      setDraft(value);
    }
  };

  return (
    <section>
      <h4 className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-2 flex items-center gap-1.5">
        <Sparkles size={12} /> {t('settings.agentName.title')}
      </h4>
      <p className="text-[11px] text-stone-500 mb-2 leading-relaxed">
        {t('settings.agentName.desc')}
      </p>
      <div className="relative">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          maxLength={30}
          placeholder="Anni"
          className="w-full p-3 rounded-2xl border bg-white text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-offset-1"
          style={{
            borderColor: isDirty && !isValid ? '#FCA5A5' : '#E7E5E4',
            ['--tw-ring-color' as any]: primary,
          }}
        />
        {isDirty && (
          <button
            onClick={commit}
            disabled={!isValid}
            className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 rounded-lg text-[10px] font-semibold transition disabled:opacity-50"
            style={{ background: primary, color: '#FFFFFF' }}
          >
            {t('common.save')}
          </button>
        )}
      </div>
      {isDirty && !isValid && (
        <p className="text-[10px] text-rose-600 mt-1.5">{t('settings.agentName.invalid')}</p>
      )}
      <p className="text-[10px] text-stone-400 mt-1.5 leading-relaxed">
        {t('settings.agentName.hint', { name: draft.trim() || 'Anni' })}
      </p>
    </section>
  );
}

/* ─────────── App-Sprache (i18n) ─────────── */

function LanguagePickerSetting({ value, onChange, primary, t }: any) {
  return (
    <section>
      <h4 className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-2 flex items-center gap-1.5">
        <Globe size={12} /> {t('settings.appLanguage')}
      </h4>
      <p className="text-[11px] text-stone-500 mb-2 leading-relaxed">
        {t('settings.appLanguageDesc')}
      </p>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full appearance-none p-3 pr-10 rounded-2xl border border-stone-200 bg-white text-sm text-stone-800 cursor-pointer focus:outline-none focus:ring-2 focus:ring-offset-1"
          style={{ borderColor: '#E7E5E4', '--tw-ring-color': primary } as any}
        >
          {SUPPORTED_LOCALES.map((loc: any) => (
            <option key={loc.code} value={loc.code}>
              {loc.flag}  {loc.nativeLabel}
            </option>
          ))}
        </select>
        <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-stone-400">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
    </section>
  );
}

/* ─────────── VAD-Empfindlichkeit ─────────── */

function VadSensitivitySetting({ value, onChange, primary, t }: any) {
  const options = [
    {
      id: 'high',
      label: t('settings.vad.high.label'),
      description: t('settings.vad.high.desc'),
      hint: t('settings.vad.high.hint'),
    },
    {
      id: 'normal',
      label: t('settings.vad.normal.label'),
      description: t('settings.vad.normal.desc'),
      hint: t('settings.vad.normal.hint'),
    },
    {
      id: 'low',
      label: t('settings.vad.low.label'),
      description: t('settings.vad.low.desc'),
      hint: t('settings.vad.low.hint'),
    },
  ];

  return (
    <section>
      <h4 className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-2 flex items-center gap-1.5">
        <Mic size={12} /> {t('settings.vad.title')}
      </h4>
      <p className="text-[11px] text-stone-500 mb-3 leading-relaxed">
        {t('settings.vad.desc')}
      </p>
      <div className="space-y-1.5">
        {options.map(opt => {
          const isSelected = opt.id === value;
          return (
            <button
              key={opt.id}
              onClick={() => onChange(opt.id)}
              className="w-full p-3 rounded-2xl border-2 transition text-left"
              style={{
                borderColor: isSelected ? primary : '#E7E5E4',
                background: isSelected ? `${primary}10` : '#FAFAF9',
              }}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-semibold text-stone-800">{opt.label}</span>
                {isSelected && (
                  <span className="text-[10px] font-semibold" style={{ color: primary }}>{t('settings.voice.active')}</span>
                )}
              </div>
              <p className="text-[11px] text-stone-500 mb-0.5">{opt.description}</p>
              <p className="text-[10px] text-stone-400">{opt.hint}</p>
            </button>
          );
        })}
      </div>
      <p className="text-[10px] text-stone-400 mt-2 leading-relaxed">
        {t('settings.vad.hint')}
      </p>
    </section>
  );
}

/* ─────────── Lausch-Timeout Slider ─────────── */

function ListenTimeoutSetting({ valueSec, onChange, primary, t }: any) {
  return (
    <section>
      <h4 className="text-xs uppercase tracking-wider text-stone-500 font-semibold mb-2 flex items-center gap-1.5">
        <Mic size={12} /> {t('settings.timeout.title')}
      </h4>
      <p className="text-[11px] text-stone-500 mb-3 leading-relaxed">
        {t('settings.timeout.desc')}
      </p>
      <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
        <div className="flex items-baseline justify-between mb-3">
          <span className="text-sm text-stone-600">{t('settings.timeout.current')}:</span>
          <span className="text-2xl font-bold" style={{ color: primary }}>
            {valueSec}<span className="text-sm font-normal text-stone-500 ml-1">{t('settings.timeout.seconds')}</span>
          </span>
        </div>
        <input
          type="range"
          min={LISTEN_TIMEOUT_MIN}
          max={LISTEN_TIMEOUT_MAX}
          step={1}
          value={valueSec}
          onChange={(e) => onChange(parseInt(e.target.value, 10))}
          className="w-full h-2 rounded-full appearance-none cursor-pointer"
          style={{
            background: `linear-gradient(to right, ${primary} 0%, ${primary} ${((valueSec - LISTEN_TIMEOUT_MIN) / (LISTEN_TIMEOUT_MAX - LISTEN_TIMEOUT_MIN)) * 100}%, #E7E5E4 ${((valueSec - LISTEN_TIMEOUT_MIN) / (LISTEN_TIMEOUT_MAX - LISTEN_TIMEOUT_MIN)) * 100}%, #E7E5E4 100%)`,
            WebkitAppearance: 'none',
          }}
        />
        <div className="flex justify-between mt-1.5 text-[10px] text-stone-400">
          <span>{LISTEN_TIMEOUT_MIN}s</span>
          <span>{LISTEN_TIMEOUT_MAX}s</span>
        </div>
        <p className="text-[10px] text-stone-400 mt-3 leading-relaxed">
          {t('settings.timeout.costHint')}
        </p>
      </div>
    </section>
  );
}
