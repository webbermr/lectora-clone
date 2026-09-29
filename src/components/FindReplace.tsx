import { useMemo, useState } from 'react';
import { isTextFile } from '../lib/paths';
import { applyToText, findEverywhere, type SourceMatch } from '../lib/sourceMatch';
import { store, useStore } from '../lib/store';
import { decodeText, encodeText } from '../lib/text';

/** Search every text file in the package; replacements keep each file's encoding. */
export function FindReplace() {
  const s = useStore();
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [flexible, setFlexible] = useState(true);
  const files = s.project!.files;

  const matches = useMemo(() => {
    if (query.trim().length < 2) return [];
    const texts = Object.keys(files)
      .filter((p) => isTextFile(p) && !p.includes('__lc_edit__'))
      .sort()
      .map((p) => [p, decodeText(files[p])] as [string, string]);
    return findEverywhere(texts, query, { flexible });
  }, [query, flexible, files]);

  const replace = async (subset: SourceMatch[]) => {
    const byPath = new Map<string, SourceMatch[]>();
    for (const m of subset) byPath.set(m.path, [...(byPath.get(m.path) ?? []), m]);
    await store.write(
      `Replace "${query.slice(0, 30)}"`,
      [...byPath].map(([path, ms]) => ({ path, bytes: encodeText(applyToText(decodeText(files[path]), ms, replacement)) })),
    );
    store.setStatus(`Replaced ${subset.length} match${subset.length === 1 ? '' : 'es'} in ${byPath.size} file${byPath.size === 1 ? '' : 's'}`);
  };

  const fileCount = new Set(matches.map((m) => m.path)).size;

  return (
    <div className="panel-body">
      <div className="stack">
        <input placeholder="Find text…" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
        <input placeholder="Replace with…" value={replacement} onChange={(e) => setReplacement(e.target.value)} />
        <label className="check small" title="Also match text stored as HTML entities, JS escapes, \u codes, and across line breaks">
          <input type="checkbox" checked={flexible} onChange={(e) => setFlexible(e.target.checked)} /> Match however it's encoded
        </label>
        <div className="mini-toolbar">
          <span className="muted small grow">
            {query.trim().length < 2 ? 'Type at least 2 characters' : `${matches.length}${matches.length === 200 ? '+' : ''} matches in ${fileCount} files`}
          </span>
          <button className="primary" disabled={!matches.length} onClick={() => confirm(`Replace all ${matches.length} matches?`) && void replace(matches)}>
            Replace all
          </button>
        </div>
      </div>
      <ul className="find-results">
        {matches.map((m, i) => (
          <li key={`${m.path}:${m.index}:${i}`}>
            <button className="find-hit" title="Open this file in Code view" onClick={() => { store.openPage(m.path, null); store.setView('code'); }}>
              <span className="mono small"><b>{m.path}</b></span>
              <span className="mono small">
                <span className="ctx">…{m.before.slice(-30)}</span>
                <mark>{m.matched}</mark>
                <span className="ctx">{m.after.slice(0, 30)}…</span>
              </span>
            </button>
            <button onClick={() => void replace([m])} title="Replace just this one">Replace</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
