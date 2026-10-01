/** User-level operations built on the store: import, export, pages, assets. */
import * as mf from './manifest';
import { readScormZip, shouldCompress, writeScormZip, type FileMap } from './package';
import { loadProject } from './storage';
import { task, yieldToPaint } from './task';
import { basename, extname, relative } from './paths';
import { newId, store, type FileChange } from './store';
import { SCORM_HELPER_JS, SCORM_HELPER_PATH, newPageHtml } from './templates';
import { decodeText, encodeText } from './text';
import { findUnused } from './unused';
import { askAboutUnused } from './publishReview';

const IMPORT_STEPS = ['Read zip', 'Extract files', 'Set up preview', 'Save in browser'];

function mb(n: number): string {
  return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function sizeOf(files: FileMap): number {
  return Object.values(files).reduce((n, b) => n + b.length, 0);
}

/** Load a project into the editor, reporting the preview setup and first save as steps. */
async function openWithProgress(id: string, name: string, files: FileMap, previewStep: number) {
  task.step(previewStep, { current: 'Copying files to the preview server…' });
  await store.open(id, name, files, (done, total, current) => task.progress({ done, total, current }));
  if (previewStep + 1 < (task.get()?.steps.length ?? 0)) {
    task.step(previewStep + 1, { current: `Saving ${mb(sizeOf(files))} so it's here next time you open the app…` });
    await store.saveNow();
    if (store.saveState === 'error') throw new Error(store.status || 'Could not save the project in this browser.');
  }
}

function courseSummary(files: FileMap, started: number): { summary: string; details: string[] } {
  const p = store.project!;
  const m = p.manifest;
  const count = Object.keys(files).length;
  const details: string[] = [];
  if (!m) details.push(`⚠ Manifest problem: ${p.manifestError}. You can still edit files from the Files tab.`);
  else if (m.items.length === 1 && !m.items[0].children.length && 'trivantis.js' in files) {
    details.push('Lectora course: chapters are rebuilt from page file names in the Title Explorer.');
  }
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  return {
    summary: `${m ? `"${m.title}" · SCORM ${m.version} · ` : ''}${count.toLocaleString()} files · ${mb(sizeOf(files))} in ${secs}s`,
    details,
  };
}

export async function importPackage(file: Blob & { name?: string }) {
  if (task.running()) return;
  const started = Date.now();
  task.start('Importing SCORM package…', `${file.name ?? 'package.zip'} · ${mb(file.size)}`, IMPORT_STEPS, {
    closeLabel: 'Start editing',
    doneTitle: 'Imported',
    failTitle: 'Import failed',
  });
  await yieldToPaint();
  try {
    task.step(0, { current: 'Reading the zip file and its table of contents…' });
    const files = await readScormZip(file, (done, total, current) => {
      if (done === 1) task.step(1);
      task.progress({ done, total, current });
    });
    await openWithProgress(newId(), file.name ?? 'Imported course', files, 2);
    const { summary, details } = courseSummary(files, started);
    task.finish(summary, { details });
    store.setStatus(`Imported ${summary}`);
  } catch (e) {
    console.error(e);
    task.fail(e);
  }
}

/** Reopen a project saved in this browser. */
export async function openSavedProject(id: string, name: string) {
  if (task.running()) return;
  const started = Date.now();
  task.start('Opening project…', name, ['Load from browser', 'Set up preview'], {
    closeLabel: 'Start editing',
    doneTitle: 'Opened',
    failTitle: "Couldn't open the project",
  });
  await yieldToPaint();
  try {
    task.step(0, { current: 'Reading the saved project…' });
    const stored = await loadProject(id);
    if (!stored) throw new Error('This project is missing from browser storage. It may have been cleared.');
    await openWithProgress(stored.id, stored.name, stored.files, 1);
    const { summary, details } = courseSummary(stored.files, started);
    task.finish(summary, { details });
    // Opening is usually quick; don't make people dismiss a window for it.
    if (Date.now() - started < 1500) task.close();
  } catch (e) {
    console.error(e);
    task.fail(e);
  }
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

/** Publish: first offer to leave out files nothing in the course uses, then build the zip. */
export async function publishPackage() {
  if (task.running()) return;
  const p = store.project!;
  store.setStatus('Checking which files the course uses…');
  await yieldToPaint();
  let leaveOut = new Set<string>();
  try {
    const unused = findUnused(p.files, p.manifest);
    if (unused.paths.length) {
      const sizes = Object.fromEntries(unused.paths.map((f) => [f, p.files[f].length]));
      const chosen = await askAboutUnused(unused, sizes, sizeOf(p.files));
      if (!chosen) {
        store.setStatus('Publishing cancelled.');
        return;
      }
      leaveOut = chosen;
    }
  } catch (e) {
    // The check is a convenience: if it fails, publish everything as before.
    console.error(e);
  }
  await exportPackage(leaveOut);
}

/**
 * The package as published without the given files: they're left out of the zip and of the manifest's file
 * lists, and asset entries left with no files are dropped (with any dependencies on them). The project
 * itself is unchanged.
 */
export function withoutFiles(files: FileMap, manifest: mf.ManifestModel | null, leaveOut: Set<string>): FileMap {
  if (!leaveOut.size) return files;
  const out: FileMap = {};
  for (const [path, bytes] of Object.entries(files)) if (!leaveOut.has(path)) out[path] = bytes;
  if (files['imsmanifest.xml'] && manifest) {
    const emptied = manifest.resources.filter((r) => !r.href && r.files.length > 0 && r.files.every((f) => leaveOut.has(f))).map((r) => r.identifier);
    out['imsmanifest.xml'] = encodeText(mf.removeResourcesAndFiles(decodeText(files['imsmanifest.xml']), emptied, leaveOut));
  }
  return out;
}

export async function exportPackage(leaveOut: Set<string> = new Set()) {
  if (task.running()) return;
  const p = store.project!;
  const name = slug(p.manifest?.title ?? p.name) + '_scorm' + (p.manifest?.version === '2004' ? '2004' : '12') + '.zip';
  const files = withoutFiles(p.files, p.manifest, leaveOut);
  const left = leaveOut.size ? ` · ${leaveOut.size.toLocaleString()} unused file${leaveOut.size === 1 ? '' : 's'} left out` : '';
  const paths = Object.keys(files);
  const stored = paths.filter((f) => !shouldCompress(f)).length;
  const started = Date.now();
  task.start('Publishing SCORM package…', name, ['Gather files', 'Build zip', 'Save download'], {
    doneTitle: 'Published',
    failTitle: 'Publishing failed',
    note: `${stored.toLocaleString()} images, audio and video files are copied as-is, since they're already compressed; only text files (HTML, JS, CSS, XML) are compressed.`,
    current: `Gathering ${paths.length.toLocaleString()} files (${mb(sizeOf(files))})…`,
  });
  // Let the progress window paint before the CPU-heavy part starts.
  await yieldToPaint();
  try {
    task.step(1, { total: paths.length });
    const seen = new Set<string>();
    const blob = await writeScormZip(files, ({ percent, currentFile }) => {
      if (currentFile) seen.add(currentFile);
      task.progress({ percent, done: seen.size, total: paths.length, current: currentFile ? `Adding ${currentFile}` : null });
    });
    task.step(2, { current: 'Handing the file to your browser…' });
    download(blob, name);
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    task.finish(`${mb(blob.size)} zip · ${paths.length.toLocaleString()} files in ${secs}s${left}`, {
      action: { label: 'Download again', run: () => download(blob, name) },
    });
    store.setStatus(`Published ${name} (${mb(blob.size)})${left}`);
  } catch (e) {
    console.error(e);
    task.fail(e);
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

