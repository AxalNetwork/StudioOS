/**
 * D768 (#2092, D720 §11) — EVERY PAGE KNOWS ITS PLACE.
 *
 * The rail's page key is `<Profile> · <Section>` or `<Profile> · <Section> ·
 * <Module>`, in the names of the AIRail · every page canvas
 * (`design/incoming/airail-every-page-data/canvas.json`, `profiles`). The
 * matrix (D764) picks a page's models by this key, and the run path (D765)
 * records and switches by it, so the map is the one place a route learns it.
 *
 * THREE TABLES.
 *   - `RAIL_PAGES`: per profile, the routes that own a key. A route matches
 *     itself and every path below it; `?tab=` and `#anchor` in a route are
 *     part of the match, so two boards on one route keep their own keys when
 *     the tab or the anchor tells them apart.
 *   - Route aliases, in `RAIL_PAGES` too: a second route that answers a key
 *     another route already owns (a legacy zone, a record page with its own
 *     path) says why in `alias`.
 *   - `RAIL_BOARD_ALIASES`: a canvas board with no route of its own, and the
 *     page that answers it (D720 §11's table, and boards two sections share,
 *     which the board the canvas lists first owns).
 *
 * Off-canvas pages that draw a rail (Messages, Help, Learning…) keep a key of
 * their own under the member's profile, flagged `offCanvas`: D764's matrix
 * names their rows, and the canvas parity test does not count them.
 *
 * HOMES. Every profile's home is `<Profile> · Home`, the Founder's is
 * `Founder · Studio`. `/studio` for an admin has no rail (D598), so it has no
 * key. `pageKeyFor` is pure: the pathname, the shell role (`shellRoleFor`,
 * `lib/shellRole.js`) and the query and hash, nothing else.
 */

export const PROFILES = ['Founder', 'Investor', 'Advisor', 'Operating Partner', 'Admin', 'Super Admin'];

/** The canvas profile for a shell role (`shellRoleFor`), or a profile name as it is. */
export const PROFILE_OF_ROLE = {
  founder: 'Founder',
  investor: 'Investor',
  advisor: 'Advisor',
  partner: 'Operating Partner',
  admin: 'Admin',
  branch_admin: 'Admin',
  super_admin: 'Super Admin',
};

const key = (...parts) => parts.join(' · ');
/** A route that owns `k`. */
const own = (route, k) => ({ route, key: k });
/** A second route that answers `k`, which another route owns; `why` says so. */
const alias = (route, k, why) => ({ route, key: k, alias: why });
/** A rail page the canvas does not draw: its own key, outside the canvas parity count. */
const off = (route, k) => ({ route, key: k, offCanvas: true });
/** A route that answers itself only, never the paths below it. */
const exact = (entry) => ({ ...entry, exact: true });

/** The canvas section names for a profile's research and network buckets, by route. */
const NETWORK = (P) => [
  own('/network', key(P, 'Network')),
  own('/network/relationships', key(P, 'Network', 'Relationships')),
  own('/network/introductions', key(P, 'Network', 'Introductions')),
  own('/network/organizations', key(P, 'Network', 'Organizations')),
  // D771 (#2097): the workspace (`/network?mode=workspace`) picks its tab from `?tab=`, and its
  // Relationships and Introductions tabs carry those boards' bands, so each tab is its board's.
  alias('/network?tab=relationships', key(P, 'Network', 'Relationships'), 'The workspace’s Relationships tab is that board’s working tool.'),
  alias('/network?tab=introductions', key(P, 'Network', 'Introductions'), 'The workspace’s Introductions tab is that board’s working tool.'),
];

/**
 * Pages every member profile reaches, off the canvas. Each takes the
 * profile's own key, so a founder's Messages and an advisor's are two rows.
 */
const SHARED = (P) => [
  off('/messages', key(P, 'Messages')),
  off('/help', key(P, 'Help')),
  // D786 (#2211): /pricing, with the catalogue at /pricing/products under it.
  off('/pricing', key(P, 'Plans and pricing')),
  off('/account', key(P, 'Account')),
  off('/trust', key(P, 'Trust')),
  off('/calendar', key(P, 'Calendar')),
  off('/my/events', key(P, 'Events')),
  off('/learning', key(P, 'Learning')),
  off('/referrals', key(P, 'Referrals')),
  off('/company-settings', key(P, 'Company settings')),
  off('/updates', key(P, 'Updates')),
  off('/legal/send', key(P, 'Send for signature')),
  off('/studio/archetype', key(P, 'Archetype')),
  off('/wellbeing', key(P, 'Wellbeing')),
  off('/perks', key(P, 'Perks')),
  off('/projects', key(P, 'Projects')),
];

const F = 'Founder';
const CYCLE = (section, base, modules) => [
  own(base, key(F, section)),
  ...modules.map(([slug, name]) => own(`${base}/${slug}`, key(F, section, name))),
];

