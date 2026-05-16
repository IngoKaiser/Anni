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

# Tool-Aufrufe — IMMER mit Bestätigung

WICHTIG: Bevor du ein **schreibendes** Tool aufrufst (alles was Daten einträgt,
dokumentiert, eine Benachrichtigung sendet, einen Termin setzt etc.):

1. Fasse strukturiert zusammen WAS du gleich tun wirst.
   Beispiel: "Ich dokumentiere folgenden Einsatz bei Frau Müller: Heute 14:30,
   Klage über starke Schmerzen, Ibuprofen 400mg gegeben. Soll ich das so eintragen?"
2. Frage den Nutzer ausdrücklich nach Bestätigung ("Ja, eintragen" / "Nein, korrigieren").
3. RUF DAS TOOL ERST AUF wenn der Nutzer "Ja", "Bestätige", "Ok" oder gleichwertig sagt.
   Bei "Nein" oder Korrektur: passe an und frage erneut.

Lese-Tools (Informationen nachschlagen, Pflegewissen abrufen, Status prüfen)
darfst du DIREKT aufrufen ohne Bestätigung - dort gibt es nichts rückgängig zu machen.
Sage dabei aber kurz WAS du nachschlägst.

# Übersetzungsmodus

Du hast Tools start_translation_mode und stop_translation_mode für Dolmetscher-Anfragen.

## Aktivierung
Wenn der Nutzer eine Übersetzung möchte ("Übersetzung starten", "translation mode",
"Dolmetscher", "ins Polnische übersetzen" etc.), rufe start_translation_mode auf.

- Sprache direkt mitgenannt: SOFORT start_translation_mode aufrufen, keine Rückfrage.
- Sprache fehlt: einmal kurz "In welche Sprache?" fragen, dann beim nächsten Input
  (z.B. nur das Wort "Polnisch") SOFORT start_translation_mode aufrufen.
- Sprache unbekannt ("weiß ich nicht"): start_translation_mode mit targetLanguage="unknown".
- Keine verbale Bestätigung wie "Okay, ich übersetze". Sofort Tool.

## Beendigung
Wenn der Nutzer den Modus beenden möchte ("Übersetzung beenden", "stop translation",
"Dolmetscher aus" etc.), rufe stop_translation_mode auf.

## Wichtige Hinweise zum Übersetzungsmodus
- Übersetzungs-Aktivierungs/Stop-Befehle brauchen KEINE Bestätigung. Direkt aufrufen.
- Mache niemals zwei Nachfragen hintereinander beim Aktivieren.
- Die eigentliche Übersetzung machst du nicht - das Tool aktiviert einen separaten Modus.

