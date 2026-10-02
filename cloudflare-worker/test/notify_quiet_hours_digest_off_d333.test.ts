/**
 * D333 — quiet hours with the digest off no longer drops a non-critical
 * email outright.
 *
 * Before this fix, `notify()`'s email branch read: critical → send now;
 * quiet hours → (digest off → log `suppressed_quiet_hours` to
 * `activity_logs` and send nothing; digest on → buffer to the outbox);
 * otherwise → send now. A user who was in quiet hours AND had never turned
 * digests on simply never got the email — not now, not buffered, not ever.
 * Quiet hours only ever promised to suppress the real-time push (see T20 in
 * notify.ts); it was never meant to be a second, silent unsubscribe for
 * mail with no digest to catch it.
 *
 * The fix drops the quiet+digest-off special case entirely: with digest
 * off, quiet hours now behaves like "not quiet" for the email channel —
 * the email dispatches immediately either way. This test pins that by
 * checking the one durable side effect the old code had: the
 * `suppressed_quiet_hours` activity_logs row. The fixed code never writes
 * one; the old code always did when digest was off and the user was inside
 * their quiet window.
 *
 * Real SQLite, per the project's standing D1-test convention — the
 * behaviour under test is the branch notify() takes, not a stubbed shape.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/notify_quiet_hours_digest_off_d333.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import { notify } from '../src/services/notify.ts';
import { d1Over } from './_d1_sqlite.mjs';

const ME = 7;

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, notification_prefs TEXT);
    CREATE TABLE activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL, details TEXT, actor TEXT, user_id INTEGER
    );
    CREATE TABLE user_settings (
      user_id INTEGER PRIMARY KEY,
      digest_frequency TEXT DEFAULT 'weekly',
      quiet_hours_start TEXT, quiet_hours_end TEXT, quiet_hours_tz TEXT DEFAULT 'UTC'
    );
  `);
  db.prepare(`INSERT INTO users (id, email) VALUES (?, 'rae@axal.example')`).run(ME);
  // Quiet hours spanning the whole day in UTC, so "now" is always inside —
  // this isolates the digest=off branch from any clock-dependent flakiness.
  db.prepare(
    `INSERT INTO user_settings (user_id, digest_frequency, quiet_hours_start, quiet_hours_end, quiet_hours_tz)
     VALUES (?, 'off', '00:00', '23:59', 'UTC')`,
  ).run(ME);
  return db;
}

function env(db: InstanceType<typeof DatabaseSync>): any {
  return { ENVIRONMENT: 'development', DB: d1Over(db) };
}

async function suppressedRows(db: InstanceType<typeof DatabaseSync>): Promise<number> {
  const row: any = db.prepare(
    `SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'suppressed_quiet_hours' AND user_id = ?`,
  ).get(ME);
  return Number(row?.n ?? 0);
}

test('quiet hours + digest off: the email is not logged as suppressed', async () => {
  const db = fixture();
  await notify(env(db), {
    userId: ME, type: 'score_generated', title: 'New score', category: 'scoring',
    channels: ['email'],
  });
  assert.equal(await suppressedRows(db), 0, 'notify() still suppressed the email outright with digest off');
});

test('quiet hours + digest daily: still buffers to the outbox, not a regression', async () => {
  const db = fixture();
  db.prepare(`UPDATE user_settings SET digest_frequency = 'daily' WHERE user_id = ?`).run(ME);
  await notify(env(db), {
    userId: ME, type: 'score_generated', title: 'New score', category: 'scoring',
    channels: ['email'],
  });
  const row: any = db.prepare(
    `SELECT COUNT(*) AS n FROM notification_outbox WHERE user_id = ? AND reason = 'digest'`,
  ).get(ME);
  assert.equal(Number(row?.n ?? 0), 1, 'a daily-digest user in quiet hours should still buffer the email');
  assert.equal(await suppressedRows(db), 0);
});

test('critical category always sends now, quiet hours or not', async () => {
  const db = fixture();
  await notify(env(db), {
    userId: ME, type: 'billing_alert', title: 'Payment failed', category: 'billing',
    channels: ['email'],
  });
  const outbox: any = db.prepare(`SELECT COUNT(*) AS n FROM notification_outbox WHERE user_id = ?`).get(ME);
  assert.equal(Number(outbox?.n ?? 0), 0, 'a critical category must never be buffered');
  assert.equal(await suppressedRows(db), 0);
});
