/**
 * Deleting pages from a published Lectora title without breaking playback.
 *
 * What a Lectora 19 HTML publish ties together (confirmed against a real
 * course):
 *  - Pages navigate with trivExitPage('a001_page.html', …), including the
 *    trivNextPage / trivPrevPage functions and actions (auto-advance, jumps
 *    to the dashboard, lockout pages).
 *  - trivantis-pagetracking.js holds `trivPageTracking.title`, a tree of
 *    chapter/section/page ids, and `trivPageTracking.numPages`. Each page
 *    marks itself visited with SetRangeStatus(<its id>, 2); the id also names
 *    its manifest resource, P_<id>.
 *  - imsmanifest.xml lists every page as resource P_<id>, with <dependency>
 *    links from the SCO and between pages, and every image/sound in shared
 *    resources.
 *
 * planDelete() works out every change a delete needs, without touching
 * anything, so it can be reviewed first; applyPlan() turns it into writes.
 */
import { referencedAssets, textOf } from './assetRefs';
import { removeResourcesAndFiles, type ManifestModel } from './manifest';
import type { FileMap } from './package';
import { basename, isHtmlFile, isTextFile } from './paths';
import { editTestXml, type OpenedTests, type TestEdit } from './lectoraTest';
import { encodeText } from './text';

export const TRACKING_FILE = 'trivantis-pagetracking.js';

// ---------------------------------------------------------------------------
// Page-tracking tree
// ---------------------------------------------------------------------------

export interface TrackNode {
  id: number;
  v: number;
  /** 1 on a test chapter. */
  t?: number;
  c?: TrackNode[];
}

export interface Tracking {
  title: TrackNode;
  numPages: number | null;
}

const TITLE_RE = /(trivPageTracking\.title\s*=\s*)(\{.*\})(\s*;)/;
const NUMPAGES_RE = /(trivPageTracking\.numPages\s*=\s*)(\d+)(\s*;)/;

export function parseTracking(js: string): Tracking | null {
  const m = TITLE_RE.exec(js);
  if (!m) return null;
  try {
    // The tree is a JS object literal with bare keys: {id:1,v:0,c:[…]}.
    const title = JSON.parse(m[2].replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g, '$1"$2":')) as TrackNode;
    const n = NUMPAGES_RE.exec(js);
    return { title, numPages: n ? Number(n[2]) : null };
  } catch {
    return null;
  }
}

export function serializeTracking(js: string, t: Tracking): string {
  const obj = JSON.stringify(t.title).replace(/"([A-Za-z_]\w*)":/g, '$1:');
  let out = js.replace(TITLE_RE, (_, a, _b, c) => a + obj + c);
  if (t.numPages !== null) out = out.replace(NUMPAGES_RE, (_, a, _b, c) => a + t.numPages + c);
  return out;
}

/** Leaf pages in course order, with whether each sits inside a test. */
export function trackedPages(node: TrackNode, inTest = false, out: { id: number; test: boolean }[] = []) {
  const test = inTest || node.t === 1;
  if (!node.c) out.push({ id: node.id, test });
  else for (const c of node.c) trackedPages(c, test, out);
  return out;
}

function allIds(node: TrackNode, inTest = false, out = new Map<number, boolean>()) {
  const test = inTest || node.t === 1;
  out.set(node.id, test);
  for (const c of node.c ?? []) allIds(c, test, out);
  return out;
}

/**
 * Remove nodes by id. Containers left with no children go too (a chapter
 * whose pages are all deleted), except the root.
 */
function pruneTree(root: TrackNode, remove: Set<number>): { removedLeaves: TrackNode[]; removedTestLeaves: number } {
  const removedLeaves: TrackNode[] = [];
  let removedTestLeaves = 0;
  const walk = (node: TrackNode, inTest: boolean) => {
    if (!node.c) return;
    const test = inTest || node.t === 1;
    node.c = node.c.filter((child) => {
      if (remove.has(child.id)) {
        for (const leaf of trackedPages(child, test)) {
          removedLeaves.push({ id: leaf.id, v: 0 });
          if (leaf.test) removedTestLeaves++;
        }
        return false;
      }
      const hadChildren = !!child.c?.length;
      walk(child, test);
      return !(hadChildren && child.c && child.c.length === 0);
    });
  };
  walk(root, false);
  return { removedLeaves, removedTestLeaves };
}

