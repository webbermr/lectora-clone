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
