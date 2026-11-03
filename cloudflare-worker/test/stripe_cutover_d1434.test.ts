/** D1434 (#3703, part 2): the owner-run Stripe mode cutover, and Q2 = B's portal plan switch. No live Stripe calls. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';
import stripe from '../src/routes/admin_stripe.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { subscriptionPlanEvent } from '../src/services/planSubscription.ts';
import { CUTOVER_NOTICE } from '../src/services/stripeCutover.ts';
import { aiTopupUnitPriceId, aiTopupUnitRaw } from '../src/services/aiTopups.ts';

const JWT = 's'.repeat(64);
const REASON = 'Production moves to the live Stripe account';
const response = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });

const DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  const rows = db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END").all() as Array<{ sql: string }>;
  db.close();
  return rows.map((r) => r.sql);
})();

/** Synthetic sandbox-era records, one of each kind the cutover must handle. */
function seed(db: DatabaseSync) {
  db.exec(`INSERT INTO users(id,uid,name,email,role,is_active) VALUES
    (1,'holder1434','Holder','holder@example.invalid','admin',1),
    (2,'plain1434','Admin','plain@example.invalid','admin',1);
    INSERT INTO super_admins(user_id) VALUES(1);
    INSERT INTO user_sessions(user_id,jti,factor,created_at) VALUES(1,'fresh','totp',datetime('now')),
      (1,'stale','totp',datetime('now','-2 days')),(2,'plain','totp',datetime('now'));`);
  db.exec(`INSERT INTO users(id,uid,name,email,role,is_active,subscription_tier,subscription_status,stripe_customer_id,stripe_subscription_id) VALUES
    (10,'f10','Paid Founder','f10@example.invalid','founder',1,'studio','active','cus_t10','sub_t10'),
    (11,'f11','Comp Founder','f11@example.invalid','founder',1,'growth','active',NULL,NULL),
    (12,'f12','Pack Buyer','f12@example.invalid','founder',1,'free','active','cus_t12',NULL);
    INSERT INTO users(id,uid,name,email,role,is_active,investor_tier,investor_subscription_status,investor_stripe_customer_id,investor_stripe_subscription_id) VALUES
    (20,'i20','Paid Investor','i20@example.invalid','investor',1,'professional','active','cus_t20','sub_t20');
    INSERT INTO users(id,uid,name,email,role,is_active,investor_tier,investor_subscription_status,investor_seat_primary_user_id) VALUES
    (21,'i21','Seat Colleague','i21@example.invalid','investor',1,'professional','active',20);
    INSERT INTO users(id,uid,name,email,role,is_active) VALUES
    (30,'a30','Paid Advisor','a30@example.invalid','advisor',1),
    (40,'m40','MI Reader','m40@example.invalid','founder',1);
    INSERT INTO account_subscriptions(user_id,plan_group,plan,status,subscription_id,stripe_customer_id) VALUES(30,'advisor','advisor_pro','active','sub_t30','cus_t30');
    INSERT INTO mi_pro_subscriptions(user_id,status,subscription_id,plan,stripe_customer_id) VALUES(40,'active','sub_t40','mi_pro_monthly','cus_t40');
    INSERT INTO member_ai_auto_reload(user_id,enabled,pack_uid,threshold_microusd,stripe_payment_method) VALUES(12,1,'pack-uid',1000000,'pm_t12');
    INSERT INTO billing_alerts(user_id,kind,state,object_id,subscription_id) VALUES(10,'payment_failed','open','in_t10','sub_t10');
    INSERT INTO member_subscription_amounts(subscription_id,user_id,plan_family,amount_cents,interval,status) VALUES('sub_t10',10,'founder',4900,'month','active');
    INSERT INTO stripe_products(id,name,kind,active,metadata_json,prices_json,livemode) VALUES
      ('prod_t1','Studio','subscription',1,'{}','[]',0),('prod_t2','Pack','alacarte',1,'{}','[]',0);
    INSERT INTO ai_token_packs(price_id,product_id,face_cents,on_sale,sort,origin) VALUES
      ('price_tpack10','prod_tpack10',1000,1,10,'adopted'),('price_tpack25','prod_tpack25',2500,1,20,'created');
    INSERT INTO ai_token_packs(price_id,product_id,face_cents,on_sale,sort,origin,archived_at) VALUES
      ('price_tpackold','prod_tpackold',5000,0,30,'created','2026-10-01 00:00:00');`);
}

