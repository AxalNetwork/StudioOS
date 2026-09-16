# pages/branch — the subsidiary tier's eight rows

What a branch administrator sees on their own deployment. A branch runs the
same code as HQ under its own name, on its own host, over its own database
(D.2), so nothing here narrows a global view — there is no global view
underneath to narrow. Every route is `guard(['admin'], …)` in `App.jsx` and the
worker re-checks on every call regardless; the shell arm that paints these
screens steel rather than violet is `shellRoleFor` → `branch_admin` (D107),
which names a sidebar and never a permission.

| File | What it is |
| --- | --- |
| `BranchZone.jsx` | The frame every `/branch/*` route renders in, and the branch tier's **one** Worker AI rail mount (D126). It owns the two-column layout, the rail column that collapses with the rail, and the sentence saying this rail reads one database. |
| `BranchZonePending.jsx` | The stated absence on a row whose artboard is not built yet (D107): which artboard, what will be on it, which PR brings it. A **card**, not a page — `BranchApprovals` renders it inside itself. |
| `BranchApprovals.jsx` | Canvas S3 at `/branch/approvals`, the outbound lane only (D112): raise an escalation to HQ, and read the one decision that comes back. The four local queues are PR 13 and say so. It wraps itself in `BranchZone` because it loads live data and only it knows what its rail can report. |

## Rules

- **One rail mount for the whole tier.** It lives in `BranchZone.jsx` and
  nowhere else, and `frontend/test/branch_rail_mount.test.mjs` fails the build
  if a second appears. Eight routes each building their own layout is how the
  HQ tier ended up with five copies of one grid, three of which then drifted
  into passing props `WorkerRail` does not declare.
- **A rail column reads `var(--fwr-track, 280px)`**, never a hardcoded width.
  `workerRail.css` sets that variable to `44px` when the reader collapses the
  rail; a literal cannot follow it and leaves a hole.
- **A zone with data owns its frame; a zone without takes it from the route.**
  Coverage is what un-disables the rail's one button, and only the page that
  loaded something knows what it holds. Each of the seven wrappers in `App.jsx`
  goes away on the day its zone gets a page.
- **A row is added with its route, never before it.** `sidebarConfig.js` states
  the rule: a row pointing at a route that does not exist looks shipped and
  404s. All eight branch rows have routes; the ones without artboards land on
  `BranchZonePending`.
