/**
 * D1051 (#2902, part 3 of #2451) — checkout's quote, start and status, with
 * Stripe stubbed (as `billing_plan_grants_d892.test.ts` does): every Stripe
 * call is recorded, so a test can say what was sent, and that a read sent
 * nothing that takes money.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/billing_checkout_d1051.test.ts
 */
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import checkout from '../src/routes/billing_checkout.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { changeDirection, familyForRole, plannedEntry, priceForEntry } from '../src/services/planCheckout.ts';
import { planByKey } from '../src/services/planCatalogue.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const KEY = 'sk_test_sentinel';
const JWT_SECRET = 'd1051-unit-test-jwt-secret-0123456789-abcdef';
const FOUNDER = 61, INVESTOR = 62, ADMIN = 63, EXPLORER = 64, OTHER = 65, PARTNER = 66;
const PERIOD_END = 1_900_000_000;

// ── Stripe, stubbed ─────────────────────────────────────────────────────────
type Call = { url: string; method: string; body: string; idem: string | null };
let calls: Call[] = [];
let heldPrice = { id: 'price_growth_m', unit_amount: 7900 };
// What Stripe lists per customer that D1 never saw (D892 §6), and a list read that fails.
let stripeLists: Record<string, unknown[]> = {};
let listFails = false;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = String(typeof input === 'string' ? input : input?.url);
  const method = String(init?.method || 'GET').toUpperCase();
  calls.push({ url, method, body: String(init?.body ?? ''), idem: init?.headers?.['Idempotency-Key'] ?? null });
  const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200 });
  const path = url.replace('https://api.stripe.com/v1', '').split('?')[0];
  if (path === '/subscriptions/sub_held' && method === 'GET') {
    return json({ id: 'sub_held', status: 'active', customer: 'cus_founder', current_period_end: PERIOD_END, schedule: null,
      items: { data: [{ id: 'si_1', price: { id: heldPrice.id, unit_amount: heldPrice.unit_amount, currency: 'usd', recurring: { interval: 'month', interval_count: 1 } } }] } });
  }
  if (path === '/subscriptions/sub_inv_old' && method === 'GET') {
    return json({ id: 'sub_inv_old', status: 'active', customer: 'cus_inv_general', current_period_end: PERIOD_END, schedule: null,
      items: { data: [{ id: 'si_i', price: { id: 'price_pro_m', unit_amount: 14900, currency: 'usd', recurring: { interval: 'month', interval_count: 1 } } }] } });
  }
  if (path === '/subscriptions/sub_partner' && method === 'GET') {
    return json({ id: 'sub_partner', status: 'active', customer: 'cus_partner', current_period_end: PERIOD_END, schedule: null,
      items: { data: [{ id: 'si_p', price: { id: 'price_partner_y', unit_amount: 99000, currency: 'usd', recurring: { interval: 'year', interval_count: 1 } } }] } });
  }
  if (path === '/subscriptions/sub_partner' && method === 'POST') {
    return json({ id: 'sub_partner', status: 'active', latest_invoice: { id: 'in_p', payment_intent: { id: 'pi_p', status: 'succeeded' } } });
  }
  if (path === '/subscriptions/sub_held' && method === 'POST') {
    return json({ id: 'sub_held', status: 'active', latest_invoice: { id: 'in_up', payment_intent: { id: 'pi_up', status: 'requires_action', client_secret: 'pi_up' + '_secret_' + 'fixture' } } });
  }
  if (path === '/subscriptions' && method === 'POST') {
    return json({ id: 'sub_new1', status: 'incomplete', latest_invoice: { id: 'in_1', payment_intent: { id: 'pi_1', client_secret: 'pi_1' + '_secret_' + 'fixture' } } });
  }
  if (path === '/subscriptions' && method === 'GET') {
    if (listFails) return new Response(JSON.stringify({ error: { type: 'api_error', message: 'down' } }), { status: 500 });
    return json({ data: stripeLists[new URL(url).searchParams.get('customer') || ''] ?? [] });
  }
  if (path === '/invoices/upcoming') {
    return json({ currency: 'usd', amount_due: 17000, total: 17000, tax: null, lines: { data: [{ amount: -7900, proration: true }, { amount: 24900, proration: true }, { amount: 24900, proration: false }] } });
  }
  if (path === '/subscription_schedules' && method === 'POST') return json({ id: 'sub_sched_1', phases: [{ start_date: 1_800_000_000, end_date: PERIOD_END }] });
  if (path.startsWith('/subscription_schedules/')) return json({ id: 'sub_sched_1' });
  if (path === '/payment_methods/pm_mine') return json({ id: 'pm_mine', customer: 'cus_founder' });
  if (path === '/payment_methods/pm_theirs') return json({ id: 'pm_theirs', customer: 'cus_someone_else' });
  if (path === '/customers' && method === 'POST') return json({ id: 'cus_created' });
  return new Response('unexpected call in test: ' + method + ' ' + url, { status: 599 });
}) as typeof fetch;
process.on('exit', () => { globalThis.fetch = realFetch; });
beforeEach(() => { calls = []; heldPrice = { id: 'price_growth_m', unit_amount: 7900 }; stripeLists = {}; listFails = false; });
const posts = () => calls.filter((c) => c.method === 'POST');
const sent = (c: Call) => new URLSearchParams(c.body);

