/**
 * Task #11 (AC-2) — Investor question bank.
 *
 * `investor.profile.thesis` is gated behind the Investor Pro tier
 * (W-1 paywall) — the AC-1 write-router returns
 * `{ status: 'paywalled', upgrade_link }` instead of writing, and
 * the chat client (AC-3) renders the upgrade CTA inline. We mark
 * `tier_required: 'investor_pro'` here so the UI can dim the field
 * before submission.
 */
import { all, required, minChars, maxChars, oneOf, csvNonEmpty } from '../validators';

const TYPES = ['Angel', 'Family Office', 'Micro VC', 'Traditional VC', 'Corporate Venture', 'Syndicate Lead'];
const TICKETS = ['<$25k', '$25k–$100k', '$100k–$500k', '$500k–$2M', '$2M+'];

export const INVESTOR_BANK = [
  // --- Firm facts ------------------------------------------------------
  {
    id: 'investor.profile.investor_type',
    label: 'Which best describes your investing capacity?',
    type: 'select',
    options: TYPES,
    explainer: 'Drives the deal-flow filters and which fund-management tools we surface.',
    doc_anchor: 'portals/portfolio-health',
    page_target: '/investor-profile',
    validate: all(required, oneOf(TYPES)),
  },

  // --- Thesis (paywalled long-form) -----------------------------------
  {
    id: 'investor.profile.sectors',
    label: 'Which sectors are you actively investing in? (comma-separated)',
    type: 'short',
    explainer: 'e.g. AI, Climate, Fintech',
    doc_anchor: 'portals/portfolio-health',
    page_target: '/investor-profile',
    validate: all(required, csvNonEmpty(1)),
  },
  {
    id: 'investor.profile.stages',
    label: 'Which stages do you write checks at? (comma-separated)',
    type: 'short',
    explainer: 'e.g. Pre-seed, Seed, Series A',
    doc_anchor: 'portals/portfolio-health',
    page_target: '/investor-profile',
    validate: all(required, csvNonEmpty(1)),
  },
  {
    id: 'investor.profile.thesis',
    label: 'Tell me your investment thesis in 2-4 sentences.',
    type: 'long',
    explainer:
      'Long-form thesis is part of Investor Pro. Free-tier investors can still set sector/stage above.',
    doc_anchor: 'portals/portfolio-health',
    page_target: '/investor-profile',
    tier_required: 'investor_pro',
    validate: all(required, minChars(40), maxChars(1000)),
  },

  // --- Tickets ---------------------------------------------------------
  {
    id: 'investor.profile.ticket_band',
    label: 'What ticket size do you typically write?',
    type: 'select',
    options: TICKETS,
    explainer: 'Used to filter deals to your range and to size co-invest invitations.',
    doc_anchor: 'portals/portfolio-health',
    page_target: '/investor-profile',
    validate: all(required, oneOf(TICKETS)),
  },

  // --- Pipeline preferences -------------------------------------------
  {
    id: 'investor.pipeline.deal_volume',
    label: 'How many deals do you actively look at per quarter?',
    type: 'select',
    options: ['<5', '5–20', '20–50', '50+'],
    explainer: 'Calibrates how aggressively the deal-flow surface paginates new opportunities.',
    doc_anchor: 'portals/portfolio-health',
    page_target: '/deal-flow',
    validate: all(required, oneOf(['<5', '5–20', '20–50', '50+'])),
  },

  // --- Co-invest preferences ------------------------------------------
  {
    id: 'investor.coinvest.preferences',
    label: 'Do you lead, follow, or both? Anything we should know about co-invest preferences?',
    type: 'long',
    explainer: 'Shown to studio partners when sizing rounds you might join.',
    doc_anchor: 'portals/portfolio-health',
    page_target: '/investor-profile',
    validate: all(required, minChars(2), maxChars(500)),
  },

  // --- Watchlist seeds -------------------------------------------------
  {
    id: 'investor.watchlist.seed_companies',
    label: 'Any companies you’re already tracking? (comma-separated)',
    type: 'short',
    explainer: 'We’ll add them to your Watchlist on the Portfolio page.',
    doc_anchor: 'portals/portfolio-health',
    page_target: '/portfolio',
    validate: maxChars(500),
  },
];

export default INVESTOR_BANK;
