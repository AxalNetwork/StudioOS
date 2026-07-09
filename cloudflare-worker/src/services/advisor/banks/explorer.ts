/**
 * Explorer role question banks — Problem/Challenge Discovery.
 *
 * The 'exploring' holding role covers users who haven't been confirmed into
 * a real persona yet (see services/exploringSchema.ts). Their very first
 * question is the shared `role_detect.primary` 4-option picker ("I am
 * building a startup" / "I invest in startups" / "I advisor founders" /
 * "I partner with the studio" — see ROLE_DETECTOR in ../questionBank.ts).
 * That answer selects a TRACK, and each track gets its own dedicated
 * needs-discovery bank below — the questions are deliberately NOT shared
 * across tracks, since a founder's blockers (PMF, hiring, cap table) are a
 * different shape of problem than an investor's (deal flow, LP capital), an
 * advisor's (positioning, compensation model), or a partner's (engagement
 * model, referral pipeline).
 *
 * Every track bank follows the same 4-section shape so the write-router can
 * share one leaf→column map (see writeRouter.ts EXPLORER_SHARED_LEAF_MAP):
 *   CONTEXT    — current status, team structure, sector, geography
 *   CHALLENGES — top-3 multi-select (track-specific options) + depth on #1
 *   TIMELINE   — urgency, hard deadline, runway
 *   <track 4th section> — the track's capital/compensation/commercials shape
 *
 * Answers persist in explorer_needs, keyed ONLY by user_id (see
 * writeRouter.ts's explorer branch), so they survive an admin re-tagging the
 * user from 'exploring' to founder/investor/advisor/partner.
 */
import type { Question } from '../questionBank';

const SECTORS = ['AI', 'B2B SaaS', 'Climate', 'Fintech', 'Healthcare', 'Consumer', 'Deep Tech', 'Other'];
const GEOGRAPHIES = ['North America', 'Europe', 'Asia Pacific', 'Latin America', 'Multi-region'];
const TIMELINE_OPTIONS = ['Within 30 days', 'Within 90 days', 'Within 180 days', 'No immediate timeline'];

// ---------------------------------------------------------------------------
// Founder track — explorer.founder.*
// ---------------------------------------------------------------------------
const FOUNDER_STATUSES = [
  'Idea stage', 'Building prototype', 'Pre-seed', 'Seed', 'Series A', 'Series B+',
  'Bootstrapped & profitable', 'Post-acquisition', 'Exploring multiple paths',
];
const FOUNDER_CHALLENGES = [
  'Product & customer discovery (PMF)',
  'Fundraising & capital strategy',
  'Hiring & team building',
  'Go-to-market & customer acquisition',
  'Operations & scaling',
  'Cap table & equity management',
  'Co-founder/co-leader search',
  'Technology & product decisions',
  'Partnership & distribution',
  'Personal financial runway',
  'Board/advisor guidance',
  'Legal/compliance setup',
];

