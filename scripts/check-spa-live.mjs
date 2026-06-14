#!/usr/bin/env node
/**
 * Task #16 — Post-deploy live SPA smoke check.
 *
 * Task #15 added a BUILD-TIME guard (`scripts/check-spa-build.mjs` in the
 * upstream tree) that the Vite artifact (`docs/index.html` + `docs/assets/`)
 * is complete. This script is the RUNTIME sibling: after `npm run deploy`
 * publishes the Worker, it fetches the live site and fails loudly if any key
 * route returns a non-200, a non-HTML body, or the JSON 404 (`{"detail":"Not
 * found"}`) instead of the rendered SPA shell. The original blank-page
 * incident shipped because no post-deploy check existed.
 *
 * What "healthy" means for a route:
 *   - HTTP 200
 *   - Content-Type: text/html
 *   - Body contains `<div id="root">` (the SPA mount node)
 *   - Body contains a hashed module script `<script type="module" ...
 *     src="/assets/*.js">` (proof the built bundle is wired in, not a stub)
 *
 * Host model (see wrangler.toml + replit.md "Apex routing"):
 *   - app.axal.vc is a Workers Custom Domain: the Worker serves the SPA on
 *     EVERY path via `not_found_handling = "single-page-application"`, so `/`
 *     and all deep links return the shell.
 *   - axal.vc is the proxied apex: ONLY the path-scoped zone routes in
 *     `[[env.production.routes]]` go through the Worker; the apex root `/`
 *     still serves the Jekyll marketing site. So on axal.vc we assert the SPA
 *     shell on the routed app paths and only assert "200 + HTML" on `/`.
 *
 * Exit 0 when every check passes; exit 1 (loud) on the first host with any
 * failure, after reporting ALL failures.
 *
 * Invocation:
 *   node scripts/check-spa-live.mjs                  # both prod hosts
 *   SMOKE_HOSTS=https://app.axal.vc node scripts/check-spa-live.mjs
 *   node scripts/check-spa-live.mjs https://app.axal.vc
 *
 * Wired into `npm run deploy` via the `postdeploy` lifecycle hook so a deploy
 * that produces a blank/broken site fails the deploy command. Set
 * SKIP_LIVE_SMOKE=1 to bypass (e.g. from a host with no route to prod) — the
 * skip is explicit and logged so it can never silently pass.
 *
 * Tunables (env):
 *   SMOKE_HOSTS      space/comma-separated base URLs (default prod pair)
 *   SMOKE_SLUG       slug used for the /articles/:slug deep link
 *   SMOKE_RETRIES    attempts per request before failing (default 3)
 *   SMOKE_RETRY_MS   delay between attempts in ms (default 5000)
 *   SMOKE_TIMEOUT_MS per-request timeout in ms (default 15000)
 */

const DEFAULT_HOSTS = ['https://axal.vc', 'https://app.axal.vc'];

const SLUG = process.env.SMOKE_SLUG || 'smoke-test-deeplink';
const RETRIES = Number(process.env.SMOKE_RETRIES || 3);
const RETRY_MS = Number(process.env.SMOKE_RETRY_MS || 5000);
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 15000);

const hostsArg =
  process.argv.slice(2).filter((a) => !a.startsWith('-')).join(' ') ||
  process.env.SMOKE_HOSTS ||
  '';
const HOSTS = hostsArg
  ? hostsArg.split(/[\s,]+/).filter(Boolean)
  : DEFAULT_HOSTS;

