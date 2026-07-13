// Advisor Research — deterministic mock data for the advisor Research workspace
// (Market, Companies, AI Research, Documents, News). This is placeholder data
// only: there is no backend behind it yet, so it is modelled here and structured
// to be swapped for a live API later. Everything is deterministic — the demo
// "today" is fixed at 2026-07-11 and no value depends on Date.now / Math.random
// / a zero-argument new Date(). Dates are plain ISO strings. AI surfaces are
// clearly labelled as sample output in the UI.

export const TODAY = '2026-07-11';
const TODAY_MS = new Date(TODAY).getTime();
const DAY = 86400000;

// Deterministic date/format helpers ----------------------------------------
export function daysAgo(n) {
  return new Date(TODAY_MS - n * DAY).toISOString().slice(0, 10);
}
export function formatDay(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
export function formatRelativeDay(iso) {
  if (!iso) return '—';
  const diff = Math.round((new Date(iso).getTime() - TODAY_MS) / DAY);
  if (diff === 0) return 'Today';
  if (diff === -1) return 'Yesterday';
  if (diff < 0) return `${-diff}d ago`;
  return `in ${diff}d`;
}
export function money(v) {
  if (v == null) return '—';
  if (Math.abs(v) >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(v % 1_000_000_000 === 0 ? 0 : 1)}B`;
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(v % 1_000_000 === 0 ? 0 : 1)}M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(v % 1_000 === 0 ? 0 : 1)}K`;
  return `$${v.toLocaleString()}`;
}

// ===========================================================================
// MARKET — Industries, Sectors, Trends, Geography, Macro Analysis
// ===========================================================================
export const MARKET_TABS = [
  { id: 'industries', label: 'Industries' },
  { id: 'sectors', label: 'Sectors' },
  { id: 'trends', label: 'Trends' },
  { id: 'geography', label: 'Geography' },
  { id: 'macro', label: 'Macro Analysis' },
];

export const INDUSTRIES = [
  {
    id: 'ind-wealth', name: 'Wealth Management', marketSize: 128_000_000_000, growth: 11, companies: 3400,
    momentum: 'Growing', multiple: 12,
    description: 'Advisory, planning, and asset management serving high-net-worth and mass-affluent households.',
    keyTrends: ['Fee compression', 'Model portfolios', 'Hybrid advice'],
    topPlayers: ['Fidelity', 'Charles Schwab', 'Vanguard', 'Morgan Stanley'],
    outlook: 'The great wealth transfer and demand for holistic planning are expanding the advisor opportunity even as fees compress.',
  },
  {
    id: 'ind-insurance', name: 'Insurance & Annuities', marketSize: 96_000_000_000, growth: 8, companies: 2600,
    momentum: 'Selective', multiple: 9,
    description: 'Life, annuity, and protection products used within holistic client plans.',
    keyTrends: ['Annuity resurgence', 'Digital underwriting', 'Guaranteed income demand'],
    topPlayers: ['Prudential', 'Lincoln Financial', 'MassMutual', 'Athene'],
    outlook: 'Higher rates have revived annuity demand; guaranteed-income solutions are back at the center of retirement planning.',
  },
  {
    id: 'ind-retirement', name: 'Retirement & Pensions', marketSize: 84_000_000_000, growth: 9, companies: 1900,
    momentum: 'Growing', multiple: 10,
    description: 'Defined contribution, IRA rollovers, and decumulation solutions for retiring households.',
    keyTrends: ['Rollover wave', 'Decumulation planning', 'Managed accounts'],
    topPlayers: ['Empower', 'Fidelity', 'Vanguard', 'Principal'],
    outlook: 'A record cohort entering retirement is driving rollover flows and demand for structured decumulation advice.',
  },
  {
    id: 'ind-fintech', name: 'Advisor FinTech', marketSize: 62_000_000_000, growth: 19, companies: 2100,
    momentum: 'Aggressive', multiple: 14,
    description: 'Planning software, CRM, portfolio tools, and custody platforms serving advisors.',
    keyTrends: ['AI planning copilots', 'Direct indexing', 'Unified advisor desktops'],
    topPlayers: ['Envestnet', 'Orion', 'Addepar', 'eMoney'],
    outlook: 'AI-native workflows and direct indexing are reshaping the advisor tech stack and expanding software budgets.',
  },
  {
    id: 'ind-realestate', name: 'Real Estate & Alts', marketSize: 108_000_000_000, growth: 13, companies: 1500,
    momentum: 'Growing', multiple: 11,
    description: 'Private markets, real assets, and alternative allocations entering advisor portfolios.',
    keyTrends: ['Retail alts access', 'Interval funds', 'Private credit'],
    topPlayers: ['Blackstone', 'Apollo', 'iCapital', 'CAIS'],
    outlook: 'Democratized access to private markets is pulling alternatives into mainstream advisor allocations.',
  },
];

export const SECTORS = [
  { id: 'sec-directindex', name: 'Direct Indexing', industry: 'Advisor FinTech', marketSize: 21_000_000_000, growth: 34, momentum: 'Aggressive', multiple: 16, notableDeals: ['Parametric — model expansion', 'Vise — $65M'], summary: 'Personalized, tax-managed index portfolios at the household level.' },
  { id: 'sec-privcredit', name: 'Private Credit', industry: 'Real Estate & Alts', marketSize: 45_000_000_000, growth: 28, momentum: 'Aggressive', multiple: 12, notableDeals: ['Apollo retail fund', 'Blue Owl BDC'], summary: 'Direct lending and credit strategies now accessible in advisor portfolios.' },
  { id: 'sec-annuities', name: 'Guaranteed Income Annuities', industry: 'Insurance & Annuities', marketSize: 32_000_000_000, growth: 22, momentum: 'Growing', multiple: 9, notableDeals: ['Athene FIA launch', 'Corebridge suite'], summary: 'Fixed and indexed annuities providing guaranteed retirement income.' },
  { id: 'sec-rollovers', name: 'IRA Rollovers', industry: 'Retirement & Pensions', marketSize: 27_000_000_000, growth: 15, momentum: 'Growing', multiple: 10, notableDeals: ['Empower rollover center', 'Capitalize partnership'], summary: 'Consolidation of workplace retirement assets into advisor-managed IRAs.' },
  { id: 'sec-planningsw', name: 'Financial Planning Software', industry: 'Advisor FinTech', marketSize: 14_000_000_000, growth: 26, momentum: 'Aggressive', multiple: 15, notableDeals: ['eMoney AI copilot', 'RightCapital — $50M'], summary: 'Cash-flow, goals, and scenario planning tools for advisors.' },
  { id: 'sec-esg', name: 'Values-Based Investing', industry: 'Wealth Management', marketSize: 18_000_000_000, growth: 12, momentum: 'Selective', multiple: 10, notableDeals: ['Ethic — expansion', 'OpenInvest integration'], summary: 'ESG and values-aligned portfolio construction for client mandates.' },
];

export const TREND_STAGES = [
  { id: 'emerging', label: 'Emerging' },
  { id: 'growing', label: 'Growing' },
  { id: 'mainstream', label: 'Mainstream' },
  { id: 'declining', label: 'Declining' },
];

export const TRENDS = [
  { id: 'tr-aiplanning', title: 'AI planning copilots', category: 'Advisor FinTech', stage: 'growing', impact: 'High', timeHorizon: '1–2 years', description: 'AI assistants that draft plans, summarize meetings, and surface next-best actions for advisors.', signals: ['Major planning tools adding copilots', 'Faster plan turnaround', 'Rising advisor adoption'], relatedSectors: ['Financial Planning Software'] },
  { id: 'tr-wealthtransfer', title: 'Great wealth transfer', category: 'Wealth Management', stage: 'mainstream', impact: 'High', timeHorizon: 'Now', description: 'Trillions in assets moving to next-generation heirs, reshaping client relationships.', signals: ['Intergenerational planning demand', 'Heir retention focus', 'Estate planning uptick'], relatedSectors: ['Values-Based Investing'] },
  { id: 'tr-retailalts', title: 'Retail access to alternatives', category: 'Real Estate & Alts', stage: 'growing', impact: 'High', timeHorizon: '2–3 years', description: 'Interval funds and feeder structures bring private markets to advisor portfolios.', signals: ['Interval fund launches', 'Platform integrations', 'Rising allocations'], relatedSectors: ['Private Credit'] },
  { id: 'tr-guaranteedincome', title: 'Guaranteed income resurgence', category: 'Insurance & Annuities', stage: 'growing', impact: 'Medium', timeHorizon: '1–2 years', description: 'Higher rates revive annuity demand for structured retirement income.', signals: ['Record annuity sales', 'In-plan annuity pilots', 'Payer product launches'], relatedSectors: ['Guaranteed Income Annuities'] },
  { id: 'tr-directindexing', title: 'Direct indexing at scale', category: 'Advisor FinTech', stage: 'emerging', impact: 'High', timeHorizon: '3–5 years', description: 'Tax-managed personalized indexing moves down-market to mass-affluent clients.', signals: ['Falling account minimums', 'Custodian integrations', 'Tax-loss harvesting demand'], relatedSectors: ['Direct Indexing'] },
  { id: 'tr-roboadvice', title: 'Standalone robo-advice', category: 'Wealth Management', stage: 'declining', impact: 'Low', timeHorizon: 'Now', description: 'Pure-play robo platforms are being absorbed into hybrid human-plus-digital models.', signals: ['Consolidation', 'Flat standalone growth', 'Hybrid pivots'], relatedSectors: ['Values-Based Investing'] },
];

export const GEOGRAPHIES = [
  { id: 'geo-na', region: 'North America', dealVolume: 3120, totalFunding: 46_000_000_000, growth: 12, hubs: ['New York', 'San Francisco', 'Chicago', 'Toronto'], topSectors: ['Direct Indexing', 'Private Credit', 'Financial Planning Software'], notableCompanies: ['Charles Schwab', 'Addepar', 'iCapital'] },
  { id: 'geo-eu', region: 'Europe', dealVolume: 1980, totalFunding: 16_000_000_000, growth: 9, hubs: ['London', 'Zurich', 'Frankfurt', 'Luxembourg'], topSectors: ['Values-Based Investing', 'Private Credit', 'Guaranteed Income Annuities'], notableCompanies: ['UBS', 'Nutmeg', 'Moonfare'] },
  { id: 'geo-apac', region: 'Asia-Pacific', dealVolume: 2440, totalFunding: 12_000_000_000, growth: 14, hubs: ['Singapore', 'Hong Kong', 'Sydney', 'Tokyo'], topSectors: ['Advisor FinTech', 'Wealth Management', 'Real Estate & Alts'], notableCompanies: ['StashAway', 'Endowus'] },
  { id: 'geo-me', region: 'Middle East', dealVolume: 620, totalFunding: 3_500_000_000, growth: 19, hubs: ['Dubai', 'Riyadh', 'Abu Dhabi'], topSectors: ['Wealth Management', 'Real Estate & Alts'], notableCompanies: ['Lunate', 'Sarwa'] },
];

export const MACRO = {
  asOf: TODAY,
  indicators: [
    { label: 'Fed funds rate', value: '4.25%', trend: 'down', note: 'Two cuts priced in for H2.' },
    { label: 'Inflation (CPI)', value: '2.6%', trend: 'down', note: 'Cooling toward target.' },
    { label: '10Y Treasury yield', value: '4.1%', trend: 'flat', note: 'Range-bound; income opportunities persist.' },
    { label: 'S&P 500 (YTD)', value: '+9.4%', trend: 'up', note: 'Broadening beyond mega-cap tech.' },
    { label: 'Household savings rate', value: '4.8%', trend: 'up', note: 'Rebuilding after post-pandemic drawdown.' },
    { label: 'Advised assets (industry)', value: '$38T', trend: 'up', note: 'Steady share gains vs. self-directed.' },
  ],
  regions: [
    { region: 'North America', vcFunding: 46_000_000_000, growth: 12, ipoWindow: 'Opening', note: 'Advisor fintech and direct indexing lead.' },
    { region: 'Europe', vcFunding: 16_000_000_000, growth: 9, ipoWindow: 'Selective', note: 'Values-based and private markets strength.' },
    { region: 'Asia-Pacific', vcFunding: 12_000_000_000, growth: 14, ipoWindow: 'Selective', note: 'Digital wealth platforms scaling fast.' },
    { region: 'Middle East', vcFunding: 3_500_000_000, growth: 19, ipoWindow: 'Opening', note: 'Sovereign and family-office capital growing.' },
  ],
  commentary: 'A soft-landing base case supports risk assets while higher-for-longer rates keep income and guaranteed-income solutions attractive. Advisors are leaning into planning depth, alternatives, and tax management to differentiate.',
};

// ===========================================================================
// COMPANIES — Startup DB, Enterprise DB, Competitors, Customers, Partners
// ===========================================================================
export const COMPANY_DATASETS = [
  { id: 'startups', label: 'Startup Database' },
  { id: 'enterprise', label: 'Enterprise Database' },
  { id: 'competitors', label: 'Competitors' },
  { id: 'customers', label: 'Customers' },
  { id: 'partners', label: 'Partners' },
  // Additive VC/startup-investment datasets.
  { id: 'unicorns', label: 'Unicorn Database' },
  { id: 'public', label: 'Public Companies' },
  { id: 'exits', label: 'Exit Database' },
  { id: 'rounds', label: 'Funding Rounds' },
];

export const STARTUPS = [
  { id: 'st-planwise', name: 'PlanWise', sector: 'Financial Planning Software', stage: 'Seed', founded: 2023, hq: 'Austin, USA', employees: 34, totalFunding: 12_000_000, lastRound: 'Seed', valuation: 55_000_000, description: 'AI-native planning copilot that drafts client plans and meeting summaries for advisors.', investors: ['Fintech Collective', 'Bessemer'], founders: ['Dara Okafor', 'Sam Reilly'] },
  { id: 'st-indexa', name: 'Indexa', sector: 'Direct Indexing', stage: 'Series A', founded: 2022, hq: 'New York, USA', employees: 58, totalFunding: 30_000_000, lastRound: 'Series A', valuation: 160_000_000, description: 'Tax-managed direct indexing platform for mass-affluent advisory books.', investors: ['a16z', 'Nyca'], founders: ['Priya Nair'] },
  { id: 'st-vestflow', name: 'VestFlow', sector: 'Private Credit', stage: 'Series A', founded: 2021, hq: 'San Francisco, USA', employees: 72, totalFunding: 24_000_000, lastRound: 'Series A', valuation: 130_000_000, description: 'Marketplace bringing private credit interval funds to independent advisors.', investors: ['Ribbit', 'QED'], founders: ['Marco Diaz'] },
  { id: 'st-harbor', name: 'Harbor Advisory Tech', sector: 'Advisor FinTech', stage: 'Seed', founded: 2023, hq: 'Boston, USA', employees: 21, totalFunding: 8_000_000, lastRound: 'Seed', valuation: 45_000_000, description: 'Unified advisor desktop consolidating CRM, planning, and portfolio data.', investors: ['Bain Capital Ventures'], founders: ['Elena Fischer'] },
  { id: 'st-annuiti', name: 'Annuiti', sector: 'Guaranteed Income Annuities', stage: 'Series A', founded: 2021, hq: 'Chicago, USA', employees: 64, totalFunding: 22_000_000, lastRound: 'Series A', valuation: 120_000_000, description: 'Digital annuity marketplace and comparison engine for retirement planning.', investors: ['Foundation Capital'], founders: ['Sofia Klein'] },
  { id: 'st-ethicore', name: 'EthiCore', sector: 'Values-Based Investing', stage: 'Seed', founded: 2024, hq: 'Los Angeles, USA', employees: 18, totalFunding: 4_500_000, lastRound: 'Seed', valuation: 24_000_000, description: 'Values-alignment engine for building custom ESG client portfolios.', investors: ['Forerunner'], founders: ['Ryan Cole'] },
];

export const ENTERPRISE_COMPANIES = [
  { id: 'ent-schwab', name: 'Charles Schwab', sector: 'Wealth Management', hq: 'Westlake, USA', founded: 1971, employees: 32000, aum: 9_400_000_000_000, ticker: 'SCHW', segment: 'Custodian', note: 'Leading RIA custodian and brokerage platform.' },
  { id: 'ent-fidelity', name: 'Fidelity Investments', sector: 'Wealth Management', hq: 'Boston, USA', founded: 1946, employees: 76000, aum: 13_700_000_000_000, ticker: null, segment: 'Custodian', note: 'Private custodian, asset manager, and retirement provider.' },
  { id: 'ent-envestnet', name: 'Envestnet', sector: 'Advisor FinTech', hq: 'Berwyn, USA', founded: 1999, employees: 4200, aum: 5_800_000_000_000, ticker: null, segment: 'Platform', note: 'Wealth management technology and TAMP platform.' },
  { id: 'ent-addepar', name: 'Addepar', sector: 'Advisor FinTech', hq: 'Mountain View, USA', founded: 2009, employees: 1000, aum: 6_000_000_000_000, ticker: null, segment: 'Reporting', note: 'Portfolio reporting and analytics for complex wealth.' },
  { id: 'ent-blackstone', name: 'Blackstone', sector: 'Real Estate & Alts', hq: 'New York, USA', founded: 1985, employees: 4700, aum: 1_100_000_000_000, ticker: 'BX', segment: 'Alts Manager', note: 'Largest alternative asset manager, expanding retail access.' },
  { id: 'ent-icapital', name: 'iCapital', sector: 'Real Estate & Alts', hq: 'New York, USA', founded: 2013, employees: 1400, aum: 200_000_000_000, ticker: null, segment: 'Alts Platform', note: 'Alternatives access and infrastructure for advisors.' },
];

export const COMPETITOR_TIERS = ['Direct', 'Adjacent', 'Emerging'];
export const COMPETITORS = [
  { id: 'cmp-1', company: 'Summit Wealth Partners', tier: 'Direct', segment: 'RIA', aum: 4_200_000_000, clients: 1800, date: daysAgo(20), region: 'Northeast', strengths: ['Deep planning bench', 'Strong referral network'], watch: 'Aggressively hiring advisors in our market.' },
  { id: 'cmp-2', company: 'Meridian Advisors', tier: 'Direct', segment: 'RIA', aum: 2_600_000_000, clients: 1100, date: daysAgo(45), region: 'Northeast', strengths: ['Tax specialization', 'Family-office services'], watch: 'Launched a competing HNW estate offering.' },
  { id: 'cmp-3', company: 'Vanguard Personal Advisor', tier: 'Adjacent', segment: 'Hybrid', aum: 300_000_000_000, clients: 900000, date: daysAgo(60), region: 'National', strengths: ['Low fees', 'Brand trust'], watch: 'Pressuring fees at the mass-affluent tier.' },
  { id: 'cmp-4', company: 'Facet', tier: 'Adjacent', segment: 'Subscription', aum: 3_400_000_000, clients: 24000, date: daysAgo(30), region: 'National', strengths: ['Flat-fee model', 'Digital-first onboarding'], watch: 'Targeting younger accumulators with flat fees.' },
  { id: 'cmp-5', company: 'Range', tier: 'Emerging', segment: 'AI Wealth', aum: 900_000_000, clients: 6000, date: daysAgo(12), region: 'National', strengths: ['AI-driven planning', 'Membership pricing'], watch: 'AI-native positioning gaining press attention.' },
];

export const CUSTOMERS = [
  { id: 'cus-1', name: 'The Reyes Family', segment: 'HNW Household', relationship: 'Client', aum: 14_500_000, since: 2019, hq: 'Greenwich, USA', advisor: 'You', products: ['Managed portfolio', 'Estate plan', 'Private credit'], note: 'Multi-generational planning underway ahead of a business sale.' },
  { id: 'cus-2', name: 'Northshore Foundation', segment: 'Endowment', relationship: 'Client', aum: 62_000_000, since: 2017, hq: 'Chicago, USA', advisor: 'Priya Nair', products: ['Endowment portfolio', 'Alternatives sleeve'], note: 'Reviewing spending policy and alts allocation this quarter.' },
  { id: 'cus-3', name: 'Dr. Amelia Cho', segment: 'Mass Affluent', relationship: 'Client', aum: 2_200_000, since: 2022, hq: 'Seattle, USA', advisor: 'You', products: ['Model portfolio', 'Direct indexing'], note: 'Onboarded to direct indexing for tax-loss harvesting.' },
  { id: 'cus-4', name: 'Vertex Industries 401(k)', segment: 'Retirement Plan', relationship: 'Client', aum: 48_000_000, since: 2020, hq: 'Austin, USA', advisor: 'Marco Diaz', products: ['Plan advisory', 'Managed accounts'], note: 'Adding an in-plan guaranteed income option.' },
  { id: 'cus-5', name: 'The Okafor Trust', segment: 'HNW Household', relationship: 'Prospect', aum: 8_900_000, since: null, hq: 'Boston, USA', advisor: 'You', products: ['Discovery in progress'], note: 'Referred by an existing client; proposal in review.' },
];

export const PARTNERS = [
  { id: 'par-1', name: 'iCapital', type: 'Alternatives Platform', focus: 'Private markets access', tier: 'Strategic', since: 2021, hq: 'New York, USA', note: 'Provides feeder-fund access to private credit and PE for client portfolios.' },
  { id: 'par-2', name: 'eMoney Advisor', type: 'Technology', focus: 'Financial planning software', tier: 'Strategic', since: 2019, hq: 'Radnor, USA', note: 'Core planning platform integrated into the advisor desktop.' },
  { id: 'par-3', name: 'Charles Schwab', type: 'Custodian', focus: 'Custody & brokerage', tier: 'Strategic', since: 2018, hq: 'Westlake, USA', note: 'Primary custodian for managed client accounts.' },
  { id: 'par-4', name: 'Miller & Associates CPA', type: 'Referral', focus: 'Tax & accounting', tier: 'Preferred', since: 2020, hq: 'Greenwich, USA', note: 'Reciprocal referrals for tax planning and business owners.' },
  { id: 'par-5', name: 'Athene', type: 'Insurance Carrier', focus: 'Annuities & income', tier: 'Preferred', since: 2022, hq: 'West Des Moines, USA', note: 'Preferred carrier for fixed-indexed annuity solutions.' },
];

// ===========================================================================
// AI RESEARCH — clearly-labelled sample surfaces
// AI Search, AI Analyst, SWOT Analysis, Market Maps, Company Reports
// ===========================================================================
export const AI_TABS = [
  { id: 'search', label: 'AI Search' },
  { id: 'analyst', label: 'AI Analyst' },
  { id: 'comparables', label: 'Comparable Companies' },
  { id: 'swot', label: 'SWOT Analysis' },
  { id: 'maps', label: 'Market Maps' },
  { id: 'reports', label: 'Company Reports' },
];

// Sample AI search: a canned query with sourced results.
export const AI_SEARCH_SAMPLE = {
  query: 'How should I position guaranteed income for a client nearing retirement?',
  answer: 'For a client 2–3 years from retirement, pair a fixed-indexed annuity covering essential expenses with a diversified growth sleeve for discretionary spending. Guaranteed income floors reduce sequence-of-returns risk, letting the equity allocation stay invested through early retirement. Athene and Corebridge products lead current comparisons on cap rates.',
  sources: [
    { title: 'Retirement Income Framework', ref: 'doc-3' },
    { title: 'Annuity Comparison Playbook', ref: 'doc-5' },
    { title: 'Guaranteed Income Resurgence — trend', ref: 'tr-guaranteedincome' },
  ],
  related: ['Guaranteed income', 'Sequence risk', 'Decumulation'],
};

// Sample AI analyst: canned analytical prompts + outputs.
export const AI_ANALYST_SAMPLES = [
  { id: 'an-1', prompt: 'Summarize the direct indexing opportunity for my mass-affluent book', output: 'Direct indexing account minimums have fallen below $50K, opening tax-managed personalization to most mass-affluent clients. Expect 1–2% annual after-tax alpha from loss harvesting in taxable accounts. Indexa and Parametric lead on custodian integrations; the main lift is client education and onboarding workflow.' },
  { id: 'an-2', prompt: 'What are the risks in adding private credit to client portfolios?', output: 'Illiquidity, higher fees, and valuation opacity are the top risks. Interval-fund structures cap redemptions, so size allocations to spending needs. VestFlow and iCapital reduce operational friction, but suitability and liquidity disclosures remain the compliance watch item.' },
  { id: 'an-3', prompt: 'Compare fee models across competing RIAs', output: 'Flat-fee and subscription models (Facet, Range) are pressuring the traditional AUM fee at the mass-affluent tier, while HNW clients still accept AUM pricing for planning depth. Differentiation is shifting from cost to tax management, estate work, and alternatives access.' },
];

// Sample SWOT analysis: strengths/weaknesses/opportunities/threats per subject.
export const SWOT_SAMPLES = [
  {
    id: 'swot-practice', subject: 'Your Advisory Practice', context: 'Independent RIA · $1.2B AUM',
    strengths: ['Deep multi-generational planning', 'High client retention (97%)', 'Strong CPA referral network'],
    weaknesses: ['Limited alternatives shelf', 'Aging advisor bench', 'Manual onboarding workflow'],
    opportunities: ['Direct indexing for mass affluent', 'Great wealth transfer client capture', 'AI planning efficiency gains'],
    threats: ['Fee pressure from flat-fee entrants', 'Competitor advisor poaching', 'Rising compliance burden'],
  },
  {
    id: 'swot-indexa', subject: 'Indexa (vendor)', context: 'Direct indexing platform · prospective partner',
    strengths: ['Low account minimums', 'Strong custodian integrations', 'Automated tax-loss harvesting'],
    weaknesses: ['Limited fixed-income coverage', 'Thin support team', 'Early-stage balance sheet'],
    opportunities: ['White-label advisor offering', 'Down-market expansion', 'Bundling with planning tools'],
    threats: ['Incumbent price competition', 'Custodian in-housing the feature', 'Margin compression'],
  },
];

// Sample market maps: a category grid of companies.
export const MARKET_MAPS = [
  { id: 'map-advisortech', category: 'Advisor FinTech', segments: [
    { name: 'Planning', companies: ['eMoney', 'RightCapital', 'PlanWise'] },
    { name: 'Portfolio', companies: ['Orion', 'Addepar', 'Indexa'] },
    { name: 'CRM', companies: ['Redtail', 'Wealthbox', 'Harbor Advisory Tech'] },
  ] },
  { id: 'map-alts', category: 'Alternatives Access', segments: [
    { name: 'Private credit', companies: ['Blue Owl', 'Apollo', 'VestFlow'] },
    { name: 'Platforms', companies: ['iCapital', 'CAIS'] },
    { name: 'Real assets', companies: ['Blackstone', 'Starwood'] },
  ] },
  { id: 'map-income', category: 'Retirement Income', segments: [
    { name: 'Annuity carriers', companies: ['Athene', 'Corebridge', 'Lincoln'] },
    { name: 'Marketplaces', companies: ['Annuiti', 'DPL'] },
    { name: 'Decumulation tools', companies: ['Income Lab', 'RightCapital'] },
  ] },
];

// Sample company reports: generated reports with detail.
export const COMPANY_REPORTS = [
  { id: 'rep-indexa', company: 'Indexa', generated: daysAgo(4), sector: 'Direct Indexing', score: 82, recommendation: 'Strong partner candidate', summary: 'AI-native direct indexing platform with low minimums and strong custodian integrations — a good fit to extend tax management down-market.', strengths: ['Low account minimums', 'Automated tax-loss harvesting', 'Fast integration timeline'], risks: ['Early-stage balance sheet', 'Thin support team', 'Incumbent price competition'], sections: ['Business overview', 'Fit for practice', 'Pricing & terms', 'Risk assessment'] },
  { id: 'rep-vestflow', company: 'VestFlow', generated: daysAgo(9), sector: 'Private Credit', score: 74, recommendation: 'Monitor — pilot recommended', summary: 'Marketplace bringing private credit interval funds to advisors; strong access but suitability and liquidity governance need review.', strengths: ['Broad fund access', 'Simple advisor workflow', 'Reasonable minimums'], risks: ['Liquidity/redemption caps', 'Valuation opacity', 'Higher fee layers'], sections: ['Business overview', 'Fit for practice', 'Pricing & terms', 'Risk assessment'] },
  { id: 'rep-annuiti', company: 'Annuiti', generated: daysAgo(12), sector: 'Guaranteed Income Annuities', score: 68, recommendation: 'Support pilot', summary: 'Digital annuity marketplace simplifying comparison and quoting; useful for guaranteed-income planning but carrier depth is still growing.', strengths: ['Clean comparison engine', 'Fast quoting', 'Good UX for clients'], risks: ['Limited carrier panel', 'Commission transparency', 'Compliance documentation'], sections: ['Business overview', 'Fit for practice', 'Pricing & terms', 'Risk assessment'] },
];

// ===========================================================================
// DOCUMENTS — searchable library
// Research Papers, PDFs, Frameworks, Templates, Playbooks
// ===========================================================================
export const DOCUMENT_TYPES = [
  { id: 'paper', label: 'Research Papers' },
  { id: 'pdf', label: 'PDFs' },
  { id: 'framework', label: 'Frameworks' },
  { id: 'template', label: 'Templates' },
  { id: 'playbook', label: 'Playbooks' },
  // Additive investment-flavored document types.
  { id: 'deck', label: 'Pitch Decks' },
  { id: 'memo', label: 'Investment Memos' },
  { id: 'contract', label: 'Contracts' },
];

export const DOCUMENTS = [
  { id: 'doc-1', title: 'State of Wealth Management 2026', type: 'paper', source: 'Public research', author: 'McKinsey', date: daysAgo(26), pages: 42, tags: ['Wealth Management', 'Industry'], confidentiality: 'Public', summary: 'Annual landscape of advisor economics, fee trends, and the great wealth transfer.' },
  { id: 'doc-2', title: 'Direct Indexing Adoption Study', type: 'paper', source: 'Public research', author: 'Cerulli Associates', date: daysAgo(48), pages: 28, tags: ['Direct Indexing', 'Advisor FinTech'], confidentiality: 'Public', summary: 'Adoption drivers, after-tax alpha benchmarks, and platform comparisons for direct indexing.' },
  { id: 'doc-3', title: 'Retirement Income Framework', type: 'framework', source: 'Internal', author: 'You', date: daysAgo(20), pages: 9, tags: ['Retirement', 'Planning'], confidentiality: 'Internal', summary: 'Decumulation framework pairing guaranteed income floors with a growth sleeve.' },
  { id: 'doc-4', title: 'Client Risk Tolerance Framework', type: 'framework', source: 'Internal', author: 'Priya Nair', date: daysAgo(64), pages: 11, tags: ['Planning', 'Risk'], confidentiality: 'Internal', summary: 'Structured approach to assessing capacity, willingness, and need for risk.' },
  { id: 'doc-5', title: 'Annuity Comparison Playbook', type: 'playbook', source: 'Internal', author: 'Marco Diaz', date: daysAgo(14), pages: 16, tags: ['Annuities', 'Income'], confidentiality: 'Internal', summary: 'Step-by-step playbook for positioning and comparing fixed-indexed annuities.' },
  { id: 'doc-6', title: 'Alternatives Landscape 2026', type: 'pdf', source: 'Public research', author: 'iCapital Research', date: daysAgo(80), pages: 24, tags: ['Real Estate & Alts', 'Private Credit'], confidentiality: 'Public', summary: 'Market map and access structures for private credit, PE, and real assets.' },
  { id: 'doc-7', title: 'Client Onboarding Template', type: 'template', source: 'Internal', author: 'Operations', date: daysAgo(9), pages: 6, tags: ['Operations', 'Onboarding'], confidentiality: 'Internal', summary: 'Standard onboarding checklist and document-collection template for new households.' },
  { id: 'doc-8', title: 'Quarterly Review Meeting Template', type: 'template', source: 'Internal', author: 'You', date: daysAgo(35), pages: 4, tags: ['Client Service', 'Reviews'], confidentiality: 'Internal', summary: 'Agenda and talking-points template for quarterly client review meetings.' },
  { id: 'doc-9', title: 'HNW Prospecting Playbook', type: 'playbook', source: 'Internal', author: 'Business Development', date: daysAgo(52), pages: 18, tags: ['Growth', 'Prospecting'], confidentiality: 'Confidential', summary: 'Referral, centers-of-influence, and event tactics for winning HNW households.' },
  { id: 'doc-10', title: 'Tax-Loss Harvesting White Paper', type: 'pdf', source: 'Public research', author: 'Parametric', date: daysAgo(150), pages: 14, tags: ['Tax', 'Direct Indexing'], confidentiality: 'Public', summary: 'Mechanics and after-tax benefit estimates of systematic tax-loss harvesting.' },
  { id: 'doc-11', title: 'Indexa Series B Pitch Deck', type: 'deck', source: 'Deal room', author: 'Indexa', date: daysAgo(6), pages: 22, tags: ['Direct Indexing', 'Series B'], confidentiality: 'Confidential', summary: 'Growth-stage pitch deck covering traction, unit economics, and the expansion plan for a direct-indexing platform.' },
  { id: 'doc-12', title: 'VestFlow Seed Pitch Deck', type: 'deck', source: 'Deal room', author: 'VestFlow', date: daysAgo(70), pages: 18, tags: ['Private Credit', 'Seed'], confidentiality: 'Confidential', summary: 'Seed deck outlining the private-credit marketplace opportunity and go-to-market for advisors.' },
  { id: 'doc-13', title: 'Investment Memo — Indexa', type: 'memo', source: 'Internal', author: 'You', date: daysAgo(5), pages: 8, tags: ['Direct Indexing', 'Diligence'], confidentiality: 'Confidential', summary: 'Thesis, market, team, and risk assessment supporting a proposed Series B investment.' },
  { id: 'doc-14', title: 'Investment Memo — VestFlow', type: 'memo', source: 'Internal', author: 'Marco Diaz', date: daysAgo(19), pages: 7, tags: ['Private Credit', 'Diligence'], confidentiality: 'Confidential', summary: 'Diligence memo evaluating the private-credit marketplace, unit economics, and liquidity risks.' },
  { id: 'doc-15', title: 'SAFE Agreement Template', type: 'contract', source: 'Internal', author: 'Legal', date: daysAgo(33), pages: 12, tags: ['Legal', 'Financing'], confidentiality: 'Internal', summary: 'Standard post-money SAFE template used for early-stage investments.' },
  { id: 'doc-16', title: 'Series A Term Sheet — EthiCore', type: 'contract', source: 'Deal room', author: 'Legal', date: daysAgo(41), pages: 6, tags: ['Legal', 'Series A'], confidentiality: 'Confidential', summary: 'Executed term sheet covering valuation, liquidation preference, and governance terms.' },
];

// ===========================================================================
// NEWS — categorized feed
// Industry News, Client News, Funding, M&A, Regulations
// ===========================================================================
export const NEWS_CATEGORIES = [
  { id: 'industry', label: 'Industry News' },
  { id: 'client', label: 'Client News' },
  { id: 'funding', label: 'Funding News' },
  { id: 'mna', label: 'M&A' },
  { id: 'regulation', label: 'Regulations' },
  // Additive investment-flavored categories.
  { id: 'portfolio', label: 'Portfolio News' },
  { id: 'competitor', label: 'Competitor News' },
  { id: 'acquisitions', label: 'Acquisitions' },
  { id: 'ipos', label: 'IPOs' },
];

export const NEWS = [
  { id: 'nw-1', headline: 'Advisor fee compression accelerates as flat-fee models gain share', category: 'industry', source: 'Barron\u2019s', date: daysAgo(1), sentiment: 'neutral', companies: ['Facet', 'Range'], summary: 'Subscription and flat-fee advice models continue pressuring the traditional AUM fee at the mass-affluent tier.' },
  { id: 'nw-2', headline: 'Direct indexing minimums drop below $50K, opening mass-affluent market', category: 'industry', source: 'InvestmentNews', date: daysAgo(10), sentiment: 'positive', companies: ['Indexa', 'Parametric'], summary: 'Falling account minimums bring tax-managed personalization to a much larger advisor client base.' },
  { id: 'nw-3', headline: 'The Reyes Family completes business sale ahead of estate transition', category: 'client', source: 'Practice CRM', date: daysAgo(5), sentiment: 'positive', companies: ['The Reyes Family'], summary: 'A key client liquidity event triggers a multi-generational estate and gifting review.' },
  { id: 'nw-4', headline: 'Northshore Foundation approves updated alternatives allocation', category: 'client', source: 'Practice CRM', date: daysAgo(16), sentiment: 'positive', companies: ['Northshore Foundation'], summary: 'Endowment client greenlights a larger private-markets sleeve after the quarterly review.' },
  { id: 'nw-5', headline: 'PlanWise raises $12M seed to scale AI planning copilot', category: 'funding', source: 'TechCrunch', date: daysAgo(24), sentiment: 'positive', companies: ['PlanWise'], summary: 'An AI-native planning startup lands funding to expand meeting-summary and next-best-action features.' },
  { id: 'nw-6', headline: 'VestFlow closes $24M Series A for private credit marketplace', category: 'funding', source: 'Fintech Times', date: daysAgo(18), sentiment: 'neutral', companies: ['VestFlow'], summary: 'Continued capital flowing into platforms that widen advisor access to alternatives.' },
  { id: 'nw-7', headline: 'Envestnet to acquire planning-software startup in $300M deal', category: 'mna', source: 'WSJ', date: daysAgo(40), sentiment: 'neutral', companies: ['Envestnet'], summary: 'Consolidation continues as platform incumbents buy up advisor-facing software capabilities.' },
  { id: 'nw-8', headline: 'Two regional RIAs merge to form $9B wealth firm', category: 'mna', source: 'RIABiz', date: daysAgo(60), sentiment: 'neutral', companies: ['Summit Wealth Partners', 'Meridian Advisors'], summary: 'Advisor M&A stays hot as scale and succession drive consolidation among independents.' },
  { id: 'nw-9', headline: 'SEC finalizes updated advisor marketing and testimonial guidance', category: 'regulation', source: 'ThinkAdvisor', date: daysAgo(8), sentiment: 'neutral', companies: [], summary: 'New guidance clarifies use of client testimonials and performance advertising for RIAs.' },
  { id: 'nw-10', headline: 'DOL fiduciary rule update raises rollover documentation bar', category: 'regulation', source: 'ThinkAdvisor', date: daysAgo(30), sentiment: 'negative', companies: [], summary: 'Advisors face heightened documentation requirements when recommending IRA rollovers.' },
  { id: 'nw-11', headline: 'Portfolio company Indexa crosses $2B in assets on platform', category: 'portfolio', source: 'Portfolio Update', date: daysAgo(3), sentiment: 'positive', companies: ['Indexa'], summary: 'A core portfolio holding hits a new assets milestone, strengthening its Series B positioning.' },
  { id: 'nw-12', headline: 'VestFlow expands interval-fund marketplace into the national RIA channel', category: 'portfolio', source: 'Portfolio Update', date: daysAgo(7), sentiment: 'positive', companies: ['VestFlow'], summary: 'Portfolio company widens distribution, adding several national RIA networks this quarter.' },
  { id: 'nw-13', headline: 'Range steps up AI-wealth marketing and poaches senior advisors', category: 'competitor', source: 'RIABiz', date: daysAgo(6), sentiment: 'negative', companies: ['Range'], summary: 'A watchlist competitor accelerates hiring and press, sharpening its AI-native positioning.' },
  { id: 'nw-14', headline: 'Facet expands flat-fee tiers to target younger accumulators', category: 'competitor', source: 'InvestmentNews', date: daysAgo(13), sentiment: 'neutral', companies: ['Facet'], summary: 'Adjacent competitor broadens its subscription model, pressuring mass-affluent pricing.' },
  { id: 'nw-15', headline: 'Apollo acquires a private-credit fintech to widen retail access', category: 'acquisitions', source: 'Bloomberg', date: daysAgo(11), sentiment: 'neutral', companies: ['Apollo'], summary: 'A major alternatives manager buys a distribution platform, signaling further retail-alts consolidation.' },
  { id: 'nw-16', headline: 'Addepar acquires a reporting startup to deepen its analytics stack', category: 'acquisitions', source: 'TechCrunch', date: daysAgo(22), sentiment: 'positive', companies: ['Addepar'], summary: 'Reporting incumbent absorbs a smaller analytics team to accelerate its roadmap.' },
  { id: 'nw-17', headline: 'Digital-wealth platform files for IPO at a $6B valuation', category: 'ipos', source: 'WSJ', date: daysAgo(15), sentiment: 'positive', companies: ['StashAway'], summary: 'An APAC digital-wealth leader opens the fintech IPO window with a closely watched filing.' },
  { id: 'nw-18', headline: 'Direct-indexing unicorn confidentially files for a public offering', category: 'ipos', source: 'Reuters', date: daysAgo(28), sentiment: 'neutral', companies: ['Parametric'], summary: 'A late-stage direct-indexing company begins the IPO process as public-market appetite returns.' },
];

// ===========================================================================
// COMPANIES (additive) — Unicorn DB, Public Companies, Exit DB, Funding Rounds
// VC/startup-investment flavored databases layered on top of the existing
// Companies datasets.
// ===========================================================================
export const UNICORNS = [
  { id: 'uni-parametric', name: 'Parametric', sector: 'Direct Indexing', hq: 'Seattle, USA', founded: 2018, valuation: 4_200_000_000, totalFunding: 640_000_000, lastRound: 'Series E', employees: 620, investors: ['Tiger Global', 'a16z', 'Sequoia'], description: 'Category-leading direct-indexing platform scaling tax-managed personalization down-market ahead of a rumored IPO.' },
  { id: 'uni-icapital', name: 'iCapital', sector: 'Alternatives Access', hq: 'New York, USA', founded: 2013, valuation: 6_000_000_000, totalFunding: 1_100_000_000, lastRound: 'Series D', employees: 1400, investors: ['Temasek', 'Apollo', 'BlackRock'], description: 'Alternatives infrastructure connecting advisors to private-market feeder funds at scale.' },
  { id: 'uni-addepar', name: 'Addepar', sector: 'Advisor FinTech', hq: 'Mountain View, USA', founded: 2009, valuation: 3_500_000_000, totalFunding: 500_000_000, lastRound: 'Series F', employees: 1000, investors: ['8VC', 'D1 Capital', 'WestCap'], description: 'Portfolio reporting and analytics platform for complex, multi-asset wealth.' },
  { id: 'uni-stashaway', name: 'StashAway', sector: 'Digital Wealth', hq: 'Singapore', founded: 2016, valuation: 1_400_000_000, totalFunding: 290_000_000, lastRound: 'Series D', employees: 480, investors: ['Sequoia', 'Eight Roads', 'GIC'], description: 'APAC digital-wealth platform expanding across Southeast Asia and the Middle East.' },
  { id: 'uni-moonfare', name: 'Moonfare', sector: 'Alternatives Access', hq: 'Berlin, Germany', founded: 2016, valuation: 1_200_000_000, totalFunding: 320_000_000, lastRound: 'Series C', employees: 350, investors: ['Insight Partners', 'Fidelity', 'KKR'], description: 'European private-markets platform bringing PE and VC access to wealth clients.' },
];

export const PUBLIC_COMPANIES = [
  { id: 'pub-schw', name: 'Charles Schwab', ticker: 'SCHW', sector: 'Wealth Management', hq: 'Westlake, USA', marketCap: 132_000_000_000, revenue: 19_600_000_000, change: 1.4, pe: 22, note: 'Leading RIA custodian and retail brokerage.' },
  { id: 'pub-bx', name: 'Blackstone', ticker: 'BX', sector: 'Alternatives', hq: 'New York, USA', marketCap: 168_000_000_000, revenue: 11_200_000_000, change: 2.1, pe: 31, note: 'Largest alternative asset manager, expanding retail access.' },
  { id: 'pub-owl', name: 'Blue Owl Capital', ticker: 'OWL', sector: 'Private Credit', hq: 'New York, USA', marketCap: 28_000_000_000, revenue: 2_100_000_000, change: -0.6, pe: 26, note: 'Direct-lending and GP-stakes platform in private credit.' },
  { id: 'pub-apo', name: 'Apollo Global', ticker: 'APO', sector: 'Alternatives', hq: 'New York, USA', marketCap: 78_000_000_000, revenue: 26_000_000_000, change: 0.9, pe: 15, note: 'Alternatives and retirement-services manager scaling retail credit.' },
  { id: 'pub-lpla', name: 'LPL Financial', ticker: 'LPLA', sector: 'Advisor Platform', hq: 'San Diego, USA', marketCap: 22_000_000_000, revenue: 10_400_000_000, change: 1.1, pe: 19, note: 'Largest independent broker-dealer and advisor platform.' },
  { id: 'pub-amp', name: 'Ameriprise', ticker: 'AMP', sector: 'Wealth Management', hq: 'Minneapolis, USA', marketCap: 41_000_000_000, revenue: 16_800_000_000, change: 0.4, pe: 16, note: 'Diversified wealth and asset-management franchise.' },
];

export const EXIT_TYPES = ['Acquisition', 'IPO', 'Secondary'];
export const EXITS = [
  { id: 'exit-1', company: 'Vise', type: 'Acquisition', counterparty: 'Envestnet', sector: 'Direct Indexing', value: 900_000_000, multiple: 6.2, date: daysAgo(40), note: 'Platform acquisition folding AI-driven portfolios into a TAMP incumbent.', investors: ['Sequoia', 'Founders Fund'] },
  { id: 'exit-2', company: 'Nutmeg', type: 'Acquisition', counterparty: 'JPMorgan', sector: 'Digital Wealth', value: 700_000_000, multiple: 4.8, date: daysAgo(120), note: 'European robo-advisor acquired to seed a retail wealth expansion.', investors: ['Balderton', 'Convoy'] },
  { id: 'exit-3', company: 'Marqeta', type: 'IPO', counterparty: 'NASDAQ', sector: 'FinTech Infrastructure', value: 15_000_000_000, multiple: 11.0, date: daysAgo(210), note: 'Card-issuing platform IPO — a benchmark comp for fintech infrastructure.', investors: ['ICONIQ', 'Coatue'] },
  { id: 'exit-4', company: 'Personal Capital', type: 'Acquisition', counterparty: 'Empower', sector: 'Digital Wealth', value: 1_000_000_000, multiple: 5.5, date: daysAgo(300), note: 'Hybrid digital-advice platform absorbed by a retirement provider.', investors: ['IVP', 'Institutional Venture'] },
  { id: 'exit-5', company: 'Wealthfront', type: 'Secondary', counterparty: 'UBS (terminated)', sector: 'Digital Wealth', value: 1_400_000_000, multiple: 6.0, date: daysAgo(500), note: 'Late-stage secondary after a planned acquisition was called off.', investors: ['Greylock', 'Index Ventures'] },
];

export const ROUND_STAGES = ['Seed', 'Series A', 'Series B', 'Series C', 'Growth'];
export const FUNDING_ROUNDS = [
  { id: 'rnd-1', company: 'Indexa', stage: 'Series B', amount: 60_000_000, date: daysAgo(6), valuation: 420_000_000, sector: 'Direct Indexing', leadInvestor: 'a16z', investors: ['a16z', 'Nyca', 'Bessemer'] },
  { id: 'rnd-2', company: 'PlanWise', stage: 'Seed', amount: 12_000_000, date: daysAgo(24), valuation: 55_000_000, sector: 'Advisor FinTech', leadInvestor: 'Fintech Collective', investors: ['Fintech Collective', 'Bessemer'] },
  { id: 'rnd-3', company: 'VestFlow', stage: 'Series A', amount: 24_000_000, date: daysAgo(18), valuation: 130_000_000, sector: 'Private Credit', leadInvestor: 'Ribbit', investors: ['Ribbit', 'QED'] },
  { id: 'rnd-4', company: 'Annuiti', stage: 'Series A', amount: 22_000_000, date: daysAgo(55), valuation: 120_000_000, sector: 'Guaranteed Income', leadInvestor: 'Foundation Capital', investors: ['Foundation Capital'] },
  { id: 'rnd-5', company: 'Harbor Advisory Tech', stage: 'Seed', amount: 8_000_000, date: daysAgo(72), valuation: 45_000_000, sector: 'Advisor FinTech', leadInvestor: 'Bain Capital Ventures', investors: ['Bain Capital Ventures'] },
  { id: 'rnd-6', company: 'EthiCore', stage: 'Series A', amount: 18_000_000, date: daysAgo(41), valuation: 95_000_000, sector: 'Values-Based Investing', leadInvestor: 'Forerunner', investors: ['Forerunner', 'Kapor Capital'] },
  { id: 'rnd-7', company: 'Moonfare', stage: 'Growth', amount: 140_000_000, date: daysAgo(90), valuation: 1_200_000_000, sector: 'Alternatives Access', leadInvestor: 'Insight Partners', investors: ['Insight Partners', 'Fidelity'] },
];

// Sample AI comparable-company sets (clearly labelled sample output).
export const COMPARABLES = [
  {
    id: 'comp-indexa', target: 'Indexa', sector: 'Direct Indexing',
    basis: 'Revenue multiple and growth-adjusted valuation vs. direct-indexing and advisor-fintech peers.',
    peers: [
      { name: 'Parametric', valuation: 4_200_000_000, revenue: 380_000_000, growth: 34, multiple: 11.0, note: 'Scaled category leader; premium multiple.' },
      { name: 'Vise (acq.)', valuation: 900_000_000, revenue: 120_000_000, growth: 40, multiple: 6.2, note: 'Recent acquisition comp.' },
      { name: 'Addepar', valuation: 3_500_000_000, revenue: 300_000_000, growth: 22, multiple: 9.5, note: 'Adjacent reporting platform.' },
    ],
    takeaway: 'Indexa screens attractively vs. peers on growth-adjusted multiple; the Series B valuation sits below the scaled-leader premium.',
  },
  {
    id: 'comp-vestflow', target: 'VestFlow', sector: 'Private Credit',
    basis: 'Platform-fee run-rate and AUM-on-platform vs. alternatives-access peers.',
    peers: [
      { name: 'iCapital', valuation: 6_000_000_000, revenue: 500_000_000, growth: 28, multiple: 12.0, note: 'Category infrastructure leader.' },
      { name: 'Moonfare', valuation: 1_200_000_000, revenue: 90_000_000, growth: 30, multiple: 8.0, note: 'European access platform.' },
      { name: 'CAIS', valuation: 1_100_000_000, revenue: 85_000_000, growth: 26, multiple: 7.5, note: 'US alternatives marketplace.' },
    ],
    takeaway: 'VestFlow is early on the same curve as iCapital and CAIS; distribution wins are the key multiple driver.',
  },
];

// ===========================================================================
// FUNDS — research fund directory (distinct from the investor Funds ops surface)
// Fund Directory, Investors & Partners, Fundraises. Deterministic demo data.
// ===========================================================================
export const FUND_TABS = [
  { id: 'directory', label: 'Fund Directory' },
  { id: 'managers', label: 'Investors & Partners' },
  { id: 'fundraises', label: 'Fundraises' },
];

export const FUND_TYPES = ['Venture', 'Growth', 'Private Equity', 'Seed'];
export const FUND_SIGNALS = ['Fresh fund', 'Actively deploying', 'Selective', 'Fully deployed'];

export const FUND_DIRECTORY = [
  { id: 'fd-nyca', name: 'Nyca Partners Fund IV', firm: 'Nyca Partners', type: 'Venture', fundSize: 500_000_000, vintage: 2025, stage: 'Series A–B', geography: 'North America', dryPowder: 340_000_000, signal: 'Fresh fund', hq: 'New York, USA', thesis: 'Fintech infrastructure, advisor tooling, and embedded finance across early growth.', sectors: ['Advisor FinTech', 'Payments', 'Insurance'], notableInvestments: ['Indexa', 'PlanWise'] },
  { id: 'fd-ribbit', name: 'Ribbit Capital IX', firm: 'Ribbit Capital', type: 'Venture', fundSize: 800_000_000, vintage: 2024, stage: 'Seed–Series B', geography: 'Global', dryPowder: 420_000_000, signal: 'Actively deploying', hq: 'Palo Alto, USA', thesis: 'Category-defining financial services and fintech companies worldwide.', sectors: ['Private Credit', 'FinTech', 'Digital Wealth'], notableInvestments: ['VestFlow', 'Robinhood'] },
  { id: 'fd-bcv', name: 'Bain Capital Ventures Fund II', firm: 'Bain Capital Ventures', type: 'Venture', fundSize: 1_400_000_000, vintage: 2024, stage: 'Seed–Growth', geography: 'North America', dryPowder: 900_000_000, signal: 'Actively deploying', hq: 'Boston, USA', thesis: 'Application and infrastructure software, including wealth and advisor platforms.', sectors: ['Advisor FinTech', 'SaaS', 'Data'], notableInvestments: ['Harbor Advisory Tech'] },
  { id: 'fd-insight', name: 'Insight Partners XIII', firm: 'Insight Partners', type: 'Growth', fundSize: 12_500_000_000, vintage: 2023, stage: 'Growth', geography: 'Global', dryPowder: 3_100_000_000, signal: 'Selective', hq: 'New York, USA', thesis: 'ScaleUp software and internet companies with proven unit economics.', sectors: ['Alternatives Access', 'SaaS', 'FinTech'], notableInvestments: ['Moonfare'] },
  { id: 'fd-apollo', name: 'Apollo Hybrid Value III', firm: 'Apollo Global', type: 'Private Equity', fundSize: 5_000_000_000, vintage: 2024, stage: 'Buyout / Structured', geography: 'North America', dryPowder: 2_400_000_000, signal: 'Actively deploying', hq: 'New York, USA', thesis: 'Structured equity and control positions in financial services and credit.', sectors: ['Private Credit', 'Financial Services'], notableInvestments: ['Retail credit platform'] },
  { id: 'fd-forerunner', name: 'Forerunner Ventures VI', firm: 'Forerunner Ventures', type: 'Seed', fundSize: 500_000_000, vintage: 2025, stage: 'Seed–Series A', geography: 'North America', dryPowder: 460_000_000, signal: 'Fresh fund', hq: 'San Francisco, USA', thesis: 'Consumer and consumer-fintech companies redefining how people manage money.', sectors: ['Values-Based Investing', 'Consumer FinTech'], notableInvestments: ['EthiCore'] },
  { id: 'fd-foundation', name: 'Foundation Capital X', firm: 'Foundation Capital', type: 'Venture', fundSize: 600_000_000, vintage: 2022, stage: 'Series A', geography: 'North America', dryPowder: 90_000_000, signal: 'Fully deployed', hq: 'Palo Alto, USA', thesis: 'Enterprise and fintech companies at the Series A inflection point.', sectors: ['Guaranteed Income', 'FinTech'], notableInvestments: ['Annuiti'] },
];

export const FUND_MANAGERS = [
  { id: 'fm-nair', name: 'Priya Nair', firm: 'Nyca Partners', role: 'General Partner', focus: 'Advisor fintech & wealth infrastructure', location: 'New York, USA', notableDeals: ['Indexa', 'PlanWise'], bio: 'Leads fintech-infrastructure investing; former operator at a wealth platform.' },
  { id: 'fm-diaz', name: 'Marco Diaz', firm: 'Ribbit Capital', role: 'Partner', focus: 'Private credit & alternatives access', location: 'Palo Alto, USA', notableDeals: ['VestFlow'], bio: 'Focuses on platforms widening access to private markets for advisors.' },
  { id: 'fm-fischer', name: 'Elena Fischer', firm: 'Bain Capital Ventures', role: 'Partner', focus: 'Application & infrastructure software', location: 'Boston, USA', notableDeals: ['Harbor Advisory Tech'], bio: 'Backs early-stage software teams building the advisor desktop of the future.' },
  { id: 'fm-cole', name: 'Ryan Cole', firm: 'Forerunner Ventures', role: 'Principal', focus: 'Consumer & values-based fintech', location: 'San Francisco, USA', notableDeals: ['EthiCore'], bio: 'Invests in consumer-fintech products with strong brand and retention.' },
  { id: 'fm-klein', name: 'Sofia Klein', firm: 'Foundation Capital', role: 'General Partner', focus: 'Retirement & income products', location: 'Palo Alto, USA', notableDeals: ['Annuiti'], bio: 'Backs founders reinventing retirement income and guaranteed products.' },
];

export const FUNDRAISE_STATUSES = ['Raising', 'First close', 'Final close'];
export const FUNDRAISES = [
  { id: 'fr-nyca', firm: 'Nyca Partners', fund: 'Fund IV', type: 'Venture', target: 500_000_000, raised: 500_000_000, date: daysAgo(20), status: 'Final close', geography: 'North America', stage: 'Series A–B', signal: 'Fresh dry powder — actively taking Series A meetings.' },
  { id: 'fr-forerunner', firm: 'Forerunner Ventures', fund: 'Fund VI', type: 'Seed', target: 500_000_000, raised: 500_000_000, date: daysAgo(35), status: 'Final close', geography: 'North America', stage: 'Seed–Series A', signal: 'Newly closed — ramping seed deployment this quarter.' },
  { id: 'fr-bcv', firm: 'Bain Capital Ventures', fund: 'Fund II', type: 'Venture', target: 1_400_000_000, raised: 1_400_000_000, date: daysAgo(60), status: 'Final close', geography: 'North America', stage: 'Seed–Growth', signal: 'Large reserve pool; leading and following on rounds.' },
  { id: 'fr-apollo', firm: 'Apollo Global', fund: 'Hybrid Value III', type: 'Private Equity', target: 5_000_000_000, raised: 3_600_000_000, date: daysAgo(30), status: 'First close', geography: 'North America', stage: 'Buyout / Structured', signal: 'First close done; continuing to raise while deploying.' },
  { id: 'fr-ribbit', firm: 'Ribbit Capital', fund: 'Fund IX', type: 'Venture', target: 800_000_000, raised: 620_000_000, date: daysAgo(14), status: 'Raising', geography: 'Global', stage: 'Seed–Series B', signal: 'Raising now; already writing checks from early LP commitments.' },
  { id: 'fr-moonfare', firm: 'Insight Partners', fund: 'Fund XIII (co-invest)', type: 'Growth', target: 2_000_000_000, raised: 1_100_000_000, date: daysAgo(48), status: 'Raising', geography: 'Global', stage: 'Growth', signal: 'Co-invest vehicle open; selective on new growth positions.' },
];

// Lookup helpers ------------------------------------------------------------
export function documentById(id) {
  return DOCUMENTS.find((d) => d.id === id) || null;
}