const FOUNDER = [
  own('/studio', key(F, 'Studio')),
  alias('/studio/tickets/new', key(F, 'Studio'), 'Studio’s own new-ticket form, on the Studio page.'),
  ...CYCLE('Validate', '/validate', [
    ['problem-discovery', 'Problem discovery'], ['customer-research', 'Customer research'],
    ['ideal-customer-profile', 'Ideal customer profile'], ['market-intelligence', 'Market intelligence'],
    ['demand-signals', 'Demand and urgency signals'], ['experiments', 'Experiments and evidence'], ['verdict', 'Verdict'],
  ]),
  alias('/validate/record', key(F, 'Validate', 'Customer research'), 'Record a session opens on Customer research, where the interview lands.'),
  alias('/validate/session', key(F, 'Validate', 'Customer research'), 'An interview session is a Customer research record (D660).'),
  alias('/validate/inbox', key(F, 'Validate', 'Customer research'), 'Inbox chats become interview notes in Customer research (D757 §2.12).'),
  alias('/build/competitors', key(F, 'Validate', 'Market intelligence'), 'Competitor analysis is Market intelligence’s own tool.'),
  ...CYCLE('Build', '/build', [
    ['solution-design', 'Solution design'], ['prototype-mvp', 'Prototype / MVP'], ['product-roadmap', 'Product roadmap'],
    ['founding-team', 'Founding team'], ['company-creation', 'Company creation'], ['operating-systems', 'Operating systems'],
  ]),
  alias('/build/connect', key(F, 'Build', 'Operating systems'), 'Connect a tool is Operating systems’ action.'),
  alias('/build/roadmap', key(F, 'Build', 'Product roadmap'), 'The legacy Roadmap zone of the same module.'),
  alias('/build/team', key(F, 'Build', 'Founding team'), 'The legacy Talent zone, the founding team’s page.'),
  alias('/build/this-week', key(F, 'Build', 'Operating systems'), 'The legacy This week zone: the company’s operating cadence.'),
  alias('/build/board', key(F, 'Build', 'Operating systems'), 'The legacy Board zone: the company’s operating board.'),
  alias('/build/cadence', key(F, 'Build', 'Operating systems'), 'The legacy Cadence zone.'),
  alias('/build/kpi', key(F, 'Build', 'Operating systems'), 'The legacy KPI entry zone.'),
  alias('/build/marketplace', key(F, 'Build', 'Operating systems'), 'The service marketplace a founder runs the company with.'),
  alias('/build/brand', key(F, 'Grow', 'Distribution'), 'Brand is distribution’s material; Build has no brand module.'),
  ...CYCLE('Raise', '/raise', [
    ['fundraising-readiness', 'Fundraising readiness'], ['investor-narrative', 'Investor narrative'], ['pitch-deck', 'Pitch deck'],
    ['data-room', 'Data room'], ['cap-table', 'Cap table'], ['use-of-funds', 'Use of funds'], ['capital-relationships', 'Capital relationships'],
  ]),
  alias('/raise/status', key(F, 'Raise', 'Fundraising readiness'), 'The legacy Status zone: where the raise stands.'),
  alias('/raise/pitch', key(F, 'Raise', 'Pitch deck'), 'The Pitch deck studio, its tabs and the deck builder (D894).'),
  alias('/raise/capital', key(F, 'Raise', 'Capital relationships'), 'The legacy Capital zone: investors and rounds.'),
  alias('/raise/capital-match', key(F, 'Raise', 'Capital relationships'), 'Investor match finds capital relationships.'),
  alias('/raise/calls', key(F, 'Raise', 'Capital relationships'), 'A call with an investor is a capital relationship’s record.'),
  alias('/raise/call', key(F, 'Raise', 'Capital relationships'), 'Log a call opens on Capital relationships.'),
  alias('/raise/legal', key(F, 'Build', 'Company creation'), 'The legal zone holds the company’s formation documents.'),
  alias('/raise/legal-engine', key(F, 'Build', 'Company creation'), 'The legal engine: incorporation, founders, compliance and equity.'),
  ...CYCLE('Grow', '/grow', [
    ['product-improvement', 'Product improvement'], ['distribution', 'Distribution'], ['revenue-and-traction', 'Revenue and traction'],
    ['team-expansion', 'Team expansion'], ['partner-network', 'Partner network'], ['market-expansion', 'Market expansion'],
    ['durable-company-building', 'Durable company-building'],
  ]),
  alias('/grow/update', key(F, 'Grow'), 'Write an update opens on Grow’s overview.'),
  alias('/grow/focus', key(F, 'Grow'), 'The legacy Focus zone: Grow’s overview.'),
  alias('/grow/talent', key(F, 'Grow', 'Team expansion'), 'The legacy Talent zone.'),
  alias('/grow/customers', key(F, 'Grow', 'Revenue and traction'), 'The legacy Customers zone.'),
  alias('/grow/partnerships', key(F, 'Grow', 'Partner network'), 'The legacy Partnerships zone.'),
  alias('/grow/launch', key(F, 'Grow', 'Distribution'), 'The legacy Launch zone.'),
  ...NETWORK(F),
  own('/research', key(F, 'Research')),
  own('/research/ask', key(F, 'Research', 'Ask')),
  own('/research/markets', key(F, 'Research', 'Markets')),
  own('/research/geographies', key(F, 'Research', 'Geographies')),
  own('/research/companies', key(F, 'Research', 'Companies')),
  own('/research/funds', key(F, 'Research', 'Funds')),
  own('/research/library', key(F, 'Research', 'Library')),
  off('/spinout-lab', key(F, 'Spin-Out Lab')),
  off('/profile', key(F, 'Profile')),
  off('/deals', key(F, 'Deal room')),
  off('/portfolio', key(F, 'Portfolio')),
  off('/pipeline', key(F, 'Pipeline board')),
  ...SHARED(F),
];

