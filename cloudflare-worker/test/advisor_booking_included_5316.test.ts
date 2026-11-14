/**
 * #5316 (D5316) — a session recorded as included in an engagement: its own
 * state, with no price, in no billed or outstanding total, not counted as
 * unpriced, and named where the earnings say what they are built from.
 * Frozen terms (#4713) are untouched: a priced line cannot be included.
 *
 * On the migrated schema, synthetic rows only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/advisor_booking_included_5316.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import advisors from '../src/routes/advisors.ts';

const SECRET = 'test'.repeat(16);
test.after(() => removeMigratedDatabases());
const ADVISOR = 21;
const OTHER_ADVISOR = 23;

function fixture() {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO users(id,name,email,role,is_active) VALUES (21,'Advisor','a@example.test','advisor',1);
    INSERT INTO users(id,name,email,role,is_active) VALUES (22,'Client','c@example.test','founder',1);
    INSERT INTO users(id,name,email,role,is_active) VALUES (23,'Advisor Two','b@example.test','advisor',1);
    INSERT INTO advisors(id,uid,user_id,display_name,email,is_active) VALUES (201,'a-1',21,'Advisor','a@example.test',1);
    INSERT INTO advisors(id,uid,user_id,display_name,email,is_active) VALUES (202,'a-2',23,'Advisor Two','b@example.test',1);
    UPDATE users SET advisor_id = 201 WHERE id = 21;
    UPDATE users SET advisor_id = 202 WHERE id = 23;
    INSERT INTO advisor_engagements(id, uid, advisor_id, founder_user_id, client_name, lane, shape, cycles, created_at, updated_at)
      VALUES (301, 'e-1', 201, 22, 'Client Co', 'signed', 'retainer', 1, '2026-01-01', '2026-01-01');
    INSERT INTO advisor_engagements(id, uid, advisor_id, client_name, lane, shape, cycles, created_at, updated_at)
      VALUES (302, 'e-2', 202, 'Not mine', 'signed', 'retainer', 1, '2026-01-01', '2026-01-01');
  `);
  const slot = db.prepare('INSERT INTO advisor_office_hour_slots(id,uid,advisor_id,starts_at,ends_at,capacity) VALUES (?,?,201,?,?,4)');
  for (let i = 1; i <= 4; i += 1) slot.run(i, `s-${i}`, `2026-02-0${i}T10:00:00.000Z`, `2026-02-0${i}T11:00:00.000Z`);
  const env: any = { JWT_SECRET: SECRET, ENVIRONMENT: 'development', DB: d1Over(db) };
  const ctx: any = { waitUntil() {}, passThroughOnException() {}, props: {} };
  const app = new Hono<any>();
  app.route('/api/advisors', advisors);
  const call = async (who: number, method: string, path: string, body?: unknown) => {
    const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const res = await app.request(`/api/advisors${path}`, {
      method, headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, env, ctx);
    const text = await res.text();
    try { return { status: res.status, body: JSON.parse(text) as any }; } catch { throw new Error(`${path} ${res.status}: ${text.slice(0, 200)}`); }
  };
  const booking = (slotId: number, status = 'completed') => {
    const r = db.prepare("INSERT INTO advisor_bookings(uid,slot_id,advisor_id,founder_user_id,status,created_at,updated_at) VALUES (?,?,201,22,?,'2026-02-01T00:00:00.000Z','2026-02-01T00:00:00.000Z')")
      .run(`b-${slotId}`, slotId, status);
    return Number(r.lastInsertRowid);
  };
  const stored = (id: number) => db.prepare('SELECT * FROM advisor_bookings WHERE id = ?').get(id) as any;
  const billing = (id: number, body: unknown, who = ADVISOR) => call(who, 'PATCH', `/me/bookings/${id}/billing`, body);
  return { db, call, booking, stored, billing };
}

test('a session is recorded as included: who, when, the engagement, and no price', async () => {
  const f = fixture();
  const id = f.booking(1);
  const r = await f.billing(id, { billing_state: 'included', engagement_id: 301 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.billing_state, 'included');
  assert.equal(r.body.amount_cents, null);
  assert.equal(r.body.included_engagement_id, 301);
  assert.equal(r.body.included_by_user_id, ADVISOR);
  assert.ok(r.body.included_at);
  const row = f.stored(id);
  assert.equal(row.billing_state, 'unpriced', 'the column keeps a value its CHECK allows');
  assert.deepEqual([row.amount_cents, row.take_rate_bps, row.platform_cut_cents], [null, null, null]);
  assert.equal(row.included_by_user_id, ADVISOR);
  assert.equal(row.included_engagement_id, 301);
});

test('an included booking is left out of billed and outstanding totals, and is not unpriced', async () => {
  const f = fixture();
  const billed = f.booking(1);
  const collected = f.booking(2);
  const included = f.booking(3);
  const unpriced = f.booking(4);
  assert.equal((await f.billing(billed, { amount_cents: 20000 })).status, 200);
  assert.equal((await f.billing(collected, { amount_cents: 10000, billing_state: 'collected' })).status, 200);
  assert.equal((await f.billing(included, { billing_state: 'included', engagement_id: 301 })).status, 200);

  const earnings = (await f.call(ADVISOR, 'GET', '/me/earnings')).body;
  assert.equal(earnings.billed_cents, 20000);
  assert.equal(earnings.outstanding_cents, 20000);
  assert.equal(earnings.collected_cents, 10000);
  assert.equal(earnings.unpriced_count, 1, 'only the session nobody priced');
  assert.equal(earnings.included_count, 1);
  assert.equal(earnings.population.included_sessions, 1, 'named in what the figures cover');
  assert.equal(earnings.population.sessions, 4);
  assert.deepEqual(earnings.by_state.find((s: any) => s.state === 'included'), { state: 'included', bookings: 1, total_cents: 0 });

  const ledger = (await f.call(ADVISOR, 'GET', '/me/ledger')).body;
  assert.equal(ledger.totals.gross_cents, 30000);
  assert.equal(ledger.totals.sessions, 4);
  assert.equal(ledger.totals.priced_sessions, 2, 'an included session is not priced');
  assert.equal(ledger.totals.unpriced_sessions, 1);
  assert.equal(ledger.totals.included_sessions, 1);
  assert.equal(ledger.states.billed.gross_cents, 20000);
  assert.equal(ledger.states.billed.sessions, 1);
  assert.deepEqual(ledger.states.included, { sessions: 1 });
  assert.equal(ledger.states.unpriced.sessions, 1);
  const line = ledger.lines.items.find((l: any) => l.id === included);
  assert.equal(line.billing_state, 'included');
  assert.equal(line.amount_cents, null);
  assert.equal(line.included_engagement_id, 301);
  assert.equal(ledger.lines.items.find((l: any) => l.id === unpriced).billing_state, 'unpriced');
  assert.equal(ledger.clients[0].unpriced_sessions, 1, 'per client too');

  const tax = (await f.call(ADVISOR, 'GET', '/me/tax-summary?year=2026')).body;
  assert.deepEqual([tax.gross_cents, tax.priced_sessions, tax.unpriced_sessions, tax.included_sessions], [30000, 2, 1, 1]);

  const list = (await f.call(ADVISOR, 'GET', '/me/bookings')).body;
  const items = list.items ?? list;
  assert.equal(items.find((b: any) => b.id === included).billing_state, 'included');
});

test('a priced line cannot be included, and its frozen terms do not move', async () => {
  const f = fixture();
  const id = f.booking(1);
  await f.billing(id, { amount_cents: 15000 });
  const before = f.stored(id);
  const r = await f.billing(id, { billing_state: 'included' });
  assert.deepEqual([r.status, r.body.code], [409, 'priced_line']);
  const free = f.booking(2);
  await f.billing(free, { amount_cents: 0 });
  assert.equal((await f.billing(free, { billing_state: 'included' })).body.code, 'priced_line', 'free is a recorded $0, not included');
  const after = f.stored(id);
  for (const k of ['amount_cents', 'billing_state', 'take_rate_bps', 'platform_cut_cents', 'included_at']) assert.equal(after[k], before[k], k);
  const priced = await f.billing(f.booking(3), { billing_state: 'included', amount_cents: 5000 });
  assert.deepEqual([priced.status, priced.body.code], [400, 'included_has_no_price']);
});

test('leaving included is said out loud; sending a state clears the record', async () => {
  const f = fixture();
  const id = f.booking(1);
  await f.billing(id, { billing_state: 'included', engagement_id: 301 });
  const bare = await f.billing(id, { amount_cents: 9000 });
  assert.deepEqual([bare.status, bare.body.code], [409, 'included_line']);
  assert.equal(f.stored(id).amount_cents, null);
  const priced = await f.billing(id, { amount_cents: 9000, billing_state: 'billed' });
  assert.equal(priced.status, 200, JSON.stringify(priced.body));
  assert.equal(priced.body.billing_state, 'billed');
  assert.equal(priced.body.included_at, null);
  const row = f.stored(id);
  assert.deepEqual([row.included_at, row.included_by_user_id, row.included_engagement_id], [null, null, null]);
  assert.equal(row.amount_cents, 9000);
});

test('the first record stands; an engagement that is not yours is Not Found; an old booking is not included', async () => {
  const f = fixture();
  const id = f.booking(1);
  const first = await f.billing(id, { billing_state: 'included' });
  assert.equal(first.body.included_engagement_id, null, 'no engagement named is recorded as none');
  const again = await f.billing(id, { billing_state: 'included', engagement_id: 301 });
  assert.equal(again.body.included_at, first.body.included_at);
  assert.equal(again.body.included_engagement_id, 301);
  const notMine = await f.billing(id, { billing_state: 'included', engagement_id: 302 });
  assert.equal(notMine.status, 404);
  assert.equal(f.stored(id).included_engagement_id, 301);
  // Someone else's booking is Not Found too.
  assert.equal((await f.billing(id, { billing_state: 'included' }, OTHER_ADVISOR)).status, 404);
  // A booking made before this existed, whatever its offer said, is not included.
  const old = f.booking(2);
  f.db.prepare(`UPDATE advisor_bookings SET offer_json = '{"session_type_id":1,"name":"Retainer call","pricing":"included"}' WHERE id = ?`).run(old);
  const ledger = (await f.call(ADVISOR, 'GET', '/me/ledger')).body;
  assert.equal(ledger.lines.items.find((l: any) => l.id === old).billing_state, 'unpriced');
  assert.equal(ledger.totals.included_sessions, 1);
});
