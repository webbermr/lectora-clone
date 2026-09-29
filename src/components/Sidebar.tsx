import { useRef, useState } from 'react';
import * as actions from '../lib/actions';
import type { ItemNode } from '../lib/manifest';
import { isHtmlFile, isImageFile, isMediaFile, isTextFile } from '../lib/paths';
import { store, useStore } from '../lib/store';
import { vfsUrl } from '../lib/vfs';

export function Sidebar() {
  const [tab, setTab] = useState<'title' | 'files'>('title');
  return (
    <aside className="sidebar">
      <div className="tabs">
        <button className={tab === 'title' ? 'active' : ''} onClick={() => setTab('title')}>Title Explorer</button>
        <button className={tab === 'files' ? 'active' : ''} onClick={() => setTab('files')}>Files</button>
      </div>
      {tab === 'title' ? <TitleExplorer /> : <FileList />}
    </aside>
  );
}

function TitleExplorer() {
  const s = useStore();
  const m = s.project?.manifest;
  const [renaming, setRenaming] = useState<string | null>(null);

  if (!m) {
    return (
      <div className="panel-body">
        <p className="error">Manifest problem: {s.project?.manifestError}</p>
        <p className="muted">You can still edit files from the Files tab, including imsmanifest.xml.</p>
      </div>
    );
  }

  const selected = s.currentItemId;
  const addPage = () => {
    const title = prompt('Title for the new page:', 'New page');
    if (title) void actions.addPage(title, selected ?? undefined);
  };
  const del = () => {
    if (!selected) return;
    const alsoFile = confirm('Remove this page from the course.\n\nOK also deletes its HTML file from the package. Cancel keeps the file.');
    void actions.deleteItem(selected, alsoFile);
  };

  const renderItem = (item: ItemNode, depth: number) => (
    <li key={item.identifier}>
      <div
        className={'tree-row' + (item.identifier === selected ? ' selected' : '')}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => store.openPage(item.href ?? null, item.identifier)}
        onDoubleClick={() => setRenaming(item.identifier)}
        title={item.href ? item.href + item.query : 'Folder (no launch file)'}
      >
        <span className="tree-icon">{item.children.length ? '▾' : item.href ? '▫' : '▸'}</span>
        {renaming === item.identifier ? (
          <input
            autoFocus
            defaultValue={item.title}
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => {
              setRenaming(null);
              if (e.target.value.trim() && e.target.value !== item.title) void actions.renameItem(item.identifier, e.target.value.trim());
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setRenaming(null);
            }}
          />
        ) : (
          <span className="tree-label">{item.title}</span>
        )}
      </div>
      {item.children.length > 0 && <ul>{item.children.map((c) => renderItem(c, depth + 1))}</ul>}
    </li>
  );

  return (
    <div className="panel-body">
      <div className="course-head">
        <input
          key={m.title}
          className="course-title"
          defaultValue={m.title}
          title="Course title (shown in the LMS)"
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v && v !== m.title) void actions.setCourseTitle(v);
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <span className="badge">SCORM {m.version}</span>
      </div>
      <div className="mini-toolbar">
        <button onClick={addPage} title="Add a page after the selected one">＋ Page</button>
        <button onClick={() => selected && setRenaming(selected)} disabled={!selected}>Rename</button>
        <button onClick={() => selected && void actions.moveItem(selected, -1)} disabled={!selected} title="Move up">↑</button>
        <button onClick={() => selected && void actions.moveItem(selected, 1)} disabled={!selected} title="Move down">↓</button>
        <button onClick={del} disabled={!selected} title="Delete page">🗑</button>
      </div>
      {m.items.length ? <ul className="tree">{m.items.map((i) => renderItem(i, 0))}</ul> : <p className="muted">No pages yet.</p>}
      {m.items.length === 1 && !m.items[0].children.length && (
        <p className="hint">
          This course launches from a single file. Tools like Lectora and Storyline put every page behind one launch
          page, so look in the Files tab for the individual page HTML files.
        </p>
      )}
    </div>
  );
}

function fileIcon(path: string): string {
  if (isHtmlFile(path)) return '📄';
  if (isImageFile(path)) return '🖼';
  if (isMediaFile(path)) return '🎞';
  if (isTextFile(path)) return '📝';
  return '📦';
}

function FileList() {
  const s = useStore();
  const [filter, setFilter] = useState('');
  const upload = useRef<HTMLInputElement>(null);
  const files = Object.keys(s.project?.files ?? {}).sort();
  const shown = files.filter((f) => f.toLowerCase().includes(filter.toLowerCase()));

  const open = (path: string) => {
    store.openPage(path, null);
    if (!isHtmlFile(path) && store.view === 'edit') store.setView(isTextFile(path) ? 'code' : 'edit');
  };

  return (
    <div className="panel-body">
      <div className="mini-toolbar">
        <input className="grow" placeholder={`Filter ${files.length} files…`} value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button onClick={() => upload.current?.click()} title="Add files to the package">⤒ Add</button>
        <input
          ref={upload}
          type="file"
          multiple
          hidden
          onChange={async (e) => {
            for (const f of Array.from(e.target.files ?? [])) await actions.addAsset(f);
            e.target.value = '';
          }}
        />
      </div>
      <ul className="file-list">
        {shown.map((f) => (
          <li key={f} className={'file-row' + (f === s.currentPath ? ' selected' : '')} onClick={() => open(f)} title={f}>
            <span>{fileIcon(f)}</span>
            <span className="file-name">{f}</span>
            <span className="file-actions">
              <button
                title="Rename"
                onClick={(e) => {
                  e.stopPropagation();
                  const to = prompt('New path for this file:', f);
                  if (to && to !== f) actions.renameProjectFile(f, to.replace(/^\/+/, '')).catch((err) => alert(err.message));
                }}
              >
                ✎
              </button>
              <button
                title="Delete"
                onClick={(e) => {
                  e.stopPropagation();
                  if (f === 'imsmanifest.xml') return alert('The manifest is required for a SCORM package.');
                  if (confirm(`Delete ${f}?`)) void actions.deleteProjectFile(f);
                }}
              >
                ✕
              </button>
            </span>
          </li>
        ))}
      </ul>
      {s.currentPath && isImageFile(s.currentPath) && s.project && (
        <div className="file-preview">
          <img src={vfsUrl(s.project.id, s.currentPath)} alt="" />
        </div>
      )}
    </div>
  );
}
