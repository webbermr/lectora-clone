/**
 * Live edit: the page runs with its scripts, exactly as a learner sees it.
 * Text you change on screen is traced back to wherever the package stores it
 * (HTML, a JavaScript string, a JSON data file) and rewritten there. Images
 * are replaced by overwriting the file the page loads.
 */
import { useSyncExternalStore } from 'react';
import { chooseMatches } from './dialog';
import { isTextFile, resolveFrom } from './paths';
import { applyToText, findEverywhere, visibleText, type SourceMatch } from './sourceMatch';
import { store, type FileChange } from './store';
import { decodeText, encodeText } from './text';
import { vfsUrl } from './vfs';

// Decoding every text file on each search is wasteful; file bytes are replaced, never mutated.
const decoded = new WeakMap<Uint8Array, string>();
function textOf(bytes: Uint8Array): string {
  let t = decoded.get(bytes);
  if (t === undefined) {
    t = decodeText(bytes);
    decoded.set(bytes, t);
  }
  return t;
}

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
      store.setStatus(`Updated ${applied} place${applied > 1 ? 's' : ''} in ${[...where].join(', ')}` + (failed.length ? ` · ${failed.length} not found` : ''));
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

  /** Overwrite an asset's bytes in place, keeping its name so no references change. */
  async replaceAsset(path: string, file: File, el: Element) {
    await store.write(`Replace ${path}`, [{ path, bytes: new Uint8Array(await file.arrayBuffer()) }]);
    // Bust the browser's image cache so the new file shows immediately.
    const bust = (u: string) => u.split('#')[0] + (u.includes('?') ? '&' : '?') + 'lc=' + Date.now();
    if (el instanceof HTMLImageElement) {
      el.removeAttribute('srcset');
      el.src = bust(el.currentSrc || el.src);
    } else if (el instanceof HTMLMediaElement) {
      el.src = bust(el.currentSrc || el.src);
    } else if (el.tagName.toLowerCase() === 'image') {
      el.setAttribute('href', bust(el.getAttribute('href') ?? ''));
    } else if (el instanceof HTMLElement || el instanceof SVGElement) {
      const url = vfsUrl(store.project!.id, path);
      (el as HTMLElement).style.backgroundImage = `url("${bust(url)}")`;
    }
    store.setStatus(`Replaced ${path}${file.name.split('.').pop() !== path.split('.').pop() ? ' (kept the original file name so the page still finds it)' : ''}`);
  }
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
