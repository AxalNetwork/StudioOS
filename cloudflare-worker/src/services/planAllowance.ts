/**
 * D783 (#2124) — a plan includes 25% of its price as AI allowance each month.
 *
 * The owner, 2026-10-19: "Customers get 25% in token credits of the total
 * subscription cost, 20$ subscription would offer 5$ in tokens." No paid plan
 * means no allowance: every run uses top-up tokens. A yearly plan gives a
 * monthly share, 25% of the yearly price ÷ 12. There is no daily limit.
 *
 * THE PRICE THAT COUNTS IS THE MEMBER'S OWN. `member_subscription_amounts`
 * (migration 505) records each member plan's amount from the subscription
 * webhook, so a discounted or grandfathered price counts as paid. A
 * subscriber with no recorded row yet (subscribed before migration 505) falls
 * back to the catalogue's current price for the plan the mirrors say they
 * hold, and says so (`source: 'catalogue'`).
 *
 * Only member plans count: founder, investor, Market Intelligence and the
 * persona plans. Registered Agent is a company service (the owner's answer on
 * #2124, Q2). Only a subscription in Stripe's `active` status counts: a trial
 * has not been paid, and `past_due` has not been either.
 *
 * All amounts are integers: cents in, micro-USD out, rounded down.
 */
import type { Env } from '../types';
import { effectiveInvestorTier } from '../middleware/requireInvestorTier';

/** D783: the share of a plan's monthly-equivalent price included as AI allowance. */
export const PLAN_AI_SHARE = 0.25;
// 1 cent = 10,000 micro-USD; 25% of that is 2,500. Kept beside the share so a change to one is seen.
const MICRO_PER_CENT_SHARED = Math.round(10_000 * PLAN_AI_SHARE);

export const PLAN_FAMILIES = ['founder', 'investor', 'market_intelligence', 'advisor', 'partner'] as const;
export type PlanFamily = typeof PLAN_FAMILIES[number];
const PAID_STATUS = 'active';

/** Months one charge covers, or null for an interval a plan never uses. */
export function monthsPerCharge(interval: unknown, count: unknown): number | null {
  const n = typeof count === 'number' && Number.isSafeInteger(count) && count > 0 ? count : 1;
  if (interval === 'month') return n;
  if (interval === 'year') return 12 * n;
  return null;
}

/** The monthly allowance one charge buys: 25% of its monthly equivalent, in micro-USD, rounded down. */
export function allowanceFromCharge(amountCents: unknown, interval: unknown, count: unknown): number {
  const months = monthsPerCharge(interval, count);
  if (months === null || typeof amountCents !== 'number' || !Number.isSafeInteger(amountCents) || amountCents <= 0) return 0;
  return Math.floor((amountCents * MICRO_PER_CENT_SHARED) / months);
}

export interface AllowancePart {
  family: PlanFamily;
  source: 'recorded' | 'catalogue';
  amount_cents: number;
  interval: string;
  interval_count: number;
  allowance_microusd: number;
}
export interface PlanAllowance {
  monthly_microusd: number;
  /** `plan` when every part is recorded, `catalogue` when any part is today's catalogue price, `none` with no paid plan. */
  source: 'plan' | 'catalogue' | 'none';
  share: number;
  parts: AllowancePart[];
}

/** D1's "no such table: <table>" for exactly this table, not one whose name it begins. A string match: the name is never a pattern. */
const missingTable = (e: unknown, table: string) => {
  const message = String((e as Error)?.message ?? e), needle = `no such table: ${table}`;
  const at = message.indexOf(needle);
  return at >= 0 && !/\w/.test(message.charAt(at + needle.length));
};

// ---------------------------------------------------------------------------
// The webhook's write
// ---------------------------------------------------------------------------

interface SubscriptionItem { quantity?: number; price?: { unit_amount?: number | null; currency?: string; recurring?: { interval?: string; interval_count?: number } | null } }

