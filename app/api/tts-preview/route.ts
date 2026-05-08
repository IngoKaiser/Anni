import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_VOICES = new Set([
  'alloy', 'ash', 'ballad', 'coral', 'echo',
  'sage', 'shimmer', 'verse', 'marin', 'cedar',
]);

const MAX_PREVIEW_LENGTH = 200;

/**
 * Sprach-spezifische TTS-Anweisungen.
 * Müssen mit den App-Sprachen in lib/i18n.tsx übereinstimmen.
 * Bei unbekannten Codes fällt es auf Englisch zurück.
 */
const TTS_INSTRUCTIONS: Record<string, string> = {
  de: 'Sprich auf Deutsch mit natürlicher, klarer Aussprache. Freundlicher, professioneller Ton einer Pflege-Assistentin.',
  en: 'Speak in clear English with a natural, friendly tone. Warm and professional, like a care assistant.',
  it: 'Parla in italiano con pronuncia chiara e naturale. Tono amichevole e professionale di una assistente di cura.',
  fr: 'Parle en français avec une prononciation claire et naturelle. Ton amical et professionnel d\'une assistante de soins.',
  es: 'Habla en español con pronunciación clara y natural. Tono amable y profesional de una asistente de cuidados.',
};

/**
 * Liefert eine kurze Audio-Probe einer OpenAI-Stimme.
 *
 * Body:
 *   { voice: string, text: string, locale?: string }
 *
 * locale steuert die TTS-Aussprache-Anweisung. Standard: 'en'.
 * Der text kommt vom Client und enthält bereits den lokalisierten Beispielsatz.
 *
 * Kosten: TTS API ~$0.0006 pro Probe.
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

  const { voice, text, locale } = body;

  if (typeof voice !== 'string' || !ALLOWED_VOICES.has(voice)) {
    return NextResponse.json({ error: 'Ungültige Stimme' }, { status: 400 });
  }

  if (typeof text !== 'string' || text.length === 0) {
    return NextResponse.json({ error: 'Kein Text angegeben' }, { status: 400 });
  }

  const safeText = text.slice(0, MAX_PREVIEW_LENGTH);
  const instructions = TTS_INSTRUCTIONS[locale as string] || TTS_INSTRUCTIONS.en;

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
        instructions,
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