const I = 'Investor';
const INVESTOR = [
  own('/studio', key(I, 'Home')),
  own('/deals', key(I, 'Deals')),
  own('/deals/pipeline', key(I, 'Deals', 'Pipeline')),
  own('/deals/screening', key(I, 'Deals', 'Screening')),
  own('/deals/commit', key(I, 'Deals', 'Commit')),
  own('/deals/closing', key(I, 'Deals', 'Closing')),
  alias('/pipeline', key(I, 'Deals', 'Pipeline'), 'The investor’s legacy pipeline board, which Deals · Pipeline superseded (shellConfig).'),
  own('/portfolio', key(I, 'Portfolio')),
  alias('/portfolio/health', key(I, 'Portfolio'), 'The overview’s legacy alias (shellConfig).'),
  own('/portfolio/positions', key(I, 'Portfolio', 'Positions')),
  own('/portfolio/performance', key(I, 'Portfolio', 'Performance')),
  own('/portfolio/updates', key(I, 'Portfolio', 'Updates')),
  own('/portfolio/value-add', key(I, 'Portfolio', 'Value-add')),
  own('/spinout-lab/investor-workspace', key(I, 'Axal VC Fund')),
  own('/funds', key(I, 'Fund')),
  own('/funds/lps', key(I, 'Fund', 'LPs')),
  own('/funds/calls', key(I, 'Fund', 'Capital calls')),
  own('/funds/ledger', key(I, 'Fund', 'Distributions')),
  own('/funds/reporting', key(I, 'Fund', 'Reporting')),
  alias('/funds/performance', key(I, 'Fund'), 'Fund Ops’ performance tab, on the fund.'),
  off('/raise/data-room', key(I, 'Data room')),
  off('/build/competitors', key(I, 'Competitor analysis')),
  ...NETWORK(I),
  own('/research', key(I, 'Research')),
  own('/research/ask', key(I, 'Research', 'Ask')),
  own('/research/diligence', key(I, 'Research', 'Diligence')),
  own('/research/benchmarking', key(I, 'Research', 'Benchmarking')),
  own('/research/markets', key(I, 'Research', 'Markets')),
  alias('/research/geographies', key(I, 'Research', 'Markets'), 'The investor’s research has no Geographies module; a geography is a market.'),
  own('/research/library', key(I, 'Research', 'Library')),
  ...SHARED(I),
];

const A = 'Advisor';
const BUCKET = (P, section, base, modules) => [
  own(base, key(P, section)),
  ...modules.map(([slug, name]) => own(`${base}/${slug}`, key(P, section, name))),
];
const ADVISOR = [
  own('/studio', key(A, 'Home')),
  ...BUCKET(A, 'Practice', '/practice', [['opportunities', 'Opportunities'], ['engagements', 'Engagements'], ['delivery', 'Delivery'], ['sessions', 'Sessions'], ['earnings', 'Earnings']]),
  alias('/advisor/advisory', key(A, 'Practice'), 'The legacy advisory workspace, which Practice superseded (shellConfig).'),
  ...BUCKET(A, 'Cohorts', '/cohorts', [['founders', 'Founders'], ['guidance', 'Guidance'], ['this-week', 'This week'], ['calendar', 'Calendar'], ['outcomes', 'Outcomes']]),
  ...BUCKET(A, 'Expertise', '/expertise', [['profile', 'Profile'], ['services', 'Services'], ['proof', 'Proof'], ['thinking', 'Thinking'], ['visibility', 'Visibility']]),
  ...NETWORK(A),
  own('/research', key(A, 'Research')),
  own('/research/ask', key(A, 'Research', 'Ask')),
  own('/research/client-prep', key(A, 'Research', 'Client prep')),
  own('/research/markets', key(A, 'Research', 'Markets')),
  alias('/research/geographies', key(A, 'Research', 'Markets'), 'The advisor’s research has no Geographies module; a geography is a market.'),
  own('/research/companies', key(A, 'Research', 'Companies')),
  own('/research/library', key(A, 'Research', 'Library')),
  ...SHARED(A),
];

