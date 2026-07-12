// Advisor Research — deterministic mock data for the advisor Research workspace
// (Market, Companies, Documents, AI Research, News). This is placeholder data
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
// MARKET — Industries, Sectors, Trends, Macro, Geography
// ===========================================================================
export const MARKET_TABS = [
  { id: 'industries', label: 'Industries' },
  { id: 'sectors', label: 'Sectors' },
  { id: 'trends', label: 'Trends' },
  { id: 'macro', label: 'Macro' },
  { id: 'geography', label: 'Geography' },
];

export const INDUSTRIES = [
  {
    id: 'ind-ai', name: 'Artificial Intelligence', marketSize: 320_000_000_000, growth: 37, companies: 4200,
    momentum: 'Aggressive', multiple: 14,
    description: 'Foundation models, applied AI, and AI infrastructure across enterprise and consumer.',
    keyTrends: ['Agentic workflows', 'Inference cost collapse', 'Vertical copilots'],
    topPlayers: ['OpenAI', 'Anthropic', 'Mistral', 'Northwind Labs'],
    outlook: 'Capital keeps concentrating in infrastructure and vertical applications; horizontal chat is commoditizing.',
  },
  {
    id: 'ind-fintech', name: 'FinTech', marketSize: 245_000_000_000, growth: 18, companies: 3800,
    momentum: 'Selective', multiple: 8,
    description: 'Payments, lending, embedded finance, and financial infrastructure.',
    keyTrends: ['Embedded finance', 'Real-time payments', 'AI underwriting'],
    topPlayers: ['Stripe', 'Adyen', 'Beacon Fintech', 'Ramp'],
    outlook: 'Rate environment favors profitable models; embedded finance remains the durable growth pocket.',
  },
  {
    id: 'ind-health', name: 'Digital Health', marketSize: 180_000_000_000, growth: 22, companies: 2900,
    momentum: 'Growing', multiple: 9,
    description: 'Care delivery, diagnostics, health data, and clinical AI.',
    keyTrends: ['Clinical AI', 'Value-based care', 'Remote monitoring'],
    topPlayers: ['Cadence Health', 'Hinge Health', 'Abridge'],
    outlook: 'Reimbursement clarity is unlocking AI-native diagnostics; distribution remains the moat.',
  },
  {
    id: 'ind-climate', name: 'Climate & Energy', marketSize: 210_000_000_000, growth: 28, companies: 2100,
    momentum: 'Aggressive', multiple: 11,
    description: 'Clean energy, grid tech, carbon, and climate hardware.',
    keyTrends: ['Grid software', 'Long-duration storage', 'Climate hardware'],
    topPlayers: ['Lumen Robotics', 'Form Energy', 'Crusoe'],
    outlook: 'Policy tailwinds plus falling hardware costs are pulling capital into deployment-stage companies.',
  },
  {
    id: 'ind-devtools', name: 'Developer Tools', marketSize: 95_000_000_000, growth: 24, companies: 1600,
    momentum: 'Growing', multiple: 12,
    description: 'Infrastructure, observability, and productivity for software teams.',
    keyTrends: ['AI code generation', 'Platform engineering', 'Observability consolidation'],
    topPlayers: ['Vercel', 'Northwind Labs', 'Grafana'],
    outlook: 'AI is expanding the tooling budget; buyers consolidate around platforms over point solutions.',
  },
];

