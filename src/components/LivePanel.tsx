import { useEffect, useMemo, useRef, useState } from 'react';
import { assetKind, live, textNodesOf, useLive, type AssetKind, type PageAsset } from '../lib/live';
import { aspectRatio, formatFromName, imageInfo, replacementMismatches, type ImageInfo } from '../lib/imageInfo';
import { basename, dirname, extname, isImageFile } from '../lib/paths';
import { visibleText } from '../lib/sourceMatch';
import { store, useStore } from '../lib/store';
import { vfsUrl } from '../lib/vfs';
import { textOf } from '../lib/assetRefs';
import { declaredObjects, hiddenIds, navigatesAway, objectIdOf, objectRoot, partIds } from '../lib/removeObjects';
import { sameObjectEverywhere } from '../lib/objectTwins';

/** Properties for the element selected in Live edit. */
export function LivePanel() {
  const lv = useLive();
  const el = lv.selected;
  // After the page navigates, the old selection lives in a document with no window: drop it.
  if (!el || !el.isConnected || !el.ownerDocument.defaultView) return <PageAssets />;
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

      <PositionObject el={el} />
      <RemoveObject el={el} />

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
            {isImageFile(asset.path) && <ImageSpecs path={asset.path} element={el} />}
            {asset.kind === 'media' && <MediaPlayer path={asset.path} />}
            <button onClick={() => upload.current?.click()}>Replace file…</button>
            <input
              ref={upload}
              type="file"
              hidden
              accept={asset.kind === 'media' ? 'audio/*,video/*' : 'image/*'}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) await replaceChecked(asset.path, f);
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

const KIND_NAME: Record<string, string> = { ObjButton: 'button', ObjImage: 'shape or image', ObjText: 'text block', ObjInline: 'object', ObjScroll: 'scrolling panel', ObjProgress: 'progress bar', ObjMedia: 'media player', ObjGroup: 'group' };

