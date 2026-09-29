import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkCourse } from '../src/lib/courseCheck';
import { parseTracking, planChanges, planDelete, serializeTracking, trackedPages } from '../src/lib/lectora';
import { parseManifest } from '../src/lib/manifest';
import { readScormZip, type FileMap } from '../src/lib/package';
import { decodeText } from '../src/lib/text';

const load = () => readScormZip(readFileSync('samples/lectora-style-scorm12.zip'));
const text = (files: FileMap, p: string) => decodeText(files[p]);
const nextOf = (files: FileMap, p: string) => /function trivNextPage\(\) \{\s*trivExitPage\( '([^']+)'/.exec(text(files, p))?.[1];
const prevOf = (files: FileMap, p: string) => /function trivPrevPage\(\) \{\s*trivExitPage\( '([^']+)'/.exec(text(files, p))?.[1];

function apply(files: FileMap, changes: { path: string; bytes: Uint8Array | null }[]): FileMap {
  const out = { ...files };
  for (const c of changes) {
    if (c.bytes) out[c.path] = c.bytes;
    else delete out[c.path];
  }
  return out;
}

describe('page-tracking tree', () => {
  it('round-trips Lectora\'s bare-key object literal', () => {
    const js = "var x = 1;\ntrivPageTracking.numPages = 3;\ntrivPageTracking.title={id:1,v:0,c:[{id:38,v:0,c:[{id:7,v:0}]},{id:9,v:0,t:1,c:[{id:10,v:0}]}]};\n";
    const t = parseTracking(js)!;
    expect(t.numPages).toBe(3);
    expect(trackedPages(t.title)).toEqual([{ id: 7, test: false }, { id: 10, test: true }]);
    expect(serializeTracking(js, t)).toBe(js);
  });
});

