import { useMemo, useRef, useState } from 'react';
import * as actions from '../lib/actions';
import { FindReplace } from './FindReplace';
import type { ItemNode } from '../lib/manifest';
import { isHtmlFile, isImageFile, isMediaFile, isTextFile } from '../lib/paths';
import { store, useStore } from '../lib/store';
import { buildFileIndex, pageCount, type FileIndex } from '../lib/structure';
import { vfsUrl } from '../lib/vfs';

export function Sidebar() {
  const [tab, setTab] = useState<'title' | 'files' | 'find'>('title');
  return (
    <aside className="sidebar">
      <div className="tabs">
        <button className={tab === 'title' ? 'active' : ''} onClick={() => setTab('title')}>Title Explorer</button>
        <button className={tab === 'files' ? 'active' : ''} onClick={() => setTab('files')}>Files</button>
        <button className={tab === 'find' ? 'active' : ''} onClick={() => setTab('find')}>Find</button>
      </div>
      {tab === 'title' ? <TitleExplorer /> : tab === 'files' ? <FileList /> : <FindReplace />}
    </aside>
  );
}

function TitleExplorer() {
  const s = useStore();
  const m = s.project?.manifest;
  const [renaming, setRenaming] = useState<string | null>(null);
  const [openFiles, setOpenFiles] = useState<Set<string>>(() => new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [showUnlisted, setShowUnlisted] = useState(false);
  const files = s.project?.files;
  const index = useMemo(() => (m && files ? buildFileIndex(m, Object.keys(files)) : null), [m, files]);

  if (!m || !index) {
    return (
      <div className="panel-body">
        <p className="error">Manifest problem: {s.project?.manifestError}</p>
        <p className="muted">You can still edit files from the Files tab, including imsmanifest.xml.</p>
      </div>
    );
  }

  const selected = s.currentItemId;
  const toggleFiles = (id: string) =>
    setOpenFiles((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleCollapsed = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const addPage = () => {
    const title = prompt('Title for the new page:', 'New page');
    if (title) void actions.addPage(title, selected ?? undefined);
  };
  const del = () => {
    if (!selected) return;
    const alsoFile = confirm('Remove this page from the course.\n\nOK also deletes its HTML file from the package. Cancel keeps the file.');
    void actions.deleteItem(selected, alsoFile);
  };

  const ctx: TreeCtx = { selected, renaming, setRenaming, index, openFiles, toggleFiles, collapsed, toggleCollapsed, currentPath: s.currentPath };

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
      {m.items.length ? (
        <ul className="tree">
          {m.items.map((i) => (
            <TreeItem key={i.identifier} item={i} depth={0} ctx={ctx} />
          ))}
        </ul>
      ) : (
        <p className="muted">No pages yet.</p>
      )}
      {index.unlisted.length > 0 && (
        <div className="unlisted">
          <div className="tree-row" onClick={() => setShowUnlisted((v) => !v)} title="Files in the package that the manifest doesn't assign to any module or page">
            <span className="tree-icon">{showUnlisted ? '▾' : '▸'}</span>
            <span className="tree-label muted">Not in any module</span>
            <span className="count">{index.unlisted.length}</span>
          </div>
          {showUnlisted && <ItemFileList files={index.unlisted} depth={1} ctx={ctx} />}
        </div>
      )}
      {m.items.length === 1 && !m.items[0].children.length && (
        <p className="hint">
          The manifest describes this course as a single unit, so every file belongs to it. Lectora and Storyline
          often publish this way and keep their chapters and sections inside their own player, not in the manifest.
        </p>
      )}
    </div>
  );
}

interface TreeCtx {
  selected: string | null;
  renaming: string | null;
  setRenaming: (id: string | null) => void;
  index: FileIndex;
  openFiles: Set<string>;
  toggleFiles: (id: string) => void;
  collapsed: Set<string>;
  toggleCollapsed: (id: string) => void;
  currentPath: string | null;
}

/** A module/section (has children) or a page (has a launch file), with its files on demand. */
function TreeItem({ item, depth, ctx }: { item: ItemNode; depth: number; ctx: TreeCtx }) {
  const isModule = item.children.length > 0;
  const files = ctx.index.itemFiles.get(item.identifier) ?? [];
  const filesOpen = ctx.openFiles.has(item.identifier);
  const isCollapsed = ctx.collapsed.has(item.identifier);
  const pages = isModule ? pageCount(item) : 0;

  return (
    <li>
      <div
        className={'tree-row' + (item.identifier === ctx.selected ? ' selected' : '') + (isModule ? ' module' : '')}
        style={{ paddingLeft: 4 + depth * 14 }}
        onClick={() => store.openPage(item.href ?? null, item.identifier)}
        onDoubleClick={() => ctx.setRenaming(item.identifier)}
        title={item.title + '\n' + (item.href ? item.href + item.query : `${pages} page${pages === 1 ? '' : 's'}`)}
      >
        {isModule ? (
          <button
            className="twisty"
            title={isCollapsed ? 'Expand' : 'Collapse'}
            onClick={(e) => {
              e.stopPropagation();
              ctx.toggleCollapsed(item.identifier);
            }}
          >
            {isCollapsed ? '▸' : '▾'}
          </button>
        ) : (
          <span className="tree-icon">▫</span>
        )}
        <span className="tree-glyph">{isModule ? '📁' : '📄'}</span>
        {ctx.renaming === item.identifier ? (
          <input
            autoFocus
            defaultValue={item.title}
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => {
              ctx.setRenaming(null);
              if (e.target.value.trim() && e.target.value !== item.title) void actions.renameItem(item.identifier, e.target.value.trim());
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') ctx.setRenaming(null);
            }}
          />
        ) : (
          <span className="tree-label">{item.title}</span>
        )}
        {isModule && <span className="count" title="Pages in this module">{pages}p</span>}
        {files.length > 0 && (
          <button
            className={'files-toggle' + (filesOpen ? ' active' : '')}
            title={`${filesOpen ? 'Hide' : 'Show'} the ${files.length} files this ${isModule ? 'module' : 'page'} uses`}
            onClick={(e) => {
              e.stopPropagation();
              ctx.toggleFiles(item.identifier);
            }}
          >
            {files.length} files
          </button>
        )}
      </div>
      {filesOpen && <ItemFileList files={files} depth={depth + 1} ctx={ctx} />}
      {isModule && !isCollapsed && (
        <ul>
          {item.children.map((c) => (
            <TreeItem key={c.identifier} item={c} depth={depth + 1} ctx={ctx} />
          ))}
        </ul>
      )}
    </li>
  );
}

function ItemFileList({ files, depth, ctx }: { files: string[]; depth: number; ctx: TreeCtx }) {
  return (
    <ul className="item-files">
      {files.map((f) => {
        const users = ctx.index.fileModules.get(f) ?? [];
        // Used by more than one page, e.g. a shared script, stylesheet or logo.
        const shared = (ctx.index.fileItems.get(f)?.length ?? 0) > 1;
        return (
          <li
            key={f}
            className={'file-row' + (f === ctx.currentPath ? ' selected' : '')}
            style={{ paddingLeft: 10 + depth * 14 }}
            onClick={() => openFile(f)}
            title={f + (users.length ? `\nUsed by: ${users.map((u) => u.title).join(', ')}` : '')}
          >
            <span>{fileIcon(f)}</span>
            <span className="file-name">{f}</span>
            {shared && <span className="tag">shared</span>}
          </li>
        );
      })}
    </ul>
  );
}

/** "Module 1: Getting Started" -> "Module 1"; otherwise "M1", "M2"... by position. */
function shortModuleName(mod: ItemNode, modules: ItemNode[]): string {
  const head = mod.title.split(/[:\-–—]/)[0].trim();
  return head && head.length <= 12 && head !== mod.title ? head : `M${modules.indexOf(mod) + 1}`;
}

/** Open a file in the view that suits it. */
function openFile(path: string) {
  store.openPage(path, null);
  if (isHtmlFile(path)) {
    if (store.view === 'code') store.setView('edit');
  } else if (isTextFile(path)) {
    store.setView('code');
  }
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
  const [moduleFilter, setModuleFilter] = useState('');
  const m = s.project?.manifest;
  const fileMap = s.project?.files;
  const files = useMemo(() => Object.keys(fileMap ?? {}).sort(), [fileMap]);
  const index = useMemo(() => (m ? buildFileIndex(m, files) : null), [m, files]);
  // Only worth offering when the manifest actually splits the course up.
  const modules = m && m.items.length > 1 ? m.items : [];
  const inModule = (f: string) =>
    !moduleFilter ||
    (moduleFilter === '__none__' ? f !== 'imsmanifest.xml' && !index?.fileModules.has(f) : !!index?.fileModules.get(f)?.some((u) => u.identifier === moduleFilter));
  const shown = files.filter((f) => f.toLowerCase().includes(filter.toLowerCase()) && inModule(f));

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
      {modules.length > 0 && (
        <select className="module-filter" value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)} title="Show only the files a module uses">
          <option value="">All modules</option>
          {modules.map((mod) => (
            <option key={mod.identifier} value={mod.identifier}>{mod.title}</option>
          ))}
          <option value="__none__">Not in any module</option>
        </select>
      )}
      <ul className="file-list">
        {shown.map((f) => {
          const users = index?.fileModules.get(f) ?? [];
          return (
          <li key={f} className={'file-row' + (f === s.currentPath ? ' selected' : '')} onClick={() => openFile(f)} title={f + (users.length ? `\nModule: ${users.map((u) => u.title).join(', ')}` : '')}>
            <span>{fileIcon(f)}</span>
            <span className="file-name">{f}</span>
            {modules.length > 0 && users.length > 0 && (
              <span className="tag" title={users.map((u) => u.title).join(', ')}>
                {users.length > 1 ? 'shared' : shortModuleName(users[0], modules)}
              </span>
            )}
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
          );
        })}
      </ul>
      {s.currentPath && isImageFile(s.currentPath) && s.project && (
        <div className="file-preview">
          <img src={vfsUrl(s.project.id, s.currentPath)} alt="" />
        </div>
      )}
    </div>
  );
}
