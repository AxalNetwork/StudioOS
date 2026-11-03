/**
 * D4292 (#4292, D4289 P3) — an influencer's commission on the paid software
 * subscription invoices of the members they referred: pending for 30 days,
 * then payable; once per invoice; twelve invoices per member; cancelled or
 * clawed back on a refund or a dispute; the milestone bonuses; no stacking.
 *
 * The database is the baseline plus every migration (`loadSchema`), so the new
 * migration applies as it ships. Every service call is given `now`; the
 * webhook cases use invoices paid on fixed dates far from any real clock. Every
 * person is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/influencer_commission_d4292.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import billingRoute from '../src/routes/billing.ts';
import {
  CUSTOM_MILESTONE, HOLD_DAYS, INVOICES_PER_MEMBER, invoiceNet, onChargeRefunded, onDispute, onInvoicePaid,
  onSubscriptionEnded, paidCustomers, paymentEarnedInfluencerCommission, sweepPendingCommissions,
} from '../src/services/influencerCommission.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const DAY = 86_400_000;
const SUPER = 1, JANE = 10, OTHER = 11;
const MEMBER0 = 100;
const T0 = Date.UTC(2026, 0, 15, 12, 0, 0); // the first invoice's payment

function world(opts: { bps?: number; bonus10?: number | null; currency?: string; overallCap?: number | null; noTerms?: boolean } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, email_verified) VALUES (?, ?, ?, ?, 1, 1)');
  u.run(SUPER, 'admin', 'Sue Super', 'sue@example.test');
  u.run(JANE, 'investor', 'Jane Creator', 'jane@example.test');
  u.run(OTHER, 'founder', 'Omar Other', 'omar@example.test');
  for (let i = 0; i < 260; i++) u.run(MEMBER0 + i, 'founder', `Member ${i}`, `m${i}@example.test`);
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  db.prepare("INSERT INTO referral_partners (id, user_id, segment, added_by) VALUES (1, ?, 'venture_scouts', ?)").run(JANE, SUPER);
  if (!opts.noTerms) {
    db.prepare(`INSERT INTO referral_partner_terms (id, uid, partner_id, segment, status, starts_on, currency, overall_cap_cents, created_by,
        submitted_by, submitted_at, approved_by, approved_at, envelope_id, sent_by, sent_at, signed_at)
      VALUES (1, 'terms-jane', 1, 'venture_scouts', 'signed', '2025-01-01', ?, ?, ?, ?, '2025-01-01', ?, '2025-01-01', 9, ?, '2025-01-01', '2025-01-01')`)
      .run(opts.currency ?? 'USD', opts.overallCap ?? null, SUPER, SUPER, SUPER, SUPER);
    const g = db.prepare('INSERT INTO referral_partner_term_triggers (terms_id, rule_key, amount_cents, percentage_bps) VALUES (1, ?, ?, ?)');
    g.run('subscription_invoice', null, opts.bps ?? 2500);
    if (opts.bonus10 !== null) g.run('influencer_bonus_10', opts.bonus10 ?? 10000, null);
  }
  const p = db.prepare("INSERT INTO stripe_products (id, name, kind, active, metadata_json) VALUES (?, ?, 'subscription', 1, ?)");
  p.run('prod_growth', 'Validate + Build', JSON.stringify({ tier: 'growth' }));
  p.run('prod_pro', 'Investor Pro', JSON.stringify({ investor_tier: 'professional' }));
  p.run('prod_deal', 'A deal fee', JSON.stringify({ kind: 'deal' }));
  p.run('prod_mi', 'Market intelligence', JSON.stringify({ plan: 'mi_pro' }));
  const env = { DB: d1Over(db), ENVIRONMENT: 'development', JWT_SECRET: 'd4292-fixture-only-secret', STRIPE_WEBHOOK_SECRET: 'd4292-fixture-only-webhook', STRIPE_SECRET_KEY: 'sk_test_fixture' } as any;
  return { db, env };
}

let seq = 0;
/** A paid invoice of member `m`'s subscription, attributed to Jane through @jane/yt. */
function invoice(m: number, paidAtMs: number, o: { sub?: string; amount?: number; tax?: number; product?: string; referrer?: number | null; currency?: string; pi?: string; charge?: string } = {}) {
  seq++;
  const md: Record<string, string> = { user_id: String(m), handle: 'jane', channel: 'yt' };
  if (o.referrer !== null) md.referrer_user_id = String(o.referrer ?? JANE);
  return {
    id: `in_t${seq}`, object: 'invoice', status: 'paid', billing_reason: 'subscription_cycle',
    subscription: o.sub ?? `sub_m${m}`, subscription_details: { metadata: md },
    amount_paid: o.amount ?? 10000, tax: o.tax ?? 0, currency: o.currency ?? 'usd',
    charge: o.charge ?? `ch_t${seq}`, payment_intent: o.pi ?? `pi_t${seq}`,
    status_transitions: { paid_at: Math.floor(paidAtMs / 1000) },
    lines: { data: [{ price: { id: 'price_x', product: o.product ?? 'prod_growth', recurring: { interval: 'month' } } }] },
  };
}
const commissions = (db: DatabaseSync) => db.prepare("SELECT * FROM commissions WHERE source_type IN ('subscription_invoice', 'influencer_bonus') ORDER BY id").all() as any[];
const ledger = (db: DatabaseSync) => db.prepare('SELECT * FROM influencer_commission_invoices ORDER BY id').all() as any[];

