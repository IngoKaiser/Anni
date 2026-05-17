'use client';

/**
 * useHeadsetMediaKeys (v2)
 *
 * Bluetooth-Headset Play/Pause-Tasten steuern den Voice-Button.
 *
 * # Architektur
 *
 * Die Media Session API funktioniert nur wenn der Browser eine aktive Audio-
 * Quelle erkennt. Wir spielen einen Silent-Loop (8 KB WAV, 1 Sekunde Stille
 * in Endlos-Loop). Über `setActionHandler('play'/'pause', cb)` registrieren
 * wir Handler die bei Headset-Tap aufgerufen werden.
 *
 * # iOS Quirks - das was wir gelernt haben
 *
 * 1. Audio braucht User-Geste. Erste Aktivierung erst nach Tap/Click.
 * 2. Wenn WebRTC einen Audio-Stream öffnet (= unsere Realtime-Voice-Session),
 *    übernimmt iOS die Audio-Session. Unser Silent-Loop wird verdrängt UND
 *    iOS zeigt eine Toast-Notification "Steuerung mit AirPods nicht möglich".
 * 3. Aber: die Media-Session-Handler bleiben aktiv und reagieren auf den
 *    WebRTC-Stream als neue Source. ABER nur wenn wir den Handler in der
 *    richtigen Phase setzen.
 * 4. Nach Voice-Session-Ende muss der Silent-Loop wieder gestartet werden,
 *    sonst gehen Folge-Taps verloren.
 *
 * # Strategie
 *
 * - Beim ersten User-Tap: Silent-Loop starten + Handler registrieren
 * - Bei voiceState 'recording'/'responding': Silent-Loop pausieren
 *   (WebRTC übernimmt). Handler bleiben registriert.
 * - Bei voiceState 'idle'/'error': Silent-Loop wieder starten
 *   (WebRTC ist weg, wir müssen Audio-Session zurückerobern).
 * - Handler werden bei JEDEM voiceState-Wechsel neu gesetzt - das umgeht
 *   iOS-Bug wo Handler nach Audio-Session-Wechsel verloren gehen.
 */

import { useEffect, useRef, useState } from 'react';

interface UseHeadsetOptions {
  onTap: () => void;
  voiceState: 'idle' | 'connecting' | 'recording' | 'processing' | 'responding' | 'error';
  enabled?: boolean;
}

interface UseHeadsetResult {
  /** Hook ist initialisiert und Action-Handler sind registriert */
  isActive: boolean;
  /** Fehler bei der Initialisierung */
  error: string | null;
  /** Manuelle Aktivierung - wird normalerweise automatisch getriggert */
  activate: () => void;
  /**
   * Tatsächlich verbundenes externes Audio-Output-Device erkannt?
   * - true: ein Headset/Kopfhörer/Bluetooth-Gerät ist verbunden
   * - false: nur eingebauter Lautsprecher verfügbar
   * - null: noch unbekannt (Permission fehlt oder noch nicht enumeriert)
   */
  hasHeadset: boolean | null;
  /**
   * Best-effort Name des verbundenen Headsets, z.B. "AirPods Pro" oder
   * "Bose QC". null wenn nicht ermittelbar (Permission fehlt) oder
   * kein Headset verbunden.
   */
  headsetName: string | null;
}

const SILENT_AUDIO_URL = '/silent.wav';