export const SECTORS = [
  { id: 'sec-agents', name: 'AI Agents', industry: 'Artificial Intelligence', marketSize: 42_000_000_000, growth: 61, momentum: 'Aggressive', multiple: 18, notableDeals: ['Adept — $350M', 'Cognition — $175M'], summary: 'Autonomous multi-step workflows across knowledge work.' },
  { id: 'sec-aiinfra', name: 'AI Infrastructure', industry: 'Artificial Intelligence', marketSize: 88_000_000_000, growth: 44, momentum: 'Aggressive', multiple: 15, notableDeals: ['Together — $305M', 'Northwind Labs — $60M'], summary: 'Training, inference, and observability for model pipelines.' },
  { id: 'sec-embfin', name: 'Embedded Finance', industry: 'FinTech', marketSize: 55_000_000_000, growth: 26, momentum: 'Growing', multiple: 9, notableDeals: ['Unit — $100M', 'Beacon Fintech — $40M'], summary: 'Banking, payments, and lending embedded in software products.' },
  { id: 'sec-clinai', name: 'Clinical AI', industry: 'Digital Health', marketSize: 24_000_000_000, growth: 39, momentum: 'Aggressive', multiple: 12, notableDeals: ['Abridge — $150M', 'Cadence Health — $30M'], summary: 'AI for documentation, diagnostics, and clinical decision support.' },
  { id: 'sec-grid', name: 'Grid Software', industry: 'Climate & Energy', marketSize: 18_000_000_000, growth: 33, momentum: 'Growing', multiple: 10, notableDeals: ['Base Power — $200M', 'Lumen Robotics — $18M'], summary: 'Software to balance, forecast, and optimize the electrical grid.' },
  { id: 'sec-platformeng', name: 'Platform Engineering', industry: 'Developer Tools', marketSize: 14_000_000_000, growth: 29, momentum: 'Growing', multiple: 11, notableDeals: ['Vercel — $250M'], summary: 'Internal developer platforms and deployment infrastructure.' },
];

export const TREND_STAGES = [
  { id: 'emerging', label: 'Emerging' },
  { id: 'growing', label: 'Growing' },
  { id: 'mainstream', label: 'Mainstream' },
  { id: 'declining', label: 'Declining' },
];

export const TRENDS = [
  { id: 'tr-agents', title: 'Agentic AI workflows', category: 'Artificial Intelligence', stage: 'growing', impact: 'High', timeHorizon: '1–2 years', description: 'Software that plans and executes multi-step tasks with limited human input.', signals: ['Enterprise pilots moving to production', 'Rapid tool-use benchmark gains', 'New agent-native startups every week'], relatedSectors: ['AI Agents', 'AI Infrastructure'] },
  { id: 'tr-inference', title: 'Inference cost collapse', category: 'Artificial Intelligence', stage: 'mainstream', impact: 'High', timeHorizon: 'Now', description: 'Order-of-magnitude drops in cost per token are unlocking new product economics.', signals: ['Open-weight models near frontier', 'Custom silicon shipping', 'Aggressive provider price cuts'], relatedSectors: ['AI Infrastructure'] },
  { id: 'tr-embfin', title: 'Embedded finance everywhere', category: 'FinTech', stage: 'growing', impact: 'Medium', timeHorizon: '2–3 years', description: 'Non-financial software adds payments, lending, and banking as native features.', signals: ['BaaS providers scaling', 'Vertical SaaS adding finance', 'Rising interchange revenue'], relatedSectors: ['Embedded Finance'] },
  { id: 'tr-clinai', title: 'Ambient clinical documentation', category: 'Digital Health', stage: 'growing', impact: 'High', timeHorizon: '1–2 years', description: 'AI scribes cut clinician admin burden and are reaching reimbursement clarity.', signals: ['Health-system rollouts', 'Payer pilots', 'Strong clinician NPS'], relatedSectors: ['Clinical AI'] },
  { id: 'tr-longstorage', title: 'Long-duration energy storage', category: 'Climate & Energy', stage: 'emerging', impact: 'High', timeHorizon: '3–5 years', description: 'Storage beyond lithium for multi-day grid balancing.', signals: ['First utility-scale deployments', 'Falling $/kWh', 'Policy incentives'], relatedSectors: ['Grid Software'] },
  { id: 'tr-nocode', title: 'No-code app builders', category: 'Developer Tools', stage: 'declining', impact: 'Low', timeHorizon: 'Now', description: 'General no-code is being absorbed by AI code generation.', signals: ['Flat funding', 'Consolidation', 'AI-native replacements'], relatedSectors: ['Platform Engineering'] },
];

