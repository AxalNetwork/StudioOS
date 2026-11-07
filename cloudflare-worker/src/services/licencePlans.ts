/**
 * D4729 (#4729) — paid features follow each licence's own plan.
 *
 * The owner's answer A on #4472 (2026-11-06): each licence's paid features
 * check that licence's own stored plan. A granted licence with no plan of its
 * own stays on that licence's free tier. No member gets a paid feature without
 * that licence's plan. This module is the rule, in one place.
 *
 * Where each licence's plan lives (nothing new is stored):
 *   Founder   `users.subscription_tier` / `subscription_status` / `subscription_renews_at`
 *   Investor  `users.investor_tier` / `investor_subscription_status` / `investor_trial_ends_at` /
 *             `investor_subscription_renews_at` / `investor_seat_primary_user_id`
 *   Advisor, Operating Partner  `account_subscriptions` (one row per member, `plan_group` names the family)
 *
 * `users.role` is the primary licence; `user.licences` is the held set that auth attaches once.
 * A licence that is not held has no plan (`null`); one that is held with no stored plan reads `'free'`.
 *
 * Two readers: the PURE ones (`founderPlanTier`, `investorPlanTier`, `ownPlanTier`) read the caller's own
 * row and serve the synchronous gates in `middleware/requireTier.ts` and `requireInvestorTier.ts`; the ASYNC
 * ones (`licencePlanTier`, `licenceMeetsTier`) also resolve an Investor seat to its primary's plan and read
 * Advisor and Partner from `account_subscriptions`.
 *
 * This file imports no middleware, so the gates can import it without a cycle.
 */
import { inGrace } from '../middleware/planSubscription';
import type { Env } from '../types';
import type { InvestorTier } from './investorTiers';

export type PlanLicence = 'founder' | 'investor' | 'advisor' | 'partner';
export type FounderPlanTier = 'free' | 'growth' | 'studio';
export type StaffPlanTier = 'free' | 'pro';
export type LicencePlanTier = FounderPlanTier | InvestorTier | StaffPlanTier;

const FOUNDER_RANK: Record<FounderPlanTier, number> = { free: 0, growth: 1, studio: 2 };
const INVESTOR_RANK: Record<InvestorTier, number> = { free: 0, plus: 1, professional: 2, institutional: 3 };
const STAFF_RANK: Record<StaffPlanTier, number> = { free: 0, pro: 1 };

type Held = { role?: string | null; licences?: readonly string[] };
/** The same predicate as `holdsLicence` (services/accountLicences.ts), kept here so this file stays dependency-free. */
export function holds(user: Held | null | undefined, licence: PlanLicence): boolean {
  if (!user) return false;
  return user.licences ? user.licences.includes(licence) : String(user.role || '').toLowerCase() === licence;
}

export type FounderPlanCols = {
  subscription_tier?: string | null; subscription_status?: string | null; subscription_renews_at?: string | null;
};
export type InvestorPlanCols = {
  investor_tier?: string | null; investor_subscription_status?: string | null; investor_trial_ends_at?: string | null;
  investor_subscription_renews_at?: string | null; investor_seat_primary_user_id?: number | null;
};

/** True when `have` covers `required` on the Founder ladder. */
export function founderTierCovers(have: string | null | undefined, required: FounderPlanTier): boolean {
  return (FOUNDER_RANK[String(have ?? 'free').toLowerCase() as FounderPlanTier] ?? 0) >= FOUNDER_RANK[required];
}
/** True when `have` covers `required` on the Investor ladder. */
export function investorTierCovers(have: string | null | undefined, required: InvestorTier): boolean {
  return (INVESTOR_RANK[String(have ?? 'free').toLowerCase() as InvestorTier] ?? 0) >= INVESTOR_RANK[required];
}

/**
 * The Founder plan the row stores, as `userMeetsTier` has always read it: a lapsed, unpaid or never-paid
 * subscription reads Free (D1100, D892 §6), and a partner grant or referral past its end reads Free (X-1).
 */
export function founderPlanTier(user: FounderPlanCols | null | undefined): FounderPlanTier {
  if (!user) return 'free';
  const status = user.subscription_status ?? 'active';
  if (status === 'unpaid' || status === 'cancelled' || status === 'canceled'
    || (status === 'past_due' && !inGrace(status, user.subscription_renews_at))) return 'free';
  if (status === 'incomplete' || status === 'incomplete_expired') return 'free';
  if (status === 'partner_grant' || status === 'partner_referral') {
    const renews = user.subscription_renews_at;
    if (renews && new Date(renews).getTime() <= Date.now()) return 'free';
  }
  const tier = String(user.subscription_tier ?? 'free').toLowerCase() as FounderPlanTier;
  return FOUNDER_RANK[tier] !== undefined ? tier : 'free';
}

/**
 * The Investor plan the row stores, with an expired `trialing` reading Free (with `strictTrial`, a trial with no end date
 * reads Free too). Lapsed, unpaid and never-paid subscriptions read Free (D1052, D892 §6) and a partner grant or
 * referral past its end reads Free (X-1).
 */
