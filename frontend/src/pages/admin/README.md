# pages/admin — the admin console

Screens under `/admin` and `/admin/*`, plus the tabs `AdminPage.jsx` composes.
Since D648 each of those tabs is its own component under `consoles/` (see its
README), loading only its own data; `AdminPage.jsx` is the shell that mounts
the chosen one.
Everything here is gated to the `admin` role in `App.jsx`; the guard is on the
route, not in the component.

`AdminStudioHome.jsx` is the admin profile's `/studio` landing (rendered by
`Dashboard` when the active role is admin). It is Eadwyn, then
`StudioPosture.jsx` (the admin bank on record), `StudioNeedsDecision.jsx` (four
link tiles, worst first), then `AdminStudioOverview.jsx`: one card per other
Admin page. All three read their figures and the one `UNAVAILABLE` sentinel
from `adminStudioOverview.js` (D246). The strip and the cards also read
`GET /api/admin/studio/glance` (D443, corrected by D447), which answers on both
tiers. Until that glance arrives the first paint says it is reading, and a
glance that is already in hand is not passed through the legacy props.
`AdminStudioHome.jsx` does not call that route yet. It is not an `/admin/*` route.

Roughly grouped by what they administer: accounts and roles, the Spin-Out Lab
cohort (applications, timing, journey preview, and `SpinoutModerationPage.jsx`
at `/admin/spinout-moderation`, which lists cases awaiting a decision apart
from sanctions in force, D448), content (articles, publications,
templates), the network (profiles, partners, referrals), and integrations
(Telegram, X). On `/admin/telegram`, `TelegramBotHealth.jsx` (words in
`telegramBotHealth.js`) shows Super Admins the Telegram Business interview
bot's health from `GET /api/admin/channels/telegram/webhook`, above the news
bot's tabs (D756).

The AI rail (D775, #2101). Every screen here that is a Super Admin board sits in
`RailFrame` with `WorkerRail`, as `contracts/ContractsDesk.jsx` does. Where a
plain admin also reaches the screen, the rail takes the viewer's tier.
`PublicationsFrame.jsx` is the one frame the three Publications routes share,
because they are one board. Which board each screen is, and the options it
offers, are listed in `frontend/src/lib/railOptions/superAdmin.js`.
A record view names its record as the rail's last crumb with
`useRecordCrumb.js` (D768's contract, as a hook).

`HeldZone.jsx` and the five `Held*.jsx` landings are the Admin shell on
accounts HQ holds directly (canvas S20, D286): `HeldAccounts.jsx` (embeds the
console's Users panel; links Exploring, Personas, Trash), `HeldApprovals.jsx`
(S22's sixteen lanes as literal rows), `HeldPrograms.jsx`, `HeldCommunity.jsx`
and `HeldInsights.jsx` (links nowhere, by S20). Since D555 each reads HQ's own
figures from the Studio glance through `heldFigures.jsx` (`useHeldGlance`,
`Figure`, `laneOf`): lane counts on Approvals, counts on the cards, and the
headline figures on Insights. Mounted at `/admin/held/*` —
a prefix of their own so none can collide with an HQ console such as
`/admin/accounts`. Every console link on them is literal, because
`frontend/test/admin_route_reachability.test.mjs` reads navigation syntax,
and `HeldZone` carries the always-visible scope sentence and the shell's one
Worker AI rail mount.

`AdminBoardFrame.jsx` is the rail on the Admin boards that drew none (D774,
#2100): each wraps its whole page in it, named for its board, and the rail
takes the viewer's tier (HQ's for a Super Admin, the admin's otherwise; none
outside the admin tier). `../../lib/railOptions/admin.js` lists the Admin's
boards, S1–S39, with the file that mounts each one's rail.

`AdminCommissions.jsx` is `/admin/commissions` (D569, D572): the commission
rules (edited through D572's route, never created), every commission, the payout queue with
its confirmed process actions, and the HQ take rate for the super admin. It is
reached from the referral review console (`ReferralReview.jsx`) and shares
its drawing pieces with the partner earnings screens (`parts.jsx`).

`assessment/` holds the assessment game editor — see its own README.

`fundAdmin/` is D714's fund administration console at `/admin/fund-admin`, for
the Super Admin and every Admin on HQ: capital calls, distributions,
management fees, reconciliation, bank accounts and LP reports, each control
drawn from the Worker's act table — see its own README.

`contracts/` owns the D647 desk, counted agreement pages, related lists,
signing detail and guided envelope panel. Both shells reach `/admin/contracts`.

## Rules

- **The route guard is the boundary.** A component here assumes an admin caller;
  the worker re-checks anyway, and must.
- Impersonation ("View As") is audited server-side. A surface that impersonates
  without leaving a trail is a bug, not a convenience.
- Being admin-only is not a reason to invent data. These screens show real rows
  or say the list is empty.

D647: `LegacyContractsRedirect.jsx` sends `/admin?tab=legal` to `/admin/contracts?moved=legal` before the console mounts, preserving other console sections.
