'use client';

import React, { useState, useEffect } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Mail, ArrowRight, Heart, Zap, AlertCircle, RefreshCw, Globe, Check } from 'lucide-react';
import { useI18n, SUPPORTED_LOCALES, type Locale } from '@/lib/i18n';

interface DemoUser {
  id: string;
  email: string;
  name: string;
  role: string;
  tenantId: string;
}

interface DemoTenant {
  id: string;
  name: string;
  email_domains: string[];
  branding: {
    app_name: string;
    logo_emoji: string;
    primary_color: string;
    secondary_color: string;
  };
}

export default function LoginScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t, locale, setLocale } = useI18n();
  const isDemoParam = searchParams.get('demo') === '1';
  const urlError = searchParams.get('error');

  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [showDemoOptions, setShowDemoOptions] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showLanguagePicker, setShowLanguagePicker] = useState(false);

  const [info, setInfo] = useState<{
    showDemoLogin: boolean;
    tenants: DemoTenant[];
    demoUsers: DemoUser[];
    hasMagicLink: boolean;
    hasOpenAI: boolean;
  } | null>(null);

  /**
   * Auth.js-Error-Codes in nutzerfreundliche Texte übersetzen.
   * Verwendet i18n - sprache-abhängig.
   */
  function translateAuthError(code: string): string {
    if (!code) return t('login.error.unknown');
    const c = code.toLowerCase();
    if (c.includes('emailsignin') || c.includes('email')) return t('login.error.email');
    if (c.includes('verification')) return t('login.error.verification');
    if (c.includes('accessdenied')) return t('login.error.accessDenied');
    if (c.includes('configuration')) return t('login.error.configuration');
    if (c.includes('callback')) return t('login.error.callback');
    return `${t('login.error.unknown')} (${code})`;
  }

  useEffect(() => {
    const url = isDemoParam ? '/api/demo-info?demo=1' : '/api/demo-info';
    fetch(url)
      .then(r => r.json())
      .then(setInfo)
      .catch(() => {});
  }, [isDemoParam]);

  useEffect(() => {
    if (urlError) {
      setError(translateAuthError(urlError));
      window.history.replaceState({}, '', window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlError]);

  const handleMagicLink = async () => {
    setError('');
    if (!email.includes('@')) {
      setError(t('login.error.invalidEmail'));
      return;
    }

    const domain = email.split('@')[1]?.toLowerCase().trim();
    const tenant = info?.tenants.find(t => t.email_domains.includes(domain || ''));
    if (!tenant) {
      const hint = info?.showDemoLogin
        ? t('login.error.unknownDomain.withDemo')
        : t('login.error.unknownDomain.noDemo');
      setError(hint);
      return;
    }

    if (!info?.hasMagicLink) {
      setError(t('login.error.notConfigured'));
      return;
    }

    setSubmitting(true);
    try {
      const result = await signIn('resend', {
        email,
        redirect: false,
        callbackUrl: '/',
      });

      if (result?.error) {
        setError(translateAuthError(result.error));
        setSubmitting(false);
        return;
      }

      if (result?.url) {
        router.push(result.url);
      } else {
        router.push('/verify');
      }
    } catch (err: any) {
      setError(translateAuthError(err?.message || ''));
      setSubmitting(false);
    }
  };

  const handleDemoLogin = async (demoUserId: string) => {
    setError('');
    try {
      const result = await signIn('demo-quicklogin', {
        demoUserId,
        redirect: false,
        callbackUrl: '/',
      });
      if (result?.error) {
        setError(t('login.error.demoFailed') in (window as any) ? '' : 'Demo login failed');
        return;
      }
      router.push('/');
    } catch (err: any) {
      setError(err?.message || 'Demo login failed');
    }
  };

  const currentLocale = SUPPORTED_LOCALES.find(l => l.code === locale);

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 py-8 relative"
      style={{ background: 'linear-gradient(135deg, #FFE4E6 0%, #FED7AA 50%, #FEF3C7 100%)' }}
    >
      {/* Sprach-Picker oben rechts */}
      <div className="absolute top-4 right-4">
        <button
          onClick={() => setShowLanguagePicker(!showLanguagePicker)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/70 backdrop-blur hover:bg-white/90 transition text-sm"
        >
          <span className="text-base">{currentLocale?.flag}</span>
          <span className="text-stone-700">{currentLocale?.nativeLabel}</span>
        </button>
        {showLanguagePicker && (
          <div className="absolute right-0 top-full mt-2 bg-white rounded-2xl shadow-lg border border-stone-200 overflow-hidden min-w-[180px]">
            {SUPPORTED_LOCALES.map(l => (
              <button
                key={l.code}
                onClick={() => {
                  setLocale(l.code);
                  setShowLanguagePicker(false);
                }}
                className="w-full px-3 py-2.5 flex items-center gap-2 hover:bg-stone-50 text-sm text-left"
              >
                <span className="text-base">{l.flag}</span>
                <span className="flex-1">{l.nativeLabel}</span>
                {l.code === locale && <Check size={14} className="text-rose-500" />}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="w-full max-w-md">
        {/* Logo / Tagline */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-white shadow-lg mb-4">
            <Heart className="text-rose-500" size={36} strokeWidth={2.5} fill="currentColor" />
          </div>
          <h1 className="text-3xl font-bold text-stone-800 mb-1">Anni</h1>
          <p className="text-sm text-stone-600">{t('login.tagline')}</p>
        </div>

        {/* Login-Karte */}
        <div className="bg-white/80 backdrop-blur rounded-3xl shadow-xl p-6">
          <h2 className="text-lg font-semibold text-stone-800 mb-1">{t('login.title')}</h2>
          <p className="text-xs text-stone-500 mb-4">
            {info?.hasMagicLink
              ? t('login.subtitle.magicLink')
              : t('login.subtitle.noMagicLink')}
          </p>

          {/* Email-Form */}
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-stone-600 mb-1 block">
                {t('login.email.label')}
              </label>
              <input
                type="email"
                value={email}
                onChange={e => {
                  setEmail(e.target.value);
                  if (error) setError('');
                }}
                placeholder={t('login.email.placeholder')}
                className="w-full px-4 py-3 rounded-2xl border border-stone-200 bg-white focus:outline-none focus:border-rose-300 focus:ring-2 focus:ring-rose-100 transition"
                disabled={submitting || !info?.hasMagicLink}
              />
            </div>

            <button
              onClick={handleMagicLink}
              disabled={submitting || !email || !info?.hasMagicLink}
              className="w-full py-3 rounded-2xl bg-gradient-to-r from-rose-500 to-orange-400 hover:from-rose-600 hover:to-orange-500 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition shadow-md"
            >
              <Mail size={16} />
              {submitting ? t('login.button.sending') : t('login.button.send')}
              {!submitting && <ArrowRight size={16} />}
            </button>
          </div>

          {error && (
            <div className="mt-3 rounded-2xl bg-rose-50 border border-rose-200 p-3">
              <div className="flex items-start gap-2.5">
                <AlertCircle size={16} className="text-rose-500 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-rose-800 mb-0.5">
                    {t('login.error.title')}
                  </p>
                  <p className="text-xs text-rose-700 leading-relaxed">{error}</p>
                  <button
                    onClick={() => setError('')}
                    className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-rose-700 hover:text-rose-800"
                  >
                    <RefreshCw size={11} />
                    {t('login.error.retry')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Demo-Sektion */}
          {info?.showDemoLogin && info.demoUsers.length > 0 && (
            <>
              <div className="flex items-center gap-3 my-5">
                <div className="flex-1 h-px bg-stone-200" />
                <span className="text-xs text-stone-400">{t('login.divider')}</span>
                <div className="flex-1 h-px bg-stone-200" />
              </div>

              <button
                onClick={() => setShowDemoOptions(!showDemoOptions)}
                className="w-full py-3 rounded-2xl border-2 border-dashed border-stone-300 hover:border-rose-400 hover:bg-rose-50/50 text-stone-600 font-medium flex items-center justify-center gap-2 transition"
              >
                <Zap size={16} />
                {t('login.demo.button')}
              </button>

              {showDemoOptions && (
                <div className="mt-3 space-y-2">
                  {info.demoUsers.map(u => {
                    const tenant = info.tenants.find(t => t.id === u.tenantId);
                    if (!tenant) return null;
                    return (
                      <button
                        key={u.id}
                        onClick={() => handleDemoLogin(u.id)}
                        className="w-full p-3 rounded-2xl border border-stone-200 bg-white hover:bg-stone-50 transition text-left flex items-center gap-3"
                      >
                        <div
                          className="w-10 h-10 rounded-2xl flex items-center justify-center text-lg shrink-0"
                          style={{ background: tenant.branding.primary_color + '20' }}
                        >
                          {tenant.branding.logo_emoji}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-stone-800 truncate">
                            {u.name}
                          </p>
                          <p className="text-[11px] text-stone-500 truncate">
                            {u.role} · {tenant.name}
                          </p>
                        </div>
                        <ArrowRight size={14} className="text-stone-400" />
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {/* Tenant-Liste */}
        {info && info.tenants.length > 0 && (
          <div className="mt-5 text-center">
            <p className="text-xs text-stone-500 mb-2">{t('login.tenants.title')}</p>
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              {info.tenants.map(t => (
                <span
                  key={t.id}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/60 backdrop-blur text-xs text-stone-600"
                >
                  <span>{t.branding.logo_emoji}</span>
                  {t.name}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
