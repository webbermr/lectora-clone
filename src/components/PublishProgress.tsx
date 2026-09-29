import { useEffect, useState } from 'react';
import { download } from '../lib/actions';
import { publish, usePublish, type PublishStage } from '../lib/publish';

const STEPS: { stage: PublishStage; label: string }[] = [
  { stage: 'preparing', label: 'Gather files' },
  { stage: 'packaging', label: 'Build zip' },
  { stage: 'saving', label: 'Save download' },
];

function mb(n: number): string {
  return n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function seconds(ms: number): string {
  return ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

/** Progress window for Publish SCORM. */
export function PublishProgress() {
  const st = usePublish();
  const [, tick] = useState(0);
  const running = !!st && st.stage !== 'done' && st.stage !== 'error';

  // Keep the elapsed-time readout moving even between progress events.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [running]);

  if (!st) return null;
  const elapsed = (st.finishedAt ?? Date.now()) - st.startedAt;
  const stepIndex = st.stage === 'done' ? STEPS.length : STEPS.findIndex((s) => s.stage === st.stage);
  // Rough time left from progress so far; only once there's enough to go on.
  const eta = running && st.percent > 5 && st.percent < 100 ? (elapsed / st.percent) * (100 - st.percent) : null;

  return (
    <div className="modal-backdrop">
      <div className="modal publish" role="dialog" aria-label="Publishing SCORM package" aria-live="polite">
        <h3>
          {st.stage === 'done' ? '✓ Published' : st.stage === 'error' ? 'Publishing failed' : 'Publishing SCORM package…'}
        </h3>
        <div className="mono small muted">{st.fileName}</div>

        <ol className="steps">
          {STEPS.map((s, i) => (
            <li key={s.stage} className={i < stepIndex ? 'done' : i === stepIndex && st.stage !== 'error' ? 'active' : st.stage === 'error' && i === Math.max(0, stepIndex) ? 'failed' : ''}>
              {s.label}
            </li>
          ))}
        </ol>

        {st.stage !== 'error' && (
          <>
            <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(st.percent)}>
              <div className="bar-fill" style={{ width: `${st.percent}%` }} />
            </div>
            <div className="publish-stats">
              <span>
                {st.filesDone.toLocaleString()} / {st.filesTotal.toLocaleString()} files · {Math.floor(st.percent)}%
              </span>
              <span>
                {seconds(elapsed)} elapsed{eta !== null ? ` · about ${seconds(eta)} left` : ''}
              </span>
            </div>
            <div className="publish-current mono small" title={st.currentFile ?? ''}>
              {st.stage === 'preparing' && `Gathering ${st.filesTotal.toLocaleString()} files (${mb(st.bytesTotal)})…`}
              {st.stage === 'packaging' && (st.currentFile ? `Adding ${st.currentFile}` : 'Starting…')}
              {st.stage === 'saving' && 'Handing the file to your browser…'}
              {st.stage === 'done' && `${mb(st.zipSize ?? 0)} zip · ${st.filesTotal.toLocaleString()} files in ${seconds(elapsed)}`}
            </div>
            <p className="hint">
              {st.storedCount.toLocaleString()} images, audio and video files are copied as-is, since they're already
              compressed; only text files (HTML, JS, CSS, XML) are compressed.
            </p>
          </>
        )}

        {st.stage === 'error' && <p className="error">{st.error}</p>}

        <div className="modal-actions">
          <span className="spacer" />
          {st.stage === 'done' && st.blob && (
            <button onClick={() => download(st.blob!, st.fileName)} title="If the download didn't start, save it again">
              Download again
            </button>
          )}
          <button className={running ? '' : 'primary'} disabled={running} onClick={() => publish.close()}>
            {running ? 'Working…' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
}
