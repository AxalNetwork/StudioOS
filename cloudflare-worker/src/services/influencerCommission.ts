/**
 * D4292 (#4292, D4289 P3 of #4289) — an influencer's commission on the paid
 * software subscription invoices of a member they referred.
 *
 * WHAT FIRES. `invoice.paid` (routes/billing.ts) calls `onInvoicePaid`. A
 * commission is written when all of these hold:
 *   - the invoice's subscription carries P2's attribution metadata,
 *     `referrer_user_id` (and `handle`, `channel`, which are recorded), plus the
 *     member's `user_id`, and the two are different people;
 *   - the price's product is a software plan: founder, investor, advisor or
 *     partner (`planOf` over the product mirror's metadata). LP access, deals,
 *     funds and anything else are never paid on;
 *   - the referrer holds active signed terms with the `subscription_invoice`
 *     trigger (`activeTermsFor`, D958). The rate is the trigger's
 *     `percentage_bps` (or its flat amount per invoice, when the terms set
 *     one); no rate is typed here (D1050);
 *   - the invoice is among the member's first INVOICES_PER_MEMBER paid
 *     invoices on that subscription (D4289 §1.1: invoices, not months);
 *   - no other referral commission was paid on the same payment (no stacking).
 *
 * The amount is the invoice's amount paid, which is already net of discount,
 * less its tax, times the rate. It is written in the invoice's currency.
 *
 * ONCE PER INVOICE. The row is `commissions` with `source_type`
 * 'subscription_invoice' and `source_id` the invoice id; the UNIQUE (user_id,
 * source_type, source_id) and `influencer_commission_invoices.invoice_id`
 * UNIQUE make a replayed webhook a no-op.
 *
 * THE HOLD. A commission is `pending`, with `payable_at` HOLD_DAYS after the
 * invoice was paid. `sweepPendingCommissions` (daily) moves due rows to
 * `accrued`, the status the payout request claims.
 *
 * REFUNDS AND DISPUTES. `onChargeRefunded` and `onDispute` find the invoice by
 * its charge or PaymentIntent. Inside the hold the commission is cancelled
 * whole (D4289: "a refund or dispute inside the hold cancels it"). After it, a
 * refund reverses its share (`clawbackReferralCommissionForRefund`, as the
 * admin refund does) and a lost dispute reverses it all.
 *
 * BONUSES. After the sweep, each referrer whose count of paid customers
 * crosses a milestone is paid that milestone's bonus once: a member counts when
 * one of their commissions has passed the hold uncancelled and their
 * subscription has not ended. The amount is the terms' flat `influencer_bonus_<n>`
 * trigger; terms without one pay no bonus for that milestone. Reaching
 * CUSTOM_MILESTONE tells HQ, once.
 *
 * Every function takes `now` (ms) so tests never read the clock.
 */
import type { Env } from '../types';
import { activeTermsFor, termsAmount, todayUtc } from './referralPartnerTerms';
import { clawbackReferralCommissionForRefund } from './referralCommissions';

export const SOURCE_TYPE = 'subscription_invoice';
export const BONUS_SOURCE_TYPE = 'influencer_bonus';
/** The terms trigger the invoice share is read from. */
export const INVOICE_RULE = 'subscription_invoice';
/** How many of a member's paid invoices earn (D4289 §1.1). */
export const INVOICES_PER_MEMBER = 12;
/** Days a commission is held before it is payable (D4289's rules). */
export const HOLD_DAYS = 30;
/** The paid-customer counts that pay a one-time bonus; each amount is the terms' `influencer_bonus_<n>` trigger. */
export const BONUS_MILESTONES = [10, 25, 50, 100] as const;
export const bonusRule = (n: number) => `influencer_bonus_${n}`;
/** The count at which HQ is told to agree a custom partnership; it pays nothing by itself. */
export const CUSTOM_MILESTONE = 250;
/** The plan families a commission is paid on. Never `lp`, `staff`, `other` or market intelligence. */
export const SOFTWARE_FAMILIES: ReadonlySet<string> = new Set(['founder', 'investor', 'advisor', 'partner']);

const DAY_MS = 86_400_000;
const INVOICE_RE = /^in_[A-Za-z0-9]{1,255}$/;
const SUB_RE = /^sub_[A-Za-z0-9]{1,255}$/;
type Obj = Record<string, any>;

