/**
 * The two path-prefix paywalls, in one place (D1421, #3699).
 *
 * `index.ts` mounts `requireTier('studio')` on every STUDIO_PREFIXES entry and
 * `requireInvestorTierExcept('professional')` on every INVESTOR_PRO_PREFIXES
 * entry, exactly as before; `services/studioModules.ts` reads the same arrays to
 * say which Studio modules a member's plan locks. Neither list is restated
 * anywhere else, so a new paywalled prefix locks its Studio modules too.
 */

/**
 * Task #6: Studio-tier (Raise + Grow) paywall prefixes. Bypass roles
 * (admin/partner/investor/advisor) are exempt inside the middleware itself.
 * Growth-tier mutation gates live inline at the specific handler.
 */
export const STUDIO_PREFIXES: readonly string[] = [
  '/api/capital',
  '/api/funds',
  '/api/fund-sim',
  '/api/liquidity',
  '/api/legalcap',
  '/api/cofounder',
  '/api/kyc',
  '/api/networkfx',
  '/api/insights',
  '/api/portfolio',
  '/api/journal',
  '/api/watchlist',
  '/api/antiportfolio',
  '/api/partner-office-hours',
  '/api/lp-reports',
  '/api/positions',
];

/**
 * Task #6 (W-1): investor Professional paywall prefixes. The middleware only
 * enforces tier when caller.role === 'investor'; `INVESTOR_PRO_EXEMPT` names
 * the precise exemptions.
 */
export const INVESTOR_PRO_PREFIXES: readonly string[] = [
  '/api/dd',
  '/api/pipeline',
  '/api/deals',
  '/api/ic',
];

/** True when `path` is `prefix` itself or under it, as the `p` and `${p}/*` mounts match. */
export function underPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}
