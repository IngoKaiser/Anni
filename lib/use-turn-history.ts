'use client';

/**
 * useTurnHistory - persistente Chat-Historie in localStorage.
 *
 * Speichert Turns (User-Aussagen + Assistant-Antworten + Tool-Karten +
 * Wissens-Karten) pro User und Modus separat. Beim Reload werden sie
 * automatisch wiederhergestellt.
 *
 * # Speicher-Struktur
 *
 * Schlüssel: `anni:turns:${userEmail}:${mode}`
 *   - mode: 'standard' oder 'translator'
 *
 * Wert: JSON-Array der Turns (mit allen Metadaten)
 *
 * Limit: 200 Turns pro Modus. Ältere werden FIFO abgeschnitten damit
 * localStorage nicht überläuft (Quota 5-10 MB je Browser).
 *
 * # Wichtig zur Persistenz
 *
 * Tool-Confirmation-Cards mit 'pending' Status werden NICHT persistiert
 * (würde nach Reload zu Geister-Cards führen die niemand mehr bestätigen
 * kann). Wir filtern beim Speichern.
 *
 * Knowledge-Cards mit '__loading__' werden auch nicht persistiert -
 * sie waren mitten in einer Abfrage als der User reloaded hat.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

// Generischer Turn-Typ - wir importieren ihn nicht von VoiceApp um
// zirkuläre Imports zu vermeiden. Stattdessen typen wir unstrukturiert
// und vertrauen dem Caller dass er Turn-Objekte reingibt.
type AnyTurn = {
  id: number;
  role: string;
  text: string;
  timestamp: number;
  toolCalls?: any[];
  sourceLang?: string;
  translation?: string;
  toolConfirmation?: { status: string; [k: string]: any };
  knowledge?: { answer: string; [k: string]: any };
};

const MAX_TURNS_PER_MODE = 200;

function storageKey(userEmail: string, mode: 'standard' | 'translator'): string {
  // Email kann Sonderzeichen haben - kein Encoding nötig da localStorage-Keys
  // alle Strings akzeptieren.
  return `anni:turns:${userEmail}:${mode}`;
}

/**
 * Filtert flüchtige Turns die nicht persistiert werden sollen.
 * Diese würden nach Reload "tot" sein.
 */
function isPersistable(turn: AnyTurn): boolean {
  // Pending Tool-Confirmation: User hat noch nicht bestätigt/abgelehnt.
  // Nach Reload kann er nicht mehr - also weglassen.
  if (turn.toolConfirmation?.status === 'pending') return false;
  // Loading Knowledge-Card: war mitten in API-Call. Nach Reload tot.
  if (turn.knowledge?.answer === '__loading__') return false;
  return true;
}

interface UseTurnHistoryResult {
  turns: AnyTurn[];
  setTurns: React.Dispatch<React.SetStateAction<AnyTurn[]>>;
  clearTurns: () => void;
  isLoaded: boolean;
}

export function useTurnHistory(
  userEmail: string | null | undefined,
  mode: 'standard' | 'translator'
): UseTurnHistoryResult {
  const [turns, setTurnsState] = useState<AnyTurn[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  // Aktueller Key (kann sich ändern wenn User/Mode wechselt)
  const currentKeyRef = useRef<string | null>(null);

  /** Aus localStorage laden */
  useEffect(() => {
    if (!userEmail) {
      setTurnsState([]);
      setIsLoaded(true);
      return;
    }
    const key = storageKey(userEmail, mode);
    currentKeyRef.current = key;

    try {
      const raw = window.localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          // Defensiv: nur Objekte mit Mindest-Feldern akzeptieren
          const valid = parsed.filter(t =>
            t && typeof t === 'object' &&
            typeof t.id === 'number' &&
            typeof t.role === 'string' &&
            typeof t.timestamp === 'number'
          );
          setTurnsState(valid);
        } else {
          setTurnsState([]);
        }
      } else {
        setTurnsState([]);
      }
    } catch (err) {
      console.warn('[turn-history] load failed:', err);
      setTurnsState([]);
    }
    setIsLoaded(true);
  }, [userEmail, mode]);

  /** Bei jeder Turn-Änderung: persistieren (mit Throttling) */
  useEffect(() => {
    if (!userEmail || !isLoaded) return;
    const key = currentKeyRef.current;
    if (!key) return;

    // Throttle: 500ms warten dann speichern. Verhindert dass wir bei jedem
    // einzelnen Streaming-Delta in localStorage schreiben (wäre teuer).
    const timer = setTimeout(() => {
      try {
        const persistable = turns.filter(isPersistable);
        // FIFO-Cap
        const capped = persistable.length > MAX_TURNS_PER_MODE
          ? persistable.slice(-MAX_TURNS_PER_MODE)
          : persistable;
        window.localStorage.setItem(key, JSON.stringify(capped));
      } catch (err) {
        // Quota überschritten? Versuchen mit halbierter Menge nochmal
        try {
          const half = turns.filter(isPersistable).slice(-Math.floor(MAX_TURNS_PER_MODE / 2));
          window.localStorage.setItem(key, JSON.stringify(half));
        } catch {
          console.warn('[turn-history] save failed:', err);
        }
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [turns, userEmail, isLoaded]);

  /** Setter mit gleicher API wie useState */
  const setTurns: React.Dispatch<React.SetStateAction<AnyTurn[]>> = useCallback((value) => {
    setTurnsState(value);
  }, []);

  /** Historie komplett löschen */
  const clearTurns = useCallback(() => {
    setTurnsState([]);
    if (userEmail) {
      const key = storageKey(userEmail, mode);
      try {
        window.localStorage.removeItem(key);
      } catch {}
    }
  }, [userEmail, mode]);

  return { turns, setTurns, clearTurns, isLoaded };
}
