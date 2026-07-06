/**
 * Task #1 (AG) — API ↔ Worker drift test (mount-existence).
 *
 * Parses `frontend/src/lib/api.js` for every `/api/...` path the SPA hits
 * via the `request()` helper (string + template literal), then asserts each
 * is mounted in `cloudflare-worker/src/index.ts` via `app.route('/api/...', …)`.
 *
 * This is a PREFIX-level checker — the existing `scripts/check-api-drift.mjs`
 * remains the canonical CLI. This file mirrors it under `node --test` so
 * the worker test suite catches drift in CI.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const API_FILE = resolve(ROOT, 'frontend/src/lib/api.js');
const WORKER_FILE = resolve(ROOT, 'cloudflare-worker/src/index.ts');

function extractClientPaths(src) {
  const paths = new Set();
  const callRe = /\b(?:request|api\.\w+)\s*\(\s*(['"`])([^'"`$\n]+)\1/g;
  let m;
  while ((m = callRe.exec(src)) !== null) {
    if (m[2].startsWith('/')) paths.add(m[2]);
  }
  const tplRe = /\b(?:request|api\.\w+)\s*\(\s*`([^`]+)`/g;
  while ((m = tplRe.exec(src)) !== null) {
    let p = m[1];
    if (!p.startsWith('/')) continue;
    p = p.replace(/\$\{[^}]+\}/g, ':param');
    paths.add(p);
  }
  return [...paths];
}

function extractWorkerMounts(src) {
  const out = new Set();
  const re = /app\.route\(\s*['"`](\/api[^'"`]*)['"`]/g;
  let m;
  while ((m = re.exec(src)) !== null) out.add(m[1]);
  return [...out].sort((a, b) => b.length - a.length);
}

function isCovered(path, mounts) {
  const full = '/api' + path;
  return mounts.some((p) => full === p || full.startsWith(p + '/'));
}

test('every SPA /api path has a mounted worker route', () => {
  const apiSrc = readFileSync(API_FILE, 'utf8');
  const workerSrc = readFileSync(WORKER_FILE, 'utf8');
  const clientPaths = extractClientPaths(apiSrc);
  const workerMounts = extractWorkerMounts(workerSrc);
  assert.ok(clientPaths.length > 0, 'expected client paths to parse');
  assert.ok(workerMounts.length > 0, 'expected worker mounts to parse');
  const missing = clientPaths.filter((p) => !isCovered(p, workerMounts)).sort();
  assert.deepEqual(
    missing,
    [],
    `Frontend calls these /api paths with no matching worker mount:\n${missing.map((m) => '  - ' + m).join('\n')}`,
  );
});

test('founder_risk, services, public routes are mounted', () => {
  const workerSrc = readFileSync(WORKER_FILE, 'utf8');
  const mounts = extractWorkerMounts(workerSrc);
  for (const required of ['/api/founder-risk', '/api/services', '/api/public']) {
    assert.ok(
      mounts.includes(required),
      `expected app.route('${required}', …) in cloudflare-worker/src/index.ts`,
    );
  }
});

test('spec-contract endpoint signatures use the documented param names', () => {
  const cases = [
    {
      file: resolve(ROOT, 'cloudflare-worker/src/routes/watchlist.ts'),
      matchers: [
        /r\.delete\(\s*['"]\/items\/:id['"]/,
        /r\.get\(\s*['"]\/items['"]/,
        /r\.post\(\s*['"]\/items['"]/,
        /r\.get\(\s*['"]\/digest['"]/,
      ],
    },
    {
      file: resolve(ROOT, 'cloudflare-worker/src/routes/journal.ts'),
      matchers: [
        /r\.patch\(\s*['"]\/entries\/:id['"]/,
        /r\.delete\(\s*['"]\/entries\/:id['"]/,
        /r\.get\(\s*['"]\/entries['"]/,
        /r\.post\(\s*['"]\/entries['"]/,
      ],
    },
  ];
  for (const { file, matchers } of cases) {
    const src = readFileSync(file, 'utf8');
    for (const re of matchers) {
      assert.ok(re.test(src), `expected ${re} in ${file}`);
    }
  }
});

test('alias forwarders never concatenate url.search into url.pathname', () => {
  const aliasFiles = [
    'cloudflare-worker/src/routes/watchlist.ts',
    'cloudflare-worker/src/routes/journal.ts',
    'cloudflare-worker/src/routes/cofounder.ts',
    'cloudflare-worker/src/routes/comarketing.ts',
    'cloudflare-worker/src/routes/company.ts',
    'cloudflare-worker/src/routes/needs.ts',
    'cloudflare-worker/src/routes/advisors.ts',
    'cloudflare-worker/src/routes/partner_office_hours.ts',
  ];
  const bad = /url\.pathname\s*=\s*[^;]*\+\s*url\.search/;
  const badConcat = /new Request\(\s*url\s*\+/;
  for (const rel of aliasFiles) {
    const src = readFileSync(resolve(ROOT, rel), 'utf8');
    assert.ok(
      !bad.test(src),
      `${rel} concatenates url.search into url.pathname — assign url.search separately instead`,
    );
    assert.ok(
      !badConcat.test(src),
      `${rel} concatenates a string onto a URL object in new Request(url + …) — pass the URL object directly so url.search is preserved exactly once`,
    );
  }
});

test('newly added Task #1 files do not leak `: any` return types', () => {
  const newFiles = [
    'cloudflare-worker/src/routes/founder_risk.ts',
    'cloudflare-worker/src/routes/services.ts',
    'cloudflare-worker/src/routes/public.ts',
    'cloudflare-worker/src/routes/progress.ts',
  ];
  const banned = /\)\s*:\s*any\b/;
  for (const rel of newFiles) {
    const src = readFileSync(resolve(ROOT, rel), 'utf8');
    assert.ok(
      !banned.test(src),
      `${rel} declares a function with \`: any\` return type — use a concrete type`,
    );
  }
});
