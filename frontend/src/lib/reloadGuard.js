/**
 * The one implementation of "reload the page, but only so many times".
 *
 * WHY THIS EXISTS. Four places in this app reload the page to recover from
 * something: the boot watchdog in `index.html`, the stale-chunk recovery in
 * `main.jsx`, `RouteErrorBoundary`, and the service-worker update in `pwa.js`.
 * Each needs a bound, because an unbounded recovery reload is a reload loop —
 * and Safari reports one as "This webpage was reloaded because a problem
 * occurred", which is the symptom that has now been chased three times.
 *
 * Three of the four learned the same two lessons the hard way, each in its own
 * copy of the logic. `pwa.js` had learned neither: its guard was a module-local
 * `let` that died with the document, so it bounded one reload PER PAGE LOAD,
 * which is not a bound on a loop at all. This module is the shared answer, so a
 * fifth caller cannot arrive without the lessons.
 *
 * THE TWO LESSONS, both paid for in production:
 *
 *   1. THE BOUND IS A COUNT, NOT A FLAG, AND NOTHING CLEARS IT ON A TIMER.
 *      A flag cleared five seconds after `load` means "once per five seconds",
 *      and every lazily-imported route chunk fails later than that.
 *
 *   2. IT CANNOT LIVE ONLY IN sessionStorage. `setItem` THROWS in Safari
 *      Private Browsing and wherever site data is blocked — exactly the
 *      browser this bug keeps being reported from. So the count also rides in
 *      the URL, which no storage policy can refuse.
 *
 * `sessionStorage` is the right lifetime for the storage half: it dies with the
 * tab, so a new tab gets a fresh budget without any timer resetting one
 * mid-session.
 *
 * Plain JavaScript, no JSX, so the guard test can load it in Node.
 */

/**
 * Every sessionStorage key that is a reload bound rather than page state.
 *
 * THIS LIST IS WHY THE FILE EXPORTS IT RATHER THAN JUST USING IT. `clearSession`
 * in `App.jsx` sweeps `sessionStorage` on sign-out to drop per-tab sensitive
 * state — drafts, in-flight wizards — and a blanket `clear()` took these with
 * it. That mattered most on `/login`, because `AuthScreen` runs `clearSession`
 * on mount for anyone arriving still signed in, and because `main.jsx` strips
 * the boot watchdog's `?__reboot=` marker on every successful boot: between
 * them the watchdog lost both of its guards at once, which is precisely what
 * `main.jsx`'s own comment says must never happen.
 *
 * A guard key added to any caller belongs here, or the next sweep drops it.
 */
export const RELOAD_GUARD_KEYS = [
  // The boot watchdog in `frontend/index.html`. Its other guard, `?__reboot=`,
  // is stripped by `main.jsx` after a successful boot, so on any page that has
  // booted this key is the ONLY bound it has left.
  'axal:boot-reboot',
  // Stale-chunk recovery in `main.jsx`.
  'axal:chunk-reload-attempts',
  // `RouteErrorBoundary`'s one-shot, cleared only by its own Reload button.
  'axal:chunk-reload-boundary',
  // The service-worker update reload in `lib/pwa.js`.
  'axal:sw-reload-attempts',
  // `PitchDeckPage`'s stale deck-registry recovery.
  'deck_registry_recover',
];

/**
 * How many times this recovery has already reloaded, from storage or — where
 * storage is refused — from the URL marker that rode along with the last one.
 */
export function readAttempts(storageKey, urlParam) {
  try {
    const n = parseInt(sessionStorage.getItem(storageKey) || '0', 10);
    if (Number.isFinite(n) && n > 0) return n;
  } catch { /* storage blocked — fall through to the URL marker */ }
  try {
    // `URLSearchParams`, NOT a regex built from `urlParam`. Semgrep's
    // detect-non-literal-regexp flagged the interpolated version, and while the
    // ReDoS it exists to catch is not reachable here — every caller passes a
    // module-level constant, never anything a user supplies — the finding was
    // still worth taking rather than arguing, because a parser beats a pattern
    // for reading a query parameter. It decodes correctly, cannot be confused
    // by a value that looks like a delimiter, and is the same mechanism
    // `reloadCarryingCount` below already uses to WRITE the marker.
    const raw = new URL(window.location.href).searchParams.get(urlParam);
    if (raw != null) {
      const n = parseInt(raw, 10);
      if (Number.isFinite(n) && n > 0) return n;
    }
  } catch { /* location unreadable */ }
  return 0;
}

/**
 * Reload, carrying the attempt count in the URL so the bound survives a browser
 * that refuses the storage write.
 *
 * The bare `reload()` fallback is reached only when building a URL throws, which
 * means `window.location` is unusable — at that point there is nothing left to
 * carry the count in, and one unguarded reload is better than a page that can
 * never recover. Callers must have checked the budget BEFORE calling this: the
 * failing shape this module replaces was a swallowed write followed by a reload.
 */
export function reloadCarryingCount(urlParam, n) {
  try {
    const u = new URL(window.location.href);
    u.searchParams.set(urlParam, String(n));
    window.location.replace(u.toString());
  } catch {
    window.location.reload();
  }
}

/**
 * Record one more attempt and reload — or do nothing, if the budget is spent.
 * Returns whether it reloaded, so a caller can fall back to showing something.
 */
export function reloadWithinBudget(storageKey, urlParam, max, before) {
  const attempts = readAttempts(storageKey, urlParam);
  if (attempts >= max) return false;
  const next = attempts + 1;
  try { sessionStorage.setItem(storageKey, String(next)); } catch { /* the URL marker carries it */ }
  const go = () => reloadCarryingCount(urlParam, next);
  if (typeof before === 'function') { before(go); } else { go(); }
  return true;
}

/**
 * Run a `sessionStorage` sweep without taking the reload guards with it.
 *
 * Reads the guards, runs the caller's sweep, writes back whatever had a value.
 * Never throws: a browser that refuses storage has no guards to preserve and no
 * sweep to protect them from.
 */
export function preserveReloadGuards(sweep) {
  const kept = [];
  try {
    for (const key of RELOAD_GUARD_KEYS) {
      const v = sessionStorage.getItem(key);
      if (v != null) kept.push([key, v]);
    }
  } catch { /* storage unreadable — nothing to preserve */ }
  try { sweep(); } finally {
    try {
      for (const [key, v] of kept) sessionStorage.setItem(key, v);
    } catch { /* storage refused the write back — the URL markers still bound us */ }
  }
}
