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
      if (hit && isPageLoad(event.request)) return withSyncHelper(hit);
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

// A course page (or frame) being opened, as opposed to a file it loads.
function isPageLoad(request) {
  return request.mode === 'navigate' || ['document', 'iframe', 'frame'].includes(request.destination);
}

// Put the editor's helper for synchronous requests (vfs-sync.js) at the top of an HTML
// page, so it runs before the course's scripts. Works on the bytes, so the page's own
// encoding is left alone; only the editor's view of the page changes, never the file.
async function withSyncHelper(response) {
  const type = response.headers.get('Content-Type') || '';
  if (!/html/i.test(type)) return response;
  const bytes = new Uint8Array(await response.arrayBuffer());
  const tag = new TextEncoder().encode(`<script src="${self.registration.scope}vfs-sync.js"></script>`);
  const headers = { 'Content-Type': type, 'Cache-Control': 'no-store' };
  // UTF-16 pages would need the tag in UTF-16 too; leave them as they are.
  if ((bytes[0] === 0xfe && bytes[1] === 0xff) || (bytes[0] === 0xff && bytes[1] === 0xfe)) return new Response(bytes, { headers });
  const at = afterTag(bytes, 'head') ?? afterTag(bytes, 'html') ?? 0;
  const out = new Uint8Array(bytes.length + tag.length);
  out.set(bytes.subarray(0, at), 0);
  out.set(tag, at);
  out.set(bytes.subarray(at), at + tag.length);
  return new Response(out, { headers });
}

/** Index just past the opening <name …> tag (ASCII, any case), or null. */
function afterTag(bytes, name) {
  const lower = name.toLowerCase();
  const limit = Math.min(bytes.length, 65536);
  outer: for (let i = 0; i + name.length + 1 < limit; i++) {
    if (bytes[i] !== 0x3c) continue; // <
    for (let j = 0; j < name.length; j++) {
      const c = bytes[i + 1 + j] | 0x20; // lower-case ASCII
      if (c !== lower.charCodeAt(j)) continue outer;
    }
    const next = bytes[i + 1 + name.length];
    if (next !== 0x3e && next !== 0x20 && next !== 0x09 && next !== 0x0a && next !== 0x0d) continue; // <header> isn't <head>
    for (let k = i + 1 + name.length; k < limit; k++) if (bytes[k] === 0x3e) return k + 1;
    return null;
  }
  return null;
}
