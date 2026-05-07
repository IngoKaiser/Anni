/**
 * Audit Logging
 *
 * Schreibt User-Aktionen in Postgres via Neon Serverless Driver.
 * Wenn keine DB konfiguriert ist (lokal ohne Vercel Postgres/Neon),
 * wird in die Console geloggt - die App bleibt funktionsfähig.
 *
 * Hinweis zur Connection-URL: Vercel + Neon-Integration setzt die Variablen
 * unter mehreren Namen (DATABASE_URL, POSTGRES_URL, etc.). Wir prüfen
 * beide, damit es egal ist, welcher Storage-Anbieter im Vercel-Projekt
 * verbunden ist.
 */

import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

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
 * Ermittelt die Datenbank-URL aus den verschiedenen Env-Varianten,
 * die Vercel/Neon setzen.
 */
function getDatabaseUrl(): string | null {
  return (
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    null
  );
}

let cachedSql: NeonQueryFunction<false, false> | null = null;

function getSql(): NeonQueryFunction<false, false> | null {
  if (cachedSql) return cachedSql;
  const url = getDatabaseUrl();
  if (!url) return null;
  cachedSql = neon(url);
  return cachedSql;
}

let tableInitialized = false;

async function ensureTable(): Promise<void> {
  if (tableInitialized) return;
  const sql = getSql();
  if (!sql) return;

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
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_log(tenant_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at)`;
  tableInitialized = true;
}

/**
 * Schreibt einen Audit-Eintrag. Wirft niemals - Audit-Fehler dürfen
 * User-Aktionen nicht blockieren.
 */
export async function logAuditEvent(entry: AuditEntry, ip?: string): Promise<void> {
  try {
    const sql = getSql();
    if (!sql) {
      console.log('[audit]', JSON.stringify({ ...entry, ip, timestamp: new Date().toISOString() }));
      return;
    }

    await ensureTable();
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
      )
    `;
  } catch (err) {
    console.error('[audit] Failed:', err);
  }
}

/**
 * Liest Audit-Log eines Tenants (für spätere Admin-Views).
 * Neon's neon() liefert Ergebnisse direkt als Array - kein .rows mehr.
 */
export async function getAuditLog(tenantId: string, limit: number = 100): Promise<any[]> {
  const sql = getSql();
  if (!sql) return [];

  try {
    await ensureTable();
    const rows = await sql`
      SELECT * FROM audit_log
      WHERE tenant_id = ${tenantId}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
    return rows as any[];
  } catch (err) {
    console.error('[audit] Query failed:', err);
    return [];
  }
}
