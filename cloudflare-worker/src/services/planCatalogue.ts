/**
 * D1050 (#2901, part 2 of #2451) — THE PLAN CATALOGUE: one table of what
 * each plan is, read by every surface that names a plan (Pricing's cards, the
 * paywall, the checkout sheet, Billing, the upsell a 402 carries).
 *
 * NO PRICE LIVES HERE. A price is Stripe's, mirrored in D1 (`stripe_products`)
 * and read through the Worker: `plansAndPacks` (`services/aiCredits.ts`) sends
 * it beside these fields on `GET /api/public/plans-and-packs`. A typed amount
 * disagreed with Stripe four times over before this (the map,
 * `documentation/audits/CHECKOUT_MAP_2026-10-25.md` §1 item 3);
 * `plan_catalogue_d1050.test.ts` fails on any typed `$` amount in the files
 * that name a plan.
 *
 * EACH ENTRY:
 *   - `key`: the plan's key, `family:tier` for a plan a profile buys, or
 *     `other`, `lp_access` and `admin`;
 *   - `family`, `name`, `tagline` and `colour` (the profile colour on the
 *     plan pill: D1048's sheet, and the canvas's);
 *   - `licence_key` and `matches`: the Stripe product metadata the plan is
 *     sold under, as `planOf` (`services/aiCredits.ts`) reads it. Null for a
 *     plan with no product (a free plan, LP access, staff);
 *   - `sellable` and `sellable_reason`. Investor Plus is not sold (D786);
 *   - `storage` and `best_suited_for`: #2449's. Neither is decided yet, so each
 *     is null with the reason, never a figure;
 *   - `included`: the lines the plan includes, the Pricing card's own
 *     (`frontend/src/lib/sitePricing.js`, held equal by the test).
 */
import type { PlanFamily } from './aiCredits';

export type PlanColour = 'violet' | 'sky' | 'amber' | 'emerald' | 'muted';
export type CatalogueFamily = Exclude<PlanFamily, 'market_intelligence'> | 'lp' | 'staff';

export type CatalogueEntry = {
  key: string;
  family: CatalogueFamily;
  name: string;
  tagline: string;
  colour: PlanColour;
  licence_key: string | null;
  matches: Record<string, string> | null;
  sellable: boolean;
  sellable_reason: string | null;
  storage: { bytes: number | null; reason: string | null };
  best_suited_for: string | null;
  best_suited_for_reason: string | null;
  included: readonly string[];
};

/** #2449 decides storage per plan and "Best suited for". Until it does, each reads its reason. */
export const STORAGE_NOT_DECIDED = 'Storage per plan is not decided yet (#2449).';
export const BEST_SUITED_NOT_DECIDED = '"Best suited for" is not decided yet (#2449).';

export const NOT_SOLD = {
  free: 'A free plan: nothing to buy.',
  plus: 'Investor Plus is not sold yet (D786).',
  custom: 'Priced by our sales team: Contact Sales.',
  lp: 'Free with an investment in an Axal VC fund.',
  staff: 'Staff accounts hold no plan.',
  other: 'Choose a profile first.',
} as const;

/** The profile colour on the plan pill, by family (D1048 §3). */
export const FAMILY_COLOUR: Record<CatalogueFamily, PlanColour> = {
  founder: 'violet', investor: 'sky', advisor: 'amber', partner: 'emerald', other: 'muted', lp: 'sky', staff: 'muted',
};

const TOP_UP = 'AI runs from AI tokens you top up';

type Spec = Omit<CatalogueEntry, 'colour' | 'storage' | 'best_suited_for' | 'best_suited_for_reason' | 'sellable_reason'> & { sellable_reason?: string | null };

