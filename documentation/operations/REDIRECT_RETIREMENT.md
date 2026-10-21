# Retiring the SPA's internal redirects (#2301)

The owner ticked "the internal redirects (§12), after 90 days" on #2297 on
2026-10-21. This runbook is how that is done on **2027-01-19**.

## What is counted, and how

- **The list.** `cloudflare-worker/src/services/redirectRoutes.ts` holds every
  `<Route>` in `frontend/src/App.jsx` whose element only ever forwards to
  another address. `frontend/test/redirect_hits_2301.test.mjs` reads App.jsx
  and fails if the two drift apart, so a new redirect, or one turned into a
  page, cannot go uncounted.
  - It held 84 patterns when it was written (#2303). That is more than #2297
    §12's "51", which names 44 and ends "and others"; the list is what the
    code holds.
  - A page that #2297 removes joins the list when its old address is kept as
    a redirect, so bookmarks still land and the hits are counted with the
    rest: `/network-effects` (#2324) lands on `/network`, the four older
    `/lp/*` landing pages (#2321) land on their door pages, `/legal-capital`
    (#2354) lands on `/raise/legal`, and `/cofounder` (#2355) lands on
    `/spinout-lab/cofounder-match`.
  - A route that redirects some roles and renders a page for others is a page
    and is not listed. `/raise/data-room`, which §12 names, is one: founders
    open the Data room there.
- **Keep.** Entries marked `keep` stay whatever their count: the addresses an
  email or an external link can carry (#2297 §12: `/settings`,
  `/settings/:section`, `/notifications`, `/notifications/*`, `/tickets/:id`,
  `/support`, `/plans-and-pricing`), plus `/help/:id`, which ticket Slack
  messages already sent carry, and `/integrations`, where every provider's
  sign-in returns.
- **The count.** A redirect runs in the browser, and the Worker serves the SPA
  shell without running, so no Worker log sees the old address.
  - The router shell (`useRedirectBeacon` in `frontend/src/lib/redirectBeacon.js`)
    sends one first-party beacon each time a listed address is opened.
  - `POST /api/public/analytics/pageview` counts it in `public_pageviews` as
    `redirect:<pattern>`, by day, only for a pattern on the list.
  - Path only: the pattern, never the visited ids, query or hash, and no IP,
    user agent or cookie.

## On 2027-01-19

1. **Read the last 30 days.**

   ```sh
   npx wrangler d1 execute studioos-db --remote --env production --command \
     "SELECT path, SUM(views) AS hits FROM public_pageviews
       WHERE path LIKE 'redirect:%' AND day >= date('now', '-30 days')
       GROUP BY path ORDER BY hits DESC"
   ```

   A pattern that is not in the result had no hits.
2. **Remove** every listed redirect that is not `keep` and had no hits: its
   `<Route>` in App.jsx, its `*Redirect` component if nothing else uses it,
   its entry in `redirectRoutes.ts`, and the tests that pin it.
3. **List the rest on #2301** with their counts, for the owner to decide.
4. **Add the guard test** (#2301 step 3): every removed address must stay
   absent from App.jsx's routes and from every in-app link, so it cannot come
   back as a dead link.
5. Close #2301 with that PR (`Closes #2301`).
