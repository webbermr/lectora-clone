/**
 * The live editing session for the page shown in the Edit stage. Holds the
 * iframe document, the selected element, and turns DOM edits into saved,
 * undoable file writes.
 */
import { useSyncExternalStore } from 'react';
import { fromEditDocument } from './html';
import { relative } from './paths';
import { store } from './store';
import { objectHtml, type InsertKind } from './templates';

export const NON_TEXT_TAGS = new Set(['IMG', 'VIDEO', 'AUDIO', 'IFRAME', 'OBJECT', 'EMBED', 'CANVAS', 'SVG', 'INPUT', 'SELECT', 'HR', 'BR']);

class EditorSession {
  doc: Document | null = null;
  path: string | null = null;
  doctype = '';
  selected: HTMLElement | null = null;
  editingText: HTMLElement | null = null;
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

  attach(doc: Document | null, path: string | null, doctype: string) {
    this.doc = doc;
    this.path = path;
    this.doctype = doctype;
    this.selected = null;
    this.editingText = null;
    this.emit();
  }

  select(el: HTMLElement | null) {
    if (el && (el === this.doc?.documentElement || el === this.doc?.body)) el = null;
    if (this.editingText && this.editingText !== el) this.stopTextEdit();
    this.selected = el;
    this.emit();
  }

  /** Serialize the live document and save it as an undoable change. */
  async commit(label: string) {
    if (!this.doc || !this.path) return;
    const html = fromEditDocument(this.doc, this.doctype);
    await store.writeText(label, this.path, html, { fromStage: true });
    this.emit();
  }

  startTextEdit(el: HTMLElement) {
    if (NON_TEXT_TAGS.has(el.tagName.toUpperCase())) return;
    this.stopTextEdit();
    el.setAttribute('contenteditable', 'true');
    el.setAttribute('data-lc-ce', '');
    el.setAttribute('data-lc-editing', '');
    this.editingText = el;
    el.focus();
    const sel = el.ownerDocument.getSelection();
    if (sel) {
      sel.selectAllChildren(el);
      sel.collapseToEnd();
    }
    this.emit();
  }

  stopTextEdit() {
    const el = this.editingText;
    if (!el) return;
    this.editingText = null;
    // Only strip contenteditable if we added it; authored editable regions stay.
    if (el.hasAttribute('data-lc-ce')) el.removeAttribute('contenteditable');
    el.removeAttribute('data-lc-ce');
    el.removeAttribute('data-lc-editing');
    void this.commit('Edit text');
  }

  /** Where new objects go: Lectora-clone pages have .lc-page, others use <body>. */
  private container(): HTMLElement {
    const doc = this.doc!;
    return (doc.querySelector('.lc-page') as HTMLElement | null) ?? doc.body;
  }

  async insert(kind: InsertKind, assetPath?: string) {
    if (!this.doc || !this.path) return;
    const container = this.container();
    const rect = container.getBoundingClientRect();
    // Drop the object near the top-left of what is currently visible,
    // staggered so repeated inserts don't stack exactly on top of each other.
    const offset = 40 + (container.children.length % 8) * 16;
    const x = Math.round(Math.max(0, -rect.left) + offset);
    const y = Math.round(Math.max(0, -rect.top) + offset);
    const src = assetPath ? relative(this.path, assetPath) : '';
    const tpl = this.doc.createElement('template');
    tpl.innerHTML = objectHtml(kind, x, y, src);
    const el = tpl.content.firstElementChild as HTMLElement;
    container.appendChild(el);
    this.select(el);
    await this.commit(`Insert ${kind}`);
  }

  async deleteSelected() {
    const el = this.selected;
    if (!el) return;
    this.select(null);
    el.remove();
    await this.commit('Delete object');
  }

  async duplicateSelected() {
    const el = this.selected;
    if (!el) return;
    const copy = el.cloneNode(true) as HTMLElement;
    if (copy.id) copy.id = copy.id + '_copy';
    const pos = el.ownerDocument.defaultView!.getComputedStyle(el).position;
    if (pos === 'absolute' || pos === 'fixed' || pos === 'relative') {
      copy.style.left = (parseFloat(copy.style.left || '0') || 0) + 20 + 'px';
      copy.style.top = (parseFloat(copy.style.top || '0') || 0) + 20 + 'px';
    }
    el.after(copy);
    this.select(copy);
    await this.commit('Duplicate object');
  }

  async restack(where: 'front' | 'back' | 'forward' | 'backward') {
    const el = this.selected;
    if (!el || !el.parentElement) return;
    const win = el.ownerDocument.defaultView!;
    if (win.getComputedStyle(el).position === 'static') el.style.position = 'relative';
    const siblings = Array.from(el.parentElement.children).filter((c) => c !== el) as HTMLElement[];
    const zs = siblings.map((s) => parseInt(win.getComputedStyle(s).zIndex) || 0);
    const cur = parseInt(win.getComputedStyle(el).zIndex) || 0;
    let z = cur;
    if (where === 'front') z = Math.max(0, ...zs) + 1;
    else if (where === 'back') z = Math.min(0, ...zs) - 1;
    else if (where === 'forward') z = cur + 1;
    else z = cur - 1;
    el.style.zIndex = String(z);
    await this.commit('Change stacking order');
  }

  /**
   * Make sure an element can be moved with left/top, returning its current
   * offsets. Static elements become position:relative so layout is kept.
   */
  positionBase(el: HTMLElement): { left: number; top: number } {
    const cs = el.ownerDocument.defaultView!.getComputedStyle(el);
    if (cs.position === 'static') {
      el.style.position = 'relative';
      return { left: 0, top: 0 };
    }
    const left = parseFloat(cs.left);
    const top = parseFloat(cs.top);
    if (cs.position === 'relative') {
      return { left: parseFloat(el.style.left) || 0, top: parseFloat(el.style.top) || 0 };
    }
    return { left: isNaN(left) ? el.offsetLeft : left, top: isNaN(top) ? el.offsetTop : top };
  }
}

export const editor = new EditorSession();

export function useEditor(): EditorSession {
  useSyncExternalStore(editor.subscribe, editor.getVersion);
  return editor;
}