export const EXPLORER_FOUNDER_BANK: Question[] = [
  { id: 'explorer.founder.context.status', persona: 'explorer', section: 'CONTEXT',
    prompt: 'What\'s your current status?', hint: 'Where are you in your venture journey?',
    input_kind: 'select', options: FOUNDER_STATUSES, importance: 'critical',
    page_target: '/explorer/profile', doc_anchor: 'explorer/founder/current-status',
    validate: 'select', followups: ['explorer.founder.context.team'] },
  { id: 'explorer.founder.context.team', persona: 'explorer', section: 'CONTEXT',
    prompt: 'Are you building solo or with co-founder(s)?',
    input_kind: 'select', options: ['Solo founder', 'With co-founder(s)', 'Exploring both paths'],
    importance: 'high', page_target: '/explorer/profile', doc_anchor: 'explorer/founder/team-structure',
    validate: 'select', followups: ['explorer.founder.context.sector'] },
  { id: 'explorer.founder.context.sector', persona: 'explorer', section: 'CONTEXT',
    prompt: 'What sector or industry are you focused on?',
    input_kind: 'select', options: SECTORS, importance: 'high',
    page_target: '/explorer/profile', doc_anchor: 'explorer/founder/sector',
    validate: 'select', skip_allowed: true, mi_section: 'sector_heat' },
  { id: 'explorer.founder.context.geography', persona: 'explorer', section: 'CONTEXT',
    prompt: 'What\'s your geographic focus or market?',
    input_kind: 'select', options: GEOGRAPHIES, importance: 'normal',
    page_target: '/explorer/profile', doc_anchor: 'explorer/founder/geography',
    validate: 'select', skip_allowed: true, followups: ['explorer.founder.challenges.top3'] },

  { id: 'explorer.founder.challenges.top3', persona: 'explorer', section: 'CHALLENGES',
    prompt: 'What are your top 3 challenges right now? (Select up to 3)',
    hint: 'Choose the ones most pressing for you', input_kind: 'multi', options: FOUNDER_CHALLENGES,
    importance: 'critical', page_target: '/explorer/profile', doc_anchor: 'explorer/founder/challenges',
    validate: 'multi', followups: ['explorer.founder.challenges.top1_depth'] },
  { id: 'explorer.founder.challenges.top1_depth', persona: 'explorer', section: 'CHALLENGES',
    prompt: 'Tell us more about your top priority challenge — what specifically are you dealing with?',
    hint: 'E.g., "We\'re pre-seed and need to validate our MVP" or "Trying to close our first 3 customers by end of Q3"',
    input_kind: 'long', importance: 'high', page_target: '/explorer/profile',
    doc_anchor: 'explorer/founder/challenge-depth', validate: 'long', skip_allowed: true,
    followups: ['explorer.founder.timeline.urgency'] },

  { id: 'explorer.founder.timeline.urgency', persona: 'explorer', section: 'TIMELINE',
    prompt: 'When do you need help with your top challenge?',
    input_kind: 'select', options: TIMELINE_OPTIONS, importance: 'critical',
    page_target: '/explorer/profile', doc_anchor: 'explorer/founder/timeline-urgency',
    validate: 'select', mi_section: 'capital_velocity', followups: ['explorer.founder.timeline.deadline'] },
  { id: 'explorer.founder.timeline.deadline', persona: 'explorer', section: 'TIMELINE',
    prompt: 'Are there any hard deadlines or milestones? (e.g., "demo day in 8 weeks", "need to close Series A by Q4")',
    input_kind: 'short', importance: 'normal', page_target: '/explorer/profile',
    doc_anchor: 'explorer/founder/hard-deadlines', validate: 'short', skip_allowed: true,
    followups: ['explorer.founder.timeline.runway'] },
  { id: 'explorer.founder.timeline.runway', persona: 'explorer', section: 'TIMELINE',
    prompt: 'How many months of personal runway do you have?',
    hint: 'Months of savings/income to sustain yourself', input_kind: 'number', importance: 'normal',
    page_target: '/explorer/profile', doc_anchor: 'explorer/founder/personal-runway',
    validate: 'number', skip_allowed: true },

  { id: 'explorer.founder.funding.appetite', persona: 'explorer', section: 'FUNDING',
    prompt: 'What\'s your funding philosophy?',
    input_kind: 'select',
    options: ['Actively raising now', 'Open to it', 'Bootstrapping by design', 'Post-funded, exploring new venture'],
    importance: 'critical', page_target: '/explorer/profile', doc_anchor: 'explorer/founder/funding-philosophy',
    validate: 'select', followups: ['explorer.founder.funding.currently_raising'] },
  { id: 'explorer.founder.funding.currently_raising', persona: 'explorer', section: 'FUNDING',
    prompt: 'Are you currently in a fundraising process?',
    input_kind: 'select', options: ['Yes', 'No', 'Just starting'], importance: 'high',
    page_target: '/explorer/profile', doc_anchor: 'explorer/founder/fundraising-status',
    validate: 'select', followups: ['explorer.founder.funding.lead_investor'] },
  { id: 'explorer.founder.funding.lead_investor', persona: 'explorer', section: 'FUNDING',
    prompt: 'Do you have a lead investor or warm relationship with potential backers?',
    input_kind: 'select', options: ['Yes', 'No', 'Maybe (warm leads)'], importance: 'normal',
    page_target: '/explorer/profile', doc_anchor: 'explorer/founder/lead-investor',
    validate: 'select', skip_allowed: true },
];

