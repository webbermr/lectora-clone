import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkCourse } from '../src/lib/courseCheck';
import { parseTracking } from '../src/lib/lectora';
import { parseManifest } from '../src/lib/manifest';
import { readScormZip, type FileMap } from '../src/lib/package';
import { planCopy, planMove, planWrites, type PagePlan } from '../src/lib/pageOps';
import { decodeText, encodeText } from '../src/lib/text';

const load = () => readScormZip(readFileSync('samples/lectora-style-scorm12.zip'));
const text = (files: FileMap, p: string) => decodeText(files[p]);
const nextOf = (files: FileMap, p: string) => /function trivNextPage\(\) \{\s*trivExitPage\( '([^']+)'/.exec(text(files, p))?.[1];
const prevOf = (files: FileMap, p: string) => /function trivPrevPage\(\) \{\s*trivExitPage\( '([^']+)'/.exec(text(files, p))?.[1];
const manifestOf = (files: FileMap) => parseManifest(text(files, 'imsmanifest.xml'));

function apply(files: FileMap, plan: PagePlan): FileMap {
  expect(plan.blocked).toBeUndefined();
  const out = { ...files };
  for (const c of planWrites(plan, encodeText)) {
    if (c.bytes) out[c.path] = c.bytes;
    else delete out[c.path];
  }
  return out;
}