export const MACRO = {
  asOf: TODAY,
  indicators: [
    { label: 'Fed funds rate', value: '4.25%', trend: 'down', note: 'Two cuts priced in for H2.' },
    { label: 'Inflation (CPI)', value: '2.6%', trend: 'down', note: 'Cooling toward target.' },
    { label: 'IPO window', value: 'Opening', trend: 'up', note: 'Several tech names on file.' },
    { label: 'Global VC funding (Q2)', value: '$78B', trend: 'up', note: 'Up 12% QoQ, AI-led.' },
    { label: 'Median Series A', value: '$14M', trend: 'up', note: 'Premiums for AI-native teams.' },
    { label: 'Exit environment', value: 'Improving', trend: 'up', note: 'M&A picking up; SPACs quiet.' },
  ],
  regions: [
    { region: 'North America', vcFunding: 46_000_000_000, growth: 14, ipoWindow: 'Opening', note: 'AI infrastructure and defense tech lead.' },
    { region: 'Europe', vcFunding: 16_000_000_000, growth: 9, ipoWindow: 'Selective', note: 'Deep tech and climate strength.' },
    { region: 'Asia-Pacific', vcFunding: 12_000_000_000, growth: 6, ipoWindow: 'Selective', note: 'India and Japan up; China muted.' },
    { region: 'Middle East', vcFunding: 3_500_000_000, growth: 21, ipoWindow: 'Opening', note: 'Sovereign capital scaling fast.' },
  ],
  commentary: 'A soft-landing base case is pulling risk appetite back. Capital is concentrated in AI and climate deployment; generalist rounds remain disciplined on price.',
};

export const GEOGRAPHIES = [
  { id: 'geo-na', region: 'North America', dealVolume: 3120, totalFunding: 46_000_000_000, growth: 14, hubs: ['San Francisco', 'New York', 'Boston', 'Toronto'], topSectors: ['AI Infrastructure', 'Clinical AI', 'Embedded Finance'], notableCompanies: ['OpenAI', 'Ramp', 'Northwind Labs'] },
  { id: 'geo-eu', region: 'Europe', dealVolume: 1980, totalFunding: 16_000_000_000, growth: 9, hubs: ['London', 'Paris', 'Berlin', 'Stockholm'], topSectors: ['AI Agents', 'Climate Hardware', 'Grid Software'], notableCompanies: ['Mistral', 'Form Energy EU', 'Lumen Robotics'] },
  { id: 'geo-apac', region: 'Asia-Pacific', dealVolume: 2440, totalFunding: 12_000_000_000, growth: 6, hubs: ['Singapore', 'Bangalore', 'Tokyo', 'Sydney'], topSectors: ['FinTech', 'Developer Tools', 'AI Applications'], notableCompanies: ['Sarvam', 'Sakana AI'] },
  { id: 'geo-me', region: 'Middle East', dealVolume: 620, totalFunding: 3_500_000_000, growth: 21, hubs: ['Dubai', 'Riyadh', 'Abu Dhabi'], topSectors: ['AI Infrastructure', 'Climate & Energy'], notableCompanies: ['G42', 'Humain'] },
];

// ===========================================================================
// COMPANIES — Startups, Unicorns, Public, Exits, Funding Rounds
// ===========================================================================
export const COMPANY_DATASETS = [
  { id: 'startups', label: 'Startups' },
  { id: 'unicorns', label: 'Unicorns' },
  { id: 'public', label: 'Public' },
  { id: 'exits', label: 'Exits' },
  { id: 'rounds', label: 'Funding Rounds' },
];

