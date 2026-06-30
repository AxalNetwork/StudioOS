import React from 'react';
import { useLocation } from 'react-router-dom';
import { AlertTriangle, RefreshCcw, Home } from 'lucide-react';
import { reportError } from '../lib/log';

/**
 * Page-level error boundary that wraps the lazy `<Routes>` tree.
 *
 * Without this boundary, ANY render-time throw inside a lazily-loaded
 * page component (missing import, bad data shape, undefined access)
 * bubbles past `<Suspense>` and blanks the entire React tree — every
 * route, including /login, goes blank. That's the "blank pages happen
 * across the platform often" pattern the user reported.
 *
 * Behaviour:
 *   - Catches errors from page render/lifecycle.
 *   - Logs once via `reportError` for triage.
 *   - Renders an explicit, visible error state (NOT silent) with the
 *     error message, a "Try again" button (resets boundary state so
 *     the route re-renders fresh), and a "Back to Studio" link.
 *   - Resets automatically when the URL pathname changes, so navigating
 *     away from the broken page recovers without a hard reload.
 *
 * Per replit.md user prefs: "explicit error handling over silent
 * fallbacks" — we deliberately surface the failure with the underlying
 * message so the user knows what's wrong and the next reload of the
 * agent has a starting clue.
 */

// Chunk/dynamic-import failure phrases across all major browsers:
//   Chrome:  "Failed to fetch dynamically imported module"
//            "error loading dynamically imported module"
//   WebKit/Safari: "Importing a module script failed."
//                  "module script failed to load"
//   Firefox: "error loading dynamically imported module"
//   Webpack: "ChunkLoadError" / "Loading chunk NNN failed"
//   Vite:    "Failed to load module script"
const CHUNK_LOAD_RE = /chunk|loading chunk|chunkloaderror|failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|module script failed to load|failed to load module script/i;

function isChunkLoadError(error) {
  if (!error) return false;
  if (error.name === 'ChunkLoadError') return true;
  const msg = String(error.message || error);
  return CHUNK_LOAD_RE.test(msg);
}

// sessionStorage key used to prevent auto-reload loops.
const RELOAD_GUARD_KEY = 'axal:chunk-reload-boundary';

class RouteErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, reloading: false };
  }

  static getDerivedStateFromError(error) {
    // Decide synchronously — before the first error render — whether this is a
    // recoverable stale-chunk failure we're going to auto-reload from. When it
    // is, we render a calm "updating" splash instead of the alarming error
    // card, so the red card never flashes during the reload. The reload itself
    // is fired from componentDidCatch; this stays side-effect-free and only
    // reads the one-shot guard so its decision mirrors componentDidCatch's.
    let reloading = false;
    if (isChunkLoadError(error)) {
      try {
        reloading = sessionStorage.getItem(RELOAD_GUARD_KEY) !== '1';
      } catch {
        reloading = false; // sessionStorage blocked → can't auto-reload; show the card
      }
    }
    return { error, reloading };
  }

  componentDidCatch(error, info) {
    try {
      reportError('route-error-boundary', error);
      if (typeof console !== 'undefined' && info?.componentStack) {
        // eslint-disable-next-line no-console
        console.error('[RouteErrorBoundary]', error, info.componentStack);
      }
    } catch { /* never let the boundary itself throw */ }

    // Auto-recover from chunk-load failures exactly once per session.
    // The guard is cleared on a successful app load (see main.jsx), so
    // it only loops-stops if the chunk is permanently broken.
    if (isChunkLoadError(error)) {
      let willReload = false;
      try {
        if (sessionStorage.getItem(RELOAD_GUARD_KEY) !== '1') {
          sessionStorage.setItem(RELOAD_GUARD_KEY, '1');
          willReload = true;
          window.location.reload();
        }
      } catch { /* sessionStorage blocked / write failed — fall through to the card */ }
      // If we are NOT actually reloading (guard already spent, sessionStorage
      // blocked, or the write threw), don't strand the user on the calm
      // "updating" splash that getDerivedStateFromError optimistically chose —
      // flip back to the actionable error card with its explicit Reload button.
      if (!willReload) {
        this.setState({ reloading: false });
      }
    }
  }

  componentDidUpdate(prevProps) {
    // Reset on route change so a user navigating away from the broken
    // page recovers cleanly without needing a hard reload.
    if (this.state.error && prevProps.pathname !== this.props.pathname) {
      this.setState({ error: null, reloading: false });
    }
  }

  handleRetry = () => {
    this.setState({ error: null, reloading: false });
  };

  handleChunkReload = () => {
    try { sessionStorage.removeItem(RELOAD_GUARD_KEY); } catch {}
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    // Recoverable stale-chunk failure: we're auto-reloading to pick up the
    // freshly deployed build. Show a calm, neutral splash (matching the app's
    // Suspense loading state) instead of the alarming red error card — the page
    // reloads a beat later. The red card is reserved for failures we can't
    // silently recover from (a real render error, or a chunk error where the
    // one-shot reload guard is already spent / sessionStorage is blocked).
    if (this.state.reloading) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-white dark:bg-gray-950 px-4 text-gray-500 dark:text-gray-400">
          <RefreshCcw size={22} className="animate-spin" aria-hidden="true" />
          <p className="text-sm" role="status" aria-live="polite">
            Updating to the latest version…
          </p>
        </div>
      );
    }

    const msg = this.state.error?.message || String(this.state.error) || 'Unknown error';
    const isChunk = isChunkLoadError(this.state.error);

    return (
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-gray-950 px-4 py-12">
        <div
          role="alert"
          aria-live="assertive"
          className="max-w-lg w-full border border-red-200 dark:border-red-900/50 rounded-xl bg-red-50/70 dark:bg-red-950/30 p-6"
        >
          <div className="mb-4 inline-flex items-center justify-center w-11 h-11 rounded-full bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-300">
            <AlertTriangle size={20} aria-hidden="true" />
          </div>
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
            This page hit an unexpected error
          </h1>
          <p className="text-sm text-gray-700 dark:text-gray-300 mb-4 leading-relaxed">
            {isChunk
              ? 'A new version of the app was just deployed. Reload to pick it up.'
              : 'The page failed to render. The team has been notified. You can try again, or head back to Studio.'}
          </p>
          <pre className="text-xs font-mono text-red-700 dark:text-red-300 bg-white/60 dark:bg-black/30 border border-red-200 dark:border-red-900/40 rounded-md p-3 mb-5 whitespace-pre-wrap break-words max-h-40 overflow-auto">
            {msg}
          </pre>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
            <button
              type="button"
              onClick={isChunk ? this.handleChunkReload : this.handleRetry}
              className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-2.5 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-sm font-medium hover:bg-gray-800 dark:hover:bg-white transition-colors"
            >
              <RefreshCcw size={15} aria-hidden="true" />
              {isChunk ? 'Reload' : 'Try again'}
            </button>
            <a
              href="/studio"
              className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              <Home size={15} aria-hidden="true" />
              Back to Studio
            </a>
          </div>
        </div>
      </div>
    );
  }
}

// Functional wrapper so we can inject `pathname` from react-router and
// auto-reset the boundary when the user navigates away from a broken
// page.
export default function RouteErrorBoundaryWithLocation({ children }) {
  const { pathname } = useLocation();
  return <RouteErrorBoundary pathname={pathname}>{children}</RouteErrorBoundary>;
}
