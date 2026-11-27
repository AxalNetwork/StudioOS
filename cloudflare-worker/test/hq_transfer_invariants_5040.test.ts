/**
 * D5040 (#5040) — the Super Admin transfer holds its invariants at the write.
 *
 *   1. THE SUCCESSOR MUST BE ACTIVE AT THE WRITE, not only at the preflight read: an account
 *      deactivated in the gap between the two must not receive the sole elevation.
 *   2. A USER ID IS A DECIMAL POSITIVE WHOLE NUMBER. `123abc` named account 123.
 *   3. A TRANSFER THAT MOVED NOTHING records nothing and tells nobody.
 *
 * The tables come from the baseline, verbatim (the D221 pattern).
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/hq_transfer_invariants_5040.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';

import superAdmins, { parseUserId } from '../src/routes/admin_super_admins.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const HOLDER = 801;
const SUCCESSOR = 802;
const MEMBER = 803;
const HANDOVER = 'Guillaume steps back from operations; Sam runs HQ from October';

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
        __sql: sql,
        __binds: () => b,
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    // The transfer's two writes go in one batch; run them in order, as D1 does.
    async batch(stmts: any[]) {
      const out: any[] = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
  };
}

const BASELINE = readFileSync(
  resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8',
);
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
  for (const t of [
    'users', 'super_admins', 'user_sessions', 'activity_logs',
    'impersonation_sessions', 'admin_audit_log', 'notifications_inbox',
  ]) db.exec(ddl(t));
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)');
  u.run(HOLDER, 'admin', 'Holder Hart', 'holder@axal.example');
  u.run(SUCCESSOR, 'admin', 'Sam Successor', 'sam@axal.example');
  u.run(MEMBER, 'founder', 'Fran Founder', 'fran@example.com');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(HOLDER);
  // requireFactor wants factor='totp'; requireStepUp wants it RECENT.
  const sess = db.prepare(
    `INSERT INTO user_sessions (jti, user_id, factor, created_at, last_step_up_at)
     VALUES (?, ?, 'totp', datetime('now'), datetime('now'))`,
  );
  for (const id of [HOLDER, SUCCESSOR]) sess.run(`totp-${id}`, id);
  return db;
}

const env = (db: InstanceType<typeof DatabaseSync>) =>
  ({ JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) }) as any;


const IMPOSTOR = 123;      // an active administrator whose id `123abc` / `1e2…` used to reach
const LOW = 1;             // an active administrator whose id `1e2` / `1.5` used to reach
const MAXISH = '9007199254740993'; // 2^53 + 1: not a safe integer

function withBystanders(db: InstanceType<typeof DatabaseSync>) {
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)');
  u.run(IMPOSTOR, 'admin', 'Ida Impostor', 'ida@axal.example');
  u.run(LOW, 'admin', 'Lou Low', 'lou@axal.example');
  return db;
}

const holderIds = (db: any) =>
  (db.prepare('SELECT user_id FROM super_admins ORDER BY user_id').all() as any[]).map((r) => r.user_id);
const auditCount = (db: any) => (db.prepare('SELECT COUNT(*) AS n FROM admin_audit_log').get() as any).n;
const noticeCount = (db: any) => (db.prepare('SELECT COUNT(*) AS n FROM notifications_inbox').get() as any).n;

async function jwtFor(userId: number): Promise<string> {
  return new SignJWT({ user_id: userId, role: 'admin', jti: `totp-${userId}` })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function call(
  db: InstanceType<typeof DatabaseSync>, actor: number, method: string, path: string,
  body?: Record<string, unknown>, e: any = env(db),
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { Authorization: `Bearer ${await jwtFor(actor)}` };
  if (body) headers['content-type'] = 'application/json';
  const res = await superAdmins.fetch(
    new Request(`http://x${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), e,
  );
  let parsed: any = null;
  try { parsed = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: parsed };
}

/** An env whose batch runs `competitor` once, between the preflight reads and the write. */
function racingBatchEnv(db: InstanceType<typeof DatabaseSync>, competitor: () => void | Promise<void>) {
  const base = makeD1(db);
  const state = { fired: 0 };
  const e = {
    JWT_SECRET, ENVIRONMENT: 'development',
    DB: {
      ...base,
      async batch(stmts: any[]) {
        if (state.fired === 0) { state.fired += 1; await competitor(); }
        return base.batch(stmts);
      },
    },
  } as any;
  return { e, state };
}

