/**
 * Support sessions are bounded, justified and recorded — canvas H4.
 *
 * TWO THINGS THE ARTBOARD DRAWS THAT THE CODE DID NOT DO.
 *
 * 1. **"Expiry · 30 minutes · hard."** `POST /admin/impersonate/:userId` minted
 *    the ORDINARY token — `JWT_EXPIRY_HOURS = 24`. An admin who opened a
 *    support session kept a credential that acts AS that person for the rest
 *    of the day, long after the support ended, with nothing on screen saying
 *    so. Drawing the canvas over that would have put a false claim about a
 *    live security control on the page, which is the failure D35 already
 *    records this repo learning once.
 * 2. **"Reason · required, free text."** `impersonation_sessions.context`
 *    existed but was an optional query parameter no SPA caller ever sent, so
 *    every row in the audit read "someone impersonated someone" with no why.
 *
 * The expiry is asserted by DECODING the minted token, not by reading the
 * constant back — a test that checks its own input proves nothing, and the
 * whole point is what the token actually carries.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT, decodeJwt } from 'jose';

import admin from '../src/routes/admin.ts';
import { IMPERSONATION_EXPIRY_MINUTES, createJWT } from '../src/auth.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADMIN = 701;
const OTHER_ADMIN = 702;
const TARGET = 703;
const JTI = 'jti-admin-session-1';
const OTHER_JTI = 'jti-other-admin-1';
const REASON = 'Password reset support ticket 4821';

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
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) { return x; },
  };
}

/** Verbatim from the baseline; a literal search, never a built regex. */
const BASELINE = readFileSync(
  resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8',
);
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
  for (const t of ['users', 'activity_logs', 'user_sessions', 'impersonation_sessions']) db.exec(ddl(t));
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)');
  u.run(ADMIN, 'admin', 'The Admin', 'admin@example.test');
  u.run(OTHER_ADMIN, 'admin', 'Other Admin', 'other@example.test');
  u.run(TARGET, 'founder', 'A Founder', 'founder@example.test');
  // Both gates read `user_sessions` by the token's jti: requireFactor wants
  // factor='totp', requireStepUp wants that step-up to be RECENT.
  const sess = db.prepare(
    `INSERT INTO user_sessions (jti, user_id, factor, created_at, last_step_up_at)
     VALUES (?, ?, 'totp', datetime('now'), datetime('now'))`,
  );
  sess.run(JTI, ADMIN);
  sess.run(OTHER_JTI, OTHER_ADMIN);
  return db;
}

