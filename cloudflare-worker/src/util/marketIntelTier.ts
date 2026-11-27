/**
 * Task #5 (AK) — single source of truth for the Market Intelligence
 * "full lens" tier predicate, used by `routes/market_intel.ts`. (The
 * investor-signals reads that shared it were retired with the /market-intel
 * page, D670.)
 *
 * Free / Starter callers see only the sector-compass overview; this
 * predicate returns true for the entitled cohort:
 *   - admin / partner / advisor       → bypass (operations roles)
 *   - investor on any paid tier      → full lens (D1334: Plus too, as
 *                                       a founder's lowest paid tier is)
 *   - founder with growth/studio     → full lens
 */
import type { User } from '../types';
import type { InvestorUser } from '../middleware/requireInvestorTier';
import { holds, investorPlanTier } from '../services/licencePlans';
import type { TierUser } from '../middleware/requireTier';

export type MIUser = User & Partial<TierUser> & Partial<InvestorUser>;

const FULL_LENS_BYPASS_ROLES = ['admin', 'partner', 'advisor'] as const;

export function callerHasFullLens(user: MIUser | null | undefined): boolean {
  if (!user) return false;
  if ((FULL_LENS_BYPASS_ROLES as readonly string[]).includes(String(user.role))) return true;
  // D4729: each held licence's own plan. A shared entitlement accepts either one's paid plan.
  // The Founder side reads the stored tier as it always has (this lens never applied the lapse rules); an account whose
  // primary is not Investor and holds no Founder licence keeps that reading too, so a one-licence account sees no change.
  const storedTier = String(user.subscription_tier ?? 'free').toLowerCase();
  const founder = (storedTier === 'growth' || storedTier === 'studio') && (holds(user, 'founder') || user.role !== 'investor');
  const investor = holds(user, 'investor') && investorPlanTier(user) !== 'free';
  return founder || investor;
}
