/**
 * #2301 — the SPA's redirect-only routes, counted before they are retired.
 *
 * Each path-only entry is a `<Route path>` in `frontend/src/App.jsx` whose element always
 * forwards to another address (a `<Navigate>` or a `*Redirect` component, with
 * or without a role guard), never a page. Routes that redirect for some roles
 * and render a page for others (`/raise/data-room`, `/build`, …) are
 * not here: they are pages. D939 additionally records the fixed historical
 * admin-tab keys, including tabs awaiting their own redirect; these must stay
 * countable when their console sections move. The tests pin that closed set.
 * `frontend/test/redirect_hits_2301.test.mjs` reads
 * App.jsx and fails if this list and the routes drift apart.
 *
 * WHY A LIST. A redirect runs in the browser: the Worker serves the SPA shell
 * from `[assets]` without running, so no Worker log line sees the old address.
 * The SPA sends one first-party beacon when an address here is opened
 * (`lib/redirectBeacon.js`), and `POST /api/public/analytics/pageview` counts
 * it as `redirect:<pattern>` in `public_pageviews` — only for a pattern on this
 * list, so the beacon cannot write any other key. Fixed patterns only: no IP, user agent
 * or cookie.
 *
 * ORDER. Each exact pattern comes before its splat (`/notifications`, then
 * `/notifications/*`): the SPA takes the first pattern an address matches.
 *
 * `keep` marks the addresses an email or an external link can still carry
 * (#2297 §12: settings, notifications, a ticket, support, plans and pricing;
 * and, by its "any token or signed link", `/help/<id>` in sent Slack messages
 * and `/integrations`, where provider sign-ins return): they stay after
 * 2027-01-19 whatever their count, and are counted for the record.
 */
export interface RedirectRoute { path: string; keep?: true; forward?: true }

/** D939: the legacy console's fixed tabs, including the two retired integration tabs.
 * Never record an arbitrary query value. These are counter keys, not Route paths.
 */
export const ADMIN_TAB_REDIRECTS: readonly RedirectRoute[] = Object.freeze([
  { path: '/admin?tab=users' },
  { path: '/admin?tab=profiles' },
  { path: '/admin?tab=kyc' },
  { path: '/admin?tab=lab-applications' },
  { path: '/admin?tab=legal' },
  { path: '/admin?tab=personas' },
  { path: '/admin?tab=directory' },
  { path: '/admin?tab=promos' },
  { path: '/admin?tab=payments' },
  { path: '/admin?tab=bank-accounts' },
  { path: '/admin?tab=product-testing' },
  { path: '/admin?tab=billing' },
  { path: '/admin?tab=wellbeing' },
  { path: '/admin?tab=network-profiles' },
  { path: '/admin?tab=integration-keys' },
  { path: '/admin?tab=github' },
]);

/**
 * D1160 (#3067): addresses that forward one role and stay a page for another.
 * `/funds` and `/funds/performance` forward an admin to Fund administration
 * and remain an investor's pages, so the address-bar beacon skips them; the
 * forward itself (`FundOpsRedirect`) sends the key, counted until #2319.
 * D1243 (#3256): `/pipeline` forwards an investor to Deal flow's table and
 * stays the partner's bucket and the founder's and an admin's board; its
 * forward (`DealsPipelineRedirect`) sends the key.
 */
export const ROLE_REDIRECTS: readonly (RedirectRoute & { role: 'admin' | 'investor' })[] = Object.freeze([
  { path: '/funds', role: 'admin' },
  { path: '/funds/performance', role: 'admin' },
  { path: '/pipeline', role: 'investor' },
]);

/**
 * D1109 (#2989, part 8 of #2456): the Data room's old addresses. Each forward
 * counts itself (`DataRoomMovedRedirect`), because the address bar cannot:
 * `/raise/data-room` is the tool's Home and only its `?mode=` forwards, and
 * `/raise/data-room/:id` shares its shape with the tool's tab words
 * (`/files`, `/access`, …), which are pages. A file's number forwards; a tab word never does.
 */
export const FORWARD_REDIRECTS: readonly (RedirectRoute & { forward: true })[] = Object.freeze([
  { path: '/raise/data-room?mode=workspace', forward: true },
  { path: '/raise/data-room?mode=access', forward: true },
  { path: '/raise/data-room/:id', forward: true },
  // D1180 (#3107): the retired Capital workspace's default tab (the financial model); `/raise/capital` itself is a page.
  { path: '/raise/capital?mode=workspace', forward: true },
]);

