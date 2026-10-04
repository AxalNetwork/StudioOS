/**
 * D333 — a second Codex review round on the same PR found three more
 * defects in the first fix pass:
 *
 *  1. (P1) `isCritical` forced email back over a stored opt-out for EVERY
 *     uncategorised legacy caller (capital.ts's capital_call_paid,
 *     tickets.ts's ticket_update), not just the two types
 *     SettingsPage.jsx actually renders locked (capital_call_issued,
 *     agreement_ready_to_sign). `resolveChannels` now takes a dedicated
 *     `forceEmail` flag scoped to LOCKED_EMAIL_TYPES, decoupled from
 *     `isCritical` (which stays as-is for quiet-hours/digest timing).
 *  2. (P2) `flushPendingDigests` released `reason: 'quiet_hours'` outbox
 *     rows at the fixed 09:00-local send slot without rechecking whether
 *     the quiet window itself (e.g. 22:00-10:00) was still open — so a
 *     "paused until the window ends" email shipped mid-window anyway.
 *  3. (P2) the weekly digest's `weekLabel` formatted in the runtime's
 *     default timezone instead of the recipient's `u.tz`, so a user east
 *     of UTC could see the previous day's date in "WEEK OF ...".
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/notify_codex_round2_d333.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import { notify, flushPendingDigests } from '../src/services/notify.ts';
import { d1Over } from './_d1_sqlite.mjs';

function isHost(url: string, host: string): boolean {
  try { return new URL(url).hostname === host; } catch { return false; }
}

function schema(db: InstanceType<typeof DatabaseSync>) {
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, notification_prefs TEXT);
    CREATE TABLE activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL, details TEXT, actor TEXT, user_id INTEGER
    );
    CREATE TABLE user_settings (
      user_id INTEGER PRIMARY KEY,
      digest_frequency TEXT DEFAULT 'weekly',
      quiet_hours_start TEXT, quiet_hours_end TEXT, quiet_hours_tz TEXT DEFAULT 'UTC',
      timezone TEXT
    );
    CREATE TABLE notification_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL, type TEXT, title TEXT, body TEXT, link TEXT,
      payload TEXT, category TEXT, reason TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, flushed_at TIMESTAMP, flushed_digest_id TEXT
    );
  `);
}

test('an uncategorised legacy type (capital_call_paid) still honours a stored email opt-out', async (t) => {
  const db = new DatabaseSync(':memory:');
  schema(db);
  const ME = 31;
  db.prepare(`INSERT INTO users (id, email, notification_prefs) VALUES (?, 'rae@axal.example', ?)`)
    .run(ME, JSON.stringify({ capital_call_paid: { email: false } }));
  db.prepare(`INSERT INTO user_settings (user_id, digest_frequency) VALUES (?, 'off')`).run(ME);

  let fetchedOAuth = false;
  const originalFetch = globalThis.fetch;
  t.after(() => { (globalThis as any).fetch = originalFetch; });
  (globalThis as any).fetch = async (url: string) => {
    if (isHost(String(url), 'oauth2.googleapis.com')) fetchedOAuth = true;
    return new Response(JSON.stringify({ error: 'test_stub_no_real_send' }), { status: 400 });
  };

  const env: any = {
    ENVIRONMENT: 'development', DB: d1Over(db),
    GMAIL_CLIENT_ID: 'x', GMAIL_CLIENT_SECRET: 'x', GMAIL_REFRESH_TOKEN: 'x',
  };
  // capital.ts calls notify() for capital_call_paid with no `category`,
  // the exact shape Codex's P1 finding named.
  await notify(env, {
    userId: ME, type: 'capital_call_paid', title: 'Capital call paid',
    channels: ['email'],
  });
  assert.equal(fetchedOAuth, false, 'an uncategorised caller\'s own stored opt-out must still work — only capital_call_issued/agreement_ready_to_sign are locked');
});

test('capital_call_issued (a genuinely locked type) still overrides a stored opt-out', async (t) => {
  const db = new DatabaseSync(':memory:');
  schema(db);
  const ME = 32;
  db.prepare(`INSERT INTO users (id, email, notification_prefs) VALUES (?, 'rae@axal.example', ?)`)
    .run(ME, JSON.stringify({ capital_call_issued: { email: false } }));
  db.prepare(`INSERT INTO user_settings (user_id, digest_frequency) VALUES (?, 'off')`).run(ME);

  let fetchedOAuth = false;
  const originalFetch = globalThis.fetch;
  t.after(() => { (globalThis as any).fetch = originalFetch; });
  (globalThis as any).fetch = async (url: string) => {
    if (isHost(String(url), 'oauth2.googleapis.com')) fetchedOAuth = true;
    return new Response(JSON.stringify({ error: 'test_stub_no_real_send' }), { status: 400 });
  };

  const env: any = {
    ENVIRONMENT: 'development', DB: d1Over(db),
    GMAIL_CLIENT_ID: 'x', GMAIL_CLIENT_SECRET: 'x', GMAIL_REFRESH_TOKEN: 'x',
  };
  await notify(env, {
    userId: ME, type: 'capital_call_issued', title: 'Capital call issued', category: 'billing',
    channels: ['email'],
  });
  assert.equal(fetchedOAuth, true, 'the LOCKED_EMAIL_TYPES scoping must not break the lock it is meant to keep');
});

test('a quiet-hours-buffered row is not released while the window is still open', async () => {
  const db = new DatabaseSync(':memory:');
  schema(db);
  const ME = 33;
  db.prepare(`INSERT INTO users (id, email) VALUES (?, 'rae@axal.example')`).run(ME);
  // Window 22:00-10:00 UTC — still open at the 09:00 send slot this test uses.
  db.prepare(
    `INSERT INTO user_settings (user_id, digest_frequency, quiet_hours_start, quiet_hours_end, quiet_hours_tz)
     VALUES (?, 'off', '22:00', '10:00', 'UTC')`,
  ).run(ME);
  db.prepare(
    `INSERT INTO notification_outbox (user_id, type, title, body, reason) VALUES (?, 'score_generated', 'New score', 'a body', 'quiet_hours')`,
  ).run(ME);

  const env: any = { ENVIRONMENT: 'development', DB: d1Over(db) };
  const sendTime = new Date('2026-10-05T09:00:00Z'); // inside 22:00-10:00
  const result = await flushPendingDigests(env, sendTime);
  assert.equal(result.sent, 0, 'a quiet_hours row must not flush while the window is still open');
  const pending: any = db.prepare(
    `SELECT COUNT(*) AS n FROM notification_outbox WHERE user_id = ? AND flushed_at IS NULL`,
  ).get(ME);
  assert.equal(Number(pending?.n ?? 0), 1, 'the row must stay pending, not get dropped');
});

test('a quiet-hours-buffered row DOES flush once the window has ended', async () => {
  const db = new DatabaseSync(':memory:');
  schema(db);
  const ME = 34;
  db.prepare(`INSERT INTO users (id, email) VALUES (?, 'rae@axal.example')`).run(ME);
  // Window 02:00-05:00 UTC — closed well before the 09:00 send slot.
  db.prepare(
    `INSERT INTO user_settings (user_id, digest_frequency, quiet_hours_start, quiet_hours_end, quiet_hours_tz)
     VALUES (?, 'off', '02:00', '05:00', 'UTC')`,
  ).run(ME);
  db.prepare(
    `INSERT INTO notification_outbox (user_id, type, title, body, reason) VALUES (?, 'score_generated', 'New score', 'a body', 'quiet_hours')`,
  ).run(ME);

  const env: any = { ENVIRONMENT: 'development', DB: d1Over(db) };
  const result = await flushPendingDigests(env, new Date('2026-10-05T09:00:00Z'));
  assert.equal(result.sent, 1, 'a closed quiet window must not block the regular 09:00 digest flush');
});

test('the weekly digest formats "WEEK OF" in the recipient\'s own timezone, not the runtime default', async (t) => {
  const db = new DatabaseSync(':memory:');
  schema(db);
  const ME = 35;
  // Kiritimati (UTC+14, the world's farthest-ahead tz): Monday 09:00 local
  // is Sunday 19:00 UTC — a full calendar day earlier. The cadence check
  // already formats in `u.tz` and correctly treats this instant as the
  // Monday weekly slot; a `weekLabel` formatter that fell back to the
  // runtime's default (UTC here) would print "4 October" (Sunday), a day
  // behind what the recipient's own 09:00 Monday actually is.
  db.prepare(`INSERT INTO users (id, email) VALUES (?, 'rae@axal.example')`).run(ME);
  db.prepare(
    `INSERT INTO user_settings (user_id, digest_frequency, quiet_hours_tz) VALUES (?, 'weekly', 'Pacific/Kiritimati')`,
  ).run(ME);
  db.prepare(
    `INSERT INTO notification_outbox (user_id, type, title, body, reason) VALUES (?, 'score_generated', 'New score', 'a body', 'digest')`,
  ).run(ME);

  let sentMime: string | null = null;
  const originalFetch = globalThis.fetch;
  t.after(() => { (globalThis as any).fetch = originalFetch; });
  (globalThis as any).fetch = async (url: string, init: any) => {
    const u = String(url);
    if (isHost(u, 'oauth2.googleapis.com')) return new Response(JSON.stringify({ access_token: 'fake' }), { status: 200 });
    if (isHost(u, 'gmail.googleapis.com')) {
      const payload = JSON.parse(init.body);
      const b64 = String(payload.raw).replace(/-/g, '+').replace(/_/g, '/');
      sentMime = Buffer.from(b64, 'base64').toString('utf8');
      return new Response(JSON.stringify({ id: 'fake' }), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${u}`);
  };

  const env: any = {
    ENVIRONMENT: 'development', DB: d1Over(db),
    GMAIL_CLIENT_ID: 'x', GMAIL_CLIENT_SECRET: 'x', GMAIL_REFRESH_TOKEN: 'x',
  };
  // 2026-10-04T19:00Z = Monday 09:00 Pacific/Kiritimati exactly, which is
  // still Sunday in UTC.
  const result = await flushPendingDigests(env, new Date('2026-10-04T19:00:00Z'));
  assert.equal(result.sent, 1, 'the weekly digest did not send at all');
  assert.ok(sentMime, 'no email actually reached Gmail');
  const htmlPartMatch = sentMime!.match(
    /Content-Type: text\/html[^\r\n]*\r\nContent-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)\r\n\r\n--/,
  );
  assert.ok(htmlPartMatch, 'html part not found in raw MIME');
  const html = Buffer.from(htmlPartMatch[1].replace(/\s+/g, ''), 'base64').toString('utf8');
  assert.match(html, /5 OCTOBER/i, 'the WEEK OF label must show the recipient\'s own local date (5 October in Pacific/Kiritimati), not a UTC-shifted one (4 October)');
});
