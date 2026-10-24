/**
 * The H35 placement map — where every legacy admin console lives (D283).
 *
 * One entry per row of the old 50-row admin sidebar, per tab of the Admin
 * Console at /admin, and for the parked X row. Each says which tier and row
 * it lives on and how it appears there. The command palette
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

export const TIERS = ['HQ', 'Admin', 'palette', 'parked'];

// H35's three forms plus the three the canvas also draws: a lane on Approvals,
// a top-bar button, and the palette (D563 retired the launcher that was the
// sixth). `row` is for the one entry that IS a
// shell row rather than something placed inside one.
export const FORMS = ['row', 'sub-nav', 'card link', 'embedded', 'lane', 'top bar', 'palette'];

// H35's note, verbatim: "Rows: exactly eleven, unchanged."
export const HQ_ROWS = ['Home', 'Licences', 'Funds', 'Contracts', 'Team', 'Revenue', 'Content', 'Platform', 'Support', 'Security', 'Settings'];
// S20's eight, in order.
export const ADMIN_ROWS = ['Studio', 'Accounts', 'Approvals', 'Programs', 'Community', 'Contracts', 'Insights', 'Licences'];
// The one placement that is neither a row nor a tier: the top bar of a shell.
export const TOP_BAR = 'Top bar';

// H35's reason for X, verbatim.
export const X_PARKED_REASON = 'In no navigation, by decision. The route still resolves.';

const hq = (row, form) => ({ tier: 'HQ', row, form });
const admin = (row, form) => ({ tier: 'Admin', row, form });

// A legacy sidebar row. `key` is its route.
const row = (label, route, place, hqOnly, extra = {}) => ({ key: route, kind: 'row', label, route, hqOnly, ...place, ...extra });
// A tab of the retired Admin Console. `key` is `tab:<value>`, which H35's
// question pins; `route` is the page's own address (#2375's route map, D938),
// where `/admin?tab=<value>` forwards. `hqOnly` restates the route's wrapper.
const tab = (value, label, route, hqOnly, place, extra = {}) => ({ key: `tab:${value}`, kind: 'tab', tabValue: value, label, route, hqOnly, ...place, ...extra });
// One of the 28 working pages S23/H37 drew in a launcher, with the canvas's own
// one-line description of what the page is.
const page = (group, label, route, what) => ({ key: route, kind: 'page', group, label, route, what, hqOnly: false, tier: 'palette', row: null, form: 'palette' });

export const ADMIN_PLACEMENT = [
  // ── Home group ──────────────────────────────────────────────────────────
  row('Studio', '/studio', admin('Studio', 'row'), false,
    { how: 'Row 1 of the Admin shell. HQ’s own landing stays /hq.' }),
  row('Messages', '/messages', admin(TOP_BAR, 'top bar'), false,
    { how: 'Top-bar button on HQ and Admin.', also: [hq(TOP_BAR, 'top bar')] }),

  // ── Admin group ─────────────────────────────────────────────────────────
  // The Admin Console itself, /admin, is on UNPLACED below: H35 said "Stays
  // reachable. Its 14 tabs are placed individually". Since D938 it is a
  // redirect, and each tab is a page of its own, placed below.
  row('Due Diligence', '/admin/due-diligence', admin('Approvals', 'lane'), false, { how: 'A lane.' }),
  row('Best-Fit Console', '/admin/best-fit', admin('Approvals', 'lane'), false, { how: 'A lane.' }),
  row('Event Admin', '/admin/events', admin('Community', 'card link'), false,
    { how: 'Card link. Its approvals are also an Approvals lane.', also: [admin('Approvals', 'lane')] }),
  row('Job Board Admin', '/admin/jobs', admin('Community', 'card link'), false,
    { how: 'Card link. Also an Approvals lane.', also: [admin('Approvals', 'lane')] }),
  row('Communities Admin', '/admin/circles', admin('Community', 'card link'), false,
    { how: 'Card link. Circles have no approval queue.' }),
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
  // D923 (#2370): the console moved to /admin/partner-invitations. The key stays
  // the legacy row's route, which H35's question pins; the route is the new
  // address, a Community card link with Approvals lane 13 as its `also`, as Events.
  { key: '/admin/partners', kind: 'row', label: 'Partner Invitations', route: '/admin/partner-invitations', hqOnly: false,
    ...admin('Community', 'card link'), how: 'Card link. Approvals lane 13 is also its door.', also: [admin('Approvals', 'lane')] },
  row('Referral Review', '/admin/refer-earn', admin('Approvals', 'lane'), false, { how: 'The Referrals core lane.' }),
  row('Public Team Page', '/admin/team', hq('Content', 'sub-nav'), false, { how: 'Sub-navigation item.' }),
  row('My Licence', '/admin/my-licence', admin('Licences', 'embedded'), false, { how: 'Embedded panel.' }),
  // H35 drew Trash as "HQ · Security · proposal — not yet agreed". The
  // proposal is not adopted: the door was a literal link on the Admin Console
  // header, and since D938 it is an item of All accounts' More menu.
  row('Trash', '/admin/trash', admin('Accounts', 'card link'), false,
    { how: 'A literal link in All accounts’ More menu (D938). H35’s Security proposal was not adopted.' }),

  // ── The Admin Console's tabs, each a page since D938 (#2743) ───────────
  // `/admin?tab=<value>` forwards to the route (`LegacyContractsRedirect`).
  // All accounts sits under /admin/accounts until #2375's question 1 is
  // answered (part 4); Platform and Revenue pages are the Super Admin's.
  tab('users', 'All accounts', '/admin/accounts/all', false, hq('Team', 'embedded'),
    { how: 'Already embedded on HQ · Team; its own page on Admin · Accounts.', also: [admin('Accounts', 'embedded')] }),
  tab('profiles', 'Partner profiles', '/admin/partner-profiles', false, admin('Approvals', 'lane'), { how: 'A lane.' }),
  tab('kyc', 'KYC & KYB', '/admin/kyc', false, admin('Approvals', 'lane'),
    { how: 'A lane. HQ · Team carries a card link to it.', also: [hq('Team', 'card link')] }),
  tab('lab-applications', 'Spin-Out Lab', '/admin/programs/spinout-lab/applications', false, admin('Programs', 'embedded'),
    { how: 'Its own page under Programs (D937); the legacy tab redirects here.' }),
  tab('legal', 'Contracts', '/admin/contracts', false, hq('Contracts', 'embedded'),
    { how: 'One Contracts page in both shells; the legacy Legal link redirects here.', also: [admin('Contracts', 'embedded')] }),
  tab('personas', 'Persona segments', '/admin/persona-segments', false, hq('Content', 'sub-nav'),
    { how: 'Sub-navigation item (the taxonomy). Retagging one person lives on Admin · Accounts.', also: [admin('Accounts', 'card link')] }),
  // #2375: Directory is Community's; Approvals lists it under "Not a queue".
  tab('directory', 'Directory', '/admin/directory', false, admin('Community', 'card link'),
    { how: 'Card link. Approvals lists it under “Not a queue”.', also: [admin('Approvals', 'lane')] }),
  // Integration keys and GitHub Sync stood here as Platform sub-navigation
  // items. The owner's ruling (2026-10-20) took both out of the Admin Console:
  // they are one Super Admin page, `/admin/integration-keys`, with an HQ row
  // of its own, so there is no legacy tab left to place.
  tab('payments', 'Payments', '/admin/platform/payments', true, hq('Platform', 'sub-nav'), { how: 'Sub-navigation item.' }),
  // D708 (#1773) — beside Payments: the Super Admin's bank-account registry.
  tab('bank-accounts', 'Bank accounts', '/admin/platform/bank-accounts', true, hq('Platform', 'sub-nav'), { how: 'Sub-navigation item, after Payments.' }),
  tab('product-testing', 'Product testing', '/admin/platform/product-testing', true, hq('Platform', 'sub-nav'), { how: 'Sub-navigation item, after Bank accounts (D815).' }),
  tab('promos', 'Promo codes', '/admin/platform/promo-codes', true, hq('Platform', 'sub-nav'), { how: 'Sub-navigation item. Promo ceilings stay on Revenue.' }),
  tab('billing', 'Billing', '/admin/revenue/billing', true, hq('Revenue', 'card link'), { how: 'Card link.' }),
  // Wellbeing had no home on H35. The decision: Admin · Community — the
  // roster is curated where the community it serves is run.
  tab('wellbeing', 'Wellbeing', '/admin/wellbeing', false, admin('Community', 'card link'), { how: 'Card link, beside Events, Jobs and Circles.' }),
  tab('network-profiles', 'Advisors & Partners', '/admin/advisors-partners', false, hq('Content', 'sub-nav'),
    { how: 'Its own page under Community (D972); Sub-navigation item on Content; the legacy tab redirects to its Deck roster.', also: [admin('Community', 'card link')] }),

  // ── The 28 working pages (S23 · H37) → the profile sidebars (D563) ──────
  // H37 drew them in a Workspaces launcher on the admin shells; D563 retired
  // it. Each now lights the profile row in `PAGE_HOMES` below and is linked
  // from that row's overview; on an admin shell the palette indexes them.
  // The owner removed six of them on 2026-10-20 — Scoring Engine, Risk Matrix,
  // Capital & Investment, Liquidity & Exits, Reserve Allocation and Watchlist
  // & Journal — page and route together. #2324 removed Network Effects,
  // #2341 removed Advisory, #2337 and #2338 removed Portfolio Coverage,
  // Service Catalogue and Needs Board on 2026-10-21, and #2354 removed Legal &
  // Capital (its address forwards to Raise › Legal), so fourteen remain.
  page('Studio', 'Pipeline Board', '/pipeline', 'Deals by stage on one board.'),
  page('Studio', 'Deal Flow', '/deals', 'Incoming deals and their status.'),
  page('Capital & Legal', 'Portfolio Health', '/portfolio/health', 'Health signals per company.'),
  page('Capital & Legal', 'Exit Waterfall', '/portfolio/waterfall', 'Proceeds by class at a given exit.'),
  page('Capital & Legal', 'Incorporate', '/incorporate', 'Entity formation workflow.'),
  page('Capital & Legal', 'Compliance Calendar', '/compliance', 'Filings and their deadlines.'),
  page('Network & Growth', 'Network', '/network', 'Relationships and introductions.'),
  page('Network & Growth', 'Jobs', '/my/jobs', 'Open roles.'),
  page('Network & Growth', 'Demand Insights', '/partner/insights', 'Partner demand analytics.'),
  page('Network & Growth', 'Partner Office Hours', '/partner/office-hours', 'Partner session bookings.'),
  page('Network & Growth', 'Co-Marketing Review', '/comarketing', 'Co-marketing submissions to review.'),
  page('More', 'Co-Founder Agreement', '/incorporate/cofounder-agreement', 'Founder agreement drafting.'),
  page('More', '83(b) Tracker', '/spinout-lab/83b', 'Election deadline tracking.'),
  page('More', 'Perks', '/perks', 'Partner perks and claims.'),
];

// S23 / H37's groups, in the canvas's order. The palette's hint names them.
export const WORKSPACE_GROUP_ORDER = ['Studio', 'Capital & Legal', 'Network & Growth', 'More'];

/**
 * The working pages (eighteen since 2026-10-21), the list the command palette reads for an admin shell
 * (D284). Derived from the map, never typed twice.
 */
