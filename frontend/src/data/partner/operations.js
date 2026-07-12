// Partner Operations — deterministic mock data for the service-partner Operations
// workspace (Overview, Capabilities, Portfolio, Engagements, Performance). This
// is placeholder data only: there is no backend behind it yet, so it is modelled
// here and structured to be swapped for a live API later. Everything is
// deterministic — the demo "today" is fixed at 2026-07-11 and no value depends on
// Date.now / Math.random / a zero-argument new Date(). Dates are plain ISO
// strings; date-only strings are formatted in UTC so they never drift a day.

export const TODAY = '2026-07-11';
const TODAY_MS = new Date(TODAY).getTime();
const DAY = 86400000;

// Deterministic date/format helpers ----------------------------------------
export function daysAgo(n) {
  return new Date(TODAY_MS - n * DAY).toISOString().slice(0, 10);
}
export function daysFromNow(n) {
  return new Date(TODAY_MS + n * DAY).toISOString().slice(0, 10);
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
  if (diff === 1) return 'Tomorrow';
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
// OVERVIEW — company profile of the service-partner firm
// ===========================================================================
export const FIRM = {
  name: 'BrightPath Advisory',
  tagline: 'Fractional go-to-market team for seed-to-Series-B B2B startups.',
  type: 'Service Partner',
  legalName: 'BrightPath Advisory LLC',
  founded: '2019',
  hq: 'Remote — global (San Francisco, USA)',
  teamSize: 14,
  website: 'https://brightpath.example',
  categories: ['Go-to-market', 'Growth strategy', 'Sales enablement', 'Marketing', 'Revenue operations'],
  industriesServed: ['B2B SaaS', 'FinTech', 'Developer Tools', 'Climate & Energy', 'Digital Health'],
  geography: [
    { region: 'North America', coverage: 'Primary', note: 'SF, NYC, Toronto — most active market.' },
    { region: 'Europe', coverage: 'Active', note: 'London, Berlin, Amsterdam.' },
    { region: 'Asia-Pacific', coverage: 'Selective', note: 'Singapore and Sydney via partners.' },
  ],
  socials: [
    { label: 'Website', handle: 'brightpath.example', url: 'https://brightpath.example' },
    { label: 'LinkedIn', handle: '/company/brightpath', url: 'https://linkedin.example/company/brightpath' },
    { label: 'X', handle: '@brightpathgtm', url: 'https://x.example/brightpathgtm' },
  ],
  description: {
    mission: 'Help technical founders build repeatable, efficient go-to-market before they hire a full in-house team.',
    vision: 'Be the default fractional GTM partner for the best early-stage B2B companies in the world.',
    story: 'Founded in 2019 by a group of operators who had scaled GTM at three venture-backed startups, BrightPath started as a two-person advisory and grew into a 14-person collective spanning sales, marketing, and revenue operations.',
    valueProp: 'Senior operators embedded part-time — the experience of a VP of Sales and a VP of Marketing without the full-time cost or ramp.',
    pitch: 'We plug in for 3–6 months to design your GTM motion, stand up the systems, and hand off a running playbook your first full-time hires can own.',
  },
};

export const TEAM = [
  { id: 'tm-lena', name: 'Lena Fischer', title: 'Founder & Principal', team: 'Leadership', location: 'Berlin, DE', since: '2019-01-01', email: 'lena@brightpath.example', expertise: ['GTM strategy', 'Fundraising narrative', 'Org design'], bio: 'Founder of BrightPath. Previously VP Marketing at two Series-B SaaS companies; leads strategy engagements and executive coaching.' },
  { id: 'tm-marco', name: 'Marco Bianchi', title: 'GTM Lead', team: 'Delivery', location: 'San Francisco, USA', since: '2019-06-01', email: 'marco@brightpath.example', expertise: ['Sales process', 'Outbound', 'Pipeline design'], bio: 'Leads sales-focused engagements. Ex-Head of Sales at a developer-tools startup taken from $1M to $10M ARR.' },
  { id: 'tm-aria', name: 'Aria Kapoor', title: 'Head of Demand', team: 'Delivery', location: 'New York, USA', since: '2020-03-15', email: 'aria@brightpath.example', expertise: ['Demand gen', 'Paid acquisition', 'Lifecycle marketing'], bio: 'Runs demand-generation engagements and marketing analytics. Background in performance marketing for fintech.' },
  { id: 'tm-diego', name: 'Diego Santos', title: 'RevOps Lead', team: 'Delivery', location: 'Remote — LATAM', since: '2021-02-01', email: 'diego@brightpath.example', expertise: ['CRM architecture', 'Reporting', 'Forecasting'], bio: 'Stands up revenue-operations systems — CRM, attribution, and forecasting — for scaling teams.' },
  { id: 'tm-sofia', name: 'Sofia Meyer', title: 'Content Strategist', team: 'Delivery', location: 'London, UK', since: '2022-09-01', email: 'sofia@brightpath.example', expertise: ['Positioning', 'Content', 'Category design'], bio: 'Leads positioning and content strategy. Helps founders sharpen their story ahead of a raise.' },
  { id: 'tm-noah', name: 'Noah Adeyemi', title: 'Operations Manager', team: 'Operations', location: 'Remote — EU', since: '2023-01-10', email: 'noah@brightpath.example', expertise: ['Engagement delivery', 'Client success', 'Scheduling'], bio: 'Keeps engagements on track — scoping, staffing, and client communication across the portfolio.' },
];

// ===========================================================================
// CAPABILITIES — service catalog
// ===========================================================================
export const SERVICES = [
  { id: 'sv-gtm', name: 'GTM Strategy Sprint', category: 'Strategy', pricingModel: 'Fixed fee', priceRange: '$25K–$40K', duration: '6 weeks', summary: 'Design an end-to-end go-to-market motion: ICP, positioning, channels, and a 2-quarter plan.', deliverables: ['ICP & segmentation', 'Positioning & messaging', 'Channel strategy', '2-quarter GTM plan'], outcomes: ['Clear ideal-customer profile', 'A prioritized channel plan', 'Board-ready GTM narrative'] },
  { id: 'sv-sales', name: 'Sales Motion Build', category: 'Sales', pricingModel: 'Monthly retainer', priceRange: '$12K–$18K/mo', duration: '3–6 months', summary: 'Stand up a repeatable outbound + inbound sales process with playbooks and tooling.', deliverables: ['Sales playbook', 'Outbound sequences', 'CRM pipeline setup', 'Rep onboarding kit'], outcomes: ['Repeatable pipeline generation', 'Documented sales process', 'Ready to hire first AEs'] },
  { id: 'sv-demand', name: 'Demand Generation Engine', category: 'Marketing', pricingModel: 'Monthly retainer', priceRange: '$10K–$16K/mo', duration: '3–6 months', summary: 'Build and run a multi-channel demand program with attribution and reporting.', deliverables: ['Channel mix & budget', 'Campaign calendar', 'Attribution model', 'Monthly performance reviews'], outcomes: ['Predictable lead flow', 'Cost-per-opportunity clarity', 'A running demand calendar'] },
  { id: 'sv-revops', name: 'RevOps Foundations', category: 'RevOps', pricingModel: 'Fixed fee', priceRange: '$18K–$30K', duration: '4–8 weeks', summary: 'Architect CRM, reporting, and forecasting so revenue data is trustworthy.', deliverables: ['CRM architecture', 'Dashboards & reports', 'Forecasting model', 'Data hygiene playbook'], outcomes: ['Single source of revenue truth', 'Reliable forecasting', 'Clean pipeline data'] },
  { id: 'sv-position', name: 'Positioning & Narrative', category: 'Strategy', pricingModel: 'Fixed fee', priceRange: '$15K–$25K', duration: '4 weeks', summary: 'Sharpen positioning and the fundraising narrative ahead of a raise or launch.', deliverables: ['Positioning framework', 'Messaging hierarchy', 'Pitch narrative', 'Website copy audit'], outcomes: ['Differentiated positioning', 'A compelling raise narrative', 'Consistent messaging'] },
  { id: 'sv-fractional', name: 'Fractional VP of Sales', category: 'Sales', pricingModel: 'Monthly retainer', priceRange: '$16K–$22K/mo', duration: 'Ongoing', summary: 'An embedded senior sales leader to run the team while you hire full-time.', deliverables: ['Team leadership', 'Pipeline reviews', 'Hiring support', 'Board reporting'], outcomes: ['Experienced sales leadership', 'Faster full-time VP hire', 'Steady pipeline management'] },
];

export const EXPERTISE = [
  { area: 'Go-to-market strategy', level: 'Expert', years: 12 },
  { area: 'Sales process & enablement', level: 'Expert', years: 10 },
  { area: 'Demand generation', level: 'Expert', years: 9 },
  { area: 'Revenue operations', level: 'Advanced', years: 7 },
  { area: 'Positioning & messaging', level: 'Expert', years: 11 },
  { area: 'Pricing & packaging', level: 'Advanced', years: 6 },
];

export const TECHNOLOGIES = [
  { group: 'CRM & Sales', items: ['Salesforce', 'HubSpot', 'Attio', 'Apollo', 'Outreach'] },
  { group: 'Marketing', items: ['Marketo', 'Customer.io', 'Webflow', 'Google Ads', 'LinkedIn Ads'] },
  { group: 'Analytics & RevOps', items: ['Looker', 'dbt', 'Segment', 'Clearbit', 'Census'] },
  { group: 'Collaboration', items: ['Notion', 'Slack', 'Linear', 'Figma'] },
];

export const CAPABILITY_INDUSTRIES = ['B2B SaaS', 'FinTech', 'Developer Tools', 'Climate & Energy', 'Digital Health', 'Marketplaces'];

export const STAGES_SUPPORTED = [
  { stage: 'Pre-Seed', fit: 'Selective', note: 'Positioning and first GTM hypotheses.' },
  { stage: 'Seed', fit: 'Core', note: 'Primary sweet spot — first repeatable motion.' },
  { stage: 'Series A', fit: 'Core', note: 'Scaling the motion and building the team.' },
  { stage: 'Series B', fit: 'Active', note: 'RevOps maturity and demand scale.' },
  { stage: 'Growth', fit: 'Selective', note: 'Special projects and interim leadership.' },
];

export const TYPICAL_ENGAGEMENTS = [
  { name: 'GTM Sprint', duration: '4–6 weeks', format: 'Fixed-fee project', description: 'A focused strategy engagement to design the motion.' },
  { name: 'Embedded Retainer', duration: '3–6 months', format: 'Monthly retainer', description: 'Ongoing hands-on delivery with a dedicated lead.' },
  { name: 'Fractional Leadership', duration: 'Ongoing', format: 'Monthly retainer', description: 'A part-time senior leader running a function.' },
  { name: 'Advisory', duration: 'Ongoing', format: 'Light retainer', description: 'Monthly strategic guidance and reviews.' },
];

// ===========================================================================
// PORTFOLIO — proof of work
// ===========================================================================
export const CLIENTS = [
  { id: 'cl-northwind', name: 'Northwind Labs', industry: 'AI Infrastructure', stage: 'Seed', relationship: 'Retainer', since: '2025-09-01', status: 'Active' },
  { id: 'cl-lumen', name: 'Lumen Analytics', industry: 'Data / SaaS', stage: 'Series A', relationship: 'Project', since: '2025-04-15', status: 'Active' },
  { id: 'cl-ledgerly', name: 'Ledgerly', industry: 'FinTech', stage: 'Pre-Seed', relationship: 'Advisory', since: '2026-01-20', status: 'Active' },
  { id: 'cl-ceres', name: 'Ceres Bio', industry: 'Climate / Biotech', stage: 'Seed', relationship: 'Project', since: '2024-11-05', status: 'Completed' },
  { id: 'cl-vertex', name: 'Vertex Mobility', industry: 'Mobility', stage: 'Series A', relationship: 'Retainer', since: '2025-06-10', status: 'Active' },
  { id: 'cl-atlas', name: 'Atlas Commerce', industry: 'E-commerce', stage: 'Seed', relationship: 'Project', since: '2024-08-01', status: 'Completed' },
];

export const PORTFOLIO_COMPANIES = [
  { name: 'Northwind Labs', sector: 'AI Infrastructure', note: 'Sales motion + RevOps foundations.' },
  { name: 'Lumen Analytics', sector: 'Data / SaaS', note: 'Demand generation engine.' },
  { name: 'Vertex Mobility', sector: 'Mobility', note: 'Fractional VP of Sales.' },
  { name: 'Ceres Bio', sector: 'Climate', note: 'Positioning & narrative for Series A.' },
  { name: 'Atlas Commerce', sector: 'E-commerce', note: 'GTM strategy sprint.' },
  { name: 'Ledgerly', sector: 'FinTech', note: 'GTM advisory.' },
];

export const CASE_STUDIES = [
  {
    id: 'cs-northwind', title: 'From founder-led sales to a repeatable pipeline', client: 'Northwind Labs', industry: 'AI Infrastructure', date: daysAgo(60),
    services: ['Sales Motion Build', 'RevOps Foundations'],
    challenge: 'Northwind was closing deals through founder hustle but had no repeatable process or pipeline visibility ahead of its Series A.',
    approach: 'We designed an outbound + inbound motion, built the CRM and pipeline stages, wrote the sales playbook, and ran the first two months of pipeline reviews.',
    results: ['3.2x increase in qualified pipeline', 'First two AEs onboarded on the new playbook', 'Board-ready pipeline dashboard'],
    metrics: [{ label: 'Qualified pipeline', value: '+220%' }, { label: 'Sales cycle', value: '-18%' }, { label: 'Time to first AE ramp', value: '5 weeks' }],
  },
  {
    id: 'cs-lumen', title: 'Building a predictable demand engine', client: 'Lumen Analytics', industry: 'Data / SaaS', date: daysAgo(120),
    services: ['Demand Generation Engine'],
    challenge: 'Lumen relied on unpredictable inbound and had no attribution, making budget decisions guesswork.',
    approach: 'We built a multi-channel demand program, implemented attribution, and ran monthly performance reviews to reallocate budget toward the best channels.',
    results: ['Predictable monthly lead flow', 'Clear cost-per-opportunity by channel', '2.1x marketing-sourced pipeline'],
    metrics: [{ label: 'MQL → SQL rate', value: '+35%' }, { label: 'Cost per opportunity', value: '-27%' }, { label: 'Marketing-sourced pipeline', value: '2.1x' }],
  },
  {
    id: 'cs-ceres', title: 'Positioning for a Series A raise', client: 'Ceres Bio', industry: 'Climate / Biotech', date: daysAgo(210),
    services: ['Positioning & Narrative'],
    challenge: 'Ceres had strong science but a story investors struggled to follow, slowing its raise.',
    approach: 'We rebuilt the positioning framework, sharpened the messaging hierarchy, and crafted a pitch narrative connecting the science to a commercial wedge.',
    results: ['Closed an $8M Series A', 'Clear, repeatable investor narrative', 'Refreshed website and deck'],
    metrics: [{ label: 'Raise closed', value: '$8M' }, { label: 'Time to term sheet', value: '9 weeks' }],
  },
];

export const SUCCESS_STORIES = [
  { id: 'ss-1', client: 'Northwind Labs', headline: 'Series A pipeline built in one quarter', metric: '+220% pipeline', quote: 'BrightPath turned our founder-led selling into a real machine. We walked into our A with a pipeline dashboard investors loved.' },
  { id: 'ss-2', client: 'Vertex Mobility', headline: 'Hired a full-time VP off a strong foundation', metric: '4-month bridge', quote: 'Their fractional VP ran our team while we searched. The full-time hire inherited a healthy, well-run org.' },
  { id: 'ss-3', client: 'Ceres Bio', headline: 'A narrative that closed the round', metric: '$8M Series A', quote: 'They made our science make sense to generalist investors. The raise moved fast after that.' },
];

export const REFERENCES = [
  { id: 'rf-dara', name: 'Dara Okafor', title: 'Co-founder & CEO', company: 'Northwind Labs', relationship: 'Retainer client', quote: 'One of the highest-leverage partners we have worked with. Senior operators who actually do the work.' },
  { id: 'rf-owen', name: 'Owen Blackwood', title: 'CEO', company: 'Lumen Analytics', relationship: 'Project client', quote: 'Our demand program went from guesswork to a spreadsheet the whole team trusts.' },
  { id: 'rf-elena', name: 'Dr. Elena Rossi', title: 'Co-founder & CEO', company: 'Ceres Bio', relationship: 'Project client', quote: 'They found the words for what we do. It changed how investors responded to us.' },
];

// ===========================================================================
// ENGAGEMENTS — project & contract management
// ===========================================================================
export const PROJECTS = [
  { id: 'pj-northwind', name: 'Sales Motion Build', client: 'Northwind Labs', status: 'active', progress: 65, start: daysAgo(48), end: daysFromNow(42), type: 'Retainer', lead: 'Marco Bianchi', team: ['Marco Bianchi', 'Diego Santos'], budget: 90000, summary: 'Standing up the outbound + inbound motion and CRM ahead of the Series A.' },
  { id: 'pj-lumen', name: 'Demand Generation Engine', client: 'Lumen Analytics', status: 'active', progress: 40, start: daysAgo(30), end: daysFromNow(60), type: 'Retainer', lead: 'Aria Kapoor', team: ['Aria Kapoor', 'Sofia Meyer'], budget: 78000, summary: 'Multi-channel demand program with attribution and monthly reviews.' },
  { id: 'pj-vertex', name: 'Fractional VP of Sales', client: 'Vertex Mobility', status: 'active', progress: 55, start: daysAgo(95), end: daysFromNow(30), type: 'Fractional', lead: 'Marco Bianchi', team: ['Marco Bianchi'], budget: 120000, summary: 'Interim sales leadership while Vertex recruits a full-time VP.' },
  { id: 'pj-ledgerly', name: 'GTM Advisory', client: 'Ledgerly', status: 'active', progress: 25, start: daysAgo(20), end: daysFromNow(100), type: 'Advisory', lead: 'Lena Fischer', team: ['Lena Fischer'], budget: 30000, summary: 'Monthly strategic guidance on the early GTM motion.' },
  { id: 'pj-ceres', name: 'Positioning & Narrative', client: 'Ceres Bio', status: 'completed', progress: 100, start: daysAgo(240), end: daysAgo(205), type: 'Project', lead: 'Sofia Meyer', team: ['Sofia Meyer', 'Lena Fischer'], budget: 22000, summary: 'Positioning framework and fundraising narrative for the Series A.' },
  { id: 'pj-atlas', name: 'GTM Strategy Sprint', client: 'Atlas Commerce', status: 'completed', progress: 100, start: daysAgo(330), end: daysAgo(288), type: 'Project', lead: 'Lena Fischer', team: ['Lena Fischer', 'Aria Kapoor'], budget: 32000, summary: 'End-to-end GTM plan for the seed-stage launch.' },
];

export const RETAINERS = [
  { id: 'rt-northwind', client: 'Northwind Labs', scope: 'Sales motion + RevOps', monthly: 15000, start: daysAgo(48), renewal: daysFromNow(42), status: 'Active' },
  { id: 'rt-lumen', client: 'Lumen Analytics', scope: 'Demand generation', monthly: 13000, start: daysAgo(30), renewal: daysFromNow(60), status: 'Active' },
  { id: 'rt-vertex', client: 'Vertex Mobility', scope: 'Fractional VP of Sales', monthly: 20000, start: daysAgo(95), renewal: daysFromNow(30), status: 'Renewal due' },
];

export const CONTRACTS = [
  { id: 'ct-northwind', title: 'Master Services Agreement', client: 'Northwind Labs', type: 'MSA', value: 90000, start: daysAgo(48), end: daysFromNow(42), status: 'Active' },
  { id: 'ct-lumen', title: 'Statement of Work — Demand', client: 'Lumen Analytics', type: 'SOW', value: 78000, start: daysAgo(30), end: daysFromNow(60), status: 'Active' },
  { id: 'ct-vertex', title: 'Fractional Leadership Agreement', client: 'Vertex Mobility', type: 'Retainer', value: 120000, start: daysAgo(95), end: daysFromNow(30), status: 'Renewal due' },
  { id: 'ct-ledgerly', title: 'Advisory Agreement', client: 'Ledgerly', type: 'Advisory', value: 30000, start: daysAgo(20), end: daysFromNow(100), status: 'Active' },
  { id: 'ct-ceres', title: 'Statement of Work — Positioning', client: 'Ceres Bio', type: 'SOW', value: 22000, start: daysAgo(240), end: daysAgo(205), status: 'Closed' },
];

export const DELIVERABLES = [
  { id: 'dl-1', name: 'Sales playbook v1', project: 'Sales Motion Build', client: 'Northwind Labs', status: 'in_progress', due: daysFromNow(9), owner: 'Marco Bianchi' },
  { id: 'dl-2', name: 'CRM pipeline configuration', project: 'Sales Motion Build', client: 'Northwind Labs', status: 'done', due: daysAgo(6), owner: 'Diego Santos' },
  { id: 'dl-3', name: 'Attribution model', project: 'Demand Generation Engine', client: 'Lumen Analytics', status: 'in_progress', due: daysFromNow(14), owner: 'Diego Santos' },
  { id: 'dl-4', name: 'Q3 campaign calendar', project: 'Demand Generation Engine', client: 'Lumen Analytics', status: 'review', due: daysFromNow(3), owner: 'Aria Kapoor' },
  { id: 'dl-5', name: 'Pipeline review — July', project: 'Fractional VP of Sales', client: 'Vertex Mobility', status: 'in_progress', due: daysFromNow(5), owner: 'Marco Bianchi' },
  { id: 'dl-6', name: 'GTM advisory memo', project: 'GTM Advisory', client: 'Ledgerly', status: 'not_started', due: daysFromNow(21), owner: 'Lena Fischer' },
  { id: 'dl-7', name: 'Positioning framework', project: 'Positioning & Narrative', client: 'Ceres Bio', status: 'done', due: daysAgo(215), owner: 'Sofia Meyer' },
];

// ===========================================================================
// PERFORMANCE — operational scorecard
// ===========================================================================
export const SCORECARD = [
  { label: 'Overall rating', value: '4.8', hint: 'across 24 reviews' },
  { label: 'Client NPS', value: '72', hint: 'last 12 months' },
  { label: 'Avg response time', value: '3.4h', hint: 'first response' },
  { label: 'On-time delivery', value: '94%', hint: 'milestones met' },
  { label: 'Active engagements', value: '4', hint: '2 retainers · 1 fractional' },
  { label: 'Repeat / referral rate', value: '61%', hint: 'of new engagements' },
];

export const RATINGS = [
  { category: 'Quality of work', score: 4.9 },
  { category: 'Communication', score: 4.8 },
  { category: 'Expertise', score: 4.9 },
  { category: 'Value for money', score: 4.5 },
  { category: 'Responsiveness', score: 4.7 },
];

export const FEEDBACK = [
  { id: 'fb-1', client: 'Northwind Labs', author: 'Dara Okafor', rating: 5, date: daysAgo(12), project: 'Sales Motion Build', comment: 'Exceptional. The playbook is exactly what our new AEs needed and the pipeline reviews kept us honest.' },
  { id: 'fb-2', client: 'Lumen Analytics', author: 'Owen Blackwood', rating: 5, date: daysAgo(34), project: 'Demand Generation Engine', comment: 'Turned our marketing into a system we can actually reason about. Attribution alone paid for the engagement.' },
  { id: 'fb-3', client: 'Vertex Mobility', author: 'Sofia Klein', rating: 4, date: daysAgo(51), project: 'Fractional VP of Sales', comment: 'Strong leadership and steady hand. Would have loved a bit more time on hiring, but overall excellent.' },
  { id: 'fb-4', client: 'Ceres Bio', author: 'Dr. Elena Rossi', rating: 5, date: daysAgo(200), project: 'Positioning & Narrative', comment: 'They found the words for our science. The raise moved quickly afterward.' },
];

export const OUTCOMES = [
  { label: 'Client pipeline generated', value: '$12.4M', hint: 'attributed across engagements' },
  { label: 'Avg pipeline lift', value: '+180%', hint: 'first two quarters' },
  { label: 'Raises supported', value: '$46M', hint: 'across 5 clients' },
  { label: 'Full-time hires enabled', value: '9', hint: 'GTM roles handed off' },
];

export const RESPONSE_METRICS = [
  { label: 'First response', value: '3.4h', target: '< 4h', met: true },
  { label: 'Resolution time', value: '1.8 days', target: '< 2 days', met: true },
  { label: 'Weekly check-in cadence', value: '100%', target: '100%', met: true },
  { label: 'Escalation response', value: '52 min', target: '< 1h', met: true },
];

export const ACTIVITY = [
  { id: 'ac-1', date: daysAgo(0), type: 'Deliverable', description: 'Submitted Q3 campaign calendar for Lumen Analytics review.' },
  { id: 'ac-2', date: daysAgo(1), type: 'Meeting', description: 'Weekly pipeline review with Northwind Labs.' },
  { id: 'ac-3', date: daysAgo(3), type: 'Feedback', description: 'Received a 5-star review from Northwind Labs.' },
  { id: 'ac-4', date: daysAgo(5), type: 'Milestone', description: 'Completed CRM pipeline configuration for Northwind Labs.' },
  { id: 'ac-5', date: daysAgo(8), type: 'Engagement', description: 'Kicked off GTM Advisory with Ledgerly.' },
  { id: 'ac-6', date: daysAgo(12), type: 'Meeting', description: 'Monthly business review with Vertex Mobility.' },
];
