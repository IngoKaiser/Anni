'use client';

/**
 * useHeadsetMediaKeys
 *
 * Macht den Tap-zum-Sprechen-Button vom Bluetooth-Headset (oder beliebigen
 * Media-Keys auf der Tastatur) steuerbar.
 *
 * # Wie das technisch funktioniert
 *
 * Die Media Session API (navigator.mediaSession) lässt eine Web-App auf
 * Media-Key-Events reagieren — aber NUR wenn der Browser eine aktive
 * Audio-Quelle für diese Seite registriert hat. Ohne aktive Quelle sind
 * die Handler taub.
 *
 * Trick: wir spielen eine STILLE Audio-Datei in Endlosschleife ab. Der
 * Browser registriert das als aktive Audio-Quelle und routet die
 * Media-Tasten an unsere Handler.
 *
 * # iOS Safari Quirks
 *
 * - Audio muss durch User-Geste gestartet werden (kein Autoplay). Wir
 *   warten auf den ersten Tap irgendwo in der App und starten dann.
 * - Audio darf nicht "1ms" lang sein - manche Browser ignorieren das.
 *   Wir nehmen 1 Sekunde Stille in einer Loop.
 * - Manchmal greift der erste Play-Befehl nicht. Wir handhaben das
 *   indem wir bei Bedarf einen erneuten Versuch unternehmen.
 *
 * # Logik der Tasten
 *
 * Das Headset sendet bei einem Klick auf die Mitteltaste einen
 * "joint command for play and pause". Der UA-Spec zufolge ruft das je
 * nach playbackState entweder den play- oder den pause-Handler auf.
 * Wir registrieren BEIDE und mappen beide auf onTap - so dass der User
 * mit einem Klick togglen kann (analog zum Tap-Button).
 */

import { useEffect, useRef, useState } from 'react';

interface UseHeadsetOptions {
  /** Wird aufgerufen wenn der User den Media-Key drückt (Headset oder Tastatur) */
  onTap: () => void;
  /** Aktueller Voice-State - wir leiten daraus den playbackState ab */
  voiceState: 'idle' | 'connecting' | 'recording' | 'processing' | 'responding' | 'error';
  /** Feature-Flag: User kann das in Settings ausschalten */
  enabled?: boolean;
}

interface UseHeadsetResult {
  /** True wenn Headset-Steuerung aktiv ist (Audio läuft, Handler registriert) */
  isActive: boolean;
  /** Falls die Aktivierung fehlgeschlagen ist: Fehler-Beschreibung */
  error: string | null;
  /** Manuelle Aktivierung - wird normalerweise automatisch bei erster Interaktion getriggert */
  activate: () => void;
}

// Silent-WAV (1 Sekunde Stille, 8 kHz, 8-bit PCM, ~8 KB) liegt als
// public/silent.wav im Repo. Das wird vom Browser zuverlässig dekodiert.
// Eine Data-URL hatten wir auch versucht aber WAV-Header korrekt in einer
// Data-URL hinzubekommen ist fragil - File ist robuster.
const SILENT_AUDIO_URL = '/silent.wav';

export function useHeadsetMediaKeys(opts: UseHeadsetOptions): UseHeadsetResult {
  const { onTap, voiceState, enabled = true } = opts;

  const [isActive, setIsActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Audio-Element für den Silent-Loop
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // onTap als ref, damit useEffects nicht bei jeder onTap-Änderung re-laufen
  const onTapRef = useRef(onTap);
  useEffect(() => { onTapRef.current = onTap; }, [onTap]);

  /**
   * Initialisiert den Silent-Audio-Loop und die MediaSession-Handler.
   * Idempotent - mehrfaches Aufrufen schadet nicht.
   */
  const activate = () => {
    if (typeof window === 'undefined') return;
    if (!('mediaSession' in navigator)) {
      setError('Media Session API not supported');
      return;
    }
    if (isActive) return;
    if (!enabled) return;

    try {
      // Audio-Element erstellen falls noch nicht da
      if (!audioRef.current) {
        const audio = new Audio();
        audio.src = SILENT_AUDIO_URL;
        audio.loop = true;
        audio.volume = 0; // Doppelt sicher - Silent-Data + volume=0
        // playsinline ist auf iOS wichtig, sonst öffnet sich der Vollbild-Player
        audio.setAttribute('playsinline', 'true');
        audioRef.current = audio;
      }

      // Audio starten. play() returnt eine Promise die rejecten kann
      // (z.B. wenn kein User-Gesture vorausging).
      const playPromise = audioRef.current.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch((err: Error) => {
          // Bei AbortError ignorieren (passiert beim schnellen Toggle)
          if (err.name === 'NotAllowedError') {
            setError('User-Geste nötig - Headset-Steuerung wird beim ersten Tap aktiv');
          } else if (err.name !== 'AbortError') {
            setError(`Audio play failed: ${err.message}`);
          }
        });
      }

      // Metadata setzen - hilft manchen Browsern die Session korrekt zu
      // identifizieren. Wir nutzen App-Branding statt Track-Info.
      navigator.mediaSession.metadata = new MediaMetadata({
        title: 'Voice Assistant',
        artist: 'Anni',
      });

      // Handler für Play und Pause. Joint command vom Headset löst je nach
      // playbackState einen der beiden aus - beide rufen onTap.
      // Wir wrappen in try/catch weil setActionHandler auf manchen
      // älteren Browsern werfen kann.
      const handler = () => {
        onTapRef.current();
      };

      try {
        navigator.mediaSession.setActionHandler('play', handler);
        navigator.mediaSession.setActionHandler('pause', handler);
      } catch (err) {
        setError(`Handler registration failed: ${(err as Error).message}`);
        return;
      }

      // playbackState initial setzen
      navigator.mediaSession.playbackState = 'paused';
      setIsActive(true);
      setError(null);
    } catch (err) {
      setError(`Activation failed: ${(err as Error).message}`);
    }
  };

  /**
   * Bei erster User-Interaktion automatisch aktivieren.
   * Browser-Restriktion: Audio darf erst nach einer Geste laufen.
   */
  useEffect(() => {
    if (!enabled) return;
    if (isActive) return;

    const tryActivate = () => {
      activate();
    };

    // Auf alle möglichen Geste-Events hören (defensive Mehrfach-Listener).
    // 'once' sorgt dafür dass jeder Listener nach dem ersten Trigger
    // automatisch entfernt wird.
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
   * playbackState an Voice-State syncen, damit das Headset richtig toggled:
   * - Recording / Responding → 'playing' (Pause-Taste sendet pause-Action)
   * - Sonst → 'paused' (Play-Taste sendet play-Action)
   *
   * Beide Actions laufen bei uns auf denselben Handler, das ist nur für
   * korrekte Toggle-Semantik wichtig.
   */
  useEffect(() => {
    if (!isActive) return;
    if (typeof window === 'undefined') return;
    if (!('mediaSession' in navigator)) return;

    const isVoiceActive = voiceState === 'recording' || voiceState === 'responding';
    navigator.mediaSession.playbackState = isVoiceActive ? 'playing' : 'paused';
  }, [voiceState, isActive]);

  /**
   * Bei enabled=false: Cleanup.
   */
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
      } catch {}
      navigator.mediaSession.playbackState = 'none';
    }
    setIsActive(false);
  }, [enabled]);

  /**
   * Cleanup bei Unmount.
   */
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
        } catch {}
      }
    };
  }, []);

  return { isActive, error, activate };
}
