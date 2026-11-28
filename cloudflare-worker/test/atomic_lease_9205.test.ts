/**
 * D9205 (#9205) — the minute cron's queue lease and the fail-closed rate-limit
 * counters are atomic in the `AiGovernor` Durable Object, not a KV get then put.
 *
 * Pinned:
 *   · the pure take / release / bump rules the object applies;
 *   · the REAL scheduled() handler, two ticks at once over a KV whose reads
 *     lag a write behind: exactly one runs and the other records `skipped`,
 *     and a tick after the release takes the lease at once (on the old KV
 *     read-then-write both ticks run, and the late tick still reads the
 *     released holder and skips);
 *   · N concurrent requests at the fail-closed `register` bucket (limit 10)
 *     over the same stale KV: exactly 10 pass;
 *   · a failed counter call on a fail-closed bucket still refuses with 503.
 *
 * The Durable Object is the real class over a storage map
 * (`_ai_governor_fixture.ts`), so concurrency is the object's own serial order.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/atomic_lease_9205.test.ts
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

import { governorNamespace } from './_ai_governor_fixture.ts';
import {
  CRON_LEASE_NAME, CRON_LEASE_TTL_MS, bumpWindow, cronLeaseObjectName, releaseLease, takeLease,
} from '../src/services/atomicLease.ts';

/**
 * A KV whose reads lag one write behind on each key: what an edge cache serving
 * the value from before the last put or delete looks like. Writes land.
 */
function staleKv() {
  const now = new Map<string, string | null>();
  const before = new Map<string, string | null>();
  const write = (k: string, v: string | null) => { before.set(k, now.has(k) ? now.get(k)! : null); now.set(k, v); };
  return {
    now,
    async get(k: string) { return before.has(k) ? before.get(k)! : null; },
    async put(k: string, v: string) { write(k, v); },
    async delete(k: string) { write(k, null); },
    async list() { return { keys: [], list_complete: true }; },
  };
}

/* ── The rules the object applies ─────────────────────────────────────── */

test('the lease is taken when free or expired, refused with its holder while live, and released only by its holder', () => {
  const t0 = 1_000_000;
  const a = takeLease(null, 'A', t0);
  assert.deepEqual(a.out, { taken: true });
  assert.deepEqual(a.state, { holder: 'A', expiresAt: t0 + CRON_LEASE_TTL_MS });
  assert.equal(CRON_LEASE_TTL_MS, 90_000, 'the lease lives 90 seconds, as the KV lease did');
  const b = takeLease(a.state, 'B', t0 + CRON_LEASE_TTL_MS - 1);
  assert.deepEqual(b.out, { taken: false, heldBy: 'A' });
  assert.deepEqual(takeLease(a.state, 'C', t0 + CRON_LEASE_TTL_MS).out, { taken: true }, 'an expired lease is free');
  assert.deepEqual(releaseLease(a.state, 'B'), { state: a.state, out: { released: false } }, 'another tick cannot release it');
  assert.deepEqual(releaseLease(a.state, 'A'), { state: null, out: { released: true } });
});

test('a counter counts within its window, restarts in a newer one, and never resets for an older one', () => {
  let s = bumpWindow(null, 7, 60).state;
  assert.deepEqual(s, { window: 7, count: 1, endsAt: 8 * 60_000 });
  s = bumpWindow(s, 7, 60).state;
  assert.equal(s!.count, 2);
  assert.deepEqual(bumpWindow(s, 6, 60).out, { count: 3 }, 'a clock behind counts in the newer window');
  assert.deepEqual(bumpWindow(s, 8, 60), { state: { window: 8, count: 1, endsAt: 9 * 60_000 }, out: { count: 1 } });
});

