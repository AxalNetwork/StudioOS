/**
 * D258, 4/4 — A MISTYPED AUTHENTICATOR CODE IS A 400, NEVER A 401.
 *
 * `request()` in frontend/src/lib/api.js reads any 401 from a non-`/auth/` path
 * on a protected page as an expired session: it clears the token and sends the
 * person to /login. Four routes under /api/settings answered a wrong TOTP code
 * with 401, so a typo while setting up, repairing or re-enrolling an
 * authenticator ended the session it was typed in — and the SPA's own
 * `e.code === 'invalid_code'` branch (TotpEnrollment.jsx) could never run.
 *
 * The plan named three routes. Re-measured there were four:
 * /totp/re-enrol/confirm, /totp/enrol/confirm, /totp/repair and
 * /totp/recovery-codes/regenerate. All four are driven here, through the real
 * router, against tables sliced from the baseline — never a SQL-text stub,
 * because "nothing was written" is only worth asserting against a database that
 * could have been written to.
 *
 * Every route is asserted in both directions: the wrong code answers 400 with
 * one shared body and writes nothing; the right code still succeeds and writes
 * what it always wrote. A route that answered 400 to everything would pass the
 * first half and fail the second.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { TOTP, Secret } from 'otpauth';
import { Hono } from 'hono';

import settings from '../src/routes/settings.ts';
import { persistNewTotpEnrolment } from '../src/services/authTotp.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { codeOnly } from './_codeOnly.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-d258-0123456789-abcdef';
const USER = 7258;
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const RECOVERY = read('cloudflare-worker/sql/migrations/277_user_recovery_state.sql');
const SETTINGS_SRC = read('cloudflare-worker/src/routes/settings.ts');

/** One table's CREATE TABLE, verbatim. A literal search, never a built regex. */
function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  const end = BASELINE.indexOf(');', at);
  assert.ok(end > at, `${name}'s definition in the baseline is unterminated`);
  return BASELINE.slice(at, end + 2);
}

function freshDb() {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  for (const t of ['users', 'user_sessions', 'activity_logs', 'auth_totp']) db.exec(ddl(t));
  db.exec(RECOVERY);
  db.prepare(
    `INSERT INTO users (id, role, name, email, email_verified, is_active) VALUES (?, 'founder', 'A Founder', 'totp.d258@example.test', 1, 1)`,
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
  return {
    JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db),
    RATE_LIMITS: kv(), TOKENS: kv(), APP_URL: 'https://app.example.test',
  } as any;
}

function app() {
  const a = new Hono();
  a.route('/api/settings', settings);
  a.onError((err: any, c) => c.json({ detail: String(err?.message || err) }, 500));
  return a;
}

