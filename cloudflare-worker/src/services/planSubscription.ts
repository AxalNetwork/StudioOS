/**
 * D892 (#2453) — a plan bought through `POST /api/payments/intent` is granted
 * like a plan bought through a Billing checkout.
 *
 * WHAT WENT WRONG. `/pricing`'s Upgrade confirms through the payments intent,
 * which made a subscription stamped only `user_id`, `uid` and `price_id`. The
 * webhook grants a plan from `metadata.kind` (`tier`, `investor`, `plan`, `mi`),
 * so the card was charged and the plan never moved. An upgrade also started a
 * second subscription beside the first.
 *
 * ONE MAPPING FOR BOTH PATHS. A plan product carries the same metadata key the
 * Billing checkouts already look up with `priceForPlanMetadata`:
 *   `tier`            growth | studio          → kind `tier`
 *   `investor_tier`   professional | institutional → kind `investor`
 *   `plan_group`      a persona plan group      → kind `plan`
 *   `plan`            mi_pro                    → kind `mi`
 * `planMetaForProduct` reads it; the intent stamps it on the subscription, and
 * the webhook reads it back from the price for a subscription made before this
 * fix, whose event carries no `kind`.
 */
import type { Env } from '../types';
import { stripeCall } from '../routes/billing';
import { INVESTOR_QUOTAS, type InvestorTier } from '../middleware/requireInvestorTier';
import { classifyStripeError } from '../util/stripeError';
import { findCatalogProductByPriceId } from './catalog';

export type PlanMeta =
  | { kind: 'tier'; tier: 'growth' | 'studio' }
  | { kind: 'investor'; investor_tier: 'professional' | 'institutional' }
  | { kind: 'plan'; plan_group: string }
  | { kind: 'mi'; plan: 'mi_pro_monthly' | 'mi_pro_annual' };

/** The plan a catalog product sells, or null when it is not a plan. Pure. */
export function planMetaForProduct(
  product: { metadata?: Record<string, string> | null } | null | undefined,
  price: { interval?: string | null } | null | undefined,
): PlanMeta | null {
  const m = product?.metadata || {};
  if (m.tier === 'growth' || m.tier === 'studio') return { kind: 'tier', tier: m.tier };
  if (m.investor_tier === 'professional' || m.investor_tier === 'institutional') {
    return { kind: 'investor', investor_tier: m.investor_tier };
  }
  if (typeof m.plan_group === 'string' && m.plan_group.trim()) return { kind: 'plan', plan_group: m.plan_group.trim() };
  if (m.plan === 'mi_pro') return { kind: 'mi', plan: price?.interval === 'year' ? 'mi_pro_annual' : 'mi_pro_monthly' };
  return null;
}

/** The metadata fields a subscription carries for `meta`, as the Billing checkouts write them. Pure. */
export function planMetaFields(meta: PlanMeta): Record<string, string> {
  if (meta.kind === 'tier') return { kind: 'tier', tier: meta.tier };
  if (meta.kind === 'investor') return { kind: 'investor', investor_tier: meta.investor_tier };
  if (meta.kind === 'plan') return { kind: 'plan', plan_group: meta.plan_group };
  return { kind: 'mi', plan: meta.plan };
}

/** The same fields as Stripe form parameters: `metadata[kind]`, … Pure. */
export function planMetaParams(meta: PlanMeta): Record<string, string> {
  return Object.fromEntries(Object.entries(planMetaFields(meta)).map(([k, v]) => [`metadata[${k}]`, v]));
}

/** The price a subscription object is for: its stamped `price_id`, else its first item's price. Pure. */
export function subscriptionPriceId(obj: Record<string, unknown>): string | null {
  const meta = (obj.metadata as Record<string, string> | undefined) || {};
  if (typeof meta.price_id === 'string' && meta.price_id) return meta.price_id;
  const items = (obj.items as { data?: Array<{ price?: { id?: string } }> } | undefined)?.data;
  const id = items?.[0]?.price?.id;
  return typeof id === 'string' && id ? id : null;
}