/** The subscription's charge from its items: Σ unit_amount × quantity at the first item's interval. Null when unreadable. */
export function chargeOf(obj: Record<string, unknown>): { amount_cents: number; currency: string | null; interval: string; interval_count: number } | null {
  const items = ((obj.items as { data?: SubscriptionItem[] } | undefined)?.data ?? []).filter(Boolean);
  const first = items.find((i) => i.price?.recurring?.interval);
  const interval = first?.price?.recurring?.interval;
  if (!first || !interval) return null;
  const count = first.price?.recurring?.interval_count ?? 1;
  let amount = 0;
  for (const item of items) {
    const r = item.price?.recurring;
    if (!r || r.interval !== interval || (r.interval_count ?? 1) !== count) continue;
    const unit = item.price?.unit_amount, qty = item.quantity ?? 1;
    if (typeof unit !== 'number' || !Number.isSafeInteger(unit) || unit < 0 || !Number.isSafeInteger(qty) || qty < 0) return null;
    amount += unit * qty;
  }
  return Number.isSafeInteger(amount) ? { amount_cents: amount, currency: first.price?.currency ?? null, interval, interval_count: count } : null;
}

/**
 * The member and plan family a subscription event belongs to, by the same
 * routing the billing webhook's mirrors use. Null for any other subscription
 * (Registered Agent, generic products), which gives no allowance.
 */
export async function subscriptionOwner(env: Env, obj: Record<string, unknown>,
  kind: { isPlan: boolean; isTier: boolean; isInvestor: boolean }): Promise<{ userId: number; family: PlanFamily } | null> {
  const meta = (obj.metadata as Record<string, string> | undefined) ?? {};
  const customer = typeof obj.customer === 'string' ? obj.customer : null;
  const byId = (id: unknown) => { const n = Number(id); return Number.isSafeInteger(n) && n > 0 ? n : null; };
  if (kind.isPlan) {
    const userId = byId(meta.user_id);
    return userId && (meta.plan_group === 'advisor' || meta.plan_group === 'partner') ? { userId, family: meta.plan_group } : null;
  }
  if (meta.kind === 'mi') {
    const userId = byId(meta.user_id);
    return userId ? { userId, family: 'market_intelligence' } : null;
  }
  if (kind.isTier && customer) {
    const u = await env.DB.prepare('SELECT id FROM users WHERE stripe_customer_id = ? LIMIT 1').bind(customer).first<{ id: number }>();
    return u ? { userId: u.id, family: 'founder' } : null;
  }
  if (kind.isInvestor && customer) {
    const u = await env.DB.prepare('SELECT id FROM users WHERE investor_stripe_customer_id = ? AND investor_seat_primary_user_id IS NULL LIMIT 1')
      .bind(customer).first<{ id: number }>();
    return u ? { userId: u.id, family: 'investor' } : null;
  }
  // A legacy Market Intelligence subscription with no kind: its own mirror row names the member.
  if (typeof obj.id === 'string') {
    try {
      const mi = await env.DB.prepare('SELECT user_id FROM mi_pro_subscriptions WHERE subscription_id = ? LIMIT 1').bind(obj.id).first<{ user_id: number }>();
      if (mi) return { userId: mi.user_id, family: 'market_intelligence' };
    } catch (e) { if (!missingTable(e, 'mi_pro_subscriptions')) throw e; }
  }
  return null;
}

/**
 * `customer.subscription.created` and `updated`: record the member's charge.
 * Never moves a canceled row back: Stripe does not reactivate a canceled
 * subscription, so an out-of-order older event cannot revive one.
 */
