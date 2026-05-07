'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * useSpeechSynthesis - iOS-taugliches Wrapper um die Web Speech API.
 *
 * Probleme die dieser Hook löst:
 *
 * 1. iOS-User-Interaction-Lock: speechSynthesis.speak() funktioniert nur
 *    direkt aus einem Touch-Event. Wir nutzen einen "warm-up" beim ersten
 *    Tap, der die Engine entsperrt. Danach funktionieren weitere speak()-
 *    Aufrufe auch aus Timeouts heraus.
 *
 * 2. Voice-List-Race: getVoices() liefert beim ersten Aufruf eine leere
 *    Liste. Wir warten auf das voiceschanged Event und reagieren reaktiv.
 *
 * 3. iOS Resume-Bug: nach längeren Pausen pausiert die Engine sich selbst.
 *    Wir rufen periodisch resume() auf während gesprochen wird.
 *
 * 4. Robustes cancel(): wir warten kurz nach cancel() bevor wir das nächste
 *    speak() schicken, sonst geht das auf iOS schief.
 */

export interface VoiceOption {
  id: string;          // einzigartiger Identifier (Name + Lang)
  name: string;        // Anzeigename, z.B. "Anna"
  lang: string;        // BCP-47 Code, z.B. "de-DE"
  langLabel: string;   // Menschlich lesbar, "Deutsch (Deutschland)"
  isDefault: boolean;
  isLocal: boolean;    // true = on-device, false = remote (Google etc)
  voice: SpeechSynthesisVoice;
}

export interface UseSpeechSynthesisOptions {
  preferredLang?: string;     // z.B. 'de-DE'
}

export interface UseSpeechSynthesisReturn {
  isSupported: boolean;
  isUnlocked: boolean;        // true nach erstem User-Interaction-speak()
  isSpeaking: boolean;
  voices: VoiceOption[];      // gefiltert nach preferredLang wenn gesetzt
  allVoices: VoiceOption[];   // alle verfügbaren
  selectedVoiceId: string | null;
  selectVoice: (id: string | null) => void;  // null = System-Default
  speak: (text: string, opts?: { rate?: number; pitch?: number; volume?: number }) => void;
  cancel: () => void;
  primeForUserInteraction: () => void;  // muss aus Touch-Handler aufgerufen werden
}

const STORAGE_KEY = 'anni-selected-voice';

function langLabel(lang: string): string {
  try {
    const parts = lang.split('-');
    const lc = parts[0]?.toLowerCase();
    const cc = parts[1]?.toUpperCase();
    const langs: Record<string, string> = {
      de: 'Deutsch', en: 'English', fr: 'Français', es: 'Español',
      it: 'Italiano', nl: 'Nederlands', pt: 'Português', tr: 'Türkçe',
      pl: 'Polski', ru: 'Русский',
    };
    const countries: Record<string, string> = {
      DE: 'Deutschland', AT: 'Österreich', CH: 'Schweiz',
      US: 'USA', GB: 'UK', IE: 'Irland', AU: 'Australien',
    };
    const langName = langs[lc] || lang;
    const cName = countries[cc];
    return cName ? `${langName} (${cName})` : langName;
  } catch {
    return lang;
  }
}

function toVoiceOption(v: SpeechSynthesisVoice): VoiceOption {
  return {
    id: `${v.name}|${v.lang}`,
    name: v.name,
    lang: v.lang,
    langLabel: langLabel(v.lang),
    isDefault: v.default,
    isLocal: v.localService,
    voice: v,
  };
}

