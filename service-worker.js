const CACHE_NAME = 'worldmaps-v1';

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll([
      './',
      '/index.html',
      '/listes.js',
    ]))
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  // Laisser passer tout ce qui ne vient pas de ton site (Wikidata, Commons, flagcdn…)
  const isSameOrigin = e.request.url.startsWith(self.location.origin);
  if (!isSameOrigin) return;

  e.respondWith(
    fetch(e.request)
      .then(response => {
        if (!response || !response.ok || response.status === 206) {
          return response;
        }
        const clone = response.clone();
        caches.open(CACHE_NAME)
          .then(cache => cache.put(e.request, clone))
          .catch(() => {});
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(e.request);
        // Toujours renvoyer une Response, jamais undefined
        return cached || new Response('Hors ligne', { status: 503, statusText: 'Offline' });
      })
  );
});
