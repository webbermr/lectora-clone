import { describe, expect, it } from 'vitest';
import { planAction, proposeAction, type ActionProposal } from '../src/lib/scorm/actions';
import { runTool } from '../src/lib/scorm/tools';
import { readRule } from '../src/lib/answerRule';
import { hiddenIds } from '../src/lib/removeObjects';
import { declaredPosition } from '../src/lib/moveObjects';
import { encodeText } from '../src/lib/text';

// Lectora-style pages (names invented): a callout inherited by two pages, a chapter's own copy of it on a
// third, and a Next button that leaves the page.
const page = (callout: string, next: string) =>
  encodeText(`<html><head><title>P</title><script>
function trivNextPage() {
    trivExitPage( '${next}', true )
}
function button9onUp() {
  trivExitPage('${next}',true);
}
</script></head><body><script>
button9 = new ObjButton('button9', 'Next',954,629,30,30,1,1,'div','',1,0)
${callout} = new ObjImage('${callout}','images/${callout}.png','Callout 1',100,120,400,200,1,71,'div','',0 )
${callout}.addInnerText('<p>Watch the gray box</p>')
</script></body></html>`);
const course = () => ({
  'a001_one.html': page('shape58889', 'a001_two.html'),
  'a001_two.html': page('shape58889', 'a001_three.html'),
  'a001_three.html': page('shape70001', 'a001_one.html'),
  'images/shape58889.png': new Uint8Array([1, 2, 3]),
  'images/shape70001.png': new Uint8Array([1, 2, 3]),
});
const text = (f: Record<string, Uint8Array>, p: string) => new TextDecoder().decode(f[p]);
const ctx = (files: Record<string, Uint8Array>) => ({ files, manifest: null, courseName: 'C' });

describe('editor actions SCORM can offer', () => {
  it('offers removing an object on this page or every page with it, and does only what was chosen', async () => {
    const files = course();
    const out = await runTool('remove_object', { path: 'a001_one.html', id: 'shape58889', summary: 'Remove the gray callout' }, ctx(files));
    expect(out.isError).toBeFalsy();
    const p = out.action!;
    expect(p.object).toMatchObject({ id: 'shape58889', name: 'Callout 1' });
    expect(p.elsewhere).toEqual([
      { path: 'a001_three.html', id: 'shape70001' },
      { path: 'a001_two.html', id: 'shape58889' },
    ]);
    expect(out.content).toContain('on 2 other pages');
    expect(hiddenIds(text(files, 'a001_one.html'))).toEqual([]); // nothing done yet

    const here = planAction(files, p, false);
    expect(here.changes.map((c) => c.path)).toEqual(['a001_one.html']);
    expect(hiddenIds(here.changes[0].text)).toEqual(['shape58889']);
    const all = planAction(files, p, true);
    expect(all.changes.map((c) => [c.path, hiddenIds(c.text)])).toEqual([
      ['a001_one.html', ['shape58889']],
      ['a001_three.html', ['shape70001']],
      ['a001_two.html', ['shape58889']],
    ]);
  });

  it('warns before removing a button that moves the learner on', () => {
    const p = proposeAction(course(), 'a001_one.html', { type: 'remove', id: 'button9' }, 'p1', 'Remove Next') as ActionProposal;
    expect(p.warning).toContain('takes the learner to another page');
  });

  it("refuses what can't be done, in words SCORM can pass on", () => {
    expect(proposeAction(course(), 'a001_one.html', { type: 'remove', id: 'shape1' }, 'p1', 's')).toContain("doesn't declare an object shape1");
    expect(proposeAction(course(), 'a001_one.html', { type: 'restore', id: 'shape58889' }, 'p1', 's')).toContain("isn't removed");
    expect(proposeAction(course(), 'a001_one.html', { type: 'move', id: 'shape58889', x: 100, y: 120 }, 'p1', 's')).toContain('already at 100, 120');
  });

  it('restores on the pages where it was removed', () => {
    const files = course();
    const removed = planAction(files, proposeAction(files, 'a001_one.html', { type: 'remove', id: 'shape58889' }, 'p1', 's') as ActionProposal, true);
    const after = { ...files, ...Object.fromEntries(removed.changes.map((c) => [c.path, encodeText(c.text)])) };
    const p = proposeAction(after, 'a001_two.html', { type: 'restore', id: 'shape58889' }, 'p2', 'Bring it back') as ActionProposal;
    expect(p.elsewhere.map((e) => e.path)).toEqual(['a001_one.html', 'a001_three.html']);
    expect(planAction(after, p, true).changes.every((c) => hiddenIds(c.text).length === 0)).toBe(true);
  });

  it('moves the object, and its copies at the same spot when asked', () => {
    const files = course();
    const p = proposeAction(files, 'a001_one.html', { type: 'move', id: 'shape58889', x: 140, y: 90 }, 'p1', 'Move the callout') as ActionProposal;
    expect(p.detail).toContain('from 100, 120 to 140, 90');
    const all = planAction(files, p, true);
    expect(all.changes.map((c) => c.path)).toEqual(['a001_one.html', 'a001_three.html', 'a001_two.html']);
    expect(declaredPosition(all.changes[1].text, 'shape70001')).toEqual({ x: 140, y: 90 });
  });

  it('works from the files as they are when applied: a page changed in between is left alone and counted', () => {
    const files = course();
    const p = proposeAction(files, 'a001_one.html', { type: 'remove', id: 'shape58889' }, 'p1', 's') as ActionProposal;
    // Meanwhile the callout was removed on page two by hand, and page one lost the object altogether.
    const two = planAction(files, { ...p, path: 'a001_two.html', elsewhere: [] }, false).changes[0];
    const later = { ...files, 'a001_two.html': encodeText(two.text) };
    expect(planAction(later, p, true).skipped).toEqual(['a001_two.html']);
    const gone = { ...files, 'a001_one.html': encodeText('<html><body></body></html>') };
    expect(planAction(gone, p, true).problem).toContain('has changed since SCORM looked');
  });

  it('sets Answer required on a question page, or the course default', async () => {
    const quiz = encodeText(text(course(), 'a001_one.html').replace('<title>P</title>', '<title>Quiz</title>').replace('</script></body>', 'var trivQuestionArray=[qu1];\n</script></body>'));
    const files = { ...course(), 'a001_quiz_question_1.html': quiz };
    const out = await runTool('set_answer_required', { path: 'a001_quiz_question_1.html', rule: 'required', summary: 'Require an answer' }, ctx(files));
    const plan = planAction(files, out.action!, false);
    expect(readRule(plan.changes[0].text)).toEqual({ rule: 'required', set: 'page' });
    const all = await runTool('set_answer_required', { path: 'a001_quiz_question_1.html', rule: 'required', all_question_pages: true, summary: 'Require answers everywhere' }, ctx(files));
    expect(all.action!.detail).toContain('course default');
    expect((await runTool('set_answer_required', { path: 'a001_quiz_question_1.html', rule: 'sometimes', summary: 's' }, ctx(files))).isError).toBe(true);
  });
});
