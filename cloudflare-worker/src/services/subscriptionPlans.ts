/**
 * Task #11 — Subscription plan catalog.
 *
 * Backed by the `subscription_plans` D1 table (migration
 * `cloudflare-worker/sql/migrations/004_subscription_plans.sql`). Replaces
 * the previously-hardcoded `PLAN_MONTHLY_USD` map in analyticsReports.ts so
 * that launching a new plan in Stripe (or inserting a row here) reflects in
 * MRR/ARR immediately, without a code change.
 *
 * The Stripe webhook calls `upsertPlanFromStripeSubscription` on every
 * `customer.subscription.created|updated` event so plans register the first
 * time anyone subscribes to them.
 */
import type { Env } from '../types';
import { getSQL } from '../db';

export interface SubscriptionPlanRow {
  plan_id: string;
  monthly_price_usd: number;
  display_name: string | null;
  stripe_price_id: string | null;
  is_active: number;
}

let _schemaReady = false;

/**
 * Idempotent CREATE TABLE + seed. Mirrors migration 004 so a fresh worker
 * boot has the catalog available even if the wrangler migration hasn't been
 * applied yet (matches the pattern used by `ensureMiPaywallSchema`).
 */
export async function ensureSubscriptionPlansSchema(env: Env): Promise<void> {
  if (_schemaReady) return;
  try {
    await env.DB.exec(
      'CREATE TABLE IF NOT EXISTS subscription_plans (' +
      'plan_id TEXT PRIMARY KEY, ' +
      'monthly_price_usd REAL NOT NULL, ' +
      'display_name TEXT, ' +
      'stripe_price_id TEXT, ' +
      'is_active INTEGER NOT NULL DEFAULT 1, ' +
      "created_at TEXT NOT NULL DEFAULT (datetime('now')), " +
      "updated_at TEXT NOT NULL DEFAULT (datetime('now')))",
    );
    await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_sub_plans_active ON subscription_plans(is_active)');
    // Seed the two legacy plans. INSERT OR IGNORE so admin edits survive boot.
    await env.DB.prepare(
      "INSERT OR IGNORE INTO subscription_plans (plan_id, monthly_price_usd, display_name) VALUES ('mi_pro_monthly', 49, 'MI Pro · Monthly')",
    ).run();
    await env.DB.prepare(
      "INSERT OR IGNORE INTO subscription_plans (plan_id, monthly_price_usd, display_name) VALUES ('mi_pro_annual', 39, 'MI Pro · Annual')",
    ).run();
    _schemaReady = true;
  } catch (e) {
    console.warn('[subscriptionPlans] ensureSchema failed:', (e as Error).message);
  }
}

/**
 * Load every known plan as a `plan_id → monthly_price_usd` map. Analytics
 * functions call this once at the top of a request and pass the map down,
 * so a single report does at most one DB read for pricing.
 */
export async function loadPlanPriceMap(env: Env): Promise<Map<string, number>> {
  await ensureSubscriptionPlansSchema(env);
  const sql = getSQL(env);
  try {
    const rows = (await sql`SELECT plan_id, monthly_price_usd FROM subscription_plans`) as Array<{
      plan_id: string; monthly_price_usd: number | string;
    }>;
    const map = new Map<string, number>();
    for (const r of rows) {
      const n = typeof r.monthly_price_usd === 'number' ? r.monthly_price_usd : Number(r.monthly_price_usd);
      if (Number.isFinite(n)) map.set(r.plan_id, n);
    }
    return map;
  } catch (e) {
    console.warn('[subscriptionPlans] loadPlanPriceMap failed:', (e as Error).message);
    return new Map();
  }
}

export function priceFor(map: Map<string, number>, plan: string | null | undefined): number {
  if (!plan) return 0;
  return map.get(plan) ?? 0;
}

// ---------- Stripe webhook upsert ----------

interface StripePrice {
  id?: string;
  unit_amount?: number | null;
  recurring?: { interval?: string; interval_count?: number } | null;
}
interface StripeSubscriptionItem { price?: StripePrice | null }
interface StripeSubscriptionLike {
  items?: { data?: StripeSubscriptionItem[] } | null;
  // Legacy single-plan shape some older API versions still emit.
  plan?: (StripePrice & { interval?: string; interval_count?: number }) | null;
  metadata?: Record<string, string> | null;
}

/**
 * Convert a Stripe price (`unit_amount` in cents + `recurring.interval`) to a
 * normalised monthly USD figure. Matches the convention the analytics layer
 * uses (annual plans are stored as their monthly equivalent so MRR math is a
 * straight `subscribers * monthly_price`).
 */
export function monthlyUsdFromStripePrice(price: StripePrice | null | undefined): number | null {
  if (!price || price.unit_amount == null) return null;
  const dollars = Number(price.unit_amount) / 100;
  if (!Number.isFinite(dollars) || dollars < 0) return null;
  const interval = price.recurring?.interval ?? 'month';
  const count = Math.max(1, Number(price.recurring?.interval_count ?? 1));
  switch (interval) {
    case 'day':   return Number(((dollars * 30) / count).toFixed(2));
    case 'week':  return Number(((dollars * 4.345) / count).toFixed(2));
    case 'month': return Number((dollars / count).toFixed(2));
    case 'year':  return Number((dollars / (12 * count)).toFixed(2));
    default:      return Number((dollars / count).toFixed(2));
  }
}

/**
 * Upsert a `subscription_plans` row from a Stripe subscription event payload
 * and return the resolved plan_id (so the caller can keep
 * `users.mi_subscription_plan` aligned with the catalog key).
 *
 * Plan-id resolution order:
 *   1. `preferredPlanId` — caller passes the plan currently stored on the
 *      user row. This is the value we already wrote to `users` from the
 *      checkout-session metadata, so it's the right key for backward
 *      compatibility with existing seed plans (e.g. `mi_pro_monthly`).
 *   2. `subscription.metadata.plan` — set on checkout sessions; sometimes
 *      copied onto the subscription itself.
 *   3. `price.id` — final fallback for plans launched in Stripe without
 *      explicit metadata wiring. Ensures MRR still tracks them; admins can
 *      later rename via the catalog row.
 *
 * Existing rows are NEVER overwritten on price (admins may have set the
 * canonical USD figure manually); only `stripe_price_id` and `updated_at`
 * are refreshed. New rows get the price derived from the Stripe payload.
 *
 * Returns the resolved plan_id, or null if no row could be derived.
 */
export async function upsertPlanFromStripeSubscription(
  env: Env,
  subscription: StripeSubscriptionLike,
  preferredPlanId?: string | null,
): Promise<string | null> {
  const item = subscription.items?.data?.[0];
  const price = (item?.price ?? subscription.plan ?? null) as StripePrice | null;
  if (!price) return null;
  const monthly = monthlyUsdFromStripePrice(price);
  if (monthly == null) return null;
  const planId = preferredPlanId || subscription.metadata?.plan || price.id || null;
  if (!planId) return null;
  await ensureSubscriptionPlansSchema(env);
  try {
    await env.DB.prepare(
      'INSERT INTO subscription_plans (plan_id, monthly_price_usd, display_name, stripe_price_id) ' +
      'VALUES (?, ?, ?, ?) ' +
      'ON CONFLICT(plan_id) DO UPDATE SET ' +
      '  stripe_price_id = excluded.stripe_price_id, ' +
      "  updated_at = datetime('now')",
    ).bind(planId, monthly, planId, price.id ?? null).run();
    return planId;
  } catch (e) {
    console.warn('[subscriptionPlans] upsertPlanFromStripeSubscription failed:', (e as Error).message);
    return null;
  }
}
