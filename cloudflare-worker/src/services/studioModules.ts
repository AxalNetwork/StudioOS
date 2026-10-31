/**
 * D1421 (#3699): the one registry of Studio blocks, its default layouts, and
 * the plan locks derived from the existing paywalls.
 *
 * Each Studio home (`FounderStudioBody.jsx`, `InvestorStudioHome.jsx`,
 * `AdvisorStudioHome.jsx`, `PartnerStudioHome.jsx`) still draws its blocks in
 * JSX until #3698's canvas lands. This file names those blocks once, so a
 * member's saved layout (`studio_layouts`, migration 687) can be checked
 * against them.
 *
 * - **No tier is written here.** A module lists the `/api/*` paths it reads;
 *   `lockOf` asks the same prefix arrays `index.ts` mounts its paywalls on
 *   (`middleware/paywallPrefixes.ts`) and the same gate functions
 *   (`userMeetsTier`, `userMeetsInvestorTier`). No block on /studio is
 *   plan-locked on main today; the first module that reads a paywalled prefix
 *   is locked without any change here.
 * - **Fixed blocks** (chat, the founder strip, the profile card) are not
 *   modules: they are always drawn and never placed.
 * - **Removed blocks** ("Do these next", "Activity across the platform", #3698)
 *   are not offered, so a member cannot add them back.
 * - **Not offered yet:** the founder's "Holding progress" and "What this adds
 *   up to" have no store (D564 `NO_STORE`), so they stay out until one exists
 *   (owner question B, S1's pick).
 */
import type { User } from '../types';
import { userMeetsTier, PLAN_NAME, PLAN_KEY as FOUNDER_PLAN_KEY } from '../middleware/requireTier';
import { userMeetsInvestorTier, INVESTOR_PRO_EXEMPT, PLAN_KEY as INVESTOR_PLAN_KEY } from '../middleware/requireInvestorTier';
import { planByKey } from './planCatalogue';
import { STUDIO_PREFIXES, INVESTOR_PRO_PREFIXES, underPrefix } from '../middleware/paywallPrefixes';

export const STUDIO_PROFILES = ['founder', 'investor', 'advisor', 'partner'] as const;
export type StudioProfile = typeof STUDIO_PROFILES[number];
export const STUDIO_SIZES = ['1/3', '1/2', 'full'] as const;
export type StudioSize = typeof STUDIO_SIZES[number];
/** At most this many modules in one layout. */
export const STUDIO_LAYOUT_MAX = 12;

export interface StudioModule {
  key: string;
  profile: StudioProfile;
  title: string;
  group: string;
  /** The `/api/*` paths the block reads. Its plan lock is derived from these. */
  reads: readonly string[];
  default_size: StudioSize;
  /** Only meaningful inside a Spin-Out Lab cohort. */
  cohort_only?: true;
}

/** Today's blocks, in each home's order, minus the fixed and removed ones. */
export const STUDIO_MODULES: readonly StudioModule[] = [
  // Founder — FounderStudioBody.jsx
  { key: 'company_progress', profile: 'founder', title: 'Company progress', group: 'Build', reads: ['/api/spinout-lab/state'], default_size: 'full' },
  { key: 'eadwyn_questions', profile: 'founder', title: 'Eadwyn’s questions', group: 'Validate', reads: ['/api/advisor/progress', '/api/advisor/queue'], default_size: '1/2' },
  { key: 'module_map', profile: 'founder', title: 'Module map', group: 'Build', reads: ['/api/spinout-lab/state'], default_size: 'full', cohort_only: true },
  // Investor — InvestorStudioHome.jsx
  { key: 'usage_quota', profile: 'investor', title: 'Usage & quota', group: 'Account', reads: ['/api/dashboard'], default_size: '1/3' },
  { key: 'deal_lifecycle', profile: 'investor', title: 'Deal lifecycle', group: 'Deals', reads: ['/api/dashboard/investor-lifecycle'], default_size: '1/2' },
  { key: 'scored_opportunities', profile: 'investor', title: 'AI-scored opportunities', group: 'Deals', reads: ['/api/dashboard'], default_size: '1/2' },
  { key: 'quick_stats', profile: 'investor', title: 'Quick stats', group: 'Deals', reads: ['/api/dashboard', '/api/dashboard/investor-lifecycle'], default_size: '1/3' },
  { key: 'portfolio_glance', profile: 'investor', title: 'Portfolio glance', group: 'Portfolio', reads: ['/api/positions/analytics'], default_size: '1/3' },
  { key: 'upcoming_events', profile: 'investor', title: 'Upcoming events', group: 'Calendar', reads: ['/api/calendar/events'], default_size: '1/3' },
  // Advisor — AdvisorStudioHome.jsx
  { key: 'today', profile: 'advisor', title: 'Today', group: 'Calendar', reads: ['/api/advisors/me/bookings', '/api/calendar/events'], default_size: '1/2' },
  { key: 'storefront', profile: 'advisor', title: 'Storefront', group: 'Network', reads: ['/api/advisors/me'], default_size: '1/2' },
  { key: 'engagements', profile: 'advisor', title: 'Engagements', group: 'Network', reads: ['/api/advisors/me/bookings'], default_size: '1/2' },
  { key: 'consented_proof', profile: 'advisor', title: 'Consented proof', group: 'Network', reads: [], default_size: '1/2' },
  { key: 'earnings', profile: 'advisor', title: 'Earnings', group: 'Grow', reads: ['/api/network/payouts/me', '/api/network/commissions/me'], default_size: '1/2' },
  // Operating Partner (role `partner`) — PartnerHomeP2.jsx
  { key: 'firm_standing', profile: 'partner', title: 'Firm standing', group: 'Delivery', reads: ['/api/partner/delivery/board', '/api/partner/pipeline/retainers', '/api/partner/delivery/capacity'], default_size: 'full' },
  { key: 'firm_feed', profile: 'partner', title: 'What needs you', group: 'Delivery', reads: ['/api/partner/delivery/board', '/api/partner/pipeline/retainers', '/api/partner/delivery/capacity'], default_size: 'full' },
];

