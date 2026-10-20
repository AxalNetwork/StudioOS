// D806 (#2245) — Billing's one invoice list (`GET /api/billing/invoices`) and
// the card's billing address on `GET /api/billing/overview`. Real SQLite with
// the AI budget migrations; a pack is recorded, credited and refunded through
// the real D755 code. Stripe is stubbed: no live call, and every customer,
// card and address here is a placeholder.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/billing_invoices_d806.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { ensureCatalogSchema } from '../src/services/catalog.ts';
import { ensureOrdersSchema } from '../src/services/orders.ts';
import { recordAiTopupPurchase, creditAiTopupFromPayment } from '../src/services/aiTopups.ts';
import { reverseRefund } from '../src/services/aiCreditReversals.ts';
import { invoicePaging, orderDescription, stripeInvoiceRow } from '../src/services/billingInvoices.ts';
import billingRoute from '../src/routes/billing.ts';

const M = 1_000_000;
const ME = 2;
const OTHER = 3;
const PACK = 'price_pack25';
const PLAN = 'price_plan_build_monthly';
const day = (d: number) => Math.floor(Date.UTC(2026, 9, d, 12) / 1000);

async function world() {
  const f = aiBudgetFixture();
  const env = { DB: f.DB, JWT_SECRET: 'd806-fixture-only-signing-secret', STRIPE_WEBHOOK_SECRET: 'd806-fixture-only-webhook-secret',
    STRIPE_SECRET_KEY: 'sk' + '_test_fixtureOnly000', ENVIRONMENT: 'development' } as any;
  await ensureCatalogSchema(env);
  await ensureOrdersSchema(env);
  f.db.exec(`ALTER TABLE users ADD COLUMN uid TEXT; ALTER TABLE users ADD COLUMN stripe_customer_id TEXT;
    ALTER TABLE users ADD COLUMN investor_stripe_customer_id TEXT;
    UPDATE users SET uid='uid-'||id, stripe_customer_id='cus_member'||id`);
  f.db.prepare("INSERT INTO stripe_products(id,name,kind,active,metadata_json,prices_json) VALUES('prod_pack25','$25 of tokens','alacarte',1,'{}',?)")
    .run(JSON.stringify([{ id: PACK, product: 'prod_pack25', active: true, currency: 'usd', unit_amount: 2500, nickname: null, type: 'one_time', recurring: null }]));
  f.db.prepare("INSERT INTO stripe_products(id,name,kind,active,metadata_json,prices_json) VALUES('prod_build','Validate + Build','subscription',1,'{}',?)")
    .run(JSON.stringify([{ id: PLAN, product: 'prod_build', active: true, currency: 'usd', unit_amount: 4900, nickname: null, type: 'recurring', recurring: { interval: 'month', interval_count: 1 } }]));
  f.db.prepare("INSERT INTO ai_token_packs(uid,price_id,product_id,face_cents,bonus_microusd,on_sale,origin) VALUES('pack25',?,'prod_pack25',2500,0,1,'created')").run(PACK);
  return { ...f, env };
}

const line = (origin?: string) => JSON.stringify([{ price_id: PACK, product_id: 'prod_pack25', name: '$25 of tokens', kind: 'alacarte',
  quantity: 1, unit_amount: 2500, line_total: 2500, ...(origin ? { origin } : {}) }]);
function order(f: any, ref: string, o: { user?: number; pi?: string | null; at: string; total?: number; status?: string; items?: string }) {
  f.db.prepare(`INSERT INTO orders(id,order_ref,user_id,status,currency,subtotal_cents,total_cents,payment_intent_id,items_json,created_at,paid_at)
    VALUES(?,?,?,?,'usd',?,?,?,?,?,?)`).run(`ord_${ref}`, ref, o.user ?? ME, o.status ?? 'paid', o.total ?? 2500, o.total ?? 2500, o.pi ?? null,
    o.items ?? line(), o.at, o.status === 'pending' ? null : o.at);
}
/** A $25 pack bought, credited by the webhook, as D755 does. */
async function pack(f: any, pi: string, ref: string, user = ME) {
  await recordAiTopupPurchase(f.env, { paymentIntentId: pi, orderRef: ref, userId: user, totalCents: 2500, currency: 'usd',
    quote: { priceId: PACK, creditMicrousd: 25 * M, packUid: 'pack25', bonusMicrousd: 0 } });
  assert.equal(await creditAiTopupFromPayment(f.env, { id: pi, status: 'succeeded', currency: 'usd', amount_received: 2500,
    metadata: { kind: 'cart_order', order_ref: ref, user_id: String(user) } }), true);
}

