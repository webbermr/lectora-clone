/**
 * Course check: finds what would make a course break, loop or never finish
 * when played. Run it any time, and automatically after deleting pages.
 */
import { textOf } from './assetRefs';
import { findProgressTotals, readLectoraCourse, TRACKING_FILE, trackedPages } from './lectora';
import type { ManifestModel } from './manifest';
import type { FileMap } from './package';
import { basename, isHtmlFile, isTextFile, resolveFrom } from './paths';

export type Severity = 'error' | 'warning' | 'info';

export interface Issue {
  severity: Severity;
  /** Short grouping label, e.g. "Broken link". */
  kind: string;
  message: string;
  file?: string;
}

export interface CheckResult {
  issues: Issue[];
  pagesChecked: number;
  /** Next-button path from the first page, when it could be traced. */
  nextChain?: { length: number; endsAt: string };
}

const NEXT_FN = /function\s+trivNextPage\s*\(\s*\)\s*\{\s*trivExitPage\(\s*['"]([^'"]+)['"]/;
const PREV_FN = /function\s+trivPrevPage\s*\(\s*\)\s*\{\s*trivExitPage\(\s*['"]([^'"]+)['"]/;
// Quoted page names used as links: trivExitPage('x.html'), href="x.html", location = 'x.html'.
const PAGE_REF = /['"]([^'"\s<>()]+?\.html?)(?:[?#][^'"]*)?['"]/gi;
const RUNTIME_FILE = /^(trivantis[\w.-]*|jquery[\w.-]*|mediaelement[\w.-]*|es6-promise[\w.-]*|enc|aria-utils|apiwrapper\w*|scofunctions|dialog|trivantis-player)\.js$/i;
const IGNORE_REF = /^(https?:|mailto:|javascript:|data:|\/\/)|\+/i;

export function checkCourse(files: FileMap, manifest: ManifestModel | null): CheckResult {
  const issues: Issue[] = [];
  const add = (severity: Severity, kind: string, message: string, file?: string) => issues.push({ severity, kind, message, file });
  const pages = Object.keys(files).filter(isHtmlFile);

  // --- Links to pages that don't exist ----------------------------------------
  // The authoring tool's own player code (Lectora's trivantis*.js, jQuery, the SCORM
  // wrapper) mentions internal names like cookie keys and a debug window that learners
  // never navigate to, so only the course's own pages and data files are checked.
  const runtime = new Set([
    ...(manifest?.resources ?? []).filter((r) => /^S_/.test(r.identifier)).flatMap((r) => r.files),
    ...Object.keys(files).filter((f) => RUNTIME_FILE.test(basename(f))),
  ]);
  const broken = new Map<string, Set<string>>();
  for (const f of Object.keys(files)) {
    if (!/\.(html?|js)$/i.test(f) || f.includes('__lc_edit__') || runtime.has(f)) continue;
    const text = textOf(files[f]);
    PAGE_REF.lastIndex = 0;
    for (let m = PAGE_REF.exec(text); m; m = PAGE_REF.exec(text)) {
      const ref = m[1];
      if (IGNORE_REF.test(ref)) continue;
      const path = resolveFrom(f, ref);
      if (!path || files[path]) continue;
      // Some runtimes build names at run time; only flag names that look like real pages.
      if (!/^[\w\-./%]+$/.test(ref)) continue;
      if (!broken.has(f)) broken.set(f, new Set());
      broken.get(f)!.add(ref);
    }
  }
  for (const [f, refs] of broken) {
    add('error', 'Broken link', `Links to ${[...refs].slice(0, 4).join(', ')}${refs.size > 4 ? ` and ${refs.size - 4} more` : ''}, which ${refs.size === 1 ? "isn't" : "aren't"} in the package. Learners who follow ${refs.size === 1 ? 'it' : 'them'} get a "not found" page.`, f);
  }

  // --- Next/Back buttons: self-links, loops, dead ends --------------------------
  const next = new Map<string, string>();
  for (const f of pages) {
    const text = textOf(files[f]);
    const n = NEXT_FN.exec(text)?.[1];
    const p = PREV_FN.exec(text)?.[1];
    if (n) {
      const to = resolveFrom(f, n) ?? n;
      next.set(f, to);
      if (to === f) add('error', 'Loop', `The Next button goes back to this same page, so learners get stuck here.`, f);
    }
    if (p && (resolveFrom(f, p) ?? p) === f) add('error', 'Loop', `The Back button goes to this same page.`, f);
  }
  const course = readLectoraCourse(files, manifest);
  let nextChain: CheckResult['nextChain'];
  const start = course.order.find((p) => next.has(p)) ?? [...next.keys()][0];
  if (start) {
    const seen = new Map<string, number>();
    let cur: string | undefined = start;
    let steps = 0;
    while (cur && next.has(cur) && !seen.has(cur) && steps < 5000) {
      seen.set(cur, steps++);
      cur = next.get(cur);
    }
    // Ending back at the start (the dashboard/menu) is normal; a circle that
    // closes anywhere else keeps learners going round without reaching the end.
    if (cur && seen.has(cur) && cur !== start) {
      const loop = [...seen.keys()].slice(seen.get(cur)!).map(basename);
      add('error', 'Loop', `Clicking Next goes round in a circle: ${loop.slice(0, 6).join(' → ')}${loop.length > 6 ? ' → …' : ''} → ${basename(cur)}.`, cur);
    }
    nextChain = { length: seen.size + (cur && !seen.has(cur) ? 1 : 0), endsAt: cur ?? start };
  }

  // --- Visit tracking ---------------------------------------------------------
  if (course.tracking) {
    const tracked = trackedPages(course.tracking.title);
    const missing = tracked.filter((t) => !course.fileOf.has(t.id));
    if (missing.length) {
      add(
        'error',
        'Can never finish',
        `The page-tracking list includes ${missing.length} page(s) that no longer exist (ids ${missing.slice(0, 5).map((m) => m.id).join(', ')}${missing.length > 5 ? ', …' : ''}). A course that needs every page visited can never reach 100%.`,
        TRACKING_FILE,
      );
    }
    const content = tracked.filter((t) => !t.test).length;
    if (course.tracking.numPages !== null) {
      add(
        'info',
        'Page count',
        `Lectora's page count (numPages) is ${course.tracking.numPages}; ${content} content pages and ${tracked.length - content} test pages are tracked. Lectora counts pages its own way, so these needn't match. When pages are deleted, numPages drops by the number of content pages removed, keeping the difference the same as when the course was published.`,
        TRACKING_FILE,
      );
    }
  }

  // --- Fixed progress totals the pages can no longer reach ---------------------------
  for (const t of findProgressTotals(files)) {
    const reachable = [...t.increments].filter(([f]) => files[f] && isHtmlFile(f)).reduce((n, [, v]) => n + v, 0);
    if (reachable < t.value) {
      add(
        'error',
        'Progress can’t reach 100%',
        `Pages add up to ${reachable} on ${t.counter}, but ${t.total} expects ${t.value}. Learners will never see 100% progress (or anything that waits for it). Deleting pages with this app lowers ${t.total} automatically.`,
        [...t.increments.keys()].find((f) => /dashboard/i.test(f)),
      );
    }
  }

  // --- Manifest -----------------------------------------------------------------
  if (manifest) {
    const ids = new Set(manifest.resources.map((r) => r.identifier));
    const missingFiles = [...new Set(manifest.resources.flatMap((r) => r.files).filter((f) => !files[f]))];
    if (missingFiles.length) {
      add('warning', 'Manifest', `The manifest lists ${missingFiles.length} file(s) that aren't in the package, e.g. ${missingFiles.slice(0, 3).join(', ')}. Some LMSs reject such packages.`, 'imsmanifest.xml');
    }
    const launch = manifest.items.flatMap(function walk(i): string[] {
      return [...(i.href ? [i.href] : []), ...i.children.flatMap(walk)];
    });
    for (const h of launch) if (!files[h]) add('error', 'Manifest', `The course launches ${h}, which isn't in the package.`, 'imsmanifest.xml');
    const xml = files['imsmanifest.xml'] ? textOf(files['imsmanifest.xml']) : '';
    const deps = [...xml.matchAll(/<dependency[^>]*identifierref="([^"]+)"/g)].map((m) => m[1]).filter((d) => !ids.has(d));
    if (deps.length) add('error', 'Manifest', `${deps.length} <dependency> entries point to resources that don't exist (${[...new Set(deps)].slice(0, 3).join(', ')}).`, 'imsmanifest.xml');
  }

  const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  issues.sort((a, b) => order[a.severity] - order[b.severity] || a.kind.localeCompare(b.kind));
  return { issues, pagesChecked: pages.filter((p) => !p.includes('__lc_edit__') && isTextFile(p)).length, nextChain };
}