export function useSpeechSynthesis(opts: UseSpeechSynthesisOptions = {}): UseSpeechSynthesisReturn {
  const { preferredLang } = opts;

  const [isSupported, setIsSupported] = useState(false);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [allVoices, setAllVoices] = useState<VoiceOption[]>([]);
  const [selectedVoiceId, setSelectedVoiceIdInternal] = useState<string | null>(null);

  const resumeIntervalRef = useRef<number | null>(null);
  const currentUtterRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Init: Support-Check, Voices laden, gespeicherte Voice wiederherstellen
  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      setIsSupported(false);
      return;
    }
    setIsSupported(true);

    const loadVoices = () => {
      const list = window.speechSynthesis.getVoices().map(toVoiceOption);
      setAllVoices(list);
    };

    loadVoices();
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices);

    // Gespeicherte Voice-Wahl laden
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) setSelectedVoiceIdInternal(saved);
    } catch {}

    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', loadVoices);
      if (resumeIntervalRef.current) {
        window.clearInterval(resumeIntervalRef.current);
      }
    };
  }, []);

  const selectVoice = useCallback((id: string | null) => {
    setSelectedVoiceIdInternal(id);
    try {
      if (id) window.localStorage.setItem(STORAGE_KEY, id);
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }, []);

  /**
   * iOS Workaround: Beim ersten Tap rufen wir einen leeren speak()-Befehl auf,
   * um die Engine zu entsperren. Ab da darf speak() auch aus Timeouts kommen.
   */
  const primeForUserInteraction = useCallback(() => {
    if (!isSupported || isUnlocked) return;
    try {
      // Leere/sehr kurze Utterance um Engine zu wecken
      const primer = new SpeechSynthesisUtterance(' ');
      primer.volume = 0;
      primer.rate = 10;
      window.speechSynthesis.speak(primer);
      setIsUnlocked(true);
    } catch (err) {
      // ignorieren - speak() schlägt später nochmal fehl wenn nötig
      console.warn('[speech] prime failed', err);
    }
  }, [isSupported, isUnlocked]);

  const cancel = useCallback(() => {
    if (!isSupported) return;
    try {
      window.speechSynthesis.cancel();
    } catch {}
    if (resumeIntervalRef.current) {
      window.clearInterval(resumeIntervalRef.current);
      resumeIntervalRef.current = null;
    }
    setIsSpeaking(false);
    currentUtterRef.current = null;
  }, [isSupported]);

  const speak = useCallback(
    (text: string, sopts: { rate?: number; pitch?: number; volume?: number } = {}) => {
      if (!isSupported || !text.trim()) return;

      // iOS hasst speak() direkt nach cancel(). Cancel + kurze Pause + speak.
      try {
        window.speechSynthesis.cancel();
      } catch {}

      const launch = () => {
        const utter = new SpeechSynthesisUtterance(text);

        // Voice auswählen
        let chosen: SpeechSynthesisVoice | null = null;
        if (selectedVoiceId) {
          const found = allVoices.find(v => v.id === selectedVoiceId);
          if (found) chosen = found.voice;
        }
        if (!chosen && preferredLang) {
          const langMatch = allVoices.find(v => v.lang === preferredLang);
          if (langMatch) chosen = langMatch.voice;
        }
        if (chosen) {
          utter.voice = chosen;
          utter.lang = chosen.lang;
        } else if (preferredLang) {
          utter.lang = preferredLang;
        }

        utter.rate = sopts.rate ?? 1.0;
        utter.pitch = sopts.pitch ?? 1.0;
        utter.volume = sopts.volume ?? 1.0;

        utter.onstart = () => {
          setIsSpeaking(true);
          // iOS Resume-Workaround: alle 5s resume() aufrufen während gesprochen
          if (resumeIntervalRef.current) window.clearInterval(resumeIntervalRef.current);
          resumeIntervalRef.current = window.setInterval(() => {
            try {
              if (window.speechSynthesis.speaking && window.speechSynthesis.paused) {
                window.speechSynthesis.resume();
              }
            } catch {}
          }, 5000);
        };

        utter.onend = () => {
          setIsSpeaking(false);
          if (resumeIntervalRef.current) {
            window.clearInterval(resumeIntervalRef.current);
            resumeIntervalRef.current = null;
          }
          currentUtterRef.current = null;
        };

        utter.onerror = (e) => {
          // 'interrupted' ist normal wenn cancel() aufgerufen wurde
          if (e.error !== 'interrupted' && e.error !== 'canceled') {
            console.warn('[speech] error:', e.error);
          }
          setIsSpeaking(false);
          if (resumeIntervalRef.current) {
            window.clearInterval(resumeIntervalRef.current);
            resumeIntervalRef.current = null;
          }
          currentUtterRef.current = null;
        };

        currentUtterRef.current = utter;
        try {
          window.speechSynthesis.speak(utter);
        } catch (err) {
          console.warn('[speech] speak failed:', err);
        }
      };

      // 50ms Pause nach cancel - genug für iOS, unmerkbar für Mensch
      window.setTimeout(launch, 50);
    },
    [isSupported, selectedVoiceId, allVoices, preferredLang]
  );

  // Voice-Filter: wenn preferredLang gesetzt, nur passende Stimmen anzeigen
  const voices = preferredLang
    ? allVoices.filter(v => v.lang.toLowerCase().startsWith(preferredLang.split('-')[0].toLowerCase()))
    : allVoices;

  return {
    isSupported,
    isUnlocked,
    isSpeaking,
    voices,
    allVoices,
    selectedVoiceId,
    selectVoice,
    speak,
    cancel,
    primeForUserInteraction,
  };
}