test('a paid invoice writes one pending commission at the terms rate, net of tax; the sweep makes it payable after 30 days', async () => {
  const { db, env } = world({ bps: 2500 });
  const inv = invoice(MEMBER0, T0, { amount: 11000, tax: 1000 });
  assert.equal(invoiceNet(inv), 10000);
  const r = await onInvoicePaid(env, inv, T0);
  assert.equal(r.outcome, 'paid');
  const [c] = commissions(db);
  assert.equal(c.status, 'pending');
  assert.equal(c.amount_cents, 2500, '25% of the 10,000 paid net of tax');
  assert.equal(c.currency, 'USD');
  assert.equal(c.user_id, JANE);
  assert.equal(c.source_id, inv.id);
  assert.equal(c.terms_id, 1);
  assert.equal(c.payable_at, new Date(T0 + HOLD_DAYS * DAY).toISOString().slice(0, 19).replace('T', ' '));
  const [l] = ledger(db);
  assert.deepEqual([l.invoice_number, l.member_user_id, l.subscription_id, l.handle, l.channel, l.plan_key, l.net_cents], [1, MEMBER0, `sub_m${MEMBER0}`, 'jane', 'yt', 'founder:growth', 10000]);

  // A day before the hold ends, nothing moves; at the hold's end it is payable.
  assert.equal((await sweepPendingCommissions(env, T0 + (HOLD_DAYS - 1) * DAY)).payable, 0);
  assert.equal(commissions(db)[0].status, 'pending');
  assert.equal((await sweepPendingCommissions(env, T0 + HOLD_DAYS * DAY)).payable, 1);
  assert.equal(commissions(db)[0].status, 'accrued');
  assert.equal((await sweepPendingCommissions(env, T0 + (HOLD_DAYS + 1) * DAY)).payable, 0, 'a second sweep changes nothing');
});

test('a replayed invoice is a no-op, and only the first twelve paid invoices of a subscription earn', async () => {
  const { db, env } = world();
  const first = invoice(MEMBER0, T0);
  assert.equal((await onInvoicePaid(env, first, T0)).outcome, 'paid');
  assert.equal((await onInvoicePaid(env, first, T0 + DAY)).outcome, 'replayed');
  assert.equal(commissions(db).length, 1);
  for (let n = 2; n <= INVOICES_PER_MEMBER; n++) {
    assert.equal((await onInvoicePaid(env, invoice(MEMBER0, T0 + n * 30 * DAY), T0 + n * 30 * DAY)).outcome, 'paid');
  }
  assert.deepEqual(ledger(db).map((l) => l.invoice_number), Array.from({ length: 12 }, (_, i) => i + 1));
  assert.equal((await onInvoicePaid(env, first, T0 + 380 * DAY)).outcome, 'replayed', 'a late replay of invoice 1 is still invoice 1');
  const thirteenth = invoice(MEMBER0, T0 + 400 * DAY);
  assert.equal((await onInvoicePaid(env, thirteenth, T0 + 400 * DAY)).outcome, 'past_last_invoice');
  assert.equal(commissions(db).length, 12, 'invoice 13 earns nothing');
  assert.match(commissions(db)[11].description, /12 of 12/);
});

