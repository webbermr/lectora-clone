/** Autosave projects in IndexedDB so work survives a page reload. */
import type { FileMap } from './package';

export interface StoredProject {
  id: string;
  name: string;
  updatedAt: number;
  files: FileMap;
}

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: number;
  fileCount: number;
}

const DB = 'lectora-clone';
const STORE = 'projects';
const META = 'meta';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.result.createObjectStore(META, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        tx.oncomplete = () => {
          db.close();
          resolve(req.result);
        };
        tx.onerror = () => reject(tx.error);
      }),
  );
}

export async function saveProject(p: StoredProject): Promise<void> {
  await run(STORE, 'readwrite', (s) => s.put(p));
  const summary: ProjectSummary = { id: p.id, name: p.name, updatedAt: p.updatedAt, fileCount: Object.keys(p.files).length };
  await run(META, 'readwrite', (s) => s.put(summary));
}

export function loadProject(id: string): Promise<StoredProject | undefined> {
  return run(STORE, 'readonly', (s) => s.get(id));
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const all = await run<ProjectSummary[]>(META, 'readonly', (s) => s.getAll());
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteProject(id: string): Promise<void> {
  await run(STORE, 'readwrite', (s) => s.delete(id));
  await run(META, 'readwrite', (s) => s.delete(id));
}
