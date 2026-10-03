/**
 * D333 — quiet hours with the digest off no longer drops a non-critical
 * email outright.
 *
 * Before this fix, `notify()`'s email branch read: critical → send now;
 * quiet hours → (digest off → log `suppressed_quiet_hours` to
 * `activity_logs` and send nothing; digest on → buffer to the outbox);
 * otherwise → send now. A user who was in quiet hours AND had never turned
 * digests on simply never got the email — not now, not buffered, not ever.
 *
 * THE FIRST FIX HERE DISPATCHED IMMEDIATELY INSTEAD, AND A CODEX REVIEW ON
 * THE PR CAUGHT WHY THAT WAS ALSO WRONG: `SettingsPage.jsx`'s Quiet Hours
 * card promises "Push and non-critical email are paused during this
 * window" — sending right away during the window breaks that promise just
 * as much as dropping the email did, only louder (an overnight email the
 * user explicitly asked to not get until morning). The actual fix buffers
 * it the same way a digest-on quiet-hours email already does
 * (`enqueueOutbox(..., 'quiet_hours')`), which the existing digest cadence
 * flush drains at the user's next local slot (daily by default when
 * digest is 'off') — paused and later delivered, never vanished, which is
 * the promise the UI actually makes.
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

/** Fake Gmail creds so `sendNotificationEmail` doesn't early-return on
 *  `!env.GMAIL_CLIENT_ID` before ever attempting a send — the observable
 *  signal for "did notify() actually try to dispatch an email" is whether
 *  the OAuth token-exchange fetch to oauth2.googleapis.com fires. */
function envWithGmail(db: InstanceType<typeof DatabaseSync>): any {
  return { ...env(db), GMAIL_CLIENT_ID: 'x', GMAIL_CLIENT_SECRET: 'x', GMAIL_REFRESH_TOKEN: 'x' };
}

async function suppressedRows(db: InstanceType<typeof DatabaseSync>): Promise<number> {
  const row: any = db.prepare(
    `SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'suppressed_quiet_hours' AND user_id = ?`,
  ).get(ME);
  return Number(row?.n ?? 0);
}

async function outboxRows(db: InstanceType<typeof DatabaseSync>, reason: string): Promise<number> {
  const row: any = db.prepare(
    `SELECT COUNT(*) AS n FROM notification_outbox WHERE user_id = ? AND reason = ?`,
  ).get(ME, reason);
  return Number(row?.n ?? 0);
}

test('quiet hours + digest off: the email is buffered, not suppressed and not sent immediately', async () => {
  const db = fixture();
  await notify(env(db), {
    userId: ME, type: 'score_generated', title: 'New score', category: 'scoring',
    channels: ['email'],
  });
  assert.equal(await suppressedRows(db), 0, 'notify() still suppressed the email outright with digest off');
  assert.equal(
    await outboxRows(db, 'quiet_hours'), 1,
    'the email was neither buffered nor dropped — it must have been sent immediately, contradicting the Quiet Hours pause promise',
  );
});

test('quiet hours + digest daily: still buffers to the outbox, not a regression', async () => {
  const db = fixture();
  db.prepare(`UPDATE user_settings SET digest_frequency = 'daily' WHERE user_id = ?`).run(ME);
  await notify(env(db), {
    userId: ME, type: 'score_generated', title: 'New score', category: 'scoring',
    channels: ['email'],
  });
  assert.equal(await outboxRows(db, 'digest'), 1, 'a daily-digest user in quiet hours should still buffer the email');
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

test('a critical category\'s email is not stopped by a stored email:false opt-out', async (t) => {
  // Codex review on this PR: SettingsPage.jsx now renders capital_call_issued's
  // email column checked and disabled (D333's lock), but a user who saved
  // `email: false` before that lock existed had their email silently kept
  // off — resolveChannels dropped 'email' before isCritical ever got a say,
  // so the "cannot be turned off" promise was UI-only. The observable proof
  // that notify() actually tries to send (not just that no DB row says it
  // didn't) is whether it reaches Gmail's OAuth token exchange at all.
  const db = fixture();
  db.prepare(`UPDATE users SET notification_prefs = ? WHERE id = ?`)
    .run(JSON.stringify({ capital_call_issued: { email: false } }), ME);
  let fetchedOAuth = false;
  const originalFetch = globalThis.fetch;
  t.after(() => { (globalThis as any).fetch = originalFetch; });
  (globalThis as any).fetch = async (url: string, init: any) => {
    if (String(url).includes('oauth2.googleapis.com')) { fetchedOAuth = true; }
    return new Response(JSON.stringify({ error: 'test_stub_no_real_send' }), { status: 400 });
  };
  await notify(envWithGmail(db), {
    userId: ME, type: 'capital_call_issued', title: 'Capital call issued', category: 'billing',
    channels: ['email'],
  });
  assert.equal(fetchedOAuth, true, 'notify() never attempted to send the email at all — the stored opt-out silently won');
  const outbox: any = db.prepare(`SELECT COUNT(*) AS n FROM notification_outbox WHERE user_id = ?`).get(ME);
  assert.equal(Number(outbox?.n ?? 0), 0, 'a critical category must never be buffered, stored opt-out or not');
  assert.equal(await suppressedRows(db), 0);
});

test('a non-critical, non-locked type still honours a stored email:false opt-out', async (t) => {
  // The fix must not over-widen: resolveChannels only forces email back for
  // a CRITICAL category, never for an ordinary opt-outable one.
  const db = fixture();
  db.prepare(`UPDATE user_settings SET quiet_hours_start = NULL, quiet_hours_end = NULL WHERE user_id = ?`).run(ME);
  db.prepare(`UPDATE users SET notification_prefs = ? WHERE id = ?`)
    .run(JSON.stringify({ score_generated: { email: false } }), ME);
  let fetchedOAuth = false;
  const originalFetch = globalThis.fetch;
  t.after(() => { (globalThis as any).fetch = originalFetch; });
  (globalThis as any).fetch = async (url: string) => {
    if (String(url).includes('oauth2.googleapis.com')) { fetchedOAuth = true; }
    return new Response(JSON.stringify({ error: 'test_stub_no_real_send' }), { status: 400 });
  };
  await notify(envWithGmail(db), {
    userId: ME, type: 'score_generated', title: 'New score', category: 'scoring',
    channels: ['email'],
  });
  assert.equal(fetchedOAuth, false, 'email was opted out for a non-critical type, yet notify() tried to send it anyway');
});
