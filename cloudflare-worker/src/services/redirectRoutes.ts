/**
 * #2301 — surviving SPA redirects after D2319 (#4415) retires zero-open aliases.
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
export const ROLE_REDIRECTS: readonly (RedirectRoute & { role: 'admin' | 'investor' | 'founder' })[] = Object.freeze([
  { path: '/funds', role: 'admin' },
  { path: '/funds/performance', role: 'admin' },
  { path: '/pipeline', role: 'investor' },
  // D4439: only founders forward; partner visits stay pageviews.
  { path: '/comarketing', role: 'founder' },
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
  { path: '/settings', keep: true },
  { path: '/settings/:section', keep: true },
  { path: '/dashboard', keep: true },
  { path: '/product-testing', keep: true }, // #2314: historical member notifications
  // D4254 (#4254): Pitch's old addresses. The Worker's Raise links still name /raise/pitch-deck, so it is kept.
  { path: '/raise/pitch-deck', keep: true },
  { path: '/insights' }, // #2333: the briefs are a section of /articles
  { path: '/wellbeing/expert-dashboard', keep: true },
  { path: '/notifications', keep: true },
  { path: '/notifications/*', keep: true },
  { path: '/help/:id', keep: true }, // sent Slack CTAs carry `/help/<id>` (tickets.ts)
  { path: '/tickets/:id', keep: true },
  { path: '/support', keep: true },
  { path: '/plans-and-pricing', keep: true },
  { path: '/raise/capital/cap-table' }, // D1029: → /raise/cap-table?moved=cap-table
  { path: '/lp-portal' },
  { path: '/refer', keep: true },
  { path: '/integrations', keep: true }, // every provider's OAuth sign-in returns here
  // #2321 — the older audience landing pages, forwarded to the door pages.
  { path: '/lp/founder', keep: true },
  { path: '/lp/customer-discovery', keep: true },
  { path: '/lp/investor', keep: true },
  { path: '/lp/partner', keep: true },
  { path: '/admin/spinout-lab', keep: true }, // D937 (#2374): the Lab moved under Programs; sent cohort notices carry it (#2375)
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
