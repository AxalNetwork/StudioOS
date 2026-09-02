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
  // Remove the dev-diagnostic banner once JS is executing
  const _diag = document.getElementById('dev-diag');
  if (_diag) _diag.remove();
  const _root = document.getElementById('root');
  if (_root) _root.style.paddingTop = '';
  // `?__reboot=` is the boot watchdog's STORAGE-FREE loop guard. Tidying it out
  // of the URL is only safe when the watchdog's other guard — sessionStorage —
  // actually works; where writes throw, stripping it leaves the watchdog with
  // no bound at all and the next failed boot reloads forever.
  let _storageWorks = false;
  try {
    sessionStorage.setItem('axal:probe', '1');
    sessionStorage.removeItem('axal:probe');
    _storageWorks = true;
  } catch { /* blocked — keep the URL marker as the only remaining guard */ }
  const _u = new URL(window.location.href);
  if (_storageWorks && _u.searchParams.has('__reboot')) {
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
// SW-cache-clearing hard reload, bounded to MAX_CHUNK_RELOADS per tab.
//
// THIS USED TO LOOP FOREVER, in two independent ways, and both produced
// Safari's "This webpage was reloaded because a problem occurred".
//
// 1. The guard was a single flag that a `load` handler CLEARED five seconds
//    later (see below). A chunk that failed more than five seconds after load —
//    which is every lazily-imported route chunk — therefore found the guard
//    clear, reloaded, booted, had the guard cleared again, failed again, and
//    reloaded again. "Once" only ever meant "once per five-second window", so a
//    permanently missing chunk (the stale-deploy case this code exists for) was
//    an unbounded reload loop.
//
// 2. The reload sat AFTER the try/catch, so when `sessionStorage.setItem` threw
//    — Safari Private Browsing, and any profile with site data blocked — the
//    write failed, the throw was swallowed, and the reload ran with no guard at
//    all. `RouteErrorBoundary` already had this right: its reload is inside the
//    try, so a blocked write falls through to the error card instead.
//
// So: a counter rather than a flag, never cleared on a timer, with a URL marker
// as the storage-free half. A tab that survives two deploys still recovers from
// both; a genuinely broken chunk stops after MAX_CHUNK_RELOADS and lets the
// error boundary render something a person can act on.
const CHUNK_KEY = 'axal:chunk-reload-attempts';
const MAX_CHUNK_RELOADS = 2;

function chunkReloadAttempts() {
  try {
    const n = parseInt(sessionStorage.getItem(CHUNK_KEY) || '0', 10);
    if (Number.isFinite(n) && n > 0) return n;
  } catch { /* storage blocked — fall through to the URL marker */ }
  try {
    const m = /[?&]__chunk=(\d+)/.exec(window.location.search);
    if (m) return parseInt(m[1], 10) || 0;
  } catch { /* location unreadable */ }
  return 0;
}

function reloadOnceForStaleChunk() {
  const attempts = chunkReloadAttempts();
  if (attempts >= MAX_CHUNK_RELOADS) return;
  const next = attempts + 1;
  try { sessionStorage.setItem(CHUNK_KEY, String(next)); } catch { /* URL marker below carries it */ }
  // Drop SW caches first so the next load isn't fed another stale chunk.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations()
      .then((regs) => Promise.all(regs.map((r) => r.unregister().catch(() => {}))))
      .catch(() => {})
      .finally(() => {
        if (window.caches && caches.keys) {
          caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k).catch(() => {}))))
            .catch(() => {})
            .finally(() => reloadCarryingCount(next));
        } else {
          reloadCarryingCount(next);
        }
      });
  } else {
    reloadCarryingCount(next);
  }
}

// The attempt count rides in the URL as well as in sessionStorage, so the bound
// still holds in a browser that refuses the write.
function reloadCarryingCount(n) {
  try {
    const u = new URL(window.location.href);
    u.searchParams.set('__chunk', String(n));
    window.location.replace(u.toString());
  } catch {
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
// THE GUARDS ARE NOT CLEARED ON A TIMER, and that removal is the fix.
//
// This used to wipe all three five seconds after `load`, so that "the next real
// chunk failure can trigger a fresh auto-recovery". The cost was that the
// guards only bounded failures occurring within those five seconds. A lazy
// route chunk that 404s when the user clicks — the ordinary case after a deploy
// — always found them cleared, so every reload restored the conditions for the
// next one and the tab reloaded until the browser gave up.
//
// The bound is now a per-tab attempt count instead (see above), which is the
// right lifetime: sessionStorage dies with the tab, so a new tab gets a fresh
// budget without any timer resetting one mid-session.
//
// The boundary's own guard is cleared only by its explicit Reload button
// (`RouteErrorBoundary.handleChunkReload`), which is a person deciding to try
// again rather than a timer deciding for them.
//
// `axal:boot-reboot` is likewise left alone. Clearing it while `main.jsx` also
// strips `?__reboot=` from the URL removed BOTH of the boot watchdog's loop
// guards at once, which is the same unbounded-reload shape one layer down.

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