async function bearer() {
  const t = await new SignJWT({ user_id: USER, role: 'founder', email: 'totp.d258@example.test' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  return `Bearer ${t}`;
}

async function post(env: any, path: string, body: unknown) {
  const res = await app().fetch(
    new Request(`http://x/api/settings${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: await bearer() },
      body: JSON.stringify(body),
    }),
    env,
  );
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}

const now = () => Date.now();
const validCode = (secret: string) => new TOTP({ secret: Secret.fromBase32(secret) }).generate({ timestamp: now() });

/** A six-digit code no step within ±2 periods of now would produce. */
function wrongCode(secret: string): string {
  const t = new TOTP({ secret: Secret.fromBase32(secret) });
  const live = new Set([-2, -1, 0, 1, 2].map((k) => t.generate({ timestamp: now() + k * 30_000 })));
  for (let n = 0; n < 1_000_000; n++) {
    const c = String(n).padStart(6, '0');
    if (!live.has(c)) return c;
  }
  throw new Error('unreachable');
}

const one = (db: any, sql: string, ...a: any[]) => db.prepare(sql).get(...a) as any;
const activity = (db: any, action: string) =>
  Number(one(db, 'SELECT COUNT(*) AS n FROM activity_logs WHERE action = ?', action).n);
const totpRow = (db: any) => one(db, 'SELECT secret_ct, recovery_hashes FROM auth_totp WHERE user_id = ?', USER);
const userRow = (db: any) => one(db, 'SELECT jwt_min_iat, totp_recovery_codes FROM users WHERE id = ?', USER);

/** The one refusal every route must send, read off the first route that answers it. */
let SHARED: { error: string; message: string } | null = null;
function assertRefusal(r: { status: number; body: any }, route: string) {
  assert.equal(r.status, 400, `${route}: a wrong code must be 400 — a 401 signs the person out (${JSON.stringify(r.body)})`);
  assert.equal(r.body.error, 'invalid_code', `${route}: the machine code must be invalid_code`);
  assert.equal(typeof r.body.message, 'string', `${route}: the refusal must carry a sentence`);
  assert.ok(/\s/.test(r.body.message), `${route}: the message must be a sentence, not a code`);
  if (!SHARED) SHARED = { error: r.body.error, message: r.body.message };
  assert.deepEqual({ error: r.body.error, message: r.body.message }, SHARED,
    `${route}: every TOTP route must send the same refusal`);
}

async function enrolled() {
  const db = freshDb();
  const env = envFor(db);
  const secret = new Secret().base32;
  await persistNewTotpEnrolment(env, USER, secret, ['hash-of-an-old-code']);
  return { db, env, secret };
}

test('/totp/repair: a wrong code is 400 invalid_code and the enrolment is untouched', async () => {
  const { db, env, secret } = await enrolled();
  const beforeTotp = totpRow(db);
  const beforeUser = userRow(db);
  const r = await post(env, '/totp/repair', { totp_code: wrongCode(secret) });
  assertRefusal(r, '/totp/repair');
  assert.deepEqual(totpRow(db), beforeTotp, 'a refused repair re-paired the authenticator');
  assert.deepEqual(userRow(db), beforeUser, 'a refused repair moved the session floor');
  assert.equal(activity(db, 'totp_repaired'), 0);
});

test('/totp/repair: the right code still repairs', async () => {
  const { db, env, secret } = await enrolled();
  const before = totpRow(db).secret_ct;
  const r = await post(env, '/totp/repair', { totp_code: validCode(secret) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.ok, true);
  assert.notEqual(totpRow(db).secret_ct, before, 'the repair stored no new secret');
  assert.equal(activity(db, 'totp_repaired'), 1);
});

test('/totp/recovery-codes/regenerate: a wrong code is 400 invalid_code and the codes stand', async () => {
  const { db, env, secret } = await enrolled();
  const before = userRow(db);
  const r = await post(env, '/totp/recovery-codes/regenerate', { totp_code: wrongCode(secret) });
  assertRefusal(r, '/totp/recovery-codes/regenerate');
  assert.deepEqual(userRow(db), before, 'a refused regenerate replaced the recovery codes');
  assert.equal(activity(db, 'totp_recovery_codes_regenerated'), 0);
});

test('/totp/recovery-codes/regenerate: the right code still regenerates', async () => {
  const { db, env, secret } = await enrolled();
  const before = userRow(db).totp_recovery_codes;
  const r = await post(env, '/totp/recovery-codes/regenerate', { totp_code: validCode(secret) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.codes.length, 10);
  assert.notEqual(userRow(db).totp_recovery_codes, before);
  assert.equal(activity(db, 'totp_recovery_codes_regenerated'), 1);
});

test('/totp/enrol/confirm: a wrong code is 400 invalid_code and nothing is enrolled', async () => {
  const db = freshDb();
  const env = envFor(db);
  const secret = new Secret().base32;
  const r = await post(env, '/totp/enrol/confirm', { totp_secret: secret, totp_code: wrongCode(secret) });
  assertRefusal(r, '/totp/enrol/confirm');
  assert.equal(totpRow(db), undefined, 'a refused enrolment stored a secret');
  assert.equal(activity(db, 'totp_enrolled'), 0);
});

test('/totp/enrol/confirm: the right code still enrols', async () => {
  const db = freshDb();
  const env = envFor(db);
  const secret = new Secret().base32;
  const r = await post(env, '/totp/enrol/confirm', { totp_secret: secret, totp_code: validCode(secret) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(totpRow(db), 'the enrolment stored nothing');
  assert.equal(activity(db, 'totp_enrolled'), 1);
});

for (const [label, due] of [['inside the step-up window', "datetime('now', '+2 days')"],
  ['past the step-up deadline (relocked)', "datetime('now', '-1 hour')"]] as const) {
  test(`/totp/re-enrol/confirm ${label}: a wrong code is 400 invalid_code and the deadline stands`, async () => {
    const db = freshDb();
    const env = envFor(db);
    db.exec(`INSERT INTO user_recovery_state (user_id, step_up_due_at) VALUES (${USER}, ${due})`);
    const dueBefore = one(db, 'SELECT step_up_due_at FROM user_recovery_state WHERE user_id = ?', USER).step_up_due_at;
    const floorBefore = userRow(db).jwt_min_iat;
    const secret = new Secret().base32;
    const r = await post(env, '/totp/re-enrol/confirm', { totp_secret: secret, totp_code: wrongCode(secret) });
    assertRefusal(r, `/totp/re-enrol/confirm (${label})`);
    assert.equal(one(db, 'SELECT step_up_due_at FROM user_recovery_state WHERE user_id = ?', USER).step_up_due_at,
      dueBefore, 'a refused re-enrolment cleared the step-up deadline');
    assert.equal(userRow(db).jwt_min_iat, floorBefore);
    assert.equal(totpRow(db), undefined);
    assert.equal(activity(db, 'totp_reenrolled_post_recovery'), 0);
  });
}

test('/totp/re-enrol/confirm: the right code still re-enrols and clears the deadline', async () => {
  const db = freshDb();
  const env = envFor(db);
  db.exec(`INSERT INTO user_recovery_state (user_id, step_up_due_at) VALUES (${USER}, datetime('now', '+2 days'))`);
  const secret = new Secret().base32;
  const r = await post(env, '/totp/re-enrol/confirm', { totp_secret: secret, totp_code: validCode(secret) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(one(db, 'SELECT step_up_due_at FROM user_recovery_state WHERE user_id = ?', USER).step_up_due_at, null);
  assert.ok(totpRow(db));
  assert.equal(activity(db, 'totp_reenrolled_post_recovery'), 1);
});

test('settings.ts answers no refusal with 401 — the SPA reads that status as a sign-out', () => {
  // requireAuth's own 401 is thrown, not returned, so every `, 401)` left in the
  // file would be a handler choosing to sign the person out.
  assert.doesNotMatch(codeOnly(SETTINGS_SRC), /,\s*401\s*\)/);
});
