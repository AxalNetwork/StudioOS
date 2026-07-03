// Network layer — shared config + curated data for the public Network surface
// (Articles · Directory · Programs & Events · Communities & Circles).
//
// This is the single source of truth for the circle/program taxonomy so the
// pages stay in sync and new circles/programs are a one-line data edit rather
// than a JSX change. Anything that is not yet backed by a live API is modelled
// here and surfaced with an explicit "coming soon" / "preview" affordance in
// the UI — we never fabricate verified member accounts.
//
// When a Communities backend lands, swap the CIRCLES / PROGRAMS arrays for an
// API fetch; the card components read the same field names.

// ---------------------------------------------------------------------------
// Circle taxonomy
// ---------------------------------------------------------------------------

// The six circle families. `accent` maps to Tailwind colour families already in
// the design system; `icon` is a lucide-react icon name resolved on the page.
export const CIRCLE_TYPES = [
  { id: 'founder', label: 'Founder circles', short: 'Founders', icon: 'Rocket', accent: 'violet',
    blurb: 'Peer groups for operators building and scaling ventures.' },
  { id: 'investor', label: 'Investor circles', short: 'Investors', icon: 'TrendingUp', accent: 'emerald',
    blurb: 'Angels, LPs, and funds sharing dealflow and diligence.' },
  { id: 'partner', label: 'Service partner circles', short: 'Partners', icon: 'Handshake', accent: 'sky',
    blurb: 'Vetted operators — legal, finance, GTM, design, engineering.' },
  { id: 'advisor', label: 'Advisor circles', short: 'Advisors', icon: 'GraduationCap', accent: 'amber',
    blurb: 'Mentors and domain experts offering office hours and guidance.' },
  { id: 'city', label: 'City / region circles', short: 'City & region', icon: 'MapPin', accent: 'rose',
    blurb: 'Local hubs for in-person meetups and regional dealflow.' },
  { id: 'topic', label: 'Topic circles', short: 'Topics', icon: 'Sparkles', accent: 'indigo',
    blurb: 'Deep-dive communities around a sector or technology.' },
];

export const CIRCLE_TYPE_LABEL = Object.fromEntries(
  CIRCLE_TYPES.map((t) => [t.id, t.label]),
);
export const CIRCLE_TYPE_ACCENT = Object.fromEntries(
  CIRCLE_TYPES.map((t) => [t.id, t.accent]),
);

// Access model — public pages anyone can preview vs invite-only circles.
export const ACCESS_TYPES = [
  { id: 'public', label: 'Public', desc: 'Anyone can view and join.' },
  { id: 'private', label: 'Invite-only', desc: 'Request access or get invited by a member.' },
];

// Activity signal shown on each card.
export const ACTIVITY_LEVELS = {
  active: { label: 'Active', dot: 'bg-emerald-500' },
  growing: { label: 'Growing', dot: 'bg-sky-500' },
  quiet: { label: 'Quiet', dot: 'bg-slate-400' },
  new: { label: 'New', dot: 'bg-violet-500' },
};

