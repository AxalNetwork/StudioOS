// Advisor Network — deterministic mock data for the advisor Network workspace
// (Introductions, Relationships, Organizations). This is placeholder data only:
// there is no backend behind it yet, so it is modelled here and structured to be
// swapped for a live API later. Everything is deterministic — the demo "today"
// is fixed at 2026-07-11 and no value depends on Date.now / Math.random / a
// zero-argument new Date(). Dates are plain ISO strings.

export const TODAY = '2026-07-11';

// ---------------------------------------------------------------------------
// Introduction categories — surfaced as filters on the Introductions tab.
// `contacts` and `organizations` are the two entity kinds; the rest are role/
// segment tags an entry can belong to.
// ---------------------------------------------------------------------------
export const INTRODUCTION_CATEGORIES = [
  { id: 'contacts', label: 'Contacts', kind: 'entity' },
  { id: 'organizations', label: 'Organizations', kind: 'entity' },
  { id: 'founders', label: 'Founders', kind: 'segment' },
  { id: 'ceos', label: 'CEOs', kind: 'segment' },
  { id: 'executives', label: 'Executives', kind: 'segment' },
  { id: 'investors', label: 'Investors', kind: 'segment' },
  { id: 'vc', label: 'VC', kind: 'segment' },
  { id: 'private_equity', label: 'Private Equity', kind: 'segment' },
  { id: 'family_offices', label: 'Family Offices', kind: 'segment' },
  { id: 'advisors', label: 'Advisors', kind: 'segment' },
  { id: 'experts', label: 'Experts', kind: 'segment' },
  { id: 'board_members', label: 'Board Members', kind: 'segment' },
  { id: 'customers', label: 'Customers', kind: 'segment' },
  { id: 'partners', label: 'Partners', kind: 'segment' },
  { id: 'service_providers', label: 'Service Providers', kind: 'segment' },
];

