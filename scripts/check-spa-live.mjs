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
 *   - Every hashed `/assets/*.{js,css}` the shell references actually
 *     RESOLVES on the same host (HTTP 200 + a JS/CSS content-type, never
 *     text/html). This is the check that catches the recurring blank page.
 *     Task #15 routes `axal.vc/assets/*` to the Worker so app routes serve
 *     their OWN build's hashes; on the apex this check ALSO asserts each asset
 *     is Worker-served (no `server: GitHub.com` / `x-github-request-id`) so a
 *     deploy where the route carve silently isn't in effect — the request
 *     falls through to a stale GitHub Pages build and the hashes 404 — fails
 *     here instead of shipping a blank site.
 *
 * Host model (see wrangler.toml + replit.md "Apex routing"):
 *   - app.axal.vc is a Workers Custom Domain: the Worker serves the SPA on
 *     EVERY path via `not_found_handling = "single-page-application"`, so `/`
 *     and all deep links return the shell.
 *   - axal.vc is the proxied apex: the path-scoped zone routes in wrangler.toml
 *     (incl. `/assets/*` as of Task #15) go through the Worker; the apex root
 *     `/` still serves the GitHub Pages SPA build. So on axal.vc we assert the
 *     SPA shell on the routed app paths and only assert "200 + HTML" on `/` —
 *     but every hashed asset the root references is now Worker-served, so the
 *     asset checks below still apply to it.
 *
 * Apex `/api/*` routing assertion (the regression that took prod down):
 *   The shell-HTML checks above can ALL pass while every `/api/*` fetch falls
 *   through to Jekyll. On the proxied apex, if the `axal.vc/api/*` Worker route
 *   isn't registered (stale/incomplete deploy, or a deploy that bound a route
 *   table without the apex carve-out, or Cloudflare zone-route drift), GitHub
 *   Pages answers `/api/*` with an HTML 404 — so the SPA's relative `/api/*`
 *   XHRs 404 and every authenticated page breaks. This script now probes a
 *   stable `/api/*` endpoint on each host and FAILS loudly when it returns an
 *   HTML body instead of a Worker JSON response. A JSON response (a 200 from
 *   /api/health, or even a JSON 401 from an authed probe) counts as HEALTHY —
 *   it proves the request reached the Worker; auth state is irrelevant here.
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
 *   SMOKE_API_PROBE  `/api/*` path probed to prove the Worker is reached
 *                    (default /api/health — unauthenticated, always mounted)
 */

const DEFAULT_HOSTS = ['https://axal.vc', 'https://app.axal.vc'];

const SLUG = process.env.SMOKE_SLUG || 'smoke-test-deeplink';
const RETRIES = Number(process.env.SMOKE_RETRIES || 3);
const RETRY_MS = Number(process.env.SMOKE_RETRY_MS || 5000);
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 15000);
// Always-mounted, unauthenticated `/api/*` probe used to prove the Worker is
// actually reached on each host (see checkApiRouting). `/api/health` is
// registered directly on the Hono app (cloudflare-worker/src/index.ts) and
// returns JSON on every deploy. An authed endpoint would also work — a JSON
// 401 still proves the Worker answered — but health needs no credentials.
const API_PROBE_PATH = process.env.SMOKE_API_PROBE || '/api/health';

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
    { path: '/studio', shell: true },
    { path: '/login', shell: true },
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

// GitHub Pages / Jekyll serves an HTML document (its 404.html or a marketing
// page) when an apex path isn't routed to the Worker. Detect an HTML body so
// an `/api/*` probe that fell through to Pages is flagged even when the
// Content-Type header is missing or unexpected.
function looksLikeHtml(body) {
  return /<!doctype html|<html[\s>]/i.test(body.trimStart().slice(0, 2048));
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

// Pull every hashed `/assets/*.{js,css}` the document references (entry
// script, modulepreload chunks, stylesheet). These are the files the browser
// must load for the page to render; if any 404s the page goes blank.
function extractAssetRefs(body) {
  const refs = new Set();
  const re = /(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g;
  let m;
  while ((m = re.exec(body)) !== null) refs.add(m[1]);
  return refs;
}

// Lightweight metadata fetch: we only need status + content-type, so cancel
// the body stream instead of downloading the (often 500KB+) bundle.
async function fetchAssetMeta(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'User-Agent': 'axal-spa-smoke/1.0' },
    });
    try {
      await res.body?.cancel();
    } catch {
      /* body already consumed/empty */
    }
    return {
      status: res.status,
      ctype: res.headers.get('content-type') || '',
      server: res.headers.get('server') || '',
      githubReqId: res.headers.get('x-github-request-id') || '',
    };
  } finally {
    clearTimeout(timer);
  }
}