/** Leaf page ids in tracking order. */
const order = (files: FileMap) => {
  const ids: number[] = [];
  const walk = (n: { id: number; c?: { id: number }[] }) => (n.c ? n.c.forEach(walk) : ids.push(n.id));
  walk(parseTracking(text(files, 'trivantis-pagetracking.js'))!.title);
  return ids;
};
const tocPages = (files: FileMap) => [...text(files, 'a001_toc1.html').matchAll(/NewLink\("[^"]*", "([^"]+)"/g)].map((m) => m[1]);
const tocFolders = (files: FileMap) => [...text(files, 'a001_toc1.html').matchAll(/NewFolder\("([^"]*)", "([^"]+)"/g)].map((m) => `${m[1]}=${m[2]}`);
const errors = (files: FileMap) => checkCourse(files, manifestOf(files)).issues.filter((i) => i.severity === 'error');

const R = {
  welcome: 'a001_reporting_welcome.html',
  when: 'a001_reporting_when_to_report.html',
  summary: 'a001_reporting_module_summary.html',
};

describe('moving Lectora pages', () => {
  it('moves a page back one, keeping Next/Back, tracking, the TOC and its chapter link right', async () => {
    const files = await load();
    const after = apply(files, planMove(files, manifestOf(files), R.when, { before: R.welcome }));

    // Old order: ws_summary -> welcome -> when -> summary. New: ws_summary -> when -> welcome -> summary.
    expect(nextOf(after, 'a001_workplace_safety_module_summary.html')).toBe(R.when);
    expect(prevOf(after, R.when)).toBe('a001_workplace_safety_module_summary.html');
    expect(nextOf(after, R.when)).toBe(R.welcome);
    expect(prevOf(after, R.welcome)).toBe(R.when);
    expect(nextOf(after, R.welcome)).toBe(R.summary);
    expect(prevOf(after, R.summary)).toBe(R.welcome);

    expect(order(after).slice(9, 12)).toEqual([1009, 1008, 1010]);
    expect(tocPages(after).slice(9, 12)).toEqual([R.when, R.welcome, R.summary]);
    // The chapter's own TOC link opened its first page, so it opens the new first page.
    expect(tocFolders(after)).toContain(`Reporting=${R.when}`);
    expect(errors(after)).toEqual([]);
  });

  it('moves a page forward one', async () => {
    const files = await load();
    const after = apply(files, planMove(files, manifestOf(files), R.welcome, { after: R.when }));
    expect(nextOf(after, 'a001_workplace_safety_module_summary.html')).toBe(R.when);
    expect(nextOf(after, R.when)).toBe(R.welcome);
    expect(nextOf(after, R.welcome)).toBe(R.summary);
    expect(prevOf(after, R.summary)).toBe(R.welcome);
    expect(order(after).slice(9, 12)).toEqual([1009, 1008, 1010]);
    expect(errors(after)).toEqual([]);
  });

  it('moves a page into another chapter, renaming it for that chapter and updating the manifest', async () => {
    const files = await load();
    const plan = planMove(files, manifestOf(files), R.when, { after: 'a001_workplace_safety_hazards.html' });
    const moved = 'a001_workplace_safety_when_to_report.html';
    expect(plan.renamed).toEqual({ from: R.when, to: moved });
    expect(plan.page).toBe(moved);
    const after = apply(files, plan);

    expect(after[R.when]).toBeUndefined();
    expect(nextOf(after, 'a001_workplace_safety_hazards.html')).toBe(moved);
    expect(prevOf(after, moved)).toBe('a001_workplace_safety_hazards.html');
    expect(nextOf(after, moved)).toBe('a001_workplace_safety_protective_gear.html');
    expect(prevOf(after, 'a001_workplace_safety_protective_gear.html')).toBe(moved);
    // The gap it left closes.
    expect(nextOf(after, R.welcome)).toBe(R.summary);
    expect(prevOf(after, R.summary)).toBe(R.welcome);

    const m = manifestOf(after);
    expect(m.resources.find((r) => r.identifier === 'P_1009')!.files).toContain(moved);
    expect(text(after, 'imsmanifest.xml')).not.toContain(R.when);
    expect(order(after).slice(4, 7)).toEqual([1003, 1004, 1009]);
    expect(errors(after)).toEqual([]);
  });

  it('moves a page to the start of a chapter', async () => {
    const files = await load();
    const first = 'a001_getting_started_welcome.html';
    const after = apply(files, planMove(files, manifestOf(files), 'a001_getting_started_module_summary.html', { before: first }));
    expect(nextOf(after, 'a001_student_dashboard.html')).toBe('a001_getting_started_module_summary.html');
    expect(nextOf(after, 'a001_getting_started_module_summary.html')).toBe(first);
    expect(nextOf(after, 'a001_getting_started_how_to_navigate.html')).toBe('a001_workplace_safety_welcome.html');
    expect(tocFolders(after)).toContain('Getting Started=a001_getting_started_module_summary.html');
    expect(errors(after)).toEqual([]);
  });

  it('renumbers "Page X of Y" in both chapters', async () => {
    const files = await load();
    // Give the sample's pages Lectora's chapter counter.
    const chapters: Record<string, string[]> = {
      getting: ['a001_getting_started_welcome.html', 'a001_getting_started_how_to_navigate.html', 'a001_getting_started_module_summary.html'],
      reporting: [R.welcome, R.when, R.summary],
    };
    for (const pages of Object.values(chapters)) {
      pages.forEach((p, i) => {
        files[p] = encodeText(text(files, p).replace('</script>', `VarPageInChapter.set('${i + 1}');\nVarPagesInChapter.set('${pages.length}');\n</script>`));
      });
    }
    const after = apply(files, planMove(files, manifestOf(files), R.welcome, { after: 'a001_getting_started_how_to_navigate.html' }));
    const moved = 'a001_getting_started_welcome_2.html'; // a001_getting_started_welcome.html is taken
    const shown = (p: string) => [/VarPageInChapter\.set\('(\d+)'/.exec(text(after, p))?.[1], /VarPagesInChapter\.set\('(\d+)'/.exec(text(after, p))?.[1]].join('/');
    expect(shown('a001_getting_started_how_to_navigate.html')).toBe('2/4');
    expect(shown(moved)).toBe('3/4');
    expect(shown('a001_getting_started_module_summary.html')).toBe('4/4');
    expect(shown(R.when)).toBe('1/2');
    expect(shown(R.summary)).toBe('2/2');
    expect(errors(after)).toEqual([]);
  });

  it('blocks test pages, spots inside the test, and the launch page', async () => {
    const files = await load();
    const m = manifestOf(files);
    expect(planMove(files, m, 'a001_test_module_1_q2.html', { after: R.when }).blocked).toMatch(/part of the test/);
    expect(planMove(files, m, R.when, { after: 'a001_test_module_1_q1.html' }).blocked).toMatch(/inside the test/);
    expect(planMove(files, m, 'a001index.html', { after: R.when }).blocked).toMatch(/launch page/);
    expect(planMove(files, m, R.when, { after: R.welcome }).blocked).toMatch(/already there/);
  });
});

describe('copying Lectora pages', () => {
  it('copies a page straight after the original, as a new page throughout the course', async () => {
    const files = await load();
    const plan = planCopy(files, manifestOf(files), R.welcome);
    const copy = 'a001_reporting_welcome_copy.html';
    expect(plan.page).toBe(copy);
    const after = apply(files, plan);

    // A new id, its own tracking and title.
    const t = text(after, copy);
    expect(t).toContain("pgID = 'page7722'");
    expect(t).toContain('SetRangeStatus(7722,2)');
    expect(text(after, R.welcome)).toContain("pgID = 'page1008'");

    // In the chain between the original and the page after it.
    expect(nextOf(after, R.welcome)).toBe(copy);
    expect(prevOf(after, copy)).toBe(R.welcome);
    expect(nextOf(after, copy)).toBe(R.when);
    expect(prevOf(after, R.when)).toBe(copy);
    expect(prevOf(after, R.welcome)).toBe('a001_workplace_safety_module_summary.html');

    const tracking = parseTracking(text(after, 'trivantis-pagetracking.js'))!;
    expect(tracking.numPages).toBe(22);
    expect(order(after).slice(9, 13)).toEqual([1008, 7722, 1009, 1010]);
    expect(text(after, 'a001_toc1.html')).toContain(`insertEntry(aux1, NewLink("Welcome (copy)", "${copy}", "page", 7722))`);

    // The manifest has a resource for it, and the course depends on it like on the original.
    const m = manifestOf(after);
    const res = m.resources.find((r) => r.identifier === 'P_7722')!;
    expect(res.files).toEqual([copy]);
    expect(m.resources.find((r) => r.identifier === 'A001')!.dependencies).toContain('P_7722');

    // It adds to the course progress counter, so the total goes up.
    expect(text(after, 'a001_student_dashboard.html')).toContain("Vara_progress_total = new Variable( 'Vara_progress_total', '14' )");
    expect(errors(after)).toEqual([]);
  });

  it('copies a page into another chapter', async () => {
    const files = await load();
    const plan = planCopy(files, manifestOf(files), R.welcome, { before: 'a001_old_policies_welcome.html' });
    const copy = 'a001_old_policies_welcome_copy.html';
    expect(plan.page).toBe(copy);
    const after = apply(files, plan);
    expect(nextOf(after, R.summary)).toBe(copy);
    expect(prevOf(after, copy)).toBe(R.summary);
    expect(nextOf(after, copy)).toBe('a001_old_policies_welcome.html');
    expect(prevOf(after, 'a001_old_policies_welcome.html')).toBe(copy);
    // The original's links are untouched.
    expect(nextOf(after, R.welcome)).toBe(R.when);
    expect(tocFolders(after)).toContain(`Old Policies=${copy}`);
    expect(errors(after)).toEqual([]);
  });

  it('blocks copying test pages', async () => {
    const files = await load();
    expect(planCopy(files, manifestOf(files), 'a001_test_module_2_q1.html').blocked).toMatch(/part of the test/);
  });
});
