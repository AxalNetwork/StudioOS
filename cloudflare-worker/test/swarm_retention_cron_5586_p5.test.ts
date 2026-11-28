/**
 * D5586 part 5 (#5586): swarm retention on a daily cron (owner answer C1, 2026-11-28). Pinned:
 *   · `17 3 * * *` is in all three `wrangler.toml` trigger tables, in `CRON_TRIGGERS` and is the module's own constant;
 *   · the scheduled handler gates the run on 03:17 UTC, the trigger's own minute, loads the task with a dynamic import
 *     (index.ts is a frozen hub, HUBS.md) and does not gate it on HQ;
 *   · one run follows `more: true` with another call, at most `SWARM_RETENTION_CALLS`, and sums what they retired;
 *   · nothing due and no binding are `skipped`; a refusal is `failed` with its code and keeps what was retired;
 *     a thrown stub is `admission_unavailable`, never a throw;
 *   · over the real `WorkspaceAdmission` class, a settled ticket 30 days old is retired once, and a second run is a skip;
 *   · the REAL scheduled() handler at 03:17 calls the coordinator and records the task; at 03:16 it does not call it.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/swarm_retention_cron_5586_p5.test.ts
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

import { CRON_TRIGGERS, BRANCH_CRONS } from '../src/util/cronHistory.ts';
import { SWARM_RETENTION_CALLS, SWARM_RETENTION_CRON, runSwarmRetentionTick } from '../src/services/agents/swarmRetentionCron.ts';
import { SWARM_RETENTION_MS } from '../src/services/agents/swarmRetention.ts';
import { WorkspaceAdmission } from '../src/durable-objects/workspace-admission.ts';
import { WORKSPACE_ADMISSION_OBJECT } from '../src/services/agents/workspaceAdmissionClient.ts';
import { V7, facts, policy, request } from './_swarm_world_5586.ts';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

/** The quoted crons of one wrangler table. */
function cronsOf(toml: string, header: string): string[] {
  const h = toml.indexOf(`\n${header}\n`);
  assert.ok(h >= 0, `${header} is no longer in wrangler.toml`);
  const open = toml.indexOf('crons = [', h);
  const next = toml.indexOf('\n[', h + 1);
  assert.ok(open >= 0 && (next < 0 || open < next), `${header} has no crons`);
  const body = toml.slice(open, toml.indexOf(']', open));
  return [...body.replace(/#[^\n]*/g, '').matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

test('17 3 * * * is declared in the three trigger tables and in CRON_TRIGGERS', () => {
  assert.equal(SWARM_RETENTION_CRON, '17 3 * * *');
  const toml = read('../../wrangler.toml');
  for (const header of ['[triggers]', '[env.production.triggers]', '[env.preview.triggers]']) {
    assert.ok(cronsOf(toml, header).includes(SWARM_RETENTION_CRON), `${header} declares the retention cron`);
  }
  assert.deepEqual(CRON_TRIGGERS.find((t) => t.expr === SWARM_RETENTION_CRON), { name: 'swarm_retention', expr: SWARM_RETENTION_CRON });
  assert.ok(!BRANCH_CRONS.includes(SWARM_RETENTION_CRON), 'a branch keeps its two crons; its every-minute tick still reaches 03:17');
});

test('the scheduled handler runs retention at the trigger\'s own minute, by a dynamic import, on every tier', () => {
  const src = read('../src/index.ts');
  const start = src.indexOf('async scheduled(event: ScheduledEvent');
  const body = src.slice(start, src.indexOf('ctx.waitUntil(work);', start));
  const [minute, hour] = SWARM_RETENTION_CRON.split(' ').map(Number);
  const gate = `if (now.getUTCHours() === ${hour} && now.getUTCMinutes() === ${minute}) {`;
  const at = body.indexOf(gate + "\n          try {\n            const { runSwarmRetentionTick } = await import('./services/agents/swarmRetentionCron');");
  assert.ok(at > 0, 'the 03:17 block loads the task with a dynamic import');
  assert.equal(body.split("import('./services/agents/swarmRetentionCron')").length, 2, 'loaded once');
  assert.ok(!/^import .*swarmRetentionCron/m.test(src), 'no static import in the frozen hub');
  const block = body.slice(at, body.indexOf('\n        }\n', at));
  assert.ok(!block.includes('hqCadences'), 'each deployment retires its own coordinator');
  assert.match(block, /cronTasks\.done\('swarm retention', r\.note\)/);
  assert.match(block, /cronTasks\.skipped\('swarm retention', r\.note\)/);
  assert.match(block, /taskFailed\('swarm retention', r\.code, r\.note\)/);
});

// ---- the tick over a scripted coordinator ----------------------------------------------------------------------------
type Answer = { ok: true; value: Record<string, unknown> } | { ok: false; status: number; code: string } | 'throw' | 'http500';
const pass = (tickets: number, more: boolean, patch: Record<string, number> = {}) =>
  ({ ok: true as const, value: { tickets, slots: 0, audit: 0, evicted: 0, more, batches: 1, now: 1, cutoff: 0, ...patch } });
function scripted(answers: Answer[]) {
  const calls: string[] = [];
  const ns = {
    idFromName: (n: string) => ({ name: n }),
    get: (id: { name: string }) => ({
      fetch: async (url: string, init: RequestInit) => {
        calls.push(`${init.method} ${url} ${id.name}`);
        const a = answers.shift() ?? pass(0, false);
        if (a === 'throw') throw new Error('down');
        if (a === 'http500') return new Response('{}', { status: 500 });
        return new Response(JSON.stringify(a), { status: 200 });
      },
    }),
  };
  return { env: { WORKSPACE_ADMISSION: ns } as any, calls };
}

test('one run follows more: true, at most SWARM_RETENTION_CALLS calls, and sums them', async () => {
  const s = scripted([pass(2000, true, { audit: 5, slots: 2, evicted: 4 }), pass(10, false, { slots: 1, evicted: 2, audit: 1 })]);
  const r = await runSwarmRetentionTick(s.env);
  assert.deepEqual(s.calls, [`POST https://workspace-admission/retire ${WORKSPACE_ADMISSION_OBJECT}`, `POST https://workspace-admission/retire ${WORKSPACE_ADMISSION_OBJECT}`]);
  assert.deepEqual(r, { outcome: 'done', note: 'tickets=2010 slots=3 audit=6 evicted=6 calls=2', calls: 2, tickets: 2010, slots: 3,
    audit: 6, evicted: 6, more: false, code: null });

  assert.equal(SWARM_RETENTION_CALLS, 3);
  const long = scripted([pass(2000, true), pass(2000, true), pass(2000, true), pass(2000, true)]);
  const l = await runSwarmRetentionTick(long.env);
  assert.equal(long.calls.length, 3, 'bounded: the rest waits for the next night');
  assert.deepEqual([l.outcome, l.tickets, l.more, l.note], ['done', 6000, true, 'tickets=6000 slots=0 audit=0 evicted=0 calls=3 more']);
  const one = scripted([pass(2000, true), pass(2000, true)]);
  assert.equal((await runSwarmRetentionTick(one.env, { calls: 1 })).calls, 1);
  assert.equal(one.calls.length, 1);
});

test('nothing due and no binding are skipped; a refusal is failed with its code and keeps what was retired', async () => {
  const none = scripted([pass(0, false)]);
  assert.deepEqual(await runSwarmRetentionTick(none.env), { outcome: 'skipped', note: 'nothing due', calls: 1, tickets: 0, slots: 0,
    audit: 0, evicted: 0, more: false, code: null });
  for (const field of ['audit', 'slots', 'evicted']) {
    const only = await runSwarmRetentionTick(scripted([pass(0, false, { [field]: 3 })]).env);
    assert.equal(only.outcome, 'done', `${field} alone is work done`);
  }

  const unbound = await runSwarmRetentionTick({} as any);
  assert.deepEqual([unbound.outcome, unbound.code, unbound.note, unbound.calls], ['skipped', 'admission_unbound', 'coordinator not bound', 0]);

  const regressed = scripted([pass(40, true), { ok: false, status: 503, code: 'clock_regressed' }]);
  const r = await runSwarmRetentionTick(regressed.env);
  assert.deepEqual([r.outcome, r.code, r.tickets, r.calls, r.note], ['failed', 'clock_regressed', 40, 1,
    'clock_regressed tickets=40 slots=0 audit=0 evicted=0 calls=1 more']);
  assert.equal(regressed.calls.length, 2, 'it stops at the refusal');

  for (const a of ['throw', 'http500'] as const) {
    const f = await runSwarmRetentionTick(scripted([a]).env);
    assert.deepEqual([f.outcome, f.code], ['failed', 'admission_unavailable'], a);
  }
});

// ---- the real coordinator class, over an in-memory Durable Object storage ------------------------------------------
function storage() {
  let data = new Map<string, unknown>();
  let chain: Promise<unknown> = Promise.resolve();
  return {
    transaction<T>(fn: (txn: { get: (k: string) => Promise<unknown>; put: (k: string, v: unknown) => Promise<void> }) => Promise<T>): Promise<T> {
      const run = chain.then(async () => {
        const copy = new Map([...data].map(([k, v]) => [k, structuredClone(v)]));
        const out = await fn({ get: async (k) => structuredClone(copy.get(k)), put: async (k, v) => { copy.set(k, structuredClone(v)); } });
        data = copy;
        return out;
      });
      chain = run.catch(() => {});
      return run;
    },
  };
}
class TestAdmission extends WorkspaceAdmission {
  static now = 5_000_000;
  protected clock() { return TestAdmission.now; }
}
function coordinator() {
  const obj = new TestAdmission({ id: { name: WORKSPACE_ADMISSION_OBJECT }, storage: storage() } as any, {} as any);
  const op = async (o: string, args: unknown[]) => (await obj.fetch(new Request('https://x/op', { method: 'POST',
    body: JSON.stringify({ op: o, caller: { tenantId: V7.tenant_id, companyId: V7.company_id }, args }) }))).json() as Promise<any>;
  const ns = { idFromName: (n: string) => ({ name: n }), get: () => ({ fetch: (u: string, i: RequestInit) => obj.fetch(new Request(u, i)) }) };
  return { op, env: { WORKSPACE_ADMISSION: ns } as any };
}

test('over the real coordinator, a settled ticket 30 days old is retired once, then the run is a skip', async () => {
  const c = coordinator();
  const t = request(V7, 'document');
  assert.equal((await c.op('swarm.request', [t, policy(V7), facts()])).value.state, 'admitted');
  assert.equal((await c.op('swarm.settle', [t.ticket_uid, 300])).value.charged_microusd, 300);
  assert.equal((await runSwarmRetentionTick(c.env)).note, 'nothing due', 'young work stays');
  TestAdmission.now += SWARM_RETENTION_MS;
  const r = await runSwarmRetentionTick(c.env);
  assert.deepEqual([r.outcome, r.tickets, r.calls, r.more], ['done', 1, 1, false]);
  assert.equal((await runSwarmRetentionTick(c.env)).outcome, 'skipped', 'a second run retires nothing');
  assert.equal((await c.op('swarm.request', [t, policy(V7), facts()])).code, 'ticket_retired');
});

// ---- the REAL scheduled() handler, bundled as cron_task_outcomes_8533 bundles it ------------------------------------
const STUB = 'export class WorkerEntrypoint { constructor(ctx, env) { this.ctx = ctx; this.env = env; } } '
  + 'export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } } '
  + 'export class RpcTarget {} export class WorkflowEntrypoint {} export const env = {};'
  + ' export const exports = {}; export class WorkflowEvent {} export class EmailMessage {}';

async function bundledWorker() {
  const out = join(mkdtempSync(join(tmpdir(), 'd5586p5-')), 'worker.mjs');
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

async function tick(worker: any, iso: string, answers: Answer[]) {
  const histories: any[][] = [];
  const kv = new Map<string, string>();
  const stmt = (sql: string) => {
    let binds: any[] = [];
    const api: any = {
      bind: (...a: any[]) => { binds = a; return api; },
      async first() { return null; },
      async all() { return { results: [] }; },
      async run() {
        if (/INSERT INTO cron_run_history/.test(sql)) histories.push([sql, ...binds]);
        return { meta: { changes: 0 } };
      },
      async raw() { return []; },
    };
    return api;
  };
  const s = scripted(answers);
  const env: any = {
    ENVIRONMENT: 'development',
    DB: { prepare: stmt, async batch(xs: any[]) { return xs.map(() => ({ meta: { changes: 0 } })); }, async exec() { return { count: 0, duration: 0 }; } },
    RATE_LIMITS: { async get(k: string) { return kv.get(k) ?? null; }, async put(k: string, v: string) { kv.set(k, v); }, async delete(k: string) { kv.delete(k); } },
    WORKSPACE_ADMISSION: s.env.WORKSPACE_ADMISSION,
  };
  const at = Date.parse(iso);
  mock.timers.enable({ apis: ['Date'], now: at + 800 });
  const waits: Promise<unknown>[] = [];
  const silence = ['info', 'warn', 'error', 'log'].map((k) => mock.method(console, k as any, () => {}));
  try {
    await worker.scheduled({ cron: SWARM_RETENTION_CRON, scheduledTime: at, type: 'scheduled' }, env, { waitUntil: (p: Promise<unknown>) => waits.push(p), passThroughOnException() {} });
    await Promise.allSettled(waits);
  } finally {
    silence.forEach((m) => m.mock.restore());
    mock.timers.reset();
  }
  assert.equal(histories.length, 1, 'one row for the tick');
  return { calls: s.calls, tasks: JSON.parse(histories[0][7] ?? '[]') as any[] };
}

test('the real scheduled() handler runs retention at 03:17 UTC and records it, and not at 03:16', async () => {
  const worker = await bundledWorker();
  const due = await tick(worker, '2026-11-29T03:17:00Z', [pass(7, false)]);
  assert.deepEqual(due.calls, [`POST https://workspace-admission/retire ${WORKSPACE_ADMISSION_OBJECT}`]);
  assert.deepEqual(due.tasks.find((t) => t.task === 'swarm retention'),
    { task: 'swarm retention', outcome: 'done', note: 'tickets=7 slots=0 audit=0 evicted=0 calls=1' });

  const refused = await tick(worker, '2026-11-29T03:17:00Z', [{ ok: false, status: 503, code: 'clock_regressed' }]);
  assert.deepEqual(refused.tasks.find((t) => t.task === 'swarm retention'),
    { task: 'swarm retention', outcome: 'failed', error_class: 'clock_regressed' });

  const idle = await tick(worker, '2026-11-29T03:17:00Z', [pass(0, false)]);
  assert.deepEqual(idle.tasks.find((t) => t.task === 'swarm retention'), { task: 'swarm retention', outcome: 'skipped', note: 'nothing due' });

  const early = await tick(worker, '2026-11-29T03:16:00Z', [pass(7, false)]);
  assert.deepEqual(early.calls, [], 'another minute does not call the coordinator');
  assert.equal(early.tasks.find((t) => t.task === 'swarm retention'), undefined);
});
