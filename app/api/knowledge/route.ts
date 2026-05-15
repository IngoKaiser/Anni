import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { logAuditEvent } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30; // Web-Search braucht Zeit

/**
 * Pflegewissen-Endpoint mit Web-Search.
 *
 * Architektur: Wir nutzen OpenAI's gpt-4o-mini-search-preview Modell, das
 * nativ Web-Search in der Chat Completions API hat. Das vermeidet das
 * Komplexitäts-Overhead einer separaten Search-API plus Re-Ranking.
 *
 * Quellen-Filterung: Wir geben dem Modell im System-Prompt eine Whitelist
 * von vertrauenswürdigen Domains für deutsche Pflege/Medizin. Das Modell
 * sucht primär dort. Wenn keine Treffer auf der Whitelist → klare Markierung
 * "aus Allgemeinwissen" damit der Nutzer weiß dass keine kuratierte Quelle
 * verwendet wurde.
 *
 * Audit-Trail: Antwort enthält Quellen-URLs strukturiert zurück (aus den
 * Citations des Search-Modells extrahiert), damit das Frontend sie als
 * Karte rendern kann.
 */

// Vertrauenswürdige Domains für Pflege/Medizin in Deutschland.
// Wenn das Modell hier Quellen findet, ist die Antwort kuratiert.
// Sonst markieren wir die Antwort als "Allgemeinwissen".
const TRUSTED_DOMAINS = [
  'bfarm.de',           // Bundesinstitut für Arzneimittel und Medizinprodukte
  'rki.de',             // Robert Koch-Institut
  'awmf.org',           // Leitlinien-Register
  'gesund.bund.de',     // Offizielles Gesundheitsportal Bund
  'pflege.de',          // Etablierter Pflege-Anbieter
  'springerpflege.de',  // Springer Verlag Pflege
  'dimdi.de',           // Deutsches Institut für Medizinische Dokumentation
  'g-ba.de',            // Gemeinsamer Bundesausschuss
  'aerzteblatt.de',     // Deutsches Ärzteblatt
  'mdr.de',             // Medizinischer Dienst
  'who.int',            // WHO (international, oft hilfreich für Background)
  'ncbi.nlm.nih.gov',   // PubMed
];

interface KnowledgeRequest {
  query: string;
  locale?: string;
}