// ---------------------------------------------------------------------------
// Investor track — explorer.investor.*
// ---------------------------------------------------------------------------
const INVESTOR_STATUSES = [
  'Just starting to invest', 'Angel investing casually', 'Building a fund', 'Between funds',
  'Scout / syndicate lead', 'Family office deploying capital', 'Exploring multiple paths',
];
const INVESTOR_CHALLENGES = [
  'Deal sourcing & pipeline building',
  'Due diligence process & tooling',
  'Portfolio construction & thesis definition',
  'LP relations & fund formation',
  'Co-investor / syndicate network',
  'Follow-on & reserves strategy',
  'Sector/stage focus definition',
  'Board seats & portfolio support',
  'Exit strategy & liquidity planning',
  'Ticket size & check-writing process',
  'Legal / fund structure setup',
  'Reporting & investor relations tooling',
];

export const EXPLORER_INVESTOR_BANK: Question[] = [
  { id: 'explorer.investor.context.status', persona: 'explorer', section: 'CONTEXT',
    prompt: 'What\'s your current status?', hint: 'Where are you in your investing journey?',
    input_kind: 'select', options: INVESTOR_STATUSES, importance: 'critical',
    page_target: '/explorer/profile', doc_anchor: 'explorer/investor/current-status',
    validate: 'select', followups: ['explorer.investor.context.team'] },
  { id: 'explorer.investor.context.team', persona: 'explorer', section: 'CONTEXT',
    prompt: 'Are you investing solo or as part of a team?',
    input_kind: 'select',
    options: ['Investing solo', 'With investing partner(s)', 'Part of a fund team', 'Exploring both paths'],
    importance: 'high', page_target: '/explorer/profile', doc_anchor: 'explorer/investor/team-structure',
    validate: 'select', followups: ['explorer.investor.context.sector'] },
  { id: 'explorer.investor.context.sector', persona: 'explorer', section: 'CONTEXT',
    prompt: 'What sector(s) does your investment thesis focus on?',
    input_kind: 'select', options: SECTORS, importance: 'high',
    page_target: '/explorer/profile', doc_anchor: 'explorer/investor/sector',
    validate: 'select', skip_allowed: true, mi_section: 'sector_heat' },
  { id: 'explorer.investor.context.geography', persona: 'explorer', section: 'CONTEXT',
    prompt: 'What\'s your geographic focus for investing?',
    input_kind: 'select', options: GEOGRAPHIES, importance: 'normal',
    page_target: '/explorer/profile', doc_anchor: 'explorer/investor/geography',
    validate: 'select', skip_allowed: true, followups: ['explorer.investor.challenges.top3'] },

  { id: 'explorer.investor.challenges.top3', persona: 'explorer', section: 'CHALLENGES',
    prompt: 'What are your top 3 challenges right now? (Select up to 3)',
    hint: 'Choose the ones most pressing for you', input_kind: 'multi', options: INVESTOR_CHALLENGES,
    importance: 'critical', page_target: '/explorer/profile', doc_anchor: 'explorer/investor/challenges',
    validate: 'multi', followups: ['explorer.investor.challenges.top1_depth'] },
  { id: 'explorer.investor.challenges.top1_depth', persona: 'explorer', section: 'CHALLENGES',
    prompt: 'Tell us more about your top priority challenge — what specifically are you dealing with?',
    hint: 'E.g., "Sourcing enough qualified deal flow in climate tech" or "Setting up fund admin before our first close"',
    input_kind: 'long', importance: 'high', page_target: '/explorer/profile',
    doc_anchor: 'explorer/investor/challenge-depth', validate: 'long', skip_allowed: true,
    followups: ['explorer.investor.timeline.urgency'] },

  { id: 'explorer.investor.timeline.urgency', persona: 'explorer', section: 'TIMELINE',
    prompt: 'When do you need help with your top challenge?',
    input_kind: 'select', options: TIMELINE_OPTIONS, importance: 'critical',
    page_target: '/explorer/profile', doc_anchor: 'explorer/investor/timeline-urgency',
    validate: 'select', mi_section: 'capital_velocity', followups: ['explorer.investor.timeline.deadline'] },
  { id: 'explorer.investor.timeline.deadline', persona: 'explorer', section: 'TIMELINE',
    prompt: 'Are there any hard deadlines or milestones? (e.g., "fund first close in 8 weeks", "LP commitment deadline in Q4")',
    input_kind: 'short', importance: 'normal', page_target: '/explorer/profile',
    doc_anchor: 'explorer/investor/hard-deadlines', validate: 'short', skip_allowed: true,
    followups: ['explorer.investor.timeline.runway'] },
  { id: 'explorer.investor.timeline.runway', persona: 'explorer', section: 'TIMELINE',
    prompt: 'How many months of runway do you have before you need to deploy or raise your next fund?',
    hint: 'Personal or fund runway', input_kind: 'number', importance: 'normal',
    page_target: '/explorer/profile', doc_anchor: 'explorer/investor/runway',
    validate: 'number', skip_allowed: true },

  { id: 'explorer.investor.capital.deployable', persona: 'explorer', section: 'CAPITAL',
    prompt: 'How much capital do you have available to deploy?',
    input_kind: 'select',
    options: ['<$100K', '$100K-$500K', '$500K-$2M', '$2M-$10M', '$10M+', 'Not yet raised'],
    importance: 'critical', page_target: '/explorer/profile', doc_anchor: 'explorer/investor/deployable-capital',
    validate: 'select', followups: ['explorer.investor.capital.check_size'] },
  { id: 'explorer.investor.capital.check_size', persona: 'explorer', section: 'CAPITAL',
    prompt: 'What\'s your typical check size?',
    input_kind: 'select', options: ['<$25K', '$25K-$100K', '$100K-$500K', '$500K+'], importance: 'high',
    page_target: '/explorer/profile', doc_anchor: 'explorer/investor/check-size',
    validate: 'select', followups: ['explorer.investor.capital.source'] },
  { id: 'explorer.investor.capital.source', persona: 'explorer', section: 'CAPITAL',
    prompt: 'What\'s the source of your investment capital?',
    input_kind: 'select',
    options: ['Personal capital', 'Family office', 'Fund (raised)', 'Fund (raising)', 'Syndicate/SPV'],
    importance: 'normal', page_target: '/explorer/profile', doc_anchor: 'explorer/investor/capital-source',
    validate: 'select', skip_allowed: true },
];

