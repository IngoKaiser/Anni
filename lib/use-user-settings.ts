'use client';

/**
 * useUserSettings - Persistente User-Präferenzen via localStorage
 *
 * Speichert:
 * - voiceId: gewählte OpenAI-Stimme (nur für echte User relevant)
 * - listenTimeoutSec: wie lange Anni nach einer Antwort weiter zuhört (3-60s)
 *
 * Defaults sind bewusst konservativ: 10s Listening passen zu typischen
 * Pflege-Dialog-Pausen (Bewohner anschauen, kurz nachdenken, weiter sprechen).
 */

import { useEffect, useState, useCallback } from 'react';

const STORAGE_KEY = 'anni-user-settings';

export type VoiceMode = 'realtime' | 'pipeline';

export interface UserSettings {
  voiceId: string | null;          // null = Tenant-Default verwenden
  listenTimeoutSec: number;         // 3-60
  voiceMode: VoiceMode;             // 'realtime' = OpenAI Realtime, 'pipeline' = STT+LLM+TTS
}

const DEFAULT_SETTINGS: UserSettings = {
  voiceId: null,
  listenTimeoutSec: 10,
  voiceMode: 'realtime',
};

export const LISTEN_TIMEOUT_MIN = 3;
export const LISTEN_TIMEOUT_MAX = 60;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function loadSettings(): UserSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    return {
      voiceId: typeof parsed.voiceId === 'string' || parsed.voiceId === null
        ? parsed.voiceId
        : null,
      listenTimeoutSec: typeof parsed.listenTimeoutSec === 'number'
        ? clamp(parsed.listenTimeoutSec, LISTEN_TIMEOUT_MIN, LISTEN_TIMEOUT_MAX)
        : DEFAULT_SETTINGS.listenTimeoutSec,
      voiceMode: parsed.voiceMode === 'pipeline' ? 'pipeline' : 'realtime',
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(s: UserSettings): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignore quota errors */
  }
}

export function useUserSettings() {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    setSettings(loadSettings());
  }, []);

  const update = useCallback((patch: Partial<UserSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...patch };
      // Listen-Timeout auf Bereich klemmen
      if (typeof patch.listenTimeoutSec === 'number') {
        next.listenTimeoutSec = clamp(
          patch.listenTimeoutSec,
          LISTEN_TIMEOUT_MIN,
          LISTEN_TIMEOUT_MAX
        );
      }
      saveSettings(next);
      return next;
    });
  }, []);

  return { settings, update };
}

/**
 * OpenAI-Stimmen, die wir den Usern anbieten.
 *
 * WICHTIG: Hier listen wir NUR Stimmen, die sowohl von der Realtime API
 * als auch von der TTS API (für Stimmen-Proben) unterstützt werden.
 *
 * Realtime API (Stand Mai 2026, gpt-realtime model):
 *   alloy, ash, ballad, coral, echo, sage, shimmer, verse, marin, cedar
 *
 * TTS API (Stand Mai 2026, gpt-4o-mini-tts model):
 *   alloy, ash, ballad, coral, echo, fable, onyx, nova, sage, shimmer, verse, marin, cedar
 *
 * Schnittmenge = was wir hier listen. Falls OpenAI die Listen erweitert,
 * können neue Stimmen hier ergänzt werden - in beiden APIs verifizieren!
 *
 * Beschreibungen sind subjektiv - User können trotzdem alle ausprobieren.
 */
export const OPENAI_VOICES: { id: string; label: string; description: string }[] = [
  { id: 'marin', label: 'Marin', description: 'Empfohlen — natürlich, ausdrucksstark' },
  { id: 'cedar', label: 'Cedar', description: 'Empfohlen — warm, vertrauensvoll' },
  { id: 'alloy', label: 'Alloy', description: 'Neutral, klar' },
  { id: 'ash', label: 'Ash', description: 'Tief, ruhig' },
  { id: 'ballad', label: 'Ballad', description: 'Melodisch, weich' },
  { id: 'coral', label: 'Coral', description: 'Warm, freundlich' },
  { id: 'echo', label: 'Echo', description: 'Männlich, sachlich' },
  { id: 'sage', label: 'Sage', description: 'Bedacht, weise' },
  { id: 'shimmer', label: 'Shimmer', description: 'Warm, sanft' },
  { id: 'verse', label: 'Verse', description: 'Vielseitig, modern' },
];
