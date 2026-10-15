/**
 * Moving and copying pages in a published Lectora title without breaking playback.
 *
 * What a page's place in the course is tied to (the same things a delete has to deal with, see lectora.ts):
 *  - The Next/Back chain: each page names its neighbours (trivNextPage / trivPrevPage, Next and Back buttons,
 *    auto-advance). It runs through the whole course, across chapters, in page-tracking order.
 *  - trivantis-pagetracking.js: the tree of chapters and pages, by id. Course order, and what counts as visited.
 *  - The table of contents (a001_toc*.html): one insertEntry(…) line per page, under its chapter's folder.
 *  - "Page 3 of 12": each page sets its own VarPageInChapter / VarPagesInChapter.
 *  - imsmanifest.xml: one resource P_<id> per page, which the course (and some pages) depend on.
 *  - The page's file name: the editor (like an author) reads the chapter from it (a001_<chapter>_<page>.html).
 *  - For a copy: a new page id (pgID, SetRangeStatus), and fixed progress totals the copy also adds to.
 *
 * planMove() / planCopy() work out every change without touching anything, so it can be reviewed first.
 */
import { textOf } from './assetRefs';
import {
  TOC_ENTRY,
  TOC_FOLDER,
  TRACKING_FILE,
  findProgressTotals,
  isTocFile,
  readLectoraCourse,
  relinkText,
  retargetTotal,
  serializeTracking,
  type TrackNode,
  type Tracking,
} from './lectora';
import { openTests, testPages } from './lectoraTest';
import { cloneResource, type ManifestModel } from './manifest';
import type { FileMap } from './package';
import { basename, isTextFile } from './paths';

/** Where a page goes: straight after one page, or straight before another. */
export type Position = { after: string } | { before: string };

export interface PagePlan {
  /** e.g. 'Move "Welcome"' */
  label: string;
  /** New text for every file that changes, and new files (a copy). */
  edits: Map<string, string>;
  /** A page renamed to match the chapter it moved into: old path -> new path. */
  renamed?: { from: string; to: string };
  /** The page the result is about (the moved page, or the new copy), by its final path. */
  page?: string;
  /** What will change, in plain words, for the review. */
  summary: string[];
  warnings: string[];
  /** Set when it mustn't go ahead. */
  blocked?: string;
}

const LECTORA_PAGE = /^(a\d{3})_(.+)\.html?$/i;
const PROTECTED = /^(a\d{3}index\.html?|index\.html?)$/i;
const reEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---------------------------------------------------------------------------------------------------------
// The course as it is
// ---------------------------------------------------------------------------------------------------------

interface Course {
  tracking: Tracking;
  idOf: Map<string, number>;
  fileOf: Map<number, string>;
  /** Tracked pages in course order. */
  seq: string[];
  /** Page id -> its parent container in the tree, and whether it's inside a test. */
  parentOf: Map<number, TrackNode>;
  inTest: Set<number>;
}

function readCourse(files: FileMap, manifest: ManifestModel | null): Course | string {
  const c = readLectoraCourse(files, manifest);
  if (!c.tracking || !files[TRACKING_FILE]) {
    return `Moving and copying pages needs Lectora's page tracking (${TRACKING_FILE}), which this course doesn't have. For courses with a page per manifest item, use ↑ and ↓ in the Title Explorer.`;
  }
  const parentOf = new Map<number, TrackNode>();
  const inTest = new Set<number>();
  const seq: string[] = [];
  const walk = (n: TrackNode, test: boolean) => {
    const t = test || n.t === 1;
    for (const ch of n.c ?? []) {
      parentOf.set(ch.id, n);
      if (t || ch.t === 1) inTest.add(ch.id);
      if (!ch.c) {
        const f = c.fileOf.get(ch.id);
        if (f && files[f]) seq.push(f);
      }
      walk(ch, t);
    }
  };
  walk(c.tracking.title, false);
  return { tracking: c.tracking, idOf: c.idOf, fileOf: c.fileOf, seq, parentOf, inTest };
}

