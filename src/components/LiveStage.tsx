import { useEffect, useMemo, useRef, useState } from 'react';
import { live, textNodesOf, useLive } from '../lib/live';
import { flattenItems } from '../lib/manifest';
import { isHtmlFile } from '../lib/paths';
import { previewLms } from '../lib/scormApi';
import { store, useStore } from '../lib/store';
import { vfsUrl } from '../lib/vfs';
import { useFollowFrame } from '../lib/frameFollow';
import { undoShortcut } from '../lib/undoKeys';
import { warmSignatures } from '../lib/objectTwins';

const LIVE_CSS =
  '[data-lc-live-hover]{outline:2px dashed #2f7de1!important;outline-offset:1px!important;cursor:pointer!important}' +
  '[data-lc-live-sel]{outline:3px solid #2f7de1!important;outline-offset:1px!important;cursor:move!important}' +
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
  useFollowFrame(iframeRef, p.id);
  // Matching an object to its copies on other pages reads every page once; do that in the background.
  useEffect(() => warmSignatures(p.files), [p.files]);

  useEffect(() => {
    previewLms.install(window);
    // S / I switch modes from anywhere in the editor (the page's own keys are handled in wireDocument).
    const onKey = (e: KeyboardEvent) => {
      if (modeShortcut(e) || nudgeShortcut(e)) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    // Undo/redo of a removal changes the source; mirror it on the running page.
    const unsub = store.subscribe(() => {
      live.syncRemoved();
      live.syncMoved();
    });
    return () => {
      unsub();
      window.removeEventListener('keydown', onKey);
      live.select(null);
    };
  }, []);

  // Pages can load more frames or swap documents as the learner moves on
  // (Lectora frames, Storyline slides). Keep wiring whatever is showing.
  useEffect(() => {
    const wired = new WeakSet<Document>();
    const scan = () => {
      const root = iframeRef.current?.contentDocument;
      if (root) wireTree(root, wired);
      live.syncRemoved();
      live.syncMoved();
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
          <button className={lv.mode === 'select' ? 'active' : ''} onClick={() => live.setMode('select')} title="Click text or images to edit them (shortcut: S)" aria-keyshortcuts="S">
            ✎ Select &amp; edit <kbd>S</kbd>
          </button>
          <button className={lv.mode === 'interact' ? 'active' : ''} onClick={() => live.setMode('interact')} title="Use the page normally, e.g. click Next to reach the slide you want (shortcut: I)" aria-keyshortcuts="I">
            🖱 Interact <kbd>I</kbd>
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

const TEXT_INPUTS = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number', 'date', 'datetime-local', 'month', 'time', 'week', '']);

/** True when the key is going into something the user types in (in the editor or inside the course page). */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName.toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return tag === 'INPUT' && TEXT_INPUTS.has(((el as HTMLInputElement).type ?? '').toLowerCase());
}

/**
 * S → Select & edit, I → Interact. Ignored while typing in a text box, with
 * modifier keys (so Ctrl+S etc. still work), or while a dialog is open.
 */
export function modeShortcut(e: KeyboardEvent): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.defaultPrevented) return false;
  const k = e.key.toLowerCase();
  if (k !== 's' && k !== 'i') return false;
  if (isTypingTarget(e.target) || document.querySelector('.modal-backdrop')) return false;
  live.setMode(k === 's' ? 'select' : 'interact');
  return true;
}

/** Arrow keys nudge the selected object 1px (Shift: 10px) in Select & edit mode. */
export function nudgeShortcut(e: KeyboardEvent): boolean {
  const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (!dir || e.ctrlKey || e.metaKey || e.altKey || live.mode !== 'select' || !live.selected) return false;
  if (isTypingTarget(e.target) || document.querySelector('.modal-backdrop')) return false;
  const step = e.shiftKey ? 10 : 1;
  return live.nudge(dir[0] * step, dir[1] * step);
}

function wireTree(doc: Document, wired: WeakSet<Document>) {
  if (!wired.has(doc) && doc.documentElement) {
    wired.add(doc);
    wireDocument(doc);
    live.register(doc);
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
    if (justDragged) return; // the end of a drag, not a new selection
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
    if (!editing) {
      // Mode shortcuts work while the page has focus too; the course never sees the key.
      if (modeShortcut(e) || undoShortcut(e) || nudgeShortcut(e)) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
      return;
    }
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

  // Drag the selected object to move it. It follows the pointer on screen and is saved on drop.
  let drag: { x0: number; y0: number; scale: number; moved: boolean; pointer: number; target: Element } | null = null;
  let justDragged = false;
  let frame = 0;
  let last: PointerEvent | null = null;
  const onDragStart = (e: PointerEvent) => {
    if (!active() || editing || e.button !== 0) return;
    const sel = live.selectedObject();
    const hit = elementOf(e.target);
    if (!sel || sel.doc !== doc || !hit || live.selectedObject(hit)?.id !== sel.id) return;
    live.beginMove(doc, sel.id, sel.at);
    // Lectora scales the page to fit; convert screen pixels to the page's own.
    const pageDiv = doc.getElementById('pageDIV') as HTMLElement | null;
    const scale = pageDiv?.offsetWidth ? pageDiv.getBoundingClientRect().width / pageDiv.offsetWidth || 1 : 1;
    drag = { x0: e.clientX, y0: e.clientY, scale, moved: false, pointer: e.pointerId, target: hit };
    // Keep getting the pointer even if it leaves the object (or the page) mid-drag.
    try {
      hit.setPointerCapture(e.pointerId);
    } catch {
      // not capturable; window listeners still see moves inside the page
    }
  };
  const onDragMove = (e: PointerEvent) => {
    if (!drag) return;
    const dx = (e.clientX - drag.x0) / drag.scale;
    const dy = (e.clientY - drag.y0) / drag.scale;
    if (!drag.moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
    drag.moved = true;
    e.preventDefault();
    // One update per frame, however many pointer events arrive.
    last = e;
    if (!frame) {
      frame = win.requestAnimationFrame(() => {
        frame = 0;
        if (!drag || !last) return;
        live.previewMove((last.clientX - drag.x0) / drag.scale, (last.clientY - drag.y0) / drag.scale);
      });
    }
  };
  const onDragEnd = (e?: PointerEvent) => {
    const d = drag;
    drag = null;
    if (!d) return;
    if (frame) win.cancelAnimationFrame(frame);
    frame = 0;
    try {
      d.target.releasePointerCapture(d.pointer);
    } catch {
      // already released
    }
    if (!d.moved) return;
    if (e) live.previewMove((e.clientX - d.x0) / d.scale, (e.clientY - d.y0) / d.scale);
    justDragged = true;
    setTimeout(() => (justDragged = false), 0);
    void live.commitMove();
  };

  const onOver = (e: Event) => setHover(active() && !editing ? elementOf(e.target) : null);
  const onFocusOut = (e: FocusEvent) => {
    if (editing && e.target === editing.el) void finish(true);
  };

  const opts = { capture: true };
  win.addEventListener('pointerdown', onDragStart, opts);
  win.addEventListener('pointermove', onDragMove, opts);
  win.addEventListener('pointerup', onDragEnd, opts);
  win.addEventListener('pointercancel', () => onDragEnd(), opts);
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
