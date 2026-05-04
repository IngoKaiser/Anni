import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getTenantById } from '@/lib/tenants';
import { executeTool } from '@/lib/tool-execution';
import { logAuditEvent } from '@/lib/audit';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || !session.user.tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const tenant = getTenantById(session.user.tenantId);
  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
  }

  const { toolId, args } = await req.json();
  if (!toolId) {
    return NextResponse.json({ error: 'Missing toolId' }, { status: 400 });
  }

  const userRole = session.user.role || 'user';
  const isDemoUser = session.user.isDemoUser ?? false;
  const tool = tenant.tools.find(t => t.id === toolId);

  try {
    const result = await executeTool(tenant, toolId, args, userRole, isDemoUser);

    logAuditEvent({
      event: result.success ? 'tool.invoked' : 'tool.failed',
      userId: session.user.id || session.user.email,
      userEmail: session.user.email!,
      tenantId: tenant.tenant.id,
      isDemoUser,
      toolId,
      toolLabel: tool?.label,
      metadata: {
        success: result.success,
        error: result.error,
      },
    }).catch(() => {});

    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[tool-execute] Failed:', err);
    return NextResponse.json(
      { error: err?.message || 'Tool execution failed' },
      { status: 500 }
    );
  }
}
