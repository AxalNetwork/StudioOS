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
| `BranchApprovals.jsx` | Canvas S3 at `/branch/approvals`: the work board over the four local queues, oldest first with SLA bands (D130), **and** the outbound To-HQ lane (D112). The board READS — every decision is still made in that queue's own console — and spinout moderation's row says it has no console, because none exists. Assignment, history and the AI decision note do not ship; the rail names each. |
| `BranchHome.jsx` | Canvas S1 at `/branch` (D131): queue pressure over the four local queues ordered by the **oldest item** rather than by count, the programme clock with the zone its deadlines are enforced in, and the revenue-share rate. The AI digest, the rail's anomaly flags and a local territory clock have no source; the rail names each with its reason. Wraps itself in `BranchZone`. |
| `BranchAccounts.jsx` | Canvas S2 at `/branch/accounts`, plus the half of S8 that is true (D129): seat tiles with used, licensed and free per licence type; the members table searched over this deployment's own D1; the Exploring count. S8's seat **ledger** does not ship — D127 settled that seats used is a definition over `users.role`, so no seat has an id to assign or release. Wraps itself in `BranchZone`. |

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
- **A notice states a fact about the platform, so it expires.** The
  `/branch/accounts` notice said seats used could not be shown because the seat
  store did not exist; D127 made that false and the notice outlived it by one
  merge. `frontend/test/branch_accounts_s2.test.mjs` refuses the retired
  sentence anywhere under `frontend/src`, the same way `founderZoneFilters.js`
  refuses `NO_VERDICT_SNAPSHOT`. When a `will=` promises a store, the PR that
  decides not to build it deletes the promise too. `/branch`'s notice promised
  all six of S1's blocks; three of them have no source and one cannot get one,
  so D131 shipped the three that are real and moved the rest into the rail with
  their reasons, where a reader meets a fact instead of a schedule.
- **A time a person is held to carries the zone it is enforced in.** The cohort
  programme runs on `COHORT_TZ` — America/New_York — for every territory, and a
  branch admin reads the screen somewhere else. `BranchHome`'s `inZone` takes
  the zone as a **required** argument for that reason: a formatter that fell
  back to the reader's zone would print the wrong hour rather than no hour, and
  wrong is the only one of those a deadline cannot survive.