// ── A database as production has it ─────────────────────────────────────────
const price = (id: string, cents: number, interval: string) => ({ id, unit_amount: cents, currency: 'usd', interval, interval_count: 1, nickname: null, type: 'recurring', active: true });
function database() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  const baseline = read('cloudflare-worker/sql/schema_baseline.sql');
  for (const t of ['users', 'user_sessions', 'activity_logs', 'account_subscriptions']) db.exec(tableFromBaseline(baseline, t));
  db.exec(`CREATE TABLE stripe_products (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'subscription',
      active INTEGER NOT NULL DEFAULT 1, metadata_json TEXT NOT NULL DEFAULT '{}', prices_json TEXT NOT NULL DEFAULT '[]', synced_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE ai_token_packs (uid TEXT, origin TEXT, price_id TEXT, product_id TEXT, face_cents INTEGER, bonus_microusd INTEGER, on_sale INTEGER,
      offer_starts_at TEXT, offer_ends_at TEXT, first_purchase_only INTEGER, archived_at TEXT);`);
  db.exec(read('cloudflare-worker/sql/migrations/505_member_subscription_amounts.sql'));
  db.exec('ALTER TABLE member_subscription_amounts ADD COLUMN price_id TEXT');
  db.exec(read('cloudflare-worker/sql/migrations/691_stripe_mode_stamps.sql'));
  const product = db.prepare('INSERT INTO stripe_products (id, name, metadata_json, prices_json, livemode) VALUES (?, ?, ?, ?, 0)');
  product.run('prod_growth', 'Founder — Growth', JSON.stringify({ tier: 'growth' }), JSON.stringify([price('price_growth_m', 7900, 'month'), price('price_growth_y', 79000, 'year')]));
  product.run('prod_studio', 'Founder — Studio', JSON.stringify({ tier: 'studio' }), JSON.stringify([price('price_studio_m', 24900, 'month')]));
  product.run('prod_partner', 'Operating Partner Pro', JSON.stringify({ plan_group: 'partner' }), JSON.stringify([price('price_partner_m', 9900, 'month'), price('price_partner_y', 99000, 'year')]));
  product.run('prod_pro', 'Investor — Professional', JSON.stringify({ investor_tier: 'professional' }), JSON.stringify([price('price_pro_m', 14900, 'month')]));
  const u = db.prepare('INSERT INTO users (id, role, name, email, uid, is_active, stripe_customer_id) VALUES (?, ?, ?, ?, ?, 1, ?)');
  u.run(FOUNDER, 'founder', 'Ada Quill', 'ada@example.test', 'uid-61', 'cus_founder');
  u.run(INVESTOR, 'investor', 'Ira Vale', 'ira@example.test', 'uid-62', 'cus_inv_general');
  u.run(ADMIN, 'admin', 'Sam Staff', 'sam@example.test', 'uid-63', null);
  u.run(EXPLORER, 'exploring', 'Eve New', 'eve@example.test', 'uid-64', null);
  u.run(OTHER, 'founder', 'Oto Else', 'oto@example.test', 'uid-65', 'cus_other');
  u.run(PARTNER, 'partner', 'Pat Rowe', 'pat@example.test', 'uid-66', 'cus_partner');
  db.prepare(`INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, 'fresh', 'totp', datetime('now'))`).run(FOUNDER);
  db.prepare(`INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, 'fresh-p', 'totp', datetime('now'))`).run(PARTNER);
  return db;
}
const holdGrowth = (db: DatabaseSync, tier = 'growth') =>
  db.prepare(`UPDATE users SET subscription_tier = ?, subscription_status = 'active', stripe_subscription_id = 'sub_held' WHERE id = ?`).run(tier, FOUNDER);
