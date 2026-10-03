/**
 * D334 — three fixes from a Codex review:
 *
 *   1. `isAllowedPushEndpoint` — `/push/subscribe` used to accept any
 *      non-empty string as `endpoint`, and `/push/test` then did a
 *      server-side `fetch()` to it: an authenticated client could persist
 *      an arbitrary URL and get this Worker to make outbound POSTs to it
 *      on demand. Validated at the one place a row is ever written.
 *      A follow-up review ran the first (blocklist) fix against real
 *      attack shapes and found several still got through — see the
 *      allowlist test below. It is now an allowlist of the four browser
 *      push vendors' hostnames instead.
 *   2. `sendWebPush` parsed `sub.endpoint` with `new URL()` BEFORE its own
 *      try block, so a malformed stored endpoint threw uncaught instead of
 *      returning the same `{ok:false, ...}` shape every other failure in
 *      the function does.
 *   3. `notify()` built the push routes and the RFC 8291 sender in D334/D335
 *      but never called `sendWebPush` from the actual notification
 *      dispatcher — enabling push only ever produced the manual /push/test
 *      ping; a real notification never reached a subscribed device.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/push_security_fixes_d334.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import { isAllowedPushEndpoint, sendWebPush } from '../src/services/webpush.ts';
import { notify } from '../src/services/notify.ts';
import notifications from '../src/routes/notifications.ts';
import { d1Over } from './_d1_sqlite.mjs';

// ---------------------------------------------------------------------------
// 1. isAllowedPushEndpoint
// ---------------------------------------------------------------------------

test('isAllowedPushEndpoint accepts an ordinary https push-service URL', () => {
  assert.equal(isAllowedPushEndpoint('https://fcm.googleapis.com/fcm/send/abc123'), true);
});

test('isAllowedPushEndpoint rejects non-https, malformed, and private/loopback hosts', () => {
  assert.equal(isAllowedPushEndpoint('http://push.example/x'), false, 'plain http');
  assert.equal(isAllowedPushEndpoint('not a url'), false, 'unparseable');
  assert.equal(isAllowedPushEndpoint(''), false, 'empty');
  assert.equal(isAllowedPushEndpoint('https://localhost/x'), false, 'localhost');
  assert.equal(isAllowedPushEndpoint('https://127.0.0.1/x'), false, 'IPv4 loopback');
  assert.equal(isAllowedPushEndpoint('https://10.0.0.5/x'), false, 'RFC1918 10.x');
  assert.equal(isAllowedPushEndpoint('https://192.168.1.1/x'), false, 'RFC1918 192.168.x');
  assert.equal(isAllowedPushEndpoint('https://172.20.0.1/x'), false, 'RFC1918 172.16-31.x');
  assert.equal(isAllowedPushEndpoint('https://169.254.169.254/latest/meta-data'), false, 'link-local / cloud metadata');
  assert.equal(isAllowedPushEndpoint('https://[::1]/x'), false, 'IPv6 loopback');
  assert.equal(isAllowedPushEndpoint('https://foo.internal/x'), false, '.internal');
  assert.equal(isAllowedPushEndpoint('https://' + 'a'.repeat(2001)), false, 'too long');
});

// A second Codex review ran the blocklist fix above against real attack
// shapes and found every one of these still got through: private/link-local
// IPv6 the literal check never covered, loopback written as an IPv4-mapped
// IPv6 literal (which the v4 regex can't see), carrier-grade NAT (RFC 6598,
// outside the blocked ranges), and plainly any public host that isn't a push
// service at all. The fix is an allowlist of the real push vendors' hosts
// instead of trying to keep enumerating what to block.
test('isAllowedPushEndpoint rejects every host from the follow-up review\'s attack list', () => {
  assert.equal(isAllowedPushEndpoint('https://[fd00::1]/'), false, 'private IPv6 (ULA)');
  assert.equal(isAllowedPushEndpoint('https://[fe80::1]/'), false, 'link-local IPv6');
  assert.equal(isAllowedPushEndpoint('https://[::ffff:127.0.0.1]/'), false, 'loopback as IPv4-mapped IPv6');
  assert.equal(isAllowedPushEndpoint('https://100.64.0.1/'), false, 'carrier-grade NAT (RFC 6598)');
  assert.equal(isAllowedPushEndpoint('https://example.com/anything'), false, 'public host, not a push service');
});

test('isAllowedPushEndpoint still allows a real fcm.googleapis.com endpoint', () => {
  assert.equal(isAllowedPushEndpoint('https://fcm.googleapis.com/fcm/send/abc123'), true);
});

test('isAllowedPushEndpoint allows the other three browser push vendors', () => {
  assert.equal(isAllowedPushEndpoint('https://android.googleapis.com/gcm/send/abc'), true);
  assert.equal(isAllowedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/abc'), true);
  assert.equal(isAllowedPushEndpoint('https://abc123.notify.windows.com/w/abc'), true);
  assert.equal(isAllowedPushEndpoint('https://web.push.apple.com/abc'), true);
});

test('isAllowedPushEndpoint does not allow a host that merely contains an allowed suffix', () => {
  // A suffix check without a leading-dot anchor would let
  // "push.services.mozilla.com.attacker.example" (the allowed string as a
  // PREFIX of an attacker-controlled host) or "notpush.services.mozilla.com"
  // (the allowed string missing its leading dot) through. The suffixes are
  // all stored with a leading dot precisely so `endsWith` requires it.
  assert.equal(isAllowedPushEndpoint('https://push.services.mozilla.com.attacker.example/x'), false);
  assert.equal(isAllowedPushEndpoint('https://notpush.services.mozilla.com/x'), false);
  assert.equal(isAllowedPushEndpoint('https://real.push.services.mozilla.com/x'), true, 'a genuine subdomain still works');
});

// ---------------------------------------------------------------------------
// 2. sendWebPush no longer throws uncaught on a malformed endpoint
// ---------------------------------------------------------------------------

test('sendWebPush returns a failure shape, not a throw, for a malformed endpoint', async () => {
  const result = await sendWebPush(
    { VAPID_PUBLIC_KEY: 'x', VAPID_PRIVATE_KEY: 'x' } as any,
    { endpoint: 'not a url at all', p256dh: 'x', auth: 'x' },
    { title: 'x' },
  );
  assert.equal(result.ok, false);
  assert.equal((result as any).error, 'invalid_endpoint');
});

// ---------------------------------------------------------------------------
// 3. /push/subscribe rejects a disallowed endpoint and a subscription-count cap
// ---------------------------------------------------------------------------

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ME = 31;

function routeFixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
                        jwt_min_iat INTEGER, name TEXT, email TEXT);`);
  db.prepare("INSERT INTO users (id, role, name, email) VALUES (?, 'founder', 'Rae', 'rae@axal.example')").run(ME);
  return db;
}
const app = new Hono<any>();
app.route('/notifications', notifications);
async function tokenFor(userId: number) {
  return new SignJWT({ user_id: userId, role: 'founder' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

test('POST /push/subscribe rejects a non-https / private-host endpoint', async () => {
  const db = routeFixture();
  const token = await tokenFor(ME);
  const res = await app.request('/notifications/push/subscribe', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint: 'http://169.254.169.254/latest/meta-data', keys: { p256dh: 'p', auth: 'a' } }),
  }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) });
  assert.equal(res.status, 422);
  const row: any = db.prepare(`SELECT COUNT(*) AS n FROM push_subscriptions`).get();
  assert.equal(Number(row?.n ?? 0), 0, 'the disallowed endpoint must not have been written');
});

test('POST /push/subscribe caps live subscriptions per account', async () => {
  const db = routeFixture();
  const token = await tokenFor(ME);
  const env: any = { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) };
  // The allowlist added for the follow-up SSRF review only looks at the
  // host, so distinct paths on a real push vendor's host are still 20
  // distinct endpoints for this cap.
  for (let i = 0; i < 20; i++) {
    const res = await app.request('/notifications/push/subscribe', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: `https://fcm.googleapis.com/fcm/send/${i}`, keys: { p256dh: 'p', auth: 'a' } }),
    }, env);
    assert.equal(res.status, 200, `subscription ${i} should have been accepted`);
  }
  const res21 = await app.request('/notifications/push/subscribe', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint: 'https://fcm.googleapis.com/fcm/send/one-too-many', keys: { p256dh: 'p', auth: 'a' } }),
  }, env);
  assert.equal(res21.status, 429, 'the 21st distinct subscription should have been capped');
});

// ---------------------------------------------------------------------------
// 4. notify() actually fans out to a subscribed device, not just /push/test
// ---------------------------------------------------------------------------

function notifyFixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, notification_prefs TEXT);
    CREATE TABLE push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
      endpoint TEXT NOT NULL UNIQUE, p256dh TEXT NOT NULL, auth TEXT NOT NULL
    );
  `);
  db.prepare(`INSERT INTO users (id, email) VALUES (?, 'rae@axal.example')`).run(ME);
  return db;
}

test('notify() sends a real web push to a subscribed device', async (t) => {
  const db = notifyFixture();
  const subKeyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', subKeyPair.publicKey) as ArrayBuffer);
  const b64url = (b: Uint8Array) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  db.prepare(`INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)`)
    .run(ME, 'https://push.example/device', b64url(pub), b64url(crypto.getRandomValues(new Uint8Array(16))));

  let pushedTo: string | null = null;
  const originalFetch = globalThis.fetch;
  t.after(() => { (globalThis as any).fetch = originalFetch; });
  (globalThis as any).fetch = async (url: string) => {
    if (String(url) === 'https://push.example/device') { pushedTo = String(url); }
    return new Response(null, { status: 201 });
  };

  const vapidPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']) as CryptoKeyPair;
  const vapidPub = new Uint8Array(await crypto.subtle.exportKey('raw', vapidPair.publicKey) as ArrayBuffer);
  const vapidJwk = await crypto.subtle.exportKey('jwk', vapidPair.privateKey) as JsonWebKey;

  await notify(
    { ENVIRONMENT: 'development', DB: d1Over(db), VAPID_PUBLIC_KEY: b64url(vapidPub), VAPID_PRIVATE_KEY: vapidJwk.d } as any,
    { userId: ME, type: 'score_generated', title: 'New score', category: 'scoring', channels: ['in_app'] },
  );

  assert.equal(pushedTo, 'https://push.example/device', 'notify() never reached the subscribed device at all');
});

// ---------------------------------------------------------------------------
// 5. The push fan-out runs concurrently and is bounded by a timeout
// ---------------------------------------------------------------------------

async function subscriberKeys() {
  const subKeyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', subKeyPair.publicKey) as ArrayBuffer);
  const b64url = (b: Uint8Array) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return { p256dh: b64url(pub), auth: b64url(crypto.getRandomValues(new Uint8Array(16))) };
}

async function vapidEnv(extra: Record<string, unknown> = {}) {
  const vapidPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']) as CryptoKeyPair;
  const vapidPub = new Uint8Array(await crypto.subtle.exportKey('raw', vapidPair.publicKey) as ArrayBuffer);
  const vapidJwk = await crypto.subtle.exportKey('jwk', vapidPair.privateKey) as JsonWebKey;
  return { VAPID_PUBLIC_KEY: Buffer.from(vapidPub).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), VAPID_PRIVATE_KEY: vapidJwk.d, ...extra };
}

test('notify() sends to multiple subscriptions concurrently, not one at a time', async (t) => {
  // Codex review (P2): the fan-out loop used to `await` each send in turn.
  // Three subscriptions each held for 150ms would take ~450ms sequentially
  // but should take ~150ms run concurrently — the gap between those two
  // numbers is exactly what distinguishes the two implementations.
  const db = notifyFixture();
  for (let i = 0; i < 3; i++) {
    const keys = await subscriberKeys();
    db.prepare(`INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)`)
      .run(ME, `https://fcm.googleapis.com/fcm/send/${i}`, keys.p256dh, keys.auth);
  }
  const DELAY_MS = 150;
  const originalFetch = globalThis.fetch;
  t.after(() => { (globalThis as any).fetch = originalFetch; });
  (globalThis as any).fetch = async () => {
    await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    return new Response(null, { status: 201 });
  };
  const env: any = await vapidEnv({ ENVIRONMENT: 'development', DB: d1Over(db) });
  const startedAt = Date.now();
  await notify(env, { userId: ME, type: 'score_generated', title: 'New score', category: 'scoring', channels: ['in_app'] });
  const elapsed = Date.now() - startedAt;
  assert.ok(
    elapsed < DELAY_MS * 2,
    `3 subscriptions at ${DELAY_MS}ms each took ${elapsed}ms — sequential would be ~${DELAY_MS * 3}ms, concurrent should be close to ${DELAY_MS}ms`,
  );
});

test('notify() does not hang forever on a push service that never responds', async (t) => {
  // One endpoint's fetch never resolves at all. The send must be bounded by
  // the fan-out's own timeout, not left to hang notify() — and a request
  // handler, not just this test, is what would otherwise be stuck waiting.
  const db = notifyFixture();
  const hungKeys = await subscriberKeys();
  db.prepare(`INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)`)
    .run(ME, 'https://fcm.googleapis.com/fcm/send/hung', hungKeys.p256dh, hungKeys.auth);
  const okKeys = await subscriberKeys();
  db.prepare(`INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)`)
    .run(ME, 'https://fcm.googleapis.com/fcm/send/ok', okKeys.p256dh, okKeys.auth);

  let okPushed = false;
  const originalFetch = globalThis.fetch;
  t.after(() => { (globalThis as any).fetch = originalFetch; });
  (globalThis as any).fetch = async (url: string) => {
    if (String(url).endsWith('/hung')) return new Promise(() => { /* never resolves */ });
    if (String(url).endsWith('/ok')) { okPushed = true; return new Response(null, { status: 201 }); }
    throw new Error(`unexpected fetch: ${url}`);
  };
  const env: any = await vapidEnv({ ENVIRONMENT: 'development', DB: d1Over(db) });
  const startedAt = Date.now();
  await notify(env, { userId: ME, type: 'score_generated', title: 'New score', category: 'scoring', channels: ['in_app'] });
  const elapsed = Date.now() - startedAt;
  assert.ok(elapsed < 6000, `notify() took ${elapsed}ms — a hung push send must be bounded by its own timeout (5s), not left open`);
  assert.equal(okPushed, true, 'the other, responsive subscription must still receive its push despite the hung one');
}, { timeout: 8000 });
