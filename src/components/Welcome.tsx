import { useEffect, useRef, useState } from 'react';
import * as actions from '../lib/actions';
import { deleteProject, listProjects, loadProject, type ProjectSummary } from '../lib/storage';
import { store } from '../lib/store';

export function Welcome() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const refresh = () => listProjects().then(setProjects).catch((e) => setError(String(e)));
  useEffect(() => {
    void refresh();
  }, []);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError('');
    try {
      await fn();
    } catch (e) {
      console.error(e);
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  const importFile = (f: File) => run(`Importing ${f.name}…`, () => actions.importPackage(f));

  return (
    <div
      className={'welcome' + (dragging ? ' dragging' : '')}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files[0];
        if (f) void importFile(f);
      }}
    >
      <div className="welcome-card">
        <h1>Lectora Clone</h1>
        <p className="muted">Import a SCORM package, edit its pages, and publish it back to your LMS.</p>

        <div className="welcome-actions">
          <button className="big primary" onClick={() => input.current?.click()} disabled={!!busy}>
            Import SCORM .zip
          </button>
          <input
            ref={input}
            type="file"
            accept=".zip,application/zip"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void importFile(f);
            }}
          />
          <button
            className="big"
            disabled={!!busy}
            onClick={() => {
              const title = prompt('Course title:', 'New course');
              if (!title) return;
              const v = confirm('Use SCORM 2004?\n\nOK = SCORM 2004 (4th Ed.)\nCancel = SCORM 1.2 (widest LMS support)') ? '2004' : '1.2';
              void run('Creating…', () => actions.newCourse(title, v));
            }}
          >
            New blank course
          </button>
        </div>
        <p className="muted small">…or drop a .zip anywhere on this page.</p>
        {busy && <p className="busy">{busy}</p>}
        {error && <p className="error">{error}</p>}

        {projects.length > 0 && (
          <>
            <h2>Recent projects</h2>
            <p className="muted small">Saved in this browser automatically.</p>
            <ul className="recent">
              {projects.map((p) => (
                <li key={p.id}>
                  <button
                    className="recent-open"
                    onClick={() =>
                      run(`Opening ${p.name}…`, async () => {
                        const stored = await loadProject(p.id);
                        if (!stored) throw new Error('Project data is missing.');
                        await store.open(stored.id, stored.name, stored.files);
                      })
                    }
                  >
                    <b>{p.name}</b>
                    <span className="muted small">
                      {p.fileCount} files · edited {new Date(p.updatedAt).toLocaleString()}
                    </span>
                  </button>
                  <button
                    title="Delete from this browser"
                    onClick={async () => {
                      if (!confirm(`Delete "${p.name}" from this browser? Export it first if you need it.`)) return;
                      await deleteProject(p.id);
                      void refresh();
                    }}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