export async function recordSubscriptionAmount(env: Env, obj: Record<string, unknown>,
  kind: { isPlan: boolean; isTier: boolean; isInvestor: boolean }): Promise<'recorded' | 'skipped'> {
  if (typeof obj.id !== 'string' || !obj.id) return 'skipped';
  const owner = await subscriptionOwner(env, obj, kind);
  const charge = chargeOf(obj);
  if (!owner || !charge) return 'skipped';
  const status = typeof obj.status === 'string' ? obj.status : 'active';
  const periodEnd = typeof obj.current_period_end === 'number' ? new Date(obj.current_period_end * 1000).toISOString() : null;
  await env.DB.prepare(`INSERT INTO member_subscription_amounts
      (subscription_id, user_id, plan_family, amount_cents, currency, interval, interval_count, status, period_end)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(subscription_id) DO UPDATE SET user_id = excluded.user_id, plan_family = excluded.plan_family,
      amount_cents = excluded.amount_cents, currency = excluded.currency, interval = excluded.interval,
      interval_count = excluded.interval_count, status = excluded.status, period_end = excluded.period_end,
      updated_at = datetime('now')
    WHERE member_subscription_amounts.status <> 'canceled'`)
    .bind(obj.id, owner.userId, owner.family, charge.amount_cents, charge.currency, charge.interval, charge.interval_count, status, periodEnd).run();
  return 'recorded';
}

/** `customer.subscription.deleted`: the row stays, canceled, so it never falls back to the catalogue. */
export async function markSubscriptionAmountCanceled(env: Env, subscriptionId: string): Promise<void> {
  await env.DB.prepare(`UPDATE member_subscription_amounts SET status = 'canceled', updated_at = datetime('now') WHERE subscription_id = ?`)
    .bind(subscriptionId).run();
}

// ---------------------------------------------------------------------------
// The allowance
// ---------------------------------------------------------------------------

/**
 * D816 (#2262): how often the member's plan in `family` is charged, from the
 * charge the webhook recorded (`month` or `year`), or null when no live row
 * is recorded (a free member, one who subscribed before migration 505, or a
 * missing table). A canceled subscription answers nothing.
 */
export async function heldInterval(env: Env, userId: number, family: string): Promise<string | null> {
  try {
    const row = await env.DB.prepare(`SELECT interval FROM member_subscription_amounts
        WHERE user_id = ? AND plan_family = ? AND status <> 'canceled' ORDER BY updated_at DESC, id DESC LIMIT 1`)
      .bind(userId, family).first<{ interval: string | null }>();
    return row?.interval ?? null;
  } catch (e) {
    if (missingTable(e, 'member_subscription_amounts')) return null;
    throw e;
  }
}

/** The plan families the mirrors say this member pays for, with what the catalogue fallback needs. */
async function mirroredPlans(env: Env, user: any): Promise<Array<{ family: PlanFamily; match: Record<string, string>; interval: string }>> {
  const out: Array<{ family: PlanFamily; match: Record<string, string>; interval: string }> = [];
  // `subscription_status` defaults to 'active' for a free founder, so a paid founder also has a tier and a subscription id.
  if ((user.subscription_tier === 'growth' || user.subscription_tier === 'studio') && user.stripe_subscription_id && user.subscription_status === PAID_STATUS)
    out.push({ family: 'founder', match: { tier: user.subscription_tier }, interval: 'month' });
  const inv = effectiveInvestorTier(user);
  // A seat colleague inherits the tier but does not pay for it.
  if ((inv === 'professional' || inv === 'institutional') && user.investor_stripe_subscription_id
      && user.investor_subscription_status === PAID_STATUS && user.investor_seat_primary_user_id == null)
    out.push({ family: 'investor', match: { investor_tier: inv }, interval: 'month' });
  try {
    const mi = await env.DB.prepare('SELECT plan FROM mi_pro_subscriptions WHERE user_id = ? AND status = ?').bind(user.id, PAID_STATUS).first<{ plan: string | null }>();
    if (mi) out.push({ family: 'market_intelligence', match: { plan: 'mi_pro' }, interval: mi.plan === 'mi_pro_annual' ? 'year' : 'month' });
  } catch (e) { if (!missingTable(e, 'mi_pro_subscriptions')) throw e; }
  try {
    const persona = await env.DB.prepare('SELECT plan_group FROM account_subscriptions WHERE user_id = ? AND status = ?').bind(user.id, PAID_STATUS).first<{ plan_group: string | null }>();
    if (persona && (persona.plan_group === 'advisor' || persona.plan_group === 'partner'))
      out.push({ family: persona.plan_group, match: { plan_group: persona.plan_group }, interval: 'month' });
  } catch (e) { if (!missingTable(e, 'account_subscriptions')) throw e; }
  return out;
}

