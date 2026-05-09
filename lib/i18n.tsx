'use client';

/**
 * i18n - Internationalization
 *
 * Eigene leichtgewichtige Lösung statt next-intl/i18next, weil:
 * - Pro Sprache nur ~150 Strings, kein Plural- oder Datums-Formatting nötig
 * - Wir brauchen kein Locale-Routing (URLs bleiben sprachunabhängig)
 * - Locale-Wechsel zur Laufzeit ohne Page-Reload
 *
 * Wie Sprachen ergänzt werden:
 * 1. Code in SUPPORTED_LOCALES eintragen
 * 2. Dictionary unter TRANSLATIONS hinzufügen
 * 3. Voice-Sample-Text in VOICE_PREVIEW_TEXTS dazu
 *
 * Browser-Detection:
 * - navigator.languages (geordnete Liste der User-Präferenzen)
 * - Erste Sprache aus Liste, die wir unterstützen, gewinnt
 * - Wenn keine Übereinstimmung: 'en' als Fallback (international)
 *
 * Persistenz:
 * - Manuelle Auswahl wird in localStorage gespeichert (Schlüssel: 'anni-locale')
 * - Manuelle Auswahl überschreibt Browser-Detection für immer
 */

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';

export type Locale = 'de' | 'en' | 'it' | 'fr' | 'es';

export const SUPPORTED_LOCALES: { code: Locale; label: string; nativeLabel: string; flag: string }[] = [
  { code: 'de', label: 'Deutsch',     nativeLabel: 'Deutsch',     flag: '🇩🇪' },
  { code: 'en', label: 'English',     nativeLabel: 'English',     flag: '🇬🇧' },
  { code: 'it', label: 'Italienisch', nativeLabel: 'Italiano',    flag: '🇮🇹' },
  { code: 'fr', label: 'Französisch', nativeLabel: 'Français',    flag: '🇫🇷' },
  { code: 'es', label: 'Spanisch',    nativeLabel: 'Español',     flag: '🇪🇸' },
];

const STORAGE_KEY = 'anni-locale';
const DEFAULT_LOCALE: Locale = 'en';

/**
 * Erkennt die bevorzugte Sprache aus dem Browser.
 * Priorität:
 *   1. localStorage (User hat manuell gewählt)
 *   2. navigator.languages → erstes Match mit unterstützten Sprachen
 *   3. navigator.language → Match
 *   4. 'en' als internationaler Fallback
 *
 * Wir vergleichen nur den Sprach-Anteil (vor dem Bindestrich), also
 * "de-AT" und "de-CH" matchen beide auf "de".
 */
export function detectInitialLocale(): Locale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;

  // 1. User-Wahl
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && SUPPORTED_LOCALES.some(l => l.code === stored)) {
      return stored as Locale;
    }
  } catch {}

  const supportedCodes = SUPPORTED_LOCALES.map(l => l.code);

  // 2. navigator.languages durchgehen
  if (Array.isArray(navigator.languages)) {
    for (const browserLang of navigator.languages) {
      const primary = browserLang.split('-')[0].toLowerCase();
      if (supportedCodes.includes(primary as Locale)) {
        return primary as Locale;
      }
    }
  }

  // 3. navigator.language Fallback
  if (navigator.language) {
    const primary = navigator.language.split('-')[0].toLowerCase();
    if (supportedCodes.includes(primary as Locale)) {
      return primary as Locale;
    }
  }

  return DEFAULT_LOCALE;
}

/**
 * Voice-Sample-Texte für die Stimm-Probe in den Settings.
 * Pro App-Sprache ein passender Beispielsatz mit dynamischem Agent-Namen.
 */
export function buildVoicePreviewText(locale: Locale, agentName: string): string {
  const templates: Record<Locale, (n: string) => string> = {
    de: (n) => `Hallo, ich bin ${n}. So klinge ich.`,
    en: (n) => `Hello, I'm ${n}. This is how I sound.`,
    it: (n) => `Ciao, sono ${n}. Ecco come suono.`,
    fr: (n) => `Bonjour, je suis ${n}. Voilà ma voix.`,
    es: (n) => `Hola, soy ${n}. Así suena mi voz.`,
  };
  const builder = templates[locale] || templates.en;
  return builder(agentName);
}

/**
 * @deprecated - nutze buildVoicePreviewText(locale, agentName) stattdessen.
 * Bleibt nur als Fallback für Code der noch nicht migriert ist.
 */
export const VOICE_PREVIEW_TEXTS: Record<Locale, string> = {
  de: 'Hallo, ich bin Anni. So klinge ich.',
  en: "Hello, I'm Anni. This is how I sound.",
  it: 'Ciao, sono Anni. Ecco come suono.',
  fr: 'Bonjour, je suis Anni. Voilà ma voix.',
  es: 'Hola, soy Anni. Así suena mi voz.',
};

/**
 * Sprach-Anweisung für TTS / Realtime API. Wird als 'instructions'
 * an OpenAI mitgegeben, damit deutsche Stimmen nicht englisch akzentuiert
 * klingen.
 */
export const VOICE_INSTRUCTIONS: Record<Locale, string> = {
  de: 'Sprich auf Deutsch mit natürlicher, klarer Aussprache. Freundlicher, professioneller Ton einer Pflege-Assistentin.',
  en: 'Speak in clear English with a natural, friendly tone. Warm and professional, like a care assistant.',
  it: 'Parla in italiano con pronuncia chiara e naturale. Tono amichevole e professionale di una assistente di cura.',
  fr: 'Parle en français avec une prononciation claire et naturelle. Ton amical et professionnel d\'une assistante de soins.',
  es: 'Habla en español con pronunciación clara y natural. Tono amable y profesional de una asistente de cuidados.',
};

type Dictionary = Record<string, string>;

