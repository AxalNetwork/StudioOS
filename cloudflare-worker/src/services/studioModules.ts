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
 *
 * D1418 (#3862): the canvas's full catalogue. Each module has a group from
 * `STUDIO_GROUPS`, a one-line purpose and an Open link; the founder's 27 cycle
 * modules are derived from the four cycles' own Worker lists, never retyped;
 * `module_map` is `lab_tools` ("Module map" names only the lightbox now) and
 * `firm_standing` is `firm_tiles`.
 */
import type { User } from '../types';
import { userMeetsTier, PLAN_NAME, PLAN_KEY as FOUNDER_PLAN_KEY } from '../middleware/requireTier';
import { userMeetsInvestorTier, INVESTOR_PRO_EXEMPT, PLAN_KEY as INVESTOR_PLAN_KEY } from '../middleware/requireInvestorTier';
import { planByKey } from './planCatalogue';
import { STUDIO_PREFIXES, INVESTOR_PRO_PREFIXES, underPrefix } from '../middleware/paywallPrefixes';
import { MODULES as VALIDATE_MODULES } from './cycleValidate';
import { MODULES as RAISE_MODULES } from './raiseCycle';
import { GROW_MODULES } from './growCycle';
import { BUILD_MODULES } from '../routes/cycle_build';

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
  /** One of `STUDIO_GROUPS[profile]`'s keys. */
  group: string;
  /** D1418: one line, in the canvas's words, for the module map lightbox. */
  purpose: string;
  /** D1418: the tile's Open link, or null when the module acts on the page itself. */
  href: string | null;
  /** The `/api/*` paths the block reads. Its plan lock is derived from these. */
  reads: readonly string[];
  default_size: StudioSize;
  /** Only meaningful inside a Spin-Out Lab cohort. */
  cohort_only?: true;
  /** D1418: offered only to a member whose own role is founder (or an admin previewing one), never to a Spin-Out Lab member. */
  founder_role_only?: true;
}

/** D1418: each profile's groups, in the order the module map draws them. */
export const STUDIO_GROUPS: Record<StudioProfile, ReadonlyArray<{ key: string; label: string }>> = {
  founder: [
    { key: 'studio', label: 'Studio' }, { key: 'validate', label: 'Validate' }, { key: 'build', label: 'Build' },
    { key: 'raise', label: 'Raise' }, { key: 'grow', label: 'Grow' },
  ],
  investor: [{ key: 'investor', label: 'Investor' }],
  advisor: [{ key: 'advisor', label: 'Advisor' }],
  partner: [{ key: 'partner', label: 'Operating partner' }],
};

/**
 * D1418: the canvas's one-line purpose for each cycle module, keyed
 * `<cycle>/<slug>` as the Worker's own lists spell the slugs.
 */
export const CYCLE_PURPOSE: Readonly<Record<string, string>> = {
  'validate/problem-discovery': 'Pain themes, ranked by how often you hear them.',
  'validate/customer-research': 'Interviews held and what they found.',
  'validate/ideal-customer-profile': 'Who you sell to, and how sure you are.',
  'validate/market-intelligence': 'Market size and competitors, with sources.',
  'validate/demand-signals': 'Letters of intent, pre-sales and would-pay.',
  'validate/experiments': 'Claims, and how many are supported.',
  'validate/verdict': 'Proceed, pivot or stop, with its evidence.',
  'build/solution-design': 'Features and the pains they answer.',
  'build/prototype-mvp': 'Must-haves done against the plan.',
  'build/product-roadmap': 'Now, Next and Later at a glance.',
  'build/founding-team': 'Who is on the team, and what is covered.',
  'build/company-creation': 'Formation steps, and what is left.',
  'build/operating-systems': 'The tools your company runs on.',
  'raise/fundraising-readiness': 'Product-market fit and the raise kit.',
  'raise/investor-narrative': 'Your story, section by section.',
  'raise/pitch-deck': 'The current version and who viewed it.',
  'raise/data-room': 'Files shared, and who opened the room.',
  'raise/cap-table': 'Ownership by group.',
  'raise/use-of-funds': 'What this raise pays for.',
  'raise/capital-relationships': 'Investors by stage.',
  'grow/product-improvement': 'What shipped and what moved.',
  'grow/distribution': 'Channels, and what they brought.',
  'grow/revenue-and-traction': 'MRR and paying customers, from your tools.',
  'grow/team-expansion': 'Roles open and filled.',
  'grow/partner-network': 'Partners signed and in talks.',
  'grow/market-expansion': 'Markets served and entering.',
  'grow/durable-company-building': 'The checklist for a lasting company.',
};