const invoice = (id: string, created: number, o: Record<string, unknown> = {}) => ({ id, status: 'paid', currency: 'usd', total: 4900, created,
  invoice_pdf: `https://pay.stripe.example/${id}.pdf`, lines: { data: [{ description: '1 × Validate + Build', price: { id: PLAN, recurring: { interval: 'month' } } }] }, ...o });

/** Stripe, stubbed: `invoices` per customer; `down` fails every call. Anything unanswered fails the test. */
function stripeStub(o: { invoices?: Record<string, unknown[]>; down?: boolean; pms?: unknown[] } = {}) {
  const before = globalThis.fetch; const calls: { path: string; customer: string | null }[] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  globalThis.fetch = (async (input: any) => {
    const url = new URL(String(input));
    calls.push({ path: url.pathname, customer: url.searchParams.get('customer') });
    if (o.down) return json({ error: { type: 'api_error', message: 'stubbed outage' } }, 500);
    const customer = url.searchParams.get('customer') ?? '';
    if (url.pathname === '/v1/invoices') return json({ data: o.invoices?.[customer] ?? [], has_more: false });
    if (url.pathname === '/v1/invoices/upcoming') return json({ error: { type: 'invalid_request_error', message: 'none' } }, 404);
    if (url.pathname === '/v1/payment_methods') return json({ data: o.pms ?? [] });
    if (url.pathname === '/v1/subscriptions' || url.pathname === '/v1/charges') return json({ data: [] });
    if (/^\/v1\/customers\/cus_\w+$/.test(url.pathname)) return json({ id: url.pathname.split('/').pop(), invoice_settings: { default_payment_method: 'pm_card1' } });
    throw new Error(`no Stripe stub answers ${url.pathname}`);
  }) as any;
  return { calls, restore: () => { globalThis.fetch = before; } };
}

async function get(f: any, path: string, user = ME) {
  const jwt = await new SignJWT({ user_id: user }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(f.env.JWT_SECRET));
  const r = await billingRoute.request(path, { headers: { Authorization: `Bearer ${jwt}` } }, f.env);
  return { status: r.status, body: await r.json().catch(() => null) as any };
}

/** Two pack orders (one refunded through the real webhook code), three plan invoices, and another member's of each. */
async function fiveRows() {
  const f = await world();
  order(f, 'MRD-A', { pi: 'pi_a', at: '2026-10-05 09:00:00' });
  await pack(f, 'pi_a', 'MRD-A');
  order(f, 'MRD-B', { pi: 'pi_b', at: '2026-10-15 09:00:00' });
  await pack(f, 'pi_b', 'MRD-B');
  assert.equal(await reverseRefund(f.env, { id: 'ch_b', payment_intent: 'pi_b', amount_refunded: 2500, currency: 'usd' }), true);
  order(f, 'MRD-OTHER', { user: OTHER, pi: 'pi_other', at: '2026-10-16 09:00:00' });
  order(f, 'MRD-PENDING', { pi: null, at: '2026-10-17 09:00:00', status: 'pending' });
  const invoices = {
    cus_member2: [invoice('in_1', day(1)), invoice('in_10', day(10)), invoice('in_20', day(20))],
    cus_member3: [invoice('in_other', day(19))],
  };
  return { f, invoices };
}

