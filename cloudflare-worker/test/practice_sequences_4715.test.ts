/**
 * #4715 item 8 — the Practice action SEQUENCES the audit reproduced, run end to
 * end through the mounted advisor router on the migrated schema. Each test is
 * a legal series of presses, not one route in isolation:
 *
 *   1. send → relink → recipient read
 *   2. price → platform-rate change → billing-state edit
 *   3. complete racing confirm
 *   4. signed → intermediate lane → end
 *   6. empty account → first engagement and first deliverable
 *   7. block → booking attempt
 *
 * (5, the period switch before its response returns, is a page sequence and
 * lives in frontend/test/practice_sequences_4715.test.mjs.)
 *
 * Synthetic rows only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/practice_sequences_4715.test.ts
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
const NOW = Date.now();
const at = (days: number, minutes = 0) => new Date(NOW + days * 86_400_000 + minutes * 60_000).toISOString();
const ADVISOR = 21, A = 11, B = 12;

// 11 and 12 are founders who have both booked the advisor (21, row 201), so either may be linked to an engagement.
function fixture() {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO founders(id,name,email) VALUES (101,'One','one@example.test'),(102,'Two','two@example.test');
    INSERT INTO users(id,name,email,role,founder_id,is_active,subscription_tier) VALUES
      (11,'Founder A','fa@example.test','founder',101,1,'studio'),
      (12,'Founder B','fb@example.test','founder',102,1,'studio'),
      (21,'Advisor','a@example.test','advisor',NULL,1,'studio');
    INSERT INTO advisors(id,uid,user_id,display_name,email,is_active) VALUES (201,'a-1',21,'Advisor','a@example.test',1);
    UPDATE users SET advisor_id = 201 WHERE id = 21;
  `);
  const slot = db.prepare('INSERT INTO advisor_office_hour_slots(id,uid,advisor_id,starts_at,ends_at,capacity) VALUES (?,?,?,?,?,?)');
  const booking = db.prepare('INSERT INTO advisor_bookings(id,uid,slot_id,advisor_id,founder_user_id,status) VALUES (?,?,?,?,?,?)');
  slot.run(1, 's-1', 201, at(-10), at(-10, 60), 2);
  booking.run(1, 'b-1', 1, 201, A, 'completed');
  booking.run(2, 'b-2', 1, 201, B, 'completed');
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
    try { return { status: res.status, body: JSON.parse(text) as any }; } catch { throw new Error(`${method} ${path} ${res.status}: ${text.slice(0, 200)}`); }
  };
  const ok = (r: { status: number; body: any }, what: string) => { assert.ok(r.status >= 200 && r.status < 300, `${what}: ${r.status} ${JSON.stringify(r.body)}`); return r.body; };
  return { db, env, call, ok, slot, booking };
}

test('1. send → relink → recipient read: the version stays with the client it was sent to', async () => {
  const f = fixture();
  const eng = f.ok(await f.call(ADVISOR, 'POST', '/me/engagements', { client_name: 'Synthetic Co', shape: 'sprint' }), 'create engagement');
  f.ok(await f.call(ADVISOR, 'PATCH', `/me/engagements/${eng.id}`, { founder_user_id: A }), 'link A');
  const d = f.ok(await f.call(ADVISOR, 'POST', '/me/deliverables', { title: 'Synthetic plan', engagement_id: eng.id, link_url: 'https://docs.example.test/plan' }), 'create deliverable');
  f.ok(await f.call(ADVISOR, 'POST', `/me/deliverables/${d.id}/versions/1/send`), 'send v1');
  // The advisor relinks the engagement to another client after sending.
  f.ok(await f.call(ADVISOR, 'PATCH', `/me/engagements/${eng.id}`, { founder_user_id: B }), 'relink to B');
  const forA = f.ok(await f.call(A, 'GET', '/received/deliverables'), 'A reads');
  const forB = f.ok(await f.call(B, 'GET', '/received/deliverables'), 'B reads');
  assert.equal(forA.items.length, 1, 'the client it was sent to still holds it');
  assert.equal(forB.items.length, 0, 'the newly linked client was never sent it');
  // And the receipt is the recipient's to record, not the new link's.
  const uid = forA.items[0].versions[0].uid; // the receipt names a version, not the work product
  assert.notEqual((await f.call(B, 'POST', `/received/deliverables/${uid}/open`)).status, 200);
  f.ok(await f.call(A, 'POST', `/received/deliverables/${uid}/open`), 'A opens');
});

test('2. price → platform-rate change → billing-state edit: the priced rate and cut stand', async () => {
  const f = fixture();
  f.db.exec("INSERT INTO platform_settings(key,value) VALUES ('advisor_take_rate_bps','1500')");
  const priced = f.ok(await f.call(ADVISOR, 'PATCH', '/me/bookings/1/billing', { amount_cents: 20000 }), 'price');
  assert.equal(priced.take_rate_bps, 1500);
  assert.equal(priced.platform_cut_cents, 3000);
  // The operator moves the platform rate.
  f.db.exec("UPDATE platform_settings SET value = '1200' WHERE key = 'advisor_take_rate_bps'");
  const collected = f.ok(await f.call(ADVISOR, 'PATCH', '/me/bookings/1/billing', { billing_state: 'collected' }), 'collect');
  assert.equal(collected.billing_state, 'collected');
  assert.equal(collected.take_rate_bps, 1500, 'a status edit keeps the rate the line was priced at');
  assert.equal(collected.platform_cut_cents, 3000);
  // A settled line cannot be repriced at the new rate either.
  const reprice = await f.call(ADVISOR, 'PATCH', '/me/bookings/1/billing', { amount_cents: 25000, reprice: true });
  assert.equal(reprice.status, 409);
  assert.equal(reprice.body.code, 'settled_price');
});

test('3. complete racing confirm: one wins, the other is told, and the row is one or the other', async () => {
  const f = fixture();
  f.slot.run(2, 's-2', 201, at(2), at(2, 60), 1);
  f.booking.run(3, 'b-3', 2, 201, A, 'pending');
  const [confirm, complete] = await Promise.all([
    f.call(ADVISOR, 'POST', '/bookings/3/confirm', {}),
    f.call(ADVISOR, 'POST', '/bookings/3/complete', {}),
  ]);
  const statuses = [confirm.status, complete.status].sort();
  const row = f.db.prepare('SELECT status FROM advisor_bookings WHERE id = 3').get() as any;
  if (statuses[0] === 200 && statuses[1] === 200) {
    // Serialised: confirm then complete is a legal series and ends completed.
    assert.equal(row.status, 'completed');
  } else {
    assert.deepEqual(statuses, [200, 409], 'the loser is refused, not silently applied');
    assert.equal(row.status, confirm.status === 200 ? 'confirmed' : 'completed');
  }
  // Either way the booking is not pending, and a second confirm is refused.
  assert.notEqual(row.status, 'pending');
  if (row.status === 'completed') assert.equal((await f.call(ADVISOR, 'POST', '/bookings/3/confirm', {})).status, 409);
});

test('3b. a complete that lands between confirm’s read and its write wins; the confirm changes nothing', async () => {
  const f = fixture();
  f.slot.run(2, 's-2', 201, at(2), at(2, 60), 1);
  f.booking.run(3, 'b-3', 2, 201, A, 'pending');
  const prepare = f.env.DB.prepare.bind(f.env.DB);
  let injected = false;
  f.env.DB.prepare = (sql: string) => {
    if (!injected && /^\s*UPDATE advisor_bookings SET status = \?/.test(sql)) {
      injected = true;
      f.db.prepare("UPDATE advisor_bookings SET status = 'completed' WHERE id = 3").run();
    }
    return prepare(sql);
  };
  const confirm = await f.call(ADVISOR, 'POST', '/bookings/3/confirm', {});
  assert.ok(injected, 'the confirm reached its write');
  assert.equal(confirm.status, 409);
  const row = f.db.prepare('SELECT status, advisor_decision FROM advisor_bookings WHERE id = 3').get() as any;
  assert.equal(row.status, 'completed', 'the completion is not undone by a stale confirm');
  assert.equal(row.advisor_decision, null, 'and no acceptance is recorded for a confirm that did not happen');
});

test('4. signed → renewal due → ended: the end is a recorded decision and the lane is final', async () => {
  const f = fixture();
  const e = f.ok(await f.call(ADVISOR, 'POST', '/me/engagements', { client_name: 'Synthetic Co', shape: 'retainer' }), 'create');
  const signed = f.ok(await f.call(ADVISOR, 'POST', `/me/engagements/${e.id}/advance`, { lane: 'signed', expected_lane: 'drafting' }), 'sign');
  const due = f.ok(await f.call(ADVISOR, 'POST', `/me/engagements/${e.id}/advance`, { lane: 'renewal_due', expected_lane: 'signed' }), 'renewal due');
  assert.equal(due.cycles, signed.cycles, 'the intermediate lane is not a term');
  // Ending is not a lane move from here.
  assert.equal((await f.call(ADVISOR, 'POST', `/me/engagements/${e.id}/advance`, { lane: 'ended' })).status, 409);
  const ended = f.ok(await f.call(ADVISOR, 'POST', `/me/engagements/${e.id}/renewal`, { decision: 'ended', end_reason: 'did_not_renew', expected_cycles: due.cycles }), 'end');
  assert.equal(ended.lane, 'ended');
  assert.equal(ended.outcome, 'ended');
  const kinds = f.ok(await f.call(ADVISOR, 'GET', `/me/engagements/${e.id}/events`), 'history').items.map((x: any) => x.kind);
  assert.deepEqual(kinds, ['signed', 'ended']);
  assert.equal((await f.call(ADVISOR, 'POST', `/me/engagements/${e.id}/advance`, { lane: 'signed' })).status, 409, 'ended is final');
});

test('6. empty account → first engagement and first deliverable: counts read none, then one', async () => {
  const f = fixture();
  const none = f.ok(await f.call(ADVISOR, 'GET', '/me/engagements'), 'empty engagements');
  assert.equal(none.items.length, 0);
  assert.equal(none.page.total, 0);
  const noneD = f.ok(await f.call(ADVISOR, 'GET', '/me/deliverables'), 'empty deliverables');
  assert.equal(noneD.items.length, 0);
  const e = f.ok(await f.call(ADVISOR, 'POST', '/me/engagements', { client_name: 'First Co', shape: 'per_call' }), 'first engagement');
  f.ok(await f.call(ADVISOR, 'POST', '/me/deliverables', { title: 'First memo', engagement_id: e.id }), 'first deliverable');
  const one = f.ok(await f.call(ADVISOR, 'GET', '/me/engagements'), 'one engagement');
  assert.equal(one.items.length, 1);
  assert.equal(one.page.total, 1);
  const oneD = f.ok(await f.call(ADVISOR, 'GET', '/me/deliverables'), 'one deliverable');
  assert.equal(oneD.items.length, 1);
  assert.equal(oneD.items[0].client_name, 'First Co', 'the deliverable takes its engagement’s client');
});

test('7. block → booking attempt: a blocked hour is refused by slot and keeps no booking', async () => {
  const f = fixture();
  f.slot.run(3, 's-3', 201, at(3), at(3, 60), 1);
  f.ok(await f.call(ADVISOR, 'POST', '/me/slots/block', { from: at(3, -1), until: at(3, 61), reason: 'Synthetic: away' }), 'block');
  const tried = await f.call(A, 'POST', '/slots/3/book', { topic: 'Synthetic' });
  assert.equal(tried.status, 409);
  assert.equal(tried.body.code, 'slot_blocked');
  assert.ok(!JSON.stringify(tried.body).includes('Synthetic: away'), 'the advisor’s reason is not repeated to the client');
  assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM advisor_bookings WHERE slot_id = 3').get() as any).n, 0);
  const listed = f.ok(await f.call(A, 'GET', '/a-1/slots'), 'slot list').items.map((s: any) => s.uid);
  assert.ok(!listed.includes('s-3'), 'and the blocked hour is not offered');
});
