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
  isActive: boolean;
  error: string | null;
  activate: () => void;
}

const SILENT_AUDIO_URL = '/silent.wav';

export function useHeadsetMediaKeys(opts: UseHeadsetOptions): UseHeadsetResult {
  const { onTap, voiceState, enabled = true } = opts;

  const [isActive, setIsActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const onTapRef = useRef(onTap);
  const voiceStateRef = useRef(voiceState);
  useEffect(() => { onTapRef.current = onTap; }, [onTap]);
  useEffect(() => { voiceStateRef.current = voiceState; }, [voiceState]);

  /** Silent-Loop sicher starten (idempotent) */
  const startSilentLoop = async (): Promise<boolean> => {
    if (!audioRef.current) return false;
    try {
      if (audioRef.current.paused) {
        try { audioRef.current.currentTime = 0; } catch {}
        await audioRef.current.play();
      }
      return true;
    } catch (err) {
      const e = err as Error;
      if (e.name !== 'AbortError' && e.name !== 'NotAllowedError') {
        console.warn('[headset] silent loop play failed:', e.message);
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
   */
  useEffect(() => {
    if (!isActive) return;
    if (typeof window === 'undefined') return;
    if (!('mediaSession' in navigator)) return;

    const isVoiceActive = voiceState === 'recording' || voiceState === 'responding';

    navigator.mediaSession.playbackState = isVoiceActive ? 'playing' : 'paused';
    setHandlers();

    if (isVoiceActive) {
      stopSilentLoop();
    } else {
      const timer = setTimeout(() => {
        if (voiceStateRef.current !== 'recording' &&
            voiceStateRef.current !== 'responding') {
          startSilentLoop();
        }
      }, 300);
      return () => clearTimeout(timer);
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

  return { isActive, error, activate };
}