// ---------------------------------------------------------------------------
// LEGACY DEMO DATA — Introductions tab only.
// The Network > Organizations tab now loads real VC funds / deep-tech investors
// from the backend `/api/organizations` API (see OrganizationsPage.jsx). This
// array is retained solely because the out-of-scope Introductions tab
// (IntroductionsPage.jsx via organizationById) still uses it as a demo org
// directory. Do not add new consumers — use the API instead.
// ---------------------------------------------------------------------------
export const ORGANIZATIONS = [
  {
    id: 'org-northwind',
    name: 'Northwind Labs',
    industry: 'AI infrastructure',
    stage: 'Seed',
    description: 'Developer platform for running and observing LLM pipelines in production.',
    founded: '2023',
    hq: 'San Francisco, USA',
    website: 'https://northwind.example',
    employeeCount: 34,
    categories: ['organizations', 'customers'],
    tags: ['AI', 'devtools', 'B2B SaaS'],
    leadership: [
      { name: 'Dara Okafor', title: 'Co-founder & CEO', contactId: 'c-dara' },
      { name: 'Sam Reilly', title: 'Co-founder & CTO', contactId: 'c-sam' },
      { name: 'Nina Patel', title: 'VP Product', contactId: 'c-nina' },
    ],
    employees: [
      { name: 'Dara Okafor', role: 'CEO', team: 'Executive' },
      { name: 'Sam Reilly', role: 'CTO', team: 'Engineering' },
      { name: 'Nina Patel', role: 'VP Product', team: 'Product' },
      { name: 'Owen Blackwood', role: 'Head of GTM', team: 'Sales' },
      { name: 'Grace Lim', role: 'Staff Engineer', team: 'Engineering' },
    ],
    funding: [
      { date: '2023-04-15', round: 'Pre-Seed', amount: 1500000, valuation: 9000000, lead: 'Meridian Capital' },
      { date: '2024-09-02', round: 'Seed', amount: 6500000, valuation: 42000000, lead: 'Harbor Fund' },
    ],
    ownership: [
      { holder: 'Founders', pct: 58 },
      { holder: 'Harbor Fund', pct: 15 },
      { holder: 'Meridian Capital', pct: 12 },
      { holder: 'Employee option pool', pct: 12 },
      { holder: 'Angels', pct: 3 },
    ],
    locations: ['San Francisco, USA (HQ)', 'Toronto, Canada', 'Remote — EU'],
    documents: [
      { name: 'Seed round deck', type: 'Pitch deck', date: '2024-08-10' },
      { name: 'Mutual NDA', type: 'NDA', date: '2025-11-20' },
      { name: 'FY25 board memo', type: 'Memo', date: '2026-01-15' },
    ],
  },
  {
    id: 'org-ledgerly',
    name: 'Ledgerly',
    industry: 'Fintech — payments',
    stage: 'Pre-Seed',
    description: 'Reconciliation and payments ledger API for vertical SaaS platforms.',
    founded: '2024',
    hq: 'New York, USA',
    website: 'https://ledgerly.example',
    employeeCount: 11,
    categories: ['organizations', 'customers'],
    tags: ['fintech', 'payments', 'API'],
    leadership: [
      { name: 'Marisol Vega', title: 'Founder & CEO', contactId: 'c-marisol' },
      { name: 'Tobias Frank', title: 'Founding Engineer', contactId: null },
    ],
    employees: [
      { name: 'Marisol Vega', role: 'CEO', team: 'Executive' },
      { name: 'Tobias Frank', role: 'Founding Engineer', team: 'Engineering' },
      { name: 'Amelia Cross', role: 'Head of Ops', team: 'Operations' },
    ],
    funding: [
      { date: '2024-11-30', round: 'Pre-Seed', amount: 900000, valuation: 6000000, lead: 'Meridian Capital' },
    ],
    ownership: [
      { holder: 'Founders', pct: 72 },
      { holder: 'Meridian Capital', pct: 15 },
      { holder: 'Employee option pool', pct: 10 },
      { holder: 'Angels', pct: 3 },
    ],
    locations: ['New York, USA (HQ)'],
    documents: [
      { name: 'Pre-seed SAFE', type: 'Contract', date: '2024-11-30' },
      { name: 'Product one-pager', type: 'Memo', date: '2025-06-01' },
    ],
  },
  {
    id: 'org-ceres',
    name: 'Ceres Bio',
    industry: 'Climate / biotech',
    stage: 'Seed',
    description: 'Engineered microbes that cut synthetic fertiliser use in row crops.',
    founded: '2022',
    hq: 'London, UK',
    website: 'https://ceresbio.example',
    employeeCount: 27,
    categories: ['organizations', 'customers'],
    tags: ['climate', 'deeptech', 'biotech'],
    leadership: [
      { name: 'Dr. Elena Rossi', title: 'Co-founder & CEO', contactId: 'c-elena' },
      { name: 'James Whitaker', title: 'Co-founder & CSO', contactId: null },
    ],
    employees: [
      { name: 'Dr. Elena Rossi', role: 'CEO', team: 'Executive' },
      { name: 'James Whitaker', role: 'CSO', team: 'Science' },
      { name: 'Priya Anand', role: 'Head of Field Trials', team: 'Operations' },
    ],
    funding: [
      { date: '2022-06-20', round: 'Pre-Seed', amount: 2000000, valuation: 12000000, lead: 'Harbor Fund' },
      { date: '2024-03-11', round: 'Seed', amount: 8000000, valuation: 55000000, lead: 'Stonebridge Partners' },
    ],
    ownership: [
      { holder: 'Founders', pct: 51 },
      { holder: 'Stonebridge Partners', pct: 20 },
      { holder: 'Harbor Fund', pct: 14 },
      { holder: 'Employee option pool', pct: 12 },
      { holder: 'Grants (non-dilutive)', pct: 3 },
    ],
    locations: ['London, UK (HQ)', 'Cambridge, UK', 'Iowa, USA — trial site'],
    documents: [
      { name: 'Seed round deck', type: 'Pitch deck', date: '2024-02-01' },
      { name: 'Field trial report 2025', type: 'Research', date: '2025-10-05' },
    ],
  },
  {
    id: 'org-meridian',
    name: 'Meridian Capital',
    industry: 'Venture capital',
    stage: 'Fund',
    description: 'Early-stage fund backing B2B software and fintech from pre-seed to Series A.',
    founded: '2018',
    hq: 'San Francisco, USA',
    website: 'https://meridian.example',
    employeeCount: 18,
    categories: ['organizations', 'investors', 'vc'],
    tags: ['VC', 'B2B SaaS', 'fintech'],
    leadership: [
      { name: 'Marcus Vale', title: 'Managing Partner', contactId: 'c-marcus' },
      { name: 'Priya Nair', title: 'Partner', contactId: 'c-priya' },
    ],
    employees: [
      { name: 'Marcus Vale', role: 'Managing Partner', team: 'Investment' },
      { name: 'Priya Nair', role: 'Partner', team: 'Investment' },
      { name: 'Devon Clarke', role: 'Principal', team: 'Investment' },
    ],
    funding: [
      { date: '2018-05-01', round: 'Fund I', amount: 45000000, valuation: null, lead: 'LP syndicate' },
      { date: '2022-01-15', round: 'Fund II', amount: 120000000, valuation: null, lead: 'LP syndicate' },
    ],
    ownership: [
      { holder: 'General Partners', pct: 100 },
    ],
    locations: ['San Francisco, USA (HQ)', 'New York, USA'],
    documents: [
      { name: 'Fund II LP agreement', type: 'Contract', date: '2022-01-15' },
    ],
  },
  {
    id: 'org-harbor',
    name: 'Harbor Fund',
    industry: 'Micro-VC',
    stage: 'Fund',
    description: 'Solo-GP micro-fund writing first cheques into seed-stage deeptech.',
    founded: '2020',
    hq: 'New York, USA',
    website: 'https://harborfund.example',
    employeeCount: 4,
    categories: ['organizations', 'investors', 'vc'],
    tags: ['micro-VC', 'deeptech', 'seed'],
    leadership: [
      { name: 'Helena Brandt', title: 'General Partner', contactId: 'c-helena' },
    ],
    employees: [
      { name: 'Helena Brandt', role: 'General Partner', team: 'Investment' },
      { name: 'Ray Osei', role: 'Platform', team: 'Platform' },
    ],
    funding: [
      { date: '2020-09-10', round: 'Fund I', amount: 22000000, valuation: null, lead: 'LP syndicate' },
    ],
    ownership: [
      { holder: 'General Partner', pct: 100 },
    ],
    locations: ['New York, USA (HQ)'],
    documents: [],
  },
  {
    id: 'org-stonebridge',
    name: 'Stonebridge Partners',
    industry: 'Private equity',
    stage: 'Fund',
    description: 'Growth-equity firm investing in profitable climate and industrial software.',
    founded: '2011',
    hq: 'Boston, USA',
    website: 'https://stonebridge.example',
    employeeCount: 62,
    categories: ['organizations', 'investors', 'private_equity'],
    tags: ['private equity', 'growth', 'climate'],
    leadership: [
      { name: 'Gregory Hale', title: 'Partner', contactId: 'c-gregory' },
    ],
    employees: [
      { name: 'Gregory Hale', role: 'Partner', team: 'Investment' },
      { name: 'Sophia Lund', role: 'Vice President', team: 'Investment' },
    ],
    funding: [
      { date: '2019-04-01', round: 'Fund III', amount: 650000000, valuation: null, lead: 'Institutional LPs' },
    ],
    ownership: [
      { holder: 'Partners', pct: 100 },
    ],
    locations: ['Boston, USA (HQ)', 'London, UK'],
    documents: [],
  },
  {
    id: 'org-vanewood',
    name: 'Vanewood Family Office',
    industry: 'Family office',
    stage: 'Evergreen',
    description: 'Single-family office allocating to venture, real assets, and direct deals.',
    founded: '2009',
    hq: 'Zurich, CH',
    website: 'https://vanewood.example',
    employeeCount: 9,
    categories: ['organizations', 'investors', 'family_offices'],
    tags: ['family office', 'LP', 'direct'],
    leadership: [
      { name: 'Isabelle Vane', title: 'Principal', contactId: 'c-isabelle' },
    ],
    employees: [
      { name: 'Isabelle Vane', role: 'Principal', team: 'Investment' },
      { name: 'Karl Meier', role: 'CIO', team: 'Investment' },
    ],
    funding: [],
    ownership: [
      { holder: 'Vane family', pct: 100 },
    ],
    locations: ['Zurich, CH (HQ)'],
    documents: [],
  },
  {
    id: 'org-brightpath',
    name: 'BrightPath Advisory',
    industry: 'GTM consulting',
    stage: 'Services',
    description: 'Fractional go-to-market team for seed-to-Series-B B2B startups.',
    founded: '2019',
    hq: 'Remote',
    website: 'https://brightpath.example',
    employeeCount: 14,
    categories: ['organizations', 'partners', 'service_providers'],
    tags: ['GTM', 'consulting', 'services'],
    leadership: [
      { name: 'Lena Fischer', title: 'Founder & Principal', contactId: 'c-lena' },
    ],
    employees: [
      { name: 'Lena Fischer', role: 'Principal', team: 'Executive' },
      { name: 'Marco Bianchi', role: 'GTM Lead', team: 'Delivery' },
    ],
    funding: [],
    ownership: [
      { holder: 'Founder', pct: 100 },
    ],
    locations: ['Remote — global'],
    documents: [
      { name: 'Master services agreement', type: 'Contract', date: '2025-02-14' },
    ],
  },
  {
    id: 'org-lumen',
    name: 'Lumen Analytics',
    industry: 'Data / SaaS',
    stage: 'Series A',
    description: 'Product analytics for regulated industries with on-prem deployment.',
    founded: '2021',
    hq: 'Austin, USA',
    website: 'https://lumen.example',
    employeeCount: 58,
    categories: ['organizations', 'customers'],
    tags: ['analytics', 'SaaS', 'enterprise'],
    leadership: [
      { name: 'Owen Blackwood', title: 'CEO', contactId: 'c-owen' },
      { name: 'Rebecca Tan', title: 'COO', contactId: null },
    ],
    employees: [
      { name: 'Owen Blackwood', role: 'CEO', team: 'Executive' },
      { name: 'Rebecca Tan', role: 'COO', team: 'Operations' },
      { name: 'Victor Ngo', role: 'VP Engineering', team: 'Engineering' },
    ],
    funding: [
      { date: '2021-07-01', round: 'Seed', amount: 4000000, valuation: 22000000, lead: 'Meridian Capital' },
      { date: '2023-05-18', round: 'Series A', amount: 18000000, valuation: 95000000, lead: 'Stonebridge Partners' },
    ],
    ownership: [
      { holder: 'Founders', pct: 44 },
      { holder: 'Stonebridge Partners', pct: 22 },
      { holder: 'Meridian Capital', pct: 16 },
      { holder: 'Employee option pool', pct: 15 },
      { holder: 'Angels', pct: 3 },
    ],
    locations: ['Austin, USA (HQ)', 'Dublin, IE'],
    documents: [
      { name: 'Series A deck', type: 'Pitch deck', date: '2023-04-20' },
      { name: 'Advisory agreement', type: 'Contract', date: '2025-09-01' },
    ],
  },
  {
    id: 'org-atlas-legal',
    name: 'Atlas Legal',
    industry: 'Legal services',
    stage: 'Services',
    description: 'Boutique startup law firm — financings, formations, and commercial contracts.',
    founded: '2015',
    hq: 'San Francisco, USA',
    website: 'https://atlaslegal.example',
    employeeCount: 22,
    categories: ['organizations', 'partners', 'service_providers'],
    tags: ['legal', 'services', 'financings'],
    leadership: [
      { name: 'Daniel Cho', title: 'Partner', contactId: 'c-daniel' },
    ],
    employees: [
      { name: 'Daniel Cho', role: 'Partner', team: 'Legal' },
      { name: 'Fatima Noor', role: 'Associate', team: 'Legal' },
    ],
    funding: [],
    ownership: [
      { holder: 'Partners', pct: 100 },
    ],
    locations: ['San Francisco, USA (HQ)'],
    documents: [
      { name: 'Engagement letter', type: 'Contract', date: '2025-01-10' },
    ],
  },
];