export const STARTUPS = [
  { id: 'st-northwind', name: 'Northwind Labs', sector: 'AI Infrastructure', stage: 'Seed', founded: 2023, hq: 'San Francisco, USA', employees: 34, totalFunding: 60_000_000, lastRound: 'Seed', valuation: 280_000_000, description: 'Developer platform for running and observing LLM pipelines in production.', investors: ['Axal VC', 'Sequoia', 'South Park Commons'], founders: ['Dara Okafor', 'Sam Reilly'] },
  { id: 'st-cadence', name: 'Cadence Health', sector: 'Clinical AI', stage: 'Series A', founded: 2022, hq: 'Boston, USA', employees: 58, totalFunding: 30_000_000, lastRound: 'Series A', valuation: 160_000_000, description: 'Ambient clinical documentation for outpatient care teams.', investors: ['a16z Bio', 'Axal VC'], founders: ['Priya Nair'] },
  { id: 'st-lumen', name: 'Lumen Robotics', sector: 'Climate Hardware', stage: 'Series A', founded: 2021, hq: 'Denver, USA', employees: 72, totalFunding: 18_000_000, lastRound: 'Series A', valuation: 120_000_000, description: 'Autonomous field robots for utility-scale solar maintenance.', investors: ['Lowercarbon', 'Axal VC'], founders: ['Marco Diaz'] },
  { id: 'st-harbor', name: 'Harbor Analytics', sector: 'Data Analytics', stage: 'Seed', founded: 2023, hq: 'New York, USA', employees: 21, totalFunding: 8_000_000, lastRound: 'Seed', valuation: 45_000_000, description: 'Enterprise analytics platform moving upmarket into mid-market.', investors: ['Bessemer', 'Axal VC'], founders: ['Elena Fischer'] },
  { id: 'st-vertex', name: 'Vertex Mobility', sector: 'Mobility', stage: 'Series A', founded: 2021, hq: 'Austin, USA', employees: 64, totalFunding: 22_000_000, lastRound: 'Series A', valuation: 130_000_000, description: 'Fleet electrification software for last-mile logistics.', investors: ['Founders Fund'], founders: ['Sofia Klein'] },
  { id: 'st-atlas', name: 'Atlas Commerce', sector: 'E-commerce', stage: 'Seed', founded: 2024, hq: 'Los Angeles, USA', employees: 18, totalFunding: 3_500_000, lastRound: 'Seed', valuation: 20_000_000, description: 'Curated commerce marketplace for independent brands.', investors: ['Forerunner'], founders: ['Ryan Cole'] },
];

export const UNICORNS = [
  { id: 'uni-openai', name: 'OpenAI', sector: 'Artificial Intelligence', valuation: 157_000_000_000, hq: 'San Francisco, USA', founded: 2015, totalFunding: 21_900_000_000, investors: ['Microsoft', 'Thrive', 'Khosla'], status: 'Active' },
  { id: 'uni-anthropic', name: 'Anthropic', sector: 'Artificial Intelligence', valuation: 61_500_000_000, hq: 'San Francisco, USA', founded: 2021, totalFunding: 9_700_000_000, investors: ['Google', 'Spark', 'Lightspeed'], status: 'Active' },
  { id: 'uni-stripe', name: 'Stripe', sector: 'FinTech', valuation: 70_000_000_000, hq: 'San Francisco, USA', founded: 2010, totalFunding: 9_400_000_000, investors: ['Sequoia', 'a16z', 'Founders Fund'], status: 'Active' },
  { id: 'uni-ramp', name: 'Ramp', sector: 'FinTech', valuation: 22_500_000_000, hq: 'New York, USA', founded: 2019, totalFunding: 2_000_000_000, investors: ['Founders Fund', 'Thrive'], status: 'Active' },
  { id: 'uni-mistral', name: 'Mistral AI', sector: 'Artificial Intelligence', valuation: 6_000_000_000, hq: 'Paris, France', founded: 2023, totalFunding: 1_100_000_000, investors: ['General Catalyst', 'a16z'], status: 'Active' },
  { id: 'uni-form', name: 'Form Energy', sector: 'Climate & Energy', valuation: 3_200_000_000, hq: 'Somerville, USA', founded: 2017, totalFunding: 1_200_000_000, investors: ['Breakthrough', 'ArcelorMittal'], status: 'Active' },
];

