/**
 * D4293 (#4293, D4289 P4) — influencer offers: a Promos code with an owner,
 * applied at checkout to a member that influencer referred, inside its budget
 * and the terms' offer budget; never stacked with a typed code; HQ's link and
 * change, audited; the influencer's offers read and "Ask HQ for an offer".
 *
 * The database is the baseline plus every migration (`loadSchema`). Stripe is
 * stubbed: every call is recorded so a test can say what was sent. Services are
 * given `now`. Every person is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/influencer_offers_d4293.test.ts
 */
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import checkout from '../src/routes/billing_checkout.ts';
import { mount } from '../src/routes/influencer_offers.ts';
import { autoOffer, featuredOffer, offersRead, NOT_RECORDED } from '../src/services/influencerOffers.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'd4293-unit-test-jwt-secret-0123456789-abcdef';
const SUPER = 1, JANE = 10, MEMBER = 20, OTHER = 21, STRANGER = 22;
const NOW = Date.UTC(2026, 10, 3, 12, 0, 0);
const DAY = 86_400_000;

// ── Stripe, stubbed ─────────────────────────────────────────────────────────
type Call = { url: string; method: string; body: string };
let calls: Call[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = String(typeof input === 'string' ? input : input?.url);
  const method = String(init?.method || 'GET').toUpperCase();
  calls.push({ url, method, body: String(init?.body ?? '') });
  const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200 });
  const path = url.replace('https://api.stripe.com/v1', '').split('?')[0];
  if (path === '/subscriptions' && method === 'GET') return json({ data: [] });
  if (path === '/subscriptions' && method === 'POST') {
    return json({ id: 'sub_new1', status: 'incomplete', latest_invoice: { id: 'in_1', payment_intent: { id: 'pi_1', client_secret: 'pi_1' + '_secret_' + 'fixture' } } });
  }
  return new Response('unexpected call in test: ' + method + ' ' + url, { status: 599 });
}) as typeof fetch;
process.on('exit', () => { globalThis.fetch = realFetch; });
beforeEach(() => { calls = []; });
const posted = () => calls.filter((c) => c.method === 'POST').map((c) => new URLSearchParams(c.body));

const PRICES = JSON.stringify([
  { id: 'price_growth_m', unit_amount: 10000, currency: 'usd', interval: 'month', interval_count: 1, nickname: null, type: 'recurring', active: true },
  { id: 'price_growth_y', unit_amount: 100000, currency: 'usd', interval: 'year', interval_count: 1, nickname: null, type: 'recurring', active: true },
]);
const GROWTH = { id: 'prod_growth', metadata: { tier: 'growth' } };