const env = (db: DatabaseSync) => ({ JWT_SECRET, ENVIRONMENT: 'test', STRIPE_SECRET_KEY: KEY, STRIPE_PUBLISHABLE_KEY: 'pk_test_fixture', STRIPE_WEBHOOK_SECRET: 'fixture-signing', DB: d1Over(db) } as any);
const app = (() => {
  const a = new Hono<any>();
  a.route('/api/billing', checkout);
  a.onError((err: any, c) => {
    const s = AUTH_ERROR_STATUSES[String(err?.message || '')];
    return s ? c.json({ detail: err.message, code: err.message }, s) : c.json({ detail: String(err?.message || '') }, 500);
  });
  return a;
})();
async function hit(db: DatabaseSync, method: string, path: string, who: number, body?: unknown, jti?: string) {
  const role = (db.prepare('SELECT role FROM users WHERE id = ?').get(who) as any).role;
  const claims: any = { user_id: who, role }; if (jti) claims.jti = jti;
  const token = await new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await app.request(path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, env(db));
    const text = await res.text();
    let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body: json, text };
  } finally { [console.warn, console.error] = saved; }
}
const quote = (db: DatabaseSync, who: number, plan_key: string, interval = 'month') => hit(db, 'POST', '/api/billing/checkout/quote', who, { plan_key, interval });
const start = (db: DatabaseSync, who: number, body: Record<string, unknown>, jti?: string) =>
  hit(db, 'POST', '/api/billing/checkout/start', who, { interval: 'month', nonce: 'nonce-press-0001', ...body }, jti);
const status = (db: DatabaseSync, who: number, ref: string) => hit(db, 'GET', `/api/billing/checkout/status?ref=${ref}`, who);

/* ------------------------------------------------------------------ */

test('the rules: a member buys their own profile\'s sold plans; a change goes by what it costs a month', () => {
  assert.deepEqual(familyForRole('founder'), { family: 'founder' });
  assert.equal((familyForRole('admin') as any).refusal.code, 'staff_no_plan');
  assert.equal((familyForRole('exploring') as any).refusal.code, 'choose_profile');
  // Mutation checked: drop the family check → a founder may buy an investor plan.
  assert.equal((plannedEntry('founder', 'investor:professional') as any).refusal.code, 'other_profile');
  assert.equal((plannedEntry('investor', 'investor:institutional') as any).refusal.code, 'not_sellable', 'Institutional is Contact Sales');
  // D1334 (#3540): Investor Plus is sold, replacing D786's "not sold" pin.
  assert.equal((plannedEntry('investor', 'investor:plus') as any).entry.key, 'investor:plus', 'Investor Plus is sold (D1334)');
  assert.equal((plannedEntry('founder', 'investor:plus') as any).refusal.code, 'other_profile');
  assert.equal((plannedEntry('founder', 'founder:free') as any).refusal.code, 'not_sellable');
  assert.equal((plannedEntry('founder', 'nope') as any).refusal.code, 'unknown_plan');
  assert.equal((plannedEntry('founder', 'founder:studio') as any).entry.key, 'founder:studio');
  // Owner question 7, A.
  assert.equal(changeDirection({ price_id: 'a', unit_amount: 7900, interval: 'month' }, { price_id: 'b', unit_amount: 24900, interval: 'month' }), 'upgrade');
  assert.equal(changeDirection({ price_id: 'b', unit_amount: 24900, interval: 'month' }, { price_id: 'a', unit_amount: 7900, interval: 'month' }), 'downgrade');
  // Mutation checked: compare the raw amounts → a yearly plan reads as an upgrade from its own monthly price.
  assert.equal(changeDirection({ price_id: 'm', unit_amount: 7900, interval: 'month' }, { price_id: 'y', unit_amount: 79000, interval: 'year' }), 'downgrade');
  assert.equal(changeDirection({ price_id: 'a', unit_amount: 1, interval: 'month' }, { price_id: 'a', unit_amount: 1, interval: 'month' }), 'same');
  const products: any[] = [{ id: 'p', kind: 'subscription', active: true, metadata: { tier: 'growth' }, prices: [
    { id: 'x', active: false, type: 'recurring', interval: 'month', interval_count: 1, unit_amount: 1, currency: 'usd' },
    { id: 'y', active: true, type: 'recurring', interval: 'month', interval_count: 3, unit_amount: 1, currency: 'usd' },
    { id: 'z', active: true, type: 'recurring', interval: 'month', interval_count: 1, unit_amount: 7900, currency: 'usd' }] }];
  assert.equal(priceForEntry(products, planByKey('founder:growth')!, 'month')!.price.id, 'z', 'an active price charged every one month');
  assert.equal(priceForEntry(products, planByKey('founder:studio')!, 'month'), null);
});

