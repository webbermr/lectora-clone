import { useMemo, useRef } from 'react';
import { live, textNodesOf, useLive } from '../lib/live';
import { isImageFile } from '../lib/paths';
import { visibleText } from '../lib/sourceMatch';
import { useStore } from '../lib/store';
import { vfsUrl } from '../lib/vfs';

/** Properties for the element selected in Live edit. */
export function LivePanel() {
  const lv = useLive();
  const el = lv.selected;
  if (!el || !el.isConnected) {
    return (
      <>
        <p className="hint">
          <b>Live edit</b> runs the page with its JavaScript, the way learners see it. Use it when the Edit view is
          blank, which happens when an authoring tool (Lectora, Storyline, Captivate…) builds the page with scripts.
        </p>
        <p className="hint">
          Click any text or image on the page. Its text shows up here along with the source file it lives in. Change
          it and press Save, or double-click the text on the page to type straight over it.
        </p>
        <p className="hint">
          To reach a later screen of a single-page player, switch to <b>Interact</b>, click through to it, then switch
          back.
        </p>
      </>
    );
  }
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
                if (f) await live.replaceAsset(asset.path, f, el);
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
