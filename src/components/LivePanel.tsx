import { useEffect, useMemo, useRef, useState } from 'react';
import { live, textNodesOf, useLive, type AssetKind, type PageAsset } from '../lib/live';
import { basename, dirname, extname, isImageFile } from '../lib/paths';
import { visibleText } from '../lib/sourceMatch';
import { useStore } from '../lib/store';
import { vfsUrl } from '../lib/vfs';

/** Properties for the element selected in Live edit. */
export function LivePanel() {
  const lv = useLive();
  const el = lv.selected;
  if (!el || !el.isConnected) return <PageAssets />;
  return <Selected key={lv.getVersion()} el={el} />;
}

function Selected({ el }: { el: Element }) {
  const s = useStore();
  const nodes = useMemo(() => textNodesOf(el, 30), [el]);
  const asset = useMemo(() => live.assetOf(el), [el]);
  const upload = useRef<HTMLInputElement>(null);
  const tag = el.tagName.toLowerCase();

  return (
    <>
      <div className="props-head">
        <b className="mono">
          {tag}
          {el.id ? '#' + el.id : ''}
        </b>
        <div className="btn-grid">
          <button
            onClick={() => el.parentElement && el.parentElement !== el.ownerDocument.body && live.select(el.parentElement)}
            title="Select the containing element"
          >
            Parent
          </button>
          <button onClick={() => live.select(null)}>Deselect</button>
        </div>
      </div>

      {asset && (
        <details className="section" open>
          <summary>{asset.kind === 'media' ? 'Media file' : 'Image'}</summary>
          <div className="section-body">
            <div className="mono small wide-cell">{asset.path}</div>
            {isImageFile(asset.path) && (
              <div className="file-preview wide-cell">
                <img src={vfsUrl(s.project!.id, asset.path) + '?v=' + (s.revisions[asset.path] ?? 0)} alt="" />
              </div>
            )}
            <button onClick={() => upload.current?.click()}>Replace file…</button>
            <input
              ref={upload}
              type="file"
              hidden
              accept={asset.kind === 'media' ? 'audio/*,video/*' : 'image/*'}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) await live.replaceAsset(asset.path, f);
              }}
            />
            <p className="hint wide-cell">The new file keeps the old name, so every page that uses it picks it up.</p>
          </div>
        </details>
      )}

      {nodes.length > 0 ? (
        <details className="section" open>
          <summary>Text{nodes.length > 1 ? ` (${nodes.length} pieces)` : ''}</summary>
          <div className="stack">
            {nodes.map((n, i) => (
              <TextPiece key={i} node={n} />
            ))}
            {nodes.length === 30 && <p className="hint">Showing the first 30 pieces. Select a smaller element to see the rest.</p>}
          </div>
        </details>
      ) : (
        !asset && (
          <p className="hint">
            {tag === 'canvas'
              ? 'This is drawn on a canvas, so there is no text or image to edit here.'
              : 'No text in this element. Click directly on the words you want to change.'}
          </p>
        )
      )}
    </>
  );
}

function TextPiece({ node }: { node: Text }) {
  const s = useStore();
  const ref = useRef<HTMLTextAreaElement>(null);
  const original = visibleText(node.data);
  const doc = node.ownerDocument;
  // Where does this text live? Shown before editing, so there are no surprises.
  const matches = useMemo(() => live.find(original, doc), [original, doc, s.project?.files]);

  const save = async () => {
    const next = ref.current!.value;
    if (visibleText(next) === original) return;
    const old = node.data;
    node.data = next;
    const failed = await live.applyText([{ node, old, next }], doc);
    if (failed.length) node.data = old;
    live.emit();
  };

  const files = [...new Set(matches.map((m) => m.path))];
  return (
    <div className="text-piece">
      <textarea ref={ref} className="text-edit" defaultValue={original} onKeyDown={(e) => e.stopPropagation()} />
      <div className="text-piece-foot">
        <span className={'small ' + (matches.length ? 'muted' : 'error')}>
          {matches.length
            ? `In ${files[0]}${files.length > 1 ? ` +${files.length - 1} more` : ''}${matches.length > 1 ? ` · ${matches.length} matches` : ''}`
            : 'Not found in source'}
        </span>
        <button className="primary" disabled={!matches.length} onClick={() => void save()}>
          Save
        </button>
      </div>
    </div>
  );
}

