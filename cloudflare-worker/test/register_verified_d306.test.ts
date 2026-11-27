/**
 * D306 — /register refuses every VERIFIED account, whatever it signs in with.
 *
 * THE DEFECT. `POST /api/auth/register` is unauthenticated: Turnstile, no
 * session. Its existing-account branch refused a row only when it was
 * `email_verified` AND had an authenticator (`hasTotpConfigured`). Every other
 * existing row took the incomplete-signup path: `UPDATE users SET name = <the
 * body's>, role = 'exploring'`, the body's lane over the suggested role, a
 * spin-out flag, an embed job and a fresh verification email. Magic-link and
 * Google members never enrol TOTP, so anyone holding such a member's address
 * could rename them and send them back to the review queue. Measured read-only
 * on 2026-09-27: 27 production accounts exposed, 24 of 26 partners and 3 of 8
 * founders; both admins have TOTP.
 *
 * THE RULE. An unauthenticated request may only overwrite an account whose
 * email has never been proven. Verified → 409, and nothing is written.
 * Unverified → the path, exactly as it was.
 *
 * HOW IT IS DRIVEN. The real `routes/auth.ts` over HTTP, against a real
 * `node:sqlite` database sliced from `schema_baseline.sql` that holds every
 * table the path writes — so each side effect the old path had is a row that
 * appears or does not, and the account's whole state is compared before and
 * after rather than a column or two.
 *
 * Turnstile passes the way the other route tests pass it: no secret outside
 * production, so `verifyTurnstile` fails open — the state an attacker reaches
 * in production with one solved challenge. The Gmail credentials are dummies
 * and `fetch` is swapped, for each request, for a recorder that refuses, so a
 * verification send shows up as rows AND as a recorded call to Google's token
 * endpoint, and nothing leaves the process. Test (c) proves the recorder does
 * see a real send, so its silence in (a) and (b) is a measurement rather than
 * a missing instrument.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Secret } from 'otpauth';

import auth from '../src/routes/auth.ts';
import { hasTotpConfigured, persistNewTotpEnrolment } from '../src/services/authTotp.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import { codeOnly } from './_codeOnly.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');

const JWT_SECRET = 'unit-test-jwt-secret-d306-0123456789-abcdef';

// A partner who signs in by magic link: verified, approved, no authenticator —
// the shape of 24 of the 27 exposed production accounts.
const MAGIC_MEMBER = 3061;
const MAGIC_EMAIL = 'partner.magic.d306@example.test';
// A founder who enrolled an authenticator: refused before this change too.
const TOTP_MEMBER = 3062;
const TOTP_EMAIL = 'founder.totp.d306@example.test';
// A deck viewer who never proved the address (deck_share_actions.ts inserts
// `email_verified = 0` with the viewer's chosen role).
const UNVERIFIED = 3063;
const UNVERIFIED_EMAIL = 'viewer.unverified.d306@example.test';

const TABLES = [
  'users', 'user_role_review', 'user_spinout_flags', 'auth_totp',
  'queue_jobs', 'email_send_log', 'notifications_inbox', 'activity_logs',
];

function fixture() {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  for (const t of TABLES) db.exec(stripForeignKeys(tableFromBaseline(BASELINE, t)));
  const user = db.prepare(
    `INSERT INTO users (id, email, name, role, email_verified, is_active) VALUES (?, ?, ?, ?, ?, 1)`,
  );
  user.run(MAGIC_MEMBER, MAGIC_EMAIL, 'Priya Natarajan', 'partner', 1);
  user.run(TOTP_MEMBER, TOTP_EMAIL, 'Farid Haddad', 'founder', 1);
  user.run(UNVERIFIED, UNVERIFIED_EMAIL, 'Deck Viewer', 'investor', 0);
  // An admin already confirmed the magic-link member's role in the review queue.
  db.prepare(
    `INSERT INTO user_role_review (user_id, suggested_role, role_confirmed, assigned_role) VALUES (?, 'partner', 1, 'partner')`,
  ).run(MAGIC_MEMBER);
  return { db, env: envFor(db) };
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
    // Dummies, so a send attempt gets as far as asking Google for a token —
    // which the recorder below answers, and refuses.
    GMAIL_CLIENT_ID: 'dummy-client', GMAIL_CLIENT_SECRET: 'dummy-secret', GMAIL_REFRESH_TOKEN: 'dummy-refresh',
  } as any;
}

// The two request shapes RegisterPage.jsx sends: its primary button
// (`registerWithMagic`, which defers the email and then asks for a sign-in
// link) and its "Verify by email and set one up" link (`register`).
const primary = (email: string, name = 'Renamed By A Stranger') => ({
  email, name, role: 'founder', product: 'spinout-lab', defer_email: true, turnstileToken: 'solved-challenge',
});
const classic = (email: string, name = 'Renamed By A Stranger') => ({
  email, name, role: 'investor', turnstileToken: 'solved-challenge',
});

async function register(env: any, body: unknown) {
  const calls: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: any) => {
    calls.push(typeof input === 'string' ? input : String(input?.url ?? input));
    return new Response(JSON.stringify({ error: 'no network in this test' }), {
      status: 503, headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  try {
    const res = await auth.fetch(
      new Request('http://x/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.30' },
        body: JSON.stringify(body),
      }),
      env,
    );
    return { status: res.status, body: await res.json().catch(() => ({})) as any, calls };
  } finally {
    globalThis.fetch = real;
  }
}

/** node:sqlite rows have a null prototype; spread them so literals compare. */
const plain = (row: any) => (row ? { ...row } : null);