export const WORKSPACES = ADMIN_PLACEMENT
  .filter((e) => e.tier === 'palette')
  .map(({ group, label, route, what }) => ({ group, label, route, description: what }));

/**
 * Where each of the working pages lives in the profile shells (D563). One entry per page:
 * `[role, row, door]`, where `row` is the profile sidebar row's label and
 * `door` says how the page is reached from that row:
 *
 *   'row'   — the page IS the row's own destination (or its overview alias);
 *   'also'  — the row's `match` lists it, and the row's overview draws it in
 *             its "Also in" list (`workspaces/AlsoIn.jsx`);
 *   'lab'   — a Spin-Out Lab page: the row's `match` lists it and the Lab's
 *             own arsenal (`lib/spinoutLabArsenal.js`) links it.
 *
 * An optional fourth element, `{ label, description }`, is what that profile
 * calls the page in its "Also in" list. The palette entry's label is the
 * ADMIN name ("Co-Marketing Review"); a founder's Grow row lists the page
 * under the name the page itself carries for them (#1447).
 *
 * Only roles the page's route guard admits are named, and a page has at most
 * one home per role, which is the sidebar's own rule ("items must not appear
 * in more than one group within a role"). `frontend/test/
 * workspaces_retired_d563.test.mjs` checks every line against App.jsx and
 * `sidebarConfig.js`.
 */
