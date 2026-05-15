/**
 * Audit Logging
 *
 * Schreibt User-Aktionen (Voice-Session-Start, Tool-Aufrufe) in Postgres
 * via Neon Serverless Driver.
 *
 * Drei Betriebsmodi:
 * 1. AUDIT_LOG_DISABLED=true  → Nur Console-Log, kein DB-Schreiben
 * 2. Keine DB-URL gesetzt     → Nur Console-Log (lokale Dev-Umgebung)
 * 3. DB-URL gesetzt           → Schreibt in Postgres mit graceful fallback
 *
 * Resilience: Cold-Start-Timeouts und Connection-Errors werden still
 * geschluckt. Audit-Log darf User-Aktionen niemals blockieren oder
 * Logs-Pollution verursachen. Bei echten DB-Problemen sieht der Operator
 * den ausführlichen Fehler genau einmal pro 5 Minuten.
 *
 * Hinweis zur Connection-URL: Vercel + Neon-Integration setzt die Variablen
 * unter mehreren Namen (DATABASE_URL, POSTGRES_URL, etc.). Wir prüfen
 * alle, damit es egal ist, welcher Storage-Anbieter im Vercel-Projekt
 * verbunden ist.
 */

import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

export type AuditEvent =
  | 'session.started'
  | 'session.ended'
  | 'tool.invoked'
  | 'tool.failed'
  | 'tool.confirmed'
  | 'tool.cancelled'
  | 'knowledge.query'
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
 * Ist Audit-Log via DB ausgeschaltet?
 * AUDIT_LOG_DISABLED=true in Vercel-Env setzen, um nur Console zu nutzen.
 */
function isAuditDisabled(): boolean {
  return process.env.AUDIT_LOG_DISABLED === 'true';
}

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
  if (isAuditDisabled()) return null;
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
 * Erkennt Cold-Start-Timeouts und Connection-Errors von Neon.
 * Diese sind erwartbar wenn die DB nach Inaktivität wieder hochgefahren wird,
 * und sollen die Logs nicht spammen.
 */
function isColdStartError(err: any): boolean {
  if (!err) return false;
  const msg = String(err?.message || '');
  const code = err?.sourceError?.cause?.code || err?.code;

  return (
    code === 'ETIMEDOUT' ||
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'ECONNRESET' ||
    msg.includes('fetch failed') ||
    msg.includes('Connection terminated') ||
    msg.includes('Error connecting to database')
  );
}

/**
 * Throttled-Logging: Cold-Start-Fehler werden nur einmal pro 5 Minuten
 * geloggt, sonst nervt das den Operator nur. Echte DB-Fehler (z.B.
 * Schema-Probleme, Auth-Fehler) werden immer geloggt.
 */
let lastColdStartLog = 0;
const COLD_START_LOG_THROTTLE_MS = 5 * 60 * 1000;

function logErrorIfNotised(err: any, context: string): void {
  if (isColdStartError(err)) {
    const now = Date.now();
    if (now - lastColdStartLog > COLD_START_LOG_THROTTLE_MS) {
      console.warn(`[audit] DB unreachable (cold start or network) - audit log skipped. Context: ${context}`);
      lastColdStartLog = now;
    }
    return;
  }
  // Echte Fehler (Schema, Auth, etc.) immer loggen
  console.error(`[audit] ${context}:`, err);
}

/**
 * Schreibt einen Audit-Eintrag. Wirft niemals - Audit-Fehler dürfen
 * User-Aktionen nicht blockieren. Cold-Start-Errors werden gethrottled.
 */
export async function logAuditEvent(entry: AuditEntry, ip?: string): Promise<void> {
  // Wenn DB nicht konfiguriert oder ausgeschaltet: nur Console
  const sql = getSql();
  if (!sql) {
    console.log('[audit]', JSON.stringify({ ...entry, ip, timestamp: new Date().toISOString() }));
    return;
  }

  try {
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
    logErrorIfNotised(err, 'logAuditEvent failed');
    // Fallback: Console-Log damit der Audit-Trail wenigstens dort ist
    console.log('[audit-fallback]', JSON.stringify({ ...entry, ip, timestamp: new Date().toISOString() }));
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
    logErrorIfNotised(err, 'getAuditLog failed');
    return [];
  }
}
