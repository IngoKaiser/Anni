/**
 * Sprach-Konstanten ohne 'use client' Marker, damit sie sowohl im
 * Server-Code (app/layout.tsx → SSR) als auch im Client-Code
 * (components → React-Hook) importiert werden können.
 *
 * Die React-Komponenten und Hooks selbst bleiben in lib/i18n.tsx
 * (mit 'use client'). Die reinen Daten leben hier.
 */

export type Locale = 'de' | 'en' | 'it' | 'fr' | 'es';

export const SUPPORTED_LOCALES: { code: Locale; label: string; nativeLabel: string; flag: string }[] = [
  { code: 'de', label: 'Deutsch',     nativeLabel: 'Deutsch',     flag: '🇩🇪' },
  { code: 'en', label: 'English',     nativeLabel: 'English',     flag: '🇬🇧' },
  { code: 'it', label: 'Italienisch', nativeLabel: 'Italiano',    flag: '🇮🇹' },
  { code: 'fr', label: 'Französisch', nativeLabel: 'Français',    flag: '🇫🇷' },
  { code: 'es', label: 'Spanisch',    nativeLabel: 'Español',     flag: '🇪🇸' },
];
