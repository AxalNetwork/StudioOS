/**
 * D430 — recovery codes have one writer, so regenerating them and then
 * re-pairing the authenticator never resurrects the discarded set.
 *
 * THE DEFECT, AS FILED AND REPRODUCED HERE BEFORE THE FIX. Regenerate wrote
 * only `users.totp_recovery_codes`; `auth_totp.recovery_hashes` kept the old
 * set. Repair then loaded the stale `auth_totp` row and wrote its hashes back
 * to BOTH columns through `persistNewTotpEnrolment`. Login consumes from
 * `users.totp_recovery_codes` (auth.ts's tryConsumeRecoveryCode reads that
 * column and checks membership of the code's hash), so after regenerate →
 * repair the codes the person had just saved stopped working and the ones
 * they had just discarded worked again — against the settings page's own
 * promise that regenerating "invalidates any existing recovery codes".
 *
 * Driven through the real router against tables sliced from the baseline
 * (the D258 harness), never a SQL-text stub: "the discarded set is gone" is
 * only worth asserting against a database that could still hold it.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/recovery_codes_single_writer_d430.test.ts
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
import { persistNewTotpEnrolment, loadTotp } from '../src/services/authTotp.ts';
import { hashToken } from '../src/auth.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { codeOnly } from './_codeOnly.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-d430-0123456789-abcdef';
const USER = 7430;
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const RECOVERY = read('cloudflare-worker/sql/migrations/277_user_recovery_state.sql');
const SETTINGS_SRC = codeOnly(read('cloudflare-worker/src/routes/settings.ts'));
const SERVICE_SRC = codeOnly(read('cloudflare-worker/src/services/authTotp.ts'));

function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  const end = BASELINE.indexOf(');', at);
  assert.ok(end > at, `${name}'s definition in the baseline is unterminated`);
  return BASELINE.slice(at, end + 2);
}

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'user_sessions', 'activity_logs', 'auth_totp']) db.exec(ddl(t));
  db.exec(RECOVERY);
  db.prepare(
    `INSERT INTO users (id, role, name, email, email_verified, is_active) VALUES (?, 'founder', 'A Founder', 'totp.d430@example.test', 1, 1)`,
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
  const t = await new SignJWT({ user_id: USER, role: 'founder', email: 'totp.d430@example.test' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  return `Bearer ${t}`;
}

async function post(env: any, path: string, body: unknown) {
  const res = await app().fetch(
    new Request(`http://x/api/settings${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', Authorization: await bearer() }, body: JSON.stringify(body),
    }),
    env,
  );
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}

const validCode = (secret: string) => new TOTP({ secret: Secret.fromBase32(secret) }).generate({ timestamp: Date.now() });
const one = (db: any, sql: string, ...a: any[]) => db.prepare(sql).get(...a) as any;
/** The two stores, parsed, in the order login reads them: users first. */
function stores(db: any): { users: string[]; totp: string[] } {
  const u = one(db, 'SELECT totp_recovery_codes FROM users WHERE id = ?', USER);
  const t = one(db, 'SELECT recovery_hashes FROM auth_totp WHERE user_id = ?', USER);
  return { users: JSON.parse(u?.totp_recovery_codes || '[]'), totp: JSON.parse(t?.recovery_hashes || '[]') };
}
/**
 * What login decides: auth.ts's tryConsumeRecoveryCode reads
 * `users.totp_recovery_codes` and accepts a code iff its hash is in the array.
 * Mirrored here rather than driven through /api/auth/login, whose other
 * factors are not this test's subject.
 */
async function loginWouldAccept(db: any, code: string): Promise<boolean> {
  return stores(db).users.includes(await hashToken(code));
}

const OLD_CODE = 'OLDC-ODEA-BCDE';

async function enrolled() {
  const db = freshDb();
  const env = envFor(db);
  const secret = new Secret().base32;
  await persistNewTotpEnrolment(env, USER, secret, [await hashToken(OLD_CODE)]);
  return { db, env, secret };
}

