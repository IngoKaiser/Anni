/**
 * Auth.js v5 (NextAuth) - Variante C: Beide Login-Wege parallel
 *
 * - Magic Link via Resend (für echte User mit Tenant-Email)
 * - Demo Quick-Login Credentials Provider (für Demo-User)
 *
 * Architektur-Details:
 *
 * 1. Magic Link braucht ZWINGEND einen Database-Adapter (Auth.js speichert
 *    Verification-Tokens dort). Wir nutzen den offiziellen @auth/neon-adapter.
 *
 * 2. Sessions sind trotz Adapter weiter JWT-basiert (strategy: 'jwt').
 *    Das hat einen wichtigen Grund: Credentials-Provider (Demo-Login) ist
 *    NICHT mit Database-Sessions kompatibel. JWT erlaubt beides parallel.
 *
 * 3. Der Pool MUSS im Request-Handler erstellt werden, nicht modul-global.
 *    Neon's Postgres kann Pools zwischen Requests nicht halten.
 *    Daher das Lazy-Pattern: NextAuth(() => ({ ... })).
 *
 * 4. Beim ersten Aufruf wird das Auth-Schema lazy angelegt - sonst würde
 *    der erste Magic-Link fehlschlagen weil die verification_token Tabelle
 *    fehlt.
 */

import NextAuth, { type DefaultSession } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Resend from 'next-auth/providers/resend';
import { resolveTenantByEmail } from './tenants';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      email: string;
      tenantId?: string;
      role?: string;
      isDemoUser?: boolean;
    } & DefaultSession['user'];
  }

  interface User {
    tenantId?: string;
    role?: string;
    isDemoUser?: boolean;
  }
}

// Demo-User - vorab konfiguriert für Demo-Quick-Login
export const DEMO_USERS = [
  {
    id: 'demo-maria',
    email: 'maria@sonnenblick.de',
    name: 'Maria Schmidt',
    role: 'pflegefachkraft',
    roleLabel: 'Pflegefachkraft',
    tenantId: 'pflegeheim-sonnenblick',
  },
  {
    id: 'demo-anne',
    email: 'anne@homecare-hamburg.de',
    name: 'Anne Petersen',
    role: 'betreuungskraft',
    roleLabel: 'Betreuungskraft',
    tenantId: 'home-care-hamburg',
  },
  {
    id: 'demo-sandra',
    email: 'sandra@reha-waldblick.de',
    name: 'Sandra Becker',
    role: 'therapeut',
    roleLabel: 'Therapeutin',
    tenantId: 'reha-waldblick',
  },
];

/**
 * Datenbank-URL ermitteln (Vercel/Neon setzen mehrere Varianten).
 */
function getDatabaseUrl(): string | null {
  return (
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    null
  );
}

/**
 * Legt das Auth.js-Schema in der DB an. Idempotent.
 * Wird beim ersten Auth-Request lazy aufgerufen.
 *
 * Schema basiert auf dem offiziellen @auth/pg-adapter Schema.
 */
let schemaInitialized = false;

