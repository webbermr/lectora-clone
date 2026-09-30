/**
 * Removing on-screen objects (callouts, buttons, images) from published pages.
 *
 * Lectora builds most objects from script (`button6746 = new ObjButton('button6746', 'Close TOC', ...)`),
 * and other code on the page shows, hides and animates them by id. Deleting the markup or the script
 * would leave that code failing, so a removed object is hidden instead, with one rule per object in
 * a style block the editor owns. The page runs exactly as before and simply never shows it, and
 * restoring it is just dropping the rule.
 */
import type { FileMap } from './package';
import { isHtmlFile } from './paths';
import { textOf } from './assetRefs';
import { declarations } from './lectoraDecl';

export const REMOVED_STYLE_ID = 'lc-removed';
const BLOCK = new RegExp(`<style id="${REMOVED_STYLE_ID}">([\\s\\S]*?)</style>\\n?`);
/** One rule per object: `#button6746,#button6746path,…{display:none!important}`. The first id names it. */
const RULE = /#([A-Za-z_][\w-]*)((?:\s*,\s*#[\w-]+)*)\s*\{\s*display\s*:\s*none\s*!important\s*;?\s*\}/g;

/**
 * Lectora draws one object with several elements named after it (`button6746path`, `button6746SVG`,
 * `button6746MapArea`…), and they aren't always nested inside the object's own element. Every part
 * is hidden, or a click area or outline would stay behind. Suffixes from trivantis.js.
 */
export const PART_SUFFIXES = ['div', 'path', 'SVG', 'MapArea', 'Map', 'TextSpan', 'TextDiv', 'text', 'imgF', 'Img', 'border', 'Mask', 'Object', 'ObjLayer', 'Reflection', 'ReflectionDiv', 'ReflectionSVG', 'AlphaGradient'];

/** The object an element id belongs to: itself, or the declared object it's a part of. */
export function objectIdOf(elementId: string, declared: Map<string, PageObject>): string | null {
  if (declared.has(elementId)) return elementId;
  let best: string | null = null;
  for (const id of declared.keys()) {
    // "button204030path" belongs to button204030; "button2040301" is a different object.
    if (elementId.length > id.length && elementId.startsWith(id) && !/\d/.test(elementId[id.length]) && (!best || id.length > best.length)) best = id;
  }
  return best;
}

/** Ids of an object's parts: the known suffixes plus any others the running page has. */
export function partIds(id: string, doc?: Document | null): string[] {
  const out = new Set([id, ...PART_SUFFIXES.map((s) => id + s)]);
  for (const e of Array.from(doc?.querySelectorAll(`[id^="${id}"]`) ?? [])) {
    if (e.id.length > id.length && !/\d/.test(e.id[id.length]) && /^[\w-]+$/.test(e.id)) out.add(e.id);
  }
  return [...out];
}

export interface PageObject {
  id: string;
  /** What Lectora calls it: "Close TOC", "Callout 3". Empty when unnamed. */
  name: string;
  /** ObjButton, ObjImage, ObjText… */
  kind: string;
}

/** Objects a Lectora page creates from script, by id. */
export function declaredObjects(html: string): Map<string, PageObject> {
  const out = new Map<string, PageObject>();
  // Every object, even one declared without a position…
  for (const m of html.matchAll(/\bnew\s+(Obj\w+)\(\s*'([\w-]+)'/g)) {
    if (!out.has(m[2])) out.set(m[2], { id: m[2], kind: m[1], name: '' });
  }
  // …named as Lectora names it (for images that's the argument after the file).
  for (const [id, d] of declarations(html)) out.set(id, { id, kind: d.kind, name: d.name });
  return out;
}

/** Objects this editor has hidden on a page, each with the element ids its rule covers. */
export function hiddenRules(html: string): Map<string, string[]> {
  const block = BLOCK.exec(html)?.[1] ?? '';
  const out = new Map<string, string[]>();
  for (const m of block.matchAll(RULE)) out.set(m[1], [m[1], ...[...m[2].matchAll(/#([\w-]+)/g)].map((x) => x[1])]);
  return out;
}

/** Objects this editor has hidden on a page. */
export function hiddenIds(html: string): string[] {
  return [...hiddenRules(html).keys()];
}

/** Rules for these objects; `parts` gives each one's element ids (default: the known suffixes). */
export function removedCss(ids: string[], parts?: Map<string, string[]>): string {
  return ids.map((id) => `${(parts?.get(id) ?? partIds(id)).map((x) => '#' + x).join(',')}{display:none!important}`).join('\n');
}

/**
 * The page with exactly these objects hidden (none → the block is taken out again).
 * `parts` adds element ids seen on the running page; rules already on the page keep theirs.
 */
export function setHidden(html: string, ids: string[], parts: Map<string, string[]> = new Map()): string {
  const unique = [...new Set(ids)];
  const known = hiddenRules(html);
  const merged = new Map(unique.map((id) => [id, [...new Set([...partIds(id), ...(known.get(id) ?? []), ...(parts.get(id) ?? [])])]]));
  const block = unique.length ? `<style id="${REMOVED_STYLE_ID}">\n${removedCss(unique, merged)}\n</style>\n` : '';
  if (BLOCK.test(html)) return html.replace(BLOCK, block);
  if (!block) return html;
  const head = /<\/head\s*>/i.exec(html);
  if (head) return html.slice(0, head.index) + block + html.slice(head.index);
  const body = /<body[^>]*>/i.exec(html);
  if (body) return html.slice(0, body.index + body[0].length) + '\n' + block + html.slice(body.index + body[0].length);
  return block + html;
}

/** True when the object's click handler takes the learner to another page (Next, Back, menu). */
export function navigatesAway(html: string, id: string): boolean {
  const start = html.search(new RegExp(`function\\s+${id}onUp\\s*\\(`));
  if (start < 0) return false;
  const end = html.indexOf('\n}', start);
  const body = html.slice(start, end < 0 ? undefined : end);
  return /\btriv(?:ExitPage|NextPage|PrevPage)\s*\(/.test(body);
}

/** HTML pages that create this object (inherited objects repeat on every page with the same id). */
export function pagesWithObject(files: FileMap, id: string): string[] {
  const decl = new RegExp(`\\bnew\\s+Obj\\w+\\(\\s*'${id}'`);
  const tag = new RegExp(`\\sid=["']${id}["']`);
  return Object.keys(files)
    .filter(isHtmlFile)
    .filter((p) => {
      const t = textOf(files[p]);
      return decl.test(t) || tag.test(t);
    })
    .sort();
}

/**
 * The whole object a click landed on: from an inner SVG path or span, walk up to the element the
 * page declared (`shape58889` for a click on `shape58889path`, even when that path isn't nested inside
 * it), else the nearest element with an id.
 */
export function objectRoot(el: Element, declared: Map<string, PageObject>): { id: string; element: Element } | null {
  let fallback: Element | null = null;
  for (let e: Element | null = el; e && e.tagName !== 'BODY' && e.tagName !== 'HTML'; e = e.parentElement) {
    const id = e.id ? objectIdOf(e.id, declared) : null;
    if (id) return { id, element: e.ownerDocument.getElementById(id) ?? e };
    if (e.id && !fallback && e.id !== 'pageDIV') fallback = e;
  }
  return fallback ? { id: fallback.id, element: fallback } : null;
}