test('a counter\'s alarm clears an ended window and keeps a live one', async () => {
  const gov = governorNamespace();
  const name = 'rate-counter:rl:i:203.0.113.1:register';
  const stub = gov.ns.get(gov.ns.idFromName(name));
  const r = await stub.fetch('https://ai-governor/counter/bump', { method: 'POST', body: JSON.stringify({ window: 1, windowSec: 60 }) });
  assert.deepEqual(await r.json(), { count: 1 });
  const g = (await import('../src/durable-objects/ai-governor.ts')).AiGovernor;
  const storage = { get: async (k: string) => gov.stores.get(name)!.get(k), put: async (k: string, v: unknown) => { gov.stores.get(name)!.set(k, v); }, delete: async (k: string) => gov.stores.get(name)!.delete(k) };
  await new g({ storage } as any, {} as any).alarm();
  assert.equal(gov.stores.get(name)!.has('counter'), false, 'window 1 ended long ago, so the alarm cleared it');
  const live = Math.floor(Date.now() / 60_000);
  await stub.fetch('https://ai-governor/counter/bump', { method: 'POST', body: JSON.stringify({ window: live, windowSec: 60 }) });
  await new g({ storage } as any, {} as any).alarm();
  assert.equal((gov.stores.get(name)!.get('counter') as any)?.count, 1, 'a live window is kept');
});

/* ── The real scheduled() handler ──────────────────────────────────────── */

const STUB = 'export class WorkerEntrypoint { constructor(ctx, env) { this.ctx = ctx; this.env = env; } } '
  + 'export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } } '
  + 'export class RpcTarget {} export class WorkflowEntrypoint {} export const env = {};'
  + ' export const exports = {}; export class WorkflowEvent {} export class EmailMessage {}';

async function bundledWorker() {
  const out = join(mkdtempSync(join(tmpdir(), 'd9205-')), 'worker.mjs');
  await build({
    entryPoints: [new URL('../src/index.ts', import.meta.url).pathname],
    bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent',
    loader: { '.woff2': 'binary', '.png': 'binary' }, target: 'node22',
    mainFields: ['module', 'main'], conditions: ['workerd', 'worker', 'import'],
    plugins: [{
      name: 'workers-shims',
      setup(b) {
        b.onResolve({ filter: /^cloudflare:/ }, (a) => ({ path: a.path, namespace: 'cf-stub' }));
        b.onLoad({ filter: /.*/, namespace: 'cf-stub' }, () => ({ contents: STUB, loader: 'js' }));
        b.onResolve({ filter: /\?raw$/ }, (a) => ({ path: join(a.resolveDir, a.path.replace(/\?raw$/, '')), namespace: 'raw' }));
        b.onLoad({ filter: /.*/, namespace: 'raw' }, (a) => ({ contents: readFileSync(a.path, 'utf8'), loader: 'text' }));
      },
    }],
    external: ['node:*'],
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  });
  return (await import(pathToFileURL(out).href)).default;
}

