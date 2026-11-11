#!/usr/bin/env node
/**
 * #4573 (Performance P1) — LAB Web Vitals for the anonymous pages, against the
 * built bundle in `docs/`, in a local Chromium. Not field data: one machine,
 * fixed throttling, no real users, so it is a baseline to compare builds by,
 * never a claim about what visitors see.
 *
 *   node scripts/perf/vitals-local.mjs [--runs=5] [--json=<file>]
 *
 * How:
 *   - a static server over `docs/` with the SPA fallback the Worker's assets
 *     binding gives (`not_found_handling = "single-page-application"`), serving
 *     brotli when asked, `immutable` caching on /assets/*;
 *   - every `/api/*` call is answered here with 401 and recorded by method and
 *     path only (no bodies), so the anonymous page's API waterfall is visible
 *     without a Worker, an account or a network;
 *   - every other origin (Google Fonts) is blocked, so runs are repeatable;
 *     the report says which origins the shell would have reached;
 *   - two profiles: `mobile` (412×823, 4× CPU slowdown, 150 ms RTT,
 *     1.6 Mbps down / 750 kbps up, Lighthouse's "slow 4G") and `desktop`
 *     (1350×940, no throttling);
 *   - each page loads cold (new context) `--runs` times; the median and the
 *     worst run are reported.
 *
 * Measured: TTFB, FCP, LCP, CLS, DOMContentLoaded, load, request count and
 * bytes transferred. INP is a field metric (it needs real interactions) and is
 * reported as unavailable rather than invented.
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { brotliCompressSync, constants } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DOCS = join(ROOT, 'docs');
const require = createRequire(import.meta.url);

export const PAGES = Object.freeze(['/', '/login', '/register', '/pricing']);
export const PROFILES = Object.freeze({
  mobile: { viewport: { width: 412, height: 823 }, cpu: 4, net: { latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 } },
  desktop: { viewport: { width: 1350, height: 940 }, cpu: 1, net: null },
});
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.webp': 'image/webp', '.jpg': 'image/jpeg' };

function serve() {
  const br = new Map();
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://local');
    let file = normalize(join(DOCS, decodeURIComponent(url.pathname)));
    if (!file.startsWith(DOCS)) { res.writeHead(403).end(); return; }
    if (!existsSync(file) || statSync(file).isDirectory()) {
      const index = join(file, 'index.html');
      file = existsSync(index) ? index : join(DOCS, 'index.html');
    }
    const type = TYPES[extname(file)] || 'application/octet-stream';
    let body = readFileSync(file);
    const headers = { 'content-type': type, 'cache-control': url.pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' };
    if (/\b(br)\b/.test(String(req.headers['accept-encoding'])) && /text|javascript|json|svg/.test(type)) {
      if (!br.has(file)) br.set(file, brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }));
      body = br.get(file);
      headers['content-encoding'] = 'br';
    }
    res.writeHead(200, headers).end(body);
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

/** Read in the page: the buffered observers' answers, the navigation timing and the resources fetched. */
const COLLECT = `(() => {
  window.__vitals = { lcp: null, cls: 0, fcp: null };
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__vitals.lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__vitals.cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') window.__vitals.fcp = e.startTime; }).observe({ type: 'paint', buffered: true });
})();`;

async function once(browser, base, path, profile) {
  const ctx = await browser.newContext({ viewport: profile.viewport, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const api = [];
  const blocked = new Set();
  await ctx.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.origin === base) {
      if (u.pathname.startsWith('/api/')) {
        api.push(`${route.request().method()} ${u.pathname}`);
        return route.fulfill({ status: 401, contentType: 'application/json', body: '{"detail":"Not authenticated"}' });
      }
      return route.continue();
    }
    blocked.add(u.origin);
    return route.abort();
  });
  const cdp = await ctx.newCDPSession(page);
  if (profile.net) { await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', { offline: false, ...profile.net }); }
  if (profile.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpu });
  await page.addInitScript(COLLECT);
  await page.goto(base + path, { waitUntil: 'load', timeout: 120_000 });
  await page.waitForTimeout(3000);
  const m = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const res = performance.getEntriesByType('resource');
    return {
      ttfb: nav.responseStart, dcl: nav.domContentLoadedEventEnd, load: nav.loadEventEnd,
      requests: res.length + 1, transfer: res.reduce((t, r) => t + (r.transferSize || 0), nav.transferSize || 0),
      ...window.__vitals,
    };
  });
  await ctx.close();
  return { ...m, api: [...new Set(api)].sort(), blocked: [...blocked].sort() };
}

const median = (xs) => { const s = [...xs].sort((a, z) => a - z); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
const worst = (xs) => (xs.length ? Math.max(...xs) : null);

export async function run({ runs = 5 } = {}) {
  const { chromium } = require('playwright');
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  // The repo's Playwright may pin a browser build this machine lacks; PW_CHROMIUM names another binary.
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}).catch((e) => {
    if (existsSync('/opt/pw-browsers/chromium')) return chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
    throw e;
  });
  const out = { runs, pages: {} };
  try {
    for (const path of PAGES) {
      out.pages[path] = {};
      for (const [name, profile] of Object.entries(PROFILES)) {
        const samples = [];
        for (let i = 0; i < runs; i += 1) samples.push(await once(browser, base, path, profile));
        const pick = (k) => samples.map((s) => s[k]).filter((v) => typeof v === 'number');
        const stat = (k, digits = 0) => ({ median: round(median(pick(k)), digits), worst: round(worst(pick(k)), digits) });
        out.pages[path][name] = {
          ttfb_ms: stat('ttfb'), fcp_ms: stat('fcp'), lcp_ms: stat('lcp'), cls: stat('cls', 3), dcl_ms: stat('dcl'), load_ms: stat('load'),
          requests: stat('requests'), transfer_bytes: stat('transfer'),
          inp: 'unavailable: lab run, no real interactions',
          api_calls: samples[0].api, blocked_origins: samples[0].blocked,
        };
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  return out;
}
const round = (v, d) => (v == null ? null : Number(v.toFixed(d)));

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!existsSync(join(DOCS, 'index.html'))) { console.error('✖ vitals-local: no docs/index.html — run `npm run build` first.'); process.exit(1); }
  const runs = Number((process.argv.find((a) => a.startsWith('--runs=')) || '--runs=5').slice(7)) || 5;
  const r = await run({ runs });
  const json = process.argv.find((a) => a.startsWith('--json='));
  if (json) writeFileSync(json.slice(7), `${JSON.stringify(r, null, 2)}\n`);
  for (const [path, profiles] of Object.entries(r.pages)) {
    for (const [name, m] of Object.entries(profiles)) {
      console.log(`${path.padEnd(10)} ${name.padEnd(8)} LCP ${m.lcp_ms.median}ms (worst ${m.lcp_ms.worst}) FCP ${m.fcp_ms.median}ms CLS ${m.cls.median} TTFB ${m.ttfb_ms.median}ms load ${m.load_ms.median}ms ${m.requests.median} req ${(m.transfer_bytes.median / 1024).toFixed(0)} KiB · api: ${m.api_calls.join(', ') || 'none'}`);
    }
  }
}
