/**
 * D783 (#2124): a plan includes 25% of its price as AI allowance each month.
 *
 * - The allowance is computed from what the member pays: the subscription
 *   webhook records each member plan's amount (migration 505), a yearly price
 *   counts ÷ 12, and two plans add up. A subscriber with no recorded row yet
 *   reads the catalogue's current price.
 * - No paid plan, no allowance: every run draws tokens, or is refused.
 * - No daily cap for members. The admin licence keeps its typed caps.
 * - HQ reads each plan's allowance as computed; a member licence cannot be typed.
 *
 * Real SQL on node:sqlite through the shared AI fixture; Stripe is never called.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import billing from '../src/routes/billing.ts';
import budget from '../src/routes/ai_budget.ts';
import { loadAiBudget, reserveAiBudget, resolveAiCaps, listAiLicenceCaps } from '../src/services/aiBudget.ts';
import { plansAndPacks } from '../src/services/aiCredits.ts';
import { PLAN_AI_SHARE, allowanceFromCharge, chargeOf, planAllowanceFor } from '../src/services/planAllowance.ts';

const JWT_SECRET = 'x'.repeat(64); // synthetic fixture key
const ADMIN = 1, FOUNDER = 2, INVESTOR = 3, COLLEAGUE = 4, MI = 5, ADVISOR = 6, NOBODY = 7;
const NOW = new Date('2026-10-19T12:00:00Z');

function fixture() {
  const { DB, db } = aiBudgetFixture();
  // Each test sets its own plans: no fixture member pays anything here.
  db.exec(`DELETE FROM member_subscription_amounts;
    ALTER TABLE users ADD COLUMN stripe_customer_id TEXT; ALTER TABLE users ADD COLUMN stripe_subscription_id TEXT;
    ALTER TABLE users ADD COLUMN investor_stripe_customer_id TEXT; ALTER TABLE users ADD COLUMN investor_stripe_subscription_id TEXT;
    ALTER TABLE users ADD COLUMN investor_seat_primary_user_id INTEGER; ALTER TABLE users ADD COLUMN investor_dealroom_max INTEGER;
    ALTER TABLE users ADD COLUMN jwt_min_iat INTEGER DEFAULT 0;
    UPDATE users SET role = 'investor' WHERE id = 4; UPDATE users SET role = 'advisor' WHERE id = 6;
    CREATE TABLE mi_pro_subscriptions(user_id INTEGER PRIMARY KEY, status TEXT NOT NULL DEFAULT 'free', subscription_id TEXT UNIQUE, plan TEXT, period_end TEXT, stripe_customer_id TEXT, updated_at TEXT);
    CREATE TABLE account_subscriptions(user_id INTEGER PRIMARY KEY, plan_group TEXT, plan TEXT, status TEXT NOT NULL DEFAULT 'free', subscription_id TEXT UNIQUE, period_end TEXT, trial_end TEXT, stripe_customer_id TEXT, updated_at TEXT);
    CREATE TABLE stripe_products(id TEXT PRIMARY KEY, name TEXT, kind TEXT, active INTEGER DEFAULT 1, metadata_json TEXT NOT NULL DEFAULT '{}', prices_json TEXT NOT NULL DEFAULT '[]');`);
  const price = (id: string, cents: number, interval: string) => ({ id, unit_amount: cents, currency: 'usd', interval, interval_count: 1, active: true });
  const product = db.prepare("INSERT INTO stripe_products(id, name, kind, metadata_json, prices_json) VALUES (?, ?, 'subscription', ?, ?)");
  product.run('prod_growth', 'Founder — Growth', JSON.stringify({ tier: 'growth' }), JSON.stringify([price('price_growth_m', 7900, 'month')]));
  product.run('prod_studio', 'Founder — Studio', JSON.stringify({ tier: 'studio' }), JSON.stringify([price('price_studio_m', 24900, 'month')]));
  product.run('prod_pro', 'Investor — Professional', JSON.stringify({ investor_tier: 'professional' }),
    JSON.stringify([price('price_pro_m', 14900, 'month'), price('price_pro_y', 142800, 'year')]));
  product.run('prod_mi', 'Market Intelligence Pro', JSON.stringify({ plan: 'mi_pro' }), JSON.stringify([price('price_mi_m', 2900, 'month'), price('price_mi_y', 29000, 'year')]));
  product.run('prod_ra', 'Registered Agent', JSON.stringify({}), JSON.stringify([price('price_ra_y', 10000, 'year')]));
  const env = { DB, JWT_SECRET, ENVIRONMENT: 'test' } as any;
  return { db, env };
}
const app = (() => {
  const a = new Hono<any>();
  a.route('/api/billing', billing);
  a.route('/api/ai-budget', budget);
  return a;
})();
async function call(env: any, method: string, path: string, body?: unknown, id = FOUNDER) {
  const token = await new SignJWT({ user_id: id, role: id === ADMIN ? 'admin' : 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request(path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, env);
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
const hook = (env: any, type: string, object: Record<string, unknown>) => call(env, 'POST', '/api/billing/stripe/webhook', { type, data: { object } });
const sub = (id: string, meta: Record<string, string>, cents: number, interval: string, extra: Record<string, unknown> = {}) => ({
  id, object: 'subscription', status: 'active', current_period_end: 1_800_000_000, metadata: meta,
  items: { data: [{ quantity: 1, price: { unit_amount: cents, currency: 'usd', recurring: { interval, interval_count: 1 } } }] }, ...extra,
});
const rows = (db: any) => db.prepare('SELECT subscription_id, user_id, plan_family, amount_cents, interval, status FROM member_subscription_amounts ORDER BY id').all().map((r: any) => ({ ...r }));

test('each plan in the issue gives 25% of its monthly-equivalent price, rounded down, in micro-USD', () => {
  // Mutation checked: ÷ 12 dropped for a yearly price → $357 a month.
  assert.equal(PLAN_AI_SHARE, 0.25);
  assert.deepEqual([
    allowanceFromCharge(7900, 'month', 1), allowanceFromCharge(24900, 'month', 1),
    allowanceFromCharge(14900, 'month', 1), allowanceFromCharge(142800, 'year', 1),
    allowanceFromCharge(59900, 'month', 1), allowanceFromCharge(574800, 'year', 1),
    allowanceFromCharge(2900, 'month', 1), allowanceFromCharge(29000, 'year', 1),
  ], [19_750_000, 62_250_000, 37_250_000, 29_750_000, 149_750_000, 119_750_000, 7_250_000, 6_041_666]);
  assert.equal(allowanceFromCharge(2000, 'month', 1), 5_000_000, 'the owner\'s example: $20 gives $5');
  assert.deepEqual([allowanceFromCharge(0, 'month', 1), allowanceFromCharge(2000, 'week', 1), allowanceFromCharge(-1, 'month', 1), allowanceFromCharge(1.5, 'month', 1)], [0, 0, 0, 0]);
  assert.equal(allowanceFromCharge(24000, 'month', 3), 20_000_000, 'every three months counts ÷ 3');
  assert.deepEqual(chargeOf({ items: { data: [
    { quantity: 2, price: { unit_amount: 1000, currency: 'usd', recurring: { interval: 'month' } } },
    { quantity: 1, price: { unit_amount: 500, currency: 'usd', recurring: { interval: 'month' } } },
    { quantity: 1, price: { unit_amount: 9999, currency: 'usd', recurring: { interval: 'year' } } },
  ] } }), { amount_cents: 2500, currency: 'usd', interval: 'month', interval_count: 1, price_id: null }, 'unit × quantity, at the first item\'s interval');
});

test('the webhook records what each member plan pays, and nothing for Registered Agent', async () => {
  // Mutation checked: skip recordSubscriptionAmount in the webhook → no rows.
  const { db, env } = fixture();
  db.exec(`UPDATE users SET stripe_customer_id = 'cus_f' WHERE id = 2; UPDATE users SET investor_stripe_customer_id = 'cus_i' WHERE id = 3`);
  for (const [object] of [
    [sub('sub_f', { kind: 'tier', tier: 'growth' }, 5900, 'month', { customer: 'cus_f' })],
    [sub('sub_i', { kind: 'investor', investor_tier: 'professional' }, 142800, 'year', { customer: 'cus_i' })],
    [sub('sub_m', { kind: 'mi', user_id: '5' }, 2900, 'month', { customer: 'cus_m' })],
    [sub('sub_a', { kind: 'plan', plan_group: 'advisor', user_id: '6' }, 4900, 'month', { customer: 'cus_a' })],
    [sub('sub_ra', { kind: 'registered_agent' }, 10000, 'year', { customer: 'cus_f' })],
  ] as const) assert.equal((await hook(env, 'customer.subscription.created', object as any)).status, 200);
  assert.deepEqual(rows(db), [
    { subscription_id: 'sub_f', user_id: 2, plan_family: 'founder', amount_cents: 5900, interval: 'month', status: 'active' },
    { subscription_id: 'sub_i', user_id: 3, plan_family: 'investor', amount_cents: 142800, interval: 'year', status: 'active' },
    { subscription_id: 'sub_m', user_id: 5, plan_family: 'market_intelligence', amount_cents: 2900, interval: 'month', status: 'active' },
    { subscription_id: 'sub_a', user_id: 6, plan_family: 'advisor', amount_cents: 4900, interval: 'month', status: 'active' },
  ]);
  db.close();
});

test('an update changes the amount; a deletion cancels; an older update never revives a canceled plan', async () => {
  // Mutation checked: drop the "status <> 'canceled'" guard → the late update revives the row.
  const { db, env } = fixture();
  db.exec(`UPDATE users SET stripe_customer_id = 'cus_f' WHERE id = 2`);
  await hook(env, 'customer.subscription.created', sub('sub_f', { kind: 'tier', tier: 'growth' }, 7900, 'month', { customer: 'cus_f' }));
  await hook(env, 'customer.subscription.updated', sub('sub_f', { kind: 'tier', tier: 'studio' }, 19900, 'month', { customer: 'cus_f' }));
  assert.equal(rows(db)[0].amount_cents, 19900, 'a grandfathered or discounted price is what is recorded');
  await hook(env, 'customer.subscription.deleted', { id: 'sub_f', customer: 'cus_f', status: 'canceled', metadata: { kind: 'tier' } });
  assert.equal(rows(db)[0].status, 'canceled');
  await hook(env, 'customer.subscription.updated', sub('sub_f', { kind: 'tier', tier: 'studio' }, 19900, 'month', { customer: 'cus_f' }));
  assert.equal(rows(db)[0].status, 'canceled');
  db.close();
});

test('the member\'s allowance: their own price, yearly ÷ 12, two plans add up, and no plan is $0', async () => {
  // Mutation checked: count only the first row → the second plan's share is lost.
  const { db, env } = fixture();
  const add = db.prepare(`INSERT INTO member_subscription_amounts(subscription_id, user_id, plan_family, amount_cents, currency, interval, interval_count, status)
    VALUES (?, ?, ?, ?, 'usd', ?, 1, ?)`);
  add.run('sub_f', FOUNDER, 'founder', 5900, 'month', 'active'); // a discounted Growth: $59, not the catalogue's $79
  add.run('sub_m', FOUNDER, 'market_intelligence', 29000, 'year', 'active');
  add.run('sub_i', INVESTOR, 'investor', 142800, 'year', 'active');
  add.run('sub_t', MI, 'market_intelligence', 2900, 'month', 'trialing');
  assert.equal((await resolveAiCaps(env, FOUNDER)).monthly_microusd, 14_750_000 + 6_041_666);
  assert.equal((await resolveAiCaps(env, INVESTOR)).monthly_microusd, 29_750_000);
  const trial = await resolveAiCaps(env, MI);
  assert.deepEqual([trial.monthly_microusd, trial.source], [0, 'none'], 'a trial has not been paid');
  const nobody = await resolveAiCaps(env, NOBODY);
  assert.deepEqual([nobody.monthly_microusd, nobody.source, nobody.daily_capped], [0, 'none', false]);
  db.close();
});

test('a subscriber with no recorded row reads the catalogue price; a free founder and a seat colleague read $0', async () => {
  // Mutation checked: count a founder whose subscription_status is the column default with no subscription id → $19.75.
  // Mutation checked: drop the seat check → the colleague, who kept the id of a subscription of their own from before the seat, reads $37.25.
  const { db, env } = fixture();
  db.exec(`UPDATE users SET subscription_tier = 'growth', stripe_subscription_id = 'sub_old', subscription_status = 'active' WHERE id = 2;
    UPDATE users SET investor_tier = 'professional', investor_subscription_status = 'active', investor_stripe_subscription_id = 'sub_inv' WHERE id = 3;
    UPDATE users SET investor_tier = 'professional', investor_subscription_status = 'active', investor_seat_primary_user_id = 3, investor_stripe_subscription_id = 'sub_own_before_seat' WHERE id = 4;
    UPDATE users SET subscription_tier = 'studio' WHERE id = 7;
    INSERT INTO mi_pro_subscriptions(user_id, status, subscription_id, plan) VALUES (5, 'active', 'sub_mi', 'mi_pro_annual');
    INSERT INTO account_subscriptions(user_id, plan_group, plan, status, subscription_id) VALUES (6, 'advisor', 'advisor_monthly', 'active', 'sub_adv');`);
  const f = await planAllowanceFor(env, db.prepare('SELECT * FROM users WHERE id = 2').get());
  assert.deepEqual([f.monthly_microusd, f.source, f.parts[0].source], [19_750_000, 'catalogue', 'catalogue']);
  assert.equal((await resolveAiCaps(env, INVESTOR)).monthly_microusd, 37_250_000, 'no interval recorded: the monthly price');
  assert.equal((await resolveAiCaps(env, MI)).monthly_microusd, 6_041_666, 'an annual Market Intelligence plan: its yearly price ÷ 12');
  assert.equal((await resolveAiCaps(env, ADVISOR)).monthly_microusd, 0, 'no advisor plan in the catalogue: nothing invented');
  assert.equal((await resolveAiCaps(env, COLLEAGUE)).monthly_microusd, 0, 'a seat colleague does not pay');
  assert.equal((await resolveAiCaps(env, NOBODY)).monthly_microusd, 0, 'a studio tier with no subscription is not paid');
  // Once the webhook records the member's own amount, the catalogue is no longer read for that family.
  db.prepare(`INSERT INTO member_subscription_amounts(subscription_id, user_id, plan_family, amount_cents, currency, interval, interval_count, status)
    VALUES ('sub_old', 2, 'founder', 5900, 'usd', 'month', 1, 'active')`).run();
  const after = await resolveAiCaps(env, FOUNDER);
  assert.deepEqual([after.monthly_microusd, after.source], [14_750_000, 'plan']);
  db.close();
});

test('no plan: a run draws tokens, or is refused with the month\'s words when there are none', async () => {
  // Mutation checked: keep the day refusal for members → budget_user_day.
  const { db, env } = fixture();
  const refused = await reserveAiBudget(env, NOBODY, 1000, NOW);
  assert.deepEqual(refused, { ok: false, refusal: 'budget_user_month' });
  db.prepare('UPDATE ai_topup_accounts SET balance_microusd = 5_000_000 WHERE user_id = ?').run(NOBODY);
  const held = await reserveAiBudget(env, NOBODY, 1000, NOW);
  assert.equal(held.ok, true);
  const row = db.prepare('SELECT included_microusd, topup_microusd FROM ai_budget_reservations WHERE user_id = ?').get(NOBODY) as any;
  assert.deepEqual([row.included_microusd, row.topup_microusd], [0, 1000], 'every run uses tokens');
  db.close();
});

test('there is no daily cap: a member spends past the old $5 a day within the month', async () => {
  // Mutation checked: daily_microusd stays the environment's $5 → the second hold is refused.
  const { db, env } = fixture();
  db.prepare(`INSERT INTO member_subscription_amounts(subscription_id, user_id, plan_family, amount_cents, currency, interval, interval_count, status)
    VALUES ('sub_s', ?, 'founder', 24900, 'usd', 'month', 1, 'active')`).run(FOUNDER);
  for (let i = 0; i < 3; i++) assert.equal((await reserveAiBudget(env, FOUNDER, 20_000_000, NOW)).ok, true, `hold ${i + 1} of $20`);
  const b = await loadAiBudget(env, FOUNDER, NOW);
  assert.deepEqual([b.daily_capped, b.monthly_microusd, b.month_reserved_microusd], [false, 62_250_000, 60_000_000]);
  assert.deepEqual(await reserveAiBudget(env, FOUNDER, 3_000_000, NOW), { ok: false, refusal: 'budget_user_month' }, 'the month is the only limit');
  db.close();
});

test('the admin licence keeps its typed caps and its day', async () => {
  // Mutation checked: compute the admin licence from plans → $0.
  const { db, env } = fixture();
  db.prepare('INSERT INTO ai_licence_caps(licence_key, daily_microusd, monthly_microusd, recorded_by) VALUES (?, ?, ?, 1)').run('admin', 2_000_000, 9_000_000);
  db.prepare('INSERT INTO ai_licence_caps(licence_key, daily_microusd, monthly_microusd, recorded_by) VALUES (?, ?, ?, 1)').run('founder:free', 1_000_000, 4_000_000);
  const admin = await resolveAiCaps(env, ADMIN);
  assert.deepEqual([admin.source, admin.daily_capped, admin.daily_microusd, admin.monthly_microusd], ['recorded', true, 2_000_000, 9_000_000]);
  assert.equal((await resolveAiCaps(env, NOBODY)).monthly_microusd, 0, 'a cap typed for a member licence is no longer read');
  assert.equal((await reserveAiBudget(env, ADMIN, 1_500_000, NOW)).ok, true);
  assert.deepEqual(await reserveAiBudget(env, ADMIN, 1_000_000, NOW), { ok: false, refusal: 'budget_user_day' }, 'the admin licence still has a day');
  const list = await listAiLicenceCaps(env);
  const by = (k: string) => list.find((r: any) => r.licence_key === k) as any;
  assert.deepEqual([by('admin').editable, by('admin').source], [true, 'recorded']);
  assert.deepEqual([by('founder:free').editable, by('founder:free').source, by('founder:free').monthly_microusd, by('founder:free').ignored_recorded], [false, 'computed', null, true]);
  db.close();
});

test('the reads: /me says there is no day, HQ cannot type a member plan, and each price says what it includes', async () => {
  // Mutation checked: let PUT /caps write a member licence → 200.
  const { db, env } = fixture();
  db.prepare(`INSERT INTO member_subscription_amounts(subscription_id, user_id, plan_family, amount_cents, currency, interval, interval_count, status)
    VALUES ('sub_f', ?, 'founder', 7900, 'usd', 'month', 1, 'active')`).run(FOUNDER);
  const me = await call(env, 'GET', '/api/ai-budget/me');
  assert.equal(me.status, 200);
  assert.deepEqual([me.body.daily_capped, me.body.monthly_microusd, me.body.plan.share, me.body.plan.monthly_microusd], [false, 19_750_000, 0.25, 19_750_000]);
  assert.deepEqual(me.body.plan.parts, [{ family: 'founder', source: 'recorded', interval: 'month', allowance_microusd: 19_750_000 }]);
  assert.ok(!JSON.stringify(me.body).includes('amount_cents'), 'the read names what the plan gives, not what it cost');
  // Mutation checked: pass the Super Admin's member read the raw plan → amount_cents in its body.
  const account = await call(env, 'GET', `/api/ai-budget/members/${FOUNDER}`, undefined, ADMIN);
  assert.equal(account.status, 200);
  assert.deepEqual(account.body.allowance.plan, me.body.plan, 'the Super Admin reads the same projection');
  assert.ok(!JSON.stringify(account.body).includes('amount_cents'), 'nor does the Super Admin\'s member read');
  const typed = await call(env, 'PUT', '/api/ai-budget/caps/founder:growth', { daily_usd: 1, monthly_usd: 10 }, ADMIN);
  assert.deepEqual([typed.status, typed.body.error ?? typed.body.code], [409, 'ai_allowance_computed']);
  assert.equal((await call(env, 'PUT', '/api/ai-budget/caps/admin', { daily_usd: 1, monthly_usd: 10 }, ADMIN)).status, 200);
  const caps = await call(env, 'GET', '/api/ai-budget/caps', undefined, ADMIN);
  assert.equal(caps.status, 200);
  assert.equal(caps.body.share, 0.25);
  const pro = caps.body.catalogue.find((p: any) => p.product_id === 'prod_pro');
  assert.deepEqual(pro.prices.map((p: any) => [p.price_id, p.allowance_microusd]), [['price_pro_m', 37_250_000], ['price_pro_y', 29_750_000]]);
  assert.deepEqual(pro.allowance, { share: 0.25, monthly_microusd: 37_250_000, source: 'plan' }, 'the card\'s figure is its monthly price\'s');
  const pub = await plansAndPacks(env);
  const free = pub.plans.find((p: any) => p.free && p.family === 'founder') as any;
  assert.deepEqual(free.allowance, { share: 0.25, monthly_microusd: 0, source: 'none' }, 'no plan, no allowance');
  assert.ok(!pub.plans.some((p: any) => p.plan_name === 'Registered Agent'), 'Registered Agent is not a member plan');
  db.close();
});
