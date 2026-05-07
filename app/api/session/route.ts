import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getTenantById } from '@/lib/tenants';
import { createVoiceSession } from '@/lib/voice';
import { logAuditEvent } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || !session.user.tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const tenant = getTenantById(session.user.tenantId);
  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
  }

  try {
    const userRole = session.user.role || 'user';
    const isDemoUser = session.user.isDemoUser ?? false;
    const voiceSession = await createVoiceSession(tenant, userRole, isDemoUser);

    logAuditEvent({
      event: 'session.started',
      userId: session.user.id || session.user.email,
      userEmail: session.user.email!,
      tenantId: tenant.tenant.id,
      isDemoUser,
      metadata: { mode: voiceSession.mode },
    }).catch(() => {});

    return NextResponse.json(voiceSession);
  } catch (err: any) {
    console.error('[session] Failed:', err);
    const message = err?.message || 'Session creation failed';

    // Konfigurations-Fehler: Voice-Backend nicht aktiviert.
    // 503 Service Unavailable ist semantisch korrekter als 500.
    const isConfigError = message.includes('nicht konfiguriert') ||
                          message.includes('nicht aktiviert');

    return NextResponse.json(
      { error: message, code: isConfigError ? 'voice_backend_unavailable' : 'session_failed' },
      { status: isConfigError ? 503 : 500 }
    );
  }
}
