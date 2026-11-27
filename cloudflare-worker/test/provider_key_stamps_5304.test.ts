/**
 * D5304 (#5304, D4860 question D = b) — a managed key's expiry and last use.
 *
 * What is pinned:
 *   - an expiry the provider reported (entered on save) is stored and read back
 *     on both the console's list and HQ › Platform's summary; one never
 *     reported reads null, which the page draws as "Not recorded";
 *   - a blank or malformed expiry: blank records none, malformed is refused;
 *   - a key never used reads `last_used_at: null`;
 *   - the last-use write is throttled: a second use within the hour writes
 *     nothing (in this isolate, and through the database's own condition when
 *     another isolate stamped), and a use an hour later writes;
 *   - a Worker-secret key's stamps sit on a row with no key material, which
 *     never reads as a key held in the database;
 *   - a new save resets the old key's stamps; nothing returns a key's value.
 *
 * Real node:sqlite with every migration (`_schema_once.mjs`), the real router.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/provider_key_stamps_5304.test.ts
 */
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

import integrationKeys from '../src/routes/admin_integration_keys.ts';
import {
  _clearLastUsedMemo, _clearOauthCredsCache, markProviderKeyUsed, parseKeyExpiry, readProviderKeyStatus,
  recordProviderKeyExpiry, LAST_USED_STAMP_INTERVAL_MS,
} from '../src/services/providerOauthKeys.ts';
import { readIntegrationKeySummary } from '../src/services/platformSummary.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const HOLDER = 901;

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  db.exec('PRAGMA foreign_keys = OFF');
  db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)').run(HOLDER, 'admin', 'The Holder', 'holder@example.test');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(HOLDER);
  db.prepare("INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, 'totp-holder', 'totp', datetime('now'))").run(HOLDER);
  return db;
}
const CF = { CLOUDFLARE_API_TOKEN: 'cf-token-sentinel', CLOUDFLARE_ACCOUNT_ID: 'acct-1' };
const SLACK_ENV = { SLACK_CLIENT_ID: 'slack-id-sentinel', SLACK_CLIENT_SECRET: 'slack-secret-sentinel' };
const envFor = (db: DatabaseSync, extra: Record<string, unknown> = {}) =>
  ({ JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), RATE_LIMITS: { get: async () => null, put: async () => {}, delete: async () => {} }, ...extra }) as any;

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any) => {
  const url = String(typeof input === 'string' ? input : input?.url);
  if (url.startsWith('https://api.cloudflare.com/')) return new Response(JSON.stringify({ success: true, errors: [], result: {} }), { status: 200 });
  return new Response('unexpected call in test', { status: 599 });
}) as typeof fetch;
process.on('exit', () => { globalThis.fetch = realFetch; });
beforeEach(() => { _clearOauthCredsCache(); });

