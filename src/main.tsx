import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ensureServiceWorker } from './lib/vfs';
import { installSyncRead } from './lib/syncRead';
import './styles.css';

// Course pages ask this window for files they load synchronously (see syncRead.ts).
installSyncRead();

// Register early so the preview server is ready by the time a project opens.
ensureServiceWorker().catch((e) => console.error(e));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
