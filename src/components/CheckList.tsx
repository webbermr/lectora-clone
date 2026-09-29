import { useMemo, useState } from 'react';
import { textOf } from '../lib/assetRefs';
import type { Issue } from '../lib/courseCheck';
import { readLectoraCourse, relinkText, tocTitles } from '../lib/lectora';
import { basename, isHtmlFile } from '../lib/paths';
import { store } from '../lib/store';
import { encodeText } from '../lib/text';

const ICON = { error: '⛔', warning: '⚠', info: 'ℹ' } as const;

/** Course-check findings, each linking to the file involved; broken links can be repointed. */
export function CheckList({ issues, onOpen, onFixed }: { issues: Issue[]; onOpen?: () => void; onFixed?: () => void }) {
  const [fixing, setFixing] = useState<number | null>(null);
  return (
    <ul className="check-list">
      {issues.map((i, n) => (
        <li key={n} className={'check-item ' + i.severity}>
          <span className="check-icon" aria-label={i.severity}>{ICON[i.severity]}</span>
          <div className="check-body">
            <b>{i.kind}</b>
            {i.file && (
              <>
                {' · '}
                <button
                  className="linkish mono"
                  title="Open this file in Code view"
                  onClick={() => {
                    store.openPage(i.file!, null);
                    store.setView('code');
                    onOpen?.();
                  }}
                >
                  {i.file}
                </button>
              </>
            )}
            <div className="small">{i.message}</div>
            {i.missing && i.file && (fixing === n ? (
              <RelinkForm
                file={i.file}
                missing={i.missing}
                onDone={() => {
                  setFixing(null);
                  onFixed?.();
                }}
                onCancel={() => setFixing(null)}
              />
            ) : (
              <button className="small fix-btn" onClick={() => setFixing(n)}>Fix: choose where it should go…</button>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Pick a page for each missing link in one file, then rewrite them (one undo step). */
function RelinkForm({ file, missing, onDone, onCancel }: { file: string; missing: string[]; onDone: () => void; onCancel: () => void }) {
  const p = store.project!;
  // Pages in course order, labelled with their table-of-contents titles where known.
  const options = useMemo(() => {
    const course = readLectoraCourse(p.files, p.manifest);
    const titles = tocTitles(p.files).pages;
    const pages = course.order.length ? course.order : Object.keys(p.files).filter(isHtmlFile).sort();
    return pages
      .filter((f) => p.files[f] && f !== file && !f.includes('__lc_edit__'))
      .map((f) => ({ path: f, label: titles.get(basename(f)) ? `${titles.get(basename(f))} (${basename(f)})` : basename(f) }));
  }, [p.files, p.manifest, file]);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const ready = missing.some((m) => choice[m]);

  const apply = async () => {
    let text = textOf(p.files[file]);
    let changed = 0;
    for (const m of missing) {
      if (!choice[m]) continue;
      const r = relinkText(text, basename(m), basename(choice[m]));
      text = r.text;
      changed += r.count;
    }
    if (changed) {
      await store.write(`Repoint links in ${basename(file)}`, [{ path: file, bytes: encodeText(text) }]);
      store.setStatus(`Repointed ${changed} link${changed === 1 ? '' : 's'} in ${basename(file)}. Undo with Ctrl+Z.`);
    }
    onDone();
  };

  return (
    <div className="relink">
      {missing.map((m) => (
        <label key={m} className="field wide">
          <span>
            Send <span className="mono">{basename(m)}</span> to
          </span>
          <select value={choice[m] ?? ''} onChange={(e) => setChoice({ ...choice, [m]: e.target.value })}>
            <option value="">— leave as is —</option>
            {options.map((o) => (
              <option key={o.path} value={o.path}>{o.label}</option>
            ))}
          </select>
        </label>
      ))}
      <div className="mini-toolbar">
        <button className="primary" disabled={!ready} onClick={() => void apply()}>Repoint</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
