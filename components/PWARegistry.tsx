'use client';

import { useEffect, useState } from 'react';

/**
 * Service Worker registrieren + iOS Install-Banner anzeigen.
 *
 * Auf Android/Chrome: native beforeinstallprompt-Event wird gefeuert,
 * wir können den Browser-Install-Prompt programmatisch zeigen.
 *
 * Auf iOS Safari: kein beforeinstallprompt verfügbar - User muss manuell
 * "Zum Home-Bildschirm hinzufügen" über Share-Menü machen. Wir zeigen
 * einen freundlichen Hinweis-Banner an, der erklärt warum (Headset-
 * Funktionalität profitiert von PWA-Modus).
 */
export function PWARegistry() {
  const [installPromptEvent, setInstallPromptEvent] = useState<any>(null);
  const [showIOSBanner, setShowIOSBanner] = useState(false);
  const [showInstallBanner, setShowInstallBanner] = useState(false);

  // Service-Worker registrieren - nur in Production
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    if (window.location.hostname === 'localhost') return;

    navigator.serviceWorker.register('/sw.js')
      .catch(err => console.warn('[pwa] SW registration failed:', err));
  }, []);

  // beforeinstallprompt für Android/Chrome
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handler = (e: any) => {
      e.preventDefault();
      setInstallPromptEvent(e);
      // Banner nur zeigen wenn nicht schon einmal weggeklickt
      const dismissed = localStorage.getItem('anni:installPromptDismissed');
      if (!dismissed) setShowInstallBanner(true);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  // iOS Detection: kein beforeinstallprompt, aber Standalone-Check
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isStandalone = (window.navigator as any).standalone === true ||
                         window.matchMedia('(display-mode: standalone)').matches;
    const dismissed = localStorage.getItem('anni:iosInstallDismissed');

    if (isIOS && !isStandalone && !dismissed) {
      // Erst nach 30 Sekunden zeigen - nicht beim ersten Page-Load
      const timer = setTimeout(() => setShowIOSBanner(true), 30000);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleInstall = async () => {
    if (!installPromptEvent) return;
    try {
      await installPromptEvent.prompt();
      const choice = await installPromptEvent.userChoice;
      if (choice.outcome === 'accepted') {
        localStorage.setItem('anni:installPromptDismissed', '1');
      }
    } catch {}
    setShowInstallBanner(false);
    setInstallPromptEvent(null);
  };

  const dismissInstallBanner = () => {
    localStorage.setItem('anni:installPromptDismissed', '1');
    setShowInstallBanner(false);
  };

  const dismissIOSBanner = () => {
    localStorage.setItem('anni:iosInstallDismissed', '1');
    setShowIOSBanner(false);
  };

  // Android-Install-Banner
  if (showInstallBanner) {
    return (
      <div className="fixed bottom-4 left-4 right-4 z-50 max-w-md mx-auto bg-white rounded-2xl shadow-2xl border border-stone-200 p-4 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-stone-900">Anni installieren?</p>
          <p className="text-xs text-stone-600 mt-1 leading-relaxed">
            Schnellerer Start und volle Headset-Steuerung. Funktioniert wie eine App.
          </p>
          <div className="flex gap-2 mt-3">
            <button
              onClick={handleInstall}
              className="px-3 py-1.5 rounded-xl bg-rose-700 text-white text-xs font-semibold"
            >
              Installieren
            </button>
            <button
              onClick={dismissInstallBanner}
              className="px-3 py-1.5 rounded-xl bg-stone-100 text-stone-600 text-xs font-semibold"
            >
              Später
            </button>
          </div>
        </div>
      </div>
    );
  }

  // iOS-Install-Hinweis-Banner
  if (showIOSBanner) {
    return (
      <div className="fixed bottom-4 left-4 right-4 z-50 max-w-md mx-auto bg-white rounded-2xl shadow-2xl border border-stone-200 p-4">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-stone-900">Anni zum Home-Bildschirm</p>
            <p className="text-xs text-stone-600 mt-1 leading-relaxed">
              Als App: schnellerer Start, AirPods-Steuerung auch vor dem ersten Klick.
              <br />
              Tippe auf <span className="font-mono">⎘</span> (Teilen) → <strong>"Zum Home-Bildschirm"</strong>.
            </p>
            <button
              onClick={dismissIOSBanner}
              className="mt-3 px-3 py-1.5 rounded-xl bg-stone-100 text-stone-600 text-xs font-semibold"
            >
              Verstanden
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
