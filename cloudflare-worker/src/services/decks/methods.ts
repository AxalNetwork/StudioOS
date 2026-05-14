/**
 * Task #16 (DE) — Pitch Deck Builder rewrite.
 *
 * 12 deck-method specs. Each entry declares the ordered slide schema for
 * a template, plus the data sources the auto-fill engine should consult
 * for each field. The auto-fill engine (services/decks/autofill.ts)
 * reads these specs and produces a populated `slides[]` array; missing
 * fields fall back to AI draft, then to the literal `[Founder, fill in]`
 * placeholder.
 *
 * Field-source vocabulary (used by autofill.ts):
 *   project.<col>          — column on the projects row
 *   project.derived.<key>  — computed string (e.g. derived.ask_line)
 *   financials.<key>       — key on financial_models.computed_json or assumptions_json
 *   captable.<key>         — derived from cap_table_holders rows
 *   ai.<hint>              — Personal Advisor / OpenAI fallback prompt
 */

export type DeckMethodId =
  | 'yc_seed'
  | 'sequoia_classic'
  | 'kawasaki_10_20_30'
  | 'minimal_seed'
  | 'series_a_growth'
  | 'series_b_diligence'
  | 'demo_day'
  | 'sales_commercial'
  | 'partnership_bd'
  | 'one_pager_teaser'
  | 'investor_appendix'
  | 'narrative_brand';

export type DeckSlideField = {
  /** Field id (becomes the JSON key on the slide). */
  key: string;
  /** Human label shown in the editor. */
  label: string;
  /** Render kind — controls how the editor + renderer treat it. */
  kind: 'title' | 'subtitle' | 'paragraph' | 'bullets' | 'image' | 'metric_grid' | 'quote';
  /** Ordered list of source expressions consulted in order. */
  sources: string[];
  /** Short hint surfaced when the field is empty. */
  hint?: string;
  /** Marks the field as optional — autofill won't insert a placeholder. */
  optional?: boolean;
};

export type DeckSlideSpec = {
  id: string;
  title: string;
  /** Optional subtitle template like "{project.name} — {project.sector}". */
  subtitle?: string;
  /** Ordered fields rendered on this slide. */
  fields: DeckSlideField[];
  /** Optional appendix flag — surfaced as "Appendix" group in editor. */
  appendix?: boolean;
};

export type DeckMethodSpec = {
  id: DeckMethodId;
  /** Storage key (matches id). */
  key: DeckMethodId;
  label: string;
  /** Short pitch shown in the method picker. */
  prompt_hint: string;
  /** Best-fit blurb: who/when. */
  best_for: string;
  /** Total slide count (excluding optional appendix slides). */
  slide_count: number;
  /** Premium templates require Growth tier; free tier sees a paywall. */
  premium?: boolean;
  /** Suggested category badge in the picker. */
  category: 'fundraising' | 'commercial' | 'event' | 'narrative';
  fields_from_project: string[];
  fields_from_financials: string[];
  fields_from_captable: string[];
  ai_fill_hint: string;
  slides: DeckSlideSpec[];
};

// ---------------------------------------------------------------------
// Slide-field factory helpers — keeps method declarations readable.
// ---------------------------------------------------------------------
const f = {
  title: (key = 'title', sources: string[] = [], label = 'Headline'): DeckSlideField =>
    ({ key, label, kind: 'title', sources, hint: 'A single, punchy line.' }),
  subtitle: (key = 'subtitle', sources: string[] = [], label = 'Sub-line'): DeckSlideField =>
    ({ key, label, kind: 'subtitle', sources, optional: true }),
  para: (key: string, label: string, sources: string[], hint?: string): DeckSlideField =>
    ({ key, label, kind: 'paragraph', sources, hint }),
  bullets: (key: string, label: string, sources: string[], hint?: string): DeckSlideField =>
    ({ key, label, kind: 'bullets', sources, hint }),
  metrics: (key: string, label: string, sources: string[]): DeckSlideField =>
    ({ key, label, kind: 'metric_grid', sources }),
  image: (key: string, label: string, sources: string[]): DeckSlideField =>
    ({ key, label, kind: 'image', sources, optional: true }),
  quote: (key: string, label: string, sources: string[]): DeckSlideField =>
    ({ key, label, kind: 'quote', sources, optional: true }),
};