export const PUBLIC_COMPANIES = [
  { id: 'pub-nvda', name: 'NVIDIA', ticker: 'NVDA', sector: 'AI Infrastructure', marketCap: 3_200_000_000_000, price: 131.4, change: 2.3, pe: 62, revenue: 96_000_000_000, ipoDate: '1999-01-22' },
  { id: 'pub-crm', name: 'Salesforce', ticker: 'CRM', sector: 'Enterprise SaaS', marketCap: 265_000_000_000, price: 274.8, change: -0.6, pe: 44, revenue: 37_900_000_000, ipoDate: '2004-06-23' },
  { id: 'pub-dash', name: 'DoorDash', ticker: 'DASH', sector: 'Marketplace', marketCap: 62_000_000_000, price: 149.2, change: 1.1, pe: 118, revenue: 10_700_000_000, ipoDate: '2020-12-09' },
  { id: 'pub-snow', name: 'Snowflake', ticker: 'SNOW', sector: 'Data Infrastructure', marketCap: 54_000_000_000, price: 162.5, change: -1.4, pe: null, revenue: 3_500_000_000, ipoDate: '2020-09-16' },
  { id: 'pub-net', name: 'Cloudflare', ticker: 'NET', sector: 'Developer Tools', marketCap: 38_000_000_000, price: 111.7, change: 0.8, pe: null, revenue: 1_700_000_000, ipoDate: '2019-09-13' },
];

export const EXIT_TYPES = ['IPO', 'M&A', 'SPAC'];
export const EXITS = [
  { id: 'ex-1', company: 'Databricks', type: 'IPO', acquirer: null, value: 62_000_000_000, date: daysAgo(40), sector: 'Data Infrastructure', multiple: 24, investors: ['a16z', 'NEA'] },
  { id: 'ex-2', company: 'Wiz', type: 'M&A', acquirer: 'Google', value: 32_000_000_000, date: daysAgo(120), sector: 'Cybersecurity', multiple: 46, investors: ['Sequoia', 'Index'] },
  { id: 'ex-3', company: 'Loom', type: 'M&A', acquirer: 'Atlassian', value: 975_000_000, date: daysAgo(310), sector: 'Developer Tools', multiple: 12, investors: ['Kleiner Perkins'] },
  { id: 'ex-4', company: 'Nubank LatAm', type: 'IPO', acquirer: null, value: 41_000_000_000, date: daysAgo(200), sector: 'FinTech', multiple: 18, investors: ['Sequoia', 'Tiger'] },
  { id: 'ex-5', company: 'Rubrik', type: 'IPO', acquirer: null, value: 6_600_000_000, date: daysAgo(90), sector: 'Cybersecurity', multiple: 9, investors: ['Lightspeed', 'Greylock'] },
];

export const FUNDING_ROUNDS = [
  { id: 'rd-1', company: 'Cognition', stage: 'Series B', amount: 175_000_000, valuation: 4_000_000_000, date: daysAgo(6), sector: 'AI Agents', leadInvestor: 'Founders Fund', investors: ['Founders Fund', '8VC'] },
  { id: 'rd-2', company: 'Together AI', stage: 'Series B', amount: 305_000_000, valuation: 3_300_000_000, date: daysAgo(18), sector: 'AI Infrastructure', leadInvestor: 'General Catalyst', investors: ['General Catalyst', 'Prosperity7'] },
  { id: 'rd-3', company: 'Northwind Labs', stage: 'Seed', amount: 60_000_000, valuation: 280_000_000, date: daysAgo(24), sector: 'AI Infrastructure', leadInvestor: 'Sequoia', investors: ['Sequoia', 'Axal VC'] },
  { id: 'rd-4', company: 'Abridge', stage: 'Series C', amount: 150_000_000, valuation: 2_500_000_000, date: daysAgo(33), sector: 'Clinical AI', leadInvestor: 'IVP', investors: ['IVP', 'Lightspeed'] },
  { id: 'rd-5', company: 'Base Power', stage: 'Series B', amount: 200_000_000, valuation: 1_000_000_000, date: daysAgo(52), sector: 'Grid Software', leadInvestor: 'Andreessen Horowitz', investors: ['a16z', 'Valor'] },
  { id: 'rd-6', company: 'Cadence Health', stage: 'Series A', amount: 30_000_000, valuation: 160_000_000, date: daysAgo(70), sector: 'Clinical AI', leadInvestor: 'a16z Bio', investors: ['a16z Bio', 'Axal VC'] },
];

