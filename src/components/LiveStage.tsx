import { useEffect, useMemo, useRef, useState } from 'react';
import { live, textNodesOf, useLive } from '../lib/live';
import { flattenItems } from '../lib/manifest';
import { isHtmlFile } from '../lib/paths';
import { previewLms } from '../lib/scormApi';
import { useStore } from '../lib/store';
import { vfsUrl } from '../lib/vfs';

const LIVE_CSS =
  '[data-lc-live-hover]{outline:2px dashed #2f7de1!important;outline-offset:1px!important;cursor:pointer!important}' +
  '[data-lc-live-sel]{outline:3px solid #2f7de1!important;outline-offset:1px!important}' +
  '[data-lc-live-editing]{outline:3px solid #e1a92f!important;cursor:text!important}';

/**
 * Runs the page with its scripts, like Preview, but lets you click text and
 * images to change them. Edits are written back to the package source.
 */
export function LiveStage({ width }: { width: string }) {
  const s = useStore();
  const lv = useLive();
  const p = s.project!;
  const item = useMemo(
    () => flattenItems(p.manifest?.items ?? []).find((i) => i.identifier === s.currentItemId),
    [p.manifest, s.currentItemId],
  );
  const path = s.currentPath;
  const [nonce, setNonce] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    previewLms.install(window);
    return () => live.select(null);
  }, []);

  // Pages can load more frames or swap documents as the learner moves on
  // (Lectora frames, Storyline slides). Keep wiring whatever is showing.
  useEffect(() => {
    const wired = new WeakSet<Document>();
    const scan = () => {
      const root = iframeRef.current?.contentDocument;
      if (root) wireTree(root, wired);
    };
    const timer = setInterval(scan, 700);
    return () => clearInterval(timer);
  }, [nonce, path]);

  if (!path) return <div className="stage-empty">Select a page to live-edit.</div>;
  if (!isHtmlFile(path)) return <div className="stage-empty">{path} is not a page. Pick an HTML file.</div>;
  const src = vfsUrl(p.id, path) + (item?.href === path ? item.query : '');

  return (
    <div className="preview">
      <div className="preview-bar">
        <div className="segmented" role="group" aria-label="Live edit mode">
          <button className={lv.mode === 'select' ? 'active' : ''} onClick={() => live.setMode('select')} title="Click text or images to edit them">
            ✎ Select &amp; edit
          </button>
          <button className={lv.mode === 'interact' ? 'active' : ''} onClick={() => live.setMode('interact')} title="Use the page normally, e.g. click Next to reach the slide you want">
            🖱 Interact
          </button>
        </div>
        <span className="muted small">
          {lv.mode === 'select'
            ? 'Click text or an image to select it. Double-click text to type over it. Enter saves, Esc cancels.'
            : 'Navigate the course to the screen you want, then switch back to Select & edit.'}
        </span>
        <span className="spacer" />
        <button onClick={() => setNonce((n) => n + 1)} title="Reload the page from the saved package">⟳ Reload</button>
      </div>
      <div className="stage-scroll">
        <div className="stage-frame" style={{ width }}>
          <iframe ref={iframeRef} key={`${src}#${nonce}`} src={src} title="Live editor" className="stage-iframe" allow="autoplay; fullscreen" />
        </div>
      </div>
    </div>
  );
}

function wireTree(doc: Document, wired: WeakSet<Document>) {
  if (!wired.has(doc) && doc.documentElement) {
    wired.add(doc);
    wireDocument(doc);
  }
  for (const f of Array.from(doc.querySelectorAll('iframe, frame'))) {
    try {
      const child = (f as HTMLIFrameElement).contentDocument;
      if (child) wireTree(child, wired);
    } catch {
      /* cross-origin frame: leave it alone */
    }
  }
}

function elementOf(t: EventTarget | null): Element | null {
  let n = t as Node | null;
  while (n && n.nodeType !== 1) n = n.parentNode;
  return n as Element | null;
}

function wireDocument(doc: Document) {
  const style = doc.createElement('style');
  style.textContent = LIVE_CSS;
  (doc.head ?? doc.documentElement).appendChild(style);

  let hovered: Element | null = null;
  let editing: { el: HTMLElement; snapshot: [Text, string][]; hadEditable: string | null } | null = null;
  const win = doc.defaultView!;
  const active = () => live.mode === 'select';
  const inEdit = (t: EventTarget | null) => !!(editing && editing.el.contains(t as Node));

  const setHover = (el: Element | null) => {
    hovered?.removeAttribute('data-lc-live-hover');
    hovered = el && el !== doc.body && el !== doc.documentElement ? el : null;
    hovered?.setAttribute('data-lc-live-hover', '');
  };

  const finish = async (save: boolean) => {
    const ed = editing;
    if (!ed) return;
    editing = null;
    ed.el.removeAttribute('data-lc-live-editing');
    if (ed.hadEditable === null) ed.el.removeAttribute('contenteditable');
    else ed.el.setAttribute('contenteditable', ed.hadEditable);
    const changes = ed.snapshot
      .filter(([node, old]) => node.data !== old)
      .map(([node, old]) => ({ node, old, next: node.data }));
    if (!save) {
      changes.forEach((c) => (c.node.data = c.old));
      return;
    }
    const failed = await live.applyText(changes, doc);
    // Put back anything we couldn't save, so the screen never lies about the file.
    failed.forEach((c) => (c.node.data = c.old));
    live.emit();
  };

  const startEdit = (el: Element) => {
    // SVG text can't be typed into; it's edited from the Properties panel instead.
    if (el.namespaceURI !== 'http://www.w3.org/1999/xhtml') return;
    const nodes = textNodesOf(el);
    if (!nodes.length) return;
    editing = { el: el as HTMLElement, snapshot: nodes.map((n) => [n, n.data]), hadEditable: el.getAttribute('contenteditable') };
    el.setAttribute('contenteditable', 'true');
    el.setAttribute('data-lc-live-editing', '');
    (el as HTMLElement).focus();
  };

  const swallow = (e: Event) => {
    if (!active() || inEdit(e.target)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };

  const onClick = (e: MouseEvent) => {
    if (!active() || inEdit(e.target)) return;
    swallow(e);
    if (editing) void finish(true);
    live.select(elementOf(e.target));
  };

  const onDblClick = (e: MouseEvent) => {
    if (!active() || inEdit(e.target)) return;
    swallow(e);
    const el = elementOf(e.target);
    if (!el) return;
    live.select(el);
    startEdit(el);
  };

  const onKey = (e: KeyboardEvent) => {
    if (!editing) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void finish(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      void finish(false);
    }
    // Stop course keyboard shortcuts (next slide, etc.) while typing.
    e.stopImmediatePropagation();
  };

  const onOver = (e: Event) => setHover(active() && !editing ? elementOf(e.target) : null);
  const onFocusOut = (e: FocusEvent) => {
    if (editing && e.target === editing.el) void finish(true);
  };

  const opts = { capture: true };
  // Block the course's own handlers so selecting a button doesn't press it.
  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'submit', 'dragstart', 'contextmenu']) {
    win.addEventListener(type, swallow, opts);
  }
  win.addEventListener('click', onClick, opts);
  win.addEventListener('dblclick', onDblClick, opts);
  win.addEventListener('keydown', onKey, opts);
  win.addEventListener('keyup', (e) => editing && e.stopImmediatePropagation(), opts);
  win.addEventListener('keypress', (e) => editing && e.stopImmediatePropagation(), opts);
  win.addEventListener('mouseover', onOver, opts);
  win.addEventListener('focusout', onFocusOut, opts);
}
