import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getTenantById } from '@/lib/tenants';
import { createVoiceSession } from '@/lib/voice';
import { logAuditEvent } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Whitelist: nur diese Voice-IDs werden akzeptiert (gegen Injection)
// Muss mit OPENAI_VOICES in lib/use-user-settings.ts übereinstimmen.
// Stand Mai 2026: Realtime API unterstützt KEINE der Stimmen nova/fable/onyx -
// diese gibt es nur in der TTS-API. Hier daher ohne diese drei.
const ALLOWED_VOICES = new Set([
  'alloy', 'ash', 'ballad', 'coral', 'echo',
  'sage', 'shimmer', 'verse', 'marin', 'cedar',
]);

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || !session.user.tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const tenant = getTenantById(session.user.tenantId);
  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
  }

  // User-Präferenzen aus Body lesen (z.B. Stimmen-Override)
  let body: any = {};
  try { body = await req.json(); } catch { /* leerer Body ist okay */ }
  const voiceOverride =
    typeof body?.voiceId === 'string' && ALLOWED_VOICES.has(body.voiceId)
      ? body.voiceId
      : undefined;

  try {
    const userRole = session.user.role || 'user';
    const isDemoUser = session.user.isDemoUser ?? false;
    const voiceSession = await createVoiceSession(tenant, userRole, isDemoUser, {
      voiceId: voiceOverride,
    });

    logAuditEvent({
      event: 'session.started',
      userId: session.user.id || session.user.email,
      userEmail: session.user.email!,
      tenantId: tenant.tenant.id,
      isDemoUser,
      metadata: { mode: voiceSession.mode, voiceId: voiceSession.voiceId },
    }).catch(() => {});

    return NextResponse.json(voiceSession);
  } catch (err: any) {
    console.error('[session] Failed:', err);
    const message = err?.message || 'Session creation failed';

    const isConfigError = message.includes('nicht konfiguriert') ||
                          message.includes('nicht aktiviert');

    return NextResponse.json(
      { error: message, code: isConfigError ? 'voice_backend_unavailable' : 'session_failed' },
      { status: isConfigError ? 503 : 500 }
    );
  }
}