// ===========================================================================
// DOCUMENTS — searchable library
// ===========================================================================
export const DOCUMENT_TYPES = [
  { id: 'deck', label: 'Pitch Decks' },
  { id: 'memo', label: 'Investment Memos' },
  { id: 'pdf', label: 'PDFs' },
  { id: 'contract', label: 'Contracts' },
  { id: 'paper', label: 'Research Papers' },
];

export const DOCUMENTS = [
  { id: 'doc-1', title: 'Northwind Labs — Seed pitch deck', type: 'deck', source: 'Founder shared', author: 'Dara Okafor', date: daysAgo(26), pages: 18, tags: ['AI Infrastructure', 'Seed'], confidentiality: 'Confidential', summary: 'Seed-stage deck covering the LLM observability platform, traction, and $60M raise.' },
  { id: 'doc-2', title: 'AI Infrastructure — investment memo', type: 'memo', source: 'Internal', author: 'You', date: daysAgo(20), pages: 9, tags: ['AI Infrastructure', 'Thesis'], confidentiality: 'Internal', summary: 'Thesis memo on the AI infrastructure sector and the Northwind opportunity.' },
  { id: 'doc-3', title: 'Cadence Health — Series A memo', type: 'memo', source: 'Internal', author: 'You', date: daysAgo(64), pages: 11, tags: ['Clinical AI', 'Series A'], confidentiality: 'Internal', summary: 'Diligence memo on ambient clinical documentation and reimbursement path.' },
  { id: 'doc-4', title: 'State of AI Agents 2026', type: 'paper', source: 'Public research', author: 'Air Street Capital', date: daysAgo(48), pages: 42, tags: ['AI Agents', 'Market'], confidentiality: 'Public', summary: 'Annual landscape of agentic AI adoption, benchmarks, and funding.' },
  { id: 'doc-5', title: 'Mutual NDA — Harbor Analytics', type: 'contract', source: 'Legal', author: 'Legal team', date: daysAgo(14), pages: 4, tags: ['NDA', 'Legal'], confidentiality: 'Confidential', summary: 'Signed mutual non-disclosure agreement covering diligence materials.' },
  { id: 'doc-6', title: 'Climate hardware landscape', type: 'pdf', source: 'Public research', author: 'Sightline Climate', date: daysAgo(80), pages: 28, tags: ['Climate & Energy', 'Market'], confidentiality: 'Public', summary: 'Market map and deployment economics for climate hardware.' },
  { id: 'doc-7', title: 'Lumen Robotics — Series B deck (draft)', type: 'deck', source: 'Founder shared', author: 'Marco Diaz', date: daysAgo(9), pages: 22, tags: ['Climate Hardware', 'Series B'], confidentiality: 'Confidential', summary: 'Draft Series B narrative and metrics for the fundraising sprint.' },
  { id: 'doc-8', title: 'Embedded finance economics', type: 'paper', source: 'Public research', author: 'a16z', date: daysAgo(150), pages: 16, tags: ['FinTech', 'Embedded Finance'], confidentiality: 'Public', summary: 'Unit economics and take-rate benchmarks across embedded finance.' },
];

// ===========================================================================
// AI RESEARCH — clearly-labelled sample surfaces
// ===========================================================================
export const AI_TABS = [
  { id: 'search', label: 'AI Search' },
  { id: 'analyst', label: 'AI Analyst' },
  { id: 'comparables', label: 'Comparable Companies' },
  { id: 'maps', label: 'Market Maps' },
  { id: 'reports', label: 'Company Reports' },
];

// Sample AI search: a canned query with sourced results.
export const AI_SEARCH_SAMPLE = {
  query: 'Which AI infrastructure startups are best positioned for the inference-cost decline?',
  answer: 'Startups that own the inference layer (routing, caching, and observability) capture the most value as token costs fall, because they monetize volume rather than model access. Northwind Labs and Together AI are the clearest examples; both sit between applications and models where switching costs accrue.',
  sources: [
    { title: 'State of AI Agents 2026', ref: 'doc-4' },
    { title: 'AI Infrastructure — investment memo', ref: 'doc-2' },
    { title: 'Together AI — Series B round', ref: 'rd-2' },
  ],
  related: ['Inference cost collapse', 'AI Infrastructure', 'AI Agents'],
};

