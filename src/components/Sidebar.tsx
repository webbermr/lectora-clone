import { useMemo, useRef, useState } from 'react';
import * as actions from '../lib/actions';
import { CourseCheckPanel } from './CourseCheckPanel';
import { FindReplace } from './FindReplace';
import { deleteFlow } from '../lib/deleteFlow';
import { flattenItems, type ItemNode } from '../lib/manifest';
import { isHtmlFile, isImageFile, isMediaFile, isTextFile } from '../lib/paths';
import { store, useStore } from '../lib/store';
import { buildFileIndex, inferLectoraStructure, isLectoraPackage, pageCount, type FileIndex } from '../lib/structure';
import { vfsUrl } from '../lib/vfs';

export function Sidebar() {
  const [tab, setTab] = useState<'title' | 'files' | 'find' | 'check'>('title');
  return (
    <aside className="sidebar">
      <div className="tabs">
        <button className={tab === 'title' ? 'active' : ''} onClick={() => setTab('title')}>Title Explorer</button>
        <button className={tab === 'files' ? 'active' : ''} onClick={() => setTab('files')}>Files</button>
        <button className={tab === 'find' ? 'active' : ''} onClick={() => setTab('find')}>Find</button>
        <button className={tab === 'check' ? 'active' : ''} onClick={() => setTab('check')} title="Check the course for broken links, loops and tracking problems">Check</button>
      </div>
      {tab === 'title' ? <TitleExplorer /> : tab === 'files' ? <FileList /> : tab === 'find' ? <FindReplace /> : <CourseCheckPanel />}
    </aside>
  );
}

function TitleExplorer() {
  const s = useStore();
  const m = s.project?.manifest;
  const [renaming, setRenaming] = useState<string | null>(null);
  const [openFiles, setOpenFiles] = useState<Set<string>>(() => new Set());
  const [collapsed, setCollapsed] = useState<Map<string, boolean>>(() => new Map());
  const [showUnlisted, setShowUnlisted] = useState(false);
  const [showChapters, setShowChapters] = useState(true);
  // Recovered Lectora items picked for deleting (click, or Ctrl/⌘-click for several).
  const [marked, setMarked] = useState<Set<string>>(() => new Set());
  const structure = useStructure();
  const index = structure?.manifestIndex;
  const lectora = structure?.lectora ?? null;

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
  const setItemCollapsed = (id: string, closed: boolean) => setCollapsed((prev) => new Map(prev).set(id, closed));
  // Recovered Lectora chapters aren't in the manifest, so manifest edits don't apply to them.
  const editable = !!selected && !isInferred(selected);
  const addPage = () => {
    const title = prompt('Title for the new page:', 'New page');
    if (title) void actions.addPage(title, editable ? selected! : undefined);
  };
  const inferredById = new Map(lectora ? flattenItems(lectora.modules).map((i) => [i.identifier, i]) : []);
  const targets = [...marked].filter((id) => inferredById.has(id));
  if (!targets.length && selected && inferredById.has(selected)) targets.push(selected);
  const deleteInferred = () => {
    const items = targets.map((id) => inferredById.get(id)!);
    // Deleting a chapter and one of its own pages is the same as deleting the chapter.
    const pages = [...new Set(items.flatMap((i) => flattenItems([i]).map((x) => x.href).filter((h): h is string => !!h)))];
    const label = items.length === 1 ? `Delete "${items[0].title}"` : `Delete ${items.length} items`;
    setMarked(new Set());
    void deleteFlow.start(label, pages);
  };
  const del = () => {
    if (targets.length) return deleteInferred();
    if (!editable) return;
    const alsoFile = confirm('Remove this page from the course.\n\nOK also deletes its HTML file from the package. Cancel keeps the file.');
    void actions.deleteItem(selected, alsoFile);
  };

  const onRowClick = (item: ItemNode, e: React.MouseEvent) => {
    if (isInferred(item.identifier) && (e.ctrlKey || e.metaKey)) {
      setMarked((prev) => {
        const next = new Set(prev);
        if (next.has(item.identifier)) next.delete(item.identifier);
        else next.add(item.identifier);
        return next;
      });
      return;
    }
    setMarked(new Set());
    store.openPage(item.href ?? null, item.identifier);
  };
  const ctx: TreeCtx = { selected, renaming, setRenaming, index, openFiles, toggleFiles, collapsed, setCollapsed: setItemCollapsed, currentPath: s.currentPath, marked, onRowClick };
  const lectoraCtx: TreeCtx | null = lectora ? { ...ctx, index: lectora.index, closedByDefault: true } : null;
  const unlisted = lectora ? lectora.index.unlisted : index.unlisted;

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
        <button onClick={() => editable && setRenaming(selected)} disabled={!editable}>Rename</button>
        <button onClick={() => editable && void actions.moveItem(selected!, -1)} disabled={!editable} title="Move up">↑</button>
        <button onClick={() => editable && void actions.moveItem(selected!, 1)} disabled={!editable} title="Move down">↓</button>
        <button
          onClick={del}
          disabled={!editable && !targets.length}
          title={targets.length > 1 ? `Delete the ${targets.length} selected items` : 'Delete the selected chapter, section or page'}
        >
          🗑{targets.length > 1 ? ` ${targets.length}` : ''}
        </button>
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
      {lectora && lectoraCtx && (
        <div className="chapters">
          <div className="chapters-head" onClick={() => setShowChapters((v) => !v)}>
            <span className="tree-icon">{showChapters ? '▾' : '▸'}</span>
            <b>Chapters</b>
            <span className="muted small">
              {lectora.modules.length} chapters · {lectora.pageCount} pages
            </span>
          </div>
          <p className="hint chapters-note">
            Recovered from Lectora's page file names, since the manifest lists this course as a single unit. Files
            are matched to pages by what each page's HTML refers to. Ctrl/⌘-click to pick several chapters, sections or
            pages, then 🗑 to review and delete them.
          </p>
          {showChapters && (
            <ul className="tree">
              {lectora.modules.map((i) => (
                <TreeItem key={i.identifier} item={i} depth={0} ctx={lectoraCtx} />
              ))}
            </ul>
          )}
        </div>
      )}
      {unlisted.length > 0 && (
        <div className="unlisted">
          <div
            className="tree-row"
            onClick={() => setShowUnlisted((v) => !v)}
            title={lectora ? 'Files no page refers to: runtime files, or assets that may be unused' : "Files in the package that the manifest doesn't assign to any module or page"}
          >
            <span className="tree-icon">{showUnlisted ? '▾' : '▸'}</span>
            <span className="tree-label muted">{lectora ? 'Not used by any page' : 'Not in any module'}</span>
            <span className="count">{unlisted.length}</span>
          </div>
          {showUnlisted && <ItemFileList files={unlisted} depth={1} ctx={lectoraCtx ?? ctx} />}
        </div>
      )}
      {!lectora && m.items.length === 1 && !m.items[0].children.length && (
        <p className="hint">
          The manifest describes this course as a single unit, so every file belongs to it. Lectora and Storyline
          often publish this way and keep their chapters and sections inside their own player, not in the manifest.
        </p>
      )}
    </div>
  );
}