/** The plan a subscription's own price sells, read from the catalog. Null when it is none, or unreadable. */
async function catalogPlanOf(env: Env, obj: Record<string, unknown>): Promise<PlanMeta | null> {
  const priceId = subscriptionPriceId(obj);
  if (!priceId) return null;
  try {
    const found = await findCatalogProductByPriceId(env, priceId);
    return found ? planMetaForProduct(found.product, found.price) : null;
  } catch (e) {
    console.warn('[billing] plan metadata not resolved from the catalog:', (e as Error).message);
    return null;
  }
}

/**
 * A subscription event's metadata, with the plan filled in from the catalog
 * when the event carries no `kind`, and whether it was (`fromCatalog`). Only
 * `customer.subscription.*` events are read this way. A catalog that cannot be
 * read leaves the metadata as it came: the webhook then does what it did
 * before, and never guesses a plan.
 */
export async function subscriptionPlanEvent(
  env: Env,
  eventType: string,
  obj: Record<string, unknown>,
): Promise<{ meta: Record<string, string>; fromCatalog: boolean }> {
  const meta = { ...((obj.metadata as Record<string, string> | undefined) ?? {}) };
  if (meta.kind || !eventType.startsWith('customer.subscription.')) return { meta, fromCatalog: false };
  const plan = await catalogPlanOf(env, obj);
  return plan ? { meta: { ...meta, ...planMetaFields(plan) }, fromCatalog: true } : { meta, fromCatalog: false };
}

/** `subscriptionPlanEvent`'s metadata alone. */
export async function subscriptionMetadata(
  env: Env,
  eventType: string,
  obj: Record<string, unknown>,
): Promise<Record<string, string>> {
  return (await subscriptionPlanEvent(env, eventType, obj)).meta;
}

/** The plan family a Stripe subscription belongs to: its stamped `kind`, else its price's product. */
export async function planKindOfSubscription(env: Env, sub: Record<string, unknown>): Promise<PlanMeta['kind'] | null> {
  const kind = String((sub.metadata as Record<string, string> | undefined)?.kind ?? '');
  if (kind === 'tier' || kind === 'investor' || kind === 'plan' || kind === 'mi') return kind;
  if (kind) return null;
  return (await catalogPlanOf(env, sub))?.kind ?? null;
}

/**
 * Statuses of a subscription whose first payment never completed. Stripe makes
 * the payments intent's subscription `incomplete` and moves it to
 * `incomplete_expired` when nobody pays. Neither grants a plan (D892 §6).
 */
export const UNPAID_STATUSES = ['incomplete', 'incomplete_expired'] as const;
export const isUnpaidStatus = (s: unknown) => (UNPAID_STATUSES as readonly string[]).includes(String(s || '').toLowerCase());

/**
 * Statuses that mean a subscription still exists for the member: paid, trialing,
 * or a renewal Stripe is retrying. This is about whether a second subscription
 * would be a duplicate, not about access: what `past_due` may use is D1052's
 * grace, bounded by D1100, in the gates.
 */
export const HELD_STATUSES = ['active', 'trialing', 'past_due'] as const;
const held = (s: unknown) => (HELD_STATUSES as readonly string[]).includes(String(s || '').toLowerCase());

/**
 * The member's subscription for the same plan family, when they already have
 * one, so the intent can refuse a second one and send them to the swap route
 * (`POST /api/billing/subscription/swap/preview`), which prorates.
 * Partner-granted tiers have no Stripe subscription and are not counted.
 */
