/**
 * Editor actions SCORM can offer to carry out: removing (hiding) or restoring an object, moving one, and
 * setting "Answer required?". Like text edits they are only proposed; the person picks this page or every
 * page with the same object, and the editor does exactly what its own Remove / Restore / Move / Answer
 * required controls do, as one undoable step. Each plan is worked out again from the files as they are when
 * the person clicks, so a page changed in between is never overwritten blindly.
 */
import { textOf } from '../assetRefs';
import { applyDefault, courseDefault, questionPages, setRule, type AnswerRule } from '../answerRule';
import { declaredPosition, moveInSource } from '../moveObjects';
import { sameObjectEverywhere } from '../objectTwins';
import type { FileMap } from '../package';
import { isHtmlFile } from '../paths';
import { declaredObjects, hiddenIds, navigatesAway, setHidden } from '../removeObjects';

export type ObjectAction =
  | { type: 'remove'; id: string }
  | { type: 'restore'; id: string }
  | { type: 'move'; id: string; x: number; y: number }
  | { type: 'answer_rule'; rule: AnswerRule | 'default' }
  | { type: 'answer_default'; rule: AnswerRule };

export interface ActionProposal {
  id: string;
  summary: string;
  /** The page the action is proposed on. */
  path: string;
  action: ObjectAction;
  /** The object on the page, when the action is about one. */
  object?: { id: string; name: string; kind: string };
  /** Other pages with the same object (its id there, which can differ for a chapter's own copy). */
  elsewhere: { path: string; id: string }[];
  /** Something the person should know before applying. */
  warning?: string;
  /** What will happen, in a line. */
  detail: string;
}

export interface ActionPlan {
  changes: { path: string; text: string }[];
  /** Pages left alone because they changed since SCORM looked. */
  skipped: string[];
  problem?: string;
}

const label = (o: { id: string; name: string }) => (o.name ? `"${o.name}" (${o.id})` : o.id);

/** The object as the page declares it, or a reason it can't be used. */
function objectOn(files: FileMap, path: string, id: string): { id: string; name: string; kind: string } | string {
  if (!files[path] || !isHtmlFile(path)) return `${path} isn't an HTML page in the package.`;
  const o = declaredObjects(textOf(files[path])).get(id);
  return o ? { id, name: o.name, kind: o.kind } : `${path} doesn't declare an object ${id}. page_overview lists the objects it has.`;
}

