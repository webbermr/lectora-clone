import { useState } from 'react';
import { useChoice, type ChoiceRequest } from '../lib/dialog';

export function MatchChooser() {
  const req = useChoice();
  if (!req) return null;
  return <Dialog key={req.title + req.matches.length} req={req} />;
}

function Dialog({ req }: { req: ChoiceRequest }) {
  const [picked, setPicked] = useState(() => new Set(req.preselected));
  const toggle = (i: number) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <div className="modal-backdrop" onKeyDown={(e) => e.key === 'Escape' && req.resolve(null)}>
      <div className="modal" role="dialog" aria-label={req.title}>
        <h3>{req.title}</h3>
        <p className="muted small">
          Pick which ones to change to <b>“{req.newText.slice(0, 80)}”</b>. Matches in the page you're on are ticked.
        </p>
        <ul className="match-list">
          {req.matches.map((m, i) => (
            <li key={i}>
              <label>
                <input type="checkbox" checked={picked.has(i)} onChange={() => toggle(i)} />
                <span className="mono small">
                  <b>{m.path}</b>
                  <br />
                  <span className="ctx">…{m.before}</span>
                  <mark>{m.matched}</mark>
                  <span className="ctx">{m.after}…</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        <div className="modal-actions">
          <button onClick={() => setPicked(new Set(req.matches.map((_, i) => i)))}>Select all</button>
          <span className="spacer" />
          <button onClick={() => req.resolve(null)}>Cancel</button>
          <button className="primary" disabled={!picked.size} onClick={() => req.resolve(req.matches.filter((_, i) => picked.has(i)))}>
            Change {picked.size}
          </button>
        </div>
      </div>
    </div>
  );
}
