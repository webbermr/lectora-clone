/**
 * "The same object" on other pages.
 *
 * Lectora gives an object inherited by a whole title the same id on every page, but an object placed
 * per chapter is a separate object in each chapter: the copyright line is `text236596` on one
 * chapter's pages and `text236384` on another's. So an object counts as the same one elsewhere when
 * it has the same id, or when it is the same kind and size, at the same spot, showing the same
 * content (its text, else its name or image). Objects with no content to compare only match by id,
 * so plain shapes are never lumped together.
 */
import { textOf } from './assetRefs';
import type { FileMap } from './package';
import { isHtmlFile } from './paths';

export interface ObjectRef {
  page: string;
  id: string;
}

const DECL = /\bnew\s+(Obj\w+)\(\s*'([\w-]+)'\s*,\s*(null|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/g;
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

/** Each object's signature on a page (null when it has no content to compare by). */
const sigCache = new WeakMap<Uint8Array, Map<string, string | null>>();
export function objectSignatures(bytes: Uint8Array): Map<string, string | null> {
  let out = sigCache.get(bytes);
  if (out) return out;
  out = new Map();
  const html = textOf(bytes);
  if (html.includes('new Obj')) {
    // One pass each: every object's inner markup, and its setup lines (for the image it shows).
    const inner = new Map<string, string>();
    for (const m of html.matchAll(/\b([\w-]+)\.addInnerText\(\s*'((?:[^'\\]|\\.)*)'/g)) if (!inner.has(m[1])) inner.set(m[1], m[2]);
    const images = new Map<string, string>();
    for (const m of html.matchAll(/^\s*([\w-]+)\.[^\n]*/gm)) {
      if (images.has(m[1])) continue;
      const img = IMAGE.exec(m[0])?.[1];
      if (img) images.set(m[1], img);
    }
    for (const m of html.matchAll(DECL)) {
      const [, kind, id, rawName, x, y, w, h] = m;
      if (out.has(id)) continue;
      const text = inner.has(id) ? visibleWords(inner.get(id)!) : '';
      const name = rawName === 'null' ? '' : rawName.slice(1, -1);
      const image = images.get(id) ?? '';
      const content = text ? `text:${text}` : image ? `image:${image}` : name ? `name:${name}` : '';
      out.set(id, content ? `${kind}|${Number(x)},${Number(y)},${Number(w)},${Number(h)}|${content}` : null);
    }
  }
  sigCache.set(bytes, out);
  return out;
}

/** The object itself plus the same object on every other page (see above), page order. */
export function sameObjectEverywhere(files: FileMap, page: string, id: string): ObjectRef[] {
  const here = files[page] ? objectSignatures(files[page]).get(id) : undefined;
  const out: ObjectRef[] = [];
  for (const p of Object.keys(files).sort()) {
    if (!isHtmlFile(p)) continue;
    const sigs = objectSignatures(files[p]);
    if (sigs.has(id)) {
      out.push({ page: p, id });
      continue;
    }
    if (!here) continue;
    for (const [other, sig] of sigs) {
      if (sig === here) {
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
      if (files[p]) objectSignatures(files[p]);
    }
    if (pending.length) timer = setTimeout(step, 16);
  };
  timer = setTimeout(step, 200);
  return () => clearTimeout(timer);
}