// ---------------------------------------------------------------------------
// Advisor track — explorer.advisor.*
// ---------------------------------------------------------------------------
const ADVISOR_STATUSES = [
  'New to advising', 'Advising informally', 'Building a formal practice',
  'Between engagements', 'Exploring multiple paths',
];
const ADVISOR_CHALLENGES = [
  'Building a client/founder pipeline',
  'Defining area of expertise & positioning',
  'Pricing & engagement model (equity vs cash vs hourly)',
  'Capacity planning (how many founders to advise)',
  'Conflict-of-interest management',
  'Building credibility & track record',
  'Structuring advisory agreements',
  'Network & referral building',
  'Balancing advisory work with other commitments',
  'Tools for tracking advisory relationships',
  'Board/observer seat opportunities',
  'Specialization vs generalist positioning',
];

export const EXPLORER_ADVISOR_BANK: Question[] = [
  { id: 'explorer.advisor.context.status', persona: 'explorer', section: 'CONTEXT',
    prompt: 'What\'s your current status?', hint: 'Where are you in your advising journey?',
    input_kind: 'select', options: ADVISOR_STATUSES, importance: 'critical',
    page_target: '/explorer/profile', doc_anchor: 'explorer/advisor/current-status',
    validate: 'select', followups: ['explorer.advisor.context.team'] },
  { id: 'explorer.advisor.context.team', persona: 'explorer', section: 'CONTEXT',
    prompt: 'Do you advise solo or as part of a firm/collective?',
    input_kind: 'select',
    options: ['Advising solo', 'Part of an advisory firm/collective', 'Exploring both paths'],
    importance: 'high', page_target: '/explorer/profile', doc_anchor: 'explorer/advisor/team-structure',
    validate: 'select', followups: ['explorer.advisor.context.sector'] },
  { id: 'explorer.advisor.context.sector', persona: 'explorer', section: 'CONTEXT',
    prompt: 'What sector(s) is your advisory expertise focused on?',
    input_kind: 'select', options: SECTORS, importance: 'high',
    page_target: '/explorer/profile', doc_anchor: 'explorer/advisor/sector',
    validate: 'select', skip_allowed: true, mi_section: 'sector_heat' },
  { id: 'explorer.advisor.context.geography', persona: 'explorer', section: 'CONTEXT',
    prompt: 'What\'s your geographic focus for advising?',
    input_kind: 'select', options: GEOGRAPHIES, importance: 'normal',
    page_target: '/explorer/profile', doc_anchor: 'explorer/advisor/geography',
    validate: 'select', skip_allowed: true, followups: ['explorer.advisor.challenges.top3'] },

  { id: 'explorer.advisor.challenges.top3', persona: 'explorer', section: 'CHALLENGES',
    prompt: 'What are your top 3 challenges right now? (Select up to 3)',
    hint: 'Choose the ones most pressing for you', input_kind: 'multi', options: ADVISOR_CHALLENGES,
    importance: 'critical', page_target: '/explorer/profile', doc_anchor: 'explorer/advisor/challenges',
    validate: 'multi', followups: ['explorer.advisor.challenges.top1_depth'] },
  { id: 'explorer.advisor.challenges.top1_depth', persona: 'explorer', section: 'CHALLENGES',
    prompt: 'Tell us more about your top priority challenge — what specifically are you dealing with?',
    hint: 'E.g., "Not sure how to price equity-based engagements" or "Need more founder introductions in fintech"',
    input_kind: 'long', importance: 'high', page_target: '/explorer/profile',
    doc_anchor: 'explorer/advisor/challenge-depth', validate: 'long', skip_allowed: true,
    followups: ['explorer.advisor.timeline.urgency'] },

  { id: 'explorer.advisor.timeline.urgency', persona: 'explorer', section: 'TIMELINE',
    prompt: 'When do you need help with your top challenge?',
    input_kind: 'select', options: TIMELINE_OPTIONS, importance: 'critical',
    page_target: '/explorer/profile', doc_anchor: 'explorer/advisor/timeline-urgency',
    validate: 'select', mi_section: 'capital_velocity', followups: ['explorer.advisor.timeline.deadline'] },
  { id: 'explorer.advisor.timeline.deadline', persona: 'explorer', section: 'TIMELINE',
    prompt: 'Are there any hard deadlines or milestones? (e.g., "want 3 active engagements by Q4")',
    input_kind: 'short', importance: 'normal', page_target: '/explorer/profile',
    doc_anchor: 'explorer/advisor/hard-deadlines', validate: 'short', skip_allowed: true,
    followups: ['explorer.advisor.timeline.runway'] },
  { id: 'explorer.advisor.timeline.runway', persona: 'explorer', section: 'TIMELINE',
    prompt: 'How many months of runway do you have before you need paying engagements?',
    input_kind: 'number', importance: 'normal', page_target: '/explorer/profile',
    doc_anchor: 'explorer/advisor/runway', validate: 'number', skip_allowed: true },

  { id: 'explorer.advisor.compensation.model', persona: 'explorer', section: 'COMPENSATION',
    prompt: 'What\'s your preferred compensation model?',
    input_kind: 'select',
    options: ['Equity only', 'Cash/retainer only', 'Hybrid (cash + equity)', 'Pro bono / building track record'],
    importance: 'critical', page_target: '/explorer/profile', doc_anchor: 'explorer/advisor/compensation-model',
    validate: 'select', followups: ['explorer.advisor.compensation.capacity'] },
  { id: 'explorer.advisor.compensation.capacity', persona: 'explorer', section: 'COMPENSATION',
    prompt: 'How many founders can you advise concurrently?',
    input_kind: 'select', options: ['1-2 founders', '3-5 founders', '6-10 founders', '10+ founders'],
    importance: 'high', page_target: '/explorer/profile', doc_anchor: 'explorer/advisor/capacity',
    validate: 'select', followups: ['explorer.advisor.compensation.min_engagement'] },
  { id: 'explorer.advisor.compensation.min_engagement', persona: 'explorer', section: 'COMPENSATION',
    prompt: 'What\'s your preferred minimum engagement length?',
    input_kind: 'select',
    options: ['One-off session', '1-3 months', '3-6 months', '6+ months / ongoing'],
    importance: 'normal', page_target: '/explorer/profile', doc_anchor: 'explorer/advisor/min-engagement',
    validate: 'select', skip_allowed: true },
];

