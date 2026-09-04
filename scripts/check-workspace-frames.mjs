#!/usr/bin/env node
/**
 * Render every workspace route and MEASURE the frame, instead of reading the
 * source and believing it.
 *
 * WHY THIS EXISTS. The 1064-test frontend suite reads source as text — there
 * is no DOM in it (frontend/test/README.md) — so it cannot see a page that
 * throws on render. The layout pass proved that gap twice in one hour:
 *
 *   · `/expertise/profile` crashed into RouteErrorBoundary on EVERY visit and
 *     showed a red error card instead of the profile. `ProfileZone` reads
 *     `draft.display_name` and eleven siblings directly inside `<ZoneBody>`'s
 *     children, and React evaluates a component's children when the PARENT
 *     renders — before ZoneBody looks at `loading` to choose between a
 *     skeleton and them. So the null draft was dereferenced on the first
 *     render, always. A `loading` prop cannot guard an expression that is
 *     built before it is read, and no amount of source-reading saw it: the
 *     page's own tests passed, twice, across two PRs that touched it.
 *   · The four-profile frame contract — one crumb, one h1, one sub-line, one
 *     zone-pill row, one rail — was asserted from source for a week. Rendering
 *     it took a few minutes and answered it for all 115 routes.
 *
 * WHAT IT CHECKS, per route: the page renders at all (no crash, no blank), it
 * draws exactly one `<h1>` and at most one Worker AI rail, and where it uses
 * the shared shell, the shell's own `.main` padding is applied.
 *
 * WHAT IT DOES NOT CHECK, deliberately: whether the numbers on the page are
 * right. Every `/api/*` call is stubbed with an EMPTY answer of the correct
 * shape, because the point is the frame, not the data. Getting a shape wrong
 * manufactures a crash the real API would never cause — that happened while
 * writing this, on `/pipeline/analytics`, where a bare `[]` in place of
 * `{matrix: []}` produced a convincing false positive. Shapes here are copied
 * from each page's own 404 fallback for that reason.
 *
 * NOT IN `test:guards`, and that is a judgement rather than an oversight: it
 * needs a Chromium the CI runner is not known to carry, and a check that
 * cannot run must not report success. Run it by hand after a build:
 *
 *     npm run build && node scripts/check-workspace-frames.mjs [role]
 */
import http from 'node:http';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = join(ROOT, 'docs');

let chromium;
try {
  ({ chromium } = await import(join(ROOT, 'frontend/node_modules/@playwright/test/index.mjs')));
} catch {
  console.log('check-workspace-frames: SKIPPED — @playwright/test is not installed.');
  process.exit(0);
}
const EXECUTABLE = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome']
  .find((p) => existsSync(p));

const { allZoneRoutes, bucketsFor } = await import(join(ROOT, 'frontend/src/workspaces/shellConfig.js'));
const ARGS = process.argv.slice(2);

/**
 * `--fail-reads` answers a different question from the default run, and it is
 * the question this repository cares about most.
 *
 * The standing rule is that a failed read renders as a STATED failure — never
 * as emptiness, never as a skeleton that never resolves. "No records found" and
 * "we could not read your records" are different claims, and only one of them
 * is true when the server returned a 500. Until now that rule was only ever
 * asserted by reading source: a test can see that a component HAS an error
 * branch, but not that the branch is what a user actually ends up looking at.
 *
 * With every /api/* answered 500 (auth and the onboarding gate excepted, or
 * nothing under test renders at all), this reads what the page settles on and
 * fails any route that shows a skeleton or asserts emptiness as fact.
 */
const FAIL_READS = ARGS.includes('--fail-reads');
const ROLE_ARG = ARGS.find((a) => !a.startsWith('--'));
const ROLES = ROLE_ARG ? [ROLE_ARG] : ['founder', 'investor', 'advisor', 'partner'];

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.map': 'application/json' };

if (!existsSync(join(DOCS, 'index.html'))) {
  console.error('check-workspace-frames: docs/ has no index.html — run `npm run build` first.');
  process.exit(1);
}

/**
 * Every file docs/ actually contains, walked once and keyed by the URL path
 * that should serve it. The request never becomes a path — it becomes a Map
 * key — so there is no path to traverse.
 *
 * TWO GOES AT THIS, and the second is the one worth keeping. The first built
 * `join(DOCS, decodeURIComponent(req.url))` and read it, which is a genuine
 * traversal: `join` walks out of docs/ on a `..`, and decoding before joining
 * lets `%2e%2e%2f` do the same. Reproduced before fixing —
 * `/../../../../home/user/StudioOS/wrangler.toml` resolved to that file, and
 * it exists.
 *
 * The second added `resolve` plus a containment check, which is correct at
 * runtime — the traversals were provably contained — and CodeQL still flagged
 * it, because its dataflow does not recognise that shape as a sanitizer and
 * the tainted value still reached `existsSync`, `statSync` and `join`.
 *
 * Arguing with the scanner there would have been the wrong move. An allowlist
 * is simply better: the only paths that can ever be opened are ones this
 * process found on disk itself, a missing key falls back to the SPA shell
 * exactly as an unknown route did, and the property is obvious to a reader
 * rather than resting on `resolve` semantics. It costs one walk of ~1200
 * files at startup, which is nothing beside launching a browser.
 */
