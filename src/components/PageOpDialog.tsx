import { pageOpFlow, usePageOpFlow } from '../lib/pageOpFlow';
import type { Destination } from '../lib/pageOps';
import { basename } from '../lib/paths';
import { CheckList } from './CheckList';

/** Destination pages grouped under their chapters, in course order. */
function byChapter(spots: Destination[]): { chapter: string; pages: Destination[] }[] {
  const out: { chapter: string; pages: Destination[] }[] = [];
  for (const s of spots) {
    const last = out.at(-1);
    if (last && last.chapter === s.chapter) last.pages.push(s);
    else out.push({ chapter: s.chapter, pages: [s] });
  }
  return out;
}

/** Pick where a page goes, review everything that changes, apply it, then show the course check. */
export function PageOpDialog() {
  const st = usePageOpFlow();
  if (!st) return null;
  const { plan } = st;
  const moving = st.kind === 'move';
  const side = 'after' in st.pos ? 'after' : 'before';
  const anchor = 'after' in st.pos ? st.pos.after : st.pos.before;
  const title = st.spots.find((s) => s.path === st.page)?.title ?? basename(st.page);
  const errors = st.check?.issues.filter((i) => i.severity === 'error') ?? [];

  return (
    <div className="modal-backdrop">
      <div className="modal delete-dialog" role="dialog" aria-label={plan.label}>
        <h3>{st.stage === 'done' ? `✓ ${moving ? 'Moved' : 'Copied'} "${title}"` : st.stage === 'error' ? `${moving ? 'Move' : 'Copy'} failed` : plan.label}</h3>

        {st.stage === 'review' && (
          <div className="page-op-spot">
            <span>{moving ? 'Move it' : 'Put the copy'}</span>
            <select value={side} onChange={(e) => pageOpFlow.setPosition(e.target.value === 'after' ? { after: anchor } : { before: anchor })} aria-label="Before or after">
              <option value="after">after</option>
              <option value="before">before</option>
            </select>
            <select
              value={anchor}
              onChange={(e) => pageOpFlow.setPosition(side === 'after' ? { after: e.target.value } : { before: e.target.value })}
              aria-label="Page"
            >
              {byChapter(st.spots).map((g, i) => (
                <optgroup key={g.chapter + i} label={g.chapter}>
                  {g.pages.map((p) => (
                    <option key={p.path} value={p.path}>
                      {p.title}
                      {p.path === st.page ? ' (this page)' : ''}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        )}

        {st.stage === 'applying' && <p className="muted">Updating pages, links, tracking, the table of contents and the manifest…</p>}
        {st.stage === 'error' && <p className="error">{st.error}</p>}

        {plan.blocked && st.stage === 'review' && (
          <div className="blocked">
            <b>{moving ? "It can't go there." : "This can't be copied there."}</b>
            <p>{plan.blocked}</p>
          </div>
        )}

        {!plan.blocked && st.stage === 'review' && (
          <div className="plan">
            <section>
              <h4>What changes</h4>
              <ul className="plain-list small">
                {plan.summary.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
              <details>
                <summary className="small">{plan.edits.size + (plan.renamed ? 1 : 0)} files touched</summary>
                <ul className="plain-list mono small">
                  {[...plan.edits.keys()].sort().map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                  {plan.renamed && <li>{plan.renamed.from} (removed, renamed)</li>}
                </ul>
              </details>
            </section>
            {plan.warnings.length > 0 && (
              <section className="warnings">
                <h4>⚠ Check afterwards</h4>
                <ul className="plain-list small">
                  {plan.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </section>
            )}
            <p className="small muted">You can undo this with Ctrl+Z (⌘Z) until you close the project.</p>
          </div>
        )}

        {st.stage === 'done' && st.check && (
          <div className="plan">
            <div className={'check-summary ' + (errors.length ? 'bad' : 'good')}>
              {errors.length ? `⛔ Course check found ${errors.length} problem${errors.length > 1 ? 's' : ''}` : '✓ Course check passed: no broken links, loops or missing tracked pages'}
              {st.check.nextChain && <div className="small muted">Next buttons lead through {st.check.nextChain.length} pages.</div>}
            </div>
            <CheckList issues={st.check.issues.filter((i) => i.severity !== 'info')} onOpen={() => pageOpFlow.close()} onFixed={() => pageOpFlow.recheck()} />
          </div>
        )}

        <div className="modal-actions">
          <span className="spacer" />
          {st.stage === 'review' ? (
            <>
              <button onClick={() => pageOpFlow.close()}>Cancel</button>
              <button className="primary" disabled={!!plan.blocked} onClick={() => void pageOpFlow.confirm()}>
                {moving ? 'Move page' : 'Copy page'}
              </button>
            </>
          ) : (
            <button className="primary" disabled={st.stage === 'applying'} onClick={() => pageOpFlow.close()} autoFocus>
              {st.stage === 'applying' ? 'Working…' : 'Close'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