/**
 * The course structure to show: the manifest's own modules when it has them,
 * or, for a Lectora title published as one SCO, chapters recovered from the
 * page file names.
 */
function useStructure() {
  const s = useStore();
  const m = s.project?.manifest ?? null;
  const files = s.project?.files;
  // Files are replaced (not mutated) on edit, but the map object is reused, so key on the undo history too.
  const edits = s.undoStack.length + s.redoStack.length * 1000;
  return useMemo(() => {
    if (!m || !files) return null;
    const manifestIndex = buildFileIndex(m, Object.keys(files));
    const single = m.items.length === 1 && m.items[0].children.length === 0;
    const xml = files['imsmanifest.xml'] ? new TextDecoder().decode(files['imsmanifest.xml'].subarray(0, 600)) : '';
    const lectora = single && isLectoraPackage(xml, files) ? inferLectoraStructure(m, files) : null;
    return { manifestIndex, lectora, modules: lectora ? lectora.modules : m.items.length > 1 ? m.items : [], index: lectora?.index ?? manifestIndex };
  }, [m, files, edits]);
}

const isInferred = (id: string | null) => !!id && id.startsWith('lectora:');

interface TreeCtx {
  selected: string | null;
  renaming: string | null;
  setRenaming: (id: string | null) => void;
  index: FileIndex;
  openFiles: Set<string>;
  toggleFiles: (id: string) => void;
  /** Modules the user opened (false) or closed (true) by hand; others follow the default. */
  collapsed: Map<string, boolean>;
  setCollapsed: (id: string, closed: boolean) => void;
  currentPath: string | null;
  /** Start modules closed (hundreds of recovered Lectora pages would otherwise flood the list). */
  closedByDefault?: boolean;
  marked: Set<string>;
  onRowClick: (item: ItemNode, e: React.MouseEvent) => void;
}

/** A module/section (has children) or a page (has a launch file), with its files on demand. */
function TreeItem({ item, depth, ctx }: { item: ItemNode; depth: number; ctx: TreeCtx }) {
  const isModule = item.children.length > 0;
  const files = ctx.index.itemFiles.get(item.identifier) ?? [];
  const filesOpen = ctx.openFiles.has(item.identifier);
  const holdsCurrent = useMemo(
    () => isModule && !!ctx.currentPath && flattenItems(item.children).some((c) => c.href === ctx.currentPath),
    [isModule, item, ctx.currentPath],
  );
  const closedByDefault = !!ctx.closedByDefault && !holdsCurrent;
  const isCollapsed = ctx.collapsed.get(item.identifier) ?? closedByDefault;
  const pages = isModule ? pageCount(item) : 0;

  return (
    <li>
      <div
        className={'tree-row' + (item.identifier === ctx.selected ? ' selected' : '') + (isModule ? ' module' : '') + (ctx.marked.has(item.identifier) ? ' marked' : '')}
        style={{ paddingLeft: 4 + depth * 14 }}
        onClick={(e) => ctx.onRowClick(item, e)}
        onDoubleClick={() => !isInferred(item.identifier) && ctx.setRenaming(item.identifier)}
        title={item.title + '\n' + (item.href ? item.href + item.query : `${pages} page${pages === 1 ? '' : 's'}`)}
      >
        {isModule ? (
          <button
            className="twisty"
            title={isCollapsed ? 'Expand' : 'Collapse'}
            onClick={(e) => {
              e.stopPropagation();
              ctx.setCollapsed(item.identifier, !isCollapsed);
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
  const fileMap = s.project?.files;
  const files = useMemo(() => Object.keys(fileMap ?? {}).sort(), [fileMap]);
  const structure = useStructure();
  const index = structure?.index;
  // Only worth offering when the course is actually split up.
  const modules = structure?.modules ?? [];
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
          <option value="">{structure?.lectora ? 'All chapters' : 'All modules'}</option>
          {modules.map((mod) => (
            <option key={mod.identifier} value={mod.identifier}>{mod.title}</option>
          ))}
          <option value="__none__">{structure?.lectora ? 'Not used by any page' : 'Not in any module'}</option>
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
