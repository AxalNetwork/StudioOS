/**
 * D236 — the admin drawer's authenticator line reads the definition sign-in
 * uses, and a failed read is not "No".
 *
 * WHAT WAS WRONG. `GET /api/admin/users/:user_id/profile` returned
 * `totp_enabled: false` under the comment "placeholder — wire to actual TOTP
 * table when added", and the drawer's KYC tab printed it as "TOTP enabled:
 * No" for EVERY account. The table was added long ago: enrolment lives in
 * `auth_totp`, and `/login` asks `hasTotpConfigured(env, userId)` — an
 * `auth_totp` row, or a legacy base32 secret still parked in
 * `users.password_hash`. So HQ, on the screen it supervises accounts from, was
 * told that accounts which DO have a second factor did not.
 *
 * WHAT THIS DRIVES. The real route, through the real admin router, over the
 * database a fresh deployment builds — `schema_baseline.sql` plus every
 * post-cutoff migration, the build `check-baseline-drift` and deploy step 9
 * compare against production. So the users table has its production shape,
 * `auth_totp` is the production table, and nothing here is a hand-written
 * narrower copy of either.
 *
 * FOUR ACCOUNTS, FOUR ANSWERS:
 *   - enrolled through `auth_totp`                 → true
 *   - never enrolled                               → false
 *   - a legacy base32 secret, not yet migrated     → true (the half of the
 *     definition a placeholder, or a one-table check, would miss)
 *   - the enrolment store cannot be read           → null, with a reason, and
 *     the rest of the record still loads
 *
 * THE FAILED READ IS A REAL SQLITE FAILURE, NOT A STUB. `auth_totp` is
 * replaced by a table with no `user_id` column, so the helper's own SELECT
 * fails to prepare exactly as it would against a mis-shaped or unreachable
 * store. (A MISSING table would not do it: the helper's bootstrap creates
 * `auth_totp` when it is absent, and the honest answer is then "No" — nobody
 * can have enrolled in a table that did not exist. The legacy half is still
 * read, and the legacy case below proves it.)
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/admin_profile_totp_d236.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import admin from '../src/routes/admin.ts';
import { hasTotpConfigured } from '../src/services/authTotp.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { buildFresh, postCutoffMigrations } from '../../scripts/check-baseline-drift.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const LATER = (postCutoffMigrations(ROOT) as Array<{ sql: string }>).map((m) => m.sql);

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const HOLDER = 1;     // the one Super Admin — may open any record
const ENROLLED = 10;  // an auth_totp row
const PLAIN = 11;     // no authenticator of any kind
const LEGACY = 12;    // a base32 secret still in users.password_hash
/** 32 characters of the base32 alphabet — the shape `BASE32_RE` accepts. */
const LEGACY_BASE32 = 'AB'.repeat(16);

/**
 * `app.onError` lives in index.ts and is not in the chain for a directly
 * dispatched sub-app, so the two auth refusals the route can throw are mapped
 * here; anything else surfaces as the 500 it would be.
 */
function appFor(router: any) {
  const a = new Hono<any>();
  a.route('/', router);
  a.onError((err: any, c) => {
    const msg = String(err?.message || '');
    if (msg === 'Unauthorized') return c.json({ detail: msg }, 401);
    if (msg === 'Admin required') return c.json({ detail: msg }, 403);
    return c.json({ detail: msg }, 500);
  });
  return a;
}
const app = appFor(admin);

function freshDb() {
  const db = buildFresh(BASELINE, LATER);
  const user = db.prepare('INSERT INTO users (id, email, name, role, email_verified) VALUES (?, ?, ?, ?, 1)');
  user.run(HOLDER, 'hq@axal.example', 'Hana', 'admin');
  user.run(ENROLLED, 'enrolled@example.com', 'Ed', 'founder');
  user.run(PLAIN, 'plain@example.com', 'Pia', 'founder');
  user.run(LEGACY, 'legacy@example.com', 'Lee', 'founder');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(LEGACY_BASE32, LEGACY);
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(HOLDER);
  // The presence of the row is the whole fact; the ciphertext is never read
  // by the presence check, so any non-empty value stands in for it.
  db.prepare('INSERT INTO auth_totp (user_id, secret_ct) VALUES (?, ?)').run(ENROLLED, 'ct');
  db.prepare(
    `INSERT INTO user_sessions (user_id, jti, factor, assurance_level)
     VALUES (?, 'totp-holder', 'totp', 'full')`,
  ).run(HOLDER);
  return db;
}

