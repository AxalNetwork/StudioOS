/**
 * D200 — the security_events ledger, and the two Security-page refusals that
 * denied stores the platform has.
 *
 * WHAT THIS FILE PROVES, AND WHY EACH HALF IS BEHAVIOURAL. Every assertion
 * below runs against a real `node:sqlite` database built from
 * `schema_baseline.sql` with migration 282 applied OFF DISK — never a
 * SQL-text stub, because the defects this ledger could carry are all about
 * what SQLite actually does: a trigger that does or does not fire, a UNIQUE
 * tuple that does or does not collapse two rows, a timestamp comparison that
 * does or does not normalise its column.
 *
 *   THE SEAL. Append-only, with ONE admitted delete: a row older than the
 *   retention window. The sweep deletes exactly what the trigger admits, and
 *   the retention number lives twice (SQL literal, TS constant) — asserted
 *   equal so changing one without the other fails here.
 *
 *   THE WRITE IS BOUNDED AND NEVER THROWS. It sits on unauthenticated paths:
 *   one row per (kind, factor, outcome, subject, network, minute), and a
 *   database without 282 must leave every refusal answering exactly the status
 *   it answered before the ledger existed.
 *
 *   NO ADDRESS IS STORED. The subject is `hashEmail`'s digest and the network
 *   is a /24 or ::/48 bucket; a scan of every column refuses the raw values.
 *
 *   REFUSALS AND STEP-UPS ONLY. A successful /login is DRIVEN end to end with
 *   a genuinely enrolled authenticator and must leave the ledger empty —
 *   activity_logs already holds sign-in successes.
 *
 *   UNREADABLE IS NOT ZERO. The counts, the sanctions summary and the backup
 *   heartbeat each answer `available: false` with a reason on a store they
 *   cannot read — never a figure of 0.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';
import { TOTP, Secret } from 'otpauth';
import { Hono } from 'hono';

import auth from '../src/routes/auth.ts';
import passkey from '../src/routes/auth_passkey.ts';
import recover from '../src/routes/auth_recover.ts';
import security from '../src/routes/admin_security.ts';
import { requireFactor, requireStepUp } from '../src/auth.ts';
import { persistNewTotpEnrolment } from '../src/services/authTotp.ts';
import {
  recordSecurityEvent, pruneSecurityEvents, loadSecurityEventCounts, ipPrefix,
  SECURITY_EVENT_KINDS, SECURITY_EVENT_RETENTION_DAYS, SECURITY_EVENTS_NOT_COUNTED,
} from '../src/services/securityEvents.ts';
import { screeningSummary } from '../src/services/sanctions.ts';
import { readBackupHeartbeat, RESTORE_DRILL_REASON } from '../src/services/backup.ts';
import { hashEmail } from '../src/util/hashEmail.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { codeOnly } from './_codeOnly.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const USER = 801;
const SUPER = 802;
const EMAIL = 'founder.d200@example.test';
const IP = '198.51.100.23';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const MIGRATION = read('cloudflare-worker/sql/migrations/282_security_events.sql');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');

/** One table's CREATE TABLE, verbatim. A literal search, never a built regex. */
function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  const end = BASELINE.indexOf(');', at);
  assert.ok(end > at, `${name}'s definition in the baseline is unterminated`);
  return BASELINE.slice(at, end + 2);
}

const TABLES = [
  'users', 'user_sessions', 'activity_logs', 'super_admins', 'admin_audit_log',
  'passkeys', 'webauthn_challenges', 'auth_recovery_tickets',
];

function freshDb({ ledger = true, extra = [] as string[] } = {}) {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  for (const t of [...TABLES, ...extra]) db.exec(ddl(t));
  if (ledger) db.exec(MIGRATION);
  db.prepare(
    `INSERT INTO users (id, role, name, email, email_verified, is_active) VALUES (?, 'founder', 'A Founder', ?, 1, 1)`,
  ).run(USER, EMAIL);
  db.prepare(
    `INSERT INTO users (id, role, name, email, email_verified, is_active) VALUES (?, 'admin', 'T. Okafor', 'okafor@example.test', 1, 1)`,
  ).run(SUPER);
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
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

function envFor(db: any, over: Record<string, unknown> = {}) {
  return {
    JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db),
    RATE_LIMITS: kv(), TOKENS: kv(), APP_URL: 'https://app.example.test', ...over,
  } as any;
}

