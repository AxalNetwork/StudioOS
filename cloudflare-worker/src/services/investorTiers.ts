/**
 * D1334 (#3540) — the investor tier names, in one dependency-free module so
 * the billing, catalogue and money-rail readers can share them without
 * importing the paywall middleware.
 *
 * Rank order: free < plus < professional < institutional
 * (`middleware/requireInvestorTier.ts` holds the ranks and the gates).
 */
export type InvestorTier = 'free' | 'plus' | 'professional' | 'institutional';

/**
 * A paid investor tier a Stripe product or checkout may name, or null.
 * Anything else (a typo, a tier this code does not know) grants nothing: it
 * never falls through to Professional, which is how a `plus` product would
 * have handed out Pro before Plus existed.
 */
export function paidInvestorTier(raw: unknown): Exclude<InvestorTier, 'free'> | null {
  return raw === 'plus' || raw === 'professional' || raw === 'institutional' ? raw : null;
}
