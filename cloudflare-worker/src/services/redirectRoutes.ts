/**
 * #2301 — the SPA's redirect-only routes, counted before they are retired.
 *
 * Each entry is a `<Route path>` in `frontend/src/App.jsx` whose element always
 * forwards to another address (a `<Navigate>` or a `*Redirect` component, with
 * or without a role guard), never a page. Routes that redirect for some roles
 * and render a page for others (`/raise/data-room`, `/build`, …) are
 * not here: they are pages. `frontend/test/redirect_hits_2301.test.mjs` reads
 * App.jsx and fails if this list and the routes drift apart.
 *
 * WHY A LIST. A redirect runs in the browser: the Worker serves the SPA shell
 * from `[assets]` without running, so no Worker log line sees the old address.
 * The SPA sends one first-party beacon when an address here is opened
 * (`lib/redirectBeacon.js`), and `POST /api/public/analytics/pageview` counts
 * it as `redirect:<pattern>` in `public_pageviews` — only for a pattern on this
 * list, so the beacon cannot write any other key. Path only: no IP, user agent
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
export interface RedirectRoute { path: string; keep?: true }

export const REDIRECT_ROUTES: readonly RedirectRoute[] = Object.freeze([
  { path: '/for-mentors' },
  { path: '/pricing/investor' },
  { path: '/settings', keep: true },
  { path: '/settings/:section', keep: true },
  { path: '/dashboard' },
  { path: '/product-testing', keep: true }, // #2314: historical member notifications
  { path: '/onboarding/licence' },
  { path: '/build/deck' },
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
  { path: '/grow/capital-match' },
  { path: '/grow/brand' }, // #2343: Grow's Brand page folded into /build/brand
  { path: '/build/discovery' }, // #2335: → Validate · Customer research
  { path: '/build/metrics' }, // #2336: → /build/kpi
  { path: '/build/financials' }, // #2339: → /raise/capital/model
  { path: '/build/captable' }, // #2340: → /raise/capital/cap-table
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