test('quote, a new subscriber: the plan, its price and allowance, the saving, the total; read only', async () => {
  const db = database();
  const r = await quote(db, FOUNDER, 'founder:growth');
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([r.body.mode, r.body.plan_name, r.body.unit_amount, r.body.currency, r.body.price_id], ['new', 'Validate + Build', 7900, 'usd', 'price_growth_m']);
  assert.equal(r.body.yearly_saving_percent, 17, '1 − 79000 ÷ (12 × 7900)');
  assert.equal(r.body.ai_allowance_microusd, 19_750_000, '25% of $79 a month');
  assert.deepEqual(r.body.includes, planByKey('founder:growth')!.included);
  assert.equal(r.body.total_due_today, 7900);
  assert.equal(r.body.step_up_required, false, 'a first plan with a new card needs no code');
  assert.equal(r.body.saved_card_step_up, true);
  // Mutation checked: create the subscription in the quote → a POST reaches Stripe.
  assert.equal(posts().length, 0, 'a quote never writes to Stripe');
  // Refusals in words.
  assert.equal((await quote(db, FOUNDER, 'investor:professional')).body.error, 'other_profile');
  assert.equal((await quote(db, ADMIN, 'founder:growth')).body.error, 'staff_no_plan');
  assert.equal((await quote(db, EXPLORER, 'founder:growth')).body.error, 'choose_profile');
  assert.equal((await quote(db, FOUNDER, 'founder:studio', 'year')).body.reason, 'price_missing', 'no yearly Studio price: never a typed one');
  assert.equal((await quote(db, FOUNDER, 'founder:growth', 'week')).body.error, 'invalid_interval');
  // A token pack's price is never a plan.
  db.exec(`INSERT INTO ai_token_packs (uid, origin, price_id, product_id, archived_at) VALUES ('pk', 'catalog', 'price_growth_m', 'prod_growth', NULL)`);
  assert.equal((await quote(db, FOUNDER, 'founder:growth')).body.error, 'token_pack_checkout_only');
});

test('quote, a member already paying: an upgrade now with its proration; a downgrade at the period end, nothing today', async () => {
  const db = database();
  holdGrowth(db);
  const up = await quote(db, FOUNDER, 'founder:studio');
  assert.equal(up.status, 200, up.text);
  assert.deepEqual([up.body.mode, up.body.direction, up.body.change_at, up.body.step_up_required], ['change', 'upgrade', 'now', true]);
  // Mutation checked: count the next period's line as proration → 41900.
  assert.equal(up.body.proration_amount, 17000);
  assert.equal(up.body.total_due_today, 17000);
  assert.ok(calls.some((c) => c.url.includes('/invoices/upcoming') && c.url.includes('always_invoice')), "Stripe's own preview");
  heldPrice = { id: 'price_studio_m', unit_amount: 24900 };
  holdGrowth(db, 'studio');
  const down = await quote(db, FOUNDER, 'founder:growth');
  assert.deepEqual([down.body.direction, down.body.total_due_today, down.body.proration_amount], ['downgrade', 0, 0]);
  assert.equal(down.body.change_at, new Date(PERIOD_END * 1000).toISOString());
  assert.equal((await quote(db, FOUNDER, 'founder:studio')).body.error, 'already_on_plan');
  assert.equal(posts().length, 0);
});

