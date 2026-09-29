/**
 * Live edit: the page runs with its scripts, exactly as a learner sees it.
 * Text you change on screen is traced back to wherever the package stores it
 * (HTML, a JavaScript string, a JSON data file) and rewritten there. Images
 * are replaced by overwriting the file the page loads.
 */
import { useSyncExternalStore } from 'react';
import { chooseMatches } from './dialog';
import { isHtmlFile, isImageFile, isTextFile, resolveFrom } from './paths';
import { applyToText, findEverywhere, visibleText, type SourceMatch } from './sourceMatch';
import { store, type FileChange } from './store';
import { encodeText } from './text';
import { referencedAssets, textOf } from './assetRefs';
import { vfsUrl } from './vfs';
import { documentPage } from './pageIdentity';
import { REMOVED_STYLE_ID, declaredObjects, hiddenIds, hiddenRules, objectRoot, partIds, removedCss, setHidden } from './removeObjects';
import { declaredPosition, declaredPositions, moveInSource, type Point } from './moveObjects';
import { sameObjectEverywhere, type ObjectRef } from './objectTwins';

export type LiveMode = 'select' | 'interact';

export interface TextChange {
  node: Text;
  old: string;
  next: string;
}

class LiveSession {
  mode: LiveMode = 'select';
  selected: Element | null = null;
  private version = 0;
  private listeners = new Set<() => void>();

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = () => this.version;
  emit() {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  setMode(mode: LiveMode) {
    this.mode = mode;
    if (mode === 'interact') this.select(null);
    this.emit();
  }

  select(el: Element | null) {
    this.selected?.removeAttribute('data-lc-live-sel');
    this.selected = el;
    el?.setAttribute('data-lc-live-sel', '');
    this.emit();
  }

  /** Package path of a URL served from the virtual file server, or null. */
  pathFromUrl(url: string): string | null {
    const p = store.project;
    if (!p) return null;
    const base = vfsUrl(p.id, '');
    if (!url.startsWith(base)) return null;
    try {
      return decodeURIComponent(url.slice(base.length).split(/[?#]/)[0]);
    } catch {
      return null;
    }
  }

  /**
   * The package page a live document is showing. Lectora's page player keeps the address on the
   * launch page while it swaps pages in, so this goes by the page's objects when it can.
   */
  pageOf(doc: Document): string | null {
    const files = store.project?.files;
    // A document the frame has navigated away from has no window or address any more.
    const address = doc.location ? this.pathFromUrl(doc.location.href) : null;
    return (files && documentPage(doc, address, files)) || address;
  }

  /** Files most likely to hold this document's text, best first. */
  private priorityFiles(doc: Document | null): string[] {
    const files = store.project!.files;
    const order: string[] = [];
    const add = (p: string | null) => {
      if (p && files[p] && isTextFile(p) && !order.includes(p) && !p.includes('__lc_edit__')) order.push(p);
    };
    if (doc) {
      const page = this.pageOf(doc);
      add(page);
      if (doc.location) add(this.pathFromUrl(doc.location.href));
      for (const s of Array.from(doc.querySelectorAll('script[src]'))) {
        add(this.pathFromUrl((s as HTMLScriptElement).src));
      }
      // Files the page references by name (data files loaded by script, etc).
      if (page) {
        const html = textOf(files[page]);
        for (const m of html.matchAll(/["']([^"'\s<>]+\.(?:js|json|xml|html?))["']/gi)) add(resolveFrom(page, m[1]));
      }
    }
    for (const p of Object.keys(files).sort()) add(p);
    return order;
  }

  find(text: string, doc: Document | null): SourceMatch[] {
    const files = store.project!.files;
    const order = this.priorityFiles(doc);
    return findEverywhere(
      order.map((p) => [p, textOf(files[p])] as [string, string]),
      text,
    );
  }

  /**
   * Write text changes back to the package. Returns the changes that could
   * not be traced to the source so the caller can revert them on screen.
   */
  async applyText(changes: TextChange[], doc: Document | null): Promise<TextChange[]> {
    const failed: TextChange[] = [];
    const fileTexts = new Map<string, string>();
    const files = store.project!.files;
    const read = (p: string) => fileTexts.get(p) ?? textOf(files[p]);
    let applied = 0;
    const where = new Set<string>();

    for (const c of changes) {
      const old = visibleText(c.old);
      const next = visibleText(c.next);
      if (old === next) continue;
      if (!old) {
        failed.push(c);
        continue;
      }
      // Search the working copy so several edits to one file build on each other.
      const order = this.priorityFiles(doc);
      const matches = findEverywhere(order.map((p) => [p, read(p)] as [string, string]), old);
      if (!matches.length) {
        failed.push(c);
        continue;
      }
      let chosen: SourceMatch[] | null = matches;
      if (matches.length > 1) {
        // Text in an object the page shares with others (a copyright line, a header) is the same
        // object on every page, so it changes everywhere. Otherwise default to the best file.
        const shared = doc ? this.objectPages(c.node, doc) : [];
        const firstPath = matches[0].path;
        const inScope = (m: SourceMatch) => (shared.length > 1 ? shared.includes(m.path) : m.path === firstPath);
        const pre = new Set(matches.map((m, i) => (inScope(m) ? i : -1)).filter((i) => i >= 0));
        const note = shared.length > 1 ? ` · ticked on the ${shared.length} pages that share this object` : '';
        chosen = await chooseMatches(`"${old.slice(0, 60)}" appears ${matches.length} times${note}`, next, matches, pre);
        if (!chosen?.length) {
          failed.push(c);
          continue;
        }
      }
      const byPath = new Map<string, SourceMatch[]>();
      for (const m of chosen) byPath.set(m.path, [...(byPath.get(m.path) ?? []), m]);
      for (const [p, ms] of byPath) {
        fileTexts.set(p, applyToText(read(p), ms, next));
        where.add(p);
      }
      applied += chosen.length;
    }

    if (fileTexts.size) {
      const writes: FileChange[] = [...fileTexts].map(([path, text]) => ({ path, bytes: encodeText(text) }));
      await store.write('Edit text', writes);
    }
    if (applied) {
      const files = [...where];
      const inFiles = files.length <= 2 ? files.join(' and ') : `${files.length} files`;
      store.setStatus(`Updated ${applied} place${applied > 1 ? 's' : ''} in ${inFiles}. Undo with Ctrl+Z (⌘Z).` + (failed.length ? ` · ${failed.length} not found` : ''));
    } else if (failed.length) {
      store.setStatus('Could not find that text in the package source. Try Find & Replace in the sidebar with a shorter phrase.');
    }
    return failed;
  }

  /** The package file behind an <img>, <image>, <video>, or CSS background, if any. */
  assetOf(el: Element): { path: string; kind: 'img' | 'background' | 'media' } | null {
    const win = el.ownerDocument.defaultView;
    const tag = el.tagName.toLowerCase();
    if (tag === 'img') {
      const path = this.pathFromUrl((el as HTMLImageElement).currentSrc || (el as HTMLImageElement).src);
      if (path) return { path, kind: 'img' };
    }
    if (tag === 'image') {
      const href = el.getAttribute('href') ?? el.getAttribute('xlink:href') ?? '';
      const path = href ? this.pathFromUrl(new URL(href, el.ownerDocument.baseURI).href) : null;
      if (path) return { path, kind: 'img' };
    }
    if (tag === 'video' || tag === 'audio') {
      const media = el as HTMLMediaElement;
      const path = this.pathFromUrl(media.currentSrc || media.src);
      if (path) return { path, kind: 'media' };
    }
    const bg = win?.getComputedStyle(el).backgroundImage ?? '';
    const m = /url\(["']?([^"')]+)["']?\)/.exec(bg);
    if (m) {
      const path = this.pathFromUrl(new URL(m[1], el.ownerDocument.baseURI).href);
      if (path) return { path, kind: 'background' };
    }
    return null;
  }

  /**
   * Overwrite an asset's bytes in place, keeping its name so no references
   * change, then refresh every element on screen that shows it.
   */
  async replaceAsset(path: string, file: File) {
    await store.write(`Replace ${path}`, [{ path, bytes: new Uint8Array(await file.arrayBuffer()) }]);
    this.refreshEverywhere(path);
    const renamed = file.name.split('.').pop()?.toLowerCase() !== path.split('.').pop()?.toLowerCase();
    store.setStatus(`Replaced ${path}${renamed ? ' (kept the original file name so the page still finds it)' : ''}`);
    this.emit();
  }

  /** Re-request an asset in every live document, bypassing the browser cache. */
  private refreshEverywhere(path: string) {
    const stamp = 'lc=' + Date.now();
    const bust = (u: string) => u.split('#')[0].replace(/[?&]lc=\d+/, '') + (u.includes('?') ? '&' : '?') + stamp;
    for (const doc of this.liveDocs()) {
      for (const use of this.assetUses(doc)) {
        if (use.path !== path) continue;
        const el = use.element;
        const tag = el.tagName.toLowerCase();
        // Elements live in the page's own window, so check tag names, not instanceof.
        if (tag === 'img') {
          el.removeAttribute('srcset');
          (el as HTMLImageElement).src = bust((el as HTMLImageElement).currentSrc || (el as HTMLImageElement).src);
        } else if (tag === 'video' || tag === 'audio') {
          const m = el as HTMLMediaElement;
          m.src = bust(m.currentSrc || m.src);
        } else if (tag === 'source') {
          const media = el.parentElement as HTMLMediaElement | null;
          el.setAttribute('src', bust((el as HTMLSourceElement).src));
          media?.load?.();
        } else if (tag === 'image') {
          el.setAttribute('href', bust(new URL(el.getAttribute('href') ?? el.getAttribute('xlink:href') ?? '', doc.baseURI).href));
        } else if (use.via === 'background') {
          (el as HTMLElement).style.backgroundImage = `url("${bust(vfsUrl(store.project!.id, path))}")`;
        }
      }
    }
  }

  /** Pages that declare the Lectora object this node belongs to (just the one page for page-only objects). */
  private objectPages(node: Node, doc: Document): string[] {
    const files = store.project!.files;
    const page = this.pageOf(doc);
    const el = node.parentElement;
    if (!page || !files[page] || !el) return [];
    const root = objectRoot(el, declaredObjects(textOf(files[page])));
    return root ? [...new Set(sameObjectEverywhere(files, page, root.id).map((r) => r.page))] : [];
  }

  /** The object and its copies on other pages that sit at the same spot (what a move applies to). */
  copiesAtSameSpot(page: string, id: string): ObjectRef[] {
    const files = store.project!.files;
    const from = files[page] ? declaredPosition(textOf(files[page]), id) : null;
    if (!from) return [];
    return sameObjectEverywhere(files, page, id).filter((r) => {
      const at = declaredPosition(textOf(files[r.page]), r.id);
      return at && at.x === from.x && at.y === from.y;
    });
  }

  // ---- moving objects (see moveObjects.ts: the page's own declared position changes) ----

  /** Move on every page that has the object at the same spot (the default), or on this page only. */
  moveScope: 'page' | 'all' = 'all';
  setMoveScope(scope: 'page' | 'all') {
    this.moveScope = scope;
    this.emit();
  }

  /** The Lectora object the selection belongs to, with where its page declares it. */
  selectedObject(el: Element | null = this.selected): { doc: Document; page: string; id: string; element: Element; at: Point } | null {
    if (!el || !el.isConnected || !el.ownerDocument.defaultView) return null;
    const doc = el.ownerDocument;
    const files = store.project?.files;
    const page = this.pageOf(doc);
    if (!files || !page || !files[page]) return null;
    const html = textOf(files[page]);
    const root = objectRoot(el, declaredObjects(html));
    const at = root ? declaredPosition(html, root.id) : null;
    return root && at ? { doc, page, id: root.id, element: root.element, at } : null;
  }

  /** Arrow keys: move the selected object by a few pixels. */
  async nudge(dx: number, dy: number): Promise<boolean> {
    const o = this.selectedObject();
    if (!o) return false;
    await this.moveObject(o.doc, o.id, { x: o.at.x + dx, y: o.at.y + dy });
    return true;
  }

  async moveObject(doc: Document, id: string, to: Point) {
    const files = store.project!.files;
    const page = this.pageOf(doc);
    if (!page || !files[page]) return;
    // Only copies at the same spot; a page that placed it elsewhere keeps its own layout.
    const refs = this.moveScope === 'all' ? this.copiesAtSameSpot(page, id) : [{ page, id }];
    const writes: FileChange[] = [];
    for (const r of refs) {
      const html = textOf(files[r.page]);
      const next = moveInSource(html, r.id, to);
      if (next !== html) writes.push({ path: r.page, bytes: encodeText(next) });
    }
    if (!writes.length) return;
    await store.write(`Move ${id}`, writes, { fromStage: true });
    this.syncMoved();
    store.setStatus(`Moved ${id} to ${Math.round(to.x)}, ${Math.round(to.y)}${writes.length > 1 ? ` on ${writes.length} pages` : ''}. Undo with Ctrl+Z (⌘Z).`);
    this.emit();
  }

  /** Where each object was declared when the running page built it. */
  private builtAt = new WeakMap<Element, Point>();

  /**
   * Shift objects on the running page by how far their declared position has moved since the page
   * built them (after a move, undo or redo), so there's no reload. Uses the CSS `translate` property,
   * which adds to Lectora's own transforms (rotation) instead of replacing them.
   */
  syncMoved() {
    const files = store.project?.files;
    if (!files) return;
    for (const doc of this.liveDocs()) {
      const page = this.pageOf(doc);
      if (!page || !files[page] || !isHtmlFile(page)) continue;
      for (const [id, now] of declaredPositions(textOf(files[page]))) {
        const el = doc.getElementById(id) as HTMLElement | null;
        if (!el) continue;
        let built = this.builtAt.get(el);
        if (!built) this.builtAt.set(el, (built = now));
        const dx = now.x - built.x;
        const dy = now.y - built.y;
        const value = dx || dy ? `${dx}px ${dy}px` : '';
        for (const part of objectParts(doc, id, el)) if (part.style.translate !== value) part.style.translate = value;
      }
    }
  }

  // ---- removing objects (see removeObjects.ts: they're hidden by id, so page scripts keep working) ----

  /** Hide objects on pages: page path → ids. One undo step. */
  async removeObjects(label: string, byPage: Map<string, string[]>, parts?: Map<string, string[]>) {
    const files = store.project!.files;
    const writes: FileChange[] = [];
    for (const [page, ids] of byPage) {
      const html = textOf(files[page]);
      const next = setHidden(html, [...hiddenIds(html), ...ids], parts);
      if (next !== html) writes.push({ path: page, bytes: encodeText(next) });
    }
    await store.write(label, writes, { fromStage: true });
    this.syncRemoved();
    const pages = byPage.size;
    store.setStatus(`${label}${pages > 1 ? ` on ${pages} pages` : ''}. Undo with Ctrl+Z (⌘Z), or restore it from the page assets panel.`);
    this.emit();
  }

  /** Show a removed object again on the given pages. */
  async restoreObject(id: string, pages: string[]) {
    const files = store.project!.files;
    const writes: FileChange[] = [];
    for (const page of pages) {
      const html = textOf(files[page]);
      const next = setHidden(html, hiddenIds(html).filter((x) => x !== id));
      if (next !== html) writes.push({ path: page, bytes: encodeText(next) });
    }
    await store.write(`Restore ${id}`, writes, { fromStage: true });
    this.syncRemoved();
    this.emit();
  }

  /**
   * Make the running page match what its source hides (after a removal, restore, undo or redo)
   * without reloading it, so the learner's place in the course is kept.
   */
  syncRemoved() {
    const files = store.project?.files;
    if (!files) return;
    for (const doc of this.liveDocs()) {
      const page = this.pageOf(doc);
      if (!page || !files[page] || !isHtmlFile(page)) continue;
      const rules = hiddenRules(textOf(files[page]));
      const css = removedCss([...rules.keys()], rules);
      // The page may have loaded with an older copy of the rules baked in; keep that one current too.
      const baked = doc.getElementById(REMOVED_STYLE_ID);
      if (baked && baked.textContent !== css) baked.textContent = css;
      let tag = doc.getElementById('lc-removed-live');
      if (!tag) {
        if (!css) continue;
        tag = doc.createElement('style');
        tag.id = 'lc-removed-live';
        (doc.head ?? doc.documentElement).appendChild(tag);
      }
      if (tag.textContent !== css) tag.textContent = css;
    }
  }

  // ---- documents currently shown in the Live stage (the page plus any frames) ----

  private docs = new Set<Document>();
  private emitTimer: ReturnType<typeof setTimeout> | undefined;

  register(doc: Document) {
    this.docs.add(doc);
    // Authoring runtimes keep building objects after load; refresh the asset list shortly after.
    clearTimeout(this.emitTimer);
    this.emitTimer = setTimeout(() => this.emit(), 600);
  }

  liveDocs(): Document[] {
    for (const d of this.docs) if (!d.defaultView) this.docs.delete(d);
    return [...this.docs];
  }

  /** Package path of the page showing in the stage (it changes as you click through in Interact mode). */
  stagePagePath(): string | null {
    const top = this.liveDocs().find((d) => d.defaultView?.frameElement?.classList.contains('stage-iframe'));
    return top ? this.pageOf(top) : null;
  }

  /** Every element in a document that displays a package file. */
  assetUses(doc: Document): AssetUse[] {
    const out: AssetUse[] = [];
    const win = doc.defaultView;
    const add = (element: Element, url: string | null | undefined, via: AssetUse['via']) => {
      if (!url) return;
      let abs: string;
      try {
        abs = new URL(url, doc.baseURI).href;
      } catch {
        return;
      }
      const path = this.pathFromUrl(abs);
      if (path && !isHtmlFile(path) && !/\.(js|css|json|xml)$/i.test(path)) out.push({ path, element, via });
    };
    for (const el of Array.from(doc.querySelectorAll('img, image, video, audio, source, track, embed, object, iframe, frame, a[href], [poster]'))) {
      const tag = el.tagName.toLowerCase();
      if (tag === 'img') add(el, (el as HTMLImageElement).currentSrc || el.getAttribute('src'), 'src');
      else if (tag === 'image') add(el, el.getAttribute('href') ?? el.getAttribute('xlink:href'), 'src');
      else if (tag === 'video' || tag === 'audio') add(el, (el as HTMLMediaElement).currentSrc || el.getAttribute('src'), 'src');
      else if (tag === 'source' || tag === 'track' || tag === 'embed' || tag === 'iframe' || tag === 'frame') add(el, el.getAttribute('src'), 'src');
      else if (tag === 'object') add(el, el.getAttribute('data'), 'src');
      else if (tag === 'a') add(el, el.getAttribute('href'), 'link');
      if (el.hasAttribute('poster')) add(el, el.getAttribute('poster'), 'src');
    }
    if (win) {
      for (const el of Array.from(doc.querySelectorAll('body, body *'))) {
        const bg = win.getComputedStyle(el).backgroundImage;
        if (!bg || bg === 'none') continue;
        for (const m of bg.matchAll(/url\(["']?([^"')]+)["']?\)/g)) add(el, m[1], 'background');
      }
    }
    return out;
  }

  /**
   * All assets a page uses: what is on screen now, plus files its source
   * names that aren't showing yet (popups, audio played by an action, later
   * states). Lectora builds many objects only when an action shows them.
   */
  pageAssets(pagePath: string | null): PageAsset[] {
    const files = store.project?.files ?? {};
    const byPath = new Map<string, PageAsset>();
    const entry = (path: string) => {
      let a = byPath.get(path);
      if (!a) {
        a = { path, kind: assetKind(path), bytes: files[path]?.length ?? 0, elements: [] };
        byPath.set(path, a);
      }
      return a;
    };
    for (const doc of this.liveDocs()) {
      for (const use of this.assetUses(doc)) {
        if (!files[use.path]) continue;
        const el = use.element.tagName.toLowerCase() === 'source' && use.element.parentElement ? use.element.parentElement : use.element;
        const a = entry(use.path);
        if (!a.elements.includes(el)) a.elements.push(el);
      }
    }
    if (pagePath && files[pagePath]) {
      for (const path of referencedAssets(pagePath, files)) entry(path);
    }
    return [...byPath.values()]
      .filter((a) => !isSpacer(a))
      .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || Number(b.elements.length > 0) - Number(a.elements.length > 0) || a.path.localeCompare(b.path));
  }
}

export interface AssetUse {
  path: string;
  element: Element;
  via: 'src' | 'background' | 'link';
}

export type AssetKind = 'image' | 'video' | 'audio' | 'other';

export interface PageAsset {
  path: string;
  kind: AssetKind;
  bytes: number;
  /** Elements showing it right now; empty when it is only named in the source. */
  elements: Element[];
}

const KIND_ORDER: AssetKind[] = ['image', 'video', 'audio', 'other'];

export function assetKind(path: string): AssetKind {
  if (isImageFile(path)) return 'image';
  if (/\.(mp4|webm|ogv|m4v|mov|flv)$/i.test(path)) return 'video';
  if (/\.(mp3|wav|ogg|oga|m4a|aac)$/i.test(path)) return 'audio';
  return 'other';
}

/** Lectora and older tools use transparent 1x1 GIFs for layout; they're noise here. */
function isSpacer(a: PageAsset): boolean {
  if (/(^|\/)(trans|spacer|blank|clear|pixel)\.gif$/i.test(a.path)) return true;
  return a.kind === 'image' && a.bytes > 0 && a.bytes < 100 && /\.gif$/i.test(a.path);
}

export const live = new LiveSession();

export function useLive(): LiveSession {
  useSyncExternalStore(live.subscribe, live.getVersion);
  return live;
}

/** Visible, non-empty text nodes inside an element. */
export function textNodesOf(el: Element, limit = 40): Text[] {
  const out: Text[] = [];
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      const p = n.parentElement;
      if (!p || /^(script|style|noscript|template)$/i.test(p.tagName)) return NodeFilter.FILTER_REJECT;
      return visibleText((n as Text).data) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  for (let n = walker.nextNode(); n && out.length < limit; n = walker.nextNode()) out.push(n as Text);
  return out;
}

/** An object's element plus any of its parts drawn outside it (Lectora's separate click-area SVGs). */
export function objectParts(doc: Document, id: string, root: Element): (HTMLElement | SVGElement)[] {
  const found = [root as HTMLElement];
  for (const pid of partIds(id)) {
    const e = pid === id ? null : (doc.getElementById(pid) as HTMLElement | null);
    if (e && !found.includes(e)) found.push(e);
  }
  // Move each outermost piece once; a path inside a moved SVG moves with it.
  return found.filter((e) => !found.some((o) => o !== e && o.contains(e)));
}
