import { useEffect, useState } from 'react';
import { undoShortcut } from './lib/undoKeys';
import { CodeView } from './components/CodeView';
import { DeleteDialog } from './components/DeleteDialog';
import { EditStage, handleEditorKey } from './components/EditStage';
import { LiveStage } from './components/LiveStage';
import { MatchChooser } from './components/MatchChooser';
import { PreviewStage } from './components/PreviewStage';
import { PropertiesPanel } from './components/PropertiesPanel';
import { ProgressWindow } from './components/ProgressWindow';
import { Sidebar } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import { Welcome } from './components/Welcome';
import { store, useStore } from './lib/store';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ScormAssistant } from './components/ScormAssistant';
import { PublishDialog } from './components/PublishDialog';

export function App() {
  const s = useStore();
  const [width, setWidth] = useState('100%');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!s.project) return;
      if (s.view === 'edit' ? handleEditorKey(e) : undoShortcut(e)) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [s.project, s.view]);

  // Tells course pages which view shows them (vfs-sync.js): in Live edit nothing on a page starts by itself.
  useEffect(() => {
    const w = window as unknown as { __lcStage?: string; __lcOnHeld?: (what: string) => void };
    w.__lcStage = s.view;
    w.__lcOnHeld = (what) =>
      store.setStatus(
        what === 'narration'
          ? 'Live edit doesn\'t start narration or video by itself; press play on the page to hear it. Preview plays the course as learners see it.'
          : what === 'timer'
            ? 'A timer on this page ran out; Live edit doesn\'t act on timers (session timeout, auto-advance counters). Preview runs them as learners see them.'
          : `Live edit held back an automatic move to ${what}. Use Interact (I) and click Next to move on, or Preview to run the course as learners see it.`,
      );
  }, [s.view]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (s.saveState === 'dirty' || s.saveState === 'saving') e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [s.saveState]);

  if (!s.project) {
    return (
      <>
        <Welcome />
        <ProgressWindow />
      </>
    );
  }

  return (
    <div className="app">
      <Toolbar width={width} setWidth={setWidth} />
      <div className="workspace">
        <ErrorBoundary area="sidebar">
          <Sidebar />
        </ErrorBoundary>
        <main className="stage">
          <ErrorBoundary area={`${s.view} view`} key={s.view}>
            {s.view === 'edit' && <EditStage width={width} />}
            {s.view === 'live' && <LiveStage width={width} />}
            {s.view === 'preview' && <PreviewStage width={width} />}
            {s.view === 'code' && <CodeView />}
          </ErrorBoundary>
        </main>
        <ErrorBoundary area="properties panel" key={s.currentPath ?? ''}>
          <PropertiesPanel />
        </ErrorBoundary>
      </div>
      <footer className="statusbar">
        <span className="status-msg" title={s.status}>{s.status}</span>
        <span className="spacer" />
        <span className="status-path">{s.viewingPath ?? s.currentPath}</span>
        <span className={'save-' + s.saveState}>
          {{ saved: '✓ Saved', saving: 'Saving…', dirty: 'Unsaved changes', error: '⚠ Save failed' }[s.saveState]}
        </span>
      </footer>
      <ErrorBoundary area="dialog">
        <MatchChooser />
        <DeleteDialog />
        <PublishDialog />
      </ErrorBoundary>
      <ErrorBoundary area="SCORM assistant">
        <ScormAssistant />
      </ErrorBoundary>
      <ProgressWindow />
    </div>
  );
}