const O = 'Operating Partner';
const PARTNER = [
  own('/studio', key(O, 'Home')),
  ...BUCKET(O, 'Pipeline', '/pipeline', [['leads', 'Leads'], ['proposals', 'Proposals'], ['negotiations', 'Negotiations'], ['retainers', 'Retainers'], ['analytics', 'Analytics']]),
  alias('/partner/insights', key(O, 'Pipeline', 'Analytics'), 'Analytics’ legacy route (shellConfig).'),
  own('/delivery', key(O, 'Delivery')),
  own('/delivery/board', key(O, 'Delivery', 'Engagements')),
  own('/delivery/deliverables', key(O, 'Delivery', 'Deliverables')),
  own('/delivery/capacity', key(O, 'Delivery', 'Capacity')),
  own('/delivery/status-reports', key(O, 'Delivery', 'Reporting')),
  own('/delivery/health', key(O, 'Delivery', 'Health')),
  alias('/portfolio', key(O, 'Delivery'), 'Portfolio’s guard admits a partner; Delivery is the row it reads under (its coverage page was removed, #2337).'),
  ...BUCKET(O, 'Offers', '/offers', [['catalog', 'Catalog'], ['perk-deals', 'Perk deals'], ['visibility', 'Visibility'], ['proof', 'Proof'], ['audience-fit', 'Audience fit']]),
  // D815 (#2261): not on the AI-rail canvas, which predates product testing.
  off('/offers/testing', key(O, 'Offers', 'Product testing')),
  alias('/perks', key(O, 'Offers', 'Perk deals'), 'Perk deals’ legacy route (shellConfig).'),
  alias('/partner/office-hours', key(O, 'Offers'), 'The Offers row lists office hours under “Also in”.'),
  alias('/comarketing', key(O, 'Offers'), 'The Offers row lists co-marketing under “Also in”.'),
  ...NETWORK(O),
  own('/research', key(O, 'Research')),
  own('/research/ask', key(O, 'Research', 'Ask')),
  own('/research/client-prep', key(O, 'Research', 'Client prep')),
  own('/research/markets', key(O, 'Research', 'Market')),
  alias('/research/geographies', key(O, 'Research', 'Market'), 'The partner’s research has no Geographies module; a geography is a market.'),
  own('/research/library', key(O, 'Research', 'Library')),
  off('/partner/earnings', key(O, 'Earnings')),
  off('/partner/referrals', key(O, 'Partner referrals')),
  off('/partner/relationships', key(O, 'Relationship log')),
  off('/build/competitors', key(O, 'Competitor analysis')),
  off('/raise/legal-engine', key(O, 'Legal engine')),
  off('/deals', key(O, 'Deal room')),
  ...SHARED(O).filter((p) => p.route !== '/perks'),
];