const rows = (db: any) => db.prepare('SELECT * FROM security_events ORDER BY id').all() as any[];

async function post(app: any, path: string, body: unknown, env: any, headers: Record<string, string> = {}) {
  const res = await app.fetch(
    new Request(`http://x${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': IP, ...headers },
      body: JSON.stringify(body),
    }),
    env,
  );
  return { status: res.status, body: await res.json().catch(() => ({})) as any, res };
}

async function jwtFor(userId: number, role: string, jti: string) {
  return new SignJWT({ user_id: userId, role, jti })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

/** A real enrolment through the service, so the secret is encrypted as production stores it. */
async function enrol(env: any, userId: number) {
  const secret = new Secret().base32;
  await persistNewTotpEnrolment(env, userId, secret, []);
  const totp = new TOTP({ secret: Secret.fromBase32(secret) });
  return { good: () => totp.generate(), bad: () => (totp.generate() === '000000' ? '111111' : '000000') };
}

// ───────────────────────────────────────────────────────────── the seal ──

test('migration 282 applies twice, and builds the table, both indexes and both triggers', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(MIGRATION);
  db.exec(MIGRATION); // CREATE … IF NOT EXISTS throughout, or the bootstrap path dies on a re-run
  const names = (type: string) => (db.prepare(
    `SELECT name FROM sqlite_master WHERE type = ? AND tbl_name = 'security_events' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
  ).all(type) as any[]).map((r) => r.name);
  assert.deepEqual(names('table'), ['security_events']);
  assert.deepEqual(names('index'), ['idx_security_events_occurred', 'idx_security_events_user']);
  assert.deepEqual(names('trigger'), ['security_events_block_update', 'security_events_seal_delete']);
});

test('the CHECK admits exactly SECURITY_EVENT_KINDS, and a kind outside it is refused by SQLite', () => {
  const ddlOnly = MIGRATION.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  const m = /kind\s+TEXT NOT NULL\s+CHECK \(kind IN \(([^)]*)\)\)/.exec(ddlOnly);
  assert.ok(m, 'the kind CHECK could not be read off the migration');
  const kinds = m![1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
  assert.deepEqual(kinds, [...SECURITY_EVENT_KINDS], 'the CHECK and the exported kinds disagree');
  const db = freshDb();
  assert.throws(() => db.prepare(
    `INSERT INTO security_events (kind, factor, outcome, minute) VALUES ('login', 'totp', 'refused', '2026-09-23 10:00')`,
  ).run(), /CHECK constraint failed/);
  assert.throws(() => db.prepare(
    `INSERT INTO security_events (kind, factor, outcome, minute) VALUES ('signin', 'totp', 'maybe', '2026-09-23 10:00')`,
  ).run(), /CHECK constraint failed/);
});

test('the retention window is one number, stated twice and asserted equal', () => {
  const m = /datetime\('now', '-(\d+) days'\)/.exec(MIGRATION);
  assert.ok(m, 'the seal no longer names its window');
  assert.equal(Number(m![1]), SECURITY_EVENT_RETENTION_DAYS,
    'the trigger and the constant disagree — the sweep would try to delete rows the seal refuses, or keep rows it admits');
});

test('the seal: an UPDATE aborts, a young DELETE aborts, an aged DELETE succeeds, and the sweep deletes exactly the aged', async () => {
  const db = freshDb();
  const ins = db.prepare(
    `INSERT INTO security_events (kind, factor, outcome, subject_key, minute, occurred_at)
     VALUES ('signin', 'totp', 'refused', ?, ?, datetime('now', ?))`,
  );
  ins.run('young', 'm1', '-10 days');
  ins.run('aged', 'm2', '-100 days');
  ins.run('edge-young', 'm3', '-89 days');

  assert.throws(() => db.prepare(`UPDATE security_events SET outcome = 'ok'`).run(), /append-only/);
  assert.throws(() => db.prepare(`DELETE FROM security_events WHERE subject_key = 'young'`).run(), /keeps 90 days/);

  const r = await pruneSecurityEvents(envFor(db));
  assert.deepEqual(r, { readable: true, deleted: 1 });
  assert.deepEqual(rows(db).map((x) => x.subject_key).sort(), ['edge-young', 'young']);

  // And the aged-row delete is ADMITTED by the trigger directly, not only by the sweep's WHERE.
  ins.run('aged-2', 'm4', '-120 days');
  db.prepare(`DELETE FROM security_events WHERE subject_key = 'aged-2'`).run();
  assert.equal(rows(db).length, 2);
});