test('nothing is paid on a non-software price, without attribution, to oneself, without terms, or on a zero invoice', async () => {
  const { db, env } = world();
  assert.equal((await onInvoicePaid(env, invoice(MEMBER0, T0, { product: 'prod_deal' }), T0)).outcome, 'not_software');
  assert.equal((await onInvoicePaid(env, invoice(MEMBER0, T0, { product: 'prod_unknown' }), T0)).outcome, 'not_software');
  assert.equal((await onInvoicePaid(env, invoice(MEMBER0, T0, { product: 'prod_mi' }), T0)).outcome, 'not_software', 'market intelligence is not one of the four software families');
  assert.equal((await onInvoicePaid(env, invoice(MEMBER0, T0, { referrer: null }), T0)).outcome, 'no_attribution');
  assert.equal((await onInvoicePaid(env, invoice(JANE, T0), T0)).outcome, 'self_referral');
  assert.equal((await onInvoicePaid(env, invoice(MEMBER0, T0, { referrer: OTHER }), T0)).outcome, 'no_terms');
  assert.equal((await onInvoicePaid(env, invoice(MEMBER0, T0, { amount: 0 }), T0)).outcome, 'nothing_due');
  assert.equal((await onInvoicePaid(env, { ...invoice(MEMBER0, T0), status: 'open' }, T0)).outcome, 'not_paid');
  assert.equal(commissions(db).length, 0);
  assert.equal((await onInvoicePaid(env, invoice(MEMBER0, T0, { product: 'prod_pro' }), T0)).outcome, 'paid', 'an investor plan is software');
  const w = world({ noTerms: true });
  assert.equal((await onInvoicePaid(w.env, invoice(MEMBER0, T0), T0)).outcome, 'no_terms');
});

test('the commission is in the invoice currency; the terms caps bind only their own currency', async () => {
  const { db, env } = world({ bps: 5000, overallCap: 3000 });
  await onInvoicePaid(env, invoice(MEMBER0, T0, { currency: 'eur', amount: 10000 }), T0);
  await onInvoicePaid(env, invoice(MEMBER0 + 1, T0, { amount: 10000 }), T0);
  assert.deepEqual(commissions(db).map((c) => [c.currency, c.amount_cents, /capped/.test(c.description)]), [['EUR', 5000, false], ['USD', 3000, true]]);
});

test('terms that set a flat amount per invoice pay that amount, whatever the invoice', async () => {
  const { db, env } = world({ bps: 2500 });
  db.prepare("UPDATE referral_partner_term_triggers SET amount_cents = 700, percentage_bps = NULL WHERE rule_key = 'subscription_invoice'").run();
  await onInvoicePaid(env, invoice(MEMBER0, T0, { amount: 50000 }), T0);
  assert.deepEqual(commissions(db).map((c) => c.amount_cents), [700]);
});

test('no stacking: a payment that earned a purchase commission earns no influencer commission, and the reverse is visible', async () => {
  const { db, env } = world();
  db.prepare("INSERT INTO commissions (user_id, amount_cents, currency, source_type, source_id, status) VALUES (?, 500, 'USD', 'purchase', 'pi_stacked', 'accrued')").run(OTHER);
  assert.equal((await onInvoicePaid(env, invoice(MEMBER0, T0, { pi: 'pi_stacked' }), T0)).outcome, 'stacked');
  assert.equal(commissions(db).length, 0);
  await onInvoicePaid(env, invoice(MEMBER0 + 1, T0, { pi: 'pi_influenced' }), T0);
  assert.equal(await paymentEarnedInfluencerCommission(env, 'pi_influenced'), true);
  assert.equal(await paymentEarnedInfluencerCommission(env, 'pi_elsewhere'), false);
});

test('a refund inside the hold cancels the commission whole; after the hold it reverses the refunded share', async () => {
  const { db, env } = world({ bps: 2000 });
  await onInvoicePaid(env, invoice(MEMBER0, T0, { charge: 'ch_a', pi: 'pi_a' }), T0);
  const r1 = await onChargeRefunded(env, { id: 'ch_a', payment_intent: 'pi_a', amount: 10000, amount_refunded: 1000 }, T0 + 5 * DAY);
  assert.equal(r1.outcome, 'cancelled');
  let [c] = commissions(db);
  assert.deepEqual([c.status, c.reversed_amount_cents], ['reversed', 2000], 'a partial refund inside the hold still cancels it all');
  assert.equal(ledger(db)[0].cancel_reason, 'refund');
  assert.equal((await onChargeRefunded(env, { id: 'ch_a', payment_intent: 'pi_a', amount: 10000, amount_refunded: 2000 }, T0 + 6 * DAY)).outcome, 'already_reversed');
  assert.equal((await sweepPendingCommissions(env, T0 + 40 * DAY)).payable, 0, 'a cancelled commission never becomes payable');

  await onInvoicePaid(env, invoice(MEMBER0 + 1, T0, { charge: 'ch_b', pi: 'pi_b' }), T0);
  await sweepPendingCommissions(env, T0 + 31 * DAY);
  const r2 = await onChargeRefunded(env, { id: 'ch_b', payment_intent: 'pi_b', amount: 10000, amount_refunded: 2500 }, T0 + 35 * DAY);
  assert.equal(r2.outcome, 'reversed');
  c = commissions(db)[1];
  assert.deepEqual([c.status, c.reversed_amount_cents], ['accrued', 500], 'a quarter of the 2,000 commission');
  await onChargeRefunded(env, { id: 'ch_b', payment_intent: 'pi_b', amount: 10000, amount_refunded: 10000 }, T0 + 36 * DAY);
  c = commissions(db)[1];
  assert.deepEqual([c.status, c.reversed_amount_cents], ['reversed', 2000]);
  assert.equal((await onChargeRefunded(env, { id: 'ch_none', payment_intent: 'pi_none', amount: 100, amount_refunded: 100 }, T0)).outcome, 'no_commission');
});