/** Remove the whole object the selection belongs to: here, on every page that has it, and what sits on it. */
function RemoveObject({ el }: { el: Element }) {
  const s = useStore();
  const doc = el.ownerDocument;
  const files = s.project!.files;
  const page = useMemo(() => live.pageOf(doc), [doc, files]); // eslint-disable-line react-hooks/exhaustive-deps
  const html = page && files[page] ? textOf(files[page]) : '';
  const declared = useMemo(() => declaredObjects(html), [html]);
  const root = useMemo(() => (page ? objectRoot(el, declared) : null), [el, declared, page]);
  const [scope, setScope] = useState<'page' | 'all'>('all');
  const [withCovered, setWithCovered] = useState(true);
  // The same object on other pages: same id, or a per-chapter copy with the same content at the same spot.
  const copies = useMemo(() => (root && page ? sameObjectEverywhere(files, page, root.id) : []), [root, files, page]);
  const pages = copies.map((r) => r.page);
  // Objects sitting on top of this one (a callout's text, an arrow's label) usually go with it.
  const covered = useMemo(() => {
    if (!root) return [];
    const box = root.element.getBoundingClientRect();
    const r = box.width && box.height ? box : el.getBoundingClientRect();
    if (!r.width || !r.height) return [];
    return [...declared.values()].filter((o) => {
      const e = doc.getElementById(o.id);
      if (!e || o.id === root.id || objectIdOf(o.id, declared) !== o.id || root.element.contains(e) || e.contains(root.element)) return false;
      const b = e.getBoundingClientRect();
      if (!b.width || !b.height || doc.defaultView?.getComputedStyle(e).display === 'none') return false;
      return b.left >= r.left - 2 && b.top >= r.top - 2 && b.right <= r.right + 2 && b.bottom <= r.bottom + 2;
    });
  }, [root, declared, doc]);

  if (!page) return null;
  if (!root) {
    return (
      <details className="section">
        <summary>Remove</summary>
        <p className="hint">This element has no id, so it can't be removed on its own. Try Parent to pick the object around it.</p>
      </details>
    );
  }
  const info = declared.get(root.id);
  const label = info?.name ? `"${info.name}"` : root.id;
  const kind = info ? KIND_NAME[info.kind] ?? 'object' : 'element';
  const nav = navigatesAway(html, root.id);
  const others = pages.filter((p) => p !== page);
  const ids = [root.id, ...(withCovered ? covered.map((c) => c.id) : [])];

  const remove = async () => {
    const byPage = new Map<string, string[]>();
    const refs = scope === 'all' && copies.length ? copies : [{ page, id: root.id }];
    // What sits on it goes too, on each page as that page's copy of it.
    const coveredCopies = withCovered ? covered.map((c) => sameObjectEverywhere(files, page, c.id)) : [];
    for (const r of refs) {
      const extra = r.page === page ? covered.map((c) => c.id) : coveredCopies.flatMap((list) => list.filter((x) => x.page === r.page).map((x) => x.id));
      byPage.set(r.page, [r.id, ...(withCovered ? extra : [])]);
    }
    const parts = new Map(ids.map((id) => [id, partIds(id, doc)]));
    live.select(null);
    await live.removeObjects(`Remove ${label}`, byPage, parts);
  };

  return (
    <details className="section remove-object" open>
      <summary>Remove from page</summary>
      <div className="stack">
        <p className="small">
          {root.element === el ? 'This is' : 'Your selection is part of'} the {kind} <b>{label}</b> <span className="mono muted">({root.id})</span>.
        </p>
        {covered.length > 0 && (
          <label className="check-row">
            <input type="checkbox" checked={withCovered} onChange={(e) => setWithCovered(e.target.checked)} />
            Also remove the {covered.length} object{covered.length === 1 ? '' : 's'} in the same spot
            <span className="muted small"> ({covered.map((c) => c.name || c.id).join(', ')})</span>
          </label>
        )}
        {others.length > 0 && (
          <div className="scope">
            <label className="check-row">
              <input type="radio" checked={scope === 'all'} onChange={() => setScope('all')} /> All {pages.length} pages that have it
            </label>
            <label className="check-row">
              <input type="radio" checked={scope === 'page'} onChange={() => setScope('page')} /> This page only
            </label>
          </div>
        )}
        {nav && <p className="warn-text small">⚠ This button takes the learner to another page. If it's the only way forward, removing it can leave learners stuck.</p>}
        <button className="danger" onClick={() => void remove()}>
          🗑 Remove{scope === 'all' && others.length ? ` from ${pages.length} pages` : ''}
        </button>
        <p className="hint">It's hidden rather than cut out of the page's code, so the page's scripts keep working. Undo, or restore it from this panel with nothing selected.</p>
      </div>
    </details>
  );
}

/** Where the selected object sits, as the page declares it. Drag it on the page, nudge with arrow keys, or type. */
function PositionObject({ el }: { el: Element }) {
  const s = useStore();
  const lv = useLive();
  const o = useMemo(() => live.selectedObject(el), [el, s.project?.files]); // eslint-disable-line react-hooks/exhaustive-deps
  const pages = useMemo(() => (o ? live.copiesAtSameSpot(o.page, o.id) : []), [o?.page, o?.id, s.project?.files]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!o) return null;
  const set = (axis: 'x' | 'y', value: string) => {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n) || n === o.at[axis]) return;
    void live.moveObject(o.doc, o.id, { ...o.at, [axis]: n });
  };
  return (
    <details className="section position-object" open>
      <summary>Position</summary>
      <div className="stack">
        <div className="xy">
          {(['x', 'y'] as const).map((axis) => (
            <label key={axis + o.at[axis]}>
              {axis.toUpperCase()}
              <input
                type="number"
                defaultValue={o.at[axis]}
                onBlur={(e) => set(axis, e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              />
            </label>
          ))}
        </div>
        {pages.length > 1 && (
          <div className="scope">
            <label className="check-row">
              <input type="radio" checked={lv.moveScope === 'all'} onChange={() => live.setMoveScope('all')} /> Move on all {pages.length} pages that have it here
            </label>
            <label className="check-row">
              <input type="radio" checked={lv.moveScope === 'page'} onChange={() => live.setMoveScope('page')} /> Move on this page only
            </label>
          </div>
        )}
        <p className="hint">
          Drag it on the page, or use the arrow keys (Shift for 10px). Copies on other pages at the same spot, including each
          chapter's own copy, move with it; a page that places it elsewhere keeps its own position.
        </p>
      </div>
    </details>
  );
}

/** Objects removed from the page on screen, with a way back. */
function RemovedObjects({ page }: { page: string | null }) {
  const s = useStore();
  const files = s.project!.files;
  const html = page && files[page] ? textOf(files[page]) : '';
  const ids = hiddenIds(html);
  const declared = useMemo(() => declaredObjects(html), [html]);
  // Every page each removed object is hidden on, for "restore everywhere".
  const hiddenOn = useMemo(() => {
    const out = new Map<string, string[]>();
    if (!ids.length) return out;
    for (const p of Object.keys(files)) {
      if (!/\.html?$/i.test(p)) continue;
      const t = textOf(files[p]);
      if (!t.includes('id="lc-removed"')) continue;
      for (const id of hiddenIds(t)) out.set(id, [...(out.get(id) ?? []), p]);
    }
    return out;
  }, [files, ids.join(' ')]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!page || !ids.length) return null;
  return (
    <details className="section" open>
      <summary>Removed on this page ({ids.length})</summary>
      <ul className="removed-list">
        {ids.map((id) => {
          const where = hiddenOn.get(id) ?? [page];
          return (
            <li key={id}>
              <span>{declared.get(id)?.name || id} <span className="mono muted small">{id}</span></span>
              <button onClick={() => void live.restoreObject(id, [page])}>Restore</button>
              {where.length > 1 && (
                <button title={`Restore on all ${where.length} pages it was removed from`} onClick={() => void live.restoreObject(id, where)}>
                  All {where.length}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </details>
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
  const [playing, setPlaying] = useState<string | null>(null);
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
      <RemovedObjects page={pagePath} />
      {assets.length === 0 && <p className="hint">No images, video or audio found on this page yet.</p>}
      {(filter === 'all' ? kinds : [filter]).map((k) => {
        const group = shown.filter((a) => a.kind === k);
        if (!group.length) return null;
        return (
          <details key={k} className="section" open>
            <summary>{KIND_LABEL[k]} ({group.length})</summary>
            <ul className="asset-list">
              {group.map((a) => (
                <AssetRow key={a.path} asset={a} playing={playing === a.path} onPlay={(on) => setPlaying(on ? a.path : null)} />
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

function AssetRow({ asset, playing, onPlay }: { asset: PageAsset; playing: boolean; onPlay: (on: boolean) => void }) {
  const s = useStore();
  const input = useRef<HTMLInputElement>(null);
  const src = vfsUrl(s.project!.id, asset.path) + '?v=' + (s.revisions[asset.path] ?? 0);
  const onScreen = asset.elements.find((e) => e.isConnected);
  const info = asset.kind === 'image' ? imageInfoOf(s.project!.files[asset.path]) : null;
  const playable = asset.kind === 'audio' || asset.kind === 'video';

  return (
    <li className="asset-row">
      <div className="asset-thumb">
        {asset.kind === 'image' ? <img src={src} alt="" loading="lazy" /> : <span>{KIND_ICON[asset.kind]}</span>}
      </div>
      <div className="asset-info">
        <div className="asset-name" title={asset.path}>{basename(asset.path)}</div>
        <div className="muted small asset-meta" title={asset.path}>
          {[
            info && info.format !== 'Unknown' ? info.format : extname(asset.path).toUpperCase(),
            info?.width && info.height ? `${info.width} × ${info.height} px` : '',
            formatBytes(asset.bytes),
            dirname(asset.path) && dirname(asset.path) + '/',
          ]
            .filter(Boolean)
            .join(' · ')}
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
        {playable && (
          <button className={playing ? 'active' : ''} title={playing ? 'Stop' : 'Play'} onClick={() => onPlay(!playing)}>
            {playing ? '■ Stop' : '▶ Play'}
          </button>
        )}
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
            if (f) await replaceChecked(asset.path, f);
          }}
        />
      </div>
      {playing && playable && (
        <div className="asset-extra">
          <MediaPlayer path={asset.path} autoPlay />
        </div>
      )}
      {asset.kind === 'image' && (
        <details className="asset-extra specs">
          <summary className="small">Replacement specs</summary>
          <ImageSpecs path={asset.path} element={onScreen} />
        </details>
      )}
    </li>
  );
}

/** Decoding image headers is cheap, but not free on a 5,000-image course; cache by file bytes. */
const infoCache = new WeakMap<Uint8Array, ImageInfo>();
function imageInfoOf(bytes: Uint8Array | undefined): ImageInfo | null {
  if (!bytes) return null;
  let info = infoCache.get(bytes);
  if (!info) {
    info = imageInfo(bytes);
    infoCache.set(bytes, info);
  }
  return info;
}

/** What a replacement image needs to be, read from the file itself. */
function ImageSpecs({ path, element }: { path: string; element?: Element }) {
  const s = useStore();
  const info = imageInfoOf(s.project!.files[path]);
  const [copied, setCopied] = useState(false);
  if (!info) return null;
  const size = info.width && info.height ? `${info.width} × ${info.height} px` : 'size unknown';
  const ratio = info.width && info.height ? aspectRatio(info.width, info.height) : '';
  // How big the page actually draws it, which can differ from the file's own size.
  const box = element && element.isConnected ? element.getBoundingClientRect() : null;
  const shown = box && box.width && box.height ? `${Math.round(box.width)} × ${Math.round(box.height)} px` : null;
  const mislabelled = formatFromName(path) && info.format !== 'Unknown' && formatFromName(path) !== info.format;
  const spec =
    info.format === 'SVG'
      ? `An SVG (vector) image${ratio ? ` with a ${ratio} shape (${size})` : ''}.`
      : `A ${info.format} image, ${size}${ratio ? ` (${ratio})` : ''}${info.transparent ? ', with a transparent background' : ''}.`;

  return (
    <div className="image-specs small">
      <dl>
        <dt>Type</dt>
        <dd>
          {info.format}
          {mislabelled ? ` (named .${extname(path)})` : ''}
          {info.animated ? ', animated' : ''}
        </dd>
        <dt>Size</dt>
        <dd>
          {size}
          {ratio ? ` · ${ratio}` : ''}
        </dd>
        {shown && (
          <>
            <dt>Shown at</dt>
            <dd>{shown} on this page</dd>
          </>
        )}
        <dt>Background</dt>
        <dd>{info.transparent === undefined ? 'n/a' : info.transparent ? 'transparent' : 'solid'}</dd>
      </dl>
      <p className="muted">
        To replace it, make {spec.charAt(0).toLowerCase() + spec.slice(1)} A larger image with the same shape is fine; it's scaled
        down.
      </p>
      <button
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(`${basename(path)}: ${spec}${shown ? ` Shown at ${shown}.` : ''}`);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            /* clipboard blocked; the specs are on screen anyway */
          }
        }}
      >
        {copied ? '✓ Copied' : 'Copy specs'}
      </button>
    </div>
  );
}

function formatTime(sec: number): string {
  if (!isFinite(sec)) return '';
  const m = Math.floor(sec / 60);
  return `${m}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
}

/** Plays an audio or video file from the package, with its length (and size, for video). */
function MediaPlayer({ path, autoPlay }: { path: string; autoPlay?: boolean }) {
  const s = useStore();
  const [meta, setMeta] = useState('');
  const src = vfsUrl(s.project!.id, path) + '?v=' + (s.revisions[path] ?? 0);
  const isVideo = assetKind(path) === 'video';
  const onMeta = (e: React.SyntheticEvent<HTMLMediaElement>) => {
    const m = e.currentTarget;
    const v = m as HTMLVideoElement;
    setMeta([formatTime(m.duration), isVideo && v.videoWidth ? `${v.videoWidth} × ${v.videoHeight} px` : ''].filter(Boolean).join(' · '));
  };
  const err = () => setMeta("This browser can't play this file (it may be a format such as FLV or SWF).");
  return (
    <div className="media-player">
      {isVideo ? (
        <video src={src} controls autoPlay={autoPlay} preload="metadata" onLoadedMetadata={onMeta} onError={err} />
      ) : (
        <audio src={src} controls autoPlay={autoPlay} preload="metadata" onLoadedMetadata={onMeta} onError={err} />
      )}
      {meta && <div className="muted small">{meta}</div>}
    </div>
  );
}

/** Replace an asset, first pointing out if the new image doesn't match the old one. */
async function replaceChecked(path: string, file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (isImageFile(path)) {
    const old = imageInfoOf(store.project?.files[path]);
    const next = imageInfo(bytes);
    const issues = old ? replacementMismatches(old, next) : [];
    if (issues.length && !confirm(`Replace ${basename(path)} with ${file.name}?\n\n• ${issues.join('\n\n• ')}`)) return;
  }
  await live.replaceAsset(path, file);
}
