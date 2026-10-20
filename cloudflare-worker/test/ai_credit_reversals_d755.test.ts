// D755 §8 (#1920) — a refund or a dispute of a token pack takes its tokens back,
// up to the member's balance, and records the rest as a shortfall. Events are
// fixtures signed with a test secret; no Stripe is called. After every case,
// every member's ledger sum equals their top-up balance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { aiBudgetFixture, setFixtureAllowance } from './_ai_budget_fixture.mjs';
import { recordAiTopupPurchase, creditAiTopupFromPayment } from '../src/services/aiTopups.ts';
import { reserveAiBudget, settleAiReservation } from '../src/services/aiBudget.ts';
import { ledgerBalance, tokenPackQuote } from '../src/services/aiCredits.ts';
import { ensureCatalogSchema } from '../src/services/catalog.ts';
import billingRoute from '../src/routes/billing.ts';

const now = new Date();
const PI = 'pi_pack25';
async function world(opts: { total?: number; bonus?: number } = {}) {
  const f = aiBudgetFixture();
  const env = { DB: f.DB, JWT_SECRET: 'd755-rev-fixture-only-secret', STRIPE_WEBHOOK_SECRET: 'd755-rev-fixture-only-webhook', ENVIRONMENT: 'development' } as any;
  f.db.prepare("INSERT INTO ai_token_packs(uid,price_id,product_id,face_cents,bonus_microusd,on_sale,origin) VALUES('pack25','price_pack25','prod_pack25',2500,?,1,'created')").run(opts.bonus ?? 2500000);
  const total = opts.total ?? 2500;
  await recordAiTopupPurchase(env, { paymentIntentId: PI, orderRef: 'MRD-pack25', userId: 2, totalCents: total, currency: 'usd',
    quote: { priceId: 'price_pack25', creditMicrousd: 25000000, packUid: 'pack25', bonusMicrousd: opts.bonus ?? 2500000 } });
  await ensureCatalogSchema(env);
  f.db.prepare("INSERT INTO stripe_products(id,name,kind,active,metadata_json,prices_json) VALUES('prod_pack25','$25 of tokens','token_pack',1,'{}',?)")
    .run(JSON.stringify([{ id: 'price_pack25', currency: 'usd', unit_amount: 2500, interval: null, interval_count: null, nickname: null, type: 'one_time', active: true }]));
  const pi = { id: PI, status: 'succeeded', currency: 'usd', amount_received: total, metadata: { kind: 'cart_order', order_ref: 'MRD-pack25', user_id: '2' } };
  return { ...f, env, pi, total };
}
async function credit(f: any) { assert.equal(await creditAiTopupFromPayment(f.env, f.pi), true); }
async function hook(f: any, type: string, object: Record<string, unknown>, secret = f.env.STRIPE_WEBHOOK_SECRET) {
  const body = JSON.stringify({ id: `evt_${Math.random().toString(36).slice(2)}`, type, data: { object } });
  const timestamp = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`)))).map((n) => n.toString(16).padStart(2, '0')).join('');
  return billingRoute.request('/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': `t=${timestamp},v1=${signature}`, 'content-type': 'application/json' }, body }, f.env);
}
const refund = (f: any, refunded: number, extra: Record<string, unknown> = {}) =>
  hook(f, 'charge.refunded', { id: 'ch_pack25', object: 'charge', payment_intent: PI, currency: 'usd', amount: f.total, amount_captured: f.total, amount_refunded: refunded, ...extra });
const dispute = (f: any, type: string, status: string, extra: Record<string, unknown> = {}) =>
  hook(f, type, { id: 'dp_pack25', object: 'dispute', charge: 'ch_pack25', payment_intent: PI, amount: f.total, currency: 'usd', status, ...extra });
const balance = (f: any) => f.db.prepare('SELECT balance_microusd AS b FROM ai_topup_accounts WHERE user_id=2').get().b;
const purchase = (f: any) => ({ ...f.db.prepare('SELECT reversed_microusd, dispute_state FROM ai_topup_purchases WHERE payment_intent_id=?').get(PI) });
const rows = (f: any, kinds = "'refund','dispute','dispute_won'") =>
  f.db.prepare(`SELECT kind, delta_microusd, shortfall_microusd, source_ref FROM ai_credit_ledger WHERE kind IN (${kinds}) ORDER BY rowid`).all().map((r: any) => ({ ...r }));
const notices = (f: any) => f.db.prepare("SELECT type, title, body FROM notifications_inbox WHERE user_id=2 AND type LIKE 'ai_tokens_%' AND type <> 'ai_tokens_added' ORDER BY id").all().map((r: any) => ({ ...r }));
const CART = { lines: [{ price_id: 'price_pack25', product_id: 'prod_pack25', name: '$25 of tokens', kind: 'token_pack', quantity: 1, unit_amount: 2500, line_total: 2500 }], subtotal: 2500, currency: 'usd' } as any;
/** Whether the member's next pack order is refused on hold: the real order-intent check. */
async function packsOnHold(f: any, userId: number) {
  const q = await tokenPackQuote(f.env, userId, CART, '') as any;
  if (q && 'error' in q && q.error !== 'token_packs_on_hold' && q.error !== 'token_balance_ceiling') throw new Error(q.error);
  return q?.error === 'token_packs_on_hold';
}
async function invariant(f: any) {
  for (const { user_id } of f.db.prepare('SELECT user_id FROM ai_topup_accounts UNION SELECT user_id FROM ai_credit_ledger').all())
    assert.equal(await ledgerBalance(f.env, user_id), f.db.prepare('SELECT balance_microusd AS b FROM ai_topup_accounts WHERE user_id=?').get(user_id)?.b ?? 0, `invariant ${user_id}`);
}
/** Spend part of the top-up balance through the real reserve and settle code. */
async function spend(f: any, micro: number) {
  setFixtureAllowance(f.db, 0); // D783: no plan, so runs draw tokens
  const r = await reserveAiBudget(f.env, 2, micro, now); if (!r.ok) throw Error('reserve');
  await settleAiReservation(f.env, r.reservation, micro);
}

test('a full refund with nothing spent takes the pack and its bonus back, once', async () => {
  const f = await world();
  try {
    await credit(f); assert.equal(balance(f), 27500000);
    for (let i = 0; i < 2; i++) assert.equal((await refund(f, 2500)).status, 200);
    assert.deepEqual(rows(f), [{ kind: 'refund', delta_microusd: -27500000, shortfall_microusd: 0, source_ref: 'rf:ch_pack25:2500' }]);
    assert.equal(balance(f), 0, 'back to what it was before the pack');
    assert.deepEqual(purchase(f), { reversed_microusd: 27500000, dispute_state: null });
    assert.deepEqual(notices(f), [{ type: 'ai_tokens_refunded', title: 'Refunded: $27.50 of tokens', body: 'Refunded: $27.50 was taken off your top-up balance.' }]);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action='ai_topup_refund_reversed'").get().n, 1);
    assert.equal(await packsOnHold(f, 2), false, 'no shortfall, no hold');
    await invariant(f);
  } finally { f.db.close(); }
});

test('a refund or dispute whose Stripe id is not one reverses nothing', async () => {
  const f = await world();
  try {
    await credit(f);
    for (const id of ['ch_pack25;drop', 'ch_', 'xch_pack25', 'ch_pack 25', 'pi_pack25']) await refund(f, 2500, { id });
    for (const id of ['dp_pack25!', 'dp_']) await dispute(f, 'charge.dispute.created', 'needs_response', { id });
    assert.deepEqual(rows(f), [], 'a malformed id reached the ledger');
    assert.equal(balance(f), 27500000);
    await invariant(f);
  } finally { f.db.close(); }
});

test('two partial refunds are two rows that add up; replaying either changes nothing', async () => {
  const f = await world();
  try {
    await credit(f);
    assert.equal((await refund(f, 1000)).status, 200);
    assert.equal((await refund(f, 2500)).status, 200);
    for (const r of [1000, 2500]) assert.equal((await refund(f, r)).status, 200, `replay ${r}`);
    assert.deepEqual(rows(f).map((r: any) => [r.delta_microusd, r.source_ref]), [[-11000000, 'rf:ch_pack25:1000'], [-16500000, 'rf:ch_pack25:2500']]);
    assert.equal(purchase(f).reversed_microusd, 27500000); assert.equal(balance(f), 0);
    assert.equal(notices(f).length, 2);
    await invariant(f);
  } finally { f.db.close(); }
});

test('two partial refunds racing take each share once: the share is read inside the write', async () => {
  const f = await world();
  try {
    await credit(f);
    const [a, b] = await Promise.all([refund(f, 1000), refund(f, 2500)]);
    assert.deepEqual([a.status, b.status], [200, 200]);
    assert.equal(purchase(f).reversed_microusd, 27500000, 'never more than the pack');
    // `amount_refunded` is cumulative: when the full refund lands first, the
    // partial one has no share left and writes no row. Either order, no shortfall.
    assert.ok([1, 2].includes(rows(f).length), `one or two rows, by arrival order (${rows(f).length})`);
    assert.ok(rows(f).every((r: any) => r.shortfall_microusd === 0), 'nothing was spent, so no shortfall');
    assert.equal(rows(f).reduce((n: number, r: any) => n + r.delta_microusd, 0), -27500000);
    assert.equal(balance(f), 0);
    await invariant(f);
  } finally { f.db.close(); }
});

test('a refund after part was spent takes the balance to zero and records the spent part as a shortfall', async () => {
  const f = await world();
  try {
    await credit(f);
    await spend(f, 20000000); assert.equal(balance(f), 7500000);
    assert.equal((await refund(f, 2500)).status, 200);
    assert.deepEqual(rows(f), [{ kind: 'refund', delta_microusd: -7500000, shortfall_microusd: 20000000, source_ref: 'rf:ch_pack25:2500' }]);
    assert.equal(balance(f), 0, 'the balance CHECK never fires');
    assert.equal(purchase(f).reversed_microusd, 27500000);
    assert.equal(notices(f)[0].body, 'Refunded: $7.50 was taken off your top-up balance. $20.00 of these tokens had already been used.');
    assert.equal(await packsOnHold(f, 2), true, 'a shortfall holds pack purchases for 90 days');
    // With nothing left at all, a later share is a row of 0 with its whole amount as shortfall.
    const g = await world();
    try {
      await credit(g); await spend(g, 27500000); assert.equal(balance(g), 0);
      assert.equal((await refund(g, 1000)).status, 200);
      assert.deepEqual(rows(g), [{ kind: 'refund', delta_microusd: 0, shortfall_microusd: 11000000, source_ref: 'rf:ch_pack25:1000' }]);
      await invariant(g);
    } finally { g.db.close(); }
    await invariant(f);
  } finally { f.db.close(); }
});

test('a UAE order: the refund shares VAT pro rata and reverses only the tokens', async () => {
  const f = await world({ total: 2625 });
  try {
    await credit(f);
    assert.equal((await refund(f, 125)).status, 200);
    assert.equal(rows(f)[0].delta_microusd, -1309524, 'ceil(27.5M × 125 / 2625)');
    assert.equal((await refund(f, 2625)).status, 200);
    assert.equal(purchase(f).reversed_microusd, 27500000, 'a full refund takes exactly the tokens, never the VAT on top');
    assert.equal(balance(f), 0);
    await invariant(f);
  } finally { f.db.close(); }
});

test('a dispute takes the share and holds packs; won returns what it took; lost moves nothing', async () => {
  // Created, then won.
  let f = await world();
  try {
    await credit(f);
    const cart = CART;
    assert.equal('error' in ((await tokenPackQuote(f.env, 2, cart, '')) as any), false, 'before the dispute a pack can be bought');
    for (let i = 0; i < 2; i++) assert.equal((await dispute(f, 'charge.dispute.created', 'needs_response')).status, 200);
    assert.deepEqual(rows(f), [{ kind: 'dispute', delta_microusd: -27500000, shortfall_microusd: 0, source_ref: 'dp:dp_pack25' }]);
    assert.deepEqual(purchase(f), { reversed_microusd: 27500000, dispute_state: 'open' });
    assert.deepEqual(await tokenPackQuote(f.env, 2, cart, ''), { error: 'token_packs_on_hold' });
    await invariant(f);
    for (let i = 0; i < 2; i++) assert.equal((await dispute(f, 'charge.dispute.closed', 'won')).status, 200);
    assert.deepEqual(rows(f).map((r: any) => [r.kind, r.delta_microusd]), [['dispute', -27500000], ['dispute_won', 27500000]]);
    assert.equal(balance(f), 27500000, 'restored');
    assert.deepEqual(purchase(f), { reversed_microusd: 0, dispute_state: 'won' });
    assert.equal('error' in ((await tokenPackQuote(f.env, 2, cart, '')) as any), false, 'the hold lifts');
    // A replayed created event never reopens a closed dispute.
    assert.equal((await dispute(f, 'charge.dispute.created', 'needs_response')).status, 200);
    assert.equal(purchase(f).dispute_state, 'won');
    assert.deepEqual(notices(f).map((n: any) => n.type), ['ai_tokens_disputed', 'ai_tokens_dispute_won']);
    await invariant(f);
  } finally { f.db.close(); }
  // Created after part was spent, then won: it returns what it took, not the shortfall.
  f = await world();
  try {
    await credit(f); await spend(f, 20000000);
    assert.equal((await dispute(f, 'charge.dispute.created', 'needs_response')).status, 200);
    assert.deepEqual(rows(f).map((r: any) => [r.delta_microusd, r.shortfall_microusd]), [[-7500000, 20000000]]);
    assert.equal((await dispute(f, 'charge.dispute.closed', 'warning_closed')).status, 200);
    assert.deepEqual(rows(f).map((r: any) => [r.kind, r.delta_microusd]), [['dispute', -7500000], ['dispute_won', 7500000]]);
    assert.equal(balance(f), 7500000);
    assert.deepEqual(purchase(f), { reversed_microusd: 0, dispute_state: 'won' });
    await invariant(f);
  } finally { f.db.close(); }
  // Created, then lost: nothing more moves.
  f = await world();
  try {
    await credit(f);
    assert.equal((await dispute(f, 'charge.dispute.created', 'needs_response')).status, 200);
    for (let i = 0; i < 2; i++) assert.equal((await dispute(f, 'charge.dispute.closed', 'lost')).status, 200);
    assert.deepEqual(rows(f).map((r: any) => r.kind), ['dispute']);
    assert.equal(balance(f), 0); assert.deepEqual(purchase(f), { reversed_microusd: 27500000, dispute_state: 'lost' });
    assert.equal(await packsOnHold(f, 2), false, 'a lost dispute is not open');
    // A closed dispute acts once: a later "won" for a lost dispute moves nothing.
    assert.equal((await dispute(f, 'charge.dispute.closed', 'won')).status, 200);
    assert.deepEqual(rows(f).map((r: any) => r.kind), ['dispute']);
    assert.deepEqual(purchase(f), { reversed_microusd: 27500000, dispute_state: 'lost' });
    // A dispute on a pack already fully refunded takes nothing, still opens, and a replay after it closes never reopens it.
    const h = await world();
    try {
      await credit(h);
      assert.equal((await refund(h, 2500)).status, 200);
      assert.equal((await dispute(h, 'charge.dispute.created', 'needs_response')).status, 200);
      assert.deepEqual(rows(h).map((r: any) => r.kind), ['refund'], 'nothing more to take');
      assert.equal(purchase(h).dispute_state, 'open');
      assert.equal((await dispute(h, 'charge.dispute.closed', 'won')).status, 200);
      assert.deepEqual(purchase(h), { reversed_microusd: 27500000, dispute_state: 'won' });
      assert.equal((await dispute(h, 'charge.dispute.created', 'needs_response')).status, 200);
      assert.equal(purchase(h).dispute_state, 'won', 'the replay does not reopen it');
      assert.deepEqual(rows(h).map((r: any) => r.kind), ['refund']);
      await invariant(h);
    } finally { h.db.close(); }
    // A closed event for a dispute still under review changes nothing.
    const g = await world();
    try {
      await credit(g);
      assert.equal((await dispute(g, 'charge.dispute.created', 'needs_response')).status, 200);
      assert.equal((await dispute(g, 'charge.dispute.closed', 'under_review')).status, 200);
      assert.equal(purchase(g).dispute_state, 'open');
      await invariant(g);
    } finally { g.db.close(); }
    await invariant(f);
  } finally { f.db.close(); }
});

test('a charge that is not a token pack is untouched, a bad signature is refused, and a reversal before its credit waits', async () => {
  const f = await world();
  try {
    // Before the credit: Stripe is asked to retry, and nothing is written.
    assert.equal((await refund(f, 2500)).status, 500);
    assert.equal((await dispute(f, 'charge.dispute.created', 'needs_response')).status, 500);
    assert.deepEqual(rows(f), []); assert.deepEqual(purchase(f), { reversed_microusd: 0, dispute_state: null });
    await credit(f);
    // An ordinary order, an incorporation and an intro-credit purchase have no ai_topup_purchases row.
    for (const pi of ['pi_ordinary', 'pi_incorporation', 'pi_introcredits']) {
      assert.equal((await hook(f, 'charge.refunded', { id: 'ch_other', payment_intent: pi, currency: 'usd', amount_captured: 4900, amount_refunded: 4900 })).status, 200);
      assert.equal((await hook(f, 'charge.dispute.created', { id: 'dp_other', payment_intent: pi, amount: 4900, status: 'needs_response' })).status, 200);
      assert.equal((await hook(f, 'charge.dispute.closed', { id: 'dp_other', payment_intent: pi, amount: 4900, status: 'lost' })).status, 200);
    }
    assert.deepEqual(rows(f), []);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action LIKE 'ai_topup_%' AND action <> 'ai_topup_credited'").get().n, 0);
    // A bad signature is refused before any case runs.
    const forged = await refund(f, 2500).then(() => hook(f, 'charge.refunded', { id: 'ch_pack25', payment_intent: PI, currency: 'usd', amount_captured: 2500, amount_refunded: 1000 }, 'not-the-secret'));
    assert.equal(forged.status, 400);
    assert.deepEqual(rows(f).map((r: any) => r.source_ref), ['rf:ch_pack25:2500'], 'only the signed refund moved anything');
    // The legacy no-secret soft-accept can never move paid balance.
    const g = await world();
    try {
      await credit(g); delete g.env.STRIPE_WEBHOOK_SECRET;
      const body = JSON.stringify({ type: 'charge.refunded', data: { object: { id: 'ch_pack25', payment_intent: PI, currency: 'usd', amount_captured: 2500, amount_refunded: 2500 } } });
      assert.equal((await billingRoute.request('/stripe/webhook', { method: 'POST', headers: { 'content-type': 'application/json' }, body }, g.env)).status, 500);
      assert.deepEqual(rows(g), []);
      await invariant(g);
    } finally { g.db.close(); }
    await invariant(f);
  } finally { f.db.close(); }
});