/** Everything the incomplete-signup path could write about one account. */
function accountState(db: any, id: number) {
  const user = plain(db.prepare(
    `SELECT email, name, role, email_verified, is_active, password_hash,
            verification_token, verification_token_expires FROM users WHERE id = ?`,
  ).get(id));
  return {
    user,
    review: plain(db.prepare(
      `SELECT suggested_role, role_confirmed, assigned_role FROM user_role_review WHERE user_id = ?`,
    ).get(id)),
    spinout: plain(db.prepare(`SELECT registration_product FROM user_spinout_flags WHERE user_id = ?`).get(id)),
    totp: plain(db.prepare(`SELECT secret_ct, recovery_hashes FROM auth_totp WHERE user_id = ?`).get(id)),
    jobs: db.prepare(`SELECT job_type, payload FROM queue_jobs ORDER BY id`).all().map(plain),
    sends: db.prepare(
      `SELECT template_key, to_addr, status FROM email_send_log WHERE user_id = ? OR to_addr = ? ORDER BY id`,
    ).all(id, user?.email ?? '').map(plain),
    inbox: db.prepare(`SELECT template_key FROM notifications_inbox WHERE user_id = ? ORDER BY id`).all(id).map(plain),
    logs: db.prepare(`SELECT action FROM activity_logs WHERE user_id = ? ORDER BY id`).all(id).map(plain),
  };
}

// ───────────────────────────────────────── (a) verified, no authenticator ──

test('(a) a verified member with no authenticator: the primary request is refused 409 and changes nothing', async () => {
  const { db, env } = fixture();
  assert.equal(await hasTotpConfigured(env, MAGIC_MEMBER), false, 'premise: this member has no authenticator');
  const before = accountState(db, MAGIC_MEMBER);

  const r = await register(env, primary(MAGIC_EMAIL));

  assert.deepEqual(accountState(db, MAGIC_MEMBER), before,
    'an unauthenticated request rewrote a verified account (name, role, suggested role, spin-out flag or embed job)');
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.error, 'email_already_registered');
  const after = accountState(db, MAGIC_MEMBER);
  assert.equal(after.user!.name, 'Priya Natarajan');
  assert.equal(after.user!.role, 'partner');
  assert.equal(after.review!.suggested_role, 'partner');
  assert.deepEqual(r.calls, [], 'a refused request reached the network');
});

test('(a) a verified member with no authenticator: the classic request is refused 409, and no verification email is attempted', async () => {
  const { db, env } = fixture();
  assert.equal(await hasTotpConfigured(env, MAGIC_MEMBER), false, 'premise: this member has no authenticator');
  const before = accountState(db, MAGIC_MEMBER);

  const r = await register(env, classic(MAGIC_EMAIL));

  assert.deepEqual(accountState(db, MAGIC_MEMBER), before,
    'an unauthenticated request rewrote a verified account or minted it a verification token');
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.error, 'email_already_registered');
  const after = accountState(db, MAGIC_MEMBER);
  assert.equal(after.user!.name, 'Priya Natarajan');
  assert.equal(after.user!.role, 'partner');
  assert.equal(after.review!.suggested_role, 'partner');
  assert.equal(after.user!.verification_token, null, 'a verification token was minted for a refused request');
  assert.deepEqual(after.sends, [], 'a verification email was attempted for a refused request');
  assert.deepEqual(r.calls, [], 'the mail provider was asked for a token on behalf of a refused request');
});

// ───────────────────────────────────────────── (b) verified, with TOTP ──

test('(b) a verified member WITH an authenticator is refused 409 as before, and the authenticator is left alone', async () => {
  const { db, env } = fixture();
  await persistNewTotpEnrolment(env, TOTP_MEMBER, new Secret().base32, []);
  assert.equal(await hasTotpConfigured(env, TOTP_MEMBER), true, 'premise: this member has an authenticator');
  const before = accountState(db, TOTP_MEMBER);
  assert.ok(before.totp, 'premise: the enrolment is a row in auth_totp');

  for (const body of [primary(TOTP_EMAIL), classic(TOTP_EMAIL)]) {
    const r = await register(env, body);
    assert.deepEqual(accountState(db, TOTP_MEMBER), before, 'a refused request changed the account');
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.equal(r.body.error, 'email_already_registered');
    assert.deepEqual(r.calls, []);
  }
});

