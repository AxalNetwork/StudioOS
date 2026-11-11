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
export function markPendingNextRedirected() {
  redirected = true;
}

export function pendingNextRedirected() {
  return redirected;
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
export const RETURN_AFTER_LOGIN_PREFIXES = Object.freeze(['/learning', '/grow']);

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
  const safe = kept ? sanitizeNextPath(here) : null;
  return safe ? `/login?next=${encodeURIComponent(safe)}` : '/login';
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
  return area ? { name: area.name, what: area.what, who: area.who(pathname) } : null;
}

/**
 * What the sign-in page shows for a kept destination (#4579): its area, and a sign-up link that keeps the same
 * destination. Null for a direct visit or an unsafe `next`, which keep the generic page.
 */
export function signInContextFor(next) {
  const area = destinationArea(next);
  return area ? { area, registerHref: `/register?next=${encodeURIComponent(sanitizeNextPath(next))}` } : null;
}

/**
 * Destinations that need a finished account. An invitation link stays reachable while the account is still being set
 * up (RequireAuth exempts the pending target from its setup gates); a Grow page does not, because it needs the
 * founder account setup creates. So setup runs first, and the destination is kept until it finishes.
 */
export const SETUP_BEFORE_DESTINATION_PREFIXES = Object.freeze(['/grow']);

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
