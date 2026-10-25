/**
 * D1052 (#2903, part 4 of Checkout #2451) — billing alerts: what a member must
 * know about a plan payment, written by the verified Stripe webhook
 * (`routes/billing.ts` → `handleStripeEvent`) into `billing_alerts`
 * (migration 578) and read back by `GET /api/billing/alerts`.
 *
 *   invoice.payment_failed             a renewal failed: an open `payment_failed` alert
 *   invoice.payment_action_required    the bank asks the member to confirm: an open `needs_confirmation` alert
 *   invoice.paid                       closes that invoice's alerts
 *   customer.subscription.updated      active or trialing again closes them; ended closes them;
 *                                      `unpaid` (Stripe stopped retrying) keeps them open with no next try
 *   customer.subscription.deleted      closes them
 *   charge.refunded                    a plan payment refunded: a `refund` row, and the member is told
 *   charge.dispute.created / .closed   a plan payment disputed: an open `dispute` alert, told; closed with its outcome
 *
 * IDEMPOTENT ON THE EVENT OBJECT'S ID: `(kind, object_id)` is unique (578), so
 * a redelivered event updates the row it wrote, never adds one, never reopens
 * a closed one, and tells the member nothing twice. Bound SQL only.
 *
 * NO CARD DATA. A row holds ids, counts, dates and an amount. The client
 * secret a confirmation needs is fetched from Stripe only when the member
 * presses Confirm (`confirmationFor`), and never stored.
 */
import type { Env } from '../types';
import { formatMoney } from './fundNotices';
import { subscriptionOwner } from './planSubscription';

export const ALERT_KINDS = ['payment_failed', 'needs_confirmation', 'refund', 'dispute'] as const;
export type AlertKind = typeof ALERT_KINDS[number];

/** The invoices that renew a plan the member already holds. A first payment is the card form's. */
export const RENEWAL_REASONS = ['subscription_cycle', 'subscription_update', 'subscription_threshold'] as const;

// Stripe ids by prefix, as literal patterns, so nothing else reaches a URL or a row.
const ID = {
  in: /^in_[A-Za-z0-9]+$/, sub: /^sub_[A-Za-z0-9]+$/, ch: /^(ch|py)_[A-Za-z0-9]+$/, dp: /^(dp|du)_[A-Za-z0-9]+$/,
} as const;
const idOf = (v: unknown, kind: keyof typeof ID): string | null => {
  const s = typeof v === 'string' ? v : (v && typeof v === 'object' ? (v as { id?: unknown }).id : null);
  return typeof s === 'string' && ID[kind].test(s) ? s : null;
};
const cents = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null);
const currencyOf = (v: unknown): string | null => (typeof v === 'string' && /^[a-z]{3}$/i.test(v) ? v.toLowerCase() : null);
const stamp = (unix: unknown): string | null => {
  const n = Number(unix);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString().replace('T', ' ').slice(0, 19) : null;
};
const missingTable = (e: unknown) => /no such table:\s*billing_alerts/i.test(String((e as Error)?.message ?? e));
/**
 * A write's changed-row count. Before migration 578 the table is absent: the
 * write is skipped (0) and the rest of the webhook runs as it did. Any other
 * failure throws, so the webhook answers non-2xx and Stripe retries.
 */
async function changed(stmt: D1PreparedStatement): Promise<number> {
  try { return Number((await stmt.run()).meta?.changes ?? 0); }
  catch (e) { if (missingTable(e)) return 0; throw e; }
}

/** The plan family a subscription's charge is recorded under (migration 505), or null. */
async function familyOf(env: Env, subId: string): Promise<string | null> {
  try {
    const r = await env.DB.prepare('SELECT plan_family FROM member_subscription_amounts WHERE subscription_id = ?').bind(subId).first<{ plan_family: string | null }>();
    return r?.plan_family ?? null;
  } catch { return null; }
}

/** A renewal invoice's subscription and owner, or null when it is not a member's renewal. */
async function renewalOf(env: Env, invoice: Record<string, unknown>) {
  if (!(RENEWAL_REASONS as readonly string[]).includes(String(invoice.billing_reason))) return null;
  const invoiceId = idOf(invoice.id, 'in');
  const subId = idOf(invoice.subscription, 'sub');
  if (!invoiceId || !subId) return null;
  const userId = await subscriptionOwner(env, subId);
  if (!userId) return null;
  return { invoiceId, subId, userId, family: await familyOf(env, subId) };
}

