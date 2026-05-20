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
 * Epic 11 — Content-Security-Policy (nonce-based).
 *   The worker is overwhelmingly a JSON API, but a few endpoints emit HTML
 *   (CSP-violation report viewer, the OAuth consent screens served by some
 *   integrations, error pages). For those pages we need a strict CSP that
 *   only allows scripts carrying a per-request nonce. The nonce is generated
 *   here, stashed on the request context as `cspNonce` so route handlers can
 *   inline `<script nonce="...">`, and emitted in the CSP header.
 *
 *   For pure JSON responses the nonce header is harmless (browsers only
 *   consult CSP on documents that load resources, not on raw JSON). Keeping
 *   the policy uniform avoids "we forgot to set CSP on this one HTML route"
 *   regressions.
 */

/**
 * Generate a cryptographically-strong CSP nonce. 16 random bytes (~128 bits)
 * is the OWASP-recommended minimum; we base64-encode without padding to keep
 * the header value short and URL-safe.
 */
function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // btoa is available in the Workers runtime.
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/=+$/, '');
}

export function securityHeadersMiddleware() {
  return async (c: Context, next: Next) => {
    // Issue the nonce BEFORE the route runs so handlers can read it and
    // emit `<script nonce="...">` tags in any HTML they generate.
    const nonce = generateNonce();
    c.set('cspNonce' as never, nonce as never);

    await next();
    const h = c.res.headers;
    h.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
    h.set('X-Content-Type-Options', 'nosniff');
    h.set('X-Frame-Options', 'DENY');
    h.set('Referrer-Policy', 'no-referrer');
    // Task #33 — broaden Permissions-Policy to deny every powerful sensor
    // by default. Add features only when an actual route needs them.
    h.set(
      'Permissions-Policy',
      'geolocation=(), camera=(), microphone=(), payment=(), usb=(), bluetooth=(), accelerometer=(), gyroscope=(), magnetometer=(), midi=(), serial=(), hid=(), interest-cohort=()',
    );
    h.set('Cross-Origin-Resource-Policy', 'same-site');
    // Task #33 — Cross-Origin-Opener-Policy isolates the API browsing context
    // from any opener so window.opener-style attacks cannot read worker
    // responses. Same-origin is the strictest setting that doesn't break
    // legitimate same-origin OAuth popups (the few we have run on the SPA,
    // not the API).
    h.set('Cross-Origin-Opener-Policy', 'same-origin');
    // Nonce-based CSP. `'strict-dynamic'` lets a nonce'd loader script bring
    // in additional scripts without each one needing its own nonce — this is
    // the modern OWASP-recommended pattern. `'unsafe-inline'` is included as
    // a fallback ONLY for browsers that don't understand nonces; nonce-aware
    // browsers ignore it (CSP3 §6.6.2.5).
    h.set(
      'Content-Security-Policy',
      `default-src 'self'; ` +
        `script-src 'nonce-${nonce}' 'strict-dynamic' 'unsafe-inline' https:; ` +
        `style-src 'self' 'unsafe-inline'; ` +
        `img-src 'self' data: https:; ` +
        `connect-src 'self' https://app.axal.vc https://axal.vc https://www.axal.vc https://api.stripe.com https://*.cloudflareaccess.com; ` +
        `frame-ancestors 'none'; ` +
        `base-uri 'self'; ` +
        `form-action 'self'; ` +
        `object-src 'none'`,
    );
  };
}
