/**
 * D9033 (#9033) — the monitoring log tables (system_metrics, error_logs,
 * rate_limit_logs, cf_dlq_mirror) keep 30 days, pruned at 03:00 in bounded
 * batches; each table is its own cron sub-task, and the manual cleanup route
 * runs the same function.
 *
 * Real SQLite (the migrated schema through `_schema_once.mjs`), synthetic rows.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/log_prune_9033.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import { d1Over } from './_d1_sqlite.mjs';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';
import { CronTaskLog } from '../src/util/cronHistory.ts';
import {
  LOG_RETENTION_DAYS, LOG_TABLES, logCutoff, pruneCandidatesSql, pruneLogTables, runLogPrune,
} from '../src/services/logRetention.ts';

const NOW = new Date('2026-11-27T03:00:00Z');
const DAY = 86_400_000;
const sqlStamp = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const OLD = sqlStamp(NOW.getTime() - (LOG_RETENTION_DAYS + 10) * DAY);
const OLD_ISO = new Date(NOW.getTime() - (LOG_RETENTION_DAYS + 3) * DAY).toISOString();
const JUST_INSIDE = sqlStamp(NOW.getTime() - (LOG_RETENTION_DAYS - 1) * DAY);
const NEW = sqlStamp(NOW.getTime() - 2 * DAY);
/** The cleanup route reads the real clock; a row stamped this far ahead is inside its window on any day. */
const FAR_FUTURE = '9999-12-31 00:00:00';
/**
 * 2026-10-28 04:30 UTC, an hour and a half inside the window, written with an
 * offset: as text it sorts before the cutoff, so only the datetime() term
 * keeps it.
 */
const OFFSET_INSIDE = '2026-10-27T23:30:00-05:00';
const ADMIN = 9201;
const SECRET = 'd9033-log-prune-secret-0123456789abcdef';

function database() {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(db);
  db.exec(`INSERT INTO users (id, role, name, email, is_active) VALUES (${ADMIN}, 'admin', 'Ada Admin', 'ada-admin@example.test', 1)`);
  return db;
}

let seq = 0;
/** One row in `table` stamped `at`. */
function seed(db: DatabaseSync, table: string, at: string) {
  seq += 1;
  switch (table) {
    case 'system_metrics':
      db.prepare(`INSERT INTO system_metrics (metric_name, value, labels, timestamp) VALUES ('api_request', 1, '{}', ?)`).run(at); break;
    case 'error_logs':
      db.prepare(`INSERT INTO error_logs (level, source, message, created_at) VALUES ('ERROR', 'test', 'synthetic', ?)`).run(at); break;
    case 'rate_limit_logs':
      db.prepare(`INSERT INTO rate_limit_logs (endpoint, requests_in_window, blocked, created_at) VALUES ('/api/x', 1, 0, ?)`).run(at); break;
    case 'cf_dlq_mirror':
      db.prepare(`INSERT INTO cf_dlq_mirror (message_id, job_type, payload, received_at) VALUES (?, 'email_send', '{}', ?)`).run(`msg-${seq}`, at); break;
    default: throw new Error(table);
  }
}

const stamps = (db: DatabaseSync, table: string, column: string) =>
  db.prepare(`SELECT ${column} AS at FROM ${table} ORDER BY rowid`).all().map((r: any) => r.at);

test('the cutoff is 30 days before the tick, in the datetime() format', () => {
  assert.equal(LOG_RETENTION_DAYS, 30);
  assert.equal(logCutoff(NOW), '2026-10-28 03:00:00');
});

test('every table loses its rows older than 30 days and keeps the newer ones', async () => {
  const db = database();
  for (const { table } of LOG_TABLES) for (const at of [OLD, NEW, OLD_ISO, JUST_INSIDE, OFFSET_INSIDE]) seed(db, table, at);
  const { results } = await pruneLogTables({ DB: d1Over(db) } as any, { now: NOW });
  assert.deepEqual(results.map((r) => ({ table: r.table, ok: r.ok, deleted: r.deleted, capped: r.capped })),
    LOG_TABLES.map(({ table }) => ({ table, ok: true, deleted: 2, capped: false })));
  for (const { table, column } of LOG_TABLES) {
    assert.deepEqual(stamps(db, table, column), [NEW, JUST_INSIDE, OFFSET_INSIDE], table);
  }
});

test('a cap smaller than the old rows deletes only the cap; the next run deletes the rest', async () => {
  const db = database();
  for (let i = 0; i < 7; i += 1) seed(db, 'system_metrics', OLD);
  seed(db, 'system_metrics', NEW);
  const env = { DB: d1Over(db) } as any;
  const count = () => Number((db.prepare(`SELECT COUNT(*) AS n FROM system_metrics`).get() as any).n);

  const first = (await pruneLogTables(env, { now: NOW, batchRows: 2, maxBatches: 2 })).results.find((r) => r.table === 'system_metrics')!;
  assert.deepEqual({ deleted: first.deleted, batches: first.batches, capped: first.capped }, { deleted: 4, batches: 2, capped: true });
  assert.equal(count(), 4);

  const second = (await pruneLogTables(env, { now: NOW, batchRows: 2, maxBatches: 2 })).results.find((r) => r.table === 'system_metrics')!;
  assert.deepEqual({ deleted: second.deleted, batches: second.batches, capped: second.capped }, { deleted: 3, batches: 2, capped: false });
  assert.deepEqual(stamps(db, 'system_metrics', 'timestamp'), [NEW]);
});