// The plain Admin shell: HQ's held consoles (`/admin/held/*` and the Admin
// Console's tools at their own addresses, D938) and a branch's own pages
// (`/branch/*`), one profile (sidebarConfig.js). The keys keep their canvas
// names (#2375); only the routes moved.
const AD = 'Admin';
const ADMIN = [
  // The canvas draws no Admin home; D720 §5's overrides add one.
  off('/admin/commissions', key(AD, 'Home')),
  alias('/branch', key(AD, 'Home'), 'The branch digest, the branch admin’s landing (D720 §5).'),
  alias('/admin/fund-admin', key(AD, 'Home'), 'Fund admin has no board yet; it takes Admin · Home (D720 §11).'),
  own('/admin/held/accounts', key(AD, 'Accounts')),
  alias('/branch/accounts', key(AD, 'Accounts'), 'The branch’s Accounts page.'),
  own('/admin/accounts/all', key(AD, 'Accounts', 'Users')),
  own('/admin/exploring', key(AD, 'Accounts', 'Exploring members')),
  own('/admin/trash', key(AD, 'Accounts', 'Trash')),
  own('/admin/approvals', key(AD, 'Approvals')),
  alias('/branch/approvals', key(AD, 'Approvals'), 'The branch’s Approvals page.'),
  own('/admin/kyc', key(AD, 'Approvals', 'Identity checks')),
  own('/admin/partner-profiles', key(AD, 'Approvals', 'Entity profiles')),
  own('/admin/lp-applications', key(AD, 'Approvals', 'LP applications')),
  own('/admin/refer-earn', key(AD, 'Approvals', 'Referrals')),
  own('/admin/best-fit', key(AD, 'Approvals', 'Best fit')),
  own('/admin/due-diligence', key(AD, 'Approvals', 'Due diligence')),
  alias('/due-diligence', key(AD, 'Approvals', 'Due diligence'), 'The same Due diligence list and cases at the path the other profiles share (D774).'),
  // D937 (#2374): the Lab left the Admin Console for Programs. The keys keep
  // their canvas names (#2375); the addresses are the Lab's.
  own('/admin/programs/spinout-lab/applications', key(AD, 'Approvals', 'Spin-Out applications')),
  own('/admin/spinout-moderation', key(AD, 'Approvals', 'Spin-Out moderation')),
  own('/admin/events', key(AD, 'Approvals', 'Events')),
  own('/admin/jobs', key(AD, 'Approvals', 'Jobs')),
  own('/admin/circles', key(AD, 'Approvals', 'Communities')),
  own('/admin/advisor-cohorts', key(AD, 'Approvals', 'Advisor cohort access')),
  // D953 (#2371): the catalogue owns Admin · Programs, exactly: the Lab's
  // sub-path (#2374) has no rail (D317), so the owner does not answer the
  // pages below it. `/admin/held/programs` only redirects, so it draws no rail.
  // The two programs whose boards are on the canvas keep those boards' keys,
  // whose owners stay on the old addresses; the other five take Programs'.
  exact(own('/admin/programs', key(AD, 'Programs'))),
  alias('/branch/programs', key(AD, 'Programs'), 'The branch’s Programs page.'),
  alias('/admin/programs/mentor-cohorts', key(AD, 'Approvals', 'Advisor cohort access'), 'Programs › Mentor cohort access is the assignments console’s page and tabs (D953).'),
  alias('/admin/programs/refer-and-earn', key(AD, 'Approvals', 'Referrals'), 'Programs › Refer & Earn is the referral review’s page and tabs (D953).'),
  alias('/admin/programs/perks', key(AD, 'Programs'), 'Perks, one program page under Programs (D953).'),
  alias('/admin/programs/learning', key(AD, 'Programs'), 'Learning, one program page under Programs (D953).'),
  alias('/admin/programs/referral-partners', key(AD, 'Programs'), 'Referral partners, one program page under Programs (D953).'),
  alias('/admin/programs/investor-cohorts', key(AD, 'Programs'), 'Investor cohort access, one program page under Programs (D953).'),
  alias('/admin/programs/ai-native-venture', key(AD, 'Programs'), 'AI-native Venture, one program page under Programs (D953).'),
  own('/admin/programs/spinout-lab', key(AD, 'Programs', 'Spin-Out Lab')),
  own('/admin/profiling-trends', key(AD, 'Programs', 'Profiling trends')),
  own('/admin/community', key(AD, 'Community')),
  alias('/branch/community', key(AD, 'Community'), 'The branch’s Community page.'),
  // D938: the roster's own address; the prefix covers its resource library.
  own('/admin/wellbeing', key(AD, 'Community', 'Wellbeing experts')),
  // D972 (#2369): re-rooted at the page's address; the prefix covers its tabs.
  own('/admin/advisors-partners', key(AD, 'Community', 'Advisors and partners')),
  own('/admin/directory', key(AD, 'Community', 'Directory')),
  // D923 (#2370): re-rooted at the new address; the prefix covers the tabs and
  // the records. `/admin/partners` only redirects, so it draws no rail.
  own('/admin/partner-invitations', key(AD, 'Community', 'Partner invitations')),
  own('/admin/contracts', key(AD, 'Contracts')),
  alias('/branch/contracts', key(AD, 'Contracts'), 'The branch’s Contracts page.'),
  own('/admin/contracts?tab=agreements', key(AD, 'Contracts', 'Agreements')),
  own('/admin/contracts?tab=ndas', key(AD, 'Contracts', 'NDAs')),
  own('/admin/contracts?tab=partner-deals', key(AD, 'Contracts', 'Partner deals')),
  own('/admin/contracts?tab=templates', key(AD, 'Contracts', 'Templates')),
  own('/admin/contracts?tab=forms', key(AD, 'Contracts', 'Forms')),
  own('/admin/insights', key(AD, 'Insights')),
  alias('/branch/insights', key(AD, 'Insights'), 'The branch’s Insights page and its analytics.'),
  // D796 (#2229): the Admin's "Settings" board is "Licences"; runs logged before keep `Admin · Settings`.
  own('/admin/my-licence', key(AD, 'Licences')),
  // D804 (#2241): the board's Contract, Statements and Requests tabs are the Licences board's own.
  alias('/admin/my-licence/contract', key(AD, 'Licences'), 'The Licences board’s Contract tab.'),
  alias('/admin/my-licence/statements', key(AD, 'Licences'), 'The Licences board’s Statements tab.'),
  alias('/admin/my-licence/requests', key(AD, 'Licences'), 'The Licences board’s Requests tab.'),
  alias('/admin/my-licence/programs', key(AD, 'Licences'), 'The Licences board’s Programs tab (D981).'),
  alias('/branch/settings', key(AD, 'Licences'), 'The branch’s settings, which the Licences row stays lit on.'),
  off('/admin/accounts/credits', key(AD, 'Member credits')),
  exact(off('/admin', key(AD, 'Admin console'))),
  off('/exploring', key(AD, 'Exploring dashboard')),
  ...SHARED(AD),
];