// ---------------------------------------------------------------------
// Re-usable slide builders.
// ---------------------------------------------------------------------
const titleSlide = (id: string, title = 'Title'): DeckSlideSpec => ({
  id, title,
  subtitle: '{project.name}',
  fields: [
    f.title('headline', ['project.name'], 'Company name'),
    f.subtitle('tagline', ['project.tagline', 'ai.one_line_pitch'], 'Tagline'),
    f.para('intro', 'One-liner', ['project.description', 'ai.one_line_pitch'], 'A single sentence on what you do.'),
    f.image('logo', 'Logo / hero', ['project.logo_url']),
  ],
});

const problemSlide: DeckSlideSpec = {
  id: 'problem', title: 'Problem',
  fields: [
    f.title('headline', ['ai.problem_headline'], 'Problem in 5 words'),
    f.para('story', 'Customer pain', ['project.problem_statement', 'ai.problem_story']),
    f.bullets('pains', 'Top pains', ['ai.problem_bullets'], 'Top 3 pains today'),
  ],
};

const solutionSlide: DeckSlideSpec = {
  id: 'solution', title: 'Solution',
  fields: [
    f.title('headline', ['ai.solution_headline'], 'Solution in 5 words'),
    f.para('story', 'How it works', ['project.solution', 'project.description', 'ai.solution_story']),
    f.bullets('features', 'Key capabilities', ['ai.solution_bullets']),
    f.image('shot', 'Product screenshot', []),
  ],
};

const marketSlide: DeckSlideSpec = {
  id: 'market', title: 'Market',
  fields: [
    f.title('headline', ['ai.market_headline'], 'Sector + size'),
    f.metrics('sizes', 'TAM / SAM / SOM', ['project.tam', 'project.sam', 'project.som']),
    f.bullets('drivers', 'Why now', ['project.why_now', 'ai.why_now_bullets']),
  ],
};

const tractionSlide: DeckSlideSpec = {
  id: 'traction', title: 'Traction',
  fields: [
    f.title('headline', ['ai.traction_headline']),
    f.metrics('metrics', 'Top numbers', [
      'project.users_count', 'project.revenue', 'financials.runway_months',
      'financials.ltv_cac_ratio', 'financials.breakeven_month',
    ]),
    f.bullets('proof', 'Proof points', ['project.growth_signals', 'ai.traction_bullets']),
    f.quote('quote', 'Customer quote', []),
  ],
};

const businessModelSlide: DeckSlideSpec = {
  id: 'model', title: 'Business model',
  fields: [
    f.title('headline', ['ai.model_headline']),
    f.para('story', 'How we make money', ['ai.model_story']),
    f.metrics('unit_econ', 'Unit economics', [
      'financials.ltv', 'financials.ltv_cac_ratio', 'project.cac', 'project.gross_margin_pct',
    ]),
  ],
};

const gtmSlide: DeckSlideSpec = {
  id: 'gtm', title: 'Go-to-market',
  fields: [
    f.title('headline', ['ai.gtm_headline']),
    f.bullets('channels', 'Channels', ['ai.gtm_channels']),
    f.bullets('motion', 'Motion', ['ai.gtm_motion']),
  ],
};

const competitionSlide: DeckSlideSpec = {
  id: 'competition', title: 'Competition',
  fields: [
    f.title('headline', ['ai.competition_headline']),
    f.bullets('landscape', 'Landscape', ['ai.competition_landscape']),
    f.para('moat', 'Our wedge', ['ai.competition_moat']),
  ],
};

