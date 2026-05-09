/**
 * Voice Backend Adapter
 *
 * Pro Session-Request wird hier entschieden:
 * - Demo-User → Web Speech API im Browser (Frontend handhabt)
 * - Normaler Modus → OpenAI Realtime mit Tenant-System-Prompt + Tools
 * - Translator-Modus → OpenAI Realtime mit Dolmetscher-Prompt, ohne Tenant-Tools
 *
 * Sprache (App-Locale) wird mitgegeben damit Anni in dieser Sprache antwortet,
 * unabhängig vom Tenant-Default. Der User wählt seine UI-Sprache, Anni passt
 * sich an.
 */

import type { TenantConfig, TenantTool } from './tenants';

export type VoiceLocale = 'de' | 'en' | 'it' | 'fr' | 'es';

export interface VoiceSessionDescriptor {
  mode: 'webrtc' | 'demo';
  endpoint?: string;
  ephemeralToken?: string;
  systemPrompt: string;
  tools: any[];
  voiceId?: string;
  language?: string;
  /** Im Translator-Mode gesetzt - Frontend kann diesen Text als Begrüßung anzeigen. */
  translatorGreeting?: string;
  /** Marker für Frontend: welche UI rendern (Translator-Vollbild vs Normal). */
  isTranslator?: boolean;
}

const LOCALE_NAMES: Record<VoiceLocale, string> = {
  de: 'Deutsch',
  en: 'English',
  it: 'italiano',
  fr: 'français',
  es: 'español',
};

/**
 * Lokalisierte Aussprache-Anweisungen für Realtime-Sessions.
 * Werden zusätzlich zum System-Prompt mitgegeben damit die Stimme
 * die richtige Sprache hat (verhindert englischen Akzent bei DE-Voice).
 */
const LANGUAGE_INSTRUCTION: Record<VoiceLocale, string> = {
  de: 'Sprich auf Deutsch mit natürlicher Aussprache.',
  en: 'Speak in natural English.',
  it: 'Parla in italiano con pronuncia naturale.',
  fr: 'Parle en français avec une prononciation naturelle.',
  es: 'Habla en español con pronunciación natural.',
};

function buildSystemPrompt(
  tenant: TenantConfig,
  userRole: string,
  locale: VoiceLocale,
  agentName: string,
): string {
  const availableTools = tenant.tools.filter(
    t => t.enabled_for_roles.includes('all') || t.enabled_for_roles.includes(userRole)
  );

  const toolDescriptions = availableTools
    .map(t => `- ${t.label}: ${t.description}`)
    .join('\n');

  const langName = LOCALE_NAMES[locale];
  const langInstruction = LANGUAGE_INSTRUCTION[locale];

  return `Du bist ${agentName}. ${tenant.agent.persona}

Verfügbare Tools für deine Rolle:
${toolDescriptions}

Nutze die Tools selbständig, wenn der Nutzer eine Anfrage stellt, die zu einem Tool passt.
Bestätige Tool-Aufrufe verbal kurz und prägnant.

# ÜBERSETZUNGSMODUS - Aktivierung

Du hast ein Tool "start_translation_mode" für Dolmetscher-Anfragen.

WICHTIG: Der Nutzer muss seinen Befehl IMMER mit "${agentName}" beginnen, sonst keine Aktion.
Nur "${agentName} Übersetzung starten" / "${agentName} translation mode" / "${agentName} Dolmetscher" usw.
zählen als Aktivierungs-Befehl. Ein "Übersetzung starten" ohne "${agentName}" davor IGNORIERST du
und behandelst es wie normale Konversation.

## PFAD A: Sprache wurde direkt genannt
Beispiele:
- "${agentName}, übersetze ins Polnische"
- "${agentName} translation to English"
- "${agentName} Dolmetscher für Türkisch"
→ Rufe SOFORT start_translation_mode mit der genannten Sprache auf. KEINE verbale Antwort vorher.

## PFAD B: Sprache fehlt
Beispiele:
- "${agentName}, Übersetzung starten"
- "${agentName} Dolmetscher"
- "${agentName} translation mode"
→ Frage genau einmal kurz: "In welche Sprache?"
→ SOBALD der Nutzer eine Sprache nennt (z.B. nur das Wort "Polnisch", "Polish", "Türkisch"),
   rufe SOFORT start_translation_mode mit dieser Sprache auf.
→ Wenn der Nutzer sagt "weiß ich nicht", "unbekannt", "no idea":
   rufe start_translation_mode mit targetLanguage="unknown" auf.
→ KEINE Bestätigung wie "Okay". Sofort Tool aufrufen.

## WICHTIG
- Nach dem Tool-Aufruf wird das System auf Übersetzungsmodus umschalten.
- Du sollst NICHT die Übersetzung selbst machen - das Tool macht das.
- Nach "In welche Sprache?" und der Antwort des Users ist die NÄCHSTE Aktion IMMER der Tool-Aufruf.
- Mache niemals zwei Nachfragen hintereinander.

WICHTIG: ${langInstruction} Antworte immer auf ${langName}.`;
}