// ---------------------------------------------------------------------------
// Contacts — people in the advisor's network. `categories` maps each person to
// the introduction-category filters; `orgId` links to an Organization when set.
// ---------------------------------------------------------------------------
export const CONTACTS = [
  {
    id: 'c-dara', name: 'Dara Okafor', title: 'Co-founder & CEO', orgId: 'org-northwind', org: 'Northwind Labs',
    location: 'San Francisco, USA', email: 'dara@northwind.example',
    categories: ['contacts', 'founders', 'ceos'], tags: ['AI', 'devtools'],
    headline: 'Building the observability layer for LLM apps.',
    bio: 'Second-time founder; previously led platform engineering at a public SaaS company. Advisor engagement on GTM and Series A prep.',
    strength: 86, mutuals: 12, lastInteraction: '2026-07-02', since: '2024-05-10', warmth: 'warm',
  },
  {
    id: 'c-sam', name: 'Sam Reilly', title: 'Co-founder & CTO', orgId: 'org-northwind', org: 'Northwind Labs',
    location: 'Toronto, Canada', email: 'sam@northwind.example',
    categories: ['contacts', 'founders', 'executives'], tags: ['engineering', 'AI'],
    headline: 'Distributed systems for real-time inference.',
    bio: 'Technical co-founder. Introduced through Dara during the seed round.',
    strength: 61, mutuals: 8, lastInteraction: '2026-06-18', since: '2024-06-01', warmth: 'warm',
  },
  {
    id: 'c-nina', name: 'Nina Patel', title: 'VP Product', orgId: 'org-northwind', org: 'Northwind Labs',
    location: 'San Francisco, USA', email: 'nina@northwind.example',
    categories: ['contacts', 'executives'], tags: ['product'],
    headline: 'Product leader, ex-marketplace.',
    bio: 'Runs product at Northwind. Regular attendee of advisory sessions.',
    strength: 48, mutuals: 5, lastInteraction: '2026-05-28', since: '2025-01-20', warmth: 'warm',
  },
  {
    id: 'c-marisol', name: 'Marisol Vega', title: 'Founder & CEO', orgId: 'org-ledgerly', org: 'Ledgerly',
    location: 'New York, USA', email: 'marisol@ledgerly.example',
    categories: ['contacts', 'founders', 'ceos'], tags: ['fintech', 'payments'],
    headline: 'Payments infrastructure for vertical SaaS.',
    bio: 'First-time founder. Referred by Marcus Vale for pre-seed advisory.',
    strength: 72, mutuals: 6, lastInteraction: '2026-06-30', since: '2025-02-15', warmth: 'warm',
  },
  {
    id: 'c-elena', name: 'Dr. Elena Rossi', title: 'Co-founder & CEO', orgId: 'org-ceres', org: 'Ceres Bio',
    location: 'London, UK', email: 'elena@ceresbio.example',
    categories: ['contacts', 'founders', 'ceos', 'experts'], tags: ['climate', 'biotech'],
    headline: 'Scientist-founder decarbonising agriculture.',
    bio: 'PhD in synthetic biology. Advisory focus on commercial scale-up and board formation.',
    strength: 68, mutuals: 4, lastInteraction: '2026-06-12', since: '2024-11-05', warmth: 'warm',
  },
  {
    id: 'c-owen', name: 'Owen Blackwood', title: 'CEO', orgId: 'org-lumen', org: 'Lumen Analytics',
    location: 'Austin, USA', email: 'owen@lumen.example',
    categories: ['contacts', 'ceos', 'executives'], tags: ['analytics', 'enterprise'],
    headline: 'Scaling analytics into regulated enterprise.',
    bio: 'Long-standing advisory client. Focus on Series B narrative and org design.',
    strength: 79, mutuals: 9, lastInteraction: '2026-07-05', since: '2023-09-01', warmth: 'warm',
  },
  {
    id: 'c-marcus', name: 'Marcus Vale', title: 'Managing Partner', orgId: 'org-meridian', org: 'Meridian Capital',
    location: 'San Francisco, USA', email: 'marcus@meridian.example',
    categories: ['contacts', 'investors', 'vc', 'board_members'], tags: ['VC', 'fintech'],
    headline: 'Early-stage B2B & fintech investor.',
    bio: 'Frequent referral source. Sits on two boards alongside the advisor.',
    strength: 83, mutuals: 21, lastInteraction: '2026-07-08', since: '2022-03-10', warmth: 'warm',
  },
  {
    id: 'c-priya', name: 'Priya Nair', title: 'Partner', orgId: 'org-meridian', org: 'Meridian Capital',
    location: 'San Francisco, USA', email: 'priya@meridian.example',
    categories: ['contacts', 'investors', 'vc'], tags: ['GTM', 'pricing'],
    headline: 'Partner focused on GTM-led seed deals.',
    bio: 'Co-hosts GTM office hours with the advisor.',
    strength: 64, mutuals: 15, lastInteraction: '2026-06-22', since: '2022-08-12', warmth: 'warm',
  },
  {
    id: 'c-helena', name: 'Helena Brandt', title: 'General Partner', orgId: 'org-harbor', org: 'Harbor Fund',
    location: 'New York, USA', email: 'helena@harborfund.example',
    categories: ['contacts', 'investors', 'vc'], tags: ['deeptech', 'seed'],
    headline: 'Solo-GP writing first cheques in deeptech.',
    bio: 'Co-investor relationship. Shares dealflow in climate and AI infra.',
    strength: 57, mutuals: 11, lastInteraction: '2026-05-30', since: '2023-01-25', warmth: 'warm',
  },
  {
    id: 'c-gregory', name: 'Gregory Hale', title: 'Partner', orgId: 'org-stonebridge', org: 'Stonebridge Partners',
    location: 'Boston, USA', email: 'gregory@stonebridge.example',
    categories: ['contacts', 'investors', 'private_equity', 'board_members'], tags: ['growth', 'climate'],
    headline: 'Growth-equity partner in climate & industrial software.',
    bio: 'Later-stage relationship. Potential lead for growth rounds of advisory clients.',
    strength: 42, mutuals: 7, lastInteraction: '2026-04-19', since: '2024-02-01', warmth: 'cool',
  },
  {
    id: 'c-isabelle', name: 'Isabelle Vane', title: 'Principal', orgId: 'org-vanewood', org: 'Vanewood Family Office',
    location: 'Zurich, CH', email: 'isabelle@vanewood.example',
    categories: ['contacts', 'investors', 'family_offices'], tags: ['LP', 'direct'],
    headline: 'Family-office principal doing direct deals.',
    bio: 'Introduced at a co-investor dinner. Interested in climate direct deals.',
    strength: 35, mutuals: 3, lastInteraction: '2026-03-28', since: '2025-05-30', warmth: 'cool',
  },
  {
    id: 'c-lena', name: 'Lena Fischer', title: 'Founder & Principal', orgId: 'org-brightpath', org: 'BrightPath Advisory',
    location: 'Berlin, DE', email: 'lena@brightpath.example',
    categories: ['contacts', 'partners', 'service_providers', 'experts'], tags: ['GTM', 'scaling'],
    headline: 'Fractional GTM for seed-to-B startups.',
    bio: 'Delivery partner on joint engagements. Reliable referral source.',
    strength: 70, mutuals: 10, lastInteraction: '2026-06-25', since: '2023-04-11', warmth: 'warm',
  },
  {
    id: 'c-daniel', name: 'Daniel Cho', title: 'Partner', orgId: 'org-atlas-legal', org: 'Atlas Legal',
    location: 'San Francisco, USA', email: 'daniel@atlaslegal.example',
    categories: ['contacts', 'partners', 'service_providers'], tags: ['legal', 'financings'],
    headline: 'Startup financings & formations.',
    bio: 'Go-to legal referral for advisory clients raising rounds.',
    strength: 55, mutuals: 13, lastInteraction: '2026-06-05', since: '2023-06-18', warmth: 'warm',
  },
  {
    id: 'c-priya-nair-expert', name: 'Dr. Priya Sharma', title: 'Pricing Expert', orgId: null, org: 'Independent',
    location: 'Remote', email: 'priya.sharma@example.com',
    categories: ['contacts', 'advisors', 'experts'], tags: ['pricing', 'GTM'],
    headline: 'Monetisation & pricing specialist.',
    bio: 'Independent expert brought into engagements for pricing deep-dives.',
    strength: 51, mutuals: 6, lastInteraction: '2026-05-14', since: '2024-08-22', warmth: 'warm',
  },
  {
    id: 'c-victor', name: 'Victor Ngo', title: 'Board Member', orgId: 'org-lumen', org: 'Lumen Analytics',
    location: 'Austin, USA', email: 'victor@lumen.example',
    categories: ['contacts', 'board_members', 'executives'], tags: ['engineering'],
    headline: 'Independent board member, ex-CTO.',
    bio: 'Serves on Lumen board alongside the advisor.',
    strength: 46, mutuals: 5, lastInteraction: '2026-04-30', since: '2025-03-15', warmth: 'cool',
  },
  {
    id: 'c-amara', name: 'Amara Diallo', title: 'Head of Partnerships', orgId: null, org: 'Fintech Guild',
    location: 'London, UK', email: 'amara@fintechguild.example',
    categories: ['contacts', 'partners', 'customers'], tags: ['partnerships', 'fintech'],
    headline: 'Runs a fintech operator community.',
    bio: 'Distribution partner for advisory workshops and events.',
    strength: 39, mutuals: 4, lastInteraction: '2026-02-20', since: '2025-07-01', warmth: 'cool',
  },
];