// ---------------------------------------------------------------------------
// Curated circles
// ---------------------------------------------------------------------------
// Fields: id, name, type, access, tagline, region, theme, members, activity,
// upcomingEvents, discussions, tags, hostedBy, featured.
export const CIRCLES = [
  {
    id: 'seed-founders',
    name: 'Seed-Stage Founders',
    type: 'founder',
    access: 'private',
    tagline: 'A tight peer group for pre-seed to seed founders shipping weekly and comparing notes on fundraising.',
    region: 'Global',
    theme: 'Fundraising & product',
    members: 214,
    activity: 'active',
    upcomingEvents: 3,
    discussions: 48,
    tags: ['pre-seed', 'seed', 'product', 'fundraising'],
    hostedBy: 'Axal VC Studio',
    featured: true,
  },
  {
    id: 'ai-builders',
    name: 'AI Builders',
    type: 'topic',
    access: 'public',
    tagline: 'Founders and engineers building with LLMs, agents, and applied ML. Weekly demos and model breakdowns.',
    region: 'Global',
    theme: 'Artificial intelligence',
    members: 512,
    activity: 'active',
    upcomingEvents: 4,
    discussions: 121,
    tags: ['AI', 'ML', 'agents', 'infra'],
    hostedBy: 'Axal VC Studio',
    featured: true,
  },
  {
    id: 'angels-lps',
    name: 'Angels & LPs',
    type: 'investor',
    access: 'private',
    tagline: 'Active angels and limited partners sharing curated dealflow, syndicates, and diligence memos.',
    region: 'Global',
    theme: 'Dealflow & diligence',
    members: 96,
    activity: 'growing',
    upcomingEvents: 2,
    discussions: 33,
    tags: ['angels', 'LP', 'syndicates', 'dealflow'],
    hostedBy: 'Axal VC Capital',
    featured: true,
  },
  {
    id: 'fintech',
    name: 'Fintech Founders',
    type: 'topic',
    access: 'public',
    tagline: 'Payments, lending, and embedded finance operators navigating regulation and go-to-market.',
    region: 'Global',
    theme: 'Fintech',
    members: 187,
    activity: 'active',
    upcomingEvents: 2,
    discussions: 57,
    tags: ['fintech', 'payments', 'regulation'],
    hostedBy: 'Community-hosted',
    featured: false,
  },
  {
    id: 'web3',
    name: 'Web3 & Crypto',
    type: 'topic',
    access: 'public',
    tagline: 'Protocol, infra, and consumer crypto builders. Onchain demos, token design, and regulatory watch.',
    region: 'Global',
    theme: 'Web3',
    members: 143,
    activity: 'growing',
    upcomingEvents: 1,
    discussions: 41,
    tags: ['web3', 'crypto', 'onchain', 'tokens'],
    hostedBy: 'Community-hosted',
    featured: false,
  },
  {
    id: 'nyc',
    name: 'New York City',
    type: 'city',
    access: 'public',
    tagline: 'The NYC hub — in-person meetups, founder dinners, and local investor intros across the five boroughs.',
    region: 'New York, USA',
    theme: 'City hub',
    members: 268,
    activity: 'active',
    upcomingEvents: 5,
    discussions: 62,
    tags: ['NYC', 'in-person', 'meetups'],
    hostedBy: 'Community-hosted',
    featured: false,
  },
  {
    id: 'london',
    name: 'London',
    type: 'city',
    access: 'public',
    tagline: 'UK & Europe founders and angels. Monthly socials, demo nights, and cross-border fundraising support.',
    region: 'London, UK',
    theme: 'City hub',
    members: 201,
    activity: 'growing',
    upcomingEvents: 3,
    discussions: 39,
    tags: ['London', 'Europe', 'in-person'],
    hostedBy: 'Community-hosted',
    featured: false,
  },
  {
    id: 'fractional-operators',
    name: 'Fractional Operators',
    type: 'partner',
    access: 'private',
    tagline: 'Fractional CFOs, CMOs, and heads of GTM taking on portfolio engagements. Vetted, KYB-checked partners.',
    region: 'Global',
    theme: 'Fractional & services',
    members: 74,
    activity: 'growing',
    upcomingEvents: 1,
    discussions: 22,
    tags: ['fractional', 'CFO', 'GTM', 'services'],
    hostedBy: 'Axal VC Partners',
    featured: false,
  },
  {
    id: 'advisor-guild',
    name: 'Advisor Guild',
    type: 'advisor',
    access: 'private',
    tagline: 'Mentors and domain experts running office hours for the studio. Advisory grants via the FAST template.',
    region: 'Global',
    theme: 'Mentorship',
    members: 58,
    activity: 'quiet',
    upcomingEvents: 2,
    discussions: 18,
    tags: ['mentors', 'office-hours', 'advisory'],
    hostedBy: 'Axal VC Studio',
    featured: false,
  },
  {
    id: 'climate',
    name: 'Climate & Deep Tech',
    type: 'topic',
    access: 'public',
    tagline: 'Hardware, energy, and climate founders tackling long-horizon, capital-intensive ventures.',
    region: 'Global',
    theme: 'Climate & deep tech',
    members: 91,
    activity: 'new',
    upcomingEvents: 1,
    discussions: 12,
    tags: ['climate', 'deeptech', 'hardware', 'energy'],
    hostedBy: 'Community-hosted',
    featured: false,
  },
  {
    id: 'sf-bay',
    name: 'SF Bay Area',
    type: 'city',
    access: 'public',
    tagline: 'The Bay Area hub — hacker houses, demo days, and warm intros across the densest startup market.',
    region: 'San Francisco, USA',
    theme: 'City hub',
    members: 331,
    activity: 'active',
    upcomingEvents: 6,
    discussions: 88,
    tags: ['SF', 'Bay Area', 'in-person'],
    hostedBy: 'Community-hosted',
    featured: false,
  },
  {
    id: 'second-time-founders',
    name: 'Second-Time Founders',
    type: 'founder',
    access: 'private',
    tagline: 'Repeat founders comparing scaling playbooks, exits, and the hard parts nobody warns you about.',
    region: 'Global',
    theme: 'Scaling & operations',
    members: 63,
    activity: 'quiet',
    upcomingEvents: 1,
    discussions: 27,
    tags: ['scaling', 'repeat-founder', 'operations'],
    hostedBy: 'Axal VC Studio',
    featured: false,
  },
];

