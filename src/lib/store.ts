/**
 * Application state: the open project, file writes with undo/redo, and
 * autosave. Components subscribe via useStore().
 */
import { useSyncExternalStore } from 'react';
import { flattenItems, parseManifest, type ManifestModel } from './manifest';
import type { FileMap } from './package';
import { bytesEqual, decodeText, encodeText } from './text';
import { previewLms } from './scormApi';
import { saveProject } from './storage';
import { deleteFile, mountProject, putFile } from './vfs';

export interface FileChange {
  path: string;
  /** New content, or null to delete. */
  bytes: Uint8Array | null;
}

interface UndoEntry {
  label: string;
  before: FileChange[];
  after: FileChange[];
}

export interface Project {
  id: string;
  name: string;
  files: FileMap;
  manifest: ManifestModel | null;
  manifestError?: string;
}

export type View = 'edit' | 'live' | 'preview' | 'code';

class Store {
  project: Project | null = null;
  /** Package path of the page/file open in the stage. */
  currentPath: string | null = null;
  currentItemId: string | null = null;
  /**
   * The page Live edit or Preview is actually showing, when the learner moved
   * on inside the course (Next buttons, menus). Null while it's still currentPath.
   */
  viewingPath: string | null = null;
  view: View = 'edit';
  /** Bumped when a file changes from outside the stage, telling the stage to reload. */
  revisions: Record<string, number> = {};
  undoStack: UndoEntry[] = [];
  redoStack: UndoEntry[] = [];
  saveState: 'saved' | 'saving' | 'dirty' | 'error' = 'saved';
  status = '';

  private version = 0;
  private listeners = new Set<() => void>();
  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getVersion = () => this.version;

  emit() {
    this.version++;
    rememberPlace(this);
    this.listeners.forEach((l) => l());
  }

  setStatus(msg: string) {
    this.status = msg;
    this.emit();
  }

  async open(id: string, name: string, files: FileMap, onProgress?: (done: number, total: number, current: string) => void) {
    await mountProject(id, files, onProgress);
    previewLms.reset();
    this.project = { id, name, files, manifest: null };
    this.reparseManifest();
    if (this.project.manifest) this.project.name = this.project.manifest.title;
    this.undoStack = [];
    this.redoStack = [];
    this.revisions = {};
    this.currentPath = null;
    this.currentItemId = null;
    this.viewingPath = null;
    this.view = 'edit';
    this.saveState = 'saved';
    const first = this.project.manifest?.items.length ? firstLaunchable(this.project.manifest.items) : undefined;
    if (first) {
      this.currentItemId = first.identifier;
      this.currentPath = first.href ?? null;
    }
    this.emit();
    this.scheduleSave(0);
  }

  close() {
    this.project = null;
    this.currentPath = null;
    this.currentItemId = null;
    this.viewingPath = null;
    this.emit();
  }

  private reparseManifest() {
    const p = this.project!;
    const bytes = p.files['imsmanifest.xml'];
    if (!bytes) {
      p.manifest = null;
      p.manifestError = 'No imsmanifest.xml in project';
      return;
    }
    try {
      p.manifest = parseManifest(decodeText(bytes));
      p.manifestError = undefined;
      p.name = p.manifest.title;
    } catch (e) {
      p.manifestError = (e as Error).message;
    }
  }

  readText(path: string): string | undefined {
    const bytes = this.project?.files[path];
    return bytes ? decodeText(bytes) : undefined;
  }

  /**
   * Apply file changes as one undoable step. `fromStage` marks edits made in
   * the live WYSIWYG document, which is already up to date and must not reload.
   */
  async write(label: string, changes: FileChange[], opts: { undoable?: boolean; fromStage?: boolean } = {}) {
    const p = this.project;
    if (!p) return;
    const before: FileChange[] = [];
    const after: FileChange[] = [];
    for (const c of changes) {
      const prev = p.files[c.path] ?? null;
      if (prev && c.bytes && bytesEqual(prev, c.bytes)) continue;
      if (!prev && !c.bytes) continue;
      before.push({ path: c.path, bytes: prev });
      after.push(c);
    }
    if (!after.length) return;
    await this.apply(after, !opts.fromStage);
    if (opts.undoable !== false) {
      this.undoStack.push({ label, before, after });
      if (this.undoStack.length > 200) this.undoStack.shift();
      this.redoStack = [];
    }
    this.emit();
  }

