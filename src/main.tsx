import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './components/App';
import { useStore } from './state/store';
import { renderRegion } from './pdf/pdfService';
import './styles.css';

// Opt-in hook for end-to-end tests (?e2e): lets a driver call store actions
// and rendering internals that are otherwise only reachable through canvas
// gestures.
if (new URLSearchParams(window.location.search).has('e2e')) {
  const w = window as unknown as Record<string, unknown>;
  w.__takeoffStore = useStore;
  w.__takeoffRenderRegion = renderRegion;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
