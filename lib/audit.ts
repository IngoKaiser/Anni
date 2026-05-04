/**
 * Audit Logging
 *
 * Schreibt User-Aktionen in Postgres.
 * Wenn keine DB konfiguriert ist (lokal ohne Vercel Postgres),
 * wird in die Console geloggt - die App bleibt funktionsfähig.
 */

export type AuditEvent =
  | 'session.started'
  | 'session.ended'
  | 'tool.invoked'
  | 'tool.failed'
  | 'login.success'
  | 'login.failed'
  | 'logout';

export interface AuditEntry {
  event: AuditEvent;
  userId: string;
  userEmail: string;
  tenantId: string;
  isDemoUser?: boolean;
  toolId?: string;
  toolLabel?: string;
  metadata?: Record<string, any>;
}

/**
 * Erkennt, ob Postgres verfügbar ist.
 */
function hasPostgres(): boolean {
  return !!process.env.POSTGRES_URL;
}

/**
 * Init-Funktion - legt Tabelle an, idempotent.
 * Wird beim ersten Schreibversuch automatisch aufgerufen.
 */
let tableInitialized = false;
async function ensureTable(): Promise<void> {
  if (tableInitialized || !hasPostgres()) return;

  const { sql } = await import('@vercel/postgres');
  await sql`
    CREATE TABLE IF NOT EXISTS audit_log (
      id SERIAL PRIMARY KEY,
      event VARCHAR(64) NOT NULL,
      user_id VARCHAR(255) NOT NULL,
      user_email VARCHAR(255) NOT NULL,
      tenant_id VARCHAR(255) NOT NULL,
      is_demo_user BOOLEAN DEFAULT FALSE,
      tool_id VARCHAR(255),
      tool_label VARCHAR(255),
      metadata JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      ip_address VARCHAR(64)
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);`;
  await sql`CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_log(tenant_id);`;
  await sql`CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);`;
  tableInitialized = true;
}

/**
 * Schreibt einen Audit-Eintrag. Wirft niemals - Audit-Fehler dürfen
 * User-Aktionen nicht blockieren.
 */
export async function logAuditEvent(entry: AuditEntry, ip?: string): Promise<void> {
  try {
    if (!hasPostgres()) {
      console.log('[audit]', JSON.stringify({ ...entry, ip, timestamp: new Date().toISOString() }));
      return;
    }

    await ensureTable();
    const { sql } = await import('@vercel/postgres');
    await sql`
      INSERT INTO audit_log (
        event, user_id, user_email, tenant_id, is_demo_user,
        tool_id, tool_label, metadata, ip_address
      )
      VALUES (
        ${entry.event},
        ${entry.userId},
        ${entry.userEmail},
        ${entry.tenantId},
        ${entry.isDemoUser ?? false},
        ${entry.toolId ?? null},
        ${entry.toolLabel ?? null},
        ${entry.metadata ? JSON.stringify(entry.metadata) : null},
        ${ip ?? null}
      );
    `;
  } catch (err) {
    console.error('[audit] Failed:', err);
  }
}

/**
 * Liest Audit-Log eines Tenants (für spätere Admin-Views).
 */
export async function getAuditLog(tenantId: string, limit: number = 100): Promise<any[]> {
  if (!hasPostgres()) return [];

  try {
    await ensureTable();
    const { sql } = await import('@vercel/postgres');
    const result = await sql`
      SELECT * FROM audit_log
      WHERE tenant_id = ${tenantId}
      ORDER BY created_at DESC
      LIMIT ${limit};
    `;
    return result.rows;
  } catch (err) {
    console.error('[audit] Query failed:', err);
    return [];
  }
}
