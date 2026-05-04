import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getTenantById, tenantToPublicView } from '@/lib/tenants';

export const runtime = 'nodejs';

export async function GET() {
  const session = await auth();
  if (!session?.user || !session.user.tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const tenant = getTenantById(session.user.tenantId);
  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
  }

  return NextResponse.json({
    tenant: tenantToPublicView(tenant),
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      role: session.user.role,
      isDemoUser: session.user.isDemoUser ?? false,
    },
  });
}