// ---------------------------------------------------------------------------
// Partner track — explorer.partner.* (operating partner / service provider /
// studio partner)
// ---------------------------------------------------------------------------
const PARTNER_STATUSES = [
  'New service provider', 'Established firm exploring studio partnership',
  'Between engagements', 'Corporate/strategic partner', 'Exploring multiple paths',
];
const PARTNER_CHALLENGES = [
  'Defining services offered to founders',
  'Structuring the partnership (referral, revenue share, retainer)',
  'Building founder/deal pipeline',
  'Scoping engagement models (project vs ongoing)',
  'Capacity & team allocation',
  'Pricing & fee structure',
  'Integration with Axal\'s tools/systems',
  'Conflict-of-interest & exclusivity terms',
  'Track record & case studies',
  'Building internal champions/referral sources',
  'Legal/contract templates for engagements',
  'Reporting & value demonstration to the studio',
];

export const EXPLORER_PARTNER_BANK: Question[] = [
  { id: 'explorer.partner.context.status', persona: 'explorer', section: 'CONTEXT',
    prompt: 'What\'s your current status?', hint: 'Where are you in your studio-partnership journey?',
    input_kind: 'select', options: PARTNER_STATUSES, importance: 'critical',
    page_target: '/explorer/profile', doc_anchor: 'explorer/partner/current-status',
    validate: 'select', followups: ['explorer.partner.context.team'] },
  { id: 'explorer.partner.context.team', persona: 'explorer', section: 'CONTEXT',
    prompt: 'Are you an independent practice or part of a firm/agency?',
    input_kind: 'select',
    options: ['Independent/solo practice', 'Part of a firm/agency', 'Exploring both paths'],
    importance: 'high', page_target: '/explorer/profile', doc_anchor: 'explorer/partner/team-structure',
    validate: 'select', followups: ['explorer.partner.context.sector'] },
  { id: 'explorer.partner.context.sector', persona: 'explorer', section: 'CONTEXT',
    prompt: 'What sector(s) does your service focus on?',
    input_kind: 'select', options: SECTORS, importance: 'high',
    page_target: '/explorer/profile', doc_anchor: 'explorer/partner/sector',
    validate: 'select', skip_allowed: true, mi_section: 'sector_heat' },
  { id: 'explorer.partner.context.geography', persona: 'explorer', section: 'CONTEXT',
    prompt: 'What\'s your geographic focus?',
    input_kind: 'select', options: GEOGRAPHIES, importance: 'normal',
    page_target: '/explorer/profile', doc_anchor: 'explorer/partner/geography',
    validate: 'select', skip_allowed: true, followups: ['explorer.partner.challenges.top3'] },

  { id: 'explorer.partner.challenges.top3', persona: 'explorer', section: 'CHALLENGES',
    prompt: 'What are your top 3 challenges right now? (Select up to 3)',
    hint: 'Choose the ones most pressing for you', input_kind: 'multi', options: PARTNER_CHALLENGES,
    importance: 'critical', page_target: '/explorer/profile', doc_anchor: 'explorer/partner/challenges',
    validate: 'multi', followups: ['explorer.partner.challenges.top1_depth'] },
  { id: 'explorer.partner.challenges.top1_depth', persona: 'explorer', section: 'CHALLENGES',
    prompt: 'Tell us more about your top priority challenge — what specifically are you dealing with?',
    hint: 'E.g., "Need clarity on revenue-share terms" or "Want more founder introductions from the studio"',
    input_kind: 'long', importance: 'high', page_target: '/explorer/profile',
    doc_anchor: 'explorer/partner/challenge-depth', validate: 'long', skip_allowed: true,
    followups: ['explorer.partner.timeline.urgency'] },

  { id: 'explorer.partner.timeline.urgency', persona: 'explorer', section: 'TIMELINE',
    prompt: 'When do you need help with your top challenge?',
    input_kind: 'select', options: TIMELINE_OPTIONS, importance: 'critical',
    page_target: '/explorer/profile', doc_anchor: 'explorer/partner/timeline-urgency',
    validate: 'select', mi_section: 'capital_velocity', followups: ['explorer.partner.timeline.deadline'] },
  { id: 'explorer.partner.timeline.deadline', persona: 'explorer', section: 'TIMELINE',
    prompt: 'Are there any hard deadlines or milestones? (e.g., "want terms finalized before next cohort")',
    input_kind: 'short', importance: 'normal', page_target: '/explorer/profile',
    doc_anchor: 'explorer/partner/hard-deadlines', validate: 'short', skip_allowed: true,
    followups: ['explorer.partner.timeline.runway'] },
  { id: 'explorer.partner.timeline.runway', persona: 'explorer', section: 'TIMELINE',
    prompt: 'How many months of runway do you have before you need active engagements?',
    input_kind: 'number', importance: 'normal', page_target: '/explorer/profile',
    doc_anchor: 'explorer/partner/runway', validate: 'number', skip_allowed: true },

  { id: 'explorer.partner.commercials.engagement_model', persona: 'explorer', section: 'COMMERCIALS',
    prompt: 'What engagement model do you prefer?',
    input_kind: 'select',
    options: ['Referral fee', 'Revenue share', 'Retainer', 'Project-based fee', 'Equity/warrants'],
    importance: 'critical', page_target: '/explorer/profile', doc_anchor: 'explorer/partner/engagement-model',
    validate: 'select', followups: ['explorer.partner.commercials.pricing_approach'] },
  { id: 'explorer.partner.commercials.pricing_approach', persona: 'explorer', section: 'COMMERCIALS',
    prompt: 'How do you typically price your services?',
    input_kind: 'select',
    options: ['Fixed fee', 'Hourly/day rate', 'Percentage of deal/round', 'Blended'],
    importance: 'high', page_target: '/explorer/profile', doc_anchor: 'explorer/partner/pricing-approach',
    validate: 'select', followups: ['explorer.partner.commercials.min_deal_size'] },
  { id: 'explorer.partner.commercials.min_deal_size', persona: 'explorer', section: 'COMMERCIALS',
    prompt: 'Is there a minimum deal/engagement size you require?',
    input_kind: 'select',
    options: ['Any size', '$100K+ engagements', '$500K+ engagements', '$1M+ engagements'],
    importance: 'normal', page_target: '/explorer/profile', doc_anchor: 'explorer/partner/min-deal-size',
    validate: 'select', skip_allowed: true },
];

