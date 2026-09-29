/** User-level operations built on the store: import, export, pages, assets. */
import * as mf from './manifest';
import { readScormZip, shouldCompress, writeScormZip, type FileMap } from './package';
import { publish } from './publish';
import { basename, extname, relative } from './paths';
import { newId, store, type FileChange } from './store';
import { SCORM_HELPER_JS, SCORM_HELPER_PATH, newPageHtml } from './templates';
import { decodeText, encodeText } from './text';

export async function importPackage(file: Blob & { name?: string }) {
  const files = await readScormZip(file);
  await store.open(newId(), file.name ?? 'Imported course', files);
  const m = store.project?.manifest;
  store.setStatus(
    m ? `Imported "${m.title}" (SCORM ${m.version}, ${Object.keys(files).length} files)` : `Imported with manifest problem: ${store.project?.manifestError}`,
  );
}

export async function newCourse(title: string, version: mf.ScormVersion) {
  let manifest = mf.createManifest(version, title);
  const pagePath = 'pages/page_1.html';
  manifest = mf.addPage(manifest, { title: 'Page 1', href: pagePath, files: [SCORM_HELPER_PATH] }).xml;
  const files: FileMap = {
    'imsmanifest.xml': encodeText(manifest),
    [SCORM_HELPER_PATH]: encodeText(SCORM_HELPER_JS),
    [pagePath]: encodeText(newPageHtml('Page 1', relative(pagePath, SCORM_HELPER_PATH))),
  };
  await store.open(newId(), title, files);
  store.setStatus(`Created "${title}" (SCORM ${version})`);
}

function manifestText(): string {
  const t = store.readText('imsmanifest.xml');
  if (t === undefined) throw new Error('This project has no imsmanifest.xml');
  return t;
}

function uniquePath(path: string): string {
  const files = store.project!.files;
  if (!files[path]) return path;
  const ext = extname(path);
  const stem = ext ? path.slice(0, -(ext.length + 1)) : path;
  for (let i = 2; ; i++) {
    const candidate = `${stem}_${i}${ext ? '.' + ext : ''}`;
    if (!files[candidate]) return candidate;
  }
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'page';
}

export async function addPage(title: string, afterId?: string) {
  const changes: FileChange[] = [];
  if (!store.project!.files[SCORM_HELPER_PATH]) {
    changes.push({ path: SCORM_HELPER_PATH, bytes: encodeText(SCORM_HELPER_JS) });
  }
  const pagePath = uniquePath(`pages/${slug(title)}.html`);
  const { xml, itemId } = mf.addPage(manifestText(), { title, href: pagePath, files: [SCORM_HELPER_PATH], afterId });
  changes.push({ path: pagePath, bytes: encodeText(newPageHtml(title, relative(pagePath, SCORM_HELPER_PATH))) });
  changes.push({ path: 'imsmanifest.xml', bytes: encodeText(xml) });
  await store.write(`Add page "${title}"`, changes);
  store.openPage(pagePath, itemId);
}

export async function deleteItem(itemId: string, deleteLaunchFile: boolean) {
  const { xml, removedResource } = mf.removeItem(manifestText(), itemId);
  const changes: FileChange[] = [{ path: 'imsmanifest.xml', bytes: encodeText(xml) }];
  if (deleteLaunchFile && removedResource?.href) {
    const path = removedResource.href.split(/[?#]/)[0];
    if (store.project!.files[path]) changes.push({ path, bytes: null });
  }
  await store.write('Delete page', changes);
  if (store.currentItemId === itemId) store.openPage(null);
}

export async function renameItem(itemId: string, title: string) {
  await store.writeText('Rename page', 'imsmanifest.xml', mf.setItemTitle(manifestText(), itemId, title));
}

export async function moveItem(itemId: string, delta: -1 | 1) {
  await store.writeText('Move page', 'imsmanifest.xml', mf.moveItem(manifestText(), itemId, delta));
}

export async function setCourseTitle(title: string) {
  await store.writeText('Rename course', 'imsmanifest.xml', mf.setCourseTitle(manifestText(), title));
}

/** Add an uploaded file to the project. Returns its package path. */
export async function addAsset(file: File, folder = 'assets'): Promise<string> {
  const safe = basename(file.name).replace(/[^\w.\-]+/g, '_');
  const path = uniquePath(folder ? `${folder}/${safe}` : safe);
  await store.write(`Add ${safe}`, [{ path, bytes: new Uint8Array(await file.arrayBuffer()) }]);
  return path;
}

export async function deleteProjectFile(path: string) {
  await store.write(`Delete ${basename(path)}`, [{ path, bytes: null }]);
}

export async function renameProjectFile(from: string, to: string) {
  const bytes = store.project!.files[from];
  if (!bytes || store.project!.files[to]) throw new Error(`Cannot rename: ${to} already exists`);
  await store.write(`Rename ${basename(from)}`, [
    { path: to, bytes },
    { path: from, bytes: null },
  ]);
}

export async function exportPackage() {
  if (publish.running()) return;
  const p = store.project!;
  const name = slug(p.manifest?.title ?? p.name) + '_scorm' + (p.manifest?.version === '2004' ? '2004' : '12') + '.zip';
  const paths = Object.keys(p.files);
  publish.start({
    fileName: name,
    filesTotal: paths.length,
    bytesTotal: paths.reduce((n, f) => n + p.files[f].length, 0),
    storedCount: paths.filter((f) => !shouldCompress(f)).length,
  });
  // Let the progress window paint before the CPU-heavy part starts.
  await new Promise((r) => setTimeout(r, 50));
  try {
    publish.update({ stage: 'packaging' });
    const seen = new Set<string>();
    let lastPaint = 0;
    const blob = await writeScormZip(p.files, ({ percent, currentFile }) => {
      if (currentFile) seen.add(currentFile);
      // JSZip reports thousands of times a second; ~10 repaints a second is plenty.
      const now = performance.now();
      if (now - lastPaint < 100 && percent < 100) return;
      lastPaint = now;
      publish.update({ percent, currentFile, filesDone: seen.size });
    });
    publish.update({ stage: 'saving', percent: 100, filesDone: paths.length, currentFile: null });
    download(blob, name);
    publish.update({ stage: 'done', finishedAt: Date.now(), zipSize: blob.size, blob });
    store.setStatus(`Published ${name} (${(blob.size / 1024 / 1024).toFixed(1)} MB)`);
  } catch (e) {
    console.error(e);
    publish.update({ stage: 'error', error: (e as Error).message || String(e) });
    store.setStatus('Publishing failed: ' + (e as Error).message);
  }
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Every HTML page in the package, for link pickers and the file list. */
export function htmlPages(): string[] {
  return Object.keys(store.project?.files ?? {}).filter((p) => /\.x?html?$/i.test(p)).sort();
}

export function readTextFile(path: string): string {
  const b = store.project?.files[path];
  return b ? decodeText(b) : '';
}