WICHTIG: ${langInstruction} Antworte immer auf ${langName}.`;
}

function buildToolSchema(tools: TenantTool[]): any[] {
  return tools.map(tool => {
    // Falls Tool-Definition Parameters hat: strukturierte Object-Form
    if (tool.parameters && tool.parameters.length > 0) {
      const properties: Record<string, any> = {};
      const required: string[] = [];
      for (const p of tool.parameters) {
        properties[p.name] = {
          type: p.type,
          description: p.description || `${p.name} für ${tool.label}`,
        };
        if (p.required) required.push(p.name);
      }
      return {
        type: 'function',
        name: tool.id,
        description: tool.description,
        parameters: {
          type: 'object',
          properties,
          ...(required.length > 0 ? { required } : {}),
        },
      };
    }
    // Fallback: Free-form Input
    return {
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
    };
  });
}

/**
 * System-Tools (verfügbar in jeder Realtime-Session unabhängig vom Tenant).
 * Wird als Funktion gebaut, weil die Tool-Description den User-konfigurierten
 * Agent-Namen als Trigger enthält.
 */
function buildSystemTools(_agentName: string): any[] {
  return [
    {
      type: 'function',
      name: 'lookup_pflegewissen',
      description:
        'Schlägt Pflege- oder Medizin-Wissen aus vertrauenswürdigen Online-Quellen nach ' +
        '(RKI, BfArM, Leitlinien, Gesundheitsportal Bund, Ärzteblatt etc.). ' +
        'Aufrufen wenn der Nutzer eine fachliche Frage stellt, die Wissen über ' +
        'Krankheitsbilder, Pflegemaßnahmen, Wirkstoffe, Leitlinien, Hygiene, etc. erfordert. ' +
        'Beispiele: "Wie behandelt man Dekubitus Grad 2?", "Wechselwirkungen von Marcumar?", ' +
        '"Maßnahmen bei MRSA-Verdacht?". ' +
        'Das Tool antwortet mit Text und Quellen-Citations - sage dem Nutzer kurz WAS du nachschlägst.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Die Frage in eigenen Worten formuliert (Deutsch oder App-Sprache).',
          },
        },
        required: ['query'],
      },
    },
    {
      type: 'function',
      name: 'start_translation_mode',
      description:
        'Aktiviert den bidirektionalen Dolmetscher-Modus. ' +
        'Aufrufen wenn der Nutzer eine Übersetzungs-Anfrage stellt ("Übersetzung starten", ' +
        '"translation mode", "Dolmetscher", "ins Polnische übersetzen" etc.). ' +
        'WANN AUFRUFEN: (1) Direkt wenn Nutzer eine Sprache nennt zusammen mit Übersetzungs-Wunsch ' +
        '("Übersetze ins Polnische") - sofort aufrufen. (2) Nach einer Rückfrage "In welche Sprache?" ' +
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
        'Aufrufen wenn der Nutzer den Modus beenden möchte ("Übersetzung beenden", ' +
        '"stop translation", "Dolmetscher aus", "fine traduzione", "arrête la traduction", ' +
        '"alto traducción" etc.). Sofort aufrufen, keine Bestätigung nötig.',
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

  // OpenAI Realtime GA API (seit Mai 2026):
  // - Endpoint zur Token-Erzeugung: /v1/realtime/client_secrets (statt /sessions)
  // - WebRTC-Endpoint: /v1/realtime/calls (statt /realtime?model=)
  // - Model: 'gpt-realtime' (statt 'gpt-4o-realtime-preview-2024-12-17')
  // - Session-Config muss in { session: { type: 'realtime', ... } } gewrappt sein
  // - voice/transcription/turn_detection unter audio.input.* und audio.output.*
  // - KEIN 'OpenAI-Beta'-Header mehr
  const sessionConfig = {
    type: 'realtime',
    model: 'gpt-realtime',
    instructions: systemPrompt,
    tools,
    tool_choice: 'auto',
    audio: {
      input: {
        transcription: { model: 'gpt-4o-mini-transcribe' },
        noise_reduction: { type: 'near_field' },
        turn_detection: {
          type: 'server_vad',
          threshold: vadParams.threshold,
          prefix_padding_ms: vadParams.prefix_padding_ms,
          silence_duration_ms: vadParams.silence_duration_ms,
          create_response: true,
        },
      },
      output: {
        voice: effectiveVoiceId,
      },
    },
  };

  const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      session: sessionConfig,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`OpenAI session creation failed: ${response.status} ${errorText}`);
  }

  const session = await response.json();

  // GA-API liefert das ephemeral secret im Feld 'value' (am Wurzel-Objekt,
  // nicht mehr verschachtelt unter client_secret wie in der Beta).
  const ephemeralToken = session.value || session.client_secret?.value;

  return {
    mode: 'webrtc',
    // WebRTC-Endpoint hat sich geändert - /calls statt /realtime
    endpoint: 'https://api.openai.com/v1/realtime/calls?model=gpt-realtime',
    ephemeralToken,
    systemPrompt,
    tools,
    voiceId: effectiveVoiceId,
    language: locale,
    isTranslator,
    translatorGreeting: isTranslator ? overrides!.translator!.greeting : undefined,
  };
}
