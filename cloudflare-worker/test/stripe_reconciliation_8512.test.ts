/**
 * D8512 (#8512): the Stripe webhook's read-only reconciliation. Fixtures for
 * both sides: a fake `GET /v1/events` and a D1 over node:sqlite. No Stripe
 * call leaves the process, and nothing is written.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';
import stripe from '../src/routes/admin_stripe.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import {
  DELIVERY_GRACE_MINUTES, RECONCILE_WINDOW_HOURS,
  classifyStripeReconciliation, readLocalSide, readStripeSide,
} from '../src/services/stripeReconciliation.ts';

const JWT = 's'.repeat(64);
// The route and the receipt reads use the real clock (Date.now, SQLite datetime('now')), so event times are set relative to it.
const NOW = Math.floor(Date.now() / 1000); // clock-ok: relative
const SETTLED = NOW - (DELIVERY_GRACE_MINUTES + 5) * 60;
const FRESH = NOW - 60;
const EVENT_IDS = ['evt_fixture_paid', 'evt_fixture_failed'];

function database() {
  const db = loadSchema(new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true }));
  db.exec(`INSERT INTO users(id,uid,name,email,role,is_active) VALUES (1,'holder8512','Holder','holder@example.invalid','admin',1),
      (2,'plain8512','Admin','plain@example.invalid','admin',1);
    INSERT INTO super_admins(user_id) VALUES(1);
    INSERT INTO user_sessions(user_id,jti,factor,created_at) VALUES(1,'fresh','totp',datetime('now')),(2,'plain','totp',datetime('now'));`);
  return db;
}
const receipt = (db: DatabaseSync, id: string, opts: { handled?: boolean; livemode?: 0 | 1; age?: string } = {}) => db.prepare(
  `INSERT INTO stripe_webhook_events(event_id,type,livemode,received_at,handled_at) VALUES (?,?,?,datetime('now',?),${opts.handled === false ? 'NULL' : "datetime('now')"})`,
).run(id, 'invoice.paid', opts.livemode ?? 1, opts.age ?? '-1 hours');
const events = (...list: Array<[string, number]>) => async () => ({ data: list.map(([id, created]) => ({ id, created })), has_more: false });

async function reconcile(db: DatabaseSync, get: Parameters<typeof readStripeSide>[0], livemode = true) {
  const env: any = { DB: d1Over(db) };
  return classifyStripeReconciliation(await readStripeSide(get, ['invoice.paid'], NOW), await readLocalSide(env, livemode), NOW);
}

test('no events expected: Stripe created nothing and no paying subscription is on record', async () => {
  const db = database();
  const r = await reconcile(db, events());
  assert.equal(r.state, 'no_events_expected');
  assert.equal(r.stripe_events, 0);
  assert.equal(r.paying_subscriptions, 0);
  // An event still inside the grace is not yet anyone's failure.
  assert.equal((await reconcile(db, events(['evt_fixture_fresh', FRESH]))).state, 'no_events_expected');
});

test('a paying subscription with a quiet window is reconciled, not "no events expected"', async () => {
  const db = database();
  db.exec(`INSERT INTO account_subscriptions(user_id,plan_group,plan,status,subscription_id) VALUES (1,'advisor','advisor_pro','active','sub_fixture')`);
  const r = await reconcile(db, events());
  assert.equal(r.paying_subscriptions, 1);
  assert.equal(r.state, 'reconciled');
});

test('every settled event received and finished is reconciled', async () => {
  const db = database();
  for (const id of EVENT_IDS) receipt(db, id);
  const r = await reconcile(db, events([EVENT_IDS[0], SETTLED], [EVENT_IDS[1], SETTLED]));
  assert.equal(r.state, 'reconciled');
  assert.deepEqual([r.stripe_events, r.receipted, r.not_received, r.unfinished], [2, 2, 0, 0]);
});

test('delivery failed or absent: Stripe shows a settled event no receipt holds', async () => {
  const db = database();
  receipt(db, EVENT_IDS[0]);
  const r = await reconcile(db, events([EVENT_IDS[0], SETTLED], [EVENT_IDS[1], SETTLED]));
  assert.equal(r.state, 'delivery_failed_or_absent');
  assert.equal(r.not_received, 1);
  // A receipt older than the window does not count for an event in it.
  const old = database();
  receipt(old, EVENT_IDS[1], { age: `-${RECONCILE_WINDOW_HOURS + 1} hours` });
  assert.equal((await reconcile(old, events([EVENT_IDS[1], SETTLED]))).state, 'delivery_failed_or_absent');
});

test('accepted but state missing: a receipt taken and never finished', async () => {
  const db = database();
  receipt(db, EVENT_IDS[0], { handled: false });
  const r = await reconcile(db, events([EVENT_IDS[0], SETTLED]));
  assert.equal(r.state, 'accepted_state_missing');
  assert.equal(r.unfinished, 1);
  assert.equal(r.not_received, 0);
  // Missing a delivery outranks a missing state.
  assert.equal((await reconcile(db, events([EVENT_IDS[0], SETTLED], [EVENT_IDS[1], SETTLED]))).state, 'delivery_failed_or_absent');
  // An unfinished receipt Stripe's page no longer lists still counts.
  const stale = database();
  receipt(stale, 'evt_fixture_stale', { handled: false, age: '-5 days' });
  assert.equal((await reconcile(stale, events())).state, 'accepted_state_missing');
  // A receipt inside the grace, or one being worked on now, is not yet missing anything.
  const busy = database();
  receipt(busy, 'evt_fixture_just_in', { handled: false, age: '-1 minutes' });
  receipt(busy, 'evt_fixture_working', { handled: false });
  busy.exec(`UPDATE stripe_webhook_events SET processing_uid = 'p', processing_until = datetime('now', '+5 minutes') WHERE event_id = 'evt_fixture_working'`);
  const r2 = await reconcile(busy, events());
  assert.equal(r2.unfinished, 0);
  assert.equal(r2.state, 'no_events_expected');
});

test('a receipt of the other mode, which the webhook ignores, is not "state missing"', async () => {
  const db = database();
  receipt(db, 'evt_fixture_testmode', { handled: false, livemode: 0 });
  assert.equal((await reconcile(db, events(), true)).state, 'no_events_expected');
  assert.equal((await reconcile(db, events(), false)).state, 'accepted_state_missing');
});

test('an unreadable side is unreadable, never a clean state', async () => {
  const db = database();
  assert.equal((await reconcile(db, async () => { throw new Error('stripe down'); })).state, 'unreadable');
  assert.equal((await reconcile(db, async () => ({ error: 'x' }) as any)).state, 'unreadable');
  assert.equal((await reconcile(db, async () => ({ data: [{ id: 7, created: SETTLED }] }) as any)).state, 'unreadable');
  db.exec('DROP TABLE stripe_webhook_events');
  const r = await reconcile(db, events());
  assert.equal(r.state, 'unreadable');
  assert.equal(r.stripe_events, null);
});

test('the Stripe read is one GET of the subscribed types in the window', async () => {
  const seen: Array<[string, Record<string, string>]> = [];
  const side = await readStripeSide(async (path, query) => { seen.push([path, query]); return { data: [], has_more: true }; }, ['invoice.paid', 'invoice.payment_failed'], NOW);
  assert.deepEqual(side, { available: true, events: [], truncated: true });
  assert.equal(seen.length, 1);
  assert.equal(seen[0][0], '/events');
  assert.equal(seen[0][1]['created[gte]'], String(NOW - RECONCILE_WINDOW_HOURS * 3600));
  assert.equal(seen[0][1]['types[0]'], 'invoice.paid');
  assert.equal(seen[0][1]['types[1]'], 'invoice.payment_failed');
});

test('GET /reconciliation: Super Admin only, GET only to Stripe, and no id, key or payload in the answer', async (t) => {
  const db = database();
  receipt(db, EVENT_IDS[0]);
  const key = 'sk_live_' + 'k'.repeat(24);
  const env: any = { DB: d1Over(db), JWT_SECRET: JWT, ENVIRONMENT: 'test', APP_URL: 'https://axal.test', STRIPE_SECRET_KEY: key };
  const app = new Hono<any>();
  app.onError((e: any, c) => c.json({ detail: AUTH_ERROR_STATUSES[e.message] ? e.message : 'unhandled' }, AUTH_ERROR_STATUSES[e.message] ?? 500));
  app.route('/api/admin/stripe', stripe);
  const calls: Array<{ method: string; path: string; types: string[] }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://api.stripe.com');
    calls.push({ method: init?.method ?? 'GET', path: url.pathname, types: [...url.searchParams.entries()].filter(([k]) => k.startsWith('types')).map(([, v]) => v) });
    return new Response(JSON.stringify({ data: [{ id: EVENT_IDS[0], created: SETTLED, data: { object: { customer: 'cus_fixture' } } }, { id: EVENT_IDS[1], created: SETTLED }], has_more: false }), { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; db.close(); });
  const as = async (who: number, jti: string) => {
    const token = await new SignJWT({ user_id: who, jti }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT));
    return app.request('/api/admin/stripe/reconciliation', { headers: { Authorization: `Bearer ${token}` } }, env);
  };
  assert.equal((await as(2, 'plain')).status, 403);
  assert.equal(calls.length, 0, 'a refused caller reaches no Stripe read');
  const res = await as(1, 'fresh');
  assert.equal(res.status, 200);
  const text = await res.text();
  const body = JSON.parse(text);
  assert.equal(body.state, 'delivery_failed_or_absent');
  assert.equal(body.mode, 'live');
  assert.deepEqual(calls.map((c) => [c.method, c.path]), [['GET', '/v1/events']]);
  assert.ok(calls[0].types.includes('invoice.paid') && calls[0].types.includes('checkout.session.completed'));
  for (const secret of [...EVENT_IDS, 'cus_fixture', key]) assert.ok(!text.includes(secret), `the answer holds no ${secret.slice(0, 4)}…`);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM stripe_webhook_events').get()!.n, 1, 'nothing is written');
});

test('GET /reconciliation with no Stripe key is unreadable and calls nothing', async (t) => {
  const db = database();
  const env: any = { DB: d1Over(db), JWT_SECRET: JWT, ENVIRONMENT: 'test' };
  const app = new Hono<any>();
  app.route('/api/admin/stripe', stripe);
  const originalFetch = globalThis.fetch;
  let called = 0;
  globalThis.fetch = (async () => { called += 1; throw new Error('no call expected'); }) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; db.close(); });
  const token = await new SignJWT({ user_id: 1, jti: 'fresh' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT));
  const body = await (await app.request('/api/admin/stripe/reconciliation', { headers: { Authorization: `Bearer ${token}` } }, env)).json() as any;
  assert.equal(body.mode, 'unconfigured');
  assert.equal(body.state, 'unreadable');
  assert.equal(called, 0);
});