// Sample AI analyst: canned analytical prompts + outputs.
export const AI_ANALYST_SAMPLES = [
  { id: 'an-1', prompt: 'Summarize the AI infrastructure sector for an LP update', output: 'AI infrastructure grew 44% YoY to an ~$88B sector. Value is shifting from raw model access to the inference and orchestration layer. Our exposure (Northwind Labs) sits in this durable pocket; key risk is hyperscaler bundling.' },
  { id: 'an-2', prompt: 'What are the risks in the climate hardware thesis?', output: 'Deployment capital intensity, project-financing dependence, and lengthening sales cycles are the top risks. Lumen Robotics mitigates via a software-attach motion, but hardware margins remain the watch item.' },
  { id: 'an-3', prompt: 'Compare Series A valuations in Clinical AI', output: 'Median Clinical AI Series A is ~$150M post, a premium to the $120M cross-sector median, driven by reimbursement clarity for ambient documentation. Cadence Health priced below median, suggesting upside.' },
];

// Sample comparables: pick a company, get a peer set.
export const COMPARABLES_SAMPLE = {
  base: 'Northwind Labs',
  peers: [
    { name: 'Together AI', stage: 'Series B', valuation: 3_300_000_000, growth: 210, revenueMultiple: 42, note: 'Later-stage, similar inference focus.' },
    { name: 'Baseten', stage: 'Series B', valuation: 825_000_000, growth: 160, revenueMultiple: 28, note: 'Model deployment adjacency.' },
    { name: 'Modal', stage: 'Series A', valuation: 350_000_000, growth: 140, revenueMultiple: 22, note: 'Serverless compute overlap.' },
    { name: 'Northwind Labs', stage: 'Seed', valuation: 280_000_000, growth: 300, revenueMultiple: 35, note: 'Base company — earliest stage, fastest growth.' },
  ],
};

// Sample market maps: a category grid of companies.
export const MARKET_MAPS = [
  { id: 'map-aiinfra', category: 'AI Infrastructure', segments: [
    { name: 'Inference', companies: ['Together AI', 'Baseten', 'Northwind Labs'] },
    { name: 'Training', companies: ['Mosaic', 'Foundry'] },
    { name: 'Observability', companies: ['Northwind Labs', 'Arize', 'LangSmith'] },
  ] },
  { id: 'map-clinai', category: 'Clinical AI', segments: [
    { name: 'Documentation', companies: ['Abridge', 'Cadence Health', 'Nuance'] },
    { name: 'Diagnostics', companies: ['Aidoc', 'Viz.ai'] },
    { name: 'Decision support', companies: ['Glass Health'] },
  ] },
  { id: 'map-climate', category: 'Climate Hardware', segments: [
    { name: 'Field robotics', companies: ['Lumen Robotics'] },
    { name: 'Storage', companies: ['Form Energy', 'ESS'] },
    { name: 'Grid', companies: ['Base Power', 'Amperon'] },
  ] },
];

// Sample company reports: generated reports with detail.
export const COMPANY_REPORTS = [
  { id: 'rep-northwind', company: 'Northwind Labs', generated: daysAgo(4), sector: 'AI Infrastructure', score: 82, recommendation: 'Strong follow-on candidate', summary: 'AI-native inference and observability platform with fast growth and a durable position between apps and models.', strengths: ['Fast revenue growth (~300% YoY)', 'Strong technical founding team', 'Durable inference-layer position'], risks: ['Hyperscaler bundling', 'Early revenue base', 'Competitive infra market'], sections: ['Business overview', 'Market position', 'Financial snapshot', 'Risk assessment'] },
  { id: 'rep-cadence', company: 'Cadence Health', generated: daysAgo(12), sector: 'Clinical AI', score: 74, recommendation: 'Monitor — pricing upside', summary: 'Ambient clinical documentation with reimbursement clarity; priced below sector median at Series A.', strengths: ['Reimbursement path clearing', 'High clinician NPS', 'Attractive entry valuation'], risks: ['Distribution into health systems', 'Incumbent competition'], sections: ['Business overview', 'Market position', 'Financial snapshot', 'Risk assessment'] },
  { id: 'rep-lumen', company: 'Lumen Robotics', generated: daysAgo(9), sector: 'Climate Hardware', score: 68, recommendation: 'Support fundraise', summary: 'Field robotics for solar maintenance with a software-attach motion; capital-intensive but policy-favored.', strengths: ['Policy tailwinds', 'Software attach improves margins', 'Strong pilot results'], risks: ['Hardware margins', 'Deployment capital intensity'], sections: ['Business overview', 'Market position', 'Financial snapshot', 'Risk assessment'] },
];

