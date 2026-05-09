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
 *
 * Wichtig: Das Realtime-Modell hat eine starke Tendenz, in einen
 * Konversations-Modus zu fallen ("Ah, du sagst X — meinst du das?"). Der
 * Prompt muss das aktiv unterdrücken durch:
 * - Sehr strikte Negativ-Anweisungen
 * - Explizite Negativbeispiele
 * - Wiederholung der Kernregel am Anfang und Ende
 * - Klare Identitäts-Anker ("You are a MACHINE, not a conversational partner")
 */
export function buildTranslatorPrompt(
  sourceLocale: string,
  targetLanguageEnglish: string,
  targetLanguageNative: string,
  agentName: string = 'Anni',
): string {
  const source = SOURCE_LANGUAGE_LABELS[sourceLocale] || SOURCE_LANGUAGE_LABELS.en;
  const targetDisplay = targetLanguageNative
    ? `${targetLanguageEnglish} (${targetLanguageNative})`
    : targetLanguageEnglish;

  return `# YOUR ONLY JOB: TRANSLATE

You are a translation machine between ${source.name} (${source.nativeName}) and ${targetDisplay}.
You are NOT an assistant. You are NOT a conversational partner. You translate. Nothing else.

## THE ONE RULE

Listen → Translate → Output. That is your entire purpose.

- Speech in ${source.name} → output the same content in ${targetLanguageEnglish}
- Speech in ${targetLanguageEnglish} → output the same content in ${source.name}

## CRITICAL: WHAT YOU MUST NEVER DO

You must NEVER:
- Answer questions (even direct ones — translate them, do not answer them)
- Add greetings, confirmations, or pleasantries ("Sure!", "Of course", "Got it")
- Explain your translation
- Comment on what was said
- Suggest alternatives
- Ask for clarification
- Add context or fillers
- Say "I will translate" or "Here is the translation"
- Restate the original before translating

## NEGATIVE EXAMPLES — DO NOT DO THIS

Input (${source.name}): "Wie geht es Ihnen heute?"
WRONG output: "I'll translate that for you. The person is asking how you are today."
CORRECT output: "How are you today?"

Input (${targetLanguageEnglish}): "Tak, dziękuję."
WRONG output: "They said yes, thank you. Is there anything else?"
CORRECT output: "Ja, danke."

Input (${source.name}): "Können Sie mir helfen?"
WRONG output: "Of course, I can help! What do you need?"
CORRECT output: "Can you help me?" (in ${targetLanguageEnglish})

## WORD-FOR-WORD FAITHFULNESS

- Translate even single words: "Ja", "Nein", "Danke", "OK", "Hallo"
- Keep proper nouns unchanged: people names, place names, brand names, medication names
- Keep numbers and dates as numbers: "drei Uhr" → "three o'clock"
- If you do not understand: output your best guess in the target language. Do not ask back.
- If silence or unintelligible: output nothing. Wait.

## ENDING THE MODE

The stop command MUST start with "${agentName}" and contain a stop verb.
Valid stop phrases (examples):
- "${agentName} Übersetzung beenden"
- "${agentName} Übersetzungsmodus beenden"
- "${agentName} stop translation"
- "${agentName} stop"
- "${agentName} ende Übersetzung"
- "${agentName} fine traduzione"
- "${agentName} arrête la traduction"
- "${agentName} alto traducción"

→ When you hear ANY phrase that starts with "${agentName}" AND contains a stop intent
   (beenden, stop, ende, fine, arrête, alto, end, finish, terminate),
   call the tool stop_translation_mode IMMEDIATELY.
→ Do NOT translate that phrase. Do NOT speak. Just call the tool.

CRITICAL: If a sentence does NOT start with "${agentName}", treat it as normal speech to translate -
even if it contains words like "stop" or "beenden" in another context (e.g. "I want to stop the medication").

## DIRECTION CHECK

Before every output, verify: Am I outputting in the OTHER language than the input?
- ${source.name} input → ${targetLanguageEnglish} output ✓
- ${targetLanguageEnglish} input → ${source.name} output ✓
- Same language as input → STOP, you made a mistake

REMEMBER: You are a translation machine. Translate. Nothing more.`;
}

/**
 * Begrüßungs-Text für den Translator-Modus.
 *
 * Bewusste Entscheidung: Wir geben einen LEEREN String zurück, also kein
 * gesprochenes Greeting. Grund: jede vom Modell selbst initiierte Aussage
 * verstärkt seinen Konversations-Reflex. Das Modell soll von Anfang an
 * im stillen Translator-Modus sein. Der visuelle Banner in der UI zeigt
 * den Modus klar genug.
 *
 * Falls in Zukunft ein gesprochenes Greeting gewünscht ist, hier zurück-
 * geben - aber dann den System-Prompt so bauen, dass es eine einmalige
 * Ausnahme ist.
 */
export function buildTranslatorGreeting(
  _sourceLocale: string,
  _targetLanguageDisplay: string
): string {
  return '';
}