interface Citation {
  url: string;
  title: string;
  domain: string;
  isTrusted: boolean;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: 'Wissens-Backend nicht konfiguriert' },
      { status: 503 }
    );
  }

  let body: KnowledgeRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  if (!body.query || typeof body.query !== 'string' || body.query.length < 3) {
    return NextResponse.json({ error: 'Frage zu kurz' }, { status: 400 });
  }

  // Query-Länge begrenzen gegen Missbrauch
  const safeQuery = body.query.slice(0, 500);
  const locale = body.locale || 'de';

  // Locale-spezifische Antwort-Anweisung
  const languageInstructions: Record<string, string> = {
    de: 'Antworte ausschließlich auf Deutsch.',
    en: 'Answer only in English.',
    it: 'Rispondi solo in italiano.',
    fr: 'Réponds uniquement en français.',
    es: 'Responde solo en español.',
  };
  const langInstruction = languageInstructions[locale] || languageInstructions.de;

  const systemPrompt = `Du bist ein Assistent für Pflegekräfte in Deutschland. Beantworte Pflege- und Medizin-Fragen.

REGELN:
1. Suche bevorzugt auf diesen vertrauenswürdigen Quellen:
   ${TRUSTED_DOMAINS.join(', ')}
2. Wenn du gute Information aus diesen Quellen findest: Antworte basierend darauf
   und zitiere die Quellen.
3. Wenn keine vertrauenswürdige Quelle eine Antwort hat: Antworte basierend auf
   deinem Allgemeinwissen, aber MARKIERE die Antwort am Anfang mit:
   "⚠ Hinweis: Diese Antwort stammt aus allgemeinem KI-Wissen, nicht aus einer
   geprüften Pflege-Quelle. Bitte verifiziere bei Bedarf mit einer Fachperson."
4. Halte die Antwort PRAGMATISCH und PFLEGEKRAFT-ORIENTIERT - kurz, klar, mit
   konkreten Handlungsschritten wo möglich.
5. Bei medizinischen Entscheidungen IMMER auf ärztliche Konsultation verweisen.
6. ${langInstruction}

WICHTIG: Antworte mit der reinen Information - das System hängt automatisch
einen Quellen-Audit-Trail an.`;

  try {
    const startTime = Date.now();

    const llmRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini-search-preview',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: safeQuery },
        ],
        // gpt-4o-mini-search-preview unterstützt KEIN temperature/tools - siehe Doku
        // Wir nutzen die Default-Einstellungen.
        max_tokens: 800,
      }),
    });

    if (!llmRes.ok) {
      const errText = await llmRes.text().catch(() => '');
      console.error('[knowledge] Search failed:', llmRes.status, errText);
      return NextResponse.json(
        { error: `Wissens-Suche fehlgeschlagen (${llmRes.status})` },
        { status: 502 }
      );
    }

    const llmData = await llmRes.json();
    const answer: string = llmData.choices?.[0]?.message?.content || '';
    const annotations = llmData.choices?.[0]?.message?.annotations || [];

    // Citations aus Annotations extrahieren.
    // Format der Search-Preview-API: annotations: [{type: 'url_citation', url_citation: {url, title, ...}}]
    const citations: Citation[] = [];
    const seenUrls = new Set<string>();
    for (const ann of annotations) {
      if (ann.type !== 'url_citation') continue;
      const c = ann.url_citation;
      if (!c?.url || seenUrls.has(c.url)) continue;
      seenUrls.add(c.url);
      let domain = '';
      try {
        domain = new URL(c.url).hostname.replace(/^www\./, '');
      } catch {
        domain = c.url;
      }
      const isTrusted = TRUSTED_DOMAINS.some(d => domain.endsWith(d));
      citations.push({
        url: c.url,
        title: c.title || domain,
        domain,
        isTrusted,
      });
    }

    // Wenn KEINE Citations da sind UND die Antwort den ⚠-Marker nicht hat,
    // füge den Allgemeinwissens-Hinweis selbst hinzu - falls das Modell ihn vergisst.
    let finalAnswer = answer;
    const trustedCount = citations.filter(c => c.isTrusted).length;
    if (trustedCount === 0 && !finalAnswer.startsWith('⚠')) {
      const allgWarning: Record<string, string> = {
        de: '⚠ Hinweis: Diese Antwort stammt aus allgemeinem KI-Wissen, nicht aus einer geprüften Pflege-Quelle. Bitte verifiziere bei Bedarf mit einer Fachperson.',
        en: '⚠ Note: This answer comes from general AI knowledge, not from a verified care source. Please verify with a professional if needed.',
        it: '⚠ Nota: Questa risposta proviene da conoscenza AI generale, non da una fonte di cura verificata. Verifica con un professionista se necessario.',
        fr: '⚠ Note : Cette réponse provient des connaissances générales de l\'IA, pas d\'une source de soins vérifiée. Vérifiez avec un professionnel si nécessaire.',
        es: '⚠ Nota: Esta respuesta proviene del conocimiento general de IA, no de una fuente de atención verificada. Verifica con un profesional si es necesario.',
      };
      finalAnswer = (allgWarning[locale] || allgWarning.de) + '\n\n' + finalAnswer;
    }

    const elapsed = Date.now() - startTime;

    // Audit-Log persistieren (lokal Dev: console, sonst DB)
    logAuditEvent({
      event: 'knowledge.query',
      userId: session.user.id || session.user.email || 'unknown',
      userEmail: session.user.email || 'unknown',
      tenantId: session.user.tenantId || 'unknown',
      isDemoUser: session.user.isDemoUser ?? false,
      metadata: {
        query: safeQuery,
        citationCount: citations.length,
        trustedCount,
        elapsedMs: elapsed,
      },
    }).catch(() => {});

    return NextResponse.json({
      answer: finalAnswer,
      citations,
      hasTrustedSources: trustedCount > 0,
      elapsedMs: elapsed,
    });
  } catch (err: any) {
    console.error('[knowledge] Failed:', err);
    return NextResponse.json(
      { error: err?.message || 'Wissens-Suche fehlgeschlagen' },
      { status: 500 }
    );
  }
}
