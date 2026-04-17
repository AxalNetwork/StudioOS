import type { Context, Next } from 'hono';

/**
 * Adds defense-in-depth HTTP security headers to every API response.
 * - HSTS: force HTTPS for 2 years incl. subdomains (axal.vc is HTTPS-only).
 * - X-Content-Type-Options: block MIME-sniffing.
 * - X-Frame-Options: deny embedding (the API is JSON, never framed).
 * - Referrer-Policy: never leak full URLs (which contain query params, IDs).
 * - Permissions-Policy: disable powerful browser features for any HTML responses.
 * - Cross-Origin-Resource-Policy: only same-site can load API responses as resources.
 *
 * CSP is intentionally NOT set here because this is a JSON API; the static
 * frontend on GitHub Pages controls its own CSP.
 */
export function securityHeadersMiddleware() {
  return async (c: Context, next: Next) => {
    await next();
    const h = c.res.headers;
    h.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
    h.set('X-Content-Type-Options', 'nosniff');
    h.set('X-Frame-Options', 'DENY');
    h.set('Referrer-Policy', 'no-referrer');
    h.set('Permissions-Policy', 'geolocation=(), camera=(), microphone=(), payment=()');
    h.set('Cross-Origin-Resource-Policy', 'same-site');
  };
}