function world(t: any, opts: { live?: boolean; noKey?: boolean } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const sql of DDL) db.exec(sql);
  seed(db);
  const kv = new Map<string, string>([['cache:catalog:live:test', '[]'], ['cache:catalog:live:live', '[]']]);
  const env: any = {
    DB: d1Over(db), JWT_SECRET: JWT, ENVIRONMENT: 'test', APP_URL: 'https://axal.test',
    STRIPE_SECRET_KEY: opts.noKey ? undefined : opts.live === false ? 'sk_test_' + 'x'.repeat(24) : 'sk_live_' + 'x'.repeat(24),
    RATE_LIMITS: { async get(k: string) { return kv.get(k) ?? null; }, async put(k: string, v: string) { kv.set(k, v); }, async delete(k: string) { kv.delete(k); } },
  };
  const app = new Hono<any>();
  app.onError((e: any, c) => c.json({ detail: AUTH_ERROR_STATUSES[e.message] ? e.message : 'unhandled' }, AUTH_ERROR_STATUSES[e.message] ?? 500));
  app.route('/api/admin/stripe', stripe);
  const calls: string[] = [];
  let syncFails = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://api.stripe.com', 'only the Stripe mock is used');
    calls.push(url.pathname);
    if (syncFails) return new Response('{"error":{"message":"down"}}', { status: 500 });
    if (url.pathname === '/v1/products' || url.pathname === '/v1/prices') return response({ data: [], has_more: false });
    throw new Error('Unexpected Stripe fixture request');
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; db.close(); });
  async function call(method: string, body?: unknown, who = 1, jti = 'fresh') {
    const token = await new SignJWT({ user_id: who, jti }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt()
      .setExpirationTime('1h').sign(new TextEncoder().encode(JWT));
    return app.request('/api/admin/stripe/cutover', { method, headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) }, env);
  }
  const one = (sql: string) => ({ ...(db.prepare(sql).get() as any) });
  const audits = () => db.prepare("SELECT action, details FROM activity_logs WHERE action = 'stripe_mode_cutover'").all() as any[];
  return { db, env, kv, calls, call, one, audits, failSync() { syncFails = true; } };
}

const GO = { to_mode: 'live', confirm: 'live', reason: REASON };

test('GET /cutover counts what a move would clear, for the holder only', async (t) => {
  const w = world(t);
  const res = await w.call('GET');
  assert.equal(res.status, 200);
  const body = await res.json() as any;
  assert.equal(body.mode, 'live');
  assert.equal(body.stored_mode, 'test');
  assert.equal(body.last_cutover, null);
  // customers: f10, f12, i20, account 30, mi 40. subscriptions: f10, i20, 30, 40.
  // plans: f10, i20, seat i21, account 30, mi 40 (comp founder f11 is not one).
  assert.deepEqual(body.would_clear, { customers: 5, subscriptions: 4, plans: 5, mirror_rows: 2, packs: 2 });
  assert.equal((await w.call('GET', undefined, 2, 'plain')).status, 403);
  assert.equal(w.calls.length, 0);
});

test('an unreadable count is a 503, never 0', async (t) => {
  const w = world(t);
  w.db.exec('DROP TABLE stripe_products');
  const get = await w.call('GET');
  assert.equal(get.status, 503);
  assert.equal((await get.json() as any).error, 'cutover_unreadable');
  const post = await w.call('POST', GO);
  assert.equal(post.status, 503);
  assert.equal(w.one('SELECT COUNT(*) AS n FROM stripe_mode_cutovers').n, 0);
  assert.equal(w.one("SELECT subscription_tier AS t FROM users WHERE id = 10").t, 'studio');
});

