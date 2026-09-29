/**
 * Which package page a running document is showing.
 *
 * Usually that's its address. Lectora's page player (`pagePlayer.gotoPage`) is different: the
 * address stays on the launch page (a001index.html) while each page is loaded into the same
 * document. Every Lectora page declares its objects by id (`text63337 = new ObjText('text63337', …)`),
 * so the page on screen is the one whose objects are in the document. Objects inherited from the
 * chapter or title appear on many pages; the ones only that page has decide it.
 */
import { textOf } from './assetRefs';
import type { FileMap } from './package';
import { isHtmlFile } from './paths';
import { declaredObjects } from './removeObjects';

const declaredCache = new WeakMap<Uint8Array, string[]>();
function declaredIds(bytes: Uint8Array): string[] {
  let ids = declaredCache.get(bytes);
  if (!ids) {
    const t = textOf(bytes);
    ids = t.includes('new Obj') ? [...declaredObjects(t).keys()] : [];
    declaredCache.set(bytes, ids);
  }
  return ids;
}

interface ObjectIndex {
  files: FileMap;
  pagesById: Map<string, string[]>;
  total: Map<string, number>;
}
let cached: ObjectIndex | null = null;

function objectIndex(files: FileMap): ObjectIndex {
  if (cached?.files === files) return cached;
  const pagesById = new Map<string, string[]>();
  const total = new Map<string, number>();
  for (const p of Object.keys(files)) {
    if (!isHtmlFile(p)) continue;
    const ids = declaredIds(files[p]);
    if (!ids.length) continue;
    total.set(p, ids.length);
    for (const id of ids) {
      const list = pagesById.get(id);
      if (list) list.push(p);
      else pagesById.set(id, [p]);
    }
  }
  cached = { files, pagesById, total };
  return cached;
}

/**
 * The page whose declared objects best match these element ids, or null when no page clearly
 * does (not a Lectora course, or the page is still loading).
 */
export function pageFromObjectIds(ids: Iterable<string>, files: FileMap): string | null {
  const idx = objectIndex(files);
  if (!idx.total.size) return null;
  const hits = new Map<string, number>();
  for (const id of ids) {
    for (const p of idx.pagesById.get(id) ?? []) hits.set(p, (hits.get(p) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestRatio = 0;
  let bestHits = 0;
  for (const [p, n] of hits) {
    const ratio = n / idx.total.get(p)!;
    // Highest share of its objects present; a page with more of them present wins a tie
    // (a page with only inherited objects matches fully, but so does the real one, with more).
    if (ratio > bestRatio + 1e-9 || (Math.abs(ratio - bestRatio) < 1e-9 && n > bestHits)) {
      best = p;
      bestRatio = ratio;
      bestHits = n;
    }
  }
  return best && bestRatio >= 0.6 ? best : null;
}

/**
 * Package path of the page a document shows, given its address mapped to a package path.
 * Null while a Lectora launch page (which has no objects of its own) is still loading the page;
 * callers keep what they had rather than flash the launcher.
 */
export function documentPage(doc: Document, addressPath: string | null, files: FileMap): string | null {
  const ids: string[] = [];
  for (const e of Array.from(doc.querySelectorAll('[id]'))) ids.push(e.id);
  const byObjects = pageFromObjectIds(ids, files);
  if (byObjects) return byObjects;
  const idx = objectIndex(files);
  if (!idx.total.size) return addressPath; // not built from declared objects: the address is right
  return addressPath && idx.total.has(addressPath) ? addressPath : null;
}
