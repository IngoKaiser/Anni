import { NextRequest, NextResponse } from 'next/server';
import { DEMO_USERS } from '@/lib/auth';
import { getAllTenants } from '@/lib/tenants';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  // Demo-Login wird in zwei Fällen sichtbar gemacht:
  // 1. DEMO_LOGIN_VISIBLE=true in den ENV-Variablen
  // 2. URL-Parameter ?demo=1 im Request
  // (Demo-Login funktioniert immer wenn man die User-IDs kennt - das ist das verstecken)
  const demoVisibleByEnv = process.env.DEMO_LOGIN_VISIBLE === 'true';
  const demoVisibleByParam = req.nextUrl.searchParams.get('demo') === '1';
  const showDemoLogin = demoVisibleByEnv || demoVisibleByParam;

  // Liste der Tenants für Login-Footer
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

  // Demo-User nur ausgeben wenn Demo sichtbar
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