/** The four cycles' module lists, as each cycle's Worker read lists them. Never retyped here. */
const CYCLE_LISTS: ReadonlyArray<{ cycle: 'validate' | 'build' | 'raise' | 'grow'; modules: ReadonlyArray<{ slug: string; name: string }>; founderOnly?: true }> = [
  { cycle: 'validate', modules: VALIDATE_MODULES },
  { cycle: 'build', modules: BUILD_MODULES.map(([slug, name]) => ({ slug, name })) },
  { cycle: 'raise', modules: RAISE_MODULES },
  // `/grow/:slug` admits admin and founder only (App.jsx), never a Spin-Out Lab member.
  { cycle: 'grow', modules: GROW_MODULES, founderOnly: true },
];

/** `<cycle>_<slug with "-" as "_">`, e.g. `build_prototype_mvp`. */
export const cycleModuleKey = (cycle: string, slug: string) => `${cycle}_${slug.replace(/-/g, '_')}`;

/** D1418: the 27 cycle modules, one per row of the four lists, in their order. */
export const CYCLE_MODULES: readonly StudioModule[] = CYCLE_LISTS.flatMap(({ cycle, modules, founderOnly }) => modules.map((m): StudioModule => ({
  key: cycleModuleKey(cycle, m.slug), profile: 'founder', title: m.name, group: cycle,
  purpose: CYCLE_PURPOSE[`${cycle}/${m.slug}`] ?? '', href: `/${cycle}/${m.slug}`,
  reads: [`/api/cycles/${cycle}/overview`], default_size: '1/3',
  ...(founderOnly ? { founder_role_only: true as const } : {}),
})));

/** Every placeable block, in each profile's order: by group, then in each list's own order. */
export const STUDIO_MODULES: readonly StudioModule[] = [
  // Founder — the Studio group (FounderStudioBody.jsx), then the cycle modules.
  { key: 'company_progress', profile: 'founder', title: 'Company progress', group: 'studio', purpose: 'Stages, what shipped and what is still open.', href: null, reads: ['/api/spinout-lab/state'], default_size: 'full' },
  // "Answer now" on the tile goes to the chat on the page, so it has no Open link.
  { key: 'eadwyn_questions', profile: 'founder', title: 'Eadwyn’s questions', group: 'studio', purpose: 'Questions waiting on you, by impact.', href: null, reads: ['/api/advisor/progress', '/api/advisor/queue'], default_size: '1/2' },
  { key: 'lab_tools', profile: 'founder', title: 'Lab tools', group: 'studio', purpose: 'The Lab features open to you this week.', href: '/spinout-lab', reads: ['/api/spinout-lab/state'], default_size: '1/2', cohort_only: true },
  ...CYCLE_MODULES,
  // Investor — InvestorStudioHome.jsx
  { key: 'usage_quota', profile: 'investor', title: 'Usage & quota', group: 'investor', purpose: 'Your plan’s limits, and what you used.', href: null, reads: ['/api/dashboard'], default_size: '1/2' },
  { key: 'deal_lifecycle', profile: 'investor', title: 'Deal lifecycle', group: 'investor', purpose: 'Deals by stage. Read-only here.', href: null, reads: ['/api/dashboard/investor-lifecycle'], default_size: '1/2' },
  // The canvas draws this locked to Investor Pro; `/api/dashboard` is not behind a paywall, so it is not locked (D1418).
  { key: 'scored_opportunities', profile: 'investor', title: 'AI-scored opportunities', group: 'investor', purpose: 'Ventures that match your thesis, scored.', href: null, reads: ['/api/dashboard'], default_size: '1/2' },
  { key: 'quick_stats', profile: 'investor', title: 'Quick stats', group: 'investor', purpose: 'Your flow, watchlist and commitments.', href: null, reads: ['/api/dashboard', '/api/dashboard/investor-lifecycle'], default_size: '1/2' },
  { key: 'portfolio_glance', profile: 'investor', title: 'Portfolio glance', group: 'investor', purpose: 'Companies, invested and returns.', href: null, reads: ['/api/positions/analytics'], default_size: '1/2' },
  { key: 'upcoming_events', profile: 'investor', title: 'Upcoming events', group: 'investor', purpose: 'Events you are going to.', href: null, reads: ['/api/calendar/events'], default_size: '1/2' },
  // Advisor — AdvisorStudioHome.jsx
  { key: 'today', profile: 'advisor', title: 'Today', group: 'advisor', purpose: 'Your sessions today, and your open slots.', href: null, reads: ['/api/advisors/me/bookings', '/api/calendar/events'], default_size: '1/2' },
  { key: 'storefront', profile: 'advisor', title: 'Storefront', group: 'advisor', purpose: 'How members find you, and whether you are published.', href: null, reads: ['/api/advisors/me'], default_size: '1/2' },
  { key: 'engagements', profile: 'advisor', title: 'Engagements', group: 'advisor', purpose: 'Clients, sessions and status.', href: null, reads: ['/api/advisors/me/bookings'], default_size: '1/2' },
  { key: 'consented_proof', profile: 'advisor', title: 'Consented proof', group: 'advisor', purpose: 'Proof your clients agreed to share.', href: null, reads: [], default_size: '1/2' },
  { key: 'earnings', profile: 'advisor', title: 'Earnings', group: 'advisor', purpose: 'What you can be paid, and what you were paid.', href: null, reads: ['/api/network/payouts/me', '/api/network/commissions/me'], default_size: 'full' },
  // Operating Partner (role `partner`) — PartnerHomeP2.jsx
  { key: 'firm_tiles', profile: 'partner', title: 'Firm tiles', group: 'partner', purpose: 'Active, due, at risk, recurring and over capacity.', href: null, reads: ['/api/partner/delivery/board', '/api/partner/pipeline/retainers', '/api/partner/delivery/capacity'], default_size: 'full' },
  // Owner question G, S1's pick (a): the shipped AI brief stays, between the tiles and the feed.
  { key: 'operating_brief', profile: 'partner', title: 'Operating brief', group: 'partner', purpose: 'Today’s brief: what falls due, what is at risk and why.', href: null, reads: ['/api/research/drafts'], default_size: 'full' },
  { key: 'firm_feed', profile: 'partner', title: 'Firm feed', group: 'partner', purpose: 'What needs you, by client.', href: null, reads: ['/api/partner/delivery/board', '/api/partner/pipeline/retainers', '/api/partner/delivery/capacity'], default_size: 'full' },
];

