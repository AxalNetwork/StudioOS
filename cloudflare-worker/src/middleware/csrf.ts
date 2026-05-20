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
 *   - Skips entirely if the request already carries `Authorization` (Bearer
 *     flow — the attacker would need to read & inject the token themselves,
 *     which CSRF can't help with).
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

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const AUTH_COOKIE = 'studioos_auth';
const CSRF_COOKIE = 'studioos_csrf';
const CSRF_HEADER = 'X-CSRF-Token';

// Task #2 (IB) — RFC 8058 one-click List-Unsubscribe MUST work without a
// CSRF token. Mailbox-provider unsubscribe POSTs originate from the
// mailbox UI (Gmail, Outlook), not the user's browser session — they
// will never carry the studioos_csrf cookie+header pair. The HMAC token
// in the URL IS the authorisation, so this path is safe to exempt.
const CSRF_PATH_EXEMPT = new Set([
  '/api/notifications/unsubscribe',
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

export function csrfMiddleware(): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) return next();

    // Task #2 (IB) — RFC 8058 one-click unsubscribe exemption.
    if (CSRF_PATH_EXEMPT.has(c.req.path)) return next();

    // Bearer flow: no ambient credentials → no CSRF concern.
    const authHeader = c.req.header('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) return next();

    const cookieHeader = c.req.header('Cookie') || '';
    const authCookie = readCookie(cookieHeader, AUTH_COOKIE);
    if (!authCookie) return next();

    const csrfCookie = readCookie(cookieHeader, CSRF_COOKIE);
    const csrfHeader = c.req.header(CSRF_HEADER);

    if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
      return c.json({ error: 'CSRF token missing or invalid' }, 403);
    }
    return next();
  };
}
