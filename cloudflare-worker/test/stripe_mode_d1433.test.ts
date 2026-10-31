/** D1433 (#3703): mode-safe checkouts and authenticated event receipts. No live Stripe calls. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import checkout from '../src/routes/billing_checkout.ts';
import billing from '../src/routes/billing.ts';
import orders from '../src/routes/orders.ts';
import { getCatalog, getLiveCatalog, fetchAndMirrorPrice, findCatalogProductByPriceId, syncCatalog, resetCatalogModeSyncWindow } from '../src/services/catalog.ts';
import { plansAndPacks } from '../src/services/aiCredits.ts';
import { keyReadiness, planReadiness } from '../src/services/stripeReadiness.ts';
import { PLAN_CATALOGUE, planByKey } from '../src/services/planCatalogue.ts';
import { catalogChecks } from '../src/services/paymentsCatalog.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(read('../sql/schema_baseline.sql'));
  for (const file of readdirSync(new URL('../sql/migrations/', import.meta.url))
    .filter(file => /^\d+_.*\.sql$/.test(file) && migrationNumber(file) > BASELINE_CUTOFF).sort(compareMigrations)) {
    db.exec(read('../sql/migrations/' + file));
  }
  const rows = db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END").all() as Array<{ sql: string }>;
  db.close();
  return rows.map(row => row.sql);
})();
const JWT = 'j'.repeat(64);
const SIGNING = 'w'.repeat(64);
const response = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });

function world(t: any, live = false) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const sql of DDL) db.exec(sql);
  db.exec(`INSERT INTO users(id,uid,name,email,role,is_active) VALUES
    (1,'founder1433','Synthetic Founder','founder@example.invalid','founder',1),
    (2,'investor1433','Synthetic Investor','investor@example.invalid','investor',1),
    (3,'advisor1433','Synthetic Advisor','advisor@example.invalid','advisor',1);
    INSERT INTO user_sessions(user_id,jti,factor,created_at) VALUES(1,'fresh1433f','totp',datetime('now')),
      (2,'fresh1433i','totp',datetime('now')),(3,'fresh1433a','totp',datetime('now'));`);
  const kv = new Map<string, string>();
  const env: any = { DB: d1Over(db), JWT_SECRET: JWT, ENVIRONMENT: 'test', APP_URL: 'https://axal.test',
    STRIPE_SECRET_KEY: live ? 'sk_live_' + 'x'.repeat(24) : 'sk_test_' + 'x'.repeat(24),
    STRIPE_PUBLISHABLE_KEY: live ? 'pk_live_' + 'p'.repeat(24) : 'pk_test_' + 'p'.repeat(24),
    STRIPE_WEBHOOK_SECRET: SIGNING,
    RATE_LIMITS: { async get(key: string) { return kv.get(key) ?? null; }, async put(key: string, value: string) { kv.set(key, value); }, async delete(key: string) { kv.delete(key); } },
  };
  const app = new Hono<any>();
  app.route('/api/billing', checkout);
  app.route('/api/billing', billing);
  app.route('/api/orders', orders);
  app.onError((_error, c) => c.json({ error: 'fixture_unhandled_error' }, 500));
  const calls: Array<{ path: string; method: string; body: string }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://api.stripe.com', 'only the Stripe mock is used');
    const path = url.pathname.replace(/^\/v1/, '');
    calls.push({ path, method: init.method ?? 'GET', body: String(init.body ?? '') });
    if (path === '/products' || path === '/prices') return response({ data: [], has_more: false });
    if (path === '/customers' && init.method === 'POST') return response({ id: 'cus_created1433' });
    if (path === '/subscriptions' && init.method === 'GET') return response({ data: [] });
    if (path === '/subscriptions' && init.method === 'POST') return response({ id: 'sub_created1433', status: 'incomplete',
      latest_invoice: { id: 'in_created1433', payment_intent: { id: 'pi_created1433', client_secret: 'synthetic-client-response' } } });
    if (path === '/billing_portal/sessions') return response({ url: 'https://billing.stripe.test/session' });
    throw new Error('Unexpected Stripe fixture request');
  }) as typeof fetch;
  resetCatalogModeSyncWindow();
  t.after(() => { globalThis.fetch = originalFetch; db.close(); resetCatalogModeSyncWindow(); });
  async function hit(path: string, body?: unknown, who = 1) {
    const role = (db.prepare('SELECT role FROM users WHERE id=?').get(who) as any).role;
    const token = await new SignJWT({ user_id: who, role, jti: who === 1 ? 'fresh1433f' : who === 2 ? 'fresh1433i' : 'fresh1433a' })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT));
    return app.request(path, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}) }, env);
  }
  async function webhook(event: unknown, age = 0) {
    const raw = JSON.stringify(event);
    const at = String(Math.floor(Date.now() / 1000) - age);
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SIGNING), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const bytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${at}.${raw}`));
    const signature = Array.from(new Uint8Array(bytes)).map(byte => byte.toString(16).padStart(2, '0')).join('');
    return app.request('/api/billing/stripe/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': `t=${at},v1=${signature}` }, body: raw }, env);
  }
  return { db, env, kv, app, calls, hit, webhook };
}
type World = ReturnType<typeof world>;
const price = (id: string, interval = 'month') => ({ id, active: true, currency: 'usd', unit_amount: 1000,
  type: 'recurring', interval, interval_count: 1, nickname: null });
function product(w: World, id = 'prod_growth1433', live: boolean | null = false, prices = [price('price_growth1433')], metadata = { tier: 'growth' }) {
  w.db.prepare(`INSERT INTO stripe_products(id,name,kind,active,metadata_json,prices_json,livemode)
    VALUES(?,?,'subscription',1,?,?,?)`).run(id, 'Synthetic plan', JSON.stringify(metadata), JSON.stringify(prices), live === null ? null : live ? 1 : 0);
}
const syntheticEvent = (id = 'evt_fixture1433', live = false) => ({ id, type: 'd1433.synthetic', livemode: live, data: { object: {} } });
const renewalEvent = () => ({ id: 'evt_renewal1433', type: 'invoice.payment_failed', livemode: false, data: { object: {
  id: 'in_renewal1433', subscription: 'sub_renewal1433', billing_reason: 'subscription_cycle', attempt_count: 1, amount_due: 1000, currency: 'usd',
} } });

test('691 stamps only historical rows as test; later unrecorded rows remain unknown', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(read('../sql/migrations/097_stripe_products.sql'));
    db.exec("INSERT INTO stripe_products(id,name) VALUES('prod_before1433','Synthetic before')");
    db.exec(read('../sql/migrations/691_stripe_mode_stamps.sql'));
    db.exec("INSERT INTO stripe_products(id,name) VALUES('prod_after1433','Synthetic after')");
    assert.deepEqual(db.prepare('SELECT livemode FROM stripe_products ORDER BY id').all().map((row: any) => row.livemode), [null, 0]);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM stripe_mode_cutovers').get().n, 0);
  } finally { db.close(); }
});

test('sync and individual price fetch stamp Stripe mode, isolate KV caches and discard old-mode prices', async t => {
  const w = world(t, true);
  product(w, 'prod_old1433', false);
  w.kv.set('cache:catalog:live:test', JSON.stringify([{ id: 'prod_cached_test1433', livemode: false }]));
  globalThis.fetch = (async (input: any) => {
    const path = new URL(String(input)).pathname;
    w.calls.push({ path, method: 'GET', body: '' });
    if (path === '/v1/products') return response({ data: [{ id: 'prod_live1433', name: 'Synthetic live', active: true, livemode: true, metadata: { tier: 'growth' } }], has_more: false });
    if (path === '/v1/prices') return response({ data: [{ ...price('price_live1433'), product: 'prod_live1433', recurring: { interval: 'month', interval_count: 1 }, livemode: true }], has_more: false });
    return response({ id: 'price_added1433', active: true, livemode: true, currency: 'usd', unit_amount: 500,
      type: 'one_time', recurring: null, nickname: null, product: { id: 'prod_live1433', name: 'Synthetic live', active: true, livemode: true } });
  }) as typeof fetch;
  assert.equal((await syncCatalog(w.env)).synced, 1);
  assert.deepEqual(w.db.prepare('SELECT id,livemode FROM stripe_products').all().map((row: any) => [row.id, row.livemode]), [['prod_live1433', 1]]);
  assert.ok(w.kv.has('cache:catalog:live:live'));
  assert.ok(w.kv.has('cache:catalog:live:test'));
  const before = w.calls.length;
  assert.equal((await getLiveCatalog(w.env))[0].id, 'prod_live1433');
  assert.equal(w.calls.length, before, 'the current-mode cache is used');
  assert.equal((await fetchAndMirrorPrice(w.env, 'price_added1433')).state, 'mirrored');
  assert.equal(w.db.prepare('SELECT livemode FROM stripe_products').get().livemode, 1);
  assert.equal(JSON.parse(w.db.prepare('SELECT prices_json FROM stripe_products').get().prices_json as string).length, 2);
});

test('every sellable plan is ready in both intervals only in its own mode', async t => {
  const w = world(t);
  for (const [index, entry] of PLAN_CATALOGUE.filter(entry => entry.sellable).entries()) {
    product(w, 'prod_matrix' + index, false, [price('price_matrix_m' + index), price('price_matrix_y' + index, 'year')], entry.matches! as any);
  }
  const products = await getCatalog(w.env, undefined, undefined, { sync: false });
  for (const entry of PLAN_CATALOGUE.filter(entry => entry.sellable)) {
    for (const interval of ['month', 'year'] as const) assert.deepEqual(await planReadiness(w.env, products, entry, interval), { state: 'ready' });
  }
  assert.deepEqual(catalogChecks(products, { accountMode: 'test', publishableMode: 'test', webhookConfigured: true }), []);
  const published = (await plansAndPacks(w.env)).plans.filter((plan: any) => plan.checkout);
  assert.equal(published.length, 6);
  assert.ok(published.every((plan: any) => plan.checkout.monthly === 'ready' && plan.checkout.yearly === 'ready'));
  assert.equal(w.calls.length, 0);
  w.env.STRIPE_SECRET_KEY = 'sk_live_' + 'x'.repeat(24);
  w.env.STRIPE_PUBLISHABLE_KEY = 'pk_live_' + 'p'.repeat(24);
  for (const entry of PLAN_CATALOGUE.filter(entry => entry.sellable)) assert.deepEqual(await planReadiness(w.env, products, entry, 'month'), { state: 'not_ready', reason: 'price_missing' });
  assert.ok((await plansAndPacks(w.env)).plans.filter((plan: any) => plan.checkout).every((plan: any) => plan.checkout.monthly === 'not_ready'));
  assert.equal(w.calls.length, 0);
});

test('single-price reads cannot import an opposite or unknown product/price mode', async t => {
  const w = world(t, true);
  product(w, 'prod_source1433', false, [price('price_wrong1433')]);
  product(w, 'prod_current1433', true, [price('price_current1433')]);
  // A failed healing attempt must not expose the opposite-mode lookup.
  globalThis.fetch = (async () => { throw new Error('Synthetic provider outage'); }) as typeof fetch;
  t.mock.method(console, 'warn', () => {});
  assert.equal(await findCatalogProductByPriceId(w.env, 'price_wrong1433'), null);
  assert.equal((await findCatalogProductByPriceId(w.env, 'price_current1433'))?.product.livemode, true);
  for (const [priceMode, productMode] of [[false, true], [true, false], [undefined, true], [true, undefined]]) {
    globalThis.fetch = (async () => response({ id: 'price_rejected1433', active: true, livemode: priceMode,
      currency: 'usd', unit_amount: 1000, type: 'one_time', recurring: null,
      product: { id: 'prod_source1433', name: 'Synthetic source', active: true, livemode: productMode } })) as typeof fetch;
    assert.deepEqual(await fetchAndMirrorPrice(w.env, 'price_rejected1433'), { state: 'mode_mismatch' });
    assert.equal(w.db.prepare("SELECT livemode FROM stripe_products WHERE id='prod_source1433'").get().livemode, 0);
  }
  globalThis.fetch = (async () => response({ id: 'price_rejected1433', active: true, livemode: true,
    currency: 'usd', unit_amount: 1000, type: 'one_time', recurring: null,
    product: { id: 'prod_source1433', name: 'Synthetic source', active: true, livemode: true } })) as typeof fetch;
  assert.equal((await fetchAndMirrorPrice(w.env, 'price_rejected1433')).state, 'mirrored');
  const replaced: any = w.db.prepare("SELECT livemode,prices_json FROM stripe_products WHERE id='prod_source1433'").get();
  assert.equal(replaced.livemode, 1);
  assert.deepEqual(JSON.parse(replaced.prices_json).map((price: any) => price.id), ['price_rejected1433']);
});

test('mismatched mirror refresh is bounded per mode/window, even when Stripe fails', async t => {
  const w = world(t, true);
  product(w, 'prod_other1433', false);
  product(w, 'prod_unknown1433', null);
  globalThis.fetch = (async () => { w.calls.push({ path: 'failed', method: 'GET', body: '' }); throw new Error('synthetic provider outage'); }) as typeof fetch;
  t.mock.method(console, 'warn', () => {});
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  assert.deepEqual(await getCatalog(w.env), []);
  const first = w.calls.length;
  assert.ok(first > 0);
  assert.deepEqual(await getCatalog(w.env), []);
  assert.equal(w.calls.length, first);
  t.mock.timers.tick(10 * 60 * 1000 - 1);
  await getCatalog(w.env);
  assert.equal(w.calls.length, first);
  t.mock.timers.tick(1);
  await getCatalog(w.env);
  assert.ok(w.calls.length > first);
});

test('public plans/packs hide test and unknown rows, give all six readiness states, and never call Stripe', async t => {
  const w = world(t, true);
  product(w, 'prod_wrong1433', false);
  product(w, 'prod_unknown1433', null);
  product(w, 'prod_live1433', true);
  const result = await plansAndPacks(w.env);
  const sold = result.plans.filter((p: any) => (p.catalogue as any)?.sellable);
  assert.equal(sold.length, 6);
  assert.equal(result.plans.some((p: any) => ['prod_wrong1433', 'prod_unknown1433'].includes(p.product_id)), false);
  const growth = sold.find((p: any) => p.licence_key === 'founder:growth')!;
  assert.deepEqual(growth.checkout, { monthly: 'ready', yearly: 'not_ready' });
  assert.equal('reason' in (growth.checkout as any), false);
  assert.ok(sold.filter((p: any) => p !== growth).every((p: any) => p.checkout.monthly === 'not_ready'));
  assert.equal(w.calls.length, 0);
  w.env.STRIPE_WEBHOOK_SECRET = '';
  assert.ok((await plansAndPacks(w.env)).plans.filter((p: any) => p.checkout).every((p: any) => p.checkout.monthly === 'not_ready'));
  assert.equal(w.calls.length, 0);
});

test('public token packs are filtered by recorded mode without a provider read', async t => {
  const w = world(t, true);
  for (const [suffix, mode] of [['test', false], ['unknown', null], ['live', true]] as const) {
    product(w, 'prod_pack_' + suffix, mode, [{ ...price('price_pack_' + suffix), type: 'one_time', interval: null } as any]);
    w.db.prepare(`INSERT INTO ai_token_packs(uid,origin,price_id,product_id,face_cents,bonus_microusd,on_sale,sort)
      VALUES(?,'created',?,?,1000,0,1,1)`).run('pack_' + suffix, 'price_pack_' + suffix, 'prod_pack_' + suffix);
  }
  const publicRead = await plansAndPacks(w.env);
  assert.deepEqual(publicRead.packs.map(pack => pack.price_id), ['price_pack_live']);
  assert.equal(w.calls.length, 0);
});

for (const reason of ['secret_key_missing', 'publishable_key_missing', 'publishable_key_unknown', 'key_mode_mismatch', 'webhook_secret_missing', 'price_missing']) {
  test(`quote and start fail before Stripe: ${reason}`, async t => {
    const w = world(t);
    if (reason !== 'price_missing') product(w);
    if (reason === 'secret_key_missing') w.env.STRIPE_SECRET_KEY = '';
    if (reason === 'publishable_key_missing') w.env.STRIPE_PUBLISHABLE_KEY = '';
    if (reason === 'publishable_key_unknown') w.env.STRIPE_PUBLISHABLE_KEY = 'not-a-publishable-key';
    if (reason === 'key_mode_mismatch') w.env.STRIPE_PUBLISHABLE_KEY = 'pk_live_' + 'p'.repeat(24);
    if (reason === 'webhook_secret_missing') w.env.STRIPE_WEBHOOK_SECRET = '';
    for (const endpoint of ['quote', 'start']) {
      const res = await w.hit('/api/billing/checkout/' + endpoint, { plan_key: 'founder:growth', interval: 'month', nonce: 'press-fixture-1433' });
      assert.equal(res.status, 409);
      const body: any = await res.json();
      assert.equal(body.error, 'checkout_not_ready');
      assert.equal(body.reason, reason);
      assert.equal(body.message, "This plan can't be bought just now. Nothing was charged.");
    }
    assert.equal(w.calls.length, 0);
  });
}

test('ready monthly/yearly plans still quote and start; missing yearly never falls back to monthly', async t => {
  const w = world(t);
  product(w);
  assert.deepEqual(await keyReadiness(w.env), { state: 'ready' });
  const products = await getCatalog(w.env, 'subscription', undefined, { sync: false });
  assert.deepEqual(await planReadiness(w.env, products, planByKey('founder:growth')!, 'month'), { state: 'ready' });
  assert.deepEqual(await planReadiness(w.env, products, planByKey('founder:growth')!, 'year'), { state: 'not_ready', reason: 'price_missing' });
  assert.equal((await w.hit('/api/billing/checkout/quote', { plan_key: 'founder:growth', interval: 'month' })).status, 200);
  assert.equal((await w.hit('/api/billing/checkout/start', { plan_key: 'founder:growth', interval: 'month', nonce: 'press-fixture-1433' })).status, 200);
  assert.ok(w.calls.some(call => call.path === '/subscriptions' && call.method === 'POST'));
});

test('legacy plan checkouts and a pack order share readiness before provider calls', async t => {
  const w = world(t);
  w.env.STRIPE_WEBHOOK_SECRET = '';
  for (const [path, body, who] of [
    ['/api/billing/tier/checkout', { tier: 'growth' }, 1],
    ['/api/billing/investor/checkout', { plan: 'investor_pro_monthly' }, 2],
    ['/api/billing/plan/checkout', {}, 3],
  ] as const) {
    const res = await w.hit(path, body, who);
    assert.equal(res.status, 409, path);
    assert.equal((await res.json() as any).reason, 'webhook_secret_missing');
  }
  w.env.STRIPE_PRICE_AI_TOPUP = 'price_pack1433';
  const res = await w.hit('/api/orders/intent', { items: [{ price_id: 'price_pack1433', quantity: 1 }] });
  assert.equal(res.status, 409);
  assert.equal((await res.json() as any).reason, 'webhook_secret_missing');
  assert.equal(w.calls.length, 0);
});

test('HQ detects each missing monthly sellable plan, webhook secret and invalid pack', async t => {
  const w = world(t);
  const products = await getCatalog(w.env, undefined, undefined, { sync: false });
  const checks = catalogChecks(products, { accountMode: 'test', publishableMode: 'test', webhookConfigured: false }, [{
    origin: 'created', uid: 'pack1433', price_id: 'price_pack1433', face_cents: 1000, on_sale: true, bonus_microusd: 0, sort: 1,
    state: 'not_ready', reason: 'missing_from_catalog', adoptable: false, offer_starts_at: null, offer_ends_at: null, first_purchase_only: false,
  }]);
  assert.equal(checks.filter(check => check.code === 'sellable_plan_unpriced').length, PLAN_CATALOGUE.filter(entry => entry.sellable).length);
  assert.ok(checks.some(check => check.code === 'webhook_secret_missing' && check.severity === 'blocker'));
  assert.ok(checks.some(check => check.code === 'pack_not_ready' && check.price_id === 'price_pack1433'));
});

test('signed duplicate events acknowledge once without dispatch or another claim', async t => {
  const w = world(t);
  w.db.exec("UPDATE users SET stripe_subscription_id='sub_renewal1433' WHERE id=1");
  let alerts = 0, claims = 0;
  const prepare = w.env.DB.prepare.bind(w.env.DB);
  w.env.DB.prepare = (sql: string) => { if (sql.includes('INSERT INTO billing_alerts')) alerts++; if (sql.includes('SET processing_uid = ?')) claims++; return prepare(sql); };
  const event = renewalEvent();
  assert.equal((await w.webhook(event)).status, 200);
  const again = await w.webhook(event);
  assert.equal(again.status, 200);
  assert.deepEqual(await again.json(), { received: true, duplicate: true });
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM billing_alerts').get().n, 1);
  assert.equal(alerts, 1);
  assert.equal(claims, 1);
  const receipt: any = w.db.prepare('SELECT * FROM stripe_webhook_events').get();
  assert.ok(receipt.handled_at);
  assert.equal(receipt.processing_uid, null);
});

test('a handler failure leaves its receipt unfinished and immediately retryable', async t => {
  const w = world(t);
  w.db.exec("UPDATE users SET stripe_subscription_id='sub_renewal1433' WHERE id=1");
  const prepare = w.env.DB.prepare.bind(w.env.DB);
  let fail = true;
  w.env.DB.prepare = (sql: string) => { if (fail && sql.includes('INSERT INTO billing_alerts')) throw new Error('Synthetic write failure'); return prepare(sql); };
  assert.equal((await w.webhook(renewalEvent())).status, 503);
  let receipt: any = w.db.prepare('SELECT * FROM stripe_webhook_events').get();
  assert.equal(receipt.handled_at, null);
  assert.equal(receipt.processing_uid, null);
  fail = false;
  assert.equal((await w.webhook(renewalEvent())).status, 200);
  receipt = w.db.prepare('SELECT * FROM stripe_webhook_events').get();
  assert.ok(receipt.handled_at);
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM billing_alerts').get().n, 1);
});

test('simultaneous deliveries serialize the handler across the durable claim', { timeout: 10000 }, async t => {
  const w = world(t);
  w.db.exec("UPDATE users SET stripe_subscription_id='sub_renewal1433' WHERE id=1");
  let begin: () => void, release: () => void;
  const started = new Promise<void>(resolve => { begin = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  const batch = w.env.DB.batch.bind(w.env.DB);
  let first = true;
  w.env.DB.batch = async (statements: any[]) => {
    if (first) { first = false; begin!(); await held; }
    return batch(statements);
  };
  const running = w.webhook(renewalEvent());
  try {
    await started;
    const overlapping = await w.webhook(renewalEvent());
    assert.equal(overlapping.status, 409);
    assert.equal((await overlapping.json() as any).error, 'webhook_processing');
    assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM billing_alerts').get().n, 0);
  } finally { release!(); await running; }
  assert.equal((await running).status, 200);
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM billing_alerts').get().n, 1);
  const retried = await w.webhook(renewalEvent());
  assert.deepEqual(await retried.json(), { received: true, duplicate: true });
});

test('an active event claim cannot dispatch again; an expired abandoned claim can recover', async t => {
  const w = world(t);
  w.db.prepare(`INSERT INTO stripe_webhook_events(event_id,type,livemode,processing_uid,processing_until)
    VALUES(?,?,0,'abandoned1433',datetime('now','+5 minutes'))`).run('evt_fixture1433', 'd1433.synthetic');
  assert.equal((await w.webhook(syntheticEvent())).status, 409);
  assert.equal(w.db.prepare('SELECT handled_at FROM stripe_webhook_events').get().handled_at, null);
  w.db.exec("UPDATE stripe_webhook_events SET processing_until=datetime('now','-1 second')");
  assert.equal((await w.webhook(syntheticEvent())).status, 200);
  assert.ok(w.db.prepare('SELECT handled_at FROM stripe_webhook_events').get().handled_at);
});

test('wrong-mode events are recorded without dispatch; malformed/unsigned events never reach D1', async t => {
  const w = world(t);
  const res = await w.webhook({ ...renewalEvent(), livemode: true });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ignored: 'mode_mismatch' });
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM billing_alerts').get().n, 0);
  assert.equal(w.db.prepare('SELECT livemode FROM stripe_webhook_events').get().livemode, 1);
  assert.equal((await w.webhook({ type: 'd1433.synthetic', data: { object: {} } })).status, 400);
  const { livemode: _missingMode, ...unstamped } = syntheticEvent('evt_no_mode1433');
  assert.equal((await w.webhook(unstamped)).status, 400);
  const unsigned = await w.app.request('/api/billing/stripe/webhook', { method: 'POST', body: JSON.stringify(syntheticEvent('evt_unsigned1433')) }, w.env);
  assert.equal(unsigned.status, 400);
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM stripe_webhook_events').get().n, 1);
});

test('signature tolerance includes 299/300 seconds and rejects 301 seconds in either direction', async t => {
  const w = world(t);
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  for (const age of [299, 300, -299, -300]) assert.equal((await w.webhook(syntheticEvent('evt_allowed' + String(age)), age)).status, 200);
  for (const age of [301, -301]) assert.equal((await w.webhook(syntheticEvent('evt_old' + String(age)), age)).status, 400);
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM stripe_webhook_events').get().n, 4);
});

test('both customer portals return to account billing', async t => {
  const w = world(t);
  w.db.exec("UPDATE users SET stripe_customer_id='cus_founder1433' WHERE id=1; UPDATE users SET investor_stripe_customer_id='cus_investor1433' WHERE id=2");
  assert.equal((await w.hit('/api/billing/tier/portal')).status, 200);
  assert.equal((await w.hit('/api/billing/investor/portal', {}, 2)).status, 200);
  const portals = w.calls.filter(call => call.path === '/billing_portal/sessions');
  assert.equal(portals.length, 2);
  for (const call of portals) assert.equal(new URLSearchParams(call.body).get('return_url'), 'https://axal.test/account/billing');
});