export async function heldPlanSubscription(env: Env, userId: number, meta: PlanMeta): Promise<string | null> {
  if (meta.kind === 'tier' || meta.kind === 'investor') {
    const u = await env.DB.prepare(
      `SELECT subscription_tier, subscription_status, stripe_subscription_id,
              investor_tier, investor_subscription_status, investor_stripe_subscription_id
         FROM users WHERE id = ?`,
    ).bind(userId).first<Record<string, string | null>>();
    if (!u) return null;
    if (meta.kind === 'tier') {
      const paid = u.subscription_tier === 'growth' || u.subscription_tier === 'studio';
      return paid && held(u.subscription_status) && u.stripe_subscription_id ? u.stripe_subscription_id : null;
    }
    const paid = u.investor_tier === 'professional' || u.investor_tier === 'institutional';
    return paid && held(u.investor_subscription_status) && u.investor_stripe_subscription_id ? u.investor_stripe_subscription_id : null;
  }
  try {
    const row = meta.kind === 'plan'
      ? await env.DB.prepare('SELECT status, subscription_id FROM account_subscriptions WHERE user_id = ?')
        .bind(userId).first<{ status: string | null; subscription_id: string | null }>()
      : await env.DB.prepare('SELECT status, subscription_id FROM mi_pro_subscriptions WHERE user_id = ?')
        .bind(userId).first<{ status: string | null; subscription_id: string | null }>();
    return row && held(row.status) && row.subscription_id ? row.subscription_id : null;
  } catch {
    // The side table does not exist yet on this database: nothing is held there.
    return null;
  }
}

/**
 * The same question asked of Stripe, for what D1 cannot see: a subscription
 * the payments intent made before D892, whose events never reached the plan
 * columns. The member's live subscriptions on their general customer, then on
 * their investor customer when they have one, are read; one of the same family
 * counts as held, and the answer names the customer that holds it.
 *
 * Stripe answering `resource_missing` for the general customer means nothing is
 * held there: the id is unknown under the active key (the test-to-live
 * mismatch `/billing/overview` heals). Any other failed read throws, so the
 * intent refuses rather than risk a second charge (D892 §6).
 */
export async function heldPlanInStripe(
  env: Env,
  customers: { general: string | null | undefined; investor?: string | null },
  meta: PlanMeta,
): Promise<{ subscription: string; customer: string } | null> {
  const general = customers.general || null;
  const ids = [general, customers.investor || null].filter((c): c is string => typeof c === 'string' && c.length > 0);
  for (const customer of [...new Set(ids)]) {
    let list: { data?: Array<Record<string, unknown>> };
    try {
      list = await stripeCall<{ data?: Array<Record<string, unknown>> }>(
        env, '/subscriptions', { customer, status: 'all', limit: '20' }, { method: 'GET' },
      );
    } catch (e) {
      if (customer === general && classifyStripeError(e) === 'resource_missing') continue;
      throw e;
    }
    for (const sub of list?.data ?? []) {
      if (!held(sub.status) || typeof sub.id !== 'string') continue;
      if ((await planKindOfSubscription(env, sub)) === meta.kind) return { subscription: sub.id, customer };
    }
  }
  return null;
}

/** The member's stored investor customer, read only: nothing is made in Stripe. */
export async function storedInvestorCustomer(env: Env, userId: number): Promise<string | null> {
  const row = await env.DB.prepare('SELECT investor_stripe_customer_id FROM users WHERE id = ?')
    .bind(userId).first<{ investor_stripe_customer_id: string | null }>();
  return row?.investor_stripe_customer_id || null;
}

/**
 * A member with no investor customer, whose investor plan made before D892 sits
 * on their general customer, takes that customer as their investor customer,
 * so the plan's next event and the swap route find it. A member who already
 * has an investor customer keeps it (D892 §6).
 */
export async function adoptInvestorCustomer(env: Env, userId: number, customer: string): Promise<boolean> {
  const r = await env.DB.prepare('UPDATE users SET investor_stripe_customer_id = ? WHERE id = ? AND investor_stripe_customer_id IS NULL')
    .bind(customer, userId).run();
  return ((r?.meta?.changes ?? 0) as number) > 0;
}

/**
 * The member's investor customer, made when they have none. It is its own
 * Stripe customer, as the investor checkout makes it, never the general one:
 * Billing tells the two scopes apart by customer (D892 §6). The intent calls
 * it only once nothing is held, so a refused intent makes no customer. Two
 * intents at once can each make one; the first stored wins and the other is
 * left unused.
 */
