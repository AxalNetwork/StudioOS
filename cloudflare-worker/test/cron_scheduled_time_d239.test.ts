/**
 * D239 — the scheduled handler's gates read the event's own time.
 *
 * `now` was taken AFTER the queue drain, so a drain that crossed a minute
 * boundary made the tick look at the wrong minute: every block gated on the
 * scheduled minute was skipped, and nothing recorded it. The test drives the
 * REAL `scheduled()` with Date mocked: the stub database moves the clock 70
 * seconds forward while the drain reads the queue, exactly the case that
 * skipped, and the 03:00 daily block (Jobs.cleanup) must still run.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/cron_scheduled_time_d239.test.ts
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// THE REAL HANDLER, BUNDLED THE WAY WRANGLER BUNDLES IT (esbuild). Node's
// type stripping cannot load the worker's module graph (several files import
// a type as a value), so the entry is bundled instead:
//   · `cloudflare:*` (the RPC entrypoint classes) maps to a stub with the
//     class names; nothing on the scheduled path calls them;
//   · `*.md?raw` (the legal templates) loads as text, as Wrangler does.
const STUB = 'export class WorkerEntrypoint { constructor(ctx, env) { this.ctx = ctx; this.env = env; } } '
  + 'export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } } '
  + 'export class RpcTarget {} export class WorkflowEntrypoint {} export const env = {};';
const out = join(mkdtempSync(join(tmpdir(), 'd239-')), 'worker.mjs');
await build({
  entryPoints: [new URL('../src/index.ts', import.meta.url).pathname],
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent',
  mainFields: ['module', 'main'], conditions: ['workerd', 'worker', 'import'],
  plugins: [{
    name: 'workers-shims',
    setup(b) {
      b.onResolve({ filter: /^cloudflare:/ }, (a) => ({ path: a.path, namespace: 'cf-stub' }));
      b.onLoad({ filter: /.*/, namespace: 'cf-stub' }, () => ({ contents: STUB, loader: 'js' }));
      b.onResolve({ filter: /\?raw$/ }, (a) => ({ path: join(a.resolveDir, a.path.replace(/\?raw$/, '')), namespace: 'raw' }));
      b.onLoad({ filter: /.*/, namespace: 'raw' }, async (a) => ({
        contents: (await import('node:fs')).readFileSync(a.path, 'utf8'), loader: 'text',
      }));
    },
  }],
  external: ['node:*'],
  // CommonJS dependencies call require() on Node built-ins inside the ESM output.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
const worker = (await import(pathToFileURL(out).href)).default;

const CLEANUP_SQL = "DELETE FROM queue_jobs WHERE status IN ('completed','failed')";

function stubEnv(onDrain: () => void) {
  const statements: string[] = [];
  const kv = new Map<string, string>();
  const stmt = (sql: string) => {
    statements.push(sql);
    const api: any = {
      bind: () => api,
      async first() { return null; },
      async all() {
        if (/SELECT id FROM queue_jobs WHERE status = 'pending'/.test(sql)) onDrain();
        return { results: [] };
      },
      async run() { return { meta: { changes: 0 } }; },
      async raw() { return []; },
    };
    return api;
  };
  const env: any = {
    ENVIRONMENT: 'development',
    DB: {
      prepare: stmt,
      async batch(xs: any[]) { return xs.map(() => ({ meta: { changes: 0 } })); },
      async exec() { return { count: 0, duration: 0 }; },
    },
    RATE_LIMITS: {
      async get(k: string) { return kv.get(k) ?? null; },
      async put(k: string, v: string) { kv.set(k, v); },
      async delete(k: string) { kv.delete(k); },
    },
  };
  return { env, statements };
}

async function tick(scheduled: string, drainMs: number, dispatchLagMs = 800) {
  const at = Date.parse(scheduled);
  // Dispatched `dispatchLagMs` after its minute (production: up to 52 s).
  mock.timers.enable({ apis: ['Date'], now: at + dispatchLagMs });
  const { env, statements } = stubEnv(() => mock.timers.tick(drainMs));
  const waits: Promise<unknown>[] = [];
  const ctx: any = { waitUntil: (p: Promise<unknown>) => waits.push(p), passThroughOnException() {} };
  const silence = ['info', 'warn', 'error', 'log'].map((k) => mock.method(console, k as any, () => {}));
  try {
    await (worker as any).scheduled({ cron: '0 3 * * *', scheduledTime: at, type: 'scheduled' }, env, ctx);
    await Promise.allSettled(waits);
  } finally {
    silence.forEach((m) => m.mock.restore());
    mock.timers.reset();
  }
  return statements;
}

test('the 03:00 daily block runs when the 03:00 tick finishes its drain at 03:01', async () => {
  const statements = await tick('2026-09-24T03:00:00Z', 70_000);
  assert.ok(statements.some((s) => s.includes(CLEANUP_SQL)),
    'the 03:00 block was skipped because the drain crossed into 03:01');
});

test('and a quick drain runs it too (the control)', async () => {
  const statements = await tick('2026-09-24T03:00:00Z', 1_000);
  assert.ok(statements.some((s) => s.includes(CLEANUP_SQL)));
});

test('a 03:00 tick delivered late, at 03:01:05, still runs the 03:00 block', async () => {
  // The wall clock read BEFORE the drain would get this one wrong too: the
  // minute a tick stands for is the one it was scheduled for.
  const statements = await tick('2026-09-24T03:00:00Z', 1_000, 65_000);
  assert.ok(statements.some((s) => s.includes(CLEANUP_SQL)), 'a late-delivered 03:00 tick skipped its block');
});

test('a tick scheduled for 03:01 does not run the 03:00 block, however early it is dispatched', async () => {
  const statements = await tick('2026-09-24T03:01:00Z', 1_000);
  assert.ok(!statements.some((s) => s.includes(CLEANUP_SQL)), 'the 03:01 tick ran the 03:00 block');
});

test('the gate clock is fixed from event.scheduledTime before the drain', () => {
  const idx = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
  const start = idx.indexOf('async scheduled(event: ScheduledEvent');
  const body = idx.slice(start, idx.indexOf('ctx.waitUntil(work)', start));
  const decl = body.indexOf('const now = new Date(Number.isFinite(event.scheduledTime) ? event.scheduledTime : Date.now());');
  const drain = body.indexOf('await processQueueBatch(env, 25)');
  assert.ok(decl > 0 && drain > decl, 'the gate clock is no longer taken from scheduledTime before the drain');
  assert.equal((body.match(/const now = /g) || []).length, 1, 'a second `now` is declared in the handler');
  // The one consumer that keeps the wall clock, on purpose (D122's rule).
  assert.match(body, /sweepWatchlistReminders\(env, new Date\(\)\)/);
  // No gate anywhere in the handler reads the wall clock: the behavioural
  // tests above drive the 03:00 block, and this covers every other one.
  const wallGates = body.match(/if \([^\n]*new Date\(\)\.getUTC[^\n]*/g) || [];
  assert.deepEqual(wallGates, [], 'a gate reads the wall clock instead of the scheduled minute');
});
