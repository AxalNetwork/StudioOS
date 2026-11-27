// Task #1 — invitation & lane continuity through signup.
//
// A `?next=` return path arriving on /register (e.g. a startup-team
// invitation that bounced a new user to sign-up) must survive the
// email-verification / magic-link / Google-OAuth round-trip. We persist it
// in localStorage before the round-trip and consume it exactly once per
// page load after the user is authenticated (see RequireAuth in App.jsx).
//
// Open-redirect safety: only same-origin absolute paths are accepted —
// a single leading '/', never '//', bounded length, no control chars.
// This mirrors the worker's sanitizeRedirect() and LoginPage's
// safeNextPath().

import { safeReadJSON, safeWriteJSON, safeRemove } from './storage';

const KEY = 'gvpn:next';
// The classic verification email expires in 24h — the stored return path
// lives exactly as long, so a stale next from an abandoned signup weeks
// ago can never yank a user away from their normal landing page.
const TTL_MS = 24 * 60 * 60 * 1000;

export function sanitizeNextPath(raw) {
  if (typeof raw !== 'string') return null;
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  if (raw.length > 200) return null;
  // A backslash is a slash to the browser's URL parser, so `/\evil.com` is
  // `//evil.com`; it strips tabs and newlines, so `/<tab>/evil.com` is too.
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return null;
  return raw;
}

/**
 * `raw` as a path on `origin`, or null — for a value about to be assigned to
 * `window.location.href`. On top of `sanitizeNextPath`, the path is parsed
 * against the origin and kept only if it stays there, and what is returned is
 * the parsed path, query and fragment, never the raw string.
 */
export function sameOriginNextPath(raw, origin) {
  const p = sanitizeNextPath(raw);
  if (!p) return null;
  try {
    const base = new URL(origin);
    const u = new URL(p, base);
    if (u.origin !== base.origin) return null;
    return u.pathname + u.search + u.hash;
  } catch {
    return null;
  }
}

export function storePendingNext(path) {
  const p = sanitizeNextPath(path);
  if (!p) return;
  safeWriteJSON(KEY, { path: p, ts: Date.now() });
}

/**
 * #4651: a Pricing return (`/pricing?…checkout=<plan>`) kept for a plan the visitor has since walked away from must not
 * send a later, plain sign-up to that plan's checkout. Dropped when /register is opened without a `next` of its own;
 * any other kept path (an invitation, a deep link) is left alone.
 */
export function clearPendingPricingNext() {
  const v = safeReadJSON(KEY, null);
  if (v && typeof v === 'object' && typeof v.path === 'string' && /^\/pricing\?(?:.*&)?checkout=/.test(v.path)) safeRemove(KEY);
}

function readPendingNext() {
  const v = safeReadJSON(KEY, null);
  if (!v || typeof v !== 'object') return null;
  const p = sanitizeNextPath(v.path);
  const fresh = Number.isFinite(v.ts) && Date.now() - v.ts <= TTL_MS;
  if (!p || !fresh) {
    safeRemove(KEY);
    return null;
  }
  return p;
}

// ---------------------------------------------------------------------------
// Consume-once-per-page-load semantics. Magic-link verify, the Google
// callback, and VerifyEmailPage's "Continue" all land via FULL page loads,
// so module state resets exactly when a fresh consumption should happen.
// ---------------------------------------------------------------------------
let consumed = false;
let value = null;
let redirected = false;
// D8537 (#8537): the history entry (React Router's `location.key`) the redirect was issued from. React Router runs a
// `<Navigate>` as a transition, so an urgent re-render can still draw the page being left (a `/me` answer landing on
// `/studio` after the email link). Read there, a spent flag let that page's own guard redirect too, and its redirect
// won: a new account that chose a plan was sent to `/exploring` instead of the plan's checkout.
let redirectedFrom = null;

// Reads (and clears from storage) the pending next path. Cached in module
// state so StrictMode double-renders and later RequireAuth mounts within
// the same page load all see the same value.
export function consumePendingNextOnce() {
  if (!consumed) {
    consumed = true;
    value = readPendingNext();
    if (value) safeRemove(KEY);
  }
  return value;
}

