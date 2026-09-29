import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ensureServiceWorker } from './lib/vfs';
import './styles.css';

// Register early so the preview server is ready by the time a project opens.
ensureServiceWorker().catch((e) => console.error(e));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
