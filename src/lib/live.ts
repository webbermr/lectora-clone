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

  /** Files most likely to hold this document's text, best first. */
  private priorityFiles(doc: Document | null): string[] {
    const files = store.project!.files;
    const order: string[] = [];
    const add = (p: string | null) => {
      if (p && files[p] && isTextFile(p) && !order.includes(p) && !p.includes('__lc_edit__')) order.push(p);
    };
    if (doc) {
      const page = this.pathFromUrl(doc.location.href);
      add(page);
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
        // Default to every hit in the best file; the user confirms or adjusts.
        const firstPath = matches[0].path;
        const pre = new Set(matches.map((m, i) => (m.path === firstPath ? i : -1)).filter((i) => i >= 0));
        chosen = await chooseMatches(`"${old.slice(0, 60)}" appears ${matches.length} times`, next, matches, pre);
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
    return top ? this.pathFromUrl(top.location.href) : null;
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
