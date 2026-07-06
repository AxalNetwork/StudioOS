/**
 * Task #5 (AK) — single source of truth for the Market Intelligence
 * "full lens" tier predicate. Both `routes/market_intel.ts` and
 * `routes/investor_signals.ts` import from here so the gate cannot
 * drift between the seven sub-tabs.
 *
 * Free / Starter callers see only the sector-compass overview; this
 * predicate returns true for the entitled cohort:
 *   - admin / partner / advisor       → bypass (operations roles)
 *   - investor with professional+    → full lens
 *   - founder with growth/studio     → full lens
 */
import type { User } from '../types';
import { effectiveInvestorTier, type InvestorUser } from '../middleware/requireInvestorTier';
import type { TierUser } from '../middleware/requireTier';

export type MIUser = User & Partial<TierUser> & Partial<InvestorUser>;

const FULL_LENS_BYPASS_ROLES = ['admin', 'partner', 'advisor'] as const;

export function callerHasFullLens(user: MIUser | null | undefined): boolean {
  if (!user) return false;
  if ((FULL_LENS_BYPASS_ROLES as readonly string[]).includes(String(user.role))) return true;
  if (user.role === 'investor') {
    const t = effectiveInvestorTier(user as InvestorUser);
    return t === 'professional' || t === 'institutional';
  }
  const tier = String(user.subscription_tier ?? 'free').toLowerCase();
  return tier === 'growth' || tier === 'studio';
}
