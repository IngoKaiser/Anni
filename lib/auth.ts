/**
 * Auth.js v5 (NextAuth) - Variante C: Beide Login-Wege parallel
 *
 * - Magic Link via Resend (für echte User mit Tenant-Email)
 * - Demo Quick-Login Credentials Provider (für Demo-User)
 *
 * Pro User wird in der Session ein "isDemoUser" Flag gespeichert,
 * das später entscheidet ob OpenAI Realtime oder Web Speech API genutzt wird.
 *
 * Session: JWT, 90 Tage gültig.
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

// Hinweis: Wir augmentieren absichtlich NICHT 'next-auth/jwt' als Modul.
// In Auth.js v5-beta ist das Pfad-Mapping zwischen next-auth und @auth/core
// nicht stabil (das nested @auth/core in next-auth's eigenem node_modules
// macht TypeScript Resolution unzuverlässig). Wir nutzen stattdessen
// einfache Type-Casts in den Callbacks unten - das JWT akzeptiert
// zur Laufzeit beliebige Felder, die Augmentation ist nur Type-Hint.

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

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  secret: process.env.AUTH_SECRET,

  session: {
    strategy: 'jwt',
    maxAge: 90 * 24 * 60 * 60, // 90 Tage
  },

  pages: {
    signIn: '/login',
    verifyRequest: '/verify',
  },

  providers: [
    // Magic Link (nur aktiv wenn RESEND_API_KEY gesetzt)
    ...(process.env.RESEND_API_KEY
      ? [
          Resend({
            apiKey: process.env.RESEND_API_KEY,
            from: process.env.EMAIL_FROM || 'onboarding@resend.dev',
          }),
        ]
      : []),

    // Demo Quick-Login (immer aktiv - sichtbar oder versteckt regelt das Frontend)
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
      // token ist JWT, wird aber zur Laufzeit als Plain-Object behandelt.
      // Type-Cast auf 'any' an Schreibstellen, weil wir das Modul-Augmentation
      // bewusst weggelassen haben (siehe Kommentar oben).
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
});
