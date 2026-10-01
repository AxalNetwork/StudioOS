/**
 * D433 — the Account page's "Authenticator app" row reads WHEN the factor was
 * paired, and the worker now serves it.
 *
 * `auth_totp.created_at` has existed since the table did, stamped on every
 * enrolment and re-pair by `persistNewTotpEnrolment`; nothing served it. The
 * root settings payload and GET /settings/security both carry it now as
 * `totp_paired_at`: the row's own timestamp when an authenticator is
 * configured, and null when none is — an unpaired account has no date, and
 * the page must not print one.
 *
 * Real SQLite through the real router; the harness is D430's.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Secret } from 'otpauth';
import { Hono } from 'hono';

import settings from '../src/routes/settings.ts';
import { persistNewTotpEnrolment, loadTotpPairedAt } from '../src/services/authTotp.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { codeOnly } from './_codeOnly.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-d433-0123456789-abcdef';
const USER = 7433;
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const RECOVERY = read('cloudflare-worker/sql/migrations/277_user_recovery_state.sql');
const SETTINGS_SRC = codeOnly(read('cloudflare-worker/src/routes/settings.ts'));

function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  const end = BASELINE.indexOf(');', at);
  return BASELINE.slice(at, end + 2);
}

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'user_sessions', 'activity_logs', 'auth_totp', 'email_change_requests']) db.exec(ddl(t));
  db.exec(RECOVERY);
  db.prepare(
    `INSERT INTO users (id, role, name, email, email_verified, is_active) VALUES (?, 'founder', 'A Founder', 'totp.d433@example.test', 1, 1)`,
  ).run(USER);
  return db;
}

function kv() {
  const m = new Map<string, string>();
  return {
    async get(k: string) { return m.has(k) ? m.get(k)! : null; },
    async put(k: string, v: string) { m.set(k, v); },
    async delete(k: string) { m.delete(k); },
  };
}

function envFor(db: any) {
  return { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), RATE_LIMITS: kv(), TOKENS: kv(), APP_URL: 'https://app.example.test' } as any;
}

function app() {
  const a = new Hono();
  a.route('/api/settings', settings);
  a.onError((err: any, c) => c.json({ detail: String(err?.message || err) }, 500));
  return a;
}

async function bearer() {
  const t = await new SignJWT({ user_id: USER, role: 'founder', email: 'totp.d433@example.test' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  return `Bearer ${t}`;
}

async function get(env: any, path: string) {
  const res = await app().fetch(
    new Request(`http://x/api/settings${path}`, { headers: { Authorization: await bearer() } }),
    env,
  );
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}

const one = (db: any, sql: string, ...a: any[]) => db.prepare(sql).get(...a) as any;

test('D433: an unpaired account is served totp_paired_at: null on both payloads', async () => {
  const db = freshDb();
  const env = envFor(db);
  const root = await get(env, '');
  assert.equal(root.status, 200, JSON.stringify(root.body));
  assert.equal(root.body.totp_configured, false);
  assert.equal(root.body.totp_paired_at, null);
  assert.ok('totp_paired_at' in root.body, 'the key is present, as null — a page must not mistake absence for an old payload');
  const sec = await get(env, '/security');
  assert.equal(sec.status, 200, JSON.stringify(sec.body));
  assert.equal(sec.body.totp_configured, false);
  assert.equal(sec.body.totp_paired_at, null);
});

test('D433: once paired, both payloads serve the enrolment row\'s own created_at', async () => {
  const db = freshDb();
  const env = envFor(db);
  await persistNewTotpEnrolment(env, USER, new Secret().base32, []);
  const stamped = one(db, 'SELECT created_at FROM auth_totp WHERE user_id = ?', USER)?.created_at;
  assert.ok(stamped, 'the enrolment did not stamp created_at');

  const root = await get(env, '');
  assert.equal(root.status, 200, JSON.stringify(root.body));
  assert.equal(root.body.totp_configured, true);
  assert.equal(root.body.totp_paired_at, stamped);
  const sec = await get(env, '/security');
  assert.equal(sec.body.totp_configured, true);
  assert.equal(sec.body.totp_paired_at, stamped);
});

test('D433: a re-pair moves the date — the row reads the CURRENT authenticator\'s pairing', async () => {
  const db = freshDb();
  const env = envFor(db);
  await persistNewTotpEnrolment(env, USER, new Secret().base32, []);
  // Backdate the first enrolment so the second is visibly later.
  db.prepare(`UPDATE auth_totp SET created_at = '2020-01-01 00:00:00' WHERE user_id = ?`).run(USER);
  assert.equal(await loadTotpPairedAt(env, USER), '2020-01-01 00:00:00');
  await persistNewTotpEnrolment(env, USER, new Secret().base32, []);
  const after = await loadTotpPairedAt(env, USER);
  assert.notEqual(after, '2020-01-01 00:00:00', 'the re-pair did not restamp created_at');
  assert.equal((await get(env, '')).body.totp_paired_at, after);
});

test('D433: the service reads auth_totp.created_at and nothing else; the routes read it only when configured', () => {
  const svc = codeOnly(read('cloudflare-worker/src/services/authTotp.ts'));
  const fn = svc.slice(svc.indexOf('export async function loadTotpPairedAt'), svc.indexOf('export async function loadTotp('));
  assert.ok(fn.length > 100, 'loadTotpPairedAt could not be sliced');
  assert.match(fn, /SELECT created_at FROM auth_totp WHERE user_id = \?/);
  assert.match(fn, /return row\?\.created_at \?\? null;/);
  // Both payloads gate the read on totp_configured: no stamp for an unpaired account.
  assert.equal((SETTINGS_SRC.match(/totp_configured\s*\?\s*await loadTotpPairedAt\(c\.env, user\.id\)\s*:\s*null/g) || []).length, 2,
    'the root payload and /security each read the date only when a factor is configured');
  assert.equal((SETTINGS_SRC.match(/totp_paired_at: totpPairedAt,/g) || []).length, 2);
});