// 1 ───────────────────────────────────────────────────────────────────────────
test('two orders, one refunded, and three plan invoices: five rows, newest first, two pages at per=3', async () => {
  // Mutations checked: the sort reversed; the refund read dropped; the slice off by one; the pending order listed.
  const { f, invoices } = await fiveRows(); const s = stripeStub({ invoices });
  try {
    const p1 = await get(f, '/invoices?page=1&per=3');
    assert.equal(p1.status, 200);
    assert.equal(p1.body.total, 5);
    assert.equal(p1.body.page, 1);
    assert.equal(p1.body.per, 3);
    assert.equal('degraded' in p1.body, false);
    assert.deepEqual(p1.body.invoices.map((r: any) => [r.kind, r.id, r.status]),
      [['stripe', 'in_20', 'paid'], ['order', 'MRD-B', 'refunded'], ['stripe', 'in_10', 'paid']]);
    const p2 = await get(f, '/invoices?page=2&per=3');
    assert.deepEqual(p2.body.invoices.map((r: any) => r.id), ['MRD-A', 'in_1']);
    assert.equal(p2.body.total, 5);
    const [plan] = p1.body.invoices;
    assert.deepEqual(plan, { kind: 'stripe', id: 'in_20', date: '2026-10-20T12:00:00.000Z', description: 'Validate + Build · monthly',
      amount_cents: 4900, currency: 'usd', status: 'paid', pdf_url: 'https://pay.stripe.example/in_20.pdf' });
    const refunded = p1.body.invoices[1];
    assert.deepEqual(refunded, { kind: 'order', id: 'MRD-B', date: '2026-10-15T09:00:00.000Z', description: 'AI tokens, $25 pack',
      amount_cents: 2500, currency: 'usd', status: 'refunded', pdf_url: '/api/orders/MRD-B/invoice' });
    assert.equal((await get(f, '/invoices')).body.per, 25, '25 to a page by default');
  } finally { s.restore(); f.db.close(); }
});

// 2 ───────────────────────────────────────────────────────────────────────────
test('another member\'s orders and invoices never appear', async () => {
  // Mutations checked: the user filter dropped from the orders read; Stripe read for another customer.
  const { f, invoices } = await fiveRows(); const s = stripeStub({ invoices });
  try {
    const r = await get(f, '/invoices?per=100');
    const ids = r.body.invoices.map((x: any) => x.id);
    assert.equal(ids.includes('MRD-OTHER'), false);
    assert.equal(ids.includes('in_other'), false);
    assert.deepEqual([...new Set(s.calls.map((c) => c.customer))], ['cus_member2'], 'Stripe is asked for the member\'s own customer only');
    const theirs = await get(f, '/invoices?per=100', OTHER);
    assert.deepEqual(theirs.body.invoices.map((x: any) => x.id), ['in_other', 'MRD-OTHER']);
  } finally { s.restore(); f.db.close(); }
});

// 3 ───────────────────────────────────────────────────────────────────────────
test('an investor\'s own Stripe customer is listed too, once', async () => {
  // Mutation checked: only the founder customer read.
  const f = await world();
  f.db.exec("UPDATE users SET investor_stripe_customer_id='cus_investor2' WHERE id=2");
  const s = stripeStub({ invoices: { cus_member2: [invoice('in_founder', day(3))], cus_investor2: [invoice('in_investor', day(4))] } });
  try {
    const r = await get(f, '/invoices');
    assert.deepEqual(r.body.invoices.map((x: any) => x.id), ['in_investor', 'in_founder']);
    f.db.exec("UPDATE users SET investor_stripe_customer_id='cus_member2' WHERE id=2");
    const same = await get(f, '/invoices');
    assert.deepEqual(same.body.invoices.map((x: any) => x.id), ['in_founder'], 'one customer in both scopes is read once');
  } finally { s.restore(); f.db.close(); }
});

// 4 ───────────────────────────────────────────────────────────────────────────
test('with Stripe down, the orders still list, with degraded', async () => {
  // Mutations checked: a Stripe failure answered as an error; degraded not set.
  const { f } = await fiveRows(); const s = stripeStub({ down: true });
  try {
    const r = await get(f, '/invoices');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.degraded, ['stripe']);
    assert.deepEqual(r.body.invoices.map((x: any) => x.id), ['MRD-B', 'MRD-A']);
    assert.equal(r.body.total, 2);
  } finally { s.restore(); f.db.close(); }
  const g = await world(); order(g, 'MRD-X', { at: '2026-10-02 09:00:00', items: '[]' });
  g.env.STRIPE_SECRET_KEY = undefined;
  try {
    const r = await get(g, '/invoices');
    assert.deepEqual(r.body.degraded, ['stripe'], 'no key, with a customer, is Stripe unread');
    assert.deepEqual(r.body.invoices.map((x: any) => x.description), ['Order']);
  } finally { g.db.close(); }
});