// ---------------------------------------------------------------------------
// Relationship intelligence — powers the Relationships tab.
// ---------------------------------------------------------------------------

// Warm introductions the advisor has proposed or made.
export const WARM_INTROS = [
  { id: 'wi-1', from: 'c-marcus', to: 'c-marisol', status: 'made', date: '2026-06-28',
    note: 'Introduced Marisol to Marcus for the Ledgerly pre-seed lead.' },
  { id: 'wi-2', from: 'c-dara', to: 'c-daniel', status: 'made', date: '2026-06-15',
    note: 'Connected Northwind to Atlas Legal for Series A paperwork.' },
  { id: 'wi-3', from: 'c-helena', to: 'c-elena', status: 'pending', date: '2026-07-06',
    note: 'Proposed intro so Harbor can look at Ceres Bio bridge.' },
  { id: 'wi-4', from: 'c-priya', to: 'c-owen', status: 'pending', date: '2026-07-09',
    note: 'Pricing office-hours intro for Lumen enterprise packaging.' },
  { id: 'wi-5', from: 'c-gregory', to: 'c-owen', status: 'declined', date: '2026-05-02',
    note: 'Growth-round intro declined — too early for Stonebridge.' },
];

// Referral chains — who referred whom into the network.
export const REFERRALS = [
  { id: 'ref-1', referrer: 'c-marcus', referred: 'c-marisol', date: '2025-02-15', context: 'Pre-seed advisory referral' },
  { id: 'ref-2', referrer: 'c-lena', referred: 'c-amara', date: '2025-07-01', context: 'Workshop distribution partner' },
  { id: 'ref-3', referrer: 'c-dara', referred: 'c-sam', date: '2024-06-01', context: 'Co-founder intro' },
  { id: 'ref-4', referrer: 'c-marcus', referred: 'c-priya', date: '2022-08-12', context: 'Same fund' },
];