export const TRANSLATIONS: Record<Locale, Dictionary> = {
  de: {
    // Login
    'login.title': 'Anmelden',
    'login.subtitle.magicLink': 'Wir schicken dir einen Anmelde-Link per Email.',
    'login.subtitle.noMagicLink': 'Email-Login ist auf diesem System nicht konfiguriert.',
    'login.email.label': 'Deine Email',
    'login.email.placeholder': 'name@deine-einrichtung.de',
    'login.button.send': 'Anmelde-Link erhalten',
    'login.button.sending': 'Sende…',
    'login.divider': 'oder',
    'login.demo.button': 'Demo-Schnellzugang',
    'login.tagline': 'Deine persönliche Assistentin',
    'login.tenants.title': 'Diese Einrichtungen sind freigeschaltet:',

    'login.error.title': 'Anmeldung fehlgeschlagen',
    'login.error.retry': 'Erneut versuchen',
    'login.error.invalidEmail': 'Bitte gültige Email-Adresse eingeben',
    'login.error.unknownDomain.withDemo': 'Diese Email-Domain ist noch nicht freigeschaltet. Probiere eine Demo-Anmeldung unten.',
    'login.error.unknownDomain.noDemo': 'Diese Email-Domain ist noch nicht freigeschaltet. Bitte wende dich an den Support.',
    'login.error.notConfigured': 'Email-Login ist auf diesem System nicht konfiguriert.',
    'login.error.email': 'Die Email konnte nicht versendet werden. Häufige Ursachen: Resend-API-Key ist ungültig, oder die Absender-Domain ist nicht in Resend verifiziert. Bitte erneut versuchen oder den Administrator kontaktieren.',
    'login.error.verification': 'Der Anmelde-Link ist abgelaufen oder ungültig. Bitte einen neuen Link anfordern.',
    'login.error.accessDenied': 'Diese Email-Domain ist nicht für {name} freigeschaltet. Bitte den Administrator kontaktieren.',
    'login.error.configuration': 'Der Server ist nicht korrekt konfiguriert. Bitte den Administrator kontaktieren.',
    'login.error.callback': 'Beim Verarbeiten des Anmelde-Links ist ein Fehler aufgetreten. Bitte erneut versuchen.',
    'login.error.unknown': 'Anmeldung fehlgeschlagen. Bitte erneut versuchen.',

    // Verify
    'verify.title': 'Email gesendet',
    'verify.subtitle': 'Wir haben dir einen Anmelde-Link geschickt.',
    'verify.body': 'Öffne deine Email und klicke auf den Link, um dich anzumelden. Der Link ist 24 Stunden gültig.',
    'verify.help.title': 'Keine Email erhalten?',
    'verify.help.spam': 'Spam-Ordner prüfen',
    'verify.help.typo': 'Email-Adresse korrekt geschrieben?',
    'verify.help.delay': 'Bis zu 1 Minute Verzögerung möglich',
    'verify.back': '← Andere Email verwenden oder erneut senden',

    // App-Header / Status
    'app.tools.available': 'Tools verfügbar',
    'app.demo_badge': 'DEMO',
    'app.error': 'Fehler',
    'settings.agentName.title': 'Name des Assistenten',
    'settings.agentName.desc': 'Wie soll dein persönlicher Voice-Assistent heißen? Dieser Name wird als Aktivierungswort genutzt — nur "{name}, ..." löst Aktionen aus.',
    'settings.agentName.hint': 'Sag z.B.: "{name}, Übersetzung starten" oder "{name}, Vitalwerte erfassen".',
    'settings.agentName.invalid': 'Nur Buchstaben, Leerzeichen, Bindestriche. Max. 30 Zeichen.',
    'common.save': 'Speichern',
    'app.status.standardMode': 'Standard-Modus',
    'app.status.standardModeDesc': 'KI wählt automatisch passendes Tool',

    // Push-to-Talk Button
    'ptt.idle.demo': 'Tippen für Demo-Beispiel',
    'ptt.idle.real': 'Tippen zum Sprechen',
    'ptt.connecting': 'Verbinde…',
    'ptt.recording.demo': 'Demo läuft…',
    'ptt.recording.real': 'Höre zu — sprich los',
    'ptt.processing': 'Verarbeite…',
    'ptt.responding.demo': 'Antwortet…',
    'ptt.responding.real': 'Antwortet — tippen unterbricht',
    'ptt.error': 'Fehler · neu versuchen',
    'ptt.hint': 'AirPods · Headset · Spacebar',

    // Empty State
    'empty.demoHint': '💡 Demo-Modus: Beispiel-Dialoge werden simuliert',
    'empty.tapHint': 'Tippe den Button und sprich. Ich finde das richtige Tool.',

    // Turn-Card
    'turn.you': 'Du',
    'turn.assistant': 'Assistent',

    // Settings-Modal
    'settings.title': 'Einstellungen',
    'settings.account': 'Angemeldet als',
    'settings.demoActive': 'Demo-Modus aktiv',
    'settings.tenant': 'Einrichtung',
    'settings.tools': 'Verfügbare Tools',
    'settings.privacy': 'Datenschutz',
    'settings.privacy.hosting': 'Hosting',
    'settings.privacy.audit': 'Audit-Aufbewahrung',
    'settings.privacy.region': '{region}-Region',
    'settings.privacy.days': '{days} Tage',
    'settings.logout': 'Abmelden',
    'settings.id': 'ID',
    'settings.emailDomains': 'Email-Domains',

    // Settings - Sprache
    'settings.appLanguage': 'App-Sprache',
    'settings.appLanguageDesc': 'Sprache der Oberfläche und Sprachausgabe von {name}',
    'settings.appLanguageHint': 'Wirkt sofort. {name} spricht ab der nächsten Session in der gewählten Sprache.',

    // Settings - Stimme (echte User)
    'settings.voice.title': 'Stimme von {name}',
    'settings.voice.desc': 'Tippe eine Stimme an, um sie sofort zu hören. Auswahl wirkt ab der nächsten Session.',
    'settings.voice.tenantDefault': 'Standard für {tenant}',
    'settings.voice.active': 'aktiv',
    'settings.voice.preview': 'Probe hören',

    // Settings - Demo-Stimme
    'settings.demoVoice.title': 'Stimme der Sprachausgabe',
    'settings.demoVoice.desc': 'Wähle eine Stimme. Tippe auf eine Option, um sie sofort zu hören.',

    // Settings - VAD
    'settings.vad.title': 'Empfindlichkeit Spracherkennung',
    'settings.vad.desc': 'Wie empfindlich {name} auf Geräusche reagiert. Bei häufigen Falschauslösungen durch Hintergrundgeräusche auf "Niedrig" stellen.',
    'settings.vad.high.label': 'Hoch',
    'settings.vad.high.desc': 'Reagiert schnell, hört auch leise Stimmen',
    'settings.vad.high.hint': 'Bei ruhiger Umgebung',
    'settings.vad.normal.label': 'Normal',
    'settings.vad.normal.desc': 'Empfohlen für die meisten Situationen',
    'settings.vad.normal.hint': 'Standard',
    'settings.vad.low.label': 'Niedrig',
    'settings.vad.low.desc': 'Nur deutliche Sprache, ignoriert Hintergrundgeräusche',
    'settings.vad.low.hint': 'Bei lauter Umgebung',
    'settings.vad.hint': 'Hinweis: Wirkt erst ab der nächsten Session.',

    // Settings - Lausch-Timeout
    'settings.timeout.title': 'Lausch-Zeit nach Antwort',
    'settings.timeout.desc': 'Wie lange {name} nach einer Antwort weiter zuhört, bevor die Session endet. Du kannst in dieser Zeit einfach weiter reden — {name} antwortet im Dialog.',
    'settings.timeout.current': 'Aktuell',
    'settings.timeout.seconds': 'Sek.',
    'settings.timeout.costHint': 'Hinweis: längere Lausch-Zeiten erhöhen die OpenAI-Kosten leicht.',

    // Translator-Modus
    'translator.banner': 'Übersetzungsmodus',
    'translator.activeLabel': 'AKTIV',
    'translator.statusActive': 'Übersetzung aktiv: {source} ↔ {target}',
    'translator.bannerSub': '{name} dolmetscht zwischen {source} und {target}',
    'translator.askLanguage': 'In welche Sprache soll übersetzt werden?',
    'translator.detecting': 'Sprache wird erkannt…',
    'translator.connecting': 'Übersetzungsmodus wird gestartet…',
    'translator.placeholder': 'Sprich los — ich übersetze hin und her zwischen {source} und {target}.',
    'translator.endHint': 'Sage "{name} Übersetzung beenden" um zu beenden.',
    'translator.exitButton': 'Übersetzung beenden',
    'translator.detected': 'Original',
    'translator.input': 'Eingabe',
    'translator.output': 'Ausgabe',
    'translator.translation': 'Übersetzung',

    // Generic
    'common.cancel': 'Abbrechen',
    'common.confirm': 'Bestätigen',
    'common.close': 'Schließen',
  },

  en: {
    'login.title': 'Sign in',
    'login.subtitle.magicLink': "We'll send you a sign-in link by email.",
    'login.subtitle.noMagicLink': 'Email login is not configured on this system.',
    'login.email.label': 'Your email',
    'login.email.placeholder': 'name@your-organization.com',
    'login.button.send': 'Get sign-in link',
    'login.button.sending': 'Sending…',
    'login.divider': 'or',
    'login.demo.button': 'Demo quick access',
    'login.tagline': 'Your personal assistant',
    'login.tenants.title': 'These organizations are enabled:',

    'login.error.title': 'Sign in failed',
    'login.error.retry': 'Try again',
    'login.error.invalidEmail': 'Please enter a valid email address',
    'login.error.unknownDomain.withDemo': 'This email domain is not yet enabled. Try a demo sign-in below.',
    'login.error.unknownDomain.noDemo': 'This email domain is not yet enabled. Please contact support.',
    'login.error.notConfigured': 'Email login is not configured on this system.',
    'login.error.email': 'Could not send email. Common causes: invalid Resend API key, or sender domain not verified in Resend. Please try again or contact your administrator.',
    'login.error.verification': 'The sign-in link has expired or is invalid. Please request a new link.',
    'login.error.accessDenied': 'This email domain is not enabled for {name}. Please contact your administrator.',
    'login.error.configuration': 'Server is not correctly configured. Please contact your administrator.',
    'login.error.callback': 'Error processing the sign-in link. Please try again.',
    'login.error.unknown': 'Sign in failed. Please try again.',

    'verify.title': 'Email sent',
    'verify.subtitle': 'We have sent you a sign-in link.',
    'verify.body': 'Open your email and click the link to sign in. The link is valid for 24 hours.',
    'verify.help.title': 'No email received?',
    'verify.help.spam': 'Check spam folder',
    'verify.help.typo': 'Email address spelled correctly?',
    'verify.help.delay': 'Up to 1 minute delay possible',
    'verify.back': '← Use a different email or send again',

    'app.tools.available': 'tools available',
    'app.demo_badge': 'DEMO',
    'app.error': 'Error',
    'settings.agentName.title': 'Assistant name',
    'settings.agentName.desc': 'What should your personal voice assistant be called? This name is used as activation word — only "{name}, ..." triggers actions.',
    'settings.agentName.hint': 'Say e.g.: "{name}, start translation" or "{name}, record vitals".',
    'settings.agentName.invalid': 'Only letters, spaces, hyphens. Max. 30 characters.',
    'common.save': 'Save',
    'app.status.standardMode': 'Standard mode',
    'app.status.standardModeDesc': 'AI picks the right tool automatically',

    'ptt.idle.demo': 'Tap for demo example',
    'ptt.idle.real': 'Tap to speak',
    'ptt.connecting': 'Connecting…',
    'ptt.recording.demo': 'Demo running…',
    'ptt.recording.real': 'Listening — go ahead',
    'ptt.processing': 'Processing…',
    'ptt.responding.demo': 'Responding…',
    'ptt.responding.real': 'Responding — tap to interrupt',
    'ptt.error': 'Error · try again',
    'ptt.hint': 'AirPods · Headset · Spacebar',

    'empty.demoHint': '💡 Demo mode: example dialogs are simulated',
    'empty.tapHint': 'Tap the button and speak. I will find the right tool.',

    'turn.you': 'You',
    'turn.assistant': 'Assistant',

    'settings.title': 'Settings',
    'settings.account': 'Signed in as',
    'settings.demoActive': 'Demo mode active',
    'settings.tenant': 'Organization',
    'settings.tools': 'Available tools',
    'settings.privacy': 'Privacy',
    'settings.privacy.hosting': 'Hosting',
    'settings.privacy.audit': 'Audit retention',
    'settings.privacy.region': '{region} region',
    'settings.privacy.days': '{days} days',
    'settings.logout': 'Sign out',
    'settings.id': 'ID',
    'settings.emailDomains': 'Email domains',

    'settings.appLanguage': 'App language',
    'settings.appLanguageDesc': 'Language of the interface and {name}\'s voice',
    'settings.appLanguageHint': 'Takes effect immediately. {name} will speak the chosen language from the next session.',

    'settings.voice.title': '{name}\'s voice',
    'settings.voice.desc': 'Tap a voice to hear it. Selection takes effect from the next session.',
    'settings.voice.tenantDefault': 'Standard for {tenant}',
    'settings.voice.active': 'active',
    'settings.voice.preview': 'Preview',

    'settings.demoVoice.title': 'Voice for speech output',
    'settings.demoVoice.desc': 'Choose a voice. Tap an option to hear it immediately.',

    'settings.vad.title': 'Voice detection sensitivity',
    'settings.vad.desc': 'How sensitively {name} reacts to sounds. If background noise causes false triggers, set to "Low".',
    'settings.vad.high.label': 'High',
    'settings.vad.high.desc': 'Reacts quickly, hears even quiet voices',
    'settings.vad.high.hint': 'For quiet environments',
    'settings.vad.normal.label': 'Normal',
    'settings.vad.normal.desc': 'Recommended for most situations',
    'settings.vad.normal.hint': 'Default',
    'settings.vad.low.label': 'Low',
    'settings.vad.low.desc': 'Only clear speech, ignores background noise',
    'settings.vad.low.hint': 'For loud environments',
    'settings.vad.hint': 'Note: Takes effect from the next session.',

    'settings.timeout.title': 'Listen time after response',
    'settings.timeout.desc': 'How long {name} keeps listening after a response before the session ends. You can simply keep speaking — {name} continues the dialog.',
    'settings.timeout.current': 'Current',
    'settings.timeout.seconds': 'sec.',
    'settings.timeout.costHint': 'Note: longer listen times slightly increase OpenAI costs.',

    'translator.banner': 'Translation mode',
    'translator.activeLabel': 'ACTIVE',
    'translator.statusActive': 'Translation active: {source} ↔ {target}',
    'translator.bannerSub': '{name} interprets between {source} and {target}',
    'translator.askLanguage': 'Which language should I translate to?',
    'translator.detecting': 'Detecting language…',
    'translator.connecting': 'Starting translation mode…',
    'translator.placeholder': 'Go ahead — I\'ll translate back and forth between {source} and {target}.',
    'translator.endHint': 'Say "{name} stop translation" to end.',
    'translator.exitButton': 'End translation',
    'translator.detected': 'Original',
    'translator.input': 'Input',
    'translator.output': 'Output',
    'translator.translation': 'Translation',

    'common.cancel': 'Cancel',
    'common.confirm': 'Confirm',
    'common.close': 'Close',
  },

  it: {
    'login.title': 'Accedi',
    'login.subtitle.magicLink': 'Ti invieremo un link di accesso via email.',
    'login.subtitle.noMagicLink': 'L\'accesso via email non è configurato.',
    'login.email.label': 'La tua email',
    'login.email.placeholder': 'nome@tua-organizzazione.it',
    'login.button.send': 'Ricevi link di accesso',
    'login.button.sending': 'Invio…',
    'login.divider': 'oppure',
    'login.demo.button': 'Accesso demo rapido',
    'login.tagline': 'La tua assistente personale',
    'login.tenants.title': 'Queste organizzazioni sono abilitate:',

    'login.error.title': 'Accesso fallito',
    'login.error.retry': 'Riprova',
    'login.error.invalidEmail': 'Inserisci un indirizzo email valido',
    'login.error.unknownDomain.withDemo': 'Questo dominio email non è ancora abilitato. Prova un accesso demo qui sotto.',
    'login.error.unknownDomain.noDemo': 'Questo dominio email non è ancora abilitato. Contatta il supporto.',
    'login.error.notConfigured': 'L\'accesso via email non è configurato.',
    'login.error.email': 'Impossibile inviare email. Cause comuni: API key Resend non valida o dominio mittente non verificato. Riprova o contatta l\'amministratore.',
    'login.error.verification': 'Il link è scaduto o non valido. Richiedi un nuovo link.',
    'login.error.accessDenied': 'Questo dominio email non è abilitato. Contatta l\'amministratore.',
    'login.error.configuration': 'Il server non è configurato correttamente. Contatta l\'amministratore.',
    'login.error.callback': 'Errore nell\'elaborazione del link. Riprova.',
    'login.error.unknown': 'Accesso fallito. Riprova.',

    'verify.title': 'Email inviata',
    'verify.subtitle': 'Ti abbiamo inviato un link di accesso.',
    'verify.body': 'Apri la tua email e clicca sul link per accedere. Il link è valido per 24 ore.',
    'verify.help.title': 'Nessuna email ricevuta?',
    'verify.help.spam': 'Controlla la cartella spam',
    'verify.help.typo': 'Email scritta correttamente?',
    'verify.help.delay': 'Possibile ritardo fino a 1 minuto',
    'verify.back': '← Usa un\'altra email o invia di nuovo',

    'app.tools.available': 'strumenti disponibili',
    'app.demo_badge': 'DEMO',
    'app.error': 'Errore',
    'settings.agentName.title': 'Nome assistente',
    'settings.agentName.desc': 'Come si dovrebbe chiamare il tuo assistente vocale personale? Questo nome è la parola di attivazione — solo "{name}, ..." attiva azioni.',
    'settings.agentName.hint': 'Di\' ad esempio: "{name}, avvia traduzione" o "{name}, registra parametri vitali".',
    'settings.agentName.invalid': 'Solo lettere, spazi, trattini. Max. 30 caratteri.',
    'common.save': 'Salva',
    'app.status.standardMode': 'Modalità standard',
    'app.status.standardModeDesc': 'L\'IA sceglie automaticamente lo strumento giusto',

    'ptt.idle.demo': 'Tocca per esempio demo',
    'ptt.idle.real': 'Tocca per parlare',
    'ptt.connecting': 'Connessione…',
    'ptt.recording.demo': 'Demo in corso…',
    'ptt.recording.real': 'Ascolto — parla',
    'ptt.processing': 'Elaborazione…',
    'ptt.responding.demo': 'Risposta…',
    'ptt.responding.real': 'Risposta — tocca per interrompere',
    'ptt.error': 'Errore · riprova',
    'ptt.hint': 'AirPods · Cuffie · Spazio',

    'empty.demoHint': '💡 Modalità demo: dialoghi di esempio simulati',
    'empty.tapHint': 'Tocca il pulsante e parla. Trovo lo strumento giusto.',

    'turn.you': 'Tu',
    'turn.assistant': 'Assistente',

    'settings.title': 'Impostazioni',
    'settings.account': 'Connesso come',
    'settings.demoActive': 'Modalità demo attiva',
    'settings.tenant': 'Organizzazione',
    'settings.tools': 'Strumenti disponibili',
    'settings.privacy': 'Privacy',
    'settings.privacy.hosting': 'Hosting',
    'settings.privacy.audit': 'Conservazione audit',
    'settings.privacy.region': 'Regione {region}',
    'settings.privacy.days': '{days} giorni',
    'settings.logout': 'Disconnetti',
    'settings.id': 'ID',
    'settings.emailDomains': 'Domini email',

    'settings.appLanguage': 'Lingua dell\'app',
    'settings.appLanguageDesc': 'Lingua dell\'interfaccia e della voce di {name}',
    'settings.appLanguageHint': 'Effetto immediato. {name} parlerà nella lingua scelta dalla prossima sessione.',

    'settings.voice.title': 'Voce di {name}',
    'settings.voice.desc': 'Tocca una voce per ascoltarla. La selezione ha effetto dalla prossima sessione.',
    'settings.voice.tenantDefault': 'Predefinita per {tenant}',
    'settings.voice.active': 'attiva',
    'settings.voice.preview': 'Anteprima',

    'settings.demoVoice.title': 'Voce per l\'output vocale',
    'settings.demoVoice.desc': 'Scegli una voce. Tocca un\'opzione per ascoltarla.',

    'settings.vad.title': 'Sensibilità riconoscimento vocale',
    'settings.vad.desc': 'Quanto sensibilmente {name} reagisce ai suoni. In caso di falsi positivi, imposta "Bassa".',
    'settings.vad.high.label': 'Alta',
    'settings.vad.high.desc': 'Reagisce velocemente, sente anche voci basse',
    'settings.vad.high.hint': 'In ambienti silenziosi',
    'settings.vad.normal.label': 'Normale',
    'settings.vad.normal.desc': 'Consigliato per la maggior parte delle situazioni',
    'settings.vad.normal.hint': 'Predefinito',
    'settings.vad.low.label': 'Bassa',
    'settings.vad.low.desc': 'Solo voce chiara, ignora rumori di fondo',
    'settings.vad.low.hint': 'In ambienti rumorosi',
    'settings.vad.hint': 'Nota: ha effetto dalla prossima sessione.',

    'settings.timeout.title': 'Tempo di ascolto dopo risposta',
    'settings.timeout.desc': 'Quanto a lungo {name} continua ad ascoltare dopo una risposta prima che la sessione termini.',
    'settings.timeout.current': 'Attuale',
    'settings.timeout.seconds': 'sec.',
    'settings.timeout.costHint': 'Nota: tempi più lunghi aumentano leggermente i costi OpenAI.',

    'translator.banner': 'Modalità traduzione',
    'translator.activeLabel': 'ATTIVA',
    'translator.statusActive': 'Traduzione attiva: {source} ↔ {target}',
    'translator.bannerSub': '{name} traduce tra {source} e {target}',
    'translator.askLanguage': 'In quale lingua devo tradurre?',
    'translator.detecting': 'Rilevamento lingua…',
    'translator.connecting': 'Avvio modalità traduzione…',
    'translator.placeholder': 'Parla — traduco avanti e indietro tra {source} e {target}.',
    'translator.endHint': 'Di\' "{name} stop traduzione" per terminare.',
    'translator.exitButton': 'Termina traduzione',
    'translator.detected': 'Originale',
    'translator.input': 'Ingresso',
    'translator.output': 'Uscita',
    'translator.translation': 'Traduzione',

    'common.cancel': 'Annulla',
    'common.confirm': 'Conferma',
    'common.close': 'Chiudi',
  },

  fr: {
    'login.title': 'Connexion',
    'login.subtitle.magicLink': 'Nous vous enverrons un lien de connexion par email.',
    'login.subtitle.noMagicLink': 'La connexion par email n\'est pas configurée.',
    'login.email.label': 'Votre email',
    'login.email.placeholder': 'nom@votre-organisation.fr',
    'login.button.send': 'Recevoir le lien',
    'login.button.sending': 'Envoi…',
    'login.divider': 'ou',
    'login.demo.button': 'Accès démo rapide',
    'login.tagline': 'Votre assistante personnelle',
    'login.tenants.title': 'Ces organisations sont activées :',

    'login.error.title': 'Échec de la connexion',
    'login.error.retry': 'Réessayer',
    'login.error.invalidEmail': 'Veuillez entrer une adresse email valide',
    'login.error.unknownDomain.withDemo': 'Ce domaine email n\'est pas encore activé. Essayez une connexion démo ci-dessous.',
    'login.error.unknownDomain.noDemo': 'Ce domaine email n\'est pas encore activé. Contactez le support.',
    'login.error.notConfigured': 'La connexion par email n\'est pas configurée.',
    'login.error.email': 'Impossible d\'envoyer l\'email. Causes courantes : clé API Resend invalide ou domaine expéditeur non vérifié. Réessayez ou contactez l\'administrateur.',
    'login.error.verification': 'Le lien a expiré ou est invalide. Demandez un nouveau lien.',
    'login.error.accessDenied': 'Ce domaine email n\'est pas activé. Contactez l\'administrateur.',
    'login.error.configuration': 'Le serveur n\'est pas correctement configuré.',
    'login.error.callback': 'Erreur lors du traitement du lien. Réessayez.',
    'login.error.unknown': 'Échec de la connexion. Réessayez.',

    'verify.title': 'Email envoyé',
    'verify.subtitle': 'Nous vous avons envoyé un lien de connexion.',
    'verify.body': 'Ouvrez votre email et cliquez sur le lien pour vous connecter. Le lien est valide 24 heures.',
    'verify.help.title': 'Pas d\'email reçu ?',
    'verify.help.spam': 'Vérifiez le dossier spam',
    'verify.help.typo': 'Email correctement orthographié ?',
    'verify.help.delay': 'Délai possible jusqu\'à 1 minute',
    'verify.back': '← Utiliser un autre email ou renvoyer',

    'app.tools.available': 'outils disponibles',
    'app.demo_badge': 'DÉMO',
    'app.error': 'Erreur',
    'settings.agentName.title': 'Nom de l\'assistant',
    'settings.agentName.desc': 'Comment doit s\'appeler ton assistant vocal personnel ? Ce nom sert de mot d\'activation — seul "{name}, ..." déclenche des actions.',
    'settings.agentName.hint': 'Dis par exemple : "{name}, démarrer traduction" ou "{name}, enregistrer signes vitaux".',
    'settings.agentName.invalid': 'Uniquement lettres, espaces, tirets. Max. 30 caractères.',
    'common.save': 'Enregistrer',
    'app.status.standardMode': 'Mode standard',
    'app.status.standardModeDesc': 'L\'IA choisit automatiquement le bon outil',

    'ptt.idle.demo': 'Toucher pour exemple démo',
    'ptt.idle.real': 'Toucher pour parler',
    'ptt.connecting': 'Connexion…',
    'ptt.recording.demo': 'Démo en cours…',
    'ptt.recording.real': 'Écoute — parle',
    'ptt.processing': 'Traitement…',
    'ptt.responding.demo': 'Réponse…',
    'ptt.responding.real': 'Réponse — toucher pour interrompre',
    'ptt.error': 'Erreur · réessayer',
    'ptt.hint': 'AirPods · Casque · Espace',

    'empty.demoHint': '💡 Mode démo : dialogues simulés',
    'empty.tapHint': 'Touchez le bouton et parlez. Je trouve le bon outil.',

    'turn.you': 'Vous',
    'turn.assistant': 'Assistant',

    'settings.title': 'Paramètres',
    'settings.account': 'Connecté en tant que',
    'settings.demoActive': 'Mode démo actif',
    'settings.tenant': 'Organisation',
    'settings.tools': 'Outils disponibles',
    'settings.privacy': 'Confidentialité',
    'settings.privacy.hosting': 'Hébergement',
    'settings.privacy.audit': 'Conservation des logs',
    'settings.privacy.region': 'Région {region}',
    'settings.privacy.days': '{days} jours',
    'settings.logout': 'Déconnexion',
    'settings.id': 'ID',
    'settings.emailDomains': 'Domaines email',

    'settings.appLanguage': 'Langue de l\'app',
    'settings.appLanguageDesc': 'Langue de l\'interface et de la voix d\'{name}',
    'settings.appLanguageHint': 'Effet immédiat. {name} parlera dans la langue choisie dès la prochaine session.',

    'settings.voice.title': 'Voix d\'{name}',
    'settings.voice.desc': 'Touchez une voix pour l\'écouter. La sélection prend effet dès la prochaine session.',
    'settings.voice.tenantDefault': 'Par défaut pour {tenant}',
    'settings.voice.active': 'actif',
    'settings.voice.preview': 'Aperçu',

    'settings.demoVoice.title': 'Voix de la sortie vocale',
    'settings.demoVoice.desc': 'Choisissez une voix. Touchez une option pour l\'écouter.',

    'settings.vad.title': 'Sensibilité reconnaissance vocale',
    'settings.vad.desc': 'À quel point {name} réagit aux sons. En cas de faux déclenchements, réglez sur "Faible".',
    'settings.vad.high.label': 'Haute',
    'settings.vad.high.desc': 'Réagit vite, entend les voix basses',
    'settings.vad.high.hint': 'En environnement calme',
    'settings.vad.normal.label': 'Normale',
    'settings.vad.normal.desc': 'Recommandé dans la plupart des situations',
    'settings.vad.normal.hint': 'Par défaut',
    'settings.vad.low.label': 'Faible',
    'settings.vad.low.desc': 'Seulement parole claire, ignore le bruit',
    'settings.vad.low.hint': 'En environnement bruyant',
    'settings.vad.hint': 'Note : effet à partir de la prochaine session.',

    'settings.timeout.title': 'Durée d\'écoute après réponse',
    'settings.timeout.desc': 'Combien de temps {name} continue d\'écouter après une réponse avant que la session se termine.',
    'settings.timeout.current': 'Actuel',
    'settings.timeout.seconds': 'sec.',
    'settings.timeout.costHint': 'Note : des durées plus longues augmentent légèrement les coûts OpenAI.',

    'translator.banner': 'Mode traduction',
    'translator.activeLabel': 'ACTIF',
    'translator.statusActive': 'Traduction active : {source} ↔ {target}',
    'translator.bannerSub': '{name} interprète entre {source} et {target}',
    'translator.askLanguage': 'Vers quelle langue dois-je traduire ?',
    'translator.detecting': 'Détection de la langue…',
    'translator.connecting': 'Démarrage du mode traduction…',
    'translator.placeholder': 'Parlez — je traduis entre {source} et {target}.',
    'translator.endHint': 'Dites « {name} stop traduction » pour terminer.',
    'translator.exitButton': 'Terminer la traduction',
    'translator.detected': 'Original',
    'translator.input': 'Entrée',
    'translator.output': 'Sortie',
    'translator.translation': 'Traduction',

    'common.cancel': 'Annuler',
    'common.confirm': 'Confirmer',
    'common.close': 'Fermer',
  },

  es: {
    'login.title': 'Iniciar sesión',
    'login.subtitle.magicLink': 'Te enviaremos un enlace de acceso por email.',
    'login.subtitle.noMagicLink': 'El acceso por email no está configurado.',
    'login.email.label': 'Tu email',
    'login.email.placeholder': 'nombre@tu-organizacion.es',
    'login.button.send': 'Recibir enlace de acceso',
    'login.button.sending': 'Enviando…',
    'login.divider': 'o',
    'login.demo.button': 'Acceso demo rápido',
    'login.tagline': 'Tu asistente personal',
    'login.tenants.title': 'Estas organizaciones están habilitadas:',

    'login.error.title': 'Error de inicio de sesión',
    'login.error.retry': 'Reintentar',
    'login.error.invalidEmail': 'Introduce una dirección de email válida',
    'login.error.unknownDomain.withDemo': 'Este dominio email aún no está habilitado. Prueba un acceso demo abajo.',
    'login.error.unknownDomain.noDemo': 'Este dominio email aún no está habilitado. Contacta con soporte.',
    'login.error.notConfigured': 'El acceso por email no está configurado.',
    'login.error.email': 'No se pudo enviar el email. Causas comunes: clave API Resend inválida o dominio remitente no verificado. Reintenta o contacta al administrador.',
    'login.error.verification': 'El enlace ha caducado o no es válido. Solicita un nuevo enlace.',
    'login.error.accessDenied': 'Este dominio email no está habilitado. Contacta al administrador.',
    'login.error.configuration': 'El servidor no está configurado correctamente.',
    'login.error.callback': 'Error al procesar el enlace. Reintenta.',
    'login.error.unknown': 'Error de inicio de sesión. Reintenta.',

    'verify.title': 'Email enviado',
    'verify.subtitle': 'Te hemos enviado un enlace de acceso.',
    'verify.body': 'Abre tu email y haz clic en el enlace para acceder. El enlace es válido 24 horas.',
    'verify.help.title': '¿No recibiste el email?',
    'verify.help.spam': 'Revisa la carpeta de spam',
    'verify.help.typo': '¿Email escrito correctamente?',
    'verify.help.delay': 'Posible retraso de hasta 1 minuto',
    'verify.back': '← Usa otro email o envía de nuevo',

    'app.tools.available': 'herramientas disponibles',
    'app.demo_badge': 'DEMO',
    'app.error': 'Error',
    'settings.agentName.title': 'Nombre del asistente',
    'settings.agentName.desc': '¿Cómo se debería llamar tu asistente de voz personal? Este nombre se usa como palabra de activación — solo "{name}, ..." activa acciones.',
    'settings.agentName.hint': 'Di por ejemplo: "{name}, iniciar traducción" o "{name}, registrar constantes vitales".',
    'settings.agentName.invalid': 'Solo letras, espacios, guiones. Máx. 30 caracteres.',
    'common.save': 'Guardar',
    'app.status.standardMode': 'Modo estándar',
    'app.status.standardModeDesc': 'La IA elige automáticamente la herramienta adecuada',

    'ptt.idle.demo': 'Tocar para ejemplo demo',
    'ptt.idle.real': 'Tocar para hablar',
    'ptt.connecting': 'Conectando…',
    'ptt.recording.demo': 'Demo en curso…',
    'ptt.recording.real': 'Escuchando — habla',
    'ptt.processing': 'Procesando…',
    'ptt.responding.demo': 'Respondiendo…',
    'ptt.responding.real': 'Respondiendo — toca para interrumpir',
    'ptt.error': 'Error · reintentar',
    'ptt.hint': 'AirPods · Auriculares · Espacio',

    'empty.demoHint': '💡 Modo demo: diálogos de ejemplo simulados',
    'empty.tapHint': 'Toca el botón y habla. Encuentro la herramienta adecuada.',

    'turn.you': 'Tú',
    'turn.assistant': 'Asistente',

    'settings.title': 'Ajustes',
    'settings.account': 'Conectado como',
    'settings.demoActive': 'Modo demo activo',
    'settings.tenant': 'Organización',
    'settings.tools': 'Herramientas disponibles',
    'settings.privacy': 'Privacidad',
    'settings.privacy.hosting': 'Hosting',
    'settings.privacy.audit': 'Retención de auditoría',
    'settings.privacy.region': 'Región {region}',
    'settings.privacy.days': '{days} días',
    'settings.logout': 'Cerrar sesión',
    'settings.id': 'ID',
    'settings.emailDomains': 'Dominios email',

    'settings.appLanguage': 'Idioma de la app',
    'settings.appLanguageDesc': 'Idioma de la interfaz y de la voz de {name}',
    'settings.appLanguageHint': 'Efecto inmediato. {name} hablará en el idioma elegido a partir de la próxima sesión.',

    'settings.voice.title': 'Voz de {name}',
    'settings.voice.desc': 'Toca una voz para escucharla. La selección tiene efecto en la próxima sesión.',
    'settings.voice.tenantDefault': 'Predeterminada para {tenant}',
    'settings.voice.active': 'activa',
    'settings.voice.preview': 'Vista previa',

    'settings.demoVoice.title': 'Voz para la salida de voz',
    'settings.demoVoice.desc': 'Elige una voz. Toca una opción para escucharla.',

    'settings.vad.title': 'Sensibilidad reconocimiento de voz',
    'settings.vad.desc': 'Cuán sensiblemente {name} reacciona a sonidos. Si hay disparos falsos, ponlo en "Baja".',
    'settings.vad.high.label': 'Alta',
    'settings.vad.high.desc': 'Reacciona rápido, oye voces bajas',
    'settings.vad.high.hint': 'En entornos tranquilos',
    'settings.vad.normal.label': 'Normal',
    'settings.vad.normal.desc': 'Recomendado para la mayoría de situaciones',
    'settings.vad.normal.hint': 'Predeterminado',
    'settings.vad.low.label': 'Baja',
    'settings.vad.low.desc': 'Solo voz clara, ignora ruido de fondo',
    'settings.vad.low.hint': 'En entornos ruidosos',
    'settings.vad.hint': 'Nota: efecto desde la próxima sesión.',

    'settings.timeout.title': 'Tiempo de escucha tras respuesta',
    'settings.timeout.desc': 'Cuánto tiempo {name} sigue escuchando tras una respuesta antes de que termine la sesión.',
    'settings.timeout.current': 'Actual',
    'settings.timeout.seconds': 'seg.',
    'settings.timeout.costHint': 'Nota: tiempos más largos aumentan ligeramente los costes de OpenAI.',

    'translator.banner': 'Modo traducción',
    'translator.activeLabel': 'ACTIVO',
    'translator.statusActive': 'Traducción activa: {source} ↔ {target}',
    'translator.bannerSub': '{name} interpreta entre {source} y {target}',
    'translator.askLanguage': '¿A qué idioma debo traducir?',
    'translator.detecting': 'Detectando idioma…',
    'translator.connecting': 'Iniciando modo traducción…',
    'translator.placeholder': 'Habla — traduzco entre {source} y {target}.',
    'translator.endHint': 'Di "{name} stop traducción" para terminar.',
    'translator.exitButton': 'Terminar traducción',
    'translator.detected': 'Original',
    'translator.input': 'Entrada',
    'translator.output': 'Salida',
    'translator.translation': 'Traducción',

    'common.cancel': 'Cancelar',
    'common.confirm': 'Confirmar',
    'common.close': 'Cerrar',
  },
};

