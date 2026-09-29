import { useEffect, useRef, useState } from 'react';
import { editor } from '../lib/editor';
import { extractDoctype, toEditCopy } from '../lib/html';
import { isHtmlFile } from '../lib/paths';
import { store, useStore } from '../lib/store';
import { encodeText } from '../lib/text';
import { editCopyPath, putFile, vfsUrl } from '../lib/vfs';

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;

export const STAGE_WIDTHS: Record<string, string> = {
  Fit: '100%',
  'Desktop 1280': '1280px',
  'Laptop 1024': '1024px',
  'Tablet 768': '768px',
  'Phone 390': '390px',
};

export function EditStage({ width }: { width: string }) {
  const s = useStore();
  const path = s.currentPath;
  const projectId = s.project?.id;
  const revision = path ? s.revisions[path] ?? 0 : 0;
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const hoverRef = useRef<HTMLDivElement>(null);
  const selRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const hovered = useRef<HTMLElement | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [scripted, setScripted] = useState(false);
  const doctypeRef = useRef('');
  const cleanupRef = useRef<() => void>(() => {});

  // Build the scripts-disabled edit copy whenever the page changes from outside.
  useEffect(() => {
    let cancelled = false;
    editor.attach(null, null, '');
    setScripted(false);
    if (!projectId || !path || !isHtmlFile(path)) {
      setSrc(null);
      return;
    }
    const text = store.readText(path) ?? '';
    doctypeRef.current = extractDoctype(text);
    const copy = editCopyPath(path);
    void putFile(projectId, copy, encodeText(toEditCopy(text))).then(() => {
      if (!cancelled) setSrc(vfsUrl(projectId, copy) + '?v=' + Date.now());
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, path, revision]);

  useEffect(() => () => {
    cleanupRef.current();
    editor.attach(null, null, '');
  }, []);

  // Keep the hover/selection boxes glued to their elements (scrolling, reflow, images loading).
  useEffect(() => {
    let raf = 0;
    const place = (box: HTMLDivElement | null, el: HTMLElement | null) => {
      if (!box) return;
      if (!el || !el.isConnected) {
        box.style.display = 'none';
        return;
      }
      const r = el.getBoundingClientRect();
      box.style.display = 'block';
      box.style.transform = `translate(${r.left}px, ${r.top}px)`;
      box.style.width = `${r.width}px`;
      box.style.height = `${r.height}px`;
    };
    const tick = () => {
      const sel = editor.selected;
      place(selRef.current, sel);
      place(hoverRef.current, hovered.current && hovered.current !== sel ? hovered.current : null);
      if (labelRef.current && sel) {
        labelRef.current.textContent = describe(sel) + (editor.editingText === sel ? ' — editing text (Esc to finish)' : '');
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const onLoad = () => {
    cleanupRef.current();
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!doc || !path) return;
    editor.attach(doc, path, doctypeRef.current);
    cleanupRef.current = wireDocument(doc, hovered);
    setScripted(looksScriptBuilt(doc));
  };

  const startResize = (dir: string, e: React.PointerEvent) => {
    const el = editor.selected;
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    const cs = el.ownerDocument.defaultView!.getComputedStyle(el);
    const startW = parseFloat(cs.width) || el.offsetWidth;
    const startH = parseFloat(cs.height) || el.offsetHeight;
    const needsPos = dir.includes('n') || dir.includes('w');
    const base = needsPos ? editor.positionBase(el) : { left: 0, top: 0 };
    const sx = e.clientX;
    const sy = e.clientY;
    const keepRatio = el.tagName === 'IMG' || e.shiftKey;
    const ratio = startH ? startW / startH : 1;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      let w = startW;
      let h = startH;
      if (dir.includes('e')) w = startW + dx;
      if (dir.includes('w')) w = startW - dx;
      if (dir.includes('s')) h = startH + dy;
      if (dir.includes('n')) h = startH - dy;
      // Corner handles keep the aspect ratio for images (or any object with Shift).
      if (keepRatio && dir.length === 2) h = w / ratio;
      w = Math.max(4, Math.round(w));
      h = Math.max(4, Math.round(h));
      if (dir !== 'n' && dir !== 's') el.style.width = `${w}px`;
      if (dir !== 'e' && dir !== 'w') el.style.height = `${h}px`;
      else if (el.tagName === 'IMG') el.style.height = 'auto';
      if (dir.includes('w')) el.style.left = `${Math.round(base.left + (startW - w))}px`;
      if (dir.includes('n')) el.style.top = `${Math.round(base.top + (startH - h))}px`;
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      void editor.commit('Resize object');
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  };

  if (!path) return <div className="stage-empty">Select a page in the Title Explorer, or an HTML file in Files.</div>;
  if (!isHtmlFile(path)) {
    return <div className="stage-empty">{path} is not an HTML page. Use the Code view to edit it.</div>;
  }

  return (
    <div className="stage-col">
      {scripted && (
        <div className="banner">
          <span>
            <b>This page is built by JavaScript</b>, so there's little or nothing to edit in its raw HTML. Live edit runs
            the scripts and lets you click the text and images you see.
          </span>
          <button className="primary" onClick={() => store.setView('live')}>⚡ Open in Live edit</button>
        </div>
      )}
    <div className="stage-scroll">
      <div className="stage-frame" style={{ width }}>
        {src && <iframe ref={iframeRef} src={src} onLoad={onLoad} title="Page editor" className="stage-iframe" />}
        <div className="overlay">
          <div ref={hoverRef} className="hover-box" />
          <div ref={selRef} className="sel-box">
            <span ref={labelRef} className="sel-label" />
            {HANDLES.map((h) => (
              <div key={h} className={`handle h-${h}`} onPointerDown={(e) => startResize(h, e)} />
            ))}
          </div>
        </div>
      </div>
    </div>
    </div>
  );
}

/** Little visible text but plenty of script: the page is drawn at runtime. */
function looksScriptBuilt(doc: Document): boolean {
  const body = doc.body?.cloneNode(true) as HTMLElement | undefined;
  body?.querySelectorAll('script, style, noscript, template').forEach((n) => n.remove());
  const text = (body?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const media = doc.body?.querySelectorAll('img, video, svg, canvas').length ?? 0;
  const scripts = Array.from(doc.scripts);
  const inline = scripts.reduce((n, sc) => n + (sc.src ? 0 : sc.textContent?.length ?? 0), 0);
  // Nearly empty body with scripts, or a body that is mostly one big inline script.
  const empty = text.length < 40 && media < 2 && scripts.length > 0;
  const mostlyScript = inline > 3000 && inline > text.length * 10;
  return empty || mostlyScript;
}

export function describe(el: Element): string {
  let s = el.tagName.toLowerCase();
  if (el.id) s += '#' + el.id;
  const cls = (el.getAttribute('class') ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (cls.length) s += '.' + cls.join('.');
  return s;
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
}

let nudgeTimer: ReturnType<typeof setTimeout> | undefined;

/** Keyboard shortcuts shared by the stage document and the app window. */
export function handleEditorKey(e: KeyboardEvent): boolean {
  const mod = e.ctrlKey || e.metaKey;
  if (editor.editingText) {
    if (e.key === 'Escape') {
      editor.stopTextEdit();
      return true;
    }
    return false;
  }
  if (mod && e.key.toLowerCase() === 'z') {
    void (e.shiftKey ? store.redo() : store.undo());
    return true;
  }
  if (mod && e.key.toLowerCase() === 'y') {
    void store.redo();
    return true;
  }
  if (isTyping(e.target)) return false;
  const el = editor.selected;
  if (!el) return false;
  if (e.key === 'Delete' || e.key === 'Backspace') {
    void editor.deleteSelected();
    return true;
  }
  if (mod && e.key.toLowerCase() === 'd') {
    void editor.duplicateSelected();
    return true;
  }
  if (e.key === 'Escape') {
    editor.select(null);
    return true;
  }
  if (e.key === 'Enter') {
    editor.startTextEdit(el);
    return true;
  }
  const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (arrows[e.key]) {
    const step = e.shiftKey ? 10 : 1;
    const base = editor.positionBase(el);
    el.style.left = `${base.left + arrows[e.key][0] * step}px`;
    el.style.top = `${base.top + arrows[e.key][1] * step}px`;
    clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(() => void editor.commit('Nudge object'), 400);
    return true;
  }
  return false;
}

/** Attach selection, drag-to-move, text editing and shortcuts to the stage document. */
function wireDocument(doc: Document, hovered: React.MutableRefObject<HTMLElement | null>): () => void {
  let drag: { el: HTMLElement; sx: number; sy: number; base: { left: number; top: number } | null; moved: boolean } | null = null;

  const elementAt = (t: EventTarget | null): HTMLElement | null => {
    let n = t as Node | null;
    while (n && n.nodeType !== 1) n = n.parentNode;
    return n as HTMLElement | null;
  };
  const inTextEdit = (t: EventTarget | null) => {
    const el = elementAt(t);
    return !!(editor.editingText && el && editor.editingText.contains(el));
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || inTextEdit(e.target)) return;
    const el = elementAt(e.target);
    if (!el) return;
    e.preventDefault();
    if (editor.editingText) editor.stopTextEdit();
    // Alt-click walks up to the parent of the current selection.
    const target = e.altKey && editor.selected?.parentElement ? editor.selected.parentElement : el;
    editor.select(target);
    if (target === doc.body || target === doc.documentElement) return;
    drag = { el: target, sx: e.clientX, sy: e.clientY, base: null, moved: false };
    target.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!drag) {
      const el = elementAt(e.target);
      hovered.current = el === doc.body || el === doc.documentElement ? null : el;
      return;
    }
    const dx = e.clientX - drag.sx;
    const dy = e.clientY - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    if (!drag.base) drag.base = editor.positionBase(drag.el);
    drag.moved = true;
    drag.el.style.left = `${Math.round(drag.base.left + dx)}px`;
    drag.el.style.top = `${Math.round(drag.base.top + dy)}px`;
  };

  const onPointerUp = (e: PointerEvent) => {
    if (!drag) return;
    drag.el.releasePointerCapture?.(e.pointerId);
    if (drag.moved) void editor.commit('Move object');
    drag = null;
  };

  const block = (e: Event) => {
    if (!inTextEdit(e.target)) e.preventDefault();
  };

  const onDblClick = (e: MouseEvent) => {
    const el = elementAt(e.target);
    if (!el || inTextEdit(e.target)) return;
    e.preventDefault();
    editor.select(el);
    editor.startTextEdit(el);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (handleEditorKey(e)) e.preventDefault();
  };

  const onFocusOut = (e: FocusEvent) => {
    const ed = editor.editingText;
    if (ed && e.target === ed && !ed.contains(e.relatedTarget as Node | null)) editor.stopTextEdit();
  };

  const onLeave = () => {
    hovered.current = null;
  };

  const opts = { capture: true };
  doc.addEventListener('pointerdown', onPointerDown, opts);
  doc.addEventListener('pointermove', onPointerMove, opts);
  doc.addEventListener('pointerup', onPointerUp, opts);
  doc.addEventListener('mousedown', block, opts);
  doc.addEventListener('click', block, opts);
  doc.addEventListener('submit', block, opts);
  doc.addEventListener('dragstart', block, opts);
  doc.addEventListener('dblclick', onDblClick, opts);
  doc.addEventListener('keydown', onKeyDown, opts);
  doc.addEventListener('focusout', onFocusOut, opts);
  doc.documentElement.addEventListener('mouseleave', onLeave);
  return () => {
    doc.removeEventListener('pointerdown', onPointerDown, opts);
    doc.removeEventListener('pointermove', onPointerMove, opts);
    doc.removeEventListener('pointerup', onPointerUp, opts);
    doc.removeEventListener('mousedown', block, opts);
    doc.removeEventListener('click', block, opts);
    doc.removeEventListener('submit', block, opts);
    doc.removeEventListener('dragstart', block, opts);
    doc.removeEventListener('dblclick', onDblClick, opts);
    doc.removeEventListener('keydown', onKeyDown, opts);
    doc.removeEventListener('focusout', onFocusOut, opts);
    doc.documentElement.removeEventListener('mouseleave', onLeave);
  };
}