test('POST /cutover refuses before changing anything', async (t) => {
  const cases: Array<[string, any, number, string, { who?: number; jti?: string; live?: boolean; noKey?: boolean }?]> = [
    ['no write bar (stale session)', GO, 403, 'step_up_required', { jti: 'stale' }],
    ['not the holder', GO, 403, '', { who: 2, jti: 'plain' }],
    ['no reason', { to_mode: 'live', confirm: 'live' }, 400, 'reason_required'],
    ['unknown mode', { to_mode: 'prod', confirm: 'prod', reason: REASON }, 400, 'invalid_mode'],
    ['confirmation typed wrong', { to_mode: 'live', confirm: 'yes', reason: REASON }, 400, 'confirm_mismatch'],
    ['keys still in test', GO, 409, 'cutover_keys_not_live', { live: false }],
    ['no secret key', GO, 503, 'stripe_not_configured', { noKey: true }],
  ];
  for (const [name, body, status, error, o = {}] of cases) {
    await t.test(name, async (tt) => {
      const w = world(tt, { live: o.live, noKey: o.noKey });
      const res = await w.call('POST', body, o.who ?? 1, o.jti ?? 'fresh');
      assert.equal(res.status, status);
      const json = await res.json() as any;
      if (error) assert.equal(json.error ?? json.detail, error);
      assert.equal(w.one('SELECT COUNT(*) AS n FROM stripe_mode_cutovers').n, 0);
      assert.equal(w.one('SELECT stripe_subscription_id AS s FROM users WHERE id = 10').s, 'sub_t10');
      assert.equal(w.one('SELECT COUNT(*) AS n FROM stripe_products').n, 2);
      assert.equal(w.audits().length, 0);
      assert.equal(w.calls.length, 0);
    });
  }
});