/**
 * Anzeigename für die App-Sprache in der eingestellten Sprache selbst.
 * Wird im Translator-Banner verwendet ("Übersetzungsmodus: Deutsch ↔ Polnisch").
 */
export function localeNativeLabel(code: Locale): string {
  return SUPPORTED_LOCALES.find(l => l.code === code)?.nativeLabel ?? code;
}

/* ─────────── React-Context und Hook ─────────── */

interface I18nContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  agentName: string;
  setAgentName: (n: string) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({
  children,
  initialLocale,
}: {
  children: ReactNode;
  initialLocale?: Locale;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale ?? DEFAULT_LOCALE);
  const [agentName, setAgentNameState] = useState<string>('Anni');
  // Marker dass die Hydration durch ist - vorher dürfen wir die Sprache
  // nicht ändern (sonst React-Hydration-Error #418).
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
    const detected = detectInitialLocale();
    if (detected !== locale) setLocaleState(detected);
    const handler = () => {
      try {
        if (!window.localStorage.getItem(STORAGE_KEY)) {
          const newDetected = detectInitialLocale();
          if (newDetected !== locale) setLocaleState(newDetected);
        }
      } catch {}
    };
    window.addEventListener('languagechange', handler);
    return () => window.removeEventListener('languagechange', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      window.localStorage.setItem(STORAGE_KEY, l);
    } catch {}
    if (typeof document !== 'undefined') {
      document.documentElement.lang = l;
    }
  }, []);

  const setAgentName = useCallback((n: string) => {
    setAgentNameState(n || 'Anni');
  }, []);

  // Übersetzungs-Funktion mit automatischem Agent-Namen-Replacement.
  // Jeder {name}-Platzhalter wird durch den aktuellen agentName ersetzt -
  // ohne dass jeder t()-Call explizit { name: ... } übergeben muss.
  const t = useCallback((key: string, params?: Record<string, string | number>) => {
    let str = TRANSLATIONS[locale]?.[key] ?? TRANSLATIONS.en[key] ?? key;
    str = str.replace(/\{name\}/g, agentName);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
      }
    }
    return str;
  }, [locale, agentName]);

  return (
    <I18nContext.Provider value={{ locale, setLocale, agentName, setAgentName, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // Fallback wenn außerhalb des Providers verwendet (sollte nicht passieren)
    return {
      locale: DEFAULT_LOCALE,
      setLocale: () => {},
      agentName: 'Anni',
      setAgentName: () => {},
      t: (key: string) => (TRANSLATIONS[DEFAULT_LOCALE][key] ?? key).replace(/\{name\}/g, 'Anni'),
    };
  }
  return ctx;
}
