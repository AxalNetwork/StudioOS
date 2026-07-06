/**
 * Persona (account-plan) subscriptions — the generic billing pipeline for every
 * signed-in role that doesn't have a dedicated one.
 *
 * Founder (`metadata.tier`) and Investor (`metadata.investor_tier`) each have a
 * bespoke pipeline (checkout / status / webhook / columns). Every OTHER role —
 * partner, advisor, and anything added later — shares this one, keyed by
 * a `plan_group` derived from the role. Catalog products opt a persona in by
 * carrying `metadata.plan_group === <group>` (e.g. 'partner', 'advisor'); the
 * `/api/billing/plan/*` routes resolve, subscribe, and sync against that.
 *
 * State lives in the `account_subscriptions` side table (mirrors migration 134),
 * NOT on `users` — that table is at D1's hard 100-column limit. See
 * .agents/memory/d1-users-column-limit.md.
 *
 * Pure helpers (`planGroupForRole`, `accountFieldsFromStripeSub`) are exported
 * so the smoke test can exercise the routing logic without a live D1/Stripe.
 */
import type { Env } from '../types';

let _migrated = false;

/** Idempotent schema bootstrap. Statement-for-statement mirror of migration 134. */
export async function ensureAccountPlanSchema(env: Env): Promise<void> {
  if (_migrated) return;
  const stmts = [
    `CREATE TABLE IF NOT EXISTS account_subscriptions (
       user_id INTEGER PRIMARY KEY,
       plan_group TEXT,
       plan TEXT,
       status TEXT NOT NULL DEFAULT 'free',
       subscription_id TEXT,
       period_end TEXT,
       trial_end TEXT,
       stripe_customer_id TEXT,
       updated_at TEXT DEFAULT (datetime('now'))
     )`,
    `CREATE INDEX IF NOT EXISTS idx_account_sub_customer ON account_subscriptions(stripe_customer_id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_account_sub_subscription ON account_subscriptions(subscription_id)`,
    `CREATE INDEX IF NOT EXISTS idx_account_sub_status ON account_subscriptions(status)`,
  ];
  for (const s of stmts) await env.DB.prepare(s).run();
  _migrated = true;
}

// Roles with their OWN dedicated billing pipeline — they never use this one
// (the Settings UI routes them to their bespoke panels).
const DEDICATED_ROLES = new Set(['founder', 'investor']);

// Explicit role → plan_group overrides. The "advisor" product surface is the
// `advisor` role internally (advisor == advisor, per the pricing pages). Every
// other non-dedicated role maps to its own name.
const ROLE_PLAN_GROUP: Record<string, string> = { advisor: 'advisor' };

/**
 * The plan_group a role subscribes under, or null when the role has a dedicated
 * pipeline (founder/investor). Non-dedicated roles default to their own name so
 * the mechanism is fully generic: a new persona lights up by tagging catalog
 * products with `metadata.plan_group` = the role (or an override here).
 */
export function planGroupForRole(role: string | null | undefined): string | null {
  const r = String(role || '').toLowerCase();
  if (!r || DEDICATED_ROLES.has(r)) return null;
  return ROLE_PLAN_GROUP[r] ?? r;
}

export interface AccountSubRow {
  user_id: number;
  plan_group: string | null;
  plan: string | null;
  status: string;
  subscription_id: string | null;
  period_end: string | null;
  trial_end: string | null;
  stripe_customer_id: string | null;
  updated_at: string | null;
}

/** Read the caller's account-plan row (or null when they've never subscribed). */
export async function readAccountSubscription(
  env: Env,
  userId: number | string,
): Promise<AccountSubRow | null> {
  await ensureAccountPlanSchema(env);
  return env.DB
    .prepare('SELECT * FROM account_subscriptions WHERE user_id = ?')
    .bind(userId)
    .first<AccountSubRow>()
    .catch(() => null);
}

/** Normalise the fields we mirror from a Stripe subscription webhook object. */
export function accountFieldsFromStripeSub(obj: Record<string, unknown>): {
  status: string;
  periodEnd: string | null;
  trialEnd: string | null;
} {
  const status = (obj.status as string) || 'active';
  const periodEnd = obj.current_period_end
    ? new Date(Number(obj.current_period_end) * 1000).toISOString()
    : null;
  const trialEnd = obj.trial_end
    ? new Date(Number(obj.trial_end) * 1000).toISOString()
    : null;
  return { status, periodEnd, trialEnd };
}

/**
 * Upsert the account-plan row from a `customer.subscription.created|updated`
 * webhook. `userId` + `group` come from the subscription metadata we stamp at
 * checkout (`kind='plan'`), so this only ever fires for our own persona subs.
 */
export async function upsertAccountPlanFromStripe(
  env: Env,
  obj: Record<string, unknown>,
  group: string | null,
  userId: number,
): Promise<void> {
  await ensureAccountPlanSchema(env);
  const { status, periodEnd, trialEnd } = accountFieldsFromStripeSub(obj);
  const customer = (obj.customer as string) ?? null;
  const subId = (obj.id as string) ?? null;
  const plan = group ? `${group}_pro` : null;
  await env.DB.prepare(
    `INSERT INTO account_subscriptions
       (user_id, plan_group, plan, status, subscription_id, period_end, trial_end, stripe_customer_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       plan_group        = COALESCE(excluded.plan_group, account_subscriptions.plan_group),
       plan              = COALESCE(excluded.plan, account_subscriptions.plan),
       status            = excluded.status,
       subscription_id   = COALESCE(excluded.subscription_id, account_subscriptions.subscription_id),
       period_end        = excluded.period_end,
       trial_end         = excluded.trial_end,
       stripe_customer_id= COALESCE(excluded.stripe_customer_id, account_subscriptions.stripe_customer_id),
       updated_at        = datetime('now')`,
  ).bind(userId, group, plan, status, subId, periodEnd, trialEnd, customer).run();
}

/**
 * Mark an account-plan row cancelled on `customer.subscription.deleted`.
 * Scoped by subscription_id so a customer with several subs only loses the one
 * that actually ended. Returns the number of rows changed (0 = not ours).
 */
export async function markAccountPlanDeleted(env: Env, subscriptionId: string): Promise<number> {
  await ensureAccountPlanSchema(env);
  const res = await env.DB.prepare(
    `UPDATE account_subscriptions
        SET status = 'cancelled', updated_at = datetime('now')
      WHERE subscription_id = ?`,
  ).bind(subscriptionId).run();
  return (res?.meta?.changes ?? 0) as number;
}

/**
 * Dev-only simulated upgrade (keyless env): flip the caller to active on the
 * persona plan without a Stripe round-trip. Mirrors the founder/investor
 * dev-upgrade so the flow stays testable without live Stripe.
 */
export async function devUpgradeAccountPlan(
  env: Env,
  userId: number | string,
  group: string,
): Promise<string> {
  await ensureAccountPlanSchema(env);
  const periodEnd = new Date(Date.now() + 30 * 86400 * 1000).toISOString();
  await env.DB.prepare(
    `INSERT INTO account_subscriptions (user_id, plan_group, plan, status, period_end, updated_at)
     VALUES (?, ?, ?, 'active', ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       plan_group = excluded.plan_group,
       plan       = excluded.plan,
       status     = 'active',
       period_end = excluded.period_end,
       updated_at = datetime('now')`,
  ).bind(userId, group, `${group}_pro`, periodEnd).run();
  return periodEnd;
}