// ---------------------------------------------------------------------------
// Programs — recurring, cohort-style series that sit alongside one-off Events.
// ---------------------------------------------------------------------------
export const PROGRAM_CATEGORIES = [
  { id: 'office_hours', label: 'Office hours' },
  { id: 'roundtable', label: 'Roundtables' },
  { id: 'workshop', label: 'Workshops' },
  { id: 'demo_day', label: 'Demo days' },
  { id: 'community', label: 'Community sessions' },
];

export const AUDIENCES = [
  { id: 'founders', label: 'Founders' },
  { id: 'investors', label: 'Investors' },
  { id: 'partners', label: 'Partners' },
  { id: 'advisors', label: 'Advisors' },
];

export const FORMATS = [
  { id: 'online', label: 'Online' },
  { id: 'in_person', label: 'In-person' },
  { id: 'hybrid', label: 'Hybrid' },
];

// Fields: id, name, category, cadence, format, audience[], description,
// nextSession, status ('open' | 'coming_soon').
export const PROGRAMS = [
  {
    id: 'founder-office-hours',
    name: 'Founder Office Hours',
    category: 'office_hours',
    cadence: 'Weekly',
    format: 'online',
    audience: ['founders'],
    description: '30-minute slots with Axal VC partners and mentors on fundraising, product, and GTM.',
    nextSession: 'Every Tuesday · 10:00 PT',
    status: 'open',
  },
  {
    id: 'investor-roundtable',
    name: 'Investor Roundtable',
    category: 'roundtable',
    cadence: 'Monthly',
    format: 'hybrid',
    audience: ['investors', 'partners'],
    description: 'Curated dealflow review and diligence discussion for angels, LPs, and syndicate leads.',
    nextSession: 'First Thursday of the month',
    status: 'open',
  },
  {
    id: 'spinout-demo-day',
    name: 'Spin-Out Demo Day',
    category: 'demo_day',
    cadence: 'Quarterly',
    format: 'hybrid',
    audience: ['founders', 'investors'],
    description: 'Graduating Spin-Out Lab cohorts pitch to the investor network. Warm intros follow.',
    nextSession: 'Next cohort — dates TBA',
    status: 'coming_soon',
  },
  {
    id: 'gtm-workshop',
    name: 'GTM Workshop Series',
    category: 'workshop',
    cadence: 'Bi-weekly',
    format: 'online',
    audience: ['founders'],
    description: 'Hands-on workshops on positioning, pricing, and pipeline led by the partner network.',
    nextSession: 'Rolling — join the waitlist',
    status: 'coming_soon',
  },
  {
    id: 'partner-clinics',
    name: 'Partner Clinics',
    category: 'office_hours',
    cadence: 'Weekly',
    format: 'online',
    audience: ['founders', 'partners'],
    description: 'Free 1:1 clinics with vetted service partners — legal, finance, design, recruiting.',
    nextSession: 'Book via the Directory',
    status: 'open',
  },
  {
    id: 'community-sessions',
    name: 'Community-Hosted Sessions',
    category: 'community',
    cadence: 'Ongoing',
    format: 'in_person',
    audience: ['founders', 'investors', 'partners', 'advisors'],
    description: 'Meetups and dinners hosted by city and topic circles. Anyone in the network can host.',
    nextSession: 'See Communities & Circles',
    status: 'open',
  },
];

