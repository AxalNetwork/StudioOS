/**
 * The H35 placement map — where every legacy admin console lives (D283).
 *
 * One entry per row of the old 50-row admin sidebar, per tab of the Admin
 * Console at /admin, and for the parked X row. Each says which tier and row
 * it lives on and how it appears there. The launcher and the command palette
 * (D284) and the HQ sub-navigation strips (D285) read this list; nothing else
 * decides where a console is reached from.
 *
 * `hqOnly` is typed here so a reader that cannot see App.jsx can decide
 * whether to offer a route to a plain admin. `frontend/test/
 * admin_placement_h35.test.mjs` derives the same flag from App.jsx's
 * `hqOnly(` wrappers and fails when the two disagree, so the typed value can
 * only ever restate the route table.
 *
 * `also` carries a second placement for the entries H35 draws on two rows —
 * a Users tab embedded on HQ · Team and on Admin · Accounts, a Community card
 * that is also an Approvals lane. The first placement is the one a shell's own
 * chrome renders; `also` is what the palette indexes in addition.
 *
 * Pure data: it imports nothing, so a Node test can import it directly.
 */

export const TIERS = ['HQ', 'Admin', 'launcher', 'parked'];

// H35's three forms plus the three the canvas also draws: a lane on Approvals,
// a top-bar button, and the launcher. `row` is for the one entry that IS a
// shell row rather than something placed inside one.
export const FORMS = ['row', 'sub-nav', 'card link', 'embedded', 'lane', 'top bar', 'launcher'];

// H35's note, verbatim: "Rows: exactly eleven, unchanged."
export const HQ_ROWS = ['Home', 'Licences', 'Funds', 'Contracts', 'Team', 'Revenue', 'Content', 'Platform', 'Support', 'Security', 'Settings'];
// S20's eight, in order.
export const ADMIN_ROWS = ['Studio', 'Accounts', 'Approvals', 'Programs', 'Community', 'Contracts', 'Insights', 'Settings'];
// The one placement that is neither a row nor a tier: the top bar of a shell.
export const TOP_BAR = 'Top bar';

// H35's reason for X, verbatim.
export const X_PARKED_REASON = 'In no navigation, by decision. The route still resolves.';

const hq = (row, form) => ({ tier: 'HQ', row, form });
const admin = (row, form) => ({ tier: 'Admin', row, form });

// A legacy sidebar row. `key` is its route.
const row = (label, route, place, hqOnly, extra = {}) => ({ key: route, kind: 'row', label, route, hqOnly, ...place, ...extra });
// An Admin Console tab. `key` is `tab:<value>`; the route is the deep link.
// /admin is `guard(['admin'])` with no elevation, so no tab is hqOnly.
const tab = (value, label, place, extra = {}) => ({ key: `tab:${value}`, kind: 'tab', tabValue: value, label, route: `/admin?tab=${value}`, hqOnly: false, ...place, ...extra });
// One of the 29 working pages: S23/H37's launcher, with the canvas's own
// one-line description of what the page is.
const page = (group, label, route, what) => ({ key: route, kind: 'page', group, label, route, what, hqOnly: false, tier: 'launcher', row: null, form: 'launcher' });

