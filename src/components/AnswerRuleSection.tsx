import { useEffect, useMemo, useState } from 'react';
import { textOf } from '../lib/assetRefs';
import { applyDefault, courseDefault, outdatedRules, questionPages, readRule, setRule, type AnswerRule } from '../lib/answerRule';
import { nextButtons } from '../lib/courseRules';
import { isHtmlFile } from '../lib/paths';
import { store, useStore } from '../lib/store';
import { encodeText } from '../lib/text';

type Choice = 'default' | AnswerRule;

interface GuardInfo {
  page?: string;
  watching?: string[];
  varFound?: boolean;
  holding?: 'submit' | 'next';
  state?: 'waiting' | 'answered' | 'left';
}

/** What the answer guard on the page on screen is doing (null: no guard running there), checked every second. */
function useGuardOnScreen(active: boolean): GuardInfo | null | undefined {
  const [info, setInfo] = useState<GuardInfo | null | undefined>(undefined);
  useEffect(() => {
    if (!active) return;
    const read = () => {
      const look = (w: Window | null, depth: number): GuardInfo | null => {
        if (!w) return null;
        try {
          const g = (w as unknown as { __lcAnswerGuardInfo?: GuardInfo; pgID?: string }).__lcAnswerGuardInfo;
          const pg = (w as unknown as { pgID?: string }).pgID;
          if (g && (g.page === undefined || g.page === pg)) return { ...g };
        } catch {
          return null; // another origin
        }
        if (depth > 0) for (let i = 0; i < w.frames.length; i++) { const g = look(w.frames[i], depth - 1); if (g) return g; }
        return null;
      };
      const frame = document.querySelector<HTMLIFrameElement>('iframe.stage-iframe');
      setInfo(frame ? look(frame.contentWindow, 2) : undefined);
    };
    read();
    const t = setInterval(read, 1000);
    return () => clearInterval(t);
  }, [active]);
  return active ? info : undefined;
}