test('a dispute inside the hold cancels; after the hold only a lost dispute claws back', async () => {
  const { db, env } = world({ bps: 2000 });
  await onInvoicePaid(env, invoice(MEMBER0, T0, { charge: 'ch_a', pi: 'pi_a' }), T0);
  assert.equal((await onDispute(env, 'charge.dispute.created', { id: 'dp_a', charge: 'ch_a', status: 'needs_response' }, T0 + DAY)).outcome, 'cancelled');
  assert.equal(ledger(db)[0].cancel_reason, 'dispute');

  await onInvoicePaid(env, invoice(MEMBER0 + 1, T0, { charge: 'ch_b', pi: 'pi_b' }), T0);
  await sweepPendingCommissions(env, T0 + 31 * DAY);
  assert.equal((await onDispute(env, 'charge.dispute.created', { id: 'dp_b', charge: 'ch_b', status: 'needs_response' }, T0 + 32 * DAY)).outcome, 'held_until_closed');
  assert.equal((await onDispute(env, 'charge.dispute.closed', { id: 'dp_b', charge: 'ch_b', status: 'won' }, T0 + 50 * DAY)).outcome, 'held_until_closed');
  assert.equal(commissions(db)[1].reversed_amount_cents, 0, 'a won dispute leaves it standing');
  assert.equal((await onDispute(env, 'charge.dispute.closed', { id: 'dp_b', charge: 'ch_b', status: 'lost' }, T0 + 50 * DAY)).outcome, 'reversed');
  assert.deepEqual([commissions(db)[1].status, commissions(db)[1].reversed_amount_cents], ['reversed', 2000]);
});

test('the 10-customer bonus fires once, from the terms, counting only members past the hold and still subscribed', async () => {
  const { db, env } = world({ bonus10: 10000 });
  for (let i = 0; i < 10; i++) await onInvoicePaid(env, invoice(MEMBER0 + i, T0), T0);
  // A second invoice of one member counts that member once.
  await onInvoicePaid(env, invoice(MEMBER0, T0 + DAY), T0 + DAY);
  assert.equal(await paidCustomers(env, JANE), 0, 'nothing counts inside the hold');
  let s = await sweepPendingCommissions(env, T0 + 10 * DAY);
  assert.equal(s.bonuses, 0);

  // One member's subscription ends before the hold is over: 9 count, no bonus.
  await onSubscriptionEnded(env, { id: `sub_m${MEMBER0 + 9}` }, T0 + 20 * DAY);
  s = await sweepPendingCommissions(env, T0 + 31 * DAY);
  assert.equal(await paidCustomers(env, JANE), 9);
  assert.equal(s.bonuses, 0);

  // A tenth member passes the hold: the bonus fires, once.
  await onInvoicePaid(env, invoice(MEMBER0 + 10, T0 + 2 * DAY), T0 + 2 * DAY);
  s = await sweepPendingCommissions(env, T0 + 33 * DAY);
  assert.equal(s.bonuses, 1);
  const bonus = commissions(db).filter((c) => c.source_type === 'influencer_bonus');
  assert.deepEqual(bonus.map((c) => [c.source_id, c.amount_cents, c.status, c.terms_id]), [['10', 10000, 'accrued', 1]]);
  assert.equal((await sweepPendingCommissions(env, T0 + 60 * DAY)).bonuses, 0, 'each milestone pays once');
  const m = db.prepare('SELECT milestone, kind, customers_counted FROM influencer_milestones').all() as any[];
  assert.deepEqual(m.map((r) => [r.milestone, r.kind, r.customers_counted]), [[10, 'bonus', 10]]);
});