export async function ensureInvestorCustomer(
  env: Env,
  user: { id: number; uid?: string | null; email?: string | null; name?: string | null },
): Promise<string> {
  const have = await storedInvestorCustomer(env, user.id);
  if (have) return have;
  const made = await stripeCall<{ id: string }>(env, '/customers', {
    ...(user.email ? { email: user.email } : {}),
    name: String(user.name || user.email || ''),
    'metadata[user_id]': String(user.id),
    'metadata[uid]': String(user.uid ?? ''),
    'metadata[scope]': 'investor',
  });
  await env.DB.prepare('UPDATE users SET investor_stripe_customer_id = ? WHERE id = ? AND investor_stripe_customer_id IS NULL')
    .bind(made.id, user.id).run();
  return (await storedInvestorCustomer(env, user.id)) || made.id;
}

// ── D892 §6: rows left at `incomplete` while Stripe took the payment ────────
//
// Before §6 each subscription event wrote its status as it came, so a
// `customer.subscription.created` (incomplete) delivered after the
// `updated` (active) could leave a paid founder or investor row at
// `incomplete`, which every gate now refuses. Two repairs read Stripe for such
// a row: the webhook's, when an `incomplete` event or `invoice.paid` names the
// subscription the row holds, which corrects a row Stripe says is live; and
// the owner's reconciliation (`POST /api/admin/billing/subscriptions/
// reconcile-incomplete`), which walks every such row and writes what Stripe
// says, as a dry run unless asked to write.

const SUB_ID = /^sub_[A-Za-z0-9]+$/;

/** A founder or investor row holding a subscription at `incomplete`. */
export interface IncompleteRow {
  user_id: number;
  family: 'tier' | 'investor';
  subscription_id: string;
  customer: string | null;
}

/** What Stripe said of an incomplete row's subscription, and whether it was written. */
export type SettleOutcome = 'granted' | 'ended' | 'unpaid' | 'unchanged' | 'mismatch' | 'missing' | 'unreadable';
export interface SettleResult {
  user_id: number;
  family: 'tier' | 'investor';
  subscription_id: string;
  outcome: SettleOutcome;
  stripe_status: string | null;
  tier: string | null;
  written: boolean;
}

type IncompleteUser = {
  id: number;
  stripe_customer_id: string | null; stripe_subscription_id: string | null; subscription_status: string | null;
  investor_stripe_customer_id: string | null; investor_stripe_subscription_id: string | null; investor_subscription_status: string | null;
};

function incompleteRowsOf(u: IncompleteUser, only?: string): IncompleteRow[] {
  const rows: IncompleteRow[] = [];
  if (u.subscription_status === 'incomplete' && u.stripe_subscription_id && (!only || u.stripe_subscription_id === only)) {
    rows.push({ user_id: Number(u.id), family: 'tier', subscription_id: u.stripe_subscription_id, customer: u.stripe_customer_id });
  }
  if (u.investor_subscription_status === 'incomplete' && u.investor_stripe_subscription_id && (!only || u.investor_stripe_subscription_id === only)) {
    rows.push({ user_id: Number(u.id), family: 'investor', subscription_id: u.investor_stripe_subscription_id, customer: u.investor_stripe_customer_id });
  }
  return rows;
}

/** The plan tier a subscription sells in `family`: its stamped tier, else its price's product. */
async function tierOfSubscription(env: Env, sub: Record<string, unknown>, family: 'tier' | 'investor'): Promise<string | null> {
  const m = (sub.metadata as Record<string, string> | undefined) ?? {};
  if (family === 'tier' && (m.tier === 'growth' || m.tier === 'studio')) return m.tier;
  if (family === 'investor' && (m.investor_tier === 'professional' || m.investor_tier === 'institutional')) return m.investor_tier;
  const plan = await catalogPlanOf(env, sub);
  if (plan?.kind === 'tier' && family === 'tier') return plan.tier;
  if (plan?.kind === 'investor' && family === 'investor') return plan.investor_tier;
  return null;
}

/**
 * What Stripe says of `row`'s subscription, written to the row when `write`.
 * Only the row that still holds that subscription at `incomplete` is touched,
 * and only when the subscription is on that row's own customer and of its
 * family. `liveOnly` (the webhook's repair) writes a live subscription only.
 *
 *   active, trialing, past_due → the plan, with Stripe's status and period end
 *   incomplete_expired, canceled → free, and the subscription let go
 *   unpaid → the status, as its own event would write it
 *   incomplete, or anything else → unchanged
 */
