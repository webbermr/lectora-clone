// Serves project files that the app has placed in Cache Storage, so course
// pages load in an iframe with their relative links, scripts and media intact.
const CACHE = 'lectora-clone-vfs';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.includes('/vfs/')) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const key = url.origin + url.pathname;
      const hit = await cache.match(key);
      if (hit) return hit;
      // Case-insensitive fallback: packages authored on Windows often mix case.
      const lower = key.toLowerCase();
      for (const req of await cache.keys()) {
        if (req.url.toLowerCase() === lower) return cache.match(req);
      }
      return new Response('Not found in project: ' + decodeURIComponent(url.pathname), {
        status: 404,
        headers: { 'Content-Type': 'text/plain' },
      });
    })(),
  );
});