/** Open (or bring up to date) a renewal's alert. Returns true when a row was written or moved forward. */
async function upsertInvoiceAlert(env: Env, kind: 'payment_failed' | 'needs_confirmation', invoice: Record<string, unknown>): Promise<boolean> {
  const r = await renewalOf(env, invoice);
  if (!r) return false;
  const attempt = Number(invoice.attempt_count);
  return (await changed(env.DB.prepare(
    `INSERT INTO billing_alerts (user_id, kind, object_id, subscription_id, invoice_id, plan_family, attempt_count, next_attempt_at, amount_cents, currency)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (kind, object_id) DO UPDATE SET
       attempt_count   = excluded.attempt_count,
       next_attempt_at = excluded.next_attempt_at,
       updated_at      = datetime('now')
     WHERE billing_alerts.state = 'open' AND COALESCE(excluded.attempt_count, 0) > COALESCE(billing_alerts.attempt_count, 0)`,
  ).bind(
    r.userId, kind, r.invoiceId, r.subId, r.invoiceId, r.family,
    Number.isSafeInteger(attempt) && attempt > 0 ? attempt : null,
    stamp(invoice.next_payment_attempt),
    cents(invoice.amount_due), currencyOf(invoice.currency),
  ))) > 0;
}

export const recordPaymentFailedAlert = (env: Env, invoice: Record<string, unknown>) => upsertInvoiceAlert(env, 'payment_failed', invoice);
export const recordConfirmationAlert = (env: Env, invoice: Record<string, unknown>) => upsertInvoiceAlert(env, 'needs_confirmation', invoice);

/** `invoice.paid`: that invoice's open alerts are closed. Returns how many. */
export async function closeInvoiceAlerts(env: Env, invoice: Record<string, unknown>): Promise<number> {
  const invoiceId = idOf(invoice.id, 'in');
  if (!invoiceId) return 0;
  try {
    const res = await env.DB.prepare(
      `UPDATE billing_alerts SET state = 'closed', closed_reason = 'paid', closed_at = datetime('now'), updated_at = datetime('now')
        WHERE invoice_id = ? AND kind IN ('payment_failed', 'needs_confirmation') AND state = 'open'`,
    ).bind(invoiceId).run();
    return Number(res.meta?.changes ?? 0);
  } catch (e) { if (missingTable(e)) return 0; throw e; }
}

/**
 * A subscription event: active or trialing again closes its open payment
 * alerts ("recovered"); canceled, incomplete_expired or deleted closes them
 * ("ended"); `unpaid` is Stripe giving up, so they stay open with no next try.
 */
export async function syncSubscriptionAlerts(env: Env, eventType: string, sub: Record<string, unknown>): Promise<number> {
  const subId = idOf(sub.id, 'sub');
  if (!subId) return 0;
  const status = String(sub.status || '');
  const reason = eventType === 'customer.subscription.deleted' || status === 'canceled' || status === 'incomplete_expired'
    ? 'ended' : status === 'active' || status === 'trialing' ? 'recovered' : null;
  try {
    if (reason) {
      const res = await env.DB.prepare(
        `UPDATE billing_alerts SET state = 'closed', closed_reason = ?, closed_at = datetime('now'), updated_at = datetime('now')
          WHERE subscription_id = ? AND kind IN ('payment_failed', 'needs_confirmation') AND state = 'open'`,
      ).bind(reason, subId).run();
      return Number(res.meta?.changes ?? 0);
    }
    if (status === 'unpaid') {
      const res = await env.DB.prepare(
        `UPDATE billing_alerts SET next_attempt_at = NULL, updated_at = datetime('now')
          WHERE subscription_id = ? AND kind = 'payment_failed' AND state = 'open' AND next_attempt_at IS NOT NULL`,
      ).bind(subId).run();
      return Number(res.meta?.changes ?? 0);
    }
    return 0;
  } catch (e) { if (missingTable(e)) return 0; throw e; }
}

// ── refunds and disputes on plans (owner question 9: the member is told) ──

/** GET from Stripe through the Worker's one client; a failure throws, so the webhook answers non-2xx and Stripe retries. */
async function stripeGet<T>(env: Env, path: string, query: Record<string, string> = {}): Promise<T> {
  const { stripeCall } = await import('../routes/billing');
  return stripeCall<T>(env, path, query, { method: 'GET' });
}