// ---------------------------------------------------------------------------
// Registry — track lookup consumed by routes/advisor.ts (bank selection)
// and services/advisor/writeRouter.ts (id-prefix parsing).
// ---------------------------------------------------------------------------
export type ExplorerTrack = 'founder' | 'investor' | 'advisor' | 'partner';

export const EXPLORER_BANKS_BY_TRACK: Record<ExplorerTrack, Question[]> = {
  founder: EXPLORER_FOUNDER_BANK,
  investor: EXPLORER_INVESTOR_BANK,
  advisor: EXPLORER_ADVISOR_BANK,
  partner: EXPLORER_PARTNER_BANK,
};

export function explorerBankForTrack(track: string | null | undefined): Question[] {
  if (!track) return [];
  const key = String(track).toLowerCase() as ExplorerTrack;
  return EXPLORER_BANKS_BY_TRACK[key] || [];
}

// Combined bank — NOT served directly to any user. Exists so the generic
// `BANKS.explorer` registry entry in questionBank.ts lets `questionById()`
// resolve any `explorer.*` id regardless of track (mirrors how `BANKS` is
// walked for every other persona). routes/advisor.ts always serves ONE of
// the 4 track arrays above via explorerBankForTrack(), never this array.
export const EXPLORER_BANK: Question[] = [
  ...EXPLORER_FOUNDER_BANK,
  ...EXPLORER_INVESTOR_BANK,
  ...EXPLORER_ADVISOR_BANK,
  ...EXPLORER_PARTNER_BANK,
];