const idOf = (v: unknown): string | null =>
  typeof v === 'string' && v ? v : v && typeof v === 'object' && typeof (v as Obj).id === 'string' ? (v as Obj).id : null;
const posInt = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};
/**
 * A database without this part's tables (a hand-built test fixture; production
 * always has the migration) has no influencer commission to act on. Any other
 * failure still throws, so Stripe retries the event.
 */
const absentStore = (e: unknown) => /no such table: (influencer_commission_invoices|influencer_milestones)/.test(String((e as Error)?.message || ''));
async function orAbsent<T>(fallback: T, run: () => Promise<T>): Promise<T> {
  try { return await run(); } catch (e) { if (absentStore(e)) return fallback; throw e; }
}

/** SQLite's datetime text for a moment, so comparisons with `datetime('now')`-style columns sort right. */
export const sqlTime = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

export type InvoiceOutcome =
  | 'paid' | 'replayed' | 'not_paid' | 'no_subscription' | 'no_attribution' | 'self_referral'
  | 'not_software' | 'no_terms' | 'nothing_due' | 'past_last_invoice' | 'stacked' | 'no_store';

/** The invoice's tax, from whichever field this API version sends; 0 when none is named. */
export function invoiceTax(inv: Obj): number {
  if (Number.isSafeInteger(inv?.tax)) return Math.max(0, inv.tax);
  for (const key of ['total_taxes', 'total_tax_amounts']) {
    const list = inv?.[key];
    if (Array.isArray(list)) return list.reduce((s: number, t: Obj) => s + (Number.isSafeInteger(t?.amount) ? Math.max(0, t.amount) : 0), 0);
  }
  return 0;
}

/** What the commission is a share of: the amount paid (after discount) less tax. */
export function invoiceNet(inv: Obj): number {
  const paid = Number.isSafeInteger(inv?.amount_paid) ? inv.amount_paid : 0;
  return Math.max(0, paid - invoiceTax(inv));
}

/** The invoice's charge and PaymentIntent, from the older fields or the newer `payments` list. */
export function invoicePayment(inv: Obj): { charge: string | null; paymentIntent: string | null } {
  let charge = idOf(inv?.charge);
  let paymentIntent = idOf(inv?.payment_intent);
  const p = Array.isArray(inv?.payments?.data) ? inv.payments.data[0]?.payment : null;
  if (!charge && p) charge = idOf(p.charge);
  if (!paymentIntent && p) paymentIntent = idOf(p.payment_intent);
  return { charge, paymentIntent };
}

function invoiceSubscription(inv: Obj): { id: string | null; metadata: Obj | null } {
  const parentSub = inv?.parent?.subscription_details;
  const id = idOf(inv?.subscription) ?? idOf(parentSub?.subscription);
  const metadata = inv?.subscription_details?.metadata ?? parentSub?.metadata
    ?? (inv?.subscription && typeof inv.subscription === 'object' ? inv.subscription.metadata : null) ?? null;
  return { id: id && SUB_RE.test(id) ? id : null, metadata };
}

function invoiceProduct(inv: Obj): string | null {
  const line = Array.isArray(inv?.lines?.data) ? inv.lines.data[0] : null;
  const price = line?.price && typeof line.price === 'object' ? line.price : null;
  return idOf(price?.product) ?? idOf(line?.pricing?.price_details?.product);
}

/** The software plan a product is sold as, from the D1 product mirror; null for anything else. */
export async function softwarePlanOf(env: Env, productId: string | null): Promise<string | null> {
  if (!productId) return null;
  const row = await env.DB.prepare('SELECT metadata_json FROM stripe_products WHERE id = ?').bind(productId).first<{ metadata_json: string }>();
  if (!row) return null;
  let md: Record<string, string> = {};
  try { md = JSON.parse(row.metadata_json || '{}') || {}; } catch { return null; }
  const { planOf } = await import('./aiCredits');
  const plan = planOf(md);
  return plan && SOFTWARE_FAMILIES.has(plan.family) ? (plan.licence_key || plan.family) : null;
}