export function investorPlanTier(user: InvestorPlanCols | null | undefined, now = Date.now(), strictTrial = false): InvestorTier {
  if (!user) return 'free';
  const status = (user.investor_subscription_status ?? 'free').toLowerCase();
  if (status === 'unpaid' || status === 'cancelled' || status === 'canceled'
    || (status === 'past_due' && !inGrace(status, user.investor_subscription_renews_at))) return 'free';
  if (status === 'incomplete' || status === 'incomplete_expired') return 'free';
  if (status === 'partner_grant' || status === 'partner_referral') {
    const renews = user.investor_subscription_renews_at;
    if (renews && new Date(renews).getTime() <= now) return 'free';
  }
  if (status === 'trialing') {
    const ends = user.investor_trial_ends_at ? Date.parse(String(user.investor_trial_ends_at)) : NaN;
    // The gates keep a trial with no recorded end on its tier, as they always have (billing_grace_bound pins it); the
    // licence reader (`strictTrial`, the archetype unlock) requires a recorded end that has not passed.
    if (Number.isFinite(ends) ? ends <= now : strictTrial) return 'free';
  }
  const tier = (user.investor_tier ?? 'free').toLowerCase() as InvestorTier;
  return INVESTOR_RANK[tier] !== undefined ? tier : 'free';
}

/**
 * The caller's own stored tier of a Founder or Investor licence, or `null` when that licence is not held.
 * An Investor seat reads its own row here (the copy made at acceptance); `licencePlanTier` reads the primary's.
 */
export function ownPlanTier(user: (Held & FounderPlanCols & InvestorPlanCols) | null | undefined, licence: 'founder' | 'investor'): FounderPlanTier | InvestorTier | null {
  if (!user || !holds(user, licence)) return null;
  return licence === 'founder' ? founderPlanTier(user) : investorPlanTier(user);
}

/** Synchronous `licenceMeetsTier` for Founder and Investor, from the caller's own row. A licence not held never meets a paid tier. */
export function ownLicenceMeets(user: (Held & FounderPlanCols & InvestorPlanCols) | null | undefined, licence: 'founder', required: FounderPlanTier): boolean;
export function ownLicenceMeets(user: (Held & FounderPlanCols & InvestorPlanCols) | null | undefined, licence: 'investor', required: InvestorTier): boolean;
export function ownLicenceMeets(user: (Held & FounderPlanCols & InvestorPlanCols) | null | undefined, licence: 'founder' | 'investor', required: string): boolean {
  const have = ownPlanTier(user, licence);
  if (have == null) return false;
  return licence === 'founder' ? founderTierCovers(have, required as FounderPlanTier) : investorTierCovers(have, required as InvestorTier);
}

/** A stored Advisor or Partner plan counts while its status is live (or past due within the grace window). */
function staffPlanOn(row: { status?: string | null; period_end?: string | null }): boolean {
  return inGrace(String(row.status ?? ''), row.period_end ?? null);
}

/**
 * The effective stored tier of `licence`'s own plan: `null` when the licence is not held, `'free'` when it is held
 * with no stored plan. An Investor seat reads its primary's plan, not the copy made when it was accepted.
 */
export async function licencePlanTier(env: Env, user: (Held & FounderPlanCols & InvestorPlanCols & { id?: number }) | null | undefined, licence: PlanLicence, now = Date.now()): Promise<LicencePlanTier | null> {
  if (!user || !holds(user, licence)) return null;
  if (licence === 'founder') return founderPlanTier(user);
  if (licence === 'investor') {
    const primaryId = Number(user.investor_seat_primary_user_id ?? 0);
    if (!primaryId) return investorPlanTier(user, now, true);
    const row = await env.DB.prepare(
      `SELECT investor_tier, investor_subscription_status, investor_trial_ends_at, investor_subscription_renews_at
         FROM users WHERE id = ?`,
    ).bind(primaryId).first<InvestorPlanCols>();
    return investorPlanTier(row, now, true);
  }
  const userId = Number(user.id ?? 0);
  if (!userId) return 'free';
  const { readAccountSubscription } = await import('./accountPlans');
  const row = await readAccountSubscription(env, userId);
  return row && row.plan_group === licence && staffPlanOn({ status: row.status, period_end: row.period_end }) ? 'pro' : 'free';
}

/** True when `licence` is held and its own plan covers `required`. */
export async function licenceMeetsTier(env: Env, user: (Held & FounderPlanCols & InvestorPlanCols & { id?: number }) | null | undefined, licence: PlanLicence, required: LicencePlanTier, now = Date.now()): Promise<boolean> {
  const have = await licencePlanTier(env, user, licence, now);
  if (have == null) return false;
  if (licence === 'founder') return founderTierCovers(have, required as FounderPlanTier);
  if (licence === 'investor') return investorTierCovers(have, required as InvestorTier);
  return (STAFF_RANK[have as StaffPlanTier] ?? 0) >= (STAFF_RANK[required as StaffPlanTier] ?? 0);
}

/** The catalogue key of the plan a licence stands on, for the account read: `founder:growth`, `advisor:pro`, `advisor:free`. */
export function planKeyOf(licence: PlanLicence, tier: LicencePlanTier): string {
  return `${licence}:${tier}`;
}

