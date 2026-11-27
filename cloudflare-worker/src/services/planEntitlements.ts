/** D4653 (#4653): public entitlement evidence, projected from the existing catalogue and investor quota gates; no prices or new enforcement rules. */
import { catalogueFields, PLAN_CATALOGUE, type CatalogueEntry } from './planCatalogue';
import { INVESTOR_QUOTAS } from '../middleware/requireInvestorTier';
import type { InvestorTier } from './investorTiers';

/** These are plan defaults, not an assertion about a member's overrides or contract. */
export function entitlementFacts(entry: CatalogueEntry) {
  const tier = entry.key.slice('investor:'.length) as InvestorTier;
  const quota = entry.family === 'investor' && Object.hasOwn(INVESTOR_QUOTAS, tier) ? INVESTOR_QUOTAS[tier] : null;
  return {
    charging_unit: entry.sellable ? 'member_licence' : null,
    investor_defaults: quota ? {
      scope: 'investor_account',
      introduction_requests_per_quarter: quota.intros_per_quarter,
      active_deal_rooms: quota.dealroom_max,
      colleague_seats: quota.seats,
      negotiated: entry.key === 'investor:institutional',
    } : null,
    research_search_export_limits: entry.family === 'investor' ? 'not_published_in_catalogue' : null,
    human_sessions_and_third_party_fees: 'separately_quoted',
    support_commitment: 'no_sla_or_included_onboarding',
  };
}

export function catalogueWithEntitlements(entry: CatalogueEntry | null) {
  return entry ? { ...catalogueFields(entry)!, entitlements: entitlementFacts(entry) } : null;
}

export function publicEntitlementCatalogue() {
  return PLAN_CATALOGUE.map(entry => ({ ...catalogueWithEntitlements(entry)!, family: entry.family,
    licence_key: entry.licence_key, matches: entry.matches }));
}
