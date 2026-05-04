'use client';

import React, { useState, useEffect } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Mail, ArrowRight, Heart, Zap } from 'lucide-react';

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
  const isDemoParam = searchParams.get('demo') === '1';

  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [showDemoOptions, setShowDemoOptions] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [info, setInfo] = useState<{
    showDemoLogin: boolean;
    tenants: DemoTenant[];
    demoUsers: DemoUser[];
    hasMagicLink: boolean;
    hasOpenAI: boolean;
  } | null>(null);

  useEffect(() => {
    const url = isDemoParam ? '/api/demo-info?demo=1' : '/api/demo-info';
    fetch(url)
      .then(r => r.json())
      .then(setInfo)
      .catch(() => {});
  }, [isDemoParam]);

  const handleMagicLink = async () => {
    setError('');
    if (!email.includes('@')) {
      setError('Bitte gültige Email-Adresse eingeben');
      return;
    }

    const domain = email.split('@')[1]?.toLowerCase().trim();
    const tenant = info?.tenants.find(t => t.email_domains.includes(domain || ''));
    if (!tenant) {
      const hint = info?.showDemoLogin
        ? 'Diese Email-Domain ist noch nicht freigeschaltet. Probiere eine Demo-Anmeldung unten.'
        : 'Diese Email-Domain ist noch nicht freigeschaltet. Bitte wende dich an den Support.';
      setError(hint);
      return;
    }

    if (!info?.hasMagicLink) {
      setError('Email-Login ist auf diesem System nicht konfiguriert.');
      return;
    }

    setSubmitting(true);
    try {
      await signIn('resend', { email, callbackUrl: '/' });
    } catch (err: any) {
      setError(err?.message || 'Fehler beim Senden des Anmelde-Links');
      setSubmitting(false);
    }
  };

  const handleDemoLogin = async (demoUserId: string) => {
    setSubmitting(true);
    try {
      const result = await signIn('demo-quicklogin', {
        demoUserId,
        redirect: false,
      });
      if (result?.error) {
        setError('Demo-Login fehlgeschlagen');
        setSubmitting(false);
        return;
      }
      router.push('/');
      router.refresh();
    } catch (err: any) {
      setError(err?.message || 'Demo-Login fehlgeschlagen');
      setSubmitting(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 py-8"
      style={{ background: 'linear-gradient(135deg, #FFE4E6 0%, #FED7AA 50%, #FEF3C7 100%)' }}
    >
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-white shadow-lg mb-4">
            <Heart className="text-rose-400" strokeWidth={2.5} size={36} fill="currentColor" />
          </div>
          <h1 className="text-2xl font-bold text-stone-800 mb-2">Anni</h1>
          <p className="text-sm text-stone-600">Deine persönliche Assistentin</p>
        </div>

        <div className="bg-white rounded-3xl shadow-xl p-6 mb-4">
          <h2 className="text-lg font-semibold text-stone-800 mb-1">Anmelden</h2>
          <p className="text-sm text-stone-500 mb-5">
            {info?.hasMagicLink
              ? 'Wir schicken dir einen Anmelde-Link per Email.'
              : 'Email-Login ist nicht konfiguriert.'}
          </p>

          <label className="block text-xs font-semibold text-stone-700 mb-2 uppercase tracking-wider">
            Deine Email
          </label>
          <div className="relative">
            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-400" size={18} />
            <input
              type="email"
              value={email}
              onChange={e => {
                setEmail(e.target.value);
                setError('');
              }}
              onKeyDown={e => e.key === 'Enter' && handleMagicLink()}
              placeholder="anne@deine-einrichtung.de"
              disabled={!info?.hasMagicLink || submitting}
              className="w-full pl-12 pr-4 py-3.5 rounded-2xl border-2 border-stone-200 focus:border-rose-400 focus:outline-none text-stone-800 placeholder-stone-400 transition disabled:bg-stone-50 disabled:text-stone-400"
            />
          </div>

          {error && (
            <div className="mt-3 px-3 py-2 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700">
              {error}
            </div>
          )}

          <button
            onClick={handleMagicLink}
            disabled={!email || !info?.hasMagicLink || submitting}
            className="mt-4 w-full py-3.5 rounded-2xl bg-rose-500 hover:bg-rose-400 disabled:bg-stone-200 disabled:text-stone-400 text-white font-semibold transition flex items-center justify-center gap-2 shadow-md"
          >
            {submitting ? 'Sende…' : 'Anmelde-Link erhalten'}
            {!submitting && <ArrowRight size={16} />}
          </button>

          {info?.showDemoLogin && info.demoUsers.length > 0 && (
            <>
              <div className="my-5 flex items-center gap-3">
                <div className="flex-1 h-px bg-stone-200" />
                <span className="text-xs text-stone-400 uppercase tracking-wider">oder</span>
                <div className="flex-1 h-px bg-stone-200" />
              </div>

              <button
                onClick={() => setShowDemoOptions(!showDemoOptions)}
                className="w-full py-3 rounded-2xl border-2 border-stone-200 hover:border-stone-300 hover:bg-stone-50 text-stone-700 font-medium transition flex items-center justify-center gap-2"
              >
                <Zap size={16} className="text-rose-500" />
                Demo-Schnellzugang
              </button>

              {showDemoOptions && (
                <div className="mt-3 space-y-2">
                  {info.demoUsers.map(user => {
                    const t = info.tenants.find(tn => tn.id === user.tenantId)!;
                    return (
                      <button
                        key={user.email}
                        onClick={() => handleDemoLogin(user.id)}
                        disabled={submitting}
                        className="w-full p-3 rounded-2xl bg-stone-50 hover:bg-stone-100 disabled:opacity-50 text-left transition flex items-center gap-3 border border-stone-100"
                      >
                        <div
                          className="w-10 h-10 rounded-2xl flex items-center justify-center text-xl shrink-0"
                          style={{ background: t.branding.secondary_color }}
                        >
                          {t.branding.logo_emoji}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-stone-800 truncate">{user.name}</p>
                          <p className="text-xs text-stone-500 truncate">
                            {user.role} · {t.name}
                          </p>
                        </div>
                        <ArrowRight size={14} className="text-stone-400 shrink-0" />
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {info?.tenants && info.tenants.length > 0 && (
          <div className="bg-white/60 backdrop-blur rounded-2xl p-4 text-center">
            <p className="text-xs text-stone-600 mb-2 font-medium">
              Diese Einrichtungen sind freigeschaltet:
            </p>
            <div className="flex justify-center gap-1.5 flex-wrap">
              {info.tenants.map(t => (
                <div
                  key={t.id}
                  className="inline-flex items-center gap-1 bg-white rounded-full px-2.5 py-1 text-xs text-stone-600 shadow-sm"
                >
                  <span>{t.branding.logo_emoji}</span>
                  <span>@{t.email_domains[0]}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