test('the sweep on a database without 282 is unreadable, not "deleted 0"', async () => {
  const r = await pruneSecurityEvents(envFor(freshDb({ ledger: false })));
  assert.equal(r.readable, false);
});

// ─────────────────────────────────────────────────────────── the write ──

test('one row per minute per (kind, factor, outcome, subject, network) — and outcome is part of the key', async () => {
  const db = freshDb();
  const env = envFor(db);
  const ev = { kind: 'step_up' as const, factor: 'totp', email: EMAIL, ip: IP, userId: USER };
  assert.deepEqual(await recordSecurityEvent(env, { ...ev, outcome: 'refused', detail: 'invalid_code' }), { recorded: true, deduped: false });
  assert.deepEqual(await recordSecurityEvent(env, { ...ev, outcome: 'refused', detail: 'invalid_code' }), { recorded: false, deduped: true });
  assert.equal(rows(db).length, 1, 'a burst inside one minute wrote more than one row');
  // `detail` is not in the key: a DIFFERENT reason in the same minute is the
  // same row, and the row keeps the first reason rather than the latest.
  assert.deepEqual(await recordSecurityEvent(env, { ...ev, outcome: 'refused', detail: 'stale_session' }), { recorded: false, deduped: true });
  assert.deepEqual(rows(db).map((r) => r.detail), ['invalid_code'], 'a later reason replaced the first one in the minute');
  // A grant after a refusal in the same minute is a different fact.
  assert.deepEqual(await recordSecurityEvent(env, { ...ev, outcome: 'ok' }), { recorded: true, deduped: false });
  assert.equal(rows(db).length, 2, 'an ok step-up was dropped as a duplicate of a refused one');
  // A row from an earlier minute does not collide with this minute's.
  db.prepare(
    `INSERT INTO security_events (kind, factor, outcome, subject_key, ip_prefix, minute, occurred_at)
     VALUES ('signin', 'magic', 'refused', ?, ?, '2000-01-01 00:00', '2000-01-01 00:00:00')`,
  ).run(await hashEmail(EMAIL), ipPrefix(IP));
  assert.deepEqual(await recordSecurityEvent(env, { kind: 'signin', factor: 'magic', outcome: 'refused', email: EMAIL, ip: IP }),
    { recorded: true, deduped: false });
  // `minute` and `occurred_at` come from one statement's 'now', so they agree.
  for (const r of rows(db)) assert.equal(String(r.occurred_at).slice(0, 16), r.minute);
});

test('no address is stored: the subject is a hash and the network is a bucket', async () => {
  const db = freshDb();
  await recordSecurityEvent(envFor(db), { kind: 'signin', factor: 'totp', outcome: 'refused', detail: 'unknown_account', email: EMAIL, ip: IP });
  const [r] = rows(db);
  assert.equal(r.subject_key, await hashEmail(EMAIL));
  assert.equal(r.ip_prefix, '198.51.100.0/24');
  for (const [col, v] of Object.entries(r)) {
    assert.ok(!String(v ?? '').toLowerCase().includes(EMAIL.toLowerCase()), `${col} stored the address`);
    assert.ok(!String(v ?? '').includes(IP), `${col} stored the raw client address`);
  }
});

test('the write never throws: no table, no binding, a failing prepare, a malformed branch code', async () => {
  const ev = { kind: 'signin' as const, factor: 'totp', outcome: 'refused' as const, email: EMAIL, ip: IP };
  const noTable = await recordSecurityEvent(envFor(freshDb({ ledger: false })), ev);
  assert.equal(noTable.recorded, false);
  assert.ok('reason' in noTable && /no such table/.test(noTable.reason));
  assert.equal((await recordSecurityEvent({} as any, ev)).recorded, false);
  const throwing = { DB: { prepare() { throw new Error('D1 unavailable'); } } } as any;
  assert.equal((await recordSecurityEvent(throwing, ev)).recorded, false);
  const db = freshDb();
  const bad = await recordSecurityEvent(envFor(db, { BRANCH_CODE: 'NOT A CODE!' }), ev);
  assert.equal(bad.recorded, false, 'a malformed BRANCH_CODE must cost the event, not the refusal');
  assert.equal(rows(db).length, 0);
});