// The HQ shell (sidebarConfig.js `super_admin`, lib/hqStrips.js).
const SA = 'Super Admin';
const SUPER = [
  // The canvas draws no Super Admin home either; /hq is the HQ shell's (sidebarConfig.js).
  off('/hq', key(SA, 'Home')),
  off('/admin/analytics', key(SA, 'Analytics')),
  own('/admin/licences', key(SA, 'Licences')),
  alias('/admin/licences/programs', key(SA, 'Licences'), 'Program grants, the Licences strip’s second item (D981).'),
  own('/admin/funds', key(SA, 'Funds')),
  alias('/admin/fund-admin', key(SA, 'Funds'), 'HQ’s Fund admin row sits after Funds and has no board yet.'),
  own('/admin/contracts', key(SA, 'Contracts')),
  own('/admin/contracts?tab=agreements', key(SA, 'Contracts', 'Agreements')),
  own('/admin/contracts?tab=ndas', key(SA, 'Contracts', 'NDAs')),
  own('/admin/contracts?tab=partner-deals', key(SA, 'Contracts', 'Partner deals')),
  own('/admin/contracts?tab=templates', key(SA, 'Contracts', 'Templates')),
  own('/admin/contracts?tab=forms', key(SA, 'Contracts', 'Forms')),
  own('/admin/contracts?tab=document-types', key(SA, 'Contracts', 'Document types')),
  own('/admin/accounts', key(SA, 'Team')),
  own('/admin/accounts/all', key(SA, 'Team', 'Users')),
  off('/admin/accounts/credits', key(SA, 'Member credits')),
  own('/admin/revenue', key(SA, 'Revenue')),
  own('/admin/revenue#disputes', key(SA, 'Revenue', 'Disputes')),
  alias('/admin/revenue/disputes', key(SA, 'Revenue', 'Disputes'), 'A dispute’s own page is a Disputes record.'),
  own('/admin/revenue#refunds', key(SA, 'Revenue', 'Refunds')),
  own('/admin/revenue#statements', key(SA, 'Revenue', 'Statements')),
  own('/admin/revenue#promotions', key(SA, 'Revenue', 'Promotions')),
  own('/admin/content', key(SA, 'Content')),
  own('/admin/articles', key(SA, 'Content', 'Content queue')),
  own('/admin/publications', key(SA, 'Content', 'Publications')),
  own('/admin/persona-segments', key(SA, 'Content', 'Personas')),
  own('/admin/advisors-partners', key(SA, 'Content', 'Advisors and partners')),
  own('/admin/directory', key(SA, 'Content', 'Directory')),
  own('/admin/team', key(SA, 'Content', 'Public team page')),
  own('/admin/platform', key(SA, 'Platform')),
  alias('/admin/platform/switches', key(SA, 'Platform'), 'Platform’s Switches item, on its overview.'),
  alias('/admin/platform/topology', key(SA, 'Platform'), 'Platform’s Topology item, on its overview.'),
  // One Super Admin page since the owner's ruling of 2026-10-20; GitHub sync is its #github section.
  own('/admin/integration-keys', key(SA, 'Platform', 'Integration keys')),
  own('/admin/integration-keys#github', key(SA, 'Platform', 'GitHub sync')),
  own('/admin/platform/payments', key(SA, 'Platform', 'Payments catalogue')),
  own('/admin/platform/promo-codes', key(SA, 'Platform', 'Promo codes')),
  own('/admin/credit-rules', key(SA, 'Platform', 'Credit rules')),
  own('/admin/platform/allowances', key(SA, 'Platform', 'AI allowances')),
  alias('/admin/platform/ai-usage', key(SA, 'Platform', 'AI allowances'), 'HQ › AI usage (D791) is AI allowances’ platform-wide read, and docks the same rail.'),
  own('/monitoring', key(SA, 'Platform', 'Monitoring')),
  own('/admin/telegram', key(SA, 'Platform', 'Telegram channels')),
  own('/admin/hq-support', key(SA, 'Support')),
  alias('/hq/review', key(SA, 'Support'), 'The review queue is Support’s (D606).'),
  own('/admin/security', key(SA, 'Security')),
  own('/account', key(SA, 'Settings')),
  exact(off('/admin', key(SA, 'Admin console'))),
  off('/exploring', key(SA, 'Exploring dashboard')),
  ...SHARED(SA).filter((p) => p.route !== '/account'),
];

/** Every profile's rail pages. A route claims a key once; an alias says why it shares one. */
export const RAIL_PAGES = {
  Founder: FOUNDER,
  Investor: INVESTOR,
  Advisor: ADVISOR,
  'Operating Partner': PARTNER,
  Admin: ADMIN,
  'Super Admin': SUPER,
};

/**
 * Canvas boards with no route of their own, and the page that answers each.
 * D720 §11's table first, then boards two sections share: the board the
 * canvas lists first owns the route (Approvals before Programs and
 * Community; Accounts before Approvals).
 */