/** Properties section: must the learner answer this page's question before Next appears? */
export function AnswerRuleSection({ page }: { page: string | null }) {
  const s = useStore();
  const files = s.project?.files;
  const [busy, setBusy] = useState(false);
  const info = useMemo(() => {
    if (!files || !page || !files[page] || !isHtmlFile(page)) return null;
    const html = textOf(files[page]);
    if (!html.includes('new Obj')) return null; // not a Lectora page
    return {
      question: questionPages(files).get(page) ?? null,
      next: nextButtons(files, page),
      rule: readRule(html),
      def: courseDefault(files),
      count: questionPages(files).size,
      outdated: outdatedRules(files),
    };
  }, [files, page]);
  const onScreen = useGuardOnScreen(!!info && (info.rule?.rule ?? (info.question ? info.def : 'optional')) === 'required');
  if (!info || !page || !files) return null;

  const choice: Choice = !info.rule || info.rule.set === 'default' ? 'default' : info.rule.rule;
  const effective: AnswerRule = info.rule?.rule ?? (info.question ? info.def : 'optional');

  const choose = async (c: Choice) => {
    if (c === choice) return;
    const rule = c === 'default' ? (info.question && info.def === 'required' ? { rule: 'required' as const, set: 'default' as const } : null) : { rule: c, set: 'page' as const };
    const next = setRule(files, page, rule);
    if (next === null) {
      store.setStatus("No Next button was found on this page, so there's nothing to hide until it's answered.");
      return;
    }
    await store.write(c === 'required' ? 'Require an answer on this page' : c === 'optional' ? "Don't require an answer on this page" : 'Use the course default for answers', [{ path: page, bytes: encodeText(next) }]);
    store.setStatus(`${c === 'default' ? 'This page follows the course default' : c === 'required' ? 'An answer is required on this page' : 'An answer is not required on this page'}. Reload the page to see it.`);
  };

  const refresh = async () => {
    setBusy(true);
    const n = info.outdated.length;
    await store.write('Update the answer check', info.outdated.map((c) => ({ path: c.path, bytes: encodeText(c.text) })));
    setBusy(false);
    store.setStatus(`Updated the answer check on ${n} page${n === 1 ? '' : 's'}. Reload the page to use it.`);
  };

  const setDefault = async (rule: AnswerRule) => {
    if (rule === info.def) return;
    setBusy(true);
    const { changes, skipped } = applyDefault(files, rule);
    const pages = changes.filter((c) => c.path !== 'imsmanifest.xml').length;
    await store.write(rule === 'required' ? 'Require answers on question pages' : "Don't require answers on question pages", changes.map((c) => ({ path: c.path, bytes: encodeText(c.text) })));
    setBusy(false);
    store.setStatus(
      `Course default: answers ${rule === 'required' ? 'required' : 'not required'} (${pages} page${pages === 1 ? '' : 's'} updated${skipped.length ? `; ${skipped.length} without a Next button left as they are` : ''}). Undo with Ctrl+Z (⌘Z).`,
    );
  };

  // Quiz pages often have Submit (it scores the answer and moves on) instead of Next.
  const moveOn = info.next.length && info.next.every((n) => /submit/i.test(n.label)) ? 'Submit' : 'Next';

  return (
    <details className="section answer-rule" open={!!info.question || !!info.rule}>
      <summary>Answer required?</summary>
      <div className="stack">
        <p className="small">
          {info.question ? (
            <>
              <b>{info.question.label}.</b>{' '}
            </>
          ) : (
            <>This page isn't recognised as a question page. </>
          )}
          {info.next.length ? (
            <>Button that moves on: {info.next.map((n) => n.label).join(', ')}.</>
          ) : (
            <span className="warn-text">No Next or Submit button found on this page.</span>
          )}
        </p>
        <label className="check-row">
          <input type="radio" checked={choice === 'default'} onChange={() => void choose('default')} /> Course default
          <span className="muted small"> ({info.question ? (info.def === 'required' ? 'required' : 'not required') : 'applies to question pages only'})</span>
        </label>
        <label className="check-row">
          <input type="radio" checked={choice === 'required'} disabled={!info.next.length} onChange={() => void choose('required')} /> Required: {moveOn === 'Submit' ? 'Submit does nothing' : 'Next stays hidden'} until answered
        </label>
        <label className="check-row">
          <input type="radio" checked={choice === 'optional'} onChange={() => void choose('optional')} /> Not required
        </label>
        <p className="hint">
          Now: {effective === 'required' ? `the learner must answer before ${moveOn === 'Submit' ? 'Submit works' : 'Next appears'}, and the page won't move on by itself until then` : "the editor doesn't add a requirement (the course's own behaviour applies)"}.
          Back and the table of contents aren't affected.
        </p>
        {info.outdated.length > 0 && (
          <div className="stack">
            <p className="small warn-text">
              {info.outdated.some((c) => c.path === page) ? 'This page has' : `${info.outdated.length} page${info.outdated.length === 1 ? ' has' : 's have'}`} an older version of the answer
              check, from before the editor was updated.
            </p>
            <button disabled={busy} onClick={() => void refresh()}>
              Update the check on {info.outdated.length} page{info.outdated.length === 1 ? '' : 's'}
            </button>
          </div>
        )}
        {effective === 'required' && onScreen !== undefined && (
          <p className={`small ${onScreen && onScreen.state !== 'answered' ? '' : 'warn-text'}`}>
            On screen now:{' '}
            {!onScreen
              ? 'the check isn\'t running on this page. Reload the page to start it; if it still doesn\'t run, tell us.'
              : onScreen.state === 'answered'
                ? `counted as answered, so ${onScreen.holding === 'submit' ? 'Submit works' : 'Next is shown'}. Reload the page to start over.`
                : `waiting for an answer${onScreen.watching?.length ? (onScreen.varFound === false ? ` (the answer variable ${onScreen.watching.join(', ')} isn't on the page, so a picked choice counts)` : ` (watching ${onScreen.watching.join(', ')})`) : ' (a picked choice or typed answer counts)'}.`}
          </p>
        )}
        <div className="course-default">
          <span className="small">Course default for all {info.count} question page{info.count === 1 ? '' : 's'}:</span>
          <select value={info.def} disabled={busy || !info.count} onChange={(e) => void setDefault(e.target.value as AnswerRule)}>
            <option value="optional">Not required</option>
            <option value="required">Required</option>
          </select>
        </div>
      </div>
    </details>
  );
}