// ---------------------------------------------------------------------------
// Pages, ids and order
// ---------------------------------------------------------------------------

export interface LectoraCourse {
  tracking: Tracking | null;
  /** Page file -> tracking/resource id. */
  idOf: Map<string, number>;
  fileOf: Map<number, string>;
  /** Every page in course order. */
  order: string[];
}

const PG_ID = /\bpgID\s*=\s*['"]page(\d+)['"]/;

export function readLectoraCourse(files: FileMap, manifest: ManifestModel | null): LectoraCourse {
  const idOf = new Map<string, number>();
  const fileOf = new Map<number, string>();
  for (const r of manifest?.resources ?? []) {
    const m = /^P_(\d+)$/.exec(r.identifier);
    const f = r.files.find((x) => isHtmlFile(x)) ?? r.href;
    if (m && f && files[f]) {
      idOf.set(f, Number(m[1]));
      fileOf.set(Number(m[1]), f);
    }
  }
  // Pages the manifest doesn't map: read the id from the page itself.
  for (const f of Object.keys(files)) {
    if (!isHtmlFile(f) || idOf.has(f)) continue;
    const m = PG_ID.exec(textOf(files[f]).slice(0, 20000));
    if (m) {
      idOf.set(f, Number(m[1]));
      if (!fileOf.has(Number(m[1]))) fileOf.set(Number(m[1]), f);
    }
  }

  const tracking = files[TRACKING_FILE] ? parseTracking(textOf(files[TRACKING_FILE])) : null;
  const order: string[] = [];
  const seen = new Set<string>();
  const push = (f: string | undefined) => {
    if (f && !seen.has(f)) {
      seen.add(f);
      order.push(f);
    }
  };
  // The tracking tree is Lectora's own course order; containers can be pages too (test sections).
  if (tracking) {
    const visit = (n: TrackNode) => {
      push(fileOf.get(n.id));
      n.c?.forEach(visit);
    };
    visit(tracking.title);
  }
  for (const r of manifest?.resources ?? []) if (/^P_\d+$/.test(r.identifier)) push(fileOf.get(Number(r.identifier.slice(2))));
  return { tracking, idOf, fileOf, order };
}

// ---------------------------------------------------------------------------
// Delete planning
// ---------------------------------------------------------------------------

export interface Rewire {
  file: string;
  from: string;
  to: string;
  count: number;
}

export interface SatisfiedVariable {
  name: string;
  value: string;
  /** Pages whose checks of it were answered. */
  files: string[];
}

export interface TocChange {
  file: string;
  entriesRemoved: number;
  chaptersRemoved: string[];
  /** Chapter entries whose own link pointed at a deleted page and now opens its first remaining page. */
  relinked: string[];
}

export interface ProgressTotalChange {
  /** Counter pages add to as the learner moves on, e.g. Varprogress_track. */
  counter: string;
  /** Fixed total it's compared with, e.g. Vara_progress_total. */
  total: string;
  before: number;
  after: number;
  files: number;
}

export interface DeletePlan {
  pages: string[];
  /** Edited test XML (plain text); encrypted into `edits` just before applying. */
  testXml: Map<string, string>;
  tests: TestEdit[];
  toc: TocChange[];
  progressTotals: ProgressTotalChange[];
  /** Flags only deleted pages set; the pages that check them now answer as if they'd been set. */
  satisfied: SatisfiedVariable[];
  assets: string[];
  rewires: Rewire[];
  /** New text for every file that changes. */
  edits: Map<string, string>;
  numPages?: { before: number; after: number };
  trackingNodesRemoved: number;
  warnings: string[];
  /** Set when the delete must not go ahead. */
  blocked?: string;
}

const PROTECTED = /^(a\d{3}index\.html?|index\.html?|imsmanifest\.xml)$/i;
const ASSET_TOKEN = /[\w\-.%/]+\.(?:png|jpe?g|gif|svg|webp|bmp|mp4|webm|ogv|m4v|mov|mp3|wav|ogg|oga|m4a|aac|flv|swf|pdf|docx?|xlsx?|pptx?|vtt|srt|txt)\b/gi;
const VAR_WRITE = /\b(Var\w+)\.(?:set|add|sub|setByVar)\s*\(/g;
const VAR_READ = /\b(Var\w+)\.(?:equals|greaterThan|lessThan|greaterThanEqual|lessThanEqual|contains|notEquals|getValue)\s*\(/g;

function reEscape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function variableUse(files: FileMap, skip: Set<string>) {
  const writes = new Map<string, Set<string>>();
  const reads = new Map<string, Set<string>>();
  for (const [f, bytes] of Object.entries(files)) {
    if (skip.has(f) || !/\.(html?|js)$/i.test(f)) continue;
    const text = textOf(bytes);
    for (const [re, map] of [[VAR_WRITE, writes], [VAR_READ, reads]] as const) {
      re.lastIndex = 0;
      for (let m = re.exec(text); m; m = re.exec(text)) {
        if (!map.has(m[1])) map.set(m[1], new Set());
        map.get(m[1])!.add(f);
      }
    }
  }
  return { writes, reads };
}

/**
 * Work out everything needed to delete `pages` cleanly. Nothing is changed.
 */
export function planDelete(
  files: FileMap,
  manifest: ManifestModel | null,
  pagesToDelete: string[],
  opts: { allowTests?: boolean; keepFinishable?: boolean; tests?: OpenedTests | { error: string } | null } = {},
): DeletePlan {
  const keepFinishable = opts.keepFinishable ?? true;
  const course = readLectoraCourse(files, manifest);
  const pages = [...new Set(pagesToDelete)].filter((p) => files[p]);
  const del = new Set(pages);
  const plan: DeletePlan = { pages, testXml: new Map(), tests: [], toc: [], progressTotals: [], satisfied: [], assets: [], rewires: [], edits: new Map(), trackingNodesRemoved: 0, warnings: [] };

  const protectedHit = pages.filter((p) => PROTECTED.test(basename(p)));
  if (protectedHit.length) {
    plan.blocked = `${protectedHit.join(', ')} is the course's launch file and can't be deleted.`;
    return plan;
  }
  const ids = course.tracking ? allIds(course.tracking.title) : new Map<number, boolean>();
  const tests = opts.tests && 'xml' in opts.tests ? opts.tests : null;
  const testPagesHit = pages.filter((p) => ids.get(course.idOf.get(p) ?? -1));
  if (testPagesHit.length && !tests && !opts.allowTests) {
    const why = opts.tests && 'error' in opts.tests ? ` ${opts.tests.error}` : '';
    plan.blocked =
      `${testPagesHit.length} of these pages belong to the test. The test's question list (_tobj….txt) has to be updated ` +
      `too, or the test could stop scoring or finishing, and it couldn't be read.${why} Leave the test pages out of this delete for now.`;
    return plan;
  }
  const resultsHit = tests ? [...tests.xml.values()].flatMap((x) => [...x.matchAll(/<page[^>]*hasResults[^>]*>[\s\S]*?<name>([^<]*)<\/name>/g)].map((m) => basename(m[1]))).filter((n) => del.has(n) || pages.some((p) => basename(p) === n)) : [];
  if (resultsHit.length) {
    plan.blocked = `${resultsHit.join(', ')} is the test's results page; the test needs it to show and record the score.`;
    return plan;
  }

  // --- Where each reference to a deleted page should now go --------------
  const order = course.order.length ? course.order : Object.keys(files).filter(isHtmlFile).sort();
  const pos = new Map(order.map((p, i) => [p, i]));
  const survivors = order.filter((p) => !del.has(p));
  const nextSurvivor = (p: string) => {
    const i = pos.get(p);
    if (i === undefined) return survivors[0];
    for (let j = i + 1; j < order.length; j++) if (!del.has(order[j])) return order[j];
    return undefined;
  };
  const prevSurvivor = (p: string) => {
    const i = pos.get(p);
    if (i === undefined) return survivors.at(-1);
    for (let j = i - 1; j >= 0; j--) if (!del.has(order[j])) return order[j];
    return undefined;
  };
  /** Forward links skip ahead past the gap, backward links skip back, never onto the linking page itself. */
  const target = (fromFile: string, deleted: string): string | undefined => {
    const a = pos.get(fromFile);
    const b = pos.get(deleted);
    const forward = a === undefined || b === undefined || a < b;
    const first = forward ? nextSurvivor(deleted) : prevSurvivor(deleted);
    const second = forward ? prevSurvivor(deleted) : nextSurvivor(deleted);
    return [first, second].find((t) => t && t !== fromFile);
  };

  const names = pages.map((p) => basename(p));
  const byName = new Map(pages.map((p) => [basename(p), p]));
  const linkRe = names.length ? new RegExp(`(?<![A-Za-z0-9_\\-])(${names.map(reEscape).join('|')})(?![A-Za-z0-9_])`, 'g') : null;
  const rewireCount = new Map<string, Rewire>();
  const unresolved = new Set<string>();

  for (const [f, bytes] of Object.entries(files)) {
    if (del.has(f) || f === 'imsmanifest.xml' || f === TRACKING_FILE || !isTextFile(f) || !linkRe) continue;
    const original = textOf(bytes);
    let text = original;
    // Table of contents: drop the deleted pages' entries (and emptied chapters) outright.
    if (isTocFile(f)) {
      const toc = removeFromToc(text, new Set(names));
      if (toc.entriesRemoved || toc.chaptersRemoved.length || toc.relinked.length) {
        plan.toc.push({ file: f, entriesRemoved: toc.entriesRemoved, chaptersRemoved: toc.chaptersRemoved, relinked: toc.relinked });
        text = toc.text;
      }
    }
    linkRe.lastIndex = 0;
    if (!linkRe.test(text)) {
      if (text !== original) plan.edits.set(f, text);
      continue;
    }
    linkRe.lastIndex = 0;
    const out = text.replace(linkRe, (whole: string, name: string) => {
      const to = target(f, byName.get(name)!);
      if (!to) {
        unresolved.add(`${f} → ${name}`);
        return whole;
      }
      const key = `${f}|${name}|${to}`;
      const r = rewireCount.get(key) ?? { file: f, from: name, to: basename(to), count: 0 };
      r.count++;
      rewireCount.set(key, r);
      return basename(to);
    });
    if (out !== original) plan.edits.set(f, out);
  }
  plan.rewires = [...rewireCount.values()];
  if (unresolved.size) {
    plan.warnings.push(`${unresolved.size} link(s) have no page left to point to and were left as they are: ${[...unresolved].slice(0, 5).join('; ')}`);
  }

  // --- The test's question list -------------------------------------------------
  if (tests) {
    const deletedNames = new Set(names);
    for (const [file, xml] of tests.xml) {
      const { xml: out, edit } = editTestXml(file, xml, deletedNames, (page) => {
        const t = target('', byName.get(basename(page)) ?? page);
        return t ? basename(t) : undefined;
      });
      if (out === xml) continue;
      plan.testXml.set(file, out);
      plan.tests.push(edit);
      if (edit.drawn.after < edit.drawn.before) {
        plan.warnings.push(`The test will ask ${edit.drawn.after} questions per attempt instead of ${edit.drawn.before}. Its pass mark stays at the same percentage.`);
      }
    }
  } else if (opts.tests && 'error' in opts.tests) {
    plan.warnings.push(`The test couldn't be read, so it wasn't checked for references to these pages. ${opts.tests.error}`);
  }

  // --- Page tracking --------------------------------------------------------
  if (course.tracking && files[TRACKING_FILE]) {
    const t: Tracking = JSON.parse(JSON.stringify(course.tracking));
    const removeIds = new Set(pages.map((p) => course.idOf.get(p)).filter((x): x is number => x !== undefined));
    const { removedLeaves, removedTestLeaves } = pruneTree(t.title, removeIds);
    plan.trackingNodesRemoved = removedLeaves.length;
    if (t.numPages !== null) {
      // Lectora's numPages doesn't always equal the tracked page count (a real course had
      // 459 for 418 content pages), so shift it by exactly what was removed, keeping
      // whatever offset the published course had. Test questions are counted by the test.
      const after = Math.max(0, t.numPages - (removedLeaves.length - removedTestLeaves));
      plan.numPages = { before: t.numPages, after };
      t.numPages = after;
    }
    const untracked = pages.filter((p) => !course.idOf.has(p) || !ids.has(course.idOf.get(p)!));
    if (untracked.length) plan.warnings.push(`${untracked.length} deleted page(s) weren't in the page-tracking list, so the page count didn't need them.`);
    plan.edits.set(TRACKING_FILE, serializeTracking(textOf(files[TRACKING_FILE]), t));
  } else {
    plan.warnings.push(`No ${TRACKING_FILE} found, so visit tracking wasn't updated. This is expected for courses not made in Lectora.`);
  }

  // --- Assets only the deleted pages used -------------------------------------
  const stillUsed = new Set<string>();
  for (const [f, bytes] of Object.entries(files)) {
    if (del.has(f) || !isTextFile(f) || f === 'imsmanifest.xml') continue;
    const text = plan.edits.get(f) ?? textOf(bytes);
    for (const m of text.match(ASSET_TOKEN) ?? []) {
      stillUsed.add(m.toLowerCase());
      stillUsed.add(basename(m).toLowerCase());
    }
  }
  // Runtime assets (Lectora's S_* resources: buttons, TOC icons, player skins) are never removed.
  const runtime = new Set((manifest?.resources ?? []).filter((r) => !/^(P|R)_/.test(r.identifier)).flatMap((r) => r.files));
  const candidates = new Set(pages.flatMap((p) => referencedAssets(p, files)));
  plan.assets = [...candidates].filter((a) => !runtime.has(a) && !stillUsed.has(a.toLowerCase()) && !stillUsed.has(basename(a).toLowerCase())).sort();

  // --- Manifest ---------------------------------------------------------------
  if (files['imsmanifest.xml']) {
    const resourceIds = pages.map((p) => course.idOf.get(p)).filter((x) => x !== undefined).map((id) => `P_${id}`);
    plan.edits.set('imsmanifest.xml', removeResourcesAndFiles(textOf(files['imsmanifest.xml']), resourceIds, [...pages, ...plan.assets]));
  }

  // --- Things that could leave the course stuck ------------------------------------
  // A flag (e.g. "module 3 done") that only deleted pages set, but that remaining
  // pages still check, would never be set again: whatever waits on it (unlocking
  // the final assessment, completion) would never happen.
  const before = variableUse(files, new Set());
  const after = variableUse(files, del);
  const stuck: string[] = [];
  for (const [name, writers] of before.writes) {
    if (after.writes.has(name) || !after.reads.has(name)) continue;
    const readers = [...after.reads.get(name)!];
    const values = new Set<string>();
    let simple = true;
    for (const w of writers) {
      const text = textOf(files[w]);
      const re = new RegExp(`\\b${reEscape(name)}\\.(set|add|sub|setByVar)\\s*\\(\\s*(['"])([^'"]*)\\2\\s*\\)`, 'g');
      for (let m = re.exec(text); m; m = re.exec(text)) {
        if (m[1] !== 'set') simple = false;
        else values.add(m[3]);
      }
      // Any other kind of write (computed values, variable copies) can't be replayed safely.
      const all = (text.match(new RegExp(`\\b${reEscape(name)}\\.(set|add|sub|setByVar)\\s*\\(`, 'g')) ?? []).length;
      const literal = (text.match(new RegExp(`\\b${reEscape(name)}\\.(set|add|sub|setByVar)\\s*\\(\\s*(['"])[^'"]*\\2\\s*\\)`, 'g')) ?? []).length;
      if (all !== literal) simple = false;
    }
    const fixable = keepFinishable && simple && values.size === 1;
    if (fixable) {
      const value = [...values][0];
      // Replace each check with its answer, as if the deleted pages had run. This
      // doesn't depend on when the runtime loads saved variable values from the LMS.
      // All or nothing: every check must have a literal argument we can evaluate.
      const readRe = new RegExp(`\\b${reEscape(name)}\\.(equals|notEquals|greaterThan|lessThan|greaterThanEqual|lessThanEqual|contains|getValue)\\s*\\(\\s*(?:(['"])([^'"]*)\\2)?\\s*\\)`, 'g');
      const anyUse = new RegExp(`\\b${reEscape(name)}\\b`, 'g');
      const writes = new RegExp(`\\b${reEscape(name)}\\.(set|add|sub|setByVar)\\s*\\(`, 'g');
      const declLine = new RegExp(`^.*\\b${reEscape(name)}\\s*=\\s*new\\s+Variable\\s*\\(.*$`, 'gm');
      const patched = new Map<string, string>();
      let ok = true;
      for (const r of readers) {
        const text = plan.edits.get(r) ?? textOf(files[r]);
        let replaced = 0;
        const out = text.replace(readRe, (whole, op: string, q: string | undefined, arg: string | undefined) => {
          const answer = evaluateCheck(op, value, q ? arg! : undefined);
          if (answer === undefined) return whole;
          replaced++;
          return answer;
        });
        // Outside its declaration, every mention must be a write or a check we just
        // answered; anything else (passing it to a function, copying it) we can't reason about.
        const body = text.replace(declLine, '');
        const mentions = (body.match(anyUse) ?? []).length;
        const written = (body.match(writes) ?? []).length;
        if (!replaced || mentions - written !== replaced) {
          ok = false;
          break;
        }
        patched.set(r, out);
      }
      if (ok) {
        for (const [r, t] of patched) plan.edits.set(r, t);
        plan.satisfied.push({ name, value, files: readers });
        continue;
      }
    }
    stuck.push(`${name} is only set on deleted page(s) (${[...writers].slice(0, 2).map(basename).join(', ')}) but still checked on ${readers.slice(0, 3).map(basename).join(', ')}`);
  }
  if (stuck.length) {
    plan.warnings.push(
      `Possible lock-up: ${stuck.length} variable(s) will never be set again, so anything waiting on them (unlocking a module, the final assessment, completion) may never happen. ` +
        stuck.slice(0, 6).join('. ') + (stuck.length > 6 ? `. …and ${stuck.length - 6} more.` : '.'),
    );
  }
  // --- Fixed progress totals ------------------------------------------------------
  // e.g. progress = Varprogress_track / Vara_progress_total (379), where each page adds 1
  // to Varprogress_track. Deleting pages that add to the counter lowers the most a learner
  // can reach, so the total has to drop by the same amount or progress stops short of 100%.
  for (const link of findProgressTotals(files)) {
    const lost = pages.reduce((n, p) => n + (link.increments.get(p) ?? 0), 0);
    if (!lost) continue;
    const after = Math.max(0, link.value - lost);
    let touched = 0;
    for (const f of Object.keys(files)) {
      if (del.has(f) || !/\.(html?|js)$/i.test(f)) continue;
      const text = plan.edits.get(f) ?? textOf(files[f]);
      const out = retargetTotal(text, link.counter, link.total, link.value, after);
      if (out !== text) {
        plan.edits.set(f, out);
        touched++;
      }
    }
    plan.progressTotals.push({ counter: link.counter, total: link.total, before: link.value, after, files: touched });
  }

  const tocRewires = plan.rewires.filter((r) => isTocFile(r.file));
  if (tocRewires.length) {
    plan.warnings.push(
      `The table of contents (${[...new Set(tocRewires.map((r) => r.file))].join(', ')}) still names ${tocRewires.length} deleted page(s) in a form this version can't remove; those links now open the nearest remaining page.`,
    );
  }
  return plan;
}

// ---------------------------------------------------------------------------
// Table of contents (a001_toc*.html)
// ---------------------------------------------------------------------------

export function isTocFile(path: string): boolean {
  return /(^|\/)a\d{3}_toc\d*\.html?$/i.test(path);
}

const STR = String.raw`"(?:[^"\\]|\\.)*"`;
const TOC_FOLDER = new RegExp(String.raw`^(\s*)(\w+)\s*=\s*insertFolder\(\s*(\w+)\s*,\s*NewFolder\(\s*(${STR})\s*,\s*"([^"]*)"\s*,\s*"\w*"\s*,\s*\d+\s*\)\s*\)\s*;?\s*$`);
const TOC_ENTRY = new RegExp(String.raw`^\s*insertEntry\(\s*(\w+)\s*,\s*NewLink\(\s*(${STR})\s*,\s*"([^"]*)"\s*,\s*"\w*"\s*,\s*\d+\s*\)\s*\)\s*;?\s*$`);

interface TocFolderLine {
  line: number;
  title: string;
  link: string;
  parent: number | null;
  children: number;
}

/**
 * Remove entries for deleted pages from Lectora's TOC script, then chapters left
 * empty. A chapter whose own link pointed at a deleted page now opens its first
 * remaining page. Lines this doesn't recognise are left exactly as they were.
 */
export function removeFromToc(text: string, deletedNames: Set<string>) {
  const lines = text.split('\n');
  const folders = new Map<number, TocFolderLine>();
  const binding = new Map<string, number>(); // variable name -> folder line currently assigned to it
  const drop = new Set<number>();
  const firstEntry = new Map<number, string>();
  const lostSome = new Set<number>(); // chapters that had at least one entry removed
  let entriesRemoved = 0;

  lines.forEach((l, i) => {
    const f = TOC_FOLDER.exec(l);
    if (f) {
      const parent = binding.get(f[3]) ?? null;
      folders.set(i, { line: i, title: JSON.parse(f[4]), link: f[5], parent, children: 0 });
      if (parent !== null) folders.get(parent)!.children++;
      binding.set(f[2], i);
      return;
    }
    const e = TOC_ENTRY.exec(l);
    if (!e) return;
    const folder = binding.get(e[1]);
    if (deletedNames.has(basename(e[3]))) {
      drop.add(i);
      entriesRemoved++;
      if (folder !== undefined) lostSome.add(folder);
      return;
    }
    if (folder !== undefined) {
      folders.get(folder)!.children++;
      if (!firstEntry.has(folder)) firstEntry.set(folder, e[3]);
    }
  });

  // Remove emptied chapters, innermost first, so a parent emptied by that goes too.
  const chaptersRemoved: string[] = [];
  const byDepth = [...folders.values()].sort((a, b) => b.line - a.line);
  let changed = true;
  while (changed) {
    changed = false;
    for (const f of byDepth) {
      // Only chapters that lost everything they had; never folders that were empty to begin with.
      // (The root, fT = NewFolder(…), isn't an insertFolder line, so top-level chapters have no parent here.)
      if (drop.has(f.line) || f.children > 0 || !lostSome.has(f.line)) continue;
      drop.add(f.line);
      chaptersRemoved.push(f.title);
      if (f.parent !== null) {
        folders.get(f.parent)!.children--;
        lostSome.add(f.parent);
      }
      changed = true;
    }
  }

  const relinked: string[] = [];
  const out = lines
    .map((l, i) => {
      const f = folders.get(i);
      if (!f || drop.has(i) || !deletedNames.has(basename(f.link))) return l;
      const to = firstEntry.get(i);
      if (!to) return l;
      relinked.push(f.title);
      return l.replace(`"${f.link}"`, `"${to}"`);
    })
    .filter((_, i) => !drop.has(i));
  return { text: out.join('\n'), entriesRemoved, chaptersRemoved, relinked };
}

/** Page and chapter titles as the table of contents shows them (Lectora's real names). */
export function tocTitles(files: FileMap): { pages: Map<string, string>; chapters: Map<string, string> } {
  const pages = new Map<string, string>();
  const chapters = new Map<string, string>(); // any page in the chapter -> chapter title
  const title = (raw: string) => {
    try {
      return (JSON.parse(raw) as string).replace(/<[^>]+>/g, '').trim();
    } catch {
      return '';
    }
  };
  for (const f of Object.keys(files).filter(isTocFile)) {
    const current = new Map<string, string>(); // folder variable -> its title
    for (const line of textOf(files[f]).split('\n')) {
      const fo = TOC_FOLDER.exec(line);
      if (fo) {
        current.set(fo[2], title(fo[4]));
        continue;
      }
      const e = TOC_ENTRY.exec(line);
      if (!e) continue;
      const page = basename(e[3]);
      const t = title(e[2]);
      if (t && !pages.has(page)) pages.set(page, t);
      const chapter = current.get(e[1]);
      if (chapter && !chapters.has(page)) chapters.set(page, chapter);
    }
  }
  return { pages, chapters };
}

// ---------------------------------------------------------------------------
// Fixed progress totals
// ---------------------------------------------------------------------------

export interface ProgressTotal {
  counter: string;
  total: string;
  value: number;
  /** How much each page adds to the counter. */
  increments: Map<string, number>;
}

/**
 * Pairs of (counter, total) where pages add to the counter and it's compared with a
 * variable declared with a fixed numeric default, e.g.
 *   Varprogress_track.add('1')                                  (on each page)
 *   Varprogress_track.lessThan(Vara_progress_total.getValue())  (dashboard)
 *   Vara_progress_total = new Variable( 'Vara_progress_total', '379', … )
 */
export function findProgressTotals(files: FileMap): ProgressTotal[] {
  const increments = new Map<string, Map<string, number>>();
  const compared = new Map<string, Set<string>>();
  const defaults = new Map<string, number>();
  const ADD = /\b(Var\w+)\.add\(\s*['"](\d+)['"]\s*\)/g;
  const CMP = /\b(Var\w+)\.(?:lessThan|lessThanEqual|greaterThan|greaterThanEqual|equals)\(\s*(Var\w+)\.getValue\(\)\s*\)/g;
  const DECL = /\b(Var\w+)\s*=\s*new\s+Variable\(\s*['"]\1['"]\s*,\s*['"](\d+)['"]/g;
  for (const [f, bytes] of Object.entries(files)) {
    if (!/\.(html?|js)$/i.test(f)) continue;
    const text = textOf(bytes);
    for (const m of text.matchAll(ADD)) {
      if (!increments.has(m[1])) increments.set(m[1], new Map());
      const per = increments.get(m[1])!;
      per.set(f, (per.get(f) ?? 0) + Number(m[2]));
    }
    for (const m of text.matchAll(CMP)) {
      if (!compared.has(m[1])) compared.set(m[1], new Set());
      compared.get(m[1])!.add(m[2]);
    }
    for (const m of text.matchAll(DECL)) if (!defaults.has(m[1])) defaults.set(m[1], Number(m[2]));
  }
  const out: ProgressTotal[] = [];
  for (const [counter, totals] of compared) {
    const per = increments.get(counter);
    if (!per) continue;
    for (const total of totals) {
      const value = defaults.get(total);
      // A total nothing ever changes: only its declared default matters.
      if (value === undefined || increments.has(total)) continue;
      out.push({ counter, total, value, increments: per });
    }
  }
  return out;
}

/** Lower a fixed total wherever it's written: its declared default, and progress bars sized to it. */
function retargetTotal(text: string, counter: string, total: string, before: number, after: number): string {
  let out = text.replace(
    new RegExp(`(\\b${reEscape(total)}\\s*=\\s*new\\s+Variable\\(\\s*['"]${reEscape(total)}['"]\\s*,\\s*['"])${before}(['"])`, 'g'),
    `$1${after}$2`,
  );
  // Progress bars whose range was sized to the total (Lectora: new ObjProgress(…, min, max, …)).
  if (out.includes(counter) || out.includes(total)) {
    out = out.replace(/^.*new\s+ObjProgress\(.*$/gm, (line) => line.replace(new RegExp(`,(\\s*\\d+\\s*),(\\s*)${before}(\\s*),`), `,$1,$2${after}$3,`));
  }
  // Direct comparisons with the number: Varprogress_track.lessThan('379').
  out = out.replace(new RegExp(`(\\b${reEscape(counter)}\\.(?:lessThan|lessThanEqual|greaterThan|greaterThanEqual|equals)\\(\\s*['"])${before}(['"])`, 'g'), `$1${after}$2`);
  return out;
}

/**
 * The result of a Lectora variable check, as JS source, given the value it
 * would have had. undefined when it can't be worked out safely.
 */
export function evaluateCheck(op: string, value: string, arg: string | undefined): string | undefined {
  if (op === 'getValue') return arg === undefined ? `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'` : undefined;
  if (arg === undefined) return undefined;
  const num = (x: string) => (x.trim() !== '' && !isNaN(Number(x)) ? Number(x) : null);
  const a = num(value);
  const b = num(arg);
  const cmp = a !== null && b !== null ? a - b : value.localeCompare(arg);
  switch (op) {
    case 'equals':
      return String(a !== null && b !== null ? a === b : value === arg);
    case 'notEquals':
      return String(!(a !== null && b !== null ? a === b : value === arg));
    case 'greaterThan':
      return String(cmp > 0);
    case 'lessThan':
      return String(cmp < 0);
    case 'greaterThanEqual':
      return String(cmp >= 0);
    case 'lessThanEqual':
      return String(cmp <= 0);
    case 'contains':
      return String(value.includes(arg));
  }
  return undefined;
}

/** Turn a plan into file writes (one undo step). */
export function planChanges(plan: DeletePlan): { path: string; bytes: Uint8Array | null }[] {
  return [
    ...[...plan.edits].map(([path, text]) => ({ path, bytes: encodeText(text) })),
    ...[...plan.pages, ...plan.assets].map((path) => ({ path, bytes: null })),
  ];
}
