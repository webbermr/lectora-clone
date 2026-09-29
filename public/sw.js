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
      let hit = await cache.match(key);
      if (!hit) {
        // Case-insensitive fallback: packages authored on Windows often mix case.
        const lower = key.toLowerCase();
        for (const req of await cache.keys()) {
          if (req.url.toLowerCase() === lower) {
            hit = await cache.match(req);
            break;
          }
        }
      }
      if (hit) return withRange(hit, event.request.headers.get('Range'));
      return new Response('Not found in project: ' + decodeURIComponent(url.pathname), {
        status: 404,
        headers: { 'Content-Type': 'text/plain' },
      });
    })(),
  );
});

// Audio and video seek by asking for a byte range. Answering those with the
// whole file makes the player restart from the beginning, so serve the slice.
async function withRange(response, range) {
  const blob = await response.blob();
  const type = response.headers.get('Content-Type') || 'application/octet-stream';
  const base = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
  const size = blob.size;
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!m || (m[1] === '' && m[2] === '')) {
    return new Response(blob, { status: 200, headers: { ...base, 'Content-Length': String(size) } });
  }
  let start, end;
  if (m[1] === '') {
    // "bytes=-500": the last 500 bytes
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${size}` } });
  }
  return new Response(blob.slice(start, end + 1, type), {
    status: 206,
    headers: { ...base, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) },
  });
}
