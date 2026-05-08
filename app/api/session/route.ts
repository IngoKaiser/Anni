import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getTenantById } from '@/lib/tenants';
import { createVoiceSession, type VoiceLocale } from '@/lib/voice';
import { logAuditEvent } from '@/lib/audit';
import {
  resolveLanguage,
  buildTranslatorPrompt,
  buildTranslatorGreeting,
} from '@/lib/translation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_VOICES = new Set([
  'alloy', 'ash', 'ballad', 'coral', 'echo',
  'sage', 'shimmer', 'verse', 'marin', 'cedar',
]);

const ALLOWED_LOCALES = new Set<VoiceLocale>(['de', 'en', 'it', 'fr', 'es']);

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || !session.user.tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const tenant = getTenantById(session.user.tenantId);
  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
  }

  let body: any = {};
  try { body = await req.json(); } catch { /* leerer Body okay */ }

  const voiceOverride =
    typeof body?.voiceId === 'string' && ALLOWED_VOICES.has(body.voiceId)
      ? body.voiceId
      : undefined;

  // App-Sprache des Users mitnehmen, validieren
  const requestedLocale =
    typeof body?.locale === 'string' && ALLOWED_LOCALES.has(body.locale as VoiceLocale)
      ? (body.locale as VoiceLocale)
      : undefined;

  let vadParams: any = undefined;
  if (
    body?.vadParams &&
    typeof body.vadParams.threshold === 'number' &&
    body.vadParams.threshold >= 0.3 && body.vadParams.threshold <= 0.95 &&
    typeof body.vadParams.silence_duration_ms === 'number' &&
    body.vadParams.silence_duration_ms >= 200 && body.vadParams.silence_duration_ms <= 3000 &&
    typeof body.vadParams.prefix_padding_ms === 'number' &&
    body.vadParams.prefix_padding_ms >= 100 && body.vadParams.prefix_padding_ms <= 1000
  ) {
    vadParams = {
      threshold: body.vadParams.threshold,
      silence_duration_ms: body.vadParams.silence_duration_ms,
      prefix_padding_ms: body.vadParams.prefix_padding_ms,
    };
  }

  // Translator-Mode: wenn body.translatorTarget gesetzt, erzeugen wir
  // eine Translation-Session statt einer normalen.
  let translatorOverride: any = undefined;
  let resolvedTargetLabel: string | undefined;
  let resolvedTargetCode: string | undefined;
  let resolvedTargetFlag: string | undefined;
  let resolvedTargetNative: string | undefined;

  if (typeof body?.translatorTarget === 'string' && body.translatorTarget.length > 0) {
    const sourceLocale = requestedLocale || 'en';
    const lang = resolveLanguage(body.translatorTarget, sourceLocale);

    translatorOverride = {
      systemPrompt: buildTranslatorPrompt(
        sourceLocale,
        lang.label,
        lang.nativeLabel,
      ),
      greeting: buildTranslatorGreeting(sourceLocale, lang.displayLabel),
    };
    resolvedTargetLabel = lang.displayLabel;
    resolvedTargetCode = lang.code;
    resolvedTargetFlag = lang.flag;
    resolvedTargetNative = lang.nativeLabel;
  }

  try {
    const userRole = session.user.role || 'user';
    const isDemoUser = session.user.isDemoUser ?? false;
    const voiceSession = await createVoiceSession(tenant, userRole, isDemoUser, {
      voiceId: voiceOverride,
      locale: requestedLocale,
      vadParams,
      translator: translatorOverride,
    });

    logAuditEvent({
      event: 'session.started',
      userId: session.user.id || session.user.email,
      userEmail: session.user.email!,
      tenantId: tenant.tenant.id,
      isDemoUser,
      metadata: {
        mode: voiceSession.mode,
        voiceId: voiceSession.voiceId,
        locale: requestedLocale,
        translator: voiceSession.isTranslator || false,
        targetLanguage: resolvedTargetLabel,
      },
    }).catch(() => {});

    return NextResponse.json({
      ...voiceSession,
      // Resolved Target-Info zurück damit Frontend die UI bauen kann
      targetLanguage: resolvedTargetLabel,
      targetLanguageCode: resolvedTargetCode,
      targetLanguageFlag: resolvedTargetFlag,
      targetLanguageNative: resolvedTargetNative,
    });
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