async function ensureAuthSchema(pool: any): Promise<void> {
  if (schemaInitialized) return;

  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS verification_token (
        identifier TEXT NOT NULL,
        expires TIMESTAMPTZ NOT NULL,
        token TEXT NOT NULL,
        PRIMARY KEY (identifier, token)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS accounts (
        id SERIAL PRIMARY KEY,
        "userId" INTEGER NOT NULL,
        type VARCHAR(255) NOT NULL,
        provider VARCHAR(255) NOT NULL,
        "providerAccountId" VARCHAR(255) NOT NULL,
        refresh_token TEXT,
        access_token TEXT,
        expires_at BIGINT,
        id_token TEXT,
        scope TEXT,
        session_state TEXT,
        token_type TEXT
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id SERIAL PRIMARY KEY,
        "userId" INTEGER NOT NULL,
        expires TIMESTAMPTZ NOT NULL,
        "sessionToken" VARCHAR(255) NOT NULL
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255),
        email VARCHAR(255) UNIQUE,
        "emailVerified" TIMESTAMPTZ,
        image TEXT
      );
    `);

    schemaInitialized = true;
  } finally {
    client.release();
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth(async () => {
  const dbUrl = getDatabaseUrl();
  let adapter: any = undefined;

  if (dbUrl) {
    // Pool und Adapter dynamisch im Request-Handler erstellen
    // (Neon kann Pools zwischen Requests nicht halten)
    const { Pool } = await import('@neondatabase/serverless');
    const { default: NeonAdapter } = await import('@auth/neon-adapter');

    const pool = new Pool({ connectionString: dbUrl });
    await ensureAuthSchema(pool).catch(err => {
      console.error('[auth] Schema init failed:', err);
    });
    adapter = NeonAdapter(pool);
  }

  return {
    trustHost: true,
    secret: process.env.AUTH_SECRET,
    adapter,

    session: {
      // JWT-Strategie auch mit Adapter - sonst funktioniert Credentials nicht
      strategy: 'jwt',
      maxAge: 90 * 24 * 60 * 60, // 90 Tage
    },

    pages: {
      signIn: '/login',
      verifyRequest: '/verify',
    },

    providers: [
      // Magic Link - nur aktiv wenn RESEND_API_KEY UND DB konfiguriert sind.
      // Ohne DB-Adapter würde der Resend-Provider in "MissingAdapter" laufen.
      ...(process.env.RESEND_API_KEY && dbUrl
        ? [
            Resend({
              apiKey: process.env.RESEND_API_KEY,
              from: process.env.EMAIL_FROM || 'onboarding@resend.dev',
            }),
          ]
        : []),

      // Demo Quick-Login - immer aktiv, braucht keine DB
      Credentials({
        id: 'demo-quicklogin',
        name: 'Demo Quick Login',
        credentials: {
          demoUserId: { type: 'text' },
        },
        async authorize(credentials) {
          const userId = credentials?.demoUserId as string;
          const demoUser = DEMO_USERS.find(u => u.id === userId);
          if (!demoUser) return null;

          return {
            id: demoUser.id,
            email: demoUser.email,
            name: demoUser.name,
            tenantId: demoUser.tenantId,
            role: demoUser.role,
            isDemoUser: true,
          };
        },
      }),
    ],

    callbacks: {
      async signIn({ user, account }) {
        // Demo-Login ist immer erlaubt
        if (account?.provider === 'demo-quicklogin') return true;

        // Magic Link: nur für bekannte Tenant-Domains
        if (!user.email) return false;
        const tenant = resolveTenantByEmail(user.email);
        return tenant !== null;
      },

      async jwt({ token, user }) {
        // token ist JWT, wird zur Laufzeit als Plain-Object behandelt.
        // Casts auf 'any' weil wir 'next-auth/jwt' nicht augmentieren
        // (instabiles Pfad-Mapping in v5-beta).
        const t = token as any;
        if (user) {
          const u = user as any;
          if (u.tenantId) {
            t.tenantId = u.tenantId;
            t.role = u.role;
            t.isDemoUser = u.isDemoUser ?? false;
          } else if (user.email) {
            // Magic-Link User: Tenant via Email-Domain auflösen
            const tenant = resolveTenantByEmail(user.email);
            if (tenant) {
              t.tenantId = tenant.tenant.id;
              t.role = tenant.roles[0]?.id || 'user';
              t.isDemoUser = false;
            }
          }
        }
        return token;
      },

      async session({ session, token }) {
        const t = token as any;
        if (t.tenantId) session.user.tenantId = t.tenantId as string;
        if (t.role) session.user.role = t.role as string;
        if (typeof t.isDemoUser === 'boolean') session.user.isDemoUser = t.isDemoUser;
        return session;
      },
    },
  };
});