export const REDIRECT_ROUTES: readonly RedirectRoute[] = Object.freeze([
  { path: '/messages' }, // D1345: retired inbox → Email (EM10).
  { path: '/for-mentors' },
  { path: '/pricing/investor' },
  { path: '/settings', keep: true },
  // D1140 (#3020): Company Settings moved under Companies and projects. No sent mail carries it, so its count decides.
  { path: '/company-settings' },
  { path: '/settings/:section', keep: true },
  { path: '/dashboard' },
  { path: '/product-testing', keep: true }, // #2314: historical member notifications
  { path: '/onboarding/licence' },
  { path: '/build/deck' },
  { path: '/raise/pitch/positioning' }, // D911: Investor narrative › Positioning
  { path: '/build/deck-reviewer' },
  { path: '/validate/customer-research/new' },
  { path: '/validate/interviews' },
  { path: '/validate/interviews/:id' },
  { path: '/validate/experiments-and-evidence' },
  { path: '/validate/experiments-and-evidence/:id' },
  { path: '/validate/demand-and-urgency-signals' },
  { path: '/validate/demand-and-urgency-signals/:id' },
  { path: '/validate/pain-map' },
  { path: '/validate/hypotheses' },
  { path: '/customer-discovery' },
  { path: '/signals' },
  { path: '/marketplace' },
  { path: '/branch' },
  { path: '/hq/credits' },
  { path: '/admin/news' },
  { path: '/news' },
  { path: '/articles/mine' },
  { path: '/insights' }, // #2333: the briefs are a section of /articles
  { path: '/advisory' }, // #2341: Team › Advisors
  { path: '/projects' },
  { path: '/build/tools' },
  { path: '/incorporate/83b' },
  { path: '/wellbeing/expert-dashboard' },
  { path: '/partners' },
  { path: '/notifications', keep: true },
  { path: '/notifications/*', keep: true },
  { path: '/help/:id', keep: true }, // sent Slack CTAs carry `/help/<id>` (tickets.ts)
  { path: '/tickets' },
  { path: '/tickets/:id', keep: true },
  { path: '/support', keep: true },
  { path: '/plans-and-pricing', keep: true },
  { path: '/plans-and-pricing/:productId' },
  { path: '/products' },
  { path: '/products/:productId' },
  { path: '/market-intel' },
  { path: '/grow/updates' },
  { path: '/grow/capital-match' }, // D1194: → /raise/capital-relationships/match?moved=match
  { path: '/raise/capital-match' }, // D1194: → /raise/capital-relationships/match?moved=match
  { path: '/raise/capital/pipeline' }, // D1194: → /raise/capital-relationships/pipeline?moved=pipeline
  { path: '/deals/pipeline' }, // D1243 (#3256): the Pipeline zone retired → /deals?view=table, query kept
  { path: '/grow/brand' }, // #2343: Grow's Brand page folded into /build/brand
  { path: '/build/discovery' }, // #2335: → Validate · Customer research
  { path: '/build/metrics' }, // #2336: → /build/kpi
  { path: '/build/financials' }, // #2339; D1178: → /raise/use-of-funds/runway/forecast
  { path: '/raise/capital/model' }, // D1178 (#3105): → /raise/use-of-funds/runway/forecast?moved=capital-model
  { path: '/build/captable' }, // #2340, D1029: → /raise/cap-table
  { path: '/raise/capital/cap-table' }, // D1029: → /raise/cap-table?moved=cap-table
  { path: '/raise/cap-table/variants' }, // D1029: → /raise/cap-table/scenarios?moved=variants
  { path: '/raise/cap-table/variants/:variant' }, // D1029: → /raise/cap-table/scenarios/:variant
  { path: '/build/command-center' },
  { path: '/mentors' },
  { path: '/office-hours' },
  { path: '/skills' },
  { path: '/values' },
  { path: '/funds/capital-calls' },
  { path: '/lp-portal' },
  { path: '/funds/lp-workspace' },
  { path: '/advisor/network' },
  { path: '/advisor/network/introductions' },
  { path: '/advisor/network/relationships' },
  { path: '/advisor/network/organizations' },
  { path: '/practice/deliverables' },
  { path: '/practice/session-types' },
  { path: '/practice/booking-links' },
  { path: '/practice/access-log' },
  { path: '/advisor/advisory' },
  { path: '/advisor/advisory/opportunities' },
  { path: '/advisor/advisory/engagements' },
  { path: '/advisor/advisory/delivery' },
  { path: '/advisor/research' },
  { path: '/advisor/research/market' },
  { path: '/partner/operations' },
  { path: '/partner/operations/overview' },
  { path: '/partner/operations/capabilities' },
  { path: '/partner/operations/portfolio' },
  { path: '/partner/operations/engagements' },
  { path: '/partner/operations/performance' },
  { path: '/pipeline/screening' },
  { path: '/pipeline/commit' },
  { path: '/pipeline/transactions' },
  { path: '/contacts' },
  { path: '/raise/calls' },
  { path: '/raise/calls/:uid' }, // D1227 (#3226): one call, now /raise/capital-relationships/calls/:uid
  { path: '/account/developer' }, // D1315 (#2418): Account › Developer, now /account/builder
  { path: '/account/developer/*' }, // D1315 (#2418): its pages and drawers, now under /account/builder
  { path: '/refer' },
  { path: '/integrations', keep: true }, // every provider's OAuth sign-in returns here
  { path: '/account/integrations' },
  { path: '/payouts' },
  { path: '/relationships' },
  { path: '/partner-portal' },
  { path: '/partners/portal' }, // #2342
  { path: '/portfolio/coverage' }, // #2337
  { path: '/needs' }, // #2338
  { path: '/services' }, // #2338
  { path: '/founder/post-need' }, // #2338
  { path: '/partner/needs' }, // #2338
  { path: '/docs' },
  { path: '/communities' },
  { path: '/network-effects' }, // #2324: the page is removed (#2297 §3); it lands on Network
  // #2321 — the older audience landing pages, forwarded to the door pages.
  { path: '/lp/founder' },
  { path: '/lp/customer-discovery' },
  { path: '/lp/investor' },
  { path: '/lp/partner' },
  { path: '/legal-capital' }, // #2354: the page is removed (#2297 §3); it lands on Raise › Legal
  { path: '/cofounder' }, // #2355: the page is removed (#2297 §3); it lands on Co-founder Match
  { path: '/admin/held/insights' }, // D893 (#2366): Insights moved to /admin/insights
  { path: '/admin/partners' }, // D923 (#2370): Partner invitations moved to /admin/partner-invitations
  { path: '/admin/held/community' }, // D930 (#2367): Community moved to /admin/community
  { path: '/admin/held/programs' }, // D953 (#2371): Programs moved to /admin/programs
  { path: '/admin/held/approvals' }, // D1038 (#2390): Approvals moved to /admin/approvals
  { path: '/admin/held/accounts' }, // D941 (#2746): Accounts moved to /admin/accounts
  { path: '/admin/advisor-cohorts' }, // D953 (#2371): now Programs › Mentor cohort access › People
  { path: '/admin/refer-earn' }, // D953 (#2371): now Programs › Refer & Earn › Queue
  { path: '/admin/spinout-lab', keep: true }, // D937 (#2374): the Lab moved under Programs; sent cohort notices carry it (#2375)
  { path: '/admin/spinout-lab/preview' }, // D937 (#2374): the preview moved with the Lab
  { path: '/admin/network-profiles' }, // D972 (#2369): the roster is Advisors & Partners › Deck roster
  { path: '/admin/partner-invitations/firm-links' }, // D952 (#2728): Firm links moved to Advisors & Partners › Firms
  ...ADMIN_TAB_REDIRECTS,
  ...ROLE_REDIRECTS,
  ...FORWARD_REDIRECTS,
  { path: '/admin', keep: true }, // D938 (#2743): the Admin Console is retired; every ?tab= forwards to its own page (#2375 keeps /admin)

]);

/** The key a hit is counted under in `public_pageviews.path`. */
export function redirectKey(path: string): string {
  return `redirect:${path}`;
}

const KEYS = new Set(REDIRECT_ROUTES.map((r) => redirectKey(r.path)));

/** Whether a beacon's `path` is one of the redirect keys, and nothing else. */
export function isRedirectKey(value: string): boolean {
  return KEYS.has(value);
}