test('D430: regenerate writes both stores at once, and the old set is gone from both', async () => {
  const { db, env, secret } = await enrolled();
  assert.equal(await loginWouldAccept(db, OLD_CODE), true, 'the fixture did not start with a usable old code');
  const r = await post(env, '/totp/recovery-codes/regenerate', { totp_code: validCode(secret) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.codes.length, 10);
  const fresh = await Promise.all((r.body.codes as string[]).map((c) => hashToken(c)));
  const s = stores(db);
  assert.deepEqual(s.users, fresh, 'users.totp_recovery_codes does not hold the ten new hashes');
  assert.deepEqual(s.totp, fresh, 'auth_totp.recovery_hashes was not written — it still holds the set regenerate discarded');
  assert.equal(await loginWouldAccept(db, OLD_CODE), false);
  assert.equal(await loginWouldAccept(db, r.body.codes[0]), true);
  // Regenerating is not a consumption: last_used_at is the audit field for a
  // code or a TOTP being USED, and a regenerate must not forge one.
  assert.equal(one(db, 'SELECT last_used_at FROM auth_totp WHERE user_id = ?', USER).last_used_at, null,
    'regenerate stamped last_used_at as if a code had been consumed');
});

test('D430: regenerate, then repair — the saved codes still work and the discarded ones never come back', async () => {
  const { db, env, secret } = await enrolled();
  const regen = await post(env, '/totp/recovery-codes/regenerate', { totp_code: validCode(secret) });
  assert.equal(regen.status, 200, JSON.stringify(regen.body));
  const saved: string[] = regen.body.codes;
  const savedHashes = await Promise.all(saved.map((c) => hashToken(c)));

  // The defect: repair re-read the stale auth_totp mirror and wrote it back
  // to both columns, so login accepted OLD_CODE again and refused `saved`.
  const rep = await post(env, '/totp/repair', { totp_code: validCode(secret) });
  assert.equal(rep.status, 200, JSON.stringify(rep.body));
  assert.equal(rep.body.ok, true);

  const s = stores(db);
  assert.deepEqual(s.users, savedHashes, 'repair replaced the saved codes in users.totp_recovery_codes');
  assert.deepEqual(s.totp, savedHashes, 'repair replaced the saved codes in auth_totp.recovery_hashes');
  assert.equal(await loginWouldAccept(db, OLD_CODE), false, 'a discarded recovery code works again after repair');
  for (const c of saved) assert.equal(await loginWouldAccept(db, c), true, 'a saved recovery code stopped working after repair');
  // And the count the settings page prints ("N of 10 remaining") follows.
  const totpRow = await loadTotp(env, USER, null, null);
  assert.equal(totpRow?.recoveryHashes.length, 10);
});

test('D430: repair carries the set login consumes from, not the mirror', async () => {
  // Drive the two stores apart by hand — the state every account that
  // regenerated before D430 is in today — and repair must side with the
  // column login reads.
  const { db, env, secret } = await enrolled();
  const keep = [await hashToken('KEEP-THIS-ONE1'), await hashToken('KEEP-THIS-ONE2')];
  db.prepare('UPDATE users SET totp_recovery_codes = ? WHERE id = ?').run(JSON.stringify(keep), USER);
  assert.deepEqual(stores(db).totp, [await hashToken(OLD_CODE)], 'the fixture did not drive the stores apart');
  const rep = await post(env, '/totp/repair', { totp_code: validCode(secret) });
  assert.equal(rep.status, 200, JSON.stringify(rep.body));
  const s = stores(db);
  assert.deepEqual(s.users, keep);
  assert.deepEqual(s.totp, keep, 'repair kept the mirror’s stale set instead of the consumed-from set');
});

test('D430: an empty consumed-from set stays empty — repair never revives codes login was already refusing', async () => {
  const { db, env, secret } = await enrolled();
  db.prepare('UPDATE users SET totp_recovery_codes = ? WHERE id = ?').run('[]', USER);
  assert.equal(await loginWouldAccept(db, OLD_CODE), false, 'the fixture still accepts the old code');
  const rep = await post(env, '/totp/repair', { totp_code: validCode(secret) });
  assert.equal(rep.status, 200, JSON.stringify(rep.body));
  const s = stores(db);
  assert.deepEqual(s.users, [], 'repair put codes back into a set the person had emptied');
  assert.deepEqual(s.totp, [], 'repair kept the mirror’s discarded codes');
  assert.equal(await loginWouldAccept(db, OLD_CODE), false);
});

test('D430: an enrolment writes both stores with the same set, in one batch', async () => {
  const db = freshDb();
  const env = envFor(db);
  db.prepare('UPDATE users SET totp_recovery_codes = ? WHERE id = ?').run('["stale-hash"]', USER);
  const set = [await hashToken('NEWC-ODE0-0001'), await hashToken('NEWC-ODE0-0002')];
  await persistNewTotpEnrolment(env, USER, new Secret().base32, set);
  const s = stores(db);
  assert.deepEqual(s.totp, set, 'auth_totp.recovery_hashes was not written');
  assert.deepEqual(s.users, set, 'users.totp_recovery_codes was not written — the mirror was dropped or swallowed');
  // The batch is the atomicity: a D1 batch either lands every statement or
  // none. The shim runs them in order, so count the writes it saw.
  let calls = 0;
  const spy = { ...env, DB: { ...env.DB, batch: async (stmts: any[]) => { calls = stmts.length; return env.DB.batch(stmts); } } };
  await persistNewTotpEnrolment(spy, USER, new Secret().base32, set);
  assert.equal(calls, 2, `persistNewTotpEnrolment batched ${calls} statements; the secret and the mirror make two`);
});

test('D430: one writer — every write of a recovery set goes through the service, and the mirror is never swallowed', () => {
  // settings.ts no longer writes users.totp_recovery_codes itself.
  assert.doesNotMatch(SETTINGS_SRC, /UPDATE users SET totp_recovery_codes/,
    'settings.ts writes users.totp_recovery_codes directly, beside the auth_totp mirror');
  // Repair passes the set read from users, not the loaded auth_totp row.
  const repair = SETTINGS_SRC.slice(SETTINGS_SRC.indexOf("settings.post('/totp/repair'"), SETTINGS_SRC.indexOf("settings.post('/sessions/revoke-all'"));
  assert.ok(repair.length > 200, 'the repair handler could not be sliced');
  assert.doesNotMatch(repair, /persistNewTotpEnrolment\([^)]*totpRow\.recoveryHashes/, 'repair still re-persists the loaded mirror');
  assert.match(repair, /recoveryCodesOf\(userRow\[0\]\.totp_recovery_codes\)/, 'repair does not carry the set from users.totp_recovery_codes');
  // The service writes both columns in one batch, with no try/catch around the mirror.
  const persist = SERVICE_SRC.slice(SERVICE_SRC.indexOf('export async function persistNewTotpEnrolment('), SERVICE_SRC.indexOf('export async function loadTotp('));
  assert.match(persist, /env\.DB\.batch\(\[/, 'persistNewTotpEnrolment does not batch its two writes');
  assert.doesNotMatch(persist, /try\s*\{[^}]*UPDATE users SET totp_recovery_codes[^}]*\}\s*catch/, 'the mirror write is still swallowed');
  const replace = SERVICE_SRC.slice(SERVICE_SRC.indexOf('export async function replaceRecoveryHashes('), SERVICE_SRC.indexOf('export async function loadTotp('));
  assert.ok(replace.length > 100, 'replaceRecoveryHashes could not be sliced — it must sit before loadTotp');
  assert.match(replace, /env\.DB\.batch\(\[/, 'replaceRecoveryHashes does not batch its two writes');
  assert.doesNotMatch(replace, /last_used_at/, 'replaceRecoveryHashes stamps last_used_at — a regenerate is not a consumption');
});
