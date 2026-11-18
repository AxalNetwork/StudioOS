/**
 * D6195 (#6195) — an investor's route preference on their commitment.
 *
 * The owner's rule: a preference only. It is recorded when committing and
 * changed while the commitment is Pending; null is "No preference recorded",
 * never Direct; the closing line's real route is the studio's and is never set
 * from it, while Choose the route reads it beside the line.
 *
 * Real router on `node:sqlite`, with the new migration applied to the table.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/deal_route_preference_6195.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import deals, { routePreferenceOf } from '../src/routes/deals.ts';

const app = new Hono();
app.onError((err: any, c: any) => c.json({ detail: String(err?.message || '') }, err?.message === 'Unauthorized' ? 401 : err?.message === 'Forbidden' ? 403 : 500));
app.route('/api/deals', deals);

const JWT_SECRET = 'unit-test-jwt-secret-6195-0123456789abcdef';
const IVY = 60, ADMIN = 1;
const DEAL = 81;
const MIGRATION = readFileSync(new URL('../sql/migrations/202611161505_6195_commitment_route_preference.sql', import.meta.url), 'utf8');

const coerce = (a: any[]) => a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  const prepare = (sql: string) => {
    let b: any[] = [];
    const api: any = {
      bind: (...x: any[]) => { b = coerce(x); return api; },
      async first() { return db.prepare(sql).get(...b) ?? null; },
      async all() { return { results: db.prepare(sql).all(...b) }; },
      async run() { const r = db.prepare(sql).run(...b); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } }; },
    };
    return api;
  };
  return {
    prepare,
    async batch(stmts: any[]) { const out = []; for (const s of stmts) out.push(await s.run()); return out; },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
  };
}

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, name TEXT, email TEXT, is_active INTEGER NOT NULL DEFAULT 1,
      jwt_min_iat INTEGER, investor_tier TEXT, partner_id INTEGER, founder_id INTEGER, kyc_status TEXT);
    CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, sector TEXT, founder_id INTEGER, company_id INTEGER, deleted_at TEXT);
    CREATE TABLE deals (id INTEGER PRIMARY KEY, uid TEXT, project_id INTEGER, status TEXT, amount REAL, target_raise REAL, minimum_check REAL,
      capital_committed REAL DEFAULT 0, currency TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE deal_invitations (id INTEGER PRIMARY KEY AUTOINCREMENT, deal_id INTEGER, investor_user_id INTEGER, status TEXT, company_id INTEGER, created_at TEXT);
    CREATE TABLE commitments (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, deal_id INTEGER, investor_user_id INTEGER, company_id INTEGER,
      amount REAL, status TEXT, notes TEXT, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE user_company_links (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, company_id INTEGER NOT NULL);
    CREATE TABLE company_profiles (id INTEGER PRIMARY KEY, company_name TEXT, archived_at TEXT);
    CREATE TABLE mi_pro_subscriptions (user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT, period_end TEXT, stripe_customer_id TEXT);
    INSERT INTO users (id, role, name, kyc_status) VALUES (${IVY}, 'investor', 'Ivy', 'approved'), (${ADMIN}, 'admin', 'Ada', NULL);
    INSERT INTO projects (id, name) VALUES (8, 'Beta');
    INSERT INTO deals (id, uid, project_id, status, amount, target_raise, minimum_check, currency) VALUES (${DEAL}, 'd-b', 8, 'active', 500000, 2000000, 1000, 'USD');
    INSERT INTO deal_invitations (deal_id, investor_user_id, status, company_id) VALUES (${DEAL}, ${IVY}, 'invited', NULL);
  `);
  db.exec(MIGRATION);
  return db;
}

async function call(db: InstanceType<typeof DatabaseSync>, user: number, method: 'GET' | 'POST', body?: any, role = 'investor') {
  const tok = await new SignJWT({ user_id: user, role }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const init: any = { method, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await app.request(`/api/deals/${DEAL}/commitments`, init, { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) } as any);
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}
const stored = (db: InstanceType<typeof DatabaseSync>) => (db.prepare(`SELECT status, amount, route_preference FROM commitments WHERE investor_user_id = ${IVY} ORDER BY id`).all() as any[]).map((r) => ({ ...r }));

test('a preference is recorded when committing, returned, and read back by the investor and the studio', async () => {
  const db = freshDb();
  const post = await call(db, IVY, 'POST', { amount: 5000, notes: null, route_preference: 'syndicate' });
  assert.equal(post.status, 200, JSON.stringify(post.body));
  assert.equal(post.body.route_preference, 'syndicate');
  assert.deepEqual(stored(db).map((r) => r.route_preference), ['syndicate']);
  const mine = await call(db, IVY, 'GET');
  assert.equal(mine.body[0].route_preference, 'syndicate', 'the investor reads it on Terms and Commitment');
  const staff = await call(db, ADMIN, 'GET', undefined, 'admin');
  assert.equal(staff.body[0].route_preference, 'syndicate', 'the studio reads it beside the commitment');
});

test('none recorded is null, never Direct', async () => {
  const db = freshDb();
  const post = await call(db, IVY, 'POST', { amount: 5000 });
  assert.equal(post.status, 200, JSON.stringify(post.body));
  assert.equal(post.body.route_preference, null);
  assert.deepEqual(stored(db).map((r) => r.route_preference), [null]);
  const cleared = await call(db, IVY, 'POST', { amount: 5000, route_preference: '' });
  assert.equal(cleared.body.route_preference, null, 'an empty choice is none');
});

test('while Pending it changes; a change of amount alone keeps it; null clears it', async () => {
  const db = freshDb();
  await call(db, IVY, 'POST', { amount: 5000, route_preference: 'direct' });
  const changed = await call(db, IVY, 'POST', { amount: 6000, route_preference: 'fund' });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.deepEqual(stored(db), [{ status: 'pending', amount: 6000, route_preference: 'fund' }], 'one Pending row, changed in place');
  await call(db, IVY, 'POST', { amount: 7000, notes: 'n' });
  assert.equal(stored(db)[0].route_preference, 'fund', 'left out of the body, it is kept');
  await call(db, IVY, 'POST', { amount: 7000, route_preference: null });
  assert.equal(stored(db)[0].route_preference, null, 'sent as null, it is cleared');
});

test('a Confirmed commitment does not change, and its preference stands', async () => {
  const db = freshDb();
  await call(db, IVY, 'POST', { amount: 5000, route_preference: 'direct' });
  db.exec(`UPDATE commitments SET status = 'confirmed'`);
  const r = await call(db, IVY, 'POST', { amount: 5000, route_preference: 'fund' });
  assert.equal(r.status, 409);
  assert.equal(stored(db)[0].route_preference, 'direct');
});

test('an unknown preference is refused in words and nothing is written', async () => {
  const db = freshDb();
  for (const bad of ['axal_fund', 'Direct', 3, true, { route: 'direct' }]) {
    const r = await call(db, IVY, 'POST', { amount: 5000, route_preference: bad });
    assert.equal(r.status, 400, String(bad));
    assert.equal(r.body.error, 'invalid_route_preference');
    assert.match(r.body.detail, /Nothing was changed\.$/);
  }
  assert.deepEqual(stored(db), [], 'no commitment was recorded');
  assert.throws(() => db.exec(`INSERT INTO commitments (deal_id, investor_user_id, amount, status, route_preference) VALUES (${DEAL}, ${IVY}, 1, 'pending', 'spv')`), /CHECK/, 'the column refuses anything else too');
});

test('routePreferenceOf: absent is not given; null and empty clear; the three keys pass', () => {
  assert.deepEqual(routePreferenceOf({}), { given: false, value: null });
  assert.deepEqual(routePreferenceOf({ route_preference: null }), { given: true, value: null });
  assert.deepEqual(routePreferenceOf({ route_preference: '' }), { given: true, value: null });
  for (const k of ['direct', 'syndicate', 'fund']) assert.deepEqual(routePreferenceOf({ route_preference: k }), { given: true, value: k });
  assert.ok(routePreferenceOf({ route_preference: 'third_party_fund' }).error);
});
