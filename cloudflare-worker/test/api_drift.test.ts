/**
 * Task #1 (AG) — API ↔ Worker drift test (TypeScript canonical source).
 *
 * Parses `frontend/src/lib/api.js` for every `/api/...` path the SPA hits
 * via the `request()` helper (string + template literal), then asserts each
 * is mounted in `cloudflare-worker/src/index.ts` via `app.route('/api/...', …)`.
 *
 * This file is the canonical source of the drift assertions. A runtime mirror
 * lives at `api_drift.test.mjs` because Node 20 (the Replit default runtime)
 * cannot execute `.ts` directly; the mirror re-implements the same logic so
 * `node --test` can run it without a TypeScript loader. Both files MUST stay
 * in sync — when you change one, change the other. `npm run test:drift`
 * executes the `.mjs` mirror; `tsc --noEmit` type-checks this file.
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

export function extractClientPaths(src: string): string[] {
  const paths = new Set<string>();
  const callRe = /\b(?:request|api\.\w+)\s*\(\s*(['"`])([^'"`$\n]+)\1/g;
  let m: RegExpExecArray | null;
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

export function extractWorkerMounts(src: string): string[] {
  const out = new Set<string>();
  const re = /app\.route\(\s*['"`](\/api[^'"`]*)['"`]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.add(m[1]);
  return [...out].sort((a, b) => b.length - a.length);
}

export function isCovered(path: string, mounts: string[]): boolean {
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

// Task #1 (AG) — endpoint-shape contract assertions. The mount-prefix test
// above can't catch param-name drift like `/items/:uid` vs `/items/:id`, so
// we additionally pin the literal route declarations the spec requires.
test('spec-contract endpoint signatures use the documented param names', () => {
  const cases: Array<{ file: string; matchers: RegExp[] }> = [
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

// Task #1 (AG) — guard against the alias-forwarding bug where query string
// gets concatenated into url.pathname (produces encoded `%3F` and 404s).
test('alias forwarders never concatenate url.search into url.pathname', () => {
  const aliasFiles = [
    'cloudflare-worker/src/routes/watchlist.ts',
    'cloudflare-worker/src/routes/journal.ts',
    'cloudflare-worker/src/routes/cofounder.ts',
    'cloudflare-worker/src/routes/comarketing.ts',
    'cloudflare-worker/src/routes/company.ts',
    'cloudflare-worker/src/routes/needs.ts',
    'cloudflare-worker/src/routes/mentors.ts',
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

// Task #1 (AG) — files newly added by this task must not introduce `: any`
// return types (anti-slop guard). Existing files are grandfathered.
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
