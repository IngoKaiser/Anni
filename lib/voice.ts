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

function buildSystemPrompt(tenant: TenantConfig, userRole: string, locale: VoiceLocale): string {
  const availableTools = tenant.tools.filter(
    t => t.enabled_for_roles.includes('all') || t.enabled_for_roles.includes(userRole)
  );

  const toolDescriptions = availableTools
    .map(t => `- ${t.label}: ${t.description}`)
    .join('\n');

  const langName = LOCALE_NAMES[locale];
  const langInstruction = LANGUAGE_INSTRUCTION[locale];

  // Persona kommt aus YAML auf Deutsch - das ist okay, der Prompt ist nicht
  // sichtbar für den User. Die Antwort selbst ist durch die Sprach-Anweisung
  // immer in der gewünschten App-Sprache.
  return `${tenant.agent.persona}

Verfügbare Tools für deine Rolle:
${toolDescriptions}

Nutze die Tools selbständig, wenn der Nutzer eine Anfrage stellt, die zu einem Tool passt.
Bestätige Tool-Aufrufe verbal kurz und prägnant.

ÜBERSETZUNGSMODUS:
Wenn der Nutzer "Übersetzung starten", "start translation", "avvia traduzione",
"démarrer traduction", "iniciar traducción" oder ähnlich sagt, rufe das Tool
start_translation_mode auf. Frage VORHER nach der Zielsprache, falls nicht erwähnt.
Wenn der Nutzer sagt er kennt die Sprache nicht, übergib "unknown" als targetLanguage -
das System erkennt sie dann anhand der nächsten Aussage selbst.

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
 */
const SYSTEM_TOOLS: any[] = [
  {
    type: 'function',
    name: 'start_translation_mode',
    description:
      'Startet den Übersetzungsmodus zwischen der App-Sprache und einer anderen Sprache. ' +
      'Aufrufen wenn der Nutzer eine Übersetzungs-Anfrage stellt. ' +
      'targetLanguage ist die Zielsprache als Wort (z.B. "Polnisch", "Polish"), oder "unknown".',
    parameters: {
      type: 'object',
      properties: {
        targetLanguage: {
          type: 'string',
          description: 'Die Zielsprache, oder "unknown" wenn aus dem Kontext erkannt werden soll.',
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
      'Aufrufen wenn jemand "Anni Übersetzung beenden", "Anni stop translation" o.ä. sagt.',
    parameters: { type: 'object', properties: {} },
  },
];

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

  const systemPrompt = isTranslator
    ? overrides!.translator!.systemPrompt
    : buildSystemPrompt(tenant, userRole, locale);

  // Tools je nach Modus:
  // - Normal: Tenant-Tools + System-Tools (start/stop translation)
  // - Translator: NUR stop_translation_mode (sonst würde KI Vitalwerte etc. fälschlich rufen)
  let tools: any[];
  if (isTranslator) {
    tools = SYSTEM_TOOLS.filter(t => t.name === 'stop_translation_mode');
  } else {
    const availableTools = tenant.tools.filter(
      t => t.enabled_for_roles.includes('all') || t.enabled_for_roles.includes(userRole)
    );
    tools = [...buildToolSchema(availableTools), ...SYSTEM_TOOLS];
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
