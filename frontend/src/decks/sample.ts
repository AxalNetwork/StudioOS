import type { DeckData } from './DeckBase';

// Base preview sample used by the existing 11 templates. Keeps the
// historical *string* shapes for `milestones`, `roadmap`, and
// `use_of_funds` because those templates render them as plain text.
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
};

// Per-template overlay. The YC Seed redesign reads the attachment's
// richer DeckData shape — arrays under the same keys (`milestones`,
// `roadmap`, `use_of_funds`) plus brand-new fields (problems[],
// product_pillars[], pricing_tiers[], etc.). Splicing those arrays
// into SAMPLE_PREVIEW_DATA directly would crash the other 11
// templates' previews (they pass the array straight into <Editable>
// which expects a string). The overlay is only applied when rendering
// the YC Seed preview.
const YC_SEED_OVERLAY: DeckData = {
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
  milestones: [
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
  roadmap: [
    { quarter: 'Now', goal: 'Live in production · 312 paying logos' },
    { quarter: '+6 mo', goal: 'Reach $1M ARR' },
    { quarter: '+12 mo', goal: 'Expand to adjacent workflow' },
    { quarter: '+24 mo', goal: 'Define the category' },
  ],
  use_of_funds: [
    { label: 'Engineering', pct: 45 },
    { label: 'GTM', pct: 30 },
    { label: 'Ops + Infra', pct: 15 },
    { label: 'Reserve', pct: 10 },
  ],
  closing_line:
    'If we win, the next generation of venture studios stop wrestling tools and start shipping outcomes.',
};

// Sequoia Classic narrative deck overlay. Provides the rich data
// shape (curves, pillars, founders, flywheel nodes, market rings)
// the 12-slide investor template renders. Kept template-local for
// the same reason as YC_SEED_OVERLAY: arrays under string-typed keys
// (`use_of_funds`, `roadmap`) would crash the simpler templates.
const SEQUOIA_OVERLAY: DeckData = {
  company: 'Demo Co.',
  category: 'Frontier infrastructure',

  future_year: '2035',
  future_headline: 'Every team will operate with a single source of truth.',
  future_subline: 'The work itself becomes the system of record — observable, audited, alive.',

  shift_title: 'Three forces converging now.',
  shift_body:
    'What was impossible last decade is now economical. What was acceptable last decade is now intolerable. The inflection is no longer ahead of us — it is here.',
  shift_curves: [
    { label: 'Compute per dollar', from: 12, to: 84, color: '#8C1F28' },
    { label: 'Tolerance for friction', from: 70, to: 14, color: '#B45D3E' },
    { label: 'Capital available', from: 28, to: 60, color: '#0D0D0D' },
  ],

  broken_title: 'Today, this work is done by hand.',
  broken_pillars: [
    { title: 'Fragmented stacks', body: 'Teams stitch six or more tools to ship a single workflow.', cost: '40% time lost' },
    { title: 'Spreadsheet truth', body: 'The most important records still live in inboxes and tabs.', cost: 'Trust eroded' },
    { title: 'Manual reconciliation', body: 'Every cycle ends in a fire drill across systems.', cost: '2× errors' },
  ],

  insight_label: 'WHAT EVERYONE ELSE MISSES',
  insight_headline: 'The work itself is the data. The data itself becomes the moat.',
  insight_body:
    'Every other approach treats the workflow and the database as separate concerns. We collapse them into one — turning ordinary daily activity into a compounding strategic asset.',
  insight_proofs: [
    'Pilot customers each generated 10× more structured records than competing tools.',
    'Every record we capture becomes training data for the next decision.',
    'The lock-in is not the product — it is the customer\u2019s own history.',
  ],

  tam_usd: 42_000_000_000,
  sam_usd: 9_400_000_000,
  som_usd: 1_200_000_000,
  market_cagr_pct: 28,
  market_curve: [
    { year: '2022', v: 22 }, { year: '2024', v: 38 }, { year: '2026', v: 64 },
    { year: '2028', v: 105 }, { year: '2030', v: 168 },
  ],

  solution_one_liner:
    'A single workflow that replaces the patchwork — and produces the audit trail the platform itself needs.',
  before_state: ['Six tools', 'Manual sync', 'Reconciled by hand', 'Filed late'],
  after_state: ['One workflow', 'Auto-synced', 'Audited live', 'Done in seconds'],

  product_pillars: [
    { title: 'One source of truth', body: 'Every record reconciled in real time.' },
    { title: 'Reasoning layer', body: 'Decisions explainable, audit-trailed.' },
    { title: 'Open by design', body: 'Plugs into the systems teams already use.' },
  ],
  product_modules: [
    { name: 'Capture', nodes: ['Web', 'API', 'Mobile'] },
    { name: 'Reason', nodes: ['Workflow', 'Policy', 'LLM'] },
    { name: 'Act', nodes: ['Integrations', 'Records', 'Audit'] },
  ],

  axis_x: 'Reach',
  axis_y: 'Depth',
  competitors: [
    { name: 'Legacy A', x: 78, y: 28 },
    { name: 'Legacy B', x: 58, y: 36 },
    { name: 'Point Tool', x: 24, y: 70 },
    { name: 'Us', x: 80, y: 84 },
  ],
  moats: [
    { title: 'Data', body: 'Every customer makes the next prediction sharper.' },
    { title: 'Distribution', body: 'Partner channels into the ICP, not around it.' },
    { title: 'Switching cost', body: 'Embedded in the daily workflow of the team.' },
  ],

  mrr_usd: 34_000,
  paying_customers: 64,
  growth_mom_pct: 41,
  nrr_pct: 122,
  revenue_curve: [
    { month: 'Jan', v: 4 }, { month: 'Feb', v: 7 }, { month: 'Mar', v: 11 },
    { month: 'Apr', v: 16 }, { month: 'May', v: 24 }, { month: 'Jun', v: 34 },
  ],
  user_curve: [
    { month: 'Jan', v: 120 }, { month: 'Feb', v: 240 }, { month: 'Mar', v: 410 },
    { month: 'Apr', v: 680 }, { month: 'May', v: 1050 }, { month: 'Jun', v: 1640 },
  ],
  retention_curve: [
    { m: 'M0', v: 100 }, { m: 'M1', v: 92 }, { m: 'M3', v: 86 },
    { m: 'M6', v: 81 }, { m: 'M9', v: 78 }, { m: 'M12', v: 76 },
  ],
  customer_logos: [
    { name: 'Acme Co.' }, { name: 'Nimbus' }, { name: 'Lattice' },
    { name: 'Northwind' }, { name: 'Atlas Labs' }, { name: 'Verdant' },
  ],

  flywheel_nodes: [
    { label: 'Customers', body: 'use product' },
    { label: 'Product', body: 'learns from use' },
    { label: 'Data', body: 'compounds' },
    { label: 'Network', body: 'expands reach' },
    { label: 'Revenue', body: 'funds invention' },
  ],

  founders: [
    { name: 'Alex Rivera', role: 'CEO · Co-founder', bio: 'Prior: led product at Stripe. Shipped infrastructure used by 4M+ businesses.', initials: 'AR' },
    { name: 'Sam Chen', role: 'CTO · Co-founder', bio: 'Prior: principal engineer at Linear. Designed core systems shipping to 50K+ teams.', initials: 'SC' },
  ],
  team_timeline: [
    { year: '2014', event: 'Met building open-source infrastructure' },
    { year: '2020', event: 'Shipped a category-defining product together' },
    { year: '2025', event: 'Founded this company' },
  ],

  opportunity_headline: 'A category measured in tens of billions.',
  product_headline: 'Three layers. One platform.',
  why_we_win_headline: 'The moats compound.',
  traction_headline: 'The numbers',
  flywheel_headline: 'Each turn makes the next one easier.',
  team_headline: 'Operators with scar tissue.',
  vision_headline: 'Raising $3.5M to build the company that defines this decade.',
  vision_body:
    'In five years, every operating team in this category will route their work through one platform. We intend to be that platform — and to do it with discipline, not theatre.',
  roadmap: [
    { quarter: 'Now', goal: 'Live · 60+ paying logos' },
    { quarter: '+6 mo', goal: '$1M ARR · 10× pipeline' },
    { quarter: '+12 mo', goal: 'Second workflow live' },
    { quarter: '+24 mo', goal: 'Category leader' },
  ],
  use_of_funds: [
    { label: 'Engineering', pct: 45 },
    { label: 'GTM', pct: 30 },
    { label: 'Operations + Infra', pct: 15 },
    { label: 'Reserve', pct: 10 },
  ],
  ask_amount_usd: 3_500_000,
  runway_months: 24,
  closing_line:
    'If we get this right, the next generation of teams stops fighting their tools and starts shipping outcomes.',
  contact: 'founders@demoCo.example',
};

// Kawasaki 10/20/30 overlay. Provides the structured shapes the
// rebuilt 10-slide investor template renders (problem_stat object,
// revenue_flow nodes, magic_capabilities, funnel, positioning map,
// revenue_series, milestones, use_of_funds donut). Kept template-
// local for the same reason as YC_SEED_OVERLAY / SEQUOIA_OVERLAY:
// these arrays under string-typed keys (`milestones`, `use_of_funds`)
// would crash the simpler templates.
const KAWASAKI_OVERLAY: DeckData = {
  company: 'Demo Co.',
  domain: 'demoCo.example',
  category: 'Workflow infrastructure',

  problem_headline: 'Teams stitch six tools to ship one workflow.',
  problem_support: 'Every cycle ends in a fire drill. The cost is enormous, hidden, and ignored.',
  problem_stat: { value: '$1.2T', label: 'wasted globally each year on duplicated work and reconciliation.' },

  solution_headline: 'One workflow. Done.',
  solution_support: 'A single source of truth that replaces the patchwork — and pays for itself in the first month.',
  solution_pillar_words: ['One', 'Workflow', 'Done'],

  bm_headline: 'Subscription. Per seat. Annual contracts.',
  revenue_flow: [
    { from: 'Customer',     to: 'Subscription', label: 'pays' },
    { from: 'Subscription', to: 'Revenue',      label: 'monthly' },
  ],
  bm_unit: { acv: '$48K', gross_margin: '82%', payback: '6 mo' },

  magic_headline: "A reasoning engine the incumbents can't copy.",
  magic_support: "Every customer's daily work trains the next decision. Compounding moat by construction.",
  magic_capabilities: ['Capture', 'Reason', 'Act'],

  funnel: [
    { stage: 'Visitors',  v: 12000 },
    { stage: 'Signups',   v: 2100 },
    { stage: 'Activated', v: 860 },
    { stage: 'Paying',    v: 220 },
  ],

  axis_x: 'Reach',
  axis_y: 'Depth',
  competitors: [
    { name: 'Legacy A',   x: 78, y: 28 },
    { name: 'Legacy B',   x: 58, y: 36 },
    { name: 'Point Tool', x: 24, y: 70 },
    { name: 'Us',         x: 80, y: 84 },
  ],

  founders: [
    { name: 'Alex Rivera', role: 'CEO · Co-founder', bio: 'Built infra at Stripe used by 4M+ businesses.', initials: 'AR' },
    { name: 'Sam Chen',    role: 'CTO · Co-founder', bio: 'Principal engineer at Linear. 50K+ teams in production.', initials: 'SC' },
  ],
  team_timeline: [
    { year: '2014', event: 'Met on open-source infrastructure' },
    { year: '2020', event: 'Shipped a category-defining product' },
    { year: '2025', event: 'Founded this company' },
  ],

  revenue_series: [
    { label: '2024', v: 0.2 },
    { label: '2025', v: 1.4 },
    { label: '2026', v: 6.2 },
    { label: '2027', v: 18 },
    { label: '2028', v: 42 },
  ],
  milestones: [
    { date: '2025', label: 'First $1M ARR' },
    { date: '2026', label: '$10M ARR · category-leading NRR' },
    { date: '2027', label: '$50M ARR · expansion line live' },
    { date: '2028', label: 'Series B · category leader' },
  ],

  mrr_usd: 34_000,
  paying_customers: 64,
  growth_mom_pct: 41,
  nrr_pct: 122,
  user_series: [
    { label: 'Jan', v: 120 }, { label: 'Feb', v: 240 }, { label: 'Mar', v: 410 },
    { label: 'Apr', v: 680 }, { label: 'May', v: 1050 }, { label: 'Jun', v: 1640 },
  ],

  ask_amount_usd: 3_500_000,
  runway_months: 24,
  use_of_funds: [
    { label: 'Engineering',        pct: 45 },
    { label: 'GTM',                pct: 30 },
    { label: 'Operations + Infra', pct: 15 },
    { label: 'Reserve',            pct: 10 },
  ],
  closing_line:
    'In five years, every operating team in this category runs through one workflow. We intend to be it.',
  contact: 'founders@demoCo.example',
};

// Returns the sample preview data for a given template key. Most
// templates get the base SAMPLE_PREVIEW_DATA verbatim; richer
// narrative templates (YC Seed, Sequoia Classic) get an overlay that
// replaces a handful of string fields with the structured shapes the
// new layouts expect.
export function previewDataFor(templateKey: string): DeckData {
  if (templateKey === 'yc_seed') {
    return { ...SAMPLE_PREVIEW_DATA, ...YC_SEED_OVERLAY };
  }
  if (templateKey === 'sequoia_classic') {
    return { ...SAMPLE_PREVIEW_DATA, ...SEQUOIA_OVERLAY };
  }
  if (templateKey === 'kawasaki_10_20_30') {
    return { ...SAMPLE_PREVIEW_DATA, ...KAWASAKI_OVERLAY };
  }
  return SAMPLE_PREVIEW_DATA;
}
