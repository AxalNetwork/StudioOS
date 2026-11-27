/**
 * D8533 (#8533) — each scheduled task's outcome inside its trigger's row.
 *
 * `cron_run_history` said whether a tick ran, and since D4703 which tasks'
 * catches fired. A `completed` row could not show a task that ran and did
 * nothing. `task_outcomes` (migration 202611250106_8533) now keeps each
 * reported task as done, skipped or failed with an error class. Pinned:
 *   · the error class a failed task gets from what its catch passed;
 *   · a trigger with one failed task is written `partial`, and the task reads
 *     failed with its class, beside the tasks that were done and skipped;
 *   · a `completed` trigger shows the task that did nothing;
 *   · a tick that reports no task writes the row as before D8533;
 *   · the REAL scheduled() handler, with one task throwing, writes that row.
 *
 * Real SQLite (the migrated schema through `_schema_once.mjs`).
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/cron_task_outcomes_8533.test.ts
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';

import { d1Over } from './_d1_sqlite.mjs';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';
import {
  CronTaskLog, MAX_TASK_OUTCOMES, errorClass, triggerState, writeCronRunHistory,
} from '../src/util/cronHistory.ts';

const AT = { now: () => new Date('2026-11-25T10:04:30Z') };

function migrated() {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  return db;
}
const rowOf = (db: DatabaseSync) => ({ ...(db.prepare('SELECT * FROM cron_run_history ORDER BY id DESC LIMIT 1').get() as any) });

test('the migration adds a nullable task_outcomes column to cron_run_history', () => {
  const db = migrated();
  const col = (db.prepare('PRAGMA table_info(cron_run_history)').all() as any[]).find((c) => c.name === 'task_outcomes');
  assert.ok(col, 'task_outcomes is on a fresh build');
  assert.deepEqual([col.type, col.notnull, col.dflt_value], ['TEXT', 0, null]);
  assert.match(readFileSync(new URL('../src/routes/infra.ts', import.meta.url), 'utf8'), /error TEXT,\s*task_outcomes TEXT\s*\)/,
    'the runtime bootstrap declares the same column');
});

test('a failed task is classed by what its catch passed', () => {
  assert.equal(errorClass([new TypeError('x is undefined')]), 'TypeError');
  assert.equal(errorClass([new Error('boom')]), 'Error');
  assert.equal(errorClass(['axal-search re-embed', Object.assign(new Error('D1'), { name: 'D1_ERROR' })]), 'D1_ERROR', 'the first Error wins over free text');
  assert.equal(errorClass([{ name: 'AbortError', message: 'timed out' }]), 'AbortError', 'an error-shaped object');
  assert.equal(errorClass(['calendar_copy_retry_failed']), 'calendar_copy_retry_failed', 'a code the site passed');
  assert.equal(errorClass(['D1 DB is overloaded. Too many requests']), 'unclassified', 'free text is no class');
  assert.equal(errorClass([]), 'unclassified');
});

test('a trigger with one failed task is recorded as such: partial, the task failed with its class, the others beside it', async () => {
  const db = migrated();
  const tasks = new CronTaskLog();
  tasks.skipped('queue drain', 'no pending job');
  tasks.failed('hubspot sync', new TypeError('cannot read properties of null'));
  tasks.done('analytics snapshot', '2026-11-24');
  await writeCronRunHistory({ DB: d1Over(db) } as any, {
    triggerName: '* * * * *', startedAt: '2026-11-25 10:04:00', cronError: null, tasks: tasks.outcomes, summary: [],
  }, AT);
  const row = rowOf(db);
  assert.equal(row.status, 'partial', 'a failed task makes the trigger partial');
  assert.equal(row.error, 'sub-tasks failed: hubspot sync');
  assert.deepEqual(JSON.parse(row.task_outcomes), [
    { task: 'queue drain', outcome: 'skipped', note: 'no pending job' },
    { task: 'hubspot sync', outcome: 'failed', error_class: 'TypeError' },
    { task: 'analytics snapshot', outcome: 'done', note: '2026-11-24' },
  ]);
  assert.equal(triggerState('* * * * *', row, new Date('2026-11-25T10:05:00Z')).state, 'failed', 'HQ reads it as failed');
});

test('a completed trigger shows the task that did nothing', async () => {
  const db = migrated();
  const tasks = new CronTaskLog();
  tasks.skipped('queue drain', 'no pending job');
  tasks.skipped('subprocessor notices', 'mail not configured');
  await writeCronRunHistory({ DB: d1Over(db) } as any, {
    triggerName: '* * * * *', startedAt: '2026-11-25 10:04:00', cronError: null, failedTasks: [], tasks: tasks.outcomes, summary: [],
  }, AT);
  const row = rowOf(db);
  assert.deepEqual([row.status, row.error], ['completed', null]);
  assert.deepEqual(JSON.parse(row.task_outcomes).map((t: any) => `${t.task}:${t.outcome}`), ['queue drain:skipped', 'subprocessor notices:skipped']);
});

test('a tick that reports no task writes the row as before D8533, and the log is bounded', async () => {
  const db = migrated();
  await writeCronRunHistory({ DB: d1Over(db) } as any, {
    triggerName: '0 3 * * *', startedAt: '2026-11-25 03:00:00', cronError: null, failedTasks: [], summary: [],
  }, AT);
  assert.equal(rowOf(db).task_outcomes, null);
  const tasks = new CronTaskLog();
  for (let i = 0; i < MAX_TASK_OUTCOMES + 5; i += 1) tasks.done(`task ${i}`, 'x'.repeat(500));
  assert.equal(tasks.outcomes.length, MAX_TASK_OUTCOMES);
  assert.equal(tasks.outcomes[0].note!.length, 200);
});

/* ------------------------------------------------------------------ *
 * The real scheduled() handler, bundled as cron_scheduled_time_d239    *
 * bundles it (esbuild, `cloudflare:*` stubbed, `?raw` as text).        *
 * ------------------------------------------------------------------ */