export const RAIL_BOARD_ALIASES = [
  { board: key(I, 'Fund', 'Overview'), to: key(I, 'Fund'), why: 'I13 maps to I12: the fund page is its overview (D720 §11).' },
  { board: key(SA, 'Revenue', 'Overview'), to: key(SA, 'Revenue'), why: 'H13 maps to H12: the Revenue page is its overview (D720 §11).' },
  { board: key(AD, 'Approvals', 'Exploring members'), to: key(AD, 'Accounts', 'Exploring members'), why: 'One console, /admin/exploring; Accounts is listed first.' },
  { board: key(AD, 'Programs', 'Advisor cohorts'), to: key(AD, 'Approvals', 'Advisor cohort access'), why: 'One console, Programs › Mentor cohort access › People (D953); Approvals is listed first.' },
  { board: key(AD, 'Community', 'Events'), to: key(AD, 'Approvals', 'Events'), why: 'One console, /admin/events; Approvals is listed first.' },
  { board: key(AD, 'Community', 'Jobs'), to: key(AD, 'Approvals', 'Jobs'), why: 'One console, /admin/jobs; Approvals is listed first.' },
  { board: key(AD, 'Community', 'Communities'), to: key(AD, 'Approvals', 'Communities'), why: 'One console, /admin/circles; Approvals is listed first.' },
];

// ── matching ─────────────────────────────────────────────────────────────────

const segs = (p) => String(p || '').split('/').filter(Boolean);

function parse(route) {
  const [beforeHash, hash = null] = route.split('#');
  const [path, query = null] = beforeHash.split('?');
  const tab = query ? new URLSearchParams(query).get('tab') : null;
  return { segments: segs(path), tab, hash };
}

const PARSED = new Map();
const parsed = (route) => {
  if (!PARSED.has(route)) PARSED.set(route, parse(route));
  return PARSED.get(route);
};

/**
 * How well an entry's route answers the location, or -1. Every route segment must
 * match in order; a tab or an anchor in the route must be the location's.
 * More segments, then a tab or an anchor, win.
 */
function score(entry, path, tab, hash) {
  const r = parsed(entry.route);
  if (r.segments.length > path.length || (entry.exact && r.segments.length !== path.length)) return -1;
  for (let i = 0; i < r.segments.length; i += 1) if (r.segments[i] !== path[i]) return -1;
  if (r.tab && r.tab !== tab) return -1;
  if (r.hash && r.hash !== hash) return -1;
  return r.segments.length * 10 + (r.tab || r.hash ? 5 : 0);
}

function best(pages, path, tab, hash) {
  let hit = null;
  let top = -1;
  for (const p of pages) {
    const s = score(p, path, tab, hash);
    if (s > top) { top = s; hit = p; }
  }
  return hit;
}

/**
 * Routes that reach the rail's module but have no member to key it by: a
 * public page, a link a guest opens, or `/studio` for an admin (D598). The
 * app-parity test reads this list; each says why.
 */
export const NO_RAIL_ROUTES = [
  { route: '/account', prefix: true, railCount: 0, pageTestIds: ['settings-page', 'account-phone'], roles: ['founder', 'investor', 'advisor', 'partner', 'admin', 'exploring'], why: 'Owner request: Account and its sections have no AI rail on desktop or phone.' },
  { route: '/perks', railCount: 0, pageTestIds: ['perks-desk'], roles: ['founder', 'investor', 'advisor', 'admin', 'exploring'], why: 'Owner request: the standalone Perks page has no AI rail on desktop or phone. Partner Perk deals remains in its own workspace.' },
  { route: '/learning', railCount: 0, pageTestIds: ['learning-home'], roles: ['founder', 'investor', 'advisor', 'partner', 'admin'], why: 'Owner request: Learning home has no AI rail on desktop or phone. Learning subpages retain their rails.' },
  { route: '/studio', roles: ['admin'], why: 'Admin · Studio has no rail (D598).' },
  { route: '/raise/pitch', railCount: 0, pageTestIds: ['pitch-studio-boundary'], roles: ['advisor', 'partner'], why: 'D905 (#2684), PD22: an Advisor or an Operating Partner opening the Pitch deck studio reads its boundary inside their own shell, with no rail and nothing from a deck.' },
  { route: '/studio', railCount: 0, pageTestIds: ['advisor-studio-home'], roles: ['advisor'], why: 'Owner request: Advisor Studio has no AI side rail; its interview and practice modules remain.' },
  { route: '/studio/tickets/new', roles: ['admin'], why: 'Studio’s own form; Admin · Studio has no rail (D598).' },
  { route: '/spinout-lab/investor-workspace', railCount: 0, pageTestIds: ['investor-workspace-axal-vc-fund'], roles: ['investor'], why: 'Owner request: the LP investor workspace has no AI side rail; its content and access gates remain.' },
  { route: '/spinout-lab/apply', roles: [], why: 'The Spin-Out Lab application, before a lane is chosen: no profile yet.' },
  { route: '/spinout-lab/brief', roles: [], why: 'The public Spin-Out Lab brief.' },
  { route: '/advisors/:uid', roles: [], why: 'An advisor’s public profile.' },
  { route: '/b/*', roles: [], why: 'A public booking page.' },
  { route: '/attest/:token', roles: [], why: 'A consent link a guest opens.' },
  { route: '/attest/partner/:token', roles: [], why: 'A partner’s consent link a guest opens.' },
  { route: '/join/:token', roles: [], why: 'A branch invitation a guest opens.' },
  { route: '/admin/due-diligence', roles: ['partner', 'investor', 'advisor'], why: 'Due diligence’s rail is the Admin board’s (D774, AdminBoardFrame); a partner, investor or advisor on it gets the page alone until their profile’s rollout gives them one.' },
  { route: '/admin/due-diligence/:uid', roles: ['partner', 'investor', 'advisor'], why: 'Due diligence’s rail is the Admin board’s (D774, AdminBoardFrame); a partner, investor or advisor on it gets the page alone until their profile’s rollout gives them one.' },
  { route: '/due-diligence', roles: ['partner', 'investor', 'advisor'], why: 'Due diligence’s rail is the Admin board’s (D774, AdminBoardFrame); a partner, investor or advisor on it gets the page alone until their profile’s rollout gives them one.' },
  { route: '/due-diligence/:uid', roles: ['partner', 'investor', 'advisor'], why: 'Due diligence’s rail is the Admin board’s (D774, AdminBoardFrame); a partner, investor or advisor on it gets the page alone until their profile’s rollout gives them one.' },
  { route: '/partner/insights', roles: ['investor'], why: 'Demand’s rail is the operating partner’s (D773: PartnerWorkspaceTabs draws it for a partner only); an investor on it gets the page alone until their profile’s rollout gives them one.' },
  { route: '/comarketing', roles: ['founder', 'investor'], why: 'Visibility’s rail is the operating partner’s (D773: PartnerWorkspaceTabs draws it for a partner only); a founder gets the Grow editor and an investor the page alone, and neither profile’s map has a co-marketing board.' },
  { route: '/admin/programs/spinout-lab', prefix: true, roles: ['admin'], why: 'A Spin-Out Lab page: D317 keeps Eadwyn out of the Lab (D774), and D937 (#2374) keeps it so at the Lab’s address under Programs. The boards keep their keys.' },
  { route: '/admin/spinout-moderation', roles: ['admin'], why: 'A Spin-Out Lab console: D317 keeps Eadwyn out of the Lab (D774). The board keeps its key; `/admin`’s Spin-Out Lab tab draws the page alone too.' },
];