// Nothing may leave the machine.
const realFetch = globalThis.fetch;
globalThis.fetch = (async () => new Response('no network in tests', { status: 599 })) as typeof fetch;
process.on('exit', () => { globalThis.fetch = realFetch; });

/* 1 · the successor is active at the write */

test('a successor deactivated after the preflight read but before the batch does not receive the elevation', async () => {
  const db = freshDb();
  const { e, state } = racingBatchEnv(db, () => { db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(SUCCESSOR); });
  const r = await call(db, HOLDER, 'POST', `/${SUCCESSOR}?transfer=1`, { reason: HANDOVER }, e);
  assert.equal(state.fired, 1, 'the account was never deactivated in the gap, so nothing raced');
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body?.code, 'successor_changed');
  assert.deepEqual(holderIds(db), [HOLDER], 'the sole elevation moved to an account that cannot sign in');
  assert.equal(auditCount(db), 0, 'a transfer that moved nothing wrote a success audit row');
  assert.equal(noticeCount(db), 0, 'a transfer that moved nothing sent transfer notices');
});

test('the same race with an active successor still lands (the control)', async () => {
  const db = freshDb();
  const { e, state } = racingBatchEnv(db, () => { /* nothing competes */ });
  const r = await call(db, HOLDER, 'POST', `/${SUCCESSOR}?transfer=1`, { reason: HANDOVER }, e);
  assert.equal(state.fired, 1);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(holderIds(db), [SUCCESSOR]);
  assert.equal(auditCount(db), 2);
  assert.equal(noticeCount(db), 2);
});

test('a successor whose role changed in the gap is refused the same way', async () => {
  const db = freshDb();
  const { e } = racingBatchEnv(db, () => { db.prepare("UPDATE users SET role = 'founder' WHERE id = ?").run(SUCCESSOR); });
  const r = await call(db, HOLDER, 'POST', `/${SUCCESSOR}?transfer=1`, { reason: HANDOVER }, e);
  assert.equal(r.status, 409);
  assert.equal(r.body?.code, 'successor_changed');
  assert.deepEqual(holderIds(db), [HOLDER]);
});

test('an already-deactivated successor is still refused before the reason is asked for', async () => {
  const db = freshDb();
  db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(SUCCESSOR);
  const r = await call(db, HOLDER, 'POST', `/${SUCCESSOR}?transfer=1`, { reason: HANDOVER });
  assert.equal(r.status, 409);
  assert.equal(r.body?.code, 'not_active');
});

test('the write conditions on the successor being active, not only on the caller still holding', () => {
  const src = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/routes/admin_super_admins.ts'), 'utf8');
  const insert = src.slice(src.indexOf('INSERT OR IGNORE INTO super_admins'), src.indexOf('INSERT OR IGNORE INTO super_admins') + 400);
  assert.match(insert, /LOWER\(role\) = 'admin' AND is_active = 1/);
});

/* 2 · ids */

const MALFORMED = ['123abc', '1e2', '1.5', '-1', '0', '00', '01', '+5', '0x10', MAXISH, '99999999999999999999'];

for (const bad of MALFORMED) {
  test(`POST /${bad} is refused as an invalid id, and no account is elevated`, async () => {
    const db = withBystanders(freshDb());
    const r = await call(db, HOLDER, 'POST', `/${bad}?transfer=1`, { reason: HANDOVER });
    assert.equal(r.status, 400, JSON.stringify(r.body));
    assert.equal(r.body?.error, 'Invalid user id');
    assert.deepEqual(holderIds(db), [HOLDER]);
    assert.equal(auditCount(db), 0);
  });
}

test('DELETE with a malformed id is refused too', async () => {
  const db = withBystanders(freshDb());
  const r = await call(db, HOLDER, 'DELETE', '/123abc');
  assert.equal(r.status, 400);
  assert.deepEqual(holderIds(db), [HOLDER]);
});

test('a well-formed id still resolves: the transfer to 123 lands', async () => {
  const db = withBystanders(freshDb());
  const r = await call(db, HOLDER, 'POST', `/${IMPOSTOR}?transfer=1`, { reason: HANDOVER });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(holderIds(db), [IMPOSTOR]);
});

test('parseUserId accepts only decimal positive whole numbers within the safe range', () => {
  for (const ok of ['1', '123', '9007199254740991']) assert.equal(parseUserId(ok), Number(ok), ok);
  for (const bad of ['', ' 1', '1 ', ...MALFORMED, 'NaN', 'Infinity']) assert.equal(parseUserId(bad), null, JSON.stringify(bad));
});