test('a failing table is a failed cron sub-task and the other tables are still pruned and recorded', async () => {
  const db = database();
  for (const { table } of LOG_TABLES) { seed(db, table, OLD); seed(db, table, NEW); }
  const inner: any = d1Over(db);
  const DB = new Proxy(inner, {
    get(t, k) {
      if (k === 'prepare') return (sql: string) => {
        if (/DELETE FROM error_logs/.test(sql)) throw new Error('D1_ERROR: injected failure');
        return t.prepare(sql);
      };
      return Reflect.get(t, k);
    },
  });
  const tasks = new CronTaskLog();
  const failedNames: string[] = [];
  await runLogPrune({ DB } as any, NOW, { done: (t, n) => tasks.done(t, n), failed: (t, ...d) => { failedNames.push(t); tasks.failed(t, ...d); } });
  assert.deepEqual(failedNames, ['log prune error_logs']);
  assert.deepEqual(tasks.outcomes.map((o) => [o.task, o.outcome, o.note ?? null]), [
    ['log prune system_metrics', 'done', 'deleted=1 batches=1'],
    ['log prune error_logs', 'failed', null],
    ['log prune rate_limit_logs', 'done', 'deleted=1 batches=1'],
    ['log prune cf_dlq_mirror', 'done', 'deleted=1 batches=1'],
  ]);
  for (const { table, column } of LOG_TABLES) {
    assert.deepEqual(stamps(db, table, column), table === 'error_logs' ? [OLD, NEW] : [NEW], table);
  }
});

test('each prune walks its table by a time index, not a table scan', () => {
  const db = database();
  for (const { table, column } of LOG_TABLES) {
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${pruneCandidatesSql(table, column)}`)
      .all('2026-10-28 03:00:00', '2026-10-28 03:00:00', 500).map((r: any) => r.detail).join(' | ');
    assert.match(plan, new RegExp(`SEARCH ${table} USING (?:COVERING )?INDEX \\w+ \\(${column}<\\?\\)`), `${table}: ${plan}`);
  }
});

test('the 03:00 block runs the prune, and the analytics comment names it', () => {
  const src = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
  const block = src.match(/if \(now\.getUTCHours\(\) === 3 && now\.getUTCMinutes\(\) === 0\) \{[\s\S]*?\n {8}\}/g) ?? [];
  assert.ok(block.some((b) => /runLogPrune\(env, now, \{/.test(b)), 'runLogPrune is called from a 03:00 block');
  assert.doesNotMatch(src, /nightly system_metrics\s+cleanup\. Idempotent/, 'the stale comment is gone');
  assert.match(src, /system_metrics[\s\S]{0,40}30 days at 03:00 \(D9033/);
});

test('POST /api/monitoring/cleanup runs the same prune over all four tables', async () => {
  const db = database();
  for (const { table } of LOG_TABLES) { seed(db, table, OLD); seed(db, table, FAR_FUTURE); }
  const { default: monitoring } = await import('../src/routes/monitoring.ts');
  const jwt = await new SignJWT({ user_id: ADMIN, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const env: any = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' };
  const res = await monitoring.fetch(new Request('http://x/cleanup', { method: 'POST', headers: { Authorization: `Bearer ${jwt}` } }), env);
  assert.equal(res.status, 200);
  const body: any = await res.json();
  assert.deepEqual(body.purged, { system_metrics: 1, error_logs: 1, rate_limit_logs: 1, cf_dlq_mirror: 1 });
  assert.deepEqual(body.failed, []);
  for (const { table } of LOG_TABLES) assert.equal(Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as any).n), 1, table);
});

test('POST /api/monitoring/cleanup names a table that failed and still prunes the others', async () => {
  const db = database();
  for (const { table } of LOG_TABLES) seed(db, table, OLD);
  const inner: any = d1Over(db);
  const DB = new Proxy(inner, {
    get(t, k) {
      if (k === 'prepare') return (sql: string) => {
        if (/DELETE FROM rate_limit_logs/.test(sql)) throw new Error('D1_ERROR: injected failure');
        return t.prepare(sql);
      };
      return Reflect.get(t, k);
    },
  });
  const { default: monitoring } = await import('../src/routes/monitoring.ts');
  const jwt = await new SignJWT({ user_id: ADMIN, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const { error } = console;
  console.error = () => {};
  let res: Response;
  try {
    res = await monitoring.fetch(new Request('http://x/cleanup', { method: 'POST', headers: { Authorization: `Bearer ${jwt}` } }),
      { DB, JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any);
  } finally { console.error = error; }
  assert.equal(res.status, 200);
  const body: any = await res.json();
  assert.deepEqual(body.failed, ['rate_limit_logs']);
  assert.deepEqual(body.purged, { system_metrics: 1, error_logs: 1, rate_limit_logs: 0, cf_dlq_mirror: 1 });
});
