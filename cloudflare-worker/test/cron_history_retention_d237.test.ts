/**
 * D237 — cron_run_history keeps 30 days, and always each trigger's newest row.
 *
 * Nothing deleted from the table before D237 (production, 2026-09-24: 152,331
 * rows, 108,976 older than 30 days). The sweep keeps the newest row of every
 * trigger because `latestRunPerTrigger` reads exactly that row for Platform's
 * "Cron triggers firing" and the Cron tab: if the weekly trigger's last row
 * aged out, it would read "never fired".
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/cron_history_retention_d237.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

import {
  pruneCronRunHistory, latestRunPerTrigger, triggerState,
  CRON_HISTORY_RETENTION_DAYS, PRUNE_BATCH_ROWS, PRUNE_MAX_BATCHES,
} from '../src/util/cronHistory.ts';

const NOW = new Date('2026-09-24T12:00:00Z');
const DAY = 86_400_000;
const stamp = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const daysAgo = (d: number) => stamp(NOW.getTime() - d * DAY);

function makeD1(db: InstanceType<typeof DatabaseSync>, opts: { failDistinct?: boolean } = {}) {
  const statements: string[] = [];
  const d1: any = {
    statements,
    prepare(sql: string) {
      statements.push(sql);
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = x; return api; },
        async first() {
          return db.prepare(sql).get(...b) ?? null;
        },
        async all() {
          if (opts.failDistinct && /SELECT DISTINCT trigger_name/.test(sql)) throw new Error('D1 down');
          return { results: db.prepare(sql).all(...b) };
        },
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { changes: Number(r.changes) } };
        },
      };
      return api;
    },
  };
  return d1;
}

function freshDb() {
  const db = new DatabaseSync(':memory:');
  // The baseline's DDL and index, read off disk rather than retyped.
  const base = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
  const table = /CREATE TABLE cron_run_history \([\s\S]*?\);/.exec(base);
  const index = /CREATE INDEX idx_crh_trigger_time ON cron_run_history\(trigger_name, started_at\);/.exec(base);
  assert.ok(table && index, 'the baseline no longer declares cron_run_history as this test expects');
  db.exec(table![0]);
  db.exec(index![0]);
  return db;
}
const add = (db: InstanceType<typeof DatabaseSync>, trigger: string, startedAt: string) =>
  db.prepare(`INSERT INTO cron_run_history (trigger_name, started_at, finished_at, status) VALUES (?, ?, ?, 'completed')`)
    .run(trigger, startedAt, startedAt);
const count = (db: InstanceType<typeof DatabaseSync>, where = '1=1', ...args: any[]) =>
  Number((db.prepare(`SELECT COUNT(*) AS n FROM cron_run_history WHERE ${where}`).get(...args) as any).n);

test('rows older than the window go, rows inside it stay', async () => {
  const db = freshDb();
  for (let d = 0; d < 60; d++) add(db, '* * * * *', daysAgo(d));
  const r = await pruneCronRunHistory({ DB: makeD1(db) } as any, { now: NOW });
  assert.equal(r.readable, true);
  // 0..29 days stay (30 rows); day 30 is exactly at the cutoff, not older, and stays too.
  assert.equal(count(db), 31);
  assert.equal(r.deleted, 29);
  assert.equal(count(db, 'datetime(started_at) < datetime(?)', daysAgo(CRON_HISTORY_RETENTION_DAYS)), 0);
});

test('the weekly trigger whose last run aged out keeps that run, and does not read "never fired"', async () => {
  const db = freshDb();
  add(db, '0 9 * * 2', daysAgo(47));
  add(db, '0 9 * * 2', daysAgo(40)); // its newest row, older than the window
  add(db, '* * * * *', daysAgo(45));
  add(db, '* * * * *', daysAgo(1));
  const env = { DB: makeD1(db) } as any;
  const r = await pruneCronRunHistory(env, { now: NOW });
  assert.equal(r.kept, 2);
  assert.equal(count(db, 'trigger_name = ?', '0 9 * * 2'), 1, 'the weekly trigger lost its newest row');
  assert.equal(count(db, 'trigger_name = ? AND started_at = ?', '0 9 * * 2', daysAgo(40)), 1,
    'the sweep kept a row, but not the newest one');
  assert.equal(count(db, 'trigger_name = ?', '* * * * *'), 1, 'the every-minute trigger kept an old row it did not need');
  const latest = await latestRunPerTrigger(env, ['0 9 * * 2'], NOW);
  const state = triggerState('0 9 * * 2', latest.get('0 9 * * 2') ?? null, NOW);
  assert.notEqual(state.state, 'never', 'the weekly trigger reads "never fired" after the sweep');
});

test('a future-dated row does not take the keep slot from the real newest row', async () => {
  const db = freshDb();
  add(db, '0 9 * * 2', daysAgo(40));
  add(db, '0 9 * * 2', stamp(NOW.getTime() + 30 * DAY)); // bound by the retired /cron-log route
  await pruneCronRunHistory({ DB: makeD1(db) } as any, { now: NOW });
  assert.equal(count(db, 'started_at = ?', daysAgo(40)), 1,
    'the row latestRunPerTrigger reads was deleted because a future row was treated as newest');
});

test('the comparison is by datetime(), so an ISO stamp is read by its time, not by where T sorts', async () => {
  const db = freshDb();
  const cutoff = NOW.getTime() - CRON_HISTORY_RETENTION_DAYS * DAY;
  // One hour before the cutoff, in ISO form. A bare string comparison sorts
  // 'T' after ' ' and would call this row newer than the cutoff.
  const iso = new Date(cutoff - 3_600_000).toISOString().slice(0, 19);
  add(db, 'legacy', daysAgo(0));
  add(db, 'legacy', iso);
  await pruneCronRunHistory({ DB: makeD1(db) } as any, { now: NOW });
  assert.equal(count(db, 'started_at = ?', iso), 0, 'an ISO-format row older than the window survived');
});

test('the sweep deletes in bounded batches and stops at its cap', async () => {
  const db = freshDb();
  add(db, 'x', daysAgo(0));
  for (let i = 0; i < 20; i++) add(db, 'x', daysAgo(40 + i));
  const d1 = makeD1(db);
  const r = await pruneCronRunHistory({ DB: d1 } as any, { now: NOW, batchRows: 3, maxBatches: 4 });
  assert.equal(r.batches, 4);
  assert.equal(r.deleted, 12);
  assert.equal(r.capped, true);
  const deletes = d1.statements.filter((s: string) => /^\s*DELETE/.test(s));
  assert.equal(deletes.length, 4, 'more statements ran than the cap allows');
  for (const s of deletes) assert.match(s, /LIMIT \?/, 'a delete ran without a LIMITed subquery');
  // The next sweep finishes the job.
  const r2 = await pruneCronRunHistory({ DB: makeD1(db) } as any, { now: NOW, batchRows: 3, maxBatches: 4 });
  assert.equal(r2.capped, false);
  assert.equal(count(db), 1);
  assert.ok(PRUNE_BATCH_ROWS * PRUNE_MAX_BATCHES <= 25_000, 'the per-tick cap grew past what the header states');
});

test('if the keep list cannot be built, nothing is deleted', async () => {
  const db = freshDb();
  add(db, '0 9 * * 2', daysAgo(40));
  const r = await pruneCronRunHistory({ DB: makeD1(db, { failDistinct: true }) } as any, { now: NOW });
  assert.equal(r.readable, false);
  assert.equal(r.deleted, 0);
  assert.equal(count(db), 1);
});

test('every comparison in the sweep is datetime() on both sides', () => {
  const src = readFileSync(new URL('../src/util/cronHistory.ts', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('export async function pruneCronRunHistory'));
  assert.match(fn, /datetime\(started_at\) < datetime\(\?\)/);
  assert.doesNotMatch(fn, /[^(]started_at\s*[<>]=?\s*\?/, 'a bare started_at comparison is back');
});

test('the history route sends the window beside its count, and the Cron tab says the count is not all-time', () => {
  const route = readFileSync(new URL('../src/routes/infra.ts', import.meta.url), 'utf8');
  const get = route.slice(route.indexOf("infra.get('/cron-history'"));
  assert.match(get.slice(0, 3000), /retention_days: CRON_HISTORY_RETENTION_DAYS,/);
  const tab = readFileSync(new URL('../../frontend/src/pages/CronTab.jsx', import.meta.url), 'utf8');
  assert.match(tab, /in the last \$\{retentionDays\} days \(older runs are pruned; each trigger's newest run is kept\)/);
  assert.match(tab, /setRetentionDays\(Number\.isInteger\(cr\.value\.retention_days\)/);
});