const teamSlide: DeckSlideSpec = {
  id: 'team', title: 'Team',
  fields: [
    f.title('headline', ['ai.team_headline'], 'Why us'),
    f.bullets('founders', 'Founders', ['captable.founders', 'ai.team_bullets']),
    f.bullets('plan', 'Hiring plan', ['ai.team_hiring']),
  ],
};

const askSlide: DeckSlideSpec = {
  id: 'ask', title: 'Ask',
  fields: [
    f.title('headline', ['project.derived.ask_line', 'ai.ask_headline']),
    f.metrics('round', 'Round', [
      'project.funding_needed', 'project.derived.runway_target',
      'financials.runway_months',
    ]),
    f.bullets('use_of_funds', 'Use of funds', ['project.use_of_funds', 'ai.ask_uses']),
  ],
};

const financialsSlide: DeckSlideSpec = {
  id: 'financials', title: 'Financials',
  fields: [
    f.title('headline', ['ai.financials_headline']),
    f.metrics('plan', 'Plan', [
      'financials.ending_cash', 'financials.total_revenue_horizon',
      'financials.avg_monthly_burn', 'financials.runway_months',
    ]),
    f.bullets('milestones', 'Milestones', ['ai.financials_milestones']),
  ],
};

const captableSlide: DeckSlideSpec = {
  id: 'captable', title: 'Cap table',
  fields: [
    f.title('headline', ['ai.captable_headline']),
    f.bullets('holders', 'Holders', ['captable.holders']),
    f.metrics('summary', 'Summary', ['captable.total_shares', 'captable.founder_pct']),
  ],
};

const productDeepSlide: DeckSlideSpec = {
  id: 'product_deep', title: 'Product deep-dive',
  fields: [
    f.title('headline', ['ai.product_deep_headline']),
    f.para('story', 'Architecture', ['ai.product_deep_story']),
    f.image('diagram', 'Diagram / screenshot', []),
  ],
};

const roadmapSlide: DeckSlideSpec = {
  id: 'roadmap', title: 'Roadmap',
  fields: [
    f.title('headline', ['ai.roadmap_headline']),
    f.bullets('quarters', 'Next 4 quarters', ['ai.roadmap_quarters']),
  ],
};

const closingSlide: DeckSlideSpec = {
  id: 'closing', title: 'Thank you',
  fields: [
    f.title('headline', ['project.name'], 'Company name'),
    f.subtitle('cta', ['ai.closing_cta'], 'Call to action'),
    f.para('contact', 'Contact', ['project.contact_email', 'ai.closing_contact']),
  ],
};

