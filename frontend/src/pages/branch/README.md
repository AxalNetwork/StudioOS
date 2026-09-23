# pages/branch — the subsidiary tier's pages

What a branch administrator sees on their own deployment, besides Studio.
The sidebar's first row is Studio at `/studio` (`AdminStudioHome.jsx`),
not the digest. `/branch` is still this folder's Home — the operating digest —
and it is no longer a sidebar row. A branch runs the
same code as HQ under its own name, on its own host, over its own database
(D.2), so nothing here narrows a global view — there is no global view
underneath to narrow. Every route is `guard(['admin'], …)` in `App.jsx` and the
worker re-checks on every call regardless; the shell arm that paints these
screens steel rather than violet is `shellRoleFor` → `branch_admin` (D107),
which names a sidebar and never a permission.

| File | What it is |
| --- | --- |
| `BranchZone.jsx` | The frame every `/branch/*` route renders in, and the branch tier's **one** Worker AI rail mount (D126). It owns the two-column layout, the rail column that collapses with the rail, and the sentence saying this rail reads one database. |
| `BranchSettings.jsx` | Canvas S11 at `/branch/settings` (D155): who owns each of the five settings rows, with the request path on the HQ-owned ones instead of a disabled field. **The canvas is wrong about two of them and the page says so:** the subsidiary name is HQ's twice over (`BRANCH_NAME` is a Worker var set at provisioning, and nothing in the worker writes `branch_licence`, so an edit would need a redeploy or be overwritten by HQ's next push), and a role cannot be changed from a branch at all (`admin_promotion_disabled` refuses everyone but the super admin, and a branch has none under D106). What the branch genuinely owns on that row — deactivating a non-admin account — is what its link goes to. **Since D209 it also carries S14, "This deployment"** (`DeploymentZone`), from `GET /api/branch/deployment`: this Worker's identity and resources, its one binding to HQ and both RPC sides, what it writes to the shared dataset and whether it can read it back, and a cannot-list checked on the deployment rather than recited — a refusal that has stopped holding is drawn in amber with its reason. Its summary line and analytics heading are derived from the payload, never typed. Wraps itself in `BranchZone`. |
| `BranchApprovals.jsx` | Canvas S3 at `/branch/approvals`: the work board over the four local queues, oldest first with SLA bands (D130), **and** the outbound To-HQ lane (D112). The board READS — every decision is still made in that queue's own console — and spinout moderation's row says it has no console, because none exists. Assignment, history and the AI decision note do not ship; the rail names each. The raise form offers only the kinds the licence allows (D206): on a white-label, `content` is a hidden row carrying the server's reason and no control. |
| `BranchHome.jsx` | Canvas S1 at `/branch` (D131): queue pressure over the four local queues ordered by the **oldest item** rather than by count, the programme clock with the zone its deadlines are enforced in, and the revenue-share rate. The AI digest, the rail's anomaly flags and a local territory clock have no source; the rail names each with its reason. Wraps itself in `BranchZone`. |
| `BranchAccounts.jsx` | Canvas S2 at `/branch/accounts`, plus the half of S8 that is true (D129): seat tiles with used, licensed and free per licence type; the members table searched over this deployment's own D1; the Exploring count. S8's seat **ledger** does not ship — D127 settled that seats used is a definition over `users.role`, so no seat has an id to assign or release. Wraps itself in `BranchZone`. |
| `BranchPrograms.jsx` | Canvas S4 at `/branch/programs` (D140): the cohort calendar as the platform **derives** it, what this territory decides about a company's week, and the assessment games running under it. It draws no date control, because there is no `UPDATE week_windows` anywhere and every `UPDATE cohort_cycles` touches status rather than `start_at`/`end_at` — the calendar is read here, not set. Individual assessment runs are not listed: the worker has no `GET /sessions` and no `GET /results`. Wraps itself in `BranchZone`. |
| `BranchCommunity.jsx` | Canvas S4's second half at `/branch/community` (D140): an **index** over four consoles that already exist and are already branch-reachable — events, the job board, circles and network profiles carry zero `requireHqAuthoring` between them. Each card says what its console can actually do, because three of the four are narrower than their names: jobs is moderation only, events cannot author an event, and network profiles is **not a member directory**. It fetches nothing, so no count here can disagree with the console one click away. |
| `BranchContracts.jsx` | Canvas S5 + S10 at `/branch/contracts` (D147): HQ's master template library as **the copy HQ pushed**, with HQ's own `pushed_at` as the age on screen rather than this database's write time. Three read states, not two — unreadable, never pushed, and pushed-but-empty — because an empty list standing in for all three is D107's `licence_not_pushed` defect again. There is **no edit control at all**: D.9 puts authoring at HQ and a greyed pencil would be the `still_an_admin` mistake, so the page states what changing a template is instead. What the copy leaves at HQ (the document bodies, and an archived-version state HQ's own library cannot produce) is read off the payload, never typed here. Active contracts states its gap with the cause D199 corrected: this branch's contracts are rows in its own database (e-sign envelopes, documents, mutual NDAs, partner deals), not in HQ's `licence_contracts`, which holds only the licence agreement — what is missing is a screen that tables them and, for envelopes, a value and a renewal date. |
| `BranchInsights.jsx` | Canvas S6 at `/branch/insights` (D148): the two stats this territory can count — accounts and seats used, on `branchOverview`'s own definition so the RPC figure and the screen cannot disagree — and **one tick against the anonymised platform median, never a rank**. The `n` is rendered beside every median because a median without its denominator implies a population the screen does not know. Activation, programme throughput and revenue share are named as absences with the SERVER's reasons: the first two have no branch-side read at all, and the third is knowable as a rate and not as an amount. With no branch provisioned HQ publishes nothing, so the benchmark block states that — three read states, never one empty list for all of them. |
| `BranchAnalytics.jsx` | Canvas S15 at `/branch/insights/analytics` (D210), reached from Insights by a literal link and lit under its row: active accounts per week from this branch's own request log, under the one definition HQ counts every branch by, against the one median HQ pushed — drawn as a dashed rule at its true value and captioned with its week, its `n_branches` and when HQ computed it, because it is that week's median and not every week's. Seat utilisation from the licence copy, median decision age for referrals (the one queue whose decision is an event written once), approval age by queue (two queues named as absences with the store fact that makes them untimeable), week gates for the cycle under way read against the server's clock (`../../lib/cohortTimeline.js`), and revenue as a rate with every stream's reason. Wraps itself in `BranchZone`. Not suspension-gated. |

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
  loaded something knows what it holds. Each of the remaining wrappers in `App.jsx`
  goes away on the day its zone gets a page — two of the seven went with D140.
- **A row is added with its route, never before it.** `sidebarConfig.js` states
  the rule: a row pointing at a route that does not exist looks shipped and
  404s. All eight branch rows have routes, and **as of D155 every one of them
  is a real page** — `BranchZonePending`, the stated notice that stood in while
  the artboards landed one at a time, is deleted rather than left unused, and
  the guard that required it to exist is re-aimed at the property it was
  approaching: every row resolves to something built.
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
  branch admin reads the screen somewhere else. `../../lib/zoneTime.js`'s `inZone`
  takes the zone as a **required** argument for that reason: a formatter that
  fell back to the reader's zone would print the wrong hour rather than no
  hour, and wrong is the only one of those a deadline cannot survive. It was
  written on `BranchHome` and moved to `lib/` in D140 when S4's calendar became
  its second caller — importing one page's export from another page is what
  `../../lib/README.md`'s rule forbids.