export async function settleIncompleteRow(
  env: Env,
  row: IncompleteRow,
  sub: Record<string, unknown>,
  opts: { write: boolean; liveOnly?: boolean },
): Promise<SettleResult> {
  const status = typeof sub.status === 'string' ? sub.status.toLowerCase() : null;
  const result = (outcome: SettleOutcome, tier: string | null = null, written = false): SettleResult => ({
    user_id: row.user_id, family: row.family, subscription_id: row.subscription_id, outcome, stripe_status: status, tier, written,
  });
  if (sub.id !== row.subscription_id || !row.customer || sub.customer !== row.customer) return result('mismatch');
  const kind = await planKindOfSubscription(env, sub);
  if (kind && kind !== row.family) return result('mismatch');

  // Every write is scoped to the row that still holds this subscription at
  // `incomplete`, so an event that moved it meanwhile is never overwritten.
  const inv = row.family === 'investor';
  let outcome: SettleOutcome;
  let tier: string | null = null;
  let write: () => Promise<{ meta?: { changes?: number } }>;
  if (held(status)) {
    outcome = 'granted';
    tier = await tierOfSubscription(env, sub, row.family);
    const end = Number(sub.current_period_end);
    const renews = Number.isFinite(end) && end > 0 ? new Date(end * 1000).toISOString() : null;
    const dealroom = inv && tier ? INVESTOR_QUOTAS[tier as InvestorTier].dealroom_max : null;
    write = () => (inv
      ? env.DB.prepare(
        `UPDATE users SET investor_tier = COALESCE(?, investor_tier), investor_subscription_status = ?,
                          investor_subscription_renews_at = COALESCE(?, investor_subscription_renews_at),
                          investor_dealroom_max = COALESCE(?, investor_dealroom_max)
          WHERE id = ? AND investor_stripe_subscription_id = ? AND investor_subscription_status = 'incomplete'`,
      ).bind(tier, status, renews, dealroom, row.user_id, row.subscription_id)
      : env.DB.prepare(
        `UPDATE users SET subscription_tier = COALESCE(?, subscription_tier), subscription_status = ?,
                          subscription_renews_at = COALESCE(?, subscription_renews_at)
          WHERE id = ? AND stripe_subscription_id = ? AND subscription_status = 'incomplete'`,
      ).bind(tier, status, renews, row.user_id, row.subscription_id)).run();
  } else if (status === 'incomplete_expired' || status === 'canceled') {
    outcome = 'ended';
    tier = 'free';
    // The spelling the deletion writes, so the row reads as any ended plan does.
    const ended = status === 'canceled' ? 'cancelled' : status;
    write = () => (inv
      ? env.DB.prepare(
        `UPDATE users SET investor_tier = 'free', investor_subscription_status = ?, investor_dealroom_max = ?,
                          investor_stripe_subscription_id = NULL
          WHERE id = ? AND investor_stripe_subscription_id = ? AND investor_subscription_status = 'incomplete'`,
      ).bind(ended, INVESTOR_QUOTAS.free.dealroom_max, row.user_id, row.subscription_id)
      : env.DB.prepare(
        `UPDATE users SET subscription_tier = 'free', subscription_status = ?, stripe_subscription_id = NULL
          WHERE id = ? AND stripe_subscription_id = ? AND subscription_status = 'incomplete'`,
      ).bind(ended, row.user_id, row.subscription_id)).run();
  } else if (status === 'unpaid') {
    outcome = 'unpaid';
    write = () => (inv
      ? env.DB.prepare(
        `UPDATE users SET investor_subscription_status = 'unpaid'
          WHERE id = ? AND investor_stripe_subscription_id = ? AND investor_subscription_status = 'incomplete'`,
      ).bind(row.user_id, row.subscription_id)
      : env.DB.prepare(
        `UPDATE users SET subscription_status = 'unpaid'
          WHERE id = ? AND stripe_subscription_id = ? AND subscription_status = 'incomplete'`,
      ).bind(row.user_id, row.subscription_id)).run();
  } else {
    return result('unchanged');
  }
  if (!opts.write || (opts.liveOnly && outcome !== 'granted')) return result(outcome, tier);

  const r = await write();
  const written = ((r?.meta?.changes ?? 0) as number) > 0;
  if (written && inv) {
    // Accepted seat colleagues follow their primary, with its period end (D1100).
    const p = await env.DB.prepare(
      'SELECT investor_tier, investor_subscription_status, investor_subscription_renews_at FROM users WHERE id = ?',
    ).bind(row.user_id).first<{ investor_tier: string | null; investor_subscription_status: string | null; investor_subscription_renews_at: string | null }>();
    if (p) {
      await env.DB.prepare(
        `UPDATE users SET investor_tier = ?, investor_subscription_status = ?, investor_subscription_renews_at = ?
          WHERE investor_seat_primary_user_id = ?`,
      ).bind(p.investor_tier, p.investor_subscription_status, p.investor_subscription_renews_at, row.user_id).run();
    }
  }
  return result(outcome, tier, written);
}