  writeText(label: string, path: string, text: string, opts?: { undoable?: boolean; fromStage?: boolean }) {
    return this.write(label, [{ path, bytes: encodeText(text) }], opts);
  }

  private async apply(changes: FileChange[], bumpRevision: boolean) {
    const p = this.project!;
    // A new object each time, so views that memoise on the file map see the change.
    p.files = { ...p.files };
    for (const c of changes) {
      if (c.bytes) {
        p.files[c.path] = c.bytes;
        await putFile(p.id, c.path, c.bytes);
      } else {
        delete p.files[c.path];
        await deleteFile(p.id, c.path);
      }
      if (bumpRevision) this.revisions[c.path] = (this.revisions[c.path] ?? 0) + 1;
    }
    if (changes.some((c) => c.path === 'imsmanifest.xml')) this.reparseManifest();
    if (this.currentPath && !p.files[this.currentPath]) this.currentPath = null;
    if (this.viewingPath && !p.files[this.viewingPath]) this.viewingPath = null;
    this.scheduleSave();
  }

  async undo() {
    const entry = this.undoStack.pop();
    if (!entry) return;
    await this.apply(entry.before, true);
    this.redoStack.push(entry);
    this.status = `Undid: ${entry.label}`;
    this.emit();
  }

  async redo() {
    const entry = this.redoStack.pop();
    if (!entry) return;
    await this.apply(entry.after, true);
    this.undoStack.push(entry);
    this.status = `Redid: ${entry.label}`;
    this.emit();
  }

  openPage(path: string | null, itemId: string | null = null) {
    this.currentPath = path;
    this.currentItemId = itemId;
    this.viewingPath = null;
    this.emit();
  }

  /** Called by Live edit / Preview as the course navigates inside its frame. */
  setViewing(path: string | null) {
    const next = path === this.currentPath ? null : path;
    if (next === this.viewingPath) return;
    this.viewingPath = next;
    this.emit();
  }

  setView(view: View) {
    // Switching views carries on from the page the course had reached.
    if (this.viewingPath && view !== this.view) {
      const path = this.viewingPath;
      this.currentPath = path;
      this.currentItemId = flattenItems(this.project?.manifest?.items ?? []).find((i) => i.href === path)?.identifier ?? null;
      this.viewingPath = null;
    }
    this.view = view;
    this.emit();
  }

  private scheduleSave(delay = 800) {
    this.saveState = 'dirty';
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.saveNow(), delay);
  }

  async saveNow() {
    clearTimeout(this.saveTimer);
    const p = this.project;
    if (!p) return;
    this.saveState = 'saving';
    this.emit();
    try {
      await saveProject({ id: p.id, name: p.name, updatedAt: Date.now(), files: { ...p.files } });
      this.saveState = 'saved';
    } catch (e) {
      console.error(e);
      this.saveState = 'error';
      this.status = 'Autosave failed: ' + (e as Error).message;
    }
    this.emit();
  }
}

function firstLaunchable(items: ManifestModel['items']): ManifestModel['items'][number] | undefined {
  for (const i of items) {
    if (i.href) return i;
    const c = firstLaunchable(i.children);
    if (c) return c;
  }
  return undefined;
}

export const store = new Store();

export function useStore(): Store {
  useSyncExternalStore(store.subscribe, store.getVersion);
  return store;
}

export function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const PLACE_KEY = 'lc-open-project';

export interface OpenPlace {
  id: string;
  name: string;
  path: string | null;
  itemId: string | null;
  view: View;
}

/** Where this tab was, so a refresh reopens the project instead of going back to the project list. */
function rememberPlace(st: Store) {
  try {
    if (!st.project) {
      sessionStorage.removeItem(PLACE_KEY);
      return;
    }
    const place: OpenPlace = { id: st.project.id, name: st.project.name, path: st.currentPath, itemId: st.currentItemId, view: st.view };
    const json = JSON.stringify(place);
    if (sessionStorage.getItem(PLACE_KEY) !== json) sessionStorage.setItem(PLACE_KEY, json);
  } catch {
    // storage blocked: a refresh just goes back to the project list
  }
}

export function rememberedPlace(): OpenPlace | null {
  try {
    const raw = sessionStorage.getItem(PLACE_KEY);
    return raw ? (JSON.parse(raw) as OpenPlace) : null;
  } catch {
    return null;
  }
}

export function forgetPlace() {
  try {
    sessionStorage.removeItem(PLACE_KEY);
  } catch {
    // ignore
  }
}
