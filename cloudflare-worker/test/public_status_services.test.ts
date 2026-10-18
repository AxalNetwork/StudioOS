/**
 * `GET /api/public/status` — the rows the public /status page draws.
 *
 * Pins:
 *   - with production's bindings every row is operational, so the page reads
 *     "All systems operational" (File storage once probed `env.R2`, which no
 *     wrangler.toml has ever bound; the bucket is `FILES`, so the row sat at
 *     "unknown" and the page rolled up to "Degraded");
 *   - the five rows added after it (search, jobs, published pages, backups,
 *     rendering) read their own bindings the same way;
 *   - a missing binding still reads honestly: "unknown" for AI and files,
 *     "down" for a store /api/health reports;
 *   - no row name carries a platform part ("(D1)", "(KV)", "Workers AI");
 *   - an incident tagged with the old technical word ("R2") still paints the
 *     row it names, and only that row.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/public_status_services.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeD1 } from './_d1_sqlite.mjs';
import publicRoutes from '../src/routes/public.ts';

const BOUND = {
  TOKENS: {}, RATE_LIMITS: {}, PIPELINE_ROOM: {}, ONBOARDING_CHAT: {}, AI: {}, FILES: {},
  VECTORIZE: {}, JOB_QUEUE: {}, PUBLICATIONS: {}, BACKUPS: {}, BROWSER: {},
};

type Row = { name: string; status: string; uptime_pct: number; history: Array<{ day: string; status: string }> };

async function status(extra: Record<string, unknown>, seed = '') {
  const realFetch = globalThis.fetch;
  // The route asks its own /api/health first; with no Worker behind it the
  // probe falls back to the bindings it was given, as it does when that hop fails.
  globalThis.fetch = (async () => { throw new Error('no network in tests'); }) as typeof fetch;
  try {
    const env = { ...makeD1('SELECT 1;', ''), ...extra };
    if (seed) {
      await publicRoutes.request('/status', {}, env);
      env.db.exec(seed);
    }
    const res = await publicRoutes.request('/status', {}, env);
    assert.equal(res.status, 200);
    return (await res.json()) as { services: Row[] };
  } finally {
    globalThis.fetch = realFetch;
  }
}

test("production's bindings read operational on every row, File storage included", async () => {
  const { services } = await status(BOUND);
  assert.deepEqual(services.map((s) => [s.name, s.status]), [
    ['API and database', 'operational'],
    ['Sign-in sessions', 'operational'],
    ['Rate limiting', 'operational'],
    ['Live updates', 'operational'],
    ['Onboarding chat', 'operational'],
    ['AI scoring', 'operational'],
    ['File storage', 'operational'],
    ['Search', 'operational'],
    ['Background jobs', 'operational'],
    ['Published pages', 'operational'],
    ['Backups', 'operational'],
    ['Document rendering', 'operational'],
  ]);
  for (const s of services) assert.equal(s.uptime_pct, 100, `${s.name} with no incident is at 100%`);
});

test('a missing binding is reported, not hidden', async () => {
  const { services } = await status({ ...BOUND, FILES: undefined, TOKENS: undefined });
  const by = Object.fromEntries(services.map((s) => [s.name, s.status]));
  assert.equal(by['File storage'], 'unknown');
  assert.equal(by['Sign-in sessions'], 'down');
});

test('no row name carries a platform part, and the match keys never leave the Worker', async () => {
  const { services } = await status(BOUND);
  for (const s of services) {
    assert.doesNotMatch(s.name, /\(|D1|KV|\bDO\b|R2|Workers AI|Durable/, s.name);
    assert.equal('match' in s, false, `${s.name} sends no match key`);
  }
});

test('an incident tagged with the old technical word still paints the row it names', async () => {
  const seed = `INSERT INTO status_incidents (title, status, severity, affected_services, created_at)
    VALUES ('Uploads slow', 'investigating', 'minor', '["R2"]', datetime('now'));`;
  const { services } = await status(BOUND, seed);
  const today = new Date().toISOString().slice(0, 10);
  for (const s of services) {
    const cell = s.history.find((h) => h.day === today);
    assert.equal(cell?.status, s.name === 'File storage' ? 'degraded' : 'operational', s.name);
  }
});
