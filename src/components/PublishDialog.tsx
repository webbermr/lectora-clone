import { useEffect, useMemo, useState } from 'react';
import { usePublishReview } from '../lib/publishReview';
import { extname } from '../lib/paths';

const mb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

const GROUPS: { label: string; test: (path: string) => boolean }[] = [
  { label: 'Pages', test: (p) => /^\.x?html?$/.test(extname(p)) },
  { label: 'Images', test: (p) => /^\.(png|jpe?g|gif|svg|webp|bmp|ico)$/.test(extname(p)) },
  { label: 'Audio and video', test: (p) => /^\.(mp3|m4a|wav|ogg|oga|aac|mp4|m4v|webm|ogv|mov|flv|swf)$/.test(extname(p)) },
  { label: 'Other files', test: () => true },
];

/** Before publishing: leave out files nothing in the course uses, or include everything. */
export function PublishDialog() {
  const review = usePublishReview();
  const [leaveOut, setLeaveOut] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    setLeaveOut(new Set(review?.unused.paths ?? []));
    setOpen(null);
  }, [review]);
  const groups = useMemo(() => {
    if (!review) return [];
    const left = new Set(review.unused.paths);
    return GROUPS.map((g) => {
      const paths = [...left].filter(g.test);
      paths.forEach((p) => left.delete(p));
      return { label: g.label, paths };
    }).filter((g) => g.paths.length);
  }, [review]);
  if (!review) return null;

  const saved = [...leaveOut].reduce((n, p) => n + (review.sizes[p] ?? 0), 0);
  const toggle = (paths: string[], on: boolean) =>
    setLeaveOut((cur) => {
      const next = new Set(cur);
      for (const p of paths) {
        if (on) next.add(p);
        else next.delete(p);
      }
      return next;
    });

  return (
    <div className="modal-backdrop">
      <div className="modal publish-dialog" role="dialog" aria-label="Unused files">
        <h3>Leave out unused files?</h3>
        <p>
          {review.unused.paths.length.toLocaleString()} file{review.unused.paths.length === 1 ? '' : 's'} ({mb(review.unused.bytes)} of {mb(review.totalBytes)}){' '}
          {review.unused.paths.length === 1 ? "isn't" : "aren't"} used anywhere in the course: nothing the course launches links to them, shows them or loads them. Leaving them out makes the package smaller.
          Your project keeps them either way.
        </p>
        <p className="small muted">
          Untick anything you want to keep. Pages only reachable from removed links, pictures of deleted objects and leftovers from
          earlier versions usually end up here. The course player's own files are always kept.
        </p>
        <div className="publish-groups">
          {groups.map((g) => {
            const chosen = g.paths.filter((p) => leaveOut.has(p)).length;
            return (
              <div key={g.label} className="publish-group">
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={chosen === g.paths.length}
                    ref={(el) => {
                      if (el) el.indeterminate = chosen > 0 && chosen < g.paths.length;
                    }}
                    onChange={(e) => toggle(g.paths, e.target.checked)}
                  />{' '}
                  <b>{g.label}</b>
                  <span className="muted small">
                    {' '}
                    {g.paths.length} · {mb(g.paths.reduce((n, p) => n + (review.sizes[p] ?? 0), 0))}
                  </span>
                </label>
                <button className="link small" onClick={() => setOpen(open === g.label ? null : g.label)}>
                  {open === g.label ? 'Hide files' : 'Show files'}
                </button>
                {open === g.label && (
                  <ul className="publish-files">
                    {g.paths.map((p) => (
                      <li key={p}>
                        <label className="check-row mono small">
                          <input type="checkbox" checked={leaveOut.has(p)} onChange={(e) => toggle([p], e.target.checked)} /> {p}
                          <span className="muted"> {mb(review.sizes[p] ?? 0)}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
        <div className="row publish-actions">
          <button className="primary" disabled={!leaveOut.size} onClick={() => review.resolve(leaveOut)}>
            Leave out {leaveOut.size.toLocaleString()} file{leaveOut.size === 1 ? '' : 's'} ({mb(saved)}) and publish
          </button>
          <button onClick={() => review.resolve(new Set())}>Include everything and publish</button>
          <button onClick={() => review.resolve(null)}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
