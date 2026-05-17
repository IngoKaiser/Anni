import './globals.css';
import { SessionProvider } from 'next-auth/react';
import { headers } from 'next/headers';
import { I18nProvider } from '@/lib/i18n';
import { SUPPORTED_LOCALES, type Locale } from '@/lib/i18n-shared';
import { PWARegistry } from '@/components/PWARegistry';

export const metadata = {
  title: 'Anni - your personal assistant',
  description: 'Voice assistance for healthcare professionals',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default' as const,
    title: 'Anni',
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover' as const,
  themeColor: '#FFFFFF',
};

/**
 * Versucht die bevorzugte App-Sprache aus dem Accept-Language Header
 * abzuleiten. Wird nur für die initiale SSR-Render genutzt - Client-Code
 * macht im I18nProvider nochmal eine Browser-Detection (localStorage,
 * navigator.languages) und übersteuert ggf.
 */
async function detectServerLocale(): Promise<Locale> {
  const supportedCodes = SUPPORTED_LOCALES.map(l => l.code);
  try {
    const headersList = await headers();
    const acceptLanguage = headersList.get('accept-language') || '';
    // Format: "de-DE,de;q=0.9,en;q=0.8" - Sprachen sind durch Komma getrennt,
    // q-values sind nur Hinweise, die Reihenfolge ist primär.
    const languages = acceptLanguage
      .split(',')
      .map(l => l.split(';')[0].trim().split('-')[0].toLowerCase())
      .filter(Boolean);
    for (const lang of languages) {
      if (supportedCodes.includes(lang as Locale)) {
        return lang as Locale;
      }
    }
  } catch {
    // headers() kann in dev-Umgebungen fehlschlagen, einfach Fallback
  }
  return 'en';
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const initialLocale = await detectServerLocale();

  return (
    <html lang={initialLocale}>
      <head>
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body>
        <SessionProvider>
          <I18nProvider initialLocale={initialLocale}>
            {children}
            <PWARegistry />
          </I18nProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