test('branch_code is the deployment that recorded it: the branch code, or hq', async () => {
  const db = freshDb();
  await recordSecurityEvent(envFor(db), { kind: 'gate', factor: 'totp', outcome: 'refused', userId: USER });
  await recordSecurityEvent(envFor(db, { BRANCH_CODE: 'fr' }), { kind: 'gate', factor: 'step_up', outcome: 'refused', userId: USER });
  assert.deepEqual(rows(db).map((r) => r.branch_code), ['hq', 'fr']);
});

test('ipPrefix is the one bucket: /24, ::/48, or unknown', () => {
  assert.equal(ipPrefix('203.0.113.9'), '203.0.113.0/24');
  assert.equal(ipPrefix('2001:db8:abcd:12::1'), '2001:db8:abcd::/48');
  assert.equal(ipPrefix(''), 'unknown');
  assert.equal(ipPrefix(undefined), 'unknown');
  assert.equal(ipPrefix('not-an-ip'), 'unknown');
});

// ─────────────────────────────────────────────────────────── the counts ──

test('rows today is anchored at midnight UTC, and failed sign-ins count only refused sign-ins in 24 hours', async () => {
  // D177's rule: "today" fixtures anchor to the start of the day, so this test
  // cannot fail at 00:30 UTC. `start of day` is always today; `-25 hours` is
  // never today.
  const db = freshDb();
  const ins = db.prepare(
    `INSERT INTO security_events (kind, factor, outcome, subject_key, minute, occurred_at)
     VALUES (?, 'totp', ?, ?, ?, datetime('now', ?))`,
  );
  ins.run('signin', 'refused', 'a', 'a', 'start of day');
  ins.run('step_up', 'refused', 'b', 'b', 'start of day');
  ins.run('signin', 'refused', 'c', 'c', '-25 hours');
  ins.run('step_up', 'ok', 'd', 'd', 'start of day');
  const c = await loadSecurityEventCounts(envFor(db));
  assert.ok(c.available);
  assert.equal((c as any).today, 3);
  assert.equal((c as any).failed_signins_24h, 1, 'a refused step-up or a 25-hour-old sign-in counted as a failed sign-in');
});

test('an unreadable ledger answers available: false with a reason — never today: 0', async () => {
  const c = await loadSecurityEventCounts(envFor(freshDb({ ledger: false })));
  assert.equal(c.available, false);
  assert.ok(!('today' in c), 'an unreadable ledger reported a figure');
  assert.match((c as any).reason, /could not be read/);
});

// ─────────────────────────────────────────── the writers, driven over HTTP ──

test('/login: an unknown address refuses 401 and records the hash, never the address', async () => {
  const db = freshDb();
  const r = await post(auth, '/login', { email: 'nobody@example.test', totp_code: '123456' }, envFor(db));
  assert.equal(r.status, 401);
  assert.equal(r.body.error, 'Invalid credentials');
  const [row] = rows(db);
  assert.equal(rows(db).length, 1);
  assert.deepEqual([row.kind, row.factor, row.outcome, row.detail, row.user_id],
    ['signin', 'totp', 'refused', 'unknown_account', null]);
  assert.equal(row.subject_key, await hashEmail('nobody@example.test'));
});

test('/login: a wrong code refuses 401 with the account named; a right code signs in and writes NOTHING here', async () => {
  const db = freshDb();
  const env = envFor(db);
  const code = await enrol(env, USER);

  const bad = await post(auth, '/login', { email: EMAIL, totp_code: code.bad() }, env);
  assert.equal(bad.status, 401);
  assert.equal(bad.body.error, 'Invalid TOTP code');
  assert.deepEqual(rows(db).map((r) => [r.kind, r.detail, r.user_id]), [['signin', 'invalid_code', USER]]);

  const good = await post(auth, '/login', { email: EMAIL, totp_code: code.good() }, env);
  assert.equal(good.status, 200, JSON.stringify(good.body));
  assert.equal(rows(db).length, 1, 'a successful sign-in was recorded — activity_logs already holds it');
  const logins = db.prepare(`SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'user_login' AND user_id = ?`).get(USER) as any;
  assert.equal(Number(logins.n), 1, 'the success went unrecorded where it IS recorded');
});

test('/login on a database without 282 refuses exactly as before: the write is swallowed', async () => {
  const db = freshDb({ ledger: false });
  const r = await post(auth, '/login', { email: 'nobody@example.test', totp_code: '123456' }, envFor(db));
  assert.equal(r.status, 401);
  assert.equal(r.body.error, 'Invalid credentials');
});