// 5 ───────────────────────────────────────────────────────────────────────────
test('an auto-reload order reads "AI tokens, auto-reload $25", and a part refund reads partly refunded', async () => {
  // Mutations checked: the origin ignored; the refund compared to the wrong total.
  const f = await world();
  order(f, 'MRD-R', { pi: 'pi_r', at: '2026-10-18 09:00:00', items: line('auto_reload') });
  await pack(f, 'pi_r', 'MRD-R');
  assert.equal(await reverseRefund(f.env, { id: 'ch_r', payment_intent: 'pi_r', amount_refunded: 1000, currency: 'usd' }), true);
  const s = stripeStub();
  try {
    const [row] = (await get(f, '/invoices')).body.invoices;
    assert.equal(row.description, 'AI tokens, auto-reload $25');
    assert.equal(row.status, 'partly_refunded');
  } finally { s.restore(); f.db.close(); }
  assert.equal(orderDescription(null, JSON.stringify([{ name: 'Incorporation', quantity: 1 }, { name: 'Expert session', quantity: 2 }])),
    'Incorporation, Expert session × 2');
  // D794's reload writes the origin on the pending order's lines.
  const src = readFileSync(new URL('../src/services/aiAutoReload.ts', import.meta.url), 'utf8');
  assert.match(src, /items: cart\.lines\.map\(\(l\) => \(\{ \.\.\.l, origin: 'auto_reload' as const \}\)\)/);
});

// 6 ───────────────────────────────────────────────────────────────────────────
test('a Stripe invoice\'s status, credit notes, PDF and words', () => {
  // Mutations checked: drafts listed; a non-https PDF passed through; credit notes ignored.
  const name = (id: string) => (id === PLAN ? 'Validate + Build' : null);
  assert.equal(stripeInvoiceRow(invoice('in_d', day(1), { status: 'draft' }) as any, name), null, 'a draft is not an invoice yet');
  assert.equal(stripeInvoiceRow(invoice('in_o', day(1), { status: 'open' }) as any, name)!.status, 'open');
  assert.equal(stripeInvoiceRow(invoice('in_v', day(1), { status: 'void' }) as any, name)!.status, 'void');
  assert.equal(stripeInvoiceRow(invoice('in_p', day(1), { post_payment_credit_notes_amount: 900 }) as any, name)!.status, 'partly_refunded');
  assert.equal(stripeInvoiceRow(invoice('in_f', day(1), { post_payment_credit_notes_amount: 4900 }) as any, name)!.status, 'refunded');
  assert.equal(stripeInvoiceRow(invoice('in_h', day(1), { invoice_pdf: 'http://pay.stripe.example/x.pdf' }) as any, name)!.pdf_url, null);
  assert.equal(stripeInvoiceRow(invoice('in_y', day(1), { lines: { data: [{ description: 'One-off', price: { id: 'price_other' } }] } }) as any, name)!.description, 'One-off');
  assert.deepEqual(invoicePaging('0', '500'), { page: 1, per: 100 });
  assert.deepEqual(invoicePaging('2', 'x'), { page: 2, per: 25 });
});

// 7 ───────────────────────────────────────────────────────────────────────────
test('the card\'s billing address passes through, and is null when Stripe holds none', async () => {
  // Mutations checked: the address dropped; an empty address answered as an object.
  const f = await world();
  const s = stripeStub({ pms: [
    { id: 'pm_card1', card: { brand: 'visa', last4: '4242', exp_month: 8, exp_year: 2028 },
      billing_details: { address: { line1: '1 Placeholder Street', line2: null, city: 'Sampletown', postal_code: '00000', country: 'US', state: 'XX' } } },
    { id: 'pm_card2', card: { brand: 'visa', last4: '0005', exp_month: 1, exp_year: 2029 },
      billing_details: { address: { line1: null, line2: null, city: null, postal_code: null, country: null } } },
    { id: 'pm_card3', card: { brand: 'visa', last4: '0006', exp_month: 1, exp_year: 2029 } },
  ] });
  try {
    const r = await get(f, '/overview');
    assert.equal(r.status, 200);
    const [one, two, three] = r.body.payment_methods;
    assert.deepEqual(one.billing_address, { line1: '1 Placeholder Street', line2: null, city: 'Sampletown', postal_code: '00000', country: 'US' });
    assert.equal(two.billing_address, null);
    assert.equal(three.billing_address, null);
  } finally { s.restore(); f.db.close(); }
});