/**
 * The webhook's repair: a row holding `subId` at `incomplete` is corrected
 * from Stripe when Stripe says the subscription is live. Nothing is read from
 * Stripe when no row holds it so. It never fails the webhook: a failed read is
 * logged, and the owner's reconciliation remains for that row.
 */
export async function repairIncompleteFromStripe(env: Env, subId: unknown): Promise<number> {
  if (typeof subId !== 'string' || !SUB_ID.test(subId)) return 0;
  try {
    const found = await env.DB.prepare(
      `SELECT id, stripe_customer_id, stripe_subscription_id, subscription_status,
              investor_stripe_customer_id, investor_stripe_subscription_id, investor_subscription_status
         FROM users
        WHERE (stripe_subscription_id = ? AND subscription_status = 'incomplete')
           OR (investor_stripe_subscription_id = ? AND investor_subscription_status = 'incomplete')`,
    ).bind(subId, subId).all<IncompleteUser>();
    const rows = (found.results ?? []).flatMap((u) => incompleteRowsOf(u, subId));
    if (!rows.length) return 0;
    const sub = await stripeCall<Record<string, unknown>>(env, `/subscriptions/${subId}`, {}, { method: 'GET' });
    let fixed = 0;
    for (const row of rows) if ((await settleIncompleteRow(env, row, sub, { write: true, liveOnly: true })).written) fixed++;
    return fixed;
  } catch (e) {
    console.warn('[billing] incomplete plan row not repaired:', (e as Error).message);
    return 0;
  }
}

/** The most rows one reconciliation walk reads from Stripe. */
export const RECONCILE_LIMIT_MAX = 100;

/**
 * The owner's reconciliation: one page of founder and investor rows at
 * `incomplete` with a stored subscription, by user id after `after`. Each
 * row's subscription is read from Stripe, and what it says is reported, and
 * written only when `write`. A row whose subscription Stripe does not know
 * (`missing`) or could not read (`unreadable`) is left as it is. The answer
 * carries `next_after` while rows remain.
 */
export async function reconcileIncompleteRows(
  env: Env,
  opts: { write: boolean; after: number; limit: number },
): Promise<{ checked: number; results: SettleResult[]; counts: Record<SettleOutcome, number>; next_after: number | null }> {
  const limit = Math.max(1, Math.min(RECONCILE_LIMIT_MAX, Math.floor(opts.limit)));
  const page = await env.DB.prepare(
    `SELECT id, stripe_customer_id, stripe_subscription_id, subscription_status,
            investor_stripe_customer_id, investor_stripe_subscription_id, investor_subscription_status
       FROM users
      WHERE id > ?
        AND ((stripe_subscription_id IS NOT NULL AND subscription_status = 'incomplete')
          OR (investor_stripe_subscription_id IS NOT NULL AND investor_subscription_status = 'incomplete'))
      ORDER BY id LIMIT ?`,
  ).bind(Math.max(0, Math.floor(opts.after)), limit).all<IncompleteUser>();
  const users = page.results ?? [];
  const results: SettleResult[] = [];
  for (const row of users.flatMap((u) => incompleteRowsOf(u))) {
    const unread = (outcome: SettleOutcome): SettleResult => ({
      user_id: row.user_id, family: row.family, subscription_id: row.subscription_id, outcome, stripe_status: null, tier: null, written: false,
    });
    if (!SUB_ID.test(row.subscription_id)) { results.push(unread('mismatch')); continue; }
    let sub: Record<string, unknown>;
    try {
      sub = await stripeCall<Record<string, unknown>>(env, `/subscriptions/${row.subscription_id}`, {}, { method: 'GET' });
    } catch (e) {
      results.push(unread(classifyStripeError(e) === 'resource_missing' ? 'missing' : 'unreadable'));
      continue;
    }
    results.push(await settleIncompleteRow(env, row, sub, { write: opts.write }));
  }
  const counts = { granted: 0, ended: 0, unpaid: 0, unchanged: 0, mismatch: 0, missing: 0, unreadable: 0 } as Record<SettleOutcome, number>;
  for (const r of results) counts[r.outcome]++;
  return {
    checked: results.length,
    results,
    counts,
    next_after: users.length === limit ? Number(users[users.length - 1].id) : null,
  };
}

