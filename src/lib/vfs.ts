/**
 * Virtual file server: project files are written to Cache Storage and served
 * to iframes by the service worker in public/sw.js at <app>/vfs/<project>/<path>.
 */
import { basename, dirname, mimeType } from './paths';
import type { FileMap } from './package';

const CACHE = 'lectora-clone-vfs';
let ready: Promise<void> | null = null;

export function ensureServiceWorker(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      if (!window.isSecureContext) {
        // Browsers only allow service workers over HTTPS (or on localhost).
        throw new Error(
          `This editor must be opened over HTTPS (or on localhost) to show course pages. It was opened at ${location.origin}. Ask whoever hosts it to put it behind HTTPS.`,
        );
      }
      if (!('serviceWorker' in navigator)) {
        throw new Error('This browser does not support service workers, which the preview needs.');
      }
      try {
        await navigator.serviceWorker.register(new URL('sw.js', document.baseURI).href);
      } catch (e) {
        // Clicking through a browser's certificate warning isn't enough for service workers.
        if (/certificate|SSL/i.test(String((e as Error)?.message ?? e))) {
          throw new Error(
            `This computer doesn't trust the certificate for ${location.host}, so course pages can't be shown. Install the editor's root certificate on this computer (see "Let other people on your network use it" in the README), then restart the browser.`,
          );
        }
        throw e;
      }
      await navigator.serviceWorker.ready;
    })();
  }
  return ready;
}

export function vfsUrl(projectId: string, path: string): string {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return new URL(`vfs/${projectId}/${encoded}`, document.baseURI).href;
}

function toResponse(path: string, bytes: Uint8Array): Response {
  return new Response(new Blob([bytes as BlobPart]), {
    headers: { 'Content-Type': mimeType(path), 'Cache-Control': 'no-store' },
  });
}

export async function putFile(projectId: string, path: string, bytes: Uint8Array): Promise<void> {
  const cache = await caches.open(CACHE);
  await cache.put(vfsUrl(projectId, path), toResponse(path, bytes));
}

export async function deleteFile(projectId: string, path: string): Promise<void> {
  const cache = await caches.open(CACHE);
  await cache.delete(vfsUrl(projectId, path));
}

export async function clearProject(projectId: string): Promise<void> {
  const cache = await caches.open(CACHE);
  const prefix = vfsUrl(projectId, '');
  await Promise.all((await cache.keys()).filter((r) => r.url.startsWith(prefix)).map((r) => cache.delete(r)));
}

export async function mountProject(
  projectId: string,
  files: FileMap,
  onProgress?: (done: number, total: number, current: string) => void,
): Promise<void> {
  await ensureServiceWorker();
  // One project mounted at a time keeps the cache from growing without bound.
  const cache = await caches.open(CACHE);
  await Promise.all((await cache.keys()).map((r) => cache.delete(r)));
  const entries = Object.entries(files);
  let done = 0;
  let next = 0;
  // A few writes in flight at a time: all-at-once finishes no sooner, and its
  // completions arrive in one burst at the end, so progress would sit at 0%.
  const worker = async () => {
    while (next < entries.length) {
      const [p, b] = entries[next++];
      await cache.put(vfsUrl(projectId, p), toResponse(p, b));
      onProgress?.(++done, entries.length, p);
    }
  };
  await Promise.all(Array.from({ length: 16 }, worker));
}

/** Sibling path for the scripts-disabled copy of a page shown in the editor. */
export function editCopyPath(path: string): string {
  const dir = dirname(path);
  return (dir ? dir + '/' : '') + '__lc_edit__' + basename(path);
}
