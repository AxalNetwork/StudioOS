/**
 * D5318 (#5318, H10) — `mayHaveSession`: whether this browser may hold a
 * session, read from what sign-in leaves behind without asking the Worker.
 * Every sign-in writes the bearer `token` or the `user` to localStorage, and the
 * cookie sign-in sets the JS-readable CSRF cookie beside the httpOnly auth
 * cookie with the same lifetime (`setAuthCookies`, cloudflare-worker/src/auth.ts).
 * With none of the three the visitor is anonymous, so the member-only reads
 * (`/api/settings/appearance`, `/api/settings/explainers`) can only answer 401
 * and are not sent. Any one of them present means "ask": a false "maybe" costs
 * one 401, a false "no" would hide a member's own theme.
 */
import { csrfCookieNameFor } from './branchHost.js';

export function mayHaveSession({ storage, cookie, hostname } = {}) {
  try {
    if (storage?.getItem('token') || storage?.getItem('user')) return true;
  } catch {
    return true; // storage unreadable: cannot tell, so ask
  }
  const name = csrfCookieNameFor(hostname || '');
  return String(cookie || '').split(';').some((part) => {
    const t = part.trim();
    const eq = t.indexOf('=');
    return eq > 0 && t.slice(0, eq) === name && t.slice(eq + 1) !== '';
  });
}

/** The same, for this page. */
export function pageMayHaveSession() {
  if (typeof window === 'undefined') return true;
  let storage = null;
  try { storage = window.localStorage; } catch { return true; }
  return mayHaveSession({ storage, cookie: typeof document === 'undefined' ? '' : document.cookie, hostname: window.location?.hostname });
}