test('start, a new subscriber with a new card: one incomplete subscription with the plan stamped, an idempotency key, and the log carries no card or email', async () => {
  const db = database();
  assert.equal((await start(db, FOUNDER, { plan_key: 'founder:growth', nonce: '' })).body.error, 'nonce_required');
  const r = await start(db, FOUNDER, { plan_key: 'founder:growth' });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([r.body.mode, r.body.ref, typeof r.body.client_secret], ['new', 'sub_new1', 'string']);
  const subs = posts().filter((c) => c.url.endsWith('/v1/subscriptions'));
  assert.equal(subs.length, 1);
  const p = sent(subs[0]);
  assert.deepEqual([p.get('customer'), p.get('items[0][price]'), p.get('payment_behavior'), p.get('metadata[kind]'), p.get('metadata[tier]'), p.get('metadata[plan_key]'), p.get('metadata[money_kind]')],
    ['cus_founder', 'price_growth_m', 'default_incomplete', 'tier', 'growth', 'founder:growth', 'platform_plan']);
  // Mutation checked: drop the nonce from the key → a double press is two charges.
  assert.match(String(subs[0].idem), /nonce-press-0001$/);
  const log = db.prepare(`SELECT action, details, entity_id FROM activity_logs WHERE user_id = ?`).all(FOUNDER) as any[];
  assert.deepEqual(log.map((l) => [l.action, l.entity_id]), [['checkout_started', 'sub_new1']]);
  assert.ok(!/@|pm_|last4|exp_|brand|fingerprint/.test(log[0].details), 'no email and no card in the log');
  assert.equal(JSON.parse(log[0].details).before_plan_key, 'founder:free', 'what was held before is recorded');
  // An investor plan lives on the member's own investor customer, made for it, never the general one (D892 §6).
  const inv = await start(db, INVESTOR, { plan_key: 'investor:professional' });
  assert.equal(inv.status, 200, inv.text);
  const made = posts().filter((c) => c.url.endsWith('/v1/customers'));
  assert.equal(made.length, 1);
  assert.equal(sent(made[0]).get('metadata[scope]'), 'investor');
  const invSub = sent(posts().filter((c) => c.url.endsWith('/v1/subscriptions')).at(-1)!);
  assert.deepEqual([invSub.get('metadata[kind]'), invSub.get('customer')], ['investor', 'cus_created']);
  assert.equal((db.prepare('SELECT investor_stripe_customer_id FROM users WHERE id = ?').get(INVESTOR) as any).investor_stripe_customer_id, 'cus_created');
});

test('start and quote, a plan Stripe holds that D1 never saw (D892 §6): refused, never a second; a check that fails charges nothing', async () => {
  const db = database();
  stripeLists = { cus_founder: [{ id: 'sub_old', status: 'active', metadata: { kind: 'tier', tier: 'growth' } }] };
  const q = await quote(db, FOUNDER, 'founder:studio');
  assert.deepEqual([q.status, q.body.error], [409, 'subscription_exists']);
  const s1 = await start(db, FOUNDER, { plan_key: 'founder:studio' });
  assert.deepEqual([s1.status, s1.body.error], [409, 'subscription_exists']);
  // An investor plan made before D892 on the general customer: the member adopts that customer, so its next event grants it.
  stripeLists = { cus_inv_general: [{ id: 'sub_old_inv', status: 'active', metadata: { kind: 'investor', investor_tier: 'professional' } }] };
  const s2 = await start(db, INVESTOR, { plan_key: 'investor:professional' });
  assert.deepEqual([s2.status, s2.body.error], [409, 'subscription_exists']);
  assert.equal((db.prepare('SELECT investor_stripe_customer_id FROM users WHERE id = ?').get(INVESTOR) as any).investor_stripe_customer_id, 'cus_inv_general');
  // A plan of another family does not count.
  stripeLists = { cus_founder: [{ id: 'sub_mi', status: 'active', metadata: { kind: 'mi' } }] };
  assert.equal((await start(db, FOUNDER, { plan_key: 'founder:growth' })).status, 200);
  // D1 holds an investor plan made before D892 on the general customer, and no investor customer: it is read as held there.
  stripeLists = {};
  db.prepare(`UPDATE users SET investor_tier = 'professional', investor_subscription_status = 'active', investor_stripe_subscription_id = 'sub_inv_old', investor_stripe_customer_id = NULL WHERE id = ?`).run(INVESTOR);
  const held = await quote(db, INVESTOR, 'investor:professional');
  assert.deepEqual([held.status, held.body.error], [409, 'already_on_plan']);
  // Stripe cannot say: 503, and nothing made.
  listFails = true; calls = [];
  const s3 = await start(db, FOUNDER, { plan_key: 'founder:growth', nonce: 'nonce-press-0002' });
  assert.deepEqual([s3.status, s3.body.error], [503, 'plan_check_unavailable']);
  assert.equal((await quote(db, FOUNDER, 'founder:growth')).body.error, 'plan_check_unavailable');
  assert.equal(posts().length, 0, 'nothing is made when the check fails');
});