export const ADMIN_PLACEMENT = [
  // ── Home group ──────────────────────────────────────────────────────────
  row('Studio', '/studio', admin('Studio', 'row'), false,
    { how: 'Row 1 of the Admin shell. HQ’s own landing stays /hq.' }),
  row('Messages', '/messages', admin(TOP_BAR, 'top bar'), false,
    { how: 'Top-bar button on HQ and Admin.', also: [hq(TOP_BAR, 'top bar')] }),

  // ── Admin group ─────────────────────────────────────────────────────────
  // The Admin Console itself, /admin, is on UNPLACED below: H35 says "Stays
  // reachable. Its 14 tabs are placed individually", and they are.
  row('Due Diligence', '/admin/due-diligence', admin('Approvals', 'lane'), false, { how: 'A lane.' }),
  row('Assessment Studio', '/admin/assessment', hq('Content', 'sub-nav'), false,
    { how: 'Sub-navigation item (authoring). Admin · Programs shows the runs.', also: [admin('Programs', 'card link')] }),
  row('Best-Fit Console', '/admin/best-fit', admin('Approvals', 'lane'), false, { how: 'A lane.' }),
  row('Event Admin', '/admin/events', admin('Community', 'card link'), false,
    { how: 'Card link. Its approvals are also an Approvals lane.', also: [admin('Approvals', 'lane')] }),
  row('Job Board Admin', '/admin/jobs', admin('Community', 'card link'), false,
    { how: 'Card link. Also an Approvals lane.', also: [admin('Approvals', 'lane')] }),
  row('Communities Admin', '/admin/circles', admin('Community', 'card link'), false,
    { how: 'Card link. Also an Approvals lane.', also: [admin('Approvals', 'lane')] }),
  row('Advisor Cohort Access', '/admin/advisor-cohorts', admin('Programs', 'card link'), false,
    { how: 'Card link. Also an Approvals lane.', also: [admin('Approvals', 'lane')] }),
  row('Exploring Users', '/admin/exploring', admin('Accounts', 'embedded'), false,
    { how: 'Embedded panel. Also an Approvals lane.', also: [admin('Approvals', 'lane')] }),
  row('LP Applications', '/admin/lp-applications', admin('Approvals', 'lane'), false, { how: 'A core lane.' }),
  row('Monitoring', '/monitoring', hq('Platform', 'sub-nav'), false, { how: 'Sub-navigation item.' }),
  row('Telegram Channels', '/admin/telegram', hq('Platform', 'sub-nav'), true, { how: 'Sub-navigation item.' }),
  // Parked, by decision. The commented-out row stays in sidebarConfig.js and
  // the route stays registered; the reachability guard exempts it as parked.
  { key: '/admin/x', kind: 'row', label: 'X (Twitter)', route: '/admin/x', hqOnly: true, tier: 'parked', row: null, form: null, how: X_PARKED_REASON },
  row('Content Queue', '/admin/articles', hq('Content', 'sub-nav'), false, { how: 'Sub-navigation item.' }),
  row('Publications', '/admin/publications', hq('Content', 'sub-nav'), false, { how: 'Sub-navigation item.' }),
  row('Partner Invitations', '/admin/partners', admin('Approvals', 'lane'), false, { how: 'A lane.' }),
  row('Referral Review', '/admin/refer-earn', admin('Approvals', 'lane'), false, { how: 'The Referrals core lane.' }),
  row('Public Team Page', '/admin/team', hq('Content', 'sub-nav'), false, { how: 'Sub-navigation item.' }),
  row('My Licence', '/admin/my-licence', admin('Settings', 'embedded'), false, { how: 'Embedded panel.' }),
  // H35 drew Trash as "HQ · Security · proposal — not yet agreed". The
  // proposal is not adopted: the door is a literal link on the Admin Console
  // (/admin), which Admin · Accounts embeds. Same product as the row it sat
  // under, one click further.
  row('Trash', '/admin/trash', admin('Accounts', 'card link'), false,
    { how: 'A literal link on the Admin Console header. H35’s Security proposal was not adopted.' }),

  // ── Admin Console tabs · /admin?tab=… ───────────────────────────────────
  tab('users', 'Users', hq('Team', 'embedded'),
    { how: 'Already embedded on HQ · Team; embedded panel on Admin · Accounts.', also: [admin('Accounts', 'embedded')] }),
  tab('profiles', 'Partner Profiles', admin('Approvals', 'lane'), { how: 'A lane.' }),
  tab('kyc', 'KYC Queue', admin('Approvals', 'lane'),
    { how: 'A lane. HQ · Team carries a card link to it.', also: [hq('Team', 'card link')] }),
  tab('lab-applications', 'Spin-Out Lab', admin('Programs', 'embedded'), { how: 'Embedded panel.' }),
  tab('legal', 'Legal', hq('Contracts', 'embedded'),
    { how: 'Already embedded on HQ · Contracts; embedded on Admin · Contracts.', also: [admin('Contracts', 'embedded')] }),
  tab('personas', 'Personas', hq('Content', 'sub-nav'),
    { how: 'Sub-navigation item (the taxonomy). Retagging one person lives on Admin · Accounts.', also: [admin('Accounts', 'card link')] }),
  tab('directory', 'Directory', admin('Approvals', 'lane'), { how: 'A lane.' }),
  tab('integration-keys', 'Integration keys', hq('Platform', 'sub-nav'), { how: 'Sub-navigation item.' }),
  tab('github', 'GitHub Sync', hq('Platform', 'sub-nav'), { how: 'Sub-navigation item.' }),
  tab('payments', 'Payments', hq('Platform', 'sub-nav'), { how: 'Sub-navigation item.' }),
  tab('promos', 'Promo codes', hq('Platform', 'sub-nav'), { how: 'Sub-navigation item. Promo ceilings stay on Revenue.' }),
  tab('billing', 'Billing', hq('Revenue', 'card link'), { how: 'Card link.' }),
  // Wellbeing had no home on H35. The decision: Admin · Community — the
  // roster is curated where the community it serves is run.
  tab('wellbeing', 'Wellbeing', admin('Community', 'card link'), { how: 'Card link, beside Events, Jobs and Circles.' }),
  tab('network-profiles', 'Advisors & Partners', hq('Content', 'sub-nav'),
    { how: 'Sub-navigation item on Content (the deck roster); card link on Community.', also: [admin('Community', 'card link')] }),

  // ── The 29 working pages → the Workspaces launcher (S23 · H37) ──────────
  // "AI Advisory Suite" keeps its shipped label. H37 flags it — the voice
  // rule forbids calling the AI an advisor — and the rename is the owner's
  // call (D284); the launcher draws the label and no flag.
  page('Studio', 'Pipeline Board', '/pipeline', 'Deals by stage on one board.'),
  page('Studio', 'Scoring Engine', '/scoring', 'Venture-readiness scores and the evidence behind them.'),
  page('Studio', 'Risk Matrix', '/portfolio/risk-matrix', 'Portfolio companies by risk dimension.'),
  page('Studio', 'Market Intelligence', '/market-intel', 'Market readings with their sources.'),
  page('Studio', 'Signals', '/signals', 'External signals, grouped by theme.'),
  page('Studio', 'AI Advisory Suite', '/advisory', 'AI-assisted analysis tools.'),
  page('Studio', 'AI Matches', '/matches', 'Suggested matches between members.'),
  page('Studio', 'Deal Flow', '/deals', 'Incoming deals and their status.'),
  page('Capital & Legal', 'Capital & Investment', '/capital', 'Rounds, commitments and instruments.'),
  page('Capital & Legal', 'Liquidity & Exits', '/liquidity', 'Secondaries and recorded exits.'),
  page('Capital & Legal', 'Portfolio Health', '/portfolio/health', 'Health signals per company.'),
  page('Capital & Legal', 'Portfolio Coverage', '/portfolio/coverage', 'Who covers which company.'),
  page('Capital & Legal', 'Reserve Allocation', '/portfolio/reserves', 'Follow-on reserves by company.'),
  page('Capital & Legal', 'Exit Waterfall', '/portfolio/waterfall', 'Proceeds by class at a given exit.'),
  page('Capital & Legal', 'Watchlist & Journal', '/watchlist', 'Tracked companies and notes.'),
  page('Capital & Legal', 'Legal & Capital', '/legal-capital', 'Documents and capital records.'),
  page('Capital & Legal', 'Incorporate', '/incorporate', 'Entity formation workflow.'),
  page('Capital & Legal', 'Compliance Calendar', '/compliance', 'Filings and their deadlines.'),
  page('Network & Growth', 'Network', '/network', 'Relationships and introductions.'),
  page('Network & Growth', 'Network Effects', '/network-effects', 'How activity compounds across the network.'),
  page('Network & Growth', 'Jobs', '/my/jobs', 'Open roles.'),
  page('Network & Growth', 'Service Catalogue', '/services', 'Services offered to companies.'),
  page('Network & Growth', 'Needs Board', '/needs', 'Needs posted by founders.'),
  page('Network & Growth', 'Demand Insights', '/partner/insights', 'Partner demand analytics.'),
  page('Network & Growth', 'Partner Office Hours', '/partner/office-hours', 'Partner session bookings.'),
  page('Network & Growth', 'Co-Marketing Review', '/comarketing', 'Co-marketing submissions to review.'),
  page('More', 'Co-Founder Agreement', '/incorporate/cofounder-agreement', 'Founder agreement drafting.'),
  page('More', '83(b) Tracker', '/spinout-lab/83b', 'Election deadline tracking.'),
  page('More', 'Perks', '/perks', 'Partner perks and claims.'),
];

