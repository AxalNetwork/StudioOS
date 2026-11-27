/**
 * Task #12 — Prove the end-of-cron run-history write survives a real DB blip.
 *
 * Task #4 covered the retry primitive (`withD1Retry`) in isolation but NOT the
 * end-to-end finalize wiring: that the scheduled handler's last
 * `cron_run_history` INSERT actually goes through the retry and still lands
 * after a transient "D1 DB is overloaded" failure followed by success. That
 * write now lives in `util/cronHistory.ts` and is called verbatim by the
 * scheduled handler's `finally` block, so exercising the helper here exercises
 * the real production path.
 *
 * Run with the strip-types loader (see package.json test:drift):
 *   node --experimental-strip-types --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/cron_history_write.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeCronRunHistory } from '../src/util/cronHistory.ts';

/**
 * Minimal D1 stub for the `prepare(sql).bind(...).run()` chain. `failPlan` is
 * called once per `.run()` with the 0-based attempt index and returns an Error
 * to throw on that attempt or null to let the INSERT "land". Only landed
 * attempts push a row, so `rows.length` is the count actually written.
 */
function makeCronHistoryDb(failPlan: (attempt: number) => Error | null) {
  const rows: any[][] = [];
  const db: any = {
    runCalls: 0,
    rows,
    prepare(sql: string) {
      return {
        sql,
        binds: [] as any[],
        bind(...a: any[]) {
          this.binds = a;
          return this;
        },
        async run() {
          const err = failPlan(db.runCalls);
          db.runCalls++;
          if (err) throw err;
          rows.push(this.binds);
          return { success: true, meta: { changes: 1, last_row_id: rows.length } };
        },
      };
    },
  };
  return db;
}

const fixedClock = () => new Date('2026-06-30T02:00:30Z');

test('writeCronRunHistory lands exactly one row after a transient overload retry', async () => {
  // First attempt throws the canonical transient signature; second succeeds.
  const db = makeCronHistoryDb((attempt) =>
    attempt === 0 ? new Error('D1 DB is overloaded. Requests queued for too long.') : null,
  );
  const env: any = { DB: db };

  await writeCronRunHistory(
    env,
    {
      triggerName: '*/5 * * * *',
      startedAt: '2026-06-30 02:00:00',
      cronError: null,
      summary: ['reembed=3', 'reminders=1'],
    },
    { retries: 3, baseDelayMs: 1, now: fixedClock },
  );

  assert.equal(db.runCalls, 2, 'first attempt fails transiently, the retry succeeds');
  assert.equal(db.rows.length, 1, 'exactly one cron_run_history row is ultimately written');
  const row = db.rows[0];
  assert.equal(row[0], '*/5 * * * *', 'trigger_name');
  assert.equal(row[1], '2026-06-30 02:00:00', 'started_at');
  assert.equal(row[2], '2026-06-30 02:00:30', 'finished_at derived from the injected clock');
  assert.equal(row[3], 'completed', 'status is completed when there is no cron error');
  assert.equal(row[4], 'reembed=3 | reminders=1', 'summary fragments joined with " | "');
  assert.equal(row[5], null, 'error column is NULL on a clean run');
});

test('writeCronRunHistory surfaces a non-transient write error immediately without retrying', async () => {
  // A real schema bug must NOT be masked behind backoff.
  const db = makeCronHistoryDb(() => new Error('no such column: trigger_name'));
  const env: any = { DB: db };

  await assert.rejects(
    () =>
      writeCronRunHistory(
        env,
        { triggerName: 'manual', startedAt: '2026-06-30 02:00:00', cronError: null, summary: [] },
        { retries: 5, baseDelayMs: 1, now: fixedClock },
      ),
    /no such column/,
  );

  assert.equal(db.runCalls, 1, 'a non-transient error surfaces on the first attempt — never retried');
  assert.equal(db.rows.length, 0, 'no row is written when the INSERT genuinely fails');
});

test('writeCronRunHistory records a failed run with status=failed and NULL summary', async () => {
  const db = makeCronHistoryDb(() => null);
  const env: any = { DB: db };

  await writeCronRunHistory(
    env,
    { triggerName: 'hourly', startedAt: '2026-06-30 03:00:00', cronError: 'cron batch error', summary: [] },
    { baseDelayMs: 1, now: fixedClock },
  );

  assert.equal(db.rows.length, 1);
  const row = db.rows[0];
  assert.equal(row[3], 'failed', 'a batch error marks the run failed');
  assert.equal(row[4], null, 'an empty summary persists as NULL, not an empty string');
  assert.equal(row[5], 'cron batch error', 'the error text is recorded');
});