test('start, a saved card: the authenticator code first (owner question 8, C), and only the member\'s own card', async () => {
  const db = database();
  // Mutation checked: drop the saved-card step-up → the charge starts with no code.
  const noCode = await start(db, FOUNDER, { plan_key: 'founder:growth', payment_method: 'pm_mine' });
  assert.equal(noCode.status, 403);
  assert.equal(noCode.body.code, 'TOTP required');
  assert.equal(posts().length, 0, 'nothing is started before the code');
  const theirs = await start(db, FOUNDER, { plan_key: 'founder:growth', payment_method: 'pm_theirs' }, 'fresh');
  assert.equal(theirs.status, 404);
  assert.equal(posts().filter((c) => c.url.endsWith('/v1/subscriptions')).length, 0);
  const mine = await start(db, FOUNDER, { plan_key: 'founder:growth', payment_method: 'pm_mine' }, 'fresh');
  assert.equal(mine.status, 200, mine.text);
  assert.equal(sent(posts().filter((c) => c.url.endsWith('/v1/subscriptions'))[0]).get('default_payment_method'), 'pm_mine');
});

test('start, a change: behind the code; an upgrade now with the proration charged; a downgrade scheduled, nothing charged; never a second subscription', async () => {
  const db = database();
  holdGrowth(db);
  // Mutation checked: drop the change's step-up → the swap runs on a stale session.
  assert.equal((await start(db, FOUNDER, { plan_key: 'founder:studio' })).status, 403);
  const up = await start(db, FOUNDER, { plan_key: 'founder:studio' }, 'fresh');
  assert.equal(up.status, 200, up.text);
  assert.deepEqual([up.body.direction, up.body.ref, typeof up.body.client_secret], ['upgrade', 'sub_held', 'string'], 'the proration invoice\'s secret');
  const swap = posts().find((c) => c.url.endsWith('/v1/subscriptions/sub_held'))!;
  // Mutation checked: create_prorations → the difference waits for the next invoice instead of today.
  assert.deepEqual([sent(swap).get('proration_behavior'), sent(swap).get('payment_behavior'), sent(swap).get('items[0][price]'), sent(swap).get('metadata[tier]')],
    ['always_invoice', 'pending_if_incomplete', 'price_studio_m', 'studio']);
  assert.equal(posts().filter((c) => c.url.endsWith('/v1/subscriptions')).length, 0, 'no second subscription');
  // A downgrade.
  calls = [];
  heldPrice = { id: 'price_studio_m', unit_amount: 24900 };
  holdGrowth(db, 'studio');
  const down = await start(db, FOUNDER, { plan_key: 'founder:growth' }, 'fresh');
  assert.equal(down.status, 200, down.text);
  assert.deepEqual([down.body.direction, down.body.scheduled, down.body.change_at], ['downgrade', true, new Date(PERIOD_END * 1000).toISOString()]);
  // Mutation checked: swap at once on a downgrade → the subscription is updated today.
  assert.equal(posts().filter((c) => c.url.endsWith('/v1/subscriptions/sub_held')).length, 0, 'the plan is not changed today');
  const sched = posts().find((c) => c.url.endsWith('/v1/subscription_schedules/sub_sched_1'))!;
  assert.deepEqual([sent(sched).get('phases[1][items][0][price]'), sent(sched).get('phases[0][end_date]'), sent(sched).get('proration_behavior'), sent(sched).get('phases[1][metadata][tier]')],
    ['price_growth_m', String(PERIOD_END), 'none', 'growth']);
  // D1 says a plan is held but Stripe does not confirm it is this member's: never a second one.
  db.prepare(`UPDATE users SET subscription_tier = 'growth', subscription_status = 'active', stripe_subscription_id = 'sub_held' WHERE id = ?`).run(OTHER);
  const clash = await start(db, OTHER, { plan_key: 'founder:studio' });
  assert.equal(clash.status, 409);
  assert.equal(clash.body.error, 'subscription_exists');
});

