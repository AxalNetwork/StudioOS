import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import TopLevelErrorBoundary from './components/TopLevelErrorBoundary';
import './index.css';
import { registerServiceWorker } from './lib/pwa';

// Recover from stale chunk loads after a deploy. The most common cause of a
// blank production page is a dynamic import 404 — the user has an old HTML
// (or SW-cached HTML) referencing a hashed JS chunk that no longer exists.
// We hard-reload once on detection; sessionStorage prevents reload loops if
// the failure is permanent (CDN broken, etc.).
function isChunkLoadError(reason) {
  if (!reason) return false;
  const msg = String(reason.message || reason);
  return (
    reason.name === 'ChunkLoadError' ||
    /Loading chunk [\w-]+ failed/i.test(msg) ||
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg)
  );
}
function recoverFromStaleChunk(reason) {
  if (!isChunkLoadError(reason)) return;
  try {
    if (sessionStorage.getItem('axal:chunk-reload') === '1') return;
    sessionStorage.setItem('axal:chunk-reload', '1');
  } catch { /* sessionStorage blocked — still safer to reload than to blank */ }
  // Drop SW caches first so the next load isn't fed another stale chunk.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations()
      .then((regs) => Promise.all(regs.map((r) => r.unregister().catch(() => {}))))
      .catch(() => {})
      .finally(() => {
        if (window.caches && caches.keys) {
          caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k).catch(() => {}))))
            .catch(() => {})
            .finally(() => window.location.reload());
        } else {
          window.location.reload();
        }
      });
  } else {
    window.location.reload();
  }
}
window.addEventListener('error', (e) => recoverFromStaleChunk(e.error || e.message));
window.addEventListener('unhandledrejection', (e) => recoverFromStaleChunk(e.reason));
// Clear both chunk-reload guard flags once the app successfully renders,
// so the next real chunk failure can trigger a fresh auto-recovery.
window.addEventListener('load', () => {
  setTimeout(() => {
    try { sessionStorage.removeItem('axal:chunk-reload'); } catch {}
    try { sessionStorage.removeItem('axal:chunk-reload-boundary'); } catch {}
  }, 5000);
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <TopLevelErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </TopLevelErrorBoundary>
  </React.StrictMode>
);

// Task #57 — register the PWA service worker (after the app mounts, so
// the first paint is never delayed by SW install work).
registerServiceWorker();