/** Where trivNextPage / trivPrevPage go on a page. */
function chainOf(text: string): { next?: string; prev?: string } {
  const go = (fn: string) => new RegExp(`function\\s+${fn}\\s*\\(\\s*\\)\\s*\\{\\s*trivExitPage\\(\\s*['"]([^'"]+)['"]`).exec(text)?.[1];
  const next = go('trivNextPage');
  const prev = go('trivPrevPage');
  return { next: next && basename(next), prev: prev && basename(prev) };
}

/** Replace page names in a text, all at once (so a -> b and b -> c don't chain). */
function swapNames(text: string, map: Map<string, string>): string {
  const keys = [...map.keys()].filter((k) => map.get(k) !== k);
  if (!keys.length) return text;
  const re = new RegExp(`(?<![A-Za-z0-9_\\-])(${keys.map(reEscape).join('|')})(?![A-Za-z0-9_])`, 'g');
  return text.replace(re, (name) => map.get(name)!);
}

const findNode = (n: TrackNode, id: number): TrackNode | null => {
  if (n.id === id) return n;
  for (const c of n.c ?? []) {
    const hit = findNode(c, id);
    if (hit) return hit;
  }
  return null;
};
const leavesOf = (n: TrackNode): number[] => (n.c ? n.c.flatMap(leavesOf) : [n.id]);
const ancestorsOf = (root: TrackNode, id: number): TrackNode[] => {
  const trail: TrackNode[] = [];
  const go = (n: TrackNode): boolean => {
    if (n.id === id) return true;
    for (const c of n.c ?? []) {
      if (go(c)) {
        trail.push(n);
        return true;
      }
    }
    return false;
  };
  go(root);
  return trail; // nearest first
};

