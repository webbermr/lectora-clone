import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readScormZip } from '../src/lib/package';
import { answerVariables, applyDefault, courseDefault, questionPages, readRule, setRule } from '../src/lib/answerRule';
import { encodeText } from '../src/lib/text';

// A Lectora-style page with a Next button that goes to the page's next page (names invented).
const page = (next: string, extra = '') => `<html><head><script>
var pgID = 'page${next.length}';
function trivNextPage() {
    trivExitPage( '${next}', true )
}
function action1(fn){
    trivExitPage('${next}',true);
    if(fn && typeof(fn) == 'string' ) eval(fn);
}
function button9onUp() {
  action1();
}
function button8onUp() {
  trivExitPage('a001_resources.html',true);
}
</script></head><body><script>
button9 = new ObjButton('button9', 'Next',954,629,30,30,1,1,'div','',1,0)
button8 = new ObjButton('button8', 'Resources',900,629,30,30,1,1,'div','',1,0)
${extra}
</script></body></html>`;

const files = () => ({
  'a001_code_quiz_question_1.html': encodeText(page('a001_code_summary.html')),
  'a001_code_welcome.html': encodeText(page('a001_code_quiz_question_1.html')),
  'a001_code_summary.html': encodeText(page('a001_next.html')),
  'a001_no_next.html': encodeText('<html><body><script>text1 = new ObjText(\'text1\',null,0,0,10,10)</script></body></html>'),
  'a001_quiz_question_2.html': encodeText('<html><body><script>text1 = new ObjText(\'text1\',null,0,0,10,10)</script></body></html>'),
});

describe('answer required', () => {
  it("finds every test question page from the encrypted test file, with its answer variable, but not the results page", async () => {
    const f = await readScormZip(readFileSync('samples/lectora-style-scorm12.zip'));
    const q = questionPages(f);
    const test = [...q].filter(([, v]) => v.source === 'test');
    expect(test.map(([p]) => p)).toEqual(['a001_test_module_1_q1.html', 'a001_test_module_1_q2.html', 'a001_test_module_1_q3.html', 'a001_test_module_2_q1.html', 'a001_test_module_2_q2.html']);
    expect(test.every(([, v]) => v.vars.length === 1)).toBe(true);
    expect(q.has('a001_test_test_results.html')).toBe(false);
  });

  it('recognises quiz pages by name (test pages come from the test file)', () => {
    const q = questionPages(files());
    expect([...q.keys()].sort()).toEqual(['a001_code_quiz_question_1.html', 'a001_quiz_question_2.html']);
    expect(q.get('a001_code_quiz_question_1.html')?.source).toBe('name');
  });

  it('adds, reads and removes the rule, hiding only the Next button', () => {
    const f = files();
    const html = setRule(f, 'a001_code_quiz_question_1.html', { rule: 'required', set: 'page' })!;
    expect(readRule(html)).toEqual({ rule: 'required', set: 'page' });
    expect(html).toContain('#button9,');
    expect(html).not.toContain('#button8');
    expect(html.indexOf('lc-answer-rule')).toBeLessThan(html.indexOf('</body>'));
    // Taking it off again gives the page back unchanged.
    f['a001_code_quiz_question_1.html'] = encodeText(html);
    expect(setRule(f, 'a001_code_quiz_question_1.html', null)).toBe(new TextDecoder().decode(files()['a001_code_quiz_question_1.html']));
    // No Next button: nothing to hide.
    expect(setRule(f, 'a001_no_next.html', { rule: 'required', set: 'page' })).toBeNull();
  });

  it('applies the course default without touching pages set on their own', () => {
    const f = files();
    f['a001_code_quiz_question_1.html'] = encodeText(setRule(f, 'a001_code_quiz_question_1.html', { rule: 'optional', set: 'page' })!);
    expect(courseDefault(f)).toBe('optional');
    const { changes, skipped } = applyDefault(f, 'required');
    expect(changes).toEqual([]); // the only other question page has no Next button (and there's no manifest here)
    expect(skipped).toEqual(['a001_quiz_question_2.html']);
    // With a manifest, the default is noted there, so it holds even when no page could take it.
    const withManifest = { ...f, 'imsmanifest.xml': encodeText('<?xml version="1.0"?>\n<manifest/>') };
    const r = applyDefault(withManifest, 'required');
    expect(r.changes.map((c) => c.path)).toEqual(['imsmanifest.xml']);
    expect(r.changes[0].text).toBe('<?xml version="1.0"?>\n<!-- scorm-editor answer-default: required -->\n<manifest/>');
    withManifest['imsmanifest.xml'] = encodeText(r.changes[0].text);
    expect(courseDefault(withManifest)).toBe('required');
  });
});

