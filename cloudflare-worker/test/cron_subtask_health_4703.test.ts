/**
 * D4703 (#4703) part 2: a failed scheduled sub-task stays visible as failed
 * when the trigger around it completes.
 *
 * `scheduled()` catches each sub-task's failure so the next one runs. That kept
 * the tick alive and wrote `completed` over a failure. Each catch now names
 * itself (`taskFailed`), and the row is `partial` with those names in `error`.
 * `partial` is one of the statuses HQ reads as failed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  FAILED_STATUSES, cronRunError, cronRunStatus, triggerState, writeCronRunHistory,
} from '../src/util/cronHistory.ts';
import { d1Over } from './_d1_sqlite.mjs';

test('a tick is failed when its batch threw, partial when a sub-task failed, else completed', () => {
  // Mutation checked: failedTasks ignored → a tick with a failed sub-task reads `completed`.
  assert.equal(cronRunStatus({ cronError: 'boom', failedTasks: ['x'] }), 'failed');
  assert.equal(cronRunStatus({ cronError: null, failedTasks: ['hubspot sync'] }), 'partial');
  assert.equal(cronRunStatus({ cronError: null, failedTasks: [] }), 'completed');
  assert.equal(cronRunStatus({ cronError: null }), 'completed');
  assert.equal(cronRunError({ cronError: null, failedTasks: ['hubspot sync', 'kv snapshot', 'hubspot sync'] }),
    'sub-tasks failed: hubspot sync, kv snapshot', 'each task once, in order');
  assert.equal(cronRunError({ cronError: 'boom', failedTasks: ['x'] }), 'boom');
  assert.equal(cronRunError({ cronError: null, failedTasks: [] }), null);
});

test('a partial tick is written as partial, and HQ reads it as failed', async () => {
  // Mutation checked: `partial` left out of FAILED_STATUSES → the trigger reads `ok`.
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE cron_run_history (id INTEGER PRIMARY KEY AUTOINCREMENT, trigger_name TEXT NOT NULL,
    started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL, summary TEXT, error TEXT)`);
  const env: any = { DB: d1Over(db) };
  await writeCronRunHistory(env, {
    triggerName: '* * * * *', startedAt: '2026-11-07 09:00:00', cronError: null,
    failedTasks: ['salesforce sync'], summary: ['drain processed=3 failed=0'],
  }, { now: () => new Date('2026-11-07T09:00:30Z') });
  const row = db.prepare('SELECT * FROM cron_run_history').get() as any;
  assert.deepEqual([row.status, row.error], ['partial', 'sub-tasks failed: salesforce sync']);
  assert.ok(FAILED_STATUSES.has('partial'));
  assert.equal(triggerState('* * * * *', row, new Date('2026-11-07T09:01:00Z')).state, 'failed');
});

test('every sub-task catch in scheduled() reports itself', () => {
  // A new sub-task that logs its failure with a bare console.error would read
  // as a completed run again. The only bare ones left are the lease (before the
  // tick starts), the outer batch catch, and the history write itself.
  // Mutation checked: one taskFailed call reverted to console.error → this fails naming it.
  const src = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
  const start = src.indexOf('async scheduled(event: ScheduledEvent');
  const end = src.indexOf('ctx.waitUntil(work);', start);
  assert.ok(start > 0 && end > start, 'scheduled() could not be found');
  const body = src.slice(start, end);
  const bare = [...body.matchAll(/console\.error\('\[cron\] ([^']*)'/g)].map((m) => m[1]);
  assert.deepEqual(bare.sort(), ['cron history write failed', 'lease acquire failed', 'sub-task failed:', 'unhandled batch error'].sort());
  assert.ok((body.match(/taskFailed\('/g) || []).length >= 60, 'the sub-tasks report through taskFailed');
  assert.match(body, /failedTasks: cronTaskFailures,/, 'and the row is written with them');
});
