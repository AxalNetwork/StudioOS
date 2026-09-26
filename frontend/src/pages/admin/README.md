# pages/admin — the admin console

Screens under `/admin` and `/admin/*`, plus the tabs `AdminPage.jsx` composes.
Everything here is gated to the `admin` role in `App.jsx`; the guard is on the
route, not in the component.

`AdminStudioHome.jsx` is the admin profile's `/studio` landing (rendered by
`Dashboard` when the active role is admin). It is Eadwyn, then
`StudioPosture.jsx` (the admin bank on record), `StudioNeedsDecision.jsx` (four
link tiles, worst first), then `AdminStudioOverview.jsx`: one card per other
Admin page. All three read their figures and the one `UNAVAILABLE` sentinel
from `adminStudioOverview.js` (D246). It is not an `/admin/*` route.

Roughly grouped by what they administer: accounts and roles, the Spin-Out Lab
cohort (applications, timing, journey preview), content (articles, publications,
templates), the network (profiles, partners, referrals), and integrations
(Telegram, X).

`HeldZone.jsx` and the five `Held*.jsx` landings are the Admin shell on
accounts HQ holds directly (canvas S20, D286): `HeldAccounts.jsx` (embeds the
console's Users panel; links Exploring, Personas, Trash), `HeldApprovals.jsx`
(S22's sixteen lanes as literal rows), `HeldPrograms.jsx`, `HeldCommunity.jsx`
and `HeldInsights.jsx` (links nowhere, by S20). Mounted at `/admin/held/*` —
a prefix of their own so none can collide with an HQ console such as
`/admin/accounts`. Every console link on them is literal, because
`frontend/test/admin_route_reachability.test.mjs` reads navigation syntax,
and `HeldZone` carries the always-visible scope sentence and the shell's one
Worker AI rail mount.

`assessment/` holds the assessment game editor — see its own README.

## Rules

- **The route guard is the boundary.** A component here assumes an admin caller;
  the worker re-checks anyway, and must.
- Impersonation ("View As") is audited server-side. A surface that impersonates
  without leaving a trail is a bug, not a convenience.
- Being admin-only is not a reason to invent data. These screens show real rows
  or say the list is empty.
