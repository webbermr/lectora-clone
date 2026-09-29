import { deleteFlow, useDeleteFlow } from '../lib/deleteFlow';
import { basename } from '../lib/paths';
import { CheckList } from './CheckList';

function List({ items, max = 8 }: { items: string[]; max?: number }) {
  return (
    <ul className="plain-list mono small">
      {items.slice(0, max).map((i) => (
        <li key={i}>{i}</li>
      ))}
      {items.length > max && <li className="muted">…and {items.length - max} more</li>}
    </ul>
  );
}

/** Review what a delete will change, apply it, then show the course check. */
export function DeleteDialog() {
  const st = useDeleteFlow();
  if (!st) return null;
  const { plan } = st;
  const busy = st.stage === 'planning' || st.stage === 'applying';
  const rewired = plan?.rewires.reduce((n, r) => n + r.count, 0) ?? 0;
  const rewiredFiles = plan ? [...new Set(plan.rewires.map((r) => r.file))] : [];
  const errors = st.check?.issues.filter((i) => i.severity === 'error') ?? [];

  return (
    <div className="modal-backdrop">
      <div className="modal delete-dialog" role="dialog" aria-label={st.label}>
        <h3>
          {st.stage === 'done' ? '✓ Deleted' : st.stage === 'error' ? 'Delete failed' : st.label}
        </h3>

        {st.stage === 'planning' && <p className="muted">Working out everything this touches…</p>}
        {st.stage === 'applying' && <p className="muted">Deleting and updating links, tracking and the manifest…</p>}
        {st.stage === 'error' && <p className="error">{st.error}</p>}

        {plan?.blocked && (
          <div className="blocked">
            <b>This can't be deleted safely yet.</b>
            <p>{plan.blocked}</p>
          </div>
        )}

        {plan && !plan.blocked && st.stage === 'review' && (
          <div className="plan">
            {plan.hubs.length > 0 && (
              <section className="hub">
                <h4>⚠ You're deleting a main page of the course</h4>
                <ul className="plain-list small">
                  {plan.hubs.map((h) => (
                    <li key={h.page}>
                      <b className="mono">{basename(h.page)}</b>
                      {h.start ? ' is where the course opens' : ''}
                      {h.start && h.linkedFrom ? ', and ' : ''}
                      {h.linkedFrom ? `${h.linkedFrom} page${h.linkedFrom === 1 ? ' links' : 's link'} to it (for example a Home or Dashboard button)` : ''}.
                    </li>
                  ))}
                </ul>
                <p className="small">
                  Pages like a dashboard often hold course progress, resume and exam status. Make sure you mean to remove it.
                </p>
              </section>
            )}
            {plan.pages.length > 0 && (
              <section>
                <h4>🗑 {plan.pages.length} page{plan.pages.length === 1 ? '' : 's'} removed</h4>
                <List items={plan.pages} />
              </section>
            )}
            {plan.otherFiles.length > 0 && (
              <section>
                <h4>📄 {plan.otherFiles.length} other file{plan.otherFiles.length === 1 ? '' : 's'} removed</h4>
                <ul className="plain-list mono small">
                  {plan.otherFiles.slice(0, 10).map((o) => (
                    <li key={o.path}>
                      {o.path}
                      {o.usedBy.length ? <span className="warn-text"> · still used by {o.usedBy.length} file{o.usedBy.length === 1 ? '' : 's'} ({o.usedBy.slice(0, 2).map(basename).join(', ')})</span> : <span className="muted"> · not used anywhere</span>}
                    </li>
                  ))}
                  {plan.otherFiles.length > 10 && <li className="muted">…and {plan.otherFiles.length - 10} more</li>}
                </ul>
              </section>
            )}
            {plan.unresolved.length > 0 && (
              <section className="hub">
                <h4>🔗 {plan.unresolved.length} link{plan.unresolved.length === 1 ? ' has' : 's have'} nowhere to go</h4>
                <p className="small">
                  There's no page left on the right side of the gap for {plan.unresolved.length === 1 ? 'this link' : 'these links'} (usually a
                  button that goes back to the deleted page from the page right after it). They'll be left as they are and shown as
                  broken links; after deleting, use <b>Fix</b> in the course check to choose where they should go, or cancel and keep the page.
                </p>
                <ul className="plain-list mono small">
                  {plan.unresolved.slice(0, 8).map((u) => (
                    <li key={u.file + u.link}>
                      {basename(u.file)} → {u.link}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <section>
              <h4>🖼 {plan.assets.length} image/audio file{plan.assets.length === 1 ? '' : 's'} removed</h4>
              {plan.assets.length ? (
                <>
                  <p className="small muted">Only the deleted pages use these. Anything another page still uses is kept.</p>
                  <List items={plan.assets} max={5} />
                </>
              ) : (
                <p className="small muted">None; everything these pages use is shared with other pages.</p>
              )}
            </section>
            <section>
              <h4>🔗 {rewired} link{rewired === 1 ? '' : 's'} rewired in {rewiredFiles.length} file{rewiredFiles.length === 1 ? '' : 's'}</h4>
              <p className="small muted">
                Next, Back, menu and jump links that pointed at a deleted page now skip over the gap: forward links go to the
                next remaining page, backward links to the previous one. No page is ever pointed at itself.
              </p>
              {plan.rewires.length > 0 && (
                <details>
                  <summary className="small">Show changes</summary>
                  <ul className="plain-list mono small">
                    {plan.rewires.slice(0, 40).map((r, i) => (
                      <li key={i}>
                        {basename(r.file)}: {r.from} → <b>{r.to}</b>
                        {r.count > 1 ? ` (×${r.count})` : ''}
                      </li>
                    ))}
                    {plan.rewires.length > 40 && <li className="muted">…and {plan.rewires.length - 40} more</li>}
                  </ul>
                </details>
              )}
            </section>
            {plan.progressTotals.length > 0 && (
              <section className="finishable">
                <h4>📈 Course progress total lowered</h4>
                <ul className="plain-list small">
                  {plan.progressTotals.map((t) => (
                    <li key={t.total}>
                      <span className="mono">{t.total}</span>: {t.before} → <b>{t.after}</b>. The deleted pages each counted toward{' '}
                      <span className="mono">{t.counter}</span>, so without this, progress could never reach 100%.
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {plan.tests.length > 0 && (
              <section className="finishable">
                <h4>📝 Test updated (and re-encrypted)</h4>
                <ul className="plain-list small">
                  {plan.tests.map((t) => (
                    <li key={t.file}>
                      {t.questionsRemoved} question{t.questionsRemoved === 1 ? '' : 's'} removed from the test
                      {t.sectionsRemoved.length ? `; ${t.sectionsRemoved.length} section${t.sectionsRemoved.length > 1 ? 's' : ''} removed (no questions left)` : ''}.
                      {t.numrandom.map((n) => (
                        <div key={n.section}>A section that drew {n.before} random questions now draws {n.after}, all it has left.</div>
                      ))}
                      {t.relinked.map((r) => (
                        <div key={r.setting}>
                          The test's {{ passdone: 'pass', cancelfail: 'fail', prevpage: 'back' }[r.setting] ?? r.setting} page was deleted; it now goes to{' '}
                          <span className="mono">{r.to}</span>.
                        </div>
                      ))}
                      <div>
                        Questions per attempt: {t.drawn.before} → <b>{t.drawn.after}</b>. The file stays encrypted, so learners still can't read the answers.
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {plan.toc.length > 0 && (
              <section>
                <h4>📑 Table of contents updated</h4>
                <ul className="plain-list small">
                  {plan.toc.map((t) => (
                    <li key={t.file}>
                      {t.entriesRemoved} entr{t.entriesRemoved === 1 ? 'y' : 'ies'} removed
                      {t.chaptersRemoved.length ? `; chapter${t.chaptersRemoved.length > 1 ? 's' : ''} ${t.chaptersRemoved.map((c) => `“${c}”`).join(', ')} removed (no pages left)` : ''}
                      {t.relinked.length ? `; ${t.relinked.map((c) => `“${c}”`).join(', ')} now open${t.relinked.length === 1 ? 's' : ''} at its first remaining page` : ''}
                      <span className="muted mono"> ({basename(t.file)})</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <section>
              <h4>📋 Tracking &amp; manifest updated</h4>
              <ul className="plain-list small">
                <li>{plan.trackingNodesRemoved} page{plan.trackingNodesRemoved === 1 ? '' : 's'} removed from visit tracking, so "visit every page" can still reach 100%.</li>
                {plan.numPages && <li>Lectora's page count: {plan.numPages.before} → {plan.numPages.after}</li>}
                <li>Their manifest entries and references are removed.</li>
              </ul>
            </section>
            <section className={plan.satisfied.length ? 'finishable' : ''}>
              <h4>🔓 Keep the course finishable</h4>
              <label className="check small">
                <input type="checkbox" checked={st.keepFinishable} onChange={(e) => deleteFlow.setKeepFinishable(e.target.checked)} />
                Treat deleted content as done, so nothing waits for it
              </label>
              {plan.satisfied.length > 0 ? (
                <>
                  <p className="small muted">
                    These flags were only set on the deleted pages, but other pages still check them before unlocking
                    things like the final assessment. Those checks will now answer as if the deleted pages had run:
                  </p>
                  <ul className="plain-list mono small">
                    {plan.satisfied.map((v) => (
                      <li key={v.name}>
                        {v.name} counts as '{v.value}' on {v.files.map(basename).join(', ')}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="small muted">
                  {st.keepFinishable ? 'Nothing needed: no remaining page waits on anything only the deleted pages did.' : 'Off: any lock-ups are listed below.'}
                </p>
              )}
            </section>
            {plan.warnings.length > 0 && (
              <section className="warnings">
                <h4>⚠ Check before deleting</h4>
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
            <CheckList issues={st.check.issues.filter((i) => i.severity !== 'info')} onOpen={() => deleteFlow.close()} onFixed={() => deleteFlow.recheck()} />
            <p className="small muted">
              Removed {plan?.pages.length} pages and {(plan?.assets.length ?? 0) + (plan?.otherFiles.length ?? 0)} files. Undo with Ctrl+Z (⌘Z) if needed.
            </p>
          </div>
        )}

        <div className="modal-actions">
          <span className="spacer" />
          {st.stage === 'review' && !plan?.blocked ? (
            <>
              <button onClick={() => deleteFlow.close()}>Cancel</button>
              <button className="danger" onClick={() => void deleteFlow.confirm()}>
                Delete {plan!.pages.length + plan!.otherFiles.length} {plan!.otherFiles.length ? 'file' : 'page'}
                {plan!.pages.length + plan!.otherFiles.length === 1 ? '' : 's'}
              </button>
            </>
          ) : (
            <button className="primary" disabled={busy} onClick={() => deleteFlow.close()} autoFocus>
              {busy ? 'Working…' : 'Close'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
