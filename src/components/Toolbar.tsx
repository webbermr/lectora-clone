import { useRef } from 'react';
import * as actions from '../lib/actions';
import { editor, useEditor } from '../lib/editor';
import { useTask } from '../lib/task';
import { store, useStore, type View } from '../lib/store';
import type { InsertKind } from '../lib/templates';
import { STAGE_WIDTHS } from './EditStage';

export function Toolbar({ width, setWidth }: { width: string; setWidth: (w: string) => void }) {
  const s = useStore();
  const ed = useEditor();
  const job = useTask();
  const media = useRef<HTMLInputElement>(null);
  const pendingKind = useRef<InsertKind>('image');
  const canInsert = s.view === 'edit' && !!ed.doc;

  const insertMedia = (kind: InsertKind, accept: string) => {
    pendingKind.current = kind;
    media.current!.accept = accept;
    media.current!.click();
  };

  const views: [View, string][] = [
    ['edit', '✎ Edit'],
    ['live', '⚡ Live edit'],
    ['preview', '▶ Preview'],
    ['code', '</> Code'],
  ];

  return (
    <header className="ribbon">
      <div className="ribbon-group">
        <button onClick={() => void store.saveNow().then(() => store.close())} title="Back to the project list">☰ Projects</button>
        <button className="primary" disabled={job?.status === 'running'} onClick={() => void actions.exportPackage()} title="Download as a SCORM .zip for your LMS">⤓ Publish SCORM</button>
      </div>
      <div className="ribbon-group">
        <button onClick={() => void store.undo()} disabled={!s.undoStack.length} title={s.undoStack.length ? `Undo ${s.undoStack.at(-1)!.label} (Ctrl+Z)` : 'Undo'}>↶</button>
        <button onClick={() => void store.redo()} disabled={!s.redoStack.length} title={s.redoStack.length ? `Redo ${s.redoStack.at(-1)!.label} (Ctrl+Y)` : 'Redo'}>↷</button>
      </div>
      <div className="ribbon-group" aria-label="Insert">
        <span className="group-label">Insert</span>
        <button disabled={!canInsert} onClick={() => void editor.insert('heading')}>Heading</button>
        <button disabled={!canInsert} onClick={() => void editor.insert('text')}>Text</button>
        <button disabled={!canInsert} onClick={() => insertMedia('image', 'image/*')}>Image</button>
        <button disabled={!canInsert} onClick={() => void editor.insert('button')}>Button</button>
        <button disabled={!canInsert} onClick={() => void editor.insert('link')}>Link</button>
        <button disabled={!canInsert} onClick={() => void editor.insert('shape')}>Shape</button>
        <button disabled={!canInsert} onClick={() => insertMedia('video', 'video/*')}>Video</button>
        <button disabled={!canInsert} onClick={() => insertMedia('audio', 'audio/*')}>Audio</button>
        <input
          ref={media}
          type="file"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            const path = await actions.addAsset(f, 'assets');
            await editor.insert(pendingKind.current, path);
          }}
        />
      </div>
      <div className="ribbon-group">
        {views.map(([v, label]) => (
          <button key={v} className={s.view === v ? 'active' : ''} onClick={() => store.setView(v)}>{label}</button>
        ))}
        <select value={width} onChange={(e) => setWidth(e.target.value)} title="Stage width">
          {Object.entries(STAGE_WIDTHS).map(([k, v]) => (
            <option key={k} value={v}>{k}</option>
          ))}
        </select>
      </div>
    </header>
  );
}
