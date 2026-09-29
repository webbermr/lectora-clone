import { useEffect, useMemo, useRef, useState } from 'react';
import { flattenItems } from '../lib/manifest';
import { previewLms, type ScormLogEntry } from '../lib/scormApi';
import { store, useStore } from '../lib/store';
import { vfsUrl } from '../lib/vfs';
import { useFollowFrame } from '../lib/frameFollow';

/** Runs the course as an LMS would: scripts on, SCORM API available, item-by-item navigation. */
export function PreviewStage({ width }: { width: string }) {
  const s = useStore();
  const p = s.project!;
  const launchable = useMemo(() => flattenItems(p.manifest?.items ?? []).filter((i) => i.href), [p.manifest]);
  const idx = launchable.findIndex((i) => i.identifier === s.currentItemId);
  const item = idx >= 0 ? launchable[idx] : undefined;
  const path = item?.href ?? s.currentPath;
  const [nonce, setNonce] = useState(0);
  const [log, setLog] = useState<ScormLogEntry[]>(() => [...previewLms.log]);
  const [showLog, setShowLog] = useState(false);
  const logEnd = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  useFollowFrame(frame, p.id);

  useEffect(() => {
    previewLms.install(window);
    return previewLms.onLog(() => setLog([...previewLms.log]));
  }, []);

  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: 'end' });
  }, [log, showLog]);

  const go = (d: number) => {
    const next = launchable[idx + d];
    if (next) store.openPage(next.href!, next.identifier);
  };

  if (!path) return <div className="stage-empty">Nothing to preview. Select a page first.</div>;
  const src = vfsUrl(p.id, path) + (item?.query ?? '');

  return (
    <div className="preview">
      <div className="preview-bar">
        <button onClick={() => go(-1)} disabled={idx <= 0}>◀ Prev</button>
        <span className="preview-title">{item ? `${idx + 1} / ${launchable.length} · ${item.title}` : path}</span>
        <button onClick={() => go(1)} disabled={idx < 0 || idx >= launchable.length - 1}>Next ▶</button>
        <button onClick={() => setNonce((n) => n + 1)} title="Reload the page">⟳ Reload</button>
        <span className="spacer" />
        <span className="lms-status">LMS {previewLms.summary()}</span>
        <button onClick={() => setShowLog((v) => !v)}>{showLog ? 'Hide' : 'Show'} SCORM log ({log.length})</button>
        <button
          onClick={() => {
            previewLms.reset();
            setLog([]);
            setNonce((n) => n + 1);
          }}
          title="Clear all tracking data, as if a new learner launched the course"
        >
          Reset LMS data
        </button>
      </div>
      <div className="preview-body">
        <div className="stage-scroll">
          <div className="stage-frame" style={{ width }}>
            <iframe ref={frame} key={`${src}#${nonce}`} src={src} title="Course preview" className="stage-iframe" allow="autoplay; fullscreen" />
          </div>
        </div>
        {showLog && (
          <div className="scorm-log">
            {log.length === 0 && <div className="muted">No SCORM calls yet.</div>}
            {log.map((l, i) => (
              <div key={i} className="log-row">
                <b>{l.call}</b>({l.args.map((a) => JSON.stringify(a)).join(', ')}) → {JSON.stringify(l.result)}
              </div>
            ))}
            <div ref={logEnd} />
          </div>
        )}
      </div>
    </div>
  );
}
