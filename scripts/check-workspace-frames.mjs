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
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, dirname, resolve, sep } from 'node:path';
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
const ROLES = process.argv[2] ? [process.argv[2]] : ['founder', 'investor', 'advisor', 'partner'];

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.map': 'application/json' };

if (!existsSync(join(DOCS, 'index.html'))) {
  console.error('check-workspace-frames: docs/ has no index.html — run `npm run build` first.');
  process.exit(1);
}

const SHELL = join(DOCS, 'index.html');

/**
 * A request path resolved strictly INSIDE docs/, or the SPA shell.
 *
 * The first version of this did `join(DOCS, decodeURIComponent(req.url))` and
 * read the result, which is a path traversal: `join` happily walks out of
 * docs/ on a `..`, and decoding first means `%2e%2e%2f` gets there too. CodeQL
 * flagged it five times and was right to. The server binds to 127.0.0.1 on an
 * ephemeral port and lives for one run, so nothing was reachable in practice —
 * but "not reachable today" is not the same as "not a traversal", and the
 * containment check costs one line.
 *
 * `resolve` is what does the work: it collapses `..` BEFORE the comparison, so
 * the prefix test below is a decision about the final path rather than about
 * the text of the request. The `sep` matters too — without it `/docs-evil`
 * would pass a bare `startsWith(DOCS)`.
 */
function resolveInsideDocs(rawUrl) {
  let decoded;
  try { decoded = decodeURIComponent(rawUrl.split('?')[0]); } catch { return SHELL; }
  const candidate = resolve(DOCS, `.${decoded.startsWith('/') ? decoded : `/${decoded}`}`);
  if (candidate !== DOCS && !candidate.startsWith(DOCS + sep)) return SHELL;
  if (!existsSync(candidate)) return SHELL;
  if (statSync(candidate).isDirectory()) {
    const index = join(candidate, 'index.html');
    return existsSync(index) ? index : SHELL;
  }
  return candidate;
}

// docs/ with an SPA fallback, which is what the Worker's assets binding does.
const server = http.createServer((req, res) => {
  const file = resolveInsideDocs(req.url);
  res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch(EXECUTABLE ? { executablePath: EXECUTABLE } : {});
const failures = [];

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
    let body = [];
    if (p.endsWith('/auth/me')) body = user;
    // The onboarding gate redirects every route to /onboarding/<role> unless
    // this read reports a completion.
    else if (p.includes('/onboarding/progress')) body = { flow: role, completed_at: '2026-01-01T00:00:00Z' };
    else if (p.includes('/insights/heatmap')) body = { matrix: [], stages: [], totals_by_category: {}, total_needs: 0 };
    else if (p.includes('/insights/trends')) body = { months: [], series: [] };
    else if (p.includes('/insights/feed')) body = { items: [], sectors: [], geographies: [] };
    else if (/\/(summary|overview|analytics|profile|me|progress|status)$/.test(p)) body = {};
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await ctx.addInitScript((u) => {
    localStorage.setItem('user', JSON.stringify(u));
    localStorage.setItem('token', 'frame-check');
  }, user);

  const routes = [...bucketsFor(role).map((b) => b.prefix), ...allZoneRoutes(role)];
  let clean = 0;
  for (const path of routes) {
    const page = await ctx.newPage();
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
      await page.waitForTimeout(250);
      const m = await page.evaluate(() => {
        const main = document.querySelector('[data-app-main]');
        const shellBody = main?.querySelector('.min-w-0.flex-1');
        return {
          h1: main?.querySelectorAll('h1').length ?? 0,
          rails: main?.querySelectorAll('.fwr, [data-testid$="worker-rail"]').length ?? 0,
          shellPad: shellBody ? getComputedStyle(shellBody).paddingTop : null,
          len: (main?.innerText || '').trim().length,
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
  console.error(`\ncheck-workspace-frames: ${failures.length} route(s) do not hold the frame.\n`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log('✓ check-workspace-frames: every workspace route renders and holds the frame.');
