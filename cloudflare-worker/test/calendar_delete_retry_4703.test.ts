/**
 * D4703 (#4703) part 3: a failed calendar delete is retried, oldest first, by
 * the hourly cron (`retryFailedCalendarDeletes`). The cancel path stamps the
 * mapping `calendar_delete_failed`; before this nothing read the stamp, so the
 * cancelled session stayed in the attendee's calendar for good.
 *
 * Real SQLite from the schema baseline. The attendees here have disconnected
 * their calendars since the failure, which is the path that clears without a
 * provider call (D1209 §4): the retry runs the same cancel, and the mapping
 * goes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { retryFailedCalendarDeletes } from '../src/services/calendar/sync.ts';
import { d1Over } from './_d1_sqlite.mjs';

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8'));
  const add = db.prepare(`INSERT INTO calendar_sync_records (user_id, provider, source_kind, source_id, external_event_id, last_synced_at, last_error)
    VALUES (?, 'google', ?, ?, ?, ?, ?)`);
  add.run(1, 'advisor_booking', 501, 'ext-501', '2026-11-01T00:00:00Z', 'calendar_delete_failed');
  add.run(1, 'partner_office_hour', 601, 'ext-601', '2026-11-02T00:00:00Z', 'calendar_delete_failed');
  add.run(1, 'advisor_booking', 502, 'ext-502', '2026-11-03T00:00:00Z', null); // a live copy: never touched
  return db;
}
const left = (db: any) => db.prepare('SELECT source_kind, source_id FROM calendar_sync_records ORDER BY source_id').all().map((r: any) => `${r.source_kind}:${r.source_id}`);

test('a stamped failed delete is retried and cleared; a live copy is left alone', async () => {
  // Mutation checked: the WHERE last_error filter dropped → the live booking 502's mapping is removed too.
  const db = fixture();
  const r = await retryFailedCalendarDeletes({ DB: d1Over(db) } as any, 20);
  assert.deepEqual(r, { tried: 2, cleared: 2 });
  assert.deepEqual(left(db), ['advisor_booking:502']);
});

test('each run takes the oldest few, so a long queue drains in order', async () => {
  // Mutation checked: ORDER BY oldest removed with LIMIT 1 → the newer failure can go first.
  const db = fixture();
  assert.deepEqual(await retryFailedCalendarDeletes({ DB: d1Over(db) } as any, 1), { tried: 1, cleared: 1 });
  assert.deepEqual(left(db), ['advisor_booking:502', 'partner_office_hour:601'], 'the oldest (501) went first');
});

test('the hourly cron runs it as a named sub-task', () => {
  const src = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
  const at = src.indexOf('retryFailedCalendarDeletes(env, 20)');
  assert.ok(at > 0, 'scheduled() calls the retry');
  const block = src.slice(src.lastIndexOf('if (now.getUTCMinutes() === 17)', at), src.indexOf("taskFailed('calendar delete retry'", at));
  assert.ok(block.length > 0 && block.length < 600, 'once an hour, and a failure is reported as a sub-task');
});