function buildToolSchema(tools: TenantTool[]): any[] {
  return tools.map(tool => ({
    type: 'function',
    name: tool.id,
    description: tool.description,
    parameters: {
      type: 'object',
      properties: {
        input: {
          type: 'string',
          description: 'Free-form input für dieses Tool',
        },
      },
    },
  }));
}

/**
 * System-Tools (verfügbar in jeder Realtime-Session unabhängig vom Tenant).
 * Wird als Funktion gebaut, weil die Tool-Description den User-konfigurierten
 * Agent-Namen als Trigger enthält.
 */
function buildSystemTools(agentName: string): any[] {
  return [
    {
      type: 'function',
      name: 'start_translation_mode',
      description:
        `Aktiviert den bidirektionalen Dolmetscher-Modus. WICHTIG: Nur aufrufen wenn der Nutzer "${agentName}" als Prefix nennt. ` +
        `Beispiele: "${agentName} Übersetzung starten", "${agentName} translation mode", "${agentName} ins Polnische übersetzen". ` +
        'Ohne Prefix wird der Befehl IGNORIERT - dann normale Konversation. ' +
        'WANN AUFRUFEN: (1) Direkt wenn Nutzer eine Sprache nennt zusammen mit Übersetzungs-Wunsch ' +
        `("${agentName} Übersetze ins Polnische") - sofort aufrufen. (2) Nach einer Rückfrage "In welche Sprache?" ` +
        'sobald der Nutzer eine Sprache nennt - sofort aufrufen, NICHT weiter unterhalten. ' +
        'targetLanguage: Sprache als deutsches/englisches Wort ("Polnisch", "Polish", "Türkisch"). ' +
        'Falls Nutzer Sprache nicht kennt: "unknown".',
      parameters: {
        type: 'object',
        properties: {
          targetLanguage: {
            type: 'string',
            description: 'Die Zielsprache als Wort (z.B. "Polnisch", "Türkisch", "Englisch") oder "unknown".',
          },
        },
        required: ['targetLanguage'],
      },
    },
    {
      type: 'function',
      name: 'stop_translation_mode',
      description:
        'Beendet den Übersetzungsmodus und kehrt zum Normalmodus zurück. ' +
        `Nur aufrufen wenn der Nutzer "${agentName}" als Prefix kombiniert mit einem Stop-Verb sagt. ` +
        `Beispiele: "${agentName} Übersetzung beenden", "${agentName} stop translation", "${agentName} stoppen", ` +
        `"${agentName} fine traduzione", "${agentName} arrête la traduction", "${agentName} alto traducción". ` +
        'Ohne Prefix oder ohne Stop-Verb NICHT aufrufen - dann den Satz normal übersetzen.',
      parameters: { type: 'object', properties: {} },
    },
  ];
}

