/**
 * #4715 — the advisor access policy (services/advisorAccess.ts): the advisor
 * side of a booking, a cohort list and a guidance edit each need the Advisor
 * licence TODAY and the account's own advisor row. A stored users.advisor_id
 * is a pointer, not a grant.
 *
 * On the migrated schema, synthetic rows only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/advisor_access_policy_4715.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import advisors from '../src/routes/advisors.ts';
import { ensureCohortGuidanceSchema } from '../src/services/cohortGuidanceSchema.ts';

const SECRET = 'test'.repeat(16);
test.after(() => removeMigratedDatabases());
const later = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

// 11 a founder; 21 an advisor (row 201); 22 a former advisor, now a founder,
// still pointing at their old row 202; 23 an advisor whose stored pointer names
// row 201, which is not theirs; 24 a founder with an additional Advisor licence
// (row 203); 30 an admin.
async function fixture() {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO founders(id,name,email) VALUES (101,'One','one@example.test');
    INSERT INTO users(id,name,email,role,founder_id,is_active) VALUES
      (11,'Founder','f@example.test','founder',101,1),
      (21,'Advisor','a@example.test','advisor',NULL,1),
      (22,'Former','former@example.test','founder',NULL,1),
      (23,'Pointer','p@example.test','advisor',NULL,1),
      (24,'Extra','x@example.test','founder',NULL,1),
      (30,'Admin','ad@example.test','admin',NULL,1);
    INSERT INTO advisors(id,uid,user_id,display_name,email,is_active) VALUES
      (201,'a-1',21,'Advisor','a@example.test',1),
      (202,'a-2',22,'Former','former@example.test',1),
      (203,'a-3',24,'Extra','x@example.test',1);
    UPDATE users SET advisor_id = 201 WHERE id = 21;
    UPDATE users SET advisor_id = 202 WHERE id = 22;
    UPDATE users SET advisor_id = 201 WHERE id = 23;
    UPDATE users SET advisor_id = 203 WHERE id = 24;
    INSERT INTO account_licences(user_id,licence,source) VALUES (24,'advisor','admin');
    INSERT INTO cohort_cycles(id,year,month,start_at,end_at,status) VALUES (471501,2099,1,'2099-01-01','2099-02-01','active');
    INSERT INTO advisor_cohort_assignments(uid,advisor_user_id,cohort_cycle_id,is_active) VALUES ('ca-21',21,471501,1),('ca-22',22,471501,1);
  `);
  const s = db.prepare('INSERT INTO advisor_office_hour_slots(id,uid,advisor_id,starts_at,ends_at,capacity) VALUES (?,?,?,?,?,?)');
  const b = db.prepare('INSERT INTO advisor_bookings(id,uid,slot_id,advisor_id,founder_user_id,status) VALUES (?,?,?,?,?,?)');
  let n = 0;
  const booking = (advisorId: number, status: string) => {
    n += 1;
    s.run(n, `s-${n}`, advisorId, later(n), later(n + 0.1), 1);
    b.run(n, `b-${n}`, n, advisorId, 11, status);
    return n;
  };
  const env: any = { JWT_SECRET: SECRET, ENVIRONMENT: 'development', DB: d1Over(db) };
  await ensureCohortGuidanceSchema(env);
  db.prepare("INSERT INTO cohort_guidance(uid,cohort_cycle_id,advisor_user_id,body) VALUES (?,?,?,?)").run('g-21', 471501, 21, 'Synthetic guidance');
  db.prepare("INSERT INTO cohort_guidance(uid,cohort_cycle_id,advisor_user_id,body) VALUES (?,?,?,?)").run('g-22', 471501, 22, 'Synthetic guidance');
  const ctx: any = { waitUntil() {}, passThroughOnException() {}, props: {} };
  const app = new Hono<any>();
  app.route('/api/advisors', advisors);
  const call = async (path: string, who: number, method = 'GET', body?: unknown) => {
    const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const res = await app.request(`/api/advisors${path}`, {
      method, headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, env, ctx);
    const text = await res.text();
    try { return { status: res.status, body: JSON.parse(text) as any }; } catch { throw new Error(`${path} ${res.status}: ${text.slice(0, 200)}`); }
  };
  const status = (id: number) => (db.prepare('SELECT status FROM advisor_bookings WHERE id = ?').get(id) as any).status;
  return { db, call, booking, status };
}

test('a former advisor cannot act on their old bookings: confirm, complete, no-show, cancel', async () => {
  const f = await fixture();
  for (const action of ['confirm', 'complete', 'no-show', 'cancel']) {
    const id = f.booking(202, 'pending');
    const r = await f.call(`/bookings/${id}/${action}`, 22, 'POST', {});
    assert.equal(r.status, 403, `${action} by a former advisor`);
    assert.equal(f.status(id), 'pending', `${action} wrote nothing`);
  }
});

test('the live advisor still confirms and completes their own bookings; an admin still can', async () => {
  const f = await fixture();
  const a = f.booking(201, 'pending');
  assert.equal((await f.call(`/bookings/${a}/confirm`, 21, 'POST', {})).status, 200);
  assert.equal(f.status(a), 'confirmed');
  assert.equal((await f.call(`/bookings/${a}/complete`, 21, 'POST', {})).status, 200);
  const b = f.booking(202, 'pending');
  assert.equal((await f.call(`/bookings/${b}/confirm`, 30, 'POST', {})).status, 200, 'an admin');
});

test('a stored pointer to another account’s advisor row grants nothing', async () => {
  const f = await fixture();
  const id = f.booking(201, 'pending');
  assert.equal((await f.call(`/bookings/${id}/confirm`, 23, 'POST', {})).status, 403);
  assert.equal(f.status(id), 'pending');
});

test('an additional Advisor licence acts as the advisor until it is revoked', async () => {
  const f = await fixture();
  const a = f.booking(203, 'pending');
  assert.equal((await f.call(`/bookings/${a}/confirm`, 24, 'POST', {})).status, 200);
  f.db.exec("UPDATE account_licences SET revoked_at = datetime('now') WHERE user_id = 24");
  const b = f.booking(203, 'pending');
  assert.equal((await f.call(`/bookings/${b}/confirm`, 24, 'POST', {})).status, 403);
});

test('a former advisor cannot review as the advisor; the founder and the live advisor can', async () => {
  const f = await fixture();
  const old = f.booking(202, 'completed');
  assert.equal((await f.call(`/bookings/${old}/review`, 22, 'POST', { rating: 1 })).status, 403);
  const own = f.booking(201, 'completed');
  assert.equal((await f.call(`/bookings/${own}/review`, 21, 'POST', { rating: 5 })).status, 200);
  assert.equal((await f.call(`/bookings/${own}/review`, 11, 'POST', { rating: 5 })).status, 200);
  const roles = f.db.prepare('SELECT reviewer_role FROM advisor_reviews WHERE booking_id = ? ORDER BY reviewer_role').all(own).map((r: any) => r.reviewer_role);
  assert.deepEqual(roles, ['advisor', 'founder']);
});

test('a former advisor lists no cohort and cannot edit guidance; the live advisor can', async () => {
  const f = await fixture();
  const former = await f.call('/me/cohort', 22);
  assert.equal(former.status, 200);
  assert.deepEqual(former.body.items, []);
  const live = await f.call('/me/cohort', 21);
  assert.equal(live.body.items.length, 1);
  assert.equal((await f.call('/me/guidance/g-22', 22, 'PATCH', { body: 'Changed' })).status, 403);
  const kept = f.db.prepare("SELECT body FROM cohort_guidance WHERE uid = 'g-22'").get() as any;
  assert.equal(kept.body, 'Synthetic guidance');
  // D4813 (package 2): an edit of the words names the version it was made
  // against, so two tabs never overwrite each other; the row starts at 1.
  assert.equal((await f.call('/me/guidance/g-21', 21, 'PATCH', { body: 'Changed', version: 1 })).status, 200);
});