const envOver = (db: any) => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) });

async function holderToken(): Promise<string> {
  return new SignJWT({ user_id: HOLDER, role: 'admin', jti: 'totp-holder' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function profile(env: any, userId: number): Promise<{ status: number; body: any }> {
  const res = await app.request(
    `/users/${userId}/profile`,
    { headers: { Authorization: `Bearer ${await holderToken()}` } },
    env,
  );
  let body: any = null;
  try { body = await res.json(); } catch { /* empty */ }
  return { status: res.status, body };
}

test('D236: an account enrolled through auth_totp reads as enrolled', async () => {
  const { status, body } = await profile(envOver(freshDb()), ENROLLED);
  assert.equal(status, 200, `the profile did not load: ${JSON.stringify(body)}`);
  assert.equal(body.kyc.totp_enabled, true,
    'an enrolled account was reported as having no authenticator — the placeholder is back');
  assert.equal(body.kyc.totp_reason, null, 'an answer carried an unreadable reason');
});

test('D236: an account with no authenticator reads as not enrolled — a measured No', async () => {
  const { status, body } = await profile(envOver(freshDb()), PLAIN);
  assert.equal(status, 200);
  assert.equal(body.kyc.totp_enabled, false);
  assert.equal(body.kyc.totp_reason, null);
});

test('D236: a legacy base32 secret counts, as it does at sign-in', async () => {
  // The half of the definition a one-table check would miss: `/login` accepts
  // this account's authenticator, so the drawer must not say it has none.
  const db = freshDb();
  const { status, body } = await profile(envOver(db), LEGACY);
  assert.equal(status, 200);
  assert.equal(body.kyc.totp_enabled, true,
    'the drawer disagrees with sign-in about an account whose secret has not migrated yet');
  const stillLegacy = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(LEGACY) as any;
  assert.equal(stillLegacy.password_hash, LEGACY_BASE32,
    'reading the drawer migrated the secret — only sign-in may do that');
});

test('D236: the drawer and sign-in give the same answer for every account', async () => {
  // One definition, asked two ways: through the route, and directly.
  const db = freshDb();
  const env = envOver(db);
  for (const id of [ENROLLED, PLAIN, LEGACY]) {
    const { body } = await profile(env, id);
    assert.equal(body.kyc.totp_enabled, await hasTotpConfigured(env as any, id),
      `user ${id}: the drawer and the sign-in check disagree`);
  }
});

test('D236: an unreadable enrolment store is null with its reason — never "No" — and the record still loads', async () => {
  const db = freshDb();
  // A table the helper's SELECT cannot be prepared against. `CREATE TABLE IF
  // NOT EXISTS` in the helper's bootstrap leaves it alone, so the read fails
  // for real, the way it would against a store that did not answer.
  db.exec('DROP TABLE auth_totp');
  db.exec('CREATE TABLE auth_totp (id INTEGER PRIMARY KEY, secret_ct TEXT)');
  const { status, body } = await profile(envOver(db), PLAIN);
  assert.equal(status, 200,
    'a failed authenticator read took the whole record down; it is caught on its own');
  assert.equal(body.kyc.totp_enabled, null,
    'a read that failed was reported as an answer — a failed read is not "No"');
  assert.equal(typeof body.kyc.totp_reason, 'string');
  assert.match(body.kyc.totp_reason, /unknown/);
  assert.match(body.kyc.totp_reason, /not the same as "No"/);
  // The rest of the record is unaffected by the one field that failed.
  assert.equal(body.user.id, PLAIN);
  assert.equal(body.kyc.status, 'not_started');
  assert.ok(Array.isArray(body.activity) && Array.isArray(body.timeline),
    'the rest of the record did not load beside the failed field');
});

test('D236: the payload carries no hard-coded authenticator answer', () => {
  // A placeholder literal is the defect this replaced. Comments are stripped
  // first: the route's own comment quotes the old line to explain it.
  const code = read('cloudflare-worker/src/routes/admin.ts')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.doesNotMatch(code, /totp_enabled:\s*(?:true|false|0|1)\b/,
    'the profile payload hard-codes totp_enabled again');
  assert.match(code, /totpEnabled = await hasTotpConfigured\(c\.env, userId\)/,
    'the profile route no longer reads the definition sign-in uses');
  assert.match(code, /totp_enabled: totpEnabled,\s*totp_reason: totpReason,/);
});