// Returns null on success, or a human-readable failure reason. A hashed asset
// is healthy when it returns 200 with a JS/CSS content-type. A 404 (or a 200
// `text/html` from the SPA fallback serving index.html in place of the real
// file) means this host is missing the hash: on the apex that's the `/assets/*`
// Worker route (Task #15) either not carved, or lacking the hash during a
// deploy/Pages skew. Both render a blank page.
async function checkAsset(base, assetPath, expectWorker = false) {
  const url = base.replace(/\/$/, '') + assetPath;
  const isCss = /\.css(?:$|\?)/i.test(assetPath);
  let lastErr = '';
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const { status, ctype, server, githubReqId } = await fetchAssetMeta(url);
      const problems = [];
      if (status !== 200) {
        problems.push(
          `HTTP ${status} (expected 200 — file missing on this host; ` +
            'likely a stale GitHub Pages build behind the Worker. Did the ' +
            'deploy get pushed to GitHub?)',
        );
      }
      if (/text\/html/i.test(ctype)) {
        problems.push(
          'served as text/html (SPA-fallback/404 page, not the real asset — ' +
            'Worker/Pages build skew)',
        );
      } else if (status === 200) {
        const want = isCss ? /css/i : /(javascript|ecmascript)/i;
        if (!ctype) {
          problems.push(
            `200 but missing Content-Type (expected ${isCss ? 'text/css' : 'a JS type'})`,
          );
        } else if (!want.test(ctype)) {
          problems.push(
            `unexpected Content-Type "${ctype}" (expected ${isCss ? 'text/css' : 'a JS type'})`,
          );
        }
      }
      // On the apex, /assets/* must be Worker-served (Task #15 route carve). A
      // GitHub Pages signature here means the carve isn't in effect and the
      // request fell through to a (possibly stale) Pages build.
      if (expectWorker && (/github/i.test(server) || githubReqId)) {
        problems.push(
          'served by GitHub Pages, not the Worker (the `axal.vc/assets/*` ' +
            'route carve is not in effect — the apex asset request fell ' +
            'through to Pages; redeploy so BOTH route blocks in wrangler.toml ' +
            'include `axal.vc/assets/*`)',
        );
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

// Returns null on success, or a human-readable failure reason string. On
// success, any hashed `/assets/*.{js,css}` the document references are added to
// `assetSink` so the caller can verify they actually resolve on this host.
async function checkRoute(base, route, assetSink) {
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
      if (problems.length === 0) {
        // `assetSink` is an intentionally optional parameter (see the doc comment
        // above `checkRoute`): the current caller always passes a `Set`, but a
        // future caller that only wants pass/fail without asset collection can
        // omit it. Static analysis only sees today's single call site and reads
        // this guard as always-true — it's deliberate defensive handling of an
        // optional argument, not dead code.
        // The apex root intentionally falls through to the marketing site,
        // where `shell: false` means this checker only asserts a healthy HTML
        // response. Its asset manifest belongs to GitHub Pages and must not be
        // mixed with the Worker-served SPA asset checks for routed app paths.
        if (assetSink && route.shell) {
          for (const ref of extractAssetRefs(body)) assetSink.add(ref);
        }
        return null;
      }
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

// Returns null when the API probe reaches the Worker on `base`, else a
// human-readable failure reason. HEALTHY = a JSON response: a 200 from
// /api/health, or even a JSON 401 from an authed probe — both prove the
// request reached the Worker. FAILURE = an HTML body / HTML 404, the exact
// signature of `/api/*` falling through to the Jekyll/GitHub-Pages site
// because the `axal.vc/api/*` Worker route isn't registered on this zone.
async function checkApiRouting(base) {
  const url = base.replace(/\/$/, '') + API_PROBE_PATH;
  // axal.vc is the proxied apex (the Jekyll fall-through case); app.axal.vc is
  // the Workers custom domain. Match the same detection routesForHost() uses
  // (`//axal.vc` does not match `//app.axal.vc`) so the failure reason names
  // the correct cause for each host.
  const isApex = /\/\/axal\.vc/i.test(base);
  let lastErr = '';
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const { status, ctype, body } = await fetchOnce(url);
      const isHtml = /text\/html/i.test(ctype) || looksLikeHtml(body);
      const isJson =
        /application\/json/i.test(ctype) ||
        (!isHtml && body.trimStart().startsWith('{'));
      if (isHtml) {
        lastErr = isApex
          ? `apex /api/* fell through to the Jekyll/GitHub-Pages site ` +
            `(HTTP ${status}, Content-Type "${ctype || '(none)'}", HTML body) ` +
            `instead of reaching the Worker`
          : `/api/* returned an HTML response ` +
            `(HTTP ${status}, Content-Type "${ctype || '(none)'}", HTML body) ` +
            `instead of Worker JSON — the Workers custom domain is not routing ` +
            `to the Worker (Worker error page or custom-domain misconfig)`;
      } else if (isJson) {
        // Worker reached (any status — a JSON 401 still proves routing works).
        return null;
      } else {
        lastErr =
          `non-JSON API response (HTTP ${status}, ` +
          `Content-Type "${ctype || '(none)'}") — expected a Worker JSON body`;
      }
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
  let apexApiRoutingFailed = false;
  for (const base of HOSTS) {
    // Apex API-routing assertion FIRST: prove `/api/*` actually reaches the
    // Worker on this host. The shell-HTML + asset checks below can all pass
    // while every `/api/*` fetch falls through to Jekyll (an HTML 404) — the
    // exact regression that took prod down on axal.vc. Catch it loudly before
    // anything else.
    {
      const apiUrl = base.replace(/\/$/, '') + API_PROBE_PATH;
      const reason = await checkApiRouting(base);
      if (reason) {
        console.error(`[spa-live] FAIL  ${apiUrl} — ${reason}`);
        failures.push(`${apiUrl} — ${reason}`);
        if (/\/\/axal\.vc/i.test(base)) apexApiRoutingFailed = true;
      } else {
        console.log(`[spa-live] PASS  ${apiUrl} (API reaches Worker)`);
      }
    }

    const routes = routesForHost(base);
    const assetSink = new Set();
    for (const route of routes) {
      const url = base.replace(/\/$/, '') + route.path;
      const reason = await checkRoute(base, route, assetSink);
      if (reason) {
        console.error(`[spa-live] FAIL  ${url} — ${reason}`);
        failures.push(`${url} — ${reason}`);
      } else {
        const kind = route.shell ? 'SPA shell' : '200 + HTML';
        console.log(`[spa-live] PASS  ${url} (${kind})`);
      }
    }
    // The shell HTML can look perfect while the hashed JS/CSS it points to
    // 404s — the exact signature of the recurring blank page (Worker serves a
    // newer build than the stale GitHub Pages that backs `/assets/*`). Verify
    // every referenced asset actually resolves on this host.
    const assetsExpectWorker = /\/\/axal\.vc/i.test(base);
    for (const assetPath of assetSink) {
      const url = base.replace(/\/$/, '') + assetPath;
      const reason = await checkAsset(base, assetPath, assetsExpectWorker);
      if (reason) {
        console.error(`[spa-live] FAIL  ${url} — ${reason}`);
        failures.push(`${url} — ${reason}`);
      } else {
        console.log(`[spa-live] PASS  ${url} (asset resolves)`);
      }
    }
  }

  if (failures.length > 0) {
    console.error(
      `\n[spa-live] ✖ ${failures.length} live route check(s) failed after deploy:`,
    );
    for (const f of failures) console.error(`  - ${f}`);
    if (apexApiRoutingFailed) {
      console.error(
        '\nAn `/api/*` probe returned an HTML 404 (the Jekyll/GitHub-Pages site)\n' +
          'instead of a Worker JSON response. The `axal.vc/api/*` Worker route is\n' +
          'NOT registered on the apex zone, so the SPA\'s relative `/api/*` fetches\n' +
          'all fall through to Pages and every authenticated page 404s — the same\n' +
          'outage as before.\n' +
          'Fix: redeploy with `npm run deploy` (it passes `--env production`). Note\n' +
          'a plain `wrangler deploy` binds the TOP-LEVEL `[[routes]]` block, so the\n' +
          'apex carve-out (`axal.vc/api/*`, `/dashboard`, `/login`, …) must be kept\n' +
          'in lockstep in BOTH `[[routes]]` and `[[env.production.routes]]` in\n' +
          'wrangler.toml. If `/api/*` still 404s after a correct deploy, reattach\n' +
          'the `axal.vc/*` Worker routes on the `axal.vc` zone in the Cloudflare\n' +
          'dashboard (zone-route drift).',
      );
    }
    console.error(
      '\nThe deployed site is serving blank/broken pages, a JSON 404, or hashed\n' +
        'assets that 404. The most common cause is a Worker/GitHub-Pages build\n' +
        'skew: `npm run deploy` updated the Worker but the build was never pushed\n' +
        'to GitHub, so Pages still serves an older build and the new asset hashes\n' +
        "404. Fix: push main to GitHub (`bash scripts/git-push.sh`) and wait for\n" +
        'Pages to rebuild, then re-run this check. (Set SKIP_LIVE_SMOKE=1 only if\n' +
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
