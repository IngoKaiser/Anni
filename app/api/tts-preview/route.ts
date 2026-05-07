import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Whitelist - nur valide Voice-IDs durchlassen
const ALLOWED_VOICES = new Set([
  'alloy', 'ash', 'ballad', 'coral', 'echo', 'fable',
  'nova', 'onyx', 'sage', 'shimmer', 'verse',
]);

// Maximale Text-Länge für Proben - verhindert Missbrauch als TTS-Service
const MAX_PREVIEW_LENGTH = 200;

/**
 * Liefert eine kurze Audio-Probe einer OpenAI-Stimme.
 *
 * Genutzt im Settings-Modal um Stimmen vorzuhören.
 * Kein Streaming - kompakter MP3-Download, ~30-40 KB pro Probe.
 *
 * Kosten: TTS API kostet $15 pro 1M Zeichen.
 * Eine typische Probe (40 Zeichen) kostet damit 0,0006 USD = praktisch nichts.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: 'TTS-Backend nicht konfiguriert' },
      { status: 503 }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { voice, text } = body;

  if (typeof voice !== 'string' || !ALLOWED_VOICES.has(voice)) {
    return NextResponse.json({ error: 'Ungültige Stimme' }, { status: 400 });
  }

  if (typeof text !== 'string' || text.length === 0) {
    return NextResponse.json({ error: 'Kein Text angegeben' }, { status: 400 });
  }

  // Längen-Limit - Probe-Endpoint, kein TTS-Service
  const safeText = text.slice(0, MAX_PREVIEW_LENGTH);

  try {
    const ttsRes = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini-tts',
        voice,
        input: safeText,
        response_format: 'mp3',
        speed: 1.0,
      }),
    });

    if (!ttsRes.ok) {
      const errorText = await ttsRes.text().catch(() => '');
      console.error('[tts-preview] OpenAI failed:', ttsRes.status, errorText);
      return NextResponse.json(
        { error: 'Stimm-Probe konnte nicht erzeugt werden' },
        { status: 502 }
      );
    }

    // MP3-Bytes direkt durchreichen
    const audioBuffer = await ttsRes.arrayBuffer();

    return new NextResponse(audioBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (err: any) {
    console.error('[tts-preview] Failed:', err);
    return NextResponse.json(
      { error: err?.message || 'TTS-Fehler' },
      { status: 500 }
    );
  }
}
