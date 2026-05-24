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
  | 'narrative_brand'
  // Task #15 — Axal 30-day Spin-Out Lab demo day deck. 14 fixed slides,
  // 4 visual variants. Autofill is special-cased in routes/decks.ts
  // (apply-method short-circuits to services/decks/axalSpinoutDemoDay.ts)
  // because the data shape — interview lists, milestone weeks, lab
  // progress — doesn't fit the generic field-source vocabulary.
  | 'axal_spinout_demoday';

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
    // Sequoia Classic — narrative-driven 12-slide deck.
    // Field keys here MUST match the data paths read by
    // frontend/src/decks/templates/sequoia_classic.tsx — the print
    // viewer flattens slides[].fields[] into one dict keyed by
    // field.key and passes it straight to the template.
    id: 'sequoia_classic', key: 'sequoia_classic',
    label: 'Sequoia Classic (12)',
    prompt_hint: 'Narrative-driven 12-slide investor deck. Future → Shift → Broken → Insight → Opportunity → Solution → Product → Why We Win → Traction → Flywheel → Team → Vision.',
    best_for: 'Seed / Series A with a clear narrative + sizable market.',
    slide_count: 12,
    category: 'narrative',
    fields_from_project: ['name', 'tagline', 'problem_statement', 'solution', 'why_now', 'tam', 'sam', 'som', 'users_count', 'revenue', 'funding_needed', 'use_of_funds', 'sector', 'contact_email'],
    fields_from_financials: ['mrr', 'mrr_usd', 'runway_months', 'ltv', 'ltv_cac_ratio', 'avg_monthly_burn', 'breakeven_month', 'mom_growth_pct', 'nrr_pct'],
    fields_from_captable: ['founders', 'holders'],
    ai_fill_hint: 'Sequoia narrative arc — each slide one big idea. Future: a single declarative line about the world in 10 years. Shift: three forces converging. Broken: today\u2019s done-by-hand reality. Insight: the non-obvious truth competitors miss. Opportunity: TAM/SAM/SOM with CAGR. Solution: company, one-liner, before vs after. Product: three pillars. Why We Win: positioning + moats. Traction: MRR, customers, MoM, NRR. Flywheel: compounding loop. Team: founders + journey. Vision: headline, roadmap, ask, runway.',
    slides: [
      {
        id: 'future', title: 'The Future',
        fields: [
          f.subtitle('future_year', ['ai.future_year'], 'Year'),
          f.title('future_headline', ['ai.future_headline'], 'The future world in one line'),
          f.para('future_subline', 'Subline', ['ai.future_subline'], 'A single declarative line that sets the horizon.'),
        ],
      },
      {
        id: 'shift', title: 'The Shift',
        fields: [
          f.title('shift_title', ['ai.shift_title'], 'The forces converging now'),
          f.para('shift_body', 'Body', ['project.why_now', 'ai.shift_body']),
          f.bullets('shift_curves', 'Forces (one per line)', ['ai.shift_curve_labels']),
        ],
      },
      {
        id: 'broken', title: 'The Broken Reality',
        fields: [
          f.title('broken_title', ['ai.broken_title'], 'Today, this work is done by hand.'),
          f.bullets('broken_pillars', 'What\u2019s broken (3 pillars)', ['project.problem_statement', 'ai.broken_pillars']),
        ],
      },
      {
        id: 'insight', title: 'The Insight',
        fields: [
          f.subtitle('insight_label', ['ai.insight_label'], 'WHAT EVERYONE ELSE MISSES'),
          f.title('insight_headline', ['ai.insight_headline'], 'The non-obvious truth'),
          f.para('insight_body', 'Body', ['ai.insight_body']),
          f.bullets('insight_proofs', 'Proofs (3 lines)', ['ai.insight_proofs']),
        ],
      },
      {
        id: 'opportunity', title: 'The Opportunity',
        fields: [
          f.title('opportunity_headline', ['ai.opportunity_headline'], 'A category measured in tens of billions.'),
          f.para('tam_usd', 'TAM (USD)', ['project.tam']),
          f.para('sam_usd', 'SAM (USD)', ['project.sam']),
          f.para('som_usd', 'SOM (USD)', ['project.som']),
          f.para('market_cagr_pct', 'CAGR (%)', ['project.market_cagr_pct', 'ai.market_cagr_pct']),
          // Year:value pairs ("2024:38"); flattener parses to {year,v}.
          f.bullets('market_curve', 'Market curve (year:value, 5 lines)', ['ai.market_curve']),
        ],
      },
      {
        id: 'solution', title: 'The Solution',
        fields: [
          f.title('company', ['project.name'], 'Company'),
          f.para('solution_one_liner', 'One-liner', ['project.solution', 'ai.solution_one_liner']),
          f.subtitle('category', ['project.sector', 'ai.category'], 'Category'),
          f.bullets('before_state', 'Before (4 lines)', ['ai.before_state']),
          f.bullets('after_state', 'After (4 lines)', ['ai.after_state']),
        ],
      },
      {
        id: 'product', title: 'The Product',
        fields: [
          f.title('product_headline', ['ai.product_headline'], 'Three layers. One platform.'),
          f.bullets('product_pillars', 'Pillars (3 lines)', ['ai.product_pillars']),
          // Architecture columns. "Capture: Web, API, Mobile" → column.
          f.bullets('product_modules', 'Architecture modules (Col: node, node)', ['ai.product_modules']),
        ],
      },
      {
        id: 'why_we_win', title: 'Why We Win',
        fields: [
          f.title('why_we_win_headline', ['ai.why_we_win_headline'], 'The moats compound.'),
          f.bullets('moats', 'Moats (3 lines)', ['ai.moats']),
          f.subtitle('axis_x', ['ai.axis_x'], 'X-axis label'),
          f.subtitle('axis_y', ['ai.axis_y'], 'Y-axis label'),
          // "Name | x | y" 0–100 each; "Us"/"We" rendered as crimson focal pin.
          f.bullets('competitors', 'Competitors (Name | x | y, 0–100)', ['ai.competitors']),
        ],
      },
      {
        id: 'traction', title: 'Traction',
        fields: [
          f.title('traction_headline', ['ai.traction_headline'], 'The numbers'),
          f.para('mrr_usd', 'MRR (USD)', ['financials.mrr_usd', 'financials.mrr', 'project.revenue']),
          f.para('paying_customers', 'Paying customers', ['project.users_count']),
          f.para('growth_mom_pct', 'MoM growth (%)', ['financials.mom_growth_pct', 'ai.growth_mom_pct']),
          f.para('nrr_pct', 'NRR (%)', ['financials.nrr_pct', 'ai.nrr_pct']),
          f.bullets('customer_logos', 'Logos (6 lines)', ['ai.customer_logos']),
          // Month:value pairs; flattener parses to {month,v}.
          f.bullets('revenue_curve', 'Revenue curve (month:value)', ['financials.revenue_curve', 'ai.revenue_curve']),
          f.bullets('user_curve', 'Users curve (month:value)', ['financials.user_curve', 'ai.user_curve']),
          f.bullets('retention_curve', 'Retention by cohort (M0:100, M1:92, …)', ['financials.retention_curve', 'ai.retention_curve']),
        ],
      },
      {
        id: 'flywheel', title: 'The Flywheel',
        fields: [
          f.title('flywheel_headline', ['ai.flywheel_headline'], 'Each turn makes the next one easier.'),
          f.bullets('flywheel_nodes', 'Nodes (5 lines)', ['ai.flywheel_nodes']),
        ],
      },
      {
        id: 'team', title: 'The Team',
        fields: [
          f.title('team_headline', ['ai.team_headline'], 'Operators with scar tissue.'),
          f.bullets('founders', 'Founders (2 lines)', ['captable.founders', 'ai.founders']),
          f.bullets('team_timeline', 'Journey (3 lines)', ['ai.team_timeline']),
        ],
      },
      {
        id: 'vision', title: 'The Vision',
        fields: [
          f.title('vision_headline', ['project.derived.ask_line', 'ai.vision_headline'], 'Raising $— to build the company that defines this decade.'),
          f.para('vision_body', 'Body', ['ai.vision_body']),
          f.bullets('roadmap', 'Roadmap (4 lines)', ['ai.roadmap_quarters']),
          f.para('ask_amount_usd', 'Ask (USD)', ['project.funding_needed']),
          f.para('runway_months', 'Runway (months)', ['financials.runway_months']),
          f.bullets('use_of_funds', 'Use of funds (4 lines)', ['project.use_of_funds', 'ai.use_of_funds']),
          f.para('contact', 'Contact', ['project.contact_email', 'ai.closing_contact']),
          f.para('closing_line', 'Closing line', ['ai.closing_line']),
        ],
      },
    ],
  },
  {
    // Kawasaki 10/20/30 — investor-grade 10-slide deck, one question
    // per slide, single accent, generous whitespace. Field keys here
    // MUST match the data paths read by
    // frontend/src/decks/templates/kawasaki_10_20_30.tsx — the print
    // viewer flattens slides[].fields[] into one dict keyed by
    // field.key and passes it straight to the template.
    id: 'kawasaki_10_20_30', key: 'kawasaki_10_20_30',
    label: 'Kawasaki 10/20/30 (10)',
    prompt_hint: '10 slides, 20 minutes, 30-point font. Maximum clarity.',
    best_for: 'Investor meetings where you need to be ruthlessly concise.',
    slide_count: 10,
    category: 'fundraising',
    fields_from_project: ['name', 'problem_statement', 'solution', 'business_model', 'tam', 'users_count', 'revenue', 'funding_needed', 'use_of_funds', 'sector', 'contact_email'],
    fields_from_financials: ['mrr_usd', 'runway_months', 'avg_monthly_burn', 'gross_margin_pct', 'mom_growth_pct', 'nrr_pct', 'payback_months', 'avg_contract_usd'],
    fields_from_captable: ['founders'],
    ai_fill_hint: 'Kawasaki rules: each slide answers ONE question, max 6 lines, large fonts. One accent colour. No appendices. Headlines must read from the back of a room.',
    slides: [
      {
        id: 'problem', title: 'What is broken?',
        fields: [
          f.title('problem_headline', ['project.problem_statement', 'ai.problem_headline'], 'Problem in one line'),
          f.para('problem_support', 'Support line', ['ai.problem_support'], 'Cost of inaction in one sentence.'),
          // "value | label" — flattener parses both halves.
          f.para('problem_stat', 'Big stat (value | label)', ['ai.problem_stat']),
        ],
      },
      {
        id: 'solution', title: 'What is the fix?',
        fields: [
          f.title('solution_headline', ['project.solution', 'ai.solution_headline'], 'Solution in 5 words'),
          f.para('solution_support', 'Support line', ['ai.solution_support']),
          f.bullets('solution_pillar_words', 'Pillar words (3 lines)', ['ai.solution_pillar_words']),
        ],
      },
      {
        id: 'business_model', title: 'How do we earn?',
        fields: [
          f.title('bm_headline', ['project.business_model', 'ai.bm_headline'], 'Pricing in one line'),
          // "Customer → Subscription : pays" per line; flattener parses.
          f.bullets('revenue_flow', 'Revenue flow (From → To : label)', ['ai.revenue_flow']),
          f.metrics('bm_unit', 'Unit economics (ACV / Gross margin / Payback)', [
            'financials.avg_contract_usd', 'project.avg_contract_usd',
            'financials.gross_margin_pct', 'financials.payback_months',
          ]),
        ],
      },
      {
        id: 'magic', title: 'Why us, not them?',
        fields: [
          f.title('magic_headline', ['ai.magic_headline'], 'The non-obvious moat'),
          f.para('magic_support', 'Support line', ['ai.magic_support']),
          f.bullets('magic_capabilities', 'Core capabilities (3 lines)', ['ai.magic_capabilities']),
        ],
      },
      {
        id: 'gtm', title: 'How do we reach them?',
        fields: [
          // "Visitors: 12000" per line; flattener parses to {stage,v}.
          f.bullets('funnel', 'Funnel (Stage: count)', ['ai.gtm_funnel']),
        ],
      },
      {
        id: 'competition', title: 'Who else is here?',
        fields: [
          f.subtitle('axis_x', ['ai.axis_x'], 'X-axis label'),
          f.subtitle('axis_y', ['ai.axis_y'], 'Y-axis label'),
          // "Name | x | y" 0–100; "Us"/"We" rendered as the focal pin.
          f.bullets('competitors', 'Competitors (Name | x | y, 0–100)', ['ai.competitors']),
        ],
      },
      {
        id: 'team', title: 'Who is shipping this?',
        fields: [
          f.bullets('founders', 'Founders (2 lines)', ['captable.founders', 'ai.founders']),
          f.bullets('team_timeline', 'Journey (3 lines, "2014 — event")', ['ai.team_timeline']),
        ],
      },
      {
        id: 'projections', title: 'Where are we going?',
        fields: [
          // "2024:0.2" pairs (USD M); flattener parses to {label,v}.
          f.bullets('revenue_series', 'Revenue series (year:value M)', ['financials.revenue_series', 'ai.revenue_series']),
          f.bullets('milestones', 'Milestones (4 lines, "2025: First $1M ARR")', ['ai.milestones']),
        ],
      },
      {
        id: 'status', title: 'What evidence exists?',
        fields: [
          f.para('mrr_usd', 'MRR (USD)', ['financials.mrr_usd', 'financials.mrr', 'project.revenue']),
          f.para('paying_customers', 'Paying customers', ['project.users_count']),
          f.para('growth_mom_pct', 'MoM growth (%)', ['financials.mom_growth_pct', 'ai.growth_mom_pct']),
          f.para('nrr_pct', 'NRR (%)', ['financials.nrr_pct', 'ai.nrr_pct']),
          // "Jan:120" per line; flattener parses to {label,v}.
          f.bullets('user_series', 'Users by month (Jan:120, …)', ['financials.user_series', 'ai.user_series']),
        ],
      },
      {
        id: 'ask', title: 'Why invest now?',
        fields: [
          f.para('ask_amount_usd', 'Ask (USD)', ['project.funding_needed']),
          f.para('runway_months', 'Runway (months)', ['financials.runway_months']),
          // "Engineering: 45" per line; flattener parses to {label,pct}.
          f.bullets('use_of_funds', 'Use of funds (4 lines, "Label: 45")', ['project.use_of_funds', 'ai.use_of_funds']),
          f.para('closing_line', 'Closing line', ['ai.closing_line']),
          f.para('contact', 'Contact', ['project.contact_email', 'ai.closing_contact']),
        ],
      },
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
    category: 'commercial',
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
  // Task #15 — Axal 30-day Spin-Out Lab demo day.
  //
  // The slide list below is informational only — the picker uses it for
  // count + appendix flags, but routes/decks.ts `/apply-method`
  // short-circuits for this method_id and writes per-section JSON-
  // encoded paragraph fields via fillAxalSpinoutDemoDay(). The
  // self-contained adapter (axal_spinout_demoday_app.tsx) reads those
  // sections back from buildTemplateData and merges them onto its
  // canonical SAMPLE_DATA shape via mergeShape().
  {
    id: 'axal_spinout_demoday', key: 'axal_spinout_demoday',
    label: 'Axal VC Spin-Out',
    prompt_hint: 'Demo Day deck for pre-incorporation founders graduating the 30-day Spin-Out Lab.',
    best_for: 'Founders in or graduating the Axal Spin-Out Lab. Audience: Axal-network investors and partners.',
    slide_count: 14,
    premium: true,
    category: 'event',
    fields_from_project: ['name', 'sector', 'tagline', 'problem_statement', 'solution', 'why_now', 'tam', 'sam', 'som', 'contact_email', 'vision', 'traction_summary'],
    fields_from_financials: ['runway_months', 'use_of_funds'],
    fields_from_captable: ['founders', 'all_holders'],
    ai_fill_hint: 'Honesty over polish. If a number is missing, leave the em-dash placeholder so the founder sees what to fill in.',
    // Spec-required 14-slide sequence: Cover · Problem · Validation ·
    // Market · Solution · Roadmap · Brand · Venture Readiness · Team ·
    // Mentor+Network · Cap Table · Ask · Axal Signal · Contact.
    // Field keys mirror buildAxalSpinoutDemoDaySlides() so the editor
    // renders real text/bullet/metric-grid inputs (not raw JSON).
    slides: [
      { id: 'cover', title: 'Cover', fields: [
        f.para('cover_eyebrow', 'Eyebrow', []),
        f.para('cover_headline', 'Headline', []),
        f.para('cover_sub', 'Sub-line', []),
        f.para('cover_location', 'Location', []),
        // Deck-wide envelope (project name, founder, week, etc.) — JSON-only.
        f.para('meta_json', 'Meta (JSON, do not edit)', []),
      ] },
      { id: 'problem', title: 'Problem', fields: [
        f.para('problem_eyebrow', 'Eyebrow', []),
        f.para('problem_headline', 'Headline', []),
        f.para('problem_body', 'Problem statement', []),
        f.bullets('problem_signals', 'Growth signals', []),
      ] },
      { id: 'validation', title: 'Validation', fields: [
        f.para('validation_eyebrow', 'Eyebrow', []),
        f.para('validation_headline', 'Headline', []),
        f.para('validation_body', 'Why now', []),
        f.metrics('validation_metrics', 'Interviews / pains / hypotheses', []),
        f.para('validation_quotes_json', 'Discovery quotes (JSON, from Lab)', []),
      ] },
      { id: 'market', title: 'Market', fields: [
        f.para('market_eyebrow', 'Eyebrow', []),
        f.para('market_headline', 'Headline', []),
        f.para('market_tam', 'TAM', []),
        f.para('market_sam', 'SAM', []),
        f.para('market_som', 'SOM', []),
        f.bullets('market_why_now', 'Why now', []),
      ] },
      { id: 'solution', title: 'Solution', fields: [
        f.para('solution_eyebrow', 'Eyebrow', []),
        f.para('solution_headline', 'Headline', []),
        f.para('solution_body', 'Solution body', []),
        f.bullets('solution_capabilities', 'Capabilities', []),
      ] },
      { id: 'roadmap', title: 'Roadmap', fields: [
        f.para('roadmap_eyebrow', 'Eyebrow', []),
        f.para('roadmap_headline', 'Headline', []),
        f.para('roadmap_quarter', 'Quarter', []),
        f.bullets('roadmap_now', 'Now', []),
        f.bullets('roadmap_next', 'Next', []),
        f.bullets('roadmap_later', 'Later', []),
      ] },
      { id: 'brand', title: 'Brand', fields: [
        f.para('brand_eyebrow', 'Eyebrow', []),
        f.para('brand_headline', 'Headline', []),
        f.para('brand_tagline', 'Tagline', []),
        f.para('brand_vision', 'Vision', []),
        f.para('brand_status_json', 'Readiness flags (JSON, from Lab)', []),
      ] },
      { id: 'venture_readiness', title: 'Venture readiness', fields: [
        f.para('vr_eyebrow', 'Eyebrow', []),
        f.para('vr_headline', 'Headline', []),
        f.para('vr_total_score', 'Total score', []),
        f.para('vr_tier', 'Tier', []),
        f.para('vr_sandbox', 'Sandbox flag (true / false)', []),
        f.metrics('vr_breakdown', 'Sub-scores', []),
        f.para('vr_ai_notes', 'AI notes', []),
      ] },
      { id: 'team', title: 'Team', fields: [
        f.para('team_eyebrow', 'Eyebrow', []),
        f.para('team_headline', 'Headline', []),
        f.para('team_intro', 'Team intro', []),
        f.para('team_founders_json', 'Founders (JSON, from Lab)', []),
      ] },
      { id: 'mentor_network', title: 'Mentors & network', fields: [
        f.para('mn_eyebrow', 'Eyebrow', []),
        f.title('mn_headline', []),
        f.para('mn_body', 'Body', []),
        f.bullets('mn_mentors', 'Mentors', []),
        f.bullets('mn_network_signals', 'Network signals', []),
      ] },
      { id: 'cap_table', title: 'Cap table', fields: [
        f.para('ct_eyebrow', 'Eyebrow', []),
        f.para('ct_headline', 'Headline', []),
        f.para('ct_note', 'Footnote', []),
        f.para('ct_holders_json', 'Holders (JSON, from Lab)', []),
      ] },
      { id: 'ask', title: 'Ask', fields: [
        f.para('ask_eyebrow', 'Eyebrow', []),
        f.para('ask_headline', 'Headline', []),
        f.para('ask_raise_amount', 'Raise amount', []),
        f.para('ask_runway', 'Runway', []),
        f.metrics('ask_use_of_funds', 'Use of funds', []),
        f.bullets('ask_next_milestones', 'Next milestones', []),
      ] },
      { id: 'axal_signal', title: 'Axal signal', fields: [
        f.para('as_eyebrow', 'Eyebrow', []),
        f.para('as_headline', 'Headline', []),
        f.para('as_body', 'Body', []),
        f.para('as_lab_weeks_json', 'Lab weeks (JSON, from Lab)', []),
      ] },
      { id: 'contact', title: 'Contact', fields: [
        f.para('contact_eyebrow', 'Eyebrow', []),
        f.para('contact_headline', 'Headline', []),
        f.para('contact_body', 'Body', []),
        f.para('contact_email', 'Contact email', []),
        f.para('contact_signoff', 'Signoff', []),
      ] },
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
