import { useEffect, useState } from 'react';
import { CodeView } from './components/CodeView';
import { EditStage, handleEditorKey } from './components/EditStage';
import { LiveStage } from './components/LiveStage';
import { MatchChooser } from './components/MatchChooser';
import { PreviewStage } from './components/PreviewStage';
import { PropertiesPanel } from './components/PropertiesPanel';
import { PublishProgress } from './components/PublishProgress';
import { Sidebar } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import { Welcome } from './components/Welcome';
import { useStore } from './lib/store';

export function App() {
  const s = useStore();
  const [width, setWidth] = useState('100%');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (s.project && s.view === 'edit' && handleEditorKey(e)) e.preventDefault();
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

  if (!s.project) return <Welcome />;

  return (
    <div className="app">
      <Toolbar width={width} setWidth={setWidth} />
      <div className="workspace">
        <Sidebar />
        <main className="stage">
          {s.view === 'edit' && <EditStage width={width} />}
          {s.view === 'live' && <LiveStage width={width} />}
          {s.view === 'preview' && <PreviewStage width={width} />}
          {s.view === 'code' && <CodeView />}
        </main>
        <PropertiesPanel />
      </div>
      <footer className="statusbar">
        <span>{s.status}</span>
        <span className="spacer" />
        <span>{s.currentPath}</span>
        <span className={'save-' + s.saveState}>
          {{ saved: '✓ Saved', saving: 'Saving…', dirty: 'Unsaved changes', error: '⚠ Save failed' }[s.saveState]}
        </span>
      </footer>
      <MatchChooser />
      <PublishProgress />
    </div>
  );
}
