import { useEffect, useState } from 'react';
import { task, useTask } from '../lib/task';

function seconds(ms: number): string {
  return ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

/** Progress for importing, opening and publishing courses. */
export function ProgressWindow() {
  const st = useTask();
  const [, tick] = useState(0);
  const running = st?.status === 'running';

  // Keep the elapsed-time readout moving between progress events.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [running]);

  if (!st) return null;
  const elapsed = (st.finishedAt ?? Date.now()) - st.startedAt;
  const counted = st.total > 0;
  const percent = st.status === 'done' ? 100 : st.percent ?? (counted ? (st.done / st.total) * 100 : null);
  // Estimate from the current step only; steps run at very different speeds.
  const stepElapsed = Date.now() - st.stepStartedAt;
  const eta = running && percent !== null && percent > 5 && percent < 100 ? (stepElapsed / percent) * (100 - percent) : null;

  return (
    <div className="modal-backdrop">
      <div className="modal progress-window" role="dialog" aria-label={st.title} aria-live="polite">
        <h3>{st.status === 'done' ? `✓ ${st.doneTitle ?? 'Done'}` : st.status === 'error' ? st.failTitle ?? 'Something went wrong' : st.title}</h3>
        <div className="mono small muted subtitle" title={st.subtitle}>{st.subtitle}</div>

        <ol className="steps">
          {st.steps.map((label, i) => (
            <li key={label} className={i < st.step ? 'done' : i === st.step ? (st.status === 'error' ? 'failed' : 'active') : ''}>
              {label}
            </li>
          ))}
        </ol>

        {st.status !== 'error' && (
          <>
            <div
              className={'bar' + (percent === null ? ' indeterminate' : '') + (st.status === 'done' ? ' complete' : '')}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent === null ? undefined : Math.round(percent)}
            >
              <div className="bar-fill" style={percent === null ? undefined : { width: `${percent}%` }} />
            </div>
            <div className="publish-stats">
              <span>
                {st.status === 'done'
                  ? 'Done'
                  : counted
                    ? `${st.done.toLocaleString()} / ${st.total.toLocaleString()} files${percent !== null ? ` · ${Math.floor(percent)}%` : ''}`
                    : percent !== null
                      ? `${Math.floor(percent)}%`
                      : 'Working…'}
              </span>
              <span>
                {seconds(elapsed)} {st.status === 'done' ? 'total' : 'elapsed'}
                {eta !== null ? ` · about ${seconds(eta)} left` : ''}
              </span>
            </div>
            <div className="publish-current mono small" title={st.current ?? ''}>
              {st.status === 'done' ? st.summary : st.current}
            </div>
            {st.status === 'done' && st.details?.map((d) => <p key={d} className="hint detail">{d}</p>)}
            {st.status === 'running' && st.note && <p className="hint">{st.note}</p>}
          </>
        )}

        {st.status === 'error' && <p className="error">{st.error}</p>}

        <div className="modal-actions">
          <span className="spacer" />
          {st.status === 'done' && st.action && <button onClick={st.action.run}>{st.action.label}</button>}
          <button className={running ? '' : 'primary'} disabled={running} onClick={() => task.close()} autoFocus={!running}>
            {running ? 'Working…' : st.status === 'done' ? st.closeLabel ?? 'Close' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
}