// Interaction timeline — chronological touchpoints across the network.
export const INTERACTIONS = [
  { id: 'in-1', contactId: 'c-marcus', type: 'meeting', date: '2026-07-08', note: 'Board sync — two shared portfolio companies.' },
  { id: 'in-2', contactId: 'c-owen', type: 'call', date: '2026-07-05', note: 'Series B narrative review.' },
  { id: 'in-3', contactId: 'c-dara', type: 'meeting', date: '2026-07-02', note: 'Advisory session — GTM hiring plan.' },
  { id: 'in-4', contactId: 'c-marisol', type: 'email', date: '2026-06-30', note: 'Sent reconciliation intro deck feedback.' },
  { id: 'in-5', contactId: 'c-lena', type: 'call', date: '2026-06-25', note: 'Joint engagement staffing.' },
  { id: 'in-6', contactId: 'c-priya', type: 'event', date: '2026-06-22', note: 'Co-hosted GTM office hours.' },
  { id: 'in-7', contactId: 'c-sam', type: 'call', date: '2026-06-18', note: 'Infra scaling Q&A.' },
  { id: 'in-8', contactId: 'c-elena', type: 'meeting', date: '2026-06-12', note: 'Board formation planning.' },
  { id: 'in-9', contactId: 'c-daniel', type: 'email', date: '2026-06-05', note: 'Referral for Northwind financing docs.' },
  { id: 'in-10', contactId: 'c-nina', type: 'call', date: '2026-05-28', note: 'Product roadmap review.' },
];

