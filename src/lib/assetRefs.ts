/** Finding the images, media and documents a page's source refers to. */
import type { FileMap } from './package';
import { isHtmlFile, normalize, resolveFrom } from './paths';
import { decodeText } from './text';

// File bytes are replaced on every write, never mutated, so caching by identity is safe.
const decoded = new WeakMap<Uint8Array, string>();
export function textOf(bytes: Uint8Array): string {
  let t = decoded.get(bytes);
  if (t === undefined) {
    t = decodeText(bytes);
    decoded.set(bytes, t);
  }
  return t;
}

/** Quoted or url()-wrapped references to asset files, in HTML attributes or JS strings. */
export const ASSET_REF =
  /["'(=]\s*([^"'()\s<>]+?\.(?:png|jpe?g|gif|svg|webp|bmp|mp4|webm|ogv|m4v|mov|mp3|wav|ogg|oga|m4a|aac|flv|swf|pdf|docx?|xlsx?|pptx?|zip|vtt|srt))(?:[?#][^"')\s]*)?\s*["')]/gi;

const refCache = new WeakMap<Uint8Array, string[]>();

/** Package paths of assets that `pagePath` names in its source (existing files only). */
export function referencedAssets(pagePath: string, files: FileMap): string[] {
  const bytes = files[pagePath];
  if (!bytes) return [];
  const cached = refCache.get(bytes);
  if (cached) return cached.filter((p) => files[p]);
  const out = new Set<string>();
  for (const m of textOf(bytes).matchAll(ASSET_REF)) {
    let ref = m[1].replace(/\\\//g, '/');
    try {
      ref = decodeURI(ref);
    } catch {
      /* keep as written */
    }
    const path = [resolveFrom(pagePath, ref), normalize(ref)].find((p) => p && files[p]);
    if (path && !isHtmlFile(path)) out.add(path);
  }
  const list = [...out];
  refCache.set(bytes, list);
  return list;
}
