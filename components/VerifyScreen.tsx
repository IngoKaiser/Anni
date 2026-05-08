'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { Mail, Inbox } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

export default function VerifyScreen() {
  const router = useRouter();
  const { t } = useI18n();

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 py-8"
      style={{ background: 'linear-gradient(135deg, #FFE4E6 0%, #FED7AA 50%, #FEF3C7 100%)' }}
    >
      <div className="w-full max-w-md text-center">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-white shadow-lg mb-6">
          <Mail className="text-rose-500" size={36} strokeWidth={2.5} />
        </div>
        <h1 className="text-2xl font-bold text-stone-800 mb-3">{t('verify.title')}</h1>
        <p className="text-stone-600 mb-2">{t('verify.subtitle')}</p>
        <p className="text-sm text-stone-500 mb-8 leading-relaxed max-w-xs mx-auto">
          {t('verify.body')}
        </p>

        <div className="bg-white/70 backdrop-blur rounded-2xl p-4 mb-6 text-left">
          <div className="flex items-start gap-2.5">
            <Inbox size={16} className="text-stone-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1 text-xs text-stone-600 leading-relaxed">
              <p className="font-semibold text-stone-700 mb-1">{t('verify.help.title')}</p>
              <ul className="space-y-1 list-none">
                <li>· {t('verify.help.spam')}</li>
                <li>· {t('verify.help.typo')}</li>
                <li>· {t('verify.help.delay')}</li>
              </ul>
            </div>
          </div>
        </div>

        <button
          onClick={() => router.push('/login')}
          className="text-sm text-stone-500 hover:text-stone-700 transition"
        >
          {t('verify.back')}
        </button>
      </div>
    </div>
  );
}