test('status: caller only; activating, then active with what the payment recorded; failed; never inferred from Stripe.js', async () => {
  const db = database();
  await start(db, FOUNDER, { plan_key: 'founder:growth' });
  // Mutation checked: drop the owner check → another member reads this checkout.
  assert.equal((await status(db, OTHER, 'sub_new1')).status, 404, 'not another member\'s');
  assert.equal((await status(db, FOUNDER, 'sub_unrelated')).status, 404, 'an unrelated reference');
  assert.equal((await status(db, FOUNDER, 'pi_1')).status, 400);
  assert.equal((await status(db, FOUNDER, 'sub_new1')).body.state, 'activating', 'paid in the browser is not yet on');
  // The webhook writes the plan columns and the charge.
  db.prepare(`UPDATE users SET subscription_tier = 'growth', subscription_status = 'active', stripe_subscription_id = 'sub_new1' WHERE id = ?`).run(FOUNDER);
  // Plan on, charge not yet recorded: active, with each missing field's reason.
  const early = await status(db, FOUNDER, 'sub_new1');
  assert.equal(early.body.state, 'active');
  assert.equal(early.body.result.interval, null);
  assert.match(early.body.result.reasons.interval, /^Not recorded/);
  db.prepare(`INSERT INTO member_subscription_amounts (subscription_id, user_id, plan_family, amount_cents, currency, interval, interval_count, status, price_id, updated_at)
    VALUES ('sub_new1', ?, 'founder', 7900, 'usd', 'month', 1, 'active', 'price_growth_m', '2026-10-26 12:00:00')`).run(FOUNDER);
  const on = await status(db, FOUNDER, 'sub_new1');
  assert.deepEqual([on.body.result.plan_key, on.body.result.plan_name, on.body.result.interval, on.body.result.effective_at, on.body.result.ai_allowance_microusd],
    ['founder:growth', 'Validate + Build', 'month', '2026-10-26 12:00:00', 19_750_000]);
  assert.deepEqual(on.body.result.included, planByKey('founder:growth')!.included);
  // Mutation checked: report the before plan without a recorded one → it reads "Free" from nowhere.
  assert.deepEqual(on.body.changes, { before: { plan_key: 'founder:free', plan_name: 'Free' }, after: { plan_key: 'founder:growth', plan_name: 'Validate + Build' } });
  // A failed start.
  const v = database();
  await start(v, FOUNDER, { plan_key: 'founder:growth' });
  v.prepare(`INSERT INTO member_subscription_amounts (subscription_id, user_id, plan_family, amount_cents, currency, interval, interval_count, status, price_id)
    VALUES ('sub_new1', ?, 'founder', 7900, 'usd', 'month', 1, 'incomplete_expired', 'price_growth_m')`).run(FOUNDER);
  assert.equal((await status(v, FOUNDER, 'sub_new1')).body.state, 'failed');
  // No recorded "before": said so, never guessed.
  v.exec(`UPDATE activity_logs SET details = json_remove(details, '$.before_plan_key')`);
  v.prepare(`UPDATE users SET subscription_tier = 'growth', subscription_status = 'active', stripe_subscription_id = 'sub_new1' WHERE id = ?`).run(FOUNDER);
  v.exec(`UPDATE member_subscription_amounts SET status = 'active'`);
  assert.deepEqual((await status(v, FOUNDER, 'sub_new1')).body.changes, { before: null, reason: 'The previous plan was not recorded.' });
  // An unreadable store is a 503, never "failed".
  v.exec('DROP TABLE activity_logs');
  assert.equal((await status(v, FOUNDER, 'sub_new1')).status, 503);
});

