/**
 * Service Worker für Anni PWA.
 *
 * Zweck:
 * - Anwendung als PWA installierbar machen
 * - silent.wav offline cachen damit Headset-Funktion sofort verfügbar ist
 *   sobald die PWA startet (auch ohne Netzwerk-Verbindung)
 *
 * Wir cachen NICHT die ganze App weil es eine dynamische Web-App mit
 * vielen API-Endpoints ist - aggressive Caching würde nur Probleme machen.
 * Stattdessen: schmaler Cache für Audio-Asset, alles andere geht durchs Netz.
 */

const CACHE_NAME = 'anni-v1';
const ESSENTIAL_ASSETS = [
  '/silent.wav',
  '/manifest.json',
];

// Install: essentielle Assets pre-cachen
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ESSENTIAL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate: alte Caches aufräumen
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch: Network-first für alles, Cache-Fallback nur für unsere Essential-Assets.
// Das Verhalten ist absichtlich konservativ - die App bleibt online-first.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Nur GET-Requests cachen
  if (event.request.method !== 'GET') return;

  // Nur same-origin (keine API-Calls etc.)
  if (url.origin !== self.location.origin) return;

  // Nur Essential-Assets
  if (!ESSENTIAL_ASSETS.includes(url.pathname)) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Erfolgreiche Antwort: in Cache aktualisieren
        if (response && response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then(r => r || new Response('', { status: 504 })))
  );
});