/** Work out a proposal (or why it can't be made). */
export function proposeAction(files: FileMap, path: string, action: ObjectAction, id: string, summary: string): ActionProposal | string {
  if (action.type === 'answer_default') {
    const n = questionPages(files).size;
    if (!n) return 'No question pages were found in this course.';
    return { id, summary, path, action, elsewhere: [], detail: `Sets the course default for "Answer required?" to ${action.rule === 'required' ? 'Required' : 'Not required'} on the ${n} question page${n === 1 ? '' : 's'} that don't have their own setting.` };
  }
  if (action.type === 'answer_rule') {
    if (!files[path] || !isHtmlFile(path)) return `${path} isn't an HTML page in the package.`;
    if (action.rule === 'required' && setRule(files, path, { rule: 'required', set: 'page' }) === null) return `${path} has no Next or Submit button to hold back, so an answer can't be required there.`;
    const what = action.rule === 'required' ? 'Required: the learner must answer before moving on' : action.rule === 'optional' ? 'Not required' : 'the course default';
    return { id, summary, path, action, elsewhere: [], detail: `Sets "Answer required?" on this page to ${what}.` };
  }
  const o = objectOn(files, path, action.id);
  if (typeof o === 'string') return o;
  const html = textOf(files[path]);
  const twins = sameObjectEverywhere(files, path, action.id).filter((r) => r.page !== path);
  if (action.type === 'remove') {
    if (hiddenIds(html).includes(action.id)) return `${label(o)} is already removed on ${path}.`;
    const elsewhere = twins.filter((r) => !hiddenIds(textOf(files[r.page])).includes(r.id)).map((r) => ({ path: r.page, id: r.id }));
    const warning = navigatesAway(html, action.id) ? 'This button takes the learner to another page (Next, Back or a menu). Without it they may have no way on.' : undefined;
    return { id, summary, path, action, object: o, elsewhere, warning, detail: `Hides ${label(o)}, the way Remove in Live edit does. Page scripts keep working, and it can be restored.` };
  }
  if (action.type === 'restore') {
    if (!hiddenIds(html).includes(action.id)) return `${label(o)} isn't removed on ${path}.`;
    const elsewhere = twins.filter((r) => hiddenIds(textOf(files[r.page])).includes(r.id)).map((r) => ({ path: r.page, id: r.id }));
    return { id, summary, path, action, object: o, elsewhere, detail: `Shows ${label(o)} again.` };
  }
  // Move: the copies at the same spot move with it, as dragging in Live edit does.
  const from = declaredPosition(html, action.id);
  if (!from) return `${path} doesn't give ${action.id} a position the editor can change.`;
  if (!Number.isFinite(action.x) || !Number.isFinite(action.y)) return 'x and y must be numbers.';
  if (from.x === Math.round(action.x) && from.y === Math.round(action.y)) return `${label(o)} is already at ${from.x}, ${from.y}.`;
  const elsewhere = twins
    .filter((r) => {
      const at = declaredPosition(textOf(files[r.page]), r.id);
      return at && at.x === from.x && at.y === from.y;
    })
    .map((r) => ({ path: r.page, id: r.id }));
  return { id, summary, path, action, object: o, elsewhere, detail: `Moves ${label(o)} from ${from.x}, ${from.y} to ${Math.round(action.x)}, ${Math.round(action.y)} (left, top in pixels).` };
}

/** The file changes for a proposal, from the files as they are now: on its page, or there and everywhere else. */
export function planAction(files: FileMap, p: ActionProposal, everywhere: boolean): ActionPlan {
  const a = p.action;
  if (a.type === 'answer_default') {
    const { changes } = applyDefault(files, a.rule);
    return { changes, skipped: [] };
  }
  if (!files[p.path]) return { changes: [], skipped: [], problem: `${p.path} isn't in the package any more.` };
  if (a.type === 'answer_rule') {
    // "Course default": the page follows the course's setting, as choosing Course default in Properties does.
    const rule =
      a.rule === 'default'
        ? questionPages(files).has(p.path) && courseDefault(files) === 'required'
          ? { rule: 'required' as const, set: 'default' as const }
          : null
        : { rule: a.rule, set: 'page' as const };
    const text = setRule(files, p.path, rule);
    if (text === null) return { changes: [], skipped: [], problem: `${p.path} has no Next or Submit button to hold back.` };
    return { changes: text === textOf(files[p.path]) ? [] : [{ path: p.path, text }], skipped: [] };
  }
  const targets = [{ path: p.path, id: a.id }, ...(everywhere ? p.elsewhere : [])];
  const changes: ActionPlan['changes'] = [];
  const skipped: string[] = [];
  let problem: string | undefined;
  targets.forEach((t, i) => {
    const html = files[t.path] ? textOf(files[t.path]) : null;
    let next: string | null = null;
    if (html !== null && declaredObjects(html).has(t.id)) {
      const hidden = hiddenIds(html);
      if (a.type === 'remove' && !hidden.includes(t.id)) next = setHidden(html, [...hidden, t.id]);
      else if (a.type === 'restore' && hidden.includes(t.id)) next = setHidden(html, hidden.filter((x) => x !== t.id));
      else if (a.type === 'move') {
        const moved = moveInSource(html, t.id, { x: a.x, y: a.y });
        if (moved !== html) next = moved;
      }
    }
    if (next !== null && next !== html) changes.push({ path: t.path, text: next });
    else if (i === 0) problem = `${p.path} has changed since SCORM looked, so this no longer applies there.`;
    else skipped.push(t.path);
  });
  return problem ? { changes: [], skipped: [], problem } : { changes, skipped };
}