// S23 / H37's launcher groups, in the canvas's order.
export const WORKSPACE_GROUP_ORDER = ['Studio', 'Capital & Legal', 'Network & Growth', 'More'];

/**
 * The 29 working pages, the one list the Workspaces launcher and the command
 * palette both read (D284). Derived from the map, never typed twice.
 */
export const WORKSPACES = ADMIN_PLACEMENT
  .filter((e) => e.tier === 'launcher')
  .map(({ group, label, route, what }) => ({ group, label, route, description: what }));

/** The same 29, grouped for rendering. `count` is computed, never typed. */
export const WORKSPACE_GROUPS = WORKSPACE_GROUP_ORDER.map((group) => {
  const items = WORKSPACES.filter((w) => w.group === group);
  return { group, items, count: items.length };
});

// Legacy entries with no placement of their own, each with its reason. The
// guard pins this list by value, so it cannot grow quietly.
export const UNPLACED = [
  { key: '/admin', kind: 'row', label: 'Admin Console', route: '/admin', hqOnly: false,
    why: 'Stays reachable. Its 14 tabs are placed individually.' },
];

/** The entries a shell draws on one of its rows: `tier` first, then `also`. */
export function placedOn(tier, rowName) {
  return ADMIN_PLACEMENT.filter((e) =>
    (e.tier === tier && e.row === rowName)
    || (e.also || []).some((a) => a.tier === tier && a.row === rowName));
}

/** The route a placement opens, without its `?tab=`: what App.jsx registers. */
export function routePath(route) {
  return route.split('?')[0].split('#')[0];
}
