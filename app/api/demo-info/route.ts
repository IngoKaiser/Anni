import { NextRequest, NextResponse } from 'next/server';
import { DEMO_USERS } from '@/lib/auth';
import { getAllTenants } from '@/lib/tenants';

export const runtime = 'nodejs';

/**
 * Sichtbarkeit der Demo-Login-Buttons:
 *
 * - URL-Parameter ?demo=1 hat IMMER Vorrang (explizit gesetzt)
 * - URL-Parameter ?demo=0 hat ebenfalls Vorrang (explizit ausgeschaltet)
 * - Sonst: Env-Variable DEMO_LOGIN_VISIBLE entscheidet
 *
 * Empfehlung für Production-Deployments: DEMO_LOGIN_VISIBLE nicht setzen
 * oder explizit auf "false". Demo-Sessions öffnest du dann mit ?demo=1.
 */
function isDemoLoginVisible(req: NextRequest): boolean {
  const param = req.nextUrl.searchParams.get('demo');
  if (param === '1') return true;
  if (param === '0') return false;
  return process.env.DEMO_LOGIN_VISIBLE === 'true';
}

export async function GET(req: NextRequest) {
  const showDemoLogin = isDemoLoginVisible(req);

  const tenants = getAllTenants().map(t => ({
    id: t.tenant.id,
    name: t.tenant.name,
    email_domains: t.tenant.email_domains,
    branding: {
      app_name: t.branding.app_name,
      logo_emoji: t.branding.logo_emoji,
      primary_color: t.branding.primary_color,
      secondary_color: t.branding.secondary_color,
    },
  }));

  // Demo-User nur ausgeben wenn Demo sichtbar ist
  const demoUsers = showDemoLogin
    ? DEMO_USERS.map(u => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.roleLabel,
        tenantId: u.tenantId,
      }))
    : [];

  return NextResponse.json({
    showDemoLogin,
    tenants,
    demoUsers,
    hasMagicLink: !!process.env.RESEND_API_KEY,
    hasOpenAI: !!process.env.OPENAI_API_KEY,
  });
}