export function useHeadsetMediaKeys(opts: UseHeadsetOptions): UseHeadsetResult {
  const { onTap, voiceState, enabled = true } = opts;

  const [isActive, setIsActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Device-Detection: was steckt physisch dran?
  const [hasHeadset, setHasHeadset] = useState<boolean | null>(null);
  const [headsetName, setHeadsetName] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const onTapRef = useRef(onTap);
  const voiceStateRef = useRef(voiceState);
  useEffect(() => { onTapRef.current = onTap; }, [onTap]);
  useEffect(() => { voiceStateRef.current = voiceState; }, [voiceState]);

  /**
   * Audio-Output-Devices enumerieren und prüfen ob ein externes Gerät
   * (= Headset/Kopfhörer/Bluetooth) verbunden ist.
   *
   * Logik:
   * - Wenn nur 1 Output-Device existiert (oder gar keins): kein Headset
   * - Wenn 2+ Devices: vermutlich Headset (eingebauter Lautsprecher + Headset)
   * - Label-Match auf gängige Begriffe für robustere Erkennung
   *
   * Limitationen:
   * - Vor Microphone-Permission sind Labels leer (Privacy)
   * - Manche Browser geben gar nicht alle Output-Devices preis
   *
   * Fallback bei Label-Lookup ohne Erfolg: wir vertrauen der Device-Count.
   */
  const detectHeadset = async () => {
    if (typeof navigator === 'undefined') return;
    if (!navigator.mediaDevices?.enumerateDevices) {
      // Browser unterstützt die API nicht - wir bleiben bei null/unbekannt
      setHasHeadset(null);
      return;
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const outputs = devices.filter(d => d.kind === 'audiooutput');

      if (outputs.length === 0) {
        // Browser/iOS Safari gibt keine Output-Devices preis (Webkit-Limit).
        // Wir können nicht zwischen "kein Headset" und "API nicht verfügbar"
        // unterscheiden. Fallback: null (unbekannt) damit die UI nicht
        // fälschlich "kein Headset" anzeigt.
        setHasHeadset(null);
        setHeadsetName(null);
        return;
      }

      // Label-Heuristik für Headset-Erkennung
      const headsetKeywords = [
        'airpods', 'beats', 'bose', 'sony', 'jabra', 'sennheiser',
        'wh-', 'wf-', 'qc', 'jbl', 'samsung galaxy buds', 'pixel buds',
        'bluetooth', 'wireless', 'headset', 'headphone', 'kopfhörer',
        'casque', 'auricular', 'cuffie',
      ];
      const speakerKeywords = ['lautsprecher', 'speaker', 'iphone', 'macbook', 'built-in', 'default', 'integriert'];

      let detected: { name: string } | null = null;
      let onlyDefault = true;

      for (const dev of outputs) {
        const label = (dev.label || '').toLowerCase();
        const isHeadsetLabel = headsetKeywords.some(kw => label.includes(kw));
        const isSpeakerLabel = speakerKeywords.some(kw => label.includes(kw));

        if (isHeadsetLabel) {
          detected = { name: dev.label };
          break;
        }
        if (!isSpeakerLabel && dev.deviceId !== 'default' && label.length > 0) {
          onlyDefault = false;
          if (!detected) detected = { name: dev.label };
        }
      }

      // Wenn keine Labels (Permission fehlt) aber 2+ Devices: vermutlich Headset
      const haveLabels = outputs.some(d => d.label && d.label.length > 0);
      if (!haveLabels && outputs.length >= 2) {
        setHasHeadset(true);
        setHeadsetName(null);  // Name unbekannt
        return;
      }

      if (detected) {
        setHasHeadset(true);
        setHeadsetName(detected.name);
        return;
      }

      // Nur Default-Output (eingebauter Lautsprecher) - kein Headset
      setHasHeadset(false);
      setHeadsetName(null);
    } catch (err) {
      console.warn('[headset] enumerateDevices failed:', (err as Error).message);
      setHasHeadset(null);
    }
  };

  // Device-Detection einmal beim Mount + bei devicechange-Events.
  // devicechange feuert wenn der User AirPods rein-/raussteckt - dann
  // updaten wir das Badge live.
  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    if (!navigator.mediaDevices) return;

    detectHeadset();

    const handler = () => detectHeadset();
    if (navigator.mediaDevices.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', handler);
      return () => navigator.mediaDevices.removeEventListener('devicechange', handler);
    }
    // Fallback für alte Browser: ondevicechange-Property
    (navigator.mediaDevices as any).ondevicechange = handler;
    return () => { (navigator.mediaDevices as any).ondevicechange = null; };
  }, []);

  // Nach Voice-Session-Ende nochmal detecten - jetzt haben wir vermutlich
  // Mic-Permission und die Device-Labels werden sichtbar.
  useEffect(() => {
    if (voiceState === 'idle') {
      // Kurz warten damit das System die Permission-State aktualisiert hat
      const t = setTimeout(() => detectHeadset(), 800);
      return () => clearTimeout(t);
    }
  }, [voiceState]);

  /**
   * Silent-Loop sicher starten (idempotent).
   *
   * Robustheit-Strategie:
   * 1. Wenn schon spielt: nichts tun, success.
   * 2. play() versuchen. Bei AbortError (kommt häufig wenn pause() vorher
   *    asynchron noch nicht durch ist): kurz warten und nochmal.
   * 3. Bei NotAllowedError (User-Gesture fehlt): kein retry, schlägt fehl.
   * 4. Bei NotSupportedError oder anderen: load() + retry. Hilft auf iOS
   *    wo nach WebRTC-Cleanup das Audio-Element manchmal "verbraucht" ist.
   */
  const startSilentLoop = async (): Promise<boolean> => {
    if (!audioRef.current) return false;
    const audio = audioRef.current;
    if (!audio.paused) return true;

    try {
      try { audio.currentTime = 0; } catch {}
      await audio.play();
      return true;
    } catch (err) {
      const e = err as Error;

      // AbortError: vorheriger pause/play noch in-flight, retry nach 50ms
      if (e.name === 'AbortError') {
        await new Promise(r => setTimeout(r, 50));
        try {
          await audio.play();
          return true;
        } catch { /* fall through to load-retry */ }
      }

      // NotSupportedError oder andere: Element neu laden und nochmal versuchen
      if (e.name !== 'NotAllowedError') {
        try {
          audio.load();
          await new Promise(r => setTimeout(r, 100));
          await audio.play();
          return true;
        } catch (err2) {
          console.warn('[headset] silent loop reload+play failed:', (err2 as Error).message);
        }
      }

      return false;
    }
  };

  /** Silent-Loop pausieren */
  const stopSilentLoop = () => {
    if (!audioRef.current) return;
    try {
      audioRef.current.pause();
    } catch {}
  };

  /** Action-Handler neu setzen. Bei jedem voiceState-Wechsel aufgerufen. */
  const setHandlers = () => {
    if (typeof navigator === 'undefined') return;
    if (!('mediaSession' in navigator)) return;
    try {
      const handler = () => {
        onTapRef.current();
      };
      navigator.mediaSession.setActionHandler('play', handler);
      navigator.mediaSession.setActionHandler('pause', handler);
      try {
        navigator.mediaSession.setActionHandler('stop', handler);
      } catch {}
    } catch (err) {
      setError(`Handler setzen fehlgeschlagen: ${(err as Error).message}`);
    }
  };

  /** Initialisierung - läuft beim ersten User-Tap */
  const activate = () => {
    if (typeof window === 'undefined') return;
    if (!('mediaSession' in navigator)) {
      setError('Media Session API nicht unterstützt');
      return;
    }
    if (isActive) return;
    if (!enabled) return;

    try {
      if (!audioRef.current) {
        const audio = new Audio();
        audio.src = SILENT_AUDIO_URL;
        audio.loop = true;
        audio.volume = 0;
        audio.preload = 'auto';
        audio.setAttribute('playsinline', 'true');
        audioRef.current = audio;
      }

      navigator.mediaSession.metadata = new MediaMetadata({
        title: 'Voice Assistant',
        artist: 'Anni',
      });

      navigator.mediaSession.playbackState = 'paused';
      setHandlers();

      const isVoiceActive = voiceStateRef.current === 'recording' ||
                            voiceStateRef.current === 'responding';
      if (!isVoiceActive) {
        startSilentLoop().then(success => {
          if (success) {
            setIsActive(true);
            setError(null);
          } else {
            setError('Audio konnte nicht gestartet werden');
          }
        });
      } else {
        setIsActive(true);
        setError(null);
      }
    } catch (err) {
      setError(`Aktivierung fehlgeschlagen: ${(err as Error).message}`);
    }
  };

  /** Erst-Aktivierung bei erster User-Interaktion */
  useEffect(() => {
    if (!enabled) return;
    if (isActive) return;

    const tryActivate = () => activate();

    const opts: AddEventListenerOptions = { once: true, passive: true };
    document.addEventListener('pointerdown', tryActivate, opts);
    document.addEventListener('keydown', tryActivate, opts);
    document.addEventListener('touchstart', tryActivate, opts);

    return () => {
      document.removeEventListener('pointerdown', tryActivate);
      document.removeEventListener('keydown', tryActivate);
      document.removeEventListener('touchstart', tryActivate);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, isActive]);

  /**
   * voiceState-Wechsel: kritischer Effect für mehrfache Nutzung.
   *
   * Bei voiceState 'recording'/'responding': WebRTC läuft, Silent-Loop pausieren.
   * Bei voiceState 'idle'/'error': WebRTC ist weg, Silent-Loop muss wieder
   * laufen damit das nächste Headset-Tap erkannt wird.
   *
   * 'connecting' und 'processing' sind Übergangszustände - wir lassen den
   * aktuellen Zustand stehen bis sich's klärt.
   */
  useEffect(() => {
    if (!isActive) return;
    if (typeof window === 'undefined') return;
    if (!('mediaSession' in navigator)) return;

    // playbackState und Handler IMMER neu setzen - iOS verliert sie sonst
    const isVoiceActive = voiceState === 'recording' || voiceState === 'responding';
    navigator.mediaSession.playbackState = isVoiceActive ? 'playing' : 'paused';
    setHandlers();

    if (isVoiceActive) {
      // WebRTC aktiv → Silent-Loop pausieren (sonst zwei Audio-Sessions konkurrieren)
      stopSilentLoop();
      return;
    }

    // voiceState ist 'idle', 'error', 'connecting' oder 'processing'.
    //
    // Bei 'idle' / 'error': wir versuchen Silent-Loop sofort + erneut nach
    // kurzer Verzögerung zu starten. Das umgeht den Race-Condition bei
    // Modus-Wechseln wo voiceState kurz idle→connecting→recording fließt.
    //
    // Bei 'connecting' / 'processing': nichts tun - Übergangszustand.
    if (voiceState === 'idle' || voiceState === 'error') {
      // Sofortiger Versuch
      startSilentLoop();

      // Robustheits-Retry: nach 500ms nochmal probieren. Falls der erste
      // Versuch von einem gerade endenden WebRTC-Stream abgebrochen wurde,
      // klappt der zweite. Falls inzwischen wieder voiceActive: skip.
      const retry = setTimeout(() => {
        if (voiceStateRef.current === 'idle' || voiceStateRef.current === 'error') {
          startSilentLoop();
          // Handler nochmal setzen für den Fall dass iOS sie verloren hat
          setHandlers();
        }
      }, 500);
      return () => clearTimeout(retry);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceState, isActive]);

  /** Bei enabled=false: Cleanup */
  useEffect(() => {
    if (enabled) return;
    if (audioRef.current) {
      try {
        audioRef.current.pause();
        audioRef.current.src = '';
      } catch {}
      audioRef.current = null;
    }
    if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
      try {
        navigator.mediaSession.setActionHandler('play', null);
        navigator.mediaSession.setActionHandler('pause', null);
        try { navigator.mediaSession.setActionHandler('stop', null); } catch {}
      } catch {}
      navigator.mediaSession.playbackState = 'none';
    }
    setIsActive(false);
  }, [enabled]);

  /** Cleanup bei Unmount */
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        try {
          audioRef.current.pause();
          audioRef.current.src = '';
        } catch {}
        audioRef.current = null;
      }
      if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
        try {
          navigator.mediaSession.setActionHandler('play', null);
          navigator.mediaSession.setActionHandler('pause', null);
          try { navigator.mediaSession.setActionHandler('stop', null); } catch {}
        } catch {}
      }
    };
  }, []);

  return { isActive, error, activate, hasHeadset, headsetName };
}
