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
import { useStore } from './lib/store';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ScormAssistant } from './components/ScormAssistant';

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
      </ErrorBoundary>
      <ErrorBoundary area="SCORM assistant">
        <ScormAssistant />
      </ErrorBoundary>
      <ProgressWindow />
    </div>
  );
}
