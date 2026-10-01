import { Fragment, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { textOf } from '../lib/assetRefs';
import { declarations } from '../lib/lectoraDecl';
import { live } from '../lib/live';
import { store, useStore } from '../lib/store';
import { encodeText } from '../lib/text';
import type { ChatItem, EditorContext, ScormChat } from '../lib/scorm/agent';
import { endpoint, loadConnection, saveMode, saveOwnKey, type Connection } from '../lib/scorm/connection';
import { applyProposal, proposalProblem, type Proposal } from '../lib/scorm/tools';

const VIEW_NAMES: Record<string, string> = { edit: 'Edit', live: 'Live edit', preview: 'Preview', code: 'Code' };

/** Short Markdown (paragraphs, lists, **bold**, `code`) as React elements; no HTML from the model is ever inserted. */
function Markdown({ text }: { text: string }) {
  const inline = (s: string, key: string): ReactNode[] =>
    s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
      part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
        <strong key={`${key}-${i}`}>{part.slice(2, -2)}</strong>
      ) : part.startsWith('`') && part.endsWith('`') && part.length > 2 ? (
        <code key={`${key}-${i}`}>{part.slice(1, -1)}</code>
      ) : (
        <Fragment key={`${key}-${i}`}>{part}</Fragment>
      ),
    );
  const blocks = text.trim().split(/\n{2,}/);
  return (
    <>
      {blocks.map((b, bi) => {
        const lines = b.split('\n');
        if (lines.every((l) => /^\s*([-*]|\d+\.)\s+/.test(l))) {
          const ordered = /^\s*\d+\./.test(lines[0]);
          const items = lines.map((l, li) => <li key={li}>{inline(l.replace(/^\s*([-*]|\d+\.)\s+/, ''), `${bi}-${li}`)}</li>);
          return ordered ? <ol key={bi}>{items}</ol> : <ul key={bi}>{items}</ul>;
        }
        if (/^```/.test(b)) return <pre key={bi}>{b.replace(/^```\w*\n?|```$/g, '')}</pre>;
        return (
          <p key={bi}>
            {lines.map((l, li) => (
              <Fragment key={li}>
                {li > 0 && <br />}
                {inline(l.replace(/^#+\s*/, ''), `${bi}-${li}`)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </>
  );
}

/** What's on screen, for the question. */
function editorContext(): EditorContext {
  const s = store;
  const page = s.viewingPath ?? s.currentPath;
  const html = page && s.project?.files[page] ? textOf(s.project.files[page]) : '';
  let selected: EditorContext['selected'] = null;
  if (s.view === 'live') {
    const sel = live.selectedObject();
    if (sel) selected = { id: sel.id, name: declarations(textOf(s.project!.files[sel.page] ?? new Uint8Array())).get(sel.id)?.name ?? '' };
  }
  return {
    courseName: s.project?.name ?? '',
    view: VIEW_NAMES[s.view] ?? s.view,
    page,
    pageTitle: /<title>([^<]*)<\/title>/i.exec(html)?.[1]?.trim(),
    selected,
  };
}

function ProposalCard({ item, chat }: { item: Extract<ChatItem, { kind: 'proposal' }>; chat: ScormChat }) {
  const p: Proposal = item.proposal;
  const apply = async () => {
    const files = store.project?.files;
    if (!files) return;
    const problem = proposalProblem(files, p);
    if (problem) {
      chat.settle(p.id, 'failed', problem);
      return;
    }
    await store.write(`SCORM: ${p.summary}`, [{ path: p.path, bytes: encodeText(applyProposal(files, p)) }]);
    store.setStatus(`Applied SCORM's change to ${p.path}. Undo with Ctrl+Z (⌘Z).`);
    chat.settle(p.id, 'applied');
  };
  return (
    <div className={`scorm-proposal scorm-${item.state}`}>
      <div className="scorm-proposal-head">
        <strong>{p.summary}</strong>
        <span className="muted small">{p.path}</span>
      </div>
      <pre className="scorm-diff">
        <span className="del">{p.find}</span>
        <span className="ins">{p.replace}</span>
      </pre>
      {item.state === 'pending' ? (
        <div className="row">
          <button className="primary" onClick={() => void apply()}>
            Apply
          </button>
          <button onClick={() => chat.settle(p.id, 'dismissed')}>Dismiss</button>
        </div>
      ) : (
        <p className="small muted">
          {item.state === 'applied' ? 'Applied (undo with Ctrl+Z / ⌘Z).' : item.state === 'dismissed' ? 'Dismissed.' : `Couldn't apply: ${item.note}`}
        </p>
      )}
    </div>
  );
}

function Setup({ conn, onDone }: { conn: Connection; onDone: (c: Connection) => void }) {
  const [key, setKey] = useState('');
  return (
    <div className="scorm-setup stack">
      <p>
        SCORM uses Claude, from Anthropic, to answer questions about this course and suggest fixes. Your questions, and the course files SCORM
        reads to answer them, are sent to Anthropic.
      </p>
      {conn.server && (
        <label className="check-row">
          <input
            type="radio"
            checked={conn.mode === 'server'}
            onChange={() => {
              saveMode('server');
              onDone({ ...conn, mode: 'server' });
            }}
          />{' '}
          Use this editor's server key
        </label>
      )}
      {!conn.server && <p className="small muted">This editor's server has no Anthropic key set up, so enter your own.</p>}
      <label className="stack small">
        Your own Anthropic API key (kept only in this browser)
        <input type="password" value={key} placeholder={conn.ownKey ? 'A key is saved; enter a new one to replace it' : 'sk-ant-…'} onChange={(e) => setKey(e.target.value)} />
      </label>
      <div className="row">
        <button
          className="primary"
          disabled={!key.trim()}
          onClick={() => {
            saveOwnKey(key.trim());
            saveMode('own');
            onDone({ ...conn, ownKey: key.trim(), mode: 'own' });
          }}
        >
          Use my key
        </button>
        {conn.ownKey && (
          <button
            onClick={() => {
              saveOwnKey(null);
              const next: Connection = { ...conn, ownKey: null, mode: conn.server ? 'server' : null };
              if (conn.server) saveMode('server');
              onDone(next);
            }}
          >
            Forget my key
          </button>
        )}
      </div>
    </div>
  );
}

/** The floating "Ask SCORM" button and chat. */
export function ScormAssistant() {
  const s = useStore();
  const [open, setOpen] = useState(false);
  const [conn, setConn] = useState<Connection | null>(null);
  const [settings, setSettings] = useState(false);
  const [chat, setChat] = useState<ScormChat | null>(null);
  const [draft, setDraft] = useState('');
  const body = useRef<HTMLDivElement>(null);
  useSyncExternalStore(chat?.subscribe ?? noSubscribe, chat?.getVersion ?? zero);

  useEffect(() => {
    if (open && !conn) void loadConnection().then(setConn);
  }, [open, conn]);

  // A new chat for each connection (and each project); the SDK loads only when SCORM is first used.
  const setup = conn ? endpoint(conn) : null;
  const projectId = s.project?.id;
  useEffect(() => {
    if (!setup) {
      setChat(null);
      return;
    }
    let live = true;
    void import('../lib/scorm/agent').then(({ ScormChat }) => {
      if (live) setChat(new ScormChat(setup));
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setup?.apiKey, setup?.baseURL, projectId]);

  useEffect(() => {
    body.current?.scrollTo({ top: body.current.scrollHeight });
  }, [chat?.version, open]);

  if (!s.project) return null;

  const send = () => {
    const q = draft.trim();
    if (!q || !chat || chat.busy) return;
    setDraft('');
    void chat.ask(q, editorContext(), () => ({ files: store.project!.files, manifest: store.project!.manifest, courseName: store.project!.name }));
  };

  if (!open) {
    return (
      <button className="scorm-fab" onClick={() => setOpen(true)} title="Ask SCORM about this course or page">
        <span aria-hidden="true">✦</span> Ask SCORM
      </button>
    );
  }

  const page = s.viewingPath ?? s.currentPath;
  const needsSetup = conn && (!conn.mode || settings);
  return (
    <section className="scorm-panel" aria-label="Ask SCORM">
      <header className="scorm-head">
        <strong>Ask SCORM</strong>
        <span className="muted small scorm-on" title={page ?? ''}>
          {page ? `On ${page.split('/').pop()}` : 'No page open'}
        </span>
        <span className="spacer" />
        {chat && chat.items.length > 0 && (
          <button className="link" onClick={() => chat.clear()} title="Start a new conversation">
            New
          </button>
        )}
        <button className="link" onClick={() => setSettings((v) => !v)} title="SCORM settings">
          ⚙
        </button>
        <button className="link" onClick={() => setOpen(false)} title="Close">
          ✕
        </button>
      </header>
      <div className="scorm-body" ref={body}>
        {!conn && <p className="muted small">Connecting…</p>}
        {conn && needsSetup && (
          <Setup
            conn={conn}
            onDone={(c) => {
              setConn(c);
              setSettings(false);
            }}
          />
        )}
        {conn && !needsSetup && chat && chat.items.length === 0 && (
          <div className="scorm-empty small muted">
            <p>Ask about this page or the whole course. For example:</p>
            <ul>
              {['Why does Next not appear on this page?', 'What happens if a learner is inactive?', 'Is anything broken on this page?', 'Change "Monitoring" to "Monitoring Services" in the page title'].map((q) => (
                <li key={q}>
                  <button className="link" onClick={() => setDraft(q)}>
                    {q}
                  </button>
                </li>
              ))}
            </ul>
            <p>SCORM can read any file in the package. It suggests changes for you to apply; it never changes files by itself.</p>
          </div>
        )}
        {!needsSetup &&
          chat?.items.map((item, i) => {
            switch (item.kind) {
              case 'user':
                return (
                  <div key={i} className="scorm-msg scorm-user">
                    {item.text}
                  </div>
                );
              case 'assistant':
                return (
                  <div key={i} className="scorm-msg scorm-assistant">
                    <Markdown text={item.text} />
                  </div>
                );
              case 'tool':
                return (
                  <div key={i} className={`scorm-tool small ${item.error ? 'warn-text' : 'muted'}`}>
                    {item.label}
                  </div>
                );
              case 'proposal':
                return <ProposalCard key={i} item={item} chat={chat} />;
              case 'error':
                return (
                  <div key={i} className="scorm-error small">
                    {item.text}
                  </div>
                );
            }
          })}
        {chat?.busy && <div className="scorm-tool small muted">SCORM is working…</div>}
      </div>
      {!needsSetup && conn?.mode && (
        <footer className="scorm-foot">
          <textarea
            rows={2}
            value={draft}
            placeholder="Ask SCORM about this page or course…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          {chat?.busy ? (
            <button onClick={() => chat.stop()}>Stop</button>
          ) : (
            <button className="primary" disabled={!draft.trim() || !chat} onClick={send}>
              Ask
            </button>
          )}
        </footer>
      )}
    </section>
  );
}

const noSubscribe = () => () => {};
const zero = () => 0;
