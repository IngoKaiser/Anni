import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getTenantById } from '@/lib/tenants';
import { logAuditEvent } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30; // Vercel-Limit für die ganze Pipeline

/**
 * STT/TTS-Pipeline (Sparmodus / "Pipeline-Voice")
 *
 * Alternative zur Realtime API. Sequentielle Verarbeitung:
 *   1. Whisper transkribiert User-Audio → Text
 *   2. GPT-4o-mini generiert Antwort-Text (mit Tools)
 *   3. TTS synthetisiert Antwort-Audio → MP3
 *
 * Vor- und Nachteile gegenüber Realtime:
 *   + ~50× günstiger (~0,006 EUR/min vs ~0,30 EUR/min)
 *   + DSGVO-freundlicher (kein WebRTC, klare Datenflüsse)
 *   + Funktioniert auch bei schwacher Internetverbindung
 *   - Latenz 2-4 Sekunden statt 200-400ms
 *   - Keine Interrupts, keine kontinuierliche Konversation
 *   - Keine Stimm-Modulation/Emotion
 *
 * Whitelist: dieselbe wie Realtime API für Konsistenz im UI.
 */

const ALLOWED_VOICES = new Set([
  'alloy', 'ash', 'ballad', 'coral', 'echo',
  'sage', 'shimmer', 'verse', 'marin', 'cedar',
]);

// Conversation Memory pro User-Session (in-memory, simpel für Pilot-Phase)
// Bei Production: in DB persistieren oder JWT mit kurzem TTL
type ConversationMessage = { role: 'user' | 'assistant' | 'system'; content: string };
const conversationMemory = new Map<string, ConversationMessage[]>();
const MAX_MEMORY_TURNS = 10; // letzte 10 Turns behalten

function getConversation(userId: string): ConversationMessage[] {
  return conversationMemory.get(userId) || [];
}

