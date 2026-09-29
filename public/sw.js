/**
 * TechVeille Hub — Service Worker
 *
 * Stratégies :
 *  - Navigations (HTML)       : network-first, repli sur le cache (hors-ligne).
 *  - Routes /api/             : jamais interceptées ; les données hors-ligne vivent dans IndexedDB (db.js),
 *                               gérées par la page et par le message CACHE_WEEK ci-dessous.
 *  - App shell (même origine) : network-first, repli sur le cache hors-ligne. HTML et JS viennent ainsi
 *                               toujours de la même version (le stale-while-revalidate servait un ancien
 *                               app.js avec un nouvel index.html après chaque mise à jour).
 *  - CDN (Tailwind, polices)  : stale-while-revalidate dans un cache runtime.
 *
 * Incrémenter VERSION à chaque déploiement pour invalider l'ancien cache.
 */
importScripts('./db.js'); // TVHDB (IndexedDB), partagé avec la page

const VERSION = 'v6.0.0';
const SHELL_CACHE = `tvh-shell-${VERSION}`;
const RUNTIME_CACHE = `tvh-runtime-${VERSION}`;

const APP_SHELL = [
  './',
  './index.html',
  './app.js',
  './db.js',
  './search.js',
  './glossary.js',
  './kanban.js',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

const CDN_HOSTS = ['cdn.tailwindcss.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll(APP_SHELL);
      // Pré-cache best-effort de Tailwind : l'app reste stylée dès la 1re visite hors-ligne.
      try {
        const res = await fetch('https://cdn.tailwindcss.com', { mode: 'no-cors' });
        await (await caches.open(RUNTIME_CACHE)).put('https://cdn.tailwindcss.com/', res);
      } catch {
        /* réseau indisponible : sera mis en cache au prochain chargement */
      }
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, RUNTIME_CACHE]);
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('tvh-') && !keep.has(k)).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }
  if (url.origin === self.location.origin && url.pathname.includes('/api/')) return;
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request));
    return;
  }
  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
  }
});

async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request.mode === 'navigate' ? './index.html' : request, response.clone());
    return response;
  } catch {
    return (
      (await cache.match(request, { ignoreSearch: true })) ||
      (request.mode === 'navigate' && (await cache.match('./index.html'))) ||
      new Response('<h1>Hors-ligne</h1>', { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    );
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreSearch: request.url.startsWith(self.location.origin) });
  const network = fetch(request)
    .then((response) => {
      // Les réponses opaques (no-cors, status 0) des CDN sont acceptées.
      if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
      return response;
    })
    .catch(() => undefined);

  if (cached) return cached;
  return (await network) || new Response('', { status: 504, statusText: 'Offline' });
}

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') return self.skipWaiting();
  // « Rendre disponible hors-ligne » : texte complet des fiches de la semaine → IndexedDB
  if (event.data?.type === 'CACHE_WEEK') {
    const [port] = event.ports;
    event.waitUntil(
      TVHDB.cacheWeek(self.registration.scope).then(
        (result) => port.postMessage(result),
        (err) => port.postMessage({ error: err.message })
      )
    );
  }
});
