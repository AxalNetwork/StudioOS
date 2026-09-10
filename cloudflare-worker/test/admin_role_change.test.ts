/**
 * `PATCH /api/admin/users/:userId/role` — Task #152.
 *
 * WHY THIS FILE EXISTS AT ALL. Nothing covered this route, `api.adminUpdateRole`
 * or `RoleDropdown` — a grep for any of the three across `frontend/test/`,
 * `cloudflare-worker/test/` and `tests/` returned nothing. It is the endpoint
 * that decides what a person may see and do in this product, and it carries
 * four refusals that exist for security reasons, none of which anything
 * checked. Task #152 was reported as "the picker is inert"; the picker turned
 * out to be right and the console merely silent about why, so the fix is copy
 * and an affordance — but the route underneath it stays untested either way,
 * and that is the part worth holding down.
 *
 * The DDL is lifted VERBATIM from `sql/schema_baseline.sql` rather than
 * hand-written, for the reason `founders.user_id` taught this repo: a harness
 * that invents its own schema only ever confirms its own assumptions. That
 * matters especially here, because `users.role` carries a CHECK constraint and
 * a test that omitted it would pass on a role the database would reject.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';

import admin from '../src/routes/admin.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADMIN = 901;      // the caller
const OTHER_ADMIN = 902;
const FOUNDER = 903;
const EXPLORER = 904;   // the state every new signup lands in

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

/**
 * One table's `CREATE TABLE` taken straight out of the baseline.
 *
 * Anchored on a line-start `CREATE TABLE <name> (` so `REFERENCES users(id)`
 * in a dozen other tables cannot match — the baseline mentions `users`
 * thirteen times and only one of them is its definition.
 */
const BASELINE = readFileSync(
  resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8',
);
function ddl(name: string): string {
  const re = new RegExp(`^CREATE TABLE (?:IF NOT EXISTS )?${name}\\s*\\(`, 'm');
  const m = re.exec(BASELINE);
  assert.ok(m, `${name} is no longer defined in schema_baseline.sql`);
  const end = BASELINE.indexOf(');', m.index);
  assert.ok(end > m.index, `${name}'s definition in the baseline is unterminated`);
  return BASELINE.slice(m.index, end + 2);
}

function freshDb() {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  db.exec(ddl('users'));
  db.exec(ddl('activity_logs'));
  db.exec(ddl('user_role_review'));
  const u = db.prepare('INSERT INTO users (id, role, name, email) VALUES (?, ?, ?, ?)');
  u.run(ADMIN, 'admin', 'The Admin', 'admin@example.test');
  u.run(OTHER_ADMIN, 'admin', 'Other Admin', 'other@example.test');
  u.run(FOUNDER, 'founder', 'A Founder', 'founder@example.test');
  u.run(EXPLORER, 'exploring', 'New Signup', 'explorer@example.test');
  return db;
}

