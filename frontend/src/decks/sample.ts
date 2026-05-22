import type { DeckData } from './DeckBase';

export const SAMPLE_PREVIEW_DATA: DeckData = {
  company: 'Demo Co.',
  tagline: 'The fastest way to ship venture-grade decks.',
  problem: 'Founders waste weeks on slide formatting instead of pitching.',
  solution: 'Auto-filled, on-brand decks generated from your project data in minutes.',
  product: 'Twelve battle-tested templates with inline editing and one-click export.',
  business_model: 'SaaS subscription with usage-based AI export credits.',
  market: 'Every early-stage founder raising under $5M.',
  why_now: 'AI made pixel-perfect decks a commodity — founders need speed, not slide artistry.',
  team: 'Operators from YC, Stripe, and Notion.',
  tam: 8_400_000_000,
  sam: 1_200_000_000,
  som: 120_000_000,
  mrr: 48_000,
  arr: 576_000,
  paying_customers: 312,
  growth_pct: 22,
  ask_amount: 2_500_000,
  use_of_funds: 'Engineering, AI inference, GTM.',
  contact: 'hello@demoCo.example',
  traction: '$48k MRR · 22% MoM · 312 paying.',
  competition: 'PowerPoint, Pitch, Canva — none auto-fill from your data.',
  moat: 'Proprietary scoring + integrated cap table + LP ledger.',
  milestones: 'Series A in 18 months at $5M ARR.',
  roadmap: 'Live → $1M ARR → adjacent workflow → category leader.',

  // ── YC Seed redesign additive fields ────────────────────────
  // Renamed where they would clobber a same-named string field used
  // by other templates: milestones→milestone_events, roadmap→
  // roadmap_phases, use_of_funds→use_of_funds_breakdown.
  vision: 'The default way venture studios run their entire portfolio.',
  domain: 'demoCo.example',
  problems: [
    { title: 'Fragmented tooling', body: 'Studios stitch 6+ tools to ship one workflow.', metric: '↑ 40% time lost' },
    { title: 'No source of truth', body: 'Data lives in inboxes, spreadsheets, and screenshots.', metric: '↓ trust' },
    { title: 'Manual reconciliation', body: 'Every cycle ends in a fire drill.', metric: '↑ 2× errors' },
  ],
  solution_summary:
    'A single workflow that replaces the patchwork — connecting intake, scoring, and cap table under one source of truth with audit trail and instant rollback.',
  before: ['Open 6 tools', 'Manually copy data', 'Reconcile by hand', 'File late'],
  after: ['One workflow', 'Auto-synced', 'Full audit trail', 'Done in 30s'],
  product_pillars: [
    { title: 'One workflow', body: 'Collapse the chain of steps into one action.' },
    { title: 'Verified data', body: 'Source-of-truth integrations with audit.' },
    { title: 'Instant rollback', body: 'Mistakes are reversible by design.' },
  ],
  tam_usd: 42_000_000_000,
  sam_usd: 9_400_000_000,
  som_usd: 1_200_000_000,
  market_cagr_pct: 28,
  market_trends: [
    'Regulation forcing audit-ready workflows.',
    'AI shifts unit economics in our favor.',
    'Adoption curve crossing into mainstream.',
  ],
  pricing_tiers: [
    { name: 'Starter', price: '$49 / mo', bullets: ['Up to 5 seats', 'Core workflow', 'Email support'] },
    { name: 'Growth', price: '$199 / mo', bullets: ['Up to 25 seats', 'Integrations', 'Audit trail'] },
    { name: 'Enterprise', price: 'Contact', bullets: ['Unlimited seats', 'SSO + SCIM', 'SLA + DPA'] },
  ],
  mrr_usd: 48_000,
  growth_mom_pct: 22,
  mrr_series: [
    { month: 'Jan', v: 8 }, { month: 'Feb', v: 12 }, { month: 'Mar', v: 18 },
    { month: 'Apr', v: 26 }, { month: 'May', v: 36 }, { month: 'Jun', v: 48 },
  ],
  user_series: [
    { month: 'Jan', v: 140 }, { month: 'Feb', v: 260 }, { month: 'Mar', v: 430 },
    { month: 'Apr', v: 720 }, { month: 'May', v: 1100 }, { month: 'Jun', v: 1640 },
  ],
  milestone_events: [
    { date: 'Q1', label: 'Closed first 10 design partners' },
    { date: 'Q2', label: 'Crossed $10K MRR' },
    { date: 'Q3', label: 'Shipped enterprise tier' },
    { date: 'Q4', label: 'First six-figure logo' },
  ],
  funnel: [
    { stage: 'Visitors', v: 12000 },
    { stage: 'Signups', v: 2100 },
    { stage: 'Activated', v: 860 },
    { stage: 'Paying', v: 312 },
    { stage: 'Expanded', v: 90 },
  ],
  channels: [
    { name: 'Inbound / SEO', share_pct: 35 },
    { name: 'Founder network', share_pct: 25 },
    { name: 'Partnerships', share_pct: 20 },
    { name: 'Outbound', share_pct: 12 },
    { name: 'Community', share_pct: 8 },
  ],
  founders: [
    { name: 'Alex Rivera', role: 'CEO · Co-founder', pedigree: ['Built X at Stripe', 'Shipped product to 10M+ users'], initials: 'AR' },
    { name: 'Sam Chen', role: 'CTO · Co-founder', pedigree: ['Led infra at Linear', 'Open-source: 12K stars'], initials: 'SC' },
  ],
  team_timeline: [
    { year: '2018', event: 'Met building developer tools' },
    { year: '2022', event: 'Shipped category-defining product' },
    { year: '2025', event: 'Founded Demo Co.' },
  ],
  ask_amount_usd: 2_500_000,
  runway_months: 24,
  roadmap_phases: [
    { quarter: 'Now', goal: 'Live in production · 312 paying logos' },
    { quarter: '+6 mo', goal: 'Reach $1M ARR' },
    { quarter: '+12 mo', goal: 'Expand to adjacent workflow' },
    { quarter: '+24 mo', goal: 'Define the category' },
  ],
  use_of_funds_breakdown: [
    { label: 'Engineering', pct: 45 },
    { label: 'GTM', pct: 30 },
    { label: 'Ops + Infra', pct: 15 },
    { label: 'Reserve', pct: 10 },
  ],
  closing_line:
    'If we win, the next generation of venture studios stop wrestling tools and start shipping outcomes.',
};