// ===========================================================================
// NEWS — categorized feed
// ===========================================================================
export const NEWS_CATEGORIES = [
  { id: 'industry', label: 'Industry' },
  { id: 'portfolio', label: 'Portfolio' },
  { id: 'competitor', label: 'Competitor' },
  { id: 'funding', label: 'Funding' },
  { id: 'acquisitions', label: 'Acquisitions' },
  { id: 'ipo', label: 'IPO' },
];

export const NEWS = [
  { id: 'nw-1', headline: 'Inference costs fall another 40% as open-weight models close the gap', category: 'industry', source: 'The Information', date: daysAgo(1), sentiment: 'positive', companies: ['OpenAI', 'Mistral'], summary: 'A fresh round of provider price cuts and open-weight releases is reshaping AI infrastructure economics.' },
  { id: 'nw-2', headline: 'Northwind Labs closes $60M seed to scale LLM observability', category: 'portfolio', source: 'TechCrunch', date: daysAgo(24), sentiment: 'positive', companies: ['Northwind Labs'], summary: 'Portfolio company Northwind Labs raised a large seed led by Sequoia to expand its inference platform.' },
  { id: 'nw-3', headline: 'Together AI raises $305M Series B, intensifying infra competition', category: 'competitor', source: 'Bloomberg', date: daysAgo(18), sentiment: 'neutral', companies: ['Together AI'], summary: 'A well-funded competitor in AI infrastructure signals a more crowded inference market.' },
  { id: 'nw-4', headline: 'Cognition lands $175M for autonomous software agents', category: 'funding', source: 'Reuters', date: daysAgo(6), sentiment: 'neutral', companies: ['Cognition'], summary: 'Agentic AI funding continues at pace as enterprises pilot autonomous workflows.' },
  { id: 'nw-5', headline: 'Google to acquire Wiz for $32B in landmark security deal', category: 'acquisitions', source: 'WSJ', date: daysAgo(120), sentiment: 'positive', companies: ['Wiz', 'Google'], summary: 'One of the largest cybersecurity acquisitions ever, signaling strong strategic-buyer appetite.' },
  { id: 'nw-6', headline: 'Databricks debuts on public markets at $62B valuation', category: 'ipo', source: 'CNBC', date: daysAgo(40), sentiment: 'positive', companies: ['Databricks'], summary: 'A strong data-infrastructure IPO reopens the exit window for late-stage software.' },
  { id: 'nw-7', headline: 'Ambient clinical AI reaches reimbursement clarity in new payer guidance', category: 'industry', source: 'STAT News', date: daysAgo(10), sentiment: 'positive', companies: ['Abridge', 'Cadence Health'], summary: 'Updated payer guidance is accelerating adoption of AI clinical documentation.' },
  { id: 'nw-8', headline: 'Lumen Robotics begins Series B process amid climate funding rebound', category: 'portfolio', source: 'Axios Pro', date: daysAgo(9), sentiment: 'neutral', companies: ['Lumen Robotics'], summary: 'Portfolio company Lumen Robotics kicks off a $12M Series B into a recovering climate market.' },
  { id: 'nw-9', headline: 'Rubrik IPO prices above range, boosting cybersecurity comps', category: 'ipo', source: 'Reuters', date: daysAgo(90), sentiment: 'positive', companies: ['Rubrik'], summary: 'A well-received IPO lifts valuation benchmarks across the security sector.' },
];

// Lookup helpers ------------------------------------------------------------
export function documentById(id) {
  return DOCUMENTS.find((d) => d.id === id) || null;
}