/**
 * Erstellt eine Voice-Session.
 *
 * @param tenant Der Tenant des Users
 * @param userRole Die Rolle des Users innerhalb des Tenants
 * @param isDemoUser Wenn true: Web Speech API, kein OpenAI-Token
 * @param overrides Optionale Präferenzen (Voice-ID, Sprache, VAD, Translator-Mode)
 */
export async function createVoiceSession(
  tenant: TenantConfig,
  userRole: string,
  isDemoUser: boolean,
  overrides?: {
    voiceId?: string;
    locale?: VoiceLocale;
    agentName?: string;
    vadParams?: {
      threshold: number;
      silence_duration_ms: number;
      prefix_padding_ms: number;
    };
    translator?: {
      systemPrompt: string;
      greeting: string;
    };
  }
): Promise<VoiceSessionDescriptor> {
  const isTranslator = !!overrides?.translator;
  const locale = overrides?.locale || 'de';
  const agentName = overrides?.agentName || 'Anni';

  const systemPrompt = isTranslator
    ? overrides!.translator!.systemPrompt
    : buildSystemPrompt(tenant, userRole, locale, agentName);

  // Tools je nach Modus:
  // - Normal: Tenant-Tools + System-Tools (start/stop translation)
  // - Translator: NUR stop_translation_mode (sonst würde KI Vitalwerte etc. fälschlich rufen)
  const systemTools = buildSystemTools(agentName);
  let tools: any[];
  if (isTranslator) {
    tools = systemTools.filter(t => t.name === 'stop_translation_mode');
  } else {
    const availableTools = tenant.tools.filter(
      t => t.enabled_for_roles.includes('all') || t.enabled_for_roles.includes(userRole)
    );
    tools = [...buildToolSchema(availableTools), ...systemTools];
  }

  const effectiveVoiceId = overrides?.voiceId || tenant.agent.voice_id || 'marin';

  if (isDemoUser) {
    return {
      mode: 'demo',
      systemPrompt,
      tools,
      voiceId: effectiveVoiceId,
      language: locale,
    };
  }

  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      'Voice-Backend ist nicht konfiguriert. Bitte den Administrator kontaktieren.'
    );
  }

  const vadParams = overrides?.vadParams ?? {
    threshold: 0.65,
    silence_duration_ms: 700,
    prefix_padding_ms: 300,
  };

  // Im Translator-Mode brauchen wir mehr Geduld - User und Patient pausieren
  // länger zwischen Sätzen, weil sie auf die Übersetzung warten.
  if (isTranslator) {
    vadParams.silence_duration_ms = Math.max(vadParams.silence_duration_ms, 900);
  }

  const response = await fetch('https://api.openai.com/v1/realtime/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-realtime-preview-2024-12-17',
      voice: effectiveVoiceId,
      instructions: systemPrompt,
      // Tools müssen hier mitgegeben werden, sonst kennt das Modell sie nicht
      // und kann sie auch nicht aufrufen. Vorher fehlte das - deshalb hat
      // das Modell auf "Übersetzung starten" nur dialogisch geantwortet,
      // statt das Tool start_translation_mode aufzurufen.
      tools,
      tool_choice: 'auto',
      input_audio_transcription: { model: 'gpt-4o-mini-transcribe' },
      input_audio_noise_reduction: { type: 'near_field' },
      turn_detection: {
        type: 'server_vad',
        threshold: vadParams.threshold,
        prefix_padding_ms: vadParams.prefix_padding_ms,
        silence_duration_ms: vadParams.silence_duration_ms,
        create_response: true,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`OpenAI session creation failed: ${response.status} ${errorText}`);
  }

  const session = await response.json();

  return {
    mode: 'webrtc',
    endpoint: 'https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17',
    ephemeralToken: session.client_secret?.value,
    systemPrompt,
    tools,
    voiceId: effectiveVoiceId,
    language: locale,
    isTranslator,
    translatorGreeting: isTranslator ? overrides!.translator!.greeting : undefined,
  };
}
