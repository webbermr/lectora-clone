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

export const REMOVED_STYLE_ID = 'lc-removed';
const BLOCK = new RegExp(`<style id="${REMOVED_STYLE_ID}">([\\s\\S]*?)</style>\\n?`);
const RULE = /#([A-Za-z_][\w-]*)\s*\{\s*display\s*:\s*none\s*!important\s*;?\s*\}/g;

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
  for (const m of html.matchAll(/\bnew\s+(Obj\w+)\(\s*'([\w-]+)'\s*(?:,\s*'((?:[^'\\]|\\.)*)')?/g)) {
    if (!out.has(m[2])) out.set(m[2], { id: m[2], kind: m[1], name: (m[3] ?? '').replace(/\\(.)/g, '$1') });
  }
  return out;
}

/** Ids this editor has hidden on a page. */
export function hiddenIds(html: string): string[] {
  const block = BLOCK.exec(html)?.[1] ?? '';
  return [...block.matchAll(RULE)].map((m) => m[1]);
}

export function removedCss(ids: string[]): string {
  return ids.map((id) => `#${id}{display:none!important}`).join('\n');
}

/** The page with exactly these ids hidden (none → the block is taken out again). */
export function setHidden(html: string, ids: string[]): string {
  const unique = [...new Set(ids)];
  const block = unique.length ? `<style id="${REMOVED_STYLE_ID}">\n${removedCss(unique)}\n</style>\n` : '';
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
 * page declared (`shape58889` for a click on `shape58889path`), else the nearest element with an id.
 */
export function objectRoot(el: Element, declared: Map<string, PageObject>): Element | null {
  let fallback: Element | null = null;
  for (let e: Element | null = el; e && e.tagName !== 'BODY' && e.tagName !== 'HTML'; e = e.parentElement) {
    if (e.id && declared.has(e.id)) return e;
    if (e.id && !fallback && e.id !== 'pageDIV') fallback = e;
  }
  return fallback;
}