/** The order an admin's preview of a member page reads the member profiles in. */
const PREVIEW = ['Founder', 'Investor', 'Advisor', 'Operating Partner'];

/**
 * The rail's page entry for a location, or null: `{ route, key, alias?,
 * offCanvas? }`. `role` is a shell role (`shellRoleFor`) or a profile name;
 * `search` and `hash` tell the boards that share a route apart. An admin on
 * a member's page (a View-as preview, a shared route) gets that page's key.
 */
export function pageFor(pathname, role, { search = '', hash = '' } = {}) {
  const profile = PROFILE_OF_ROLE[role] || (PROFILES.includes(role) ? role : null);
  if (!profile) return null;
  const path = segs(pathname);
  const tab = new URLSearchParams(String(search || '').replace(/^\?/, '')).get('tab');
  const anchor = String(hash || '').replace(/^#/, '') || null;
  const admin = profile === 'Admin' || profile === 'Super Admin';
  // D598: Studio has no rail for an admin. Its archetype card is a page of its own.
  if (admin && path[0] === 'studio' && path[1] !== 'archetype') return null;
  const mine = best(RAIL_PAGES[profile], path, tab, anchor);
  if (mine || !admin) return mine;
  for (const p of PREVIEW) {
    const hit = best(RAIL_PAGES[p], path, tab, anchor);
    if (hit) return hit;
  }
  return null;
}

/** The page key for a location, or null. Pure: see `pageFor`. */
export function pageKeyFor(pathname, role, opts = {}) {
  return pageFor(pathname, role, opts)?.key ?? null;
}

/** `{ profile, section, module }` from a page key; nulls when absent. */
export function crumbsOfKey(pageKey) {
  const [profile = null, section = null, module = null] = String(pageKey || '').split(' · ').filter(Boolean);
  return { profile, section, module };
}

/** Every page key the map can answer, by profile: owned keys and board aliases. */
export function keysOf(profile) {
  return new Set([
    ...(RAIL_PAGES[profile] || []).map((p) => p.key),
    ...RAIL_BOARD_ALIASES.filter((a) => a.board.startsWith(`${profile} · `)).map((a) => a.board),
  ]);
}

// ── the rail context a run carries ───────────────────────────────────────────

const NONE = Object.freeze({ page: null, option: null, record: null });
let current = NONE;

/**
 * `{ page, option, record }`: what every run the rail starts sends as
 * `rail` (D765 records and enforces it). `RailPageProvider`
 * (`ui/railCrumbs.js`) sets it from the route, the open option and the record
 * view; an API method reads it without React.
 */
export function currentRail() { return current; }

/** The provider's setter. `null` clears it. */
export function setCurrentRail(next) {
  current = next && next.page ? { page: next.page, option: next.option ?? null, record: next.record ?? null } : NONE;
}

/** `{ rail }` for a run's body while a page key is known, else nothing, so a body without one is unchanged. */
export function railBody() {
  return current.page ? { rail: { ...current } } : {};
}
