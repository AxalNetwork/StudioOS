/**
 * D335 — the `/api/notifications/push/*` routes `frontend/src/lib/pwa.js`
 * has called since Task #57 with no worker route behind them
 * (`scripts/api-drift-baseline.json` carried all five as known debt).
 *
 * Real SQLite per the project's D1-test convention.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/notifications_push_routes_d335.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import notifications from '../src/routes/notifications.ts';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ME = 11;
const OTHER = 12;

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
                        jwt_min_iat INTEGER, name TEXT, email TEXT);
  `);
  db.prepare("INSERT INTO users (id, role, name, email) VALUES (?, 'founder', 'Rae', 'rae@axal.example')").run(ME);
  db.prepare("INSERT INTO users (id, role, name, email) VALUES (?, 'founder', 'Sam', 'sam@axal.example')").run(OTHER);
  return db;
}

function env(db: InstanceType<typeof DatabaseSync>, vapid = false): any {
  return {
    JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db),
    ...(vapid ? { VAPID_PUBLIC_KEY: 'test-pub', VAPID_PRIVATE_KEY: 'test-priv' } : {}),
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

test('GET /push/vapid-key returns null when unset, the real key when set', async () => {
  const db = fixture();
  const token = await tokenFor(ME);
  const noKey = await app.request('/notifications/push/vapid-key', { headers: { Authorization: `Bearer ${token}` } }, env(db));
  assert.deepEqual(await noKey.json(), { public_key: null });

  const withKey = await app.request('/notifications/push/vapid-key', { headers: { Authorization: `Bearer ${token}` } }, env(db, true));
  assert.deepEqual(await withKey.json(), { public_key: 'test-pub' });
});

test('POST /push/subscribe rejects a body missing keys', async () => {
  const db = fixture();
  const token = await tokenFor(ME);
  const res = await app.request('/notifications/push/subscribe', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint: 'https://fcm.googleapis.com/fcm/send/x' }),
  }, env(db));
  assert.equal(res.status, 422);
});

test('POST /push/subscribe then GET /push/subscriptions round-trips, scoped to the caller', async () => {
  const db = fixture();
  const tokenMe = await tokenFor(ME);
  const tokenOther = await tokenFor(OTHER);
  const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/me', keys: { p256dh: 'p1', auth: 'a1' }, user_agent: 'test-agent' };
  const subRes = await app.request('/notifications/push/subscribe', {
    method: 'POST', headers: { Authorization: `Bearer ${tokenMe}`, 'content-type': 'application/json' },
    body: JSON.stringify(sub),
  }, env(db));
  assert.equal(subRes.status, 200);
  assert.deepEqual(await subRes.json(), { ok: true });

  const mine = await app.request('/notifications/push/subscriptions', { headers: { Authorization: `Bearer ${tokenMe}` } }, env(db));
  const mineBody: any = await mine.json();
  assert.equal(mineBody.subscriptions.length, 1);
  assert.equal(mineBody.subscriptions[0].user_agent, 'test-agent');

  const others = await app.request('/notifications/push/subscriptions', { headers: { Authorization: `Bearer ${tokenOther}` } }, env(db));
  const othersBody: any = await others.json();
  assert.equal(othersBody.subscriptions.length, 0, "one user's subscription leaked into another's list");
});

test('re-subscribing the same endpoint updates the row instead of duplicating it', async () => {
  const db = fixture();
  const token = await tokenFor(ME);
  const first = { endpoint: 'https://fcm.googleapis.com/fcm/send/dup', keys: { p256dh: 'p1', auth: 'a1' } };
  const second = { endpoint: 'https://fcm.googleapis.com/fcm/send/dup', keys: { p256dh: 'p2', auth: 'a2' } };
  await app.request('/notifications/push/subscribe', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(first),
  }, env(db));
  await app.request('/notifications/push/subscribe', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(second),
  }, env(db));
  const row: any = db.prepare(`SELECT COUNT(*) AS n, MAX(p256dh) AS p256dh FROM push_subscriptions WHERE endpoint = ?`).get('https://fcm.googleapis.com/fcm/send/dup');
  assert.equal(Number(row.n), 1, 're-subscribing the same endpoint created a second row');
  assert.equal(row.p256dh, 'p2', 'the row was not updated to the new keys');
});

test('POST /push/unsubscribe only deletes the caller\'s own row', async () => {
  const db = fixture();
  const tokenMe = await tokenFor(ME);
  const tokenOther = await tokenFor(OTHER);
  await app.request('/notifications/push/subscribe', {
    method: 'POST', headers: { Authorization: `Bearer ${tokenMe}`, 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint: 'https://fcm.googleapis.com/fcm/send/mine', keys: { p256dh: 'p', auth: 'a' } }),
  }, env(db));

  // The other user tries to unsubscribe MY endpoint — must be a no-op.
  await app.request('/notifications/push/unsubscribe', {
    method: 'POST', headers: { Authorization: `Bearer ${tokenOther}`, 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint: 'https://fcm.googleapis.com/fcm/send/mine' }),
  }, env(db));
  const stillThere: any = db.prepare(`SELECT COUNT(*) AS n FROM push_subscriptions WHERE endpoint = ?`).get('https://fcm.googleapis.com/fcm/send/mine');
  assert.equal(Number(stillThere.n), 1, "another user's unsubscribe call deleted my subscription");

  await app.request('/notifications/push/unsubscribe', {
    method: 'POST', headers: { Authorization: `Bearer ${tokenMe}`, 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint: 'https://fcm.googleapis.com/fcm/send/mine' }),
  }, env(db));
  const gone: any = db.prepare(`SELECT COUNT(*) AS n FROM push_subscriptions WHERE endpoint = ?`).get('https://fcm.googleapis.com/fcm/send/mine');
  assert.equal(Number(gone.n), 0);
});

test('POST /push/test refuses when VAPID is not configured, rather than claiming nothing was sent', async () => {
  const db = fixture();
  const token = await tokenFor(ME);
  const res = await app.request('/notifications/push/test', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }, env(db));
  assert.equal(res.status, 503);
  const body: any = await res.json();
  assert.equal(body.error, 'push_not_configured');
});

test('POST /push/test with no subscriptions reports why nothing was sent', async () => {
  const db = fixture();
  const token = await tokenFor(ME);
  const res = await app.request('/notifications/push/test', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }, env(db, true));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { sent: 0, failed: 0, reason: 'no_subscriptions' });
});