const STUB = 'export class WorkerEntrypoint { constructor(ctx, env) { this.ctx = ctx; this.env = env; } } '
  + 'export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } } '
  + 'export class RpcTarget {} export class WorkflowEntrypoint {} export const env = {};'
  + ' export const exports = {}; export class WorkflowEvent {} export class EmailMessage {}';

async function bundledWorker() {
  const out = join(mkdtempSync(join(tmpdir(), 'd8533-')), 'worker.mjs');
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

test('the scheduled handler records a tick with one failed task: partial, the task failed with its class, the empty drain skipped', async () => {
  const worker = await bundledWorker();
  const histories: any[][] = [];
  const kv = new Map<string, string>();
  // Every read finds nothing, every write lands nowhere; the subprocessor notice
  // sweep's read throws, so that one task fails.
  const stmt = (sql: string) => {
    let binds: any[] = [];
    const api: any = {
      bind: (...a: any[]) => { binds = a; return api; },
      async first() { return null; },
      async all() {
        if (/FROM trust_subprocessors/.test(sql)) throw new TypeError('subprocessor read failed');
        return { results: [] };
      },
      async run() {
        if (/INSERT INTO cron_run_history/.test(sql)) histories.push([sql, ...binds]);
        return { meta: { changes: 0 } };
      },
      async raw() { return []; },
    };
    return api;
  };
  const env: any = {
    ENVIRONMENT: 'development', GMAIL_CLIENT_ID: 'id', GMAIL_CLIENT_SECRET: 'secret', GMAIL_REFRESH_TOKEN: 'refresh',
    DB: { prepare: stmt, async batch(xs: any[]) { return xs.map(() => ({ meta: { changes: 0 } })); }, async exec() { return { count: 0, duration: 0 }; } },
    RATE_LIMITS: { async get(k: string) { return kv.get(k) ?? null; }, async put(k: string, v: string) { kv.set(k, v); }, async delete(k: string) { kv.delete(k); } },
  };
  const at = Date.parse('2026-11-25T10:04:00Z'); // minute 4: the subprocessor notice sweep's minute
  mock.timers.enable({ apis: ['Date'], now: at + 800 });
  const waits: Promise<unknown>[] = [];
  const silence = ['info', 'warn', 'error', 'log'].map((k) => mock.method(console, k as any, () => {}));
  try {
    await worker.scheduled({ cron: '* * * * *', scheduledTime: at, type: 'scheduled' }, env, { waitUntil: (p: Promise<unknown>) => waits.push(p), passThroughOnException() {} });
    await Promise.allSettled(waits);
  } finally {
    silence.forEach((m) => m.mock.restore());
    mock.timers.reset();
  }
  assert.equal(histories.length, 1, 'one row for the tick');
  const [sql, trigger, , , status, , error, json] = histories[0];
  assert.match(sql, /task_outcomes/);
  assert.equal(trigger, '* * * * *');
  assert.equal(status, 'partial');
  assert.match(String(error), /sub-tasks failed: .*subprocessor notices/);
  const tasks = JSON.parse(json);
  assert.deepEqual(tasks.find((t: any) => t.task === 'subprocessor notices'), { task: 'subprocessor notices', outcome: 'failed', error_class: 'TypeError' });
  assert.deepEqual(tasks.find((t: any) => t.task === 'queue drain'), { task: 'queue drain', outcome: 'skipped', note: 'no pending job' });
});

test('every taskFailed in scheduled() also records the outcome, and the row is written with them', () => {
  const src = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
  const start = src.indexOf('async scheduled(event: ScheduledEvent');
  const body = src.slice(start, src.indexOf('ctx.waitUntil(work);', start));
  assert.match(body, /const taskFailed = \(task: string, \.\.\.detail: unknown\[\]\) => \{\s*cronTaskFailures\.push\(task\);\s*cronTasks\.failed\(task, \.\.\.detail\);/);
  assert.match(body, /tasks: cronTasks\.outcomes,/);
});
