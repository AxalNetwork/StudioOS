/**
 * D668 (#1498) — the pure rules of the AI assistant consent page,
 * `/connect/assistant?request=:id` (D665's OAuth flow, #1495): which state
 * the page is in, what the client asks for, and what Approve sends. No React
 * and no fetch, so `frontend/test/assistant_connect_d668.test.mjs` holds them.
 *
 * THE REQUEST, as #1496's Worker parks it for ten minutes:
 *   { client_name, redirect_host, companies: [{ id, name }], expires_at }
 * `companies` is only those the signed-in founder can write to.
 *
 * A CLIENT'S NAME IS SELF-DECLARED (RFC 7591 lets any client register any
 * name), so the redirect host, which the authorization actually returns to,
 * is always drawn beside it and larger than it.
 */

/** What every StudioOS assistant grant may do, and may not. Fixed: no scope is optional. */
export const ASSISTANT_SCOPES = ['Read your Validate context', 'Submit interviews for your review'];
export const ASSISTANT_LIMITS = 'It cannot change a module, delete anything, or see other companies.';

/**
 * The page's state from the read's outcome. `error.status` is the Worker's:
 * 404 is the feature off (`MCP_SERVER_ENABLED`), 410 an expired request and
 * 409 a request already used. Anything else is unreadable, never "expired".
 */
export function consentState({ request, error, loading }) {
  if (loading) return 'loading';
  if (error) {
    if (error.status === 404) return 'off';
    if (error.status === 410) return 'expired';
    if (error.status === 409) return 'used';
    return 'unreadable';
  }
  if (!request) return 'unreadable';
  if (!Array.isArray(request.companies) || request.companies.length === 0) return 'empty';
  return 'ready';
}

/** The redirect host as drawn: the request's own, or "Not recorded" — never the client's name. */
export function hostOf(request) {
  const h = String(request?.redirect_host || '').trim();
  return h || null;
}

/**
 * Approve's body: exactly the ticked companies the request offered, as ids,
 * in the request's order. A tick for a company not offered is dropped.
 */
export function approveBody(request, ticked) {
  const on = new Set([...(ticked || [])].map(String));
  return { companies: (request?.companies || []).filter((c) => on.has(String(c.id))).map((c) => c.id) };
}

/** Approve needs at least one company ticked. */
export const canApprove = (request, ticked) => approveBody(request, ticked).companies.length > 0;

/** Where a signed-out visitor goes: sign-in, then back to this exact page. */
export function signInPath(location) {
  const back = `${location?.pathname || '/connect/assistant'}${location?.search || ''}`;
  return `/login?next=${encodeURIComponent(back)}`;
}

/**
 * The redirect to follow after Approve or Deny. Only an absolute https URL
 * (or http on localhost, for a developer's client) is followed; anything
 * else is refused rather than navigated to.
 */
export function safeRedirect(url) {
  try {
    const u = new URL(String(url || ''));
    if (u.protocol === 'https:') return u.toString();
    if (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname)) return u.toString();
  } catch { /* not a URL */ }
  return null;
}
