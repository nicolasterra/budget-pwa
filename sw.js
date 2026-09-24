const CACHE_NAME = 'budget-pwa-v28';

const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon.svg',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
  './lib/xlsx.full.min.js',
  './fonts/inter-400.woff2',
  './fonts/inter-500.woff2',
  './fonts/inter-600.woff2',
  './fonts/inter-700.woff2',
  './fonts/playfair-700.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Aus dem Zwischenspeicher ausliefern und parallel im Hintergrund auffrischen:
// Die App startet sofort — auch bei schlechtem Netz — und holt die neue Fassung trotzdem.
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(cache =>
      cache.match(request).then(cached => {
        const network = fetch(request)
          .then(response => {
            if (response && response.ok) cache.put(request, response.clone());
            return response;
          })
          .catch(() => cached);

        return cached || network;
      })
    )
  );
});