// ---------------------------------------------------------------------------
// Directory categories — the tabbed structure for the public Directory.
// `live` marks the tab wired to the production API; the rest are curated
// preview/"coming soon" surfaces until their public endpoints ship.
// ---------------------------------------------------------------------------
export const DIRECTORY_CATEGORIES = [
  { id: 'partners', label: 'Service Partners', icon: 'Handshake', live: true,
    blurb: 'Vetted operators — legal, finance, design, recruiting, GTM and more.' },
  { id: 'startups', label: 'Startups', icon: 'Rocket', live: false,
    blurb: 'Ventures building in and around the Axal VC studio.' },
  { id: 'investors', label: 'Investors & LPs', icon: 'TrendingUp', live: false,
    blurb: 'Angels, funds, and limited partners active in the network.' },
  { id: 'advisors', label: 'Advisors', icon: 'GraduationCap', live: false,
    blurb: 'Mentors and domain experts offering office hours and guidance.' },
];

// Small curated preview sets for the not-yet-live Directory tabs. Clearly
// labelled as previews in the UI — never presented as verified live accounts.
export const DIRECTORY_PREVIEWS = {
  startups: [
    { name: 'Northwind Labs', category: 'AI infrastructure', geography: 'San Francisco, USA', stage: 'Seed', tags: ['AI', 'devtools'] },
    { name: 'Ledgerly', category: 'Fintech', geography: 'New York, USA', stage: 'Pre-seed', tags: ['payments', 'B2B'] },
    { name: 'Ceres Bio', category: 'Climate / bio', geography: 'London, UK', stage: 'Seed', tags: ['climate', 'deeptech'] },
  ],
  investors: [
    { name: 'Meridian Angels', category: 'Angel syndicate', geography: 'Global', stage: 'Pre-seed → Seed', tags: ['syndicate', 'B2B SaaS'] },
    { name: 'Harbor Fund I', category: 'Micro-VC', geography: 'New York, USA', stage: 'Seed', tags: ['fintech', 'AI'] },
    { name: 'Atlas LP Collective', category: 'Limited partners', geography: 'Global', stage: 'Fund LP', tags: ['LP', 'co-invest'] },
  ],
  advisors: [
    { name: 'Dr. Priya Nair', category: 'GTM & pricing', geography: 'Remote', stage: 'Advisor', tags: ['GTM', 'pricing'] },
    { name: 'Marcus Vale', category: 'Fundraising', geography: 'San Francisco, USA', stage: 'Advisor', tags: ['fundraising', 'pitch'] },
    { name: 'Lena Fischer', category: 'Engineering leadership', geography: 'Berlin, DE', stage: 'Advisor', tags: ['engineering', 'scaling'] },
  ],
};