test('/login: an inactive account refuses 403 and records it', async () => {
  const db = freshDb();
  db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(USER);
  const r = await post(auth, '/login', { email: EMAIL, totp_code: '123456' }, envFor(db));
  assert.equal(r.status, 403);
  assert.deepEqual(rows(db).map((x) => [x.detail, x.user_id]), [['inactive', USER]]);
});

test('/step-up: a wrong code is refused and recorded; a right one is granted and recorded as ok', async () => {
  const db = freshDb();
  const env = envFor(db);
  const code = await enrol(env, USER);
  db.prepare(`INSERT INTO user_sessions (jti, user_id, factor, created_at) VALUES ('jti-su', ?, 'totp', datetime('now', '-2 hours'))`).run(USER);
  const bearer = { Authorization: `Bearer ${await jwtFor(USER, 'founder', 'jti-su')}` };

  const bad = await post(auth, '/step-up', { totp_code: code.bad() }, env, bearer);
  assert.equal(bad.status, 401);
  const good = await post(auth, '/step-up', { totp_code: code.good() }, env, bearer);
  assert.equal(good.status, 200, JSON.stringify(good.body));
  assert.deepEqual(rows(db).map((r) => [r.kind, r.factor, r.outcome, r.detail, r.user_id]), [
    ['step_up', 'totp', 'refused', 'invalid_code', USER],
    ['step_up', 'totp', 'ok', null, USER],
  ]);
});

test('the privileged gates record an authenticated caller they turn away — and nothing for a caller with no session', async () => {
  const db = freshDb();
  const env = envFor(db);
  const gate = new Hono();
  const run = (fn: (c: any) => Promise<unknown>) => async (c: any) => {
    try { await fn(c); return c.json({ ok: true }); } catch (e) { return c.json({ error: (e as Error).message }, 403); }
  };
  gate.get('/factor', run((c) => requireFactor(c, 'totp')));
  gate.get('/stepup', run((c) => requireStepUp(c)));
  const call = async (path: string, headers: Record<string, string> = {}) => {
    const res = await gate.fetch(new Request(`http://x${path}`, { headers: { 'cf-connecting-ip': IP, ...headers } }), env);
    return { status: res.status, body: await res.json() as any };
  };
  // An SMS session is not a TOTP session; an old TOTP session is not a recent step-up.
  db.prepare(`INSERT INTO user_sessions (jti, user_id, factor, created_at) VALUES ('jti-sms', ?, 'sms', datetime('now'))`).run(USER);
  db.prepare(`INSERT INTO user_sessions (jti, user_id, factor, created_at) VALUES ('jti-old', ?, 'totp', datetime('now', '-3 hours'))`).run(USER);
  const f = await call('/factor', { Authorization: `Bearer ${await jwtFor(USER, 'founder', 'jti-sms')}` });
  assert.equal(f.body.error, 'TOTP required');
  const s = await call('/stepup', { Authorization: `Bearer ${await jwtFor(USER, 'founder', 'jti-old')}` });
  assert.equal(s.body.error, 'step_up_required');
  assert.deepEqual(rows(db).map((r) => [r.kind, r.factor, r.detail, r.user_id]), [
    ['gate', 'totp', 'factor_required', USER],
    ['gate', 'step_up', 'step_up_required', USER],
  ]);
  await call('/stepup');
  assert.equal(rows(db).length, 2, 'a caller with no session was recorded as a gate refusal — that is a sign-in that never happened');
});

test('/magic/verify: a token that no longer claims redirects to expired and records it', async () => {
  const db = freshDb();
  const res = await auth.fetch(new Request('http://x/magic/verify?token=not-a-live-token', { headers: { 'cf-connecting-ip': IP } }), envFor(db));
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location') || '', /magic_error=expired/);
  assert.deepEqual(rows(db).map((r) => [r.kind, r.factor, r.detail]), [['signin', 'magic', 'expired']]);
});