test('a cutover resets sandbox-paid plans, clears the ids, records, audits, notifies and resyncs', async (t) => {
  const w = world(t);
  const res = await w.call('POST', GO);
  assert.equal(res.status, 200);
  const body = await res.json() as any;
  assert.equal(body.from_mode, 'test');
  assert.equal(body.to_mode, 'live');
  assert.deepEqual(
    [body.customers_cleared, body.subscriptions_cleared, body.plans_reset, body.mirror_rows_dropped, body.cards_cleared, body.alerts_closed, body.packs_archived],
    [5, 4, 5, 2, 1, 1, 2],
  );

  // Q1 = A: every sandbox-paid plan is free again.
  assert.deepEqual(w.one('SELECT subscription_tier AS t, subscription_status AS s, stripe_customer_id AS c, stripe_subscription_id AS sub FROM users WHERE id = 10'),
    { t: 'free', s: 'cancelled', c: null, sub: null });
  assert.deepEqual(w.one('SELECT investor_tier AS t, investor_stripe_customer_id AS c, investor_stripe_subscription_id AS sub FROM users WHERE id = 20'),
    { t: 'free', c: null, sub: null });
  assert.equal(w.one('SELECT investor_tier AS t FROM users WHERE id = 21').t, 'free', 'the seat colleague follows the primary');
  assert.deepEqual(w.one('SELECT status, subscription_id AS sub, stripe_customer_id AS c FROM account_subscriptions WHERE user_id = 30'),
    { status: 'free', sub: null, c: null });
  assert.deepEqual(w.one('SELECT status, subscription_id AS sub, stripe_customer_id AS c FROM mi_pro_subscriptions WHERE user_id = 40'),
    { status: 'free', sub: null, c: null });
  // A complimentary plan has no Stripe subscription, so it is kept.
  assert.equal(w.one('SELECT subscription_tier AS t FROM users WHERE id = 11').t, 'growth');
  // A pack buyer's sandbox customer is cleared; nothing else of theirs changes.
  assert.deepEqual(w.one('SELECT subscription_tier AS t, stripe_customer_id AS c FROM users WHERE id = 12'), { t: 'free', c: null });
  assert.deepEqual(w.one('SELECT enabled, stripe_payment_method AS pm, disabled_reason AS r FROM member_ai_auto_reload WHERE user_id = 12'),
    { enabled: 0, pm: null, r: 'stripe_mode_cutover' });
  assert.equal(w.one("SELECT state FROM billing_alerts WHERE object_id = 'in_t10'").state, 'closed');
  assert.equal(w.one("SELECT status FROM member_subscription_amounts WHERE subscription_id = 'sub_t10'").status, 'canceled');
  assert.equal(w.one('SELECT COUNT(*) AS n FROM stripe_products').n, 0);
  // The sandbox token packs leave the shelf, so HQ › Token packs creates them again in live.
  assert.equal(w.one('SELECT COUNT(*) AS n FROM ai_token_packs WHERE archived_at IS NULL OR on_sale = 1').n, 0);
  assert.equal(w.one("SELECT archived_at AS a FROM ai_token_packs WHERE price_id = 'price_tpackold'").a, '2026-10-01 00:00:00', 'an archived pack keeps its date');

  // One cutover row with the counts.
  const row = w.one('SELECT from_mode, to_mode, actor_user_id, reason, customers_cleared, subscriptions_cleared, plans_reset, mirror_rows_dropped FROM stripe_mode_cutovers');
  assert.deepEqual({ ...row }, { from_mode: 'test', to_mode: 'live', actor_user_id: 1, reason: REASON,
    customers_cleared: 5, subscriptions_cleared: 4, plans_reset: 5, mirror_rows_dropped: 2 });

  // One audit, one notice per member whose plan was reset, and a fresh catalogue.
  const audits = w.audits();
  assert.equal(audits.length, 1);
  assert.match(String(audits[0].details), /"plans_reset":5/);
  const notices = w.db.prepare('SELECT user_id, type, title, link FROM notifications_inbox ORDER BY user_id').all() as any[];
  assert.deepEqual(notices.map((n) => n.user_id), [10, 20, 21, 30, 40]);
  for (const n of notices) {
    assert.equal(n.type, CUTOVER_NOTICE.type);
    assert.equal(n.title, CUTOVER_NOTICE.title);
    assert.equal(n.link, '/pricing');
  }
  assert.equal(body.members_notified, 5);
  assert.equal(w.kv.has('cache:catalog:live:test'), false);
  assert.ok(w.calls.includes('/v1/products'), 'the catalogue is synced in the new mode');
  assert.equal(body.catalog_synced, 0);

  // A second run is refused and changes nothing.
  const again = await w.call('POST', GO);
  assert.equal(again.status, 409);
  assert.equal((await again.json() as any).error, 'cutover_already_done');
  assert.equal(w.one('SELECT COUNT(*) AS n FROM stripe_mode_cutovers').n, 1);
  assert.equal(w.audits().length, 1);

  // GET now reads the record and that nothing is left to clear.
  const after = await (await w.call('GET')).json() as any;
  assert.equal(after.stored_mode, 'live');
  assert.equal(after.last_cutover.to_mode, 'live');
  assert.deepEqual(after.would_clear, { customers: 0, subscriptions: 0, plans: 0, mirror_rows: 0, packs: 0 });
});

test('a catalogue that cannot be read after the batch is a 502, with the cutover recorded', async (t) => {
  const w = world(t);
  w.failSync();
  const res = await w.call('POST', GO);
  assert.equal(res.status, 502);
  assert.equal((await res.json() as any).error, 'cutover_sync_failed');
  assert.equal(w.one('SELECT COUNT(*) AS n FROM stripe_mode_cutovers').n, 1);
  assert.equal(w.one('SELECT subscription_tier AS t FROM users WHERE id = 10').t, 'free');
  assert.equal(w.audits().length, 1);
});

// --- Q2 = B: a plan switched in the Stripe portal keeps its checkout metadata.