/** The plan subscription an invoice renews, and its owner; null when the invoice is no member plan's. */
async function planOfInvoice(env: Env, invoiceRef: unknown) {
  const invoiceId = idOf(invoiceRef, 'in');
  if (!invoiceId) return null;
  let subRef = invoiceRef && typeof invoiceRef === 'object' ? (invoiceRef as { subscription?: unknown }).subscription : undefined;
  if (subRef === undefined) {
    if (!env.STRIPE_SECRET_KEY) return null;
    subRef = (await stripeGet<{ subscription?: unknown }>(env, `/invoices/${invoiceId}`)).subscription;
  }
  const subId = idOf(subRef, 'sub');
  if (!subId) return null;
  const userId = await subscriptionOwner(env, subId);
  return userId ? { userId, subId, invoiceId, family: await familyOf(env, subId) } : null;
}

async function tell(env: Env, userId: number, type: string, title: string, body: string, payload: Record<string, unknown>) {
  const { notify } = await import('./notify');
  await notify(env, { userId, type, category: 'billing', channels: ['in_app', 'email'], title, body, link: '/settings?tab=billing', payload });
}

/**
 * `charge.refunded` on a plan payment: one `refund` row per charge, carrying
 * the total refunded so far. The member is told each time that total grows,
 * and never twice for the same total. Returns true when they were told.
 */
export async function recordPlanRefund(env: Env, charge: Record<string, unknown>): Promise<boolean> {
  const chargeId = idOf(charge.id, 'ch');
  const refunded = cents(charge.amount_refunded);
  const currency = currencyOf(charge.currency);
  if (!chargeId || !refunded || !currency) return false;
  const plan = await planOfInvoice(env, charge.invoice);
  if (!plan) return false;
  const n = await changed(env.DB.prepare(
    `INSERT INTO billing_alerts (user_id, kind, state, object_id, subscription_id, invoice_id, plan_family, amount_cents, currency, closed_reason, closed_at)
     VALUES (?, 'refund', 'closed', ?, ?, ?, ?, ?, ?, 'refunded', datetime('now'))
     ON CONFLICT (kind, object_id) DO UPDATE SET amount_cents = excluded.amount_cents, updated_at = datetime('now')
     WHERE excluded.amount_cents > COALESCE(billing_alerts.amount_cents, 0)`,
  ).bind(plan.userId, chargeId, plan.subId, plan.invoiceId, plan.family, refunded, currency));
  if (!(n > 0)) return false;
  const full = cents(charge.amount) === refunded;
  await tell(env, plan.userId, 'billing.plan_refunded',
    full ? 'A plan payment was refunded' : 'Part of a plan payment was refunded',
    `${formatMoney(refunded, currency)} of a plan payment was refunded to the card it was paid with. Your plan is as it was; Billing shows what it is now.`,
    { charge: chargeId, invoice: plan.invoiceId, amount_cents: refunded, currency });
  return true;
}

/** `charge.dispute.created` on a plan payment: an open `dispute` alert, and the member is told once. */
export async function recordPlanDispute(env: Env, dispute: Record<string, unknown>): Promise<boolean> {
  const disputeId = idOf(dispute.id, 'dp');
  const chargeId = idOf(dispute.charge, 'ch');
  const amount = cents(dispute.amount);
  const currency = currencyOf(dispute.currency);
  if (!disputeId || !chargeId || amount === null || !currency) return false;
  let invoiceRef = dispute.charge && typeof dispute.charge === 'object' ? (dispute.charge as { invoice?: unknown }).invoice : undefined;
  if (invoiceRef === undefined) {
    if (!env.STRIPE_SECRET_KEY) return false;
    invoiceRef = (await stripeGet<{ invoice?: unknown }>(env, `/charges/${chargeId}`)).invoice;
  }
  const plan = await planOfInvoice(env, invoiceRef);
  if (!plan) return false;
  const n = await changed(env.DB.prepare(
    `INSERT INTO billing_alerts (user_id, kind, object_id, subscription_id, invoice_id, plan_family, amount_cents, currency)
     VALUES (?, 'dispute', ?, ?, ?, ?, ?, ?)
     ON CONFLICT (kind, object_id) DO NOTHING`,
  ).bind(plan.userId, disputeId, plan.subId, plan.invoiceId, plan.family, amount, currency));
  if (!(n > 0)) return false;
  await tell(env, plan.userId, 'billing.plan_disputed', 'A plan payment is disputed',
    `Your bank opened a dispute on a plan payment of ${formatMoney(amount, currency)}. If you did not mean to dispute it, tell your bank.`,
    { dispute: disputeId, charge: chargeId, invoice: plan.invoiceId, amount_cents: amount, currency });
  return true;
}

