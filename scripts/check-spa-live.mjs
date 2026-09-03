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
 *     text/html). This is the check that catches the recurring blank page:
 *     a shell and its `/assets/*` served from two different builds (the
 *     2026-08-31 apex outage paired Pages-served HTML with a different
 *     Worker asset build). Both hosts are now served by the one Worker from
 *     its `[assets]` copy of `docs/`, so the shell and its hashes come from
 *     the same `wrangler deploy`; a mismatch here means a skewed or partial
 *     deploy.
 *   - The response carries the static security headers `docs/_headers`
 *     declares (HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options`,
 *     `Referrer-Policy`). The Worker's assets binding answers these routes
 *     without running the Hono app, so `securityHeaders.ts` never touches
 *     them; the headers come only from `frontend/public/_headers`, which
 *     Workers static assets read natively. This is the live answer to
 *     UNRESOLVED_ITEMS.md U10 — measured here, not asserted from a document.
 *
 * Host model (see wrangler.toml `[[routes]]` + `[assets]`, CLAUDE.md fact 4):
 *   - axal.vc AND app.axal.vc are both whole-host Workers Custom Domains of
 *     the `studioos` Worker (since 2026-09-01, commit 1d320dda9). The Worker
 *     serves the SPA on EVERY path of either host via `not_found_handling =
 *     "single-page-application"`, so `/` and all deep links return the
 *     shell; `/api/*`, `/landing/*`, `/p/*` and `/assets/*` run the Hono app
 *     first (`run_worker_first`). One build sits behind both hosts and they
 *     ship together on every deploy. The asset checks ensure each shell
 *     receives its matching JS and CSS.
 *   - There is no other host. The Cloudflare Pages mirror
 *     (studioos-2p8.pages.dev) was retired on 2026-09-03 (DECISIONS.md D36);
 *     who serves a host is settled by the deploy log's "Deployed studioos
 *     triggers" lines, never by prose.
 *
 * Apex `/api/*` routing assertion (the regression that took prod down):
 *   The shell-HTML checks above can ALL pass while every `/api/*` fetch never
 *   reaches the Hono app. Historically that meant another host served the
 *   apex (GitHub Pages, then Cloudflare Pages) and the `axal.vc/api/*` Worker
 *   route was missing, so `/api/*` came back as that host's HTML 404. Today
 *   it means the custom domain is not bound to the Worker (an HTML error
 *   page), or `/api/*` has dropped out of `run_worker_first` and the assets
 *   binding's SPA fallback answers with `index.html` (an HTML 200). Either
 *   way the SPA's relative `/api/*` XHRs get HTML and every authenticated
 *   page breaks. This script probes a stable `/api/*` endpoint on each host
 *   and FAILS loudly when it returns an HTML body instead of a Worker JSON
 *   response. A JSON response (a 200 from /api/health, or even a JSON 401
 *   from an authed probe) counts as HEALTHY — it proves the request reached
 *   the Worker; auth state is irrelevant here.
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

// Static security headers every SPA shell response must carry. They are set
// by `docs/_headers` (built from frontend/public/_headers), which Workers
// static assets apply to the responses the assets binding serves. The values
// mirror cloudflare-worker/src/middleware/securityHeaders.ts except
// Referrer-Policy, which is deliberately laxer on the public static surface
// (GOTCHAS, "Referrer-Policy is two-tier"). HSTS is matched on the presence
// of a max-age so a longer or shorter window is not a deploy failure; the
// other three must be the exact value the file declares.
const REQUIRED_SHELL_HEADERS = [
  ['strict-transport-security', /max-age=\d+/i],
  ['x-content-type-options', /^nosniff$/i],
  ['x-frame-options', /^deny$/i],
  ['referrer-policy', /^strict-origin-when-cross-origin$/i],
];

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
// `shell: false` means "only require a 200 + HTML body" — used for the apex
// root, a leniency from when another host served `/` on the apex (see the
// note on that entry below).
function routesForHost(base) {
  const isApex = /\/\/axal\.vc/i.test(base);
  const appRoutes = [
    { path: '/about', shell: true },
    { path: '/dashboard', shell: true },
    { path: '/studio', shell: true },
    { path: '/login', shell: true },
    { path: '/articles', shell: true },
    { path: `/articles/${encodeURIComponent(SLUG)}`, shell: true },
    // Signed-in app paths, added 2026-08-29. Until then every route in this
    // list happened to be one of the four apex segments that WERE routed, so
    // the check reported all-PASS through a period when 37 of the 41 segments
    // the sidebar links to had no apex route at all. These six span segments
    // that were in the broken set; on the apex they are served only by the
    // explicit route table, so a table-wide revert turns them red here.
    { path: '/perks', shell: true },
    { path: '/messages', shell: true },
    { path: '/raise/data-room', shell: true },
    { path: '/admin/licences', shell: true },
    { path: '/portfolio/health', shell: true },
    { path: '/spinout-lab', shell: true },
  ];
  // Apex `/` is checked leniently (`shell: false`): it was a separate
  // marketing page (GitHub Pages, then Cloudflare Pages) until 2026-09-01.
  // Since 1d320dda9 the Worker's assets binding answers `/` on both hosts
  // with the same shell; the leniency is kept as-is here, not yet tightened.
  appRoutes.unshift({ path: '/', shell: !isApex });
  return appRoutes;
}

function looksLikeJsonNotFound(body) {
  const trimmed = body.trimStart();
  return trimmed.startsWith('{') && /"detail"\s*:\s*"Not found"/i.test(body);
}

// An `/api/*` probe that never reaches the Hono app comes back as HTML: the
// SPA shell (HTTP 200) if `/api/*` ever drops out of `run_worker_first` and
// the assets binding's single-page-application fallback answers instead, or
// an error page if the host is not bound to the Worker at all. Detect an
// HTML body so such a probe is flagged even when the Content-Type header is
// missing or unexpected.
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

// The shell's security headers, from `docs/_headers`. A missing header means
// the file did not ship in the deployed build, its rules no longer parse, or
// Workers static assets is not applying it to the SPA fallback — the
// UNRESOLVED_ITEMS.md U10 case, which this check answers by measurement.
function assertSecurityHeaders(headers) {
  const problems = [];
  for (const [name, want] of REQUIRED_SHELL_HEADERS) {
    const got = headers.get(name);
    if (got == null) {
      problems.push(`missing security header ${name} (docs/_headers not applied)`);
    } else if (!want.test(got.trim())) {
      problems.push(`security header ${name} is "${got}" (expected ${want})`);
    }
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
// file) means this host is missing the hash or its HTML and assets came from
// different deployments. Both render a blank page.
async function checkAsset(base, assetPath) {
  const url = base.replace(/\/$/, '') + assetPath;
  const isCss = /\.css(?:$|\?)/i.test(assetPath);
  let lastErr = '';
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const { status, ctype } = await fetchAssetMeta(url);
      const problems = [];
      if (status !== 200) {
        problems.push(
          `HTTP ${status} (expected 200 — file missing on this host; ` +
            'the shell and asset origins may be serving different builds)',
        );
      }
      if (/text\/html/i.test(ctype)) {
        problems.push(
          'served as text/html (SPA-fallback/404 page, not the real asset — ' +
            'the shell and its assets came from different builds)',
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
    return {
      status: res.status,
      ctype: res.headers.get('content-type') || '',
      headers: res.headers,
      body,
    };
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
      const { status, ctype, headers, body } = await fetchOnce(url);
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
        problems.push(...assertSecurityHeaders(headers));
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
        // The apex root is a `shell: false` route (a healthy HTML response is
        // all this checker asserts there), a leniency from when a separate
        // marketing site answered `/` on the apex and its asset manifest could
        // not be mixed with the Worker's. Both hosts' `/` now come from the
        // Worker's assets binding, but only `shell: true` routes feed the
        // asset checks, so the split is kept.
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
// request reached the Worker. FAILURE = an HTML body, the signature of
// `/api/*` never reaching the Hono app: the host is not bound to the Worker,
// or `/api/*` left `run_worker_first` and the assets binding's SPA fallback
// answered with `index.html`. (Before 2026-09-01 it was the apex's other
// host — GitHub Pages, then Cloudflare Pages — answering with its HTML 404.)
async function checkApiRouting(base) {
  const url = base.replace(/\/$/, '') + API_PROBE_PATH;
  // Both hosts are Workers Custom Domains (since 2026-09-01, 1d320dda9); the
  // apex/app split below only chooses which failure text is printed. Match the
  // same detection routesForHost() uses (`//axal.vc` does not match
  // `//app.axal.vc`) so each host gets its own message.
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
          ? `apex /api/* answered with HTML ` +
            `(HTTP ${status}, Content-Type "${ctype || '(none)'}", HTML body) ` +
            `instead of reaching the Worker — the axal.vc custom-domain binding is not answering`
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
  let securityHeadersFailed = false;
  for (const base of HOSTS) {
    // Apex API-routing assertion FIRST: prove `/api/*` actually reaches the
    // Worker on this host. The shell-HTML + asset checks below can all pass
    // while every `/api/*` fetch comes back as HTML instead of Worker JSON —
    // the exact regression that took prod down on axal.vc (then an HTML 404
    // from the host that served the apex). Catch it loudly before anything
    // else.
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
        if (/security header/.test(reason)) securityHeadersFailed = true;
      } else {
        const kind = route.shell ? 'SPA shell + security headers' : '200 + HTML';
        console.log(`[spa-live] PASS  ${url} (${kind})`);
      }
    }
    // The shell HTML can look perfect while the hashed JS/CSS it points to
    // 404s — the exact signature of the recurring blank page (an `index.html`
    // and the `/assets/*` it references coming from two different builds; on
    // 2026-08-31 that was Pages-served HTML against a different Worker asset
    // build). Both hosts now come from one Worker deploy, so a mismatch here
    // means the deploy itself is skewed. Verify every referenced asset
    // actually resolves on this host.
    for (const assetPath of assetSink) {
      const url = base.replace(/\/$/, '') + assetPath;
      const reason = await checkAsset(base, assetPath);
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
        '\nAn `/api/*` probe returned HTML instead of a Worker JSON response, so\n' +
          'the request never reached the Worker: the whole-host custom-domain\n' +
          'binding for that host is missing or its DNS record has drifted. Both\n' +
          '`axal.vc` and `app.axal.vc` are Workers Custom Domains of `studioos`\n' +
          '(wrangler.toml [[routes]] and [[env.production.routes]], kept in\n' +
          'lockstep). Fix: redeploy with `npm run deploy` (it passes\n' +
          '`--env production` and re-binds both domains), then read the closing\n' +
          '"Deployed studioos triggers" lines of the deploy output and the DNS\n' +
          'record for the host in the Cloudflare dashboard. Never add a\n' +
          'path-scoped `axal.vc/*` or `axal.vc/assets/*` route: it steals those\n' +
          'URLs from the assets binding and breaks the SPA fallback (the\n' +
          '2026-08-31 outage).',
      );
    }
    if (securityHeadersFailed) {
      console.error(
        '\nA SPA shell response is missing a security header. Those routes are\n' +
          "answered by the Worker's assets binding without the Hono app, so the\n" +
          'headers come only from `docs/_headers` (built from\n' +
          'frontend/public/_headers by `npm run build`). Check that the deployed\n' +
          'build carried the file and that its rules still parse; if Workers\n' +
          'static assets is not applying it to the SPA fallback, that is the\n' +
          'documentation/architecture/UNRESOLVED_ITEMS.md U10 case — route the\n' +
          'shell through the Worker rather than asserting the headers from a\n' +
          'document.',
      );
    }
    console.error(
      '\nThe deployed site is serving blank/broken pages, a JSON 404, hashed\n' +
        'assets that 404, or a shell without its security headers. On both hosts\n' +
        'the Worker serves the HTML, /assets/* and /api/* from one build, so\n' +
        'confirm the latest main commit\'s "Cloudflare Worker deploy" run finished\n' +
        '(GitHub Actions) — nothing else ships a build to either host — and\n' +
        're-run this check. (Set SKIP_LIVE_SMOKE=1 only if this host genuinely\n' +
        'cannot reach production.)',
    );
    process.exit(1);
  }

  console.log(`\n[spa-live] ✓ All live route checks passed.`);
}

main().catch((err) => {
  console.error('[spa-live] unexpected error:', err);
  process.exit(1);
});
