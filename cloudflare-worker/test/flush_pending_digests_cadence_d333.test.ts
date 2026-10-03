/**
 * D333 — `flushPendingDigests` only uses the Emails canvas's M4
 * (`renderWeeklyDigest`) for a WEEKLY digest. A Codex review on this PR
 * caught that the first cut used it unconditionally: the canvas template
 * hardcodes "WEEK OF" and "Three things from your week", so a daily-cadence
 * user's HTML body described a week while the subject and plain-text
 * alternative correctly said "daily". `canvasTransactional.ts` has no daily
 * variant (the design canvas only specifies one, weekly), so daily keeps its
 * plain-text-only rendering instead of guessing at daily-specific copy
 * nobody designed.
 *
 * The observable proof is the raw MIME body Gmail's send endpoint actually
 * receives — decoded from the intercepted `raw` field — rather than trusting
 * than an internal variable took the branch it should have.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/flush_pending_digests_cadence_d333.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import { flushPendingDigests } from '../src/services/notify.ts';
import { d1Over } from './_d1_sqlite.mjs';

const ME = 21;

function fixture(digest: 'daily' | 'weekly') {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT);
    CREATE TABLE user_settings (
      user_id INTEGER PRIMARY KEY,
      digest_frequency TEXT DEFAULT 'weekly',
      quiet_hours_tz TEXT, timezone TEXT
    );
    CREATE TABLE notification_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL, type TEXT, title TEXT, body TEXT, link TEXT,
      payload TEXT, category TEXT, reason TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, flushed_at TIMESTAMP, flushed_digest_id TEXT
    );
  `);
  db.prepare(`INSERT INTO users (id, email) VALUES (?, 'rae@axal.example')`).run(ME);
  db.prepare(`INSERT INTO user_settings (user_id, digest_frequency, quiet_hours_tz) VALUES (?, ?, 'UTC')`)
    .run(ME, digest);
  db.prepare(
    `INSERT INTO notification_outbox (user_id, type, title, body, reason) VALUES (?, 'score_generated', 'New score', 'a body', 'digest')`,
  ).run(ME);
  return db;
}

function env(db: InstanceType<typeof DatabaseSync>): any {
  return {
    ENVIRONMENT: 'development', DB: d1Over(db),
    GMAIL_CLIENT_ID: 'x', GMAIL_CLIENT_SECRET: 'x', GMAIL_REFRESH_TOKEN: 'x',
  };
}

/** Each `multipart/alternative` part in the raw email is itself
 *  base64-encoded (`Content-Transfer-Encoding: base64`), so decoding the
 *  outer `raw` field only gets you to MIME headers wrapped around more
 *  base64 — this unwraps the html part specifically. */
function decodeHtmlPart(outerMime: string): string {
  const htmlPartMatch = outerMime.match(
    /Content-Type: text\/html[^\r\n]*\r\nContent-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)\r\n\r\n--/,
  );
  if (!htmlPartMatch) throw new Error('html part not found in raw MIME');
  return Buffer.from(htmlPartMatch[1].replace(/\s+/g, ''), 'base64').toString('utf8');
}

/** CodeQL (Incomplete URL substring sanitization): `url.includes(host)` also
 *  matches `https://evil.example/gmail.googleapis.com` or a subdomain built
 *  to contain it. Parsing and comparing the actual hostname is the fix. */
function isHost(url: string, host: string): boolean {
  try { return new URL(url).hostname === host; } catch { return false; }
}

/** Intercepts both the OAuth token exchange and the Gmail send call, and
 *  decodes the raw MIME body so the test can inspect what actually shipped. */
function interceptGmailSend(): { getSentHtml: () => string | null; restore: () => void } {
  const originalFetch = globalThis.fetch;
  let sentMime: string | null = null;
  (globalThis as any).fetch = async (url: string, init: any) => {
    const u = String(url);
    if (isHost(u, 'oauth2.googleapis.com')) {
      return new Response(JSON.stringify({ access_token: 'fake' }), { status: 200 });
    }
    if (isHost(u, 'gmail.googleapis.com')) {
      const payload = JSON.parse(init.body);
      const b64 = String(payload.raw).replace(/-/g, '+').replace(/_/g, '/');
      sentMime = Buffer.from(b64, 'base64').toString('utf8');
      return new Response(JSON.stringify({ id: 'fake' }), { status: 200 });
    }
    throw new Error(`unexpected fetch in test: ${u}`);
  };
  return {
    getSentHtml: () => (sentMime ? decodeHtmlPart(sentMime) : null),
    restore: () => { (globalThis as any).fetch = originalFetch; },
  };
}

// Any Monday at 09:00 UTC — satisfies both the daily AND weekly send-slot check.
const SEND_TIME = new Date('2026-10-05T09:00:00Z');

test('a weekly digest ships the canvas HTML ("WEEK OF")', async (t) => {
  const db = fixture('weekly');
  const { getSentHtml, restore } = interceptGmailSend();
  t.after(restore);
  const result = await flushPendingDigests(env(db), SEND_TIME);
  assert.equal(result.sent, 1, 'the digest did not send at all');
  const html = getSentHtml();
  assert.ok(html, 'no email was actually dispatched to Gmail');
  assert.match(html!, /WEEK OF/, 'a weekly digest should carry the canvas HTML');
});

test('a daily digest does NOT ship the weekly canvas HTML', async (t) => {
  const db = fixture('daily');
  const { getSentHtml, restore } = interceptGmailSend();
  t.after(restore);
  const result = await flushPendingDigests(env(db), SEND_TIME);
  assert.equal(result.sent, 1, 'the digest did not send at all');
  const html = getSentHtml();
  assert.ok(html, 'no email was actually dispatched to Gmail');
  assert.doesNotMatch(html!, /WEEK OF/i, 'a daily digest must not describe itself as a week');
  assert.doesNotMatch(html!, /Three things from your week/i, 'a daily digest carried the weekly canvas copy');
});
