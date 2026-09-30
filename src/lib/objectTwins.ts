/**
 * "The same object" on other pages.
 *
 * Lectora gives an object inherited by a whole title the same id on every page, but an object placed
 * per chapter is a separate object in each chapter: the copyright line is `text236596` on one
 * chapter's pages and `text236384` on another's. So an object counts as the same one elsewhere when
 * it has the same id, or when it is the same kind and size, at the same spot, showing the same
 * content: its text, else its picture (compared by its bytes), else its name. Objects with no
 * content to compare only match by id, so plain unnamed shapes are never lumped together.
 */
import { textOf } from './assetRefs';
import type { FileMap } from './package';
import { isHtmlFile, resolveFrom } from './paths';
import { declarations } from './lectoraDecl';

export interface ObjectRef {
  page: string;
  id: string;
}

interface ObjectInfo {
  kind: string;
  /** "x,y,w,h" as declared. */
  box: string;
  text: string;
  name: string;
  image: string;
}

const IMAGE = /["']([^"'\s]+\.(?:png|jpe?g|gif|svg|webp))["']/i;

/** Visible words of an object's `addInnerText('…')` markup. */
function visibleWords(inner: string): string {
  return inner
    .replace(/\\(["'\\/])/g, '$1')
    .replace(/\\n/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&copy;|&#169;/g, '©')
    .replace(/\s+/g, ' ')
    .trim();
}

/** What each object on a page is, read once per version of the page. */
const infoCache = new WeakMap<Uint8Array, Map<string, ObjectInfo>>();
export function objectInfos(bytes: Uint8Array): Map<string, ObjectInfo> {
  let out = infoCache.get(bytes);
  if (out) return out;
  out = new Map();
  const html = textOf(bytes);
  const decls = declarations(html);
  if (decls.size) {
    // One pass each: every object's inner markup, and the first image its setup lines name.
    const inner = new Map<string, string>();
    for (const m of html.matchAll(/\b([\w-]+)\.addInnerText\(\s*'((?:[^'\\]|\\.)*)'/g)) if (!inner.has(m[1])) inner.set(m[1], m[2]);
    const images = new Map<string, string>();
    for (const m of html.matchAll(/^\s*([\w-]+)\.[^\n]*/gm)) {
      if (images.has(m[1])) continue;
      const img = IMAGE.exec(m[0])?.[1];
      if (img) images.set(m[1], img);
    }
    for (const [id, d] of decls) {
      out.set(id, {
        kind: d.kind,
        box: `${d.x},${d.y},${d.w},${d.h}`,
        text: inner.has(id) ? visibleWords(inner.get(id)!) : '',
        name: d.name,
        image: d.image || images.get(id) || '',
      });
    }
  }
  infoCache.set(bytes, out);
  return out;
}

/** A short fingerprint of a file's bytes (FNV-1a), cached per version of the file. */
const hashCache = new WeakMap<Uint8Array, string>();
function fingerprint(bytes: Uint8Array): string {
  let h = hashCache.get(bytes);
  if (h) return h;
  let x = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) x = Math.imul(x ^ bytes[i], 0x01000193);
  h = `${bytes.length}:${(x >>> 0).toString(36)}`;
  hashCache.set(bytes, h);
  return h;
}

/**
 * What an object shows, to compare copies by: its text; else its picture (Lectora renders each
 * shape to a file named after the object, so copies have different files with the same pixels);
 * else its name. Null when there's nothing to compare, so plain unnamed shapes only match by id.
 */
function content(info: ObjectInfo, page: string, files: FileMap): string | null {
  if (info.text) return `text:${info.text}`;
  if (info.image) {
    const path = resolveFrom(page, info.image);
    const bytes = path ? files[path] : undefined;
    if (bytes) return `image:${fingerprint(bytes)}`;
  }
  return info.name ? `name:${info.name}` : null;
}

/** The object itself plus the same object on every other page (see above), page order. */
export function sameObjectEverywhere(files: FileMap, page: string, id: string): ObjectRef[] {
  const hereInfo = files[page] ? objectInfos(files[page]).get(id) : undefined;
  const hereContent = hereInfo ? content(hereInfo, page, files) : null;
  const out: ObjectRef[] = [];
  for (const p of Object.keys(files).sort()) {
    if (!isHtmlFile(p)) continue;
    const infos = objectInfos(files[p]);
    if (infos.has(id)) {
      out.push({ page: p, id });
      continue;
    }
    if (!hereInfo || !hereContent) continue;
    for (const [other, info] of infos) {
      // Cheap checks first; content (which may read an image) only for the same kind at the same spot.
      if (info.kind !== hereInfo.kind || info.box !== hereInfo.box) continue;
      if (content(info, p, files) === hereContent) {
        out.push({ page: p, id: other });
        break;
      }
    }
  }
  if (!out.some((r) => r.page === page)) out.unshift({ page, id });
  return out;
}

/** Read every page's objects a few at a time in the background, so the first selection doesn't pause. */
export function warmSignatures(files: FileMap): () => void {
  const pending = Object.keys(files).filter(isHtmlFile);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const step = () => {
    const until = performance.now() + 8;
    while (pending.length && performance.now() < until) {
      const p = pending.pop()!;
      if (files[p]) objectInfos(files[p]);
    }
    if (pending.length) timer = setTimeout(step, 16);
  };
  timer = setTimeout(step, 200);
  return () => clearTimeout(timer);
}