/** Today's catalogue price for a plan, at the interval it is held, else its first recurring price. */
async function cataloguePrice(env: Env, match: Record<string, string>, interval: string): Promise<{ amount_cents: number; interval: string; interval_count: number } | null> {
  let rows: any[] = [];
  try {
    const res = await env.DB.prepare("SELECT metadata_json, prices_json FROM stripe_products WHERE kind = 'subscription' AND active = 1 ORDER BY id").all<any>();
    rows = res.results ?? [];
  } catch (e) { if (!missingTable(e, 'stripe_products')) throw e; }
  for (const row of rows) {
    let meta: Record<string, string>, prices: any[];
    try { meta = JSON.parse(row.metadata_json); prices = JSON.parse(row.prices_json); } catch { continue; }
    if (!meta || !Array.isArray(prices) || !Object.entries(match).every(([k, v]) => meta[k] === v)) continue;
    const usable = prices.filter((p) => p && p.active === true && Number.isSafeInteger(p.unit_amount) && monthsPerCharge(p.interval, p.interval_count) !== null
      && (p.currency == null || String(p.currency).toLowerCase() === 'usd'));
    const price = usable.find((p) => p.interval === interval) ?? usable[0];
    if (price) return { amount_cents: price.unit_amount, interval: price.interval, interval_count: price.interval_count ?? 1 };
  }
  return null;
}

/**
 * A member's monthly allowance: 25% of the monthly equivalent of every active
 * member plan they pay. A family with a recorded row (any status) uses only
 * what is recorded; one the mirrors show active with no row yet uses the
 * catalogue's current price.
 */
export async function planAllowanceFor(env: Env, user: any): Promise<PlanAllowance> {
  let recorded: any[] = [];
  try {
    const res = await env.DB.prepare(`SELECT plan_family, amount_cents, currency, interval, interval_count, status
      FROM member_subscription_amounts WHERE user_id = ? ORDER BY id`).bind(user.id).all<any>();
    recorded = res.results ?? [];
  } catch (e) { if (!missingTable(e, 'member_subscription_amounts')) throw e; }
  const parts: AllowancePart[] = [];
  const known = new Set<string>();
  for (const r of recorded) {
    known.add(r.plan_family);
    if (r.status !== PAID_STATUS || !(PLAN_FAMILIES as readonly string[]).includes(r.plan_family)) continue;
    if (r.currency != null && String(r.currency).toLowerCase() !== 'usd') continue;
    const allowance = allowanceFromCharge(r.amount_cents, r.interval, r.interval_count);
    parts.push({ family: r.plan_family, source: 'recorded', amount_cents: r.amount_cents, interval: r.interval, interval_count: r.interval_count, allowance_microusd: allowance });
  }
  for (const m of await mirroredPlans(env, user)) {
    if (known.has(m.family)) continue;
    const price = await cataloguePrice(env, m.match, m.interval);
    if (!price) continue;
    parts.push({ family: m.family, source: 'catalogue', ...price, allowance_microusd: allowanceFromCharge(price.amount_cents, price.interval, price.interval_count) });
  }
  const monthly = parts.reduce((sum, p) => sum + p.allowance_microusd, 0);
  return {
    monthly_microusd: monthly,
    source: parts.length === 0 ? 'none' : parts.some((p) => p.source === 'catalogue') ? 'catalogue' : 'plan',
    share: PLAN_AI_SHARE,
    parts,
  };
}