describe('the script on the page', () => {
  afterEach(() => {
    vi.useRealTimers();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  const run = (html: string) => {
    const script = /<script id="lc-answer-rule"[^>]*>([\s\S]*?)<\/script>/.exec(html)![1];
    (0, eval)(script);
  };

  it('keeps Next hidden until a choice is picked, ignoring choices already set', () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<div id="button9"></div>
      <input type="radio" name="mode" checked><input type="radio" name="mode">
      <input type="radio" name="q"><input type="radio" name="q">`;
    run(setRule(files(), 'a001_code_quiz_question_1.html', { rule: 'required', set: 'page' })!);
    expect(document.getElementById('lc-answer-guard')).not.toBeNull();
    vi.advanceTimersByTime(1000);
    expect(document.getElementById('lc-answer-guard')).not.toBeNull(); // the pre-set option doesn't count
    (document.querySelectorAll('input[name=q]')[1] as HTMLInputElement).checked = true;
    vi.advanceTimersByTime(300);
    expect(document.getElementById('lc-answer-guard')).toBeNull();
  });

  it('also counts a typed answer, and steps aside when the page player moves on', () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="button9"></div><input type="text" value="">';
    (window as unknown as { pgID: string }).pgID = 'p1';
    run(setRule(files(), 'a001_code_quiz_question_1.html', { rule: 'required', set: 'page' })!);
    vi.advanceTimersByTime(300);
    (document.querySelector('input') as HTMLInputElement).value = '42';
    vi.advanceTimersByTime(300);
    expect(document.getElementById('lc-answer-guard')).toBeNull();

    document.body.innerHTML = '<div id="button9"></div><input type="radio">';
    run(setRule(files(), 'a001_code_quiz_question_1.html', { rule: 'required', set: 'page' })!);
    (window as unknown as { pgID: string }).pgID = 'p2';
    vi.advanceTimersByTime(300);
    expect(document.getElementById('lc-answer-guard')).toBeNull();
  });

  it('stops the narration auto-advancing to the next page until answered, but not a click or other pages', () => {
    vi.useFakeTimers();
    const w = window as unknown as { trivExitPage: (u: string) => void; pgID?: string; __lcAnswerGuard?: unknown };
    delete w.pgID;
    delete w.__lcAnswerGuard;
    const went: string[] = [];
    w.trivExitPage = (u: string) => went.push(u);
    document.body.innerHTML = '<div id="button9"></div><input type="radio" name="q">';
    run(setRule(files(), 'a001_code_quiz_question_1.html', { rule: 'required', set: 'page' })!);
    vi.advanceTimersByTime(300);
    vi.advanceTimersByTime(2000); // no gesture for a while, like narration ending
    w.trivExitPage('a001_code_summary.html'); // auto-advance: dropped
    w.trivExitPage('a001_timeout.html'); // somewhere else (a session timeout): allowed
    expect(went).toEqual(['a001_timeout.html']);
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    w.trivExitPage('a001_code_summary.html'); // a click (a table of contents entry): allowed
    vi.advanceTimersByTime(2000);
    (document.querySelector('input') as HTMLInputElement).checked = true;
    vi.advanceTimersByTime(300);
    w.trivExitPage('a001_code_summary.html'); // answered: the page may move on
    expect(went).toEqual(['a001_timeout.html', 'a001_code_summary.html', 'a001_code_summary.html']);
  });

  it('finds module quiz pages by the Lectora question on them, and the variable the answer goes in', () => {
    // A quiz page named like any other, with a Submit button that scores the answer and moves on.
    const quiz = `<html><head><script>
var pgID = 'pq';
function trivNextPage() {
    trivExitPage( 'a001_after.html', true )
}
function action2(fn){
    trivExitPage('a001_after.html',true);
}
function button7onUp() {
  action2();
}
function Update_qu55(value) {
 if(typeof(value) !== "undefined")  VarQUIZ_A1.set(value)
  var val = VarQUIZ_A1.getValue()
}
</script></head><body><script>
button7 = new ObjButton('button7', 'SUBMIT',373,404,118,42,1,108,'div','',1,0)
var trivQuestionArray=[qu55];
</script></body></html>`;
    const f = { ...files(), 'a001_communications_scenario.html': encodeText(quiz) };
    expect(answerVariables(quiz)).toEqual(['VarQUIZ_A1']);
    expect(questionPages(f).get('a001_communications_scenario.html')).toMatchObject({ source: 'content', vars: ['VarQUIZ_A1'] });
    const out = setRule(f, 'a001_communications_scenario.html', { rule: 'required', set: 'page' })!;
    expect(out).toContain('var vars=["VarQUIZ_A1"], targets=["a001_after.html"]');
    expect(out).not.toContain('#button7'); // Submit isn't hidden…

    // …but does nothing until answered.
    vi.useFakeTimers();
    const w = window as unknown as { pgID?: string; __lcAnswerGuard?: unknown; VarQUIZ_A1: { v: string; getValue: () => string } };
    delete w.pgID;
    delete w.__lcAnswerGuard;
    w.VarQUIZ_A1 = { v: '', getValue: () => w.VarQUIZ_A1.v };
    document.body.innerHTML = '<div id="button7"><svg id="button7SVG"><path id="button7path"/></svg></div>';
    let submitted = 0;
    document.getElementById('button7')!.addEventListener('click', () => submitted++);
    run(out);
    vi.advanceTimersByTime(300);
    document.getElementById('button7path')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(submitted).toBe(0);
    expect(document.getElementById('lc-answer-note')?.textContent).toBe('Please choose an answer first.');
    w.VarQUIZ_A1.v = 'Sender';
    vi.advanceTimersByTime(300);
    document.getElementById('button7path')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(submitted).toBe(1);
  });
});