function world(opts: { offerBudgetCents?: number | null } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  const u = db.prepare('INSERT INTO users (id, role, name, email, uid, is_active, email_verified, stripe_customer_id) VALUES (?, ?, ?, ?, ?, 1, 1, ?)');
  u.run(SUPER, 'admin', 'Sue Super', 'sue@example.test', 'uid-sue', null);
  u.run(JANE, 'investor', 'Jane Creator', 'jane@example.test', 'uid-jane', null);
  u.run(MEMBER, 'founder', 'Max Member', 'max@example.test', 'uid-max', 'cus_max');
  u.run(OTHER, 'founder', 'Omar Other', 'omar@example.test', 'uid-omar', 'cus_omar');
  u.run(STRANGER, 'founder', 'Sid Stranger', 'sid@example.test', 'uid-sid', null);
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  for (const [id, jti] of [[SUPER, 'totp-sue'], [MEMBER, 'totp-max'], [JANE, 'totp-jane'], [STRANGER, 'totp-sid']] as const) {
    db.prepare("INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at) VALUES (?, ?, 'totp', 'totp', datetime('now'))").run(id, jti);
  }
  db.prepare("INSERT INTO referral_partners (id, user_id, segment, added_by) VALUES (1, ?, 'venture_scouts', ?)").run(JANE, SUPER);
  db.prepare(`INSERT INTO referral_partner_terms (id, uid, partner_id, segment, status, starts_on, currency, offer_budget_cents, created_by,
      submitted_by, submitted_at, approved_by, approved_at, envelope_id, sent_by, sent_at, signed_at)
    VALUES (1, 'terms-jane', 1, 'venture_scouts', 'signed', '2025-01-01', 'USD', ?, ?, ?, '2025-01-01', ?, '2025-01-01', 9, ?, '2025-01-01', '2025-01-01')`)
    .run(opts.offerBudgetCents ?? null, SUPER, SUPER, SUPER, SUPER);
  db.prepare("INSERT INTO stripe_products (id, name, kind, active, metadata_json, prices_json, livemode) VALUES ('prod_growth', 'Validate + Build', 'subscription', 1, ?, ?, 0)")
    .run(JSON.stringify({ tier: 'growth' }), PRICES);
  const promo = db.prepare(`INSERT INTO promo_codes (id, code, code_normalized, coupon_id, percent_off, amount_off, currency, duration, duration_in_months, product_ids_json,
      max_redemptions, times_redeemed, active, expires_at, plan_keys_json, intervals_json, once_per_member, first_purchase_only, created_at, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', NULL, 0, 1, ?, ?, ?, ?, 0, datetime('now'), datetime('now'))`);
  promo.run('promo_jane20', 'JANE20', 'JANE20', 'cpn_20', 20, null, null, 'repeating', 3, '2027-01-01T00:00:00Z', '[]', null, 1);
  promo.run('promo_jane10', 'JANE10', 'JANE10', 'cpn_10', 10, null, null, 'once', null, null, '["tier:studio"]', null, 0);
  promo.run('promo_typed', 'TYPED5', 'TYPED5', 'cpn_5', 5, null, null, 'once', null, null, '[]', null, 0);
  promo.run('promo_eur', 'JANEEUR', 'JANEEUR', 'cpn_eur', null, 1000, 'eur', 'once', null, null, '[]', null, 0);
  db.exec(`CREATE TABLE IF NOT EXISTS referral_attributions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL UNIQUE, referral_code TEXT NOT NULL,
    referrer_user_id INTEGER NOT NULL, first_touch_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, expires_at TIMESTAMP NOT NULL, converted_payment_intent_id TEXT, converted_at TIMESTAMP, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
  const attr = db.prepare("INSERT INTO referral_attributions (user_id, referral_code, referrer_user_id, expires_at) VALUES (?, 'h:jane', ?, ?)");
  attr.run(MEMBER, JANE, '2099-01-01T00:00:00.000Z');
  attr.run(OTHER, JANE, new Date(NOW - DAY).toISOString()); // expired yesterday
  attr.run(JANE, JANE, '2099-01-01T00:00:00.000Z'); // a self-attribution, which never counts
  const env = { DB: d1Over(db), ENVIRONMENT: 'test', JWT_SECRET, STRIPE_SECRET_KEY: 'sk_test_sentinel', STRIPE_PUBLISHABLE_KEY: 'pk_test_fixture', STRIPE_WEBHOOK_SECRET: 'fixture-signing' } as any;
  return { db, env };
}
function offer(db: DatabaseSync, uid: string, promoId: string, o: { budget?: number; currency?: string; status?: string; featured?: number } = {}) {
  db.prepare(`INSERT INTO influencer_offers (uid, influencer_user_id, promo_id, budget_cents, currency, status, featured, created_by, ended_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(uid, JANE, promoId, o.budget ?? 50000, o.currency ?? 'USD', o.status ?? 'active', o.featured ?? 0, SUPER, o.status === 'ended' ? '2026-10-01' : null);
}
function redeemed(db: DatabaseSync, promoId: string, user: number, pi: string, discount: number | null, currency: string | null = 'usd') {
  db.prepare("INSERT INTO promo_redemptions (promo_id, user_id, payment_intent_id, source, discount_cents, currency) VALUES (?, ?, ?, 'subscription', ?, ?)").run(promoId, user, pi, discount, currency);
}
const sale = (unitAmount = 10000, currency = 'usd', interval = 'month') => ({ product: GROWTH, interval, unitAmount, currency });

const app = (() => {
  const a = new Hono<any>();
  a.route('/api/billing', checkout);
  for (const m of mount) a.route(m.path, m.router);
  a.onError((err: any, c) => {
    const s = AUTH_ERROR_STATUSES[String(err?.message || '')];
    return s ? c.json({ detail: err.message, code: err.message }, s) : c.json({ detail: String(err?.message || '') }, 500);
  });
  return a;
})();
async function hit(env: any, db: DatabaseSync, method: string, path: string, who: number, body?: unknown) {
  const role = (db.prepare('SELECT role FROM users WHERE id = ?').get(who) as any).role;
  const jti = (db.prepare('SELECT jti FROM user_sessions WHERE user_id = ?').get(who) as any)?.jti;
  const token = await new SignJWT({ user_id: who, role, ...(jti ? { jti } : {}) }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await app.request(path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, env);
    const text = await res.text();
    let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body: json, text };
  } finally { [console.warn, console.error] = saved; }
}

test('a member who came through the handle gets the offer; nobody else does', async () => {
  const { db, env } = world();
  offer(db, 'off-20', 'promo_jane20');
  const r = await autoOffer(env, MEMBER, sale(), NOW);
  assert.equal(r.applied?.offer.uid, 'off-20');
  assert.equal(r.applied?.promo.id, 'promo_jane20');
  assert.equal(r.applied?.discountCents, 2000);
  assert.equal((await autoOffer(env, STRANGER, sale(), NOW)).applied, null, 'not attributed');
  assert.equal((await autoOffer(env, OTHER, sale(), NOW)).applied, null, 'the attribution window has closed');
  assert.equal((await autoOffer(env, JANE, sale(), NOW)).applied, null, 'nobody is their own referral');
});

test('featured first; a paused or ended offer, another plan, another currency or a used once-per-member code is skipped', async () => {
  const { db, env } = world();
  db.prepare(`INSERT INTO promo_codes (id, code, code_normalized, coupon_id, percent_off, duration, product_ids_json, times_redeemed, active, created_at, synced_at)
    VALUES ('promo_plain', 'PLAIN', 'PLAIN', 'cpn_plain', 15, 'once', '[]', 0, 1, datetime('now'), datetime('now'))`).run();
  offer(db, 'off-plain', 'promo_plain'); // older and applicable, but not featured
  offer(db, 'off-paused', 'promo_typed', { status: 'paused' });
  offer(db, 'off-studio', 'promo_jane10');
  offer(db, 'off-eur', 'promo_eur', { currency: 'EUR' });
  offer(db, 'off-20', 'promo_jane20', { featured: 1 });
  let r = await autoOffer(env, MEMBER, sale(), NOW);
  assert.equal(r.applied?.offer.uid, 'off-20', 'the featured offer comes first');
  redeemed(db, 'promo_jane20', MEMBER, 'pi_before', 2000);
  r = await autoOffer(env, MEMBER, sale(), NOW);
  assert.equal(r.applied?.offer.uid, 'off-plain', 'with the featured code used, the next offer applies');
  db.prepare("UPDATE influencer_offers SET status = 'paused' WHERE uid = 'off-plain'").run();
  r = await autoOffer(env, MEMBER, sale(), NOW);
  assert.equal(r.applied, null);
  assert.deepEqual(Object.fromEntries(r.skipped.map((s) => [s.uid, s.why])), {
    'off-20': 'code_refused', 'off-plain': 'paused', 'off-paused': 'paused', 'off-studio': 'plan_not_in_offer', 'off-eur': 'currency',
  });
  db.prepare("UPDATE influencer_offers SET status = 'ended', ended_at = '2026-10-01' WHERE uid = 'off-paused'").run();
  assert.equal((await autoOffer(env, MEMBER, sale(), NOW)).skipped.find((s) => s.uid === 'off-paused')?.why, 'ended');
});

test('the budget is spent from the redemptions, per currency; the terms cap all of an influencer’s offers', async () => {
  const { db, env } = world({ offerBudgetCents: 5000 });
  offer(db, 'off-20', 'promo_jane20', { budget: 3000 });
  redeemed(db, 'promo_jane20', OTHER, 'pi_a', 1500);
  redeemed(db, 'promo_jane20', STRANGER, 'pi_eur', 9000, 'eur'); // another currency does not spend a USD budget
  assert.equal((await autoOffer(env, MEMBER, sale(), NOW)).applied, null, '1,500 given + 2,000 now passes the 3,000 budget');
  assert.deepEqual((await autoOffer(env, MEMBER, sale(), NOW)).skipped, [{ uid: 'off-20', why: 'budget_used' }]);
  assert.equal((await autoOffer(env, MEMBER, sale(5000), NOW)).applied?.discountCents, 1000, 'a smaller discount still fits');

  db.prepare("UPDATE influencer_offers SET budget_cents = 100000 WHERE uid = 'off-20'").run();
  db.prepare(`INSERT INTO promo_codes (id, code, code_normalized, coupon_id, percent_off, duration, product_ids_json, times_redeemed, active, created_at, synced_at)
    VALUES ('promo_old', 'OLD', 'OLD', 'cpn_old', 50, 'once', '[]', 0, 1, datetime('now'), datetime('now'))`).run();
  offer(db, 'off-old', 'promo_old', { status: 'ended' });
  redeemed(db, 'promo_old', OTHER, 'pi_old', 2000);
  // 1,500 + 2,000 given across her offers, + 2,000 now passes the terms' 5,000.
  assert.deepEqual((await autoOffer(env, MEMBER, sale(), NOW)).skipped.map((s) => s.why), ['terms_budget_used', 'ended']);
});

test('checkout: no code typed applies the offer; a typed code wins and nothing is stacked', async () => {
  const { db, env } = world();
  offer(db, 'off-20', 'promo_jane20');
  const q = await hit(env, db, 'POST', '/api/billing/checkout/quote', MEMBER, { plan_key: 'founder:growth', interval: 'month' });
  assert.equal(q.status, 200, q.text);
  assert.deepEqual(q.body.discount, { amount: 2000, code: 'JANE20' });
  assert.deepEqual(q.body.influencer_offer, { uid: 'off-20' });

  const s1 = await hit(env, db, 'POST', '/api/billing/checkout/start', MEMBER, { plan_key: 'founder:growth', interval: 'month', nonce: 'nonce-press-0001' });
  assert.equal(s1.status, 200, s1.text);
  const sub = posted().find((p) => p.get('items[0][price]'))!;
  assert.equal(sub.get('discounts[0][promotion_code]'), 'promo_jane20');
  assert.equal(sub.get('metadata[influencer_offer_uid]'), 'off-20');
  assert.equal(sub.get('discounts[1][promotion_code]'), null);

  calls = [];
  const typedQ = await hit(env, db, 'POST', '/api/billing/checkout/quote', MEMBER, { plan_key: 'founder:growth', interval: 'month', promo_code: 'TYPED5' });
  assert.deepEqual([typedQ.body.discount?.code, typedQ.body.influencer_offer], ['TYPED5', null]);
  const s2 = await hit(env, db, 'POST', '/api/billing/checkout/start', MEMBER, { plan_key: 'founder:growth', interval: 'month', nonce: 'nonce-press-0002', promo_code: 'TYPED5' });
  assert.equal(s2.status, 200, s2.text);
  const sub2 = posted().find((p) => p.get('items[0][price]'))!;
  assert.equal(sub2.get('discounts[0][promotion_code]'), 'promo_typed');
  assert.equal(sub2.get('metadata[influencer_offer_uid]'), null);
  assert.equal(sub2.get('discounts[1][promotion_code]'), null);

  const none = await hit(env, db, 'POST', '/api/billing/checkout/quote', STRANGER, { plan_key: 'founder:growth', interval: 'month' });
  assert.deepEqual([none.body.discount, none.body.influencer_offer], [null, null]);
});

test('the offers read: plans, discount, who it is for, uses, discount given per currency, remaining budget, end date; a missing value reads Not recorded', async () => {
  const { db, env } = world();
  offer(db, 'off-20', 'promo_jane20', { budget: 10000, featured: 1 });
  offer(db, 'off-studio', 'promo_jane10', { budget: 5000, status: 'paused' });
  redeemed(db, 'promo_jane20', OTHER, 'pi_a', 2000);
  redeemed(db, 'promo_jane20', STRANGER, 'pi_b', 2000);
  redeemed(db, 'promo_jane10', OTHER, 'pi_old', null, null); // a use from before D1274: no discount recorded
  db.prepare(`INSERT INTO influencer_offers (uid, influencer_user_id, promo_id, budget_cents, currency, status, created_by) VALUES ('off-gone', ?, 'promo_missing', 100, 'USD', 'active', ?)`).run(JANE, SUPER);
  const { offers } = await offersRead(env, JANE, NOW);
  const by = Object.fromEntries(offers.map((o: any) => [o.uid, o]));
  assert.deepEqual(by['off-20'], {
    uid: 'off-20', status: 'active', code_state: 'live', featured: true, code: 'JANE20',
    plans: 'Every plan', intervals: 'Monthly and yearly', discount: '20% off for 3 months', who_for: 'Once per member',
    uses: 2, discount_given: [{ currency: 'USD', cents: 4000 }], uses_without_recorded_discount: 0,
    budget: { cents: 10000, currency: 'USD' }, remaining_budget: { cents: 6000, currency: 'USD', budget_used: false },
    ends_at: '2027-01-01T00:00:00Z',
  });
  assert.equal(by['off-studio'].status, 'paused');
  assert.deepEqual(by['off-studio'].plans, ['Raise + Grow']);
  assert.equal(by['off-studio'].uses, 1);
  assert.equal(by['off-studio'].discount_given, NOT_RECORDED, 'a use with no recorded discount is not a zero');
  assert.equal(by['off-studio'].uses_without_recorded_discount, 1);
  assert.equal(by['off-studio'].ends_at, 'No end date');
  assert.equal(by['off-gone'].discount, NOT_RECORDED);
  assert.equal(by['off-gone'].uses, NOT_RECORDED);
  assert.equal(by['off-gone'].code_state, 'unreadable');
  assert.deepEqual((await featuredOffer(env, JANE, NOW))?.discount, '20% off for 3 months');

  const mine = await hit(env, db, 'GET', '/api/influencer/me/offers', JANE);
  assert.equal(mine.status, 200);
  assert.equal(mine.body.offers.length, 3);
  assert.deepEqual((await hit(env, db, 'GET', '/api/influencer/me/offers', STRANGER)).body, { offers: [] }, 'nobody reads another’s offers');
  assert.ok(!/@example\.test/.test(mine.text), 'no member email in the read');
});

test('HQ links a code with a reason; one owner per code, the code’s currency, the terms’ budget; changes are audited', async () => {
  const { db, env } = world({ offerBudgetCents: 20000 });
  const link = (b: Record<string, unknown>, who = SUPER) => hit(env, db, 'POST', '/api/admin/influencers/uid-jane/offers', who, b);
  assert.equal((await link({ promo_id: 'promo_jane20', budget_cents: 10000, currency: 'USD' })).body.error, 'reason_required');
  assert.equal((await link({ promo_id: 'promo_jane20', budget_cents: 10000, currency: 'USD', reason: 'Launch offer for her channel' }, STRANGER)).status, 403);
  assert.equal((await hit(env, db, 'POST', '/api/admin/influencers/uid-sid/offers', SUPER, { promo_id: 'promo_jane20', budget_cents: 1, currency: 'USD', reason: 'Not an influencer at all' })).status, 404);
  const ok = await link({ promo_id: 'promo_jane20', budget_cents: 10000, currency: 'usd', featured: true, reason: 'Launch offer for her channel' });
  assert.equal(ok.status, 201, ok.text);
  assert.deepEqual([ok.body.offer.status, ok.body.offer.currency, ok.body.offer.featured], ['active', 'USD', 1]);
  assert.equal((await link({ promo_id: 'promo_jane20', budget_cents: 100, currency: 'USD', reason: 'Linking the same code twice' })).body.error, 'promo_owned');
  assert.equal((await link({ promo_id: 'promo_eur', budget_cents: 100, currency: 'USD', reason: 'An amount off in euros' })).body.error, 'currency_mismatch');
  assert.equal((await link({ promo_id: 'promo_typed', budget_cents: 10001, currency: 'USD', reason: 'Past the terms budget' })).body.error, 'terms_budget_exceeded');
  assert.equal((await link({ promo_id: 'promo_nope', budget_cents: 100, currency: 'USD', reason: 'A code Promos lacks' })).body.error, 'promo_not_found');
  const second = await link({ promo_id: 'promo_typed', budget_cents: 10000, currency: 'USD', featured: true, reason: 'Second offer, now featured' });
  assert.equal(second.status, 201);
  const featured = db.prepare('SELECT uid FROM influencer_offers WHERE featured = 1').all() as any[];
  assert.deepEqual(featured.map((r) => r.uid), [second.body.offer.uid], 'one featured offer at a time');

  const uid = ok.body.offer.uid;
  const patch = (b: Record<string, unknown>) => hit(env, db, 'PATCH', `/api/admin/influencers/uid-jane/offers/${uid}`, SUPER, b);
  assert.equal((await patch({ status: 'paused' })).body.error, 'reason_required');
  assert.equal((await patch({ status: 'paused', reason: 'Paused while she is away' })).body.offer.status, 'paused');
  assert.equal((await patch({ status: 'nope', reason: 'Not a real status here' })).body.error, 'invalid_status');
  assert.equal((await patch({ status: 'ended', reason: 'The campaign has finished' })).body.offer.status, 'ended');
  assert.equal((await patch({ status: 'active', reason: 'Trying to revive it now' })).body.error, 'offer_ended');
  const audit = db.prepare("SELECT action, viewed_user_id, filters_json FROM admin_audit_log WHERE action LIKE 'influencer_offer_%' ORDER BY id").all() as any[];
  assert.deepEqual(audit.map((a) => a.action), ['influencer_offer_linked', 'influencer_offer_linked', 'influencer_offer_changed', 'influencer_offer_changed']);
  assert.ok(audit.every((a) => a.viewed_user_id === JANE));
  assert.equal(JSON.parse(audit[2].filters_json).reason, 'Paused while she is away');
  assert.deepEqual(JSON.parse(audit[3].filters_json).before.status, 'paused');
});

test('an influencer asks HQ for an offer; HQ is told; a member who is not one is refused', async () => {
  const { db, env } = world();
  assert.equal((await hit(env, db, 'POST', '/api/influencer/me/offers/request', STRANGER, { message: 'Could I have one?' })).status, 403);
  assert.equal((await hit(env, db, 'POST', '/api/influencer/me/offers/request', JANE, { message: '' })).body.error, 'message_required');
  const r = await hit(env, db, 'POST', '/api/influencer/me/offers/request', JANE, { message: 'A yearly offer for my newsletter readers, please.' });
  assert.equal(r.status, 201, r.text);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM influencer_offer_requests WHERE influencer_user_id = ?').get(JANE) as any).n, 1);
  const n = db.prepare("SELECT user_id FROM notifications_inbox WHERE type = 'influencer_offer_requested'").all() as any[];
  assert.deepEqual(n.map((x) => x.user_id), [SUPER]);
});