/** Always drawn, never placed. Exported so tests can assert they are never offered. */
export const STUDIO_FIXED = ['chat', 'strip', 'profile_card'] as const;
/** Removed from /studio by #3698. Never offered. */
export const STUDIO_REMOVED = ['founder_actions', 'founder_activity'] as const;

/**
 * D1418: the canvas's defaults (owner question B, S1's pick (b): no
 * "Holding progress" or "What this adds up to"; question G, S1's pick (a):
 * the operating brief stays). Each default's size is its module's
 * `default_size`.
 */
export const STUDIO_DEFAULTS: Record<StudioProfile, ReadonlyArray<{ key: string; size: StudioSize }>> = {
  founder: [
    { key: 'company_progress', size: 'full' },
    { key: 'eadwyn_questions', size: '1/2' },
    { key: 'lab_tools', size: '1/2' },
  ],
  investor: [
    { key: 'usage_quota', size: '1/2' },
    { key: 'deal_lifecycle', size: '1/2' },
    { key: 'scored_opportunities', size: '1/2' },
    { key: 'quick_stats', size: '1/2' },
    { key: 'portfolio_glance', size: '1/2' },
    { key: 'upcoming_events', size: '1/2' },
  ],
  advisor: [
    { key: 'today', size: '1/2' },
    { key: 'storefront', size: '1/2' },
    { key: 'engagements', size: '1/2' },
    { key: 'consented_proof', size: '1/2' },
    { key: 'earnings', size: 'full' },
  ],
  partner: [
    { key: 'firm_tiles', size: 'full' },
    { key: 'operating_brief', size: 'full' },
    { key: 'firm_feed', size: 'full' },
  ],
};

/**
 * This profile's catalogue for this member. A Grow module is offered only to
 * a member whose own role is founder, or an admin previewing the founder
 * Studio: a Spin-Out Lab member's founder Studio leaves Grow out, since
 * `/grow/:slug` does not admit them.
 */
export function catalogueOf(profile: StudioProfile, user: Pick<User, 'role'>): StudioModule[] {
  const role = String(user.role);
  const founderRole = role === 'founder' || role === 'admin';
  return STUDIO_MODULES.filter((m) => m.profile === profile && (!m.founder_role_only || founderRole));
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