// ---------------------------------------------------------------------
// 12 method specs.
// ---------------------------------------------------------------------
export const DECK_METHODS: DeckMethodSpec[] = [
  {
    id: 'yc_seed', key: 'yc_seed',
    label: 'YC Seed (10)',
    prompt_hint: 'The Y Combinator demo-day classic. Tight, narrative.',
    best_for: 'Pre-seed / seed founders pitching accelerators.',
    slide_count: 10,
    category: 'fundraising',
    fields_from_project: ['name', 'tagline', 'problem_statement', 'solution', 'why_now', 'tam', 'sam', 'users_count', 'revenue', 'funding_needed', 'use_of_funds'],
    fields_from_financials: ['runway_months', 'ltv_cac_ratio', 'avg_monthly_burn'],
    fields_from_captable: ['founders', 'holders'],
    ai_fill_hint: 'Tight YC-style narrative: short headlines, no fluff, numbers > prose.',
    slides: [
      titleSlide('title', 'Title'),
      problemSlide, solutionSlide, marketSlide, tractionSlide,
      businessModelSlide, gtmSlide, competitionSlide, teamSlide, askSlide,
    ],
  },
  {
    id: 'sequoia_classic', key: 'sequoia_classic',
    label: 'Sequoia Classic (12)',
    prompt_hint: 'The Sequoia 12-slide template. Story arc + market deep dive.',
    best_for: 'Seed / Series A with a clear narrative + sizable market.',
    slide_count: 12,
    category: 'fundraising',
    fields_from_project: ['name', 'tagline', 'problem_statement', 'solution', 'why_now', 'tam', 'sam', 'som', 'users_count', 'revenue', 'funding_needed', 'use_of_funds'],
    fields_from_financials: ['runway_months', 'ltv', 'ltv_cac_ratio', 'avg_monthly_burn', 'breakeven_month'],
    fields_from_captable: ['founders', 'holders'],
    ai_fill_hint: 'Sequoia narrative arc: company purpose → problem → solution → why now → market → competition → product → business model → team → financials → ask.',
    slides: [
      titleSlide('purpose', 'Company purpose'),
      problemSlide, solutionSlide,
      { ...marketSlide, id: 'why_now', title: 'Why now' },
      { ...marketSlide, id: 'market', title: 'Market size' },
      competitionSlide, productDeepSlide, businessModelSlide,
      teamSlide, financialsSlide,
      { ...tractionSlide, id: 'vision', title: 'Vision' },
      askSlide,
    ],
  },
  {
    id: 'kawasaki_10_20_30', key: 'kawasaki_10_20_30',
    label: 'Kawasaki 10/20/30 (10)',
    prompt_hint: '10 slides, 20 minutes, 30-point font. Maximum clarity.',
    best_for: 'Investor meetings where you need to be ruthlessly concise.',
    slide_count: 10,
    category: 'fundraising',
    fields_from_project: ['name', 'problem_statement', 'solution', 'tam', 'users_count', 'revenue', 'funding_needed'],
    fields_from_financials: ['runway_months', 'avg_monthly_burn'],
    fields_from_captable: ['founders'],
    ai_fill_hint: 'Kawasaki rules: each slide one idea, max 6 lines, large fonts. No appendices.',
    slides: [
      titleSlide('title', 'Title'),
      problemSlide,
      { ...solutionSlide, id: 'value_prop', title: 'Value proposition' },
      { ...solutionSlide, id: 'magic', title: 'Underlying magic' },
      businessModelSlide,
      { ...gtmSlide, id: 'gtm', title: 'Go-to-market plan' },
      competitionSlide, teamSlide,
      { ...financialsSlide, id: 'projections', title: 'Projections' },
      { ...askSlide, id: 'status_ask', title: 'Status & ask' },
    ],
  },
  {
    id: 'minimal_seed', key: 'minimal_seed',
    label: 'Minimal Seed (6)',
    prompt_hint: 'Six slides. Cold-DM-friendly, easy to share async.',
    best_for: 'Sending to investors over email; first-touch pitches.',
    slide_count: 6,
    category: 'fundraising',
    fields_from_project: ['name', 'tagline', 'problem_statement', 'solution', 'users_count', 'revenue', 'funding_needed'],
    fields_from_financials: ['runway_months'],
    fields_from_captable: ['founders'],
    ai_fill_hint: 'Six tight slides. Optimised for skimming on a phone.',
    slides: [
      titleSlide('title'), problemSlide, solutionSlide, tractionSlide, teamSlide, askSlide,
    ],
  },
  {
    id: 'series_a_growth', key: 'series_a_growth',
    label: 'Series A Growth (15)',
    prompt_hint: 'Series A: depth on cohorts, retention, GTM motion.',
    best_for: 'Companies with $500k+ ARR raising a Series A.',
    slide_count: 15,
    category: 'fundraising',
    fields_from_project: ['name', 'problem_statement', 'solution', 'tam', 'sam', 'som', 'users_count', 'revenue', 'growth_signals', 'funding_needed', 'use_of_funds'],
    fields_from_financials: ['runway_months', 'ltv', 'ltv_cac_ratio', 'avg_monthly_burn', 'breakeven_month', 'ending_cash', 'total_revenue_horizon'],
    fields_from_captable: ['founders', 'holders', 'founder_pct'],
    ai_fill_hint: 'Show repeatable GTM motion + cohort retention + capital efficiency. Concrete numbers everywhere.',
    slides: [
      titleSlide('title'), problemSlide, solutionSlide, marketSlide,
      { ...tractionSlide, id: 'traction', title: 'Traction' },
      { ...tractionSlide, id: 'cohorts', title: 'Cohort retention' },
      businessModelSlide,
      { ...gtmSlide, id: 'gtm', title: 'GTM motion' },
      { ...gtmSlide, id: 'expansion', title: 'Expansion playbook' },
      competitionSlide, productDeepSlide, roadmapSlide, teamSlide, financialsSlide, askSlide,
    ],
  },
  {
    id: 'series_b_diligence', key: 'series_b_diligence',
    label: 'Series B + Diligence (22 + appendix)',
    prompt_hint: 'Long-form Series B with diligence-grade appendix.',
    best_for: 'Series B+ rounds where investors expect a data room in slides.',
    slide_count: 22, premium: true,
    category: 'fundraising',
    fields_from_project: ['name', 'problem_statement', 'solution', 'tam', 'sam', 'som', 'users_count', 'revenue', 'growth_signals', 'funding_needed', 'use_of_funds'],
    fields_from_financials: ['runway_months', 'ltv', 'ltv_cac_ratio', 'avg_monthly_burn', 'breakeven_month', 'ending_cash', 'total_revenue_horizon'],
    fields_from_captable: ['founders', 'holders', 'founder_pct', 'total_shares'],
    ai_fill_hint: 'Diligence depth: cohorts, segment economics, capital plan, hiring plan, risks, mitigations.',
    slides: [
      // 22 core slides
      titleSlide('title'), problemSlide, solutionSlide, marketSlide,
      tractionSlide,
      { ...tractionSlide, id: 'cohorts', title: 'Cohorts' },
      { ...tractionSlide, id: 'segments', title: 'Segment economics' },
      { ...tractionSlide, id: 'retention', title: 'Net retention' },
      businessModelSlide, gtmSlide,
      { ...gtmSlide, id: 'expansion', title: 'Expansion playbook' },
      { ...gtmSlide, id: 'pipeline', title: 'Sales pipeline' },
      competitionSlide, productDeepSlide,
      { ...productDeepSlide, id: 'security', title: 'Security & compliance' },
      roadmapSlide,
      teamSlide,
      { ...teamSlide, id: 'hiring_plan', title: 'Hiring plan' },
      captableSlide, financialsSlide,
      { ...financialsSlide, id: 'capital_plan', title: 'Capital plan' },
      { ...financialsSlide, id: 'risks', title: 'Risks & mitigations' },
      askSlide,
      // Diligence appendix (additional to the 22 core slides)
      { ...marketSlide, id: 'a_metrics', title: 'Appendix: metrics deep-dive', appendix: true },
      { ...financialsSlide, id: 'a_financials', title: 'Appendix: financials', appendix: true },
      { ...financialsSlide, id: 'a_unit_econ', title: 'Appendix: unit economics', appendix: true },
      { ...captableSlide, id: 'a_captable', title: 'Appendix: cap table', appendix: true },
      { ...tractionSlide, id: 'a_cohorts', title: 'Appendix: cohort tables', appendix: true },
      { ...productDeepSlide, id: 'a_product', title: 'Appendix: product detail', appendix: true },
      { ...productDeepSlide, id: 'a_security', title: 'Appendix: security posture', appendix: true },
      { ...gtmSlide, id: 'a_gtm', title: 'Appendix: GTM motion', appendix: true },
      { ...competitionSlide, id: 'a_comp', title: 'Appendix: competition deep-dive', appendix: true },
      { ...teamSlide, id: 'a_team', title: 'Appendix: team & advisors', appendix: true },
    ],
  },
  {
    id: 'demo_day', key: 'demo_day',
    label: 'Demo Day (12)',
    prompt_hint: 'Theatrical 12 slides. Designed for a live stage.',
    best_for: 'Accelerator demo days, pitch competitions.',
    slide_count: 12,
    category: 'event',
    fields_from_project: ['name', 'tagline', 'problem_statement', 'solution', 'users_count', 'revenue', 'funding_needed'],
    fields_from_financials: ['runway_months'],
    fields_from_captable: ['founders'],
    ai_fill_hint: 'Designed for a stage. Big claims, fewer words, clear call to action at the end.',
    slides: [
      titleSlide('title'), problemSlide, solutionSlide,
      { ...solutionSlide, id: 'demo', title: 'Live demo' },
      marketSlide, tractionSlide, businessModelSlide, gtmSlide,
      competitionSlide, teamSlide, askSlide, closingSlide,
    ],
  },
  {
    id: 'sales_commercial', key: 'sales_commercial',
    label: 'Sales / Commercial (18)',
    prompt_hint: 'Buyer-facing deck. ROI, security, references.',
    best_for: 'Enterprise sales meetings; commercial pitches.',
    slide_count: 18,
    category: 'commercial',
    fields_from_project: ['name', 'tagline', 'problem_statement', 'solution', 'description'],
    fields_from_financials: [],
    fields_from_captable: [],
    ai_fill_hint: 'Buyer-facing. ROI math, deployment plan, security & compliance, references, pricing tiers, next steps.',
    slides: [
      titleSlide('title'), problemSlide, solutionSlide,
      { ...solutionSlide, id: 'why_us', title: 'Why us' },
      { ...solutionSlide, id: 'how_works', title: 'How it works' },
      productDeepSlide,
      { ...productDeepSlide, id: 'integrations', title: 'Integrations' },
      { ...tractionSlide, id: 'roi', title: 'ROI math' },
      { ...tractionSlide, id: 'case_studies', title: 'Case studies' },
      { ...tractionSlide, id: 'references', title: 'References' },
      { ...productDeepSlide, id: 'security', title: 'Security & compliance' },
      { ...productDeepSlide, id: 'deployment', title: 'Deployment plan' },
      { ...gtmSlide, id: 'pricing', title: 'Pricing' },
      { ...gtmSlide, id: 'support', title: 'Support model' },
      teamSlide, roadmapSlide,
      { ...askSlide, id: 'next_steps', title: 'Next steps' }, closingSlide,
    ],
  },
  {
    id: 'partnership_bd', key: 'partnership_bd',
    label: 'Partnership / BD (12)',
    prompt_hint: 'BD deck for channel + co-marketing partners.',
    best_for: 'Strategic partnerships, channel deals, co-marketing.',
    slide_count: 12,
    category: 'commercial',
    fields_from_project: ['name', 'tagline', 'description', 'sector'],
    fields_from_financials: [],
    fields_from_captable: [],
    ai_fill_hint: 'Frame around shared upside. Audience overlap, integration shape, co-marketing hooks.',
    slides: [
      titleSlide('title'),
      { ...problemSlide, id: 'shared_problem', title: 'Shared opportunity' },
      solutionSlide,
      { ...marketSlide, id: 'audience', title: 'Audience overlap' },
      productDeepSlide,
      { ...gtmSlide, id: 'integration', title: 'Integration shape' },
      { ...gtmSlide, id: 'gtm', title: 'Joint GTM' },
      { ...tractionSlide, id: 'proof', title: 'Proof of demand' },
      { ...gtmSlide, id: 'commercials', title: 'Commercials' },
      teamSlide, roadmapSlide, closingSlide,
    ],
  },
  {
    id: 'one_pager_teaser', key: 'one_pager_teaser',
    label: 'One-pager teaser (1)',
    prompt_hint: 'Single-page summary for cold outreach.',
    best_for: 'First-touch teaser to send to investors or partners.',
    slide_count: 1,
    category: 'narrative',
    fields_from_project: ['name', 'tagline', 'problem_statement', 'solution', 'users_count', 'revenue', 'funding_needed'],
    fields_from_financials: ['runway_months', 'ltv_cac_ratio'],
    fields_from_captable: ['founders'],
    ai_fill_hint: 'Single page. Headline, three bullets each on problem/solution/traction, the ask.',
    slides: [
      {
        id: 'one_pager', title: 'Teaser',
        fields: [
          f.title('name', ['project.name'], 'Company'),
          f.subtitle('tagline', ['project.tagline', 'ai.one_line_pitch']),
          f.bullets('problem', 'Problem', ['project.problem_statement', 'ai.problem_bullets']),
          f.bullets('solution', 'Solution', ['project.solution', 'ai.solution_bullets']),
          f.bullets('traction', 'Traction', ['project.growth_signals', 'ai.traction_bullets']),
          f.metrics('numbers', 'Numbers', ['project.users_count', 'project.revenue', 'financials.runway_months', 'financials.ltv_cac_ratio']),
          f.para('ask', 'Ask', ['project.derived.ask_line']),
          f.para('contact', 'Contact', ['project.contact_email', 'ai.closing_contact']),
        ],
      },
    ],
  },
  {
    id: 'investor_appendix', key: 'investor_appendix',
    label: 'Investor + 30pp Appendix',
    prompt_hint: 'Short investor deck plus a deep diligence appendix.',
    best_for: 'Sophisticated investors who want both a TL;DR and source data.',
    slide_count: 12, premium: true,
    category: 'fundraising',
    fields_from_project: ['name', 'problem_statement', 'solution', 'tam', 'sam', 'users_count', 'revenue', 'funding_needed', 'use_of_funds'],
    fields_from_financials: ['runway_months', 'ltv', 'ltv_cac_ratio', 'avg_monthly_burn', 'breakeven_month', 'ending_cash'],
    fields_from_captable: ['founders', 'holders', 'founder_pct'],
    ai_fill_hint: 'Lead with a 12-slide narrative, then a 30-slide appendix with source data, charts, references.',
    slides: [
      // 12-slide narrative
      titleSlide('title'), problemSlide, solutionSlide, marketSlide, tractionSlide,
      businessModelSlide, gtmSlide, competitionSlide, teamSlide, financialsSlide, askSlide, closingSlide,
      // 30-slide diligence appendix
      { ...marketSlide, id: 'a_market_size', title: 'Appendix: TAM / SAM / SOM', appendix: true },
      { ...marketSlide, id: 'a_market_segs', title: 'Appendix: market segments', appendix: true },
      { ...marketSlide, id: 'a_market_trends', title: 'Appendix: market trends', appendix: true },
      { ...tractionSlide, id: 'a_traction_chart', title: 'Appendix: revenue chart', appendix: true },
      { ...tractionSlide, id: 'a_cohorts', title: 'Appendix: cohort retention', appendix: true },
      { ...tractionSlide, id: 'a_funnel', title: 'Appendix: acquisition funnel', appendix: true },
      { ...tractionSlide, id: 'a_segments', title: 'Appendix: segment economics', appendix: true },
      { ...financialsSlide, id: 'a_pnl', title: 'Appendix: P&L history', appendix: true },
      { ...financialsSlide, id: 'a_forecast', title: 'Appendix: 3-yr forecast', appendix: true },
      { ...financialsSlide, id: 'a_unit_econ', title: 'Appendix: unit economics', appendix: true },
      { ...financialsSlide, id: 'a_burn', title: 'Appendix: burn & runway', appendix: true },
      { ...financialsSlide, id: 'a_capital_plan', title: 'Appendix: capital plan', appendix: true },
      { ...captableSlide, id: 'a_captable', title: 'Appendix: cap table', appendix: true },
      { ...captableSlide, id: 'a_dilution', title: 'Appendix: pro-forma dilution', appendix: true },
      { ...productDeepSlide, id: 'a_product', title: 'Appendix: product architecture', appendix: true },
      { ...productDeepSlide, id: 'a_roadmap_detail', title: 'Appendix: detailed roadmap', appendix: true },
      { ...productDeepSlide, id: 'a_security', title: 'Appendix: security & compliance', appendix: true },
      { ...productDeepSlide, id: 'a_data_privacy', title: 'Appendix: data & privacy', appendix: true },
      { ...productDeepSlide, id: 'a_integrations', title: 'Appendix: integrations', appendix: true },
      { ...gtmSlide, id: 'a_gtm_motion', title: 'Appendix: GTM motion', appendix: true },
      { ...gtmSlide, id: 'a_pricing', title: 'Appendix: pricing & packaging', appendix: true },
      { ...gtmSlide, id: 'a_pipeline', title: 'Appendix: sales pipeline', appendix: true },
      { ...gtmSlide, id: 'a_partners', title: 'Appendix: partnerships', appendix: true },
      { ...competitionSlide, id: 'a_comp_matrix', title: 'Appendix: competitive matrix', appendix: true },
      { ...competitionSlide, id: 'a_moats', title: 'Appendix: defensibility & moats', appendix: true },
      { ...teamSlide, id: 'a_team_bios', title: 'Appendix: team bios', appendix: true },
      { ...teamSlide, id: 'a_advisors', title: 'Appendix: advisors & investors', appendix: true },
      { ...teamSlide, id: 'a_hiring', title: 'Appendix: hiring plan', appendix: true },
      { ...roadmapSlide, id: 'a_milestones', title: 'Appendix: milestones', appendix: true },
      { ...marketSlide, id: 'a_references', title: 'Appendix: references & sources', appendix: true },
    ],
  },
  {
    id: 'narrative_brand', key: 'narrative_brand',
    label: 'Narrative / Brand (15)',
    prompt_hint: 'Story-led brand deck. Heavy on imagery + tone.',
    best_for: 'Mission-driven companies; brand-first founders.',
    slide_count: 15, premium: true,
    category: 'narrative',
    fields_from_project: ['name', 'tagline', 'description', 'problem_statement', 'solution', 'why_now'],
    fields_from_financials: [],
    fields_from_captable: ['founders'],
    ai_fill_hint: 'Story arc. Use images and quotes. Name the villain (status quo). Show the future you are building.',
    slides: [
      titleSlide('title'),
      { ...problemSlide, id: 'world_today', title: 'The world today' },
      { ...problemSlide, id: 'villain', title: 'The villain' },
      { ...solutionSlide, id: 'future', title: 'The future we want' },
      solutionSlide, productDeepSlide,
      { ...marketSlide, id: 'movement', title: 'The movement' },
      tractionSlide,
      { ...tractionSlide, id: 'voices', title: 'Voices' },
      teamSlide, businessModelSlide, gtmSlide, roadmapSlide, askSlide, closingSlide,
    ],
  },
];

export const DECK_METHODS_BY_ID: Record<DeckMethodId, DeckMethodSpec> = Object.fromEntries(
  DECK_METHODS.map((m) => [m.id, m]),
) as Record<DeckMethodId, DeckMethodSpec>;

export function getMethod(id: string | null | undefined): DeckMethodSpec | null {
  if (!id) return null;
  return DECK_METHODS_BY_ID[id as DeckMethodId] || null;
}

/** Premium template ids — gated behind Growth tier. */
export const PREMIUM_METHOD_IDS: DeckMethodId[] =
  DECK_METHODS.filter((m) => m.premium).map((m) => m.id);