// The redirect to the pending target fires at most once per page load —
// without this flag a target outside RequireAuth (unlikely but possible)
// would re-trigger the bounce every time the user entered a protected
// route.
export function markPendingNextRedirected(fromKey = null) {
  redirected = true;
  redirectedFrom = fromKey;
}

/**
 * Whether the redirect has been issued. Not yet on the entry it was issued from (`hereKey`): a re-render there, before
 * the navigation lands, keeps redirecting to the target. Any other entry, the target or a later page, reads true.
 */
export function pendingNextRedirected(hereKey = null) {
  return redirected && !(redirectedFrom !== null && hereKey === redirectedFrom);
}

// If this page load already landed ON the stored target — e.g. the worker's
// Google-callback 302 delivered the user straight to their invite page, or
// the target is a public route that never mounts RequireAuth — the redirect
// is already satisfied. Consume the entry now (module load runs on every
// page load, public routes included) and mark it redirected, so a later SPA
// navigation into a protected route can never bounce the user BACK to a
// spent invite link. The value stays cached so RequireAuth still suppresses
// the onboarding-chat gate while the user remains on a protected target.
(function consumeIfLandedOnTarget() {
  try {
    if (typeof window === 'undefined') return;
    const v = safeReadJSON(KEY, null);
    const p = v && typeof v === 'object' ? sanitizeNextPath(v.path) : null;
    if (p && window.location.pathname === p.split(/[?#]/)[0]) {
      consumed = true;
      value = p;
      redirected = true;
      safeRemove(KEY);
    }
  } catch { /* never block app bootstrap */ }
})();

/**
 * #4646: areas whose signed-out visitors come back to the exact page they asked for. The route guard sends everyone
 * else to a bare `/login`, as before; an area joins this list when its deep links (a course, a lesson, a webinar) are
 * shared and must survive sign-in.
 */
export const RETURN_AFTER_LOGIN_PREFIXES = Object.freeze(['/learning', '/grow', '/research/companies', '/research/funds']);

/**
 * D7166 (#7166): a Funds directory link longer than the return cap (`sanitizeNextPath`, 200 characters) cannot be
 * kept whole. It returns to the Directory without its filters, and `FUNDS_FILTERS_DROPPED` tells the page to say so
 * (RFD-04, option A as drawn). Any other area falls back to `/login`, as before.
 */
export const FUNDS_FILTERS_DROPPED = 'filters_dropped';
const FUNDS_PREFIX = '/research/funds';

const underPrefix = (pathname, prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`);
const pathOf = (p) => String(p || '').split(/[?#]/)[0];

/**
 * Where the route guard sends a signed-out visitor: `/login?next=<the page they asked for>` for an area that keeps its
 * destination, else `/login`. The destination is the same-origin path, query and fragment the login page already
 * validates (`sanitizeNextPath`), so email-link, Google, passkey and authenticator sign-in all land on it; one that
 * fails the check (too long, not a path) falls back to `/login` rather than carrying anything unsafe.
 */
export function loginRedirectFor(location) {
  const pathname = String(location?.pathname || '');
  const here = `${pathname}${location?.search || ''}${location?.hash || ''}`;
  const kept = RETURN_AFTER_LOGIN_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  let safe = kept ? sanitizeNextPath(here) : null;
  const directory = new URLSearchParams(location?.search || '').get('view') === 'directory';
  if (!safe && kept && pathname === FUNDS_PREFIX && here.length > 200) {
    safe = sanitizeNextPath(`${FUNDS_PREFIX}?${directory ? 'view=directory&' : ''}${FUNDS_FILTERS_DROPPED}=1`);
  }
  if (safe && pathname === FUNDS_PREFIX && directory) rememberFundsReturn(safe);
  return safe ? `/login?next=${encodeURIComponent(safe)}` : '/login';
}

// ---------------------------------------------------------------------------
// D7166 part 2 (#7166, RFD-04B, RFD-06): "Signed in. This is the search you opened."
// ---------------------------------------------------------------------------

const FUNDS_RETURN_KEY = 'gvpn:funds-return';

/** The path and query of a kept destination, without its fragment: what the Directory compares on arrival. */
const withoutHash = (p) => String(p || '').split('#')[0];

/**
 * The guard sent a signed-out visitor away from a Directory link and kept it as `next`. Remember that link, for as
 * long as a kept destination lives (24 hours, the verification email's life), so the Directory can say once, on
 * arriving at that same link signed in, that it is the search they opened. The marker is only ever a same-origin
 * path that passed `sanitizeNextPath`; it names nothing but the link.
 */
export function rememberFundsReturn(path) {
  const p = sanitizeNextPath(path);
  if (!p || pathOf(p) !== FUNDS_PREFIX) return;
  safeWriteJSON(FUNDS_RETURN_KEY, { path: withoutHash(p), ts: Date.now() });
}

/**
 * True once, when the Directory opens at the link the guard kept: the marker is fresh and names this same path and
 * query. A match, a stale marker or a bad one is cleared; a fresh marker for another link is left for that link. The
 * Directory is signed in by the time it renders (App.jsx's guard), so a match means the visitor signed in to get here.
 */
export function consumeFundsReturn(here) {
  const v = safeReadJSON(FUNDS_RETURN_KEY, null);
  if (!v || typeof v !== 'object') return false;
  const p = sanitizeNextPath(v.path);
  const fresh = Number.isFinite(v.ts) && Date.now() - v.ts <= TTL_MS && Date.now() >= v.ts;
  if (!p || !fresh) {
    safeRemove(FUNDS_RETURN_KEY);
    return false;
  }
  if (p !== withoutHash(here)) return false;
  safeRemove(FUNDS_RETURN_KEY);
  return true;
}

// ---------------------------------------------------------------------------
// #4579 (D4579) — Grow keeps its destination, and says where sign-in leads.
// ---------------------------------------------------------------------------

/**
 * The areas a kept destination can name on the sign-in and sign-up pages. Each says what the area is and who it is
 * for, so a visitor knows why they are asked to sign in and what account they will need. A destination outside these
 * keeps the generic pages.
 */
const DESTINATION_AREAS = Object.freeze([
  {
    prefix: '/grow',
    name: 'Grow',
    what: 'Grow is the founder workspace for focus, hiring, customers, partnerships and investor updates.',
    // The reporting desk is the one part of Grow an advisor or operating partner can read (App.jsx's routes).
    who: (pathname) => (/^\/grow\/reporting(\/|$)/.test(pathname) && !/\/edit$/.test(pathname)
      ? 'You need a founder, advisor or operating partner account.'
      : 'You need a founder account.'),
  },
  // D7178 (#7044, RS-16 A): Companies keeps the exact company or filtered results. The screens name only the area;
  // the query, the company and any project stay in the URL and are never shown before sign-in. `ready` is the one
  // screen after required setup ("Your account is ready · Continue to Companies").
  {
    prefix: '/research/companies',
    name: 'Companies',
    what: 'Companies is the Research directory of companies, each with the public sources behind it.',
    who: () => 'You need a Founder or Advisor licence.',
    ready: true,
  },
  {
    // D7166 (#7166): RFD-04's "Sign in to continue to Funds". App.jsx guards /research/funds to founders and admins.
    prefix: '/research/funds',
    name: 'Funds',
    what: 'Funds is the Research fund directory and your shortlist of funds.',
    who: () => 'You need a founder account.',
  },
]);

/**
 * `{ name, what, who }` for a destination inside a named area, or null. `next` is checked like every kept path
 * (`sanitizeNextPath`), so an unsafe value never names an area.
 */
export function destinationArea(next) {
  const p = sanitizeNextPath(next);
  if (!p) return null;
  const pathname = pathOf(p);
  const area = DESTINATION_AREAS.find((a) => underPrefix(pathname, a.prefix));
  return area ? { name: area.name, what: area.what, who: area.who(pathname), ready: area.ready === true } : null;
}

/**
 * What the sign-in page shows for a kept destination (#4579): its area, and a sign-up link that keeps the same
 * destination. Null for a direct visit or an unsafe `next`, which keep the generic page.
 */
export function signInContextFor(next, search = '') {
  const area = destinationArea(next);
  if (!area) return null;
  // D7178: `ended=1` is set by a 401 on a protected page (`sessionEndedRedirectFor`); the page then says why.
  let ended = null;
  try { ended = new URLSearchParams(search || '').get('ended') === '1' ? sessionEndedLine(area) : null; } catch { ended = null; }
  return { area, registerHref: `/register?next=${encodeURIComponent(sanitizeNextPath(next))}`, ended };
}

/**
 * Destinations that need a finished account. An invitation link stays reachable while the account is still being set
 * up (RequireAuth exempts the pending target from its setup gates); a Grow page does not, because it needs the
 * founder account setup creates. So setup runs first, and the destination is kept until it finishes.
 */
export const SETUP_BEFORE_DESTINATION_PREFIXES = Object.freeze(['/grow', '/research/companies']);

export function destinationNeedsSetup(path) {
  const p = sanitizeNextPath(path);
  return !!p && SETUP_BEFORE_DESTINATION_PREFIXES.some((prefix) => underPrefix(pathOf(p), prefix));
}

const AFTER_SETUP_KEY = 'gvpn:after-setup';

/** Keep `path` until account setup finishes. Only a destination that needs setup, and only a safe one. */
export function keepThroughSetup(path) {
  if (!destinationNeedsSetup(path)) return;
  safeWriteJSON(AFTER_SETUP_KEY, { path: sanitizeNextPath(path), ts: Date.now() });
}

/** The kept destination, or null (unsafe, outside a setup area, or older than the verification email's 24h). */
export function destinationAfterSetup() {
  const v = safeReadJSON(AFTER_SETUP_KEY, null);
  if (!v || typeof v !== 'object') return null;
  const p = destinationNeedsSetup(v.path) ? sanitizeNextPath(v.path) : null;
  const fresh = Number.isFinite(v.ts) && Date.now() - v.ts <= TTL_MS;
  if (!p || !fresh) {
    safeRemove(AFTER_SETUP_KEY);
    return null;
  }
  return p;
}

/** Used once: cleared as the visitor is sent there (or arrives some other way). */
export function clearDestinationAfterSetup() {
  safeRemove(AFTER_SETUP_KEY);
}

// ---------------------------------------------------------------------------
// D7178 (#7044, RS-16) — Companies: a stale session keeps the page, and the page says it was restored.
// ---------------------------------------------------------------------------

/**
 * Where a 401 on a protected page sends the tab: the route guard's own answer (`loginRedirectFor`, the same
 * sanitiser), with `ended=1` when a destination is kept, so the sign-in page can say the session ended. An area that
 * keeps no destination still goes to a bare `/login`, as before.
 */
export function sessionEndedRedirectFor(location, reason = SESSION_ENDED_EXPIRED) {
  const flag = reason === SESSION_ENDED_IDLE ? SESSION_ENDED_IDLE : '1';
  const to = loginRedirectFor(location);
  if (to !== '/login') return `${to}&ended=${flag}`;
  // D8793 (#8793): every other protected page keeps its destination too. The audit's HQ and Investor tabs landed on a
  // bare `/login` with no reason given and no way back. The path is kept only in the URL (never drawn on the signed-out
  // page), through the same sanitiser; one that fails it, or a sign-in page itself, keeps only the reason.
  const pathname = String(location?.pathname || '');
  const here = `${pathname}${location?.search || ''}${location?.hash || ''}`;
  const safe = NEVER_KEPT_AFTER_SESSION_END.some((p) => underPrefix(pathname, p)) ? null : sanitizeNextPath(here);
  return safe ? `/login?next=${encodeURIComponent(safe)}&ended=${flag}` : `/login?ended=${flag}`;
}

/** The line the sign-in page shows after `sessionEndedRedirectFor`, for a kept destination in a named area. */
export function sessionEndedLine(area) {
  return area ? `Your session ended. Sign in again to go back to ${area.name}.` : null;
}

// ---------------------------------------------------------------------------
// D8793 (#8793) — an interrupted session says so, keeps where it was, and is told apart from a sign-out.
// ---------------------------------------------------------------------------

/** `ended=1`: the server answered 401 to a signed-in page. `ended=idle`: the 20-minute inactivity sign-out. */
export const SESSION_ENDED_EXPIRED = 'expired';
export const SESSION_ENDED_IDLE = 'idle';
const NEVER_KEPT_AFTER_SESSION_END = Object.freeze(['/login', '/register', '/logout']);

/** Interim wording until the canvas lands (`needs-design`). None names the page, the project or the account. */
export const SESSION_ENDED_BACK = 'Your session ended. Sign in again to go back to the page you were on.';
export const SESSION_ENDED_PLAIN = 'Your session ended. Sign in again to continue.';
export const SESSION_IDLE_BACK = 'You were signed out after a period without activity. Sign in again to go back to the page you were on.';
export const SESSION_IDLE_PLAIN = 'You were signed out after a period without activity. Sign in again to continue.';

/**
 * The sign-in page's sentence for an interrupted session, or null for an ordinary visit (no `ended`) — a deliberate
 * sign-out lands on a bare `/login` and gets none. A kept destination in a named area keeps D7178's line.
 */
export function sessionEndedNotice(next, search = '') {
  let ended = null;
  try { ended = new URLSearchParams(search || '').get('ended'); } catch { ended = null; }
  if (ended !== '1' && ended !== SESSION_ENDED_IDLE) return null;
  const kept = sanitizeNextPath(next);
  if (ended === SESSION_ENDED_IDLE) return kept ? SESSION_IDLE_BACK : SESSION_IDLE_PLAIN;
  const area = destinationArea(kept);
  if (area) return sessionEndedLine(area);
  return kept ? SESSION_ENDED_BACK : SESSION_ENDED_PLAIN;
}

/**
 * Other open tabs. A session that ends in one tab clears the stored user, and every other tab mirrors that and meets
 * the route guard signed out. The tab where it ended leaves a short-lived marker first, so those tabs are sent to the
 * same explained, destination-keeping sign-in, while a deliberate sign-out clears it and they get the plain page.
 */
const SESSION_ENDED_KEY = 'gvpn:session-ended';
export const SESSION_ENDED_MARKER_TTL_MS = 2 * 60 * 1000;

export function markSessionEnded(reason = SESSION_ENDED_EXPIRED, now = Date.now()) {
  safeWriteJSON(SESSION_ENDED_KEY, { reason: reason === SESSION_ENDED_IDLE ? SESSION_ENDED_IDLE : SESSION_ENDED_EXPIRED, ts: now });
}

export function clearSessionEnded() {
  safeRemove(SESSION_ENDED_KEY);
}

/** The reason a session ended in some tab within the last two minutes, or null (none, stale or unreadable). */
export function sessionEndedRecently(now = Date.now()) {
  const v = safeReadJSON(SESSION_ENDED_KEY, null);
  const ok = v && typeof v === 'object' && Number.isFinite(v.ts) && v.ts <= now && now - v.ts <= SESSION_ENDED_MARKER_TTL_MS
    && (v.reason === SESSION_ENDED_EXPIRED || v.reason === SESSION_ENDED_IDLE);
  if (!ok) {
    if (v !== null) safeRemove(SESSION_ENDED_KEY);
    return null;
  }
  return v.reason;
}

/** Where the route guard sends a tab that is signed out: explained and kept after an interruption, else as before. */
export function signedOutRedirectFor(location, now = Date.now()) {
  const reason = sessionEndedRecently(now);
  return reason ? sessionEndedRedirectFor(location, reason) : loginRedirectFor(location);
}

let restoredSpent = false;
let restoredTo = null;

/** After required setup, "Continue to …" sends the visitor here; the page it opens then reads as restored. */
export function markRestoredArrival(path) {
  const p = sanitizeNextPath(path);
  if (!p) return;
  restoredTo = p;
  restoredSpent = false;
}

/**
 * True when this page load returned to `path` (path and query) from sign-in, sign-up or setup, and the page has not
 * said so yet. Pure: a page reads it once (a `useState` initialiser) and then calls `spendRestoredArrival`, so a later
 * visit in the same load (Back to Companies, then the profile again) does not say it twice.
 */
export function isRestoredArrival(path) {
  if (restoredSpent) return false;
  const kept = restoredTo || (consumed || redirected ? value : null);
  if (!kept) return false;
  const here = sanitizeNextPath(path);
  return !!here && here.split('#')[0] === kept.split('#')[0];
}

export function spendRestoredArrival() {
  restoredSpent = true;
}