const app = new Hono<any>();
app.route('/', integrationKeys);
app.onError((err: any, c) => {
  const s = AUTH_ERROR_STATUSES[String(err?.message || '')];
  if (s) return c.json({ detail: err.message }, s);
  throw err;
});
async function call(env: any, method: string, path: string, body?: unknown) {
  const jwt = await new SignJWT({ user_id: HOLDER, role: 'admin', jti: 'totp-holder' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request(path, {
    method, headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env);
  const text = await res.text();
  let json: any = {};
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: json, text };
}
const byKey = (items: any[], k: string) => items.find((p: any) => p.provider_key === k);
const row = (db: DatabaseSync, k: string) => db.prepare('SELECT * FROM provider_oauth_keys WHERE provider_key = ?').get(k) as any;

/* ── expiry ─────────────────────────────────────────────────────────────── */

test('an expiry is a date or blank; anything else is refused', () => {
  assert.equal(parseKeyExpiry('2027-03-01'), '2027-03-01 00:00:00');
  assert.equal(parseKeyExpiry('2027-03-01T12:30:00Z'), '2027-03-01 12:30:00');
  assert.equal(parseKeyExpiry(''), null);
  assert.equal(parseKeyExpiry(undefined), null);
  assert.equal(parseKeyExpiry('next spring'), undefined);
  assert.equal(parseKeyExpiry('2027-13-45'), undefined);
  assert.equal(parseKeyExpiry(20270301), undefined);
});

test('a reported expiry saved with the key is read back on the list and the summary', async () => {
  const db = freshDb();
  const save = await call(envFor(db, CF), 'PUT', '/slack', { client_id: 'new-id', client_secret: 'new-secret', expires_at: '2027-03-01' });
  assert.equal(save.status, 200, save.text);
  const r = row(db, 'slack');
  assert.equal(r.expires_at, '2027-03-01 00:00:00');
  assert.equal(r.client_id, '', 'the stamps row holds no key material');
  assert.equal(r.client_secret_enc, '', 'the stamps row holds no key material');

  // The secret is now a Worker secret: the list and the summary read it there, with its expiry.
  const env = envFor(db, { ...CF, ...SLACK_ENV });
  const list = await call(env, 'GET', '/');
  const slack = byKey(list.body.providers, 'slack');
  assert.equal(slack.state, 'env');
  assert.equal(slack.expires_at, '2027-03-01 00:00:00');
  assert.equal(list.body.stamps_readable, true);
  assert.ok(!list.text.includes('slack-secret-sentinel') && !list.text.includes('new-secret'), 'a key value reached the list');
  const sum: any = await readIntegrationKeySummary(env);
  assert.equal(byKey(sum.items, 'slack').expires_at, '2027-03-01 00:00:00');
  assert.equal(sum.stamps_available, true);
  assert.ok(!JSON.stringify(sum).includes('slack-secret-sentinel'), 'a key value reached the summary');
});

test('an expiry never reported is null, and a malformed one is refused before anything is written', async () => {
  const db = freshDb();
  const save = await call(envFor(db, CF), 'PUT', '/slack', { client_id: 'id', client_secret: 'secret' });
  assert.equal(save.status, 200, save.text);
  assert.equal(row(db, 'slack'), undefined, 'a save with no expiry leaves no row');
  const sum: any = await readIntegrationKeySummary(envFor(db, SLACK_ENV));
  assert.equal(byKey(sum.items, 'slack').expires_at, null);

  const bad = await call(envFor(db, CF), 'PUT', '/slack', { client_id: 'id', client_secret: 'secret', expires_at: 'soon' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'expires_at_invalid');
  const rot = await call(envFor(db, { ...CF, ...SLACK_ENV }), 'POST', '/slack/rotate', { client_secret: 's2', expires_at: 'soon' });
  assert.equal(rot.status, 400);
});

test('an expired key is read back as stored: the expiry in the past is not hidden', async () => {
  const db = freshDb();
  await recordProviderKeyExpiry(envFor(db), 'stripe', '2026-01-01 00:00:00');
  const sum: any = await readIntegrationKeySummary(envFor(db, { STRIPE_CONNECT_CLIENT_ID: 'ca_x', STRIPE_SECRET_KEY: 'sk_x' }));
  assert.equal(byKey(sum.items, 'stripe').expires_at, '2026-01-01 00:00:00');
});

test('a new save or rotate resets the old key\'s stamps', async () => {
  const db = freshDb();
  const env = envFor(db, { ...CF, ...SLACK_ENV });
  await recordProviderKeyExpiry(env, 'slack', '2027-01-01 00:00:00');
  await markProviderKeyUsed(env, 'slack', new Date('2026-11-10T10:00:00Z'));
  assert.ok(row(db, 'slack'));
  const rot = await call(env, 'POST', '/slack/rotate', { client_secret: 'rotated' });
  assert.equal(rot.status, 200, rot.text);
  assert.equal(row(db, 'slack'), undefined, 'the old key\'s expiry and last use outlived it');
});

/* ── where the key lives is unchanged by a stamps row ───────────────────── */

test('a stamps-only row is never a key held in the database', async () => {
  const db = freshDb();
  await markProviderKeyUsed(envFor(db), 'hubspot', new Date('2026-11-10T10:00:00Z'));
  const status = await readProviderKeyStatus(envFor(db));
  const hub = byKey(status.items, 'hubspot');
  assert.equal(hub.source, 'unconfigured', 'a row with no key material read as a held key');
  const sum: any = await readIntegrationKeySummary(envFor(db));
  assert.equal(byKey(sum.items, 'hubspot').state, 'unset');
  assert.equal(byKey(sum.items, 'hubspot').last_used_at, null, 'a provider with no key carries no last use');
  // The console's Remove: a stamps row is not "removed keys".
  const del = await call(envFor(db, CF), 'DELETE', '/hubspot');
  assert.equal(del.status, 200, del.text);
  assert.equal(del.body.removed_keys, false);
  assert.equal(row(db, 'hubspot'), undefined);
});

/* ── last use ────────────────────────────────────────────────────────────── */

test('a key never used reads last_used_at null', async () => {
  const db = freshDb();
  db.prepare("INSERT INTO provider_oauth_keys (provider_key, client_id, client_secret_enc) VALUES ('hubspot', 'hub-id', 'enc')").run();
  const sum: any = await readIntegrationKeySummary(envFor(db));
  const hub = byKey(sum.items, 'hubspot');
  assert.equal(hub.state, 'db');
  assert.equal(hub.last_used_at, null);
  assert.equal(hub.expires_at, null);
});

test('the last-use write: once, then nothing within the hour, then again after it', async () => {
  const db = freshDb();
  db.prepare("INSERT INTO provider_oauth_keys (provider_key, client_id, client_secret_enc) VALUES ('hubspot', 'hub-id', 'enc')").run();
  const env = envFor(db);
  const t0 = new Date('2026-11-10T10:00:00Z');
  assert.equal(await markProviderKeyUsed(env, 'hubspot', t0), true);
  assert.equal(row(db, 'hubspot').last_used_at, '2026-11-10 10:00:00');
  assert.equal(row(db, 'hubspot').client_secret_enc, 'enc', 'the stamp touched the key');

  // A second use within the hour, same isolate: no write, and no statement at all. (The memo is keyed on the
  // binding object, so the count is taken on the same object.)
  let statements = 0;
  const prepare = env.DB.prepare.bind(env.DB);
  env.DB.prepare = (sql: string) => { statements += 1; return prepare(sql); };
  assert.equal(await markProviderKeyUsed(env, 'hubspot', new Date(t0.getTime() + 59 * 60_000)), false);
  assert.equal(statements, 0, 'a use within the hour issued a statement');
  env.DB.prepare = prepare;
  assert.equal(row(db, 'hubspot').last_used_at, '2026-11-10 10:00:00');

  // Another isolate (no memo): the database's own condition writes nothing.
  _clearLastUsedMemo(env);
  assert.equal(await markProviderKeyUsed(env, 'hubspot', new Date(t0.getTime() + 30 * 60_000)), false);
  assert.equal(row(db, 'hubspot').last_used_at, '2026-11-10 10:00:00');

  // An hour later: it writes.
  const t1 = new Date(t0.getTime() + LAST_USED_STAMP_INTERVAL_MS);
  assert.equal(await markProviderKeyUsed(env, 'hubspot', t1), true);
  assert.equal(row(db, 'hubspot').last_used_at, '2026-11-10 11:00:00');
});

test('a Worker-secret key is stamped on a row with no key material', async () => {
  const db = freshDb();
  const env = envFor(db, SLACK_ENV);
  assert.equal(await markProviderKeyUsed(env, 'slack', new Date('2026-11-10T10:00:00Z')), true);
  const r = row(db, 'slack');
  assert.deepEqual([r.client_id, r.client_secret_enc, r.last_used_at], ['', '', '2026-11-10 10:00:00']);
  const sum: any = await readIntegrationKeySummary(env);
  assert.equal(byKey(sum.items, 'slack').state, 'env');
  assert.equal(byKey(sum.items, 'slack').last_used_at, '2026-11-10 10:00:00');
});

test('the stamp never fails its caller, and skips a provider that is not managed', async () => {
  const broken = { DB: { prepare() { throw new Error('D1 is down'); } } } as any;
  assert.equal(await markProviderKeyUsed(broken, 'slack'), false);
  const db = freshDb();
  assert.equal(await markProviderKeyUsed(envFor(db), 'mercury'), false);
  assert.equal(row(db, 'mercury'), undefined);
});

test('stamps that cannot be read are reported unreadable, and every other field stands', async () => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  db.exec('ALTER TABLE provider_oauth_keys DROP COLUMN last_used_at');
  const sum: any = await readIntegrationKeySummary(envFor(db, SLACK_ENV));
  assert.equal(sum.available, true);
  assert.equal(sum.stamps_available, false);
  assert.match(sum.stamps_reason, /could not be read/);
  assert.equal(byKey(sum.items, 'slack').state, 'env');
});