async function call(db: any, actor: number, jti: string, path: string) {
  const jwt = await new SignJWT({ user_id: actor, role: 'admin', jti })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await admin.fetch(
    new Request(`http://x${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) } as any,
  );
  return { status: res.status, body: await res.json().catch(() => ({})) as any };
}

const sessions = (db: any) => db.prepare('SELECT * FROM impersonation_sessions ORDER BY id').all();
const logs = (db: any) => db.prepare('SELECT * FROM activity_logs ORDER BY id').all();
/** Minutes until the token dies, read off the token itself. */
const lifeMinutes = (token: string) => (decodeJwt(token).exp! * 1000 - Date.now()) / 60_000;

const open = (db: any, reason = REASON) =>
  call(db, ADMIN, JTI, `/impersonate/${TARGET}?context=${encodeURIComponent(reason)}`);

test('a support session cannot be opened without a reason', async () => {
  const db = freshDb();
  const r = await call(db, ADMIN, JTI, `/impersonate/${TARGET}`);
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'impersonation_reason_required');
  assert.equal(r.body.token, undefined, 'a token was minted for a session with no reason');
  assert.equal(sessions(db).length, 0, 'an unjustified session was recorded');
  assert.equal(logs(db).length, 0);
});

test('a token-gesture reason is refused too', async () => {
  // "ok", ".", "test" — the shapes someone types to get past a required
  // field. The audit is worth nothing if the reason can be a keystroke.
  const db = freshDb();
  for (const weak of ['', '   ', 'ok', 'testing', '.........']) {
    const r = await call(db, ADMIN, JTI, `/impersonate/${TARGET}?context=${encodeURIComponent(weak)}`);
    assert.equal(r.status, 400, `"${weak}" was accepted as a reason`);
    assert.equal(r.body.code, 'impersonation_reason_required');
  }
  assert.equal(sessions(db).length, 0);
});

test('the minted token lasts thirty minutes, not a day', async () => {
  const db = freshDb();
  const r = await open(db);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.token, 'no token was minted');

  // Read off the TOKEN, not off the constant — the defect was a token whose
  // real life did not match what the product said about it.
  const life = lifeMinutes(r.body.token);
  assert.ok(life > 25 && life <= IMPERSONATION_EXPIRY_MINUTES + 1,
    `the support token lives ${life.toFixed(1)} minutes; expected about ${IMPERSONATION_EXPIRY_MINUTES}`);
  assert.ok(life < 60, 'the support token is still an ordinary long-lived session token');

  // And the client is told, so it can hand the session back rather than
  // discover the expiry as a 401 that ends the ADMIN's own session.
  assert.equal(r.body.expires_in_minutes, IMPERSONATION_EXPIRY_MINUTES);
  const declared = (Date.parse(r.body.expires_at) - Date.now()) / 60_000;
  assert.ok(Math.abs(declared - life) < 1,
    'expires_at disagrees with the token it describes');
});

test('an ordinary session is untouched by the short expiry', async () => {
  // The same helper mints every other token in the product. If the default
  // moved, ~460 call sites just started expiring in half an hour.
  const token = await createJWT({ JWT_SECRET } as any, TARGET, 'founder@example.test', 'founder');
  const life = lifeMinutes(token);
  assert.ok(life > 23 * 60, `an ordinary token now lives only ${(life / 60).toFixed(1)} hours`);
});

test('the reason is what lands in the audit row', async () => {
  const db = freshDb();
  const r = await open(db);
  assert.equal(r.status, 200);
  const rows = sessions(db);
  assert.equal(rows.length, 1, 'the session was not recorded');
  assert.equal(rows[0].context, REASON, 'the audit row does not carry the reason given');
  assert.equal(rows[0].admin_user_id, ADMIN);
  assert.equal(rows[0].target_user_id, TARGET);
  assert.equal(rows[0].ended_at, null, 'a freshly opened session is already closed');
  assert.equal(r.body.impersonation_session_id, rows[0].id);
});

test('extending mints a fresh thirty minutes and says so in the log', async () => {
  const db = freshDb();
  const first = await open(db);
  const id = first.body.impersonation_session_id;

  const ext = await call(db, ADMIN, JTI, `/impersonate-sessions/${id}/extend`);
  assert.equal(ext.status, 200, JSON.stringify(ext.body));

  // NOT `notEqual(ext.token, first.token)`, which is what this asserted at
  // first and which failed. A JWT is deterministic in its payload and its
  // `iat`, and `iat` has second resolution — so an extend in the same second
  // as the grant is byte-identical, correctly: nothing about the session
  // changed. Token identity is a coincidence of timing, not the contract.
  // What must hold is that the expiry is a fresh window from NOW and never
  // earlier than the one it replaces.
  const life = lifeMinutes(ext.body.token);
  assert.ok(decodeJwt(ext.body.token).exp! >= decodeJwt(first.body.token).exp!,
    'extending moved the expiry backwards');
  assert.ok(life > 25 && life <= IMPERSONATION_EXPIRY_MINUTES + 1,
    `the extended token lives ${life.toFixed(1)} minutes`);

  // Recorded, so the audit shows how long support actually held the account
  // rather than one open-ended entry.
  const actions = logs(db).map((x: any) => x.action);
  assert.ok(actions.includes('admin_impersonate_extend'), 'an extension left no trace');
  // Still ONE session — extending is not a new grant.
  assert.equal(sessions(db).length, 1, 'extending opened a second session');
});

test('only the admin who opened a session may extend it', async () => {
  const db = freshDb();
  const first = await open(db);
  const id = first.body.impersonation_session_id;
  const r = await call(db, OTHER_ADMIN, OTHER_JTI, `/impersonate-sessions/${id}/extend`);
  assert.equal(r.status, 404, 'another admin extended a session they did not open');
  assert.equal(r.body.code, 'session_not_open');
  assert.equal(r.body.token, undefined, 'a token was handed to the wrong admin');
});

test('an ended session cannot be revived', async () => {
  // Re-entry is a new session with its own reason, which is the point: the
  // audit should show two justified visits, not one that never closed.
  const db = freshDb();
  const first = await open(db);
  const id = first.body.impersonation_session_id;
  const ended = await call(db, ADMIN, JTI, `/impersonate-sessions/${id}/end`);
  assert.equal(ended.status, 200);
  assert.ok(sessions(db)[0].ended_at, 'ending the session did not stamp it');

  const r = await call(db, ADMIN, JTI, `/impersonate-sessions/${id}/extend`);
  assert.equal(r.status, 404, 'a closed support session was reopened by extending it');
  assert.equal(r.body.token, undefined);
});
