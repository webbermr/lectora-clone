import { useCallback, useEffect, useState } from 'react';
import { checkCourse, type CheckResult } from '../lib/courseCheck';
import { openTests } from '../lib/lectoraTest';
import { store, useStore } from '../lib/store';
import { CheckList } from './CheckList';

/** Sidebar tab: run the course check and list what would break playback. */
export function CourseCheckPanel() {
  const s = useStore();
  const [result, setResult] = useState<CheckResult | null>(null);
  const [ranAt, setRanAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(() => {
    setBusy(true);
    // Let "Checking…" paint first; a big course takes a moment.
    setTimeout(() => {
      const p = store.project!;
      setResult(checkCourse(p.files, p.manifest, openTests(p.files)));
      setRanAt(Date.now());
      setBusy(false);
    }, 30);
  }, []);

  useEffect(run, [run]);
  const stale = ranAt !== null && s.undoStack.length + s.redoStack.length > 0 && result !== null;
  const errors = result?.issues.filter((i) => i.severity === 'error').length ?? 0;
  const warnings = result?.issues.filter((i) => i.severity === 'warning').length ?? 0;

  return (
    <div className="panel-body">
      <div className="mini-toolbar">
        <button className="primary" onClick={run} disabled={busy}>{busy ? 'Checking…' : '⟳ Run course check'}</button>
      </div>
      <p className="hint">
        Looks for anything that would stop the course playing properly: links to pages that aren't there, Next or Back
        buttons that loop, visit tracking that lists missing pages (so the course can't finish), and manifest problems.
      </p>
      {result && (
        <>
          <div className={'check-summary ' + (errors ? 'bad' : 'good')}>
            {errors ? `⛔ ${errors} problem${errors > 1 ? 's' : ''}` : '✓ No problems found'}
            {warnings ? ` · ${warnings} warning${warnings > 1 ? 's' : ''}` : ''}
            <div className="small muted">
              {result.pagesChecked} pages checked
              {result.nextChain ? ` · Next buttons lead through ${result.nextChain.length} pages` : ''}
              {stale ? ' · run again after further edits' : ''}
            </div>
          </div>
          <CheckList issues={result.issues} onFixed={run} />
        </>
      )}
    </div>
  );
}
