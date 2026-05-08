/**
 * Translation-Modus Helfer.
 *
 * Architektur: Wir nutzen den normalen Realtime-Endpoint mit dediziertem
 * Dolmetscher-Prompt. Die "Quell-Sprache" ist immer die App-Sprache des
 * Users (locale aus i18n), die "Ziel-Sprache" wird per Tool-Aufruf gesetzt.
 *
 * Sprachen: User können freie Eingaben machen (z.B. "Vietnamesisch",
 * "Persisch"). Die KI kennt 70+ Sprachen. Diese Liste hier ist nur für
 * UI-Anzeige und Auto-Vervollständigung.
 */

export interface TranslationLanguage {
  code: string;
  label: string;       // Englischer Name (lingua franca, von KI verstanden)
  labels: Record<string, string>; // Lokalisierte Anzeigenamen
  nativeLabel: string; // Name in der Sprache selbst
  flag: string;
}

export const TRANSLATION_LANGUAGES: TranslationLanguage[] = [
  { code: 'tr', label: 'Turkish',     labels: { de: 'Türkisch', en: 'Turkish', it: 'Turco', fr: 'Turc', es: 'Turco' },               nativeLabel: 'Türkçe',      flag: '🇹🇷' },
  { code: 'pl', label: 'Polish',      labels: { de: 'Polnisch', en: 'Polish', it: 'Polacco', fr: 'Polonais', es: 'Polaco' },         nativeLabel: 'Polski',      flag: '🇵🇱' },
  { code: 'ru', label: 'Russian',     labels: { de: 'Russisch', en: 'Russian', it: 'Russo', fr: 'Russe', es: 'Ruso' },               nativeLabel: 'Русский',     flag: '🇷🇺' },
  { code: 'ar', label: 'Arabic',      labels: { de: 'Arabisch', en: 'Arabic', it: 'Arabo', fr: 'Arabe', es: 'Árabe' },               nativeLabel: 'العربية',     flag: '🇸🇦' },
  { code: 'en', label: 'English',     labels: { de: 'Englisch', en: 'English', it: 'Inglese', fr: 'Anglais', es: 'Inglés' },         nativeLabel: 'English',     flag: '🇬🇧' },
  { code: 'de', label: 'German',      labels: { de: 'Deutsch', en: 'German', it: 'Tedesco', fr: 'Allemand', es: 'Alemán' },          nativeLabel: 'Deutsch',     flag: '🇩🇪' },
  { code: 'uk', label: 'Ukrainian',   labels: { de: 'Ukrainisch', en: 'Ukrainian', it: 'Ucraino', fr: 'Ukrainien', es: 'Ucraniano' }, nativeLabel: 'Українська', flag: '🇺🇦' },
  { code: 'ro', label: 'Romanian',    labels: { de: 'Rumänisch', en: 'Romanian', it: 'Rumeno', fr: 'Roumain', es: 'Rumano' },        nativeLabel: 'Română',      flag: '🇷🇴' },
  { code: 'fa', label: 'Persian',     labels: { de: 'Persisch', en: 'Persian', it: 'Persiano', fr: 'Persan', es: 'Persa' },          nativeLabel: 'فارسی',       flag: '🇮🇷' },
  { code: 'it', label: 'Italian',     labels: { de: 'Italienisch', en: 'Italian', it: 'Italiano', fr: 'Italien', es: 'Italiano' },   nativeLabel: 'Italiano',    flag: '🇮🇹' },
  { code: 'es', label: 'Spanish',     labels: { de: 'Spanisch', en: 'Spanish', it: 'Spagnolo', fr: 'Espagnol', es: 'Español' },      nativeLabel: 'Español',     flag: '🇪🇸' },
  { code: 'fr', label: 'French',      labels: { de: 'Französisch', en: 'French', it: 'Francese', fr: 'Français', es: 'Francés' },    nativeLabel: 'Français',    flag: '🇫🇷' },
  { code: 'pt', label: 'Portuguese',  labels: { de: 'Portugiesisch', en: 'Portuguese', it: 'Portoghese', fr: 'Portugais', es: 'Portugués' }, nativeLabel: 'Português', flag: '🇵🇹' },
  { code: 'hr', label: 'Croatian',    labels: { de: 'Kroatisch', en: 'Croatian', it: 'Croato', fr: 'Croate', es: 'Croata' },         nativeLabel: 'Hrvatski',    flag: '🇭🇷' },
  { code: 'vi', label: 'Vietnamese',  labels: { de: 'Vietnamesisch', en: 'Vietnamese', it: 'Vietnamita', fr: 'Vietnamien', es: 'Vietnamita' }, nativeLabel: 'Tiếng Việt', flag: '🇻🇳' },
];

export interface ResolvedLanguage {
  code: string;
  label: string;        // Englischer Name (für Prompt)
  displayLabel: string; // Lokalisierter Anzeigename (für UI)
  nativeLabel: string;
  flag: string;
}

/**
 * Versucht eine User-Eingabe auf eine bekannte Sprache zu mappen.
 * Akzeptiert deutsche/englische/native Namen, gängige Schreibweisen.
 *
 * locale = App-Sprache des Users, beeinflusst nur den displayLabel-Output.
 * Bei unbekannter Eingabe gibt es einen Fallback mit dem Original-String.
 */