test('passkey /auth-verify: an unclaimable challenge and an unrecognised credential each refuse and record', async () => {
  const db = freshDb();
  const env = envFor(db);
  const cdj = (challenge: string) => Buffer.from(JSON.stringify({ challenge })).toString('base64url');
  const r1 = await post(passkey, '/auth-verify', { response: { id: 'cred-x', response: { clientDataJSON: cdj('never-issued') } } }, env);
  assert.equal(r1.status, 400);
  db.prepare(
    `INSERT INTO webauthn_challenges (challenge, user_id, kind, expires_at) VALUES ('live-ch', NULL, 'authentication', ?)`,
  ).run(new Date(Date.now() + 5 * 60_000).toISOString());
  // A second NETWORK, on purpose: two refusals of one factor from one
  // network in one minute are one row by design (the dedupe test states it),
  // so driving both sites from one address would prove only the first.
  const r2 = await post(passkey, '/auth-verify', { response: { id: 'cred-unknown', response: { clientDataJSON: cdj('live-ch') } } }, env,
    { 'cf-connecting-ip': '203.0.113.9' });
  assert.equal(r2.status, 401);
  assert.deepEqual(rows(db).map((r) => [r.kind, r.factor, r.detail, r.ip_prefix]), [
    ['signin', 'passkey', 'challenge_expired', '198.51.100.0/24'],
    ['signin', 'passkey', 'unrecognised_credential', '203.0.113.0/24'],
  ]);
});

test('recovery /backup-code: an address with no account refuses 401 and records a recovery row', async () => {
  const db = freshDb();
  const r = await post(recover, '/backup-code', { email: 'ghost@example.test', code: 'AAAA-BBBB-CCCC' }, envFor(db));
  assert.equal(r.status, 401);
  assert.deepEqual(rows(db).map((x) => [x.kind, x.factor, x.detail]), [['recovery', 'backup_code', 'invalid_code']]);
});

test('SMS /sms/verify-challenge: a session that expired refuses 410 and records it', async () => {
  const db = freshDb();
  const r = await post(auth, '/sms/verify-challenge',
    { email: EMAIL, session_info: 'gone', code: '123456' }, envFor(db, { GCIP_API_KEY: 'test-key' }));
  assert.equal(r.status, 410);
  assert.deepEqual(rows(db).map((x) => [x.kind, x.factor, x.detail]), [['signin', 'sms', 'session_expired']]);
});

// ───────────────────────────────────────────── structural: the rule itself ──

