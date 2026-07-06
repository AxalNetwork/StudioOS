// Epic 1 — frontend mirror of the canonical persona taxonomy.
// Keep this file in sync with `cloudflare-worker/src/personas.ts`.
// The /api/personas/taxonomy endpoint serves the same data at runtime;
// this static copy lets components render labels and progress counts
// without an extra fetch.

export const PERSONAS = [
  {
    id: 'lp_individual',
    label: 'LP — Individual',
    short_description: 'Individual limited partner committing personal capital to the main fund.',
    role_alignment: 'partner',
    nav_extras: [{ to: '/capital', label: 'Capital & Investment' }],
    follow_up_questions: [
      { key: 'check_size_usd', prompt: 'Typical check size you write per fund (USD)?', type: 'number' },
      { key: 'accreditation', prompt: 'Are you a US-accredited investor? (yes / no / non-US)', type: 'choice', choices: ['yes', 'no', 'non-US'] },
      { key: 'sector_focus', prompt: 'Any sector/thesis focus you care about?', type: 'text' },
      { key: 'liquidity_horizon', prompt: 'Comfortable lock-up horizon? (3-5y / 5-10y / 10y+)', type: 'choice', choices: ['3-5y', '5-10y', '10y+'] },
    ],
  },
  {
    id: 'lp_institutional',
    label: 'LP — Institutional',
    short_description: 'Institutional LP (endowment, foundation, pension, fund-of-funds).',
    role_alignment: 'partner',
    nav_extras: [{ to: '/capital', label: 'Capital & Investment' }, { to: '/funds', label: 'Funds' }],
    follow_up_questions: [
      { key: 'institution_name', prompt: 'Institution name?', type: 'text' },
      { key: 'aum_usd', prompt: 'Approximate AUM (USD)?', type: 'number' },
      { key: 'allocation_target_usd', prompt: 'Target allocation to venture this cycle (USD)?', type: 'number' },
      { key: 'mandate_constraints', prompt: 'Any mandate constraints (geography, sector, ESG, ticket cap)?', type: 'text' },
    ],
  },
  {
    id: 'gp_external',
    label: 'GP — External Fund',
    short_description: 'GP running an external fund interested in deal-by-deal collaboration.',
    role_alignment: 'partner',
    nav_extras: [{ to: '/deals', label: 'Deal Flow' }, { to: '/pipeline', label: 'Pipeline Board' }],
    follow_up_questions: [
      { key: 'fund_name', prompt: 'Fund name?', type: 'text' },
      { key: 'fund_stage', prompt: 'Stage focus? (Pre-seed / Seed / Series A / Multi-stage)', type: 'choice', choices: ['Pre-seed', 'Seed', 'Series A', 'Multi-stage'] },
      { key: 'avg_check_size_usd', prompt: 'Average check size (USD)?', type: 'number' },
      { key: 'collab_intent', prompt: 'Looking for co-investment, deal sharing, or both?', type: 'choice', choices: ['co-investment', 'deal sharing', 'both'] },
    ],
  },
  {
    id: 'angel_scout',
    label: 'Angel / Scout',
    short_description: 'Individual angel or scout sourcing and writing small early checks.',
    role_alignment: 'partner',
    nav_extras: [{ to: '/refer', label: 'Refer & Earn' }, { to: '/deals', label: 'Deal Flow' }],
    follow_up_questions: [
      { key: 'check_size_usd', prompt: 'Typical angel check size (USD)?', type: 'number' },
      { key: 'deals_per_year', prompt: 'How many deals per year do you write?', type: 'number' },
      { key: 'sector_focus', prompt: 'Sectors you focus on?', type: 'text' },
      { key: 'value_add', prompt: 'Primary value-add to founders (intros, GTM, hiring, technical)?', type: 'text' },
    ],
  },
  {
    id: 'corporate_vc',
    label: 'Corporate VC',
    short_description: 'Strategic / corporate VC arm of an operating company.',
    role_alignment: 'partner',
    nav_extras: [{ to: '/deals', label: 'Deal Flow' }, { to: '/legal-capital', label: 'Legal & Capital' }],
    follow_up_questions: [
      { key: 'parent_company', prompt: 'Parent company?', type: 'text' },
      { key: 'strategic_thesis', prompt: 'Strategic thesis (what unlocks value for the parent)?', type: 'text' },
      { key: 'avg_check_size_usd', prompt: 'Average check size (USD)?', type: 'number' },
      { key: 'commercial_attachment', prompt: 'Do you typically attach commercial agreements (POC, distribution, M&A right of first refusal)?', type: 'choice', choices: ['yes', 'no', 'sometimes'] },
    ],
  },
  {
    id: 'sovereign_family_office',
    label: 'Sovereign / Family Office',
    short_description: 'Sovereign wealth, family office, or multi-family office investor.',
    role_alignment: 'partner',
    nav_extras: [{ to: '/capital', label: 'Capital & Investment' }, { to: '/liquidity', label: 'Liquidity & Exits' }],
    follow_up_questions: [
      { key: 'office_name', prompt: 'Office name?', type: 'text' },
      { key: 'aum_usd', prompt: 'Approximate AUM (USD)?', type: 'number' },
      { key: 'allocation_target_usd', prompt: 'Venture allocation target (USD)?', type: 'number' },
      { key: 'co_invest_appetite', prompt: 'Appetite for direct co-investment alongside fund commitments?', type: 'choice', choices: ['yes', 'no', 'selective'] },
    ],
  },
  {
    id: 'academic',
    label: 'Academic / Lab',
    short_description: 'Academic researcher, university tech-transfer office, or research lab.',
    role_alignment: 'partner',
    nav_extras: [],
    follow_up_questions: [
      { key: 'institution', prompt: 'Institution / lab name?', type: 'text' },
      { key: 'research_area', prompt: 'Primary research area?', type: 'text' },
      { key: 'commercial_intent', prompt: 'Spin-out, license, or just collaboration?', type: 'choice', choices: ['spin-out', 'license', 'collaboration'] },
      { key: 'ip_status', prompt: 'IP status (filed / granted / disclosure-only / none)?', type: 'choice', choices: ['filed', 'granted', 'disclosure-only', 'none'] },
    ],
  },
  {
    id: 'founder_new',
    label: 'Founder — New Venture',
    short_description: 'Founder spinning out a brand-new venture through the 30-day engine.',
    role_alignment: 'founder',
    nav_extras: [{ to: '/founder', label: 'Founder Portal' }, { to: '/spinouts', label: 'Spin-Outs' }],
    follow_up_questions: [
      { key: 'venture_idea', prompt: 'One-line description of the venture?', type: 'text' },
      { key: 'sector', prompt: 'Sector / industry?', type: 'text' },
      { key: 'jurisdiction', prompt: 'Preferred incorporation jurisdiction? (Delaware / UK / Singapore)', type: 'choice', choices: ['Delaware', 'UK', 'Singapore'] },
      { key: 'cofounders', prompt: 'Co-founders (names + roles), or solo?', type: 'text' },
    ],
  },
  {
    id: 'founder_existing',
    label: 'Founder — Existing Company',
    short_description: 'Founder of an existing company on the Strategic Scale partnership track.',
    role_alignment: 'founder',
    nav_extras: [{ to: '/founder', label: 'Founder Portal' }, { to: '/legal-capital', label: 'Legal & Capital' }],
    follow_up_questions: [
      { key: 'company_name', prompt: 'Company name?', type: 'text' },
      { key: 'current_stage', prompt: 'Current stage? (Pre-seed / Seed / Series A / Series B+ / Bootstrapped/Profitable)', type: 'choice', choices: ['Pre-seed', 'Seed', 'Series A', 'Series B+', 'Bootstrapped/Profitable'] },
      { key: 'partnership_goal', prompt: 'Primary goal? (Capital / AI integration / Distribution / M&A)', type: 'choice', choices: ['Capital', 'AI Integration (StudioOS)', 'Distribution / GTM', 'M&A / Liquidity'] },
      { key: 'existing_investors', prompt: 'Existing investors / cap-table summary (one line)?', type: 'text' },
    ],
  },
  {
    id: 'operator_advisor',
    label: 'Operator / Advisor',
    short_description: 'Operating partner or advisor offering sweat-equity expertise to spin-outs.',
    role_alignment: 'partner',
    nav_extras: [{ to: '/matches', label: 'AI Matches' }, { to: '/projects', label: 'Startups' }],
    follow_up_questions: [
      { key: 'expertise', prompt: 'Primary expertise area (e.g. GTM, eng, finance, product)?', type: 'text' },
      { key: 'years_experience', prompt: 'Years of senior operating experience?', type: 'number' },
      { key: 'time_per_week_hours', prompt: 'Hours per week you can commit?', type: 'number' },
      { key: 'compensation_pref', prompt: 'Compensation preference (equity / cash / hybrid)?', type: 'choice', choices: ['equity', 'cash', 'hybrid'] },
    ],
  },
  {
    id: 'service_provider',
    label: 'Service Provider',
    short_description: 'Legal, technical, or other service provider to the studio.',
    role_alignment: 'partner',
    nav_extras: [],
    follow_up_questions: [
      { key: 'service_type', prompt: 'Type of service (Legal / Technical / Accounting / Other)?', type: 'choice', choices: ['Legal', 'Technical', 'Accounting', 'Other'] },
      { key: 'firm_name', prompt: 'Firm name?', type: 'text' },
      { key: 'pricing_model', prompt: 'Pricing model (fixed-fee / hourly / equity / hybrid)?', type: 'choice', choices: ['fixed-fee', 'hourly', 'equity', 'hybrid'] },
      { key: 'jurisdictions', prompt: 'Jurisdictions you cover?', type: 'text' },
    ],
  },
  {
    id: 'press_analyst',
    label: 'Press / Analyst',
    short_description: 'Journalist, industry analyst, or research publication.',
    role_alignment: 'partner',
    nav_extras: [],
    follow_up_questions: [
      { key: 'outlet', prompt: 'Outlet / publication?', type: 'text' },
      { key: 'beat', prompt: 'Coverage beat?', type: 'text' },
      { key: 'engagement_type', prompt: 'Looking for briefings, embargoed news, or both?', type: 'choice', choices: ['briefings', 'embargoed news', 'both'] },
    ],
  },
];

export const PERSONA_BY_ID = Object.fromEntries(PERSONAS.map((p) => [p.id, p]));

export function getPersona(id) {
  if (!id) return null;
  return PERSONA_BY_ID[id] || null;
}