export const PAGE_HOMES = {
  '/pipeline': [['partner', 'Pipeline', 'row']],
  '/deals': [['investor', 'Deals', 'row']],
  '/portfolio/health': [['investor', 'Portfolio', 'row']],
  '/portfolio/waterfall': [['investor', 'Portfolio', 'also']],
  '/incorporate': [['founder', 'Raise', 'also']],
  '/compliance': [['founder', 'Raise', 'also']],
  '/network': [['founder', 'Network', 'row'], ['investor', 'Network', 'row'], ['partner', 'Network', 'row'], ['advisor', 'Network', 'row']],
  '/my/jobs': [['partner', 'Network', 'also'], ['advisor', 'Network', 'also']],
  '/partner/insights': [['partner', 'Pipeline', 'also']],
  '/partner/office-hours': [['partner', 'Offers', 'also']],
  '/comarketing': [['partner', 'Offers', 'also'], ['founder', 'Grow', 'also', {
    label: 'Co-marketing',
    description: 'Pitch a webinar, post or podcast with a partner, and see what it brought in.',
  }]],
  '/incorporate/cofounder-agreement': [['founder', 'Raise', 'also']],
  '/spinout-lab/83b': [['founder', 'Spin-Out Lab', 'lab']],
  '/perks': [['founder', 'Grow', 'also']],
};

/** The pages a profile row's overview lists under "Also in", in map order. */
export function alsoInFor(role, row) {
  return WORKSPACES.flatMap((w) => {
    const home = (PAGE_HOMES[w.route] || [])
      .find(([r, label, door]) => r === role && label === row && door === 'also');
    return home ? [{ ...w, ...(home[3] || {}) }] : [];
  });
}

// Legacy entries with no placement of their own, each with its reason. The
// guard pins this list by value, so it cannot grow quietly.
export const UNPLACED = [
  { key: '/admin', kind: 'row', label: 'Admin Console', route: '/admin', hqOnly: false,
    why: 'A redirect since D938: every old tab forwards to its own page, placed individually.' },
];

/** The entries a shell draws on one of its rows: `tier` first, then `also`. */
export function placedOn(tier, rowName) {
  return ADMIN_PLACEMENT.filter((e) =>
    (e.tier === tier && e.row === rowName)
    || (e.also || []).some((a) => a.tier === tier && a.row === rowName));
}

/** The route a placement opens, without its query or hash: what App.jsx registers. */
export function routePath(route) {
  return route.split('?')[0].split('#')[0];
}
