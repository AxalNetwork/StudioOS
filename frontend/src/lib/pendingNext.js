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
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(raw)) return null;
  return raw;
}

export function storePendingNext(path) {
  const p = sanitizeNextPath(path);
  if (!p) return;
  safeWriteJSON(KEY, { path: p, ts: Date.now() });
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