const PAGE_IN = /(VarPageInChapter\.set\(\s*['"])(\d+)(['"]\s*\))/;
const PAGES_IN = /(VarPagesInChapter\.set\(\s*['"])(\d+)(['"]\s*\))/;

/**
 * The container a page's "Page X of Y" counts within: the nearest one whose page count is the Y the page shows
 * (Lectora's chapter; with sections it can be further up), else its parent.
 */
function chapterOf(root: TrackNode, id: number, text: string): TrackNode | null {
  const shown = PAGES_IN.exec(text)?.[2];
  const up = ancestorsOf(root, id);
  if (!up.length) return null;
  if (shown) for (const a of up) if (leavesOf(a).length === Number(shown)) return a;
  return up[0];
}

// ---------------------------------------------------------------------------------------------------------
// Shared steps
// ---------------------------------------------------------------------------------------------------------

/** Resolve a position to the pages either side of it (in the sequence without `moving`) and the tree spot. */
function resolve(course: Course, seq: string[], pos: Position): { prev?: string; next?: string; parent: TrackNode; index: number } | string {
  const anchor = 'after' in pos ? pos.after : pos.before;
  const at = seq.indexOf(anchor);
  if (at < 0) return `${basename(anchor)} isn't one of the course's tracked pages.`;
  const id = course.idOf.get(anchor)!;
  const parent = course.parentOf.get(id);
  if (!parent || !parent.c) return `${basename(anchor)} isn't in a chapter.`;
  const idx = parent.c.findIndex((c) => c.id === id);
  if ('after' in pos) return { prev: anchor, next: seq[at + 1], parent, index: idx + 1 };
  return { prev: seq[at - 1], next: anchor, parent, index: idx };
}

/** The table of contents with `page`'s entry taken out (when moving) and an entry put in at the new spot. */
function placeInToc(
  text: string,
  opts: { take?: string; put: { name: string; title?: string; id?: number; template: string }; after?: string; before?: string },
): { text: string; changed: boolean } {
  const lines = text.split('\n');
  const entryOf = (i: number) => TOC_ENTRY.exec(lines[i]);
  const find = (name?: string) => (name ? lines.findIndex((_, i) => basename(entryOf(i)?.[3] ?? '') === name) : -1);
  const templateAt = find(opts.put.template);
  if (templateAt < 0) return { text, changed: false };
  let line = lines[templateAt];
  if (opts.put.name !== opts.put.template) {
    line = line.replace(`"${entryOf(templateAt)![3]}"`, `"${opts.put.name}"`);
  }
  if (opts.put.title !== undefined) line = line.replace(entryOf(templateAt)![2], JSON.stringify(opts.put.title));
  if (opts.put.id !== undefined) line = line.replace(/,\s*\d+(\s*\)\s*\)\s*;?\s*)$/, `, ${opts.put.id}$1`);
  // Where it goes: next to the neighbour's entry, under that neighbour's folder.
  const anchorName = opts.after ?? opts.before;
  let anchorAt = find(anchorName);
  if (anchorAt < 0) return { text, changed: false };
  const folderVar = entryOf(anchorAt)![1];
  line = line.replace(/^(\s*insertEntry\(\s*)\w+/, `$1${folderVar}`);
  const out = [...lines];
  if (opts.take) {
    const takeAt = find(opts.take);
    if (takeAt >= 0) {
      out.splice(takeAt, 1);
      if (takeAt < anchorAt) anchorAt--;
    }
  }
  out.splice(opts.after ? anchorAt + 1 : anchorAt, 0, line);
  // A chapter's own link opens its first page: keep it pointing at whichever page is first now.
  return { text: relinkFolders(lines, out).join('\n'), changed: true };
}

/**
 * Each folder line's first page entry, by position: Lectora reuses one variable for every chapter
 * (aux1 = insertFolder(…) again and again), so an entry belongs to the latest folder line that set its variable.
 */
function firstEntries(lines: string[]): Map<number, string> {
  const open = new Map<string, number>(); // folder var -> its current folder line
  const first = new Map<number, string>();
  lines.forEach((l, i) => {
    const f = TOC_FOLDER.exec(l);
    if (f) open.set(f[2], i);
    const e = TOC_ENTRY.exec(l);
    const at = e ? open.get(e[1]) : undefined;
    if (e && at !== undefined && !first.has(at)) first.set(at, e[3]);
  });
  return first;
}

/** Folder lines in order, so before and after can be matched up (the edit never adds or removes one). */
const folderLines = (lines: string[]) => lines.flatMap((l, i) => (TOC_FOLDER.test(l) ? [i] : []));

/**
 * A chapter's own TOC link opens its first page. Where a folder linked to its first page before the change,
 * point it at whichever page is first now (folders linking anywhere else are left alone).
 */
function relinkFolders(before: string[], after: string[]): string[] {
  const was = firstEntries(before);
  const now = firstEntries(after);
  const b = folderLines(before);
  const a = folderLines(after);
  const out = [...after];
  a.forEach((i, k) => {
    const link = TOC_FOLDER.exec(after[i])![5];
    const first = now.get(i);
    if (!first || first === link || was.get(b[k]) !== link) return;
    out[i] = after[i].replace(`"${link}"`, `"${first}"`);
  });
  return out;
}

/** Renumber "Page X of Y" on every page of the given containers, as the tree now is. */
function renumber(files: FileMap, edits: Map<string, string>, root: TrackNode, chapters: TrackNode[], fileOf: Map<number, string>, summary: string[]) {
  let pages = 0;
  for (const ch of chapters) {
    const node = findNode(root, ch.id);
    if (!node) continue;
    const ids = leavesOf(node);
    ids.forEach((id, i) => {
      const f = fileOf.get(id);
      if (!f) return;
      const text = edits.get(f) ?? (files[f] ? textOf(files[f]) : undefined);
      if (text === undefined || !PAGE_IN.test(text)) return;
      const out = text.replace(PAGE_IN, `$1${i + 1}$3`).replace(PAGES_IN, `$1${ids.length}$3`);
      if (out !== text) {
        edits.set(f, out);
        pages++;
      }
    });
  }
  if (pages) summary.push(`"Page X of Y" renumbered on ${pages} page${pages === 1 ? '' : 's'}.`);
}

/** The pages a test lists (they can't be moved or copied: the test's own question list orders them). */
function testPageNames(files: FileMap): Set<string> {
  const tests = openTests(files);
  const out = new Set<string>();
  if (tests && 'xml' in tests) for (const xml of tests.xml.values()) for (const p of testPages(xml)) out.add(basename(p));
  return out;
}

/** A page name (same folder as `like`) that isn't taken. */
function freeName(files: FileMap, edits: Map<string, string>, like: string, stem: string): string {
  const dir = like.includes('/') ? like.slice(0, like.lastIndexOf('/') + 1) : '';
  const ext = /\.x?html?$/i.exec(like)?.[0] ?? '.html';
  for (let n = 1; ; n++) {
    const name = `${dir}${stem}${n === 1 ? '' : `_${n}`}${ext}`;
    if (!files[name] && !edits.has(name)) return name;
  }
}

/**
 * The name part a chapter's pages share (a001_workplace_safety_hazards.html, a001_workplace_safety_welcome.html
 * -> workplace_safety), left out `except`. With one page to go on, the chapter's TOC name decides
 * ("Old Policies" -> old_policies) when the page's name starts with it, else its first word.
 */
function chapterPrefix(files: FileMap, course: Course, chapter: TrackNode, except?: string): string[] | undefined {
  const names = leavesOf(chapter)
    .map((id) => course.fileOf.get(id))
    .filter((f): f is string => !!f && f !== except)
    .map((f) => LECTORA_PAGE.exec(basename(f))?.[2].split('_'))
    .filter((t): t is string[] => !!t);
  if (!names.length) return undefined;
  if (names.length === 1) {
    for (const f of Object.keys(files).filter(isTocFile)) {
      for (const l of textOf(files[f]).split('\n')) {
        const m = TOC_FOLDER.exec(l);
        if (!m || !new RegExp(`,\\s*${chapter.id}\\s*\\)\\s*\\)\\s*;?\\s*$`).test(l)) continue;
        const slug = tocString(m[4]).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').split('_');
        if (slug[0] && names[0].length > slug.length && slug.every((w, i) => names[0][i] === w)) return slug;
      }
    }
    return names[0].length > 1 ? names[0].slice(0, 1) : undefined;
  }
  let k = 0;
  while (names.every((n) => n.length > k + 1 && n[k] === names[0][k])) k++;
  return k ? names[0].slice(0, k) : undefined;
}

/**
 * The name a page gets in another chapter: that chapter's prefix and the page's own part.
 * a001_reporting_when_to_report.html into Workplace Safety -> a001_workplace_safety_when_to_report.
 * Undefined when the names don't follow the pattern, or already fit.
 */
function stemFor(files: FileMap, course: Course, page: string, from: TrackNode | undefined, to: TrackNode): string | undefined {
  const m = LECTORA_PAGE.exec(basename(page));
  if (!m || from?.id === to.id) return undefined;
  const target = chapterPrefix(files, course, to, page);
  if (!target) return undefined;
  const tokens = m[2].split('_');
  const own = from ? chapterPrefix(files, course, from, page) : undefined;
  const fits = (pre: string[]) => tokens.length > pre.length && pre.every((w, i) => tokens[i] === w);
  if (fits(target)) return undefined;
  const tail = own && fits(own) ? tokens.slice(own.length) : tokens.length > 1 ? tokens.slice(1) : tokens;
  return `${m[1]}_${[...target, ...tail].join('_')}`;
}

/** The page's name: what it sets VarCurrentPageName to, else its table of contents entry, else its <title>. */
const pageTitle = (files: FileMap, path: string) => {
  const text = textOf(files[path]);
  const own = /VarCurrentPageName\.set\(\s*'((?:[^'\\]|\\.)*)'\s*\)/.exec(text)?.[1];
  if (own) return own;
  for (const f of Object.keys(files).filter(isTocFile)) {
    for (const l of textOf(files[f]).split('\n')) {
      const e = TOC_ENTRY.exec(l);
      if (e && basename(e[3]) === basename(path)) return tocString(e[2]);
    }
  }
  return /<title>([^<]*)<\/title>/i.exec(text)?.[1]?.trim() ?? basename(path);
};

/** A TOC title as written ("…" or '…') -> its text. */
const tocString = (s: string) => {
  try {
    return s.startsWith('"') ? (JSON.parse(s) as string) : s.slice(1, -1).replace(/\\(.)/g, '$1');
  } catch {
    return s.slice(1, -1);
  }
};

function guard(files: FileMap, course: Course, page: string, pos: Position, tests: Set<string>): string | null {
  if (!files[page]) return `${page} isn't in the package.`;
  if (PROTECTED.test(basename(page))) return `${basename(page)} is the course's launch page and stays where it is.`;
  if (!course.seq.includes(page)) return `${basename(page)} isn't in the course's page tracking, so its place in the course can't be worked out.`;
  const anchor = 'after' in pos ? pos.after : pos.before;
  const pageId = course.idOf.get(page)!;
  const anchorId = course.idOf.get(anchor);
  if (tests.has(basename(page)) || course.inTest.has(pageId)) return `${basename(page)} is part of the test, whose own question list decides its pages; it can't be moved or copied.`;
  if (anchorId !== undefined && (course.inTest.has(anchorId) || tests.has(basename(anchor)))) return `That spot is inside the test, whose own question list decides its pages. Pick a spot outside it.`;
  return null;
}

// ---------------------------------------------------------------------------------------------------------
// Move
// ---------------------------------------------------------------------------------------------------------

export function planMove(files: FileMap, manifest: ManifestModel | null, page: string, pos: Position): PagePlan {
  const title = files[page] ? pageTitle(files, page) : basename(page);
  const plan: PagePlan = { label: `Move "${title}"`, edits: new Map(), summary: [], warnings: [] };
  const course = readCourse(files, manifest);
  if (typeof course === 'string') return { ...plan, blocked: course };
  const tests = testPageNames(files);
  const stop = guard(files, course, page, pos, tests);
  if (stop) return { ...plan, blocked: stop };
  const anchor = 'after' in pos ? pos.after : pos.before;
  if (anchor === page) return { ...plan, blocked: 'Pick a different page to move it next to.' };

  const seq = course.seq;
  const at = seq.indexOf(page);
  const A = seq[at - 1];
  const B = seq[at + 1];
  const rest = seq.filter((p) => p !== page);
  const spot = resolve(course, rest, pos);
  if (typeof spot === 'string') return { ...plan, blocked: spot };
  const { prev: Q, next: R } = spot;
  if (Q === A && R === B) return { ...plan, blocked: `"${title}" is already there.` };

  // --- The Next/Back chain: close the gap it leaves, and open one where it goes -----------------------
  const name = (p?: string) => (p ? basename(p) : undefined);
  const maps = new Map<string, Map<string, string>>();
  const link = (file: string | undefined, from: string | undefined, to: string | undefined) => {
    if (!file || !from || !to) return;
    (maps.get(file) ?? maps.set(file, new Map()).get(file)!).set(from, to);
  };
  const P = basename(page);
  link(A, P, name(B)); // A's Next skips to B
  link(B, P, name(A)); // B's Back goes to A
  link(Q, name(R), P); // Q's Next comes to the page
  link(R, name(Q), P); // R's Back comes to the page
  // The page's own Back and Next: to Q and R. When it was first or last, it had no link to swap; say so.
  if (A) link(page, name(A), name(Q));
  if (B) link(page, name(B), name(R));
  const irregular: string[] = [];
  const own = chainOf(textOf(files[page]));
  if (A && own.prev !== name(A)) irregular.push(`its Back went to ${own.prev ?? 'nowhere'}, not ${name(A)}`);
  if (B && own.next !== name(B)) irregular.push(`its Next went to ${own.next ?? 'nowhere'}, not ${name(B)}`);
  if (Q && R && chainOf(textOf(files[Q])).next !== name(R)) irregular.push(`${name(Q)}'s Next went to ${chainOf(textOf(files[Q])).next ?? 'nowhere'}, not ${name(R)}`);
  if (irregular.length) plan.warnings.push(`Not every page linked to the page next to it (${irregular.join('; ')}), so those links were left as they were; check Next and Back around the page in Preview.`);
  for (const [f, map] of maps) {
    const text = textOf(files[f]);
    const out = swapNames(text, map);
    if (out !== text) plan.edits.set(f, out);
  }
  plan.summary.push(
    `Next/Back: ${[A && B ? `${name(A)} now goes on to ${name(B)}` : null, Q ? `${name(Q)} goes on to it` : null, R ? `it goes on to ${name(R)}` : null].filter(Boolean).join('; ')}.`,
  );

  // --- Page tracking ----------------------------------------------------------------------------------
  const t: Tracking = JSON.parse(JSON.stringify(course.tracking));
  const id = course.idOf.get(page)!;
  const oldChapter = chapterOf(course.tracking.title, id, textOf(files[page]));
  const fromParent = findNode(t.title, course.parentOf.get(id)!.id)!;
  const node = fromParent.c!.find((c) => c.id === id)!;
  fromParent.c = fromParent.c!.filter((c) => c.id !== id);
  const toParent = findNode(t.title, spot.parent.id)!;
  const anchorId = course.idOf.get(anchor)!;
  const anchorIdx = toParent.c!.findIndex((c) => c.id === anchorId);
  toParent.c!.splice('after' in pos ? anchorIdx + 1 : anchorIdx, 0, node);
  plan.edits.set(TRACKING_FILE, serializeTracking(textOf(files[TRACKING_FILE]), t));
  plan.summary.push('Page tracking: moved to its new place in the course order.');

  // --- Table of contents ----------------------------------------------------------------------------
  for (const f of Object.keys(files).filter(isTocFile)) {
    const text = plan.edits.get(f) ?? textOf(files[f]);
    const r = placeInToc(text, { take: P, put: { name: P, template: P }, ...('after' in pos ? { after: basename(pos.after) } : { before: basename(pos.before) }) });
    if (r.changed && r.text !== text) {
      plan.edits.set(f, r.text);
      plan.summary.push(`Table of contents (${f}): entry moved.`);
    }
  }

  // --- "Page X of Y" -------------------------------------------------------------------------------
  const anchorText = textOf(files[anchor]);
  const newChapter = chapterOf(course.tracking.title, anchorId, anchorText);
  renumber(files, plan.edits, t.title, [oldChapter, newChapter].filter((c): c is TrackNode => !!c), course.fileOf, plan.summary);

  // --- File name: a page moved into another chapter is named for it ---------------------------------
  const stem = stemFor(files, course, page, oldChapter ?? undefined, newChapter ?? spot.parent);
  if (stem) rename(files, plan, page, freeName(files, plan.edits, page, stem));
  plan.page = plan.renamed?.to ?? page;
  plan.summary.push('The manifest lists pages without an order (the course runs them in page-tracking order), so it only changes if the page is renamed.');
  return plan;
}

/** Rename a page: the file itself, and every mention of its name (links, TOC, manifest). */
function rename(files: FileMap, plan: PagePlan, from: string, to: string) {
  const a = basename(from);
  const b = basename(to);
  let count = 0;
  for (const f of new Set([...Object.keys(files), ...plan.edits.keys()])) {
    if (!isTextFile(f) && !plan.edits.has(f)) continue;
    const text = plan.edits.get(f) ?? textOf(files[f]);
    const r = relinkText(text, a, b);
    if (r.count) {
      plan.edits.set(f, r.text);
      if (f !== from) count += r.count;
    }
  }
  plan.edits.set(to, plan.edits.get(from) ?? textOf(files[from]));
  plan.edits.delete(from);
  plan.renamed = { from, to };
  plan.summary.push(`Renamed ${a} → ${b} for its new chapter, with ${count} link${count === 1 ? '' : 's'} to it updated (including the manifest).`);
}

// ---------------------------------------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------------------------------------

export function planCopy(files: FileMap, manifest: ManifestModel | null, page: string, pos: Position = { after: page }): PagePlan {
  const title = files[page] ? pageTitle(files, page) : basename(page);
  const plan: PagePlan = { label: `Copy "${title}"`, edits: new Map(), summary: [], warnings: [] };
  const course = readCourse(files, manifest);
  if (typeof course === 'string') return { ...plan, blocked: course };
  const tests = testPageNames(files);
  const stop = guard(files, course, page, pos, tests);
  if (stop) return { ...plan, blocked: stop };

  const seq = course.seq;
  const spot = resolve(course, seq, pos);
  if (typeof spot === 'string') return { ...plan, blocked: spot };
  const { prev: Q, next: R } = spot;
  const at = seq.indexOf(page);
  const A = seq[at - 1];
  const B = seq[at + 1];
  const anchor = 'after' in pos ? pos.after : pos.before;

  // --- The new page: a new name, id and title ------------------------------------------------------
  const P = basename(page);
  const m = LECTORA_PAGE.exec(P);
  const destChapter = chapterOf(course.tracking.title, course.idOf.get(anchor)!, textOf(files[anchor])) ?? spot.parent;
  const homeChapter = chapterOf(course.tracking.title, course.idOf.get(page)!, textOf(files[page])) ?? undefined;
  const stem = `${stemFor(files, course, page, homeChapter, destChapter) ?? (m ? `${m[1]}_${m[2]}` : P.replace(/\.x?html?$/i, ''))}_copy`;
  const copy = freeName(files, plan.edits, page, stem);
  const C = basename(copy);
  const oldId = course.idOf.get(page)!;
  const allIds = new Set<number>([...course.fileOf.keys()]);
  const walk = (n: TrackNode) => {
    allIds.add(n.id);
    n.c?.forEach(walk);
  };
  walk(course.tracking.title);
  for (const r of manifest?.resources ?? []) {
    const n = /^[A-Z]_(\d+)$/.exec(r.identifier);
    if (n) allIds.add(Number(n[1]));
  }
  const newId = Math.max(...allIds) + 1;
  const copyTitle = `${title} (copy)`;
  let text = textOf(files[page]);
  text = text.replace(new RegExp(`(\\bpgID\\s*=\\s*['"]page)${oldId}(['"])`), `$1${newId}$2`);
  text = text.replace(new RegExp(`(RangeStatus\\(\\s*)${oldId}(\\s*[,)])`, 'g'), `$1${newId}$2`);
  text = text.replace(/(VarCurrentPageName\.set\(\s*')((?:[^'\\]|\\.)*)('\s*\))/, (_, a, t, b) => `${a}${t} (copy)${b}`);
  // <title> often holds the course's name rather than the page's; only a page title gets " (copy)".
  text = text.replace(/(<title>)([^<]*)(<\/title>)/i, (all, a, t, b) => (t.trim() === title ? `${a}${t.trim()} (copy)${b}` : all));
  // Its own Back and Next: to the pages either side of where it goes.
  const name = (p?: string) => (p ? basename(p) : undefined);
  const own = new Map<string, string>();
  if (A && Q) own.set(basename(A), basename(Q));
  if (B && R) own.set(basename(B), basename(R));
  if (A && !Q) own.set(basename(A), basename(A));
  text = swapNames(text, own);
  plan.edits.set(copy, text);
  plan.page = copy;
  plan.summary.push(`New page ${C} (id ${newId}), titled "${copyTitle}".`);
  if (/\btrivQuestionArray\s*=\s*\[\s*\w/.test(text)) {
    plan.warnings.push('The page has a question. The copy shares its answer variable with the original, so answering one answers both; give the copy its own question in Lectora if they should be separate.');
  }

  // --- Next/Back: Q goes on to the copy, R comes back to it ------------------------------------------
  const maps = new Map<string, Map<string, string>>();
  const link = (file: string | undefined, from: string | undefined, to: string) => {
    if (!file || !from) return;
    (maps.get(file) ?? maps.set(file, new Map()).get(file)!).set(from, to);
  };
  link(Q, name(R), C);
  link(R, name(Q), C);
  for (const [f, map] of maps) {
    const t0 = plan.edits.get(f) ?? textOf(files[f]);
    const out = swapNames(t0, map);
    if (out !== t0) plan.edits.set(f, out);
  }
  plan.summary.push(`Next/Back: ${[Q ? `${name(Q)} goes on to the copy` : null, R ? `the copy goes on to ${name(R)}` : null].filter(Boolean).join('; ')}.`);

  // --- Page tracking -------------------------------------------------------------------------------
  const t: Tracking = JSON.parse(JSON.stringify(course.tracking));
  const toParent = findNode(t.title, spot.parent.id)!;
  const anchorId = course.idOf.get(anchor)!;
  const anchorIdx = toParent.c!.findIndex((c) => c.id === anchorId);
  toParent.c!.splice('after' in pos ? anchorIdx + 1 : anchorIdx, 0, { id: newId, v: 0 });
  if (t.numPages !== null && t.numPages > 0) t.numPages++;
  plan.edits.set(TRACKING_FILE, serializeTracking(textOf(files[TRACKING_FILE]), t));
  plan.summary.push('Page tracking: added after its neighbour, so visiting it counts like any other page.');

  // --- Table of contents ---------------------------------------------------------------------------
  for (const f of Object.keys(files).filter(isTocFile)) {
    const t0 = plan.edits.get(f) ?? textOf(files[f]);
    const r = placeInToc(t0, { put: { name: C, title: copyTitle, id: newId, template: P }, ...('after' in pos ? { after: basename(pos.after) } : { before: basename(pos.before) }) });
    if (r.changed && r.text !== t0) {
      plan.edits.set(f, r.text);
      plan.summary.push(`Table of contents (${f}): "${copyTitle}" added.`);
    }
  }

  // --- "Page X of Y" -------------------------------------------------------------------------------
  const fileOf = new Map(course.fileOf).set(newId, copy);
  const chapter = chapterOf(course.tracking.title, anchorId, textOf(files[anchor]));
  renumber(files, plan.edits, t.title, chapter ? [chapter] : [], fileOf, plan.summary);

  // --- Fixed progress totals: the copy adds to the counter too -------------------------------------
  for (const total of findProgressTotals(files)) {
    const inc = total.increments.get(page) ?? 0;
    if (!inc) continue;
    const after = total.value + inc;
    for (const f of Object.keys(files)) {
      if (!/\.(html?|js)$/i.test(f)) continue;
      const t0 = plan.edits.get(f) ?? textOf(files[f]);
      const out = retargetTotal(t0, total.counter, total.total, total.value, after);
      if (out !== t0) plan.edits.set(f, out);
    }
    plan.summary.push(`Progress: ${total.total} raised from ${total.value} to ${after}, since the copy also adds to ${total.counter}.`);
  }

  // --- Manifest: a resource for the new page, wherever the original is depended on --------------------
  if (files['imsmanifest.xml'] && manifest?.resources.some((r) => r.identifier === `P_${oldId}`)) {
    const xml = plan.edits.get('imsmanifest.xml') ?? textOf(files['imsmanifest.xml']);
    plan.edits.set('imsmanifest.xml', cloneResource(xml, `P_${oldId}`, `P_${newId}`, page, copy));
    plan.summary.push(`Manifest: resource P_${newId} for ${C}, listed wherever P_${oldId} is.`);
  } else if (files['imsmanifest.xml']) {
    plan.warnings.push(`The manifest has no resource for ${P}, so none was added for the copy.`);
  }
  return plan;
}

/** File writes for a plan (one undo step). */
export function planWrites(plan: PagePlan, encode: (s: string) => Uint8Array): { path: string; bytes: Uint8Array | null }[] {
  const out: { path: string; bytes: Uint8Array | null }[] = [...plan.edits].map(([path, text]) => ({ path, bytes: encode(text) }));
  if (plan.renamed) out.push({ path: plan.renamed.from, bytes: null });
  return out;
}

export interface Destination {
  path: string;
  title: string;
  /** The chapter's name (its table of contents name where there is one). */
  chapter: string;
}

/** The pages a page can go next to, in course order, with their chapters (the test's pages aren't spots). */
export function destinations(files: FileMap, manifest: ManifestModel | null): Destination[] {
  const course = readCourse(files, manifest);
  if (typeof course === 'string') return [];
  const tests = testPageNames(files);
  const folderNames = new Map<number, string>();
  for (const f of Object.keys(files).filter(isTocFile)) {
    for (const l of textOf(files[f]).split('\n')) {
      const m = TOC_FOLDER.exec(l);
      const id = m && /,\s*(\d+)\s*\)\s*\)\s*;?\s*$/.exec(l)?.[1];
      if (m && id) folderNames.set(Number(id), tocString(m[4]));
    }
  }
  return course.seq
    .filter((p) => !course.inTest.has(course.idOf.get(p)!) && !tests.has(basename(p)))
    .map((p) => {
      const parent = course.parentOf.get(course.idOf.get(p)!);
      const own = parent && parent.id !== course.tracking.title.id ? parent : undefined;
      return { path: p, title: pageTitle(files, p), chapter: own ? (folderNames.get(own.id) ?? `Chapter ${own.id}`) : 'Course' };
    });
}
