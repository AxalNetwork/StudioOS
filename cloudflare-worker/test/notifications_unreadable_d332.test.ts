/**
 * D332 — a `notifications_inbox` table-setup failure is a refusal, not an
 * empty inbox.
 *
 * `ensureInbox` returning `false` used to make GET `/`, GET `/unread-count`
 * and POST `/mark-read` answer 200 with `[]` / `0` / `{ updated: 0 }` — the
 * exact shape a genuinely empty, genuinely caught-up inbox produces. The bell
 * always said "all caught up" whether nothing was there or nothing could be
 * READ, and those are opposite claims. All three now refuse (503,
 * `notifications_unreadable`) instead.
 *
 * Real SQLite, for the reason `_d1_sqlite.mjs` gives: the failure has to come
 * from the table genuinely not existing and genuinely failing to create, not
 * from a stub taught the right shape.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/notifications_unreadable_d332.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import notifications from '../src/routes/notifications.ts';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ME = 42;

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
                        jwt_min_iat INTEGER, name TEXT, email TEXT);
  `);
  db.prepare("INSERT INTO users (id, role, name, email) VALUES (?, 'founder', 'Rae', 'rae@axal.example')").run(ME);
  return db;
}

function baseEnv(db: InstanceType<typeof DatabaseSync>): any {
  return { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) };
}

/** A D1 whose CREATE TABLE for the inbox always fails — every other statement runs normally. */
function envWithBrokenInboxSetup(db: InstanceType<typeof DatabaseSync>): any {
  const realDB = d1Over(db);
  return {
    JWT_SECRET,
    ENVIRONMENT: 'development',
    DB: {
      ...realDB,
      prepare(sql: string) {
        if (/CREATE TABLE IF NOT EXISTS notifications_inbox/.test(sql)) {
          return { bind: () => ({ run: async () => { throw new Error('disk I/O error'); } }) };
        }
        return realDB.prepare(sql);
      },
    },
  };
}

const app = new Hono<any>();
app.route('/notifications', notifications);
app.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 500));

async function tokenFor(userId: number) {
  return new SignJWT({ user_id: userId, role: 'founder' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

test('GET / refuses rather than claiming an empty inbox', async () => {
  const db = fixture();
  const token = await tokenFor(ME);
  const res = await app.request(
    '/notifications',
    { headers: { Authorization: `Bearer ${token}` } },
    envWithBrokenInboxSetup(db),
  );
  assert.equal(res.status, 503, 'a table-setup failure did not refuse');
  const body: any = await res.json();
  assert.equal(body.error, 'notifications_unreadable');
  assert.ok(!('notifications' in body), 'the refusal body still carries the success shape');
});

test('GET /unread-count refuses rather than claiming zero unread', async () => {
  const db = fixture();
  const token = await tokenFor(ME);
  const res = await app.fetch(
    new Request('http://x/notifications/unread-count', { headers: { Authorization: `Bearer ${token}` } }),
    envWithBrokenInboxSetup(db),
  );
  assert.equal(res.status, 503, 'a table-setup failure did not refuse');
  const body: any = await res.json();
  assert.equal(body.error, 'notifications_unreadable');
  assert.ok(!('count' in body), 'the refusal body still carries the success shape');
});

test('POST /mark-read refuses rather than claiming nothing needed marking', async () => {
  const db = fixture();
  const token = await tokenFor(ME);
  const res = await app.fetch(
    new Request('http://x/notifications/mark-read', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ all: true }),
    }),
    envWithBrokenInboxSetup(db),
  );
  assert.equal(res.status, 503, 'a table-setup failure did not refuse');
  const body: any = await res.json();
  assert.equal(body.error, 'notifications_unreadable');
  assert.ok(!('updated' in body), 'the refusal body still carries the success shape');
});

test('a healthy table still answers 200 with real data — the refusal is scoped to the failure', async () => {
  const db = fixture();
  const token = await tokenFor(ME);
  // No mutation of DB.prepare here — the real ensureInbox runs and succeeds.
  const res = await app.request(
    '/notifications',
    { headers: { Authorization: `Bearer ${token}` } },
    baseEnv(db),
  );
  assert.equal(res.status, 200, 'a healthy inbox was refused');
  const body: any = await res.json();
  assert.deepEqual(body.notifications, []);
});
