# pages/admin — the admin console

Screens under `/admin` and `/admin/*`, plus the tabs `AdminPage.jsx` composes.
Everything here is gated to the `admin` role in `App.jsx`; the guard is on the
route, not in the component.

`AdminStudioHome.jsx` is the admin profile's `/studio` landing (rendered by
`Dashboard` when the active role is admin). It is Eadwyn, then
`AdminStudioOverview.jsx`: one card per other Admin page. It is not an
`/admin/*` route.

Roughly grouped by what they administer: accounts and roles, the Spin-Out Lab
cohort (applications, timing, journey preview), content (articles, publications,
templates), the network (profiles, partners, referrals), and integrations
(Telegram, X).

`assessment/` holds the assessment game editor — see its own README.

## Rules

- **The route guard is the boundary.** A component here assumes an admin caller;
  the worker re-checks anyway, and must.
- Impersonation ("View As") is audited server-side. A surface that impersonates
  without leaving a trail is a bug, not a convenience.
- Being admin-only is not a reason to invent data. These screens show real rows
  or say the list is empty.