// Scheduled + past meetings (contact/meeting history).
export const MEETINGS = [
  { id: 'mt-1', contactId: 'c-owen', title: 'Lumen — Series B prep', date: '2026-07-15', status: 'upcoming', channel: 'Video' },
  { id: 'mt-2', contactId: 'c-dara', title: 'Northwind — GTM review', date: '2026-07-14', status: 'upcoming', channel: 'In person' },
  { id: 'mt-3', contactId: 'c-marisol', title: 'Ledgerly — hiring plan', date: '2026-07-13', status: 'upcoming', channel: 'Video' },
  { id: 'mt-4', contactId: 'c-marcus', title: 'Meridian — board sync', date: '2026-07-08', status: 'completed', channel: 'Video' },
  { id: 'mt-5', contactId: 'c-elena', title: 'Ceres — board formation', date: '2026-06-12', status: 'completed', channel: 'In person' },
];

// ---------------------------------------------------------------------------
// Helpers — all date math is anchored to TODAY and uses new Date(arg) only.
// ---------------------------------------------------------------------------
export function daysAgo(iso, today = TODAY) {
  if (!iso) return null;
  const ms = new Date(today).getTime() - new Date(iso).getTime();
  return Math.round(ms / 86_400_000);
}

export function formatRelativeDay(iso, today = TODAY) {
  const d = daysAgo(iso, today);
  if (d === null) return '';
  if (d === 0) return 'Today';
  if (d < 0) return `in ${Math.abs(d)}d`;
  if (d === 1) return 'Yesterday';
  if (d < 30) return `${d}d ago`;
  if (d < 365) return `${Math.round(d / 30)}mo ago`;
  return `${Math.round(d / 365)}y ago`;
}

export function money(n) {
  if (n == null) return '—';
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${n}`;
}

export function contactById(id) {
  return CONTACTS.find((c) => c.id === id) || null;
}

export function organizationById(id) {
  return ORGANIZATIONS.find((o) => o.id === id) || null;
}

export const CATEGORY_LABEL = Object.fromEntries(
  INTRODUCTION_CATEGORIES.map((c) => [c.id, c.label]),
);