const KIND_LABEL: Record<AssetKind, string> = { image: 'Images', video: 'Video', audio: 'Audio', other: 'Other files' };
const KIND_ICON: Record<AssetKind, string> = { image: '🖼', video: '🎞', audio: '🔊', other: '📎' };
const ACCEPT: Record<AssetKind, string> = { image: 'image/*', video: 'video/*', audio: 'audio/*', other: '' };

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Everything the page shown in Live edit uses, so assets can be found and replaced without hunting. */
function PageAssets() {
  const s = useStore();
  const lv = useLive();
  const [filter, setFilter] = useState<AssetKind | 'all'>('all');
  const [, rescan] = useState(0);
  // The page's runtime can add or swap objects at any time (timers, actions, slide changes).
  useEffect(() => {
    const t = setInterval(() => rescan((n) => n + 1), 1500);
    return () => clearInterval(t);
  }, []);
  const pagePath = lv.stagePagePath() ?? s.currentPath;
  // Re-read on every render; cheap, and the page's runtime may have added objects since.
  const assets = live.pageAssets(pagePath);
  const counts = assets.reduce((m, a) => ({ ...m, [a.kind]: (m[a.kind] ?? 0) + 1 }), {} as Partial<Record<AssetKind, number>>);
  const shown = assets.filter((a) => filter === 'all' || a.kind === filter);
  const kinds = (Object.keys(KIND_LABEL) as AssetKind[]).filter((k) => counts[k]);

  return (
    <>
      <div className="props-head">
        <b>Page assets</b>
        <div className="mono muted small">{pagePath}</div>
      </div>
      <div className="chips">
        <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>All {assets.length}</button>
        {kinds.map((k) => (
          <button key={k} className={filter === k ? 'active' : ''} onClick={() => setFilter(k)}>
            {KIND_ICON[k]} {counts[k]}
          </button>
        ))}
        <button title="Scan the page again" onClick={() => rescan((n) => n + 1)}>⟳</button>
      </div>
      {assets.length === 0 && <p className="hint">No images, video or audio found on this page yet.</p>}
      {(filter === 'all' ? kinds : [filter]).map((k) => {
        const group = shown.filter((a) => a.kind === k);
        if (!group.length) return null;
        return (
          <details key={k} className="section" open>
            <summary>{KIND_LABEL[k]} ({group.length})</summary>
            <ul className="asset-list">
              {group.map((a) => (
                <AssetRow key={a.path} asset={a} />
              ))}
            </ul>
          </details>
        );
      })}
      <p className="hint">
        Click any text or image on the page to edit it. Assets marked <i>not on screen</i> are named in this page's
        source but not showing right now, such as audio an action plays or a popup that hasn't opened.
      </p>
    </>
  );
}

function AssetRow({ asset }: { asset: PageAsset }) {
  const s = useStore();
  const input = useRef<HTMLInputElement>(null);
  const [dims, setDims] = useState('');
  const src = vfsUrl(s.project!.id, asset.path) + '?v=' + (s.revisions[asset.path] ?? 0);
  const onScreen = asset.elements.find((e) => e.isConnected);

  useEffect(() => {
    if (asset.kind !== 'image') return;
    const img = new Image();
    img.onload = () => setDims(img.naturalWidth && img.naturalHeight ? `${img.naturalWidth}×${img.naturalHeight}` : '');
    img.src = src;
  }, [src, asset.kind]);

  return (
    <li className="asset-row">
      <div className="asset-thumb">
        {asset.kind === 'image' ? <img src={src} alt="" loading="lazy" /> : <span>{KIND_ICON[asset.kind]}</span>}
      </div>
      <div className="asset-info">
        <div className="asset-name" title={asset.path}>{basename(asset.path)}</div>
        <div className="muted small asset-meta">
          {[extname(asset.path).toUpperCase(), formatBytes(asset.bytes), dims, dirname(asset.path) && dirname(asset.path) + '/'].filter(Boolean).join(' · ')}
        </div>
        <div className="small">
          {onScreen ? (
            <span className="on-screen">● on screen{asset.elements.length > 1 ? ` ×${asset.elements.length}` : ''}</span>
          ) : (
            <span className="muted">○ not on screen</span>
          )}
        </div>
      </div>
      <div className="asset-actions">
        {onScreen && (
          <button
            title="Select it on the page"
            onClick={() => {
              onScreen.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
              live.select(onScreen);
            }}
          >
            Show
          </button>
        )}
        <button title="Replace this file (keeps its name)" onClick={() => input.current?.click()}>Replace…</button>
        <input
          ref={input}
          type="file"
          hidden
          accept={ACCEPT[asset.kind]}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) await live.replaceAsset(asset.path, f);
          }}
        />
      </div>
    </li>
  );
}
