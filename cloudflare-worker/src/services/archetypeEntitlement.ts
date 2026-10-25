/**
 * D594 (#1233) — who may see their archetype. The owner asked Session 1 to set
 * the tiers ("B, you define what are the best pricing tiers", #976), and no new
 * price was added: the archetype unlocks with each licence's existing paid plans.
 *
 *   Founder                  `subscription_tier` growth or studio (Validate + Build, or Raise + Grow, D683)
 *   Investor                 effective `investor_tier` Professional or Institutional ($149 / $599),
 *                            an active trial counting and a seat reading its primary's plan
 *   Partner, advisor, admin  always: their licence is the paid tier
 *   Spin-Out Lab participant always while `spinout_lab_active` is 1
 *
 * ONE CHECK, EVERY ROUTE. Each route that returns the caller's own archetype
 * result asks `archetypeAccess` and, when locked, sends no archetype field at
 * all (`withoutKeys` with `ARCHETYPE_KEYS`), never a hidden copy. Locking hides the result; it
 * never stops the engine or deletes anything, so an upgrade shows it at once.
 * The person's own answers, skills and values are never locked.
 */
import type { Env, User } from '../types';
import { userMeetsTier, tierUpsell } from '../middleware/requireTier';
import { effectiveInvestorTier, investorTierCovers, investorUpsell, type InvestorUser } from '../middleware/requireInvestorTier';

/** D1050: the plan by its catalogue key; its price is the plans read's, never typed here. */
export type RequiredPlan = { licence: 'founder' | 'investor'; tier: 'growth' | 'professional'; name?: string; plan_key: string };
export type ArchetypeAccess = { locked: false } | { locked: true; required_plan: RequiredPlan };

/** Roles whose licence is the paid tier. */
const ALWAYS_UNLOCKED = new Set(['admin', 'partner', 'advisor']);

const FOUNDER_PLAN: RequiredPlan = { licence: 'founder', tier: 'growth', name: tierUpsell('growth').plan.name, plan_key: tierUpsell('growth').plan.plan_key };
const INVESTOR_PLAN: RequiredPlan = { licence: 'investor', tier: 'professional', name: investorUpsell('professional').plan.name, plan_key: investorUpsell('professional').plan.plan_key };

/**
 * The investor's effective tier, read as `effectiveInvestorTier` does, plus the
 * trial end its docstring promises: a `trialing` row whose `investor_trial_ends_at`
 * has passed reads Free.
 */
function investorTierNow(row: InvestorUser | null | undefined, now: number) {
  if (!row) return 'free' as const;
  const status = String(row.investor_subscription_status ?? '').toLowerCase();
  if (status === 'trialing') {
    const ends = row.investor_trial_ends_at ? Date.parse(String(row.investor_trial_ends_at)) : NaN;
    if (!Number.isFinite(ends) || ends <= now) return 'free' as const;
  }
  return effectiveInvestorTier(row);
}

export async function archetypeAccess(env: Env, user: User | null | undefined, now = Date.now()): Promise<ArchetypeAccess> {
  if (!user) return { locked: true, required_plan: FOUNDER_PLAN };
  const role = String(user.role ?? '').toLowerCase();
  if (ALWAYS_UNLOCKED.has(role)) return { locked: false };
  if (Number((user as any).spinout_lab_active ?? 0) === 1) return { locked: false };
  if (role === 'investor') {
    let row = user as InvestorUser;
    const primaryId = Number((user as InvestorUser).investor_seat_primary_user_id ?? 0);
    if (primaryId) {
      // A seat reads its primary's plan, not the copy made when it was accepted.
      row = (await env.DB.prepare(
        `SELECT id, role, investor_tier, investor_subscription_status, investor_subscription_renews_at, investor_trial_ends_at
           FROM users WHERE id = ?`,
      ).bind(primaryId).first<InvestorUser>()) as InvestorUser;
    }
    return investorTierCovers(investorTierNow(row, now), 'professional')
      ? { locked: false }
      : { locked: true, required_plan: INVESTOR_PLAN };
  }
  return userMeetsTier(user, 'growth') ? { locked: false } : { locked: true, required_plan: FOUNDER_PLAN };
}

/**
 * The archetype fields of each read that carries one. Skills, values, the Axal
 * values and the person's answers are not among them, and an assessment's
 * `confidence` (its vectors') is not the archetype's.
 */
export const ARCHETYPE_KEYS = {
  bestFit: ['archetype', 'archetypes'],
  assessmentResult: ['archetype_slug', 'archetype_label'],
  // A profile snapshot's archetype half: which one shows, the runner-up, how
  // sure, by how much, the trait scores behind it, and its hysteresis state.
  snapshot: ['displayed_slug', 'computed_slug', 'secondary_slug', 'confidence', 'margin', 'traits', 'hysteresis'],
} as const;

/** A copy of `obj` with `keys` removed. */
export function withoutKeys<T extends Record<string, unknown>>(obj: T, keys: readonly string[]): Partial<T> {
  const out: Record<string, unknown> = { ...obj };
  for (const k of keys) delete out[k];
  return out as Partial<T>;
}