/**
 * D892 — a renewal whose payment failed. Until now nobody was told. The member
 * is told once per failed attempt, with the next retry when Stripe gives one.
 * What the plan allows meanwhile is D1052's grace, bounded by D1100; this does
 * not change it. A first payment that fails is not a renewal: the card form shows it.
 */
export async function recordRenewalFailure(env: Env, invoice: Record<string, unknown>): Promise<number | null> {
  if (invoice.billing_reason !== 'subscription_cycle') return null;
  const subId = typeof invoice.subscription === 'string' ? invoice.subscription : null;
  if (!subId) return null;
  const userId = await subscriptionOwner(env, subId);
  if (!userId) return null;
  const invoiceId = typeof invoice.id === 'string' ? invoice.id : '';
  const attempt = Number(invoice.attempt_count) || 1;
  const next = Number(invoice.next_payment_attempt);
  const nextDay = Number.isFinite(next) && next > 0 ? new Date(next * 1000).toISOString().slice(0, 10) : null;
  const { notify } = await import('./notify');
  // Stripe redelivers events: one notice per invoice and attempt.
  try {
    const seen = await env.DB.prepare(
      `SELECT 1 AS x FROM notifications_inbox
        WHERE user_id = ? AND type = 'billing.renewal_failed'
          AND json_extract(payload, '$.invoice') = ? AND json_extract(payload, '$.attempt') = ? LIMIT 1`,
    ).bind(userId, invoiceId, attempt).first();
    if (seen) return null;
  } catch { /* the inbox does not exist yet; notify creates it */ }
  return notify(env, {
    userId,
    type: 'billing.renewal_failed',
    category: 'billing',
    channels: ['in_app', 'email'],
    title: 'Your plan’s renewal payment failed',
    // Stripe gives no next attempt on the last one: say so, never promise a retry.
    body: nextDay
      ? `Stripe will try again on ${nextDay} (UTC). Update your card in Billing so the next try goes through.`
      : 'Stripe will not try again. Update your card in Billing and pay the open invoice to keep your plan.',
    link: '/settings?tab=billing',
    payload: { invoice: invoiceId, attempt, subscription: subId, next_payment_attempt: nextDay },
  });
}

/** Which member a Stripe subscription belongs to, across the four plan families. */
export async function subscriptionOwner(env: Env, subId: string): Promise<number | null> {
  const u = await env.DB.prepare(
    'SELECT id FROM users WHERE stripe_subscription_id = ? OR investor_stripe_subscription_id = ? LIMIT 1',
  ).bind(subId, subId).first<{ id: number }>();
  if (u?.id) return Number(u.id);
  const reads = [
    () => env.DB.prepare('SELECT user_id FROM account_subscriptions WHERE subscription_id = ? LIMIT 1').bind(subId).first<{ user_id: number }>(),
    () => env.DB.prepare('SELECT user_id FROM mi_pro_subscriptions WHERE subscription_id = ? LIMIT 1').bind(subId).first<{ user_id: number }>(),
  ];
  for (const read of reads) {
    try {
      const r = await read();
      if (r?.user_id) return Number(r.user_id);
    } catch { /* table absent on this database */ }
  }
  return null;
}