function portalWorld(t: any) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const sql of DDL) db.exec(sql);
  const price = (id: string) => JSON.stringify([{ id, active: true, currency: 'usd', unit_amount: 4900, type: 'recurring', interval: 'month' }]);
  db.prepare(`INSERT INTO stripe_products(id,name,kind,active,metadata_json,prices_json,livemode) VALUES
    ('prod_growth','Growth','subscription',1,?,?,1),('prod_studio','Studio','subscription',1,?,?,1),
    ('prod_pro','Investor Professional','subscription',1,?,?,1)`)
    .run(JSON.stringify({ tier: 'growth' }), price('price_growth'), JSON.stringify({ tier: 'studio' }), price('price_studio'),
      JSON.stringify({ investor_tier: 'professional' }), price('price_pro'));
  const env: any = { DB: d1Over(db), STRIPE_SECRET_KEY: 'sk_live_' + 'x'.repeat(24),
    RATE_LIMITS: { async get() { return null; }, async put() {}, async delete() {} } };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('no Stripe call expected'); }) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; db.close(); });
  return env;
}
const sub = (metadata: Record<string, string>, priceId: string) => ({ id: 'sub_portal', metadata, items: { data: [{ price: { id: priceId } }] } });

test('Q2 = B: the item price wins over stale tier metadata on a portal switch', async (t) => {
  const env = portalWorld(t);
  const { meta } = await subscriptionPlanEvent(env, 'customer.subscription.updated',
    sub({ kind: 'tier', tier: 'growth', price_id: 'price_growth', user_id: '7' }, 'price_studio'));
  assert.equal(meta.tier, 'studio');
  assert.equal(meta.kind, 'tier');
  assert.equal(meta.price_id, 'price_studio');
  assert.equal(meta.user_id, '7', 'the rest of the metadata is kept');
});

test('Q2 = B: a price of another family, an unknown price or no switch leaves the metadata as it came', async (t) => {
  const env = portalWorld(t);
  const other = await subscriptionPlanEvent(env, 'customer.subscription.updated', sub({ kind: 'tier', tier: 'growth' }, 'price_pro'));
  assert.equal(other.meta.tier, 'growth');
  assert.equal(other.meta.investor_tier, undefined);
  const unknown = await subscriptionPlanEvent(env, 'customer.subscription.updated', sub({ kind: 'tier', tier: 'growth' }, 'price_missing'));
  assert.equal(unknown.meta.tier, 'growth');
  const same = await subscriptionPlanEvent(env, 'customer.subscription.updated', sub({ kind: 'tier', tier: 'growth', price_id: 'price_growth' }, 'price_growth'));
  assert.equal(same.meta.tier, 'growth');
  const notSub = await subscriptionPlanEvent(env, 'invoice.paid', sub({ kind: 'tier', tier: 'growth' }, 'price_studio'));
  assert.equal(notSub.meta.tier, 'growth');
});

// --- The custom-amount top-up reads the $1 unit price of the keys' own mode.

test('the $1 top-up unit price is read for the keys\' mode, so a live key never quotes the sandbox price', () => {
  const both = { STRIPE_PRICE_AI_TOPUP_UNIT: 'price_sandboxunit', STRIPE_PRICE_AI_TOPUP_UNIT_LIVE: 'price_liveunit' };
  assert.equal(aiTopupUnitPriceId({ ...both, STRIPE_SECRET_KEY: 'sk_test_' + 'x'.repeat(24) } as any), 'price_sandboxunit');
  assert.equal(aiTopupUnitPriceId({ ...both, STRIPE_SECRET_KEY: 'sk_live_' + 'x'.repeat(24) } as any), 'price_liveunit');
  assert.equal(aiTopupUnitPriceId({ ...both, STRIPE_SECRET_KEY: 'rk_live_' + 'x'.repeat(24) } as any), 'price_liveunit');
  // Live keys with no live unit price: not offered, never the sandbox one.
  assert.equal(aiTopupUnitPriceId({ STRIPE_PRICE_AI_TOPUP_UNIT: 'price_sandboxunit', STRIPE_SECRET_KEY: 'sk_live_' + 'x'.repeat(24) } as any), null);
  assert.equal(aiTopupUnitRaw({ STRIPE_PRICE_AI_TOPUP_UNIT: 'price_sandboxunit' } as any), 'price_sandboxunit', 'no key reads the test price');
});