function indexDocs() {
  const files = new Map();
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name), `${prefix}${entry.name}/`);
      else files.set(`${prefix}${entry.name}`, join(dir, entry.name));
    }
  };
  walk(DOCS, '/');
  return files;
}

const ASSETS = indexDocs();
const SHELL = ASSETS.get('/index.html');

/** The file to serve for a request, by lookup — never by path construction. */
function fileFor(rawUrl) {
  let requested;
  try { requested = decodeURIComponent(rawUrl.split('?')[0]); } catch { return SHELL; }
  const direct = ASSETS.get(requested);
  if (direct) return direct;
  // A directory request serves its index.html, which is how the prerendered
  // routes (/login/, /pricing/) are laid out.
  const asDir = ASSETS.get(`${requested.replace(/\/$/, '')}/index.html`);
  // Everything else is a client route: the SPA shell answers it, exactly as
  // the Worker's assets binding does with not_found_handling.
  return asDir || SHELL;
}

// docs/ with an SPA fallback, which is what the Worker's assets binding does.
const server = http.createServer((req, res) => {
  const file = fileFor(req.url);
  res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch(EXECUTABLE ? { executablePath: EXECUTABLE } : {});
const failures = [];

/**
 * How many data reads this page was refused, reset before each navigation.
 *
 * A route that made NO data call has no failed read to report, and asserting
 * otherwise is a false positive rather than a finding. That is not
 * hypothetical: the five investor `/funds*` routes render the "Institutional
 * add-on" entitlement notice for an account without fund access — a lock shown
 * BEFORE any call goes out — and the first version of this mode flagged all
 * five for "saying nothing about a read that failed". They were right and the
 * check was wrong.
 *
 * Counting is exact rather than a carve-out by route name, so a route that
 * starts making a call later is asserted from that moment without anyone
 * remembering to remove it from a list. Safe as a module-level counter because
 * the loop below visits one page at a time.
 */
let failedReads = 0;

/**
 * The app frame's own calls, which every route makes and no route owns.
 *
 * Counting these as "the page asked for data" is what made the first version
 * of the counter wrong. The five investor `/funds*` routes show the
 * "Institutional add-on" lock without reading anything — and were flagged
 * anyway, because the shell had meanwhile asked for the theme, the explainer
 * copy, the notification badge, the company memberships and the persona. Those
 * are the chrome's reads, not the page's, and a page cannot be asked to report
 * a failure in a call it never made.
 */
const SHELL_READ = /\/api\/(settings|notifications|personas|company\/memberships|auth|onboarding|client-error)/;

for (const role of ROLES) {
  const user = { id: 9, email: 'frame-check@example.test', name: 'Frame Check',
    role, is_super_admin: 0, kyc_status: 'approved', plan: 'pro' };
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  // Nothing off-origin: with no egress the font requests hang and every wait
  // times out on them rather than on the app.
  await ctx.route('**/*', (route) =>
    (route.request().url().startsWith(base) ? route.fallback() : route.abort()));
  await ctx.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    // Auth and the onboarding gate answer normally even in failure mode: a
    // signed-out user is bounced to /login and an incomplete one to the
    // onboarding wizard, so failing those would test neither page.
    const gate = p.endsWith('/auth/me') || p.includes('/onboarding/progress');
    if (FAIL_READS && !gate) {
      if (!SHELL_READ.test(p)) failedReads += 1;
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Internal server error' }),
      });
    }
    let body = [];
    if (p.endsWith('/auth/me')) body = user;
    // The onboarding gate redirects every route to /onboarding/<role> unless
    // this read reports a completion.
    else if (p.includes('/onboarding/progress')) body = { flow: role, completed_at: '2026-01-01T00:00:00Z' };
    else if (p.includes('/insights/heatmap')) body = { matrix: [], stages: [], totals_by_category: {}, total_needs: 0 };
    else if (p.includes('/insights/trends')) body = { months: [], series: [] };
    else if (p.includes('/insights/feed')) body = { items: [], sectors: [], geographies: [] };
    // #45 — the partner workspace's composite reads. Without these lines the
    // generic stub is a BARE `[]`, so `r.items` is undefined and the zone
    // renders whatever it does with no list — which is a state the real API
    // never produces. Stubbing the real envelope means the frame check proves
    // the EMPTY state paints, on purpose rather than by coincidence.
    else if (p.includes('/partner/pipeline/negotiations')) body = { items: [] };
    else if (p.includes('/partner/pipeline/retainers')) {
      body = { items: [], retainer_count: 0, mrr_cents: null, mrr_basis: null, mrr_note: null };
    }
    // #45 — the partner workspace's composite reads. Without these lines the
    // generic stub is a BARE `[]`, so `r.items` is undefined and the zone
    // renders whatever it does with no list — a state the real API never
    // produces. Stubbing the real envelope means the frame check proves the
    // EMPTY state paints, on purpose rather than by coincidence.
    else if (p.includes('/partner/pipeline/negotiations')) body = { items: [] };
    else if (p.includes('/partner/pipeline/retainers')) {
      body = { items: [], retainer_count: 0, mrr_cents: null, mrr_basis: null, mrr_note: null };
    } else if (/\/(summary|overview|analytics|profile|me|progress|status)$/.test(p)) body = {};
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await ctx.addInitScript((u) => {
    localStorage.setItem('user', JSON.stringify(u));
    localStorage.setItem('token', 'frame-check');
  }, user);

  const routes = [...bucketsFor(role).map((b) => b.prefix), ...allZoneRoutes(role)];
  let clean = 0;
  for (const path of routes) {
    const page = await ctx.newPage();
    failedReads = 0;
    const thrown = [];
    page.on('pageerror', (e) => thrown.push(String(e).split('\n')[0].slice(0, 120)));
    try {
      await page.goto(base + path, { waitUntil: 'domcontentloaded', timeout: 15000 });
      // Wait for the app to have PAINTED something, not for a fixed sleep. A
      // flat 500ms reported founder `/build` as blank — it is simply a heavier
      // desk that had not finished mounting — which is a false positive of
      // exactly the kind that makes a check worth ignoring. A route that
      // genuinely renders nothing still fails, one timeout later.
      await page.waitForFunction(
        () => (document.querySelector('[data-app-main]')?.innerText || '').trim().length > 0,
        null, { timeout: 8000 },
      ).catch(() => {});
      // A failed read has a retry and an error card to get through; the
      // healthy path only needs the paint it already waited for.
      await page.waitForTimeout(FAIL_READS ? 2500 : 250);
      const m = await page.evaluate(() => {
        const main = document.querySelector('[data-app-main]');
        const shellBody = main?.querySelector('.min-w-0.flex-1');
        const text = (main?.innerText || '').replace(/\s+/g, ' ').trim();
        return {
          h1: main?.querySelectorAll('h1').length ?? 0,
          rails: main?.querySelectorAll('.fwr, [data-testid$="worker-rail"]').length ?? 0,
          shellPad: shellBody ? getComputedStyle(shellBody).paddingTop : null,
          len: text.length,
          // A spinner still up after the read has failed is the "skeletons
          // forever" report; `aria-busy` is what the shared ZoneBody sets.
          skeletons: main?.querySelectorAll('[aria-busy="true"], .animate-pulse, .fn-rel-loading').length ?? 0,
          statesFailure: /unavailable|could not|did not load|failed|error|try again|retry|not recorded/i.test(text),
          claimsEmpty: /\bno [a-z ]{0,30}(records|available|found|yet)\b|\bnone yet\b/i.test(text),
        };
      });
      const bad = [];
      if (thrown.length) bad.push(`threw: ${thrown[0]}`);
      else if (!m.len) bad.push('rendered nothing');
      // >1 is the doubling bug. 0 is legitimate on an entitlement notice.
      if (m.h1 > 1) bad.push(`${m.h1} h1s`);
      if (m.rails > 1) bad.push(`${m.rails} rails`);
      // Only where the shared shell is actually the frame — several routes
      // draw their own canvas instead, correctly, and have no shell column.
      if (m.shellPad && m.shellPad === '0px') bad.push('shell renders with no padding');
      if (FAIL_READS && failedReads > 0) {
        // This page asked for data and was refused. The rule is that it must
        // not dress that up as an answer — so a spinner still spinning, or a
        // claim that there are no records, is the failure.
        //
        // IT IS NOT REQUIRED TO MENTION THE FAILURE, and an earlier version of
        // this that demanded it was wrong twice over. Investor `/funds` fires
        // `/api/funds/analytics` and then renders the "Institutional add-on"
        // notice — which comes from the `fundUnlocked` entitlement flag, not
        // from that call — so the lock is a complete and true answer whether
        // or not the analytics read succeeded. A page that answers with a
        // stated boundary owes no report about a call it made speculatively.
        // Asserting more than the rule says produces findings that are only
        // ever noise, and a check people learn to ignore checks nothing.
        if (m.skeletons) bad.push(`${m.skeletons} skeleton(s) still up after the read failed`);
        else if (m.claimsEmpty && !m.statesFailure) bad.push('claims "no records" when the read failed');
      }
      if (bad.length) failures.push(`${role} ${path} — ${bad.join('; ')}`);
      else clean += 1;
    } catch (e) {
      failures.push(`${role} ${path} — ${String(e).split('\n')[0].slice(0, 110)}`);
    }
    await page.close();
  }
  console.log(`  ${role}: ${clean}/${routes.length} routes clean`);
  await ctx.close();
}

await browser.close();
server.close();

if (failures.length) {
  console.error(`\ncheck-workspace-frames${FAIL_READS ? ' --fail-reads' : ''}: ${failures.length} route(s) failed.\n`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(FAIL_READS
  ? '✓ check-workspace-frames --fail-reads: every workspace route states a failed read rather than showing a skeleton or claiming empty.'
  : '✓ check-workspace-frames: every workspace route renders and holds the frame.');