test('terms without a bonus trigger pay no bonus; the custom milestone tells HQ once', async () => {
  const { db, env } = world({ bonus10: null });
  for (let i = 0; i < CUSTOM_MILESTONE; i++) await onInvoicePaid(env, invoice(MEMBER0 + i, T0), T0);
  const s = await sweepPendingCommissions(env, T0 + 31 * DAY);
  assert.deepEqual([s.bonuses, s.custom], [0, 1]);
  assert.equal(commissions(db).filter((c) => c.source_type === 'influencer_bonus').length, 0);
  const notes = db.prepare("SELECT user_id, type FROM notifications_inbox WHERE type = 'influencer_custom_milestone'").all() as any[];
  assert.deepEqual(notes.map((n) => n.user_id), [SUPER]);
  assert.equal((await sweepPendingCommissions(env, T0 + 32 * DAY)).custom, 0);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM notifications_inbox WHERE type = 'influencer_custom_milestone'").get() as any).n, 1);
});

async function hook(env: any, type: string, object: Record<string, unknown>) {
  const body = JSON.stringify({ id: `evt_${type}_${++seq}`, livemode: false, type, data: { object } });
  const timestamp = Math.floor(Date.now() / 1000); // the signature's own window, not a commission date
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`)))).map((n) => n.toString(16).padStart(2, '0')).join('');
  const saved = [console.warn, console.info]; console.warn = () => {}; console.info = () => {};
  try {
    return await billingRoute.request('/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': `t=${timestamp},v1=${signature}`, 'content-type': 'application/json' }, body }, env);
  } finally { [console.warn, console.info] = saved; }
}

test('the Stripe webhook writes the commission on invoice.paid and claws it back on charge.refunded and a lost dispute', async () => {
  const { db, env } = world({ bps: 2000 });
  const PAST = Date.UTC(2026, 0, 2); // long past its hold whenever this runs
  const a = invoice(MEMBER0, PAST, { charge: 'ch_w1', pi: 'pi_w1' });
  assert.equal((await hook(env, 'invoice.paid', a)).status, 200);
  assert.equal((await hook(env, 'invoice.paid', a)).status, 200);
  assert.equal(commissions(db).length, 1, 'one commission per invoice, replay or not');
  assert.equal((await hook(env, 'charge.refunded', { id: 'ch_w1', object: 'charge', payment_intent: 'pi_w1', currency: 'usd', amount: 10000, amount_refunded: 5000 })).status, 200);
  assert.equal(commissions(db)[0].reversed_amount_cents, 1000);

  const b = invoice(MEMBER0 + 1, PAST, { charge: 'ch_w2', pi: 'pi_w2' });
  await hook(env, 'invoice.paid', b);
  await hook(env, 'charge.dispute.created', { id: 'dp_w2', object: 'dispute', charge: 'ch_w2', payment_intent: 'pi_w2', amount: 10000, currency: 'usd', status: 'needs_response' });
  assert.equal(commissions(db)[1].reversed_amount_cents, 0);
  await hook(env, 'charge.dispute.closed', { id: 'dp_w2', object: 'dispute', charge: 'ch_w2', payment_intent: 'pi_w2', amount: 10000, currency: 'usd', status: 'lost' });
  assert.equal(commissions(db)[1].status, 'reversed');

  // An invoice paid in a far future is inside its hold whenever this runs: a refund cancels it.
  const FUTURE = Date.UTC(2099, 0, 2);
  const c = invoice(MEMBER0 + 2, FUTURE, { charge: 'ch_w3', pi: 'pi_w3' });
  db.prepare("UPDATE referral_partner_terms SET starts_on = '2025-01-01'").run();
  await hook(env, 'invoice.paid', c);
  await hook(env, 'charge.refunded', { id: 'ch_w3', object: 'charge', payment_intent: 'pi_w3', currency: 'usd', amount: 10000, amount_refunded: 100 });
  assert.deepEqual([commissions(db)[2].status, ledger(db)[2].cancel_reason], ['reversed', 'refund']);

  await hook(env, 'customer.subscription.deleted', { id: `sub_m${MEMBER0 + 1}`, object: 'subscription', status: 'canceled', metadata: {} });
  assert.ok(ledger(db)[1].subscription_ended_at, 'an ended subscription stops counting');
});