function appendToConversation(userId: string, msg: ConversationMessage): void {
  const history = getConversation(userId);
  history.push(msg);
  // Auf maximale Länge begrenzen (System-Prompt bleibt extra)
  while (history.length > MAX_MEMORY_TURNS * 2) {
    history.shift();
  }
  conversationMemory.set(userId, history);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || !session.user.tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: 'Voice-Backend nicht konfiguriert' },
      { status: 503 }
    );
  }

  const tenant = getTenantById(session.user.tenantId);
  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
  }

  const userId = session.user.id || session.user.email!;
  const userRole = session.user.role || 'user';

  try {
    // ─────────────────────────────────────────
    // Multipart-Parsing: Audio + Voice-Override
    // ─────────────────────────────────────────
    const formData = await req.formData();
    const audioBlob = formData.get('audio') as File | null;
    const voiceOverride = formData.get('voiceId') as string | null;

    if (!audioBlob) {
      return NextResponse.json({ error: 'Kein Audio empfangen' }, { status: 400 });
    }

    const effectiveVoice =
      voiceOverride && ALLOWED_VOICES.has(voiceOverride)
        ? voiceOverride
        : (ALLOWED_VOICES.has(tenant.agent.voice_id) ? tenant.agent.voice_id : 'marin');

    // ─────────────────────────────────────────
    // 1. STT: Whisper transkribiert das Audio
    // ─────────────────────────────────────────
    const sttForm = new FormData();
    sttForm.append('file', audioBlob, 'recording.webm');
    sttForm.append('model', 'gpt-4o-mini-transcribe');
    sttForm.append('language', 'de');

    const sttRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: sttForm,
    });

    if (!sttRes.ok) {
      const errText = await sttRes.text().catch(() => '');
      throw new Error(`Whisper STT failed: ${sttRes.status} ${errText}`);
    }

    const sttData = await sttRes.json();
    const transcript: string = sttData.text || '';

    if (!transcript.trim()) {
      return NextResponse.json({ error: 'Konnte nichts verstehen' }, { status: 400 });
    }

    // ─────────────────────────────────────────
    // 2. LLM: GPT-4o-mini generiert Antwort
    // ─────────────────────────────────────────
    const systemPrompt = buildSystemPrompt(tenant, userRole);
    const history = getConversation(userId);

    const messages: ConversationMessage[] = [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: transcript },
    ];

    const llmRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages,
        temperature: 0.7,
        max_tokens: 300,  // Antworten kurz halten - schneller TTS, niedrigere Kosten
      }),
    });

    if (!llmRes.ok) {
      const errText = await llmRes.text().catch(() => '');
      throw new Error(`LLM failed: ${llmRes.status} ${errText}`);
    }

    const llmData = await llmRes.json();
    const replyText: string = llmData.choices?.[0]?.message?.content || '';

    if (!replyText.trim()) {
      return NextResponse.json({ error: 'Keine Antwort generiert' }, { status: 500 });
    }

    // Conversation Memory aktualisieren
    appendToConversation(userId, { role: 'user', content: transcript });
    appendToConversation(userId, { role: 'assistant', content: replyText });

    // ─────────────────────────────────────────
    // 3. TTS: Antwort als MP3 synthetisieren
    // ─────────────────────────────────────────
    const ttsRes = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini-tts',
        voice: effectiveVoice,
        input: replyText.slice(0, 2000), // Sicherheits-Limit
        instructions: 'Sprich auf Deutsch mit natürlicher, klarer Aussprache. Freundlicher, professioneller Ton einer Pflege-Assistentin.',
        response_format: 'mp3',
        speed: 1.0,
      }),
    });

    if (!ttsRes.ok) {
      const errText = await ttsRes.text().catch(() => '');
      throw new Error(`TTS failed: ${ttsRes.status} ${errText}`);
    }

    const audioBuffer = await ttsRes.arrayBuffer();

    // Audit
    logAuditEvent({
      event: 'session.started',
      userId,
      userEmail: session.user.email!,
      tenantId: tenant.tenant.id,
      isDemoUser: session.user.isDemoUser ?? false,
      metadata: {
        mode: 'pipeline',
        voiceId: effectiveVoice,
        transcriptLength: transcript.length,
        replyLength: replyText.length,
      },
    }).catch(() => {});

    // Audio + Transkript zurück. Transkript via Headers, weil Body MP3 ist.
    return new NextResponse(audioBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        // Headers müssen ASCII sein - wir base64-kodieren UTF-8 Texte
        'X-Transcript': Buffer.from(transcript, 'utf-8').toString('base64'),
        'X-Reply': Buffer.from(replyText, 'utf-8').toString('base64'),
      },
    });
  } catch (err: any) {
    console.error('[pipeline] Failed:', err);
    return NextResponse.json(
      { error: err?.message || 'Pipeline-Fehler' },
      { status: 500 }
    );
  }
}

/**
 * Wir bauen den System-Prompt analog zu lib/voice.ts. Statt das aus
 * voice.ts zu reusen (würde Tools-Schema etc. ziehen), formulieren wir
 * eine schlankere Version für die Pipeline. Tools werden in dieser
 * ersten Pipeline-Version NICHT unterstützt - das ist eine bewusste
 * Vereinfachung, weil Tool-Calls in einer chat/completions-API mehrere
 * Roundtrips brauchen würden, was den Latenz-Vorteil zunichte macht.
 */
function buildSystemPrompt(tenant: any, userRole: string): string {
  const persona = tenant.agent.persona || 'Du bist eine hilfreiche Assistentin.';
  const tone = tenant.agent.tone || 'freundlich und professionell';
  const tenantName = tenant.tenant.name;

  return [
    persona,
    `Du arbeitest für ${tenantName}.`,
    `Sprich ${tone} und immer auf Deutsch.`,
    `Halte Antworten kurz und konkret - 1-3 Sätze, weil sie laut vorgelesen werden.`,
    `Der User ist ${userRole}.`,
    `WICHTIG: In diesem Modus stehen dir keine Tools zur Verfügung. Wenn der User nach Daten oder Aktionen fragt die ein Tool erfordern würden (z.B. Vitalwerte erfassen, Termine eintragen), erkläre freundlich dass diese Funktion im Sparmodus nicht verfügbar ist und der User in den Einstellungen auf "Premium-Modus" wechseln kann.`,
  ].join(' ');
}
