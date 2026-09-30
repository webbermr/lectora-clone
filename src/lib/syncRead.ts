/**
 * Answers course pages' synchronous file requests from the open project.
 *
 * Browsers don't route synchronous XMLHttpRequests through the service worker, so
 * public/vfs-sync.js (added to course pages by the service worker) asks the editor
 * window for the file through `window.__lcVfsRead` instead. Lectora's player loads
 * its test (_tobj….txt) this way; without this it reports "You must run this content
 * from a web-based server".
 */
import { mimeType } from './paths';
import { store } from './store';
import { decodeText } from './text';

export interface SyncFile {
  text: string;
  type: string;
}

/** The project file behind a URL the service worker would serve, or null. */
export function readForSyncRequest(url: string, base = document.baseURI): SyncFile | null {
  const p = store.project;
  if (!p) return null;
  const root = new URL(`vfs/${p.id}/`, base).href;
  if (!url.startsWith(root)) return null;
  let path: string;
  try {
    path = decodeURIComponent(url.slice(root.length).split(/[?#]/)[0]);
  } catch {
    return null;
  }
  let bytes = p.files[path];
  if (!bytes) {
    // Packages authored on Windows often mix case, as the service worker allows.
    const lower = path.toLowerCase();
    const match = Object.keys(p.files).find((f) => f.toLowerCase() === lower);
    if (match) bytes = p.files[match];
  }
  return bytes ? { text: decodeText(bytes), type: mimeType(path) } : null;
}

export function installSyncRead() {
  (window as unknown as { __lcVfsRead?: (url: string) => SyncFile | null }).__lcVfsRead = (url) => readForSyncRequest(url);
}