const SPECS: Spec[] = [
  {
    key: 'founder:free', family: 'founder', name: 'Free', tagline: 'Start validating one idea.', licence_key: 'founder:free', matches: null,
    sellable: false, sellable_reason: NOT_SOLD.free,
    included: ['1 active startup', 'Validate: 5 customer interviews and 3 OKRs', 'Apply to the Spin-Out Lab', 'Public profile and referral link', 'Accept up to 3 introductions a month', TOP_UP],
  },
  {
    key: 'founder:growth', family: 'founder', name: 'Validate + Build', tagline: 'Prove the idea, then build the company.', licence_key: 'founder:growth', matches: { tier: 'growth' },
    sellable: true,
    included: ['Unlimited startups', 'Unlimited interviews and OKRs', 'Venture-readiness scoring', 'Company data for market research', 'Your full archetype card', 'Accept up to 10 introductions a month'],
  },
  {
    key: 'founder:studio', family: 'founder', name: 'Raise + Grow', tagline: 'Raise the money, then grow the company.', licence_key: 'founder:studio', matches: { tier: 'studio' },
    sellable: true,
    included: ['Pitch decks: every template, share links, your branding', 'Cap table scenarios and the dilution simulator', 'Capital, funds and the data room', 'Legal, compliance and the 83(b)', 'Advisor booking and partner office hours', 'Accept up to 25 introductions a month'],
  },
  {
    key: 'investor:free', family: 'investor', name: 'Investor Basic', tagline: 'Browse the network.', licence_key: 'investor:free', matches: null,
    sellable: false, sellable_reason: NOT_SOLD.free,
    included: ['Public deal index', 'Watchlists', 'Read-only market pulses', TOP_UP],
  },
  {
    // D786: on the Pricing page, and not sold. `planOf` maps no product to it.
    key: 'investor:plus', family: 'investor', name: 'Investor Plus', tagline: 'For angel investors, independent investors and investment professionals.', licence_key: 'investor:plus', matches: null,
    sellable: false, sellable_reason: NOT_SOLD.plus,
    included: ['Investment research workspace', 'Watchlists and opportunity tracking', 'AI-assisted investment research', 'Personal investment notes', 'Deal comparisons', 'Standard research usage limits'],
  },
  {
    key: 'investor:professional', family: 'investor', name: 'Investor Pro', tagline: 'For professional angels, investment analysts and smaller firms.', licence_key: 'investor:professional', matches: { investor_tier: 'professional' },
    sellable: true,
    included: ['Advanced investment research and screening', 'Portfolio tracking and analytics', 'Investment memo generation', 'Data exports and integrations', 'Higher AI research usage limits', 'More advanced investment workflows'],
  },
  {
    key: 'investor:institutional', family: 'investor', name: 'Institutional', tagline: 'For institutional investors, family offices and investment teams.', licence_key: 'investor:institutional', matches: { investor_tier: 'institutional' },
    sellable: false, sellable_reason: NOT_SOLD.custom,
    included: ['Shared research workspaces', 'Team access controls and permissions', 'Advanced reporting and analytics', 'Custom integrations and workflows', 'Organization-wide administration', 'Negotiated usage limits and support'],
  },
  {
    key: 'advisor:free', family: 'advisor', name: 'Advisor Basic', tagline: 'Publish a profile.', licence_key: null, matches: null,
    sellable: false, sellable_reason: NOT_SOLD.free,
    included: ['Public advisor profile', 'Listed in the advisor directory', 'Office hours and session types', 'Booking links', TOP_UP],
  },
  {
    key: 'advisor:pro', family: 'advisor', name: 'Advisor Pro', tagline: 'More reach, better matches.', licence_key: 'advisor', matches: { plan_group: 'advisor' },
    sellable: true,
    included: ['More reach in matching', 'Paid sessions through your booking links', 'Deliverables and the client access log', 'Earnings and payouts'],
  },
  {
    key: 'partner:free', family: 'partner', name: 'Partner Basic', tagline: 'Get listed.', licence_key: null, matches: null,
    sellable: false, sellable_reason: NOT_SOLD.free,
    included: ['Provider profile and directory listing', 'Live founder requests', 'Verification badges', TOP_UP],
  },
  {
    key: 'partner:pro', family: 'partner', name: 'Operating Partner Pro', tagline: 'Inbound demand on tap.', licence_key: 'partner', matches: { plan_group: 'partner' },
    sellable: true,
    included: ['Proposals, pipeline and delivery', 'Partner insights: views, leads and conversion', 'Client status reports', 'Payouts through Stripe Connect'],
  },
  {
    key: 'other', family: 'other', name: 'No plan yet', tagline: 'Choose a profile to see its plans.', licence_key: 'other', matches: null,
    sellable: false, sellable_reason: NOT_SOLD.other,
    included: [TOP_UP],
  },
  {
    key: 'lp_access', family: 'lp', name: 'LP Access', tagline: 'Not a subscription. Your fund investments, documents and updates, free with your investment.', licence_key: null, matches: null,
    sellable: false, sellable_reason: NOT_SOLD.lp,
    included: ['Access to relevant fund documents and reports', 'Fund updates and announcements', 'Available capital account and investment information', 'Secure document access', 'Fund-related communications', 'Information for your authorized fund investments'],
  },
  {
    key: 'admin', family: 'staff', name: 'Staff account', tagline: 'Staff account · no plan needed.', licence_key: null, matches: null,
    sellable: false, sellable_reason: NOT_SOLD.staff,
    included: [],
  },
];

export const PLAN_CATALOGUE: readonly CatalogueEntry[] = Object.freeze(SPECS.map((s) => Object.freeze({
  ...s,
  colour: FAMILY_COLOUR[s.family],
  sellable_reason: s.sellable ? null : (s.sellable_reason ?? null),
  storage: { bytes: null, reason: STORAGE_NOT_DECIDED },
  best_suited_for: null,
  best_suited_for_reason: BEST_SUITED_NOT_DECIDED,
  included: Object.freeze([...s.included]),
})));

export const PLAN_KEYS = PLAN_CATALOGUE.map((p) => p.key);

/** One entry by its key, or null. */
export const planByKey = (key: string) => PLAN_CATALOGUE.find((p) => p.key === key) || null;

/** The entry a plans-read row belongs to, by the `licence_key` `planOf` gave it, or null. */
export const planByLicenceKey = (licenceKey: string | null | undefined) =>
  (licenceKey ? PLAN_CATALOGUE.find((p) => p.licence_key === licenceKey) : null) || null;

/**
 * The fields a plans-read row carries beside its prices. The plan's name goes
 * out as `label`: the public read carries no `name` key, so nothing in it can
 * be read as a person's (D755's rule, `ai_credits_reads_d755.test.ts`).
 */
export function catalogueFields(entry: CatalogueEntry | null) {
  if (!entry) return null;
  const { key, name, tagline, colour, sellable, sellable_reason, storage, best_suited_for, best_suited_for_reason, included } = entry;
  return { key, label: name, tagline, colour, sellable, sellable_reason, storage, best_suited_for, best_suited_for_reason, included };
}

/** The whole catalogue as the public read sends it: every entry, the plans with no product among them. */
export function publicCatalogue() {
  return PLAN_CATALOGUE.map((e) => ({ ...catalogueFields(e)!, family: e.family, licence_key: e.licence_key, matches: e.matches }));
}