// ───────────────────────────────────────────────────── (c) unverified ──

test('(c) an unverified account still takes the incomplete-signup path, exactly as before', async () => {
  const { db, env } = fixture();
  assert.equal(accountState(db, UNVERIFIED).user!.email_verified, 0, 'premise: nobody has proven this address');

  // The primary request: the account is refreshed and the email deferred.
  const deferred = await register(env, primary(UNVERIFIED_EMAIL, 'Dana Okoye'));
  assert.equal(deferred.status, 200, JSON.stringify(deferred.body));
  assert.equal(deferred.body.message, 'Account updated, verification email deferred');
  assert.equal(deferred.body.email_deferred, true);
  assert.equal(deferred.body.requires_verification, true);
  let s = accountState(db, UNVERIFIED);
  assert.equal(s.user!.name, 'Dana Okoye', 'the retried signup no longer updates the name');
  assert.equal(s.user!.role, 'exploring', 'the retried signup no longer lands in exploring');
  assert.equal(s.user!.email_verified, 0);
  assert.equal(s.review!.suggested_role, 'founder', 'the lane was not recorded as the suggested role');
  assert.equal(s.spinout!.registration_product, 'spinout-lab', 'the spin-out intent was not recorded');
  assert.deepEqual(s.jobs.map((j) => [j.job_type, JSON.parse(j.payload).id]), [['embed_entity', UNVERIFIED]]);
  assert.equal(s.user!.verification_token, null, 'a deferred email minted a token anyway');
  assert.deepEqual(s.sends, []);
  assert.deepEqual(deferred.calls, []);

  // The classic request: the verification email is sent there and then. With
  // no real provider it fails, and the page gets the fallback link — as before.
  const sent = await register(env, classic(UNVERIFIED_EMAIL, 'Dana Okoye'));
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.equal(sent.body.email_sent, false);
  assert.match(String(sent.body.verification_url), /^https:\/\/app\.example\.test\/verify-email\?token=/);
  s = accountState(db, UNVERIFIED);
  assert.equal(s.user!.role, 'exploring');
  assert.equal(s.review!.suggested_role, 'investor');
  assert.ok(s.user!.verification_token, 'no verification token was minted');
  assert.deepEqual(s.sends.map((x) => [x.template_key, x.to_addr]), [['auth_verify_email', UNVERIFIED_EMAIL]],
    'the verification email was not attempted');
  // The instrument check: a real send does reach the recorder.
  assert.ok(sent.calls.length > 0, 'the fetch recorder saw no call for a real send — its silence in (a) and (b) would mean nothing');
  for (const url of sent.calls) assert.equal(url, 'https://oauth2.googleapis.com/token');
});

// ───────────────────────────────────────────────────── (d) the refusal ──

test('(d) the 409 is a machine code and a sentence telling the person to sign in — the same whatever the factor', async () => {
  const { env } = fixture();
  await persistNewTotpEnrolment(env, TOTP_MEMBER, new Secret().base32, []);
  const noTotp = await register(env, classic(MAGIC_EMAIL));
  const withTotp = await register(env, classic(TOTP_EMAIL));
  assert.equal(noTotp.status, 409);
  assert.equal(withTotp.status, 409);

  const body = noTotp.body;
  assert.deepEqual(Object.keys(body).sort(), ['error', 'message']);
  // D258: a code-shaped `error` becomes `e.code`, and `message` becomes `e.message`.
  assert.match(body.error, /^[a-z][a-z0-9_]*$/, 'error is not code-shaped, so the page would get no e.code');
  assert.equal(body.error, 'email_already_registered');
  assert.match(body.message, /\bsign in\b/i, 'the sentence does not tell the person to sign in');
  assert.match(body.message, /\s/, 'message is a code, not a sentence');
  // A tab loaded before RegisterPage keyed on the code still matches the words.
  assert.match(body.message, /already registered/i);
  assert.deepEqual(withTotp.body, body, 'the refusal tells a caller whether the account has an authenticator');
});

test('(d) RegisterPage carries on to the sign-in link on exactly that code, not on the sentence', async () => {
  const { env } = fixture();
  const { body } = await register(env, primary(MAGIC_EMAIL));
  const page = codeOnly(read('frontend/src/pages/RegisterPage.jsx'));
  assert.match(page, new RegExp(`\\.code\\s*!==\\s*'${body.error}'`),
    'the primary path no longer treats this refusal as "send a sign-in link instead" — a returning member would see an error');
  assert.doesNotMatch(page, /already registered\/i\.test\(/,
    'the page branches on the sentence again (D258: branch on e.code)');
});
