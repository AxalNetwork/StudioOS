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

/**
 * A subscription event's metadata, with the plan filled in from the catalog
 * when the event carries no `kind`. Only `customer.subscription.*` events are
 * read this way. A catalog that cannot be read leaves the metadata as it came:
 * the webhook then does what it did before, and never guesses a plan.
 */
export async function subscriptionMetadata(
  env: Env,
  eventType: string,
  obj: Record<string, unknown>,
): Promise<Record<string, string>> {
  const meta = { ...((obj.metadata as Record<string, string> | undefined) ?? {}) };
  if (meta.kind || !eventType.startsWith('customer.subscription.')) return meta;
  const priceId = subscriptionPriceId(obj);
  if (!priceId) return meta;
  try {
    const found = await findCatalogProductByPriceId(env, priceId);
    const plan = found ? planMetaForProduct(found.product, found.price) : null;
    return plan ? { ...meta, ...planMetaFields(plan) } : meta;
  } catch (e) {
    console.warn('[billing] plan metadata not resolved from the catalog:', (e as Error).message);
    return meta;
  }
}

/**
 * Statuses that mean a subscription still exists for the member: paid, trialing,
 * or a renewal Stripe is retrying. This is about whether a second subscription
 * would be a duplicate, not about access: what `past_due` may use is #2451's
 * owner question 4, and the tier gates are unchanged here.
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
 * D892 — a renewal whose payment failed. Until now nobody was told. The member
 * is told once per failed attempt, with the next retry when Stripe gives one.
 * What the plan allows meanwhile is #2451's owner question 4; this does not
 * change it. A first payment that fails is not a renewal: the card form shows it.
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
    body: nextDay
      ? `Stripe will try again on ${nextDay}. Update your card in Billing so the next try goes through.`
      : 'Stripe will try again. Update your card in Billing so the next try goes through.',
    link: '/settings?tab=billing',
    payload: { invoice: invoiceId, attempt, subscription: subId, next_payment_attempt: nextDay },
  });
}

/** Which member a Stripe subscription belongs to, across the four plan families. */
async function subscriptionOwner(env: Env, subId: string): Promise<number | null> {
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