if (process.env.SKIP_LIVE_SMOKE === '1') {
  console.log(
    '[spa-live] SKIP_LIVE_SMOKE=1 — skipping post-deploy live smoke check.',
  );
  process.exit(0);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A route check declares the path and whether the SPA shell is required.
// `shell: false` means "this path serves something else (Jekyll), only
// require a 200 + HTML body" — used for the apex root.
function routesForHost(base) {
  const isApex = /\/\/axal\.vc/i.test(base);
  const appRoutes = [
    { path: '/about', shell: true },
    { path: '/dashboard', shell: true },
    { path: '/articles', shell: true },
    { path: `/articles/${encodeURIComponent(SLUG)}`, shell: true },
  ];
  // Apex `/` is Jekyll, not the SPA; the custom domain `/` is the SPA shell.
  appRoutes.unshift({ path: '/', shell: !isApex });
  return appRoutes;
}

function looksLikeJsonNotFound(body) {
  const trimmed = body.trimStart();
  return trimmed.startsWith('{') && /"detail"\s*:\s*"Not found"/i.test(body);
}

function assertShell(body) {
  const problems = [];
  if (!body.includes('<div id="root">')) {
    problems.push('missing `<div id="root">` mount node');
  }
  // Vite emits `<script type="module" crossorigin src="/assets/index-*.js">`.
  const hasModuleAsset =
    /type="module"/.test(body) && /src="\/assets\/[^"]+\.js"/.test(body);
  if (!hasModuleAsset) {
    problems.push('missing hashed `/assets/*.js` module script');
  }
  return problems;
}

async function fetchOnce(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'User-Agent': 'axal-spa-smoke/1.0' },
    });
    const body = await res.text();
    return { status: res.status, ctype: res.headers.get('content-type') || '', body };
  } finally {
    clearTimeout(timer);
  }
}

// Returns null on success, or a human-readable failure reason string.
async function checkRoute(base, route) {
  const url = base.replace(/\/$/, '') + route.path;
  let lastErr = '';
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const { status, ctype, body } = await fetchOnce(url);
      const problems = [];
      if (status !== 200) problems.push(`HTTP ${status} (expected 200)`);
      if (!/text\/html/i.test(ctype)) {
        problems.push(`Content-Type "${ctype || '(none)'}" is not text/html`);
      }
      if (looksLikeJsonNotFound(body)) {
        problems.push('body is the JSON 404 (`{"detail":"Not found"}`)');
      }
      if (route.shell) {
        problems.push(...assertShell(body));
      } else if (!/<html|<!doctype/i.test(body)) {
        problems.push('body is not an HTML document');
      }
      if (problems.length === 0) return null;
      lastErr = problems.join('; ');
    } catch (err) {
      lastErr = `request failed: ${err?.message || err}`;
    }
    if (attempt < RETRIES) {
      console.log(
        `[spa-live]   retry ${attempt}/${RETRIES - 1} for ${url} (${lastErr})`,
      );
      await sleep(RETRY_MS);
    }
  }
  return lastErr;
}

async function main() {
  console.log(
    `[spa-live] Checking ${HOSTS.length} host(s): ${HOSTS.join(', ')}`,
  );
  const failures = [];
  for (const base of HOSTS) {
    const routes = routesForHost(base);
    for (const route of routes) {
      const url = base.replace(/\/$/, '') + route.path;
      const reason = await checkRoute(base, route);
      if (reason) {
        console.error(`[spa-live] FAIL  ${url} — ${reason}`);
        failures.push(`${url} — ${reason}`);
      } else {
        const kind = route.shell ? 'SPA shell' : '200 + HTML';
        console.log(`[spa-live] PASS  ${url} (${kind})`);
      }
    }
  }

  if (failures.length > 0) {
    console.error(
      `\n[spa-live] ✖ ${failures.length} live route check(s) failed after deploy:`,
    );
    for (const f of failures) console.error(`  - ${f}`);
    console.error(
      '\nThe deployed site is serving blank/broken pages or a JSON 404 instead\n' +
        'of the SPA shell. Roll back or redeploy. (Set SKIP_LIVE_SMOKE=1 only if\n' +
        'this host genuinely cannot reach production.)',
    );
    process.exit(1);
  }

  console.log(`\n[spa-live] ✓ All live route checks passed.`);
}

main().catch((err) => {
  console.error('[spa-live] unexpected error:', err);
  process.exit(1);
});
