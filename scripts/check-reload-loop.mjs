#!/usr/bin/env node
/**
 * A recovery reload is bounded, or it is a reload loop — MEASURED in a browser
 * rather than read out of the source.
 *
 * WHY THIS EXISTS. `frontend/test/chunk_reload_loop.test.mjs` reads the source
 * as text: it can see that a bound is written down, not that the bound holds.
 * That is exactly the gap the service-worker reload lived in. Its guard was
 *
 *     let _reloadingForUpdate = false;
 *
 * inside the registration closure, with a comment claiming it "guard[s] against
 * any reload loop with a one-shot flag". A source-reading test sees a flag being
 * checked and set, and passes. What it cannot see is that the flag dies with the
 * document, so every reload re-arms it: the bound was one reload PER PAGE LOAD,
 * which bounds no loop at all. Only counting actual navigations catches that.
 *
 * WHAT IT DOES. Serves the built `docs/`, lets the real service worker install
 * and take control, then dispatches `controllerchange` at the page repeatedly —
 * which is what `sw.js` produces for real, since it calls `skipWaiting()` on
 * every install and `clients.claim()` on activate, and `claim()` fires
 * `controllerchange` on a page that already has a controller. Then it counts how
 * many times the main frame actually navigated.
 *
 * The event is dispatched synthetically because `ServiceWorkerContainer` is an
 * `EventTarget` and the app's listener is an ordinary `addEventListener` on it.
 * That tests the app's handler, which is where the defect was — not the
 * browser's worker lifecycle, which is not ours to test.
 *
 * WHAT IT DOES NOT DO. It cannot reproduce Safari, and the bug was only ever
 * seen there. Chromium proves the BOUND; whether Safari's worker lifecycle is
 * what fires `controllerchange` repeatedly is a separate question, answered from
 * a real browser. A green run here means "the app stops reloading", not "Safari
 * is fixed".
 *
 * Not in `test:guards`: it needs a Chromium the CI runner is not known to carry,
 * and a check that cannot run must not report success.
 *
 *     npm run build && node scripts/check-reload-loop.mjs
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
  console.log('check-reload-loop: SKIPPED — @playwright/test is not installed.');
  process.exit(0);
}
const EXECUTABLE = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => existsSync(p));

if (!existsSync(join(DOCS, 'index.html'))) {
  console.error('check-reload-loop: docs/ has no index.html — run `npm run build` first.');
  process.exit(1);
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.map': 'application/json',
  '.webmanifest': 'application/manifest+json' };

/** Allowlist of real files, so a request is a lookup and never a path to walk. */
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

function fileFor(rawUrl) {
  let requested;
  try { requested = decodeURIComponent(rawUrl.split('?')[0]); } catch { return SHELL; }
  return ASSETS.get(requested)
    || ASSETS.get(`${requested.replace(/\/$/, '')}/index.html`)
    || SHELL;
}

const server = http.createServer((req, res) => {
  const file = fileFor(req.url);
  const headers = { 'content-type': MIME[extname(file)] || 'application/octet-stream' };
  // The worker script must be servable at the root scope, which it is: `/sw.js`
  // is a real file in docs/ and resolves through the allowlist above.
  res.writeHead(200, headers);
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

// 127.0.0.1 rather than `localhost` ON PURPOSE: `sw.js` short-circuits its whole
// fetch handler on a host matching /localhost|replit/, and this check wants the
// worker behaving as it does in production. A loopback address is still a secure
// context, so registration works.

const browser = await chromium.launch(EXECUTABLE ? { executablePath: EXECUTABLE } : {});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.route('**/*', (route) =>
  (route.request().url().startsWith(base) ? route.fallback() : route.abort()));
await ctx.route('**/api/**', (route) => route.fulfill({
  status: 200, contentType: 'application/json', body: '{}',
}));

const failures = [];
const page = await ctx.newPage();
let navigations = 0;
page.on('framenavigated', (f) => { if (f === page.mainFrame()) navigations += 1; });

const ROUTE = '/login/';
try {
  // 1. First load installs the worker. `clients.claim()` gives this page a
  //    controller, but the app's listener is NOT armed on this load — it is
  //    gated on a controller existing at script-evaluation time, which is
  //    correct: a brand-new visitor must not be reloaded.
  await page.goto(base + ROUTE, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForFunction(() => !!navigator.serviceWorker, null, { timeout: 10000 });
  const controlled = await page.waitForFunction(
    () => !!navigator.serviceWorker.controller, null, { timeout: 15000 },
  ).then(() => true).catch(() => false);

  if (!controlled) {
    console.log('check-reload-loop: SKIPPED — the service worker never took control here.');
    await browser.close(); server.close(); process.exit(0);
  }

  // 2. Reload so the page boots WITH a controller and arms the listener.
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForFunction(() => !!window.__axalBooted, null, { timeout: 15000 }).catch(() => {});

  // 3. Drive the cycle. Each dispatch is one `clients.claim()` worth of signal.
  //    A bounded handler reloads at most its budget and then ignores the rest;
  //    an unbounded one reloads on every single dispatch, because each reload
  //    hands the next document a fresh flag.
  const DISPATCHES = 6;
  navigations = 0;
  for (let i = 0; i < DISPATCHES; i += 1) {
    await page.evaluate(() => {
      navigator.serviceWorker.dispatchEvent(new Event('controllerchange'));
    }).catch(() => { /* a navigation mid-evaluate is the very thing being counted */ });
    await page.waitForTimeout(700);
  }
  await page.waitForTimeout(1200);

  // The budget is 1 (`MAX_SW_RELOADS` in `lib/pwa.js`), and a reload can land as
  // more than one `framenavigated` on some paths, so the assertion is that the
  // page SETTLES — not an exact count. Six dispatches producing six navigations
  // is the loop; six producing one or two is the bound doing its job.
  const CEILING = 3;
  if (navigations > CEILING) {
    failures.push(`${DISPATCHES} controllerchange events produced ${navigations} navigations `
      + `(ceiling ${CEILING}) — the reload is not bounded across reloads`);
  }
  console.log(`  ${DISPATCHES} controllerchange events → ${navigations} navigation(s)`);

  // 4. And the bound must be readable from where it was stored, not just from a
  //    variable that happened to survive.
  const carried = await page.evaluate(() => ({
    url: window.location.search,
    stored: (() => { try { return sessionStorage.getItem('axal:sw-reload-attempts'); } catch { return null; } })(),
  }));
  if (navigations > 0 && !carried.stored && !/__swreload=/.test(carried.url)) {
    failures.push('the page reloaded but recorded the attempt nowhere — the next document has a fresh budget');
  }
} catch (e) {
  failures.push(String(e).split('\n')[0].slice(0, 160));
}

await page.close();
await ctx.close();
await browser.close();
server.close();

if (failures.length) {
  console.error(`\ncheck-reload-loop: ${failures.length} failure(s).\n`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log('✓ check-reload-loop: a service-worker controllerchange storm does not reload without bound.');