describe('deleting Lectora pages', () => {
  it('starts from a clean course', async () => {
    const files = await load();
    const r = checkCourse(files, parseManifest(text(files, 'imsmanifest.xml')));
    expect(r.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('removes a whole module and rewires Next/Back across the gap', async () => {
    const files = await load();
    const m = parseManifest(text(files, 'imsmanifest.xml'));
    const mod = Object.keys(files).filter((f) => f.startsWith('a001_workplace_safety_')).sort();
    const plan = planDelete(files, m, mod);
    expect(plan.blocked).toBeUndefined();
    const after = apply(files, planChanges(plan));

    // Last page before the gap now goes forward past it; first page after goes back past it.
    expect(nextOf(after, 'a001_getting_started_module_summary.html')).toBe('a001_reporting_welcome.html');
    expect(prevOf(after, 'a001_reporting_welcome.html')).toBe('a001_getting_started_module_summary.html');
    // The dashboard's link to the deleted module now opens the next module instead of a missing page.
    expect(text(after, 'a001_student_dashboard.html')).not.toContain('a001_workplace_safety_welcome.html');

    // Files, manifest and tracking agree.
    for (const p of mod) expect(after[p]).toBeUndefined();
    const xml = text(after, 'imsmanifest.xml');
    expect(xml).not.toMatch(/workplace_safety/);
    const t = parseTracking(text(after, 'trivantis-pagetracking.js'))!;
    expect(JSON.stringify(t.title)).not.toContain('"id":300'); // the emptied module node is gone
    expect(t.numPages).toBe(parseTracking(text(files, 'trivantis-pagetracking.js'))!.numPages! - mod.length);

    // Images only that module used are removed; shared ones stay.
    expect(plan.assets.length).toBeGreaterThan(0);
    for (const a of plan.assets) expect(a).toMatch(/workplace_safety/);
    expect(after['images/logo.png']).toBeDefined();

    // No broken links, loops or orphaned tracking after the delete.
    const r = checkCourse(after, parseManifest(xml));
    expect(r.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('keeps the final assessment reachable when a module is deleted', async () => {
    const files = await load();
    const m = parseManifest(text(files, 'imsmanifest.xml'));
    const pages = Object.keys(files).filter((f) => f.startsWith('a001_old_policies_'));
    const plan = planDelete(files, m, pages);
    // The dashboard's checks of the module's "done" flag are answered as if it had been set.
    expect(plan.satisfied).toEqual([{ name: 'VarModule500Done', value: '1', files: ['a001_student_dashboard.html'] }]);
    expect(plan.warnings.join(' ')).not.toContain('lock-up');
    const dash = decodeText(apply(files, planChanges(plan))['a001_student_dashboard.html']);
    expect(dash).not.toMatch(/VarModule500Done\.equals/);
    expect(dash).toContain("VarModule400Done.equals('1') && true");

    // Opting out leaves it alone and warns instead.
    const manual = planDelete(files, m, pages, { keepFinishable: false });
    expect(manual.satisfied).toEqual([]);
    expect(manual.warnings.join(' ')).toMatch(/Possible lock-up.*VarModule500Done.*a001_student_dashboard\.html/);
  });

  it('blocks deleting test pages', async () => {
    const files = await load();
    const js = text(files, 'trivantis-pagetracking.js').replace('{id:400,v:0,c:', '{id:400,v:0,t:1,c:');
    const withTest = { ...files, 'trivantis-pagetracking.js': new TextEncoder().encode(js) };
    const plan = planDelete(withTest, parseManifest(text(files, 'imsmanifest.xml')), ['a001_reporting_when_to_report.html']);
    expect(plan.blocked).toMatch(/test/);
  });

  it('never points a page at itself and handles deleting single pages', async () => {
    const files = await load();
    const m = parseManifest(text(files, 'imsmanifest.xml'));
    const plan = planDelete(files, m, ['a001_workplace_safety_hazards.html', 'a001_workplace_safety_let_s_review.html']);
    const after = apply(files, planChanges(plan));
    expect(nextOf(after, 'a001_workplace_safety_welcome.html')).toBe('a001_workplace_safety_protective_gear.html');
    expect(prevOf(after, 'a001_workplace_safety_protective_gear.html')).toBe('a001_workplace_safety_welcome.html');
    expect(nextOf(after, 'a001_workplace_safety_protective_gear.html')).toBe('a001_workplace_safety_module_summary.html');
    for (const f of Object.keys(after).filter((x) => x.endsWith('.html'))) {
      expect(nextOf(after, f)).not.toBe(f);
      expect(prevOf(after, f)).not.toBe(f);
    }
    expect(checkCourse(after, parseManifest(text(after, 'imsmanifest.xml'))).issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('refuses to delete the launch page', async () => {
    const files = await load();
    const plan = planDelete(files, parseManifest(text(files, 'imsmanifest.xml')), ['a001index.html']);
    expect(plan.blocked).toMatch(/launch/);
  });
});

describe('answering variable checks', () => {
  it('leaves a flag alone (and warns) when a page uses it in a way that can\'t be answered', async () => {
    const files = await load();
    const m = parseManifest(text(files, 'imsmanifest.xml'));
    const dashFile = 'a001_student_dashboard.html';
    const odd = decodeText(files[dashFile]).replace('function action_final()', 'function report() { logIt(VarModule500Done); }\nfunction action_final()');
    const withOdd = { ...files, [dashFile]: new TextEncoder().encode(odd) };
    const plan = planDelete(withOdd, m, Object.keys(files).filter((f) => f.startsWith('a001_old_policies_')));
    expect(plan.satisfied).toEqual([]);
    expect(plan.warnings.join(' ')).toContain('VarModule500Done');
    expect(plan.edits.get(dashFile) ?? '').toContain("VarModule500Done.equals('1')"); // untouched
  });

  it('evaluates Lectora comparisons the way the variable would', async () => {
    const { evaluateCheck } = await import('../src/lib/lectora');
    expect(evaluateCheck('equals', '1', '1')).toBe('true');
    expect(evaluateCheck('equals', '1', '0')).toBe('false');
    expect(evaluateCheck('equals', '1', '1.0')).toBe('true');
    expect(evaluateCheck('greaterThan', '10', '3')).toBe('true'); // numeric, not string, comparison
    expect(evaluateCheck('lessThan', 'b', 'a')).toBe('false');
    expect(evaluateCheck('getValue', "it's", undefined)).toBe("'it\\'s'");
    expect(evaluateCheck('equals', '1', undefined)).toBeUndefined();
  });
});

describe('course check', () => {
  it('catches broken links, self-loops and tracking for missing pages', async () => {
    const files = await load();
    // Delete a page the crude way: no rewiring, no tracking update.
    const broken = { ...files };
    delete broken['a001_reporting_when_to_report.html'];
    const selfLoop = decodeText(broken['a001_reporting_welcome.html']).replace(/trivExitPage\( 'a001_reporting_when_to_report.html'/, "trivExitPage( 'a001_reporting_welcome.html'");
    broken['a001_reporting_welcome.html'] = new TextEncoder().encode(selfLoop);
    const r = checkCourse(broken, parseManifest(text(broken, 'imsmanifest.xml')));
    const kinds = r.issues.filter((i) => i.severity === 'error').map((i) => i.kind);
    expect(kinds).toContain('Broken link');
    expect(kinds).toContain('Loop');
    expect(kinds).toContain('Can never finish');
  });

  it('catches Next buttons that go round in a circle away from the start', async () => {
    const files = await load();
    const f = 'a001_reporting_when_to_report.html';
    const looped = { ...files, [f]: new TextEncoder().encode(decodeText(files[f]).replace(/trivNextPage\(\) \{\s*trivExitPage\( '[^']+'/, "trivNextPage() {\n    trivExitPage( 'a001_reporting_welcome.html'")) };
    const r = checkCourse(looped, parseManifest(text(looped, 'imsmanifest.xml')));
    const loop = r.issues.find((i) => i.kind === 'Loop');
    expect(loop?.message).toContain('a001_reporting_welcome.html');
  });
});

describe('table of contents', () => {
  const tocOf = (files: FileMap) => text(files, 'a001_toc1.html');

  it('removes deleted pages and chapters left empty, instead of pointing them elsewhere', async () => {
    const files = await load();
    const m = parseManifest(text(files, 'imsmanifest.xml'));
    const mod = Object.keys(files).filter((f) => f.startsWith('a001_workplace_safety_'));
    const plan = planDelete(files, m, [...mod, 'a001_reporting_when_to_report.html']);
    expect(plan.toc).toEqual([{ file: 'a001_toc1.html', entriesRemoved: 6, chaptersRemoved: ['Workplace Safety'], relinked: [] }]);
    const toc = tocOf(apply(files, planChanges(plan)));
    expect(toc).not.toContain('workplace_safety');
    expect(toc).not.toContain('When To Report');
    expect(toc).not.toContain('"Workplace Safety"');
    expect(toc).toContain('NewLink("Module Summary", "a001_reporting_module_summary.html"'); // neighbours untouched
    expect(plan.warnings.join(' ')).not.toMatch(/table of contents/i);
  });

  it("moves a chapter's link to its first remaining page when that page is deleted", async () => {
    const files = await load();
    const plan = planDelete(files, parseManifest(text(files, 'imsmanifest.xml')), ['a001_reporting_welcome.html']);
    expect(plan.toc[0].relinked).toEqual(['Reporting']);
    expect(tocOf(apply(files, planChanges(plan)))).toContain('NewFolder("Reporting", "a001_reporting_when_to_report.html", "chap", 400)');
  });
});

describe('fixed progress totals', () => {
  it('lowers the page total by the pages removed, so progress can still reach 100%', async () => {
    const files = await load();
    const m = parseManifest(text(files, 'imsmanifest.xml'));
    const mod = Object.keys(files).filter((f) => f.startsWith('a001_workplace_safety_'));
    const plan = planDelete(files, m, mod);
    expect(plan.progressTotals).toEqual([{ counter: 'Varprogress_track', total: 'Vara_progress_total', before: 13, after: 8, files: 1 }]);
    const dash = text(apply(files, planChanges(plan)), 'a001_student_dashboard.html');
    expect(dash).toContain("Vara_progress_total = new Variable( 'Vara_progress_total', '8' )");
    expect(dash).toMatch(/new ObjProgress\('progress1',.*,1,8,/); // the dashboard bar is resized too
    const r = checkCourse(apply(files, planChanges(plan)), parseManifest(text(apply(files, planChanges(plan)), 'imsmanifest.xml')));
    expect(r.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('course check catches a total the pages can no longer reach', async () => {
    const files = await load();
    const crude = { ...files };
    for (const f of Object.keys(files).filter((x) => x.startsWith('a001_workplace_safety_'))) delete crude[f];
    const r = checkCourse(crude, parseManifest(text(crude, 'imsmanifest.xml')));
    const stuck = r.issues.find((i) => i.kind === 'Progress can’t reach 100%');
    expect(stuck?.message).toContain('Vara_progress_total');
    expect(stuck?.message).toContain('13');
  });
});

describe('course check false alarms', () => {
  it("ignores names inside Lectora's own runtime files and decodes %20 in the manifest", async () => {
    const files = await load();
    const withRuntime = {
      ...files,
      'trivantis-cookie.js': new TextEncoder().encode("var n = 'LectoraPermCookie_title.html';"),
    };
    const r = checkCourse(withRuntime, parseManifest(text(files, 'imsmanifest.xml')));
    expect(r.issues.filter((i) => i.severity !== 'info')).toEqual([]);
    expect(parseManifest(text(files, 'imsmanifest.xml')).resources.find((x) => x.identifier === 'R_extern')!.files).toEqual(['resources/Safety Handbook.pdf']);
  });
});

describe('titles', () => {
  it('uses the table of contents names in the chapter tree', async () => {
    const { inferLectoraStructure } = await import('../src/lib/structure');
    const files = await load();
    const s = inferLectoraStructure(parseManifest(text(files, 'imsmanifest.xml')), files)!;
    const gs = s.modules.find((m) => m.title === 'Getting Started')!;
    // The TOC says "How To Navigate"; the file-name guess would be "How to Navigate".
    expect(gs.children.map((c) => c.title)).toContain('How To Navigate');
  });
});

describe('deleting test questions', () => {
  it('decrypts the test with the package\'s own enc.js and trivantis-titlemgr.js', async () => {
    const { openTests } = await import('../src/lib/lectoraTest');
    const files = await load();
    const t = openTests(files);
    expect(t && 'xml' in t).toBe(true);
    const xml = (t as { xml: Map<string, string> }).xml.get('_tobj700.txt')!;
    expect(xml).toContain('<name>a001_test_module_1_q2.html</name>');
  });

  it('removes questions, keeps the draw within what is left, and re-encrypts', async () => {
    const { openTests, testPages } = await import('../src/lib/lectoraTest');
    const files = await load();
    const tests = openTests(files)!;
    const m = parseManifest(text(files, 'imsmanifest.xml'));
    const plan = planDelete(files, m, ['a001_test_module_1_q1.html', 'a001_test_module_1_q2.html'], { tests });
    expect(plan.blocked).toBeUndefined();
    expect(plan.tests).toEqual([
      {
        file: '_tobj700.txt',
        questionsRemoved: 2,
        sectionsRemoved: [],
        numrandom: [{ section: '710', before: 2, after: 1 }],
        relinked: [],
        drawn: { before: 4, after: 3 },
      },
    ]);
    const xml = plan.testXml.get('_tobj700.txt')!;
    expect(testPages(xml)).toEqual(['a001_test_module_1_q3.html', 'a001_test_module_2_q1.html', 'a001_test_module_2_q2.html', 'a001_test_test_results.html']);
    // Section 2 starts where its first question now sits; pages count up with no gaps.
    expect([...xml.matchAll(/<section>\s*<index>(\d+)/g)].map((x) => x[1])).toEqual(['0', '1']);

    // Encrypted as the flow would, then read back by the package's own code.
    const sealed = (tests as { cipher: { encrypt(x: string): string } }).cipher.encrypt(xml);
    expect(sealed.startsWith('U2FsdGVkX1')).toBe(true);
    const after = apply(files, [...planChanges(plan), { path: '_tobj700.txt', bytes: new TextEncoder().encode(sealed) }]);
    const reopened = openTests(after) as { xml: Map<string, string> };
    expect(reopened.xml.get('_tobj700.txt')).toBe(xml);
    const r = checkCourse(after, parseManifest(text(after, 'imsmanifest.xml')), openTests(after));
    expect(r.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('removes a whole section and protects the results page', async () => {
    const { openTests } = await import('../src/lib/lectoraTest');
    const files = await load();
    const tests = openTests(files)!;
    const m = parseManifest(text(files, 'imsmanifest.xml'));
    const plan = planDelete(files, m, ['a001_test_module_2_q1.html', 'a001_test_module_2_q2.html'], { tests });
    expect(plan.tests[0].sectionsRemoved).toEqual(['720']);
    expect(plan.tests[0].drawn).toEqual({ before: 4, after: 2 });
    expect(planDelete(files, m, ['a001_test_test_results.html'], { tests }).blocked).toMatch(/results page/);
  });

  it('course check catches a test that lists missing pages', async () => {
    const { openTests } = await import('../src/lib/lectoraTest');
    const files = await load();
    const crude = { ...files };
    delete crude['a001_test_module_1_q1.html'];
    const r = checkCourse(crude, parseManifest(text(crude, 'imsmanifest.xml')), openTests(crude));
    expect(r.issues.find((i) => i.kind === 'Test')?.message).toContain('a001_test_module_1_q1.html');
  });
});
