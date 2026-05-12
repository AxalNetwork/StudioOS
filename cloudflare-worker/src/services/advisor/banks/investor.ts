/**
 * Task #2 (AR) — Investor bank.
 *
 * Decision-support sequencing: identity → sectors/stages → ticket
 * size → thesis (paywalled) → pipeline → co-invest → watchlist seed.
 */
import type { Question } from '../questionBank';

const TYPES = ['Angel', 'Family Office', 'Micro VC', 'Traditional VC', 'Corporate Venture', 'Syndicate Lead'];
const TICKETS = ['<$25k', '$25k–$100k', '$100k–$500k', '$500k–$2M', '$2M+'];
const VOLUME = ['<5', '5–20', '20–50', '50+'];

export const INVESTOR_BANK: Question[] = [
  { id: 'investor.profile.investor_type', persona: 'investor', section: 'PROFILE',
    prompt: 'Which best describes your investing capacity?',
    input_kind: 'select', options: TYPES, importance: 'critical',
    page_target: '/investor-profile', doc_anchor: 'portals/portfolio-health',
    validate: 'select' },
  { id: 'investor.profile.sectors', persona: 'investor', section: 'PROFILE',
    prompt: 'Which sectors are you actively investing in? (comma-separated)',
    input_kind: 'short', importance: 'high', hint: 'e.g. AI, Climate, Fintech',
    page_target: '/investor-profile', doc_anchor: 'portals/portfolio-health',
    validate: 'csv' },
  { id: 'investor.profile.stages', persona: 'investor', section: 'PROFILE',
    prompt: 'Which stages do you write checks at? (comma-separated)',
    input_kind: 'short', importance: 'high', hint: 'e.g. Pre-seed, Seed, Series A',
    page_target: '/investor-profile', doc_anchor: 'portals/portfolio-health',
    validate: 'csv' },
  { id: 'investor.profile.ticket_band', persona: 'investor', section: 'PROFILE',
    prompt: 'What ticket size do you typically write?',
    input_kind: 'select', options: TICKETS, importance: 'high',
    page_target: '/investor-profile', doc_anchor: 'portals/portfolio-health',
    validate: 'select' },
  { id: 'investor.profile.thesis', persona: 'investor', section: 'THESIS',
    prompt: 'Tell me your investment thesis in 2-4 sentences.',
    input_kind: 'long', importance: 'high',
    tier_required: 'investor_pro',
    page_target: '/investor-profile', doc_anchor: 'portals/portfolio-health',
    validate: 'long' },
  { id: 'investor.pipeline.deal_volume', persona: 'investor', section: 'PIPELINE',
    prompt: 'How many deals do you actively look at per quarter?',
    input_kind: 'select', options: VOLUME, importance: 'normal',
    page_target: '/deal-flow', doc_anchor: 'portals/portfolio-health',
    validate: 'select' },
  { id: 'investor.coinvest.preferences', persona: 'investor', section: 'PIPELINE',
    prompt: 'Lead, follow, or both? Anything we should know about co-invest preferences?',
    input_kind: 'long', importance: 'normal',
    page_target: '/investor-profile', doc_anchor: 'portals/portfolio-health',
    validate: 'long' },
  { id: 'investor.watchlist.seed_companies', persona: 'investor', section: 'WATCHLIST',
    prompt: 'Any companies you’re already tracking? (comma-separated)',
    input_kind: 'short', importance: 'low',
    page_target: '/portfolio', doc_anchor: 'portals/portfolio-health',
    validate: 'csv', skip_allowed: true },
];

export default INVESTOR_BANK;
