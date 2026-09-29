import { useEffect, useState } from 'react';
import { isTextFile } from '../lib/paths';
import { store, useStore } from '../lib/store';

/** Plain source editor for any text file in the package (HTML, CSS, JS, XML, JSON). */
export function CodeView() {
  const s = useStore();
  const path = s.currentPath;
  const revision = path ? s.revisions[path] ?? 0 : 0;
  const saved = path ? store.readText(path) ?? '' : '';
  const [draft, setDraft] = useState(saved);

  // Reload when switching files or when the file changes elsewhere (stage edits, undo).
  useEffect(() => {
    setDraft(saved);
  }, [path, revision, saved]);

  if (!path) return <div className="stage-empty">Select a file to view its source.</div>;
  if (!isTextFile(path)) return <div className="stage-empty">{path} is a binary file and can't be edited as text.</div>;

  const dirty = draft !== saved;
  const apply = () => void store.writeText(`Edit source of ${path}`, path, draft);

  return (
    <div className="code-view">
      <div className="code-bar">
        <span className="mono">{path}</span>
        <span className="spacer" />
        {dirty && <span className="muted">Unapplied changes</span>}
        <button onClick={() => setDraft(saved)} disabled={!dirty}>Revert</button>
        <button className="primary" onClick={apply} disabled={!dirty}>Apply (Ctrl+S)</button>
      </div>
      <textarea
        className="code-text"
        spellCheck={false}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
            e.preventDefault();
            if (dirty) apply();
          } else if (e.key === 'Tab') {
            e.preventDefault();
            const t = e.currentTarget;
            const { selectionStart: a, selectionEnd: b } = t;
            const next = draft.slice(0, a) + '  ' + draft.slice(b);
            setDraft(next);
            requestAnimationFrame(() => t.setSelectionRange(a + 2, a + 2));
          }
        }}
      />
    </div>
  );
}