test('two ticks at once: exactly one runs and the other records skipped; a tick after the release takes the lease at once', async () => {
  const worker = await bundledWorker();
  const gov = governorNamespace();
  const kv = staleKv();
  /** [trigger, status] of each cron_run_history row, in write order. */
  const rows: { trigger: string; status: string }[] = [];
  const stmt = (sql: string) => {
    let binds: any[] = [];
    const api: any = {
      bind: (...a: any[]) => { binds = a; return api; },
      async first() { return null; },
      async all() { return { results: [] }; },
      async run() {
        if (/INSERT INTO cron_run_history/.test(sql)) rows.push({ trigger: binds[0], status: binds[3] });
        return { meta: { changes: 0 } };
      },
      async raw() { return []; },
    };
    return api;
  };
  const env: any = {
    ENVIRONMENT: 'development',
    DB: { prepare: stmt, async batch(xs: any[]) { return xs.map(() => ({ meta: { changes: 0 } })); }, async exec() { return { count: 0, duration: 0 } } },
    RATE_LIMITS: kv,
    AI_GOVERNOR: gov.ns,
  };
  // A slow tick from minute 7 is still running when minute 8's tick fires.
  const m7 = Date.parse('2026-11-28T10:07:00Z');
  const m8 = m7 + 60_000;
  const m9 = m8 + 60_000;
  mock.timers.enable({ apis: ['Date'], now: m8 + 500 });
  const silence = ['info', 'warn', 'error', 'log'].map((k) => mock.method(console, k as any, () => {}));
  const tick = async (cron: string, scheduledTime: number) => {
    const waits: Promise<unknown>[] = [];
    await worker.scheduled({ cron, scheduledTime, type: 'scheduled' }, env, { waitUntil: (p: Promise<unknown>) => waits.push(p), passThroughOnException() {} });
    await Promise.allSettled(waits);
  };
  try {
    await Promise.all([tick('* * * * *', m7), tick('* * * * *', m8)]);
    assert.equal(rows.length, 2, 'one row per tick');
    const statuses = rows.map((r) => r.status).sort();
    assert.equal(statuses.filter((s) => s === 'skipped').length, 1, `exactly one tick found the lease held: ${statuses}`);
    assert.equal(statuses.filter((s) => s === 'completed' || s === 'partial').length, 1, `exactly one tick ran: ${statuses}`);
    assert.equal(gov.stores.get(cronLeaseObjectName(CRON_LEASE_NAME))?.has('cron-lease'), false, 'the running tick released the lease');

    rows.length = 0;
    mock.timers.setTime(m9 + 500);
    await tick('* * * * *', m9);
    assert.equal(rows.length, 1);
    assert.notEqual(rows[0].status, 'skipped', 'the tick after the release took the lease at once');
    assert.notEqual(rows[0].status, 'deduped');
  } finally {
    silence.forEach((m) => m.mock.restore());
    mock.timers.reset();
  }
  assert.equal(kv.now.has('cron:queue:lease'), false, 'the lease is no longer written to KV');
});

/* ── The fail-closed buckets ───────────────────────────────────────────── */

async function registerApp() {
  const { rateLimitMiddleware } = await import('../src/middleware/rateLimit.ts');
  const { Hono } = await import('hono');
  const app = new Hono();
  app.use('/api/*', rateLimitMiddleware());
  app.post('/api/auth/register', (c) => c.json({ ok: true }));
  return app;
}
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} };
const DB = { prepare: () => ({ bind: () => ({ run: async () => ({}) }) }) };
const register = (ip: string) => new Request('https://axal.vc/api/auth/register', { method: 'POST', headers: { 'cf-connecting-ip': ip } });

test('N concurrent requests at a fail-closed bucket with limit L: exactly L pass', async () => {
  const app = await registerApp();
  const gov = governorNamespace();
  const env = { RATE_LIMITS: staleKv(), DB, AI_GOVERNOR: gov.ns };
  const N = 25; const L = 10; // `register`: 10 per minute per IP, failClosed
  const res = await Promise.all(Array.from({ length: N }, () => app.fetch(register('203.0.113.20'), env, ctx)));
  const codes = res.map((r) => r.status);
  assert.equal(codes.filter((s) => s === 200).length, L, `allowed: ${codes}`);
  assert.equal(codes.filter((s) => s === 429).length, N - L);
  assert.equal(res.find((r) => r.status === 429)!.headers.get('X-RateLimit-Bucket'), 'register');
  assert.ok(gov.calls.every((c) => c.startsWith('rate-counter:rl:i:203.0.113.20:register ')), 'only the fail-closed bucket uses the object');
  // Another IP has its own counter.
  assert.equal((await app.fetch(register('203.0.113.21'), env, ctx)).status, 200);
});

test('a counter the object cannot give still refuses a fail-closed bucket with 503', async () => {
  const app = await registerApp();
  const broken = { idFromName: (n: string) => n, get: () => ({ fetch: async () => new Response('down', { status: 500 }) }) };
  const res = await app.fetch(register('203.0.113.30'), { RATE_LIMITS: staleKv(), DB, AI_GOVERNOR: broken }, ctx);
  assert.equal(res.status, 503);
  assert.equal((await res.json() as any).code, 'rate_limit_unavailable');
});
