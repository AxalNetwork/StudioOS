import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import ScrollToTop from './components/ScrollToTop';
import TopLevelErrorBoundary from './components/TopLevelErrorBoundary';
import './index.css';
import { registerServiceWorker } from './lib/pwa';

// Task #37 — tell the un-bundled boot watchdog (index.html) that the entry
// module actually executed, so it won't trigger a recovery reload. Also strip
// the `?__reboot=` cache-busting param the watchdog appends, so it doesn't
// linger in the URL once we've successfully booted.
try {
  window.__axalBooted = true;
  const _u = new URL(window.location.href);
  if (_u.searchParams.has('__reboot')) {
    _u.searchParams.delete('__reboot');
    window.history.replaceState(null, '', _u.pathname + _u.search + _u.hash);
  }
} catch { /* no window / URL — nothing to do */ }

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
// One-shot, SW-cache-clearing hard reload. sessionStorage guards against a
// reload loop if the failure is permanent (CDN broken, etc.); the guard is
// cleared on a successful load (below).
function reloadOnceForStaleChunk() {
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
function recoverFromStaleChunk(reason) {
  if (!isChunkLoadError(reason)) return;
  reloadOnceForStaleChunk();
}
window.addEventListener('error', (e) => recoverFromStaleChunk(e.error || e.message));
window.addEventListener('unhandledrejection', (e) => recoverFromStaleChunk(e.reason));
// Vite dispatches `vite:preloadError` when a dynamically-imported chunk fails
// to load — the canonical stale-chunk-after-deploy signal (e.g. logging out
// redirects into the lazy /login chunk whose hashed filename no longer exists
// after a mid-session deploy). preventDefault() stops Vite's default rethrow;
// we reload once to pick up the new asset manifest so the failure never reaches
// the error boundary as a visible throw.
window.addEventListener('vite:preloadError', (e) => {
  try { e.preventDefault(); } catch { /* ignore */ }
  reloadOnceForStaleChunk();
});
// Clear both chunk-reload guard flags once the app successfully renders,
// so the next real chunk failure can trigger a fresh auto-recovery.
window.addEventListener('load', () => {
  setTimeout(() => {
    try { sessionStorage.removeItem('axal:chunk-reload'); } catch {}
    try { sessionStorage.removeItem('axal:chunk-reload-boundary'); } catch {}
    // Task #37 — the app booted, so clear the boot-watchdog guard too; the
    // next real entry-chunk failure (e.g. a future deploy) can recover again.
    try { sessionStorage.removeItem('axal:boot-reboot'); } catch {}
  }, 5000);
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <TopLevelErrorBoundary>
      <BrowserRouter>
        <ScrollToTop />
        <App />
      </BrowserRouter>
    </TopLevelErrorBoundary>
  </React.StrictMode>
);

// Task #57 — register the PWA service worker (after the app mounts, so
// the first paint is never delayed by SW install work).
registerServiceWorker();