async function call(db: any, actor: number, path: string, init: RequestInit = {}) {
  const jwt = await new SignJWT({ user_id: actor, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await admin.fetch(
    new Request(`http://x${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json', ...(init.headers || {}) },
    }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) } as any,
  );
  return { status: res.status, body: await res.json().catch(() => ({})) as any };
}

const roleOf = (db: any, id: number) => db.prepare('SELECT role FROM users WHERE id = ?').get(id).role;
const logs = (db: any) => db.prepare('SELECT * FROM activity_logs ORDER BY id').all();

test('a role outside the closed set is refused, and nothing is written', async () => {
  const db = freshDb();
  const r = await call(db, ADMIN, `/users/${FOUNDER}/role?role=banana`, { method: 'PATCH' });
  assert.equal(r.status, 400);
  assert.match(String(r.body.error), /Invalid role/);
  assert.equal(roleOf(db, FOUNDER), 'founder', 'an invalid role still changed the row');
  assert.equal(logs(db).length, 0, 'a refused change was logged as if it happened');
});

test('this endpoint cannot mint an admin', async () => {
  // Deliberate policy: granting admin is a direct-SQL act, so a compromised
  // admin session cannot entrench itself by promoting an account it controls.
  const db = freshDb();
  const r = await call(db, ADMIN, `/users/${FOUNDER}/role?role=admin`, { method: 'PATCH' });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'admin_promotion_disabled');
  assert.equal(roleOf(db, FOUNDER), 'founder', 'an admin was minted through the API');
});

test('one admin cannot quietly demote another', async () => {
  const db = freshDb();
  const r = await call(db, ADMIN, `/users/${OTHER_ADMIN}/role?role=founder`, { method: 'PATCH' });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'admin_demotion_disabled');
  assert.equal(roleOf(db, OTHER_ADMIN), 'admin', 'an admin was demoted through the API');
});

test('an admin cannot change their own role', async () => {
  const db = freshDb();
  const r = await call(db, ADMIN, `/users/${ADMIN}/role?role=founder`, { method: 'PATCH' });
  assert.equal(r.status, 400);
  assert.equal(roleOf(db, ADMIN), 'admin');
});

test('an unknown user is a 404 from this route, not an accident', async () => {
  // The BODY is asserted, not just the code, because a 404 can reach the
  // caller two ways: this route refusing, or the handler throwing past the
  // refusal and Hono answering for it. Only the message tells them apart, and
  // "the user does not exist" and "the handler crashed" are not the same
  // fact to report.
  const db = freshDb();
  const r = await call(db, ADMIN, '/users/99999/role?role=founder', { method: 'PATCH' });
  assert.equal(r.status, 404);
  assert.equal(r.body.error, 'User not found',
    'the 404 did not come from the route — it fell out of a thrown handler');
});

test('the signed-agreement gate cannot be walked around with this endpoint', async () => {
  // THE ONE THIS TASK IS ABOUT. Every new signup is `exploring`
  // (routes/auth.ts:334), and leaving it requires a completed binding
  // envelope, enforced in admin_exploring.ts. Without this refusal an admin
  // could skip the agreement entirely by using the Users-table dropdown
  // instead of the queue — which is exactly why the dropdown disables those
  // options, and why #152's fix is to explain that rather than remove it.
  const db = freshDb();
  for (const role of ['founder', 'partner', 'investor', 'advisor']) {
    const r = await call(db, ADMIN, `/users/${EXPLORER}/role?role=${role}`, { method: 'PATCH' });
    assert.equal(r.status, 409, `exploring → ${role} was allowed through the generic endpoint`);
    assert.equal(r.body.code, 'use_exploring_assign_role');
    assert.equal(roleOf(db, EXPLORER), 'exploring', `exploring → ${role} changed the row anyway`);
  }
  assert.equal(logs(db).length, 0, 'a refused transition was logged as if it happened');
});

test('a permitted change lands, and both sides are told', async () => {
  const db = freshDb();
  const r = await call(db, ADMIN, `/users/${FOUNDER}/role?role=partner`, { method: 'PATCH' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.role, 'partner');
  assert.equal(roleOf(db, FOUNDER), 'partner', 'the role did not actually change');

  // Two rows, not one: the person whose role changed gets their own entry, so
  // it is visible in their activity history and not only in the admin's.
  const rows = logs(db);
  assert.deepEqual(rows.map((x: any) => x.action), ['role_changed', 'your_role_changed']);
  assert.equal(rows[0].user_id, ADMIN);
  assert.equal(rows[1].user_id, FOUNDER);
  for (const row of rows) assert.match(String(row.details), /from founder to partner/);
});

test('the audit rows carry a hash, never the plaintext address', async () => {
  // Epic 11's rule. An audit ledger that stores addresses becomes a directory
  // of everyone the product has ever touched.
  const db = freshDb();
  await call(db, ADMIN, `/users/${FOUNDER}/role?role=partner`, { method: 'PATCH' });
  for (const row of logs(db)) {
    for (const email of ['admin@example.test', 'founder@example.test']) {
      assert.ok(!String(row.actor ?? '').includes(email),
        `activity_logs.actor holds the plaintext ${email}`);
    }
    assert.match(String(row.actor), /^[0-9a-f]{16,}$/, 'the actor is not a hash');
  }
});

test('sending a user back into exploring is allowed, and clears the stale review', async () => {
  // The reverse direction is deliberately open: an admin can return someone to
  // the holding state for re-review. The review row must reset, or they
  // reappear in the queue already marked assigned.
  const db = freshDb();
  db.prepare(
    `INSERT INTO user_role_review (user_id, role_confirmed, assigned_role, assigned_at, updated_at)
     VALUES (?, 1, 'founder', datetime('now'), datetime('now'))`,
  ).run(FOUNDER);
  const r = await call(db, ADMIN, `/users/${FOUNDER}/role?role=exploring`, { method: 'PATCH' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(roleOf(db, FOUNDER), 'exploring');
  const review: any = db.prepare('SELECT * FROM user_role_review WHERE user_id = ?').get(FOUNDER);
  assert.equal(review.role_confirmed, 0, 'the stale confirmation survived');
  assert.equal(review.assigned_role, null, 'the stale assignment survived');
});