async function subscriptionMetadata(env: Env, subId: string, md: Obj | null): Promise<Obj | null> {
  if (md && (md.referrer_user_id !== undefined || md.user_id !== undefined)) return md;
  try {
    const { stripeCall } = await import('../routes/billing');
    const sub = await stripeCall<{ metadata?: Obj }>(env, `/subscriptions/${subId}`, {}, { method: 'GET' });
    return sub?.metadata ?? md;
  } catch {
    return md;
  }
}

/**
 * `invoice.paid`: write the referrer's pending commission for this invoice, or
 * say why none is due. A database failure throws, so Stripe retries the event;
 * every write is idempotent on the invoice id.
 */
export async function onInvoicePaid(env: Env, inv: Obj, now: number = Date.now()): Promise<{ outcome: InvoiceOutcome; commission_id?: number }> {
  const invoiceId = idOf(inv);
  if (!invoiceId || !INVOICE_RE.test(invoiceId) || inv?.status !== 'paid') return { outcome: 'not_paid' };

  const seen = await orAbsent<{ commission_id: number } | null | 'absent'>('absent', () =>
    env.DB.prepare('SELECT commission_id FROM influencer_commission_invoices WHERE invoice_id = ?').bind(invoiceId).first<{ commission_id: number }>());
  if (seen === 'absent') return { outcome: 'no_store' };
  if (seen) return { outcome: 'replayed', commission_id: Number(seen.commission_id) };

  const sub = invoiceSubscription(inv);
  if (!sub.id) return { outcome: 'no_subscription' };
  const md = await subscriptionMetadata(env, sub.id, sub.metadata);
  const referrerId = posInt(md?.referrer_user_id);
  const memberId = posInt(md?.user_id);
  if (!referrerId || !memberId) return { outcome: 'no_attribution' };
  if (referrerId === memberId) return { outcome: 'self_referral' };

  const planKey = await softwarePlanOf(env, invoiceProduct(inv));
  if (!planKey) return { outcome: 'not_software' };

  const paidAtMs = posInt(inv?.status_transitions?.paid_at) ? Number(inv.status_transitions.paid_at) * 1000 : now;
  const terms = await activeTermsFor(env, referrerId, INVOICE_RULE, todayUtc(paidAtMs));
  if (!terms) return { outcome: 'no_terms' };

  const net = invoiceNet(inv);
  if (net <= 0) return { outcome: 'nothing_due' };

  const prior = await env.DB.prepare('SELECT COUNT(*) AS n FROM influencer_commission_invoices WHERE subscription_id = ?').bind(sub.id).first<{ n: number }>();
  const invoiceNumber = Number(prior?.n || 0) + 1;
  if (invoiceNumber > INVOICES_PER_MEMBER) return { outcome: 'past_last_invoice' };

  const { charge, paymentIntent } = invoicePayment(inv);
  // No stacking: a payment that already earned another referral commission earns no second one.
  if (paymentIntent) {
    const other = await env.DB.prepare(`SELECT 1 FROM commissions WHERE source_type = 'purchase' AND source_id = ? LIMIT 1`).bind(paymentIntent).first();
    if (other) return { outcome: 'stacked' };
  }

  const currency = String(inv?.currency || '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return { outcome: 'nothing_due' };
  // The terms' caps are in the terms' currency, so they bind only an invoice in
  // that currency, and only against what the terms paid in it (never a sum
  // across currencies).
  const sameCurrency = currency === terms.currency;
  const paidInCurrency = sameCurrency && terms.overall_cap_cents != null
    ? Number((await env.DB.prepare(
      `SELECT COALESCE(SUM(amount_cents - COALESCE(reversed_amount_cents, 0)), 0) AS n FROM commissions WHERE terms_id = ? AND currency = ?`,
    ).bind(terms.terms_id, currency).first<{ n: number }>())?.n || 0)
    : 0;
  const pay = termsAmount({
    ...terms,
    paid_so_far_cents: paidInCurrency,
    cap_per_intro_cents: sameCurrency ? terms.cap_per_intro_cents : null,
    overall_cap_cents: sameCurrency ? terms.overall_cap_cents : null,
  }, net);
  if (pay.amount_cents <= 0) return { outcome: 'nothing_due' };

  const payableMs = paidAtMs + HOLD_DAYS * DAY_MS;
  const handle = typeof md?.handle === 'string' ? md.handle.slice(0, 64) : null;
  const channel = typeof md?.channel === 'string' ? md.channel.slice(0, 64) : null;
  const ins = await env.DB.prepare(
    `INSERT OR IGNORE INTO commissions (user_id, referral_id, amount_cents, currency, source_type, source_id, status, description, terms_id, payable_at)
     VALUES (?, NULL, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
  ).bind(referrerId, pay.amount_cents, currency, SOURCE_TYPE, invoiceId,
    `Subscription invoice ${invoiceNumber} of ${INVOICES_PER_MEMBER}${pay.capped === 'none' ? '' : ' (capped)'}`, pay.terms_id, sqlTime(payableMs)).run();
  const row = await env.DB.prepare('SELECT id FROM commissions WHERE user_id = ? AND source_type = ? AND source_id = ?')
    .bind(referrerId, SOURCE_TYPE, invoiceId).first<{ id: number }>();
  if (!row) throw new Error('commission not recorded');
  await env.DB.prepare(
    `INSERT OR IGNORE INTO influencer_commission_invoices
       (commission_id, referrer_user_id, member_user_id, subscription_id, invoice_id, invoice_number, charge_id, payment_intent_id,
        net_cents, currency, plan_key, handle, channel, paid_at, payable_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(row.id, referrerId, memberId, sub.id, invoiceId, invoiceNumber, charge, paymentIntent,
    net, currency, planKey, handle, channel, sqlTime(paidAtMs), sqlTime(payableMs)).run();
  return { outcome: Number(ins.meta?.changes ?? 0) > 0 ? 'paid' : 'replayed', commission_id: Number(row.id) };
}

/** True when a subscription invoice earned an influencer commission on this PaymentIntent (the purchase path's no-stacking check). */
export async function paymentEarnedInfluencerCommission(env: Env, paymentIntentId: string | null | undefined): Promise<boolean> {
  if (!paymentIntentId) return false;
  const row = await orAbsent(null, () => env.DB.prepare('SELECT 1 FROM influencer_commission_invoices WHERE payment_intent_id = ? LIMIT 1').bind(paymentIntentId).first());
  return !!row;
}

type Ledger = { id: number; commission_id: number; invoice_id: string; payable_at: string; cancelled_at: string | null; status: string; amount_cents: number; reversed_amount_cents: number };

async function ledgerForCharge(env: Env, chargeId: string | null, paymentIntentId: string | null): Promise<Ledger | null> {
  if (!chargeId && !paymentIntentId) return null;
  return orAbsent(null, () => env.DB.prepare(
    `SELECT i.id, i.commission_id, i.invoice_id, i.payable_at, i.cancelled_at, c.status, c.amount_cents, COALESCE(c.reversed_amount_cents, 0) AS reversed_amount_cents
       FROM influencer_commission_invoices i JOIN commissions c ON c.id = i.commission_id
      WHERE (? IS NOT NULL AND i.charge_id = ?) OR (? IS NOT NULL AND i.payment_intent_id = ?)
      LIMIT 1`,
  ).bind(chargeId, chargeId, paymentIntentId, paymentIntentId).first<Ledger>());
}

/** Inside the hold: the commission is cancelled whole. Idempotent. */
async function cancelInHold(env: Env, row: Ledger, reason: 'refund' | 'dispute', now: number): Promise<boolean> {
  const done = await env.DB.prepare(
    `UPDATE commissions SET status = 'reversed', reversed_amount_cents = amount_cents, reversed_at = ?
      WHERE id = ? AND status = 'pending'`,
  ).bind(sqlTime(now), row.commission_id).run();
  if (!Number(done.meta?.changes ?? 0)) return false;
  await env.DB.prepare(`UPDATE influencer_commission_invoices SET cancelled_at = ?, cancel_reason = ? WHERE id = ? AND cancelled_at IS NULL`)
    .bind(sqlTime(now), reason, row.id).run();
  return true;
}

const inHold = (row: Ledger, now: number) => row.status === 'pending' && row.payable_at > sqlTime(now);

export type ReversalOutcome = 'no_commission' | 'cancelled' | 'reversed' | 'already_reversed' | 'skipped' | 'held_until_closed';

/** `charge.refunded`: cancel inside the hold, reverse the refunded share after it. */
export async function onChargeRefunded(env: Env, charge: Obj, now: number = Date.now()): Promise<{ outcome: ReversalOutcome }> {
  const row = await ledgerForCharge(env, idOf(charge), idOf(charge?.payment_intent));
  if (!row) return { outcome: 'no_commission' };
  if (row.cancelled_at || row.reversed_amount_cents >= row.amount_cents) return { outcome: 'already_reversed' };
  if (inHold(row, now)) return { outcome: (await cancelInHold(env, row, 'refund', now)) ? 'cancelled' : 'already_reversed' };
  const total = Number.isSafeInteger(charge?.amount) ? charge.amount : null;
  const refundedToDate = Number.isSafeInteger(charge?.amount_refunded) ? charge.amount_refunded : null;
  const r = await clawbackReferralCommissionForRefund(env, {
    paymentIntentId: idOf(charge?.payment_intent) || '',
    sourceType: SOURCE_TYPE,
    sourceId: row.invoice_id,
    refundedAmountCents: refundedToDate ?? 0,
    chargeAmountCents: total,
    chargeRefundedToDateCents: refundedToDate,
    refundId: idOf(charge) || row.invoice_id,
  });
  if (r.outcome === 'error') throw new Error('commission clawback failed');
  return { outcome: r.outcome === 'reversed' ? 'reversed' : r.outcome === 'already_reversed' ? 'already_reversed' : r.outcome === 'skipped' ? 'skipped' : 'no_commission' };
}

/**
 * `charge.dispute.created` and `charge.dispute.closed`. Inside the hold a new
 * dispute cancels the commission. After the hold the commission stands while
 * the dispute is open, and a dispute closed as lost reverses all of it.
 */
export async function onDispute(env: Env, eventType: string, dispute: Obj, now: number = Date.now()): Promise<{ outcome: ReversalOutcome }> {
  const row = await ledgerForCharge(env, idOf(dispute?.charge), idOf(dispute?.payment_intent));
  if (!row) return { outcome: 'no_commission' };
  if (row.cancelled_at || row.reversed_amount_cents >= row.amount_cents) return { outcome: 'already_reversed' };
  if (inHold(row, now)) return { outcome: (await cancelInHold(env, row, 'dispute', now)) ? 'cancelled' : 'already_reversed' };
  if (eventType !== 'charge.dispute.closed' || dispute?.status !== 'lost') return { outcome: 'held_until_closed' };
  const r = await clawbackReferralCommissionForRefund(env, {
    paymentIntentId: idOf(dispute?.payment_intent) || '',
    sourceType: SOURCE_TYPE,
    sourceId: row.invoice_id,
    refundedAmountCents: row.amount_cents,
    chargeAmountCents: null,
    refundId: idOf(dispute) || row.invoice_id,
  });
  if (r.outcome === 'error') throw new Error('commission clawback failed');
  return { outcome: r.outcome === 'reversed' ? 'reversed' : 'already_reversed' };
}

/** `customer.subscription.deleted`: the member stops counting toward a bonus. */
export async function onSubscriptionEnded(env: Env, sub: Obj, now: number = Date.now()): Promise<number> {
  const id = idOf(sub);
  if (!id || !SUB_RE.test(id)) return 0;
  return orAbsent(0, async () => {
    const r = await env.DB.prepare('UPDATE influencer_commission_invoices SET subscription_ended_at = ? WHERE subscription_id = ? AND subscription_ended_at IS NULL')
      .bind(sqlTime(now), id).run();
    return Number(r.meta?.changes ?? 0);
  });
}

/**
 * How many referred members count toward a referrer's bonuses: a commission
 * the sweep made payable (`accrued`, or `paid` since), not wholly reversed, on
 * a subscription that has not ended. A cancelled commission reads `reversed`.
 */
export async function paidCustomers(env: Env, referrerId: number): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(DISTINCT i.member_user_id) AS n
       FROM influencer_commission_invoices i JOIN commissions c ON c.id = i.commission_id
      WHERE i.referrer_user_id = ? AND i.subscription_ended_at IS NULL
        AND c.status IN ('accrued', 'paid') AND COALESCE(c.reversed_amount_cents, 0) < c.amount_cents`,
  ).bind(referrerId).first<{ n: number }>();
  return Number(row?.n || 0);
}

/** Pay each milestone a referrer has reached and not yet been paid for; tell HQ at the custom milestone. Idempotent. */
export async function fireMilestones(env: Env, referrerId: number, now: number = Date.now()): Promise<{ bonuses: number; custom: number }> {
  const count = await paidCustomers(env, referrerId);
  let bonuses = 0; let custom = 0;
  const today = todayUtc(now);
  for (const m of BONUS_MILESTONES) {
    if (count < m) break;
    const terms = await activeTermsFor(env, referrerId, bonusRule(m), today);
    if (!terms) continue;
    // A flat trigger pays its amount; a share has no base here, so it pays 0 and nothing fires.
    const pay = termsAmount({ ...terms, percentage_bps: null, cap_per_intro_cents: null }, 0);
    if (pay.amount_cents <= 0) continue;
    const ins = await env.DB.prepare(
      `INSERT OR IGNORE INTO commissions (user_id, referral_id, amount_cents, currency, source_type, source_id, status, description, terms_id, payable_at)
       VALUES (?, NULL, ?, ?, ?, ?, 'accrued', ?, ?, ?)`,
    ).bind(referrerId, pay.amount_cents, pay.currency, BONUS_SOURCE_TYPE, String(m), `Bonus for ${m} paid customers`, pay.terms_id, sqlTime(now)).run();
    if (!Number(ins.meta?.changes ?? 0)) continue;
    const c = await env.DB.prepare('SELECT id FROM commissions WHERE user_id = ? AND source_type = ? AND source_id = ?').bind(referrerId, BONUS_SOURCE_TYPE, String(m)).first<{ id: number }>();
    await env.DB.prepare(`INSERT OR IGNORE INTO influencer_milestones (referrer_user_id, milestone, kind, commission_id, customers_counted, achieved_at) VALUES (?, ?, 'bonus', ?, ?, ?)`)
      .bind(referrerId, m, c?.id ?? null, count, sqlTime(now)).run();
    bonuses++;
  }
  if (count >= CUSTOM_MILESTONE) {
    const ins = await env.DB.prepare(`INSERT OR IGNORE INTO influencer_milestones (referrer_user_id, milestone, kind, commission_id, customers_counted, achieved_at) VALUES (?, ?, 'custom', NULL, ?, ?)`)
      .bind(referrerId, CUSTOM_MILESTONE, count, sqlTime(now)).run();
    if (Number(ins.meta?.changes ?? 0)) {
      custom = 1;
      await tellHq(env, referrerId, count);
    }
  }
  return { bonuses, custom };
}

async function tellHq(env: Env, referrerId: number, count: number): Promise<void> {
  try {
    const { notify } = await import('./notify');
    const hq = (await env.DB.prepare('SELECT user_id FROM super_admins').all<{ user_id: number }>()).results || [];
    for (const r of hq) {
      await notify(env, {
        userId: Number(r.user_id),
        type: 'influencer_custom_milestone',
        title: `An influencer reached ${CUSTOM_MILESTONE} paid customers`,
        body: `${count} paid customers. Agree a custom partnership with them.`,
        link: '/admin/programs/influencer',
        payload: { referrer_user_id: referrerId, customers: count },
      });
    }
  } catch {
    console.warn('[influencer] custom milestone notice not sent');
  }
}

/**
 * The daily step: pending commissions whose hold has ended become `accrued`
 * (payable), then every referrer with a subscription commission is checked
 * for milestones. Idempotent: a second run the same day changes nothing.
 */
export async function sweepPendingCommissions(env: Env, now: number = Date.now()): Promise<{ payable: number; bonuses: number; custom: number }> {
  const due = await env.DB.prepare(`UPDATE commissions SET status = 'accrued' WHERE status = 'pending' AND payable_at IS NOT NULL AND payable_at <= ?`)
    .bind(sqlTime(now)).run();
  const referrers = (await env.DB.prepare('SELECT DISTINCT referrer_user_id AS id FROM influencer_commission_invoices').all<{ id: number }>()).results || [];
  let bonuses = 0; let custom = 0;
  for (const r of referrers) {
    const f = await fireMilestones(env, Number(r.id), now);
    bonuses += f.bonuses; custom += f.custom;
  }
  return { payable: Number(due.meta?.changes ?? 0), bonuses, custom };
}
