/**
 * Voice Backend Adapter
 *
 * Variante C: Pro User wird entschieden welcher Voice-Stack genutzt wird.
 * - Demo-User -> Web Speech API im Browser (Frontend handhabt)
 * - Echte User mit OPENAI_API_KEY gesetzt -> OpenAI Realtime API
 * - Echte User ohne OPENAI_API_KEY -> Fallback auf Web Speech API
 *
 * Designed als Adapter-Pattern - spätere Backends (Anthropic, Gemini Live)
 * können das gleiche Interface implementieren.
 */

import type { TenantConfig, TenantTool } from './tenants';

export interface VoiceSessionDescriptor {
  mode: 'webrtc' | 'demo';
  endpoint?: string;
  ephemeralToken?: string;
  systemPrompt: string;
  tools: any[];
  voiceId?: string;
  language?: string;
}

function buildSystemPrompt(tenant: TenantConfig, userRole: string): string {
  const availableTools = tenant.tools.filter(
    t => t.enabled_for_roles.includes('all') || t.enabled_for_roles.includes(userRole)
  );

  const toolDescriptions = availableTools
    .map(t => `- ${t.label}: ${t.description}`)
    .join('\n');

  return `${tenant.agent.persona}

Verfügbare Tools für deine Rolle:
${toolDescriptions}

Nutze die Tools selbständig, wenn der Nutzer eine Anfrage stellt, die zu einem Tool passt.
Bestätige Tool-Aufrufe verbal kurz und prägnant.
Sprich auf ${tenant.tenant.default_language === 'de' ? 'Deutsch' : tenant.tenant.default_language}.`;
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
 * Erstellt eine Voice-Session.
 *
 * @param tenant Der Tenant des Users
 * @param userRole Die Rolle des Users innerhalb des Tenants
 * @param isDemoUser Wenn true: Web Speech API, kein OpenAI-Token
 */
export async function createVoiceSession(
  tenant: TenantConfig,
  userRole: string,
  isDemoUser: boolean
): Promise<VoiceSessionDescriptor> {
  const systemPrompt = buildSystemPrompt(tenant, userRole);
  const availableTools = tenant.tools.filter(
    t => t.enabled_for_roles.includes('all') || t.enabled_for_roles.includes(userRole)
  );
  const tools = buildToolSchema(availableTools);

  // Demo-User nutzen IMMER Web Speech API + Mock-Antworten
  if (isDemoUser) {
    return {
      mode: 'demo',
      systemPrompt,
      tools,
      voiceId: tenant.agent.voice_id,
      language: tenant.tenant.default_language,
    };
  }

  // Echter User, aber OpenAI nicht konfiguriert → klar fehlschlagen.
  // Wir wollen NICHT einen Demo-Dialog vor echten Usern abspielen,
  // das war ein verwirrender Bug in früheren Versionen.
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      'Voice-Backend ist nicht konfiguriert. Bitte den Administrator kontaktieren.'
    );
  }

  // Echte User mit konfiguriertem OpenAI: Realtime API
  const response = await fetch('https://api.openai.com/v1/realtime/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-realtime-preview-2024-12-17',
      voice: tenant.agent.voice_id || 'alloy',
      instructions: systemPrompt,
      input_audio_transcription: { model: 'gpt-4o-mini-transcribe' },
      turn_detection: {
        type: 'server_vad',
        threshold: 0.5,
        prefix_padding_ms: 300,
        silence_duration_ms: 700,
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
    voiceId: tenant.agent.voice_id,
    language: tenant.tenant.default_language,
  };
}
