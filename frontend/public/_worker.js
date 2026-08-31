// Cloudflare Pages — Advanced Mode entry point for the Axal VC frontend.
//
// A `_worker.js` at the build-output root puts Pages in Advanced Mode: this
// script handles EVERY request and Pages stops processing `_redirects` and
// `_headers` entirely. That is why the security headers are set here in code
// rather than in a `_headers` file — a `_headers` file alongside this script
// is silently inert, which is how the frontend ended up with no enforced
// headers twice already (first via a Netlify-dialect `cloudflare.toml` that
// nothing read, then via a `_headers` file this script bypassed).
//
// Routing contract, matching cloudflare-worker/src/index.ts Task #37:
//   - a real file wins, always;
//   - a missing /assets/* file stays a 404 and is NEVER rewritten to
//     index.html, because the browser would execute HTML as a JS module and
//     the page would render blank — the `?__reboot=` watchdog loop;
//   - anything else with a file extension also stays a 404;
//   - non-GET/HEAD stays a 404;
//   - everything else falls back to the SPA shell so client-side routes work.

// `no-referrer` is the Worker's canonical value for the authenticated API
// surface (NICE-SEC-01). These static pages deliberately use the laxer value:
// they carry no ids or query params and want cross-origin referral
// attribution. The split is intentional — see GOTCHAS. Values mirror
// cloudflare-worker/src/middleware/securityHeaders.ts.
const SECURITY_HEADERS = {
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy':
    'geolocation=(), camera=(), microphone=(), payment=(), usb=(), bluetooth=(), ' +
    'accelerometer=(), gyroscope=(), magnetometer=(), midi=(), serial=(), hid=(), ' +
    'interest-cohort=()',
};

// No Content-Security-Policy, and that is a decision rather than an omission.
// The Worker's CSP is nonce-based and generated per request, which cannot be
// reproduced for a static bundle, and index.html carries an inline boot
// watchdog that a naive `script-src 'self'` would kill — white-screening every
// visitor. There is no CSP on this surface today either, so shipping without
// one is not a regression. Adding a correct one needs the inline scripts
// enumerated and hashed against a deployed preview.

const withSecurityHeaders = (response) => {
  const out = new Response(response.body, response);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
  return out;
};

const shouldStayNotFound = (pathname) => {
  if (pathname.startsWith('/api/') || pathname.startsWith('/assets/')) {
    return true;
  }

  const lastSegment = pathname.split('/').pop() || '';
  return lastSegment.includes('.');
};

export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);
    if (response.status !== 404) {
      return withSecurityHeaders(response);
    }

    const url = new URL(request.url);
    if (
      (request.method !== 'GET' && request.method !== 'HEAD') ||
      shouldStayNotFound(url.pathname)
    ) {
      return withSecurityHeaders(response);
    }

    const indexUrl = new URL('/index.html', url);
    const shell = await env.ASSETS.fetch(new Request(indexUrl, request));
    return withSecurityHeaders(shell);
  },
};