/** `charge.dispute.closed`: the dispute's alert closes with Stripe's outcome (won, lost, …). */
export async function closePlanDispute(env: Env, dispute: Record<string, unknown>): Promise<number> {
  const disputeId = idOf(dispute.id, 'dp');
  if (!disputeId) return 0;
  const outcome = /^[a-z_]{1,40}$/.test(String(dispute.status || '')) ? String(dispute.status) : 'closed';
  try {
    const res = await env.DB.prepare(
      `UPDATE billing_alerts SET state = 'closed', closed_reason = ?, closed_at = datetime('now'), updated_at = datetime('now')
        WHERE kind = 'dispute' AND object_id = ? AND state = 'open'`,
    ).bind(outcome, disputeId).run();
    return Number(res.meta?.changes ?? 0);
  } catch (e) { if (missingTable(e)) return 0; throw e; }
}

// ── what the member reads ──────────────────────────────────────────────────

export type BillingAlert = {
  id: number;
  kind: AlertKind;
  plan_family: string | null;
  attempt_count: number | null;
  next_attempt_at: string | null;
  amount_cents: number | null;
  currency: string | null;
  can_confirm: boolean;
  created_at: string;
  updated_at: string;
};

/** The caller's open alerts, newest first: ids, counts, dates and an amount, never card data. */
export async function openAlerts(env: Env, userId: number): Promise<BillingAlert[]> {
  const rows = (await env.DB.prepare(
    `SELECT id, kind, plan_family, attempt_count, next_attempt_at, amount_cents, currency, created_at, updated_at
       FROM billing_alerts WHERE user_id = ? AND state = 'open' ORDER BY created_at DESC, id DESC LIMIT 20`,
  ).bind(userId).all<any>()).results || [];
  return rows.map((r) => ({
    id: Number(r.id),
    kind: r.kind,
    plan_family: r.plan_family ?? null,
    attempt_count: r.attempt_count == null ? null : Number(r.attempt_count),
    next_attempt_at: r.next_attempt_at ?? null,
    amount_cents: r.amount_cents == null ? null : Number(r.amount_cents),
    currency: r.currency ?? null,
    can_confirm: r.kind === 'needs_confirmation',
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
}

export type Confirmation =
  | { ok: true; client_secret: string; payment_intent: string }
  | { ok: false; status: 404 | 409; error: 'alert_not_found' | 'confirmation_not_needed' };

/**
 * Confirm pressed: the client secret of the caller's own open confirmation,
 * fetched from Stripe now and not stored. Anything else is 404, and a payment
 * that no longer needs the member is 409.
 */
export async function confirmationFor(env: Env, userId: number, alertId: number): Promise<Confirmation> {
  if (!Number.isSafeInteger(alertId) || alertId <= 0) return { ok: false, status: 404, error: 'alert_not_found' };
  const row = await env.DB.prepare(
    `SELECT invoice_id FROM billing_alerts WHERE id = ? AND user_id = ? AND kind = 'needs_confirmation' AND state = 'open'`,
  ).bind(alertId, userId).first<{ invoice_id: string | null }>();
  const invoiceId = idOf(row?.invoice_id, 'in');
  if (!invoiceId) return { ok: false, status: 404, error: 'alert_not_found' };
  const inv = await stripeGet<{ payment_intent?: { id?: string; status?: string; client_secret?: string } | string | null }>(
    env, `/invoices/${invoiceId}`, { 'expand[]': 'payment_intent' },
  );
  const pi = inv.payment_intent && typeof inv.payment_intent === 'object' ? inv.payment_intent : null;
  if (!pi?.client_secret || !pi.id || !['requires_action', 'requires_confirmation', 'requires_payment_method'].includes(String(pi.status))) {
    return { ok: false, status: 409, error: 'confirmation_not_needed' };
  }
  return { ok: true, client_secret: pi.client_secret, payment_intent: pi.id };
}