/** Always drawn, never placed. Exported so tests can assert they are never offered. */
export const STUDIO_FIXED = ['chat', 'strip', 'profile_card'] as const;
/** Removed from /studio by #3698. Never offered. */
export const STUDIO_REMOVED = ['founder_actions', 'founder_activity'] as const;

/** Owner question A, S1's pick: today's blocks in today's order, at their sizes. The canvas changes this one table. */
export const STUDIO_DEFAULTS: Record<StudioProfile, ReadonlyArray<{ key: string; size: StudioSize }>> = {
  founder: [
    { key: 'company_progress', size: 'full' },
    { key: 'eadwyn_questions', size: '1/2' },
    { key: 'module_map', size: 'full' },
  ],
  investor: [
    { key: 'usage_quota', size: '1/3' },
    { key: 'deal_lifecycle', size: '1/2' },
    { key: 'scored_opportunities', size: '1/2' },
    { key: 'quick_stats', size: '1/3' },
    { key: 'portfolio_glance', size: '1/3' },
    { key: 'upcoming_events', size: '1/3' },
  ],
  advisor: [
    { key: 'today', size: '1/2' },
    { key: 'storefront', size: '1/2' },
    { key: 'engagements', size: '1/2' },
    { key: 'consented_proof', size: '1/2' },
    { key: 'earnings', size: '1/2' },
  ],
  partner: [
    { key: 'firm_standing', size: 'full' },
    { key: 'firm_feed', size: 'full' },
  ],
};

export function catalogueOf(profile: StudioProfile): StudioModule[] {
  return STUDIO_MODULES.filter((m) => m.profile === profile);
}

export interface StudioPlan { tier: string; name: string; plan_key: string }

/** The first paywall any of the module's reads sits behind that this member's plan does not cover; null when none. */
export function lockOf(
  user: User,
  mod: Pick<StudioModule, 'reads'>,
  prefixes: { studio: readonly string[]; investorPro: readonly string[] } = { studio: STUDIO_PREFIXES, investorPro: INVESTOR_PRO_PREFIXES },
): StudioPlan | null {
  for (const path of mod.reads) {
    if (prefixes.studio.some((p) => underPrefix(path, p)) && !userMeetsTier(user, 'studio'))
      return { tier: 'studio', name: PLAN_NAME.studio, plan_key: FOUNDER_PLAN_KEY.studio };
    if (prefixes.investorPro.some((p) => underPrefix(path, p))
      && !INVESTOR_PRO_EXEMPT.some((e) => e.method === 'GET' && e.path.test(path))
      && !userMeetsInvestorTier(user, 'professional'))
      return { tier: 'professional', name: planByKey(INVESTOR_PLAN_KEY.professional)!.name, plan_key: INVESTOR_PLAN_KEY.professional };
  }
  return null;
}

export type ProfileAnswer = { profile: StudioProfile } | { refusal: { status: 400 | 403; code: string; message: string } };

/**
 * Whose Studio this is. A member's own role names it; a Spin-Out Lab member
 * with no other Studio role is a founder (Dashboard.jsx's Lab branch); an
 * admin previews one profile at a time and must name it (as
 * `modulePageAllowed` lets admins act as any profile).
 */
export function studioProfile(user: Pick<User, 'role' | 'spinout_lab_active'>, asked: string | undefined | null): ProfileAnswer {
  const role = String(user.role);
  if (role === 'admin') {
    if (!asked || !(STUDIO_PROFILES as readonly string[]).includes(asked))
      return { refusal: { status: 400, code: 'invalid_profile', message: 'Choose which Studio to arrange: founder, investor, advisor or partner.' } };
    return { profile: asked as StudioProfile };
  }
  const own: StudioProfile | null = (STUDIO_PROFILES as readonly string[]).includes(role) ? role as StudioProfile
    : user.spinout_lab_active === 1 ? 'founder' : null;
  if (!own) return { refusal: { status: 403, code: 'no_studio_profile', message: 'Your account has no Studio to arrange yet.' } };
  if (asked && asked !== own) return { refusal: { status: 403, code: 'profile_not_allowed', message: 'You can only arrange your own Studio.' } };
  return { profile: own };
}
