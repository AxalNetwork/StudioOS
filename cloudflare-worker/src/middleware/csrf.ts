/**
 * T6 — CSRF double-submit middleware for cookie-authenticated requests.
 *
 * The worker accepts auth via either:
 *   (a) `Authorization: Bearer <jwt>`  — Bearer flow (legacy, impersonation,
 *       direct-fetch callers like useWebSocket / download URLs).
 *   (b) `Cookie: studioos_auth=<jwt>`  — cookie flow (api.js → /api/* calls).
 *
 * CSRF only matters for the cookie flow, because that's the only path the
 * browser will ambient-auth on a cross-site form POST. So this middleware:
 *   - Only runs for mutating verbs (POST/PUT/PATCH/DELETE).
 *   - Skips if the request is authenticated by its `Authorization` Bearer
 *     (the attacker would need to read & inject the token themselves, which
 *     CSRF can't help with). D4669: "authenticated by" is `selectJwt`'s
 *     choice, not the header's presence — a Bearer that loses to the cookie
 *     does not exempt the cookie.
 *   - Skips if no `studioos_auth` cookie is present (request will 401 at the
 *     route's own auth check; no point CSRF-ing an unauth'd request).
 *   - Otherwise requires the `X-CSRF-Token` header to match the
 *     `studioos_csrf` cookie (double-submit pattern). The CSRF cookie is
 *     readable by JS so api.js can mirror it into the header — but a
 *     cross-site attacker on another origin cannot read it, satisfying the
 *     CSRF guarantee.
 *
 * Auth bootstrap routes (login/register/verify-email/etc) are naturally
 * exempt because the user has no cookie yet at that point. Logout is NOT
 * exempt — it requires a valid CSRF token like any other state-changing call.
 */

import type { MiddlewareHandler } from 'hono';
import type { Env } from '../types';
import { authCookieName, csrfCookieName } from '../util/branch';
import { decodeJWT, pickAuthToken } from '../auth';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
// The cookie names are per Worker: `studioos_auth` / `studioos_csrf` on HQ,
// `studioos_auth_<code>` / `studioos_csrf_<code>` on a branch (D104). HQ's
// pair reaches a branch host too, and must satisfy nothing there.
const CSRF_HEADER = 'X-CSRF-Token';

// Task #2 (IB) — RFC 8058 one-click List-Unsubscribe MUST work without a
// CSRF token. Mailbox-provider unsubscribe POSTs originate from the
// mailbox UI (Gmail, Outlook), not the user's browser session — they
// will never carry the studioos_csrf cookie+header pair. The HMAC token
// in the URL IS the authorisation, so this path is safe to exempt.
// D810 — the newsletter's one-click unsubscribe is the same case: its signed
// token is the authorisation. So is its confirm POST, which the Worker's own
// confirm page sends from a plain form: the single-use token authorises it.
const CSRF_PATH_EXEMPT = new Set([
  '/api/notifications/unsubscribe',
  '/api/newsletter/unsubscribe',
  '/api/newsletter/confirm',
  // D1075 — the subprocessor notices' confirm and one-click unsubscribe, for
  // the same reasons: the single-use or signed token is the authorisation.
  '/api/public/trust/subprocessors/confirm',
  '/api/public/trust/subprocessors/unsubscribe',
]);

function readCookie(cookieHeader: string, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const k = trimmed.slice(0, eq);
    if (k === name) return trimmed.slice(eq + 1);
  }
  return null;
}

/**
 * Whether `getCurrentUser` would authenticate this request with the Bearer
 * rather than the cookie: `selectJwt`'s precedence, decided by the same
 * `pickAuthToken`, without `selectJwt`'s audit write (the route's own auth
 * makes that one).
 */
async function bearerAuthenticates(env: Env, bearer: string, cookie: string): Promise<boolean> {
  let b: { user_id?: number; impersonated_by?: number } | null = null;
  let k: { user_id?: number } | null = null;
  try { b = await decodeJWT(env, bearer); } catch { b = null; }
  if (!b) return false;
  try { k = await decodeJWT(env, cookie); } catch { k = null; }
  return pickAuthToken({ bearer: b, cookie: k }) === 'bearer';
}

export function csrfMiddleware(): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) return next();

    // Task #2 (IB) — RFC 8058 one-click unsubscribe exemption.
    if (CSRF_PATH_EXEMPT.has(c.req.path)) return next();
    // D1312 — a Lovable page's sign-up form posts from another site; the token in the address is the authorisation.
    if (c.req.path.startsWith('/api/validate/lovable-signups/')) return next();

    const cookieHeader = c.req.header('Cookie') || '';
    const authCookie = readCookie(cookieHeader, authCookieName(c.env));
    if (!authCookie) return next();

    // Bearer flow: no ambient credentials → no CSRF concern — BUT ONLY WHEN
    // THE BEARER IS WHAT AUTHENTICATES (D4669). `selectJwt` prefers the cookie
    // whenever the Bearer is empty, undecodable or another identity's, and the
    // check used to skip on the header's mere presence, so the request was
    // authenticated by the ambient cookie with no CSRF check. The exemption
    // now follows the same choice `getCurrentUser` makes (`bearerAuthenticates`).
    const authHeader = c.req.header('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const bearer = authHeader.slice(7);
      if (bearer && await bearerAuthenticates(c.env, bearer, authCookie)) return next();
    }

    const csrfCookie = readCookie(cookieHeader, csrfCookieName(c.env));
    const csrfHeader = c.req.header(CSRF_HEADER);

    if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
      return c.json({ error: 'CSRF token missing or invalid' }, 403);
    }
    return next();
  };
}
