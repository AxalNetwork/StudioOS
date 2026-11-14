## The Workspaces launcher's 28 pages, placed in the profile sidebars (D563)

The admin shells' Workspaces launcher (D284) is gone. Each of its 26 pages
(28 until D670 retired Market Intelligence and Signals) keeps its route and now lights the profile sidebar row that owns it, and that
row's overview links it under "Also in". The mapping is `PAGE_HOMES` in
`frontend/src/lib/adminPlacement.js`; `frontend/test/workspaces_retired_d563.test.mjs`
checks each line against the route's guard and the row's `match`. An admin
reaches them through View As and the command palette.

| Page | Guard (App.jsx) | Home | How |
| --- | --- | --- | --- |
| `/pipeline` | admin, founder, partner, investor | partner Pipeline | the row itself |
| `/scoring` | Lab + admin, partner, investor | investor Deals | `match` + Also in **Removed (owner, 2026-10-20).** |
| `/portfolio/risk-matrix` | admin, partner, investor | investor Portfolio | already under `/portfolio`; Also in **Removed (owner, 2026-10-20).** |
| `/advisory` (retired D2319) | admin, founder | founder Validate | `match` + Also in **Removed (owner, 2026-10-21, #2341); the address forwards to `/build/team?mode=workspace&tab=advisors`.** |
| `/deals` | admin, partner, investor | investor Deals | the row itself |
| `/capital` | admin, investor | investor Portfolio | `match` + Also in **Removed (owner, 2026-10-20).** |
| `/liquidity` | admin, founder, partner, investor | investor Portfolio | `match` + Also in. **A founder is redirected** to `/raise/liquidity?mode=workspace`, the same `LiquidityPage` inside Raise **Removed (owner, 2026-10-20).** |
| `/portfolio/health` | admin, founder, partner, investor | investor Portfolio | the overview's alias |
| `/portfolio/coverage` (retired D2319) | admin, partner | partner Delivery | `match` + Also in **Removed (owner, 2026-10-21, #2337); forwards to `/delivery/health`.** |
| `/portfolio/reserves` | admin, investor | investor Portfolio | already under `/portfolio`; Also in **Removed (owner, 2026-10-20).** |
| `/portfolio/waterfall` | admin, investor | investor Portfolio | already under `/portfolio`; Also in |
| `/watchlist` | admin, partner, investor | investor Portfolio | `match` + Also in **Removed (owner, 2026-10-20).** |
| `/legal-capital` (retired D2319) | admin, founder, partner, investor | founder Raise | `match` + Also in **Removed (#2354, #2297 §3): the address redirects to `/raise/legal`.** |
| `/incorporate` | Lab + admin, founder, partner, investor | founder Raise | `match` + Also in |
| `/compliance` (retired D2319) | Lab + admin, founder, partner | founder Raise | `match` + Also in **Moved (D1384, #3692): the address redirects to `/calendar?layer=compliance`, the Calendar's Compliance layer; no record moved.** |
| `/network` | admin, founder, partner, investor, advisor | every profile's Network | the row itself |
| `/network-effects` (retired D2319) | admin, founder, partner, investor | founder Grow | `match` + Also in **Removed (#2324, #2297 §3): the address redirects to `/network`.** |
| `/my/jobs` | admin, founder, partner, investor, advisor; a founder is redirected (unchanged) | partner and advisor Network | `match` + Also in |
| `/services` (retired D2319) | admin, founder, partner, investor; a founder is redirected (unchanged) | partner Offers | `match` + Also in **Removed (owner, 2026-10-21, #2338); forwards to `/offers/catalog`, a founder to `/build/marketplace?tab=services`.** |
| `/needs` (retired D2319) | admin, founder, partner, investor; a founder is redirected (unchanged) | partner Pipeline | `match` + Also in **Removed (owner, 2026-10-21, #2338); forwards to `/pipeline/leads`, a founder to `/build/marketplace?tab=needs`.** |
| `/partner/insights` | admin, partner (the investor's access was removed, owner, #2297) | partner Pipeline | `match` + Also in |
| `/partner/office-hours` | admin, partner | partner Offers | `match` + Also in |
| `/comarketing` | admin, partner, founder, investor | partner Offers; founder Grow | `match` + Also in |
| `/incorporate/cofounder-agreement` | Lab + admin, founder, partner | founder Raise | under `/incorporate`; Also in |
| `/spinout-lab/83b` | Lab + admin | founder Spin-Out Lab | `match`; the Lab's arsenal links it |
| `/perks` | admin, founder, partner, investor, advisor, exploring | founder Grow | `match` + Also in; a partner is redirected to `/offers/perk-deals` (unchanged) |