test('status after a change: a downgrade reads scheduled until its period ends; an upgrade active once the new price is recorded', async () => {
  const db = database();
  holdGrowth(db);
  db.prepare(`INSERT INTO member_subscription_amounts (subscription_id, user_id, plan_family, amount_cents, currency, interval, interval_count, status, price_id)
    VALUES ('sub_held', ?, 'founder', 7900, 'usd', 'month', 1, 'active', 'price_growth_m')`).run(FOUNDER);
  await start(db, FOUNDER, { plan_key: 'founder:studio' }, 'fresh');
  // Mutation checked: take the plan columns alone → the old plan's row reads as the upgrade done.
  assert.equal((await status(db, FOUNDER, 'sub_held')).body.state, 'activating');
  db.prepare(`UPDATE users SET subscription_tier = 'studio' WHERE id = ?`).run(FOUNDER);
  db.exec(`UPDATE member_subscription_amounts SET price_id = 'price_studio_m', amount_cents = 24900`);
  const on = await status(db, FOUNDER, 'sub_held');
  assert.equal(on.body.state, 'active');
  assert.equal(on.body.changes.before.plan_key, 'founder:growth');
  // A downgrade waits for the end of the period.
  heldPrice = { id: 'price_studio_m', unit_amount: 24900 };
  await start(db, FOUNDER, { plan_key: 'founder:growth', nonce: 'nonce-press-0002' }, 'fresh');
  const later = await status(db, FOUNDER, 'sub_held');
  assert.equal(later.body.state, 'scheduled');
  assert.equal(later.body.change_at, new Date(PERIOD_END * 1000).toISOString());
});

test('status after an interval change on a persona plan: active only once the new price is recorded, not because the plan group already reads active', async () => {
  const db = database();
  db.prepare(`INSERT INTO account_subscriptions (user_id, plan_group, plan, status, subscription_id) VALUES (?, 'partner', 'partner_pro', 'active', 'sub_partner')`).run(PARTNER);
  db.prepare(`INSERT INTO member_subscription_amounts (subscription_id, user_id, plan_family, amount_cents, currency, interval, interval_count, status, price_id)
    VALUES ('sub_partner', ?, 'partner', 99000, 'usd', 'year', 1, 'active', 'price_partner_y')`).run(PARTNER);
  // Yearly to monthly costs more a month: an upgrade, now.
  const r = await start(db, PARTNER, { plan_key: 'partner:pro' }, 'fresh-p');
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([r.body.direction, r.body.paid], ['upgrade', true]);
  // Mutation checked: take the plan columns alone → the yearly row reads as the monthly plan on.
  assert.equal((await status(db, PARTNER, 'sub_partner')).body.state, 'activating');
  db.exec(`UPDATE member_subscription_amounts SET price_id = 'price_partner_m', amount_cents = 9900, interval = 'month'`);
  const on = await status(db, PARTNER, 'sub_partner');
  assert.deepEqual([on.body.state, on.body.result.interval, on.body.result.plan_name], ['active', 'month', 'Operating Partner Pro']);
});

test('wiring: mounted ahead of billing, the client names the three routes, and since part 6 the paywall opens the sheet', () => {
  const index = read('cloudflare-worker/src/index.ts');
  assert.ok(index.indexOf("app.route('/api/billing', billingCheckout)") < index.indexOf("app.route('/api/billing', billing)"));
  const client = read('frontend/src/lib/api/billingCheckout.js');
  for (const p of ["'/billing/checkout/quote'", "'/billing/checkout/start'", '/billing/checkout/status?ref=']) assert.ok(client.includes(p), p);
  assert.match(read('frontend/src/lib/api.js'), /export \* from '\.\/api\/billingCheckout\.js';/);
  // D1054 (#2905) is part 6: the paywall opens the sheet now, never the hosted checkout. The hosted
  // route stays mounted; answering it 410 is its own change, once nothing else calls it.
  assert.doesNotMatch(read('frontend/src/components/PaywallModal.jsx'), /api\.(tierCheckout|investorCheckout)/);
  assert.match(read('frontend/src/components/PaywallModal.jsx'), /openCheckout\(/);
  assert.match(read('cloudflare-worker/src/routes/billing.ts'), /billing\.post\('\/tier\/checkout'/);
});
