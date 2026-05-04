'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { Mail } from 'lucide-react';

export default function VerifyScreen() {
  const router = useRouter();

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 py-8"
      style={{ background: 'linear-gradient(135deg, #FFE4E6 0%, #FED7AA 50%, #FEF3C7 100%)' }}
    >
      <div className="w-full max-w-md text-center">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-white shadow-lg mb-6">
          <Mail className="text-rose-500" size={36} strokeWidth={2.5} />
        </div>
        <h1 className="text-2xl font-bold text-stone-800 mb-3">Email gesendet</h1>
        <p className="text-stone-600 mb-2">Wir haben dir einen Anmelde-Link geschickt.</p>
        <p className="text-sm text-stone-500 mb-8 leading-relaxed max-w-xs mx-auto">
          Öffne deine Email und klicke auf den Link, um dich anzumelden. Der Link ist 24 Stunden gültig.
        </p>

        <button
          onClick={() => router.push('/login')}
          className="text-sm text-stone-500 hover:text-stone-700 transition"
        >
          ← Andere Email verwenden
        </button>
      </div>
    </div>
  );
}