export function resolveLanguage(input: string, locale: string = 'en'): ResolvedLanguage {
  if (!input || typeof input !== 'string') {
    return {
      code: 'unknown',
      label: 'the other language',
      displayLabel: input || 'Other language',
      nativeLabel: '',
      flag: '🌐',
    };
  }
  const normalized = input.toLowerCase().trim();

  // Exact match in irgendeinem Label
  for (const lang of TRANSLATION_LANGUAGES) {
    const allLabels = [
      lang.label.toLowerCase(),
      lang.nativeLabel.toLowerCase(),
      lang.code,
      ...Object.values(lang.labels).map(l => l.toLowerCase()),
    ];
    if (allLabels.some(l => l === normalized)) {
      return {
        code: lang.code,
        label: lang.label,
        displayLabel: lang.labels[locale] || lang.label,
        nativeLabel: lang.nativeLabel,
        flag: lang.flag,
      };
    }
  }

  // Substring-Match - "polnischen" matched "Polnisch"
  for (const lang of TRANSLATION_LANGUAGES) {
    const allLabels = [
      lang.label.toLowerCase(),
      ...Object.values(lang.labels).map(l => l.toLowerCase()),
    ];
    if (allLabels.some(l => normalized.includes(l) || l.includes(normalized))) {
      return {
        code: lang.code,
        label: lang.label,
        displayLabel: lang.labels[locale] || lang.label,
        nativeLabel: lang.nativeLabel,
        flag: lang.flag,
      };
    }
  }

  // Unbekannt - String trotzdem durchreichen, KI versteht ihn meistens
  return {
    code: 'unknown',
    label: input,
    displayLabel: input,
    nativeLabel: '',
    flag: '🌐',
  };
}

const SOURCE_LANGUAGE_LABELS: Record<string, { name: string; nativeName: string }> = {
  de: { name: 'German',  nativeName: 'Deutsch' },
  en: { name: 'English', nativeName: 'English' },
  it: { name: 'Italian', nativeName: 'italiano' },
  fr: { name: 'French',  nativeName: 'français' },
  es: { name: 'Spanish', nativeName: 'español' },
};

/**
 * Baut den Dolmetscher-System-Prompt.
 * sourceLocale = App-Sprache des Users (DE/EN/IT/FR/ES)
 * targetLanguage = wohin übersetzt werden soll (frei, KI versteht 70+ Sprachen)
 */
export function buildTranslatorPrompt(
  sourceLocale: string,
  targetLanguageEnglish: string,
  targetLanguageNative: string
): string {
  const source = SOURCE_LANGUAGE_LABELS[sourceLocale] || SOURCE_LANGUAGE_LABELS.en;
  const targetDisplay = targetLanguageNative
    ? `${targetLanguageEnglish} (${targetLanguageNative})`
    : targetLanguageEnglish;

  return `You are a silent professional interpreter between ${source.name} (${source.nativeName}) and ${targetDisplay}.

STRICT RULES:
1. When someone speaks ${source.name}, you IMMEDIATELY repeat the exact same in ${targetLanguageEnglish}.
2. When someone speaks ${targetLanguageEnglish}, you IMMEDIATELY repeat the exact same in ${source.name}.
3. You give NO own answers, NO explanations, NO comments.
4. You do NOT ask back. With unclear speech, translate what you understood without adding anything.
5. You translate WORD-FOR-WORD - no pleasantries, no simplifications, no summaries.
6. You translate even short words like "Yes", "No", "Thanks", "Hello" consistently.
7. Proper nouns (people names, place names, brand names) are NOT translated, just repeated.

ENDING:
When someone says "Anni Übersetzung beenden", "Anni stop translation", "Anni stop",
"Anni fine traduzione", "Anni arrête la traduction", "Anni alto traducción" or similar,
you call the tool stop_translation_mode IMMEDIATELY - without translating that statement.

IMPORTANT: Never speak ${source.name} to ${source.name}-language input or ${targetLanguageEnglish}
to ${targetLanguageEnglish}-language input. Always to the OTHER language.`;
}

/**
 * Begrüßungs-Text für den Translator-Modus (in beide Sprachen).
 * Wird sofort nach Session-Start abgespielt damit beide Sprecher hören:
 * "Aha, Modus aktiv".
 */
const TRANSLATOR_GREETING: Record<string, (target: string) => string> = {
  de: (t) => `Übersetzungsmodus aktiv: Deutsch und ${t}. Sprecht jetzt.`,
  en: (t) => `Translation mode active: English and ${t}. Go ahead.`,
  it: (t) => `Modalità traduzione attiva: italiano e ${t}. Parlate.`,
  fr: (t) => `Mode traduction actif : français et ${t}. Parlez.`,
  es: (t) => `Modo traducción activo: español y ${t}. Hablen.`,
};

export function buildTranslatorGreeting(
  sourceLocale: string,
  targetLanguageDisplay: string
): string {
  const builder = TRANSLATOR_GREETING[sourceLocale] || TRANSLATOR_GREETING.en;
  return builder(targetLanguageDisplay);
}