test('no sign-in, gate or recovery write can be ok: only the step-up helper passes a non-refused outcome', () => {
  const files = [
    'cloudflare-worker/src/routes/auth.ts', 'cloudflare-worker/src/routes/auth_sms.ts',
    'cloudflare-worker/src/routes/auth_passkey.ts', 'cloudflare-worker/src/routes/auth_recover.ts',
    'cloudflare-worker/src/auth.ts',
  ];
  let calls = 0;
  for (const f of files) {
    const src = codeOnly(read(f));
    for (const m of src.matchAll(/recordSecurityEvent\([^{]*\{([^}]*)\}/g)) {
      calls += 1;
      const body = m[1];
      if (/outcome: 'refused'/.test(body)) continue;
      assert.match(body, /kind: 'step_up'/, `${f}: a non-step-up write passes an outcome other than 'refused': ${body.slice(0, 90)}`);
    }
  }
  assert.ok(calls >= 8, `the scan found only ${calls} writer sites — the regex stopped matching, which would make this vacuous`);
});

test('the network bucket has one definition: routes/auth.ts computes no /24 or ::/48 of its own', () => {
  const src = codeOnly(read('cloudflare-worker/src/routes/auth.ts'));
  assert.doesNotMatch(src, /'::\/48'|'\.0\/24'/, 'a second copy of the ip bucket is back in routes/auth.ts');
  assert.match(src, /ipPrefix\(clientIp\)/, 'the turnstile refusals stopped using the shared bucket');
});

// ─────────────────────────────── sanctions and backup: the two refusals D200 corrected ──

test('sanctions: a measured zero is a figure, a missing table is unreadable, and a hit is counted', async () => {
  const missing = await screeningSummary(envFor(freshDb()));
  assert.equal(missing.available, false, 'a missing sanctions table read as zero runs');
  assert.ok(!('runs_total' in missing));

  const db = freshDb({ extra: ['sanctions_screenings'] });
  const empty = await screeningSummary(envFor(db));
  assert.ok(empty.available);
  assert.equal((empty as any).runs_total, 0);
  assert.equal((empty as any).last_run_at, null);
  assert.match((empty as any).how, /on request/i, 'a zero must say nothing schedules a run');

  db.prepare(`INSERT INTO sanctions_screenings (user_id, provider, hit, severity, match_count) VALUES (?, 'aggregate', 1, 'high', 2)`).run(USER);
  db.prepare(`INSERT INTO sanctions_screenings (user_id, provider, hit, severity, match_count) VALUES (?, 'aggregate', 0, 'none', 0)`).run(USER);
  const hit = await screeningSummary(envFor(db)) as any;
  assert.deepEqual([hit.runs_total, hit.hits_total, hit.unreviewed_hits], [2, 1, 1]);
});

test('backup: three states for the heartbeat, and the drill reason carries no count that would go stale', async () => {
  const unbound = await readBackupHeartbeat({} as any, 'd1');
  assert.equal(unbound.available, false);
  assert.match((unbound as any).reason, /BACKUPS/);

  const none = await readBackupHeartbeat({ BACKUPS: { async get() { return null; } } } as any, 'd1');
  assert.equal(none.available, false);
  assert.match((none as any).reason, /No heartbeat-d1\.json has ever been written/);

  const obj = { async json() { return { at: '2026-09-23T02:10:00Z', source: 'gha', kind: 'd1', key: 'd1/studioos-db/x.sql', size_bytes: 4096 }; } };
  const keys: string[] = [];
  const present = await readBackupHeartbeat({ BACKUPS: { async get(k: string) { keys.push(k); return obj; } } } as any, 'd1') as any;
  assert.deepEqual(keys, ['heartbeat-d1.json'], 'the D1 heartbeat was read from the wrong key');
  assert.deepEqual([present.available, present.at, present.source, present.size_bytes], [true, '2026-09-23T02:10:00Z', 'gha', 4096]);

  assert.doesNotMatch(RESTORE_DRILL_REASON, /\d+\s*(?:\/|of)\s*\d+|\bfour\b/i,
    'a run count belongs in D200 and the PR body, never in a runtime string that will go stale');
});

// ─────────────────────────────────────────────────────── /overview ──

async function overview(db: any, over: Record<string, unknown> = {}) {
  // A token that names a jti is honoured only while its user_sessions row
  // exists and is unrevoked, so the super admin signs in with a real session.
  db.prepare(`INSERT OR IGNORE INTO user_sessions (jti, user_id, factor, created_at) VALUES ('jti-super', ?, 'totp', datetime('now'))`).run(SUPER);
  const jwt = await jwtFor(SUPER, 'admin', 'jti-super');
  const res = await security.fetch(
    new Request('http://x/overview', { headers: { Authorization: `Bearer ${jwt}` } }),
    envFor(db, over),
  );
  return { status: res.status, body: await res.json().catch(() => ({})) as any };
}

test('/overview: the ledger block carries figures, sanctions and backup read their stores, the drill stays absent', async () => {
  const db = freshDb({ extra: ['sanctions_screenings'] });
  await recordSecurityEvent(envFor(db), { kind: 'signin', factor: 'totp', outcome: 'refused', detail: 'unknown_account', email: EMAIL, ip: IP });
  const r = await overview(db);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const se = r.body.security_events;
  assert.deepEqual([se.available, se.today, se.failed_signins_24h, se.retention_days], [true, 1, 1, 90]);
  assert.deepEqual(se.kinds, [...SECURITY_EVENT_KINDS]);
  assert.deepEqual(se.not_counted.map((n: any) => n.what), SECURITY_EVENTS_NOT_COUNTED.map((n) => n.what));
  assert.equal(r.body.sanctions.available, true);
  assert.equal(r.body.sanctions.runs_total, 0);
  assert.equal(r.body.backup_dr.backup.available, false, 'an unbound bucket read as a healthy backup');
  assert.equal(r.body.backup_dr.drill.available, false);
  assert.equal(r.body.backup_dr.drill.reason, RESTORE_DRILL_REASON);
  assert.deepEqual(r.body.dsr.by_branch, [{ branch: 'HQ-held', open: 0 }]);
  assert.equal(r.body.dsr.branches.bound, 0);
});

test('/overview on a database without 282: the ledger is unreadable with its reason — never 0 today', async () => {
  const r = await overview(freshDb({ ledger: false }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const se = r.body.security_events;
  assert.equal(se.available, false);
  assert.ok(!('today' in se), 'an unreadable ledger reported a count');
  assert.ok(!('failed_signins_24h' in se));
  assert.match(se.reason, /could not be read/);
  assert.equal(se.retention_days, 90, 'facts about the design are still stated when the database cannot be read');
  assert.equal(r.body.sanctions.available, false, 'a missing sanctions table read as zero runs');
});
