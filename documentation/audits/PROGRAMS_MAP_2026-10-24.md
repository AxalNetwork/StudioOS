# Programs — what the code serves, board by board (2026-10-24)

**A snapshot, not a spec.** S1 made this map for #2371 on 2026-10-24 to integrate the owner's "Programs" canvas
(PG1–PG20, 40 frames, D933) and to split the rest into slot tasks. The readers worked from the code on
`claude/spinout-lab-workspace-wuyyqd`, between `6205ee6` and `85746dd`. Each section names its own commit, and Part E
lists the line cites that moved. The map was not checked against production, and nothing here is maintained
afterwards. Re-read the code before you act on a line.

Path short forms: Worker paths are under `cloudflare-worker/src/` and frontend paths under `frontend/src/` unless a
path says otherwise. `dc:` is `design/incoming/Programs Page.dc.html`. `dcB:`, `bd:`, `grid:` and `boards:` are all
`design/incoming/Programs · Boards.dc.html`.

**Two part numberings.** "P1…P12" and "#2371·n" below are the parts #2371's body suggested. D933 §6 regroups the
work into its own eleven parts (D934–D944), so cite D933's numbers in a task.

**Settled since.** D933 settles every open conflict and S-code listed in Parts A, C and E. Where this map and D933
differ, D933 wins.

The five parts are:
- **A:** the board-by-board gap tables.
- **B:** the Worker reads and writes, family by family.
- **C:** the landing and the admin shell.
- **D:** #2371's defects, re-checked.
- **E:** the completeness critique.

## Part A — the boards against the code

### Programs catalogue (PG1, PG1h, PG2, PG3): board-by-board gap table

**This is a snapshot, not a spec.** S1's map for #2371, read on `claude/spinout-lab-workspace-wuyyqd` on 2026-10-24. It was read-only and not checked against production.

**Which commit.** HEAD is now **`fbbb4c8`**, not the `6205ee6` the task named. Six commits landed on top: `6c355ff`, `24136bf`, `0b85c2b`, `0296848`, `99466ce` (D915, the Events desk) and `fbbb4c8` (D906's review fixes).
- `git diff --stat 6205ee6 HEAD -- cloudflare-worker` is empty. Every Worker line below reads the same at both commits.
- `99466ce..fbbb4c8` changes seven files: `CycleRoute.jsx`, `PhoneModulePage.jsx`, `NarrativeTool.jsx`, `narrativeModel.js`, two tests and `D906.md`. This section cites none of them.
- In `frontend/src/App.jsx`, four Events lines (a comment and three routes) were added after old line 2837. Routes below that point moved down by 4. So `/perks` is `fe/App.jsx:2960`, `/product-testing` `:3036`, `/admin/advisor-cohorts` `:3291` and `/referrals` `:3497`.
- Lines above 2837 did not move: `:143`, `:690`, `:1099`, `:1265-1331`, `:2304-2306`, `:2695`, `:2700`, `:2708`, `:2725`, `:2730` and `:2814`.
- `frontend/test/admin_route_reachability.test.mjs` gained 8 lines at `:281-288` (D915's COMPOSED entry). Its redirect pin is at `:472` at HEAD.
- Every line below is the HEAD line. The issue body's cites on `537f646a3f` that this section relies on were re-checked. Those that moved:
  - `fe/lib/api.js:3647` → `:3652`, `:2542` → `:2547`, `:2548` → `:2553`, `:2586` → `:2591`.
  - `fe/ui/Stat.jsx:4-25` → `Stat` at `:27`.
  - `frontend/package.json:32` (recharts) → `:33`.
  - `fe/lib/railPages.js:458` → `:460`.
  - `wk/index.ts:1081` → `:1094`.

**Prefixes.**
- `wk/` = `cloudflare-worker/src/`
- `fe/` = `frontend/src/`
- `mig/` = `cloudflare-worker/sql/migrations/`
- `dc:` = `design/incoming/Programs Page.dc.html`
- `grid:` = `design/incoming/Programs · Boards.dc.html`

**Notation.** **E** = exists, **P** = partly, **N** = does not exist, **W** = would give a wrong figure or false copy today. Bracketed canvas values are samples, never data.

**How the four boards are put together** (the canvas's own dispatch):
- **PG1 and PG3:** `catHead(false)`, then the moved notice and `catCols(false)` (`dc:473`). PG3 is PG1 with `dark` set (`dc:213`).
- **PG2:** the HQ shell, `catHead(true)` and `catCols(true)` (`dc:474`).
- **PG1h:** a cropped callout with no shell, top bar or spine (`dc:214`, `dc:490-491`, `dc:512`).
- **Columns:** tiles, joins, waiting (span 3), credits (span 3), the catalogue head, nine cards (span 2 each), then Your proposals, or for HQ the callout plus Proposals from studios (`dc:370`).
- **Cards:** one template (`dc:350-357`) over the nine-program list (`dc:340-349`).
- **Grid captions:** `grid:45-47`.

---

#### 0. Key

##### 0.1 Reads an admin can call today

| Id | Read | Guard | Shape and limits | How it fails |
|---|---|---|---|---|
| **R1** | `GET /api/admin/studio/glance` (`wk/routes/admin_studio_glance.ts:30-37`; mount `wk/index.ts:1094`). Client: `api.adminStudioGlance` (`fe/lib/api.js:3652`) → `loadStudioGlance` (`fe/pages/admin/adminStudioOverview.js:357-362`) → `useHeldGlance`/`laneOf` (`fe/pages/admin/heldFigures.jsx:15-41`) | `requireAdmin` (`:32`) | HQ approvals block (`wk/services/studioGlance.ts:199-211`). Lanes `cohort` (`cohort_applicants WHERE status='pending'`, `wk/services/approvalSources.ts:132-142`) and `referrals` (`submitted`, `under_review`, `more_info_needed`; `:113-131`), each with `count`, `oldest_age_hours` and `sla` (`wk/services/branchHome.ts:360-376`). The client keeps `oldest_age_hours` (`adminStudioOverview.js:423-427`). The counts have no join, by design (`approvalSources.ts:64-68`). `no_queue` = `NOT_LANED` (`approvalSources.ts:269-274`). | A failed lane is `count: null` (`approvalSources.ts:465`). `pending_total` is null if any lane fails (`studioGlance.ts:206`). |
| **R2** | `GET /api/admin/spinout-applications` (`wk/routes/admin.ts:1190-1207`); `fe/lib/api.js:2547` | `requireAdmin` (`:1191`) | `spinout_applications` rows with `created_at`. **Pending first, then newest** (`:1200-1201`). Inner `JOIN users` (`:1199`). **LIMIT 200, no total** (`:1202`). | **Hides failure:** any error returns `{applications: []}` with 200 (`:1205`) |
| **R3** | `GET /api/admin/spinout-participants` (`admin.ts:1385-1527`); `api.js:2553` | `requireAdmin` (`:1386`) | A text `cohort` label and `started_at` per participant. Sorted **oldest first** (`:1423`), with LIMIT 400 joined rows before de-dup (`:1424`), so the cap drops the newest. | **Hides failure:** `{participants: [], catalog}` with 200 (`:1427-1430`) |
| **R4** | `GET /api/admin/cohort/timeline` (`wk/routes/admin_cohort.ts:49-76`); `api.js:2591` | `requireAdmin` (`:50`) | The 12 latest cycles (`:53`) with windows. `participant_count` = **active** users started in the window (`:60-63`), `?? 0` (`:71`). | 5xx (no try) |
| **R5** | `GET /api/admin/cohort/applications` (`admin_cohort.ts:238-330`); `api.js:2595` | `requireAdmin` (`:239`) | 12 cycles. True counts by status per cycle (`:251`, `applicant_counts` `:320`). ≤200 applicants per cycle, pending first (`:263-264`), each with `application_id`, `rolled_from_cycle_id` and `ca.created_at` (`:256-257`). The list inner-joins `users` (`:260`). | 5xx |
| **R6** | `GET /api/advisors/admin/cohort-assignments` (`wk/routes/advisors.ts:2964-2996`); `api.js:2584` | Role check only (`:2966-2967`) | Active and ended rows, newest first. `advisor_role` is the **current** role. **LIMIT 500**, no total (`:2982-2983`). | 500 via `mapError` |
| **R7** | `GET /api/admin/lab-hosts?status=` (`wk/routes/lab_hosts.ts:198-222`; mount `wk/index.ts:1327`); `api.js:2572` | `requireAdmin` (`:199`) | Up to 500 items with `created_at`, inner `JOIN users` (`:208`). `counts` are true all-time counts by status and ignore the filter (`:216-221`). Each application is a fresh insert (`:136`). | 5xx |
| **R8** | `GET /api/refer-earn/admin/submissions?status&category&limit` (`wk/routes/refer_earn.ts:256-283`; mount `wk/index.ts:1225`); `api.js:2472` | `requireAdmin` (`:257`) | Newest first (`:274`). **Default 100, max 200** (`:262`), no total. A `status` filter exists (`:266`). A row is born `submitted` (`wk/services/referralSubmissions.ts:476`; the only insert, `:473`), so `created_at` is the submission time. The referrer is served as `referrer_email`/`referrer_name` only: `toWire` drops `referrer_user_id` (`referralSubmissions.ts:635-655`; `refer_earn.ts:278-282`). | 5xx |
| **R9** | `GET /api/perks/admin/queue` (`wk/routes/perks.ts:767-778`); `api.js:3398` | `requireAdmin` (`:769`) | `status IN ('in_review','draft')` (`:773`), oldest first, LIMIT 200, no total (`:774`). Serves `p.*` (`:771`), including `updated_at`, which every partner edit resets (`:630`). No route writes `draft`: the one insert writes `in_review` (`:556-560`). | `mapError` |
| **R10** | `GET /api/perks/` (`perks.ts:863-897`); `api.perksCatalog` (`api.js:3383`) | `requireAuth` (`:865`) | Live and not past their end date, LIMIT 200 (`:871-872`). `claim_count` is computed (`:409`) but **not served**: `publicPerk` uses it only for `cap_reached` (`:382-401`, `:394`). | `mapError` |
| **R11** | `GET /api/learning/programs/mine` (`wk/routes/learning_programs.ts:104-121`); `fe/lib/api/learning.js:46` | Admin. The Super Admin sees every program; an Admin sees only the programs assigned to them (`:115`). | Per program: `status`, active `learners` and `contents` (`:112-113`), LIMIT 500. **No status filter**: drafts and archived programs come back too (`:110-117`; `status` served, `wk/services/learningPrograms.ts:33-37`). | 5xx |
| **R12** | `GET /api/learning/programs/:uid/learners` (`learning_programs.ts:178-188`) | Super Admin or assigned admin (`:169-176`) | Active learners with `uid`, name and `enrolled_at`, never an email (`:13-15`; `wk/services/learningPrograms.ts:101-106`, `:189`). One call per program. | 403 `not_assigned`, 404 |
| **R13** | `GET /api/admin/testing/programmes?status=` (`wk/routes/testing.ts:160-165`); `fe/lib/api/productTesting.js:57` | **Super Admin only** (`:155-158`) | `applicant_count` excludes withdrawn but includes declined and picked (`wk/services/testing.ts:133`) | `fail` |
| **R14** | `GET /api/admin/credit-rules/grants` (`wk/routes/admin_credit_rules.ts:74-112`); `fe/lib/api/creditRules.js:18` | **Super Admin only** (`:76`) | Rule grants and `manual` lines only, **no spends** (`:88`, `:98`). Manual lines include deductions, which come back as negative `credits` (`wk/services/creditGrants.ts:298-299`). Revoked grants stay on the list with `revoked: true` (`:107`). Newest 200 only (`:89`, `:99`). | `mapError` |
| **R15** | `GET /api/admin/partners/deals?status=` (`wk/routes/admin_partners.ts:293-312`; mount `wk/index.ts:848`); `api.adminPartners.listDeals` (`api.js:1237-1238`) | `requireAdmin` (`:294`) | One status per call, default `active`, up to 200 rows. A partner deal grants the partner their own tier on signing (`wk/services/partnerDeals.ts:301-337`). It is not a commission term. | 5xx |

On HQ there is no per-item read of the Approvals lanes. `GET /api/branch/approvals` (`wk/routes/branch_approvals.ts:51-54`; mount `wk/index.ts:1042`) calls `requireBranchTier`, which throws off a branch (`wk/util/branch.ts:107-111`). So the age bands have to come from each console's own read. Where R1 gives a lane's true count, compare it with the rows that console returned. If they differ, the bands do not cover the whole lane, and the board should say so.

##### 0.2 Dependencies

**#2371's suggested split** (issue body):
- **P1:** the program registry, the playbook store and the catalogue read `GET /api/admin/programs?weeks=`
- **P2:** proposals and the Super Admin's decision
- **P3:** grant state, with #2376
- **P4:** Refer & Earn fixes
- **P5:** Referral partners
- **P6:** Investor cohort access
- **P7:** mentor routes and hidden-founder counts
- **P8:** the frontend catalogue
- **P9:** the program page template and the Mentor, Refer & Earn, Perks and Learning pages
- **P10:** the Referral partners, Investor and AI-native pages
- **P11:** the proposal flow
- **P12:** docs

**Other issues:**
- **#2374:** the Lab console and its address
- **#2375:** the frame and the redirect pattern
- **#2376:** program grants
- **#2377:** the product tester role
- **#2382:** the Product testing page
- **#2390:** the Approvals lanes
- **#2319:** old addresses

##### 0.3 Owner decisions and S1 calls

| Code | Decision |
|---|---|
| **O-EXP** | Whether Explorers may refer (Refer & Earn) |
| **O-CRD** | The perk-credit amount for each referral reward |
| **O-VER** | What "verified investor" means |
| **O-AIV** | The AI-native Venture playbook and its purpose line |
| **O-PRF** | Whether Profiling trends is removed or moves (for example to Insights) |
| **S-RUN** | S1: whether the nine programs ship as a frontend constant before P1, and what "running" counts |
| **S-PPL** | S1: the definition of "People taking part" (distinct members, across which programs) |
| **S-AGE** | S1: the Overdue threshold and the age bands. The canvas uses 2 and 7 days; the code's bands are 24 h and 72 h (`wk/services/slaWindow.ts:18`; `approvalSources.ts:305`), shared with #2390. Also whether `more_info_needed` counts as waiting on the admin. |
| **S-LAB** | S1 with #2374: which store "Lab applications" and "in the cohort" count |
| **S-COV** | S1: which cycles count as cohorts that need a mentor. This is the denominator of "cohorts covered" and the trigger for the "no mentor" item in Needs you. |
| **S-PER** | S1: whether the card figures follow the period control |
| **S-HELD** | **Mostly answered by the canvas.** In held mode only "Granted to your studio" becomes "HQ-held". AI-native and Investor keep "Not offered yet", and Product testing keeps "Runs at HQ" (`dc:351`). The PG1h note's "every program reads HQ-held" (`dc:491`) is looser than its own code. S1 only confirms that reading. |

---

#### 1. PG1 · Catalogue · Admin · desktop light

PG3 and PG20a carry the same data. Grid caption: `grid:45`.

##### 1a. Shell and header

| Block (dc line) | What it draws | Worker source today | Owner/dependency | Now / placeholder |
|---|---|---|---|---|
| Sidebar, group "Admin", nine rows, Programs lit (`dc:509-510`; markup `dc:16-22`) | Studio, Accounts, Approvals, Programs, Community, Contracts, Fund admin, Insights, Licences | **E**, frontend only. The nine rows exist in this order (`fe/sidebarConfig.js:218-248`). The Programs row is `to: '/admin/held/programs'`, with `match` for the Lab, advisor cohorts and profiling trends (`:228-229`). The canvas's hrefs are generated from the labels (`dc:510`) and are not addresses. `match` entries are path prefixes, and once declared they are the row's complete claim (`fe/ui/SidebarNav.jsx:211-213`). Every entry must be a registered route (`frontend/test/held_admin_shell_d286.test.mjs:93-94`). The row's `to` is pinned at `:83`. | P8 | **NOW.** Programs `to: '/admin/programs'`, with `match: ['/admin/programs', '/admin/spinout-lab', '/admin/advisor-cohorts', '/admin/profiling-trends']`. The first entry is a prefix that covers the future sub-paths; a `/*` entry would fail `:94`. Profiling trends stays in `match` until O-PRF. Update the d286 pins at `:83` and `:326`. Keep every other row's real `to`. |
| Top bar: search, bell, account, studio badge "[Studio Lisbon]" (`dc:26-33`, `dc:522`) | Whose studio this is | **E**, frontend. The badge reads "HQ-held · axal.vc / HQ-HELD" (`fe/App.jsx:1321-1330`). A licence administrator whose branch is not deployed sees "{brand} · on axal.vc / BRANCH · NOT DEPLOYED", read from `api.myLicence()` (`fe/App.jsx:1311-1320`; `fe/hooks/useBranchDeployment.js:26-38`). No branch is deployed: `infra/branches/` holds only `README.md` and `_example.json` (`git ls-files infra/branches`). | — | **NOW.** Keep the existing badge. "[Studio Lisbon]" is a sample. |
| Eadwyn spine, tooltip "Eadwyn reads the program figures on this page. Nothing changes until you act." (`dc:204-206`, `dc:536`) | The AI rail, collapsed | **E**, frontend. HeldZone's one `WorkerRail` (`fe/pages/admin/HeldZone.jsx:47-59`), keyed `own('/admin/held/programs', key(AD, 'Programs'))`, which is "Admin · Programs" (`fe/lib/railPages.js:280`, `AD` `:254`, `key` `:45`). The route is also named in `fe/lib/railOptions/admin.js:61`. The rail's note is different copy (`HeldZone.jsx:43-45`), and its role is fixed to `admin` (`:51`), pinned by `held_admin_shell_d286.test.mjs:350`. | P8 | **NOW.** Move the key in `railPages.js:280` and `railOptions/admin.js:61` to `/admin/programs`, and use the canvas's note. |
| Moved notice "Programs has a new address. Update your bookmark." with Dismiss (`dc:473`; `MOVED` `dc:272`) | A lavender status line for an old `/admin/held/programs` link | **E** pattern. `HeldInsightsRedirect` keeps the query and hash and adds `?moved=` (`fe/pages/admin/insights/HeldInsightsRedirect.jsx:12-17`; route `fe/App.jsx:2730`). The page draws it as `role="status"` with Dismiss (`fe/pages/admin/insights/AdminInsights.jsx:333-338`), in the same sentence shape (`insightsModel.js:25`). **A redirect is one line in a Worker file**: `REDIRECT_ROUTES` (`wk/services/redirectRoutes.ts:137`; D893 added its own in `54bec7e`). `frontend/test/redirect_hits_2301.test.mjs:38-43` fails if App.jsx's redirect routes and that list differ. The reachability pins are `frontend/test/admin_route_reachability.test.mjs:472` (the redirect list) and `:476` (`COMPONENT_TARGETS`). | P8, #2375, #2319 | **NOW**, together with the `redirectRoutes.ts` line and both reachability pins. |
| Title "Programs" at 24 px, and the line "Every program your studio runs, what it needs from you now, and what HQ offers." (`dc:469`, `dc:528`) | Static copy | — Today the title is 18 px (`fe/pages/admin/HeldPrograms.jsx:33`) | — | **NOW** |
| Scope chip "[Studio Lisbon]", tooltip "Your studio. Every figure on this page is this licence's." (`dc:59`, `dc:469`, `dc:529`) | Licence scope | **W.** No read is scoped by licence. `admin` is an unscoped role (`wk/services/tenancyScope.ts:64`), so every read here reads HQ's own database. Two copies of the honest chip text exist: `HELD_SCOPE` (`HeldZone.jsx:30`) and `SCOPE_LABEL`/`SCOPE_TITLE` (`fe/pages/admin/insights/insightsModel.js:26-27`). | #2376, a deployed branch | **NOW as PG1h draws it:** "HQ-held accounts · axal.vc" with `SCOPE_TITLE`, from one constant. Never the licence tooltip. |
| "Propose a program" (`dc:469`) | Violet button to `/admin/programs/propose` | **N.** No proposal store or route (§8). | P2, P11 | **Do not draw until P2** |
| "Updated [10:42]" and refresh (`dc:469`) | Clock and refresh | Client only, as Insights does: `Date.now()` at read (`AdminInsights.jsx:62`, `:349-350`) | — | **NOW** |
| Period control: 4, 12 (selected) and 52 weeks (`dc:469`, `dc:533`) | Radio group; deltas against the period before | **N** server-side: no read takes `weeks=` (there is no `/api/admin/programs`, §8). Only the client-computed series can follow it, and only as far back as their rows reach (R2 and R8 stop at 200). | P1, S-PER | **NOW with a caveat:** it drives the client-side series. For weeks deeper than the rows read, the page says "Not read here yet". |

##### 1b. Row 1 · four tiles (`dc:333`; tile frame `dc:238`)

| Block | What it draws | Worker source today | Owner | Now / placeholder |
|---|---|---|---|---|
| "Programs running" [6] of [9] | Count of Live programs | **N** registry. Six cards are drawn Live (`dc:341-349`). | P1, S-RUN | **NOW with a caveat**, only if S-RUN ships the nine programs as a frontend constant. It is then a count of copy, which P1 replaces. Otherwise "Not read here yet". |
| Sub-line "[2] not granted · [1] proposed" | Grant and status counts | On PG1 the only cards not granted are the two "Not offered yet" ones, AI-native and Investor (`dc:342`, `dc:344`). The canvas has a separate "Not granted" badge that no PG1 card draws (`dc:324`; drawn only on PG15b and PG16a, `dc:486`, `dc:497`). So the sub-line's word is the wrong badge. "Proposed" is AI-native only (`dc:342`). | #2376 | **NOW as "[2] not offered yet · [1] proposed"** from the constant, which is true today. Never "not granted" until #2376. |
| "People taking part" [312], "active in the period, across programs" | Distinct members | **N.** Parts exist, but no read is distinct across programs, and they share no key. R3 and R6 give user ids. R8 gives only `referrer_email` (`referralSubmissions.ts:635-655`). R12 gives `uid` and name, never email (`learning_programs.ts:13-15`). No admin read lists perk claimants: claims are read only by their owner (`perks.ts:420-424`) and, without names, by a partner for their own listing (`perks.ts:695-710`). Summing double-counts. | P1, S-PPL | **Not read here yet** |
| Delta "+[8]%" | Against the period before | **N** | P1 | **Not read here yet** (omit the delta) |
| "Waiting for you" [21] | The sum of the five queues (`grid:45`) | **P.** Cohort and referrals come from R1 (`approvalSources.ts:113-142`). Hosts pending come from R7 `counts` (`lab_hosts.ts:216-221`). Perk listings come from R9, filtered to `in_review`. That filter is belt and braces: no route writes `draft` (`perks.ts:556-560`), and a draft would not be reviewer backlog (the referral rule, `approvalSources.ts:31-34`). The R9 count is exact only when fewer than 200 rows come back (`perks.ts:774`). **Strategic referral access is N:** the only reads are the member's own status (`referralSubmissions.ts:409`, `:419`) and the only write is the insert (`:627`). A total that misses a queue is smaller than the truth (the rule at `studioGlance.ts:191-206`). The referrals lane also counts `more_info_needed` (`approvalSources.ts:122-124`), where "the ball is in the referrer's court" (`referralSubmissions.ts:51-56`). | P4, #2390 | **W as drawn.** **NOW with a caveat:** the total over the four queues that can be read, labelled as four, with "Strategic referral access is not read here yet". Null when any one of the four is unreadable. |
| "oldest [4 days]" | The oldest item across the queues | **P.** R1 gives `oldest_age_hours` for cohort and referrals (`branchHome.ts:360-376`), each exact from its lane's `MIN(created_at)`. Hosts and perks use item stamps (R7, R9). Three skews: (a) the cohort's oldest is `cohort_applicants.created_at`, which is the close time for applications adopted at close (`wk/services/cohortApplications.ts:371-376`); (b) the referrals oldest can be a `more_info_needed` item that waits on the referrer; (c) a perk keeps its old `created_at` when a live listing goes back to review (`perks.ts:629`). Use R9's `updated_at` instead, which is reset at that moment (`:630`). | S-AGE, #2374 | **NOW with a caveat** |
| "! Overdue" flag | Past two days (the issue's brief) | Approvals bands an item as past at 72 h (`approvalSources.ts:305`) and due soon at 24 h (`slaWindow.ts:18`) | S-AGE, #2390 | **NOW once S-AGE is settled.** Use the lanes' bands so Programs and Approvals agree. |
| "Credits paid out" [4,200], "[2,600] spent on perks" | Two ledger sums over the chart's three months (`dc:311-312`: 1,400 × 3; 800 + 850 + 950) | **N for an Admin.** Every cross-member perk-credit read is Super Admin only (`admin_credit_rules.ts:66`, `:76`; `perks.ts:806`). For the Super Admin, R14 is **W** as a total: newest 200 only, no spends, manual deductions netted in as negatives, revoked grants still listed (`admin_credit_rules.ts:88-89`, `:98-99`, `:107`). No read sums `kind='spend'` across members (`git grep "SUM(delta)"`: only per-user balances, `perks.ts:283`, `creditGrants.ts:262`, `:296`). The ledger kinds are at `mig/186_perks.sql:123`. | P1 | **Not read here yet** |

##### 1c. Row 2 · "Joins per week" (`dc:334-336`)

| Block | What it draws | Worker source today | Owner | Now / placeholder |
|---|---|---|---|---|
| Chart/Table toggle, legend, hollow "so far" week, gaps never zero (`dc:336`) | Chart chrome | **E**, frontend. `Legend` and `ChartTable` (`fe/pages/admin/insights/InsightsCharts.jsx:284`, `:307`). A multi-series weekly line with gaps and a hollow current week exists in `fe/components/WeeklyLineChart.jsx:4-27`. | P8 | **NOW** |
| Title "Joins per week" and y-axis "people per week" (`dc:336`) | Axis copy | **W** as copy. Two series are not people joining: a referral submission is a person someone referred (R8), and a Lab application is an application, one per cycle (`mig/157_cohort_applications.sql:20-21`). | — | **NOW, reworded:** y-axis "per week". Keep the title only if S1 accepts "joins" for submissions. |
| Series: Lab applications (violet) | Applications per week | **P.** `spinout_applications.created_at` via R2. R2 is capped at 200 with pending rows first (`admin.ts:1200-1202`). When 200 rows come back, the weeks are complete only back to the oldest **decided** row returned. Old pending rows appear without the decided rows of their weeks. A failure returns `[]` with 200 (`admin.ts:1205`), which would draw a line of zeros (**W** on failure). A client guard works in practice. Every `cohort_applicants` row has a NOT NULL `application_id` (`mig/157:27`; no foreign key). Both writers take it from a `spinout_applications` row (`cohortApplications.ts:296-300`, `:371-376`). So if R1's cohort count is above 0 and R2 is empty, R2 could not be read. `cohort_applicants.created_at` is **W** as a join date: adopted applications get a row at close (`cohortApplications.ts:371-376`), and a rolled-forward applicant gets a new row (`mig/157:20-21`). | S-LAB, #2374 | **NOW with a caveat:** R2 plus the guard. Label how far back the decided rows reach when 200 come back. |
| Series: Referrals submitted (sky) | Referrals per week | **P.** R8 at `limit=200`, by `created_at` | P4 | **NOW with a caveat:** complete only back to the 200th newest row |
| Series: Learning enrolments (amber) | Enrolments per week | **P.** `enrolled_at` from R12, one call per program, active learners only (`learningPrograms.ts:101-106`). A removed learner drops out of past weeks. An Admin sees assigned programs only (`learning_programs.ts:169-176`). | P1 | **NOW with a caveat:** labelled "active enrolments, in the programs you follow" for an Admin |
| Series: Perk claims (emerald) | Claims per week | **N** read. `perk_claims.created_at` is stored (`mig/186:109`), but no admin read serves it (§1b). | P1 | **Not read here yet:** a legend item with no line |
| Foot "Referrals rose [18]% on the period before." | A sentence from the numbers | **P.** Needs two periods of R8 within 200 rows | P4 | **NOW** only when both periods fit in the rows read; otherwise omit it |

##### 1d. Row 3 · "Waiting by program" (`dc:337-338`)

| Block | What it draws | Worker source today | Owner | Now / placeholder |
|---|---|---|---|---|
| Legend: Under 2 days, 2 to 7 days, Over 7 days; bar-end label "[n] waiting"; Chart/Table toggle (`dc:337-338`) | Age bands | Client-side, from item stamps | S-AGE | **NOW** |
| Row "Spin-Out Lab applications" [7] | Count and bands | Count **E** from R1 `cohort`. Bands **P** from pending applicants' `created_at` in R5 (`admin_cohort.ts:256-264`), with the adopted-at-close skew above. Alternatively, join them client-side to R2's `created_at` by `application_id`. R5's list inner-joins `users` (`:260`) while R1's count has no join (`approvalSources.ts:64-68`), so the bands can cover fewer rows than the count. | #2374, S-LAB | **NOW with a caveat:** say "[n] of [m] dated" when the two differ |
| Row "Refer & Earn reviews" [7] | Count and bands | Count **E** from R1 `referrals`. Bands **P** from R8 `created_at`. Read R8 once per open status with `?status=` (`refer_earn.ts:266`). An unfiltered newest-first call cuts exactly the oldest waiting rows. The bands are complete when the rows equal R1's count. Includes `more_info_needed`. | P4 | **NOW with a caveat** |
| Row "Strategic referral access" [2] | Count and bands | Store **E**, read **N.** `referral_strategic_access` holds `status` and `created_at` (`mig/175_referral_submissions.sql:86-94`). There is no admin read and no lane (lane keys `approvalSources.ts:47-49`). | P4, #2390 | **Not read here yet** |
| Row "Perk listings" [3] | Count and bands | **P.** R9 filtered to `in_review`. Band on `updated_at` (`perks.ts:771`, `:630`), not `created_at`, which is **W** for a listing re-reviewed after an edit (`:629`). `updated_at` also moves if the partner edits a waiting listing again, which understates its age. Not an Approvals lane. | P1, #2390 | **NOW with a caveat:** "since last edit" |
| Row "Office-hours hosts" [2] | Count and bands | **E.** R7 `counts.pending` and pending items' `created_at` (up to 500). Each application is a fresh row (`lab_hosts.ts:136`). | #2374 | **NOW** |
| Row doors: "Each row opens that queue; the two Lab rows open Spin-Out Lab › Applications and › Hosts." (`dc:338`) | Deep links | Frontend. The Lab's tabs are component state (`fe/pages/admin/AdminSpinoutLab.jsx:630`, `:716`, `:767`), so they have no address. Refer & Earn's queue is `/admin/refer-earn` (`fe/App.jsx:2695`). The perks review is a state tab of `/perks` (`fe/pages/PerksPage.jsx:1671`, `:1697`). | #2374, P9 | **NOW** to today's consoles (`/admin/spinout-lab`, `/admin/refer-earn`, `/perks`). The deep links wait for #2374 and P9. |
| Foot "Nothing has waited over 7 days." | A sentence from the data | Derived | — | **NOW**, worded "Of the queues read, nothing has waited over 7 days." Strategic access is unread, so the canvas's flat claim is not one the page can make. |

##### 1e. Row 3 · "Credits in and out by month" (`dc:339`; data `dc:309-321`)

| Block | What it draws | Worker source today | Owner | Now / placeholder |
|---|---|---|---|---|
| Granted above the axis: Lab milestones, Bounties, Granted by HQ | Monthly stacks | **N for an Admin** (R14 is Super Admin only, `admin_credit_rules.ts:76`). **P** for the Super Admin, because `rule_key` maps to the sources: `lab:*` (`mig/381_credit_reward_rules.sql:48-77`), bounties via `isBountyRule`, which includes `task_approved` (`wk/services/creditGrants.ts:61-63`), and `manual` (`:282`). A manual line can be a deduction (`creditGrants.ts:298-299`), and revoked grants stay listed (`admin_credit_rules.ts:107`). Newest 200 only, so a busy month undercounts. | P1 | **Not read here yet** |
| Source "Referrals" | A stacked segment | **N** in perk credits. No referral rule exists: `grep -ni refer mig/381_credit_reward_rules.sql` finds only "REFERENCES" at `:35`. The only later rule migration, `mig/407_feature_shipped_rules_off.sql:15`, is an UPDATE. `grantCredits` has four callers, none for a referral: `wk/routes/admin_ticket_reviews.ts:225`, `wk/services/bugBounties.ts:178`, `wk/services/labMilestoneCredits.ts:80` and `:100`. **A different currency does pay referrals:** one *introduction* credit per referred signup (`wk/services/introductions.ts:247-262`; ledger kinds `:72`, `mig/150_introductions_network.sql:63`). | P4, O-CRD | **Not recorded.** Omit the segment and say "Referral rewards are not paid in perk credits yet." Never a zero bar, and never "not paid as credits": intro credits are paid. |
| Below the axis: "Spent on perk claims" | Monthly spend | **N.** No read sums spends, and R14 excludes them | P1 | **Not read here yet** |
| Foot "1 credit is worth $1 of perk value." | Copy | **E** (`mig/381:3`; `perks.ts:253-254`; the dollar value is fixed at credits × 100, `admin_credit_rules.ts:168-178`) | — | **NOW** |

##### 1f. Catalogue head and the card frame

| Block | What it draws | Worker source today | Owner | Now / placeholder |
|---|---|---|---|---|
| "Catalogue", "[9] programs", group chips All, Ventures, Access, Network and referrals, Rewards, Learning, Product (`dc:358`) | Count and a client filter | **N** registry. The nine programs and their groups are canvas copy (`dc:340-349`). | P1, S-RUN | **NOW as a frontend constant**, which P1 replaces |
| Status pill on every card: Live, Partly built, Not built yet, Proposed (`dc:322-323`, `dc:354`) | Program status | **N** registry | P1 | **NOW as copy** with the constant. Each word is true today; for Proposed, that rests on the owner's word. |
| Grant badge on every card (`dc:324`, `dc:351`, `dc:354`) | Granted to your studio, Not offered yet, Runs at HQ | **N** (#2376). On HQ-held accounts the canvas's own held mode maps only "Granted to your studio" to "HQ-held" (`dc:351`; `dc:491`). | #2376, S-HELD | **NOW** as the held mode draws it: "HQ-held" on the six granted cards, "Not offered yet" on AI-native and Investor, "Runs at HQ" on Product testing. Never "Granted to your studio" until #2376. The badge's link to grant terms (`/admin/my-licence/programs`, not a route, §8) waits for #2376. |
| "Open" on every card except Product testing (`dc:356`) | Link to `/admin/programs/<key>` | **N** (no such route, §8) | P9, P10, #2374 | **NOW** to today's console per card, listed below |

##### 1g. The nine cards (`dc:341-349`)

| Card · block | What it draws | Worker source today | Owner | Now / placeholder |
|---|---|---|---|---|
| **Spin-Out Lab** purpose, "Who: Founders · Join: By application" | Copy | **E.** 28 days (`mig/156_cohort_timing.sql:16`), monthly (`wk/services/cohortTiming.ts:4-7`) | — | **NOW** |
| Lab "[7] applications waiting" | Count | **E**, R1 `cohort` | S-LAB | **NOW** |
| Lab "[24] in the [Nov 2026] cohort" | Count | **W** from R4. `participant_count` counts active users only (`admin_cohort.ts:60-63`), and incorporation sets `spinout_lab_active = 0` (`wk/routes/spinout_lab.ts:239`, `:250`), so the count shrinks as founders succeed. Before activation nobody started in the window is active, so it reads 0. **P** from R5's true counts: approved plus activated per cycle (`admin_cohort.ts:251`, `:320-321`). | #2374, S-LAB | **Do not draw from `participant_count`.** NOW from R5 once S-LAB states the definition. |
| Lab "Needs you [9]" (7 applications + 2 hosts) | Count | **E**, R1 `cohort` plus R7 pending | — | **NOW** |
| Lab "Open" | `/admin/programs/spinout-lab` | **N.** Today it is `/admin/spinout-lab` (`fe/App.jsx:2814`), rail-free (`fe/lib/railPages.js:460`) | #2374 | **NOW** to `/admin/spinout-lab` |
| **AI-native Venture**: Proposed, Not offered yet, bracketed purpose, "Join: Not set", foot "HQ is writing the playbook." | Copy | **N**, no store. `git grep -i -E "ai.native"` over `wk/`, `cloudflare-worker/sql` and `fe/` finds copy strings only. | O-AIV, P1, P10 | **NOW as static copy.** The purpose line stays a placeholder until O-AIV; never ship the bracketed sample. Omit "Open" until P10's page exists. |
| **Mentor cohort access** purpose, "Who: Advisors · Join: Assigned by an admin" | Copy | **E** (`wk/services/cohortAdvisorAccess.ts:5-11`; `advisors.ts:2297-2299`, `:2998`) | — | **NOW** |
| Mentor "[6] mentors" | Count | **E.** R6: distinct `advisor_user_id` where `is_active` and the lower-cased `advisor_role` is `advisor` (the write's rule, `advisors.ts:2297-2299`). Exact while R6 returns fewer than 500 rows, ended rows included. | — | **NOW** |
| Mentor "[3] of [4] cohorts covered" | Ratio | **P.** R6 against R4's cycles. No denominator is defined. Past cycles stay in R4, but future ones are created only up to two months ahead (`cohortTiming.ts:219-225`; `cohortApplications.ts:310-317`). | S-COV | **NOW once S-COV states the denominator** |
| Mentor "Needs you [2]" | Count | **P**, derived from two parts. (1) An upcoming cycle with no active row: which cycles count is S-COV's call. (2) Active rows whose `advisor_role` is no longer `advisor`: **E** (R4, R6). | S-COV | **NOW** for changed roles; the no-mentor half once S-COV is set |
| Mentor "Open" | `/admin/programs/mentor-cohorts` | **N.** Today it is `/admin/advisor-cohorts` (`fe/App.jsx:3291`) | P9 | **NOW** to today's page |
| **Investor cohort access**: Not built yet, Not offered yet, "Verified investors follow one Lab cohort to Demo Day.", "Not running" | Copy | **N.** `git grep -i -E "investor.cohort\|investor_cohort"` over `wk/`, `cloudflare-worker/sql` and `fe/` finds nothing. "Verified" is undefined. | O-VER, P6, P10 | **NOW as static copy.** "Not running" is true. Omit "Open" until P10. |
| **Referral partners**: Partly built; "Who: Partners, investors, advisors · Join: By invitation" | Copy | **W.** Any signed-in account mints a code (`wk/routes/network.ts:471-472`). The pill "Partly built" is honest. | P5 | **NOW** with the pill. The Who/Join line waits for P5's definition of a partner. |
| Referral partners "[12] partners · [9] with signed terms" | Two counts | **N.** No per-partner terms store. R15 counts partner deals, signed agreements that grant the partner their own tier (`partnerDeals.ts:301-337`), not commission terms. The commission reads are Super Admin only (`network.ts:571`, `:583`). | P5 | **Not read here yet.** No "Open" for an Admin: `/admin/commissions` is `hqOnly` (`fe/App.jsx:2700`). |
| **Refer & Earn** purpose "…for credits"; "Who: Every member · Join: Open" | Copy | **W.** No Refer & Earn submission pays perk credits (§1e). The referral code on the same page earns introduction credits only (`refer_earn.ts:98`; `introductions.ts:247-262`). `/referrals` excludes `exploring` (`fe/App.jsx:3497`), while the Worker admits any signed-in account (`refer_earn.ts:95`, `:141`). | O-EXP, O-CRD, P4 | **NOW, reworded.** Drop "for credits"; "Who" waits for O-EXP. |
| Refer & Earn "[48] referrals · [9] converted" | Two counts | **P.** R8 at 200, no total. Converted counts cumulatively, as the service does: `converted` plus `reward_eligible` plus `reward_issued` (`referralSubmissions.ts:298-305`). | P4, S-PER | **NOW with a caveat:** say "of the newest 200" whenever 200 rows come back |
| Refer & Earn "Needs you [9]" (7 reviews + 2 strategic) | Count | **W** as drawn, because strategic is N | P4 | **NOW for reviews only** (R1), with the `more_info_needed` caveat from §1b |
| Refer & Earn "Open" | `/admin/programs/refer-and-earn` | **N.** Today it is `/admin/refer-earn` (`fe/App.jsx:2695`), the queue only | P9 | **NOW** to today's page |
| **Perks** purpose "members claim them with credits, a plan or payment"; "Who: Every member" | Copy | **W.** Only founders claim (`PERK_CLAIMANT_ROLES`, `perks.ts:127`). Other roles browse (`:865`), except a partner, who is sent to their own listings (`fe/App.jsx:2960`). A paid perk records intent only: the partner invoices offline (`perks.ts:33-35`). | — | **NOW, reworded:** "Founders claim; other members browse." |
| Perks "[18] live" | Count | **E.** R10 item count (up to 200): live and not past its end date (`perks.ts:871`) | — | **NOW** ("200 or more" when the cap is hit) |
| Perks "[42] claims" | Count | **N** read. `claim_count` is computed but not served (`perks.ts:409`, `:382-401`), and there is no admin claims read | P1 | **Not read here yet** |
| Perks "Needs you [3]" | Count | **P.** R9 `in_review` rows only | — | **NOW with a caveat** (exact below 200 rows) |
| Perks "Open" | `/admin/programs/perks` | **N.** Today it is `/perks` (`fe/App.jsx:2960`); the review tab cannot be linked (`PerksPage.jsx:1671`) | P9 | **NOW** to `/perks` |
| **Learning** purpose; "Who: Every member · Join: By invitation" | Copy | **E** for Who: an open, published program takes any signed-in member (`learning_programs.ts:123-142`). The join method varies per program (`enrolment IN ('invite','open')`, default `invite`, `mig/389_learning_programs.sql:26`). | — | **NOW**, with Join derived from the rows ("Open or by invitation") |
| Learning "[4] programs" | Count | **P.** R11 returns every status (`learning_programs.ts:110-117`), and an Admin sees only assigned programs (`:115`). | — | **NOW**, counting `status === 'published'` client-side, labelled "programs you follow" for an Admin |
| Learning "[126] learners" | Count | **W** if R11's per-program `learners` are summed (`:112`): a person in two programs counts twice. **P** as distinct `uid`s across R12, one call per program. | S-PPL | **NOW only as distinct over R12**, or labelled "enrolments" |
| Learning "Open" | `/admin/programs/learning` | **N.** Today it is `/learning/programs` (`fe/routes/learning.jsx:42`) | P9 | **NOW** to today's page |
| **Product testing** (Admin): "Runs at HQ", no figures, no Open, foot "Runs at HQ. Its page is for HQ only, so there is nothing to open here." (`dc:349`, `dc:352-357`) | Static | **E.** Every HQ testing route is Super Admin only (`testing.ts:155-158`). "Who: Product testers" names a role that does not exist (#2377; the Worker says so, `wk/services/adminInsights.ts:58-59`). | #2377 | **NOW**, static |

##### 1h. Row 5 · "Your proposals" (`dc:359-364`)

| Block | What it draws | Worker source today | Owner | Now / placeholder |
|---|---|---|---|---|
| Table with search, Status and Sort; columns Program, Sent, Status (Draft · Sent to HQ · Approved · Sent back · Declined), HQ's note, Open; pager "1–5 of [5]" | The studio's proposals | **N.** No proposal store or route (§8) | P2, P11 | **Do not draw until P2**, together with "Propose a program" |

---

#### 2. PG1h · callout: today every admin works on accounts HQ holds (`dc:491`; `grid:45`)

| Block | What it draws | Worker source today | Owner | Now / placeholder |
|---|---|---|---|---|
| Title "Programs" (18 px callout) and note "No subsidiary is deployed yet, so every admin works on accounts HQ holds and every program reads HQ-held." | Copy | **E**, true for the deployment. `infra/branches/` declares no branch (only `README.md` and `_example.json`; `infra/branches/README.md:1-8`), `admin` is unscoped (`tenancyScope.ts:64`), and the same fact is in `HELD_SCOPE_NOTE` (`HeldZone.jsx:31-33`). A licence administrator whose branch is not deployed exists on axal.vc (`fe/App.jsx:1311-1320`); the sentence holds for them too, because their data is HQ's. "Every program" is looser than the badge logic, which keeps "Not offered yet" and "Runs at HQ" (`dc:351`). | — | **NOW**, worded "every program HQ runs reads HQ-held" |
| Chip "HQ-held accounts · axal.vc" | Scope chip | **E.** `HELD_SCOPE` (`HeldZone.jsx:30`) and `SCOPE_LABEL` (`insightsModel.js:26`) are two copies of the same string | — | **NOW**, from one constant, with `SCOPE_TITLE` (`insightsModel.js:27`) as its tooltip |
| Three cards (Spin-Out Lab, Mentor cohort access, Refer & Earn) with the badge "HQ-held" (`dc:491`, `[0, 2, 5]`) | Cards in held mode, with figures, Needs you and Open | Badge **E** (true today). The figures are as in §1g. | — | **NOW**. This is the badge every granted card shows on HQ-held accounts. |
| Where it renders | — | Today HeldZone draws a raw-slate scope paragraph on every held landing (`HeldZone.jsx:62-69`), pinned by `frontend/test/held_admin_shell_d286.test.mjs:357-360`. That file also pins HeldPrograms as a landing (`:55`), its sidebar `to` (`:83`), its path (`:326`) and the rail's `role="admin"` (`:350`). | P8 | Draw it as the header chip (§1a). If Programs leaves `HeldZone`, update those pins the way D893 did when Insights left (`54bec7e`). |

---

#### 3. PG2 · Catalogue · Super Admin (`dc:474`; `grid:46`)

These are the differences from PG1. PG2 draws no moved notice (`dc:474`). Every other block reads as in §1, plus what the Super Admin can also read.

| Block (dc line) | What it draws | Worker source today | Owner | Now / placeholder |
|---|---|---|---|---|
| HQ sidebar, 14 rows with Programs third (`dc:509`) | A new HQ row | **N**, frontend. The HQ group has 13 rows and no Programs row (`fe/sidebarConfig.js:109-148`), pinned by `frontend/test/super_admin_shell.test.mjs:67` and the "ELEVEN rows" prose (`sidebarConfig.js:87`). A Super Admin in HQ view gets only the HQ group (`fe/lib/shellRole.js:86`; `fe/App.jsx:690-691`), so in HQ view there is no door to Programs. They reach it only by switching to the Admin view. | P8 | **NOW**, with the test pins updated |
| Top-bar badge "HQ" (`dc:522`) | Shell badge | **E** (`fe/App.jsx:1265-1268`) | — | **NOW** |
| Line "Every program on StudioOS, what needs HQ now, and what studios propose." (`dc:469`) | Copy | "What studios propose" is **N** (P2) | P2 | **NOW**, without the last clause until P2 |
| Scope chip "All studios", tooltip "Figures across every studio." (`dc:469`) | Scope | **W.** There is one database and no deployed studio. The glance reads HQ's own data (`admin_studio_glance.ts:10-12`). | #2376, a deployed branch | **NOW as "HQ-held accounts · axal.vc"** with `SCOPE_NOTE` (`insightsModel.js:28`), as Insights' one-option scope does (`AdminInsights.jsx:239-255`) |
| "New program" (`dc:469`) | Registry write | **N** | P1 | **Do not draw until P1** |
| "Studio: All ▾" filter (`dc:469`) | Studio filter | **N.** There is nothing to filter by. | a deployed branch, #2376 | **Omit** |
| Tab strip "Catalogue · Proposals [2]", amber count (`dc:469`, `dc:531`) | Tabs | Catalogue is frontend. Proposals and its count are **N**. | P2, P11 | **Omit the strip until P2** (one tab is no strip) |
| Tiles, joins, waiting | As PG1 | As §1b–§1d. The Super Admin passes every `requireAdmin` read; strategic access is still **N**. | as §1 | as §1 |
| Credits chart and the "Credits paid out" tile | As PG1 | **P** for the Super Admin: R14 grants (newest 200, no spends, deductions netted in) | P1 | **Not read here yet.** A capped grant list is not a monthly total. |
| Card grant badge "Granted to [n] studios" or "HQ only", linking to Licences › Program grants (`dc:341-349`, `dc:351`) | Grant counts | **N** (#2376), and **W** if drawn, because no studio exists. HQ's Licences page has no program-grant tab: `git grep -n -i program frontend/src/pages/admin/AdminLicences.jsx` finds nothing (route `fe/App.jsx:2708`, `hqOnly`). `/admin/licences/programs` is not a route (§8). The Admin's own My Licence tabs (`fe/lib/licencePage.js:24-31`) have no Programs tab either. | #2376 | **NOW** with "HQ-held" where the canvas draws a studio count, and the canvas's own "HQ only" on AI-native, Investor and Product testing (`dc:342`, `dc:344`, `dc:349`), which is true today. The counts wait for #2376 and a deployed studio. |
| "Needs you" hidden on HQ cards (`dc:354`) | Design | — | — | **NOW** |
| Product testing "[3] open · [48] applicants" with Open (`dc:349`, `dc:352`) | Two counts | **P.** R13. "Open" = `status='open'`. Nothing writes `testing`, which is only ever read (`wk/services/testing.ts:308`, `:372`, `:519`, `:577`). "Applicants" excludes withdrawn and includes declined (`:133`). | #2382, #2377 | **NOW with a caveat:** applicants means everyone who applied and did not withdraw. Open → `/admin?tab=product-testing` (`fe/pages/AdminPage.jsx:57`, `:245`) until #2382 builds `/admin/platform/product-testing`. |
| Learning card for the Super Admin | Programs and learners | **E.** R11 returns every program (`learning_programs.ts:115`); count the published ones. Distinct learners as in §1g. | — | **NOW.** Open → `/learning/studio/programs` (`fe/routes/learning.jsx:45`, `hqOnly`). |
| Referral partners card for the Super Admin | Two counts | The commission reads are readable (`network.ts:570-592`), but "partner" and "signed terms" have no store | P5 | **Not read here yet.** Open → `/admin/commissions` (`fe/App.jsx:2700`). |
| Callout "Which studio holds which program, and on what grant terms, is set on Licences › Program grants." with "Open Program grants" (`dc:369`) | Callout and link | **N.** The target does not exist. | #2376 | **Do not draw until #2376** |
| "Proposals from studios": Program, Studio, Sent, Status, Decide; Studio, Status and "Sort: Oldest first"; "1–3 of [3]" (`dc:365-368`) | HQ's proposal queue | **N** | P2, P11 | **Do not draw until P2** |
| The rail on PG2 (`dc:536`) | Eadwyn | HeldZone fixes the rail's role to `admin` (`HeldZone.jsx:51`). No Super Admin rail key names Programs. The Programs keys are only at `railPages.js:280-283`, and the alias at `:387`. | P8 | **NOW** with the Admin key |

---

#### 4. PG3 · Catalogue · dark (`dc:213`, `dc:215-216`, `dc:219`, `dc:473`; `grid:47`)

| Block | What it draws | Source | Owner | Now / placeholder |
|---|---|---|---|---|
| Ground #0b1220, cards #111827, raised #1f2937, ink #e5e7eb, muted #9ca3af, hairline #374151 (`dc:216`) | Dark tokens | **E.** Exactly the `.dark` tokens at `fe/index.css:144-156` | — | **NOW**, with explicit `dark:` pairs, as `AdminInsights.jsx:330-338` does |
| Moved notice in dark: lavender #211f3d with edge #4c3a8a (`dc:216`, `NOTE('v')` `dc:251`) | Status line | **E** as a pair, not a token: Insights' notice uses `dark:bg-violet-950/40 dark:border-violet-800` (`AdminInsights.jsx:334`) | — | **NOW** with Insights' pair |
| Status pairs: positive #34d399, destructive #f87171, amber #fcd34d (`dc:216`) | Pills, delta, Overdue flag | Frontend | — | **NOW** |
| Chart palette: only violet changes, to #a78bfa (`dc:216`, `S` at `dc:219`) | Series colours | **E.** `InsightsCharts.jsx:18-31`; D915's rule "No second palette and no new `axal-*` token" (`documentation/architecture/decisions/D915.md:171`). `fe/index.css` has no chart tokens (`rg -- "--chart\|--series"` finds nothing). | — | **NOW.** The muted series (#6b6577) on #111827 is about 3.2:1, just above the 3:1 floor for marks. |
| Every block | Same data as PG1 | As §1 | as §1 | as §1 |

---

#### 5. Figures that would be wrong today: do not draw until fixed

| # | Figure | Why it is wrong | Fixed by |
|---|---|---|---|
| 1 | Scope tooltip "Every figure on this page is this licence's" (PG1); "All studios" / "Figures across every studio" (PG2) | Every read is HQ's own database; `admin` is unscoped (`tenancyScope.ts:64`) | Use the HQ-held chip now; #2376 and a deployed branch later |
| 2 | "Waiting for you" [21] as the sum of five queues; Refer & Earn's "Needs you" including strategic | Strategic access has no read, and a partial sum is smaller than the truth | P4 (read), #2390 (lane) |
| 3 | "Waiting for you" counting `more_info_needed` as waiting on the admin | That status waits on the referrer (`referralSubmissions.ts:51-56`; `approvalSources.ts:122-124`) | S-AGE / #2390 to decide; label it now |
| 4 | Perk listings counted from R9 without the `in_review` filter | A draft is not reviewer backlog (`approvalSources.ts:31-34`; `perks.ts:773`). No route writes one today (`perks.ts:556-560`). | Filter to `in_review` client-side |
| 5 | Lab "in the [cohort]" from `participant_count` | Active only; drops on incorporation; 0 before activation (`admin_cohort.ts:60-63`, `:71`; `spinout_lab.ts:239`, `:250`) | Use R5's counts under S-LAB |
| 6 | "Lab applications" weekly series straight from R2 | A failed read draws zeros (`admin.ts:1205`). With 200 rows back, pending-first ordering leaves the older weeks part-filled (`:1200-1202`). | The client guard and the decided-row horizon (§1c) now; Worker honesty in #2374 |
| 7 | "Lab applications" weekly from `cohort_applicants.created_at`; the cohort's "oldest" | Adoption at close and roll-forward rows are not submission times (`cohortApplications.ts:371-376`; `mig/157:20-21`) | Use `spinout_applications.created_at` |
| 8 | Perk listing ages, "oldest" and bands from `created_at` | A listing edited back to review keeps its first `created_at` (`perks.ts:629`) | Band on R9's `updated_at` now (`:771`, `:630`), labelled "since last edit"; a `submitted_at` stamp (P1/#2390) would be exact |
| 9 | Learning learners summed across programs | Double-counts people in two programs (`learning_programs.ts:112`) | Distinct over R12 |
| 10 | "Credits paid out", monthly grants or spends from R14 | Newest 200 only, no spends, deductions netted, revoked grants listed (`admin_credit_rules.ts:88-89`, `:98-99`, `:107`); Super Admin only | P1 |
| 11 | A "Referrals" credits segment at zero, or "not paid as credits" | No perk-credit referral mechanism exists (§1e), but intro credits are paid per referred signup (`introductions.ts:247-262`) | P4, O-CRD; word it "not paid in perk credits" |
| 12 | Perks "[n] claims" from R10 | `claim_count` is not served (`perks.ts:382-401`) | P1 |
| 13 | Any grant badge beyond the held mode's: "Granted to your studio", "Granted to [n] studios", "[2] not granted" | No grant store and no studio deployed; PG1 draws no "Not granted" card | #2376 |
| 14 | Card copy: Refer & Earn "Every member · Open" and "for credits"; Perks "Every member" and "members claim"; Referral partners "Join: By invitation" and "under signed terms" | `fe/App.jsx:3497` against `refer_earn.ts:95`; no perk-credit referral rewards; `perks.ts:127`; `network.ts:471-472`; no terms store | Reword now; O-EXP, P4, P5 |
| 15 | R8 counts drawn as totals when 200 rows come back | No total (`refer_earn.ts:262`, `:269-282`) | P4 (paged list with a total) |
| 16 | Overdue at 2 days beside Approvals' 72 h band | The two boards would disagree on one item | S-AGE |
| 17 | Learning "[n] programs" straight from R11 | Counts drafts and archived programs too (`learning_programs.ts:110-117`) | Count `status === 'published'` client-side |
| 18 | Refer & Earn bands from one unfiltered R8 call | Newest first, so a cap cuts the oldest waiting rows (`refer_earn.ts:274`) | One call per open status (`:266`), checked against R1's count |
| 19 | "Joins per week" with "people per week" | Referral submissions and Lab applications are not people joining | Reword the axis |
| 20 | "Nothing has waited over 7 days" as a flat claim | Strategic access is unread | "Of the queues read, …" |

#### 6. Buildable NOW with no Worker logic change

One shell item needs a single data line in a Worker file: the redirect line in `wk/services/redirectRoutes.ts` (as D893 did). Everything else below is frontend only.

- **Shell (PG1, PG2, PG3, PG1h):**
  - the `/admin/programs` route and the Admin sidebar row, with `match` as prefixes (§1a) and the d286 pins updated (`:55`, `:83`, `:326`);
  - the HQ sidebar row for PG2 (`super_admin_shell.test.mjs:67`);
  - the redirect from `/admin/held/programs` with the moved notice, plus the `redirectRoutes.ts` line (`redirect_hits_2301.test.mjs:38-43`) and the reachability pins (`admin_route_reachability.test.mjs:472`, `:476`);
  - doors written as literal `to="…"`, or the page's files listed in the reachability test's `COMPOSED` map, as D915 did (`admin_route_reachability.test.mjs:281-288`), so the walk can reach the consoles HeldPrograms links today (`HeldPrograms.jsx:10-14`);
  - the title, the line and the HQ-held chip from one constant;
  - "Updated" and refresh;
  - the rail key moved to `/admin/programs` (`railPages.js:280`, `railOptions/admin.js:61`);
  - dark mode on Insights' palette and Insights' notice pair.
- **Tiles:**
  - "Waiting for you" over the four readable queues, labelled as four, with "oldest" (caveats in §1b);
  - "Programs running" and "[2] not offered yet · [1] proposed", only if S-RUN accepts the frontend constant.
- **Joins per week:** Lab applications (R2 plus the guard), Referrals submitted (R8), and Learning enrolments (R12, per program). Each is labelled with how far back its rows reach. The axis is reworded.
- **Waiting by program:** four rows (Lab applications, Refer & Earn reviews read per status, Perk listings filtered to `in_review` and banded on `updated_at`, Office-hours hosts). Doors go to today's consoles.
- **Credits chart:** the "1 credit is worth $1" line only.
- **Catalogue:**
  - nine static cards with status pills and the held mode's badges ("HQ-held", "Not offered yet", "Runs at HQ");
  - Lab: applications waiting and Needs you;
  - Mentor: mentors, changed roles in Needs you, and coverage plus no-mentor once S-COV is set;
  - Refer & Earn: referrals and converted, with the 200 caveat, and reviews as Needs you;
  - Perks: live and Needs you;
  - Learning: published programs and distinct learners;
  - Product testing: static for an Admin; R13 figures for the Super Admin;
  - every "Open" link to today's console.
- **PG1h:** all of it.
- **PG2:** the HQ row, the badge, the HQ-held scope, cards as above ("HQ only" where the canvas has it), and Product testing's figures.

#### 7. Honest placeholders

Use three labels and keep them apart:
- **Not recorded** (`Unrecorded`): no store or mechanism exists.
- **Not read here yet** (`Unrecorded` with its words overridden through `children`, `fe/ui/Honesty.jsx:37-50`): the data is stored, but no read serves or sums it.
- **Could not be read** (`Unreadable` with `what` and `claim`, `Honesty.jsx:62-72`): a read failed.

Today's landing pins a glance failure on every card, including cards no read backs (`heldFigures.jsx:53-56`: the unreadable state is checked before the not-recorded one). The new page must not: a failed read marks only the blocks it feeds.

| Block | Label | Waits for |
|---|---|---|
| The Referrals segment in "Credits in and out" | Not recorded ("Referral rewards are not paid in perk credits yet.") | P4, O-CRD |
| "People taking part" and its delta | Not read here yet | P1, S-PPL |
| "Credits paid out" and "spent on perks"; the granted stacks and spend bars | Not read here yet | P1 |
| Perks "[n] claims"; the "Perk claims" series | Not read here yet | P1 |
| The "Strategic referral access" row, and its share of Refer & Earn's Needs you and of "Waiting for you" | Not read here yet | P4, #2390 |
| Referral partners' two figures | Not read here yet | P5 |
| Weeks the period control asks for beyond the rows a read returns | Not read here yet | P1 (`weeks=`) |
| "Propose a program", "Your proposals", "New program", "Proposals [2]", "Proposals from studios", the Program grants callout, "Studio: All ▾", grant counts | Omit (draw nothing) | P1, P2, #2376 |
| AI-native and Investor figures | The canvas's own "Not running" / no figure (true) | P6, P10, O-AIV, O-VER |
| R2 empty while R1's cohort count is above 0 | Could not be read ("Lab applications could not be read. That is not the same as none.") | — |
| R3 empty | Cannot be told apart from none (`admin.ts:1427-1430`); feed no figure from it | #2374 |
| Any other failed read (an R1 lane with `count: null`; R4–R15 non-2xx) | Could not be read, only on the blocks that read feeds | — |

#### 8. Searches that found nothing

| Search | Where | Result |
|---|---|---|
| `git grep -n -i -E "program_grants\|programme_grants\|program_proposals\|programme_proposals\|program_registry\|programs_registry\|licence_programs\|program_playbook"` | `cloudflare-worker`, `frontend/src`, `backend` | No match (exit 1). The newest migration is `mig/535_dd_advisor_subject.sql`. |
| `git grep -n -E "/admin/programs\|/api/admin/programs\|my-licence/programs\|licences/programs\|admin/platform/product-testing"` | `cloudflare-worker/src`, `frontend/src`, `frontend/test`, `scripts` | No match (exit 1) |
| `git grep -n "referral_strategic_access"` | `cloudflare-worker/src`, `cloudflare-worker/sql`, `frontend/src`, `backend` | Only the CREATEs (`mig/175:86`, `schema_baseline.sql:3974`, `referralSubmissions.ts:155`), two per-member SELECTs (`:409`, `:419`) and one INSERT (`:627`). No admin read, and nothing writes `granted` or `declined`. |
| `grep -ni refer mig/381_credit_reward_rules.sql`; `git grep -n -i credit_reward_rules -- cloudflare-worker/sql/migrations` | The credit rule seeds | Only `REFERENCES` (`:35`); the one other migration is an UPDATE (`mig/407:15`). No referral rule. |
| `git grep -n "grantCredits("` | `cloudflare-worker/src` | Four callers, none for a referral (§1e), plus the definition (`creditGrants.ts:134`) and a comment (`bugBounties.ts:151`) |
| `git grep -n "referral_reward"` | `cloudflare-worker/src`, `cloudflare-worker/sql/migrations` | Found in the **introduction-credit** ledger only (`introductions.ts:72`, `:261`, `:274`; `mig/150:63`), a different currency from perk credits |
| `git grep -n "'draft'" -- cloudflare-worker/src/routes/perks.ts`; `git grep -n "INSERT INTO perks"` | Perk listing states | `draft` appears only in the queue filter (`:773`); the one INSERT writes `in_review` (`:556-560`) |
| `git grep -n -i program frontend/src/pages/admin/AdminLicences.jsx` | HQ's Licences page | None: no program-grant tab |
| `git grep -n -i -E "investor.cohort\|investor_cohort"` | `cloudflare-worker/src`, `cloudflare-worker/sql`, `frontend/src` | None |
| `rg -- "--chart\|--series"` | `frontend/src/index.css` | None |
| Lanes for Perk listings, Strategic referral access, Office-hours hosts, Spin-Out Lab applications | `ApprovalLaneKey` (`approvalSources.ts:47-49`) | None. `referrals` and `cohort` are the only program lanes. |
| An HQ per-item approvals read | `wk/routes/branch_approvals.ts:51-54`; `git grep -n "approvalBoard("` | Branch tier only (`wk/util/branch.ts:107-111`); the other caller is the branch assignment service (`approvalAssignments.ts:198`) |
| A cross-member perk-credit sum | `git grep -n "SUM(.*delta)" -- cloudflare-worker/src` | Per-user balances and the bounty cap only |

---

#### Corrections

1. **HEAD.** HEAD is `fbbb4c8`, not `99466ce`; six commits sit on `6205ee6`. The new commit touches none of the cited files. The App.jsx badge range is `:1321-1330`, and `:1819-1834` (cited nowhere) was dropped from the list.
2. **The redirect needs a Worker file.** §6 claimed "no Worker change", but turning `/admin/held/programs` into a redirect fails `redirect_hits_2301.test.mjs:38-43` unless `wk/services/redirectRoutes.ts` gains a line (D893 did exactly that in `54bec7e`). The reachability test's `COMPONENT_TARGETS` (`:476`) needs an entry too. Both are now in §1a and §6.
3. **The sidebar `match` was wrong.** "`match` covering `/admin/programs/*`" would fail `held_admin_shell_d286.test.mjs:93-94` (each entry must be a registered route). `match` already works by prefix (`SidebarNav.jsx:211-213`), so the entry is `/admin/programs`. Added the d286 pins (`:55`, `:83`, `:326`, `:350`, `:357-360`); the PG1h row had cited `:350` for the scope paragraph, but `:350` pins the rail's role.
4. **The Lab applications series horizon was wrong.** R2 sorts pending first, then newest (`admin.ts:1200-1201`), so "complete back to the oldest row" is wrong when 200 rows return; it is complete only back to the oldest decided row. The guard's basis is clarified: NOT NULL with no foreign key, and both writers take the id from `spinout_applications`.
5. **The "Referrals" placeholder copy was false.** "Referral rewards are not paid as credits yet" is untrue: a referred signup earns one introduction credit (`introductions.ts:247-262`). It now says "not paid in perk credits". Refer & Earn's "for credits" note is adjusted the same way.
6. **Perk ages: a fix exists today.** R9 serves `updated_at` (`perks.ts:771`, reset at `:630`), so bands no longer wait for a `submitted_at` stamp. Also noted that no route writes a `draft` perk (`:556-560`).
7. **R14 was not "grants only".** Manual lines include deductions and revoked grants stay listed (`creditGrants.ts:298-299`; `admin_credit_rules.ts:107`). Lab rule seeds are at `mig/381:48-77`, not `:48-75`.
8. **Learning "[4] programs" downgraded E → P.** R11 has no status filter (`learning_programs.ts:110-117`), so drafts and archived programs count; filter to published.
9. **Mentor "Needs you" downgraded E → P.** The no-mentor half depends on the same undefined cycle set as coverage (S-COV, broadened). Also corrected "cycles exist only for this month and the next two": past cycles persist; only future ones are capped.
10. **The sub-line correction.** "[2] not granted … contradicts the cards" was overstated: the two not-granted programs are the "Not offered yet" cards, and the word is the wrong badge. NOW is "[2] not offered yet · [1] proposed".
11. **S-HELD is answered by the canvas.** `dc:351` maps only granted cards to "HQ-held"; AI-native and Investor keep "Not offered yet" and Product testing keeps "Runs at HQ". §1f and PG2 badges were changed to match (PG2 uses the canvas's own "HQ only" where it draws it).
12. **The PG2 Licences cite pointed at the wrong page.** `licencePage.js:24-31` is the Admin's My Licence. HQ's page is `AdminLicences.jsx` (`App.jsx:2708`); the grep for "program" there finds nothing. Both are now cited.
13. **Refer & Earn bands and "People taking part".** One newest-first R8 call cuts the oldest waiting rows, so the bands now use per-status calls (`refer_earn.ts:266`) checked against R1's count. "People taking part" now explains that the reads share no key (R8 email only; R12 uid only).
14. **Strategic access.** The row is now "store E (with `created_at`, `mig/175:86-94`), read N", and the "Nothing has waited over 7 days" foot is qualified, since that queue is unread.
15. **Failure states.** §7 listed R3 among 5xx failures, but R3 returns `[]` with 200; a separate row now covers it. R5's and R7's inner joins against count-without-join (`admin_cohort.ts:260`; `approvalSources.ts:64-68`) are now flagged, and R3's oldest-first cap is noted.
16. **Smaller cite fixes.** The `railPages.js:280` key is quoted literally and `railOptions/admin.js:61` added. `admin_studio_glance.ts:9-11` → `:10-12`; the `studioGlance.ts` rule → `:191-206`; `network.ts:470-473` → `:471-472`; `perks.ts:254` → `:253-254`; `heldFigures.jsx:53-54` → `:53-56`.
17. **Blocks the section skipped.** Added the "Joins"/"people per week" axis copy (W), PG3's dark lavender notice pair, the Perks partner redirect (`App.jsx:2960`), the R7 and R8 mounts, and the product-tester cite (`adminInsights.ts:58-59`).

### Mentor cohort access and Investor cohort access: the boards against the code (PG4, PG5, PG5s, PG6, PG6d, PG11, PG11d)

**This is a snapshot, not a spec.** I read it without editing anything, on `claude/spinout-lab-workspace-wuyyqd`. HEAD moved while I was checking: the task named `6205ee6`, the first draft was read at `99466ce`, and HEAD is now **`fbbb4c8`**.
- Six commits have landed since `6205ee6`: `6c355ff`, `24136bf`, `0b85c2b`, `0296848`, `99466ce` and `fbbb4c8`.
- `git diff --stat 6205ee6 HEAD` touches nothing under `cloudflare-worker/`. In `fe/App.jsx` it adds four lines (`:2838-2841`, the D915 Events routes).
- `fbbb4c8` changes only `fe/pages/cycles/CycleRoute.jsx`, `fe/pages/cycles/PhoneModulePage.jsx`, `fe/pages/raise/narrative/NarrativeTool.jsx`, `fe/pages/raise/narrative/narrativeModel.js`, `D906.md` and two tests. None of them is cited here.
- **That moves `/admin/advisor-cohorts` from `:3287`, where every lead report cites it, to `fe/App.jsx:3291`.**
- Every other code cite reads the same at `6205ee6` and `fbbb4c8`, with one exception. The Events desk vocabulary file `fe/pages/admin/events/eventsDeskModel.js` is new since `6205ee6`: `git cat-file -e 6205ee6:frontend/src/pages/admin/events/eventsDeskModel.js` fails.

**Prefixes:**
- `wk/` = `cloudflare-worker/src/`
- `fe/` = `frontend/src/`
- `mig/` = `cloudflare-worker/sql/migrations/`
- `dc:` = `design/incoming/Programs Page.dc.html`
- `bd:` = `design/incoming/Programs · Boards.dc.html`
- `issue:` = the #2371 body as saved for this run

**Notation:** E = exists, P = partly exists, N = does not exist, W = would give a wrong figure today. Bracketed canvas values are samples, never data.

#### 0. Key

##### 0.1 Reads
| Id | Read | Gate | Shape and limits | How it fails |
|---|---|---|---|---|
| **M-R1** | `GET /api/advisors/admin/cohort-assignments` (`wk/routes/advisors.ts:2964-2996`; mounted `wk/index.ts:1330`, alias `/api/mentors` `:1331`). Client `api.adminAdvisorCohortAssignments` (`fe/lib/api.js:2584`). | **Role only**: `requireAuth` plus `isAdmin` (`:2966-2967`; `isAdmin` is `wk/routes/_t13t14t15_helpers.ts:14-16`) | **Fields** (`:2975-2979`):<br>• `items[]` with id, uid, advisor_user_id, cohort_cycle_id, assigned_at, unassigned_at, is_active, note, advisor_name and advisor_email;<br>• advisor_role, which is the **current** role.<br>**Not returned:**<br>• the account's own `users.is_active`, so a deactivated holder looks the same as a working one (see F1);<br>• `assigned_by_admin_id`.<br>**Rows:** a `LEFT JOIN users` (`:2981`), so a deleted user has a null name and role. Active and ended rows, newest assigned first, `LIMIT 500`, no total (`:2982-2983`).<br>No founder count and no hidden count. | 500 through `mapError` (`:2995`). A constraint failure would be a 400 (`_t13t14t15_helpers.ts:140-152`). |
| **M-R2** | `GET …/assignable` (`:2932-2955`). Client `fe/lib/api.js:2585`. | Role only (`:2934-2935`) | Users whose role is advisor, by name, `LIMIT 500` (`:2941-2943`), each with `has_advisor_profile` (`:2951`). **There is no `is_active` filter**, so deactivated accounts are offered. | 500 |
| **M-R3** | `GET /api/admin/cohort/timeline` (`wk/routes/admin_cohort.ts:49-76`; mounted `wk/index.ts:920`). Client `api.adminCohortTimeline` (`fe/lib/api.js:2591`). | `requireAdmin` (`:50`) | The 12 newest cycles (`:53`), each with:<br>• its windows (`:57-59`);<br>• `participant_count`: active users whose `spinout_lab_started_at` falls in [start_at, end_at) (`:60-63`), with `?? 0` (`:71`);<br>• `status_counts` from `company_week_status` (`:64-67`).<br>`SELECT *` also returns `status` and `app_status`. | No try block, so a failure is a 5xx |
| **M-R4** | `GET /api/admin/cohort/applications` (`admin_cohort.ts:238-330`). Client `fe/lib/api.js:2595`. | `requireAdmin` (`:239`) | 12 cycles (`:246`). Each has `label` (`:319`), `applicant_counts` by status (`:320`) and `meets_minimum` (`:321`). Each also has up to 200 applicants **with names and emails** (`:255-264`). | 5xx |
| **M-R5** | `GET /api/admin/lab-hosts?status=` (`wk/routes/lab_hosts.ts:198-222`; mounted `wk/index.ts:1327`). Client `fe/lib/api.js:2572`. | `requireAdmin` (`:199`) | Items for one status (pending by default, `:200-201`), `LIMIT 500` (`:214`), each carrying `capacity`. **`counts` are all-time and cover every capacity: investor, advisor, partner** (`:41`, `:216-221`). | 5xx |
| **M-R6** | Glance `no_queue` (`wk/services/studioGlance.ts:208`), served by `GET /api/admin/studio/glance` (`wk/routes/admin_studio_glance.ts:30-37`). Only the HQ tier carries it (`studioGlance.ts:308`). | `requireAdmin` (`admin_studio_glance.ts:32`) | "Advisor cohort access" is in `NOT_LANED`, with the reason "Access is assigned by an admin; an advisor has no way to request it" (`wk/services/approvalSources.ts:273`) | `mapError` (`admin_studio_glance.ts:34-35`) |
| **M-R7** | `GET /api/admin/users?q=` (`wk/routes/admin.ts:50`) | `requireAdmin` (`:51`) | Returns role, is_active and kyc_status, among other fields (`:89`, `:96`).<br>**Limits:** 100 rows by default, at most 200 (`:59`). A query needs at least two characters (`:80-82`). It searches name and email only and has no role filter (`:96`). | 400 on a one-character query |

##### 0.2 Writes
| Id | Write | Gate | What it does |
|---|---|---|---|
| **M-W1** | `POST /api/advisors/admin/cohort-assignments` (`advisors.ts:2998-3056`). Client `fe/lib/api.js:2586`. | **Role only** (`:3000-3001`). It is not `requireAdmin`, so the D135 freeze (`wk/auth.ts:523-528`; `refuseWhileFrozen` `:568-590`) never runs. It has no `requireBranchNotSuspended` (`wk/auth.ts:752`), which returns at once on HQ anyway (`:753`). | **Body:** `{advisor_user_id, cohort_cycle_id, note ≤1000}` (`:3045`).<br>**Refusals:**<br>• 400 for ids that are not integers (`:3006-3008`);<br>• 404 for no such user (`:3013`);<br>• 400 if the target is not an advisor (`:3023-3027`);<br>• 404 for no such cycle (`:3028-3030`).<br>The target check reads only id and role (`:3011-3012`), so **a deactivated account is accepted**.<br>**The upsert reactivates the pair's single row:** `is_active=1` and `unassigned_at=NULL`, and it overwrites `assigned_at`, `note` (to NULL when none is sent) and `assigned_by_admin_id` (`:3036-3045`).<br>**Re-posting a pair that is already active starts a new episode.** The same sweep sends each told founder a new "can see you" notice. It then sends an "can no longer see you … has ended" notice for the earlier episode (`cohortAdvisorAccess.ts:101-118`, then `:124-161`, condition `:132`). The last thing the founder reads is false.<br>**Response:** the row plus `founders_notified`.<br>• That figure counts only "started" notices newly sent in this call, capped by the sweep's 500-row limit (`cohortAdvisorAccess.ts:70`, `:96`, `:106-107`).<br>• It reads **0 when the sweep throws** (`:3050-3054`).<br>**No audit row:** in this file `logAdminAction` is called only at `:3708`, `:3926` and `:4323` (import `:13`). |
| **M-W2** | `DELETE …/:id` (`:3063-3082`). Client `fe/lib/api.js:2588`. | Role only (`:3065-3066`) | Sets `is_active=0` and `unassigned_at=now` (`:3072-3074`).<br>**It does not check `is_active`,** so ending an already-ended row moves its end date to now (`:3068-3074`).<br>It records no actor: 206 has no `ended_by` column (`mig/206_advisor_cohort_assignments.sql:41-54`).<br>404 when the row is missing (`:3070`).<br>`founders_notified` reads 0 when the sweep fails (`:3076-3080`).<br>No audit row. |

##### 0.3 Facts every board below leans on
- **F1. The mentor's read gate.** A mentor reads only while all three of these hold:
  - the account is active: `getCurrentUser` returns null for `!is_active` (`wk/auth.ts:335`), so `requireAuth` refuses;
  - the current role is advisor (`mayHoldCohortAssignment`, `advisors.ts:2297-2299`);
  - an active row exists (`:2430-2436`; `requireOwnCohort` `:2590-2605`).

  What follows from that:
  - A demoted holder reads nothing, at once (`:2421-2423`). Founders are not told that access ended (`wk/services/cohortAdvisorAccess.ts:30-34`).
  - **A deactivated holder also reads nothing, but nothing else knows it.**
    - M-R1 does not return the account's state (0.1).
    - The start-notice sweep checks the role only (`cohortAdvisorAccess.ts:85`), so founders are still told such a holder "can see" them.
    - The founder's own access list reports `can_see` from the row and the role only (`:199`, `:207`).
  - None of the three checks looks at the cycle's status. A mentor keeps reading a finished cohort until an admin ends the row (`advisors.ts:2430-2446`).
- **F2. The Week-1 gap.** Every mentor read, every founder notice and the founder's hide switch take cohort membership from `DISTINCT company_week_status` rows (`advisors.ts:2439-2446`; `cohortAdvisorAccess.ts:12-13`, `:83-84`, `:190`, `:223`).
  - That table has one writer, `applyWeekDecision` (`wk/services/cohortTiming.ts:318-339`). `rg "INSERT INTO company_week_status"` finds only `:321`.
  - It is called at a week's deadline (`:430`, `:443`, inside `decideUserWeek` `:411`, run from `:530` and the grace sweep `:567`). It is also called on an admin grace or override (`admin_cohort.ts:145`, `:176`).
  - The week-unlock job writes no row (`cohortTiming.ts:487-511`).
  - **So from a cohort's start until its Week-1 deadline (day 8, 00:00 ET), an assigned mentor reads no founders, no founder is told, and no founder can hide.**
    - The one exception is a founder whose Week 1 an admin has already graced or overridden.
    - This is a reading of the code, not a production check.
- **F3. Three different counts of "founders in a cohort".**
  - **Timeline `participant_count`.**
    - It is 0 until founders are activated. The cron activates them at the cycle's start (`wk/services/cohortApplications.ts:513-516`).
    - **An admin who accepts by hand activates at once,** stamping the cycle's own start (`wk/routes/admin.ts:1320-1324`). So a cohort that has not started can already count founders.
    - It shrinks when a founder incorporates, because incorporating sets `spinout_lab_active = 0` (`wk/routes/spinout_lab.ts:239`, `:250`).
  - **`company_week_status` membership.** It is 0 during Week 1 (F2).
  - **Approved plus activated applicants** (`admin_cohort.ts:320-321`).
  - None of the three equals what a mentor can read in Week 1.
- **F4. The calendar.**
  - Cohorts are monthly, four weeks long, in `America/New_York` (`cohortTiming.ts:28`, `:69-85`).
  - The deadline is 00:00 ET on day 1+N·7, and it is inclusive (`:104-106`). `end_at` is day 29 at 00:00 (`mig/156_cohort_timing.sql:16`).
  - A cycle's status goes `scheduled` → `active` at the Week-1 unlock (`cohortTiming.ts:499`) → `completed` (`:543`).
  - **Nothing moves a date.**
    - `rg "UPDATE\s+week_windows" cloudflare-worker/src cloudflare-worker/sql` exits 1.
    - The only `UPDATE cohort_cycles` statements set `status`, `app_status`, the application window and `force_proceed`, never `start_at` or `end_at` (`cohortTiming.ts:499`, `:543`; `cohortApplications.ts:284`, `:378`, `:471`, `:548`; `admin_cohort.ts:598`).
    - The rows are `INSERT OR IGNORE` (`cohortTiming.ts:206`, `:214`).
  - Cycles exist for the current month and the next two (`cohortApplications.ts:312-317`). Today that is October, November and December 2026. A later cohort cannot be assigned (404, `advisors.ts:3028-3030`).
- **F5. One row per pair.** 206 keeps a single row per advisor and cycle (`mig/206:31-33`, `:53`).
  - A re-assign overwrites the earlier episode's dates and note (`advisors.ts:3041-3043`). That breaks 206's own promise that the record says who had access and when (`mig/206:26-29`).
  - An earlier episode survives only as `cohort_advisor_notices.episode_at` (`mig/367_cohort_advisor_founder_notice.sql:29-37`), and only if at least one founder was told during it (F2). No admin route reads it.
- **F6. The opt-out.**
  - It is per (founder, advisor), not per cohort (`mig/367:42-49`).
  - A re-hide overwrites `opted_out_at` and clears `withdrawn_at` (`cohortAdvisorAccess.ts:233-237`), although 367 says the record is kept so that "who could see whom, and when, survives" (`mig/367:23-24`).
  - `rg -n "cohort_advisor_optouts" cloudflare-worker/src` finds only `cohortAdvisorAccess.ts` (`:49`, `:89`, `:185`, `:230`, `:234`) and the dev ensure (`wk/services/advisorStoresSchema.ts:175`, `:183-184`). **No admin read counts hidden founders.**
- **F7. No program store.** `rg -n "admin/programs|mentor-cohorts|investor-cohorts|Mentor cohort access|Investor cohort access" frontend/src cloudflare-worker/src frontend/test scripts` exits 1. No registry, playbook, grant, pause or program-activity table exists (the searches are in the catalogue map's §1.1).
- **F8. No subsidiary is deployed.**
  - `infra/branches/` holds only `README.md` and `_example.json`. That folder is the only place a deployment is declared (`infra/branches/README.md:1-8`).
  - So every grant badge must read "HQ-held". The canvas's own held mapping is drawn for catalogue cards (`dc:351`), and PG1h states the rule for every program (`dc:491`).
  - The chrome already draws "HQ-held · axal.vc / HQ-HELD" (`fe/App.jsx:1327-1328`).

##### 0.4 Owners and dependencies
**Parts of #2371's "Suggested split"** (`issue:508-520`):

| Code | Work |
|---|---|
| **#2371·1** | Registry, playbook store and catalogue read |
| **#2371·3 / #2376** | Grant state |
| **#2371·6** | Worker: investor cohort access |
| **#2371·7** | Worker: mentor routes to `requireAdmin`, plus hidden-founder counts |
| **#2371·8** | Frontend: the catalogue and its redirects |
| **#2371·9** | Frontend: the program page template and the Mentor pages |
| **#2371·10** | Frontend: the Investor page |

**Other issues:**

| Issue | What it owns here |
|---|---|
| **#2374** | The Lab console's address and its tabs |
| **#2375** | The frame, tab strip, crumb and redirect pattern (`issue:487`) |
| **#2376** | The grant store; the Admin reads grant terms on `/admin/my-licence/programs` (`issue:488`) |
| **#2319** | The old-address list |
| **#2369** | The advisor roster, which Mentor cohort access links to (`issue:494`) |

**Owner decisions:**

| Code | Decision |
|---|---|
| **O-FND** | One definition of a cohort's founders, shared by the chart, the pickers, "Founders visible" and the mentor reads. It includes whether mentors see founders during Week 1 (F2, F3). It decides who may read founder names and emails, and it must respect 206's rule that the Lab keeps sole authority (`mig/206:12-18`). |
| **O-VER** | What "verified investor" means. #2371's Backend list reads "Owner to decide" (`issue:479`). |
| **O-NDA** | One cohort NDA, or the existing pairwise founder↔investor NDA |
| **O-INT** | Which store holds an intro request, and the founder's accept or decline |
| **O-SEE** | What an investor sees, and whether email is ever visible |

**S1 calls (not owner):**

| Code | Call |
|---|---|
| **S-PER** | What "this period" means. Program pages draw no period control: only `catHead` sets one (`dc:469`, `:533`). |
| **S-COV** | The denominator for "Cohorts covered", and which cohorts the chart shows |
| **S-HOST** | Whether the hosts card counts every capacity, or advisor-capacity hosts only |
| **S-CSV** | What the CSV export carries, and whether it is a logged Worker export (D893's rule; see table H) |
| **S-CNT** | Whether "Active mentors" counts distinct people or open assignments. The canvas sample counts the six open rows of PG6, including the demoted one (`dc:372`, `dc:389`). |
| **S-GATE** | Whether M-W1 and M-W2 should also call `requireBranchNotSuspended`. Precedent: the Lab's decide route (`wk/routes/admin.ts:1216`). |

---

#### 1. Gap tables

##### H · Program header: the same on PG4, PG5, PG6 and PG6d (Mentor), and on PG11 and PG11d (Investor)
| Block (dc line) | What it draws | Worker source today | Owner/dep. | Now / placeholder |
|---|---|---|---|---|
| Crumb "Programs › [Program]" (`dc:471`, href `dc:468`, rendered `dc:45`) | A link to `/admin/programs` | Frontend only. **N**: `/admin/programs` is not a route (F7). The catalogue is `/admin/held/programs` (`fe/App.jsx:2725`). | #2371·8, #2375 | NOW, linked to `/admin/held/programs` until the catalogue route lands. Precedent: D915's crumb (`documentation/architecture/decisions/D915.md:28`). |
| Title and one line (`dc:371`, `dc:436`; h1 `dc:528`) | Static copy | — | — | NOW |
| Status pill: "Live" for Mentor (`dc:371`, `dc:322`); "Not built yet" for Investor (`dc:436`) | Program status | **N** as a store (F7). Both are true today as static words. The Mentor routes exist (§0.2). No Investor store exists: `rg -n -i "investor_cohort\|investor cohort\|investor-cohort\|cohort_nda\|cohort nda" cloudflare-worker/src cloudflare-worker/sql frontend/src` exits 1. | #2371·1 | NOW as static words |
| Grant badge: "Granted to your studio" for Mentor (`dc:371`); "Not offered yet" for Investor (`dc:436`) | Grant state | **N** (#2376). **W** for Mentor as drawn: no subsidiary is deployed (F8). | #2376 | Mentor: NOW as static "HQ-held". Investor: NOW as static "Not offered yet", which the held mapping leaves unchanged (`dc:351`). |
| Top-bar studio badge "[Studio Lisbon]" (`dc:522`) | Studio name | **W** today. The existing chrome draws "HQ-held · axal.vc / HQ-HELD" (`fe/App.jsx:1327-1328`). | — | NOW: keep the existing chrome |
| Mentor facts strip: "Who: Advisors · Join: Assigned by an admin · Cycle: monthly cohorts of four weeks" (`dc:371`, rendered `dc:60`) | Copy | **E**, and true:<br>• advisor only (F1);<br>• admin-assigned, with no request path (M-W1; `approvalSources.ts:273`);<br>• monthly cohorts of four weeks (F4). | — | NOW |
| Investor facts strip: "Who: Verified investors · Join: Assigned by an admin · Cycle: one Lab cohort" (`dc:436`) | Copy for a program that does not run | **N** (see PG11) | O-VER | NOW as design copy, under the "nothing runs yet" banner |
| Primary button "Assign a mentor" (`dc:371`) | Opens PG6d | **E** M-W1. Gated by role only, so a frozen HQ admin can still assign (§0.2). | #2371·7 | NOW. The gate fix is part 7. |
| Primary button "Give access" (`dc:436`) | Opens PG11d | **N**: no write exists | #2371·6 | Do not draw until part 6. An Admin sees a sentence, not a disabled button (`issue:108`). |
| ⋯ "Pause program (Super Admin)" (`dc:371`) | Program pause | **N**: no program status (F7). PG15c's pause has no store either. | #2371·1 | Omit. A Super Admin gets a sentence until a store exists. |
| ⋯ "Download (CSV)" (`dc:371`) | Export | **N** on the Worker: `rg -n -i "csv" wk/routes/advisors.ts` finds only a comment (`:2226`). A browser-built file from M-R1 would hold at most 500 rows (`:2983`) with advisor **names and emails** (`:2978`). **W against precedent:**<br>• D893's browser CSV holds counts only (`documentation/architecture/decisions/D893.md:51`);<br>• its logged export refuses any file that carries an email (`:177`, `:190`). | S-CSV, #2371·7 | Omit until S-CSV. At most a counts-only browser CSV (mentors per cohort) under D893's rule. |
| Tab strip: Overview, How it runs, People, Queue, Terms, Settings, Activity, as `/admin/programs/<key>[/<tab>]` (`dc:470-471`, rendered `dc:63-66`) | Navigation | Frontend only. **N**: no such routes (F7). Literal `NavLink` precedent: `LicenceTabs` (`fe/pages/subsidiary/LicenceFrame.jsx:50-88`). | #2371·9, #2375 | NOW for Overview, How it runs and People (Mentor) |
| Tab count "Queue [0]" (`dc:471`; `q: 0` at `dc:371`, `dc:436`) | A zero queue | **W**. Mentor access has **no queue**: it is `NOT_LANED` (`approvalSources.ts:273`), and M-R6 carries the reason. The Investor program does not run. | — | Do not draw "[0]" (`issue:422`). Mentor: the Queue tab says "No queue" with M-R6's reason, or the tab is dropped. Investor: "Not running yet". |
| Tabs Terms, Settings and Activity (`dc:470`) | Participant terms, settings, history | **N**: no terms or settings store (F7). The canvas draws no board for these tabs. Activity: see PG4's "Recent activity".<br>The Terms tab's first line comes from the **issue**, not the canvas (`issue:216`). It points to `/admin/my-licence/programs` (`issue:488`), which is not a route. Only `/admin/my-licence` and its five sub-paths exist, six tabs in all (`fe/App.jsx:2713-2719`; `LicenceFrame.jsx:79-84`). | #2371·1, #2376 | Not recorded, with the reason, until part 1 lands |
| Sidebar "Programs" lit (`dc:509-510`) | Shell | The Programs row's `match` covers `/admin/advisor-cohorts` today (`fe/sidebarConfig.js:228-229`) | #2371·8 | NOW, with `match` covering `/admin/programs` |
| Eadwyn spine: "Eadwyn reads the program figures on this page. Nothing changes until you act." (`dc:536`) | Rail | Today's frame note is "Eadwyn reads the advisors and cohorts on this page…" (`fe/pages/admin/AdvisorCohortAssignments.jsx:259`). The rail key is "Admin · Approvals · Advisor cohort access" (`fe/lib/railPages.js:279`, alias `:387`). Investor has no canvas key. A new off-canvas key has no matrix row, and the rail answers 404 `unknown_page` (`wk/routes/ai.ts:458-464`). | #2371·9 | NOW, reusing an existing key (see the shell report) |

##### PG4 · Overview · Mentor cohort access (`dc:475`; caption `bd:48`)
| Block (dc line) | What it draws | Worker source today | Owner/dep. | Now / placeholder |
|---|---|---|---|---|
| Moved notice: "Advisor cohort access is now Mentor cohort access, under Programs." with Dismiss (`dc:475`; `MOVED` `dc:272`) | A one-line status | Frontend only. The pattern exists: `HeldInsightsRedirect` keeps the query and hash and adds `?moved=` (`fe/pages/admin/insights/HeldInsightsRedirect.jsx:12-17`), and the hit is counted at `wk/services/redirectRoutes.ts:137`. Today `/admin/advisor-cohorts` still renders the old page (`fe/App.jsx:3291`). | #2371·8, #2319 | NOW (frontend). It moves these pins:<br>• `railPages.js:279`/`:387`;<br>• `railOptions/admin.js:60`/`:63`;<br>• `HeldApprovals.jsx:98`;<br>• `HeldPrograms.jsx:65`;<br>• `adminStudioOverview.js:386`;<br>• `adminPlacement.js:72-73`;<br>• `sidebarConfig.js:229`;<br>• the tests that pin the address (`frontend/test/advisor_cohorts.test.mjs:185-187`, `held_admin_shell_d286.test.mjs:198`, `:248`, `:299`, `admin_placement_h35.test.mjs:50`, `profiling_trends_d358.test.mjs:93`, `admin_route_reachability.test.mjs:421-424`). |
| Tile "Active mentors [6]" (`dc:372`) | Count | **P**, derived from M-R1: `is_active`, with `advisor_role` compared lower-cased as `mayHoldCohortAssignment` does (`advisors.ts:2298`).<br>**W** if counted on `is_active` alone, because a demoted holder reads nothing (F1).<br>**Still overstated by deactivated holders,** who also read nothing: M-R1 carries no account state (F1).<br>The canvas sample counts open assignments, including the demoted one (S-CNT). | S-CNT, #2371·7 (account state) | NOW, with the rule stated and a note that deactivated accounts are not yet excluded |
| Tile "Cohorts covered [3] of [4]" (`dc:372`) | Ratio | **P**: M-R1 joined to M-R3's cycles (`status`, `app_status`). Only existing cycles can be shown, which today is the current month plus two (F4), so "[Jan 2027]" cannot exist yet. The deactivated-holder caveat applies. | S-COV, #2371·7 | NOW with a caveat: state the denominator, for example "scheduled and active cohorts, postponed left out" |
| Tile "Founders hidden from a mentor [2]", with "A founder can hide from one mentor" (`dc:372`) | Count | **N** as a read. The opt-outs are stored, but no admin read sums them (F6). | #2371·7 | **Not read here yet**, until part 7's counts-only read exists |
| Tile "Ended this period [1]" (`dc:372`) | Period count | **P**: `unassigned_at` from M-R1. **W** in three ways:<br>• the page has no period (S-PER);<br>• a re-assign erases the earlier end (F5);<br>• a second DELETE moves the end date (M-W2). | S-PER, #2371·7 | NOW with a caveat: a fixed label such as "Ended in the last 30 days", and a note that re-assigned pairs keep only their latest episode |
| Chart "Mentors per cohort", with a Chart/Table toggle and a summary sentence (`dc:373`; `TOG` `dc:234`) | Bars | Frontend | — | NOW. The summary sentence is built from the same mentors-only counts. |
| Bar label "[2] mentors" | Mentors per cohort | **P**, derived from M-R1 (active rows held by current advisors), grouped by `cohort_cycle_id` and labelled from M-R3. The deactivated-holder caveat applies. | — | NOW |
| Bar label "· [14] founders" (`dc:373`, also on the "None" bar) | Founders per cohort | **W** if drawn from any one source without a label. There are three definitions, each wrong in some window (F3), and a mentor reads 0 during Week 1 (F2). | **O-FND** | Do not draw until O-FND. Mentors only until then. |
| Amber "! None" bar and the note "[Dec 2026] has no mentor yet." (`dc:373`) | No-mentor state | **E**, derived: M-R3 cycles with no active row held by a current advisor. A cohort whose only holder is deactivated still reads as covered (F1). | #2371·7 | NOW |
| Card "Needs you [2]" (`dc:374`) | Count of the rows below | **E**, derived | — | NOW |
| · "[Dec 2026] starts in [5 days] with no mentor." with Assign | Row | **E**: `start_at` and `app_status` from M-R3, plus M-R1. Postponed cycles are skipped. Assign opens PG6d with the cohort chosen. | — | NOW |
| · "[Name] is no longer an Advisor, but their access is still on." with End access (`dc:374`) | Row | **E**: `advisor_role` against `is_active`. Today's page already computes it (`AdvisorCohortAssignments.jsx:211`). A null role (deleted user) is not flagged there.<br>**W copy:** access is already refused (F1); only the row is open. | — | NOW with corrected copy, as today's page has it (`:227-228`): "…their access is already refused, but the assignment is still open." End access opens a dialog (`issue:421`). |
| Card "Office-hours hosts", with the note "Hosts are approved on the Spin-Out Lab page." (`dc:375`) | Copy | True: the Lab's hosts tab (`fe/pages/admin/AdminSpinoutLab.jsx:764-772`) decides through `requireAdmin` (`lab_hosts.ts:225`) | — | NOW |
| · "[9] approved · [2] waiting" (`dc:375`) | Two counts | **E** from M-R5's `counts`. **W** if read as mentor hosts: the counts cover investor, advisor and partner capacities (`lab_hosts.ts:41`, `:216-221`). Counting advisor-capacity hosts only is **P**, from the ≤500 items of one status. | S-HOST | NOW, labelled "every host" |
| · Button "Open Spin-Out Lab › Hosts" (`dc:375`) | A deep link | **N**. The Lab's tab is component state (`useState('applications')`, `AdminSpinoutLab.jsx:630`), so `/admin/spinout-lab` (`fe/App.jsx:2814`) always opens on Applications. | #2374 | NOW with a caveat: "Open Spin-Out Lab". The "› Hosts" part waits for #2374. |
| Card "Recent activity", with "See all" (`dc:376`) | The last five events | **N** as a read: assign and end write no audit row (§0.2), and no program activity read exists (F7). "See all" goes to the Activity tab, which is also N. | #2371·7, #2371·1 | See the rows below |
| · "[Name] assigned to [Jan 2027] by an admin" | Event | **P** from M-R1's `assigned_at`, latest episode only (F5). "By an admin" is copy, because `assigned_by_admin_id` is not returned (`:2975-2979`); that matches the no-names rule. | — | NOW with a caveat (latest episode per pair) |
| · "A founder in [Nov 2026] hid from one mentor" | Event | **N** as a read. Only the latest stamp per pair is stored (F6). | #2371·7 | **Not read here yet** |
| · "[Name]'s access to [Sep 2026] ended by an admin" | Event | **P** from `unassigned_at`. It is lost on a re-assign (F5), moved by a second DELETE (M-W2), and no actor is stored. | — | NOW with a caveat |
| · "[Name]'s role changed from Advisor to Investor" | Event | **N** as a program read. It is stored in `activity_logs` as `role_changed`:<br>• keyed to the admin, with the admin's and the target's names in the details text (`wk/routes/admin.ts:2261`);<br>• a `your_role_changed` row is keyed to the target (`:2262`).<br>Neither text may be printed as is. | #2371·1 | **Not read here yet** |

##### PG5 · How it runs (playbook) · Mentor cohort access (`dc:476`; caption `bd:49`)
**There is no playbook store** (F7). Every section is HQ-authored static copy until #2371·1 lands. The table checks each sentence against the code.

| Block (dc line) | What it draws | Worker source today | Owner/dep. | Now / placeholder |
|---|---|---|---|---|
| Contents "On this page", 11 entries (`dc:388`, `dc:378`) | Anchors | Frontend | — | NOW |
| A "Set by HQ" lock on every section, for an Admin (`dc:380`, rendered `dc:103`) | Who authors | **N** as a store. True as copy: HQ writes it. | #2371·1 | NOW as static |
| Purpose (`dc:377`): "Give each Lab cohort advisors who follow its founders week by week." | Copy | **P**: a mentor reads nothing during Week 1 (F2) | O-FND | NOW with a caveat |
| Who it is for (`dc:377`): "Advisor role … no profile needed" | Copy | **E**: `mig/206:35-39`, `advisors.ts:2948-2951` | — | NOW |
| How people join (`dc:377`): "An admin assigns one advisor to one cohort." | Copy | **E**: M-W1 | — | NOW |
| What a mentor sees (`dc:377`): names, emails, weekly status, who acted on guidance, Lab dates, "Nothing else in the Lab" | Copy | **E**: `cohortAdvisorAccess.ts:5-11`. The calendar's names come from sessions founders booked directly, which are not Lab data (`:10-11`). | — | NOW |
| What founders can do (`dc:377`): "told when a mentor can read them, and when that ends … can hide" | Copy | **P / W**:<br>• a founder is told, and can hide, only once a `company_week_status` row exists (F2);<br>• no end notice goes out when access ends through a role change (`cohortAdvisorAccess.ts:30-34`) or a deactivation (F1);<br>• a re-posted active pair tells founders it ended when it did not (M-W1). | O-FND, #2371·7 | NOW with corrected copy, or wait for O-FND |
| The cycle (`dc:382`): four chips "Week N · opens [d] · gate [d] 23:59", the America/New_York note, and the foot "Cohort dates are fixed by the Lab's calendar." | Dates | **E** from M-R3's windows (`admin_cohort.ts:57-59`). The deadline is stored as 00:00 ET on the next day and is inclusive (F4), so "23:59" is a minute early. The foot is true (F4). | S1 (which cohort the strip shows) | NOW, rendering `deadline_at` as "end of [7 Nov]" or "[8 Nov] 00:00 ET" |
| What you do (`dc:383`), three checklist rows | Static checklist | **N** as a store. "Check hidden founders" has no read (F6). "Carry the mentor over" means a new M-W1 on the next cycle; no carry-over write exists. | #2371·7 | NOW as static copy |
| Terms and contracts (`dc:384`): "Advisor agreement · [Template name]" with "Open in Contracts" | Link | **P**. Advisor templates exist:<br>• labels "Advisor NDA (Axal)" and "Advisor Engagement Disclaimer" (`wk/routes/admin_contracts.ts:350-351`, registry `:1720-1721`);<br>• seeded as "Mentor NDA (Axal) v1" and "Mentor Engagement Disclaimer v1" (`mig/085_seed_legal_templates.sql:1365`, `:1413`).<br>**Nothing links a template to this program** (F7).<br>Contracts opens at `/admin/contracts?tab=templates` (`fe/App.jsx:2772`; `fe/pages/admin/contracts/ContractsDesk.jsx:18`, `:23-25`). | #2371·1 | NOW with a caveat: link to the Templates tab and name no template |
| Rewards (`dc:385`): "None set." | Copy | **E**: no reward exists | — | NOW |
| How we measure it (`dc:386`) · Mentors per cohort | Measure | **P**, derived (see PG4's caveats) | — | NOW |
| · Founders hidden | Measure | **N** as a read (F6) | #2371·7 | Not read here yet |
| · Sessions booked with a mentor | Measure | **N** as an admin read. `advisor_bookings` is stored, keyed to the advisor profile, not the user (`advisors.ts:851`), so a mentor with no profile has none. Its only aggregates are org-wide counters (`wk/services/telegramAggregator.ts:109`, `wk/services/xAggregator.ts:151`). | #2371·1 | Not read here yet. PG18b's canvas word "Not recorded" should become this label. |
| Admin tools (`dc:387`) · Assign a mentor · Admin and Super Admin | Copy | **E**: the role check passes both, but it also passes a frozen admin (§0.2) | #2371·7 | NOW |
| · End access · Admin and Super Admin | Copy | **E**, with the same caveat | #2371·7 | NOW |
| · Approve office-hours hosts · Admin, on Spin-Out Lab › Hosts | Copy | **E**: `requireAdmin` (`lab_hosts.ts:225`), so a frozen admin gets 423 (`wk/index.ts:1473`) | — | NOW |
| · Edit this playbook · Super Admin | Copy | **N** as a store | #2371·1 | NOW as copy |
| Foot "HQ writes the playbook." (`dc:387`) | Admin sentence | — | — | NOW |

##### PG5s · How it runs · Super Admin variant (`dc:492`; caption `bd:49`)
| Block (dc line) | What it draws | Worker source today | Owner/dep. | Now / placeholder |
|---|---|---|---|---|
| Title "How it runs · Super Admin" (`dc:492`) | Variant marker | The elevation check is `isSuperAdminUser` (`fe/lib/shellRole.js:29-31`) | — | NOW |
| "Version [3] · edited [2 Oct]" (`dc:492`) | Version and date | **N**: no playbook, version or edit store (F7) | #2371·1 | Do not draw until part 1 |
| "Publish changes" (`dc:492`) | Write | **N**. Part 1's write would be `requireSuperAdmin` (`wk/auth.ts:692-697`) and audited. | #2371·1 | Do not draw until part 1 |
| An "Edit" button on every section, and no lock (`dc:380`, `playbook(true)` `dc:492`) | Write | **N** | #2371·1 | Do not draw until part 1. Until then a Super Admin sees the same static copy, with one sentence such as "Editing arrives with the playbook store." |

##### PG6 · People tab · Mentor cohort access (`dc:477`; caption `bd:50`)
| Block (dc line) | What it draws | Worker source today | Owner/dep. | Now / placeholder |
|---|---|---|---|---|
| Search "Search mentor or cohort" (`dc:390`) | Search | **P**: client side only, over M-R1's ≤500 rows | — | NOW, saying "newest 500" when 500 rows come back |
| Filter "Cohort ▾" (`dc:390`) | Filter | **P**: client side, on `cohort_cycle_id` | — | NOW |
| Filter "Status: Active, Ended ▾" (`dc:390`) | Filter | **P**: client side, on `is_active` | — | NOW |
| Filter "Role changed" (`dc:390`) | Filter | **P**: client side, on `advisor_role` against `is_active` (`AdvisorCohortAssignments.jsx:211`) | — | NOW |
| Sort "Assigned ▾" (Assigned, Cohort, Name) (`dc:390`) | Sort | The Worker sends newest assigned first (`advisors.ts:2982`); the other sorts are client side | — | NOW |
| Mentor column: "[Name]", the role as a subline, amber "Not an Advisor now" (`dc:389-390`) | Name and current role | **E**: `advisor_name`, `advisor_role` (`:2978-2979`). Today's page shows the email in that place (`AdvisorCohortAssignments.jsx:216`). **Nothing can flag a deactivated holder**, because M-R1 has no account state (F1). | #2371·7 (account state) | NOW |
| Cohort column: "[Nov 2026] · week 2", "· not started", "· ended" (`dc:389`) | Label and state | **P**: M-R1 joined to M-R3, using `status` (scheduled, active, completed) and `unlock_at` (F4). The computation mirrors `current_week` (`advisors.ts:2551-2555`). A cycle outside the 12 newest shows "Cycle #id" (`AdvisorCohortAssignments.jsx:218`). | — | NOW with a caveat (12 cycles) |
| Assigned column: "[3 Oct] by an admin" (`dc:389`) | Date | **E**: `assigned_at`, latest episode. "By an admin" is copy. | — | NOW |
| Ended column: "—" or "[14 Oct]" (`dc:389`) | Date | **E**: `unassigned_at`, latest episode only (F5); a second DELETE moves it (M-W2) | — | NOW with a caveat |
| Founders visible column: "[12] of [14]" (`dc:389`) | Two counts | **N**: no read exists (F6). **W** as drawn on three kinds of row, because those holders read nobody:<br>• ended rows ("[15] of [15]") and the demoted row ("[16] of [16]") (F1);<br>• the "not started" rows ("[9] of [9]"), which read 0 until the Week-1 deadline (F2).<br>The denominator waits for O-FND (F3). | #2371·7, **O-FND** | **Not read here yet**. Once it exists, draw "—" on ended, demoted or deactivated rows, and the Week-1 state on cohorts before their first deadline. |
| Note column (`dc:389`) | Text | **E**: `note` is returned (`advisors.ts:2978`). Today's page does not show it. A re-assign overwrites it (`:3043`). | — | NOW |
| ⋯ End access (`dc:390`) | Write | **E** M-W2. Today it is one click with no dialog (`AdvisorCohortAssignments.jsx:100-109`, `:234`), which breaks the issue's rule that every change opens a dialog (`issue:421`). | #2371·7 (gate) | NOW, in a `Lightbox` (`fe/ui/index.js:35`) that states what it changes: the mentor can no longer read the cohort, founders who were told are told it ended, and the row stays. Offer it on active rows only (M-W2 does not check). |
| Ended rows kept and muted (`dc:389-390`) | Style | **E**: soft end (`mig/206:26-29`) | — | NOW |
| Count "1–7 of [7]" and pages (`dc:390`; `pager` `dc:242`); the issue sets 25 a page (`issue:252`) | Count | **P**: a client-side total over at most 500 rows; there is no server total | — | NOW with a caveat |
| Foot "Ended access stays on record. ⋯ holds End access." (`dc:390`) | Copy | **W** after a re-assign: the earlier end date is overwritten (F5) | #2371·7 (history) | NOW, worded "The latest access for each mentor and cohort stays on record." |

##### PG6d · Assign a mentor (lightbox) (`dc:391-392`, `dc:477`; caption `bd:50`)
| Block (dc line) | What it draws | Worker source today | Owner/dep. | Now / placeholder |
|---|---|---|---|---|
| A dimmed page and a centred dialog: title "Assign a mentor", "Esc to close" (`dc:262`, `:264-265`, `:472`) | Dialog | `Lightbox`: role dialog, focus trap, Esc, and a full-screen sheet on a phone (`fe/ui/Lightbox.jsx:5-20`; `fe/ui/index.js:35`) | — | NOW |
| "MENTOR · ADVISORS ONLY" search (`dc:391`) | Picker | **E**: M-R2, role advisor, at most 500, searched on the client. **It also offers deactivated accounts** (no `is_active` filter, `advisors.ts:2941`), which M-W1 accepts and which read nothing (F1). | #2371·7 | NOW; mark it as a caveat until part 7 filters them |
| Selected row "[Name] · Advisor · Selected" (`dc:391`) | State | Frontend | — | NOW |
| Flag "No advisor profile yet" (`dc:391`) | Flag | **E**: `has_advisor_profile` (`advisors.ts:2951`) | — | NOW |
| COHORT "[Dec 2026] · 1–28 Dec" (`dc:391`) | Dates | **E**: M-R3's `start_at` and `end_at`. `end_at` is day 29 at 00:00, so "1–28" is right (F4). Only existing cycles can be chosen; anything else is 404 (`advisors.ts:3028-3030`). | — | NOW, offering scheduled and active cycles. Mark pairs that are already active (see Assign). |
| COHORT "· [11] founders" (`dc:391`) | Count | **W**.<br>• `participant_count` is 0 for a cohort that has not started, unless an admin accepted founders by hand, in which case it already counts them (`admin_cohort.ts:60-63`; `admin.ts:1320-1324`).<br>• The other definitions differ (F3). | **O-FND** | Do not draw until O-FND. A stated alternative is "[n] approved applicants" from M-R4 (`:320`), with that label. |
| NOTE (`dc:391`) | Input | **E**: at most 1000 characters (`advisors.ts:3045`) | — | NOW |
| Info line: "This lets [Name] read the names and email addresses of the founders in [Dec 2026]. Founders are told and can hide themselves." (`dc:391`) | Copy | **P**: true as to reach (`cohortAdvisorAccess.ts:5-11`, notice `:110-118`), but founders are told, and can hide, only from the first decided week (F2) | O-FND | NOW with a caveat. Until O-FND, add "Founders are told once their first week is recorded." |
| Back (`dc:392`) | Close | Frontend | — | NOW |
| Assign (`dc:392`) | Write | **E** M-W1. Map the refusals: 400 not an advisor, 404 no user or cycle, 500.<br>**W cases:**<br>• **Assigning a pair that is already active** sends each told founder a false "access has ended" notice right after a new "can see you" (M-W1).<br>• A "[N] founders told" line from `founders_notified` reads 0 when the sweep fails (`:3050-3053`), and 0 in Week 1 even when the sweep succeeds (F2).<br>The freeze is not enforced (§0.2). | #2371·7 | NOW, without a "founders told" figure. Refuse an already-active pair in the dialog ("[Name] already has [Dec 2026]") until part 7 makes the Worker treat it as a no-op. |

##### PG11 · Investor cohort access (new) (`dc:482`, `dc:436-443`; caption `bd:55`)
The board is drawn as a design: "nothing runs yet" (`dc:437`). No store, route or page exists (F7, and the corrected search in table H).

| Block (dc line) | What it draws | Worker source today | Owner/dep. | Now / placeholder |
|---|---|---|---|---|
| Header, pills, facts, "Give access", tabs. The Investor header has no ⋯ menu (`dc:436`). | — | See table H | — | See table H |
| Banner "New program. This is the design; nothing runs yet." (`dc:437`) | Status | True | — | NOW |
| Four tiles marked "sample": Investors with access [8], Cohorts open to investors [2], Founders hidden [3], Intro requests [11] ([6] accepted) (`dc:437`) | Sample figures | **N** for every tile. Shipping a sample would be an invented figure (`issue:422`). | #2371·6 | Draw "Not running yet" in each tile, as PG13 does (`dc:457`), never a value |
| How it runs · "An admin gives a verified investor access to one cohort." (`dc:438`) | Design copy | **N**. The template exists in 206's assignment table and M-W1/M-W2 (`mig/206:41-54`; `advisors.ts:2998-3082`), keyed to advisors.<br>**"Verified" is not defined for PG11. The code holds three candidates:**<br>• D653's `verifiedInvestor`: role investor, active, `kyc_status = 'approved'` (`wk/services/roundCallPolicy.ts:12-14`), used by round calls (`wk/routes/round_calls.ts:32`, `:73`);<br>• `investors.accreditation_status = 'verified'` (`wk/routes/public.ts:406`; default `'unverified'`, `wk/index.ts:1517`);<br>• the trust obligations `kyc_v1`, `accreditation_v1` and `investor_nda_v1` (`wk/services/trust.ts:73-75`).<br>`investor_profiles.accreditation_status` is self-declared at onboarding (`wk/routes/investor_signals.ts:306`, `:317-319`), so it is not a verification. | **O-VER**, #2371·6 | NOW as design copy |
| · "The investor signs the cohort NDA first." (`dc:438`) | Design copy | **N**. Only pairwise founder↔investor NDAs exist (`mig/025_trust_center.sql:47-60`; `hasActivePairwiseNda`/`upsertPairwiseNda`, `trust.ts:310`, `:325`). Templates: `investor_nda_axal` (`mig/085_seed_legal_templates.sql:1305`) and `nda_3way_founder_investor_axal` (`:1568`). No cohort NDA template exists (search in table H). | **O-NDA** | NOW as design copy |
| · "They see each venture's summary and weekly progress. Never founders' email addresses." (`dc:438`) | Design copy | **P/N**.<br>• `maskFounderForInvestor` nulls every key except id, name, sector, stage, headline, project_id and description_public (`trust.ts:369-373`, `:387-404`). **It returns the whole row once a pairwise NDA is active** (`:400-403`), so "never email" would need a cohort read with its own projection.<br>• Weekly progress is in `company_week_status`. Admins read it (`admin_cohort.ts:78-86`), and outside the Lab only assigned advisors do (`advisors.ts:2482-2578`). | **O-SEE**, #2371·6 | NOW as design copy |
| · "Founders are told and can hide themselves from one investor." (`dc:438`) | Design copy | **N** for investors. The pattern exists, keyed to advisors (`cohortAdvisorAccess.ts:66-164`, `:219-240`; `mig/367:29-49`). F2's gap and M-W1's re-assign notice defect would carry over. | #2371·6, O-FND | NOW as design copy |
| · "An introduction request goes to the founder, who accepts or declines." (`dc:438`) | Design copy | **P/N**. Three stores, none with a founder's accept or decline on an investor's request:<br>• `investor_introductions` (`mig/027_investor_paywall.sql:44-55`) is written once as `'pending'` (`wk/routes/introductions.ts:125-130`, investor only `:84-86`). No route updates its status. The only UPDATE is a `company_id` backfill (`mig/193_investor_relationship_company.sql:60`), and `wk/routes/portfolio_support.ts:27-30` records it as a defect.<br>• `intro_propositions`' accept and decline (`introductions.ts:321`, `:462`) belong to the platform-proposed system (`mig/150_introductions_network.sql:5-11`).<br>• The Trust Center's `POST /api/trust/intro/request` mints a 3-way NDA envelope the founder signs (`wk/routes/trust.ts:336-381`). Signing is the nearest thing to an accept, and there is no decline. | **O-INT** | NOW as design copy |
| Investors table toolbar: "Search investor or fund"; Cohort, NDA, Access, "Sort: Granted" (`dc:439`) | List tools | **N**: no list | #2371·6 | Draw the table with an empty state, such as "No investor has access. This program is not running yet." |
| Investor column: "[Name] · [Fund I]" with a "Verified" or "Not verified" pill (`dc:440-443`) | Person, fund, verification | **N** as a list. The fund name is stored as `investor_profiles.firm_name` (`mig/140_investor_profile_unify.sql:18`). | O-VER, #2371·6 | Do not draw sample rows |
| Cohort column | Cycle label | **N** as a list (labels as in PG6) | #2371·6 | Do not draw sample rows |
| NDA column: "Active · Signed [8 Oct]", "Sent", "Not sent" | NDA state | **N** per cohort. A pairwise NDA's `status` is pending, partially_signed, active, expired or revoked (`mig/025:55`). | O-NDA | Do not draw sample rows |
| Access column: "Active", "Ended", "Waits for verification" | Access state | **N** | #2371·6, O-VER | Do not draw sample rows |
| Intro requests column | Count | **N** per cohort. "Accepted" would be **W** from `investor_introductions`, where it is always 0. | O-INT | Do not draw sample rows |
| ⋯ menu | Actions | **N** | #2371·6 | Omit |
| Count "1–4 of [8]" and foot "Sample rows: this program is not running." (`dc:443`) | Count | — | — | Omit the count. Keep the foot's sense in the empty state. |

##### PG11d · Give an investor access (`dc:444`, `dc:482`)
The whole dialog waits for #2371·6. Each row records what that part can build on.

| Block (dc line) | What it draws | Worker source today | Owner/dep. | Now / placeholder |
|---|---|---|---|---|
| Title "Give an investor access", "Esc to close" (`dc:444`) | Dialog | `Lightbox` **E** | #2371·6 | Do not draw until part 6 |
| "INVESTOR · VERIFIED ONLY" picker (`dc:444`) | Picker | **P**. M-R7 returns role, is_active and kyc_status, which would satisfy D653's predicate on the client if O-VER adopts it (`roundCallPolicy.ts:12-14`). But M-R7 is a name or email search of at least two characters, at most 200 rows, with no role filter (`admin.ts:59`, `:80-82`, `:96`), and it carries no fund name. | **O-VER** | Waits for O-VER and part 6 |
| COHORT "[Nov 2026] · 1–28 Nov · [14] founders" (`dc:444`) | Dates and a count | Dates **E** (M-R3). The founders count is **W**, as in PG6d. | O-FND | Waits for part 6. The count waits for O-FND. |
| "NDA TEMPLATE [Cohort NDA v2]" (`dc:444`) | Template | **N** (see the NDA row above) | **O-NDA** | Waits for O-NDA |
| "END DATE [28 Nov 2026]" (`dc:444`) | Date | **N**: 206 has no end-date column (`mig/206:41-54`), and nothing ends access on a date | #2371·6 | Waits for part 6 |
| "WHAT THEY SEE": Venture summary ☑ (`dc:444`) | Scope | **P**: the masked public keys (`trust.ts:369-373`) | O-SEE | Waits for part 6 |
| · Weekly progress ☑ | Scope | **P**: `company_week_status`, with the F2 gap | O-SEE, O-FND | Waits for part 6 |
| · Pitch deck ☐ | Scope | **P**: founders share decks one link at a time. Each `pitch_deck_share_tokens` row is one hashed token for one deck, with an optional `prospect_id` or `investor_label` (`wk/routes/decks.ts:69-85`; view limits from `mig/064_deck_share_views.sql:16-18`). Nothing shares a deck per cohort. | O-SEE | Waits for part 6 |
| · Demo Day room ☑ | Scope | **N**. A `demo_day` event type exists (`wk/services/eventTypes.ts:13`), but there is no "room": `rg -n -i "demo.?day.?room" cloudflare-worker/src frontend/src cloudflare-worker/sql` finds nothing. | O-SEE | Waits for part 6 |
| Info line "Founders in [Nov 2026] are told that [Name] can read their ventures." (`dc:444`) | Copy | **N**. The pattern is `cohortAdvisorAccess.ts:110-118`. | #2371·6 | Waits for part 6 |
| Back, Give access (`dc:444`) | Write | **N** | #2371·6 | Waits for part 6 |

##### PG20b–d · Phone (`dc:506-508`; caption `bd:64`)
- **PG20b** reuses PG4's tiles and Needs you.
- **PG20c** reuses PG6's rows as cards. "[a] · [b] visible" is the Founders visible figure, so it reads Not read here yet.
- **PG20d** reuses PG6d as a sheet. Its crumb "‹ People" goes to `/admin/programs/mentor-cohorts/people` (N, #2371·9), with a sticky Back and Assign.
- The sources and verdicts are those of the rows above.

---

#### 2. Figures that would be wrong today: do not draw until fixed
| # | Figure | Why it is wrong | Fixed by |
|---|---|---|---|
| 1 | The "Granted to your studio" badge (PG4–PG6) | No subsidiary is deployed, so it must read "HQ-held" (F8; `dc:351`, `:491`) | Static "HQ-held" now. #2376 later. |
| 2 | Tab count "Queue [0]" (Mentor, Investor) | Mentor access has no queue (`approvalSources.ts:273`); Investor does not run | "No queue" with M-R6's reason, or "Not running yet" |
| 3 | Active mentors, Cohorts covered, Mentors per cohort and the "None" state counted on `is_active` alone | They include demoted holders, who read nothing (F1) | Count `is_active` with the role compared lower-cased |
| 3a | The same four, even with the role rule | They still include deactivated holders, who read nothing; M-R1 carries no account state (F1) | #2371·7: return `users.is_active` on M-R1, and filter M-R2. Until then, a stated caveat. |
| 4 | "Founders visible" on ended, demoted or deactivated rows, and on cohorts before their Week-1 deadline | Those holders see nobody (F1), and nobody is visible before the first decided week (F2) | "—" or the Week-1 state. The count itself waits for #2371·7. |
| 5 | Any "[n] founders" (PG4 bars, the PG6d and PG11d pickers, the visible denominator) | Three definitions, each wrong in some window. `participant_count` can be non-zero before a cohort starts (`admin.ts:1320-1324`). A mentor reads 0 during Week 1 (F2, F3). | O-FND, then one Worker definition |
| 6 | "[N] founders told" from `founders_notified` | It reads 0 when the sweep fails (`advisors.ts:3050-3053`, `:3076-3079`) and 0 in Week 1 (F2). It counts only this call's new notices, at most 500 (`cohortAdvisorAccess.ts:70`, `:106-107`). | #2371·7: return `null` on failure. O-FND for Week 1. |
| 7 | "Ended this period" | No period exists on the page; a re-assign erases the earlier end (F5); a second DELETE moves it (M-W2) | S-PER label now. #2371·7 history. |
| 8 | "Ended access stays on record" | False after a re-assign (F5) | Reword now. #2371·7 history. |
| 9 | "…but their access is still on" | Access is already refused; only the row is open (F1) | Reword now |
| 10 | "[9] approved · [2] waiting" read as mentor hosts | The counts cover every capacity (`lab_hosts.ts:41`, `:216-221`) | Label "every host" (S-HOST) |
| 11 | PG5 "Founders are told … and when that ends" | Founders are not told before the first decided week (F2). They are not told when a role change or deactivation ends access (`cohortAdvisorAccess.ts:30-34`, `:85`). They are wrongly told access ended when an active pair is re-posted (M-W1). | Corrected copy now. O-FND and #2371·7. |
| 12 | PG5 "gate [7 Nov] 23:59" | The stored deadline is 00:00 ET the next day, and it is inclusive (F4) | Render from `deadline_at` |
| 13 | Every PG11 tile and table row | Samples; an invented figure if shipped | "Not running yet" and an empty state |
| 14 | PG11 "[6] accepted" from `investor_introductions` | Its status is never updated, so the figure is always 0 (`portfolio_support.ts:27-30`) | O-INT and #2371·6 |
| 15 | Recent activity built from M-R1 as "the last five events" | Latest episode only; no hide or role events (F5, F6) | #2371·7 audit and an activity read |
| 16 | The ⋯ "Download (CSV)" built from M-R1 | It would carry advisor names and emails, which D893's export rule refuses (`D893.md:51`, `:177`, `:190`) | S-CSV: counts only, or a logged Worker export |

Two more things are drawn as true but are not figures:
- **PG5's "Admin and Super Admin" may assign and end, and so may a frozen HQ admin,** because M-W1 and M-W2 check the role only (`advisors.ts:3000-3001`, `:3065-3066`; the freeze lives in `wk/auth.ts:523-528`). It belongs to #2371·7. The issue already records it (`issue:81`).
- **Assign on an already-active pair** sends founders a false "access has ended" notice (M-W1). This also belongs to #2371·7. Until then PG6d refuses it on the client.

#### 3. Buildable NOW with no Worker change
- **Header (Mentor):**
  - the crumb to `/admin/held/programs`;
  - the title, line and facts;
  - the pills "Live" and "HQ-held";
  - literal `NavLink` tabs, with Queue reading "No queue";
  - "Assign a mentor".
  - Pause is omitted. The CSV is omitted, or counts only (S-CSV).
- **The moved notice** on `/admin/advisor-cohorts`, using the D893 redirect pattern. It is frontend only and moves the pins listed in PG4.
- **PG4:**
  - Active mentors, with its rule and the deactivated-holder caveat;
  - Cohorts covered, with a stated denominator;
  - Mentors-per-cohort bars, mentors only, with the "None" state and the Table toggle;
  - Needs you, both rows, with the role-change copy corrected;
  - Office-hours host counts labelled "every host", with "Open Spin-Out Lab" (no "› Hosts");
  - Recent activity limited to assign and end on the latest episode, with the rest marked Not read here yet.
- **PG5:** every section as static copy, with the corrections in §1:
  - the cycle strip from M-R3's windows;
  - the Templates link `/admin/contracts?tab=templates`;
  - "None set";
  - the measures list;
  - Admin tools and the contents list.
- **PG6:**
  - search, filters, sorts, count and pages, on the client over at most 500 rows;
  - the Mentor, Cohort, Assigned, Ended and Note columns (Note is new);
  - End access in a `Lightbox`, on active rows only.
- **PG6d:**
  - the advisor search and profile flag;
  - the cohort picker with dates only, marking pairs that are already active and refusing them;
  - Note;
  - the info line with the Week-1 caveat;
  - Assign, with its refusals mapped.
- **PG11:** a static design page:
  - header and banner;
  - "How it runs" as design copy;
  - four "Not running yet" tiles;
  - an empty Investors table;
  - a sentence in place of "Give access".
  - PG11d is not shipped.
- **PG20b–d:** the same blocks, as cards and a sheet.

#### 4. Honest placeholders
Three labels, kept apart. They follow the Events desk's vocabulary (`fe/pages/admin/events/eventsDeskModel.js:21-28`, `:81`, `:85`; `NOT_RECORDED` `fe/lib/absence.js:46`; `Unrecorded` and `Unreadable`, `fe/ui/index.js:87`):
- **Not recorded:** no store holds it.
- **Not read here yet:** it is stored, but no read sums it.
- **Could not be read:** the read failed.

PG11's program-level word, "Not running yet", is PG13's (`dc:457`). It maps to Not recorded.

| Block | Label | Waits for |
|---|---|---|
| Founders hidden (PG4 tile, PG5 measure), Founders visible (PG6, PG20c), the hide event in Recent activity | Not read here yet | #2371·7: a counts-only read over `cohort_advisor_optouts`, crossed with membership |
| The role-change event in Recent activity | Not read here yet | #2371·1: an activity read that names "an admin", never the admin |
| Sessions booked with a mentor (PG5; PG18b's card) | Not read here yet | #2371·1: an `advisor_bookings` count per cohort mentor, joined through the advisor profile |
| Founders per cohort (PG4 bars, PG6d, PG11d) | Not read here yet | O-FND, then one Worker definition |
| A holder's account state (deactivated) | Not read here yet | #2371·7: `users.is_active` on M-R1 and a filter on M-R2 |
| Earlier episodes' assign and end dates; who ended access | Not recorded | #2371·7: an audit row (`logAdminAction`) on M-W1 and M-W2, and a history store that survives reactivation |
| Version and edited date, Publish and Edit (PG5s); the Terms, Settings and Activity tabs; Pause | Not recorded | #2371·1 |
| A template linked to the program (PG5 Terms) | Not recorded | #2371·1 |
| Every PG11 and PG11d figure and field | Not recorded ("Not running yet") | #2371·6, after O-VER, O-NDA, O-INT and O-SEE |
| The "Open Spin-Out Lab › Hosts" deep link | Omit the "› Hosts" part | #2374 |
| M-R1, M-R2, M-R3 or M-R5 failing (500 or 5xx) | Could not be read, only on the blocks that use that read | — |

#### 5. Corrections to the lead reports, and new findings
1. **"Verified investor" has code precedents, and more than one.** D653's `verifiedInvestor` (`wk/services/roundCallPolicy.ts:12-14`) requires role investor, an active account and approved KYC. Separately, `investors.accreditation_status = 'verified'` is read as "accredited" (`wk/routes/public.ts:406`). The catalogue report said nothing defines one. O-VER can adopt one or reject them all.
2. **`/admin/advisor-cohorts` is at `fe/App.jsx:3291` at HEAD**, not `:3287`.
3. **The deadline is not "the same instant" as 23:59.** It is 00:00 ET on day 1+N·7, inclusive (`cohortTiming.ts:72`, `:81`, `:104-106`; `mig/156:27`).
4. **A mentor keeps reading after a cohort ends.** The reads check `is_active` and the role, never the cycle's status (`advisors.ts:2430-2446`). Nothing on PG4 flags active rows on completed cycles. It can be derived from M-R1 and M-R3, and would make a third Needs-you row (S1 to decide).
5. **An active pairwise NDA unmasks the whole founder row** to an investor (`trust.ts:400-403`). Email is included whenever the row carries it, so PG11's "never email" needs its own projection.
6. **"Open in Contracts" can land on the Templates tab** (`ContractsDesk.jsx:18`, `:23-25`). No URL opens a single template; `?template=` only filters agreements (`:19`, `:53`).
7. **A deactivated advisor is assignable, counted and announced, but cannot read.**
   - M-R2 has no `is_active` filter (`advisors.ts:2941`).
   - M-W1 checks the role only (`:3011-3027`).
   - M-R1 does not return account state.
   - The notice sweep tells founders such a holder "can see" them (`cohortAdvisorAccess.ts:85`, `:114`).
   - `getCurrentUser` refuses the holder (`wk/auth.ts:335`).
8. **Re-posting an already-active assignment sends founders a false "access has ended" notice** after the new "started" one (`cohortAdvisorAccess.ts:124-161`, condition `:132`, reached from `advisors.ts:3051`).
9. **DELETE on an ended row moves its end date** (`advisors.ts:3068-3074` has no `is_active` check).
10. **`participant_count` is not always 0 before a cohort starts.** The Lab's hand-accept activates at once with the cycle's start (`admin.ts:1320-1324`).

---

#### Corrections
1. **HEAD.** It is `fbbb4c8`, not `99466ce`. `fbbb4c8` touches no cited file. The Events desk file cited in §4 did not exist at `6205ee6`, so "every other cite reads the same at both commits" was not quite true.
2. **A broken search.** The Investor "no store" search used `\|` in `rg`, which matches a literal pipe, so it could never match: `echo advisor \| rg "advisor\|nothing"` exits 1. I re-ran it with real alternation; it still finds nothing, so the verdict stands.
3. **Wrong lines.**
   - The pairwise NDA `status` is `mig/025:55`, not `:53`.
   - The deadline comment is `mig/156:27`, not `:26`.
   - The deck-share cite pointed at `mig/064`, which only adds view columns. The table is defined at `wk/routes/decks.ts:69-85`.
   - Smaller fixes: `mig/150:5-11`; `ai.ts:458-464`; `Lightbox.jsx:5-20`; `sidebarConfig.js:228-229`.
4. **A misattributed source.** The Terms-tab link to `/admin/my-licence/programs` is the issue's (`issue:216`, `:488`). The canvas draws no Terms board. I also corrected "six tabs" to "the base plus five sub-paths".
5. **F1 missed a third condition: an active account** (`wk/auth.ts:335`). As a result:
   - Active mentors, Cohorts covered, Mentors per cohort and the "None" state change from E to P with a caveat;
   - the M-R1 and M-R2 rows now say they carry or filter no account state;
   - §2 row 3a and §5 item 7 are new.
6. **M-W1 missed a defect.** Re-posting an active pair sends founders a false "ended" notice. I added it to M-W1, PG5, PG6d (Assign changes to W, and the dialog must refuse the pair), §2 and §5 item 8. `founders_notified` also counts only this call's new notices, at most 500.
7. **M-W2 missed a defect.** It does not check `is_active`, so a second DELETE moves the end date. This affects Ended, "Ended this period" and Recent activity.
8. **The CSV was not buildable NOW.** A browser CSV of M-R1 carries names and emails, which D893's export rule refuses. It changes from "NOW with a caveat" to "omit, or counts only" (table H, §2 row 16, S-CSV).
9. **Founders visible missed a W case: rows on cohorts that have not started** (F2).
10. **F3 and PG6d overstated "0 before start".** The Lab's hand-accept activates at once (`admin.ts:1320-1324`).
11. **"Weekly progress readable only by assigned advisors" was wrong.** Admins read it through `/api/admin/cohort/review` (`admin_cohort.ts:78-86`).
12. **O-VER and O-INT were incomplete.**
    - O-VER gains `investors.accreditation_status` as a candidate, and a note that `investor_profiles.accreditation_status` is self-declared.
    - O-INT gains the Trust Center's 3-way NDA intro request (`trust.ts:336-381`).
13. **M-R6 and M-R7 lacked detail.**
    - M-R6 now names its route and gate (`admin_studio_glance.ts:30-37`, `:32`), HQ tier only.
    - M-R7 now states its limits: ≤200 rows, a two-character minimum, no role filter. PG11d's picker depends on them.
14. **Missing pins and dependencies.**
    - The moved-notice pin list lacked `HeldPrograms.jsx:65` and the tests that pin the address.
    - §0.4 lacked #2369 (`issue:494`).
    - S-CNT is new: the canvas sample's Active mentors counts open assignments, including the demoted row.
15. **Smaller additions.**
    - F2: an admin's Week-1 grace or override writes a row early.
    - F5: earlier episodes survive only if a founder was told.
    - F6: a re-hide also clears `withdrawn_at`, against `mig/367:23-24`.
    - Sessions booked is keyed to the advisor profile (`advisors.ts:851`), with a second aggregate at `xAggregator.ts:151`.
    - The advisor templates are seeded under "Mentor" titles (`mig/085:1365`, `:1413`).
    - The PG6 page size is 25 (`issue:252`).
    - The top-bar studio badge (`dc:522`) is now a row in table H.

No E or NOW claim turned out to need Super Admin or to be HQ-only. Every read used is `requireAdmin` or the role check. No read used here returns zeros or `[]` with a 200 on failure. The one silent zero is `founders_notified`, which was already flagged.

### Boards PG7 to PG12d: Referral partners, custom terms, Refer & Earn, Perks, Learning. What each block needs, and what the code has today

**Basis.** I read everything on `claude/spinout-lab-workspace-wuyyqd` at HEAD **`fbbb4c8`**. The task named `6205ee6`. Two commits have landed since then: D915's Events desk (`99466ce`) and D906's review fixes (`fbbb4c8`).
- `git diff --stat 6205ee6 HEAD` touches nothing under `cloudflare-worker/`, so every `wk/` and `mig/` cite reads the same at both commits.
- `git diff --stat 99466ce HEAD` touches only `fe/pages/cycles/`, `fe/pages/raise/narrative/`, two tests and `D906.md`. No cite below moves.
- In `fe/App.jsx`, D915 added four lines at `:2838` (three Events routes and a comment). Routes below that point moved down four lines: `/perks` is now `:2960`, `/admin/advisor-cohorts` is `:3291` and `/referrals` is `:3497`.
- I re-read every cite at `fbbb4c8`. Nothing was edited, and nothing was checked against production.

**Prefixes.**
- `wk/` = `cloudflare-worker/src/`
- `fe/` = `frontend/src/`
- `mig/` = `cloudflare-worker/sql/migrations/`
- `dc:` = `design/incoming/Programs Page.dc.html`
- `bd:` = `design/incoming/Programs · Boards.dc.html`
- `iss:` = the saved #2371 body (`…/scratchpad/prog/issue2371.md`)

**Status marks.**
- **E**: exists.
- **P**: partly exists (capped, gated, true only under one owner answer, or needs client work).
- **N**: does not exist.
- **W**: would show a wrong figure or false copy today.

Bracketed canvas values are samples, never data.

**Dependency codes** (column 4):

| Code | What it is |
|---|---|
| **S-REG** | #2371 split 1: registry, playbook store, catalogue read (`iss:509`) |
| **S-RE** | #2371 split 4: Refer & Earn Worker fixes (`iss:512`) |
| **S-RP** | #2371 split 5: referral-partner Worker (`iss:513`) |
| **NEW-PK** | Admin reads and review fixes for Perks. No Worker slot in the split covers these. |
| **NEW-LN** | Learning aggregate reads. No Worker slot in the split covers these. |
| **#2376** | Program grants |
| **#2375** | Page frame, tabs and the "has moved" pattern |
| **#2319 / #2301** | Old addresses and the redirect count |
| **#2390** | Approvals lanes |
| **#2370** | Partner invitations |
| **#2368** | Events |

**Owner decisions.** These codes are local to this section. Renumber them when the sections merge.

| Code | Decision |
|---|---|
| OD1 | Whether Explorers may refer (`iss:482`) |
| OD2 | The credit amount for each referral reward (`iss:482`), and whether partner-role referrers may receive credits (`wk/services/creditGrants.ts:43`) |
| OD3 | What a "referral partner" is: a role, any code holder, or a partner deal. A partner deal is the only store that holds per-partner signed terms (`mig/028_partner_deals.sql:55-75`). Many PG7 rows below change with this answer. |
| OD4 | Whether the four standard rules that nothing pays get events, or come off the card |
| OD5 | Who approves custom terms: the Super Admin only, or any HQ admin |
| OD6 | Whether a commission may be paid out as credits |
| OD7 | Whether Perks "Send back" becomes a state the partner can resubmit from |
| OD8 | Which accounts count in "credits held by members" |
| OD9 | What a "finished" Learning program is, and which cell statuses count as "Done" |

**S1 calls (not owner decisions):**
- **The Overdue threshold.** The precedent is D915's 72 hours (`documentation/architecture/decisions/D915.md:72`; `wk/services/approvalSources.ts:305`). The glance already serves each lane's `sla` band on that threshold (`wk/services/branchHome.ts:360-376`).
- **The window behind each tile.** Program pages have no period control: only `catHead` sets one (`dc:469`, drawn at `dc:533`), and `prog()` does not (`dc:471`). The canvas's sample numbers still tie each tile to the chart beside it:
  - "Referrals [48]" is the twelve-week chart's "48 in total" (`dc:417`) and the funnel's 48 submitted (`dc:416`).
  - "Claims [42]" is "42 in twelve weeks" (`dc:427`) and the top-eight sum (`dc:426`).
  - "Enrolled this period [22]" is "22 in total" over twelve weeks (`dc:448`).
  - "Introductions this quarter [31]" is 14 + 11 + 6 (`dc:396`).
  - "Commission accrued [$4,250] · paid [$2,000]" is May to October (`dc:397`).

  Every tile below says whether its read is all-time or windowed. The decision record must pick one window per tile.
- **Learning counts: people or enrolments.** The canvas sums enrolments. "Active learners [126]" is 30 + 40 + 26 + 30 (`dc:450-453`), and "[48] of [126]" is 12 + 18 + 9 + 9 (`dc:447`). Either relabel the tiles as enrolments, or count distinct people. Never print the sum under the word "learners".

**Placeholder labels** (D915's precedent, `D915.md:70`; constant at `fe/pages/admin/events/eventsDeskModel.js:81`):
- **Not recorded**: no store holds the value.
- **Not read here yet**: stored, but no read this page may call returns or sums it.
- **Could not be read**: the read failed.

---

#### 0. The program frame shared by PG7, PG9, PG10 and PG12 (`prog()`, `dc:471`)

| Block (dc line) | What it draws | Worker source today | Owner / dep | Now / placeholder |
|---|---|---|---|---|
| Sidebar "Programs" lit (`dc:509-510`) | Admin row | **P**. The row is `/admin/held/programs` (`fe/sidebarConfig.js:228-229`). `/admin/refer-earn` lights **Approvals** (`:227`). | #2371 frontend | NOW. Move `/admin/refer-earn` into the Programs `match`. |
| Crumb "Programs › [title]"; "‹ Programs" on a phone (`dc:471`, style `dc:527`) | Link to `/admin/programs` | **N**. `rg "/admin/programs" cloudflare-worker/src frontend/src` returns nothing. | #2375 | NOW (frontend only) |
| h1 at 24 px (`dc:528`) | Title | Copy | — | NOW |
| Status pill and grant badge (`ps`/`gb`, `dc:322-324`) | "Live" or "Partly built"; "Granted to your studio" | **N**. `rg -i "program_grants\|programme_grants\|program_registry\|programs_registry\|program_proposals\|program_playbook" cloudflare-worker frontend/src` returns nothing. No branch is deployed: `infra/branches/` holds only `README.md` and `_example.json`. | S-REG, #2376 | Grant badge: draw **"HQ-held"** (`dc:491`; the constant at `fe/pages/admin/HeldZone.jsx:30`), never "Granted to your studio". Status pill: a static word set in the decision record until S-REG lands. |
| Seven tabs at `/admin/programs/<key>[/<tab>]` (`dc:470-471`) | Overview, How it runs, People, Queue, Terms, Settings, Activity | **N** routes. The precedent is literal `NavLink`s (`fe/pages/subsidiary/LicenceFrame.jsx:50-88`, D800). | #2375 | Overview, Queue and People: NOW, per board. How it runs, Terms and Settings: **Not recorded** until S-REG. Activity: per board. |
| Queue count, amber when above 0 (`dc:471`, `dc:531`) | `[q]` | Per board | — | Per board. Never draw `[0]` where no queue exists. |
| ⋯ "Pause program (Super Admin)" | Program pause | **N**. No program status exists. The only pauses are per object, such as a perk listing (`wk/routes/perks.ts:844`). | S-REG | Do not draw until S-REG |
| ⋯ "Download (CSV)" | Export | **N**. No export route exists for any of these programs. | — | NOW, built in the browser from the rows already read, and stating the read's cap |
| Chart ⇄ Table switch on every chart (`TOG`, `dc:234`) | Segmented control | Frontend only | — | NOW. The table shows the rows the chart draws, with the same placeholders. |
| Eadwyn spine (`dc:536`) | One rail | **P**. `/admin/refer-earn` owns `Admin · Approvals · Referrals` (`fe/lib/railPages.js:270`). `/perks` and `/learning` have no rail (`:441-442`). | #2371 frontend | NOW. Choose the keys in the decision record: a prefix owner on `/admin/programs` would take every sub-page. |

---

#### PG7 · Referral partners (`dc:393-405`; caption `bd:51`)

| Block (dc line) | What it draws | Worker source today | Owner / dep | Now / placeholder |
|---|---|---|---|---|
| Pills "Partly built", "Granted to your studio" (`dc:393`) | Status and grant | **N** (§0) | S-REG, #2376 | "Partly built" is honest copy. Grant: "HQ-held". |
| Line "…each under their own signed terms." (`dc:393`) | Copy | **P/W**. It covers two different things. <br>• **Commission terms:** none are per person. The rule lookup is by key alone (`wk/routes/network.ts:163`), and `commission_rules` has no partner column (`:69-77`). <br>• **Partner deals:** each deal carries its own terms in `proposal_json` (`mig/028:61`). The terms are signed through an envelope (`wk/routes/partner_onboarding.ts:374`) and activated on signature (`wk/routes/esign.ts:1585-1593`). An Admin can read them (`wk/routes/admin_partners.ts:293-312`, proposal parsed at `:308-310`). The revenue-share deal states a share (`wk/services/partnerDeals.ts:118-133`), but nothing computes it: HQ drafts each obligation by hand (D713, `wk/routes/partner_settlements.ts:57-74`). | OD3, S-RP | True only if OD3 is "partner deal", and then as "under their signed partner deal", never as commission terms. Until OD3, write "under the standard rules HQ sets". |
| Facts "Who: Partners, investors, advisors, invited members" | Copy | **W**. Any signed-in account mints a code: `GET /api/network/referral/code` is `requireAuth` (`network.ts:471-474`), and the Refer & Earn overview mints one too (`wk/routes/refer_earn.ts:94-98`). | OD3 | Do not draw until OD3 |
| Facts "Join: By invitation" | Copy | **W/P**. False of the standard rules: anyone with a code earns under them. True of partner deals, which come only from an invitation (`admin_partners.ts:48-95`). | OD3 | Do not draw until OD3. It is true if OD3 is "partner deal". |
| Facts "Terms: standard rules or custom terms" | Copy | **P**. Standard rules: **E**. Custom commission terms: **N**. | S-RP | NOW, as "Terms: standard rules" |
| Queue `[0]` (`q:0`, `dc:393`) | Terms waiting for HQ | **N**. No terms store, so no queue. | S-RP | Draw "No queue", never `[0]` |
| "Invite a partner" (`dc:393`) | Primary action | **P**. `POST /api/admin/partners/invitations` is `requireAdmin` (`admin_partners.ts:48-49`); the page is `/admin/partners` (`fe/App.jsx:2701`). It proposes a partner deal. That deal grants tiers, and it creates no commission terms. | #2370 | NOW with a caveat: it links to #2370's invitation flow and says it creates no commission terms |
| Segment chips: All, Event organisers, Venture scouts, Deal makers (`dc:395`) | Filter | **N**. `rg -i "event.?organi[sz]er\|venture.?scout\|deal.?maker\|dealmaker"` finds only `wk/routes/events.ts:19` (the event-organiser service) and an assessment archetype (`mig/110_assessment_tracks.sql:607-629`). `partner_profiles` has `sectors` and `expertise` but no segment (`mig/028:34-52`). The only typed partner classification is `partner_deals.deal_type`, with five types (`mig/028:59-60`; `partnerDeals.ts:22-35`), and those are not the canvas's segments. | S-RP, OD3 | Do not draw until S-RP |
| Tile "Active partners [12]" (`dc:395`) | Count | **N** as defined. The sample is the table count "1–12 of [12]", which is 9 signed plus 3 waiting (`dc:395`, `dc:405`). Possible proxies: active partner deals (`admin_partners.ts:293-312`), or accounts that hold commissions (Super Admin only, R2 below). | OD3 | **Not recorded** until OD3 |
| Tile "With signed terms [9] · [3] waiting to sign" | Two counts | **P**. If OD3 is "partner deal", these are the counts of `active` and `awaiting_signature` partner deals (states listed at `admin_partners.ts:322-324`; `awaiting_signature` is set at `partner_onboarding.ts:374`). Those deals are signed partner terms. Caveats: <br>• `GET /api/admin/partners/deals?status=` takes one status per call, returns the newest 200, and gives no total (`:293-306`). <br>• An `awaiting_signature` row has no user yet (`mig/028:58`), so its name is null. <br>They are not commission terms. | OD3 | If OD3 is "partner deal": NOW, with two calls, reading "200 or more" when a call comes back full. Otherwise **Not recorded**. |
| Tile "Introductions this quarter [31]" | Count | **N** as drawn: "no store records an introduction a member made" (`wk/services/partnerLeaderboard.ts:19-20`). The nearest records: <br>• `referrals` rows are sign-ups by member code (`network.ts:25-33`), and no admin read returns them. <br>• The leaderboard (`GET /api/partnernet/leaderboard/board?metric=referrals&period=quarter`) is open to any member but gives only rank, role and value, for the top 25, with no total (`wk/routes/partnernet.ts:1290-1340`). <br>• Sign-ups with a partner-deal code (`partner_referral_redemptions`): an Admin reads them per deal, with `redeemed_at`, newest 500 (`admin_partners.ts:240-291`). | S-RP, OD3 | **Not recorded** as "introductions". If OD3 is "partner deal": "Sign-ups with a partner code this quarter", built from the per-deal reads. |
| Tile "Commission accrued [$4,250] · paid [$2,000]" | Two sums | The sample covers six months (`dc:397`). <br>**Commissions, Super Admin: P. Admin: N.** R2 is `GET /api/network/admin/commissions`: `requireSuperAdmin` (`network.ts:570-571`), the newest 500, no total (`:577`), in several currencies (`currency` column `:41`; `currencyTotals` `:525-546`). <br>• `status='paid'` means a payout **claimed** the commission (`:834`), so "paid" must come from R3's `completed` rows (`:891`; R3 is `:935-951`, newest 200). <br>• Refunds are not clawed back as the code stands: the clawback columns exist only in dev (`wk/services/referralCommissions.ts:39-49`; `scripts/runtime-schema-declared-baseline.json:32-40`). <br>**Partner-deal settlements, any HQ Admin: E.** D713's ledger is `GET /api/admin/partner-settlements` (`requireHqAdmin`, `partner_settlements.ts:16-20`, `:37-55`; table `mig/477_mercury_personal.sql:36-58`). It returns every row with no cap, in USD only (`:29`). Kinds include `revenue_share` (`:12`). Rows are `issued` by the Super Admin (`:108-113`) and become `matched` against a bank line (`wk/services/mercuryPersonal.ts:533`). These rows are not commissions. | S-RP, OD3 | Commissions for the Super Admin: NOW with caveats (per currency; a sum only when R2 returns fewer than 500 rows). <br>Commissions for an Admin: **Not read here yet**, with the sentence from `fe/pages/admin/AdminCommissions.jsx:623-635`. <br>If OD3 is "partner deal": settlements NOW for every HQ admin, labelled "Settlements under partner deals: issued / matched". |
| Chart "Introductions by outcome" (`dc:396`): Submitted, In conversation, Converted, Closed, by segment | Stacked bars | **N**. There are no segments. `referrals.status` holds only `pending` or `converted` (`network.ts:30`, `:180`). The outcome words are Refer & Earn statuses (`wk/services/referralSubmissions.ts:23-27`), which is a different store. | S-RP | **Not recorded** (dashed, never a zero bar, `iss:148`) |
| Chart "Commission by month", Accrued and Paid (`dc:397`) | Two lines | **Super Admin: P.** Accrued is R2 grouped by `created_at`; Paid comes from R3's `completed_at` (newest 200). **Admin: N** (403). Settlements by `issued_at`, or by the time a row became `matched`, are the partner-deal alternative under OD3. | OD3 | Super Admin: NOW with caveats (one currency per chart; complete only below the caps). Admin: **Not read here yet**, or settlements if OD3 is "partner deal". |
| Card "Standard rules", lock, five rows, note "What a referral code earns without custom terms.", foot "HQ sets the standard rules." (`dc:398`) | Rule values | **Super Admin: E.** R1 is `GET …/admin/commission-rules` (`network.ts:582-592`). The editor W1 is `PATCH …/:key` (`:614-682`), with "flat or share, never both" (`:655-660`). The editor component exists (`AdminCommissions.jsx:64-127`). <br>**W as "what a referral code earns":** <br>• Only `referral_kyc_approved` fires (`wk/routes/kyc.ts:378`). `rg` for the other four keys finds only the seeds (`network.ts:101-104`), which run only at run time (`:108`). <br>• Purchase commissions pay a product's `commission_pct`, which is not on the card (`wk/routes/billing.ts:1863-1889`). <br>• Each standard-rule commission also pays compounding bonuses: 50% to the referrer's referrer and 25% to the account above that (`wk/routes/networkfx.ts:16`, `:131-147`, called at `network.ts:192-198`). The card does not show them. <br>• Sign-ups with a `PART-` code write no `referrals` row (`wk/routes/auth.ts:460-470`), so they never earn (`network.ts:159-160`). <br>**Admin: N.** R1 answers 403. | OD4 | Super Admin: NOW. Mark four rows "No event pays this yet", and add a purchase-commission line and a compounding-bonus line. Admin: the foot sentence only, with **Not read here yet** for the values. |
| Table: Partner name and segment pill | Name, segment | Name: **P**. The Super Admin gets it from R2 (joins `users`, `network.ts:577`). Any Admin gets it on partner-deal rows (`admin_partners.ts:301`). Segment: **N**. | S-RP, OD3 | Name NOW for the rows each reader can read. Segment: **Not recorded**. |
| Table: Terms ("Custom · signed [12 Sep]", "Standard rules", "Custom · sent", "Expired") | State pill | **P.** For commission holders, only "Standard rules" can be true. A partner-deal row has a readable state: `active` with `activated_at`, `awaiting_signature`, `terminated` or `expired` (`mig/028:67-70`; `admin_partners.ts:322-324`). These are partner-deal states, not custom commission terms. | S-RP, OD3 | NOW as "Standard rules" for commission holders. For partner-deal rows, show the deal's state labelled as a partner deal, if OD3 is "partner deal". |
| Table: Code `[LIS-EV-07]` | Mono code | **P.** Member codes: **N**, because no admin read exposes `users.referral_code` (`rg referral_code wk/routes/admin*.ts` finds only `PART-` codes). Partner-deal codes (`PART-XXXXXXXX`, `partnerDeals.ts:169-178`) appear on every partner-deal row an Admin reads (`admin_partners.ts:222`, `:245`, `:281`, `:299`). Member codes are six Crockford base32 characters (`wk/services/referrals/codes.ts:3-12`). Neither real format matches the sample. | S-RP | Partner-deal rows: NOW. Member codes: **Not read here yet**. |
| Table: Intros, Converted | Counts per partner | Intros: **P**. A partner-deal row carries `redemptions_count`, the sign-ups with its code (`admin_partners.ts:302`). A member's `referrals` are readable only by that member (`network.ts:496-513`). Converted: **N**. | S-RP, OD3 | Partner-deal rows: the sign-up count NOW, labelled "Sign-ups with this code". Converted, and member rows: **Not read here yet**. |
| Table: Accrued, Paid, Last activity | Money and date | **Super Admin: P** (from R2 and R3, per currency). **Any HQ Admin: P** for partner-deal rows, from the settlements (issued, matched). Admin commissions: **N**. | OD3 | Super Admin: NOW with caveats. Partner-deal rows: settlements NOW if OD3 is "partner deal". Admin commissions: **Not read here yet**. |
| Row ⋯ "Set custom terms" | Opens PG8 | **N** | S-RP | Do not draw until S-RP |
| Row ⋯ "Send contract" | Envelope | **P**. `POST /api/admin/contracts/envelopes/preview` and `…/send` are `requireAdmin` (`wk/routes/admin_contracts.ts:234-241`). The template must be published (`wk/services/contractPublication.ts:22-23`). `deal_id` points at the startup `deals` table (`:30-34`), so nothing links the envelope to a partner or to terms. | S-RP | NOW, as a link to Contracts (`/admin/contracts`, `fe/App.jsx:2772`), with a caveat |
| Row ⋯ "Pause" | Partner pause | **N** | S-RP | Do not draw |
| Row ⋯ "End" | End partner | **P**. `POST /api/admin/partners/deals/:id/terminate` needs a reason and acts on `active` deals only (`admin_partners.ts:314-331`). It ends a **deal**. | OD3 | NOW only on a partner-deal row, through a dialog |
| Toolbar: search "name or code", Segment, Terms, Status, "Sort: Accrued" | Filters | **P/N**. Name search and the Accrued sort run in the browser over the rows read. Status works on the Worker for partner-deal rows (`?status=`, `admin_partners.ts:295`). Segment and Terms: **N**. | S-RP | Name search, sort, and Status on partner-deal rows: NOW. The rest: do not draw. |
| Count "1–12 of [12]" and pages | Total | **N**. No read returns a total. | — | Count in the browser. Add "the newest 500" when R2 is full (precedent: `AdminCommissions.jsx:501`) and "200 or more" when a deals call is full. |

#### PG8 · Custom terms, a lightbox over PG7 (`dc:406-412`; caption `bd:52`; overlay `dc:474`)

| Block (dc line) | What it draws | Worker source today | Owner / dep | Now / placeholder |
|---|---|---|---|---|
| Centred lightbox, "Esc to close" (`bd:52`; `dc:264-265`) | Dialog shell | Frontend **E**: `Lightbox` (`fe/ui/Lightbox.jsx`, exported at `fe/ui/index.js:35`). | — | NOW (frontend) |
| Title "Custom terms · [Name]"; "Deal maker · code [LIS-DM-01]" (`dc:406`) | Who, segment, code | **N**. There is no commission-terms store and no segment. A code is readable only on a partner-deal row (PG7). | S-RP | Do not draw until S-RP |
| SEGMENT chips (`dc:407`) | Choice | **N** | S-RP, OD3 | Do not draw |
| CONTRACT "Partner Custom Deal ▾" / "Or Finder's Fee / Intro Agreement", "Preview" (`dc:408`) | Template choice | **P**. Both are registered doc types (`admin_contracts.ts:270-271`; roles `:306`, `:309`; titles `:357-358`), and a `partner_revshare` type is registered too (`:270`, `:355`). Bodies: <br>• Both are **no longer stubs** (the stub seeds are at `mig/085_seed_legal_templates.sql:1672`, `:1675`). <br>• Finder's Fee was filled by `mig/113_refresh_legal_template_bodies.sql:180-221`. Its one economic field is `{{counterparty.fee_pct}}` (`:196`); its field list is at `:221`. <br>• Partner Custom was filled at `:684-723`: equity, revenue share, carry and capital (`:700`, `:723`). <br>• Back-fills for empty bodies: `mig/484_library_coded_templates.sql:211-263`, `:715-765`. <br>No flow sends either template for a partner deal: onboarding always sends `partner_services` (`partner_onboarding.ts:344`). The preview is `GET /templates/store/:slug/preview.pdf`, `requireAdmin` (`admin_contracts.ts:1937-1938`). Neither template has a flat amount, caps, dates or triggers. Changing a template is HQ authoring (`requireHqAuthoring`, `:1904-1905`). | S-RP (template fields) | Template preview: NOW. Choosing a template as a partner's terms: do not draw until S-RP. |
| WHAT PAYS: rows "Startup closes a deal · Share [3]%", "LP onboarded · Flat [$2,500]", Remove, "+ Add a trigger", note "flat or share, never both" (`dc:409`) | Per-partner triggers | **N** store. The "never both" rule exists only for the standard rules (`network.ts:655-660`). | S-RP | Do not draw until S-RP |
| Trigger list: Member completes KYC | Event | **E**. It fires (`kyc.ts:378`). | — | — |
| Trigger list: Startup closes a deal, LP onboarded, Spin-out raise, New operating partner | Events | **N** in effect. The rules exist, but nothing fires them (search above). | OD4 | Do not offer |
| Trigger list: Event tickets sold | Event | **N**. A ticket's PaymentIntent carries only `kind`, `event_id`, `registration_id` and `user_id` (`wk/services/eventTickets.ts:58-67`). The purchase hook needs `referral_code`, `referrer_user_id` and `price_id` (`billing.ts:1864-1869`). | S-RP, #2368 | Do not offer |
| Trigger list: Event sign-ups | Event | **N** | S-RP, #2368 | Do not offer |
| CAP PER INTRODUCTION; OVERALL CAP (`dc:410`) | Caps | **N**. No column holds a cap (`network.ts:69-77`), and the engine applies none (`:167-172`). | S-RP | Do not draw |
| STARTS → ENDS | Dates | **N** as commission terms. `partner_deals.term_months` and `expires_at` set the deal's term and its tier grants (`mig/028:64-70`). | S-RP | Do not draw |
| STUDIO "[Studio Lisbon]" | Scope | **N**. `commissions` has no studio column (`network.ts:36-48`). The ledger routes refuse on a branch (`wk/auth.ts:692-697`), and no branch is deployed. | #2376, S-RP | Do not draw. On HQ it could only read "HQ-held". |
| SECTORS · OPTIONAL | Scope | **N** as a term. `partner_profiles.sectors` is profile text (`mig/028:42`). | S-RP | Do not draw |
| PAYOUT METHOD: "Bank transfer · ending [4821]" / "Credits" (`dc:411`) | Method | **P/N**. The partner picks the method and the destination on each payout request (`network.ts:761-772`); it is not a term. Credits: **N**. Nothing turns a commission into credits, and `grantCredits` refuses partner accounts (`creditGrants.ts:43`, `:166-168`). | S-RP, OD6 | Do not draw |
| STEPS: Draft → Approved by HQ → Sent for signature → Signed → Active (`dc:412`) | Lifecycle | **N**. `partner_deals` has no draft or approval step (`mig/028:67-68`). The nearest precedent: an HQ admin drafts a settlement, and the Super Admin issues it behind the step-up bar (`wk/routes/partner_settlements.ts:57-74`, `:108-113`). | S-RP, OD5 | Do not draw |
| Live sentence "[Name] earns [3]% … up to [$10,000], from … to …" | Summary | **N** data. It would be built in the browser once the store exists. | S-RP | Do not draw |
| Foot "Send for signature opens once HQ approves. Terms take effect only when signed. Until then the standard rules apply." | Behaviour | **N** as behaviour. The engine reads only `commission_rules`, by key (`network.ts:163`). The signature hook activates `partner_deals` only (`wk/routes/esign.ts:1585-1593`). | S-RP | Do not draw |
| Buttons "Save draft", "Send to HQ for approval" (Admin); "Approve" (Super Admin, `bd:52`) | Writes | **N** | S-RP, OD5 | Do not draw |

#### PG9 · Refer & Earn, Overview (`dc:413-419`; caption `bd:53`)

| Block (dc line) | What it draws | Worker source today | Owner / dep | Now / placeholder |
|---|---|---|---|---|
| Pills Live, "Granted to your studio" (`dc:413`) | — | **N** (§0) | S-REG, #2376 | "HQ-held" |
| Line "Every member refers founders, platform users and strategic contacts. Rewards become credits they spend on perks." | Copy | **W** three times: <br>• Explorers cannot open `/referrals` (`fe/App.jsx:3497`), and every new sign-up starts as `exploring` (`wk/routes/auth.ts:391-398`). <br>• Nobody can refer strategic contacts. Nothing ever sets a strategic-access request to `granted`: the only write is the request upsert (`referralSubmissions.ts:626-630`). So `createSubmission` refuses every strategic referral (`:462-468`). <br>• No referral pays credits. The only `grantCredits` callers are `wk/routes/admin_ticket_reviews.ts:225`, `wk/services/bugBounties.ts:178` and `wk/services/labMilestoneCredits.ts:80`, `:100`. `mig/381_credit_reward_rules.sql` seeds no referral key (`grep -i refer` matches only a `REFERENCES` clause at `:35`). | OD1, OD2, S-RE | Do not draw until S-RE. The honest line today: "Founders, investors, advisors and partners refer founders and platform users. Strategic introductions need an invitation, and none can be granted yet." |
| Facts "Who: Every member" | Copy | **W** (see above). The Worker asks only for sign-in (`refer_earn.ts:95`, `:141`). | OD1 | Do not draw until OD1. Draw "Founders, investors, advisors and partners" (`fe/App.jsx:3497`). |
| Facts "Join: Open" | Copy | **P**. Startup and platform-user referrals are open. Strategic referrals are invite-only (`referralSubmissions.ts:21`, `:462-468`), and no write grants an invitation (see above). | S-RE | NOW as "Open; strategic by invitation (none granted yet)" |
| Facts "Rewards: credits" | Copy | **W** (see above). Rewards are "milestone labels settled off-platform" (`refer_earn.ts:44-46`; `mig/175_referral_submissions.sql:8-14`). | OD2, S-RE | Do not draw until S-RE |
| Queue tab count `[7]`, amber | Count | **E**. The glance lane `referrals` gives a true `COUNT(*)` and `MIN(created_at)` (`approvalSources.ts:113-131`; `laneCounts` at `:453-469`). It is served by `GET /api/admin/studio/glance`, `requireAdmin` (`wk/routes/admin_studio_glance.ts:30-37`), with `oldest_age_hours` and an `sla` band per lane (`wk/services/branchHome.ts:360-376`; HQ shape at `wk/services/studioGlance.ts:199-211`). Caveat: the lane counts `more_info_needed` (`approvalSources.ts:123-124`), where "the ball is in the referrer's court" (`referralSubmissions.ts:51-57`). | — | NOW with a caveat. Decide whether "More info needed" counts. |
| Moved notice "Referral review is now Refer & Earn, under Programs." (`dc:415`) | Notice | **N**. `/admin/refer-earn` still renders ReferralReview (`fe/App.jsx:2695`). The pattern exists: `fe/pages/admin/insights/HeldInsightsRedirect.jsx:12-17` and `insightsModel.js:23-25`, counted in `wk/services/redirectRoutes.ts:137`. Conflict: the canvas draws the notice on Overview (`dc:415`, `bd:53`), but the issue sends the redirect to the Queue tab (`iss:465`). | #2375, #2319 | NOW (frontend). Land the redirect on the Queue tab, where the old page's function now lives, as D894 did (`D894.md:22`). |
| Tile "Referrals [48]" | Count | **P**. `GET /api/refer-earn/admin/submissions` takes a `limit` that defaults to 100 (at most 200), returns newest first, and gives no total (`refer_earn.ts:256-283`, `:262`, `:274`). One call per status at `limit=200` gives a complete count for each status below 200 (`:266`). The sample is a twelve-week figure (S1 calls). | S-RE (total), S1 call | NOW with a caveat: one call per status, and "200 or more · **Not read here yet**" for any status that comes back full |
| Tile "Waiting for review [7] · oldest [3 days] · ! Overdue" | Count, age, flag | **E**. The count and `oldest` come from the lane. The age is right, because a row is born `submitted` (`referralSubmissions.ts:476`), but it measures time since submission. Overdue is the glance's `sla === 'past'` (72 hours, `approvalSources.ts:305-312`). The canvas says two days (`iss:173`). | S1 call | NOW with the caveats above |
| Tile "Converted [9]" | Count | **P**. Count it cumulatively, as `countsForReferrer` does (`referralSubmissions.ts:298-305`): one call each for `converted`, `reward_eligible` and `reward_issued`. | — | NOW with a caveat (complete only while each call returns fewer than 200 rows) |
| Tile "Rewards issued [6] · [600] credits" | Count, credits | Count: **P/W**. `reward_issued` can be set when nothing was issued (`reviewSubmission`, `:535-540`). Credits: **N**. `reward_label` is free text (`mig/175:48`). | OD2, S-RE | Count NOW, labelled "marked Reward issued". Credits: **Not recorded**. |
| Chart "Referral funnel", bars "Submitted → … → Reward issued", side tags "More info needed, Rejected, Closed" (`dc:416`) | How many reached each stage | **W** if built from current status. "Reached a stage" needs `referral_submission_events` (`mig/175:67-79`). The only aggregate read of those events gives a median decision age on a branch's Analytics page (`wk/services/approvalAge.ts:103-116`), not a count per stage. The only admin Refer & Earn endpoints are `refer_earn.ts:256` and `:285`. Statuses can skip, because there are no transition rules (`referralSubmissions.ts:535-540`). | S-RE | Bars: **Not read here yet**. Side tags: NOW, as current counts. |
| Chart "Referrals per week by category" (`dc:417`) | 12 weeks × 3 | **P**. Built from R4's `created_at` and `category`. `customer` is "Platform user" (`referralSubmissions.ts:17`, `:82-89`). | S-RE | NOW with a caveat (complete only if twelve weeks fit inside 200 rows) |
| Card "Rewards", lock, rows "[100] credits on acceptance, [400] on formation" / "[50] credits once onboarded" / "Agreed case by case", "Open Perks", foot "Credits are spent on Perks. HQ sets the rewards." (`dc:418`) | Reward amounts | **P/N**. The served text is different: "Milestone-based, on acceptance and formation." (`referralSubmissions.ts:80`); "Platform credit, issued once matched…" (`:88`, itself **W**); "Invite-only economics…" (`:96`). No credit rule exists, and `PUT /api/admin/credit-rules/:key` cannot create a key: it answers 404 `rule_unknown` (`wk/routes/admin_credit_rules.ts:159-162`). | OD2, S-RE | Rows: amounts **Not recorded**. "Open Perks": NOW. Foot: NOW without the first sentence. |
| Card "Strategic referral access", "[2] asking", rows "[Name] · Investor · asked [9 Oct]" with a note, Grant, Decline (`dc:419`) | Requests and decisions | **N** read, **N** write. `rg referral_strategic_access` finds the CREATE (`mig/175:86`; the dev-only ensure at `referralSubmissions.ts:155`), two SELECTs (`:409`, `:419`) and the request upsert, which updates only the note (`:626-630`). There is no approval lane (keys at `approvalSources.ts:47-49`). The store holds `user_id`, `note`, `status`, `decided_at` and `created_at` (`mig/175:86-94`). | S-RE, #2390 | Count and rows: **Not read here yet**. Grant and Decline: do not draw until S-RE. |
| Card foot "Strategic and capital introductions are invite-only." (`dc:419`) | Copy | **P**. The rule is enforced (`referralSubmissions.ts:21`, `:462-468`), but nobody can be let in (see above). | S-RE | NOW, adding "No one can be granted access yet." |

#### PG9q · Refer & Earn, Queue tab (`dc:420-421`)

| Block (dc line) | What it draws | Worker source today | Owner / dep | Now / placeholder |
|---|---|---|---|---|
| Title "Queue · [7]" | Count | **E** (the lane count above). The drawn rows also include `Qualified` (`dc:420`), which the lane does not count. | — | NOW. Say which statuses the count covers. |
| Search "referred, organisation or referrer" | Search | **N** on the Worker | S-RE | NOW in the browser, over the rows read |
| Filters Status, Category | Filter | **E**: `?status=` and `?category=` (`refer_earn.ts:260-267`). Each takes one value, and an unknown status is ignored rather than refused (`:266`). | — | NOW |
| Filter "Referrer role" | Filter | **N**. The read selects only the referrer's `email` and `name` (`:270-272`). `your_role` is the referrer's free-text relationship to the person referred (`mig/175:37-40`), not a platform role. | S-RE | Do not draw |
| Sort "Waiting longest" | Sort | **N/W**. The Worker returns newest first only (`:274`). Today's page sends no `limit` and gets the newest 100 (`fe/pages/admin/ReferralReview.jsx:52`; `fe/lib/api.js:2472-2477`), so the **oldest** waiting rows are the ones dropped. | S-RE | NOW, sorted in the browser, but only with a status filter and a result below the limit. Otherwise say the list is cut. |
| Column Referred (name · organisation) | — | **E** (`toWire`, `referralSubmissions.ts:635-655`) | — | NOW |
| Column Category | — | **E** (`category_name`, `:639`) | — | NOW |
| Column Referrer "[Name] · Founder" | Name, role | Name: **E** (`refer_earn.ts:280-281`). Role: **N**. | S-RE | Name NOW. Role: **Not read here yet**. |
| Column Status | Pill | **E** | — | NOW |
| Column Next step | Text | **E** | — | NOW |
| Column Waiting, amber dot | Age | **P**. It can come only from `created_at`, so it is time since submission. Time in the current status needs the events. | S1 call (Overdue) | NOW, as "since submitted" |
| Row ⋯ / a row opens PG9d | — | Frontend | — | NOW |
| Count "1–7 of [7]", pages | Total | **N**: no total and no offset. | S-RE | Count in the browser, plus "newest 200" when the call comes back full |
| Foot "This tab replaces Referral review; the Approvals lane Refer & Earn reviews opens it." | Wiring | Seven places name `/admin/refer-earn`: <br>• the lane console `LANE_CONSOLES.referrals` (`fe/pages/admin/adminStudioOverview.js:369`) <br>• the sidebar `match` (`fe/sidebarConfig.js:227`) <br>• the rail key (`fe/lib/railPages.js:270`) <br>• board S9 (`fe/lib/railOptions/admin.js:51`) <br>• the placement row (`fe/lib/adminPlacement.js:85`) <br>• the HQ Approvals lane link (`fe/pages/admin/HeldApprovals.jsx:84`) <br>• the branch lane console (`fe/pages/branch/BranchApprovals.jsx:607`) | #2390, #2319 | NOW (frontend). Keep the `/admin/commissions` door (`ReferralReview.jsx:77-83`, pinned by `frontend/test/partner_earnings_d569.test.mjs:840`). |

#### PG9d · A referral, opened (`dc:422`)

| Block (dc line) | What it draws | Worker source today | Owner / dep | Now / placeholder |
|---|---|---|---|---|
| Title "[Name] · [Bluefern Health]"; "Startup or founder · referred by [Name] · Founder" | Header | **E**, except the referrer's role (**N**) | S-RE | NOW, without the role |
| TIMELINE "Submitted by the referrer [21 Oct]", "Under review by an admin [22 Oct]" | Events | **P**. Events are stored with `actor_user_id` (`appendEvent`, `referralSubmissions.ts:497-509`). An admin gets the history **only** in a PATCH response (`refer_earn.ts:299-300`); no admin GET of one submission exists. `listEvents` leaves the actor out (`referralSubmissions.ts:273`), so "by an admin" is copy, as the rule asks (`iss:423`). | S-RE | **Not read here yet** before a save; the response's `history` after one |
| STATUS ▾ | Select | **E**: `PATCH /api/refer-earn/admin/submissions/:uid` (`refer_earn.ts:285-304`). Any status may follow any other (`referralSubmissions.ts:535-540`). | S-RE (transition rules) | NOW. Send `status` only when it changed: an event is appended whenever `status` is present (`:555-557`), and today's page always sends it (`ReferralReview.jsx:176`). |
| NEXT STEP | Text, max 240 | **E** (`:542`) | — | NOW |
| REWARD "[100] credits on acceptance" | Text, max 120 | **E** as free text (`:541`). **W** as drawn: it reads as credits, and it pays nothing. | OD2, S-RE | NOW, as a text field labelled as a note, never parsed as an amount |
| FIT NOTES | Text, max 2000 | **E** (`:543`). The referrer sees them (`mig/175:50-52`). | — | NOW |
| NOTE TO THE REFERRER, "What you write here is what the referrer sees." | Note | **E**. The note becomes a timeline event, which the referrer reads on their own detail page (`refer_earn.ts:172-179`). | — | NOW |
| Back / "Save changes" | Write | **E**: `requireAdmin` (`:286`). It returns 423 on a suspended branch (`requireBranchNotSuspended`, `:288`) or for a frozen admin (`wk/auth.ts:523-528`). It writes no audit row and sends no notice: `rg "notify\|logAdminAction\|activity_logs"` over `refer_earn.ts` and `referralSubmissions.ts` returns nothing. | S-RE | NOW with a caveat: the dialog says the referrer sees the change on their page and is not notified |

#### PG9s · Settings, "Who can refer" (`dc:493`)

| Block (dc line) | What it draws | Worker source today | Owner / dep | Now / placeholder |
|---|---|---|---|---|
| Card "Who can refer", note "Settings · Refer & Earn" | Settings | **N**. `rg -i "who_can_refer\|referrer_roles\|refer_earn_settings\|referral_settings\|referral_program\|program_paused"` over `wk/`, `cloudflare-worker/sql` and `fe/` returns nothing. | S-RE, OD1 | Do not draw switches until a store the Worker enforces exists |
| Switches Founders, Investors, Advisors, Partners on; Explorers off | Five switches | **P/W**. Today the frontend guard decides (`fe/App.jsx:3497`). The Worker admits any signed-in account (`refer_earn.ts:140-141`), so a switch would change nothing. | OD1 | NOW only as a read-only line: "Founders, investors, advisors and partners can open Refer & Earn." |

#### PG10 · Perks (`dc:423-435`; caption `bd:54`)

| Block (dc line) | What it draws | Worker source today | Owner / dep | Now / placeholder |
|---|---|---|---|---|
| Pills Live, "Granted to your studio" (`dc:423`) | — | **N** (§0). `perks.grant_scope` is what a redeemer receives, not a studio grant (`mig/228_perk_lifecycle_and_grant.sql:33`, `:85`). | S-REG, #2376 | "HQ-held" |
| Line "Partners list perks. Members claim them with credits, through their plan, or by paying the partner." | Copy | **W** on "Members": only founders claim (`PERK_CLAIMANT_ROLES`, `wk/routes/perks.ts:122-128`). The three ways to pay are true (`:28-36`): `money` records intent, and the partner invoices offline. | — | NOW as "Founders claim them…" |
| Facts "Who: Every member · Join: Open · Prices: credits, plan or paid" | Copy | "Who": **W**. Every signed-in account browses (`GET /api/perks/`, `requireAuth`, `:863-866`), except partners, whom `/perks` sends to their own Perk deals page (`fe/App.jsx:2960`). Only founders claim. "Prices": **E** (`mig/186_perks.sql:57-58`). | — | NOW as "Who: founders claim; members browse" |
| Queue `[3]`, amber | Count | **E** below 200. `GET /api/perks/admin/queue`, `requireAdmin` (`:767-778`), returns the **oldest** 200 (`ORDER BY p.created_at ASC`, `:774`) with no total. It reads `in_review` and `draft` (`:773`), but nothing writes `draft`: `'draft'` appears in `perks.ts` only at `:773` (it is the column default, `mig/186:73`, but every insert sets a status). The count includes the 12 seeded listings, which enter as `in_review` (`mig/366_verified_startup_perks.sql:4-5`, `:15-26`). | NEW-PK | NOW, counting `in_review` only, with "200 or more" when the read is full |
| ⋯ Pause program, Download (CSV) | — | §0 | — | §0 |
| Tile "Live perks [18]" (`dc:425`) | Count | **E**. `GET /api/perks/` serves live listings that have not ended (`:871`), at most 200 (`:872`). | — | NOW (complete below 200) |
| Tile "Waiting for review [3] · oldest [2 days]" | Count, age | Count: **E** (below 200). Oldest: **P/W**. The queue serves two dates (`SELECT p.*`, `:771`): <br>• `created_at`, the first submission. <br>• `updated_at` (`mig/186:81`), which every partner edit bumps (`perks.ts:630`), and so does every review (`:850`). <br>For a live listing edited back into review (`:629`), `created_at` is too old. `updated_at` is right only until the partner edits again. No `submitted_at` exists. | NEW-PK | Count NOW. Oldest: label it "listed [date]" (from `created_at`), never "waiting". |
| Tile "Claims [42] · [30] redeemed" | Counts | **N** admin read. The data is stored (`perk_claims`, `mig/186:90-110`). The sample is a twelve-week figure (`dc:427`; S1 calls). | NEW-PK | **Not read here yet** |
| Tile "Credits held by members [12,400]" | Sum of balances | **N**. No read sums the ledger across members: `rg "SUM\((\w+\.)?delta\)"` hits only per-user reads (`perks.ts:283`, `:1020`; `creditGrants.ts:80`, `:296`). The Super Admin's grants list (`admin_credit_rules.ts:74-112`) shows grants only, not spends. | NEW-PK, OD8 | **Not read here yet** |
| Chart "Top perks by claims", top 8 with redeemed (`dc:426`) | Bars | **N**. `claim_count` is computed (`LISTING_SELECT`, `:408-412`), but `publicPerk` drops it (`:382-401`). Redeemed counts exist only on a partner's own listings (`:496-507`). | NEW-PK | **Not read here yet**. The smallest fix serves both counts on an admin read. |
| Chart "Claims per week by price type" (`dc:427`) | Stacked bars | **N** read. Stored: `kind_at_claim`, a snapshot (`mig/186:99`), and `created_at` (`:109`). `credits` → Credits, `tier` → Included in plan, `money` → Paid to partner. | NEW-PK | **Not read here yet** |
| Review queue: Perk | Offer | **E** | — | NOW |
| Review queue: Partner | Name | **E**. The 12 seeded listings have no partner account (`mig/366:9-26`), and today's page prints "no account" for them (`fe/pages/PerksPage.jsx:1539`). | — | NOW |
| Review queue: Price | Label | **P/W**. The fields are `kind`, `credits`, `required_tier` and `price_cents`, labelled at `PerksPage.jsx:94-98`. The 12 seeded listings are external programs priced as `credits` at 0 (`mig/366:15-26`), so the label reads "0 credits" (`PerksPage.jsx:97`). | NEW-PK | NOW, but never print "0 credits" for a zero-credit listing. Set its label in the decision record. |
| Review queue: Sent | Date | **P/W** (the same two dates as the tile) | NEW-PK | NOW, labelled "Listed" |
| Review queue: Status (In review, Live, Paused, Rejected; the filter also offers Draft) | Pill | **P**. In review: **E**. Live: **P**, because `GET /api/perks/` serves live listings that have not ended, with their `uid` (`perks.ts:382-386`, `:871`) but without `partner_email`. Paused and Rejected: **N**, because the queue serves only `in_review` and `draft` (`:773`). | NEW-PK (paged listings read across statuses) | In review and Live: NOW. Paused and Rejected: wait for NEW-PK. |
| Toolbar: search, Status, Price type, "Sort: Waiting longest"; "1–6 of [6]" | Filters, count | Sort: **E** (`ORDER BY created_at ASC`, `:774`). Search and filters run in the browser over at most 200 rows. No total. | NEW-PK | NOW with a caveat (the cap) |
| ⋯ Approve | Write | **E**. `POST /api/perks/admin/:uid/review` moves the listing to `live` (`:830-857`, `:844`). An approval sent without a note clears `review_note` (`:852`), which erases the provenance note each seeded listing carries (`mig/366:15-26`). | — | NOW, through a dialog (today it is one click, `PerksPage.jsx:1562`) that keeps the existing note |
| ⋯ "Send back (a reason is required; the partner sees it)" | Write | **W**. Only `reject` exists, and it is final (`:844`): <br>• A partner's later edit leaves a rejected listing rejected (`:629`, `:633`). <br>• The queue never shows it again (`:773`). <br>The note is shown on the partner's own listing (`PerksPage.jsx:1476-1477`). No notice is sent. D915 reads a stored `rejected` as "Sent back" (`D915.md:65`), but only because a host can resubmit a rejected event (`wk/routes/events.ts:489-500`). That precedent does not carry over to perks. | OD7, NEW-PK | Until OD7, draw "Reject (final)" with a required note. Do not call it "Send back". |
| ⋯ Pause | Write | **E** in the Worker (`REVIEWABLE`, `:74`). Today's UI does not offer it (`PerksPage.jsx:1561-1566`). | — | NOW |
| ⋯ Feature switch with one editorial line | Write | **P**. It can be set but **never cleared** (`b?.featured ? 1 : perk.featured`, `:853`), and only inside a review action. The editorial line is **E** (`:845-847`). | NEW-PK | Feature on: NOW. Feature off: do not draw. |
| Every review write | Audit and gates | **N**. No audit row and no notice: `rg "logAdminAction\|notify\(\|activity_logs" wk/routes/perks.ts` finds only the redeem log (`:753-758`). No status precondition (`:838-844`). No suspension gate (imports at `:63`). | NEW-PK | NOW, with the dialog saying the partner is not notified |
| The "Perk listings lane" that opens this queue (caption `bd:54`) | Approvals lane | **N**. `APPROVAL_SOURCES` has no perks key (`approvalSources.ts:47-49`, list at `:101-258`). | #2390 | Until #2390 adds the lane, the Queue tab is reached only from the Programs page |
| Card "Credits", lock, "A Super Admin grants credits." (`dc:435`) | Copy | **E** for manual grants (`requireSuperAdmin` at `:785`, `:806`). Rule grants are made automatically, for bounties, approved tasks and Lab milestones (`creditGrants.ts:4-7`). | — | NOW |
| Foot "Members hold [12,400] credits. 1 credit is worth $1 of perk value." | Total and rate | Total: **N** (above). Rate: **E** (`CREDIT_USD_CENTS`, `:254`; `mig/381:3`). | NEW-PK, OD8 | Rate NOW. Total: **Not read here yet**. |

#### PG10s · Super Admin, Grant or deduct credits (`dc:494`)

| Block (dc line) | What it draws | Worker source today | Owner / dep | Now / placeholder |
|---|---|---|---|---|
| Eyebrow SUPER ADMIN; title "Grant or deduct credits" | Form | **E**. `POST /api/perks/admin/credits`, `requireSuperAdmin` (`perks.ts:783-798`), goes through `manualAdjust` (`creditGrants.ts:312-368`). The client is `memberCreditsApi.adjust` (`fe/lib/api/memberCredits.js:11`). The form already exists as `AdjustForm` (`fe/pages/hq/MemberCreditsPage.jsx:40`). | — | NOW |
| MEMBER "[Name] ▾" | Search | **E**: `GET /api/admin/users?q=`, `requireAdmin` (`wk/routes/admin.ts:50`, `q` at `:71`). | — | NOW |
| AMOUNT "+[200] credits" | Delta | **E**: non-zero, at most 100,000 either way (`creditGrants.ts:284`, `:320-323`). | — | NOW |
| REASON · 10 CHARACTERS OR MORE | Text | **E** (`:286`, `:324-327`). It is written to the admin audit (`:359-361`). | — | NOW |
| Back / "Grant credits" | Write | **E**. Refusals: 404 `user_not_found`, 409 `already_recorded`, and 400 for the rest, including `would_overdraw` (`perks.ts:792`; `creditGrants.ts:339-356`). There is no role check, so it can credit admin and partner accounts (`:334-335`), which `grantCredits` refuses (`:43`). | OD8 | NOW |
| Foot "The member sees the amount and the reason." | Copy | **W**. The member's notice carries the amount and the **note** (`:362-365`), and the note defaults to "Credits added by the Axal team" (`:338`). The reason goes only to the audit row. | — | Add a "Note the member sees" field (`MemberCreditsPage.jsx:44`, `:68`), or change the line |

#### PG12 · Learning (`dc:445-453`; caption `bd:56`)

| Block (dc line) | What it draws | Worker source today | Owner / dep | Now / placeholder |
|---|---|---|---|---|
| Pills Live, "Granted to your studio" (`dc:445`) | — | **N** (§0). Programs exist only on HQ: authoring is `requireSuperAdmin` (`wk/routes/admin_learning.ts:46-48`), which refuses on a branch (`wk/auth.ts:692-697`). `region` is free text (`mig/389_learning_programs.sql:23-24`), not a grant. | S-REG, #2376 | "HQ-held" |
| Line "Programs of courses, videos, exercises and exams for a region or a group." | Copy | **E** | — | NOW |
| Facts "Who: Every member" | Copy | **W** today. The Worker lets any signed-in account self-enrol (`wk/routes/learning_programs.ts:123-142`), and `/learning` admits `exploring` (`fe/routes/learning.jsx:33`). But the Learning center shows every non-admin profile "Coming soon", except Articles (`LEARNING_COMING_SOON = true`, `fe/pages/learning/learningAccess.js:37`; `learningComingSoon`, `:49-52`). The gate is applied before any view mounts (`fe/pages/learning/LearningPage.jsx:176-179`). No member screen offers a program today. | — (the owner's temporary gate, `learningAccess.js:4-7`) | NOW as "Who: admins only while Learning is coming soon; then every member" |
| Facts "Join: Open or by invitation" | Copy | **E** as stored (`mig/389:26`), but members cannot reach it while the gate is on (above) | — | NOW, with the same caveat |
| Facts "Cycle: self-paced" | Copy | **E** as copy; no store holds it | — | NOW |
| Queue `[0]` | Count | **W** as a zero. No queue exists: an invitation-only program answers 403 `invite_only` and records no request (`learning_programs.ts:129-131`). | — | "No queue" |
| ⋯ Download (CSV) | Export | §0 | — | NOW, built in the browser (names only) |
| Tile "Published programs [4]" (`dc:446`) | Count | **E**. `GET /api/learning/programs/mine` (`learning_programs.ts:104-121`) gives an Admin only the programs assigned to them (`:115`) and gives a Super Admin every program. Filter on `status='published'` in the browser. | — | NOW. Label it "assigned to you" for an Admin. |
| Tile "Active learners [126]" | People or enrolments | **P**. Counts are per program (`:112`; `admin_learning_programs.ts:88`). The canvas sums them (126 = 30 + 40 + 26 + 30, `dc:450-453`), which counts a person in two programs twice. Distinct people need one `GET /programs/:uid/learners` per program (`learning_programs.ts:178-188`), de-duplicated by `uid`. | S1 call, NEW-LN (a distinct read) | NOW either as "Enrolments [126]" (the sum) or as distinct people de-duplicated in the browser. Never the sum labelled as learners. |
| Tile "Finished [38]% · [48] of [126]" | Rate | **N** rule: nothing defines a finished program. The cells exist (`wk/services/learningPrograms.ts:163-191`). The canvas's rate is per enrolment (48 = 12 + 18 + 9 + 9, `dc:447`). | OD9, S1 call | **Not recorded** until OD9 |
| Tile "Enrolled this period [22]" | Period count | **P/W**: <br>• `enrolled_at` is served only for **active** learners (`learningPrograms.ts:101-108`). <br>• The Super Admin's detail also lists removed enrolments (`admin_learning_programs.ts:58-62`). <br>• Re-enrolling a removed learner resets `enrolled_at` (`:219`). <br>• The sample ties "this period" to the twelve-week chart (`dc:448`), though program pages have no period control (`dc:468-471`). | S1 call, NEW-LN | NOW with a caveat (a fixed twelve-week window, and "re-enrolments count again"), or **Not read here yet** |
| Chart "Completion by program", "[12] of [30] finished" (`dc:447`) | Bars | **P**: one learners read per program, plus the OD9 rule. An Admin sees only assigned programs. | OD9 | **Not recorded** until OD9; then built in the browser |
| Chart "Enrolments per week" (`dc:448`) | Line | **P/W**, as "Enrolled this period" | NEW-LN | NOW with a caveat, or **Not read here yet** |
| Table: Program, region | — | **E** (`programView`, `learningPrograms.ts:33-38`) | — | NOW |
| Table: Status (Draft, Published, Archived) | — | **E** (`mig/389:27`) | — | NOW |
| Table: Enrolment (Open, By invitation) | — | **E** (`mig/389:26`) | — | NOW |
| Table: Contents `[12]` | Count | **E** via `/mine` (`learning_programs.ts:113`). The Super Admin's list leaves it out (`admin_learning_programs.ts:87-89`), but `/mine` serves the Super Admin every program. | — | NOW |
| Table: Learners `[30]` | Count | **E** (`learning_programs.ts:112`) | — | NOW |
| Table: Assigned admins `[2]` | Count | Super Admin: **E** (`admin_learning_programs.ts:89`). Admin: **N**, because `/mine` has no admins count and the detail read is Super Admin only. The data is stored in `learning_program_admins` (`mig/389:46-54`). | NEW-LN | Super Admin: NOW. Admin: **Not read here yet**. |
| Row ⋯ (Super Admin: new program, publish or archive, contents, assign admins, enrol) | Writes | **E**, all in `wk/routes/admin_learning_programs.ts` and all audited through `record` (`admin_learning.ts:50-51`): create `:95`, PATCH status `:116`, contents `:143` (a webinar is refused at `:158`), assign `:177` (admins only, `:183-185`), unassign `:193`, enrol `:207`, remove `:226`. | — | Super Admin: NOW, each through a dialog. Admin: no actions. |
| Toolbar: search, Region, Enrolment, "Sort: Learners"; "1–4 of [4]" | Filters, count | **P**: filtering in the browser over at most 500 rows (`learning_programs.ts:116`); no server filters. | — | NOW (complete below 500) |
| Foot "You follow the programs HQ assigns you. Progress is read only. A learner row opens their record." | Copy | **E**. Only assigned admins and the Super Admin read learners (`readerOf`, `learning_programs.ts:169-176`), and an Admin has no write. | — | NOW |
| Tab Activity | History | **P**. Every program write is audited (`admin_learning.ts:50-51`). Nothing reads those rows per program: the Super Admin's governance feed returns every audit action, newest first, unfiltered (`wk/routes/admin_security.ts:548-554`, `:613-614`). | NEW-LN | **Not read here yet** |
| Today's admin Learning pages | Existing pages | **E**: `/learning/programs` for an assigned admin (`fe/routes/learning.jsx:42-43`), and `/learning/studio/programs` for the Super Admin (`hqOnly`, `:44-46`) | #2375 | NOW. The program page links to these pages or reuses their reads. Decide in the record which of them it replaces. |

#### PG12d · A learner, opened (`dc:454`)

| Block (dc line) | What it draws | Worker source today | Owner / dep | Now / placeholder |
|---|---|---|---|---|
| Title "[Name]"; no email | Learner | **E**: `GET /api/learning/programs/:uid/learners/:userUid` (`learning_programs.ts:190-201`), which serves the name, uid and `enrolled_at` only (`learningPrograms.ts:95-108`) | — | NOW |
| Sub "[Founder basics · Lisbon]" | Program, region | **E** | — | NOW |
| Sub "· last activity [12 Oct]" | Date | **N** in the output. `learning_progress.updated_at` (`mig/388_learning_core.sql:103`) is never selected. | NEW-LN | **Not read here yet** |
| Eyebrow kind: VIDEO, COURSE, EXERCISE, EXAM | Kind | **P**. Course, exercise and exam are **E** (`subject_kind`). "Video" is an `item` whose `kind` (video or reading, `mig/388:20`) is selected (`learningPrograms.ts:49`) and then dropped (`describeContents`, `:67-77`). | NEW-LN (serve `kind`) | NOW, reading "Item" until `kind` is served |
| Title per row | Content title | **E** (`describeContents`; it reads `missing` when the row is gone) | — | NOW |
| Status Done / Not yet: Video, Course | — | **E**: `completed`, `in_progress`, `not_started` (`:165-177`) | — | NOW (Done = `completed`) |
| Status Done / Not yet: Exercise | — | **P**. The cell is the latest submission's status: `submitted`, `accepted`, `needs_work` or `not_submitted` (`:178-180`; CHECK at `mig/390_learning_exercises_exams.sql:40`). | OD9 | NOW, once OD9 says whether "submitted" counts as Done |
| Status Done / Not yet: Exam | — | **E**: `passed`, `not_passed`, `not_attempted`, with the best score and the number of attempts (`:181-184`) | — | NOW |
| Date per row "[2 Oct]" | Done date | **N** in the output. `completed_at` (`:124`) and the exam's `submitted_at` (`:137`) are selected but not returned (`:188-191`). | NEW-LN | **Not read here yet** |
| Row WEBINAR "Pricing questions · Not yet" | Webinar content | **N**. A program cannot hold a webinar: the route answers 400 `webinar_not_built` (`admin_learning_programs.ts:158`). That refusal is stale, since the webinar store exists (`mig/391_learning_webinars.sql:16`). The cell would read `not_built` (`learningPrograms.ts:185`), and `attended` (`mig/391:47`) is never read. | NEW-LN | Do not draw until the contents route accepts webinars |
| Note "No email is shown here. Progress is read only."; Close | Copy | **E** | — | NOW |

---

#### Figures that would be wrong today on these boards

1. **PG9 / PG9d: "[600] credits", "[100] credits on acceptance", "Rewards: credits", "Rewards become credits".**
   - No referral grants credits.
   - The only `grantCredits` callers are tickets, bounties and the Lab (`admin_ticket_reviews.ts:225`, `bugBounties.ts:178`, `labMilestoneCredits.ts:80`, `:100`).
   - `mig/381` has no referral key.
   - `reward_label` is free text (`mig/175:48`).
   - The member page repeats the promise (`fe/pages/ReferralsPage.jsx:91`; `referralSubmissions.ts:88`).
2. **PG9 "Rewards issued [6]".** `reward_issued` can be set when nothing was issued (`referralSubmissions.ts:535-540`).
3. **PG9 "Referral funnel" built from current status.** Statuses skip and move backwards freely (`:535-540`). "Reached a stage" needs events that no admin read returns.
4. **PG9 "Waiting for review" and the Queue count.** Both include `more_info_needed` (`approvalSources.ts:123-124`), which is waiting on the referrer, not on an admin (`referralSubmissions.ts:51-57`).
5. **PG9q "Waiting longest", and "Nothing in this queue" on the old page.** The read is newest first, and the page asks for the default 100 (`refer_earn.ts:262`, `:274`; `ReferralReview.jsx:52`), so the oldest waiting rows are the ones cut. When the first read fails, today's page shows its error and also "Nothing in this queue." (`ReferralReview.jsx:42`, `:111-125`).
6. **PG9 / PG9s: "Who: Every member" and the Explorers switch.** Explorers cannot open `/referrals` (`fe/App.jsx:3497`), but the Worker accepts their submissions (`refer_earn.ts:140-141`).
7. **PG9: "strategic contacts" and "strategic by invitation".** Nothing grants strategic access (`referralSubmissions.ts:626-630` is the only write), so every strategic referral is refused (`:462-468`).
8. **PG7: the Standard rules card read as "what a referral code earns".**
   - Four of the five rules never fire: only `kyc.ts:378` calls the engine.
   - Purchase commissions are missing from the card (`billing.ts:1863-1889`).
   - Compounding bonuses are missing too: 50% and 25% of each base commission, paid up the chain (`networkfx.ts:16`, `:131-147`).
   - `PART-` codes never earn commissions (`auth.ts:460-470`; `network.ts:159-160`).
9. **PG7: "paid" taken from `commissions.status`.** That status means a payout request claimed the commission (`network.ts:834`). Completion is `payouts.status` (`:891`), and completing a payout moves no money (`:889`).
10. **PG7: money summed across currencies** (`network.ts:525-546`), or totals that ignore refunds (the clawback columns exist only in dev, `referralCommissions.ts:39-49`).
11. **PG7: "Join: By invitation", "With signed terms" and "their own signed terms", read as commission terms.** Any account earns under the standard rules. The signed terms that do exist belong to partner deals (`mig/028:55-75`): the commission engine never reads them, and only hand-drafted settlements carry their money (`partner_settlements.ts:57-74`).
12. **PG8: "Until then the standard rules apply" read as an override that exists, and the "Event tickets sold" trigger.** The engine reads only `commission_rules` (`network.ts:163`). Tickets carry no referral data (`eventTickets.ts:58-67`).
13. **PG10 "Who: Every member" and "Members claim".** Only founders claim (`perks.ts:122-128`), and partners never see the catalogue page (`fe/App.jsx:2960`).
14. **PG10 "oldest [2 days]" and the "Sent" column.** No date records when a listing was sent for review:
    - `created_at` is the first submission.
    - `updated_at` moves on every edit and every review (`perks.ts:630`, `:850`).
15. **PG10 "0 credits" on the 12 seeded listings.** They are external programs stored as `credits` at 0 (`mig/366:15-26`; label at `PerksPage.jsx:97`).
16. **PG10 "Send back".** A reject is final, and the partner's edit never resubmits the listing (`perks.ts:629`, `:633`, `:773`, `:844`).
17. **PG10 Feature switch.** It cannot be switched off (`perks.ts:853`).
18. **PG10s "The member sees the amount and the reason".** The member sees the amount and the note (`creditGrants.ts:338`, `:362-365`).
19. **PG12 "Who: Every member".** Every non-admin profile sees "Coming soon" (`learningAccess.js:37`, `:49-52`).
20. **PG12 "Active learners" and "Finished … of …" as people.** The canvas sums per-program counts (`dc:446-453`), which counts a person in two programs twice (`learning_programs.ts:112`).
21. **PG12 "Enrolled this period" and "Enrolments per week".** Re-enrolling a removed learner resets `enrolled_at` (`admin_learning_programs.ts:219`), and an Admin never sees removed learners (`learningPrograms.ts:105`).
22. **`[0]` on the Queue tabs of PG7 and PG12.** Neither program has a queue, so a zero claims a measured empty one.
23. **Any tile whose window is not stated.** The samples are windowed (twelve weeks, a quarter, six months; S1 calls), while the reads above are all-time unless the browser windows them.

#### Buildable NOW with no Worker change

- **Frame (all four pages).**
  - Crumb, title, tabs as literal links, and "HQ-held" in place of every grant badge.
  - Honest facts lines, per the rows above.
  - "No queue" where none exists.
  - Browser-side CSV over the rows read.
  - The Chart ⇄ Table switch.
- **PG7, Super Admin:**
  - The Standard rules card with the existing editor (`AdminCommissions.jsx:64-127`). Mark each rule that never fires, and add the purchase and compounding lines.
  - The commission tiles and "Commission by month" from R2 and R3: per currency, with the 500 and 200 completeness notes, and "paid" taken from completed payouts.
  - A table of commission holders: name, "Standard rules", accrued, paid, last activity.
- **PG7, any Admin:**
  - The one-paragraph explanation (`AdminCommissions.jsx:623-635`) in place of every commission figure.
  - "Invite a partner" linking to `/admin/partners` (#2370).
  - Row "End" on a partner-deal row, through a dialog.
- **PG7, if OD3 is "partner deal" (any HQ Admin):**
  - Partner rows from `GET /api/admin/partners/deals`: name, `PART-` code, deal state, and sign-ups with the code (`admin_partners.ts:293-312`).
  - "Signed / waiting to sign" from two status calls.
  - "Settlements under partner deals: issued / matched" from `GET /api/admin/partner-settlements` (`partner_settlements.ts:37-55`).
- **PG8:** only the template Preview link (`admin_contracts.ts:1937`) and a link to Contracts.
- **PG9:**
  - The moved notice and an unguarded redirect that keeps the query and the hash, adds `?moved=`, and is counted in `redirectRoutes.ts` (#2319).
  - The Waiting tile and the Queue count from the glance lane, with Overdue taken from its `sla` band (72 hours).
  - The Referrals and Converted tiles from one R4 call per status at `limit=200`, with a cap note per status.
  - The weekly chart from R4, with its cap note.
  - The side tags as current counts.
  - The Rewards card's three served text lines, with the amounts "Not recorded", and "Open Perks".
  - The strategic card's foot, with "none granted yet".
- **PG9q:**
  - The queue with the Worker's Status and Category filters.
  - Search and sort in the browser, with a cap note.
  - The `/admin/commissions` door kept.
  - All seven places that name `/admin/refer-earn` re-pointed.
- **PG9d:**
  - Every field and Save, sending `status` only when it changed.
  - The timeline from the PATCH response.
  - A dialog line saying the referrer is not notified.
- **PG10:**
  - Live perks, and the waiting count (`in_review` only, oldest 200), with "Listed [date]".
  - The review queue for In review rows, plus Live rows from the catalogue read, with Approve (keeping the note), Reject (final, with a required note), Pause and Feature on, each through a dialog.
  - The Credits lock card and the $1 rate.
  - The member `/perks` Review tab replaced by a link (`iss:466`).
- **PG10s:** the form, with the AdjustForm logic and a "Note the member sees" field.
- **PG12:**
  - Published programs from `/mine`, and learners as enrolments or as distinct people (S1 call).
  - The programs table (Assigned admins for the Super Admin only), with the Super Admin's actions through dialogs.
  - The Admin read-only line, the "coming soon" fact line, and links to `/learning/programs` and `/learning/studio/programs`.
- **PG12d:**
  - Name, program and region.
  - Each content row's title and status (course, item and exam now; exercise after OD9).
  - "Item" in place of "Video".

#### Honest placeholders

**Not recorded** (no store holds the value):
- PG7:
  - Segments: the chips, the pills and the outcome chart.
  - "Introductions" as the canvas draws them.
  - Active partners, until OD3.
  - Custom commission terms in every form: the PG8 body, caps, dates, studio, sectors, payout as credits, and the step strip.
  - Program pause.
- PG9:
  - The credit amounts on the Rewards card, and the "[600] credits" sub-line.
  - Who can refer (the PG9s switches).
- PG12:
  - Finished %, and "Completion by program", until OD9.
  - Webinar rows.
- All four pages: the How it runs, Terms and Settings tabs, until S-REG lands.

**Not read here yet** (stored; no read this page may call returns or sums it):
- PG7:
  - For an Admin, every commission figure: the Super Admin holds the ledger (`network.ts:571`, `:583`, `:936`).
  - Member referral codes, Converted, and Intros for member referrers.
- PG9:
  - The funnel's "reached" bars (from `referral_submission_events`).
  - The strategic access count and rows (`referral_strategic_access`).
  - Referrer role.
  - The timeline before a save.
  - Any status whose R4 call comes back full.
- PG10:
  - Claims and redeemed.
  - Top perks by claims.
  - Claims per week by price type.
  - Credits held by members.
  - Paused and Rejected rows in the queue.
  - Review activity, other than the redeem log.
- PG12:
  - Assigned admins, for an Admin.
  - Last activity.
  - The done date on each row.
  - The program Activity tab.
  - Enrolments per week, when not derived with its caveat.

**Could not be read** (a read failed; mark that block alone, never its neighbours). Each read below answers on its own, so its failure marks only the blocks it feeds:
- R1, R2, R3: no try/catch, so a failure is a 500 through `app.onError` (`wk/index.ts:1466`).
- R4: no try/catch, so the same 500.
- `GET /api/admin/partners/deals` and `GET /api/admin/partner-settlements`: no try/catch, so the same 500.
- The glance lane: `count: null` when it fails (`approvalSources.ts:464-466`). The whole glance fails through `mapError` (`admin_studio_glance.ts:34-35`).
- `GET /api/perks/admin/queue` and `GET /api/perks/`: `mapError`, which answers 5xx for a D1 error (`perks.ts:777`; `wk/routes/_t13t14t15_helpers.ts:128-164`).
- `/learning/programs/mine` and `…/learners`: `app.onError`.
- Not on these boards, but it hides a failure: the Refer & Earn overview's code read swallows its error (`refer_earn.ts:62-64`) and then writes a freshly minted code (`:69-71`).

The existing components are `Unreadable` and `Unrecorded` (`fe/ui/Honesty.jsx:62`, `:37`).

#### How each absence was established

| Search | Scope | Result |
|---|---|---|
| `rg -i "program_grants\|programme_grants\|program_registry\|programs_registry\|program_proposals\|program_playbook"` | `cloudflare-worker`, `frontend/src` | Nothing |
| `rg "/admin/programs"` | `cloudflare-worker/src`, `frontend/src` | Nothing |
| `rg -i "who_can_refer\|referrer_roles\|refer_earn_settings\|referral_settings\|referral_program\|program_paused"` | `wk/`, `cloudflare-worker/sql`, `fe/` | Nothing |
| `rg -n "referral_strategic_access\|strategic_access"` | `wk/`, `cloudflare-worker/sql`, `fe/`, `backend/app` | CREATE, ensure, two SELECTs, one upsert that updates only `note`, and the route's echo. Nothing sets `status`. |
| `rg -n "notify\|logAdminAction\|activity_logs"` | `refer_earn.ts`, `referralSubmissions.ts` | Nothing (exit 1) |
| `rg -n "fireCommissionEvent\(\|referral_deal_funded\|referral_lp_onboarded\|referral_spinout\|referral_partner_fee"` | `wk/`, `fe/`, `backend/app` | The seeds plus the KYC caller only |
| `rg -n "INTO commissions"` | `wk/` | Three writers: `network.ts:177` (rules), `:244` (purchases), `networkfx.ts:143` (compounding) |
| `rg -n "grantCredits\("` | `wk/` | Four call sites |
| `grep -i refer mig/381_credit_reward_rules.sql` | — | Only a `REFERENCES` clause (`:35`) |
| `rg -n -i "event.?organi[sz]er\|venture.?scout\|deal.?maker\|dealmaker"` | `wk/`, `cloudflare-worker/sql`, `fe/` | No segment |
| `rg -n "referral_code" wk/routes/admin*.ts` | — | `PART-` codes only |
| `rg -n "FROM perk_claims"` | `wk/` | No admin aggregate (the `research.ts:2355` hit is partner-scoped) |
| `rg -n "SUM\((\w+\.)?delta\)"` | `wk/` | Per-user only |
| `rg "'draft'\|'paused'\|'rejected'" wk/routes/perks.ts` | — | `:773` and `:844` only |
| `rg -n "INSERT (OR \w+ )?INTO perks\b\|UPDATE perks SET"` | `wk/`, `cloudflare-worker/sql` | `perks.ts:556` (`in_review`), `:632`, `:849`, and `mig/366:9` (`in_review`) |
| `rg -n -i "perk listings\|'perks'"` | `approvalSources.ts`, `studioGlance.ts`, `adminStudioOverview.js`, `HeldApprovals.jsx` | No perks lane |
| `rg -n "learningComingSoon"` | `fe/` | One gate, applied in `LearningPage.jsx:177` |
| `rg "reversed_amount_cents" cloudflare-worker/sql` | — | Nothing |

#### Issue #2371 cites for these boards, re-checked at `fbbb4c8`

| Issue cite (`537f646a3f`; that commit is not in this clone, so only the HEAD side was read) | HEAD |
|---|---|
| `fe/App.jsx:3479` (`/referrals`) | `fe/App.jsx:3497` |
| `fe/App.jsx:2691` (`/admin/refer-earn`) | `:2695` |
| `fe/App.jsx:2696` (`/admin/commissions`, `hqOnly`) | `:2700` |
| `fe/App.jsx:2797` (`/admin/credit-rules`) | `:2805` |
| `fe/lib/api.js:2439-2443` (commission clients) | `:2444-2449` |
| `fe/lib/api.js:2467-2475` (referral admin clients) | `:2472-2481` |
| `fe/lib/api.js:3393-3394` (perk review clients) | `:3398-3399` |
| `mig/085:1674-1675` (Finder's Fee "seeded as a stub") | Lines unchanged, but **stale**: the body was filled by `mig/105` (`:225`), `mig/113:180-221` and `mig/484:211-263` |
| `refer_earn.ts:262`, `:269-276` ("stops at 200") | Unchanged. It stops at 200 only when asked; the page gets 100. |
| `network.ts:69-77`, `:99-105`, `:571`, `:583`, `:615`; `refer_earn.ts:44-46`, `:95`, `:141`, `:244-250`, `:256`, `:285`; `referralSubmissions.ts:88`, `:462`, `:619-631` (the function ends at `:632`); `perks.ts:767`, `:769`, `:783`, `:785`, `:804`, `:806`, `:830`, `:832`; `PerksPage.jsx:1494`, `:1697`, `:1740`; `admin_learning_programs.ts:84-226`; `learning_programs.ts:178`; `fe/routes/learning.jsx:42-46`; `admin_contracts.ts:309`, `:358`; `creditGrants.ts:134`; `adminStudioOverview.js:369`; `sidebarConfig.js:227`, `:228-229` | Unchanged |

---

#### Corrections

1. **Basis.** HEAD is now `fbbb4c8`, not `99466ce`. D906's review fixes landed on top of D915. `git diff --stat 99466ce HEAD` touches only cycles and narrative frontend files, two tests and `D906.md`, so no cite moved.
2. **PG7 had a store marked N that exists: partner deals.** They hold per-partner signed terms (`mig/028:55-75`; revenue-share terms at `partnerDeals.ts:118-133`), and an Admin can read them (`admin_partners.ts:293-312`). Rows changed:
   - The "own signed terms" line: W → P/W.
   - "Join: By invitation": W → W/P.
   - "With signed terms": P/W → P.
   - Terms column: N → P.
   - Code column: N → P (`PART-` codes at `:299`).
   - Intros column: N → P (`redemptions_count`, `:302`).
   - Partner name: now readable by an Admin as well (`:301`).

   OD3 now says that partner deals are the only store with per-partner terms.
3. **PG7 money had a second missed store: D713 partner settlements.** `GET /api/admin/partner-settlements` is readable by any HQ Admin, not only the Super Admin (`partner_settlements.ts:16-20`, `:37-55`). It is an issued/matched ledger of what HQ owes or is owed under each signed deal. I added it to the commission tile, the commission chart and the table's money columns.
4. **PG7 "Introductions this quarter".** I named the nearest store the section skipped: partner-code sign-ups, which an Admin reads per deal (`admin_partners.ts:240-291`).
5. **PG7 Standard rules card.** It also misses the compounding L2/L3 bonuses (`networkfx.ts:16`, `:131-147`, called at `network.ts:192-198`). The section listed only purchase commissions. I also re-ran the search for writers of the `commissions` table (three writers).
6. **PG7 segments.** I added `partner_deals.deal_type` as the only typed partner classification, and noted that it is not the canvas's segments.
7. **PG8 CONTRACT.** No flow sends either template for a partner deal: onboarding always sends `partner_services` (`partner_onboarding.ts:344`). The `partner_revshare` doc type also exists.
8. **PG9 "Join: Open; strategic by invitation" and the suggested line.** Both were wrong. Nothing ever grants strategic access: the only write is an upsert of the note. So every strategic referral is refused, and "by invitation" promises an invitation nobody can give. I also added the strategic card's foot, which the section skipped.
9. **PG9 tiles.** Overdue can be read straight from the glance's `sla` band (`branchHome.ts:360-376`). One call per status at `limit=200` gives complete counts below 200, which beats one capped call.
10. **PG9 funnel.** "No admin bulk read" was overstated: `approvalAge.ts:103-116` reads the events, but only for a branch's median decision age. Nothing gives counts per stage.
11. **PG10 Queue.** It is the **oldest** 200 (`ORDER BY created_at ASC`, `perks.ts:774`), not the newest. It also includes the 12 seeded `in_review` listings.
12. **PG10 "only date is created_at" was wrong.** `updated_at` (`mig/186:81`) and `reviewed_at` (`:78`) exist and are served (`SELECT p.*`, `perks.ts:771`). Neither marks submission for review. Fixed the tile, the Sent column and figure 14.
13. **PG10 Live rows.** N → P: the catalogue read serves live, not-ended listings with their `uid` (`perks.ts:382-386`, `:871`).
14. **PG10 additions.**
    - The "0 credits" W on the 12 seeded listings (`mig/366:15-26`; `PerksPage.jsx:97`).
    - The missing "Perk listings lane" from caption `bd:54` (none exists in `approvalSources.ts:47-49`).
    - Approve clearing `review_note` (`perks.ts:852`).
    - Partners never see `/perks` (`App.jsx:2960`).
    - Manual versus automatic credit grants on the Credits card.
15. **PG10 "Send back" precedent was inverted.** `D915.md:65` reads a stored `rejected` *as* "Sent back", because a host can resubmit a rejected event (`events.ts:489-500`). That is why it does not transfer to perks, whose reject is final.
16. **PG12 "Who: Every member" was E, and is W today.** `LEARNING_COMING_SOON = true` (`learningAccess.js:37`, `:49-52`; applied at `LearningPage.jsx:176-179`) shows every non-admin profile "Coming soon". The Worker's self-enrolment is unreachable from the UI. The same caveat now applies to "Join".
17. **PG12 learner counts.** The canvas's own arithmetic sums enrolments (126 = 30 + 40 + 26 + 30; 48 = 12 + 18 + 9 + 9). "Never the sum" silently redefined the canvas, so I made it an S1 call: relabel as enrolments, or count distinct people. I also noted that "this period" is twelve weeks in the sample.
18. **The window behind each tile is a new S1 call.** The samples tie tiles to the twelve-week charts, the quarter and the six-month chart (`dc:396-397`, `dc:416-417`, `dc:426-427`, `dc:448`). The section treated those tiles as all-time.
19. **PG12 Row ⋯ cites were in the wrong file.** `:95`, `:143`, `:158`, `:177`, `:183-185` and `:207` are in `admin_learning_programs.ts`, not `admin_learning.ts`. I added PATCH `:116`, unassign `:193` and remove `:226`. I also added a row for today's admin Learning pages (`fe/routes/learning.jsx:42-46`), and clarified the Activity tab: the Super Admin's governance feed is unfiltered (`admin_security.ts:548-554`).
20. **PG9q wiring.** Three more places name `/admin/refer-earn`: `adminPlacement.js:85`, `HeldApprovals.jsx:84` and `BranchApprovals.jsx:607`.
21. **Line numbers fixed:**
    - R2's users join is `network.ts:577` (was `:576`).
    - Referrer name is `refer_earn.ts:280-281` (was `:278-279`).
    - `category_name` is `referralSubmissions.ts:639` (was `:640`).
    - `appendEvent` is `:497-509` (was `:497-511`).
    - The `customer` block is `:82-89` (was `:79-89`).
    - "no account" is `PerksPage.jsx:1539` (was `:1538`).
    - The exploring insert is `auth.ts:391-398` (the comment is `:391`; the INSERT is `:398`).
    - `describeContents` returns at `:67-77`.
    - `currencyTotals` is `:525-546`.
    - The Referrer-role select is `:270-272`.
22. **"Could not be read" additions.**
    - The partner-deal and settlement reads.
    - The `mapError` 5xx path for perks.
    - A side finding: the Refer & Earn overview swallows a failed code read and then writes a new code (`refer_earn.ts:62-71`).

### Programs · PG13–PG20 against the code: AI-native Venture, proposals, decisions, states, phone (2026-10-24)

**This is a snapshot, not a spec.** It was read-only: nothing was edited, staged or written.

**Basis.**
- HEAD is **`d7d7040`** on `claude/spinout-lab-workspace-wuyyqd`. The task named `6205ee6`; seven commits have landed since: `6c355ff`, `24136bf`, `0b85c2b`, `0296848`, `99466ce`, `fbbb4c8`, `d7d7040`. The last two (D906) touch only `fe/pages/cycles/*`, `fe/pages/raise/narrative/*`, two tests and `D906.md`. No file this section cites.
- `git diff --stat 6205ee6 HEAD -- cloudflare-worker` is empty.
- In `frontend/src/App.jsx` the diff adds four lines (one comment, three routes) after `:2837`, D915's `/admin/events`. They are now `:2838-2841`. Lines up to `:2837` are unchanged, and later lines moved down by four. For example, `/admin/advisor-cohorts` is now `fe/App.jsx:3291` (was `:3287`) and `/referrals` is `:3497` (was `:3493`).
- `fe/pages/admin/events/eventsDeskModel.js` and D915.md have not changed since `99466ce`.
- The issue body is the saved copy. Its lines are cited as `issue:N`, numbered as `sed -n` counts them. Every code line it relies on was re-checked at HEAD.

**Prefixes.**
- `wk/` = `cloudflare-worker/src/`
- `fe/` = `frontend/src/`
- `mig/` = `cloudflare-worker/sql/migrations/`
- `base:` = `cloudflare-worker/sql/schema_baseline.sql`
- `dc:` = `design/incoming/Programs Page.dc.html`
- `boards:` = `design/incoming/Programs · Boards.dc.html`
- Tests are written out in full.

**Notation.**
- **E** = exists.
- **P** = partly exists.
- **N** = does not exist.
- **W** = would give a wrong figure or a false sentence today.
- Bracketed canvas values are samples, never data.

---

#### 0. Key

##### 0.1 Dependency and decision codes used in the "Owner/dependency" column

| Code | What it is | Source |
|---|---|---|
| **#2371-W1** | The program registry, the playbook store and the catalogue read `GET /api/admin/programs?weeks=`. Each block answers alone and reports `available:false` with a reason when it fails. | issue:473-474, :509 |
| **#2371-W2** | Proposals (create, edit draft, send, list) and the Super Admin's decision, with a required note. Audited. | issue:475, :510 |
| **#2371-W3** | With #2376: the grant-state read and the request-access write | issue:476, :511 |
| **#2371-W4** (slot 4) | Refer & Earn fixes: a route to grant or decline strategic access, a queue read, and a paged list with a total | issue:478, :512 |
| **#2371-W7** | The four mentor routes move to `requireAdmin`, plus hidden-founder counts. **It does not add `requireBranchNotSuspended`.** | issue:480, :515 |
| **#2374** | The Lab's address, its tabs as addresses, and which applications store it counts | issue:489 |
| **#2375** | The page frame, crumb and "has moved" redirects | issue:487 |
| **#2376** | The grant store, Licences › Program grants (`/admin/licences/programs`) and the "Request a program" sheet (`/admin/my-licence/programs`) | issue:106, :488 |
| **#2377** | The "Product tester" sub-account and role names | issue:490 |
| **#2390** | The Approvals lanes, including the HQ-only group for proposals | issue:496 |
| **OD-AIN** | Owner: the AI-native Venture playbook (every section, its tools, audience and join method) | issue:482 |
| **OD-PROP** (new) | Owner: who may send a proposal while no studio is deployed. Options: any HQ admin, or only a licence administrator bound by `licence_admins`. The D799 precedent refuses anyone bound to no licence with `no_licence` (`wk/routes/licence_requests.ts:42-52`). | §0.2 s8 |
| **OD-PAUSE** (new) | Owner: what "Pause program" enforces, on which join routes, and what members see | dc:498 |
| **S1-GATE** | S1: on PG19a, keep `RoleGuard`'s silent redirect (D915's choice, `documentation/architecture/decisions/D915.md:21-23`) or draw a stated boundary | — |
| **S1-NOTICE** | S1: on PG19b, an in-page notice rather than `hqOnly` | — |
| **S1-LINK** | S1: the targets of "See your programs" and "See HQ's programs" | — |
| **S1-BANDS** | S1 with #2390: "Overdue" past two days (issue:173) and the bands under 2 days, 2 to 7 days and over 7 days (issue:180; dc:337), against the code's 24 h and 72 h bands (`wk/services/slaWindow.ts:18`; `wk/services/approvalSources.ts:305`) | — |

##### 0.2 Searches that found nothing (cited in the tables as "s1" to "s12")

- **s1. No registry, playbook, proposal or grant store.**
  - `git grep -n -i -E "program_grants|programme_grants|program_proposals|programme_proposals|program_registry|programs_registry|programme_registry|licence_programs|license_programs|program_playbook|playbook_sections|program_status|programs_catalog" -- cloudflare-worker frontend/src backend scripts` finds only Learning's own `PROGRAM_STATUS` (`fe/pages/learning/programModel.js:185`), its import and its one use (`fe/pages/learning/programReads.js:36`, `:143`).
  - `git grep -n -i -E "CREATE TABLE[^(]*(program|proposal|playbook|catalog)" -- cloudflare-worker/sql cloudflare-worker/src` finds only:
    - Learning (`mig/389_learning_programs.sql:19`, `:34`, `:46`);
    - `testing_programmes` (`mig/516_product_testing.sql:18`);
    - AI-draft `*_proposals` tables (`mig/214:50`, `mig/498:15`, `mig/500:25`, `mig/502:62`, `mig/506:32`, `mig/520:47`, `mig/521:58`, `mig/522:50`), with their copies at `base:4930` and `wk/routes/decks.ts:58`.
  - The newest migration is `535_dd_advisor_subject.sql`.
- **s2. No new addresses.** `git grep -n -E "admin/programs|my-licence/programs|licences/programs" -- cloudflare-worker/src frontend/src frontend/test scripts` finds nothing.
- **s3. AI-native Venture exists only on the canvas.**
  - `git grep -n -i -E "ai.native" -- cloudflare-worker/src cloudflare-worker/sql frontend/src` finds copy strings only:
    - `wk/services/signals/seed.ts:339`;
    - `fe/App.jsx:2360`;
    - `fe/lib/spinoutInvestorContent.js:84`;
    - `fe/pages/SpinoutLabInvestorPage.jsx:12`;
    - four deck templates;
    - onboarding placeholders (`fe/pages/OnboardingInvestorPage.jsx:149`, `fe/pages/OnboardingPersonaPage.jsx:155`).
  - `grep -c -i "ai-native" design/incoming/airail-every-page-data/canvas.json` returns 0.
- **s4. No program pause.**
  - `git grep -n -i -E "program_paused|paused_by_hq|pause_program" -- cloudflare-worker/src frontend/src` finds nothing.
  - So does `git grep -n -i -E "pause[sd]?_?(the )?program|program[me]*_?pause"`.
  - So does `git grep -n -i "paused" -- cloudflare-worker/src/routes/refer_earn.ts cloudflare-worker/src/services/referralSubmissions.ts`.
- **s5. No "Request a program" sheet in the repo.**
  - `git grep -n -i -l "program grants\|Request a program" -- design` finds only this canvas, its grid and `design/incoming/Partner Invitations Page.dc.html`.
  - That third file has one eyebrow, "NEEDS HQ PROGRAM GRANTS" (`:483`).
  - #2376 is open and labelled `needs-design` (REST `gh api repos/AxalNetwork/StudioOS/issues/2376`, updated 2026-10-21T15:41Z).
- **s6. HQ does not refuse a suspended licence's administrator.**
  - `grep -n "territory_licences\|licence_admins" cloudflare-worker/src/auth.ts` finds nothing.
  - Suspension is refused only by `requireBranchNotSuspended`, which returns at once on HQ (`wk/auth.ts:752-753`).
  - `requireHqAdmin` (`wk/auth.ts:704-708`) and `requireHqAuthoring` (`:725-729`) read no licence status.
  - D799's requests are deliberately open while a licence is suspended (`wk/routes/licence_requests.ts:25-26`).
- **s7. No admin read counts sessions with a cohort mentor.**
  - `git grep -n "advisor_cohort_assignments" -- cloudflare-worker/src` finds only `wk/routes/advisors.ts`, `wk/services/advisorStoresSchema.ts` and `wk/services/cohortAdvisorAccess.ts`. None of them counts `advisor_bookings` per cohort.
  - The only aggregate booking counts are global ones in the social digests (`wk/services/telegramAggregator.ts:109`; `wk/services/xAggregator.ts:151`).
- **s8. No branch is deployed.** `ls infra/branches/` shows `README.md` and `_example.json` only. That folder is "the only place a deployment is declared" (`infra/branches/README.md:1-7`).
- **s9. No "not an admin" notice exists.** `git grep -n -i -E "for studio admins|AdminOnlyNotice|NotAnAdmin|only HQ decides" -- frontend/src` finds only `SuperAdminOnlyNotice`.
- **s10. No product-tester role.**
  - `git grep -n -E "product_tester|'tester'" -- cloudflare-worker/src` finds only `wk/services/adminInsights.ts:484` and `wk/services/insightsExport.ts:83`.
  - Both carry the Insights reason "a sub-account that #2377 and #2318 have not defined yet" (`wk/services/adminInsights.ts:58-59`).
  - Testers do exist, but only per testing programme: a programme's `eligible_roles` and its applications (`mig/516_product_testing.sql:36`, `:48`). No role marks a tester.
- **s11. (new) The approval lanes have no Perk listings or Office-hours hosts lane.** `APPROVAL_SOURCES` (`wk/services/approvalSources.ts:101-258`) has eleven keys: `lp`, `referrals`, `cohort`, `moderation`, `kyc`, `partner_profiles`, `exploring`, `jobs`, `events`, `best_fit`, `due_diligence`. The HQ glance's lanes are exactly these (`wk/services/branchHome.ts:360-361`; `wk/services/studioGlance.ts:199-210`).
- **s12. (new) No per-item age read across lanes on HQ.** `git grep -n "approvalBoard(" -- cloudflare-worker/src` finds two callers. One is `wk/routes/branch_approvals.ts:61`, behind `requireBranchTier` (`:54`), so it is branch only. The other is `wk/services/approvalAssignments.ts:198`. On HQ, an item's age comes only from each queue's own admin list.

##### 0.3 Shared chrome on these boards

| Block (dc line) | What it draws | Source today | Owner/dependency | Now / placeholder |
|---|---|---|---|---|
| Admin sidebar, group "Admin", 9 rows, Programs lit (`dc:15-23`, `:509-510`) | Studio … Licences | **E** `fe/sidebarConfig.js:218-248` (Licences is `:248`). The Programs row is `to: '/admin/held/programs'` with `match` `['/admin/spinout-lab', '/admin/advisor-cohorts', '/admin/profiling-trends']` (`:228-229`). The canvas *computes* hrefs as `/admin/<label>` (`dc:510`), so `/admin/studio` and the others are not meant literally. | #2375 | NOW, once the Programs row moves to `/admin/programs` with a `match` that covers the subtree |
| Top bar studio badge "[Studio Lisbon]" (`dc:29`, `:522`) | Studio badge | **E**, but with other words. It shows "HQ-held · axal.vc / HQ-HELD", or "{brand} · on axal.vc / BRANCH · NOT DEPLOYED" for a licence administrator (`fe/App.jsx:1306-1329`; `fe/hooks/useBranchDeployment.js:26-38`). | — | NOW with today's badge. Never the literal "[Studio Lisbon]". |
| Eadwyn spine (`dc:204-206`; note `dc:536`) | Rail docked as a spine | **E**: HeldZone's rail (`fe/pages/admin/HeldZone.jsx:47-61`, used by `fe/pages/admin/HeldPrograms.jsx:24-25`), keyed `own('/admin/held/programs', key(AD, 'Programs'))` (`fe/lib/railPages.js:280`). A new off-canvas key would have no model rows, and the rail would answer 404 `unknown_page` (`wk/routes/ai.ts:458-464`). The airail canvas has no AI-native key (s3). | — | NOW, reusing "Admin · Programs" for every `/admin/programs/*` page |
| Phone top bar: ☰, logo, bell; 44 px targets (`dc:35-41`, `:224`, `:525`) | Phone shell | **E** `PhoneHeader`, `usePhoneWidth` (`fe/ui/index.js:82-83`) | — | NOW |

---

#### 1. Gap tables

##### PG13 · AI-native Venture · proposed (`dc:455-458`, dispatched at `dc:484`; caption `boards:57`)

| Block (dc line) | What it draws | Worker source today | Owner/dependency | Now / placeholder |
|---|---|---|---|---|
| Crumb "Programs › AI-native Venture" → `/admin/programs` (`dc:471`, `:468`, `:45`) | Back link | Frontend only. **N**: no `/admin/programs` route (s2). | #2375 | NOW, in the same change that registers `/admin/programs` |
| Title "AI-native Venture" (`dc:455`; 24 px `dc:528`) | Static | — | — | NOW |
| Pill "Proposed" (`dc:455`; icon `dc:322`) | Program status | **N**: no registry (s1). The word is the owner's (issue:194). | #2371-W1 | NOW as static copy; the registry replaces it. Keep it apart from a *proposal*'s statuses ("Draft · Sent to HQ · …", `dc:325`). |
| Grant badge "Not offered yet" (`dc:455`; `dc:324`) | Grant state | **N**: no grant store (s1, s5). True by construction: nothing can offer it. On HQ-held accounts only "Granted to your studio" becomes "HQ-held" (`dc:351`), so this badge stays. | #2376 | NOW as static copy |
| Line "[A venture program where founders build…]" (`dc:455`) | Purpose | The bracket marks a sample: nobody has written the purpose (s3) | OD-AIN | **Do not draw the bracket.** Show "Not set" until the owner writes it. |
| Facts strip | None (`facts: false`, `dc:455`; `gateV` false, `dc:471`) | — | — | Nothing to draw |
| Header buttons | None for an Admin (`btns: []`, `dc:455`). The sentence is the card foot (below). | — | — | NOW |
| Seven tabs, `/admin/programs/ai-native-venture[/how-it-runs …/activity]`, with "How it runs" current (`dc:470-471`, `:484`) | Tab strip | **N** routes (s2). Literal-NavLink precedent: `fe/pages/subsidiary/LicenceFrame.jsx:75-88`; D915's `fe/pages/admin/AdminEventsPage.jsx:51-60`. | #2375 | NOW for Overview and How it runs. People, Queue, Terms, Settings and Activity have nothing to show, so they read "Not running yet". |
| Tab "Queue [0]" (`dc:471`, `q: 0` at `dc:455`) | A zero count | **W**: a zero on a program that has no queue, against the caption's "never zero" (`boards:57`) | — | **Do not draw `[0]`** |
| Tiles: Founders, Cohorts, Applications, Studios offered, each "Not running yet" in muted ink (`dc:457`) | Four tiles | No store for this program (s3). "Studios offered" would need #2376. | #2371-W1, #2376 | NOW as words, never 0. The words describe the program's status, not missing data. Note: the board draws the tiles under the "How it runs" tab (`dc:484`). S1 decides whether they belong on Overview. |
| Card "How it runs · draft" with lock "Set by HQ" (`dc:458`; lock `dc:103`) | Locked playbook card | **N**: no playbook store (s1) | #2371-W1 | NOW as a static card with the lock (issue:158) |
| Rows Thesis, Who it is for, Length, Seats per cohort, Capital terms, Contracts, each "[to be set]" plus "Not set" (`dc:458`; style `dc:456`) | Unset sections | **N** (s1). The canvas contradicts itself here: the catalogue card says "Who: Founders · Join: Not set" (`dc:342`), while this row reads "[to be set]". | OD-AIN | NOW as "Not set" alone (Not recorded: no store). Drop the bracketed "[to be set]". The catalogue card's "Who: Founders" waits for OD-AIN too. |
| Row "Tools included [Eadwyn, Spin-Out Lab modules]" (`dc:458`) | A value with no "Not set" (`v` is false because `s !== '[to be set]'`) | **W**: a sample shown as if decided. Nothing attaches a tool to a program (s1). | OD-AIN | "Not set" until the owner names the tools |
| Foot "When HQ publishes it, you can request it." (`dc:458`) | Admin sentence in place of a button (issue:108, :368) | The request path is **N**. D799's structured kinds have no program kind (`wk/services/escalationRequests.ts:32`; `wk/rpc/hqOps.ts:50-53`). | #2376, #2371-W3 | NOW as copy. It promises #2376's request, so link nothing yet. |
| Eadwyn spine (`dc:536`) | Rail | See §0.3 | — | NOW with "Admin · Programs" |

##### PG13s · Super Admin header (`dc:495`)

| Block (dc line) | What it draws | Worker source today | Owner/dependency | Now / placeholder |
|---|---|---|---|---|
| Eyebrow "PROGRAMS › AI-NATIVE VENTURE · SUPER ADMIN" (`dc:495`) | Crumb | Frontend | #2375 | NOW with the route |
| Title at 22 px; pills "Proposed" and "Not offered yet" (`dc:495`) | Header | As on PG13 | #2371-W1 | NOW as static copy |
| "Edit playbook" (`dc:495`) | Super Admin write | **N** (s1). The authoring precedent is Learning: `gate` is `requireSuperAdmin` (`wk/routes/admin_learning.ts:46-48`), and every write goes through `record`, which calls `logAdminAction` (`:50-51`). | #2371-W1, OD-AIN | Waits for W1 |
| "Publish" (`dc:495`) | Status and version change | **N**. Precedent: Learning's `status` draft, published or archived (`mig/389_learning_programs.sql:27`), set by `PATCH /programs/:uid` (`wk/routes/admin_learning_programs.ts:116`; client map `fe/pages/learning/programModel.js:185`). | #2371-W1 | Waits for W1 |
| "Offer to studios" (primary) and its foot "…turns on Can be granted … on Licences › Program grants" (`dc:495`) | Grant flag | **N**: no grant store, and no `/admin/licences/programs` (s1, s2) | #2376 | **Do not draw** the button or its foot until #2376 ships the flag |

##### PG14 · Propose a program · Admin (`dc:459-467`, `:485`; caption `boards:58`)

| Block (dc line) | What it draws | Worker source today | Owner/dependency | Now / placeholder |
|---|---|---|---|---|
| Crumb "Programs › Propose a program" → `/admin/programs`; the address is `/admin/programs/propose` (issue:119) (`dc:485`, `:468`) | Crumb | **N** route (s2) | #2375 | NOW with the routes |
| Title and line "Five steps. HQ reviews every proposal and answers under Your proposals." (`dc:485`) | Copy | True only once W2 exists | #2371-W2 | With W2 |
| "Draft saved [10:41]" (`dc:485`; mono text `dc:329`) | Autosave stamp | **N**: no proposal store (s1). Draft-store precedent: `spinout_application_drafts` (`mig/315_spinout_application_lifecycle.sql:40-45`). | #2371-W2 | **Do not draw** until W2 saves drafts. A copy held only in the browser is not "saved". |
| Step bar: Basics → How it runs → **Terms** → Tools → Review (`dc:462`, `:459`, `:271`) | Progress | Client only | — | NOW |
| Basics: NAME, ONE-LINE PURPOSE (`dc:463`) | Fields | **N** store | #2371-W2 | With W2 |
| Basics: WHO IT IS FOR chips: Founders, Investors, Advisors, Operating partners, Explorers, Product testers (`dc:463`) | Audience | Roles exist for `founder`, `investor`, `advisor` and `partner` (labelled "Operating Partner", `fe/lib/railPages.js:39`), and for `exploring` (default path `fe/App.jsx:506`). **There is no Product tester role** (s10). Testers exist only as one testing programme's picks (`mig/516:36`, `:48`). | #2377 | Five chips NOW (as declarations). "Product testers" waits for #2377. |
| Basics: GROUP chips: Ventures, Access, **Network**, Rewards, Learning, Product (`dc:463`) | Group | **W**: the catalogue's group is "Network and referrals" (`dc:358`, `:345-346`; issue:183). No registry holds groups (s1). | #2371-W1 | NOW, using the catalogue's six names |
| How it runs: JOIN METHOD (Open, By application, By invitation, Assigned by an admin) (`dc:464`) | Choice | The vocabulary matches issue:157. **N** store. | #2371-W2 | With W2 |
| How it runs: CYCLE (Rolling, or Cohorts of [12] weeks); SEATS [12]; ELIGIBILITY (`dc:464`) | Declarations | **N** store. The only cohort engine is the Lab's fixed four weeks a month (`wk/services/cohortTiming.ts:1-7`), so a 12-week cycle is a statement, not a calendar. | #2371-W2 | With W2. Saved as text, with no calendar promised. |
| Terms (current): REWARDS (None, Credits, Cash, Equity) (`dc:465`) | Declaration | "Credits" would need a new `credit_reward_rules` key seeded by migration, because PUT refuses unknown keys with 404 `rule_unknown` (`wk/routes/admin_credit_rules.ts:159-162`; `mig/381_credit_reward_rules.sql:30-37`). "Cash": commission rules are global (`wk/routes/network.ts:69-77`). "Equity": no store. | #2371-W2 | With W2, stored as a declaration. HQ creates any rule later. |
| Terms: CONTRACT TEMPLATES "[Operator agreement] ×" and "Choose from Contracts" (`dc:465`) | Template picker | Picker data **E**: `contractsApi.templates` (`fe/lib/api/contracts.js:43`) reads `GET /api/admin/contracts/templates/store` (`wk/routes/admin_contracts.ts:1773-1774`, `requireAdmin`). A failed usage read answers 503 `templates_unreadable` (`:1797-1798`). During a recovery cool-off, every method under that prefix is refused, GET included (`wk/index.ts:655`, `:685-691`). **Nothing links a template to a program.** An envelope's only link is `deal_id`, to `deals` (`wk/services/contractPublication.ts:30-34`). | #2371-W2 | The picker read is NOW; saving the template slug on the proposal comes with W2 |
| Terms: WHAT HQ RECEIVES (`dc:465`) | Free text | **N** | #2371-W2 | With W2 |
| Terms foot "These are the participant terms. HQ sets your studio's grant terms … on Licences." (`dc:465`) | Copy | Licences has no Programs tab: its tabs are Summary to History (`fe/pages/subsidiary/LicenceFrame.jsx:79-84`) | #2376 | NOW as copy, with no link |
| Tools: seven switches (Application queue, Cohort calendar, Assignments, Referral codes, Credits and perks, Learning content, Events) (`dc:466`; switch `dc:268`) | Declarations | Each console exists on its own, but nothing attaches a tool to a program (s1). A switch that seems to turn a tool on would be **W**. | #2371-W2 | With W2. Label it "Tools it needs". |
| Review: "The playbook as HQ will read it." with five rows (`dc:467`) | Client render | Client only. The playbook has eleven sections (`dc:377-378`); a proposal fills five. | — | NOW, from the form |
| "Send to HQ" (`dc:467`) | Write | **N**. Precedents:<br>• `testing_programmes` moves from draft to submitted (`mig/516:38-39`), and `submitProgramme` refuses anything but a draft (`wk/services/testing.ts:476-483`).<br>• D799 requests are written on HQ under `branch_code='hq'` with the licence's uid, and on a branch through the branch lane (`wk/routes/licence_requests.ts:10-22`, `:92-93`).<br>Who may send it is the open question below. | #2371-W2, OD-PROP | Waits for W2. A confirmation dialog follows the rule "every change opens a dialog" (issue:421). |
| Foot "HQ reviews every proposal. You will see HQ's answer under Your proposals." (`dc:467`) | Copy | True once W2 and the "Your proposals" table (`dc:359-364`) exist. HQ's queue is #2390's HQ-only group (issue:496). | #2371-W2, #2390 | With W2 |

##### PG15 · Decisions (caption `boards:59`)

**PG15a · Decide (`dc:496`)**

| Block (dc line) | What it draws | Worker source today | Owner/dependency | Now / placeholder |
|---|---|---|---|---|
| Dialog "Decide on [Founder Fitness Sprint]" with "Esc to close" (`dc:496`, `:265`) | Dialog shell | **E** `Lightbox`: `role="dialog"`, focus trap, Esc, and a full-screen sheet on a phone (`fe/ui/Lightbox.jsx:5-17`, `:156-165`; exported `fe/ui/index.js:35`) | — | The shell is NOW; content waits for W2 |
| "From [Studio Nairobi] · sent [16 Oct]." (`dc:496`) | Studio and date | **N** proposal store. A branch's own rows carry the raiser's name in the branch's user space, never joined to HQ users (`mig/259_hq_escalations.sql:45-50`). On HQ the studio is the licence bound by `licence_admins` (`wk/routes/licence_requests.ts:42-50`). | #2371-W2 | With W2 |
| Four radios: Approve for this studio only; Approve for the catalogue; Send back; Decline (`dc:496`; radio `dc:269`) | Decision | **N**. Gate: `requireSuperAdmin` (`wk/auth.ts:692-697`). Precedent for refusing a decision unless it is waiting, requiring a note and telling the owner: `reviewProgramme` (`wk/services/testing.ts:486-503`). Both Approve options also need #2376's draft grant and catalogue listing. | #2371-W2, #2376 | Waits for W2 (Send back and Decline) and #2376 (both Approvals) |
| Foot "Approve for this studio only opens a draft grant … Approve for the catalogue lists it for every studio as Not granted." (`dc:496`) | Copy | No grant states exist (s1) | #2376 | Waits for #2376 |
| NOTE TO THE STUDIO, required for Send back and Decline (`dc:496`) | Field | **N**. Precedent: a 400 when sending back without a note, with the note capped at 2,000 characters (`wk/services/testing.ts:488-489`). | #2371-W2 | With W2. Enforce in the client too. |
| Back / Confirm (`dc:496`) | Footer | `Lightbox` `footer` prop (`fe/ui/Lightbox.jsx:70`), drawn at `:179` in a dialog and at `:144` as a page. A refusal sits under the buttons and the dialog stays open (`documentation/architecture/decisions/D915.md:123`). | — | With W2 |

**PG15b · Request access (`dc:497`)**

| Block (dc line) | What it draws | Worker source today | Owner/dependency | Now / placeholder |
|---|---|---|---|---|
| Labels "Before" and "After sending the request" (`dc:497`) | Board annotations | — | — | Not product copy |
| Learning card, muted: eyebrow, title, purpose, pill "Live", badge "Not granted" (`dc:348`, `:350-354`) | Card before the request | **N**: no grant store (s1). On HQ-held accounts no card can read "Not granted"; a granted card shows "HQ-held" (`dc:351`, `:491`). | #2376, #2371-W1 | **Do not draw** until #2376 |
| "Who: Every member · Join: By invitation" (`dc:348`, `:355`) | Facts | **W** as fixed text: Learning's join method is set per program, invite or open (`mig/389_learning_programs.sql:26`). **A plain Admin cannot derive it across programs.** The full list is Super Admin only (`wk/routes/admin_learning_programs.ts:84-85` through `gate`, `wk/routes/admin_learning.ts:46-48`). An Admin reads only the programs assigned to them (`wk/routes/learning_programs.ts:104-121`) or the published open ones (`:45-54`). "Every member" holds: `/learning` admits Explorers (`fe/routes/learning.jsx:33`). | — | Static "Open or by invitation", as PG12 does (`dc:445`) |
| "Request access" (`dc:356`) | Opens #2376's sheet | **N**: the sheet is not in the repo (s5). Carrier precedent: D799's `POST /api/licence/mine/requests` (`wk/routes/licence_requests.ts:92-93`). Its structured kinds have no program kind (`wk/services/escalationRequests.ts:32`, `:52`). Only the untyped `other` kind (`wk/rpc/hqOps.ts:50-53`), open to every licence kind (`:102-116`), could carry it as free text. | #2376, #2371-W3 | Waits for #2376 |
| After: badge "Requested" (amber) (`dc:324`, `:351`) | Grant state | **N** | #2376 | Waits for #2376 |
| "Waiting for HQ since [12 Oct]" (`dc:355`) | Date | Would come from `hq_escalations.created_at` (`mig/259_hq_escalations.sql:53`) if the request rides D799 | #2371-W3 | Waits for W3 |
| "View request" (`dc:356`) | Link | Today's Requests tab `/admin/my-licence/requests` (`fe/App.jsx:2718`; `fe/pages/subsidiary/LicenceFrame.jsx:83`) lists licence requests only (`wk/routes/licence_requests.ts:63-90`) | #2376 | Waits for #2376 |

**PG15c · Pause (`dc:498`)**

| Block (dc line) | What it draws | Worker source today | Owner/dependency | Now / placeholder |
|---|---|---|---|---|
| "Pause [Refer & Earn]?" with "Esc to close" (`dc:498`). It is Super Admin only, per the ⋯ menu "Pause program (Super Admin)" on Refer & Earn (`dc:413`), and also on Mentor, Referral partners and Perks (`dc:371`, `:393`, `:423`). | Dialog | `Lightbox` **E** | — | The shell is NOW |
| "New sign-ups stop. People already in keep their access. Members see 'Paused'." (`dc:498`) | Effect | **N**. There is no program status anywhere (s4).<br>• Refer & Earn's create route is `requireAuth` only and reads no status (`wk/routes/refer_earn.ts:140-142`).<br>• The member overview has no paused state (`:94-127`).<br>• Only per-object pauses exist: a perk listing (`wk/routes/perks.ts:844`), a testing programme's close (`wk/routes/testing.ts:188`), and a Learning program's `archived` (`mig/389:27`).<br>"Paused" (program) also differs from "Paused by HQ" (a grant, `dc:324`). | OD-PAUSE, #2371-W1 | **Do not draw** until W1 stores status *and* each program's join route refuses while paused |
| Back / Pause (destructive) (`dc:498`; `dc:228`) | Write | **N** | #2371-W1 | As above |

##### PG16 · Empty (caption `boards:60`)

**PG16a · Nothing granted (`dc:486`)**

| Block (dc line) | What it draws | Worker source today | Owner/dependency | Now / placeholder |
|---|---|---|---|---|
| Title "Programs" and line "Every program your studio runs, what it needs from you now, and what HQ offers." (`dc:469`) | Copy | **P**. On HQ-held accounts there is no "your studio". The canvas's own HQ-held wording is PG1h's note: "No subsidiary is deployed yet, so every admin works on accounts HQ holds…" (`dc:491`). "What HQ offers" needs #2376's catalogue. | #2376 | NOW, with HQ-held wording |
| Scope chip "[Studio Lisbon]", tooltip "Your studio. Every figure on this page is this licence's." (`dc:469`, `:59`) | Scope | Today it reads `SCOPE_LABEL` / `HELD_SCOPE` "HQ-held accounts · axal.vc" (`fe/pages/admin/insights/insightsModel.js:26-27`; `fe/pages/admin/HeldZone.jsx:30`). The tooltip is **W** on HQ: an admin is unscoped (`wk/services/tenancyScope.ts:64`), and the glance carries HQ's own figures (`wk/routes/admin_studio_glance.ts:10-12`). | — | NOW with the HQ-held chip and `SCOPE_TITLE`. A licence administrator's brand already shows in the badge (`fe/App.jsx:1306-1319`), but the figures are still HQ's, so the chip stays HQ-held until a branch is deployed (s8). |
| "Propose a program" (header) (`dc:486`) | Button | Route **N** | #2371-W2 | With W2 |
| Centre card "HQ has not granted any programs to [Studio Lisbon] yet." / "See what HQ offers, or propose one." (`dc:486`; `dc:276`) | Empty claim | **N** grant store (s1). It can never be true on HQ-held accounts (`dc:491`). | #2376 | **Do not draw** until #2376. A failed grant read is "Could not be read", never this. |
| Buttons "See HQ's programs" / "Propose a program" (`dc:486`) | Links | Neither target exists (s2) | S1-LINK, #2371-W2 | With the routes |
| Three "Not granted" cards: Spin-Out Lab, Mentor cohort access, Learning, each with "Live", "Not granted", Who/Join and "Request access" (`dc:486`, `:341`, `:343`, `:348`) | Cards | **N** grant (s1).<br>• The Lab's "Who: Founders · Join: By application" is true (`wk/routes/admin.ts:1183-1190`; `mig/157_cohort_applications.sql:19-24`).<br>• So is Mentor's "Who: Advisors · Join: Assigned by an admin" (`wk/routes/advisors.ts:2297-2299`, `:2998-3030`).<br>• Learning's "By invitation" is **W** (see PG15b). | #2376 | **Do not draw** until #2376 |

**PG16b · No mentors (`dc:499`)**

| Block (dc line) | What it draws | Worker source today | Owner/dependency | Now / placeholder |
|---|---|---|---|---|
| "+" and "No mentors yet." (`dc:499`) | Empty state | **E** `GET /api/advisors/admin/cohort-assignments`: no active row means empty (`wk/routes/advisors.ts:2964-2996`; mount `wk/index.ts:1330`). Caveat: it returns the newest 500 by `assigned_at` with no total (`:2982-2983`), so "none active" is exact under 500 rows. A failure answers through `mapError` (`:2995`), and today's page already keeps it apart from an empty list (`fe/pages/admin/AdvisorCohortAssignments.jsx:183-197`). The gate is role only (`:2966-2967`). | #2371-W7 (gate) | NOW, with the failure drawn as "Could not be read" |
| "Assign one before [Dec 2026] starts." (`dc:499`) | Next cycle | **E** `GET /api/admin/cohort/timeline`: the 12 newest cycles with `start_at` (`wk/routes/admin_cohort.ts:49-76`). Cycles exist for this month and the next two (`wk/services/cohortTiming.ts:220-226`; `wk/services/cohortApplications.ts:310-317`). Skip `app_status='postponed'` (`mig/157_cohort_applications.sql:11-16`). | — | NOW (derived) |
| "Assign a mentor" (`dc:499`) | Opens PG6d / PG20d | **E** POST (`wk/routes/advisors.ts:2998-3056`). It skips the freeze and the suspension gate (`:3000-3001`). | #2371-W7 | NOW |

**PG16c · Queue empty (`dc:500`)**

| Block (dc line) | What it draws | Worker source today | Owner/dependency | Now / placeholder |
|---|---|---|---|---|
| "✓" "Nothing is waiting." (`dc:500`) | Empty queue | Per queue:<br>• Refer & Earn reviews **E**: zero rows is a true zero (`wk/routes/refer_earn.ts:256-283`). The list takes one status per call (`:266`), so "waiting on an admin" is two calls, `submitted` and `under_review`. Today's Referral review draws "Nothing in this queue." under its own error (`fe/pages/admin/ReferralReview.jsx:111-125`); do not copy that.<br>• Perk listings **E**: zero is true, though a non-zero count includes drafts (`wk/routes/perks.ts:767-778`).<br>• Office-hours hosts **E** (`wk/routes/lab_hosts.ts:198-222`; mount `wk/index.ts:1327`).<br>• **Lab applications W** from `GET /api/admin/spinout-applications`, which answers 200 `{applications: []}` on any failure (`wk/routes/admin.ts:1190-1206`). Use the glance lane, which counts `cohort_applicants` pending and reports `count: null` on failure (`wk/services/approvalSources.ts:132-142`, `:453-469`), or `/api/admin/cohort/applications` (`wk/routes/admin_cohort.ts:238-265`). Which store is "the Lab's applications" is #2374's choice.<br>• Strategic access **N** read; the store exists (`mig/175_referral_submissions.sql:86`), but `wk/services/referralSubmissions.ts:409`, `:419`, `:627` are its only uses.<br>• Mentor cohort access has **no queue** (`wk/services/approvalSources.ts:273`). | #2374 (Lab store), #2371-W4 (strategic) | NOW per queue as listed. Mentor reads "No queue". Lab only through a read that fails loudly. Strategic is not drawn. |
| "New items land here when members submit them." (`dc:500`) | Copy | **W** for Perks: partners submit (`wk/routes/perks.ts:536-560`). **W** for hosts: people with a partner or advisor profile apply as an Investor, Advisor or Partner (`wk/routes/lab_hosts.ts:4-6`, `:95-117`). | — | One sentence per queue |

##### PG17 · Loading (`dc:487`; caption `boards:61`)

| Block (dc line) | What it draws | Worker source today | Owner/dependency | Now / placeholder |
|---|---|---|---|---|
| Live header: title, line, scope chip, "Propose a program", "Updated [10:42]", refresh (`dc:469`) | Header | "Updated" with a time before the first read lands is **W**. Insights shows "Reading…" until a read lands (`fe/pages/admin/insights/AdminInsights.jsx:299`). | #2371-W2 (Propose) | NOW, showing "Reading…" in place of the stamp on a first load |
| Period 4 / 12 / 52 weeks, live (`dc:469`, `:533`) | Radio group | It drives nothing until a catalogue read takes `weeks=` (issue:474). D915 left its period out for the same reason (`documentation/architecture/decisions/D915.md:131-132`). | #2371-W1 | Omit until W1 |
| Four tiles: labels live, values skeleton, "Reading…" (`dc:487`, `:333`, `:238`) | Skeleton tiles | Client only. Precedent: `fe/pages/admin/insights/AdminInsights.jsx:99`. | — | NOW |
| Skeleton cards: Joins (5 rows), Waiting (4), Credits (4), three catalogue cards (3 each) (`dc:487`, `:274-275`) | Skeletons | `Skeleton` (`fe/ui/index.js:98`). Each block settles alone (precedent `AdminInsights.jsx:135`). | — | NOW. The build draws one skeleton per block it renders; the canvas shows three cards of nine. |

##### PG18 · Error and refused (caption `boards:62`)

**PG18a · One block failed (`dc:501`)**

| Block (dc line) | What it draws | Worker source today | Owner/dependency | Now / placeholder |
|---|---|---|---|---|
| "Credits in and out by month" with amber "Credits could not be read. That is not the same as none." and "Try again" (`dc:501`) | Failed block | **For a plain Admin there is no credits read at all.**<br>• `GET /api/admin/credit-rules/grants` is `requireSuperAdmin` (`wk/routes/admin_credit_rules.ts:74-76`), and so is the per-member ledger (`wk/routes/perks.ts:804-806`).<br>• For a Super Admin, `/grants` returns only grants and manual lines, newest 200, with spends excluded (`wk/routes/admin_credit_rules.ts:79-100`).<br>• `git grep -n -i "credit"` over the glance and Insights services finds nothing.<br>So "could not be read" is **W** for an Admin (nothing was read), and the chart is not drawable from `/grants`. Component: `Unreadable({what, claim, onRetry})` renders "{what} could not be read. {claim}" plus "Retry", in red with `role="alert"` (`fe/ui/Honesty.jsx:62-73`), not the canvas's amber "Try again". | #2371-W1 (`credits_monthly`, `available:false`) | The error pattern is NOW for any existing read. This block waits for W1. Until then an Admin sees "Not read here yet". S1 picks the tone and label. |
| "Waiting by program" drawn beside it (`dc:501`; `waitK` `dc:337-338`) | Five rows with age bands | Row by row:<br>• **Lab applications: E** for count and oldest, from the glance `cohort` lane (`wk/services/approvalSources.ts:132-142`; route `wk/routes/admin_studio_glance.ts:30-37`). Bands need per-item ages, which are **P**: at most 200 items per cycle, 12 cycles (`wk/routes/admin_cohort.ts:245-265`). A rolled-forward applicant gets a new row on the next cycle, so its age restarts (`mig/157:19-23`).<br>• **Refer & Earn reviews: P.** The lane counts `more_info_needed`, which waits on the referrer (`approvalSources.ts:122-124`; `referralSubmissions.ts:51-59`). The admin list is newest first, 100 by default and 200 at most (`refer_earn.ts:262`, `:274`), so the oldest items drop out first.<br>• **Strategic access: N** read.<br>• **Perk listings: P.** No glance lane (s11). The queue includes drafts (`perks.ts:773`). `created_at` is the submission time for a new listing (`perks.ts:555-560`), but an edited live listing goes back to `in_review` with no stamp (`perks.ts:629`, `:633`).<br>• **Office-hours hosts: E**, with no glance lane (s11). Pending is newest first, at most 500, and counts by status are exact (`lab_hosts.ts:198-222`).<br>• On HQ no read gives per-item ages across lanes (s12).<br>• Bands are under 2, 2 to 7 and over 7 days, against 24 h and 72 h in code (S1-BANDS).<br>• Foot: "the two Lab rows open Spin-Out Lab › Applications and › Hosts", but the Lab's tabs are local state (`fe/pages/admin/AdminSpinoutLab.jsx:630`). | #2374, #2390, S1-BANDS | Draw only the rows marked E or P, with their caveats. Strategic access reads "Not read here yet". Lab deep links wait for #2374. |
| Chart / Table toggle on both blocks (`dc:338-339`, `TOG` `dc:234`) | View switch | Client only | — | NOW for any block drawn |

**PG18b · Not recorded (`dc:502`)**

| Block (dc line) | What it draws | Worker source today | Owner/dependency | Now / placeholder |
|---|---|---|---|---|
| "Sessions with a mentor", meta "Not recorded", line "Sessions with a mentor are not counted yet." (`dc:502`) | A figure with no value | **W label.** Bookings *are* stored: `advisor_bookings` has `advisor_id`, `founder_user_id`, `status` and `created_at` (`base:108`; columns in `cloudflare-worker/sql/historical/t13_t14_t15.sql:52-65`). No admin read counts them per cohort mentor (s7). A count is a join, not a column:<br>• `advisor_id` is the advisor *profile* (`advisors.id`, as `wk/routes/research.ts:2929-2939` reads it), while assignments key on `users.id` (`wk/routes/advisors.ts:3037-3040`). So a mentor with "No advisor profile yet" has no bookings at all.<br>• A booking names no cohort, only a founder.<br>The advisor's own calendar reads bookings (`wk/routes/advisors.ts:2769`). `Unrecorded` means "the store was read and holds no value" (`fe/ui/Honesty.jsx:12-13`), and its reason shows only on hover (`:37-50`). | — | NOW as **"Not read here yet"**, with the line visible (not in `title=`) |

**PG18c · Refused (`dc:503`)**

| Block (dc line) | What it draws | Worker source today | Owner/dependency | Now / placeholder |
|---|---|---|---|---|
| Card "Assign a mentor" with Back / Assign, and in red: "This studio's licence is suspended, so program changes are paused until HQ lifts it." (`dc:503`) | One sentence under the action | **W today, on three counts:**<br>1. The Assign POST calls neither `requireAdmin` nor `requireBranchNotSuspended` (`wk/routes/advisors.ts:3000-3001`), so it is never refused for suspension or freeze. The same holds for End access (`:3065-3066`).<br>2. The suspension refusal is a 423 with `code:'branch_suspended'` (`wk/index.ts:1477`; `wk/util/authErrors.ts:55`, `:178-189`; sentence `wk/util/branch.ts:67`). Only a branch raises it (`wk/auth.ts:752-753`), and none is deployed (s8). HQ does not refuse a suspended licence's administrator at all (s6).<br>3. On HQ, the refusal that *can* happen once `requireAdmin` is used is 423 `admin_frozen`, with other words. It fires on writes only (`wk/auth.ts:523-528`, `:568-590`; `wk/index.ts:1473`; `wk/util/authErrors.ts:146-155`).<br>**W7 as written moves the routes to `requireAdmin` only (issue:480).** That adds `admin_frozen`, but not `branch_suspended`, which also needs `requireBranchNotSuspended`.<br>Precedent: D915's code-keyed `refusalText`, whose SUSPENDED sentence names "approving and featuring" (`fe/pages/admin/events/eventsDeskModel.js:818-829`; `documentation/architecture/decisions/D915.md:127-130`). | #2371-W7 (+ a suspension gate W7 does not list) | The refusal mapping is NOW in client code, keyed on `code`, with both sentences. `admin_frozen` can fire on Assign and End access once W7 lands. `branch_suspended` needs W7 plus `requireBranchNotSuspended` plus a deployed branch. Do not claim program changes pause under suspension. |

##### PG19 · No permission (caption `boards:63`)

**PG19a · Not an admin (`dc:488`)**

| Block (dc line) | What it draws | Worker source today | Owner/dependency | Now / placeholder |
|---|---|---|---|---|
| Member shell: sidebar Studio, Spin-Out Lab, Validate, Build, Raise, Grow, Network, Research; badge "[Northwind Labs]"; no spine (`dc:488`, `:509-510`, `:522`, `:536`) | Their own shell | **E**: the app picks one sidebar per shell (`fe/App.jsx:690-692`). The canvas's computed `/spin-out-lab` is not a route; the Lab is `/spinout-lab` (`fe/App.jsx:2378`). | — | Drawn by the app as it is |
| ⊘ "This page is for studio admins." / "Your own programs are on your home." (`dc:488`) | Stated boundary | **Not what happens.** `guard(['admin'])` (`fe/App.jsx:2219-2225`) goes through `RoleGuard`, which `<Navigate>`s silently to the role's default path (`:1819-1831`, defaults `:490-507`). No such notice exists (s9). The data is safe either way: `requireAdmin` (`wk/auth.ts:523-528`). | S1-GATE | **Do not draw** unless S1 overrides D915's precedent (EV16 not drawn, `documentation/architecture/decisions/D915.md:21-23`) |
| "See your programs" / "Go to your home" (`dc:488`) | Links | "Home" is `ROLE_DEFAULT_PATH`: `/studio`, or `/exploring` for an Explorer (`fe/App.jsx:490-506`). "Your programs" has no single page. Learning's "My programs" is a section of `/learning` (`fe/pages/learning/LearningHome.jsx:457`; route `fe/routes/learning.jsx:33`); the Lab is `/spinout-lab`. | S1-LINK | Only if S1-GATE draws the panel |

**PG19b · Admin opens proposals (`dc:489`)**

| Block (dc line) | What it draws | Worker source today | Owner/dependency | Now / placeholder |
|---|---|---|---|---|
| ⊘ "Only HQ decides on proposals." / "Your own proposals are under Programs." (`dc:489`) | Stated boundary on `/admin/programs/proposals` (issue:119, :405) | Route **N** (s2). `hqOnly` would draw `SuperAdminOnlyNotice`, with other words and an "Admin Console →" link (`fe/App.jsx:2304-2306`; `fe/pages/hq/SuperAdminOnlyNotice.jsx:27-50`). Its shape is pinned (`frontend/test/super_admin_shell.test.mjs:142`). In-page precedents: `fe/pages/admin/consoles/ProductTestingConsole.jsx:37-40`; `fe/pages/admin/AdminCommissions.jsx:623-635`. The Worker refuses decisions with `requireSuperAdmin` (`wk/auth.ts:692-697`). | S1-NOTICE, #2371-W2 | NOW as an in-page notice (it needs no read) under `guard(['admin'])` without `hqOnly`. The second line is true only once W2 ships "Your proposals". |
| "Back to Programs" → `/admin/programs` (`dc:489`) | Link | Route **N** | #2375 | NOW with the route |

##### PG20 · Phone · 390 wide (caption `boards:64`)

**PG20a · Catalogue (`dc:505`)**

| Block (dc line) | What it draws | Worker source today | Owner/dependency | Now / placeholder |
|---|---|---|---|---|
| Title, line, scope chip, period. No header buttons on a phone (`hbtns = phone ? []`, `dc:469`). | Header | As on PG16a and PG17, including the line's HQ-held wording. On a phone there is no way to propose (S1). | #2371-W1 (period) | NOW without the period |
| Tile "Programs running [6] of [9]", sub "[2] not granted · [1] proposed" (`dc:333`) | Count | **N**: no registry (s1) | #2371-W1 | Not recorded |
| Tile "People taking part [312]", "+[8]%" (`dc:333`) | Distinct people | **N** read. Only parts exist, and summing them counts one person twice. | #2371-W1 | Not read here yet |
| Tile "Waiting for you [21]", "oldest [4 days]", "Overdue" (`dc:333`) | Sum of five queues | **W**: one term (strategic access) has no read. `approvalBoard`'s own comment says a sum missing a term is "a smaller number presented as the total" (`wk/services/approvalSources.ts:350-351`), and the glance nulls `pending_total` when a lane fails (`wk/services/studioGlance.ts:206`). That `pending_total` sums all eleven Approvals lanes and has no Perks or hosts lane (s11), so it is not this figure. "Overdue" past two days (issue:173) does not match 72 h in code (`approvalSources.ts:305`). | #2371-W4, S1-BANDS | Do not draw the sum until strategic access has a read |
| Tile "Credits paid out [4,200]", sub "[2,600] spent on perks" (`dc:333`) | Ledger sum | **N** for an Admin (`wk/routes/admin_credit_rules.ts:74-76`) | #2371-W1 | Not read here yet |
| "Joins per week", four series, foot "Referrals rose [18]% on the period before." (`dc:336`) | Weekly lines | • Lab **P** (`wk/routes/admin_cohort.ts:238-265`, 12 cycles, at most 200 per cycle).<br>• Referrals **P** (newest 100 by default, at most 200, `wk/routes/refer_earn.ts:262`).<br>• Learning **P**: only programs assigned to the admin (`wk/routes/learning_programs.ts:104-121`), then each one's *active* learners with `enrolled_at` (`:178-188`; `wk/services/learningPrograms.ts:101-109`). Removed learners drop out, and `enrolled_at` resets on re-enrolment (`wk/routes/admin_learning_programs.ts:216-219`).<br>• Perk claims **N** for a series. Claims are stored with `created_at`, but the only member-visible figure is an all-time `claim_count` per live listing (`wk/routes/perks.ts:408-412`). | #2371-W1 | Waits for W1 `joins_weekly` |
| Card pills "Live", "Granted to your studio" and the "Open" button on each card (`dc:350-356`, `:505`) | Status, grant, link | The status pill is **N** registry. The grant pill is **N** and reads "HQ-held" on HQ-held accounts (`dc:351`, `:491`). "Open" targets are **N** routes (s2). | #2371-W1, #2376, #2375 | Static "Live"; "HQ-held"; Open with the routes |
| Card Spin-Out Lab: "[7] applications waiting · [24] in the [Nov 2026] cohort", "Needs you [9]" (`dc:341`) | Card | • Waiting **E** from the glance lane (`cohort_applicants` pending). #2374 picks the store.<br>• "In the cohort" is **W** as read today. Participants answer `[]` on failure (`wk/routes/admin.ts:1427-1430`, `LIMIT 400` at `:1424`). The timeline counts only `spinout_lab_active=1` founders (`wk/routes/admin_cohort.ts:60-63`), and incorporation sets that flag to 0 (`wk/routes/spinout_lab.ts:239`, `:250`).<br>• "Needs you" is 7 plus 2 pending hosts, **E** (`wk/routes/lab_hosts.ts:216-221`). | #2374 | Waiting and hosts NOW. "In the cohort" waits for #2374's definition. |
| Card Mentor cohort access: "[6] mentors · [3] of [4] cohorts covered", "Needs you [2]" (`dc:343`) | Card | **E**, derived from the assignment list (`wk/routes/advisors.ts:2964-2996`) and the timeline (`wk/routes/admin_cohort.ts:49-76`). "Needs you" is the two PG20b rows: a cycle with no mentor, and a role changed (`dc:374`). | — | NOW, with the denominator stated |
| Card Refer & Earn: "[48] referrals · [9] converted", "Needs you [9]" (`dc:346`) | Card | • Counts **P**, from the newest 100 to 200 (`wk/routes/refer_earn.ts:262`).<br>• "Needs you" is 7 reviews plus 2 strategic, so **W** (strategic has no read).<br>• "Who: Every member" is **W**: `/referrals` excludes Explorers (`fe/App.jsx:3497`), though the API is `requireAuth` only (`wk/routes/refer_earn.ts:140-141`). | #2371-W4 | Reviews only. Say "newest 200" when the cap is hit. |

**PG20b · Program, Mentor cohort access (`dc:506`)**

| Block (dc line) | What it draws | Worker source today | Owner/dependency | Now / placeholder |
|---|---|---|---|---|
| "‹ Programs" → `/admin/programs` (`dc:471`) | Back link | Route **N** | #2375 | NOW with the route |
| Title; pills "Live" and "Granted to your studio"; line; facts (`dc:371`) | Header | Facts **E** (`wk/routes/advisors.ts:2297-2299`, `:2998`; `wk/services/cohortTiming.ts:1-7`). Pills **N**; on HQ the grant pill reads "HQ-held" (`dc:351`). | #2371-W1, #2376 | NOW with "HQ-held" |
| Tabs that scroll sideways, including "Queue [0]" (`dc:471`, `:532`) | Tab strip | Scroll precedent: `fe/pages/subsidiary/LicenceFrame.jsx:77`; `fe/pages/admin/AdminEventsPage.jsx:51`. "Queue [0]" is **W**: Mentor access is not laned (`wk/services/approvalSources.ts:273`). | — | NOW. The Queue tab reads "No queue", with no `[0]`. |
| No "Assign a mentor" header button on a phone (`dc:471`) | — | — | — | Reached through Needs you and People |
| Tiles: Active mentors, Cohorts covered, Founders hidden from a mentor, Ended this period (`dc:372`) | Four tiles | • Active mentors **E**. Count active rows whose current role is `advisor`, since a role-changed row reads nothing (`wk/routes/advisors.ts:2979`, `:2421-2423`).<br>• Cohorts covered **P** (needs a denominator).<br>• Founders hidden: the opt-outs are stored (`mig/367_cohort_advisor_founder_notice.sql:42-49`). They are read for the advisor's own lists, the founder's own list and the notice sweep (`wk/services/cohortAdvisorAccess.ts:47-52`, `:185`, `:89-91`), never counted for an admin.<br>• Ended this period **P**, twice over. Re-assigning overwrites `unassigned_at` (`wk/routes/advisors.ts:3041-3043`). And a program page has no period control: `prog()` sets none (`dc:471`), and only `catHead` turns one on (`dc:469`). | #2371-W7 | Active mentors NOW. "Founders hidden": Not read here yet. Ended: labelled "ended in the last [n] days (latest per pair)", with the window stated. |
| Needs you: "[Dec 2026] starts in [5 days] with no mentor" / "[Name] is no longer an Advisor, but their access is still on." (`dc:374`) | Rows with actions | **E**, derived (current `advisor_role` at `wk/routes/advisors.ts:2979`). The second line is **W**: reads are already refused (`:2421-2423`); only the row is open, and founders are not told it ended (`wk/services/cohortAdvisorAccess.ts:30-34`). "End access" calls DELETE (`wk/routes/advisors.ts:3063-3082`), which reports `founders_notified: 0` when its sweep fails (`:3076-3080`). | — | NOW, reworded to "their row is still open", with End access behind a dialog. Do not print `founders_notified`. |

**PG20c · People (`dc:507`)**

| Block (dc line) | What it draws | Worker source today | Owner/dependency | Now / placeholder |
|---|---|---|---|---|
| Search and "Filters · [0]" (`dc:507`) | Toolbar | **P**: client-side over at most 500 rows (`wk/routes/advisors.ts:2982-2983`) | — | NOW |
| Five cards: name, "[cohort] · week 2 · [12] of [14] visible", "Active" or "Not an Advisor now", 44 px "⋯" (`dc:507`; rows `dc:389`) | Card rows | • Name, role and state **E**.<br>• Cohort label **P**: only the 12 newest cycles, otherwise "Cycle #id" (`wk/routes/admin_cohort.ts:53`; `fe/pages/admin/AdvisorCohortAssignments.jsx:218`). "· week 2" is derivable from the cycle's week windows (`wk/routes/admin_cohort.ts:57-59`).<br>• "Visible" is **N** read. Its stores are the founders in `company_week_status` less the opt-outs. `PhoneRows` (`fe/ui/index.js:78`). | #2371-W7 | NOW without "visible", which reads Not read here yet |
| No count or pages on the phone list (`dc:507`) | — | The rule is "Every list has … a count" (issue:420) | — | Add the count line |

**PG20d · Assign sheet (`dc:508`; fields `dc:391`)**

| Block (dc line) | What it draws | Worker source today | Owner/dependency | Now / placeholder |
|---|---|---|---|---|
| "‹ People" → `/admin/programs/mentor-cohorts/people`; title "Assign a mentor" (`dc:508`) | Page header | Route **N**. Precedent: Lightbox page mode below 1024 px (`fe/ui/Lightbox.jsx:28-29`, `:79-80`; `PHONE_QUERY` `fe/workspaces/lens.jsx:30`). | #2375 | NOW with the route |
| MENTOR · ADVISORS ONLY: search, the selected row, a "No advisor profile yet" pill (`dc:391`) | Picker | **E** `GET …/assignable`: role advisor, `has_advisor_profile`, ordered by name, LIMIT 500 (`wk/routes/advisors.ts:2932-2955`) | — | NOW, searched in the client |
| COHORT "[Dec 2026] · 1–28 Dec · [11] founders ▾" (`dc:391`) | Cycle picker | • Dates **E**: "1–28" is right because `end_at` is day 29 at 00:00 ET (`mig/156_cohort_timing.sql:16`).<br>• "[11] founders" is **W** from `participant_count`, which is 0 before activation (`wk/routes/admin_cohort.ts:60-63`).<br>• Two true counts exist, with different meanings. Applicants by status (`:250-254`, `:320`) are who was accepted. The founders this mentor would read are the cycle's `company_week_status` membership (`wk/services/cohortAdvisorAccess.ts:12-13`), shown per week and status in `status_counts` (`wk/routes/admin_cohort.ts:64-67`). That membership is empty until the first row is written.<br>• Only 12 cycles are listed (`:53`), and an unmaterialised cycle answers 404 (`wk/routes/advisors.ts:3028-3030`). | #2374 (founder definition) | Dates NOW. The founder count waits for the definition, and the sheet should say which one it shows. |
| NOTE (`dc:391`) | Field | **E**, at most 1,000 characters (`wk/routes/advisors.ts:3045`) | — | NOW |
| "This lets [Name] read the names and email addresses of the founders in [Dec 2026]. Founders are told and can hide themselves." (`dc:391`) | Consequence line | **P/W.**<br>• It understates the access. An assignment opens names and emails, but also week-by-week status and deliverables, who acted on the advisor's guidance, and Lab dates (`wk/services/cohortAdvisorAccess.ts:5-11`). The founder's own notice says "name, email address and weekly progress" (`:115`), and PG5's playbook says the same (`dc:377`).<br>• Founders are told, and can hide, only once a `company_week_status` row exists (`:77-91`). Its one writer, `applyWeekDecision` (`wk/services/cohortTiming.ts:318-321`), runs at a week's deadline (`:430`, `:443`) or on an admin's grace or override (`wk/routes/admin_cohort.ts:145`, `:176`).<br>• The nightly sweep tells them later (`wk/index.ts:2303-2308`). | #2374 | NOW, naming everything the mentor reads, with the caveat |
| Sticky bar Back / Assign (`dc:508`; `dc:202`, `:535`) | Footer | `Lightbox` `footer`, full screen on a phone (`fe/ui/Lightbox.jsx:144`, `:165`, `:179`). POST **E** (`wk/routes/advisors.ts:2998-3056`). A failed sweep reports `founders_notified: 0` (`:3049-3054`). The gate is role only (`:3000-3001`). | #2371-W7 | NOW. Do not print `founders_notified` until the Worker returns null on failure. |

---

#### 2. Figures and sentences that would be wrong today

| # | Board | Figure or sentence | Why it is wrong | Fixed by |
|---|---|---|---|---|
| 1 | PG13, PG20b | "Queue [0]" | A zero on a program with no queue (AI-native is not running; Mentor access is `NOT_LANED`, `wk/services/approvalSources.ts:273`) | Drop the count |
| 2 | PG13 | "Tools included [Eadwyn, Spin-Out Lab modules]" with no "Not set" | A sample shown as decided (`dc:458`) | OD-AIN |
| 3 | PG13 | The bracketed purpose line | A sample (`dc:455`) | OD-AIN |
| 4 | PG14 | Group "Network" | The catalogue says "Network and referrals" (`dc:358`) | Use the catalogue's names |
| 5 | PG14 | "Product testers" as an audience | No such role (s10) | #2377 |
| 6 | PG14 | "Draft saved [10:41]" | No draft store (s1) | #2371-W2 |
| 7 | PG15b, PG16a | Learning "Join: By invitation" | Set per program (`mig/389:26`), and a plain Admin cannot read every program's setting (`wk/routes/admin_learning_programs.ts:84-85`) | Say "Open or by invitation" |
| 8 | PG15b, PG16a | Every "Not granted" or "Requested" badge; "HQ has not granted any programs to [Studio]" | No grant store; false by construction on HQ-held accounts (`dc:491`) | #2376 |
| 9 | PG15c | "New sign-ups stop … Members see 'Paused'." | Nothing stores or enforces a program pause (s4; `wk/routes/refer_earn.ts:140-142`) | OD-PAUSE, #2371-W1 |
| 10 | PG16a, PG17, PG20a | Scope tooltip "Every figure on this page is this licence's." | On HQ the figures are HQ's own; admins are unscoped (`wk/services/tenancyScope.ts:64`; `wk/routes/admin_studio_glance.ts:10-12`) | Use `SCOPE_TITLE` (`fe/pages/admin/insights/insightsModel.js:27`) |
| 11 | PG16c | "Nothing is waiting." for Lab applications | `/api/admin/spinout-applications` answers 200 `[]` on failure (`wk/routes/admin.ts:1190-1206`) | Read the glance lane or the cohort applications |
| 12 | PG16c | "Nothing is waiting." for Mentor access | It has no queue | Show "No queue" |
| 13 | PG16c | "…when members submit them" | Partners submit perks; hosts apply from a partner or advisor profile | A sentence per queue |
| 14 | PG17 | "Updated [10:42]" while loading | Nothing has been read yet (precedent `fe/pages/admin/insights/AdminInsights.jsx:299`) | Show "Reading…" |
| 15 | PG18a | "Credits could not be read" for a plain Admin | No read exists for an Admin (`wk/routes/admin_credit_rules.ts:74-76`) | "Not read here yet" until W1 |
| 16 | PG18b | "Not recorded" for mentor sessions | Bookings are recorded (`base:108`); no read counts them (s7) | Label it "Not read here yet" |
| 17 | PG18c | The suspended sentence on Assign | The write is never refused (`wk/routes/advisors.ts:3000-3001`). Suspension cannot arise on HQ (s6, s8). W7 adds only `requireAdmin`, so `admin_frozen` and not `branch_suspended` (issue:480). | #2371-W7 plus a suspension gate |
| 18 | PG20a | "Waiting for you [21]", Refer & Earn "Needs you [9]" | They include strategic access, which has no read. The referrals lane counts `more_info_needed` (`wk/services/approvalSources.ts:122-124`). The perk queue counts drafts (`wk/routes/perks.ts:773`). The glance's `pending_total` is a different sum, over eleven lanes (s11). | #2371-W4; filter the lanes |
| 19 | PG20a | "Overdue" past two days; age bands | issue:173, :180 against the code's 24 h and 72 h | S1-BANDS |
| 20 | PG20a | Lab "[24] in the cohort" | `[]` on failure and LIMIT 400 (`wk/routes/admin.ts:1424-1430`); the timeline drops founders whose `spinout_lab_active` is 0, which incorporation sets (`wk/routes/admin_cohort.ts:60-63`; `wk/routes/spinout_lab.ts:239`, `:250`) | #2374 |
| 21 | PG20a | Refer & Earn "Who: Every member" | Explorers cannot open `/referrals` (`fe/App.jsx:3497`) | OD Explorers (issue:482) |
| 22 | PG20a | Programs running; People taking part; Credits paid out | No reads | #2371-W1 |
| 23 | PG20b, PG20c | "Founders hidden", "[12] of [14] visible" | No admin count | #2371-W7 |
| 24 | PG20b | "…their access is still on" | Reads are refused (`wk/routes/advisors.ts:2421-2423`) | Reword |
| 25 | PG20d | "[11] founders" | `participant_count` is 0 before activation. The founders a mentor reads are a third set, `company_week_status` membership. | #2374 definition |
| 26 | PG20d | "Founders are told" (said at assign time) | Only founders with a `company_week_status` row are told. Rows are written at a week's deadline or on an admin's grace or override. | Caveat in copy, or #2374 |
| 27 | PG20d, PG20b | "[N] founders told" from `founders_notified` | It reads 0 on a failed sweep, on Assign and on End access (`wk/routes/advisors.ts:3049-3054`, `:3076-3080`) | Worker returns null |
| 28 | PG19b via `hqOnly` | `SuperAdminOnlyNotice`'s words and its "Admin Console →" link | Not the canvas's sentence (`fe/pages/hq/SuperAdminOnlyNotice.jsx:34-49`) | In-page notice |
| 29 | PG20b | "Ended this period [1]" | A program page has no period (`dc:471`, `:469`); re-assigning erases the end (`wk/routes/advisors.ts:3041-3043`) | State the window |
| 30 | PG20d | "…read the names and email addresses of the founders" | The mentor also reads weekly status, deliverables and guidance follow-through (`wk/services/cohortAdvisorAccess.ts:5-11`) | Name everything read |
| 31 | PG16a, PG17, PG20a | "Every program your studio runs…" | No studio is deployed; the canvas's own HQ-held wording is `dc:491` | HQ-held copy |

#### 3. Buildable NOW with no Worker change

- **PG13 (static page).**
  - Title.
  - The "Proposed" and "Not offered yet" pills, as static copy.
  - The four "Not running yet" tiles.
  - The locked "How it runs · draft" card, with every row "Not set" (Tools included too).
  - The Admin foot.
  - No Queue count; the other tabs read "Not running yet".
- **PG16b.** All of it, from the assignment list and the timeline, with failure kept apart from empty (as `fe/pages/admin/AdvisorCohortAssignments.jsx:183-197` already does).
- **PG16c.** Per queue:
  - Refer & Earn reviews (two status calls);
  - Perk listings;
  - Office-hours hosts;
  - Lab applications through the glance lane.
  - Mentor access reads "No queue". One sentence per queue on who submits.
- **PG17.** Every skeleton and "Reading…", with "Reading…" in place of the stamp on a first load. No period control.
- **PG18a.** The error pattern (`Unreadable` with `what` and `claim`) on every block whose read exists. The Waiting rows marked E or P above, and the Chart / Table toggle.
- **PG18b.** As "Not read here yet", with the line drawn visibly.
- **PG18c.** The code-keyed refusal mapping in the client, for `branch_suspended` and `admin_frozen` (the D915 shape), with a Programs sentence. Nothing fires on Assign until W7, and then only `admin_frozen`.
- **PG19b.** The in-page notice under `guard(['admin'])`, with "Back to Programs".
- **PG20a.**
  - The Lab card's waiting and hosts figures. Waiting is the glance's `cohort_applicants` count, pending #2374's choice of store.
  - The Mentor card, with its "Needs you".
  - Refer & Earn's reviews count, labelled "newest 200" when capped.
  - Static "Live" and "HQ-held" pills.
- **PG20b.**
  - Header with "HQ-held"; tabs that scroll.
  - Active mentors, current advisors only.
  - Ended, with a stated window.
  - Both Needs-you rows, with the copy fix and dialogs, and no `founders_notified`.
- **PG20c.** Search, cards without "visible" (with "· week n"), and a count line.
- **PG20d.** Picker, dates, note, the Assign POST, and the consequence line naming everything a mentor reads, with its caveat.
- **Shared chrome.** Sidebar row, badge, spine (keyed "Admin · Programs"), and the phone shell.

Everything on PG14, PG15a, PG15b, PG15c and PG13s, and every grant badge on PG16a, waits for W1, W2 or #2376. PG14's template picker read is the one exception.

#### 4. Honest placeholders

The three labels are kept apart:
- **Not recorded**: no store exists at all.
- **Not read here yet**: the data is stored, but no read sums it. Draw it with `Unrecorded`, its text overridden, and the reason shown as a visible line, not only on hover.
- **Could not be read**: a read failed. Draw it with `Unreadable`, giving `what` and `claim`.

| Block | Label | Waits for |
|---|---|---|
| Program status, playbook sections (including AI-native's), "Programs running", proposal states, "Draft saved", the decision note, program pause | Not recorded | #2371-W1, #2371-W2, OD-PAUSE |
| Every grant badge (Not granted, Requested, Granted to [n] studios); "Studios offered"; "Waiting for HQ since" | Not recorded | #2376, #2371-W3 |
| Perk-listing waiting age for a listing that went back to review after an edit. A new submission's `created_at` is exact (`wk/routes/perks.ts:555-560`, `:629`; `mig/186_perks.sql:73-81`). | Not recorded (re-reviews only) | A `submitted_at` column |
| People taking part; Credits paid out and the credits chart (for an Admin); Perk claims series | Not read here yet | #2371-W1 |
| Strategic referral access count and rows (the store is `mig/175_referral_submissions.sql:86`) | Not read here yet | #2371-W4 |
| Founders hidden; "[n] of [m] visible" (store: `mig/367:42-49`) | Not read here yet | #2371-W7 |
| Sessions with a mentor (store: `base:108`; keyed on the advisor profile) | Not read here yet | A new read |
| "[n] founders" in a cohort before activation | Not read here yet | #2374 definition. Applicants by status (`wk/routes/admin_cohort.ts:250-254`) and mentor-visible membership (`:64-67`) both exist and mean different things. |
| Learning join method per program, for a plain Admin | Static "Open or by invitation" | — (the Super Admin's list holds it) |
| AI-native tiles | "Not running yet": a fact about the program, not a gap in data | — |
| Any block whose read fails, including a Lab read reached through the glance or the cohort applications | Could not be read | — |
| A Lab applications figure taken from `/api/admin/spinout-applications` | Do not draw. Its failure looks like "none" (`wk/routes/admin.ts:1205`). | #2374, or a Worker fix |

#### 5. Findings these boards add (not in the six lead reports)

1. **HQ never refuses a suspended licence's administrator** (s6). Even after W7, PG18c's sentence cannot appear on HQ. Only a branch raises `branch_suspended`, and none is deployed (s8).
2. **W7 as written adds the freeze, not the suspension gate.** issue:480 moves the four routes to `requireAdmin`, which brings `admin_frozen` on POST and DELETE (`wk/auth.ts:569-572`). `branch_suspended` needs `requireBranchNotSuspended` added beside it, as `wk/routes/refer_earn.ts:286-288` does.
3. **The D915 refusal sentence is Events-specific** ("approving and featuring", `fe/pages/admin/events/eventsDeskModel.js:818`). Programs needs its own sentence through the same `refusalText` shape, or that helper moved to shared code with a sentence passed in.
4. **PG18b's "Not recorded" mislabels recorded data.** Mentor sessions are stored and unread, so the label is "Not read here yet". Counting them needs a join from user to advisor profile to bookings, and to the cohort's founders.
5. **PG14's group list and the catalogue's disagree** ("Network" against "Network and referrals").
6. **The phone boards drop "Propose a program" and "Assign a mentor" from the header** (`hbtns = phone ? []`, `dc:469`, `:471`). On a phone, proposing has no entry point.
7. **The glance cannot carry "Waiting by program".** It has no Perk listings or Office-hours hosts lane (s11). On HQ, nothing gives per-item ages across queues (s12). So the five-row chart is five reads with five different caps.
8. **"Founders in a cohort" has three meanings in the code.** They are active participants (`participant_count`), applicants by status, and `company_week_status` membership. The mentor reads, and is told about, the third. PG20d's count and its consequence line must name one.
9. **PG20d's consequence line understates what a mentor reads.** It names names and emails, but the access also opens weekly status, deliverables and guidance follow-through (`wk/services/cohortAdvisorAccess.ts:5-11`).
10. **Learning's join method cannot be derived for a plain Admin.** The full program list is Super Admin only (`wk/routes/admin_learning_programs.ts:84-85`).

---

#### Corrections

1. **Basis.** HEAD is `d7d7040`, not `99466ce`. Two more D906 commits (`fbbb4c8`, `d7d7040`) landed; they touch no cited file. The App.jsx insertion is after `:2837` (new `:2838-2841`), not after `:2838`.
2. **PG18c / W7: the cell overstated the fix.** It said the suspension refusal "cannot fire on Assign until W7". W7 (issue:480) adds only `requireAdmin`, which gives `admin_frozen`, not `branch_suspended`. I fixed the cell, §2 #17, §3 and the W7 key row, and added §5 #2.
3. **PG20d consequence line: marked "true", but it is incomplete.** The mentor also reads weekly status, deliverables and guidance follow-through. The old cite (`cohortAdvisorAccess.ts:110-118`) was the founder notice, not the reads; the reads are `:5-11`. Added §2 #30.
4. **PG20d: "its one writer runs at a week's deadline" was wrong.** `applyWeekDecision` is also called by an admin's grace and override (`wk/routes/admin_cohort.ts:145`, `:176`).
5. **PG20d "[11] founders": the suggested true count was a different set.** The section offered applicants by status. The founders a mentor reads are `company_week_status` membership. Added §5 #8.
6. **PG15b / §2 #7: "derive it" is not readable by an Admin.** The full Learning list is Super Admin only. An Admin sees only assigned or open programs.
7. **PG20a Learning series: wrong cite.** `learning_programs.ts:104-121` gives counts only. Dates come from `:178-188` and `services/learningPrograms.ts:101-109`, and cover active learners only.
8. **PG18a waiting rows: missing caveats.** The glance has no Perks or hosts lane (new s11), and on HQ no read gives per-item ages (new s12, `approvalBoard` is branch only). The Refer & Earn list is newest first, 100 by default. A rolled-forward Lab applicant's age restarts.
9. **Perk-listing age: "only created_at" was too strong.** `created_at` is exact for new submissions. Only re-reviews after an edit lack a stamp. I changed the §4 row.
10. **PG20b "Ended this period": a figure the canvas defines without a period.** `prog()` sets no period on a program page. Added §2 #29.
11. **PG20b and §2 #27: a hidden failure was missed.** End access (DELETE) also reports `founders_notified: 0` on failure (`:3076-3080`).
12. **PG20b Active mentors / Founders hidden: two fixes.** The count must exclude role-changed rows. Opt-outs are also read for the founder's own list and the sweep, not only the advisor's.
13. **PG16a scope chip: the brand sentence contradicted §0.3.** A licence administrator's brand already shows in the badge with no branch deployed (`fe/App.jsx:1306-1319`), so "a brand appears only on a deployed branch" was wrong.
14. **PG16a cards: wrong cite for the Lab.** Its facts were cited to the Mentor route; I re-cited them to `wk/routes/admin.ts:1183-1190` and `mig/157:19-24`.
15. **PG15c: missing cite.** The dialog names Refer & Earn, whose ⋯ menu is `dc:413` (Perks `dc:423`). The section cited only `:371` and `:393`.
16. **Missing blocks.** Added the following, with their sources:
    - PG20a card pills and "Open" buttons, and the Mentor card's "Needs you [2]";
    - the PG18a Chart / Table toggle;
    - the PG16a header line ("your studio runs…") as HQ-held copy (§2 #31);
    - PG20c's "· week n".
17. **Line numbers.**
    - `tenancyScope.ts:63` → `:64`
    - `admin_studio_glance.ts:9-11` → `:10-12`
    - `sidebarConfig.js:218-235` → `:218-248`
    - PG15a dialog footer: `Lightbox.jsx:179`, not `:144`
    - `SuperAdminOnlyNotice.jsx` → `:27-50`
    - `approvalSources.ts:351` → `:350-351`
18. **Search lists.**
    - s1 also hits `base:4930`, `wk/routes/decks.ts:58` and `programReads.js:36`, `:143`.
    - s3 also hits `fe/App.jsx:2360` and `SpinoutLabInvestorPage.jsx:12`.
    - s10's hits are `adminInsights.ts:484` and `insightsExport.ts:83`; `:58-59` is the reason text, not a hit.
    - s10 now notes per-programme testers (`mig/516:36`, `:48`).
19. **Additional nuances.**
    - The contract-template picker is refused during a recovery cool-off, GET included (`wk/index.ts:655`, `:685-691`).
    - A program request could ride D799's untyped `other` kind today (`wk/rpc/hqOps.ts:50-53`, `:102-116`).
    - S1-BANDS now cites the canvas's own two-day rule (issue:173, :180).
    - Added #2371-W4 (slot 4, issue:478, :512) to the key.
20. **Checked and correct as written.** Every other E/NOW was re-read at HEAD and is readable by a plain Admin:
    - Mentor routes are role only.
    - Timeline, cohort applications, glance, Refer & Earn admin list, perks queue, lab hosts and contract templates are `requireAdmin`.
    - None hides a failure as an empty 200, except the two the section already flags (`admin.ts:1205`, `:1429`) and the `founders_notified` zeros.

## Part B — the Worker reads and writes

### Spin-Out Lab, cohorts, Mentor cohort access, office-hours hosts: what the Worker reads and writes (2026-10-24)

**This is a snapshot, not a spec.** I read the code on `claude/spinout-lab-workspace-wuyyqd` at HEAD `6205ee6` (origin/main `b0422fe` plus S1's commits) for #2371. I did not check it against production, and nobody maintains it after today. Re-read the code before acting on any line.

**Path prefixes:**
- `wk/` = `cloudflare-worker/src/`
- `fe/` = `frontend/src/`
- `mig/` = `cloudflare-worker/sql/migrations/`
- `dc:` = `design/incoming/Programs Page.dc.html`
- `grid:` = `design/incoming/Programs · Boards.dc.html`

All lines are at HEAD. When I say something does not exist, I give the search I ran.

**Notation in the board tables:**
- **E**: exists.
- **P**: partly exists, or can be derived on the client with a stated rule.
- **N**: does not exist.
- **W**: would show a wrong figure if drawn naively.

---

#### 0. Key findings

1. **The four Mentor-access admin routes check the role only.** Each is `requireAuth` plus `isAdmin` (`wk/routes/advisors.ts:2934-2935`, `:2966-2967`, `:3000-3001`, `:3065-3066`; `isAdmin` is `wk/routes/_t13t14t15_helpers.ts:14-16`). So:
   - A frozen HQ admin can still assign and end access. D135 never runs (`wk/auth.ts:523-528`, `:568-590`).
   - A branch whose licence is suspended can still grant access to founder data. There is no `requireBranchNotSuspended` call.
   - Assign and end write **no audit row**. In `advisors.ts`, `logAdminAction` appears only at `:3708`, `:3926` and `:4323`, none of them in the cohort block `:2272-3082`.
2. **No count of hidden founders exists anywhere.** `cohort_advisor_optouts` is read only by `optedOutFounderIds` (`wk/services/cohortAdvisorAccess.ts:47-52`), which is used for the advisor's own reads. Searches:
   - `grep -rn "cohort_advisor_optouts" wk` finds only the service and the schema ensure (`wk/services/advisorStoresSchema.ts:175`).
   - `grep -rnE "hidden_count|founders_hidden|optout_count" wk fe` finds nothing relevant.
3. **Week-1 gap (new finding).** The mentor's founder list, the founder notices and the founder's hide switch all take cohort membership from `company_week_status`:
   - Founders read: `advisors.ts:2439-2446`.
   - Notices: `cohortAdvisorAccess.ts:83-84`.
   - Hide switch: `:190`, `:223`.

   That table has one writer, `applyWeekDecision` (`wk/services/cohortTiming.ts:318-339`; `grep -rn "INTO company_week_status" wk` finds 1 hit). It runs only at a week's deadline (`:443-450`) or on an admin grace or override (`wk/routes/admin_cohort.ts:145-151`, `:176-181`). So from a cohort's start until its first Week-1 deadline:
   - an assigned mentor reads **no founders**;
   - **no founder is told**;
   - **no founder can hide**.

   This is a reading of the code, not a production check.
4. **Two definitions of "founders in a cohort".** Neither matches what a mentor can read during Week 1.
   - `/api/admin/cohort/timeline` counts `users` that are active and whose `started_at` falls in the cycle window (`admin_cohort.ts:60-63`). The count is 0 before activation.
   - The mentor reads count `company_week_status` membership (see finding 3).
5. **Two Lab reads answer `[]` with 200 when they fail.**
   - `GET /api/admin/spinout-applications` returns `{applications: []}` (`wk/routes/admin.ts:1192-1206`).
   - `GET /api/admin/spinout-participants` returns `{participants: [], catalog}` (`:1427-1430`).
   - The console marks a section Unreadable only when the request itself throws (`fe/pages/admin/AdminSpinoutLab.jsx:643-649`). A database failure therefore shows as "none".
6. **Nothing can move a cohort date.**
   - `grep -rn "UPDATE week_windows" wk` finds nothing.
   - The only `UPDATE cohort_cycles` statements change status, `app_status`, `force_proceed` or the application window: `cohortTiming.ts:499`, `:543`; `wk/services/cohortApplications.ts:284`, `:378`, `:471`, `:548`; `admin_cohort.ts:598`.
7. **PG4–PG6 have no store for programs, playbooks, grants, program pause or program activity.** `grep -rniE "program_grants|programme_grants|program_registry|programme_registry|program_playbook|playbook_sections|program_proposals" cloudflare-worker/src cloudflare-worker/sql` finds nothing. "playbook" appears only in unrelated assessment, research and advisor-deliverable files.

---

#### 1. Mounts

| Prefix | Router | Mount |
|---|---|---|
| `/api/admin/cohort` | `wk/routes/admin_cohort.ts` | `wk/index.ts:920`, before the `/api/admin` catch-all (`:1101`) |
| `/api/admin/studio` (glance) | `wk/routes/admin_studio_glance.ts` | `wk/index.ts:1094` |
| `/api/admin` (spinout-admit, spinout-applications, spinout-participants) | `wk/routes/admin.ts` | `wk/index.ts:1101` |
| `/api/spinout-lab/hosts` (applicant side) | `labHosts` in `wk/routes/lab_hosts.ts` | `wk/index.ts:1326` |
| `/api/admin/lab-hosts` | `adminLabHosts` in `wk/routes/lab_hosts.ts` | `wk/index.ts:1327` |
| `/api/advisors` **and** `/api/mentors` (permanent alias) | `wk/routes/advisors.ts` | `wk/index.ts:1330`, `:1331` |

The cron jobs run from `wk/index.ts`:
- `runCohortTimingTick` (`:1971-1972`) and `runCohortApplicationsTick` (`:1983-1984`).
- The nightly mentor-notice sweep at 05:05 UTC: `syncCohortAdvisorNotices(env, {limit: 2000})` (`:2303-2308`).

---

#### 2. Guard matrix

How the guards behave:
- `requireAdmin` is `requireAuth` plus `role === 'admin'` plus `refuseWhileFrozen` (`wk/auth.ts:523-528`).
- The freeze (D135) skips GET, HEAD and OPTIONS (`:570`), every branch (`:571`) and the Super Admin (`:572`). An unreadable `admin_notices` table counts as not frozen (`:582-585`).
- A frozen write throws `admin_frozen`. Uncaught, it reaches `app.onError`, which answers **423** with `adminFrozenBody` (`wk/index.ts:1473`). Inside `mapError` it gives the same 423 (`_t13t14t15_helpers.ts:176`).
- `requireBranchNotSuspended` does nothing on HQ (`auth.ts:753`). An unreadable licence copy passes (`:759-762`). A suspended branch gets **423** `{detail, code:'branch_suspended', since, reason}` (`index.ts:1477`; `wk/util/authErrors.ts:178-190`).
- `requireSuperAdmin` is `requireAdmin` plus HQ-only plus the elevation (`auth.ts:692-697`).
- On a role refusal, admin.ts, admin_cohort.ts and lab_hosts.ts answer 403 `{detail:'Admin required'}` through `onError` (`authErrors.ts:83`). advisors.ts answers its own 403 `{detail:'Admin required'}`.

| Route | Guard | Frozen HQ admin (write) | Suspended branch (write) | How a failure reads |
|---|---|---|---|---|
| `POST /api/admin/users/:user_id/spinout-admit` | `requireAdmin` (`admin.ts:1123`) | 423 | **423** (`:1125`) | 5xx |
| `GET /api/admin/spinout-applications` | `requireAdmin` (`:1191`) | n/a (read) | n/a | **200 `{applications: []}`** (`:1205`) |
| `POST /api/admin/spinout-applications/:app_id/decide` | `requireAdmin` (`:1210`) | 423 | **423** (`:1216`) | 5xx; side effects are best-effort |
| `GET /api/admin/spinout-participants` | `requireAdmin` (`:1386`) | n/a | n/a | **200 `{participants: [], catalog}`** (`:1427-1430`) |
| `GET /api/admin/cohort/timeline` | `requireAdmin` (`admin_cohort.ts:50`) | n/a | n/a | 5xx: no try (`:52-75`); the schema ensure swallows errors (`cohortTiming.ts:186-191`) |
| `GET /api/admin/cohort/review` | `requireAdmin` (`:79`) | n/a | n/a | 5xx |
| `POST /api/admin/cohort/grace` | `requireAdmin` (`:129`) | 423 | **not gated** | 5xx |
| `POST /api/admin/cohort/override` | `requireAdmin` (`:161`) | 423 | **not gated** | 5xx |
| `GET /api/admin/cohort/impersonation-audit` | **`requireSuperAdmin`** (`:209`) | n/a | branch 403 `HQ only` | 5xx |
| `GET /api/admin/cohort/catalog` | `requireAdmin` (`:223`) | n/a | n/a | static |
| `GET /api/admin/cohort/applications` | `requireAdmin` (`:239`) | n/a | n/a | main query 5xx; settings `null` plus `settings_unreadable` (`:244`, `:329`); lifecycle fields silently absent (`:301`); plans `week1_plan_unreadable` (`:305-316`) |
| `POST /api/admin/cohort/applications/settings` | `requireAdmin` (`:333`) | 423 | **not gated** | 5xx |
| `POST /api/admin/cohort/applications/:applicant_id/decide` | `requireAdmin` (`:358`) | 423 | **423** (`:360`) | 5xx; `applicant_note_saved:false` when the note write fails (`:411-424`) |
| `POST …/:applicant_id/interview` and `…/interview/cancel` | `requireAdmin` (`:522`, `:568`) | 423 | **423** (`:523`, `:569`) | refusal bodies `{error, message, detail}` (`:511-513`) |
| `POST …/applications/cycles/:cycle_id/force-proceed` | `requireAdmin` (`:585`) | 423 | **not gated** | 5xx |
| `GET …/applications/notifications` and `…/events` | `requireAdmin` (`:607`, `:620`) | n/a | n/a | 5xx |
| `GET /api/admin/studio/glance` | `requireAdmin` inside `mapError` (`admin_studio_glance.ts:30-37`) | n/a | not gated | each lane `count: null` (`approvalSources.ts:464-466`) |
| `GET /api/advisors/admin/cohort-assignments/assignable` | **role only** (`advisors.ts:2934-2935`) | **not frozen** | not gated | 500 via `mapError` |
| `GET /api/advisors/admin/cohort-assignments` | **role only** (`:2966-2967`) | not frozen | not gated | 500 |
| `POST /api/advisors/admin/cohort-assignments` | **role only** (`:3000-3001`) | **not frozen** | **not gated** | 500; a failed notice sweep returns **`founders_notified: 0`** (`:3050-3053`) |
| `DELETE /api/advisors/admin/cohort-assignments/:id` | **role only** (`:3065-3066`) | **not frozen** | **not gated** | 500; **`founders_notified: 0`** on a failed sweep (`:3076-3079`) |
| `GET /api/admin/lab-hosts` | `requireAdmin` (`lab_hosts.ts:199`) | n/a | n/a | 5xx: no try (`:198-222`) |
| `POST /api/admin/lab-hosts/:uid/decision` | `requireAdmin` (`:225`) | 423 | **not gated** | 5xx |

The Super Admin passes every role-only and `requireAdmin` route, because the role stays `admin` (`auth.ts:669-672`). Only `impersonation-audit` is Super-Admin-only. No route in this report is `hqOnly` apart from that one.

---

#### 3. Spin-Out Lab applications and participants (`wk/routes/admin.ts`)

##### 3.1 Routes

| Route | Lines | Body | Writes | Response |
|---|---|---|---|---|
| `POST /users/:user_id/spinout-admit` | 1122-1181 | `{cohort?}`; the default is `'Cohort 3'` (`:1129`) | Upserts `user_spinout_flags` (`:1148-1152`). Sends a `spinout_admitted` email on the first admit (`:1155-1168`). Writes `activity_logs` with the admin's name in the details (`:1170-1178`). | `{ok, cohort, already_admitted, emailed}` (`:1180`). Refusals: 400 for an admin target (`:1137`); 409 for an alumnus (`:1143-1145`). |
| `GET /spinout-applications` | 1190-1207 | — | — | `{applications: [{id, user_id, name, email, company_name, idea, incorporated, stage, jurisdiction, cohort, status, created_at, decided_at}]}`. Ordered pending first, then newest. **LIMIT 200, no total** (`:1195-1202`). It does **not** return the migration-315 fields (answers, withdrawn_at, applicant_note); those come only through `/admin/cohort/applications`. |
| `POST /spinout-applications/:app_id/decide` | 1209-1378 | `{decision:'accepted'\|'refused', cohort?}` (cohort ≤50 chars, `:1226`) | Guarded `UPDATE spinout_applications … WHERE status='pending'` (`:1246-1251`). Mirrors `cohort_applicants` to approved or rejected (`:1258-1263`, errors swallowed). Claims the shared decision-email ledger (`:1276-1290`). On accept: flags (`:1293-1298`), plus activation at the cycle's `start_at` when the application is pinned to a cycle (`:1320-1333`). Email (`:1335-1365`). `activity_logs` with the admin's name (`:1367-1375`). | `{ok, status, cohort, emailed}` (`:1377`). Errors: 400 bad decision (`:1221-1223`); 404 (`:1234`); 409 already decided (`:1235`, `:1249-1251`); 400 admin target (`:1240-1242`). |
| `GET /spinout-participants` | 1385-1527 | — | Can create `user_spinout_flags` (`:1101-1115`, errors swallowed) | `{participants: [{user_id, uid, name, email, admitted, cohort, status:'active'\|'graduated'\|'admitted', week, day, days_remaining, started_at, is_incorporated, company_name, sector, milestones[], unlocked_features[], application}], catalog}` (`:1506-1526`). **LIMIT 400** (`:1424`). If milestones fail the lists are empty (`:1457`); if applications fail, `application` is null (`:1481`). |

##### 3.2 Tables

| Table | Migration |
|---|---|
| `spinout_applications` | `mig/155_spinout_applications.sql:4-16`. `cohort` is free text with default `'Cohort 4'` (`:12`); statuses pending, accepted, refused. |
| `spinout_applications` additions | `mig/315_spinout_application_lifecycle.sql:34-38`: answers_json, withdrawn_at, applicant_note, applicant_asks_json, applicant_note_at. Same migration adds the drafts table (`:40-45`). |
| `spinout_application_interviews` | `mig/316_…:19-33` |
| `user_spinout_flags` (admitted, cohort label) | `mig/154_spinout_admission.sql:10-15` |

##### 3.3 Two cohort vocabularies

- An application's and a participant's `cohort` is a **text label**:
  - `"<Month YYYY> Cohort"` from apply (`wk/routes/spinout_lab.ts:527-528`) and from activation (`cohortApplications.ts:492`, `:510`);
  - legacy `"Cohort N"` from admit and decide (`admin.ts:1129`, `:1265`).
- Cohorts as the Lab calendar knows them are `cohort_cycles` rows keyed by year and month (§4).
- The console's approve picker invents labels with `/^Cohort (\d+)$/` (`AdminSpinoutLab.jsx:186-194`).
- Applying writes both a `spinout_applications` row and a `cohort_applicants` row (`spinout_lab.ts:598-607`). At close, any unpinned pending applications are adopted into the pool (`cohortApplications.ts:371-376`). So "Spin-Out Lab applications" and "Cohort applications" are one store seen two ways, as the owner said.

---

#### 4. Cohort timeline, cycles, week windows, applicants (`admin_cohort.ts`, `cohortTiming.ts`, `cohortApplications.ts`)

##### 4.1 Routes (`wk/routes/admin_cohort.ts`)

| Route | Lines | Shape and limits |
|---|---|---|
| `GET /timeline` | 49-76 | `{cycles: [{…cohort_cycles.*, windows:[{week_number, unlock_at, deadline_at}], participant_count, status_counts:[{week_number,status,n}]}], server_time}`. Takes the **12 most recent** cycles by year and month, descending (`:53`). It runs four queries per cycle (N+1, `:56-74`). `participant_count` counts active users whose `started_at` falls in [start_at, end_at) (`:60-63`); it falls back to `?? 0` (`:71`). `SELECT *` also returns the migration-157 columns (`app_status`, application window, `force_proceed`). |
| `GET /review?cycle_id=` | 78-126 | `{review: company_week_status rows (failed or grace) with name and email, LIMIT 200 (:84-91), at_risk:[{user_id,name,email,cycle_id,week,deadline_at,missing,done,required}], server_time}`. At-risk is a per-founder loop (`:102-124`). |
| `POST /grace` | 128-158 | `{user_id, cycle_id, week 1-4, hours 1-168, reason}`. The reason is required (`:138`). It writes `applyWeekDecision` `grace` and `activity_logs`, and sends an instant notice to the founder. Response `{ok, grace_until}`. |
| `POST /override` | 160-196 | `{…, decision:'pass'\|'fail', reason}`. A pass can bump `spinout_lab_week` (`:182-187`). Response `{ok, status}`. |
| `GET /impersonation-audit` | 198-219 | Super Admin. `{sessions}`, LIMIT 100. |
| `GET /catalog` | 222-225 | `{milestones}` |
| `GET /applications` | 238-330 | `{cycles:[{…cycle, label, applicant_counts:{status:n}, meets_minimum: bool\|null, applicants:[{id, application_id, user_id, status, rolled_from_cycle_id, decided_at, decided_by, decision_reason, created_at, name, email, company_name, idea, stage, jurisdiction, answers, answers_recorded, withdrawn_at, applicant_note, applicant_asks, applicant_note_at, interview, week1_plan, week1_plan_unreadable}]}], settings:{min,max}\|null, settings_unreadable, server_time}`. 12 cycles; **200 applicants per cycle**; no total. |
| `POST /applications/settings` | 332-355 | `{min_cohort_size?, max_cohort_size?}`, integers 0-1000 (`:341`) → `{ok}` |
| `POST /applications/:applicant_id/decide` | 357-505 | `{status:'approved'\|'rejected'\|'waitlisted', reason (required, ≤500), applicant_note? (≤2000), applicant_asks?}`. Returns 409 when the applicant is activated, rolled_forward or withdrawn (`:387-389`). Keeps `spinout_applications` in step (`:399-408`). Response `{ok, status, emailed, applicant_note_saved}` (`:504`). |
| `POST /applications/:applicant_id/interview` (and `/cancel`) | 521-582 | A batch that cancels the old interview and inserts the new one (`:551-561`). 201 `{ok, interview_id, scheduled_at}`. |
| `POST /applications/cycles/:cycle_id/force-proceed` | 584-604 | `{reason}` required. Sets `force_proceed=1` (`:598`) and is allowed only while open or reviewing (`:595-597`). |
| `GET /applications/notifications?cycle_id=` and `GET /applications/events?cycle_id=` | 606-628 | LIMIT 300 each |

Every admin write logs `activity_logs` with "Admin <name>" in the details (`:32-39`, e.g. `:152-153`). Cycle events log `actor 'admin:<id>'`. A history UI must not print that text verbatim, because the canvas rule is "an admin" or "HQ" (dc: RULES).

##### 4.2 The calendar (`wk/services/cohortTiming.ts`)

- Cohorts start on the 1st of each month at 00:00 America/New_York (`COHORT_TZ`, `:28`; header `:4-7`).
- There are four weeks. Week N unlocks on day 1+(N-1)·7 at 00:00 ET, and its **deadline is day 1+N·7 at 00:00 ET** (`:69-85`). The canvas writes "gate [7 Nov] 23:59", which is the same instant.
- `end_at` is day 29 at 00:00 (`mig/156_cohort_timing.sql:16`).
- Cycles are materialized for the current month and the next one (`:220-226`), and the applications tick adds the month after (`cohortApplications.ts:312-317`). Today that means October, November and December 2026 exist. A cohort further out cannot be assigned a mentor yet: POST answers 404 `No such cohort cycle` (`advisors.ts:3028-3030`).
- The cron tick (`:473-576`) handles unlocks, deadlines (calling `decideUserWeek`, `:411-467`), grace expiry and reminders.
- The applications tick (`cohortApplications.ts:306-328`) handles reminders, close, the capacity check (with postponement and roll-forward, `:396-480`) and activation (`:483-557`).
- Nothing moves a date (finding 6).

##### 4.3 Tables

| Table | Migration |
|---|---|
| `cohort_cycles` | `mig/156:11-20`; columns added in `mig/157:14-17` (`app_status` is open, reviewing, active or postponed) |
| `week_windows` | `mig/156:22-29` |
| `company_week_status` | `mig/156:34-48` |
| `deliverable_snapshots`, `stage_transition_log` | `mig/156:53-77` |
| `cohort_applicants` | `mig/157:25-37` (pending, approved, rejected, waitlisted, rolled_forward, activated, plus withdrawn from 315) |
| `cohort_cycle_events` | `mig/157:42-49` |
| `cohort_app_notification_ledger` | `mig/157:54-62` |
| `cohort_settings` | `mig/157:66-71` |

The defaults are a minimum of 1 and a maximum of 25 (`cohortApplications.ts:35-36`). An unreadable settings table makes the read return `null` (D511, `:160-199`).

---

#### 5. The Approvals cohort lane and the studio glance

- The `cohort` lane, labelled "Cohort applications", is `SELECT COUNT(*), MIN(created_at) FROM cohort_applicants WHERE status='pending'` (`wk/services/approvalSources.ts:132-142`). Its oldest age is the **creation** time.
- "Advisor cohort access" is in `NOT_LANED` with the reason "Access is assigned by an admin; an advisor has no way to request it" (`:273`).
- **Lab hosts have no lane.** `APPROVAL_SOURCES` (`:101-258`) has no `lab_host_applications` entry. `grep -n "lab_host" wk/services/approvalSources.ts` finds nothing.
- `laneCounts` (`:453-469`) gives each lane `count: null` when it cannot be read. `queuePressure` (`wk/services/branchHome.ts:360-376`) feeds `hqApprovals` (`wk/services/studioGlance.ts:199-211`). The not-laned list is sent as `no_queue` (`:208`), and `pending_total` is null when any lane fails (`:206`).
- The route is `GET /api/admin/studio/glance`, `requireAdmin`, not suspension-gated (`admin_studio_glance.ts:1-37`).
- Client chain: `api.adminStudioGlance` (`fe/lib/api.js:3652`) → `loadStudioGlance` (`fe/pages/admin/adminStudioOverview.js:357-362`) → `useHeldGlance` and `laneOf` (`fe/pages/admin/heldFigures.jsx:15`, `:39`). Glance console links: `cohort` → `/admin/spinout-lab` (`adminStudioOverview.js:370`); 'Advisor cohort access' → `/admin/advisor-cohorts` (`:386`).

---

#### 6. Advisor ("Mentor") cohort assignments

##### 6.1 Admin routes (`wk/routes/advisors.ts`; also reachable under `/api/mentors/...`)

| Route | Lines | Body and rules | Response |
|---|---|---|---|
| `GET /admin/cohort-assignments/assignable` | 2932-2955 | Users with `LOWER(role)='advisor'`, LEFT JOIN `advisors`, ordered by name, **LIMIT 500** | `{items:[{id, name, email, has_advisor_profile}]}` |
| `GET /admin/cohort-assignments` | 2964-2996 | Every row, active and ended. `ORDER BY assigned_at DESC` **LIMIT 500**. No filters, paging or total. | `{items:[{id, uid, advisor_user_id, cohort_cycle_id, assigned_at, unassigned_at, is_active:boolean, note, advisor_name, advisor_email, advisor_role (CURRENT role)}]}`. `assigned_by_admin_id` is **not** returned (`:2975-2979`). No founder count and no hidden count. |
| `POST /admin/cohort-assignments` | 2998-3056 | `{advisor_user_id, cohort_cycle_id, note?}`. Note ≤1000 via `trimOrNull` (`:3045`). Errors: 400 for non-integer ids (`:3006-3008`); 404 no such user (`:3013`); **400 if the target is not an advisor** (`:3023-3027`); 404 no such cycle (`:3028-3030`). Upsert on the pair **reactivates** the row and overwrites `assigned_at`, `note`, `assigned_by_admin_id`, and sets `unassigned_at = NULL` (`:3036-3045`). | `{…row, is_active, founders_notified}` (`:3054`) |
| `DELETE /admin/cohort-assignments/:id` | 3063-3082 | Soft end: `is_active=0, unassigned_at=now` (`:3072-3074`). 404 when missing (`:3070`). | `{ok, id, is_active:false, unassigned_at, founders_notified}` (`:3080`) |

##### 6.2 What an assignment lets a mentor read

The rule is two parts, both required and re-checked on every request: the **current** role is `advisor` (`mayHoldCohortAssignment`, `:2297-2299`), **and** an active row exists for that cycle. The routes are `:2421-2436` and `requireOwnCohort` `:2590-2605`. The service header lists the same set (`cohortAdvisorAccess.ts:5-11`).

| Read | Lines | What it shows |
|---|---|---|
| `GET /me/cohort` | 2358-2393 | The advisor's own active assignments with cycle dates, LIMIT 50 |
| `GET /me/cohort/:cycleId/founders` | 2416-2457 | **Each founder's name and email**. Membership is `DISTINCT user_id FROM company_week_status` (`:2439-2446`), LIMIT 200. Opt-outs are filtered out (`:2452`). |
| `GET /me/cohort/:cycleId/weeks` | 2482-2578 | Names plus per-week status and deliverables done and required, plus the windows and `current_week`. On a Lab read failure it answers **`available:false`** with 200 (`:2569-2576`). |
| `GET`, `POST /me/cohort/:cycleId/guidance`; `PATCH /me/guidance/:uid` | 2624-2750 | The advisor's guidance, and the names of the founders who acted on it (hidden founders are dropped, `:2662`) |
| `GET /me/cohort/:cycleId/calendar` | 2769-2869 | Lab dates and Demo Day (`end_at`), plus the advisor's own booked sessions. `missing_prep: null`. |

A demoted advisor loses read access at once (`:2421-2423`). Their row stays active, and founders are **not** told it ended (`cohortAdvisorAccess.ts:30-34`).

##### 6.3 Founder notice and hide (D492; `wk/services/cohortAdvisorAccess.ts`, `mig/367_cohort_advisor_founder_notice.sql`)

- **Started notice.** It goes to every founder in the cycle (membership from `company_week_status`) for each active assignment held by a current advisor, unless the founder has hidden from that advisor. It is sent once per episode (`episode_at = assigned_at`) (`:77-119`). The text says the advisor "can see your name, email address and weekly progress" and links to Account › Security & Privacy (`:110-118`, link `:41`).
- **Ended notice.** It goes to founders who were told about the start, once the episode is over: the row was ended, or re-assigned, which starts a new episode (`:124-162`).
- **When the sweep runs:** on assign and end (`advisors.ts:3051`, `:3077`), before the founders, weeks and guidance reads (`:2307-2312`), when a founder opens their own list (`:2331`), and nightly (`index.ts:2303-2308`).
- **Founder routes:**
  - `GET /me/cohort-access` (`advisors.ts:2327-2336`) returns `items:[{advisor_user_id, advisor_name, cohort_cycle_id, cohort_label, assigned_at, ended_at, can_see, hidden_at}]` (`cohortAdvisorAccess.ts:180-211`).
  - `PUT /me/cohort-access/:advisorUserId {visible}` (`advisors.ts:2338-2356`) returns 404 unless the advisor holds or held an assignment on one of the founder's cohorts (`cohortAdvisorAccess.ts:219-226`).
- **The opt-out is per (founder, advisor), not per assignment or cohort.** It is `UNIQUE (founder_user_id, advisor_user_id)` (`mig/367:42-49`) and is kept after it is undone (`withdrawn_at`). Re-hiding overwrites `opted_out_at` (`cohortAdvisorAccess.ts:233-237`).
- Clients: `myCohortAdvisorAccess`, `setCohortAdvisorVisibility` (`fe/lib/api.js:4520-4521`).

##### 6.4 Ended rows

- Ended rows are kept (`mig/206_advisor_cohort_assignments.sql:26-29`), and the admin list returns them (`advisors.ts:2969-2983`).
- **There is one row per pair** (`mig/206:31-33`, `:53`). Re-assigning an ended pair reactivates the same row and clears `unassigned_at` (`advisors.ts:3041-3043`). After that, the earlier episode's dates survive only in `cohort_advisor_notices.episode_at`, and no admin route reads that table.

##### 6.5 Any count of hidden founders?

**No.** See finding 2. A count per assignment would be:

> members of the cycle in `company_week_status` ∩ `cohort_advisor_optouts` where `advisor_user_id = a.advisor_user_id` and `withdrawn_at IS NULL`

No admin route computes it.

##### 6.6 Tables

| Table | Migration |
|---|---|
| `advisor_cohort_assignments` | `mig/206:41-54` |
| `cohort_advisor_notices` | `mig/367:29-37` |
| `cohort_advisor_optouts` | `mig/367:42-49` |
| `cohort_guidance` and its acks | `mig/212_cohort_guidance.sql` |

The dev ensure for these is `wk/services/advisorStoresSchema.ts:164-184`, run as router middleware (`advisors.ts:69-72`).

---

#### 7. Lab office-hours hosts (`wk/routes/lab_hosts.ts`, D377, `mig/313_lab_host_applications.sql:36-61`)

| Route | Lines | Shape |
|---|---|---|
| `GET /api/admin/lab-hosts?status=pending\|approved\|rejected\|withdrawn\|revoked\|all` | 198-222 | Default status is pending (`:200-201`). `{status, items:[{uid, host_kind, capacity, statement, status, reviewed_at, review_note, created_at, applicant_user_id, applicant_name, applicant_email, applicant_role, profile_name, profile_company, reviewed_by_name}], counts:{pending, approved, rejected, withdrawn, revoked}}`. Items are LIMIT 500. **The counts are all-time and ignore the filter** (`:216-221`). `reviewed_by_name` is an admin's name (`:206`). |
| `POST /api/admin/lab-hosts/:uid/decision` | 224-255 | `{decision:'approve'\|'reject'\|'revoke', note?}` (note ≤1000). Allowed transitions are pending→approved or rejected, and approved→revoked (`:47-51`). Errors: 400 bad decision; 404; 409 `not_decidable`. Writes `logAdminAction` `lab_host.<decision>` (`:250-252`). Response `{application}`. Not suspension-gated. |
| Applicant side: `GET /me`, `POST /apply`, `POST /me/:uid/withdraw`, `GET /directory` | 86-192 | The directory lists approved hosts only, never an email (`:163-192`) |

A host can apply as Investor, Advisor or Partner (`:41`; check constraint `mig/313:42`, `:51`). An approved host is a different grant from a cohort assignment, and nothing links the two.

Clients: `adminLabHosts`, `adminDecideLabHost` (`fe/lib/api.js:2572-2575`).

---

#### 8. The frontend consoles today

##### 8.1 `fe/pages/admin/AdminSpinoutLab.jsx` (834 lines)

- It is mounted standalone at `/admin/spinout-lab` (`fe/App.jsx:2814`, preview `:2819`), and as the `/admin?tab=lab-applications` tab inside the "Admin Console" title and dropdown (`fe/pages/AdminPage.jsx:48`, `:213-230`, `:238`).
- **The tab state is local** (`useState('applications')`, `:630`), so no tab has its own URL.
- Its two reads run in parallel. Unreadable is set only when a request throws (`:639-651`).

| Tab (button lines) | Component | Client calls (fe/lib/api.js) |
|---|---|---|
| Applications, with the pending badge counted over the ≤200 rows it fetched (`:713-724`, `:686`) | `ApplicationsSection` (`:155-`) | `adminSpinoutApplications` `:2547`; `adminSpinoutDecide` `:2549-2550`. Uses `window.confirm` and `alert` (`:203-215`). |
| Participants (`:725-736`) | `ParticipantsSection` | `adminSpinoutParticipants` `:2553`; `adminImpersonate` with a `window.prompt` reason (`:661-683`) |
| Timing (`:737-745`) | `AdminCohortTiming.jsx` | `adminCohortTimeline` and `adminCohortReview` (`AdminCohortTiming.jsx:54`), `adminCohortGrace` and `adminCohortOverride` through prompts (`:76-88`); api.js `:2591-2594` |
| Cycles (`:746-754`) | `AdminCohortApplications.jsx` | `adminCohortApplications`, `…AppNotifications`, `…AppEvents` (`:103-105`); decide, interview, force-proceed and settings through prompts (`:129-157`); api.js `:2595-2603` |
| Certificates (`:755-763`) | `AdminSpinoutCertificates.jsx` | `spinoutCertificateList`, … (api.js `:1078-`) |
| Office-hours hosts (`:764-772`) | `AdminLabHosts.jsx` | `adminLabHosts` (`:112`), `adminDecideLabHost` (`:124`) |
| 83(b) review (`:773-781`) | `AdminSection83bReview.jsx` | `fe/lib/api/section83bReview.js:11-16` |
| Formation orders (`:782-790`) | `AdminFormationOrders.jsx` | `fe/lib/api/adminIncorporations.js:6-11` |

`adminSpinoutAdmit` (`api.js:2543-2544`) and the advisor-cohort clients are not called from this console.

##### 8.2 `fe/pages/admin/AdvisorCohortAssignments.jsx` (263 lines)

- Route: `/admin/advisor-cohorts`, `guard(['admin'])` (`fe/App.jsx:3287`). It sits in `AdminBoardFrame` (`:257-262`).
- **Reads:**
  - `adminAdvisorCohortAssignments` (`:51`)
  - `adminAssignableAdvisors` (`:62`)
  - `adminCohortTimeline` for the cycle picker (`:66-68`)
- **Writes:**
  - `adminAssignAdvisorCohort` (`:85`)
  - `adminEndAdvisorCohortAssignment` (`:103`), with **no confirmation step** (`:100-109`)
- Clients are in `fe/lib/api.js:2584-2589`.
- **Display:**
  - Columns: Advisor (name and email), Cohort, Assigned, State (`:203`).
  - The note is not shown.
  - Ended rows are hidden behind "Include ended" (`:46`, `:111`).
  - A stale role is flagged "access is already refused, but the row is still open" (`:211`, `:225-230`).
  - A cycle outside the 12 the timeline returns shows as "Cycle #id" (`:218`).
  - `founders_notified` is ignored.
- The page title is "Advisor cohort access" at 18 px (`:116`).

##### 8.3 `fe/pages/admin/HeldPrograms.jsx` (81 lines)

- The card says "Also an Approvals lane" (`:62`), which is false against `approvalSources.ts:273`. `fe/lib/adminPlacement.js:72-73` makes the same claim.
- The advisor card's reason comes from `no_queue` (`:22`, `:64`).
- The cohort count is `laneOf(hq,'cohort')` (`:21`, `:54`).
- The applications card has no count (`:44`).

##### 8.4 Client modules

**No module under `fe/lib/api/` covers cohorts, the Lab, lab hosts or cohort assignments.** I ran `grep -rlin "cohort\|spinout\|lab-host\|labhost" frontend/src/lib/api` and it returned nothing (exit 1). Every client above is in `fe/lib/api.js`.

Tests that pin this surface:
- `cloudflare-worker/test/cohort_advisor_notice_d492.test.ts`
- `cloudflare-worker/test/advisor_stores.test.ts`
- `cloudflare-worker/test/branch_freeze_admin_acts_d260.test.ts`
- `cloudflare-worker/test/cohort_applications.test.ts`
- `cloudflare-worker/test/lab_hosts_d377.test.ts`
- `frontend/test/advisor_cohorts.test.mjs`

---

#### 9. Canvas boards PG4, PG5, PG6 against the code

The grid captions are `grid:48-50`. Board composition: PG4 `dc:475`, PG5 `dc:476`, PG5s `dc:492`, PG6 and PG6d `dc:477`. Phone variants: PG20b `dc:506`, PG20c `dc:507`.

##### PG4 · Overview · Mentor cohort access

| Block (dc line) | Draws | Source today | Status | Now, or the honest placeholder |
|---|---|---|---|---|
| Breadcrumb "Programs › Mentor cohort access" and the tab hrefs `/admin/programs/mentor-cohorts/...` (`dc:471`, tabs `dc:470`) | Navigation | Frontend only. No such route exists; today's page is `/admin/advisor-cohorts` (`App.jsx:3287`). | N (frontend) | Build the route and redirect the old one |
| Moved notice (`dc:475`, `MOVED` `dc:272`) | "Advisor cohort access is now Mentor cohort access, under Programs." | Frontend only | N (frontend) | Show it on arrival from `/admin/advisor-cohorts` |
| Title and line (`dc:371`) | Static copy | — | E (copy) | — |
| Pill "Live" (`dc:371`) | Program status | No program registry (finding 7) | **N** | Static "Live" until a registry lands |
| Pill "Granted to your studio" (`dc:371`) | Grant state | No grant store (finding 7; #2376) | **N** | On HQ, "HQ-held", static |
| Facts strip (`dc:371`) | "Who: Advisors · Join: Assigned by an admin · Cycle: monthly cohorts of four weeks" | It matches the code: `advisors.ts:2297-2299`; admin-only POST (`:2998`); `cohortTiming.ts:4-7` | E (copy) | NOW |
| Tabs "Queue [0]" (`dc:470-471`) | Count 0 | There is **no queue**: `NOT_LANED` (`approvalSources.ts:273`) | **W** | Do not draw `[0]`. Show "No queue" with the `no_queue` reason, or drop the tab for this program. |
| Tabs Terms and Settings | Participant terms; program settings | No store for either | N | The tab says it is not recorded |
| Tab Activity | — | See "Recent activity" below | N | — |
| "Assign a mentor" button | Opens PG6d | `POST /advisors/admin/cohort-assignments` | E | NOW. Still role-only (finding 1). |
| ⋯ Pause program (Super Admin) | — | No pause store | N | Omit, or explain why it is not possible |
| ⋯ Download (CSV) | — | No export route (`grep -n "export" advisors.ts` finds no cohort export) | N (server); P (client) | A CSV built in the browser from the list read, at most 500 rows |
| Tile "Active mentors [6]" (`dc:372`) | Count | List read: distinct `advisor_user_id` where `is_active` and `advisor_role==='advisor'` | E (derived) | NOW |
| Tile "Cohorts covered [3] of [4]" (`dc:372`) | Ratio | Assignments plus timeline cycles (`status` scheduled or active, not `app_status` postponed) | P | Needs a stated denominator. The timeline returns only 12 cycles. |
| Tile "Founders hidden from a mentor [2]" (`dc:372`) | Count | **None** (finding 2) | **N** | Show "Not recorded" until a counts-only read exists |
| Tile "Ended this period [1]" (`dc:372`) | Count | `unassigned_at` of ended rows | P | A re-assigned pair loses its earlier end date (§6.4). Program pages have no period control, so the period needs defining. |
| Chart "Mentors per cohort" (`dc:373`) | Bars per cohort, "[2] mentors · [14] founders", amber "None" | Mentors from the list read. Founders: **no single definition** (finding 4). The options are timeline `participant_count` (0 before activation), `company_week_status` membership (0 in Week 1), or approved and activated applicants from `/admin/cohort/applications`. | P / **W** if "founders" is unlabelled | Mentors NOW. Founders only with an agreed definition and label. |
| Needs you · "[Dec 2026] starts in [5 days] with no mentor" (`dc:374`) | Row with Assign | Cycle `start_at` and `app_status` from the timeline, plus the list read | E (derived) | NOW. Skip postponed cycles. Only the current month and the next two exist (§4.2). |
| Needs you · "[Name] is no longer an Advisor, but their access is still on" (`dc:374`) | Row with End access | `advisor_role` against `is_active`. Today's page already computes this (`AdvisorCohortAssignments.jsx:211`). | E | NOW. **Fix the copy**: reads are already refused (`advisors.ts:2421-2423`); only the row is open. |
| Card "Office-hours hosts · [9] approved · [2] waiting" (`dc:375`) | Two counts and a link | `GET /api/admin/lab-hosts`, whose `counts` ignore the filter (`lab_hosts.ts:216-221`) | E | NOW. The counts cover every capacity (investor, advisor, partner), not only mentors. **The "Open Spin-Out Lab › Hosts" deep link does not exist**, because the tab is local state (`AdminSpinoutLab.jsx:630`); it waits on #2374's address. |
| Card "Recent activity" (`dc:376`) | Last five events | Assign and end write no audit (finding 1). Opt-outs keep only the latest stamps per pair (`cohortAdvisorAccess.ts:229-238`). Role changes are in `activity_logs` `role_changed` with the admin's name in the text (`wk/routes/admin.ts:2261`). | **N** (P from the `assigned_at` and `unassigned_at` of current rows only) | "Not recorded" until assign and end are audited and a read exists |

##### PG5 · How it runs (playbook) · Mentor cohort access

**Is there a store? No.** No playbook, section, version, lock or "Set by HQ" store exists (finding 7). Every section is static copy today. The table checks whether each sentence is true.

| Section (dc line) | Copy | Is it true against the code? | Status |
|---|---|---|---|
| Table of contents (`dc:378`, `:388`) | 11 sections | Frontend | E (frontend) |
| Purpose (`dc:377`) | — | — | Copy |
| Who it is for (`dc:377`) | "Advisor role … no profile needed" | True (`mig/206:35-39`; `advisors.ts:2948-2951`) | E |
| How people join (`dc:377`) | "An admin assigns one advisor to one cohort" | True (`advisors.ts:2998-3056`) | E |
| What a mentor sees (`dc:377`) | Names, emails, weekly status, who acted, Lab dates | True (`cohortAdvisorAccess.ts:5-11`). The calendar also shows names from sessions founders booked with that advisor directly. | E |
| What founders can do (`dc:377`) | Told at start and end; can hide | True, with two caveats. (1) A founder is told, and can hide, only once a `company_week_status` row exists (finding 3). (2) No end notice is sent when the advisor's role changes (`:30-34`). | P (caveats) |
| The cycle (`dc:382`) | Four week blocks, "America/New_York", "fixed by the Lab's calendar" | Windows from `GET /admin/cohort/timeline` (`admin_cohort.ts:57-59`). The time zone is `cohortTiming.ts:28`. The deadline is stored as day 8 at 00:00 ET, which the canvas draws as "day 7 23:59" (`:69-85`). It is fixed: nothing updates it (finding 6). | E |
| What you do (`dc:383`) | Checklist | No checklist store. "Check hidden founders" has no read (finding 2). | N (static copy) |
| Terms and contracts (`dc:384`) | "Advisor agreement · [Template name]" and Open in Contracts | Advisor templates exist in the library (`wk/routes/admin_contracts.ts:350-351`, "Advisor NDA (Axal)" and "Advisor Engagement Disclaimer"; `mig/085_seed_legal_templates.sql:1720`, FAST (Advisor)). **Nothing links a template to this program.** | N (link only) |
| Rewards (`dc:385`) | "None set." | True: no reward exists | E (copy) |
| How we measure it (`dc:386`) | Mentors per cohort; founders hidden; sessions booked with a mentor | Mentors per cohort can be derived. Founders hidden is N. Sessions per cohort mentor: no admin read; `advisor_bookings` has only org-wide counters (`wk/services/telegramAggregator.ts:109`). | P / N / N |
| Admin tools (`dc:387`) | Assign, end, approve hosts, edit playbook | Assign, end and hosts exist (§6.1, §7). "Admin and Super Admin" is true, because the check is role-only. Edit playbook is N. | E ×3, N ×1 |
| Locks and "Set by HQ" (`dc:380`); PG5s "Version [3] · edited [2 Oct]", "Publish changes", per-section Edit (`dc:492`) | — | No store | **N** |

##### PG6 · People tab, and PG6d Assign lightbox

| Block (dc line) | Draws | Source today | Status | Notes |
|---|---|---|---|---|
| Toolbar search, Cohort, Status (Active, Ended), "Role changed", Sort (Assigned, Cohort, Name) (`dc:390`) | Filters | List read, at most 500, newest assigned first (`advisors.ts:2982-2983`) | P | Client-side only. No server filters, sort or paging. |
| Footer "1–25 of [N]" (`dc:390`) | Count and pages | No total from the server | P | Client total over ≤500 rows |
| Mentor column: name, role pill, amber "Not an Advisor now" (`dc:389-390`) | — | `advisor_name`, `advisor_role` (current) | E | — |
| Cohort "[Nov 2026] · week 2", "· ended", "· not started" (`dc:389`) | Label and week | Joined client-side to timeline cycles, windows and status | P | The timeline covers only the latest 12 cycles; anything older shows "Cycle #id" (`AdvisorCohortAssignments.jsx:218`) |
| Assigned "[3 Oct] by an admin" | Date | `assigned_at`. `assigned_by_admin_id` is stored but not returned. | E | "by an admin" is copy. Matches the no-names rule. |
| Ended "—" or a date | Date | `unassigned_at` | E | A reactivated pair loses its previous end (§6.4) |
| Founders visible "[12] of [14]" (`dc:389`) | Two counts | **None** | **N** | Membership minus active opt-outs, per row. Counts only. |
| Note (`dc:389`) | Text | `note` is returned (`advisors.ts:2978`) but not shown today | E | NOW |
| ⋯ End access | Write | `DELETE …/:id` | E | Today it ends **with no confirmation**. The canvas rule needs a dialog. |
| Ended rows kept, muted; "Ended access stays on record." (`dc:390`) | — | Soft end (`mig/206:26-29`) | E | True for the latest episode of each pair only |
| PG6d Mentor search, advisors only, "No advisor profile yet" (`dc:391`) | Picker | `GET …/assignable`: role advisor, `has_advisor_profile`, at most 500 | E | Client-side search |
| PG6d Cohort picker "[Dec 2026] · 1–28 Dec · [11] founders" (`dc:391`) | Dates and a founder count | Timeline `start_at` and `end_at` (day 29 at 00:00, so "1–28" is right) and `participant_count` | P / **W** | For a cohort that has not started, `participant_count` is 0 (`admin_cohort.ts:60-63`). "[11] founders" needs the applications read's approved count, or a stated definition (finding 4). |
| PG6d Note | Input | ≤1000 chars (`advisors.ts:3045`) | E | — |
| PG6d line "This lets [Name] read the names and email addresses … Founders are told and can hide themselves." (`dc:391`) | Copy | True (`cohortAdvisorAccess.ts:110-118`), with the Week-1 caveat (finding 3) | P | The response's `founders_notified` could say "[N] founders told". But a failed sweep reads 0 (`advisors.ts:3050-3053`), so 0 is **W** until the Worker returns null on failure. |
| PG6d Back and Assign | Write | `POST` | E | Errors: 400 not an advisor, 404 no user or cycle. Not frozen, not suspension-gated (finding 1). |
| PG20b and PG20c phone (`dc:506-507`) | Same data | Same | as above | — |

---

#### 10. What the Worker would need for PG4–PG6 (none of it exists)

1. **Freeze, suspension and audit on the four mentor-access routes.**
   - Use `requireAdmin` instead of role-only: `advisors.ts:2934`, `:2966`, `:3000`, `:3065`.
   - Decide whether assign and end call `requireBranchNotSuspended`. The Lab's precedent freezes admissions (D260, `admin.ts:1211-1216`).
   - Add `logAdminAction` on assign and end so an Activity read has rows.
2. **Counts per assignment and per cohort**, added to the list read or as a new admin read, guarded by `requireAdmin`. Counts only, never names:
   - `founders_in_cohort`
   - `founders_hidden` (active `cohort_advisor_optouts` ∩ membership)
   - `founders_visible`
3. **One definition of a cohort's founders**, shared by the chart, the dialog and the mentor reads. A Lab-owner decision is needed on whether activated founders count before their first decided week (finding 3). The 206 rule says the Lab keeps sole authority (`mig/206:12-18`).
4. **`founders_notified: null`** when the notice sweep fails, not 0 (`advisors.ts:3050-3053`, `:3076-3079`).
5. **A program activity read** covering assign, end, hide and role changes, phrased as "an admin" or "HQ".
6. **Server paging, total and filters** on the list read if it can pass 500 rows.
7. **The registry, playbook store, grant state and pause** that drive the pills, the Terms, Settings and Queue tabs, and PG5s. This is #2371's own Backend list, plus #2376 for grants.
8. Optional: a **CSV export route**. One can also be built in the browser.

Outside PG4–PG6, but on the same reads:
- The Lab's two reads that answer `[]` should report failure (finding 5).
- `grace`, `override`, `settings`, `force-proceed` and the lab-host decision are not suspension-gated (§2). Decide each one.

---

#### 11. Line drift: issue #2371's cites (537f646a3f) against HEAD

| Issue cite | HEAD |
|---|---|
| `wk/index.ts:908` (cohort mount) | `wk/index.ts:920` |
| `wk/index.ts:1081` (glance) | `:1094` |
| `wk/index.ts:1303` (lab hosts) | `:1327` (applicant side `:1326`) |
| `wk/index.ts:1306` (advisors) | `:1330` (alias `/api/mentors` `:1331`) |
| `wk/services/studioGlance.ts:210` (`no_queue`) | `:208` |
| `fe/lib/api.js:2542` / `:2548` / `:2567` / `:2579-2584` / `:2586` / `:3647` | `:2547` / `:2553` / `:2572` / `:2584-2589` / `:2591` / `:3652` |
| `fe/App.jsx:2721` / `:2716-2718` / `:2754` / `:2806` / `:2816` / `:3273` | `:2725` / `:2720-2722` / `:2761` / `:2814` / `:2824` / `:3287` |
| `fe/lib/railPages.js:458` | `:460` |

Unchanged at HEAD:
- `wk/routes/admin.ts:1190`, `:1209`, `:1385`
- `admin_cohort.ts:49`, `:238`, `:598`
- `advisors.ts:2932`, `:2964`, `:2998`, `:3063` and the role-check pairs
- `wk/auth.ts:523-528`
- `approvalSources.ts:24-27`, `:132-142`, `:273`
- `cohortApplications.ts:284`, `:378`; `cohortTiming.ts:499`, `:543`
- `cohortAdvisorAccess.ts:14-20`
- `lab_hosts.ts:198`
- migrations 155:4, 156:11 and :22, 157:25-37, 206:41-54
- `AdminSpinoutLab.jsx:712-791`, `:768`, `:213`, `:215`, `:661-668`
- `AdminPage.jsx:213-230`, `:238`
- `HeldPrograms.jsx` (81 lines; `:21`, `:22`, `:44`, `:54`, `:60`, `:62`)
- `heldFigures.jsx:15`, `:39`
- `adminStudioOverview.js:357-362`
- `sidebarConfig.js:228-229`
- `adminPlacement.js:72-73`
- `railPages.js:279`, `:387`

All four of the issue's "Mentor-access writes skip the freeze" cites still hold at HEAD.

### Referral partners, custom terms, Refer & Earn, strategic referrals — the Worker reads and writes (2026-10-24)

**This is a snapshot, not a spec.** It was read on `claude/spinout-lab-workspace-wuyyqd` at HEAD **`24136bf`**. The task named `6205ee6`. The two commits since then (`6c355ff`, `24136bf`) change only seven Pitch-studio files (`git diff --stat 6205ee6 24136bf`), so every line cited here is the same at both. Nothing was checked against production, and nothing was edited.

**Path prefixes.**
- `wk/` = `cloudflare-worker/src/`
- `fe/` = `frontend/src/`
- `mig/` = `cloudflare-worker/sql/migrations/`
- `dc:` = `design/incoming/Programs Page.dc.html`
- `bd:` = `design/incoming/Programs · Boards.dc.html`
- `base:` = `cloudflare-worker/sql/schema_baseline.sql`

**Notation.**
- **E** = exists.
- **P** = partly exists.
- **N** = does not exist.
- **W** = the figure or sentence would be wrong if drawn today.
- "SA" = Super Admin.

---

#### 0. Key

##### 0.1 Reads an admin can call today

| Id | Read | Guard | Shape and limits | How it fails |
|---|---|---|---|---|
| **R1** | `GET /api/network/admin/commission-rules` (`wk/routes/network.ts:582-592`) | `requireSuperAdmin` (`:583`) | Every `commission_rules` row plus `updated_by_name`, ordered by key. No paging. | No try/catch, so a D1 error comes back as a 500 `{detail:'Internal server error'}` (`wk/index.ts:1466-1487`). |
| **R2** | `GET /api/network/admin/commissions` (`:570-580`) | SA (`:571`) | `c.*` plus `email`, `name`, `payout_id`. **Newest 500, no total, no filter** (`:577`). Carries no referral code. | 500, as above. |
| **R3** | `GET /api/network/admin/payouts` (`:935-951`) | SA (`:936`) | `p.*` plus `processed_by_name`, `commission_ids` (`:707-721`), `bank_match` (`:694-705`). Newest 200 (`:947`). | 500, as above. |
| **R4** | `GET /api/refer-earn/admin/submissions?status&category&limit` (`wk/routes/refer_earn.ts:256-283`) | `requireAdmin` (`:257`) | `toWire` rows plus `referrer_email`, `referrer_name`. `limit` **defaults to 100, at most 200** (`:262`). Newest first (`:274`). No offset, no total, no search, no referrer role, no history. | No try/catch, so 500. |
| **R5** | `GET /api/admin/studio/glance`, Approvals lane `referrals` (`wk/routes/admin_studio_glance.ts:30-37`, `requireAdmin` `:32`; SQL `wk/services/approvalSources.ts:114-130`) | admin | `{key:'referrals', label:'Referrals', count, oldest_at}` (`:429-465`). Counts `submitted`, `under_review` and `more_info_needed`. `oldest` is `MIN(created_at)`. | A failed lane reads `count:null` (`:465`) and the other lanes still answer. |
| **R6** | `GET /api/admin/credit-rules` (`wk/routes/admin_credit_rules.ts:64-72`) | SA (`:66`) | `{rules:[{key,kind,credits,usd_value_cents,active,updated_by,updated_at}]}` | `mapError` |
| **R7** | `GET /api/admin/credit-rules/grants?user_id=` (`:74-112`) | SA (`:76`) | Rule grants and manual lines, with revoke state. Newest 200 (`:89`, `:99`). | `mapError` |
| **R8** | `GET /api/perks/admin/credits/:userId` (`wk/routes/perks.ts:804-828`) | SA (`:806`) | Balance, 500 ledger lines and `truncated`. | `refuse`/`mapError` |
| **R9** | `GET /api/admin/partners/deals?status=` (`wk/routes/admin_partners.ts:293-312`) | `requireAdmin` (`:294`) | `partner_deals` rows, including the `PART-` `referral_code` (`:299`) and `redemptions_count`. One status per call, default `active`. Newest 200 (`:306`). | 500 |
| **R10** | `GET /api/admin/contracts/partner-deals` (`wk/routes/admin_contracts.ts:1187-1225`) | `requireAdmin` | Paged `{items,total}`, filtered by `deal_type`, `status` and `q`. | 503 `partner_deals_unreadable` (`:1205-1208`) |
| **R11** | `GET /api/admin/contracts/published-templates` (`:51-52`) | `requireAdmin` | The templates a send may use. | — |

These member reads only ever return the caller's own rows, so an admin sees only their own:
- `GET /api/refer-earn/overview`, `/submissions` and `/submissions/:uid` (`refer_earn.ts:94-179`; the owner scope is in `wk/services/referralSubmissions.ts:259-269`).
- `GET /api/network/referral/list` (`network.ts:496-513`).
- `GET /api/network/commissions/me` (`:548-568`).

##### 0.2 Writes

| Id | Write | Guard | Body, response and refusals |
|---|---|---|---|
| **W1** | `PATCH /api/network/admin/commission-rules/:key` (`network.ts:614-682`) | SA (`:615`) | Any of `amount_cents`, `percentage_bps`, `description`, `active`. After the edit a rule must pay **exactly one** of a flat amount or a share (`:655-660`). Logged before and after (`:668-677`). Refusals: 400 `invalid_body`, `invalid_amount`, `invalid_share`, `invalid_description`, `description_too_long`, `invalid_active`, `rule_amount_ambiguous`; 404 `rule_not_found`. **No route creates a rule.** |
| **W2** | `PATCH /api/network/admin/payouts/:id/process` (`:858-933`) | SA (`:859`) | `process`, `complete` or `fail`. 409 `payout_not_open` (`:875-878`). `fail` reopens the payout's commissions (`:898-930`). `complete` moves no money (`:889`). |
| **W3** | `PATCH /api/refer-earn/admin/submissions/:uid` (`refer_earn.ts:285-304`) | `requireAdmin` (`:286`), then `requireBranchNotSuspended` (`:288`) | `{status, note, rewardLabel, nextStep, fitNotes}`. Returns `toWire` plus `history`. Refusals: 404 `not_found`, 400 `bad_status` (`referralSubmissions.ts:529`, `:536`). |
| **W4** | `POST /api/refer-earn/strategic-access` (`refer_earn.ts:244-250`) | `requireAuth` | The **only** writer of `referral_strategic_access` (`referralSubmissions.ts:619-632`). |
| **W5** | `PUT /api/admin/credit-rules/:key` (`admin_credit_rules.ts:152-200`) | SA | Needs a reason of at least 10 characters (`:48-57`). Credits 0 to 100,000. The dollar value follows the credits (`:168-178`). 404 `rule_unknown`: **it cannot create a key** (`:159-162`). |
| **W6** | `POST /api/admin/credit-rules/grants/:id/revoke` (`:114-130`) | SA | Needs a reason. 404 or 409 `would_overdraw`. |
| **W7** | `POST /api/perks/admin/credits` (`perks.ts:783-800`) | SA (`:785`) | `manualAdjust` (`wk/services/creditGrants.ts:312-368`). |
| **W8** | `POST /api/admin/partners/invitations` (`admin_partners.ts:48-95`) | `requireAdmin` (`:49`) | `allowed_deal_types` is required (`:54-63`). Audited (`:88-91`). |
| **W9** | `POST /api/admin/partners/deals/:id/terminate` (`:314-…`) | `requireAdmin` (`:315`) | Needs a reason (`:319`). Acts only on an `active` deal. |
| **W10** | `POST /api/admin/contracts/envelopes/preview` and `…/send` (`admin_contracts.ts:234-241`; handler `:160-233`) | `requireAdmin` | Sends a published template to a named recipient (§4). |
| **W11** | `POST /api/admin/partner-settlements` and `PATCH`/`DELETE` (`wk/routes/partner_settlements.ts:57-106`); `POST …/:uid/issue` and `…/void` (`:108-113`) | Drafts: HQ admin (`:16-20`). Issue and void: SA plus the step-up bar (`:112-113`). | The only "admin drafts, Super Admin approves" pattern in this area (D713). |

These run internally and have no route of their own:
- `fireCommissionEvent` (`network.ts:149-200`)
- `firePurchaseCommission` (`:213-287`)
- `attachReferral` (`:414-467`)
- `fireCompoundingBonuses` (`wk/routes/networkfx.ts:131-147`)
- `grantCredits` (`wk/services/creditGrants.ts:134-230`)
- `redeemPartnerReferralCode` (`wk/services/partnerDeals.ts:477-545`)
- `activatePartnerDealOnSignature` (`:195-…`)

---

#### 1. Guards

| Guard | What it checks | Refused with | Cite |
|---|---|---|---|
| `requireAuth` | The caller is signed in. | 401 `Unauthorized` | `wk/auth.ts:517-521`; `wk/util/authErrors.ts:82` |
| `requireAdmin` | `role === 'admin'`, then the compliance freeze. The freeze applies only to writes, never on a branch, and never to the Super Admin. | 403 `Admin required`; **423 `admin_frozen`** | `auth.ts:523-528`, `:568-590`; `wk/index.ts:1473` |
| `requireSuperAdmin` | `requireAdmin`, plus not a branch, plus `is_super_admin = 1`. | 403 `HQ only` on a branch; 403 `Super admin required` | `auth.ts:669-672`, `:692-697`; `authErrors.ts:87-93`; `wk/util/branch.ts:45` |
| `requireHqAdmin` | `requireAdmin` plus not a branch. Any HQ admin passes. | 403 `HQ only` | `auth.ts:704-708` (`partner_settlements.ts:16-20` has its own copy) |
| `requireHqAuthoring` | `requireAdmin` plus not a branch. **It checks the deployment, not the elevation:** a plain HQ admin may author templates. | 403 `Changing a template is a Content submission` | `auth.ts:710-729`; `util/branch.ts:53` |
| `requireBranchNotSuspended` | Refuses only on a branch whose licence is suspended. Does nothing on HQ. An unreadable licence reads as not suspended. | 423 | `auth.ts:752-795` |
| `requireSuperAdminWriteBar` | A TOTP session, a fresh step-up, then `requireSuperAdmin`. | 403 | `auth.ts:1054-1058` |

A branch is its own deployment and its own database, named by `BRANCH_CODE` (`util/branch.ts:87-93`).

**Who passes, by area, today.**

| Area | Read | Write |
|---|---|---|
| Commission rules, commissions, payouts (`network.ts`) | Super Admin, on HQ only | Super Admin, on HQ only |
| Refer & Earn queue | Any admin, on HQ or a branch, each reading its own database | Any admin; 423 on a suspended branch |
| Strategic access | **Nobody** | Only the member's own request |
| Credit rules, grants, revokes, manual credits | Super Admin | Super Admin |
| Contract templates | Any admin may list, preview and send | Authoring is `requireHqAuthoring` (`admin_contracts.ts:64`, `:1810`, `:1905`, `:1926`) |
| Partner deals and invitations | Any admin | Any admin |

**Two stale comments in the frontend.**
- `fe/pages/admin/AdminCommissions.jsx:20-25` says three of the page's reads are `requireAdmin`.
- `fe/App.jsx:2696-2699` says the route is "never `hqOnly`".

The Worker contradicts both (`network.ts:571`, `:583`, `:936`), and so does the route itself (`hqOnly`, `fe/App.jsx:2700`). The page behaves correctly anyway: it fetches only for a Super Admin (`AdminCommissions.jsx:554-559`) and shows a plain admin a sentence instead (`:623-635`).

The canvas's "HQ sets the standard rules" means the **Super Admin** today, by elevation, not "any HQ admin" as `requireHqAuthoring` would allow.

---

#### 2. `wk/routes/network.ts` (953 lines) — the commission ledger

##### 2.1 Tables

**`referrals`** (`base:4035-4043`; runtime copy `network.ts:25-33`)
- One row per referred user (`referred_id UNIQUE`).
- `status` is written as `'pending'` (`:426`) and `'converted'` (`:180`). Nothing else writes it (`rg "UPDATE referrals"` finds only `:180`).

**`commissions`** (`base:977-989`; `network.ts:36-50`)
- Unique on `(user_id, source_type, source_id)` (`:50`).
- Status is `accrued` (`:177`), `paid` (`:834`) or `reversed` (`wk/services/referralCommissions.ts:108`).
- **No column for a studio, segment, terms, cap or trigger.**

**`payouts`** (`base:3454-3466`; `mig/393_partner_earnings.sql:42-45`; `mig/409_payout_destination_and_leaderboard.sql:28-29`) and **`payout_commissions`** (`mig/393:34-40`).

**`commission_rules`** (`base:967-975`; `mig/393:47-48`)
- Keyed only by `rule_key` (`network.ts:69-77`).
- **The five rules are seeded only at run time** by `INSERT OR IGNORE` (`:99-110`). `rg "INSERT[^;]*commission_rules"` over `sql/` and `src/` finds only `network.ts:108`.

**`referral_chains`** (`base:3932`; runtime copy `wk/routes/networkfx.ts:23-33`).

**`referral_attributions`** (`mig/100`; `mig/287:118-130`; `wk/services/referralAttribution.ts:23-40`).

**`ensureSchema` runs DDL on the first request in every isolate, production included,** and swallows every error (`network.ts:14-112`, `:96`). Compare `referralSubmissions.ts:118-120`, which skips this in production.

**Known gap.** `commissions.reversed_amount_cents` and `reversed_at` are added only in dev and preview (`referralCommissions.ts:39-49`). No migration declares them; this is already recorded in `scripts/runtime-schema-declared-baseline.json:33-40` (D359). Read as the code stands, the clawback `SELECT` in production throws, the `.catch(() => null)` (`:81`) turns that into `no_commission` (`:83`), and a refunded purchase keeps its commission. Any "Commission accrued" figure inherits this.

##### 2.2 Two separate referral-code systems

**(a) The member code, `users.referral_code`.**
- A 6-character code (`wk/services/referrals/codes.ts:8-44`), minted on first read for **any** signed-in account.
- Two different minters exist:
  - `network.ts:119-145`, which rotates legacy `AXAL-` codes (`:129-143`).
  - `refer_earn.ts:61-73`, which does not rotate them.
- At signup, `wk/routes/auth.ts:472-473` calls `attachReferral` (`network.ts:414-467`). That writes a `referrals` row and builds the L1–L3 chain (`networkfx.ts:111-124`).

**(b) The partner-deal code, `PART-XXXXXXXX`** (`partnerDeals.ts:169-178`).
- Minted when a partner deal's e-sign envelope completes (`:274-297`; hook `wk/routes/esign.ts:1585-1593`).
- At signup, `wk/routes/auth.ts:460-470` calls `redeemPartnerReferralCode` (`partnerDeals.ts:477-545`). That grants subscription tiers and writes `partner_referral_redemptions` (`:530`).
- **It writes no `referrals` row.** `fireCommissionEvent` returns at `network.ts:159-160` when there is no `referrals` row, so **a `PART-` signup never accrues a commission.**

**No admin read exposes a member's `users.referral_code`.** `rg referral_code wk/routes/admin*.ts` finds only the `PART-` code (`admin_partners.ts:281`, `:299`).

The canvas's code format `[LIS-EV-07]` matches neither system.

##### 2.3 The commission engine

**`fireCommissionEvent`** (`:149-200`)
- Finds the user's referrer (`:159`).
- Looks up the rule by key, if active (`:163`).
- Computes a flat amount, or basis points of the amount passed in (`:167-172`).
- Inserts idempotently (`:176-179`) and marks the referral converted (`:180`).
- Pays compounding bonuses (`:193-198`): L2 50%, L3 25%. These are hard-coded (`networkfx.ts:15-17`, `:131-147`), carry `source_type <type>_compound`, and are not in `commission_rules`.

**Only one caller exists:** `wk/routes/kyc.ts:378`, with `referral_kyc_approved`. A search for `referral_deal_funded`, `referral_lp_onboarded`, `referral_spinout` and `referral_partner_fee` over `cloudflare-worker/src`, `frontend/src` and `backend/app` finds only the seed lines (`network.ts:101-104`). **Four of the five standard rules can be edited and switched on, but no event ever pays them.**

**There are no per-person terms.** The rule lookup is by key alone (`:163`). Nothing reads a partner, segment, cap, date range, studio or sector.

**`firePurchaseCommission`** (`:213-287`)
- Called from the payment webhook (`wk/routes/billing.ts:1863-1889`). It fires only when the PaymentIntent carries `referral_code`, `referrer_user_id`, `price_id` and `user_id`, and the catalog product has `commission_pct` (`:1868-1872`).
- `/api/payments` stamps that metadata (`wk/routes/payments.ts:275-288`).
- **Event tickets build their PaymentIntent elsewhere,** with only `kind`, `event_id`, `registration_id` and `user_id` (`wk/services/eventTickets.ts:58-67`). So **a ticket sale never accrues a commission.**
- Purchases get no compounding bonuses.

##### 2.4 Payouts — what "paid" means

- **The partner chooses** the payout method (`stripe`, `wire` or `crypto`, `:770`) and the destination label and last four characters (`:731-748`), on each request. An admin cannot set either.
- The minimum is $10 (`:769`). A payout is in one currency (`:778-797`) and claims whole commissions, oldest first (`:802-814`), in one atomic batch (`:819-845`). A race returns 409 (`:848-850`).
- **`commissions.status = 'paid'` means a payout request claimed it, at request time** (`:834-836`; comment `:526-531`). It does not mean money moved.
- "Completed" is `payouts.status` (`:890-893`), set by a Super Admin click that moves no money (`:889`).
- Balances are `null` when a person holds more than one currency (`:532-546`).
- Error shapes are mixed: plain `{error}` strings (`:769-770`, `:800`, `:809`, `:814`, `:849`) and `refuse` codes (`:772`, `:787`, `:790`).

##### 2.5 The partner deal engine — the nearest existing "terms"

**Tables.** `partner_invitations`, `partner_profiles`, `partner_deals` and `partner_referral_redemptions` (`mig/028_partner_deals.sql:9-94`).

**Deal types.** `equity_partnership`, `services_partnership`, `deal_sourcing_revshare`, `capital_partnership` and `custom` (`partnerDeals.ts:22-35`). The proposals are fixed text built in code. For example, deal sourcing reads "5% of Axal fees … 10% of management fees" (`:118-133`); `custom` is at `:151-162`. They are stored as `proposal_json` (`mig/028:61`).

**Every type is signed on the `partner_services` template** (`wk/routes/partner_onboarding.ts:344`). None uses `partner_custom` or `finders_fee_intro_agreement`.

**States.** `proposed`, `awaiting_signature`, `active`, `terminated`, `expired`, `voided` (`mig/028:67`; `admin_partners.ts:320-324`). **There is no draft state and no HQ-approval step.**

**What a deal pays.** Tier grants only. No code computes a revenue share. Obligations are entered by hand as settlements (`partner_settlements.ts`; table `mig/477_mercury_personal.sql:36-58`).

---

#### 3. The admin commissions page (`fe/pages/admin/AdminCommissions.jsx`, 759 lines)

**Route.** `/admin/commissions`, `guard(['admin'], hqOnly(...))` (`fe/App.jsx:2700`; lazy import `:170`).

**Reads.** R1, R2, R3, and the take rate (`api.hqTakeRate`, `fe/lib/api.js:3465`). They are fetched only for a Super Admin (`:554-559`); a plain admin sees one card (`:623-635`). Clients are `fe/lib/api.js:2444-2449`.

**What it holds.**
- **Rule editor.** A radio for flat amount or share, a description, an "Active" checkbox, and a confirmation that lists before and after (`:64-127`). Save is at `:586-600`.
- **"New rule"** is drawn disabled, with the reason given (`:665`, rail `:649`).
- **Payout queue.** Open, Completed, Failed and All views (`:52-57`). A failure needs a reason (`:570-572`).
- **All commissions.** Client-side filters for status, source, period and search over the 500 rows (`:561-565`, `:717-745`). A meta line says "the newest 500 the route returns" (`:501`).
- **Honesty states.** Each block has `Unreadable` with its claim (`:138`, `:330`, `:463`); missing fields are `Unrecorded`.

**Tests that pin it.** `frontend/test/partner_earnings_d569.test.mjs` and `cloudflare-worker/test/partner_earnings_d572.test.ts`.

---

#### 4. Contract templates: Finder's Fee / Intro Agreement, and Partner Custom Deal (`wk/routes/admin_contracts.ts`)

**Registered doc types.**
- In `CONTRACT_DOC_TYPES`: `:259-275` (the two are at `:270-271`).
- Party roles: `partner_custom` is partner and Axal (`:306`); `finders_fee_intro_agreement` is investor, partner and Axal (`:309`).
- Titles, layer `gp`: `:357-358`.

**They are no longer stubs.** `mig/085:1671-1672` and `:1674-1675` seeded both with an empty body (`is_stub = 1`). Later migrations filled them:
- `mig/105` is a stub-gated upsert (`:3-4`; the Finder's Fee row is at `:220-226`).
- `mig/113` is an unconditional refresh (`:5-6`):
  - **Finder's Fee:** one economic field, `{{counterparty.fee_pct}}` of gross consideration, closing within 12 months (`mig/113:196`). Its merge fields are `["counterparty.fee_pct","governing_law"]` (`:221`).
  - **Partner Custom Deal:** its economics are equity, revenue share, carry and capital commitment (`mig/113:700`), with merge fields `partner.role`, `partner.equity_pct`, `partner.revenue_share_pct`, `partner.carry_pct`, `partner.capital_commitment`, `cap_table.vesting_schedule` and `governing_law` (`:723`).
- `mig/484` fills only an active row that is still empty (`:211-263`, `:715-765`).
- The repo files are `wk/templates/legal/finders_fee_intro_agreement_v1.md:17` and `wk/templates/legal/partner_custom_v1.md:15-19`.

So the issue's "seeded as a stub" is stale. Whether production holds the bodies was not checked.

**Neither template has** a flat amount, a cap per introduction, an overall cap, a start or end date, a studio, sectors, or a list of triggers.

**Sending one.**
- Preview, then send (W10). The template must be published (`wk/services/contractPublication.ts:22-23`); publishing is `requireHqAuthoring` (`admin_contracts.ts:63-64`).
- Every required field must be typed (`contractPublication.ts:37-44`, `:52-55`). The send must match the previewed hash (`admin_contracts.ts:196`).
- The optional `deal_id` points at the startup `deals` table (`contractPublication.ts:30-34`), **not** at `partner_deals` or any terms row.
- The clients are `fe/lib/api/contracts.js:51-52`. A template can also be previewed directly with `GET /templates/store/:slug/preview.pdf` (`admin_contracts.ts:1937`, `requireAdmin`).

**On signature, nothing ties a Finder's Fee envelope to a referrer or a rule.** The completion hook activates only `partner_deals` rows, matched by `envelope_id` (`wk/routes/esign.ts:1585-1593`).

---

#### 5. Refer & Earn: `wk/routes/refer_earn.ts` (306 lines) and `wk/services/referralSubmissions.ts` (655 lines)

##### 5.1 Tables (`mig/175_referral_submissions.sql`)

- **`referral_submissions`** (`:23-58`). Category CHECK at `:32-33`, status CHECK at `:42-47`. `reward_label` is **free text, deliberately not cents** (`:8-14`, `:48`). `fit_notes` is "Surfaced to the referrer" (`:50-52`).
- **`referral_submission_events`** (`:67-79`). It records `actor_user_id` (`:77`).
- **`referral_strategic_access`** (`:86-94`). Status is `requested`, `granted` or `declined`, with `decided_at`. There is **no `decided_by`** and no admin note.

##### 5.2 Categories, statuses and reward text

**Categories** (`referralSubmissions.ts:17-21`, `:71-98`):
- `startup`: open.
- `customer`: open; the canvas calls it "Platform user".
- `strategic`: invite-only.

**Reward text** is served to members (`refer_earn.ts:107-113`):
- Startup: "Milestone-based, on acceptance and formation." (`:80`)
- Platform user: "Platform credit, issued once matched and onboarded with a founder." (`:88`)
- Strategic: "Invite-only economics, negotiated case by case." (`:96`)

**Statuses.** There are eleven (`:23-28`), with labels (`:32-44`), a terminal set (`:47-49`) and a pre-verdict set (`:57-59`). **No transition rules exist:** an admin may set any status from any status (`:535-540`), including `reward_issued` with nothing issued.

##### 5.3 Member routes (all `requireAuth`)

- **Routes:** overview, list, create, detail, context, and CSV import. The import is capped at 50 rows (`:617`), and an `invite_only` refusal aborts the whole batch (`refer_earn.ts:237`).
- **Self-referral** is checked by email only (`:148-154`).
- **Explorers:**
  - The Worker admits any signed-in account (`requireAuth` at `:95`, `:130`, `:141`, `:173`, `:182`, `:203`, `:245`).
  - The frontend route admits only `admin`, `founder`, `partner`, `investor` and `advisor` (`fe/App.jsx:3493`). That excludes `exploring` (`wk/types.ts:604-606`).
  - **Every fresh signup lands in `exploring`** (`wk/routes/auth.ts:391`), so most referred newcomers cannot open `/referrals`.

##### 5.4 The admin queue (R4) and review (W3)

- **The default is 100 rows.** Referral review never passes `limit` (`fe/pages/admin/ReferralReview.jsx:52`), so **the page sees the newest 100, not 200.** The issue's "stops at 200" holds only for a caller that asks.
- **No admin read returns one submission or its timeline.** The only admin endpoints are `:256` and `:285` (`grep "refer\.(get|patch|post)\('/admin"`). History comes back only in a PATCH response (`:299-300`). The member detail route is owner-scoped (`:175`; `referralSubmissions.ts:264-266`).
- **Field caps:** reward label 120, next step 240, fit notes 2000 characters (`:541-543`); note 2000 (`:216`, `:508`).
- **Duplicate timeline rows.** An event is appended whenever `status` is present or a note is given (`:555-557`). Referral review always sends `status` (`ReferralReview.jsx:176`), so **every save that leaves the status unchanged still adds a duplicate timeline row the referrer sees.**
- **No audit and no notice.** There is no `logAdminAction` and no `notify` in either file (`grep -nE "notify|logAdminAction|activity_logs"` returns nothing). The referrer learns of a change only by opening their page.
- **The referrer's timeline never names the admin.** The read omits `actor_user_id` (`:273`).
- **What the referrer sees:** `reward_label`, `next_step`, `fit_notes` and the timeline notes (`toWire` `:635-655`; `fit_notes` `:649`).
- **Errors:** a `ReferralError` is answered as `{ok:false,error:{code,message}}` with its own status (`refer_earn.ts:80-88`). Anything else is rethrown to the global handler: 401, 403, 423 or 500.

##### 5.5 Strategic referrals

- **Request.** W4 upserts `'requested'` and overwrites the note on a repeat (`:629`). A member already `granted` or `declined` gets that state back and **can never ask again** (`:624-625`).
- **Gate.** A strategic submission without `granted` is refused 403 `invite_only` (`:462-468`).
- **Grant and decline: none.** There is no route, no service function and no Approvals lane.
  - `rg referral_strategic_access` over `cloudflare-worker/src`, `cloudflare-worker/sql/migrations`, `frontend/src` and `backend/app` finds only the CREATE (`referralSubmissions.ts:155`; `mig/175:86`), two SELECTs (`:409`, `:419`) and the INSERT (`:627`).
  - The only "granted" anywhere is a test stub (`cloudflare-worker/test/referral_submissions.test.ts:129-138`).
- **Approvals.** The only referral lane is `referrals` (`approvalSources.ts:114-130`). `NOT_LANED` (`:269-274`) does not mention strategic access.
- **Member page.** It sets `'requested'` locally on request (`fe/pages/ReferralsPage.jsx:692-693`) and hides locked categories (`:1089`).

##### 5.6 Rewards: none are paid

- "Platform credit, issued once matched" (`:88`) is granted by no code.
- `grantCredits` has three callers: `wk/routes/admin_ticket_reviews.ts:225`, `wk/services/bugBounties.ts:178`, and `wk/services/labMilestoneCredits.ts:80` and `:100`.
- No credit rule key exists for referrals (`mig/381:39-77`).

---

#### 6. Credits

- **The ledger** is `perk_credit_ledger`; `rule_key` was added in `mig/381:79`. A balance is `SUM(delta)` (`perks.ts:36-40`).
- **`credit_reward_rules`** (`mig/381:30-37`) seeds `bug_*`, `feature_shipped_*`, `task_approved`, `cap:bounty_monthly` and `lab:*`. **There is no referral key.**
- **How `grantCredits` grants:**
  - The amount is read from the rule, never passed (`creditGrants.ts:154-161`).
  - It is idempotent on `source_ref` (`:149-152`, `:201-205`).
  - The monthly cap applies only to bounty keys (`:61-63`, `:170-199`).
  - Every grant is audited (`:223-225`) and the member gets an inbox notice (`:226-228`).
  - Refusals come back as values, not throws (`:51-58`).
- **Staff never earn:** `admin` and `partner` are refused (`:43`, `:166-168`). **A partner-role referrer can never be paid in credits.**
- **`admin_credit_rules.ts`** is entirely Super Admin (`:14-18`). PUT edits only existing keys (`:159-162`), so **a new referral reward needs a migration seed first.** One credit is always US$1 (`:168-178`). The grants list has no paging and no total.
- **The page** is `/admin/credit-rules`, `hqOnly` (`fe/App.jsx:2805`). Clients are `fe/lib/api/creditRules.js:8-23` and `fe/lib/api/memberCredits.js:9`, `:11`.
- **Tests:** `cloudflare-worker/test/credit_grants_d540.test.ts`, `manual_credit_adjust_d608.test.ts` and `member_credits_d633.test.ts`.

---

#### 7. `fe/pages/admin/ReferralReview.jsx` (235 lines)

**Route and frame.** `/admin/refer-earn`, `guard(['admin'])` (`fe/App.jsx:2695`; lazy import `:168`). Framed by `AdminBoardFrame` with an Eadwyn note (`:228-235`).

**Look.** The title is `text-2xl font-bold` (`:68`), and the page uses raw gray and violet classes rather than tokens (`:64-124`).

**What it reads and filters.**
- One read: R4, without `limit` (`:52`).
- Status chips, without `draft` (`:20-24`, `:94-109`).
- **No category filter, search, sort, count or paging.**

**Rows.** Name and organisation, then category, status and referrer.
- **Bug:** the fallback prints `user ${r.uid}`, which is the submission's uid, not a user (`:136`).
- The context is shown inline (`:138-140`).

**The form.**
- It is inline, not a dialog: status, reward label, next step, fit notes and a timeline note (`:165-226`).
- It always sends every field (`:176`).
- Toasts report the result (`:153-154`, `:177-180`).

**Failure and empty states.**
- A failed read shows its message (`:111-115`).
- "Nothing in this queue." (`:121-124`) is truthful only within the newest 100.

**Links.** It links to `/admin/commissions` (`:77-83`), which a test pins (`frontend/test/partner_earnings_d569.test.mjs:840`).

**It has no strategic-access block.**

**Other places that name this page:**
- Sidebar Approvals `match`: `fe/sidebarConfig.js:227`
- Glance console map: `fe/pages/admin/adminStudioOverview.js:369`
- Placement map: `fe/lib/adminPlacement.js:85`
- Rail map: `fe/lib/railPages.js:270`

---

#### 8. The boards against the code

##### PG7 Referral partners (`dc:393-405`; caption `bd:51`)

| Block | Status | What exists, and what is missing |
|---|---|---|
| Pills "Partly built", "Granted to your studio" | P | "Partly built" is honest. No programme or grant store exists (#2376). |
| Facts "Join: By invitation"; "Who: Partners, investors, advisors, invited members" | **W** | Any signed-in account mints a code and earns under the standard rules (`network.ts:471-474`; `refer_earn.ts:94-98`). The invitation flow (W8) onboards people into partner deals, whose `PART-` codes earn nothing (§2.2). |
| "Invite a partner" | P | W8 exists, but for partner deals, not commission terms. |
| "⋯ Pause program, Download (CSV)" | N / P | Pause: N. CSV: only client-side, over R2's 500 rows. |
| Segment chips (Event organisers, Venture scouts, Deal makers) | N | No segment column on users, referrals, commissions, `partner_profiles` or `partner_deals` (`mig/028:34-75`). A search for event organiser, venture scout and deal maker finds only the event host service (`wk/routes/events.ts:19`) and an assessment archetype (`mig/110:607-629`). |
| Tile: Active partners | N, or P | "A partner with terms" does not exist. As proxies: active partner deals (R9, readable by an admin), or accounts holding commissions (R2, Super Admin only). The definition needs deciding. |
| Tile: With signed terms / waiting to sign | P | From R9 or R10: `active` versus `awaiting_signature`. These are partner deals (tier grants), not commission terms. |
| Tile: Introductions this quarter | N | "no store records an introduction a member made" (`wk/services/partnerLeaderboard.ts:19-20`). As proxies: `referrals` rows (no admin read), and `redemptions_count` per deal (R9). |
| Tile: Commission accrued / paid | SA: P. Admin: N (403). | Sum R2 per currency. The sum is exact only when R2 returns fewer than 500 rows. "Paid" must come from R3's `completed` payouts. **W** if summed across currencies, or if `commissions.status='paid'` (claimed, not paid) is used. The clawback gap in §2.1 also applies. |
| Chart: Introductions by outcome | N | No segments. `referrals.status` is only `pending` or `converted` (`network.ts:30`, `:180`). The outcome words on the canvas are Refer & Earn statuses (`referralSubmissions.ts:23-27`), a different programme. |
| Chart: Commission by month | SA: P. Admin: N. | Group R2 by `created_at`; take paid from R3 `completed_at` (newest 200). |
| Card: Standard rules | SA: E. Admin: N. | Super Admin: R1 plus the W1 editor (reuse `RuleEditor`, `AdminCommissions.jsx:64-127`). A plain admin gets 403 and sees no values. **W:** presented as "what a code earns", four of the five rows never pay (§2.3). The bracketed sample amounts equal the seeds (`network.ts:100-104`). |
| Table: Partner, segment | P / N | The name comes from R2 (Super Admin). Segment: N. |
| Table: Terms | N | Only "Standard rules" can be true today. |
| Table: Code | N / P | No admin read exposes a member code. The `PART-` code is readable (R9 `:299`). `[LIS-…]` matches neither format. |
| Table: Intros, Converted | N | Per-referrer `referrals` rows are readable only by that referrer (`network.ts:496-513`). |
| Table: Accrued, Paid, Last activity | SA: P. Admin: N. | From R2 and R3. |
| Row menu "⋯" | N / P / N / P | Set custom terms: N. Send contract: P (W10, linked to nothing). Pause: N. End: P (W9 ends a partner deal). |
| Search, filters, sort, count, pages | P | Client-side only, over the newest 500. |

##### PG8 Custom terms lightbox (`dc:406-412`; caption `bd:52`)

| Block | Status | What exists, and what is missing |
|---|---|---|
| "Custom terms · [Name]", "Deal maker · code [LIS-DM-01]" | N | There is no terms store, no segment and no such code format. |
| Segment | N | — |
| Contract: Partner Custom Deal or Finder's Fee, with Preview | P | Both bodies exist (§4) and preview exists (W10, or `preview.pdf` at `admin_contracts.ts:1937`). Partner Custom Deal's fields are equity, revenue share, carry and capital (`mig/113:700`, `:723`). Finder's Fee has one `fee_pct` (`:196`). Fitting the drawer's terms into either needs a template change, which is HQ authoring (`admin_contracts.ts:1904-1905`). |
| What pays: a trigger and an amount, flat or share, never both | P | The "never both" check exists for the standard rules (`network.ts:655-660`). |
| Trigger: Member completes KYC | E | It fires (`kyc.ts:378`). |
| Triggers: Startup closes a deal, LP onboarded, Spin-out raise, New operating partner | N in effect | The rules exist, but nothing fires them. |
| Trigger: Event tickets sold | N | Ticket intents carry no referral data (`eventTickets.ts:58-67`). |
| Trigger: Event sign-ups | N | — |
| Cap per introduction; overall cap | N | No column (`network.ts:69-77`). The engine has no cap (`:167-172`). |
| Start and end dates | N | `partner_deals` has `term_months` and `expires_at` (`mig/028:64-70`), but those govern tier grants. |
| Studio | N | Commissions carry no studio. The ledger routes answer `HQ only` on a branch (`auth.ts:694`). |
| Sectors | N | — |
| Payout method: bank transfer (last four) | P | The partner chooses the method and destination on each request (`network.ts:761-772`, `:731-748`); it is not a term. |
| Payout method: Credits | N | No route turns a commission into credits, and `grantCredits` refuses `partner` accounts (`creditGrants.ts:43`, `:166-168`). |
| Live sentence | P | Client-side, once a store exists. |
| Steps: Draft → Approved by HQ → Sent for signature → Signed → Active | N | No such states exist anywhere (`partner_deals` states: `mig/028:67`). The closest precedent is settlements: an HQ admin drafts, the Super Admin issues with step-up (`partner_settlements.ts:57-75`, `:108-113`). |
| Buttons: Save draft, Send to HQ for approval, Approve | N | — |
| Button: Send for signature | P | W10 sends a published template, but records nothing against the terms, and no signature hook marks them signed (`esign.ts:1585-1593`). |
| "Terms take effect only when signed. Until then the standard rules apply." | N as behaviour | The engine reads only `commission_rules` (`network.ts:163`). The sentence is true today only because no custom terms exist. |
| Admin versus Super Admin | — | A plain admin cannot even read the standard rules these terms sit beside (R1 is Super Admin only). |

##### PG9 Refer & Earn (`dc:413-422`; "Who can refer" `dc:493`; caption `bd:53`)

**Overview (PG9)**

| Block | Status | What exists, and what is missing |
|---|---|---|
| Moved notice from `/admin/refer-earn` | N | The pattern exists: D893's redirect adds `?moved=` (`fe/pages/admin/insights/HeldInsightsRedirect.jsx:5-16`). Today the route still renders the old page (`fe/App.jsx:2695`). |
| "Rewards become credits they spend on perks"; "Rewards: credits" | **W** | §5.6. The pipeline is live; the rewards are not. |
| "Who: Every member · Join: Open" | **W** | The frontend excludes Explorers (`fe/App.jsx:3493`); the Worker admits them. |
| Tile: Referrals | P | Count R4's rows at `limit=200`. The count is complete only when fewer than 200 come back. No total exists. |
| Tile: Waiting for review, "oldest", Overdue | E | R5 gives the count and `oldest_at`. Submission time is right here, because a row is born `submitted` (`referralSubmissions.ts:476`). The Overdue threshold is a client-side rule. |
| Tile: Converted | P | Client-side over R4, counted cumulatively as `countsForReferrer` does (`:302-305`). |
| Tile: Rewards issued / "[600] credits" | Count: P. Credits: **W**/N. | `reward_issued` can be set with nothing issued (`:535-540`). `reward_label` is text. |
| Chart: Referral funnel | **W** from current status | "Reached a stage" needs the events, which no admin read returns in bulk. Statuses can skip stages. The side figures (More info, Rejected, Closed) are P, as current counts. |
| Chart: Referrals per week by category | P | Client-side from R4's `created_at` and `category`. Complete only if 12 weeks fit within 200 rows. "Platform user" is the `customer` category. |
| Card: Rewards | P / N | The three text lines exist (`:80`, `:88`, `:96`). The credit amounts have no store (`mig/381`). Super Admin "Edit": N, and W5 cannot create a key. "Open Perks": E. |
| Card: Strategic referral access (Grant, Decline, "[2] asking") | N | No read, no write and no lane (§5.5). |

**Queue tab (PG9q, `dc:420-421`)**

| Block | Status | What exists, and what is missing |
|---|---|---|
| Column: Referred (name, organisation) | E | — |
| Column: Category | E | `category_name` |
| Column: Referrer "[Name] · Founder" | P | The name and email are there. The role is not selected (`refer_earn.ts:270`). |
| Column: Status | E | — |
| Column: Next step | E | — |
| Column: Waiting | P | From `created_at`, so time since submission. Time in the current status needs the events. |
| Search | N on the Worker | Client-side only. |
| Filters: Status, Category | E | `:260-267` |
| Filter: Referrer role | N | — |
| Sort: Waiting longest | N on the Worker | The Worker returns newest first only. |
| Count "1–7 of [7]", pages | N | No total, no offset. |
| "The Approvals lane opens it" | — | The lane console (`adminStudioOverview.js:369`) and the sidebar `match` (`sidebarConfig.js:227`) must change. |

**A referral, opened (PG9d, `dc:422`)**

| Block | Status | What exists, and what is missing |
|---|---|---|
| Timeline | N as a read | It is returned only after a save (§5.4). The event labels (`:504`) match the canvas. |
| Fields: Status, Next step, Reward, Fit notes, Note to the referrer | E | W3. **W:** typing "[100] credits" in Reward pays nothing. |
| "What you write here is what the referrer sees." | E | `toWire` `:635-655` |
| Save changes | E | Send `status` only when it changed. Refusals: 404 `not_found`; 400 `bad_status`; 423 on a suspended branch; 423 when the admin is frozen. |

**Who can refer (PG9s, `dc:493`)**

| Block | Status | What exists, and what is missing |
|---|---|---|
| Switches; Explorers drawn off | N | No settings store: `rg -i "who_can_refer\|referrer_roles\|refer_earn_settings\|referral_settings"` finds nothing. Today the frontend guard (`fe/App.jsx:3493`) decides; the Worker does not enforce it. Turning a switch off would need a Worker check. |

---

#### 9. Figures and sentences that would be wrong today

1. "Rewards become credits", "[600] credits", and the Reward field read as credits (PG9). No referral credit exists.
2. The standard rules read as "what a code earns" (PG7). Four of the five never fire.
3. "Paid" taken from `commissions.status`. That means claimed, not paid.
4. Money summed across currencies (`network.ts:532-546`).
5. Commission totals after refunds. They are not clawed back, as the code stands (§2.1).
6. PG7 "Join: By invitation". The PG9 "Who: Every member" is wrong too: Explorers cannot open the page.
7. PG9's funnel built from current status counts.
8. Counts from R4 drawn without the "fewer than the limit" check. Referral review's empty state covers only the newest 100.
9. PG8's "Event tickets sold" trigger, and "Until then the standard rules apply" read as an override that exists.

#### 10. Buildable now, with no Worker change

- **PG7, Super Admin view:**
  - The Standard rules card, with editing.
  - The commission tiles and "Commission by month", from R2 and R3 with the completeness check.
  - Per-person Accrued and Paid rows (terms are always "Standard rules").
  - "End" on a partner-deal row.
- **PG7, Admin view:** one sentence saying HQ holds the commission ledger, with no figures.
- **PG9:**
  - The Waiting tile (R5).
  - The Queue tab from R4 at `limit=200`, with client-side search, sort and paging, and a note that it shows the newest 200.
  - The drawer fields and Save (W3), sending `status` only when changed.
  - The redirect and moved notice (D893 pattern).
  - The Rewards card as its three text lines, with "Not set" for amounts.
- **PG8:** nothing beyond a link to Contracts and the template preview.

#### 11. Needs a Worker change (slots 4 and 5 in the issue's split)

**Slot 4, Refer & Earn:**
- Strategic access: a queue read and a grant or decline write, with `decided_by`, a note, an audit row, a notice to the member, and an Approvals lane.
- `GET /admin/submissions/:uid` with its history.
- A paged list with a total, counts by status, and counts by week and category; the referrer's role; search and sort.
- An audit row and a referrer notice on every review.
- Transition rules between statuses.
- Referral credit rules seeded by migration, and `grantCredits` called at the right statuses, with one `source_ref` per submission.
- A "who can refer" store that the Worker enforces.

**Slot 5, Referral partners:**
- A per-partner terms store: segment, flat-or-share triggers, caps, dates, studio, sectors, a contract link, and the states draft, approved, sent, signed, active and expired.
- A Super Admin approval write, following the settlements precedent.
- The engine reads a partner's active terms before `commission_rules`.
- Events that fire the four dead triggers, plus event tickets and event sign-ups.
- An admin-readable ledger scoped to what an Admin may see.
- An introductions store.
- The member referral code exposed to admins.
- A decision on whether `PART-` codes and member codes merge (#2297's "one Refer & earn").

**Templates:** commission-schedule fields in both templates, and the envelope records the terms row so the signature hook can mark the terms signed.

#### 12. Owner decisions this surfaces

- Whether Explorers may refer.
- The credit amount for each referral reward, and whether partner-role accounts may receive credits (today they are refused).
- What a "referral partner" is: a role, any holder of a code, or a partner deal.
- Whether the four dead triggers get events, or come off the card.
- Whether only the Super Admin approves custom terms, or any HQ admin.

#### 13. Issue #2371's cites, re-checked at HEAD

| Issue cite (`537f646a3f`) | At HEAD | Still true? |
|---|---|---|
| `network.ts:99-105`, `:69-77`, `:571`, `:583`, `:615` | Same lines | Yes. Four rules also never fire. |
| `AdminCommissions.jsx:27-30` | Same | Yes |
| `fe/App.jsx:2696` (commissions route, `hqOnly`) | `:2700` | Yes |
| `admin_contracts.ts:309`, `:358` | Same | Yes |
| `085_seed_legal_templates.sql:1674-1675` ("stub") | Same lines | **Stale.** Filled by `mig/105`, `mig/113` and `mig/484`. |
| `fe/App.jsx:3479` (`/referrals` guard) | `:3493` | Yes |
| `refer_earn.ts:95`, `:141`, `:44-46` | Same | Yes |
| `creditGrants.ts:134` and its four callers | Same | Yes |
| `mig/381:3`; `perks.ts:36`, `:769`, `:785`, `:806`, `:832` | Same | Yes |
| `admin_credit_rules.ts:1-18`; `fe/App.jsx:2797` (credit-rules route) | Same; `:2805` | Yes |
| `refer_earn.ts:244-250`; `referralSubmissions.ts:462`, `:619-631`, `:88` | Same; `:619-632` | Yes |
| `refer_earn.ts:262`, `:269-276` (the 200 cap) | Same | Partly: the page asks for nothing and gets 100. |
| `fe/lib/api.js:2439-2443` | `:2439-2449` | Yes |
| `fe/lib/api.js:2467-2475` | `:2472-2481` | Yes |
| `admin_credit_rules.ts:74`; `fe/lib/api/creditRules.js:18` | Same | Yes |
| `fe/App.jsx:2691` (`/admin/refer-earn`); `ReferralReview.jsx:68`; `sidebarConfig.js:227`; `adminStudioOverview.js:369` | `:2695`; same; same; same | Yes |

#### 14. How each absence was established

- Partner segments: `rg -n -i "event.?organi[sz]er|venture.?scout|deal.?maker|dealmaker"` over `cloudflare-worker/src`, `cloudflare-worker/sql` and `frontend/src`.
- Commission triggers: `rg -n "referral_deal_funded|referral_lp_onboarded|referral_spinout|referral_partner_fee|referral_kyc_approved"` over `cloudflare-worker/src`, `frontend/src` and `backend/app`.
- Strategic access writers: `rg -n "referral_strategic_access"` over `cloudflare-worker/src`, `cloudflare-worker/sql/migrations`, `frontend/src` and `backend/app`.
- Admin Refer & Earn endpoints: `grep -nE "refer\.(get|patch|post)\('/admin" wk/routes/refer_earn.ts`.
- Audit and notices on review: `grep -nE "notify|logAdminAction|activity_logs"` over `refer_earn.ts` and `referralSubmissions.ts`.
- Credit grant callers: `rg -n "grantCredits\(|manualAdjust\(|revokeGrant\("` over `wk/`.
- Credit rule seeds: `grep -lnE "INSERT (OR IGNORE )?INTO credit_reward_rules" mig/*.sql` finds only 381.
- Commission rule seeds: `rg -n "INSERT[^;]*commission_rules"` over `sql/` and `src/`.
- Referral settings: `rg -n -i "who_can_refer|referrer_roles|refer_earn_settings|referral_settings|referral_program|program_paused"`.
- Member codes visible to admins: `rg -n "referral_code" wk/routes/admin*.ts`.
- Event tickets: `rg -n "referral_code|referrer_user_id" wk/routes/events.ts wk/services/event*.ts`.
- Clawback columns: `rg -n "reversed_amount_cents" cloudflare-worker/sql scripts`.
- Other writers of `referrals.status`: `rg -n "UPDATE referrals" wk/`.

### Perks, credits, Learning programs and product testing: what the Worker reads and writes

**Basis.** I cited everything at HEAD `0296848` on `claude/spinout-lab-workspace-wuyyqd`. HEAD moved past the `6205ee6` the task names, but every file cited here is unchanged since `6205ee6`: `git diff --stat 6205ee6 HEAD` over `cloudflare-worker/`, `frontend/src/{pages/PerksPage.jsx,lib,routes,App.jsx}`, both canvas files and D558/D812/D815 prints nothing.

**Prefixes.**
- `wk/` = `cloudflare-worker/src/`
- `fe/` = `frontend/src/`
- `mig/` = `cloudflare-worker/sql/migrations/`
- `dc:` = `design/incoming/Programs Page.dc.html`
- `bd:` = `design/incoming/Programs · Boards.dc.html`
- `dec/` = `documentation/architecture/decisions/`

**Notation.**
- E = exists
- P = partly
- N = does not exist
- W = would give a wrong figure, or false copy, if drawn from today's code

Bracketed canvas values are samples, never data.

---

#### 0. The guards everything below uses

| Guard | Who passes | How a refusal looks |
|---|---|---|
| `requireAuth` (`wk/auth.ts:517-521`) | Any signed-in account | 401 `Unauthorized` |
| `requireAdmin` (`wk/auth.ts:523-528`) | `role === 'admin'`. This covers **both** the Admin and the Super Admin. The compliance freeze applies to writes only: GET, HEAD and OPTIONS pass (`:568-590`, `:570`). The Super Admin is never frozen, and nothing is frozen on a branch. | 403 "Admin required". 423 `admin_frozen` (`wk/routes/_t13t14t15_helpers.ts:176`). |
| `requireSuperAdmin` (`wk/auth.ts:692-697`) | `requireAdmin`, plus `is_super_admin`. On a branch deployment it refuses as HQ-only before anything else. | 403 "Super admin required", or the HQ-only refusal |
| `requireRole(c,'partner')` (`wk/auth.ts:802-811`) | An admin passes unconditionally, and **without the freeze check** (it never calls `requireAdmin`). Otherwise the role must match. | 403 `Forbidden` |

**How a failure comes back.** `mapError` (`wk/routes/_t13t14t15_helpers.ts:96`) answers a constraint failure with 400 `already_exists` or `invalid_record` (`:141-153`), and a D1 or SQLite failure with 500 `storage_error` (`:159-163`). Learning handlers that do not catch their own errors fall to `app.onError` (`wk/index.ts:1466`). That is a truthful 5xx, never a zero.

---

#### 1. Perks (`wk/routes/perks.ts`, mounted at `/api/perks`, `wk/index.ts:1294`)

##### 1.1 Tables

| Table | Defined | Notes |
|---|---|---|
| `perks` | `mig/186_perks.sql:40-82` | Later columns:<br>• `company_id`: the *partner's* firm, not a studio (`mig/198_perk_company.sql:48`)<br>• `ends_at` (with a CHECK on the date shape) and `grant_scope` (`mig/228_perk_lifecycle_and_grant.sql:80-85`)<br>• `value_cents` and `editorial_note` (`mig/322_perk_value_editorial_redemption_ratings.sql:52-54`)<br><br>`status` CHECK is `draft, in_review, live, paused, rejected` (`186:73-74`). |
| `perk_claims` | `186:90-110` | `kind_at_claim` is snapshotted at claim time (`:99`). `status` CHECK is `issued, redeemed, expired, revoked` (`:105-106`). UNIQUE(`perk_id`, `user_id`) (`:112`). `redeemed_by_user_id` added at `322:56`. |
| `perk_credit_ledger` | `186:118-129` | Append-only. `kind` is `grant, spend, refund, admin_adjust` (`:123`). UNIQUE(`user_id`, `kind`, `source_ref`) (`:131-132`). `rule_key` added at `381:79`. |
| `perk_views` | `186:139-147` | One row per perk, viewer and day |
| `perk_ratings` | `322:58-67` | One rating per perk and founder, 1 to 5 stars |

**Seeded rows.** `mig/366_verified_startup_perks.sql:9-26` seeds 12 external-provider listings. All are `in_review` with `partner_user_id` NULL. Eleven are `kind='credits'` with `credits=0`; one is `kind='money'`. So the review queue today holds rows whose price reads "0 credits".

##### 1.2 Price types

The three kinds are `credits`, `tier` and `money` (`perks.ts:28-36`; `KINDS` `:71`; CHECK `186:57-58`).

| Kind | Canvas word | What a claim does | Gate |
|---|---|---|---|
| `tier` | "Included in plan" | Free when the founder's plan includes it | `userMeetsTier`, with `required_tier` one of `free`, `growth`, `studio` (`:341-350`, `186:63`) |
| `money` | "Paid to partner" | Records intent only. `price_cents` is quoted and the partner invoices offline; no charge is taken (`:33-35`, `:351-352`). | None beyond founders-only |
| `credits` | "Credits" | Debits the ledger (`:354-360`) | Balance check inside the INSERT |

The page's label for each kind is `priceLabel` (`fe/pages/PerksPage.jsx:94-98`). A tier perk must name its tier (`perks.ts:548-550`).

##### 1.3 Who may claim

Only founders. `PERK_CLAIMANT_ROLES = {'founder'}` (`perks.ts:127`), the owner's decision of 2026-09-27 (`:122-126`). Every other role browses and is refused with `founders_only`, a 403 (`:139`, `:969-971`).

##### 1.4 Reads

| Id | Route | Guard | Shape and limits | Failure |
|---|---|---|---|---|
| **P-R1** | `GET /api/perks/` (`:863-897`) | `requireAuth` | `items[]` from `publicPerk` plus `affordability`. Only rows that are `live` and not past their end date (`:871`). `LIMIT 200`, featured first (`:872`). Also `balance`, `claimant`, `allowance_configured` and `categories`.<br><br>**`claim_count` is computed** (`LISTING_SELECT`, `:408-412`) **but `publicPerk` drops it** (`:382-401`). | `mapError` |
| **P-R2** | `GET /:uid` (`:899-931`) | `requireAuth` | One live listing. Writes a view row (`:909-912`). | 404 |
| **P-R3** | `GET /mine` (`:420-486`) | `requireAuth` | The caller's own claims (`LIMIT 200`, `:433`), their ledger (`LIMIT 200`, `:444`) and `stats` (`:473-478`) | `mapError` |
| **P-R4** | `GET /partner` (`:488-534`) | `partnerOnly` | Rows with `partner_user_id = caller` only, with `claim_count` and `redeemed_count` (`:496-507`). **An admin gets only listings the admin owns.** | `mapError` |
| **P-R5** | `GET /partner/:uid/stats` (`:638-690`), `GET /partner/:uid/claims` (`:695-710`) | `partnerOnly`, on the caller's own listing (`myPerk`, `:306-320`) | Views, claims, redeemed and rates. The claims list never says who claimed (`:707`). | 404 for a listing the caller does not own |
| **P-R6** | `GET /admin/queue` (`:767-778`) | `requireAdmin` (`:769`) | `p.*` plus `partner_email`, `WHERE status IN ('in_review','draft')` (`:773`), `ORDER BY created_at ASC LIMIT 200` (`:774`). No total and no paging. | `mapError` |
| **P-R7** | `GET /admin/credits/:userId` (`:804-828`) | `requireSuperAdmin` (`:806`) | `member{id,name,email,role}`, `balance`, `ledger[]` (`LIMIT 500`, `:818`) and `truncated` (`:825`) | 400 `invalid_user` (`:808`). 404 `user_not_found` (`:811`). |

##### 1.5 Writes

| Id | Route | Guard | What it does |
|---|---|---|---|
| **P-W1** | `POST /:uid/claim` (`:964-1073`) | `requireAuth`, founders only | A repeat claim returns the first one (`:983`). The open window, the cap and the balance are checked **inside** the INSERT (`:1012-1027`). The debit is in the same batch (`:1033-1037`). A lost race returns the winner (`:1039-1049`). Refusals are `claimRefusal` (`:1076-1091`): 402 `tier_required`; 409 `insufficient_credits`, `cap_reached` or `perk_ended`; 403 `founders_only`. |
| **P-W2** | `POST /:uid/rating` (`:936-962`) | Founder whose claim is redeemed | Upserts the rating |
| **P-W3** | `POST /partner` (`:536-580`) | `partnerOnly` | Always inserts `in_review` (`:554-560`) |
| **P-W4** | `PATCH /partner/:uid` (`:582-636`) | `partnerOnly`, own listing | Only a **live** listing goes back to `in_review` on an edit (`:629`). A raise of the cap alone keeps it live (`:622-625`). |
| **P-W5** | `POST /partner/:uid/redeem` (`:720-761`) | `partnerOnly` | Writes `activity_logs` `perk_claim_redeemed` (`:753-758`) |
| **P-W6** | `POST /admin/:uid/review` (`:830-857`) | `requireAdmin` (`:832`) | `action` is `approve`, `reject` or `pause` (`REVIEWABLE` `:74`; 400 at `:835-837`). The resulting status is `live`, `rejected` or `paused` (`:844`). A reject needs `review_note`, which "the partner sees" (`:841-843`). The update also writes `reviewed_by_user_id`, `reviewed_at`, `featured` and `editorial_note` (`:847-854`). |
| **P-W7** | `POST /admin/credits` (`:783-798`) | `requireSuperAdmin` (`:785`) | Goes through `manualAdjust` (§2.3). 404 `user_not_found`, 409 `already_recorded`, otherwise 400 (`:792`). |

##### 1.6 The admin review queue: what the code does and does not do

1. **There is no "Send back".** Reject sets the terminal `rejected` (`:844`). A partner's later edit leaves a rejected row `rejected`: only `live` flips back to review (`:629`). The queue reads only `in_review` and `draft` (`:773`), so an edited rejected listing never comes back to a reviewer. Compare product testing, where an edit returns a sent-back programme to `draft` (`wk/services/testing.ts:454-455`).
2. **Feature can be switched on but never off.** The update writes `b?.featured ? 1 : perk.featured` (`:853`). Featuring is also only possible inside an approve, reject or pause action; there is no standalone toggle.
3. **No status precondition.** Any listing can be approved, rejected or paused from any state (`:838-844`).
4. **Not audited, and the partner is not told.** No `logAdminAction` or `notify` anywhere in `perks.ts` (searched for `logAdminAction|notify|activity_logs`: the only hit is the redeem log at `:755`). Only the last reviewer survives, on the row. Every action also overwrites `review_note` with the new note or null (`:852`).
5. **`draft` has no writer.** `'draft'` appears only in the queue's WHERE clause (searched for `'draft'|'paused'|'rejected'` in `perks.ts`: hits only at `:773` and `:844`).
6. **The queue's age is the creation date.** "Sent" and "oldest" can only be `created_at`. A live listing edited back into review keeps its old `created_at`. No `submitted_at` column exists (`186:40-82`, 228, 322).
7. **Not an Approvals lane.** The lanes in `wk/services/approvalSources.ts:103-244` do not include perks, and `NOT_LANED` (`:269-274`) does not name them. Searched for `Perk listings` in `wk/` and `fe/`: no hits. The only hit is in the canvas (`dc:338`).

##### 1.7 The `/perks` page's admin Review tab

- **Route.** `/perks` is open to admin, founder, partner, investor, advisor and exploring accounts. A partner is redirected to `/offers/perk-deals` (`fe/App.jsx:2956`).
- **Who sees the tab.** It is shown when `role === 'admin'` (`fe/pages/PerksPage.jsx:1669`, `:1697`), so a plain Admin sees it as well as the Super Admin. It renders at `:1740`.
- **The tab is not in the URL.** Tab state is `useState('market')` (`:1671`), and the file has no `useSearchParams`. So no link can open the review tab directly.
- **`ReviewQueue` (`:1494-1571`):**
  - It reads with `api.perkReviewQueue` (`:1502`; client `fe/lib/api.js:3398`).
  - A failed read shows `Unreadable` (`:1523`). An empty queue says "Nothing is waiting for review." (`:1525-1532`).
  - Each row shows the offer, partner name, partner email, price and stated value (`:1537-1541`), a note field, an editorial field and a Feature checkbox.
  - **Only Approve and Reject are offered** (`:1561-1566`). There is no Pause, although the Worker supports it.
  - `featured: true` is sent only when the box is ticked (`:1516`).
- **Unused client.** `api.perkGrantCredits` (`fe/lib/api.js:3401-3402`) has no caller.

---

#### 2. Credits

##### 2.1 Ledger and balance

- **Balance is derived.** It is `SUM(delta)` per user, with no balance column (`perks.ts:281-286`).
- **"Allowance configured"** means any positive ledger line exists anywhere (`:289-294`).
- **Value.** 1 credit = US$1 (`CREDIT_USD_CENTS`, `:254`; `mig/381_credit_reward_rules.sql:3`).
- **Line descriptions.** Each line's source is read from `source_ref`: `perk:`, `ticket:`, `task:`, `lab:`, `revoke:` or `admin:` (`perks.ts:268-278`).
- **Kinds with no writer.** No code writes a `refund` line. No code writes a claim status of `revoked` or `expired`; `expired` is derived on read (`:223-231`). I searched for `'refund'`, `status = 'revoked'` and `status = 'expired'` in `wk/`.

##### 2.2 `credit_reward_rules` (`mig/381_credit_reward_rules.sql:30-37`) and `wk/routes/admin_credit_rules.ts` (mounted `/api/admin/credit-rules`, `wk/index.ts:1072`)

- **Columns:** `key` (PK), `credits >= 0`, `usd_value_cents >= 0`, `active` 0 or 1, `updated_by`, `updated_at`.
- **Seed (`381:39-77`):**
  - bug tiers 150 / 60 / 20;
  - `feature_shipped_*`, switched off by `mig/407_feature_shipped_rules_off.sql:15-17`;
  - `task_approved` 10;
  - the cap `cap:bounty_monthly` 500;
  - 30 `lab:*` milestones.
  - **There is no referral rule.**
- **Every route is `requireSuperAdmin`.** Every write carries a reason of at least 10 characters (`CREDIT_REASON_MIN` `:31`, `readReason` `:48-57`) and is logged with `logAdminAction`.
  - `GET /` lists the rules, each with a `kind` of cap, bounty, lab or reward (`:36-41`, `:64-72`).
  - `PUT /:key` (`:152-200`) is 404 `rule_unknown` for an unknown key. Credits run 0 to 100,000. The dollar value is fixed at credits × 100 (400 `usd_value_fixed`, `:168-178`). The audit row records from, to and reason (`:189-194`).
  - **`GET /grants`** (`:74-112`) returns rule grants and manual lines, newest first, `LIMIT 200`, with an optional `?user_id=` and each line's revoke state. It includes the email (`:82`, `:104`) and **excludes `spend` lines** (WHERE `:88`, `:98`).
  - `POST /grants/:id/revoke` (`:114-130`) and `POST /lab-backfill` (`:135-150`).
- **Client and page.** `fe/lib/api/creditRules.js:8-23`; the page is `/admin/credit-rules`, `hqOnly` (`fe/App.jsx:2805`).

##### 2.3 The grant service's guards (`wk/services/creditGrants.ts`)

**`grantCredits`** (`:134-230`):
- A source already paid answers `already_granted` (`:149-152`).
- An unknown rule answers `rule_unknown`; an off or zero rule answers `rule_inactive` (`:157-161`).
- Admin and partner recipients are refused as `not_eligible` (`INELIGIBLE_ROLES` `:43`, `:166-168`).
- The monthly bounty cap is checked inside the INSERT (`:170-199`). A grant over it is refused as `cap_reached`, with the limit and amount used (`:212-218`).
- The grant is audited: `logAdminAction` for an admin actor, `system:<source>` otherwise (`:101-113`, `:223-225`).
- The member gets an inbox notice; a failed notice does not undo the grant (`:115-123`, `:226-228`).

**`revokeGrant`** (`:243-279`) is idempotent on `revoke:<id>`. It is refused as `would_overdraw` if the credits have been spent (`:255`, `:264-267`).

**`manualAdjust`** (D608, `:312-368`), behind `POST /api/perks/admin/credits`:
- `delta` must be a non-zero whole number up to ±100,000 (`:284`, `:320-323`).
- The reason must be at least 10 characters (`:286`, `:324-327`).
- The note can be at most 500 characters (`:328-329`).
- `source_ref` defaults to `admin:<actor>:<iso>` (`:330-332`).
- A source already on the ledger is `already_recorded`, and a deduction below zero is `would_overdraw`; both are checked inside the INSERT (`:339-356`).
- `rule_key` is `'manual'` (`:282`).
- **The reason goes to the audit row; the member's notice carries the note.** The note defaults to "Credits added by the Axal team" (`:338`, `:359-365`).
- **No role check.** It checks only that the account exists (`:334-335`), so unlike `grantCredits` it can credit an admin or partner account.

##### 2.4 Who earns credits today

Three callers use `grantCredits`:
- an approved community task: `wk/routes/admin_ticket_reviews.ts:225`;
- bug bounties: `wk/services/bugBounties.ts:178`;
- Lab milestones: `wk/services/labMilestoneCredits.ts:80` and `:100`.

Two callers use `manualAdjust` and `revokeGrant`: `perks.ts:787` and `admin_credit_rules.ts:122`.

**No referral pays credits.** The copy promises "Platform credit, issued once matched…" (`wk/services/referralSubmissions.ts:88`), but no code grants it.

##### 2.5 Member credits client and page

- **Client.** `fe/lib/api/memberCredits.js:7-12`, re-exported at `fe/lib/api.js:57`:
  - `read(userId)` calls `GET /perks/admin/credits/:userId`;
  - `adjust(body)` calls `POST /perks/admin/credits`.
- **Its only consumer** is `fe/pages/hq/MemberCreditsPage.jsx`: `AdjustForm` (`:40`) and the read (`:159`).
- **Route.** `/admin/accounts/credits/:userId`, `hqOnly` (`fe/App.jsx:2775`). It is linked from the Users drawer (`fe/pages/admin/consoles/UsersConsole.jsx:1427`) and from AI usage (`fe/pages/hq/AiUsagePage.jsx:334`).
- **Member search exists:** `GET /api/admin/users?q=`, `requireAdmin` (`wk/routes/admin.ts:50`, mounted `wk/index.ts:1101`).
- **No read sums credits across members.** I searched for `SUM(delta)` without a `user_id = ?`: the only hits are per-user, plus the intro ledger.

---

#### 3. Learning programs (D558)

##### 3.1 Tables (`mig/389_learning_programs.sql`)

| Table | Lines | What it holds |
|---|---|---|
| `learning_programs` | `:19-31` | `name`; `region`, which is free text (`:23-24`); `enrolment` `invite` or `open`, default invite (`:26`); `status` `draft`, `published` or `archived` (`:27`) |
| `learning_program_contents` | `:34-43` | `subject_kind` `course`, `item`, `exam`, `exercise` or `webinar` (`:38`), with a `position` |
| `learning_program_admins` | `:46-54` | The assigned admins, with `assigned_by` and `assigned_at` |
| `learning_enrollments` | `:56-66` | `enrolled_by` (the member's own id on a self-enrolment), `enrolled_at`, `status` `active` or `removed`, `updated_at` |

Completion is read from four other stores:
- `learning_progress` (`mig/388_learning_core.sql:93-105`): `status` started or completed, `percent`, `completed_at`, `updated_at`;
- exercise submissions and exam attempts (`mig/390_learning_exercises_exams.sql:33`, `:83`).

**Webinars now have a store** (`mig/391_learning_webinars.sql:16-49`, with `attended` at `:46`).

##### 3.2 The gate

- **Authoring is the Super Admin's.** `gate` is `requireSuperAdmin` (`wk/routes/admin_learning.ts:46-48`; header `:4-6`), and every program write is recorded through `record`, i.e. `logAdminAction` (`:50-51`).
- **Branches hold no programs.** `requireSuperAdmin` refuses on a branch (`wk/auth.ts:692-697`), so nothing can author a program there and a branch database holds none.
- **Mounts.** Admin routes are at `/api/admin/learning` (`wk/index.ts:943-951`); member routes at `/api/learning` (`:1298-1306`).

##### 3.3 Super Admin routes (`wk/routes/admin_learning_programs.ts`)

| Route | Lines | Notes |
|---|---|---|
| `GET /programs` | `:84-93` | Each program with `learners` (active enrolments, `:88`) and `admins` count (`:89`), `LIMIT 500` (`:90`). **No contents count.** |
| `POST /programs` | `:95-108` | Creates a draft |
| `GET /programs/:uid` | `:110-114` | `detail` (`:51-70`): contents, admins (name and uid, never email, `:45-49`, `:55`), and **every enrolment including removed ones**, with `status`, `enrolled_at`, `updated_at` and `enrolled_by` self or super_admin (`:58-62`) |
| `PATCH /programs/:uid` | `:116-134` | |
| `PUT /programs/:uid/contents` | `:143-175` | Up to 200 items (`:34`). Each must exist (`:161`); duplicates are refused. **A webinar is refused as `webinar_not_built`** (`:158`), even though its store now exists (391). |
| `POST/DELETE /programs/:uid/admins` | `:177-205` | The target must be an admin: 400 `not_an_admin` (`:183-185`) |
| `POST/DELETE /programs/:uid/enrollments` | `:207-240` | Enrolment has no role or status check. Re-activating an enrolment **resets `enrolled_at`** (`:218-219`). Removal sets `removed` (`:232`). |

##### 3.4 Member and assigned-admin routes (`wk/routes/learning_programs.ts`)

| Route | Lines | Guard | Notes |
|---|---|---|---|
| `GET /programs` | `:45-54` | `requireAuth` | Published and open programs (`:50`), `LIMIT 200` |
| `GET /programs/enrolled` | `:65-102` | `requireAuth` | The caller's programs with contents and own completion. A failed contents round gives `contents: null` with `contents_error` (`:97-99`). |
| `GET /programs/mine` | `:104-121` | Admin. A non-admin gets 403 `admins_only` (`:107-109`). | The Super Admin sees **all** programs; an Admin sees only assigned ones (`:115`). Each carries `learners` and `contents` counts (`:112-113`); **no admins count**. |
| `POST /programs/:uid/enrol` | `:123-142` | `requireAuth` (every role, `exploring` included) | 403 `invite_only` (`:129-131`); 403 `removed` (`:132-135`) |
| `GET /programs/:uid` | `:152-167` | Reader or eligible member | 404 when hidden (`:158`) |
| `GET /programs/:uid/learners` and `…/learners/:userUid` | `:178-201` | The Super Admin or an assigned admin only (`readerOf` `:169-176`, 403 `not_assigned`; `isAssignedAdmin` `wk/services/learningAccess.ts:75-80`) | 404 `not_enrolled` (`:194`). **Active learners only** (`wk/services/learningPrograms.ts:105`). |

##### 3.5 Completion data available (`wk/services/learningPrograms.ts:118-192`)

| Content | Cell served |
|---|---|
| Course | `completed`, `in_progress` or `not_started`, with `required`, `completed` and `percent` (null when the course has no required lesson) (`:165-173`) |
| Item | Status and `percent` (`:174-177`) |
| Exercise | The latest submission's status, or `not_submitted` (`:178-180`) |
| Exam | `passed`, `not_passed` or `not_attempted`, with `best_score_percent` and `attempts` (`:181-184`) |
| Webinar | `not_built` (`:185`) |

- **No dates are returned.** `completed_at` is selected (`:124`) and exam `submitted_at` is selected (`:137`), but neither is in the output (`:188-191`). `learning_progress.updated_at` (`388:103`) is never selected.
- **No email** is selected or returned (`:7-9`, `:103`; `dec/D558.md:96-97`).
- **No program-level "finished" flag.** No definition of a finished program exists in code or in D558 (`dec/D558.md:84-95`).

##### 3.6 Enrolment data available

- **For the Super Admin:** per enrolment, `enrolled_at`, `status`, `enrolled_by` and `updated_at`, but only per program (P-detail). There is no aggregate read and no weekly series.
- **For an assigned Admin:** active learners only, with `enrolled_at`.
- **`enrolled_at` is overwritten on re-enrolment**, so the original date is lost.

##### 3.7 Frontend already wired

- Clients: `fe/lib/api/adminLearning.js:87-98` and `fe/lib/api/learning.js:40-48`.
- Read helpers: `fe/pages/learning/programReads.js:63-112`, used by `MyPrograms.jsx`, `LearningPrograms.jsx` and `ProgramStudio.jsx`.
- Routes (`fe/routes/learning.jsx`):
  - `/learning/programs` and `/learning/programs/:program` are `guard(['admin'])` (`:42-43`);
  - `/learning/studio/programs` and `/learning/studio/programs/:program` are `hqOnly` (`:45-46`).
- The Programs landing does not link to any of them (searched `fe/pages/admin/HeldPrograms.jsx` for `perk|learning|testing`: no hits).

---

#### 4. Product testing (D812, D815)

##### 4.1 Tables (`mig/516_product_testing.sql`)

- **`testing_programmes`** (`:18-45`): `owner_kind` is `hq` or `partner`. `status` is `draft, submitted, approved, open, testing, closed, rejected` (`:38-39`).
- **`testing_applications`** (`:48-57`): `status` is `applied, picked, declined, withdrawn`.
- **`testing_events`** (`:66`).
- **The `testing` status has no writer.** It is only read (`wk/services/testing.ts:308`, `:372`, `:519`, `:577`).

##### 4.2 Routes and who may see them (`wk/routes/testing.ts`; mounted `wk/index.ts:1407-1410`)

- **Members** (`:43-80`, `requireAuth`):
  - `GET /programmes` shows `open` programmes inside their window, for the caller's role, with places left (`wk/services/testing.ts:211-226`);
  - apply, withdraw and `summary`.
- **Partners** (`:120-147`, partner role and profile): their own firm's programmes only. Another firm's programme answers 404 (`testing.ts:14-15`).
- **HQ** (`:153-199`): **`requireSuperAdmin` on every route** (`actingHq` `:155-158`).
  - `GET /api/admin/testing/programmes?status=` (`:160-165`) returns every programme of any owner. Each carries `applicant_count` (excluding withdrawn), `picked_count` and `places_left` (`wk/services/testing.ts:132-133`, `:139-162`, `:189-198`).
  - Applicants are returned without an email (`:254-272`).
  - Approve or send back (`:486-503`): a send-back needs a note, and the owner is notified.
  - Open (`:506-515`) and close (`:517-523`).
- **A plain Admin can read nothing here.**
- **The admin UI** is the console `/admin?tab=product-testing` (`fe/pages/AdminPage.jsx:57`, `:245`; strip `fe/App.jsx:1099`; `fe/lib/hqStrips.js:35`; `fe/lib/adminPlacement.js:114`), gated inside by `isSuperAdminUser` (`fe/pages/admin/consoles/ProductTestingConsole.jsx:37`; `dec/D815.md:21-22`). The client is `fe/lib/api/productTesting.js:54-68`.
- **`/admin/platform/product-testing` does not exist** (searched `fe/App.jsx` for `product-testing`).
- **There is no "Product tester" role.** Searched `product_tester|'tester'`; `wk/services/adminInsights.ts:58-59` states it is undefined (#2377, #2318). Eligibility is per programme, by role (`ROLES`, `wk/services/testing.ts:32`).

---

#### 5. PG10: Perks (`dc:423-435`; Super Admin variant `dc:494`; caption `bd:54`)

| Block (dc) | Canvas | Worker today | Verdict |
|---|---|---|---|
| Header pills (`:423`): Live, "Granted to your studio" | Status and grant | No program registry and no grant store. Searched `program_grants\|programme_grants\|program_registry` and `/admin/programs` in `wk/` and `cloudflare-worker/sql`: no hits. No perks table has a studio or licence column (searched `licen\|branch\|studio` in 186, 198, 228, 322 and 381: only tier names). | **N** |
| Facts (`:423`): "Who: Every member · Join: Open · Prices: credits, plan or paid" | Copy | Prices **E** (`186:57-58`). **"Every member" is W**: only founders claim (`perks.ts:122-128`); others only browse (`:865`). | **W/E** |
| ⋯ "Pause program (Super Admin)", "Download (CSV)" (`:423`) | Program pause; export | No program-level pause, only a per-listing `pause` (`:844`). No export route; a CSV could only be built client-side from served rows. | **N** |
| Tabs (`dc:470-471`) | Overview, How it runs, People, Queue, Terms, Settings, Activity | Queue is P-R6. **People: N** (no admin read of claims or claimants; the partner read withholds the claimant, `:692-710`). **Activity: P**: redemptions go to `activity_logs` (`:753-758`) and credit acts to `logAdminAction` (`creditGrants.ts:223`, `:359`), but reviews are unlogged, and no route reads these actions (searched `perk_claim_redeemed\|credit_manual_adjust`). How it runs, Terms, Settings: **N** (no playbook store). | **P/N** |
| Tile "Live perks [18]" (`:425`) | Count | P-R1 item count. Live and not expired, `LIMIT 200`. Any signed-in account can read it. | **E** |
| Tile "Waiting for review [3] · oldest [2 days]" | Count and age | Count **E** from P-R6 (`LIMIT 200`, no total). The oldest age is **W** for re-reviewed listings: `created_at` is the only date (§1.6 item 6). | **E / W** |
| Tile "Claims [42] · [30] redeemed" | Period count | No admin aggregate. The data exists: `perk_claims.status` and `created_at` (`186:105-109`). | **N** |
| Tile "Credits held by members [12,400]" | Total of balances | No read sums every member's balance. A rule is needed on whether admin and partner accounts count, since `manualAdjust` can credit them (§2.3). | **N** |
| "Top perks by claims", top 8 with redeemed (`:426`) | Bars | No admin read. `claim_count` is computed in `LISTING_SELECT` (`:409`) but dropped by `publicPerk` (`:382-401`). Redeemed counts exist only on the partner's own reads (`:497`, `:646-650`). | **N** (smallest fix: serve `claim_count` and `redeemed_count` on an admin read) |
| "Claims per week by price type" (`:424`, `:427`) | Stacked bars: Credits, Included in plan, Paid to partner | No weekly read. The data is `perk_claims.kind_at_claim` (snapshotted, `186:99`) and `created_at`. Mapping: `credits`, `tier` → plan, `money` → paid. | **N** (raw data exists) |
| Review queue table (`:428-434`): Perk, Partner, Price, Sent, Status, ⋯; search, Status, Price type, Sort | Rows, filters, "1–6 of [6]" | **Perk, Partner, Price: E** (`offer`, `partner_name` / `partner_email`, `kind` / `credits` / `required_tier` / `price_cents`; label `fe/pages/PerksPage.jsx:94-98`). **Sent: W** (only `created_at`). **Status: P**: the canvas draws Live, Paused and Rejected rows (`:431-434`), but P-R6 serves only `in_review` and `draft`, and `draft` has no writer. **Search, filters and paging: N** on the server. The default sort, oldest first, matches "Waiting longest" (`:774`). | **P** |
| ⋯ actions (foot `:434`) | Approve | `approve` → `live` | **E** |
| | Send back (reason required, "The partner sees this") | Only `reject` (note required, `:841-843`), and it is terminal (§1.6 item 1). The note is visible on `GET /partner` and drawn for rejected rows (`PerksPage.jsx:1476-1477`). There is no notification. | **W** if drawn as "Send back" |
| | Pause | `pause` is **E** in the Worker. Today's UI does not offer it (`PerksPage.jsx:1561-1566`). | **E** (Worker) |
| | Feature switch with an editorial line | Can be set but **not cleared** (`:853`), and only inside a review action. The editorial line is **E** (`:847`). | **P** |
| Card "Credits", Admin: lock, "A Super Admin grants credits." (`:435`) | Copy | True: both credit routes are `requireSuperAdmin` (`:785`, `:806`). A plain Admin can read no balance at all. | **E** |
| Credits foot "Members hold [12,400] credits. 1 credit is worth $1" | Total; rate | The total is **N**. The rate is **E** (`:254`; `admin_credit_rules.ts:168-178`). | **N / E** |
| PG10s "Grant or deduct credits" (`dc:494`): Member search, amount, reason of 10+ characters | Form | **E**:<br>• member search: `GET /api/admin/users?q=` (`wk/routes/admin.ts:50`)<br>• write: P-W7 / `manualAdjust`, with every guard in §2.3<br>• client: `memberCreditsApi.adjust` (`fe/lib/api/memberCredits.js:11`)<br>• reusable form: `AdjustForm` (`fe/pages/hq/MemberCreditsPage.jsx:40`) | **E** |
| PG10s foot: "The member sees the amount and the reason." | Copy | **W.** The member's notice carries the `note`, defaulting to "Credits added by the Axal team", not the reason. The reason goes only to the audit row (`creditGrants.ts:338`, `:359-365`). The board has no note field. | **W**: add a "Note the member sees" field, or change the line |
| Caption "an admin reads; HQ grants" (`bd:54`) | — | A plain Admin reads only the queue and the public catalogue. Every credit figure is Super Admin only, or not served at all. | — |

---

#### 6. PG12: Learning (`dc:445-454`; caption `bd:56`)

| Block (dc) | Canvas | Worker today | Verdict |
|---|---|---|---|
| Pills (`:445`): Live, "Granted to your studio" | — | No grant store. `region` is free text (`389:23-24`). Programs exist only on HQ's database (§3.2). | **N** |
| Facts (`:445`): "Who: Every member · Join: Open or by invitation · Cycle: self-paced" | Copy | Join **E** (`389:26`). Who **E** on the Worker: self-enrolment needs sign-in only (`learning_programs.ts:123-142`). Cycle has no store; it is copy only. | **E** |
| Tile "Published programs [4]" (`:446`) | Count | Super Admin: `GET /api/admin/learning/programs` `status` (`:84-93`), or `GET /learning/programs/mine` (all programs). Admin: `/mine`, assigned programs only (`:115`). | **E** (the scope differs by role) |
| Tile "Active learners [126]" | Distinct people | Only per-program counts (`admin_learning_programs.ts:88`; `learning_programs.ts:112`). **Summing them counts a person in two programs twice (W).** No distinct read exists. | **P / W** |
| Tile "Finished [38]% · [48] of [126]" | Rate | No definition of a finished program and no aggregate. Derivable client-side from `GET /programs/:uid/learners` cells, one call per program, under a rule the owner sets: which statuses count as done, and how `missing` or `not_built` cells count. | **N** (needs a rule) |
| Tile "Enrolled this period [22]" | Period count | No aggregate. Super Admin: per-program detail `enrolled_at` (`:58-62`), one call per program. Admin: active learners only. **W** after a re-enrolment, because `enrolled_at` resets (`:218-219`). | **P / W** |
| "Completion by program", "[12] of [30] finished" (`:447`) | Bars | As "Finished": `completionFor` cells per learner exist (`learningPrograms.ts:163-191`), readable by the Super Admin or an assigned admin only (`learning_programs.ts:169-176`). | **P** (one call per program, plus a rule) |
| "Enrolments per week" (`:448`) | Line | No weekly read. The Super Admin can derive it from detail `enrolled_at`, with removed enrolments included (`:58-62`); an Admin only for active learners. Re-enrolment resets the date (W). | **P / W** |
| Programs table (`:449-453`): Program and region | — | Name and region (`programView`, `learningPrograms.ts:33-38`) | **E** |
| Status: Draft, Published, Archived | — | `389:27` | **E** |
| Enrolment: Open, By invitation | — | `invite` / `open` (`389:26`) | **E** |
| Contents [12] | — | In `/mine` (`learning_programs.ts:113`); **not** in the Super Admin's list (`admin_learning_programs.ts:87-89`) | **E** (via `/mine`) |
| Learners [30] | — | Both reads | **E** |
| Assigned admins [2] | — | Super Admin list only (`:89`). A plain Admin has no read of it: `/mine` has no admins count, and the detail read is Super Admin only. | **E** for the Super Admin, **N** for an Admin |
| Search, Region, Enrolment, Sort, "1–4 of [4]" | — | None on the server (`LIMIT 500`, `:90`, `:116`). Client-side over at most 500 rows. | **P** |
| Super Admin actions: New program, contents, assign admins, enrol (prompt PG12) | — | **E**, all audited:<br>• New program `:95`<br>• contents `:143`<br>• assign admins `:177` (an admin only)<br>• enrol `:207` | **E** |
| Admin line "You follow the programs HQ assigns you. Progress is read only." (foot `:453`) | Copy | True (`learning_programs.ts:13-15`, `:169-176`) | **E** |
| Learner record, PG12d (`:454`): name, no email | — | `GET /programs/:uid/learners/:userUid` (`:190-201`). Name and uid only. | **E** |
| Program and region · "last activity [12 Oct]" | — | Program **E**. Last activity **N**: `learning_progress.updated_at` is never selected, and no dates are returned (§3.5). | **P** |
| Rows Video, Course, Exercise, Exam with Done / Not yet and a date | — | Kind, title and status **E** (`describeContents` `learningPrograms.ts:59-78`; cells `:163-184`). Done / Not yet is a client mapping of richer statuses. **Dates N**: `completed_at` and `submitted_at` are selected but not returned (`:124`, `:137`). | **P** |
| Row "Webinar · Pricing questions" | — | **N**: a program cannot hold a webinar (`admin_learning_programs.ts:158`; stale since `mig/391:16`). The cell kind would read `not_built` (`learningPrograms.ts:185`), and `attended` (`391:46`) is not read. | **N** |
| Footer "No email is shown here. Progress is read only." | Copy | True | **E** |

---

#### 7. PG1: how the catalogue could show the Learning, Perks and Product testing cards

The card data is at `dc:347-349`, the card template at `dc:350-357`, and the PG2 Super Admin swap at `dc:474`.

**No catalogue read exists.** There is no `GET /api/admin/programs` and no program registry (searched `/admin/programs` in `wk/` and `fe/`: no hits). Until one exists, each card can be built from reads that already exist. Each card should answer on its own and show `Unreadable` or `Unrecorded` (`fe/ui/Honesty.jsx:37`, `:62`) for any figure that is missing, never a zero — the pattern of `dec/D893.md:85` and D915.

| Card | Figures (canvas) | Admin (PG1) | Super Admin (PG2) | Link |
|---|---|---|---|---|
| **Perks** (`dc:347`): "Who: Every member · Join: Open", "[18] live · [42] claims", Needs you [3] | Live, claims, waiting | Live: P-R1 count **E**. Claims: **N**. Needs you: P-R6 count **E** (`requireAdmin`). "Who: Every member" is **W** and should read "Founders claim; every member browses" (`perks.ts:122-128`). | The same. "Granted to [3] studios" is **N** (no grant store). | Today `/perks`, with no tab parameter (`PerksPage.jsx:1671`). A deep link to the queue needs a URL tab or the new `/admin/programs/perks/queue`. |
| **Learning** (`dc:348`): "[4] programs · [126] learners", "Join: By invitation" | Programs, learners | `GET /api/learning/programs/mine`: assigned programs only, each with `learners` (`learning_programs.ts:104-121`). Program count **E**. Learners: a sum is **P/W** (double count); label it "enrolments" or wait for a distinct read. The join method varies per program (`389:26`), so "By invitation" should be derived from the rows. | `/mine` returns every program (`:115`). Optional: `GET /api/admin/learning/programs` adds admin counts. | Admin `/learning/programs`; Super Admin `/learning/studio/programs` (`fe/routes/learning.jsx:42`, `:45`) |
| **Product testing** (`dc:349`): Admin "Runs at HQ", no figures and no Open; Super Admin "[3] open · [48] applicants" | Open count; applicants | Correct as drawn. A plain Admin can read nothing (`testing.ts:155-158`), so the card is static and has no link. | `GET /api/admin/testing/programmes` (`:160-165`). Open = `status='open'` (`testing` is never written). Applicants = Σ`applicant_count`, which excludes withdrawn and **includes declined** (`wk/services/testing.ts:133`). "Who: Product testers" has no role behind it (`adminInsights.ts:58-59`); use the programmes' `eligible_roles`. | `/admin?tab=product-testing` (`adminPlacement.js:114`). `/admin/platform/product-testing` does not exist yet. |

**Other PG1 blocks that touch these domains:**

| Block | Status |
|---|---|
| "Credits paid out [4,200] · [2,600] spent on perks" (`dc:333`) | **N** for an Admin (no read). For the Super Admin, `GET /admin/credit-rules/grants` is **W** as a total: newest 200 only, and spends excluded (`admin_credit_rules.ts:88-89`). |
| "Credits in and out by month" (`dc:339`, data `dc:309-311`) | Sources map to `rule_key`: `lab:` → Lab milestones; `bug_` and `task_approved` → Bounties; `manual` → Granted by HQ. **Referrals: N** (no rule, no grant). Spent: **N** read. |
| "Joins per week": Learning enrolments and Perk claims series (`dc:334-336`) | **N** weekly reads. The raw stamps exist: `learning_enrollments.enrolled_at` and `perk_claims.created_at`. |
| "Waiting by program", "Perk listings" row (`dc:338`) | Count **E** (P-R6). The age bands are **W**, because they come from `created_at`. It is not an Approvals lane (§1.6 item 7). |

---

#### 8. Owner decisions and Worker work these boards need

**Owner decisions:**
- What counts as a finished Learning program.
- Whether admin and partner accounts count in "credits held by members".
- Whether Perks "Send back" means a new resubmittable state.
- Whether any referral pays credits, and under which rule key.

**Worker work** (all new; nothing exists today):
- An admin Perks overview: live, claims and redeemed per listing, claims per week by `kind_at_claim`, a sum of all balances, and queue age from a new `submitted_at`.
- A paged admin listings read across every status.
- Review fixes:
  - a send-back that a partner's PATCH can resubmit;
  - the ability to clear `featured`;
  - a status precondition;
  - `logAdminAction` and a partner `notify`.
- Perks as an Approvals lane.
- Learning:
  - a distinct learner count;
  - enrolments per week;
  - a per-program finished count under the owner's rule;
  - dates and last activity in `completionFor` output;
  - keep the first `enrolled_at` on re-enrolment;
  - accept webinar content now that 391 exists.
- A ledger read for spends and grants by month.
- A program registry and grant store (#2376) for every grant badge.

#### 9. Searches that found nothing

| Pattern | Where | Result |
|---|---|---|
| `program_grants\|programme_grants\|program_registry\|programs_registry` | `cloudflare-worker/sql`, `wk/` | No hits |
| `'/api/admin/programs\|/admin/programs` | `wk/`, `fe/` | No hits |
| `Perk listings` | `wk/`, `fe/` | No hits |
| `logAdminAction\|notify\|activity_logs` | `wk/routes/perks.ts` | Only the redeem log, `:755` |
| `'draft'\|'paused'\|'rejected'` | `perks.ts` | `:773`, `:844` only |
| `'refund'`, `status = 'revoked'`, `status = 'expired'` (perks) | `wk/` | No writers |
| `SUM(delta)` across all members | `wk/` | None |
| `perk_claim_redeemed\|credit_manual_adjust` | `wk/` (readers) | None |
| `licen\|branch\|studio` | `mig` 186, 198, 228, 322, 381, 389, 516 | Only tier names and a comment |
| `product_tester\|'tester'` (as a role) | `wk/` | None |
| `perkGrantCredits` | `fe/` | Defined only (`fe/lib/api.js:3401`) |
| `useSearchParams` | `fe/pages/PerksPage.jsx` | None |
| `product-testing` | `fe/App.jsx` | Only `/admin?tab=product-testing` (`:1099`) and the `/product-testing` redirect (`:3032`) |

### The catalogue, proposals, grants and the programs that do not exist yet

**This is a snapshot, not a spec.** It was read-only. It covers #2371 (Admin · Programs) and the owner's canvas `design/incoming/Programs Page.dc.html` (boards PG1–PG20) with its grid `design/incoming/Programs · Boards.dc.html`. Nothing was edited, staged or written.

**HEAD.** The task names `6205ee6`. The branch `claude/spinout-lab-workspace-wuyyqd` is now at **`0296848`**. The four commits after `6205ee6` are `6c355ff`, `24136bf`, `0b85c2b` and `0296848`. They touch only the pitch-studio files, the Partner Invitations canvas, `design/incoming/README.md` and D894.md (`git diff --stat 6205ee6 HEAD`). So every line cited below reads the same at both commits.

**Prefixes.**
- `wk/` = `cloudflare-worker/src/`
- `fe/` = `frontend/src/`
- `mig/` = `cloudflare-worker/sql/migrations/`
- `dc:` = `design/incoming/Programs Page.dc.html`
- `boards:` = `design/incoming/Programs · Boards.dc.html`

**Notation.**
- **E** exists.
- **P** partly: a read exists, but it is capped, gated or needs client work.
- **N** does not exist.
- **W** would give a wrong figure if used as drawn.

Bracketed values on the canvas are samples, never data.

---

#### 0. In one screen

- **None of the five stores exists:** no program registry, no playbook store, no catalogue read, no program-proposal store, no program-grant store.
  - Searched across `wk/`, `cloudflare-worker/sql/` and the whole repo outside `design/` (the searches are in §1.1).
  - No route answers `/admin/programs`, `/admin/my-licence/programs` or `/admin/licences/programs`.
  - #2376 (Program grants) is open, labelled `needs-design`, with no open PR.
  - No Program grants canvas is in `design/`.
- **The page reads one source today:** `GET /api/admin/studio/glance` (`wk/routes/admin_studio_glance.ts:30-37`, mounted `wk/index.ts:1094`).
  - It has two of the five queues PG1 sums (cohort `wk/services/approvalSources.ts:132-142`; referrals `:113-131`).
  - The other three queues:
    - Office-hours hosts and Perk listings are readable through their own admin routes.
    - Strategic referral access has a store and no admin read at all.
- **Investor cohort access (PG11) and AI-native Venture (PG13) have no store, route or page.**
  - PG11 can be built from existing parts:
    - the advisor-cohort assignment pattern;
    - founder notices and opt-outs;
    - pairwise NDAs;
    - quota-gated investor intro requests.
  - Missing from those parts:
    - a per-cohort NDA;
    - a founder accept/decline on intro requests;
    - any definition of "verified".
- **PG1 figures:**
  - Readable today: the Lab, Mentor, Learning and hosts figures.
  - Missing for a plain Admin: the four-tile row, "People taking part", the credits chart and "Your proposals".
  - Would be wrong as drawn: "Perk claims" read from the member list.

---

#### 1. Registry, playbook, catalogue read, proposal store, program-grant store

##### 1.1 How I searched

| Search | Result |
|---|---|
| `rg -i "program_registry\|programme\|program_grant\|licence_program\|playbook\|program_proposal\|proposal" cloudflare-worker` | 2,517 hits in 307 files. Every one is unrelated: AI fill "proposals", "programme" in prose comments, Product testing's `testing_programmes`. |
| `grep -rniE "CREATE TABLE[^(]*(program\|programme\|proposal\|grant\|playbook\|catalog)" cloudflare-worker/sql` | 17 tables, listed in §1.3. None is a program registry, program proposal or program grant. |
| `rg "my-licence/programs\|licences/programs\|licence_programs\|licenceProgram\|program_grants\|programGrant\|Program grants" --glob '!design/**'` (whole repo) | **No matches** |
| `rg "/admin/programs" wk fe` | **No matches** |
| `rg -i playbook wk cloudflare-worker/sql` | Copy strings only (`wk/services/landingTemplates.ts:1585`, `wk/services/decks/methods.ts:589`, advisor question banks). `partner_playbook_v1` is an assessment key (`wk/services/assessmentSchema.ts:33`). |
| `grep -rnoiE "CREATE TABLE … (licen[cs]e\|entitle\|feature_flag\|offer)"` | Licence tables only (§1.2). No entitlement or feature table. |
| `gh api repos/AxalNetwork/StudioOS/issues/2376` | Open. Labels `tracking`, `slot:S01`, `needs-design`, `frontend`, `worker`. Updated 2026-10-21. |
| Open PRs (REST, first 50), filtered for grant / program / licen | None |
| `rg -il "program grants\|Request a program" design/` | Only `dc:` itself, and one mention on the Partner Invitations canvas (board PI10b eyebrow "NEEDS HQ PROGRAM GRANTS"). **The "Request a program" sheet PG15b points to is not in the repo.** |

##### 1.2 The Licences side (D795, D800, D804, D799, #2376)

There is no D795 file. It exists only as the umbrella cited by:
- `documentation/architecture/decisions/D800.md:3`
- `documentation/architecture/decisions/D804.md:3`
- `mig/512_licence_terms.sql:2`
- `wk/routes/licence_requests.ts:6`

| What | Shape at HEAD | Programs? |
|---|---|---|
| `territory_licences` (`mig/187_territory_licences.sql:40`) | One row per licence. `status IN ('draft','pending_activation','active','suspended','terminated')` (`:65-66`). | No program column |
| `licence_admins` (`mig/190_licence_admins.sql:41-55`) | Binds `user_id` to `licence_id`. `admin_role` is principal or delegate. Granted by HQ. | It is how a caller's "studio" is known (`wk/routes/licence_requests.ts:15-17`) |
| `licence_terms` (`mig/512_licence_terms.sql:33-79`) | One row per `licence_uid`. Every term is nullable, and null means "not recorded" (`:13-15`). Includes `referrals_note` (`:42`) and `referral_fee_bps` (`:61`), which are **licence-level** terms. Super Admin writes it (`:23-24`). Pushed to the branch as `branch_licence.terms_json` (`:81`). | **No program list, no program terms.** The closest precedent for a program-grant table: key on `licence_uid`, null = not recorded, Super Admin writes, audited by `licence_events`. |
| Licence requests (D799): `wk/routes/licence_requests.ts:1-27` | Writes `hq_escalations` (`mig/259_hq_escalations.sql:37-60`: `kind`, `subject_ref`, `status`, `created_at`, `answer`, `answered_by_user_id`, `answered_at`). On HQ it writes under `branch_code = 'hq'` (`licence_requests.ts:11-17`), and it stays open while the licence is suspended (`:25-26`). | `REQUEST_KINDS = ['renewal','terms_change','seat_increase','delegate','non_renewal']` (`wk/services/escalationRequests.ts:32`). `REQUESTABLE_TERMS = ['territory','seats','fee','term']` (`:52`). `ESCALATION_KINDS` (`wk/rpc/hqOps.ts:50-53`). **No program kind.** This is the natural carrier for PG15b's "Request access". |
| Admin Licences tabs (D800, D804) | `LICENCE_TABS` = Summary, Terms, Contract, Statements, Requests, History (`fe/lib/licencePage.js:24-31`). Routes `fe/App.jsx:2713-2719`. HQ's `/admin/licences` is `hqOnly` (`fe/App.jsx:2708`). | **No Programs tab, and no `/admin/licences/programs`.** |

##### 1.3 Stores that look like programs, and what each is

| Store | Shape | Relevance |
|---|---|---|
| `learning_programs` (`mig/389_learning_programs.sql:19-31`) | `uid, name, region, description, enrolment IN ('invite','open'), status IN ('draft','published','archived'), created_by` | Learning only. Super Admin authors (`wk/routes/admin_learning_programs.ts:5-6`; gate `requireSuperAdmin`, `wk/routes/admin_learning.ts:46-48`). |
| `learning_program_admins` (`389:46-53`) | `program_id, user_id, assigned_by, assigned_at`, unique per pair | **The nearest "who holds a program" pattern**, but keyed to a person, not a licence |
| `learning_enrollments` (`389:56-66`) | `program_id, user_id, enrolled_by, enrolled_at, status IN ('active','removed')` | Learners |
| `testing_programmes` (`mig/516_product_testing.sql:18-44`) | `owner_kind IN ('hq','partner')`, `status IN ('draft','submitted','approved','open','testing','closed','rejected')`, `review_note`. HQ approves or rejects (`wk/routes/testing.ts:167`, `:174`), opens and closes (`:181`, `:188`). Super Admin only (`:155-158`). | **The closest working "someone submits, HQ decides with a note" shape** in the codebase, for proposals |
| `cohort_cycles`, `week_windows` (`mig/156_cohort_timing.sql`), `cohort_applicants` (`mig/157_cohort_applications.sql:25`) | The Lab | #2374's |
| `advisor_cohort_assignments` (`mig/206_advisor_cohort_assignments.sql:41-54`) | `advisor_user_id, cohort_cycle_id, assigned_by_admin_id, assigned_at, unassigned_at, note, is_active`, unique per pair | Mentor cohort access, and the template for PG11 |
| `lab_host_applications` (`mig/313_lab_host_applications.sql:36-45`) | `status IN ('pending','approved','rejected','withdrawn','revoked')` | Office-hours hosts |
| `referral_strategic_access` (`mig/175_referral_submissions.sql:86`; runtime twin `wk/services/referralSubmissions.ts:155-162`) | `user_id UNIQUE, note, status DEFAULT 'requested', decided_at, created_at` | Strategic referral access. **Only ever inserted** (`referralSubmissions.ts:623-631`). `rg "UPDATE referral_strategic_access"` finds nothing. |
| `*_proposals` tables: `pitch_deck_proposals` (`mig/498:15`), `ai_rail_proposals` (`mig/506:32`), `validate_proposals` (`mig/214:50`), `mercury_raise_proposals` / `mercury_partner_proposals` / `mercury_investor_proposals` (`mig/520:47`, `mig/521:58`, `mig/522:50`), `solution_design_proposals` (`mig/500:25`), `company_creation_proposals` (`mig/502:62`) | AI-drafted content waiting for a person to accept it | **Unrelated** to studio program proposals |
| `advisor_client_grants` (`mig/218:60`), `data_room_grants` (`mig/184:79`) | Access grants of another kind | Unrelated |
| `PROGRAMS` in `fe/data/network.js:90` | A static member-facing list ("Founder Office Hours", "Investor Roundtable"…), used by the events and circles pages | **Not** the admin catalogue. Do not reuse its keys. |

##### 1.4 Consequence for the new stores

| Store the canvas needs | What exists | What it must hold (from the canvas) |
|---|---|---|
| **Registry** | N | The nine keys the canvas draws:<br>• spinout-lab<br>• ai-native-venture<br>• mentor-cohorts<br>• investor-cohorts<br>• referral-partners<br>• refer-and-earn<br>• perks<br>• learning<br>• product testing<br><br>(`dc:340-349`; addresses from `dc:471`)<br><br>Each key carries:<br>• group<br>• status (`Live · Partly built · Not built yet · Proposed · Paused`, `dc:322`)<br>• who<br>• join method<br>• one-line purpose |
| **Playbook** | N | Ordered sections. Version and edited date ("Version [3] · edited [2 Oct]", "Publish changes", `dc:492`). Lock / "Set by HQ" for an Admin (`dc:103`, `dc:380`). Draft sections reading "Not set" (`dc:458`). |
| **Catalogue read** | N | Per program: status, grant badge, two figures, Needs-you count. Per page: the four tiles, joins_weekly, queue ages, credits_monthly. Each block fails alone (`dc:501`). |
| **Proposal** | N | `Draft · Sent to HQ · Approved · Sent back · Declined` (`dc:325`, `dc:360-364`). Five steps of fields (`dc:463-467`). HQ's note (`dc:359`). Studio (`dc:365`). Decision options (`dc:496`). |
| **Grant** | N (#2376) | Badge words `Granted to your studio · Requested · Paused by HQ · Ended · Not granted · Runs at HQ · Not offered yet · HQ-held · HQ only` (`dc:324`). HQ counts "Granted to [n] studios" (`dc:341-349`). |

Two key facts for the grant store:
- A grant store keyed like `licence_terms` (by `licence_uid`) fits `licence_admins`' binding.
- On today's HQ-held accounts every program reads "HQ-held" (`dc:351`, `dc:491`). The chip text is already a constant: `HELD_SCOPE = 'HQ-held accounts · axal.vc'` (`fe/pages/admin/HeldZone.jsx:30`).

---

#### 2. Investor cohort access (PG11)

Searches:
- `rg -i "investor.cohort\|cohort.nda\|cohort_nda"`: no store and no route.
- `rg "UPDATE investor_introductions"`: no matches.
- `rg "cohort_advisor_optouts" wk`: schema plus `wk/services/cohortAdvisorAccess.ts` only.

| Canvas element (dc line) | What exists | State |
|---|---|---|
| Card: "Verified investors follow one Lab cohort to Demo Day.", `Not built yet`, "Not running" (`dc:344`) | Static copy | N, and it needs no data |
| Banner "New program. This is the design; nothing runs yet." Tiles marked "sample" (`dc:437`). Table foot "Sample rows: this program is not running." (`dc:443`) | — | Draw as static. **No sample figure may ship as data.** |
| What investors see today | The investor Lab page shows an **illustrative composite**: "No endpoint reports per-company cohort telemetry to investors" (`fe/lib/spinoutInvestorContent.js:23-29`, `:133-144`). Page `fe/pages/SpinoutLabInvestorPage.jsx` (lazy `fe/App.jsx:184`, rendered `:2382`). Public Lab reads are company-level and anonymous (`mig/206:9-10`; `wk/routes/spinout_lab.ts:922`, `:1119`). `/fund-metrics` is auth-gated programme totals (`spinout_lab.ts:1323-1332`). | N for a per-cohort investor read |
| "An admin gives a verified investor access to one cohort." (`dc:438`). Grant dialog (`dc:444`). | Template: `advisor_cohort_assignments` (`mig/206:41-54`) and its four admin routes (`wk/routes/advisors.ts:2932`, `:2964`, `:2998`, `:3063`). Keyed `advisor_user_id`, with role re-checked on every read (`wk/services/cohortAdvisorAccess.ts:30-34`). | N. Needs an investor twin. |
| "Founders are told and can hide themselves from one investor." (`dc:438`) | `cohort_advisor_notices` and `cohort_advisor_optouts` (`mig/367_cohort_advisor_founder_notice.sql:29`, `:42-49`). Both keyed to the advisor. Sweep and notice in `cohortAdvisorAccess.ts:15-28`. | N for investors. Copy the pattern. |
| "The investor signs the cohort NDA first." "NDA TEMPLATE [Cohort NDA v2]". NDA column `Signed [date] · Sent · Not sent` (`dc:438`, `:444`, `:440-442`). | `pairwise_ndas`: **founder ↔ investor per pair**, not per cohort (`mig/025_trust_center.sql:47-60`). `upsertPairwiseNda` / `hasActivePairwiseNda` (`wk/services/trust.ts:325`, `:310`). Investor obligation `investor_nda_v1` (`trust.ts:73`). Templates `investor_nda_axal` (`mig/085_seed_legal_templates.sql:1305`) and `nda_3way_founder_investor_axal` (`:1568`). | **P.** No cohort NDA template or store. |
| "They see each venture's summary and weekly progress. Never founders' email addresses." Checklist: Venture summary, Weekly progress, Pitch deck, Demo Day room (`dc:438`, `:444`). | NDA-gated, fail-closed masking: `maskFounderForInvestor` (`trust.ts:387`), used by `wk/routes/projects.ts:386-391`. Weekly status lives in `company_week_status` (read for advisors, `cohortAdvisorAccess.ts:12-13`). Demo Day is an event type (`wk/services/eventTypes.ts:13`). | P for the mask. N for a cohort-scoped investor read. N for a "Demo Day room". |
| "An introduction request goes to the founder, who accepts or declines." Intro requests "[11] ([6] accepted)" (`dc:437-438`). | `investor_introductions` (`mig/027_investor_paywall.sql:44-55`: `investor_user_id, founder_user_id, project_id, message, status DEFAULT 'pending', quarter`). `POST /api/introductions/request` is quota-gated (`wk/routes/introductions.ts:4-8`, `:83`, insert `:126`; quotas `wk/middleware/requireInvestorTier.ts:46-49`). The 3-way NDA intro is `POST /api/trust/intro/request` (`wk/routes/trust.ts:335-355`). | **P.** Requests exist, but **no founder accept/decline write exists** (no `UPDATE investor_introductions`). `intro_propositions` (`mig/150:27`, accept/decline `introductions.ts:321`, `:462`) is a separate matched-intro system. |
| "Verified" / "Not verified" pill, "Waits for verification", "INVESTOR · VERIFIED ONLY" (`dc:440-442`, `:444`) | Nothing called a verified investor. Candidates:<br>• obligations `kyc_v1` and `accreditation_v1` (`trust.ts:74-75`)<br>• `users.kyc_status` (`approvalSources.ts:169`)<br>• investor tier (`requireInvestorTier.ts:46-49`)<br>• approved `lp_applications` (`approvalSources.ts:106`)<br><br>`fe/ui/VerifiedBadge.jsx:1-5` is the connectors' "Verified", unrelated. | **N. Owner decision (§6).** |
| Tiles: Investors with access, Cohorts open, Founders hidden, Intro requests (`dc:437`) | — | N. Sample only. |

---

#### 3. AI-native Venture (PG13)

Search: `rg -i "ai.native" wk cloudflare-worker/sql fe documentation/architecture`. It found 9 copy strings and no store, route or key:
- `wk/services/signals/seed.ts:339`
- `fe/lib/spinoutInvestorContent.js:84`
- deck templates
- onboarding placeholders

The program exists only on the canvas:
- **Card** (`dc:342`):
  - Group "Ventures", status `Proposed`.
  - Grant `Not offered yet` (HQ: `HQ only`).
  - "Who: Founders · Join: Not set".
  - Bracketed purpose.
  - Foot "HQ is writing the playbook."
- **Page** (`dc:455-458`):
  - No facts strip (`facts: false`).
  - Four tiles that read "Not running yet" (`dc:457`).
  - "How it runs · draft" with a lock:
    - Thesis, Who it is for, Length, Seats per cohort, Capital terms and Contracts each read `[to be set]` and "Not set".
    - Tools included `[Eadwyn, Spin-Out Lab modules]`.
  - Foot "When HQ publishes it, you can request it."
- **Super Admin header** (`dc:495`): "Edit playbook", "Publish", "Offer to studios". The foot reads: "Offer to studios turns on Can be granted for this program on Licences › Program grants." That flag lives in #2376's store, which does not exist.

Everything is **N**. It needs:
- a registry row (status Proposed);
- the playbook store with draft sections;
- #2376's "Can be granted" flag.

Note the vocabulary overlap: the program status `Proposed` (`dc:322`) is an HQ-authored draft. It is not a studio proposal, whose statuses are `Draft · Sent to HQ · …` (`dc:325`). Keep the two apart in the store.

---

#### 4. Propose (PG14), Decisions (PG15), and the states (PG16–PG20)

##### PG14 · Propose a program (`dc:459-467`, `dc:485`; `boards:58`)

| Element | Needs | Exists |
|---|---|---|
| Five steps (`dc:462`). "Draft saved [10:41]" (`dc:485`). | Proposal store with draft autosave | N |
| Basics (`dc:463`): Name, purpose, Who it is for (Founders, Investors, Advisors, Operating partners, Explorers, Product testers), Group | Fields | N. The role "Product testers" is #2377's; no such role was found here. |
| How it runs (`dc:464`): Join method, Cycle ("Cohorts of [12] weeks"), Seats, Eligibility | Fields | N |
| Terms (`dc:465`): Rewards (None, Credits, Cash, Equity), Contract templates ("Choose from Contracts"), "What HQ receives" | Template picker | **E** for the picker data: `contracts.templates` (`fe/lib/api/contracts.js:43`) over `wk/routes/admin_contracts.ts:1041`. Line under it: "These are the participant terms. HQ sets your studio's grant terms when it grants the program, on Licences." |
| Tools (`dc:466`): seven switches (Application queue, Cohort calendar, Assignments, Referral codes, Credits and perks, Learning content, Events) | Labels stored on the proposal | The tools exist as separate consoles. Nothing attaches a tool to a program, so store it as a declaration only. |
| Review and "Send to HQ" (`dc:467`): "HQ reviews every proposal. You will see HQ's answer under Your proposals." | Send write, plus the HQ list | N. Shape precedent: `testing_programmes` draft→submitted→approved/rejected with `review_note` (`mig/516:38-40`). |

##### PG15 · Decisions (`boards:59`)

**A · Decide** (`dc:496`):
- The Super Admin decides "[Founder Fitness Sprint]" from "[Studio Nairobi]".
- Four choices:
  - "Approve for this studio only"
  - "Approve for the catalogue (any studio may request it)"
  - "Send back"
  - "Decline"
- A note is required for Send back and Decline.
- The foot reads: "Approve for this studio only opens a draft grant on Licences › Program grants … Approve for the catalogue lists it for every studio as Not granted."
- **N.** It needs the proposal store, the registry, and #2376's draft grant. Gate: `requireSuperAdmin` (`wk/auth.ts:692`).

**B · Request access** (`dc:497`; card logic `dc:350-357`):
- Before sending, the card is muted with "Request access".
- After sending: "Requested", "Waiting for HQ since [12 Oct]", "View request".
- The sheet lives on the Program grants canvas, which is **absent** (§1.1).
- Carrier: D799's licence request (`wk/routes/licence_requests.ts:1-27`). Its `hq_escalations.created_at` (`mig/259:53`) would give "since [date]". But **no program kind exists** (`escalationRequests.ts:32`, `:52`).
- **N.**

**C · Pause** (`dc:498`):
- "Pause [Refer & Earn]?" with the line "New sign-ups stop. People already in keep their access. Members see 'Paused'." The confirm button is destructive.
- The ⋯ menu marks it "Pause program (Super Admin)" (`dc:371`, `:393`, `:413`, `:423`).
- **N.** There is no program status anywhere. Only per-object pauses exist:
  - a perk listing `paused` (`wk/routes/perks.ts:844`);
  - a testing programme `close` (`wk/routes/testing.ts:188`);
  - a learning program `archived` (`mig/389:27`).
- "Members see 'Paused'" also needs the member pages to read program status. Those are `/referrals`, `/perks` and `/learning`, which the issue's own prompt excluded from this canvas.

##### PG16–PG20 · States

| Board | Canvas copy | Needs | Exists |
|---|---|---|---|
| **PG16a** Nothing granted (`dc:486`) | "HQ has not granted any programs to [Studio Lisbon] yet." / "See what HQ offers, or propose one." Three "Not granted" cards (Lab, Mentor, Learning) | Grant store | **N.** On HQ-held accounts it can never show: every program is HQ-held (`dc:491`). |
| **PG16b** No mentors (`dc:499`) | "No mentors yet." / "Assign one before [Dec 2026] starts." | Assignments, plus cycle dates | **E**: `GET /api/advisors/admin/cohort-assignments` (`wk/routes/advisors.ts:2964-2995`, LIMIT 500) and cycles `GET /api/admin/cohort/timeline` (`wk/routes/admin_cohort.ts:49`). `EmptyState` (`fe/ui/index.js:96`). |
| **PG16c** Queue empty (`dc:500`) | "Nothing is waiting." / "New items land here when members submit them." | A true zero from each queue | E per queue (see §5, Waiting by program) |
| **PG17** Loading (`dc:487`) | Tiles and cards read "Reading…"; header and period are live | — | `Skeleton` (`fe/ui/index.js:98`) |
| **PG18a** One block failed (`dc:501`) | "Credits could not be read. That is not the same as none." / "Try again" | Per-block `available:false` | Pattern **E**:<br>• lane `count:null` plus reason (`approvalSources.ts:464-466`; `wk/services/studioGlance.ts:199-210`)<br>• `Unreadable` (`fe/ui/Honesty.jsx:62`)<br><br>The credits block itself is N (§5). |
| **PG18b** Not recorded (`dc:502`) | "Sessions with a mentor" — "Not recorded" / "Sessions with a mentor are not counted yet." | — | `Unrecorded` (`fe/ui/Honesty.jsx:37`). True today: the advisor's calendar sees founder-booked sessions (`cohortAdvisorAccess.ts:10-11`), but no count is read. |
| **PG18c** Refused (`dc:503`) | "This studio's licence is suspended, so program changes are paused until HQ lifts it." | A refusal code | On a branch: `requireBranchNotSuspended` returns 423 (`wk/auth.ts:752-794`). On HQ: `requireAdmin`'s freeze (`wk/auth.ts:523-528`, `refuseWhileFrozen` `:526`). **The four mentor routes skip both**: `requireAuth` plus `isAdmin` only (`advisors.ts:2934-2935`, `:2966-2967`, `:3000-3001`, `:3065-3066`). This is issue item 5, still true. |
| **PG19a** Not an admin (`dc:488`) | Member shell. "This page is for studio admins." / "Your own programs are on your home." / "See your programs", "Go to your home" | A stated boundary | **Not what happens today.** `RoleGuard` silently `<Navigate>`s to the role default (`fe/App.jsx:1819-1831`). |
| **PG19b** Admin opens proposals (`dc:489`) | "Only HQ decides on proposals." / "Your own proposals are under Programs." / "Back to Programs" | `hqOnly` | **E** pattern: `hqOnly` renders `SuperAdminOnlyNotice` (`fe/App.jsx:2304-2306`). Its copy differs, and it links "Admin Console →" (`fe/pages/hq/SuperAdminOnlyNotice.jsx:48`), a name the brief retires. |
| **PG20** Phone (`dc:504-508`; `boards:64`) | Catalogue stacked; tabs scroll; People as cards; Assign as a full sheet with a sticky bar; 44 px targets (`dc:224`) | — | `PhoneSheet`, `PhoneRows`, `PhoneBar`, `usePhoneWidth` (`fe/ui/index.js:77-82`). `Lightbox` (`:35`). |

---

#### 5. PG1 · PG2 · PG3: block by block

##### PG1 · Catalogue, Admin (`dc:473`, `catCols` `dc:370`; `boards:45`)

The caption says: "Waiting for you reads [21], the sum of the five queues in Waiting by program" (`boards:45`).
- The five rows add up: 7 + 7 + 2 + 3 + 2 = 21 (`dc:338`).
- The cards' "Needs you" counts add up too: Lab [9] = 7 applications + 2 hosts, Refer & Earn [9] = 7 + 2 strategic, Perks [3]. 9 + 9 + 3 = 21 (`dc:341`, `:346`, `:347`).
- Mentor's "Needs you [2]" (`dc:343`) is not a queue and is not in the 21.

| Block (dc) | Drawn | Read today | State |
|---|---|---|---|
| Moved notice (`dc:473`) | "Programs has a new address. Update your bookmark." | Pattern: `?moved=` in `fe/pages/admin/insights/HeldInsightsRedirect.jsx:12-16` | E (pattern) |
| Header (`dc:469`) | Line, scope chip "[Studio Lisbon]", "Propose a program", Updated time, refresh, period 4/12/52 | Scope from `licence_admins` (`mig/190:41`) | P. The period drives nothing until a catalogue read takes `weeks=`. |
| **Tile 1** "Programs running [6] of [9]", sub "[2] not granted · [1] proposed" (`dc:333`) | Six cards are `Live` (`dc:341-349`). No PG1 card reads Not granted. | — | **N**: registry plus grant. The sample sub-line does not match the drawn badges. S1 defines "running" (= Live?). |
| **Tile 2** "People taking part [312]", "active in the period, across programs", +[8]% (`dc:333`) | — | Parts only:<br>• Lab participants `GET /api/admin/spinout-participants` (`wk/routes/admin.ts:1385`)<br>• active assignments (`advisors.ts:2964`)<br>• learners per assigned program (`wk/routes/learning_programs.ts:104-121`)<br>• referrers (≤200, `wk/routes/refer_earn.ts:262`)<br><br>No perk-claimer read for admins. | **N.** Summing double-counts, and no distinct-member read exists. Needs a definition (§6). |
| **Tile 3** "Waiting for you [21]", "oldest [4 days]", "! Overdue" (`dc:333`) | Sum of five queues | See the row below | **P.** Strategic access has no read. The Overdue rule is past two days (issue brief), while the code's bands are 24 h / 72 h (`wk/services/slaWindow.ts:18`; `approvalSources.ts:305`). |
| **Tile 4** "Credits paid out [4,200]", "[2,600] spent on perks" (`dc:333`) | Equals the chart's three months: 1,400 × 3 granted; 800 + 850 + 950 spent (`dc:311-312`) | Ledger `perk_credit_ledger` (`mig/186_perks.sql:118-123`, kind `grant\|spend\|refund\|admin_adjust`; `rule_key` `mig/381:79`). Only cross-member read: `GET /api/admin/credit-rules/grants`, **Super Admin**, newest 200, grants only, no spends (`wk/routes/admin_credit_rules.ts:74-112`). | **N** for an Admin. P for a Super Admin. |
| **Joins per week**, 4 series, 12 weeks, "so far" (`dc:334-336`) | Lab applications · Referrals submitted · Learning enrolments · Perk claims. Foot "Referrals rose [18]% on the period before." | 1. Lab: `cohort_applicants.created_at` (`mig/157:35`) via `GET /api/admin/cohort/applications` (`admin_cohort.ts:238-265`: last 12 cycles, ≤200 per cycle, true counts by status). Or `spinout_applications.created_at` (`mig/155:14`) via `admin.ts:1190` (≤200). #2374 picks the store.<br>2. Referrals: `referral_submissions.created_at` (`mig/175:56`) via `GET /api/refer-earn/admin/submissions`, ≤200 newest, **no total** (`refer_earn.ts:262`, `:274-275`).<br>3. Learning: `learning_enrollments.enrolled_at` per assigned program (`wk/services/learningPrograms.ts:101-103` via `learning_programs.ts:178-188`). That is N+1 reads.<br>4. Perk claims: `perk_claims.created_at` (`mig/186:109`). **No admin read of claims.** | Lab **P**, Referrals **P** (complete only when fewer than 200 rows come back), Learning **P**, Perk claims **N** |
| **Waiting by program**, stacked by age: Under 2 days / 2 to 7 days / Over 7 days (`dc:337-338`) | Rows: Spin-Out Lab applications · Refer & Earn reviews · Strategic referral access · Perk listings · Office-hours hosts | 1. **E** glance lane `cohort` "Cohort applications": count plus oldest (`approvalSources.ts:132-142`; `laneCounts` `:453-469`; `queuePressure` `wk/services/branchHome.ts:360-368`). Ages need the per-cycle items (P).<br>2. **E** lane `referrals` (`approvalSources.ts:113-131`). Ages from the ≤200 list (P).<br>3. **N**. Store only (`mig/175:86`). No read, no decide.<br>4. **P**. `GET /api/perks/admin/queue` returns `status IN ('in_review','draft')`, LIMIT 200, no total (`perks.ts:767-777`). **Counting drafts is W**: a draft is the partner's (the rule in `approvalSources.ts:31-34`). Filter to `in_review`.<br>5. **E**. `GET /api/admin/lab-hosts` gives true `counts` by status plus items with `created_at`, LIMIT 500 (`wk/routes/lab_hosts.ts:198-222`). | P overall. The glance labels differ from the canvas names; no "Perk listings" or "Strategic referral access" lane exists. |
| **Credits in and out by month** (`dc:339`, `dc:309-321`) | Above the axis, by source: Lab milestones · Bounties · Referrals · Granted by HQ. Below: Spent on perk claims. "1 credit is worth $1 of perk value." | Source mapping:<br>• Lab = `lab:*` rules (`mig/381:48-75`)<br>• Bounties = `isBountyRule` (`wk/services/creditGrants.ts:61-63`)<br>• Granted by HQ = `manual` (`creditGrants.ts:282`)<br>• **Referrals: no rule exists** (`rg -i refer mig/381` → none; `grantCredits` callers are only tickets, bounties and the Lab: `wk/routes/admin_ticket_reviews.ts:225`, `wk/services/bugBounties.ts:178`, `wk/services/labMilestoneCredits.ts:80`, `:100`)<br>• Spends: no cross-member read<br><br>The $1 line is true (`mig/381:3`). | **N** for an Admin. A Super Admin can get P from `/grants` (≤200, grants only). The Referrals series must read "Not recorded" (dashed), never 0. |
| Catalogue head (`dc:358`) | "[9] programs", group chips | — | Static, once the registry exists |
| **Card: Spin-Out Lab** (`dc:341`) | "[7] applications waiting · [24] in the [Nov 2026] cohort", Needs you [9] | Cohort lane (E). Participants `admin.ts:1385` (E). Hosts pending (E). | **E** (client) |
| **Card: AI-native Venture** (`dc:342`) | Proposed; "HQ is writing the playbook." | — | Static (N store) |
| **Card: Mentor cohort access** (`dc:343`) | "[6] mentors · [3] of [4] cohorts covered", Needs you [2] | Assignments with **current** `advisor_role` (`advisors.ts:2970-2979`), plus cycles (`admin_cohort.ts:49` or `:246`). "Role changed" = active row whose role is not advisor. | **E** (client) |
| **Card: Investor cohort access** (`dc:344`) | "Not running" | — | Static |
| **Card: Referral partners** (`dc:345`) | "[12] partners · [9] with signed terms" | `users.referral_code`, `referrals`, `commissions` (`wk/routes/network.ts:25-36`). Rules are global (`:69-77`, seeds `:99-105`). Every admin read is Super Admin (`:570-571`, `:582-583`, `:935-936`). | **N**. No segment, no per-partner terms. |
| **Card: Refer & Earn** (`dc:346`) | "[48] referrals · [9] converted", Needs you [9] | List ≤200 with a status filter (`refer_earn.ts:256-283`). Strategic N. | **P** |
| **Card: Perks** (`dc:347`) | "[18] live · [42] claims", Needs you [3] | Live listings: `GET /api/perks` (`perks.ts:863-…`, ≤200, live and not ended). `claim_count` per listing (`perks.ts:409`). | Live **E**. Claims **W** if summed from that list: all-time, live perks only. |
| **Card: Learning** (`dc:348`) | "[4] programs · [126] learners" | `GET /api/learning/programs/mine`: the admin's assigned programs (all, for a Super Admin), each with active `learners` and `contents` (`learning_programs.ts:104-121`; client `fe/lib/api/learning.js:46`) | Programs **E**. Learners **W** if summed across programs; distinct needs the learner reads. |
| **Card: Product testing** (`dc:349`, `:357`) | Admin: "Runs at HQ", no figures, no Open: "Runs at HQ. Its page is for HQ only, so there is nothing to open here." | — | Static for an Admin |
| Status pill and grant badge on every card (`dc:354`) | — | — | **N** (registry plus #2376) |
| **Your proposals** (`dc:359-364`) | Program, Sent, Status, HQ's note, Open. Search, Status, Sort, "1–5 of [5]" | — | **N** |
| PG1h callout (`dc:491`) | "No subsidiary is deployed yet, so every admin works on accounts HQ holds and every program reads HQ-held." Chip "HQ-held accounts · axal.vc" | `HELD_SCOPE` (`fe/pages/admin/HeldZone.jsx:30-31`) | **E** |
| Eadwyn spine (`dc:536`) | "Eadwyn reads the program figures on this page. Nothing changes until you act." | `HeldZone` rail (`fe/pages/admin/HeldZone.jsx`) | E |

##### PG2 · Super Admin (`dc:474`, `dc:469`, `dc:365-370`; `boards:46`)

| Block | Drawn | State |
|---|---|---|
| HQ sidebar "Programs" row (`dc:509`) | New row in group HQ | **N**. The HQ group has no Programs row (`fe/sidebarConfig.js:110-148`). |
| "New program" | Registry write | N |
| Tabs "Catalogue · Proposals [2]" | Count of `Sent to HQ` | N |
| Scope "All studios" ("Figures across every studio."), "Studio: All ▾" (`dc:469`) | Per-branch figures | **N**. No branch is deployed (`fe/pages/admin/HeldZone.jsx:31`). HQ's glance reads HQ's own database only (`wk/services/studioGlance.ts:10-12` header in `admin_studio_glance.ts:10-12`). |
| Cards: "Granted to [n] studios" or "HQ only" (`dc:341-349`, `:351`). Needs-you hidden on HQ cards (`dc:354`). | Grant counts | **N** (#2376) |
| Product testing "[3] open · [48] applicants" (`dc:349`) | — | **P**. `GET /api/admin/testing/programmes`, Super Admin (`wk/routes/testing.ts:160-165`; client `fe/lib/api/productTesting.js:57`). |
| Callout "Which studio holds which program, and on what grant terms, is set on Licences › Program grants." / "Open Program grants" (`dc:369`) | Link | The link target is N |
| "Proposals from studios": Program, Studio, Sent, Status, Decide; filters Studio, Status, "Sort: Oldest first" (`dc:365-368`) | — | **N** |

##### PG3 · Dark (`dc:213`, `:216`, `:219`; `boards:47`)

No new data.
- Dark tokens exist (`fe/index.css:145-146`: `--app-bg: #0b1220`, `--app-surface: #111827`).
- The one-palette pattern with violet becoming `#a78bfa` is already in Insights (`fe/pages/admin/insights/InsightsCharts.jsx:11-31`; `PALETTE` `insightsModel.js:61`).
- Reuse it. No chart tokens exist in `index.css` (`rg -- "--chart|--series" fe/index.css` → none).

---

#### 6. Owner decisions the canvas implies, and which it answers

##### 6.1 The five named in the issue (`/tmp/…/issue2371.md:482`)

| Decision | What the approved canvas says | Answered? | Code today |
|---|---|---|---|
| **Explorers in Refer & Earn** | Settings board "Who can refer", note "Settings · Refer & Earn": Founders on, Investors on, Advisors on, Partners on, **Explorers off**, no lock (`dc:493`). But the card reads "Who: Every member · Join: Open" (`dc:346`, `:413`), and a queue sample row has a referrer "[Name] · Explorer" (`dc:420`). | **Partly.** The canvas makes it a per-studio switch an Admin may set, drawn default off. It contradicts itself ("Every member", an Explorer referrer). The owner confirms the default and whether a studio may flip it. | `/referrals` admits `['admin','founder','partner','investor','advisor']`, so no Explorers (`fe/App.jsx:3493`). The Worker only asks for sign-in (`refer_earn.ts:95`, `:141`). The role is `exploring` (`approvalSources.ts:198`). No "who can refer" store. |
| **Reward credit amounts** | Rewards card, locked: "Startup or founder — [100] credits on acceptance, [400] on formation"; "Platform user — [50] credits once onboarded"; "Strategic and capital — Agreed case by case"; foot "Credits are spent on Perks. HQ sets the rewards." (`dc:418`). The drawer's Reward field reads "[100] credits on acceptance" (`dc:422`). "Rewards issued [6] ([600] credits)" (`dc:415`). Credits chart has a "Referrals" source (`dc:311`). | **Shape yes, amounts no.** Who sets them: HQ. The rewards are credits, and the milestones are acceptance and formation, onboarded, and case by case. The bracketed numbers are samples. | The same shape is written as text: `CATEGORY_META.reward` (`wk/services/referralSubmissions.ts:80`, `:88`, `:96`). Statuses include `reward_eligible`, `reward_issued` (`:23-27`). Rewards are "milestone labels settled off-platform" (`refer_earn.ts:44-46`); `rewardLabel` is free text (`:295`). Amounts belong in `credit_reward_rules`, where "no amount is written in code" (`mig/381:4-9`). No referral rule exists, so the owner supplies defaults as for #1102 Q3 (`mig/381:8-9`). |
| **What "verified investor" means** | "Verified investors follow one Lab cohort…" (`dc:344`, `:436`), "Who: Verified investors" (`dc:436`), pills `Verified` / `Not verified`, "Waits for verification" (`dc:440-442`), "INVESTOR · VERIFIED ONLY" (`dc:444`) | **No.** The canvas uses the word and never defines it. | Candidates, none named "verified": KYC (`trust.ts:74`; `users.kyc_status`, `approvalSources.ts:169`), accreditation (`trust.ts:75`), investor NDA (`:73`), investor tier (`requireInvestorTier.ts:46-49`), approved LP application (`approvalSources.ts:106`) |
| **AI-native Venture playbook** | Every section `[to be set]` / "Not set": Thesis, Who it is for, Length, Seats per cohort, Capital terms, Contracts. Tools `[Eadwyn, Spin-Out Lab modules]`. Card "Who: Founders · Join: Not set", "HQ is writing the playbook." (`dc:342`, `:458`). Super Admin: "Edit playbook", "Publish", "Offer to studios" (`dc:495`). | **Only where it sits:** group Ventures, status Proposed, HQ-only until offered, founders as audience. The content is unanswered. | Nothing (§3) |
| **Profiling trends removal** | Not among the nine cards (`dc:340-349`) or the groups (`dc:358`) | **Partly.** It leaves Programs. The canvas does not say whether it is deleted or moves (for example to Insights). | Still a card (`fe/pages/admin/HeldPrograms.jsx:69-76`), route (`fe/App.jsx:2824`), sidebar `match` (`fe/sidebarConfig.js:229`), rail map (`fe/lib/railPages.js:283`) and rail option (`fe/lib/railOptions/admin.js:65`). Insights (D893) does not include it: `rg -i profiling.trends` in D893.md and `insights/` → none. |

##### 6.2 Further decisions the canvas implies

| Decision | Canvas | Answered? | Code |
|---|---|---|---|
| Per-cohort NDA vs pairwise NDA | "The investor signs the cohort NDA first." / "NDA TEMPLATE [Cohort NDA v2]" (`dc:438`, `:444`) | Says one NDA per cohort; no template exists | Pairwise founder↔investor only (`mig/025:47-60`) |
| Founder accept/decline of intro requests | "goes to the founder, who accepts or declines" (`dc:438`) | Yes, as behaviour | No write exists (§2) |
| Who decides a proposal, and the options | Four options plus a required note (`dc:496`) | **Yes** | N |
| Proposal statuses | `Draft · Sent to HQ · Approved · Sent back · Declined` (`dc:325`) | **Yes** | N |
| Who pauses a program, and the effect | "Pause program (Super Admin)" (`dc:371`). "New sign-ups stop. People already in keep their access. Members see 'Paused'." (`dc:498`) | **Yes** | No program status (§4) |
| Product testing for a plain Admin | "Runs at HQ", no link (`dc:349`, `:357`) | **Yes** | — |
| Grant badge words | `dc:324` | **Yes** (#2376 must use the same words) | — |
| Custom partner terms: chain and payout | Draft → Approved by HQ → Sent for signature → Signed → Active. Payout "Bank transfer · ending [4821]" or "Credits". "Terms take effect only when signed. Until then the standard rules apply." (`dc:411-412`) | **Yes**, including commissions payable as **credits** (new) | Global rules only (`network.ts:69-77`, `:99-105`). Templates `partner_custom` and `finders_fee_intro_agreement` (`wk/routes/admin_contracts.ts:306`, `:309`, `:357-358`; seed stub `mig/085:1675`). |
| Who sets standard rules | Lock and "HQ sets the standard rules." (`dc:398`) | **Yes** | Super Admin only (`network.ts:614-615`) |
| Who grants credits | "A Super Admin grants credits." (`dc:435`). PG10s reason at least 10 characters (`dc:494`) | **Yes**, and it matches code | `perks.ts:783-798`; `admin_credit_rules.ts:14-16` |
| **S1's calls (not owner)** | "Overdue" past two days, and age buckets at 2 and 7 days (`dc:333`, `:337`) vs the code's 24 h / 72 h bands. The definition of "People taking part" (distinct members?). The definition of "Programs running" (Live only?). Which Lab store counts "Lab applications" (#2374). | Not answered | §5 |

---

#### 7. Issue #2371 cites that moved by HEAD

The issue's cites were taken on `537f646a3f`. Cites not listed here were re-checked and are unchanged: HeldPrograms.jsx, approvalSources.ts, refer_earn.ts, referralSubmissions.ts, perks.ts, advisors.ts, network.ts, lab_hosts.ts, testing.ts, admin_learning*.ts, auth.ts:523-528, creditGrants.ts:134, spinoutInvestorContent.js, 389, 206, 157:25.

| Issue cite | HEAD |
|---|---|
| `fe/App.jsx:2721` `/admin/held/programs` | `fe/App.jsx:2725` |
| `fe/App.jsx:2716-2718` (S20's five landings) | `:2720-2722` |
| `fe/App.jsx:2754` `/branch/programs` | `:2761` |
| `fe/App.jsx:2816` profiling-trends | `:2824` |
| `fe/App.jsx:2691` `/admin/refer-earn` | `:2695` |
| `fe/App.jsx:2696` `/admin/commissions` | `:2700` |
| `fe/App.jsx:2797` `/admin/credit-rules` | `:2805` |
| `fe/App.jsx:2806` `/admin/spinout-lab` | `:2814` |
| `fe/App.jsx:3273` `/admin/advisor-cohorts` | `:3287` |
| `fe/App.jsx:3479` `/referrals` | `:3493` |
| `fe/App.jsx:3164` event host | `/events/new` `:3178` |
| `fe/lib/api.js:3647` `adminStudioGlance` | `:3652` |
| `wk/index.ts:1081` glance mount | `wk/index.ts:1094` |
| `wk/index.ts:1303` lab-hosts mount | `:1327` |
| `wk/index.ts:1306` advisors mount | `:1330` |
| `wk/services/studioGlance.ts:210` `no_queue` | `:208` |
| `fe/sidebarConfig.js:109-148` HQ group | `:110-148` |
| `wk/routes/admin_contracts.ts:309`, `:358` | Unchanged. The title map is `:357-358`; the roles map is `:306`, `:309`. |

## Part C — the landing today and the admin shell

### The Programs landing today, and the admin shell around it

This is a snapshot, not a spec. It was read on branch `claude/spinout-lab-workspace-wuyyqd`.

- **HEAD moved while I read.** The task named `6205ee6`. HEAD is now `24136bf`: two commits, `6c355ff` and `24136bf`, landed on top.
  - `git diff --stat 6205ee6 24136bf` touches only the pitch studio files, `documentation/architecture/decisions/D894.md` and `design/incoming/README.md`.
  - No other file cited here changed, so every cite holds at both commits.
- **Path prefixes:**
  - `wk/` = `cloudflare-worker/src/`
  - `fe/` = `frontend/src/`
  - `mig/` = `cloudflare-worker/sql/migrations/`
  - `dc:` = `design/incoming/Programs Page.dc.html`
  - `dcB:` = `design/incoming/Programs · Boards.dc.html`
  - Tests are written out as `frontend/test/…`.

---

#### 1. `fe/pages/admin/HeldPrograms.jsx` (81 lines) and `fe/pages/admin/HeldZone.jsx` (73 lines)

##### 1.1 Route, guard and frame
| Item | Fact | Cite |
|---|---|---|
| Lazy import | `const HeldPrograms = lazy(() => import('./pages/admin/HeldPrograms'))` | `fe/App.jsx:143` |
| Route | `<Route path="/admin/held/programs" element={guard(['admin'], <HeldPrograms />)} />`. No `hqOnly`. | `fe/App.jsx:2725` |
| Route comment | "D286 — S20's five landings… never `hqOnly`". This is stale: four held landings remain, because D893 moved Insights out. | `fe/App.jsx:2720-2722`, `:2727-2730` |
| `guard` | `RequireAuth` → `RoleGuard(allowedRoles)` | `fe/App.jsx:2219-2225` |
| `RoleGuard` | A disallowed role gets `<Navigate to={ROLE_DEFAULT_PATH…} replace />`. A non-admin never sees the page, so PG19a is unreachable as drawn. | `fe/App.jsx:1819-1834` |
| `hqOnly` | `isSuperAdminUser(user) ? component : <SuperAdminOnlyNotice />`. This page does not use it. | `fe/App.jsx:2304-2306` |
| Frame | `<HeldZone workspace="Programs" stance="Four consoles, each opened where it is decided" coverage=[…] coverageNote=… unavailable=[…]>` | `HeldPrograms.jsx:24-32` |
| Header | `h1` "Programs" at `text-[18px]` (the canvas uses 24 px, `dc:528`), plus one muted line | `HeldPrograms.jsx:33-36` |
| Body | `<ul data-testid="held-programs-consoles">` of four `Card`s, each with one literal `<Link to=…>` | `HeldPrograms.jsx:37-78` |

##### 1.2 HeldZone, the frame and its one rail
- **Exports:**
  - `HELD_SCOPE = 'HQ-held accounts · axal.vc'` (`HeldZone.jsx:30`).
  - `HELD_SCOPE_NOTE`: "No branch is deployed yet… nothing here reads or links a page under /branch/" (`:31-33`).
  - This is a second copy of the chip text. Insights has its own, `SCOPE_LABEL` (`fe/pages/admin/insights/insightsModel.js:26`).
- **Props:** `workspace`, `stance` (default 'Read-only summary'), `coverage`, `coverageNote`, `unavailable`, `children` (`:35-42`).
- **The rail.** `<RailFrame rail={<WorkerRail workspace stance note coverage coverageNote unavailable role="admin" data-testid="held-rail"/>} data-testid="held-zone">` (`:47-61`).
  - `role="admin"` is hard-coded (`:51`), so a Super Admin also gets the admin-tier rail here.
  - `AdminBoardFrame` instead picks the rail by tier (`fe/pages/admin/AdminBoardFrame.jsx:25-33`).
- **The rail note is fixed:** "This rail reads HQ's own database…" (`:43-45`).
  - The canvas's note is "Eadwyn reads the program figures on this page. Nothing changes until you act." (`dc:536`).
- **The scope sentence** is a `<p data-testid="held-scope">` paragraph (`:62-69`).
  - It uses raw `slate-*` classes with `dark:` pairs (`:63`), not tokens.
  - The canvas draws a chip instead: `scopeS` at `dc:529`, and PG1h's chip at `dc:491`.
- **The docblock says "the five S20 landings"** (`:5`). That is stale, as is "Five rows are landings" (`fe/sidebarConfig.js:206-209`) and "the five `Held*.jsx` landings" (`fe/pages/admin/README.md:40`).

##### 1.3 What each card reads
There is one read: `useHeldGlance()` (`fe/pages/admin/heldFigures.jsx:15-33`).
- The chain: `loadStudioGlance()` (`fe/pages/admin/adminStudioOverview.js:356-362`) → `api.adminStudioGlance` (`fe/lib/api.js:3652`) → `GET /api/admin/studio/glance`.
- That route is `requireAdmin` (`wk/routes/admin_studio_glance.ts:30-37`, gate `:32`), mounted at `wk/index.ts:1094` (import `:241`).
- `laneOf(hq, key)` returns a lane only when `approvals.kind === 'ready'` (`heldFigures.jsx:39-41`).
- `Figure` has five states (`heldFigures.jsx:51-59`):
  - loading → "Reading…" (`:53`);
  - glance unreadable → `Unreadable` with `GLANCE_UNREADABLE` (`:54`, `:36`);
  - `null` → `Unreadable` (`:55`);
  - `undefined` → `Unrecorded` (`:56`);
  - a number (`:57`).

| # | Card (lines) | Copy | Figure | Door |
|---|---|---|---|---|
| 1 | "Spin-Out Lab applications" (`:38-47`) | "The applications queue, on the Admin Console's Lab tab." (`:41-43`) | `value={undefined}`: always "Not recorded". The reason is about `spinout_applications` not being a lane (`:44`). | `/admin?tab=lab-applications` (`:45`) |
| 2 | "Cohort calendar and applications" (`:48-57`) | "The Lab console: cohorts, their timing, grace and override, and the journey preview." | `laneOf(glance.hq,'cohort')` (`:21`) → `cohort.count` "cohort applications pending" (`:54`). This is `cohort_applicants WHERE status='pending'` (`wk/services/approvalSources.ts:132-142`). | `/admin/spinout-lab` (`:55`) |
| 3 | "Advisor cohort access" (`:58-67`) | "…Also an Approvals lane." (`:62`) | `value={undefined}`. The reason comes from the glance's `noQueue` (`:22`), which carries `NOT_LANED` (`approvalSources.ts:273`, sent as `no_queue` at `wk/services/studioGlance.ts:208`). | `/admin/advisor-cohorts` (`:65`) |
| 4 | "Profiling trends" (`:68-77`) | "Counts only; groups under 5 are hidden." | `value={undefined}`: "Not recorded" (`:74`) | `/admin/profiling-trends` (`:75`) |

The consoles behind the doors:
- **Cards 1 and 2 open one component, `AdminSpinoutLab`.**
  - Card 1 mounts it inside AdminPage (`fe/pages/AdminPage.jsx:238`), under the "Admin Console" h1 (`:215`) and the section dropdown (`:224-231`).
  - Card 2 mounts it standalone (`fe/App.jsx:2814`).
- **The Lab's eight sections are buttons over component state**, not addresses (`fe/pages/admin/AdminSpinoutLab.jsx:712-791`).
- **Card 3 opens `AdvisorCohortAssignments`.** Its default export is `AdminBoardFrame workspace="Advisor cohort access"` (`AdvisorCohortAssignments.jsx:257-262`). The body `AdvisorCohortAssignmentsBody` (`:39`) is not exported. Its route is `fe/App.jsx:3287`.
- **Card 4 opens `AdminProfilingTrends`**, framed as `AdminBoardFrame workspace="Profiling trends"` (`:207-211`).

##### 1.4 Honesty defects on this landing
1. **"Not recorded" on a count that is recorded.** Card 1's pending applications exist: the Lab's own tab counts them, `apps.filter(a => a.status==='pending')` (`AdminSpinoutLab.jsx:686`, `:721-722`), from `GET /api/admin/spinout-applications` (`wk/routes/admin.ts:1190`).
   - The figure is only absent from the glance.
   - `Unrecorded` means "the store was read and holds no value for this" (`fe/ui/Honesty.jsx:11-13`), which is not what happened here.
2. **"Not recorded" where the true state is "No queue".** Card 3 draws "Not recorded". HeldApprovals draws the same lane as "No queue" (`HeldApprovals.jsx:41-44`, `:98`).
3. **The reason is hover-only.** `Unrecorded` puts the reason in `title=` only (`Honesty.jsx:37-50`). On touch devices, cards 1, 3 and 4 show a bare "Not recorded".
4. **A failed glance is pinned on cards that read nothing.**
   - `Figure` checks `state.status` before `value` (`heldFigures.jsx:53-54`).
   - So when the glance fails, cards 1, 3 and 4 say "This count could not be read…", though no read backs them.
   - While the glance loads, all four say "Reading…".
5. **"Four consoles, each opened where it is decided" is false** (`:26`; the coverage string at `:27` repeats it).
   - There are three components, two cards share one, and Profiling trends decides nothing.
   - `coverage` also spells it "programme", while the canvas uses "program" (rule at `dc` words section; the issue's prompt).
6. **"Also an Approvals lane" (`:62`) is half true.** HeldApprovals draws lane 16 with "No queue" (`HeldApprovals.jsx:98`), and the placement map says the same (`fe/lib/adminPlacement.js:72-73`). But the Worker does not lane it (`approvalSources.ts:269-274`).
7. **"Cohort calendar…" promises a calendar the console cannot move.** No `UPDATE week_windows` exists. The comment `fe/pages/branch/BranchPrograms.jsx:21-27` measures this.
8. **Profiling trends is not a program.** The canvas lists it under "DO NOT DRAW… Profiling trends. It leaves Programs."
9. **The old look.**
   - The title is 18 px (`:33`).
   - The scope note is a paragraph with raw slate classes (`HeldZone.jsx:62-69`).
   - The rail tier is fixed to admin (`HeldZone.jsx:51`).
   - Card 1's door lands under an "Admin Console" title and dropdown (`AdminPage.jsx:215`, `:224-231`), which the canvas forbids.
10. **The Lab console decides with browser pop-ups:**
    - `window.confirm` (`AdminSpinoutLab.jsx:203`);
    - `alert` (`:213`, `:215`);
    - `window.prompt` (`:661`), then `alert` (`:666`).

---

#### 2. Every place that names the addresses

`/admin/programs`, `/admin/platform/product-testing`, `/admin/licences/programs` and `/admin/my-licence/programs` do not exist. Searches:
- `rg -n "admin/programs" frontend/src cloudflare-worker/src frontend/test scripts documentation/architecture` returns nothing.
- `rg -n "admin/platform/product-testing|licences/programs|my-licence/programs" frontend cloudflare-worker/src scripts documentation` returns nothing.
- No store for programs, grants or proposals exists either. `rg -i "program_grant|licence_program|programme_grant|program_proposal|program_registry"` over `cloudflare-worker/sql`, `wk` and `fe` returns nothing. The only program tables are `learning_programs`, `learning_program_contents` and `learning_program_admins` (`mig/389_learning_programs.sql:19`, `:34`, `:46`) and `testing_programmes` (`mig/516_product_testing.sql:18`).

| Address | Route and guard | Sidebar | Placement (`fe/lib/adminPlacement.js`) | Rail keys (`fe/lib/railPages.js`) | Rail boards (`fe/lib/railOptions/admin.js`) | Other references |
|---|---|---|---|---|---|---|
| `/admin/held/programs` | `fe/App.jsx:2725`, `guard(['admin'])`, not hqOnly | The Admin row `to` (`fe/sidebarConfig.js:228`) | none (it is not a legacy row) | `own(…, 'Admin · Programs')` `:280`; the branch twin `alias('/branch/programs', …)` `:281` | S19 Programs `:61`, `files ['pages/admin/HeldPrograms.jsx']`, `rail: HELD` (HeldZone) | `ADMIN_ROW_ROUTE` is derived from the sidebar (`fe/lib/hqStrips.js:87-90`). The Studio card target (`fe/pages/admin/AdminStudioOverview.jsx:25-29`, card `:275`) and the tile (`fe/pages/admin/StudioNeedsDecision.jsx:36`, "Programme" → sidebar "Programs") both read the row. Docs: `documentation/architecture/PAGE_INVENTORY.md:69`, `:134` (generated); `DECISIONS.md:28889` (D286); `D893.md:16` |
| `/admin/advisor-cohorts` | `fe/App.jsx:3287`, `guard(['admin'])` | In the Programs row's `match` (`sidebarConfig.js:229`) | `row('Advisor Cohort Access', …, admin('Programs','card link'), also Approvals lane)` `:72-73` | `own(…, 'Admin · Approvals · Advisor cohort access')` `:279`; board alias "Programs · Advisor cohorts" → that key `:387` | S18 (Approvals, owner) `:60`; S21 (Programs, alias of S18) `:63`; both `rail: FRAME` | HeldApprovals lane 16 (`fe/pages/admin/HeldApprovals.jsx:98`); `NO_QUEUE_CONSOLES['Advisor cohort access']` (`adminStudioOverview.js:386`); `HeldPrograms.jsx:65`; `documentation/architecture/ROUTE_MAP.md:915` → `PROFILE_ROUTING.md:115`; `D720.md:63` |
| `/admin/refer-earn` | `fe/App.jsx:2695`, `guard(['admin'])` | In the Approvals row's `match` (`sidebarConfig.js:227`) | `row('Referral Review', …, admin('Approvals','lane'))` `:85` | `own(…, 'Admin · Approvals · Referrals')` `:270` | S9 `:51`, `ReferralReview.jsx`, `rail: FRAME` | Title "Referral review" (`ReferralReview.jsx:68`). It is the only door to `/admin/commissions` (`:76-82`). HeldApprovals lane 2 (`HeldApprovals.jsx:84`); `LANE_CONSOLES.referrals` (`adminStudioOverview.js:369`); `BranchApprovals.jsx:607` |
| `/admin/spinout-lab` (and `/preview`) | `fe/App.jsx:2814`, `:2819`, `guard(['admin'])` | In the Programs row's `match` (`sidebarConfig.js:229`) | none: reached through the `lab-applications` tab entry (see the d286 test at `:225`) | `own(…, 'Admin · Programs · Spin-Out Lab')` `:282`; `NO_RAIL_ROUTES` `:460-461` (D317) | S12 (Approvals · Spin-Out applications, owner) `:54`; S20 alias `:62`; `rail: null`, `noRail: SPINOUT` (`:35`) | HeldApprovals lane 3 (`:85`); `LANE_CONSOLES.cohort` (`:370`); `BranchApprovals.jsx:611`; `BranchPrograms.jsx:315`; `ContractsDesk.jsx:55` and `consoles/LegalConsole.jsx:190`, both already reading "Programs › Spin-Out Lab" |
| `/admin/profiling-trends` | `fe/App.jsx:2824`, `guard(['admin'])` | In the Programs row's `match` (`:229`) | none | `own(…, 'Admin · Programs · Profiling trends')` `:283` | S23 `:65`, `rail: FRAME` | `HeldPrograms.jsx:75` is its only door; `PROFILING_V2.md:801` |
| `/admin?tab=lab-applications` | `/admin` at `fe/App.jsx:2693`; tab `fe/pages/AdminPage.jsx:48`, mount `:238`; `tabBoard` gives null (`:160`) | lit by query through `adminRowFor` (`hqStrips.js:110-116`) | `tab('lab-applications', …, admin('Programs','embedded'))` `:101` | `own(…, 'Admin · Approvals · Spin-Out applications')` `:274` | (S12's files) | `HeldPrograms.jsx:45`; `AdminSpinoutJourneyPreview.jsx:190` |
| `/perks`, Review tab | `fe/App.jsx:2956`, the six-role guard. The tab is component state, not a URL (`fe/pages/PerksPage.jsx:1669`, `:1697`, `:1740`). | the founder Grow row `match` (`sidebarConfig.js:352`) | `page('More','Perks','/perks',…)` `:146`; `PAGE_HOMES` `:199` | `NO_RAIL_ROUTES` `/perks` `:441` (owner: no rail) | — | client `perkReviewQueue` (`fe/lib/api.js:3398`) → `GET /api/perks/admin/queue` (`wk/routes/perks.ts:767`) |
| `/admin/commissions` | `fe/App.jsx:2700`, `guard(['admin'], hqOnly(…))`. The comment above it (`:2696-2699`) says "never `hqOnly`", which contradicts the code. | none | none | `off(…, 'Admin · Home')` `:257` | — | the only door is `ReferralReview.jsx:78`; RENDER offCanvas list (`frontend/test/_airailRender.mjs:235`) |
| `/admin/credit-rules` | `fe/App.jsx:2805`, hqOnly; `/hq/credits` redirect `:2807` | HQ Platform `match` (`sidebarConfig.js:136`) | none | `own(…, 'Super Admin · Platform · Credit rules')` `:353` | Super Admin H31 (`railOptions/superAdmin.js:73`) | doors `fe/pages/hq/PlatformPage.jsx:1033`, `ReviewQueuePage.jsx:387` |
| `/learning/studio/programs[/:program]` | `fe/routes/learning.jsx:45-46`, hqOnly. The Admin's `/learning/programs[/:program]` is plain admin (`:42-43`). | none | none | under `off('/learning', …)` in SHARED (`railPages.js:80`); `/learning` home has no rail (`:442`) | — | `fe/pages/learning/ProgramStudio.jsx:32`, `:55`; `LearningStudio.jsx:82` |
| `/admin/platform/product-testing` | **does not exist.** Today it is `/admin?tab=product-testing` (`AdminPage.jsx:57`, `:245`; `consoles/ProductTestingConsole.jsx:14`, holder-only `:39`). Member `/product-testing` → `/studio` (`fe/App.jsx:3032`). | HQ Platform strip (`fe/App.jsx:1099`; `hqStrips.js:35`) | `tab('product-testing', …, hq('Platform','sub-nav'))` `:114` | — | — | — |
| `/branch/programs` | `fe/App.jsx:2761`, `guard(['admin'])`. It refuses on HQ (the comment at `HeldZone.jsx:11-13`). | branch_admin row (`sidebarConfig.js:179`) | — | alias `:281` | — | links `/admin/spinout-lab` (`BranchPrograms.jsx:315`) |

The redirect inventory and precedents:
- **The Worker's list:** `wk/services/redirectRoutes.ts:30-138`, where `/admin/held/insights` sits at `:137`. It is held equal to App.jsx by `frontend/test/redirect_hits_2301.test.mjs:24-52`. `keep` and the 2027-01-19 retirement are at `:22-26`.
- **Precedents:**
  - `HeldInsightsRedirect` (`fe/pages/admin/insights/HeldInsightsRedirect.jsx:12-17`) is unguarded, keeps the query and hash, and adds `?moved=held-insights` (`insightsModel.js:23-25`).
  - `PitchWorkspaceMoved` (`fe/pages/raise/pitch/PitchWorkspaceMoved.jsx:12-15`) is chosen inside the `/raise/pitch` route (`fe/App.jsx:2912-2915`), so it is not counted (`D894.md:22-23`).
  - `HqCreditsRedirect` (`fe/App.jsx:2807`).

---

#### 3. Tests that pin any of this, and what a new address must satisfy

##### 3.1 Pins by file
| Test | Line | Pins |
|---|---|---|
| `held_admin_shell_d286.test.mjs` | `:47` | It reads **App.jsx only**, not `fe/routes/*` modules, so a route in a module reads as "not registered" here. |
| | `:52-57` | `LANDINGS.Programs = HeldPrograms.jsx` |
| | `:77-89` | The admin rows' labels (nine) and `to`s, including `'/admin/held/programs'` (`:83`) |
| | `:90-96` | Every row `to` and every `match` entry is a registered path (`path="…"` exact) |
| | `:108-119` | Each landing's row `to` starts with `/admin/held/` (`:111`), is `guard(['admin'])` without hqOnly, is lazy-imported, and renders `<HeldZone` (`:118`) |
| | `:123-125` | The Programs row has a `match` list |
| | `:131`, `:139` | Programs draws exactly 4 literal doors; no `.map(…<Link` |
| | `:145-173` | The Studio "Programs" card's href equals the row `to` (`:155`, `:168`) |
| | `:181-232` | S22's 16 lanes verbatim: lane 2 `/admin/refer-earn` (`:183`), 3 `/admin/spinout-lab` (`:184`), 16 `/admin/advisor-cohorts` (`:198`). Each lane console must be placed on Admin · Approvals in the H35 map (`:221-231`). |
| | `:246-251` | Programs' doors are exactly `['/admin?tab=lab-applications','/admin/spinout-lab','/admin/advisor-cohorts','/admin/profiling-trends']` |
| | `:297-306` | The orphans, including `/admin/refer-earn` and `/admin/advisor-cohorts`, need a literal door on a row or a landing |
| | `:319`, `:326` | `adminRowFor('/admin','?tab=lab-applications') === ADMIN_ROW_ROUTE.Programs`; `adminRowFor('/admin/held/programs','') === null` |
| | `:350`, `:355-365` | HeldZone has `role="admin"`, the `held-scope` sentence, exactly one `<WorkerRail>`, and no landing mounts its own rail |
| `admin_route_reachability.test.mjs` | `:81`, `:92` | Routes split on `'\n      <Route'` (6-space indent). A redirect is `Navigate`, or a lone `*Redirect` element. |
| | `:252-260` | `SECOND_MOUNTS`: a routed component imported by another routed component must be declared (checked `:599-616`) |
| | `:269-285` | `COMPOSED`: files a routed page renders whose doors count. Licences (D800) is the precedent; each must be imported by its host (`:618-635`). |
| | `:353-381` | EXEMPT. The comment at `:375-380` records why `/admin/spinout-lab` needs no entry. |
| | `:425-436` | Every non-redirect `/admin/*` route is reachable by BFS from the sidebar rows plus chrome |
| | `:438-452` | Nothing is reachable from the branch shell only |
| | `:454-459` | No dangling and no ambiguous `/admin` link |
| | `:461-490` | `REDIRECTS` deepEquals `['/admin/held/insights','/admin/news']` (`:464`). `COMPONENT_TARGETS = { HeldInsightsRedirect: '/admin/insights' }` reads `insightsModel.js` by hand (`:468-474`). |
| | `:637-651` | The Lab preview button must sit inside `body` |
| `admin_placement_h35.test.mjs` | `:44-78` | `LEGACY_ROWS` by value, including `/admin/advisor-cohorts` (`:50`) and `/admin/refer-earn` (`:52`); 34 rows (`:126`) |
| | `:96-102` | The hqOnly flag is read from the first line of each `<Route` |
| | `:154-171` | No placement outside the legacy set (no new `/admin/programs` entries) |
| | `:173-201` | Every placed `route` is registered, and the hqOnly flag equals App.jsx's |
| | `:203-228` | Placement rows must be in `ADMIN_ROWS`/`HQ_ROWS` (`adminPlacement.js:33`, `:35`). Both are stale prose: 8 and 11 rows, while the sidebar draws 9 and 13. |
| `rail_options_admin_d774.test.mjs` | `:63-72` | The board IDs and names are the AIRail canvas's Admin profile (`design/incoming/airail-every-page-data/canvas.json:183`: Programs = Spin-Out Lab, Advisor cohorts, Assessment runs, Profiling trends), S22 retired. **No new boards.** |
| | `:74-91` | Every board's files exist, and its `rail` file mounts `<WorkerRail>`. A rail-less board is in `NO_RAIL_ROUTES`, and its files mount neither a rail nor a frame. |
| | `:93-103` | An alias's owner comes first, shares the route, files and rail |
| | `:105-115` | The framed list `['S3','S4','S8','S9','S10','S11','S15','S16','S17','S18','S23','S31','S39']` (`:107`). Each file's default export is only `<AdminBoardFrame workspace=…>`. |
| | `:141`, `:152` | The lab-applications tab draws no frame and no rail |
| `rail_pages_d768.test.mjs` | `:29-54` | 204 canvas keys, two retired (`:33`). Every canvas key is reached by a route or alias. Every owned key is on the canvas or flagged `offCanvas`. |
| | `:59-80` | Every route that draws a rail has a key for some role its guard admits (admin → `['admin','super_admin']`, `:57`), or is in `NO_RAIL_ROUTES` |
| | `:82-97` | One owner per key; an alias needs an owner |
| `airail_render_admin_d781.test.mjs` | `:12` | Through `_airailRender.mjs`: every Admin route in `RAIL_PAGES` renders in the real App as `{role:'admin', is_super_admin:0}` (`:61`). In a 503 or `{}` state it must draw **exactly one** `aside.fwr` with `pageKeyFor(landed)` (`:380-392`). |
| | | `RENDER_NOT_YET` 2100 holds `/branch`, `/admin/fund-admin`, `/admin?tab=lab-applications`, `/admin/spinout-moderation`, `/admin/spinout-lab`, `/admin/wellbeing` (`:171-176`). The rule is "Delete a line when its route passes; never add one" (`:150-153`). |
| | | A no-rail route passes only with `railCount: 0` and `pageTestIds` (`:390-391`). |
| `airail_every_page_d781.test.mjs` | `:164-177` | 204 keys and an empty `NOT_YET` |
| `hq_studio_figures_d555.test.mjs` | `:82-85` | Every `LANE_CONSOLES`/`NO_QUEUE_CONSOLES` target is a literal `to="…"` in HeldApprovals.jsx |
| | `:186-199` | HeldPrograms.jsx exists and uses `useHeldGlance()` (`:189`) and `laneOf(glance.hq, 'cohort')` (`:198`) |
| `profiling_trends_d358.test.mjs` | `:25`, `:90-96` | It reads HeldPrograms.jsx. It pins the exact sidebar string `match: ['/admin/spinout-lab', '/admin/advisor-cohorts', '/admin/profiling-trends'] }` (`:93`), the Programs `Link` with `className={OPEN}` (`:94`) and the `stance` string (`:95`). |
| `advisor_cohorts.test.mjs` | `:184-187` | `path="/admin/advisor-cohorts"` and `guard(['admin'], <AdvisorCohortAssignments />)`, and that sidebarConfig names `/admin/advisor-cohorts` |
| `partner_earnings_d569.test.mjs` | `:836`, `:841` | The commissions route stays `hqOnly`; `ReferralReview.jsx` holds `to="/admin/commissions"` |
| `credit_rules_page_d638.test.mjs` | `:163-167` | The credit-rules route, its doors and the Platform `match` |
| `super_admin_shell.test.mjs` | `:44-50` | Every HQ row is a registered path |
| | `:52-79` | 13 HQ labels exactly (`:67`): no Programs |
| `hq_licences_h2h3.test.mjs` | `:240-245` | The "ELEVEN rows" sentence (`sidebarConfig.js:87-88`) names its eleven |
| `subsidiary_shell_s0.test.mjs` | `:62-65` | The branch rows, including Programs |
| `branch_programs_s4.test.mjs` | `:70` | `/branch/programs` → BranchPrograms. Also `branch_rail_mount.test.mjs:447` and `branch_approvals_board_d130.test.mjs:140-160` (lane consoles must be registered paths). |
| `rail_admin_tabs_super_admin_d775.test.mjs` | `:64`, `:72` | The Lab tab stays rail-free |
| `workspace_frame_contract.test.mjs` | `:249-271` | No `*Spinout*`/`*SpinOut*` page file mounts WorkerRail or AssistRail |
| `redirect_hits_2301.test.mjs` | `:24-52` | The REDIRECT_ROUTES list equals App.jsx plus the route modules' redirect-only routes |
| `profile_routing_fresh.test.mjs` | `:20-27`, `:37-108` | The generated docs are fresh. **ROUTE_MAP rows = 149** (`:103`; the last bump was D906). D915's Events desk adds no row at HEAD. |
| `licences_page_d800.test.mjs` | `:44-58` | Six Licences tabs. Matters for #2376's `/admin/my-licence/programs`. |
| `hq_subnav_h36_d285.test.mjs` | `:65` | The Platform strip's Product testing is `/admin?tab=product-testing` |
| `learning_ui_d562.test.mjs` | `:169-171` | The learning studio routes are `hqOnly` |
| `product_testing_ui_d815.test.mjs` | `:300` | The AdminPage product-testing tab mount |
| `dark_skin_d265.test.mjs` | `:66-102` | The compiled skin (`.dark [data-app-main]`) repaints `bg-white` and the rest outside `@layer`. An element with its own `dark:` class opts out. **No per-page dark-mode test exists for admin pages.** `rg -l "dark:" frontend/test` lists no held or admin file. |

##### 3.2 What a new `/admin/programs/*` address, with per-program pages and tabs, must satisfy
1. **The reachability walk.**
   - Register every route in **App.jsx** on one line at 6-space indent. d286 reads only App.jsx; h35 reads the hqOnly flag off the first line.
   - Static addresses (seven keys by seven tabs, plus propose and proposals) each need a literal `to="…"` door in a routed file or a `COMPOSED` file.
   - Alternatively, `/admin/programs/:key` and `/admin/programs/:key/:tab`: one literal door each suffices, because `toRoute` takes a static route first and matches dynamic ones at strict arity.
   - Tab strips are written out as literal `NavLink`s (the D800 pattern, `fe/pages/subsidiary/LicenceFrame.jsx:50-88`).
   - Do not link `/admin/programs/spinout-lab` until #2374 registers it; until then the link dangles (`:454-459`).
   - Keep `ReferralReview`'s `/admin/commissions` door in whatever file draws the Refer & Earn queue.
2. **D781 rail render.**
   - Each new `RAIL_PAGES` Admin route must draw **one** rail, keyed `pageKeyFor(landed)`, as a plain admin, even when every read 503s.
   - So the frame must draw the rail before data arrives (HeldZone and RailFrame do).
   - Never mount an existing default export: `AdvisorCohortAssignments` and `ReferralReview` each wrap `AdminBoardFrame`, which would draw a second rail. Export their `*Body` (`AdvisorCohortAssignments.jsx:39`, `ReferralReview.jsx:40`) and credit the file in `COMPOSED`.
   - New lines cannot be added to `RENDER_NOT_YET`.
3. **D768 page keys.**
   - Replace `own('/admin/held/programs', …)` (`railPages.js:280`) with `own('/admin/programs', 'Admin · Programs')`. Two owners of one key fail `:82-97`.
   - A non-exact entry answers every path below it, including any future `/admin/programs/spinout-lab`. The Lab would then take a Programs key unless it is listed in `NO_RAIL_ROUTES` with `railCount: 0`.
   - Any new key (for example "Admin · Programs · Mentor cohort access") is off the canvas. It must be `off()`, and it has no matrix row, so the rail's model read answers 404 `unknown_page` (`wk/routes/ai.ts:458-464`).
   - Reusing `Admin · Programs` needs no Worker change.
   - The canvas boards "Approvals · Advisor cohort access", "Approvals · Referrals" and "Programs · Advisor cohorts" must stay reached, by a route or an alias.
4. **D774 board rows.**
   - Update S19's `route` and `files` to the new file; its `rail` file must mount WorkerRail.
   - If `/admin/refer-earn` or `/admin/advisor-cohorts` become redirects, S9, S18 and S21 need the new route and files, and the `:107` framed list changes.
   - No board can be added for Mentor, Referral partners, Perks and the others.
5. **Placement (h35).**
   - Add no entries.
   - The legacy keys `/admin/advisor-cohorts` and `/admin/refer-earn` stay. Their `route` may be overridden to the new address, as `tab('legal')` does with `{ route: '/admin/contracts' }` (`adminPlacement.js:102-103`).
   - The hqOnly flag must match the new route's first line.
6. **`held_admin_shell_d286`.**
   - Remove Programs from `LANDINGS` and add an Insights-style separate check (precedent `:58-59`, `:102-107`).
   - Update the rows `to` (`:83`), the door count and list (`:131`, `:246-251`), and the lanes (`:183`, `:198`) if consoles move.
   - Every `match` entry must be a registered path.
   - `NavLink`'s `end` makes a row exact unless `match` covers the subtree. Use `match: ['/admin/programs', …]` (`fe/ui/SidebarNav.jsx:211-213`, `:252-262`).
7. **Folder docs.**
   - A new `fe/pages/admin/programs/` needs naming in `fe/pages/admin/README.md`, which is DOCUMENTED and must name every subfolder (`scripts/check-folder-docs.mjs:198-206`).
   - At 8 or more source files it needs its own README and a `DOCUMENTED` entry (`:181-192`, `HEAVY_FILES = 8`).
   - Deleting `HeldPrograms.jsx` while `fe/pages/admin/README.md:43` still names it fails the TRUTH rule.
8. **Dark mode.**
   - Pair explicit `dark:` classes, as AdminInsights does.
   - Charts reuse `InsightsCharts.jsx` `FILL`/`STROKE` (`:18-35`), where only violet flips to `#a78bfa`. That matches PG3's rule.
9. **Profile routing count.** Add an "Admin · Programs" ROUTE_MAP row, regenerate (`node scripts/build-profile-routing.mjs`), and bump `:103` from 149 to 150, or to 151 if the Events desk lands a row first.
   - **Trap:** the generator takes the backticked paths of the *live* cell over the proposed ones (`scripts/build-profile-routing.mjs:281-291`).
   - D893's row backticks only `/admin/held/insights` (`ROUTE_MAP.md:886`), so `PAGE_INVENTORY.md:73` reads "Insights … no canvas".
   - Backtick `/admin/programs` in the live cell.
10. **Other pins.**
    - `hq_studio_figures_d555:186-199` and `profiling_trends_d358:25`, `:90-96` read HeldPrograms.jsx. Delete or update them in the same change.
    - Redirects add `REDIRECT_ROUTES` entries and the reachability `REDIRECTS` list.

---

#### 4. Super Admin and Admin

- **Elevation, not a role.** `isSuperAdminUser(user)` is `Number(user?.is_super_admin ?? 0) === 1` (`fe/lib/shellRole.js:28-30`).
  - `shellRoleFor` picks `branch_admin` first (a `/me.branch` code), then `super_admin` when elevated and `hqView` (`:78-93`).
  - `hqView` comes from localStorage `hqView`, default on (`:96-103`; state at `fe/App.jsx:1877`).
  - The shell is a sidebar, never a permission (`shellRole.js:4-9`).
- **One sidebar shell at a time.** `getSidebarGroups` returns `SIDEBAR_GROUPS[shellRoleFor(...)]` (`fe/App.jsx:690-721`).
  - A Super Admin in HQ view sees only the HQ group: 13 rows, `sidebarConfig.js:109-148`, with no Programs row.
  - So `/admin/held/programs` has no door in the HQ shell. They reach it by switching to Admin view.
- **The rail on Programs today.** A Super Admin on `/admin/held/programs` gets HeldZone's admin-tier rail (`HeldZone.jsx:51`).
  - `RAIL_PAGES['Super Admin']` has no Programs or Insights key (`railPages.js:315-365`), so the HQ shell's page key there is null.
  - The airail canvas has no Super Admin · Programs section (`canvas.json:208`, the profile keys).
- **Gates:**
  - Client: `hqOnly` (`fe/App.jsx:2304-2306`) renders `SuperAdminOnlyNotice` ("This console belongs to the Super Admin…", `fe/pages/hq/SuperAdminOnlyNotice.jsx:27-52`).
  - Worker: `requireSuperAdmin` = `requireAdmin` + not a branch + `isSuperAdmin` (`wk/auth.ts:692-697`, `:669-672`); `requireAdmin` includes the freeze refusal (`:523-528`).
- **The HQ chrome.** The sub-navigation strip is literal (`fe/App.jsx:1082-1110`), drawn from `HQ_STRIPS` (`hqStrips.js:26-48`).
- **What PG2 would need:**
  - an HQ row "Programs" after Licences (`dc:509`), which changes `super_admin_shell.test.mjs:67`;
  - "New program", a Catalogue/Proposals tab strip with an amber count, the "All studios" scope chip and a "Studio: All ▾" filter (`dc:469`);
  - "Granted to [n] studios"/"HQ only" on each card (`dc:341-349`, `card(…,'hq')` `dc:350-357`), a "Proposals from studios" table (`dc:365-368`) and the callout (`dc:369`).
  - **None of these has a store or read.** There is no registry, grant or proposal table (the searches in §2).
  - The nearest precedent is Insights' Super Admin scope. Its `ScopeSelect` offers HQ-held only, with `SCOPE_NOTE` "Subsidiaries appear here once they are deployed" (`AdminInsights.jsx:238-255`, `insightsModel.js:28`). `scopeState` sends a plain Admin to `noperm` (`insightsModel.js:623-628`), and #2662 adds subsidiaries.
  - PG19b's sentence ("Only HQ decides on proposals…") is not `SuperAdminOnlyNotice`'s. Wrapping `/admin/programs/proposals` in `hqOnly` would draw the wrong words.
- **Is any branch or subsidiary deployed? No.**
  - `ls infra/branches/` shows only `README.md` and `_example.json`. The README says this folder is the only place a deployment is declared (`infra/branches/README.md:1-7`).
  - `wrangler.toml` declares one production env, `name = "studioos"` (`wrangler.toml:551-552`).
  - `wk/services/tenancyScope.ts:64` leaves `admin` unscoped.
  - **A licence administrator whose branch is not deployed can exist on axal.vc.** The chrome draws "{brand} · on axal.vc / BRANCH · NOT DEPLOYED" from `api.myLicence()` (`fe/App.jsx:1122-1125`, `:1306-1320`; `fe/hooks/useBranchDeployment.js:26-38`). Otherwise it draws "HQ-held · axal.vc / HQ-HELD" (`:1321-1329`).
  - So the scope chip today is `SCOPE_LABEL` "HQ-held accounts · axal.vc" (PG1h, `dc:491`). "[Studio Lisbon]" is a sample, and no grant badge other than "HQ-held" can be true (`dc:351`).

---

#### 5. Conventions to copy

- **Page header** (D893), `AdminInsights.jsx:327-339`:
  - `RailFrame` around the page with its own `WorkerRail` (`:313-326`);
  - `h1` `text-[24px] font-extrabold tracking-[-.02em]` with `dark:` pairs;
  - a 13.5 px muted line;
  - mono "As of"/refresh controls (`:345-349`).
  - The canvas header matches: h1 24 (`dc:528`), lines 13 px (`dc:528`), crumb above the title (`dc:45`).
- **Scope chip:** `<span title={SCOPE_TITLE} … font-mono text-[11.5px]>{SCOPE_LABEL}</span>` (`AdminInsights.jsx:332`). The constants are at `insightsModel.js:26-28`; D915 §1 reuses them (`D915.md:33-34`). The canvas draws it on the catalogue only (`dc:469`, `catHead`); `prog()` sets none (`dc:471`).
- **Tab strip with literal NavLinks:** `LicenceTabs` (`LicenceFrame.jsx:50-88`), D800 §1 (`D800.md:16-19`). It scrolls on a phone (`:76-77`). The canvas's program tabs are `/admin/programs/<key>` for Overview and `/<tab>` for how-it-runs, people, queue, terms, settings and activity, with a Queue count that turns amber when above zero (`dc:470-471`, `dc:531`).
- **Crumbs:** "Programs › [Program]", Roboto Mono 11 px uppercase .07em muted, linking `/admin/programs`. On a phone it is "‹ Programs" (`dc:468`, `:471`, `:527`); PG20d uses "‹ People" → `/admin/programs/mentor-cohorts/people` (`dc:508`). Precedent: D915's crumb (`D915.md:28-30`). Rail crumbs come from the key (`railPages.js:498-502`); a record view uses `useRecordCrumb` (`fe/pages/admin/useRecordCrumb.js:11-17`).
- **Lightbox dialogs:** `fe/ui/Lightbox.jsx` gives `role="dialog"`, a focus trap, Esc, inert behind it, and a full-screen sheet on a phone (`:5-50`). It is exported at `fe/ui/index.js:35`. PG8 is drawn as a centred lightbox, not a drawer (`dcB:52`). Never `window.confirm`/`prompt`/`alert`.
- **Phone sheets:** `fe/ui/phone/PhoneSheet.jsx`, `usePhoneWidth` (`fe/ui/Lightbox.jsx:2`). Insights uses both (`AdminInsights.jsx:8`, `:260`).
- **Charts:**
  - `InsightsCharts.jsx`: one palette (violet, sky, amber, emerald, muted; only violet flips) at `:11-35`; `PALETTE` at `insightsModel.js:61`.
  - D915's rule: "No second palette and no new `axal-*` token… moves them to `frontend/src/ui/` in its own commit" (`D915.md:165`).
  - The canvas palette is `dc:219`.
- **"Has moved":**
  - `HeldInsightsRedirect` keeps the query and hash, adds `?moved=<key>` and is unguarded (`HeldInsightsRedirect.jsx:12-17`; route `fe/App.jsx:2730`; counted at `redirectRoutes.ts:137`).
  - The page shows `role="status"` lavender with Dismiss, which removes `moved` (`AdminInsights.jsx:333-338`).
  - The in-route variant is `PitchWorkspaceMoved` (`App.jsx:2912-2915`; `pitchStudioModel.js:33-34`, `:57-60`); it is not counted.
  - The canvas's three sentences:
    - "Programs has a new address. Update your bookmark." (`dc:473`);
    - "Advisor cohort access is now Mentor cohort access, under Programs." (`dc:475`);
    - "Referral review is now Refer & Earn, under Programs." (`dc:415`).
  - The canvas draws "Dismiss" as text with an info glyph (`dc:272`); Insights uses a `×` labelled Dismiss.

---

#### Checklist for passing first time
1. Put `/admin/programs` and every sub-route in **App.jsx**, one line each at 6-space indent, `guard(['admin'], …)`. The catalogue gets no `hqOnly`. Give each a unique lazy name.
2. Sidebar Admin row: `to: '/admin/programs'`, `match: ['/admin/programs', …]`, every entry a registered path. Update `held_admin_shell_d286:83` and `profiling_trends_d358:93` in the same commit.
3. Move Programs out of d286's `LANDINGS` and add its own check (the D893 shape). Rewrite `:131` and `:246-251`. Update `hq_studio_figures_d555:186-199` and `profiling_trends_d358:25`, `:90-96` if `HeldPrograms.jsx` goes.
4. `/admin/held/programs` → `HeldProgramsRedirect`, unguarded, keeping the query and hash plus `?moved=`. Add it to `wk/services/redirectRoutes.ts`. Update the reachability `REDIRECTS` (`:464`) and generalise `COMPONENT_TARGETS` (`:468-474`).
5. Every tab and page reached by a literal door. Credit sub-files in `COMPOSED`, and declare any routed default import in `SECOND_MOUNTS`.
6. `RAIL_PAGES`: one `own('/admin/programs', 'Admin · Programs')`; drop `/admin/held/programs`. Keep every canvas board reached. Prefer the existing key, which has a matrix row, over new off-canvas keys, which have none.
7. Exactly one rail per page in every state. Never nest an `AdminBoardFrame`-wrapped default; export the bodies.
8. `railOptions/admin.js` S19: the new route, its files, and a rail file that mounts WorkerRail. Board IDs unchanged.
9. Placement: no new keys; route overrides only, with hqOnly matching.
10. Keep `ReferralReview`'s `/admin/commissions` door alive (`partner_earnings_d569:841`).
11. Link today's `/admin/spinout-lab` until #2374 registers the Lab's new address.
12. Folder docs: name `programs/` in `fe/pages/admin/README.md`, remove `HeldPrograms.jsx` there if deleted, and add a README plus a `DOCUMENTED` entry at 8 or more files.
13. A ROUTE_MAP row whose live cell backticks `/admin/programs`. Regenerate the docs and bump `profile_routing_fresh:103` with a dated comment.
14. `dark:` pairs on every surface, and the InsightsCharts palette. No `window.confirm`/`alert`.
15. "Not recorded" only where the store truly lacks the value. A failed read is Unreadable on the blocks it feeds, not on every block.

#### Open conflicts to settle
1. **Rail section against the sidebar.**
   - `/admin/advisor-cohorts` and `/admin/refer-earn` are keyed under **Approvals** (`railPages.js:270`, `:279`, `:387`; boards S9/S18/S21), while Programs is lit.
   - Under Programs they either take `Admin · Programs` and lose the board's identity, or keep "Approvals ·…" and record it as D915 did.
   - Moving the keys moves pinned board rows.
2. **The Approvals placement of Mentor cohort access.** The map's "also Approvals lane" (`adminPlacement.js:72-73`) and HeldApprovals lane 16 both say it is laned; the Worker's `NOT_LANED` (`approvalSources.ts:273`) says not. d286 `:221-231` ties the two together.
3. **Waiting-by-program rows** (`dc:338`) are named "as the Approvals lanes are". Only `referrals` and `cohort` exist on the glance, and `cohort` is `cohort_applicants`, not `spinout_applications`. Perk listings, office-hours hosts and strategic access are not laned. The names are owned by #2390.
4. **The Lab's address and tabs.**
   - Two doors open one console today: `/admin?tab=lab-applications` and `/admin/spinout-lab`.
   - Its tabs are state, not URLs (`AdminSpinoutLab.jsx:712-791`), so "Spin-Out Lab › Applications/Hosts" cannot be linked.
   - #2374 owns this. A prefix `own('/admin/programs')` would give a future `/admin/programs/spinout-lab` a rail key unless it is listed with `railCount: 0`.
5. **Product testing** points at `/admin/platform/product-testing`, which does not exist. Today it is `/admin?tab=product-testing`, owned by #2382.
6. **Profiling trends "leaves Programs".** `HeldPrograms.jsx:75` is its only door, so it needs a new door, a move to Insights, or removal (an owner decision).
7. **The `/admin/refer-earn` notice.** The canvas draws it on Overview (`dc:415`, `dcB:53`); the issue redirects to the Queue tab. D894 sent the redirect where the old function lives.
8. **PG19a cannot render** behind `RoleGuard`. **PG19b's words differ from `hqOnly`'s notice.** Decide the proposals page gate.
9. **The HQ sidebar Programs row.** The canvas adds it (`dc:509`); the tests pin 13 rows and the "ELEVEN" prose. `HQ_ROWS` and `ADMIN_ROWS` are already stale (`adminPlacement.js:33`, `:35`).
10. **The frame.**
    - Keep HeldZone, with its always-visible scope sentence pinned (d286 `:355-365`) and the admin rail even for a Super Admin.
    - Or use its own RailFrame with a tier-aware rail and a scope chip, as the canvas draws and Insights does.
11. **The scope chip.** No subsidiary is deployed, so "[Studio Lisbon]" and every grant badge but "HQ-held" have no source. A licence brand exists only for a not-deployed licence administrator.
12. **The board count.** `design/incoming/README.md:171-172` says "45 in all"; the canvas has **40** frames (`dc:209` enum, `dcB:45-64`). The pitch README's count was just corrected the same way.
13. **A stale comment.** `fe/App.jsx:2696-2699` says `/admin/commissions` is "never `hqOnly`"; `:2700` is `hqOnly`, which is pinned.
14. **The canvas sidebar hrefs are computed** (`dc:510`): `/admin/accounts` and `/admin/licences` are HQ-only pages, and `/admin/studio` does not exist. Only `/admin/programs` is meant, as D915 noted for `/admin/community`.
15. **Spelling.** "program" (canvas) against "programme" (`HeldPrograms.jsx:27`, `StudioNeedsDecision.jsx:36`, the programme clock in `adminStudioOverview.js:108-115`, `testing_programmes`).
16. **The Perks Review queue** has no URL to redirect from (`PerksPage.jsx:1697`, `:1740`). "Perks › Queue" is new work on `perkReviewQueue` (`api.js:3398`); `/perks` stays rail-free (`railPages.js:441`).
17. **ROUTE_MAP count sequencing** with #2706 (Events). Whichever lands second bumps `profile_routing_fresh:103` again.

## Part D — the defects, re-checked

### #2371's defects re-checked at HEAD

**What this is.** S1 re-checked #2371's defect claims against the code on `claude/spinout-lab-workspace-wuyyqd` on 2026-10-24. It is a snapshot and is not maintained.

**Which commit.** HEAD is `0296848`, not the `6205ee6` the task named. The branch has gained four commits since: `6c355ff`, `24136bf`, `0b85c2b` and `0296848`.
- `git diff --stat 6205ee6..HEAD` touches only the Pitch studio (D894) and the Partner invitations canvas.
- None of the files below changed, so every line cited here reads the same at `6205ee6` and at `0296848`.

**Where the issue's cites came from.** The issue cites `origin/main` at `537f646a3f` (drafted at `7787f0faf0`). Neither commit is in this clone: `git cat-file -t` says "Not a valid object name" for both.
- Since then, only `fe/App.jsx`, `fe/lib/api.js`, `wk/index.ts` and two test files have moved lines in the cited set.
- The moved lines are in the drift table at the end.

**Path short forms.**
- `wk/` = `cloudflare-worker/src/`
- `fe/` = `frontend/src/`
- `mig/` = `cloudflare-worker/sql/migrations/`
- `dc:` = `design/incoming/Programs Page.dc.html`
- `boards:` = `design/incoming/Programs · Boards.dc.html`

Bracketed canvas values are samples, never data.

---

### Summary

| # | Defect (issue) | Verdict | Touched by open work? |
|---|---|---|---|
| 1 | Two cards, one console | **PRESENT** | No code change. #2374 is named only in the issue body. |
| 2 | "Also an Approvals lane" is false | **PRESENT**, and in a fourth map | No |
| 3 | Strategic referrals can never be granted | **PRESENT**, and wider | No |
| 4 | A promised reward is never paid | **PRESENT**, and also promised on the member page | No |
| 5 | Mentor-access writes skip the freeze | **PRESENT**, with a precision fix (it is the D135 admin freeze), plus the branch gate. | No |
| 6 | Referral queue stops at 200 | **PRESENT**, **CHANGED** in detail: the page actually gets 100 | No |
| 7 | "Cohort calendar" cannot move a date | **PRESENT**. The canvas accepts it (dc:382) | No |
| 8 | Profiling trends is not a program | **PRESENT** | No |
| 9 | Old look | **PRESENT** | No |
| 10 | The Lab console decides with browser pop-ups | **PRESENT**, and wider (two more pop-ups) | No |
| M1–M9 | Bug-shaped "What is missing" claims | All **PRESENT**, except the Finder's Fee template "stub", which is **CHANGED** | No |

#### How I looked for open work

**Issue numbers in the repo.**
- `git grep -n -w` on `.md/.ts/.js/.jsx/.mjs/.json/.sql/.toml/.yml` files:
  - "2371" appears only in `design/incoming/README.md:183-186`, the canvas landing note ("S1's integration lands next").
  - "2374" and "2376" appear nowhere.
- `git log --all --grep="2371\|2374\|2376"` finds only `6205ee6` ("#2371: the admin Programs canvas lands in design/incoming").

**Branches.**
- `git branch -r` shows only `origin/main` and this branch.
- `git diff --stat origin/main..HEAD -- cloudflare-worker frontend/src` touches nine files, all under `fe/pages/cycles/`, `fe/pages/raise/narrative/` and `fe/pages/raise/pitch/`. None is a Programs file.
- I cannot list open PRs from here.

---

### Page defects 1–10

#### 1. Two cards, one console — PRESENT
Both cards still open the same console, and only one of them counts anything.
- Card 1, "Spin-Out Lab applications":
  - `fe/pages/admin/HeldPrograms.jsx:39-46` links to `/admin?tab=lab-applications` (`:45`).
  - Its figure is a fixed "not a lane" reason (`:44`).
- That tab mounts `AdminSpinoutLab`:
  - `fe/pages/AdminPage.jsx:238`;
  - under the "Admin Console" title at `:215` and the section nav at `:223-230`.
- Card 2 links to `/admin/spinout-lab` (`HeldPrograms.jsx:55`). That route mounts the same component: `fe/App.jsx:2814`, issue `:2806`.
- Card 2 counts `cohort_applicants` pending:
  - lane `wk/services/approvalSources.ts:132-142`;
  - the trap comment `:24-27`;
  - read at `HeldPrograms.jsx:21`, `:54`.
- The rail copy still says "Four consoles" / "Four programme consoles" (`HeldPrograms.jsx:26-27`).
- Canvas: one Spin-Out Lab card (dc:341).

#### 2. "Also an Approvals lane" is false — PRESENT
- Card copy: `HeldPrograms.jsx:62` ("Which advisor may read which cohort's founders. Also an Approvals lane.").
- Placement map: `fe/lib/adminPlacement.js:72-73`.
- The Worker says it is not laned:
  - `wk/services/approvalSources.ts:273` (in `NOT_LANED`, `:269`);
  - sent as `no_queue` at `wk/services/studioGlance.ts:208` (issue `:210`).
- Rail map files it under Approvals: `fe/lib/railPages.js:279`, `:387`.
- The rail options also file it as Approvals S18: `fe/lib/railOptions/admin.js:60` (Programs alias S21, `:63`).
- The sidebar lights Programs: `fe/sidebarConfig.js:228-229`.
- The canvas never says it. `grep -n "Also an Approvals lane"` on dc: returns nothing.
- Sibling, not Programs: the "Communities Admin" placement row says the same (`adminPlacement.js:70-71`), and Circles is also `NOT_LANED` (`approvalSources.ts:271`).

#### 3. Strategic referrals can never be granted — PRESENT, and wider
- The request route exists: `wk/routes/refer_earn.ts:244-250`.
- The category refuses without a grant: `wk/services/referralSubmissions.ts:462-467` (`hasStrategicAccess`, `:407-412`).
- The only write is the `'requested'` upsert at `referralSubmissions.ts:619-631`, insert at `:626-630`.
- **How I searched:** `git grep -n "referral_strategic_access" -- cloudflare-worker backend frontend scripts` finds:
  - the CREATE (`mig/175_referral_submissions.sql:86-93`, CHECK allows `'granted'`/`'declined'`) and its dev mirror;
  - two SELECTs (`referralSubmissions.ts:409`, `:419`);
  - one INSERT (`:627`).
  - There is no UPDATE and no admin read.
- `git grep -n -i "strategic referral"` in `wk/` and `fe/` finds nothing, so there is no Approvals lane either. Lane keys: `approvalSources.ts:47-49`.
- Wider than stated:
  - `/overview` marks the strategic category `locked` for every member, because nobody can reach `'granted'` (`refer_earn.ts:112`).
  - A `'declined'` state could never be re-requested (`referralSubmissions.ts:624-625`), though nothing can set it today.
- Canvas: PG9 "Strategic referral access" with Grant and Decline (dc:419).

#### 4. A promised reward is never paid — PRESENT, and also on the member page
- The Worker promises it: `referralSubmissions.ts:88` ("Platform credit, issued once matched and onboarded with a founder.").
- The member page promises it too: `fe/pages/ReferralsPage.jsx:91` ("Platform credit · Issued once matched and onboarded with a founder.").
- **How I searched:** `git grep -n grantCredits -- cloudflare-worker/src` finds only four callers:
  - `wk/routes/admin_ticket_reviews.ts:225`;
  - `wk/services/bugBounties.ts:178`;
  - `wk/services/labMilestoneCredits.ts:80`, `:100`.
- `mig/381_credit_reward_rules.sql:1-30` seeds no referral rule (bug, feature, task and Lab rules only).
- An admin can set `reward_issued` with only a label, and no credit moves: `referralSubmissions.ts:535-541`.
- Rewards are "milestone labels settled off-platform": `refer_earn.ts:44-46`.
- Canvas impact:
  - PG9 "Rewards issued [6] · [600] credits" (dc:415);
  - "[50] credits once onboarded" (dc:418);
  - PG1's "Referrals" source in "Credits in and out" would always be zero. Draw it Not recorded.

#### 5. Mentor-access writes skip the freeze — PRESENT (precision fix)
- All four routes check the role inline, not through `requireAdmin`:
  - `wk/routes/advisors.ts:2934-2935` (GET `/assignable`);
  - `:2966-2967` (GET list);
  - `:3000-3001` (POST);
  - `:3065-3066` (DELETE).
  - `isAdmin` is imported at `:16`.
- Precision: `requireAdmin` (`wk/auth.ts:523-528`) refuses through `refuseWhileFrozen` (`:526`, `:568-590`). That is the **D135 per-admin compliance freeze** on HQ's `admin_notices`, not a branch freeze.
- The two writes also skip the separate branch-suspension gate, `requireBranchNotSuspended` (`wk/auth.ts:752-793`).
- `git grep -n "refuseWhileFrozen\|ADMIN_FROZEN" -- cloudflare-worker/src` shows no global middleware, only `auth.ts` and the error maps.
- Canvas PG18c draws exactly this write refused ("Assign a mentor … licence is suspended", dc:503).

#### 6. The referral queue stops at 200 — PRESENT; CHANGED in detail
- Route:
  - `limit` defaults to 100 and caps at 200 (`wk/routes/refer_earn.ts:262`);
  - `ORDER BY s.created_at DESC` (`:274`), with no total (`:269-282`).
- The only admin client sends no `limit`:
  - `fe/pages/admin/ReferralReview.jsx:52`;
  - `fe/lib/api.js:2472-2477`.
- **So the page shows the newest 100, and the oldest waiting are the ones dropped.**
- No admin count by status exists. `countsForReferrer` is per referrer (`referralSubmissions.ts:286-306`).
- Canvas: PG9 queue "1–7 of [7]", sorted "Waiting longest" (dc:421).

#### 7. "Cohort calendar" cannot move a date — PRESENT (canvas accepts it)
- **How I searched:** `git grep -nE "UPDATE\s+week_windows|UPDATE\s+cohort_cycles|INSERT .* INTO week_windows"` over `cloudflare-worker/src` and `cloudflare-worker/sql` finds:
  - no `UPDATE week_windows`;
  - `cohort_cycles` updates for `force_proceed` (`wk/routes/admin_cohort.ts:598`);
  - the application window (`wk/services/cohortApplications.ts:284`);
  - `app_status` (`:378`, `:471`, `:548`);
  - `status` (`wk/services/cohortTiming.ts:499`, `:543`).
- Both rows are written with `INSERT OR IGNORE` (`cohortTiming.ts:206`, `:214`).
- `fe/pages/branch/BranchPrograms.jsx:21-27` says the same.
- Nuance: PG5 states "Cohort dates are fixed by the Lab's calendar" (dc:382). The canvas does not ask for a date control; only the old card name "Cohort calendar" over-promises.

#### 8. Profiling trends is not a program — PRESENT
- The card is still on the page: `HeldPrograms.jsx:69-76`.
- Route: `fe/App.jsx:2824` (issue `:2816`).
- Sidebar match: `fe/sidebarConfig.js:229`.
- Rail maps: `fe/lib/railPages.js:283`; `fe/lib/railOptions/admin.js:65`.
- `grep -c -i profiling` on dc: returns 0. The canvas drops it.

#### 9. Old look — PRESENT
- 18 px title: `HeldPrograms.jsx:33`. The canvas title is 24 px / 800 (dc:528).
- Raw slate classes in the scope note: `fe/pages/admin/HeldZone.jsx:63`.

#### 10. The Lab console decides with browser pop-ups — PRESENT, and wider
- `window.confirm` at `fe/pages/admin/AdminSpinoutLab.jsx:203`.
- `alert` at `:213` and `:215`.
- `window.prompt` at `:661-665`, then `alert` at `:668`.
- A further `alert` at `:682`.
- The console is #2374's canvas, not this one.

---

### "What is missing" claims that assert a bug

| # | Claim | Verdict | HEAD evidence |
|---|---|---|---|
| M1 | Investor cohort access: nothing | **PRESENT** | `git grep -n -i "investor_cohort\|investor cohort"` over `wk/`, `cloudflare-worker/sql`, `fe/` finds nothing. The investor Lab page is an "ILLUSTRATIVE composite": `fe/lib/spinoutInvestorContent.js:23-28`. |
| M2 | Commission rules: no route creates a rule; Super Admin only | **PRESENT** | Seeds `wk/routes/network.ts:99-109` (the only `INSERT … commission_rules`, `:108`). Keyed by rule `:69-77`. Gates `:571`, `:583`, `:615`. Page note `fe/pages/admin/AdminCommissions.jsx:27-30`. `hqOnly` route `fe/App.jsx:2700` (issue `:2696`). |
| M3 | Finder's Fee template "seeded as a stub" | **CHANGED** | Seeded as a stub at `mig/085_seed_legal_templates.sql:1674-1675`. Later filled and un-stubbed: `mig/105_fill_legal_template_bodies.sql:224-290` (`is_stub = 0` at `:287`), refreshed `mig/113_refresh_legal_template_bodies.sql:179-228`, empty-body back-fill `mig/484_library_coded_templates.sql:211-263`. Still true: nothing ties it to a referrer. Outside `wk/routes/admin_contracts.ts:309`, `:358`, only `fe/pages/admin/consoles/LegalConsole.jsx:50` names it. |
| M4 | Any member except Explorers can host an event | **PRESENT** | `fe/App.jsx:3178` (issue `:3164`). |
| M5 | `/referrals` excludes Explorers; the Worker only asks for sign-in | **PRESENT** | `fe/App.jsx:3493-3494` (issue `:3479`) against `wk/routes/refer_earn.ts:95`, `:141`. Canvas PG9s draws Explorers switched off (dc:493). |
| M6 | No referral grants credits | **PRESENT** | Same as #4. |
| M7 | The perks review queue is a tab of the member page | **PRESENT** | `fe/pages/PerksPage.jsx:1494`, `:1697`, `:1740`. Review is `requireAdmin` (`wk/routes/perks.ts:769`, `:832`); credits are Super Admin (`:785`, `:806`). |
| M8 | Learning is Super Admin only and not linked from Programs | **PRESENT** | `wk/routes/admin_learning_programs.ts:5-6`. `gate` at `wk/routes/admin_learning.ts:46-48`. Routes `fe/routes/learning.jsx:42-46`. `HeldPrograms.jsx` has no Learning link. |
| M9 | No proposals and no grants store | **PRESENT** | `git grep -n -i -E "program_grants\|programme_grants\|program_proposals\|programme_proposals\|program_registry\|programs_registry\|licence_programs\|license_programs\|program_playbook"` over `cloudflare-worker` and `fe/` finds nothing. The newest migration is `535_dd_advisor_subject.sql`. |

---

### New defects (not in #2371), by what a Programs page would draw wrongly

**N1. A failed Lab applications read draws "No applications yet." (zero for failure).** Feeds PG1 "[7] applications waiting" and the "Lab applications" series (dc:341).
- `wk/routes/admin.ts:1190-1207` swallows any error: `catch { /* table not yet migrated → empty queue */ }` (`:1205`), returning 200 with `[]`.
- `LIMIT 200` with no total (`:1202`).
- The console renders `apps.length === 0` as "No applications yet." (`fe/pages/admin/AdminSpinoutLab.jsx:261`).

**N2. A failed Lab participants read draws "No admitted founders yet."** Feeds PG1's "in the cohort" figure.
- The catch returns `{ participants: [], catalog }` with 200: `wk/routes/admin.ts:1427-1430`.
- `LIMIT 400` applies to joined user×project rows before the per-user de-dup (`:1424`, `:1432-1440`), so fewer than 400 founders can be cut silently.
- Page: `AdminSpinoutLab.jsx:439`.

**N3. A cohort's `participant_count` shrinks as founders succeed.** "[24] in the [Nov 2026] cohort" (dc:341) would undercount any cohort with incorporations.
- `wk/routes/admin_cohort.ts:62` (and `:105`) counts only `spinout_lab_active = 1` users who started in the window.
- Incorporating sets `spinout_lab_active = 0`: `wk/routes/spinout_lab.ts:239`, `:250`.
- `participants?.n ?? 0` at `admin_cohort.ts:71`.

**N4. Referral review accepts any status from any status.** The PG9 funnel (Submitted → … → Reward issued) and the cumulative "Converted" (`referralSubmissions.ts:298-305`) both assume forward movement.
- `reviewSubmission` checks only `isStatus` (`referralSubmissions.ts:535-540`).
- The terminal set (`:47-49`) is enforced only on the referrer's own update (`:575`).
- So an admin can move a `reward_issued` row back to `submitted`, or to the member's `draft`.

**N5. "Waiting for review" would count referrals that are waiting on the referrer.** PG1 "Waiting for you" and PG9 "Waiting for review [7]" (dc:415) would overcount.
- The Referrals lane counts `more_info_needed` (`wk/services/approvalSources.ts:124`).
- The service itself says "the ball is in the referrer's court" (`referralSubmissions.ts:52-57`).

**N6. ReferralReview says "Nothing in this queue." under its own error.**
- `rows` starts `[]` (`fe/pages/admin/ReferralReview.jsx:42`).
- On a failed first read the error shows (`:111`) and the empty branch also renders "Nothing in this queue." (`:121-125`).
- The referrer fallback prints the referral's uid as if it were a user (`` `user ${r.uid}` ``, `:136`).

**N7. A perk can be featured but never un-featured.** PG10's "Feature (switch)" (dc:434) cannot be switched off.
- `wk/routes/perks.ts:853`: `b?.featured ? 1 : perk.featured`.
- `grep -n featured wk/routes/perks.ts` finds no other write.

**N8. Perk review has no state check, and the queue mixes drafts in.**
- `POST /admin/:uid/review` loads the perk (`perks.ts:838-839`) and writes the new status with no current-status test (`:848-855`).
- The queue selects `('in_review', 'draft')` (`:773`), unlike the rule that a draft is not reviewer backlog (`approvalSources.ts:31-34`).
  - Create writes `in_review` today (`perks.ts:560`), so draft rows are rare.
  - The table default is `draft` (`mig/186_perks.sql:73-74`).
- `LIMIT 200` with no total (`:774`).

**N9. One-click writes with no dialog, against the canvas rule "Every change opens a dialog".**
- End access: `fe/pages/admin/AdvisorCohortAssignments.jsx:100-109`, button `:234`. It ends access to founder names and emails and notifies founders.
- Assign: `:76-98`. PG6d draws an Assign lightbox.
- Perk Approve and Reject: `fe/pages/PerksPage.jsx:1562`, `:1564`.

**N10. One perk error renders under every card.**
- A single `err` is rendered inside `items.map` (`fe/pages/PerksPage.jsx:1535`, `:1560`).

**N11. The mentor reads truncate silently.**
- Both mentor reads cap at 500 with no total: `wk/routes/advisors.ts:2943`, `:2983`.
- The cohort picker offers only the 12 newest cycles (`wk/routes/admin_cohort.ts:53`).
- An assignment to an older cycle therefore draws "Cycle #N" (`AdvisorCohortAssignments.jsx:218`).

**N12. Several program writes are not paused under branch suspension, so PG18c ("program changes are paused", dc:503) would not hold for them.**
- These writes skip `requireBranchNotSuspended`:
  - mentor POST and DELETE (`advisors.ts:2998`, `:3063`);
  - Lab grace (`admin_cohort.ts:128`), override (`:160`), settings (`:332`) and force-proceed (`:584`);
  - the lab-host decision (`wk/routes/lab_hosts.ts:224`);
  - perk review (`perks.ts:830`; the import list at `:63` has no gate).
- These writes are gated:
  - referral PATCH (`refer_earn.ts:288`);
  - cohort decide and interview (`admin_cohort.ts:360`, `:523`, `:569`);
  - the Lab decide (`admin.ts:1215`).
- The freeze test's file list (`cloudflare-worker/test/branch_suspended_freeze.test.ts:273-291`) has none of `advisors.ts`, `lab_hosts.ts` or `perks.ts`.
- It only matters on a branch: `wk/auth.ts:753` returns on HQ, and no branch is deployed.

**N13. Four of the five "Waiting by program" rows have no lane to read from.**
- The canvas says the rows are "named as the Approvals lanes are" (dc:338), and "Waiting for you reads [21], the sum of the five queues" (`boards:45`).
- The lane keys (`approvalSources.ts:47-49`) have only `referrals` for "Refer & Earn reviews".
- There is no lane for:
  - Spin-Out Lab applications (`spinout_applications`; `cohort` counts `cohort_applicants`);
  - Strategic referral access;
  - Perk listings;
  - Office-hours hosts.
- The hosts read does carry full counts by status: `lab_hosts.ts:216-221`.

**N14. "Credits in and out" and "Credits paid out" have no honest read for an Admin.**
- `GET /api/admin/credit-rules/grants` is Super Admin only (`wk/routes/admin_credit_rules.ts:74-76`) and returns the newest 200 (`:79-100`).
- A plain Admin cannot read it, and a month summed from it undercounts past 200 grants.

**N15. Doc drift on PG7's reads.**
- `fe/pages/admin/AdminCommissions.jsx:20-21` says the commission reads are `requireAdmin`.
- They are `requireSuperAdmin` (`network.ts:571`, `:583`).
- So PG7's Admin board (accrued, paid, standard rules) has no read a plain Admin may call.

**N16. Re-assigning a mentor overwrites the record of the earlier access.** PG6's "Ended access stays on record" (dc:390) stops being true after a re-assign.
- `ON CONFLICT … DO UPDATE SET is_active = 1, unassigned_at = NULL, assigned_by_admin_id, assigned_at, note` at `advisors.ts:3041-3043`.
- Ending records no actor (`:3073`).
- Neither write calls `logAdminAction`. In this file it appears only at `:3708`, `:3926` and `:4323`.

**Other notes**
- Perk review decisions write no admin-audit row (`grep -c logAdminAction wk/routes/perks.ts` = 0). Manual credit adjustments are audited through `wk/services/creditGrants.ts:359`.

---

### Line drift: issue cite → HEAD

| Item | Issue | HEAD |
|---|---|---|
| `/admin/held/programs` route; "five landings" comment | App.jsx:2721; :2716-2718 | App.jsx:2725; :2720-2722 |
| `/admin/spinout-lab` | App.jsx:2806 | App.jsx:2814 |
| `/admin/profiling-trends` | App.jsx:2816 | App.jsx:2824 |
| `/branch/programs` | App.jsx:2754 | App.jsx:2761 |
| `/admin/commissions` `hqOnly` | App.jsx:2696 | App.jsx:2700 |
| `/admin/refer-earn` | App.jsx:2691 | App.jsx:2695 |
| `/admin/credit-rules` | App.jsx:2797 | App.jsx:2805 |
| `/admin/advisor-cohorts` | App.jsx:3273 | App.jsx:3287 |
| event host routes | App.jsx:3164 | App.jsx:3178 |
| `/referrals` | App.jsx:3479 | App.jsx:3493 |
| `no_queue` | studioGlance.ts:210 | studioGlance.ts:208 |
| mounts: admin cohort / studio glance / lab-hosts / advisors | index.ts:908 / :1081 / :1303 / :1306 | index.ts:920 / :1094 / :1327 / :1330 |
| `api.adminStudioGlance` | api.js:3647 | api.js:3652 |
| `adminSpinoutApplications` / `Participants` / `CohortTimeline` | api.js:2542 / :2548 / :2586 | api.js:2547 / :2553 / :2591 |
| advisor-cohort clients | api.js:2579-2584 | api.js:2584-2589 |
| `adminLabHosts` | api.js:2567 | api.js:2572 |
| commissions clients | api.js:2439-2443 | api.js:2444-2448 |
| referral admin clients | api.js:2467-2475 | api.js:2470-2481 |
| perk review clients | api.js:3393-3394 | api.js:3398-3399 |
| `held_admin_shell_d286.test.mjs` | :55, :82, :316 | :55, :83, :326 |
| `hq_studio_figures_d555.test.mjs` | :184, :193 | :189, :198 |

**Cites that have not moved:**
- Files: `HeldPrograms.jsx`, `HeldZone.jsx`, `heldFigures.jsx`, `adminStudioOverview.js:357-362`, `approvalSources.ts`, `admin_studio_glance.ts`, `refer_earn.ts`, `referralSubmissions.ts`.
- Advisors: `advisors.ts:2932-3066`, `auth.ts:523-528`.
- Lab and cohort: `admin_cohort.ts`, `cohortApplications.ts`, `cohortTiming.ts`, `BranchPrograms.jsx:21-27`, `AdminSpinoutLab.jsx`, `AdminPage.jsx`, `admin.ts:1190/1209/1385`.
- Maps: `sidebarConfig.js`, `adminPlacement.js`, `railPages.js`.
- Perks and credits: `perks.ts`, `PerksPage.jsx`, `creditGrants.ts:134`, the grant callers.
- Commissions and contracts: `network.ts`, `AdminCommissions.jsx:27-30`, `admin_contracts.ts:309/358`.
- Learning, testing, hosts: `admin_learning_programs.ts`, `admin_learning.ts:46-48`, `learning.jsx:42-46`, `testing.ts`, `lab_hosts.ts`.
- Other: `cohortAdvisorAccess.ts:14-20`, `spinoutInvestorContent.js:23-28`, `profiling_trends_d358.test.mjs:25`.
- Migrations 085, 155, 156, 157, 175, 206, 381, 389.

## Part E — the completeness critique

### Completeness check: the Programs code map (#2371), checked against the canvas and the code

**Commit.** HEAD has moved past what the sections read. It is now `85746dd`: D923 (#2370, Partner invitations) sits on `5da1178`, a merge of main that brought in D893 PR 2, D893's subsidiary scope, D907 and D916. The four gap sections were read at `fbbb4c8` and `d7d7040`.
- `git diff --stat d7d7040 85746dd` changes:
  - `wk/index.ts`: one line added after `:236`, three after `:1077`;
  - the Insights page and model;
  - `wk/routes/events.ts` and `wk/routes/admin_events.ts`;
  - D893, D907, D916 and the new D923.
- It does not change `fe/App.jsx`, `fe/sidebarConfig.js`, `fe/lib/*`, `fe/ui/*`, HeldZone, HeldPrograms or either canvas file.

**Prefixes.** `wk/` = `cloudflare-worker/src/`, `fe/` = `frontend/src/`, `mig/` = `cloudflare-worker/sql/migrations/`, `dc:` = `design/incoming/Programs Page.dc.html`, `bd:` = `design/incoming/Programs · Boards.dc.html`.

**How I checked.**
- I read the board list (`dc:209`, 40 frames), the dispatch (`dc:468-510`), all block data (`dc:322-467`) and the grid captions (`bd:45-64`).
- **Every board and lettered variant has rows.** g1 covers PG1, PG1h, PG2 and PG3. g2 covers PG4 to PG6d, PG11, PG11d and PG20b to PG20d. g3 covers PG7 to PG10s, PG12 and PG12d. g4 covers PG13 to PG20d.
- At block level I found only the gaps listed below.

---

#### Missing

1. **The boundary with Partner invitations (new at HEAD).**
   - `documentation/architecture/decisions/D923.md:327` says the Partner invitations page owns the invitation, the offer, the agreement, the deal, its referral code and its redemptions. Programs owns the programmes members join and Refer & Earn. D923 also says "Programs' decision records the same line from its side." No section names this line.
   - g3's PG7 rows built on OD3 = "partner deal" redraw D923's pages on Programs: partner-deal rows, `PART-` codes, redemption counts, End (terminate) and settlements. D923 already gives those pages addresses (`D923.md:23-25`).
   - **Row to add (g3, PG7):** for deals, codes and sign-ups, PG7 links to `/admin/partner-invitations/deals` and `/admin/partner-invitations/referrals`; it does not draw them itself.
   - **"Invite a partner"** opens D923's New invitation, PI4 on `/admin/partner-invitations` (`D923.md:54`, `:205`), not `/admin/partners`, which becomes a redirect (`D923.md:27`).

2. **An owner decision shared with D923: O-TERMS.**
   - `D923.md:330` reads: "Per-invitation terms for Deal-sourcing revenue share and Custom, decided with #2371."
   - PG8's custom terms (`dc:406-412`) are the same decision, but no section's owner list names it.
   - **Fix:** add it to g3's OD list as joint with D923, next to OD3 and OD5.

3. **Decision and migration numbers are already taken.**
   - D923 reserves D924 to D932 for its nine parts, and migrations 547 and 548 for parts 1 and 2 (`D923.md:339-347`).
   - So Programs' decision cannot be D923, and its parts start at D933 or later. Run `node scripts/check-decision-ids.mjs` before filing.
   - Any Programs migration (registry, proposals, grants, mentor history) must not use 547 or 548. The newest migration on disk is `mig/535_dd_advisor_subject.sql`.

4. **The route-map count and the doc pins are in no buildable list.**
   - `frontend/test/profile_routing_fresh.test.mjs:104` is already 150; D915's Events row is noted at `:103`.
   - So Programs' row bumps it to 151, or 152 if D923 lands a row first. The shell report's "149 → 150" (§3.2.9, checklist 13) is stale.
   - **Rows to add to g1 §6:**
     - the ROUTE_MAP row, with `/admin/programs` in backticks in the live cell (`scripts/build-profile-routing.mjs:281-291`);
     - the folder docs: `fe/pages/admin/README.md:43` names `HeldPrograms.jsx`, and `scripts/check-folder-docs.mjs:198-206` checks that file;
     - the pins that read HeldPrograms: `frontend/test/hq_studio_figures_d555.test.mjs:186-199` and `frontend/test/profiling_trends_d358.test.mjs:25`, `:90-96`.

5. **The redirect pin is shared with D923.**
   - `frontend/test/admin_route_reachability.test.mjs:472` requires `REDIRECTS` to equal exactly `['/admin/held/insights','/admin/news']`.
   - D923 adds `/admin/partners` to that pin and to `wk/services/redirectRoutes.ts` (`D923.md:47`).
   - Programs adds `/admin/held/programs`, and `/admin/advisor-cohorts` and `/admin/refer-earn` if those become redirects.
   - `COMPONENT_TARGETS` (`:476-482`) finds a redirect component's target by regex on a model constant (`INSIGHTS_PATH`, `:482`). A Programs redirect component needs the same, or that check generalised.
   - g1 covers only `/admin/held/programs`. g2 and g3 add the other two redirects without the pin.
   - **Row to add (g1 §6):** one ordered `REDIRECTS` list and one `redirectRoutes.ts` block, merged with D923's.

6. **Profiling trends has no door once HeldPrograms goes.**
   - `fe/pages/admin/HeldPrograms.jsx:75` is its only door. The sidebar entry at `fe/sidebarConfig.js:229` only lights the Programs row; it is not a door.
   - When HeldPrograms becomes a redirect, `/admin/profiling-trends` (`fe/App.jsx:2824`) fails "every /admin route is reachable from navigation" (`admin_route_reachability.test.mjs:433`).
   - The canvas draws no door for it (`dc:340-349`). g1 keeps it in the sidebar list but gives no door. O-PRF is named, but no section says what happens until it is decided.
   - **Row to add:** until O-PRF, a literal `to="/admin/profiling-trends"` door (for example on Insights), or an exempt entry with its reason. Update `profiling_trends_d358.test.mjs:90-96` in the same change.

7. **One rail when today's consoles are reused.**
   - g2 (PG6, PG6d) and g3 (PG9q, PG9d) reuse today's pages. Their default exports wrap `AdminBoardFrame` (`fe/pages/admin/AdvisorCohortAssignments.jsx:257-261`; `fe/pages/admin/ReferralReview.jsx:229-231`), which would draw a second rail inside the program frame.
   - **Row to add:**
     - export `AdvisorCohortAssignmentsBody` (`AdvisorCohortAssignments.jsx:39`) and `ReferralReviewBody` (`ReferralReview.jsx:40`);
     - list them in `COMPOSED` (`admin_route_reachability.test.mjs:269`).
   - The one-rail check is `frontend/test/_airailRender.mjs:378-390`. The shell report's cite `airail_render_admin_d781.test.mjs:380-392` is wrong: that file has 12 lines.

8. **The rail's own copy.**
   - `HeldPrograms.jsx:24-32` passes the rail `stance` "Four consoles, each opened where it is decided", `coverage` "Four programme consoles…", `coverageNote` and `unavailable`. These are the shell report's defect 5, and they use the "programme" spelling.
   - g1's Eadwyn row replaces only the note (`dc:536`).
   - **Row to add (g1 §1a):** rewrite or drop these props for the new page.

9. **D893's subsidiary scope is now a precedent (new at HEAD).**
   - `GET /api/admin/insights/scopes` (`wk/routes/admin_insights_scopes.ts:30-38`, mounted `wk/index.ts:1082`, Super Admin on HQ) lists HQ-held plus each deployed subsidiary.
   - It reads `licence_deployments` joined to `territory_licences`, where "deployed" means `worker_live`, `hostname_active` or `linked` (`documentation/architecture/decisions/D893.md:187-190`).
   - Per-branch counts come through `branchRead` and the branch's `insights()` call (`wk/services/insightsScope.ts:1-19`; `wk/services/topology.ts`).
   - Insights keeps its "only HQ-held" note only while no subsidiary is listed (`D893.md:192`).
   - Two places predate this:
     - g1's PG2 rows: "All studios" uses Insights' one-option scope; "Studio: All ▾" says omit, nothing to filter by.
     - The shell report §4: "ScopeSelect offers HQ-held only… #2662 adds subsidiaries".
   - **Row to add (g1 PG2, g4 PG16a):**
     - The scope chip, the note and the studio filter follow D893: they key on the `/scopes` read, not on `infra/branches/`.
     - The filter is omitted while that read lists HQ-held only.
     - Per-studio program figures need a branch call shaped like `insights()`.

10. **An owner decision: may a plain Admin read the money and credit figures?**
    - The canvas draws these on Admin boards:
      - commission accrued and paid, and the standard rule values (`dc:395-398`);
      - credits held by members (`dc:425`, `dc:435`);
      - credits paid out (`dc:333`).
    - PG10's caption says "credits: an admin reads; HQ grants" (`bd:54`).
    - Every read behind them is Super Admin only: `wk/routes/network.ts:570-571`, `:582-583`, `:935-936`; `wk/routes/admin_credit_rules.ts:74-76`; `wk/routes/perks.ts:804-806`.
    - The sections mark these "Not read here yet" for an Admin, but none names the decision behind it: counts or sums for an Admin, or Super Admin only.
    - **Fix:** add it as an owner decision (call it O-MONEY) in g1 and g3.

11. **An S1 call: which board a Super Admin sees in the Admin view.**
    - Insights picks its Super Admin view by elevation (`fe/pages/admin/insights/AdminInsights.jsx:362`, `isSuperAdminUser`), not by shell (`fe/lib/shellRole.js:78-93`).
    - No section says whether a Super Admin in the Admin view gets PG1 or PG2.
    - **Fix:** add the call to g1's S-calls.

12. **The Product testing card's purpose and join line.**
    - The canvas's "Members test StudioOS features before they ship." (`dc:349`) is wrong today. Partners run programmes for their own products: see `owner_kind`, `owner_partner_id` and `product_name` (`mig/516_product_testing.sql:21-27`) and `documentation/architecture/decisions/D812.md:19-22`.
    - "Join: By application" is true (`mig/516:48`).
    - **Fix:** add a row to g1 §1g and the PG2 table: reword the purpose line, and mark the join line E.

13. **Which programs can be paused.**
    - The canvas draws "Pause program (Super Admin)" on Mentor, Referral partners, Refer & Earn and Perks (`dc:371`, `:393`, `:413`, `:423`).
    - Learning's ⋯ menu has Download only (`dc:445`). Investor and AI-native have no ⋯ at all (`dc:436`, `:455`).
    - g4's OD-PAUSE and g3's §0 treat pause as one rule for every program.
    - **Fix:** add the per-program scope to OD-PAUSE.

14. **"Also an Approvals lane" is never corrected.**
    - Bug #2 is listed only as pins to move (g2 PG4): `fe/lib/adminPlacement.js:72-73`, lane 16 at `fe/pages/admin/HeldApprovals.jsx:98`, and `held_admin_shell_d286.test.mjs:221-231`.
    - No row fixes the false claim or decides where Mentor access sits on Approvals (shell report open conflict 2).
    - **Row to add (g2):**
      - The placement copy says "No queue", matching `wk/services/approvalSources.ts:273`.
      - Lane 16 either stays as "No queue" or leaves; this is S1's call.

15. **Two defects from the bugs report have no gap row.**
    - **N6:** `ReferralReview.jsx:136` prints `user ${r.uid}` (the submission's id) as the referrer. The fix belongs in g3 PG9q's Referrer column. g4 PG16c covers only the empty-under-error line (`:42`, `:111-125`).
    - **N10:** one review error renders under every perk (`fe/pages/PerksPage.jsx:1535`, `:1560`). It needs a per-row error in g3 PG10's review queue.

---

#### Inconsistent

1. **"Waiting for you" (`dc:333`, also on PG20a `dc:505`).**
   - g1 §1b: draw it now over the four readable queues, labelled as four.
   - g4 PG20a and §2 #18: do not draw the sum.
   - **Fix:** one rule for both. I suggest g1's labelled four-queue total, null when any of the four cannot be read.

2. **"Programs running" (`dc:333`).**
   - g1: "Not read here yet" unless S-RUN.
   - g4 PG20a: "Not recorded".
   - By both sections' own definitions, a missing registry is "Not recorded". **Fix g1.**

3. **The period control (`dc:469`, `:533`).**
   - g1 §1a: now, with a caveat.
   - g4 PG17 and PG20a: omit until W1, following D915 (`documentation/architecture/decisions/D915.md:131-132`).
   - **Fix:** pick one.

4. **Mentor "Needs you" (`dc:343`, `dc:374`).**
   - g1 marks it P, with the no-mentor half waiting on S-COV.
   - g2 PG4 and g4 PG20a mark it E, now.
   - **Fix:** S-COV sets the cycle set for both the card and PG4, everywhere.

5. **"Active mentors" / "[6] mentors".** Three rules:
   - g1: distinct `advisor_user_id`;
   - g4 PG20b: active rows;
   - g2: S-CNT, plus the deactivated-holder caveat (`wk/auth.ts:335`), which g1 and g4 omit.
   - **Fix:** one rule under S-CNT, carrying the caveat.

6. **Perk listing age (PG1 bands, PG10 "oldest" and "Sent", PG18a).** Three rules:
   - g1: `updated_at`, "since last edit";
   - g3: `created_at`, "Listed";
   - g4: `created_at`, "Not recorded" for re-reviews.
   - g3's objection, that reviews also bump `updated_at` (`wk/routes/perks.ts:850`), does not apply to rows in the queue. Every review action moves a row out of `in_review` (`:844`). So a queued row's `updated_at` is its creation or its last partner edit (`:630`).
   - **Fix:** use g1's rule in all three.

7. **Refer & Earn: which statuses count as waiting, and how the count is made.**
   - g1 bands every open status, including `more_info_needed` (`approvalSources.ts:122-124`). g4 PG16c makes two calls only, `submitted` and `under_review`.
   - g1's card counts one call at 200 ("of the newest 200"); g3 makes one call per status.
   - **Fix:** S-AGE fixes the status set once, for count, bands and empty state; use per-status calls everywhere.

8. **Learning "Who: Every member" (`dc:348`, `:445`).**
   - g1 §1g marks it E, and g4 PG15b says it holds. g3 marks it W.
   - g3 is right: `LEARNING_COMING_SOON = true` (`fe/pages/learning/learningAccess.js:37`, `:49-52`), applied at `fe/pages/learning/LearningPage.jsx:177`.
   - **Fix g1 and g4.**

9. **Learning "Join".**
   - g1 derives it from R11's rows. But an Admin's R11 returns only the programs assigned to them (`wk/routes/learning_programs.ts:115`).
   - g4 draws a static "Open or by invitation". **Fix g1 to match g4** for an Admin.

10. **AI-native "Who: Founders" (`dc:342`).**
    - g1 and the catalogue report (§6.1) treat it as the owner's answer. g4 says it waits for OD-AIN.
    - **Fix:** one statement. Either the card's Who (`dc:342`) is given and the playbook row (`dc:458`) reads "Not set", or both wait for OD-AIN.

11. **Whether a referral pays credits.**
    - These say no referral pays credits: g3's PG9 line and figure 1, perks_learning §2.4, the referral report §5.6 and the bugs report #4.
    - g1 §1e found one introduction credit per referred signup (`wk/services/introductions.ts:247-262`, `intro_credit_ledger`).
    - **Fix:** "no referral pays perk credits", in g3 and the lead reports.

12. **Download (CSV).**
    - g2: omit it, or counts only (S-CSV).
    - g3 §0: built in the browser now; PG12: "names only".
    - **Fix g3 to follow S-CSV.**
    - g2's D893 cites are stale after the merge. `D893.md:177` and `:190` now describe the scope reads. The export rule is at `D893.md:250-256`: an allow-list, an email refused as 500 at `:253`, every export logged at `:255`. Line `:51` still describes the browser CSV.

13. **Which tab a moved notice lands on.**
    - g2 lands `/admin/advisor-cohorts` on Overview, where the canvas draws the notice (`dc:475`).
    - g3 lands `/admin/refer-earn` on Queue under D894's rule (`documentation/architecture/decisions/D894.md:22`), although the canvas draws that notice on Overview (`dc:415`).
    - **Fix:** one rule. D894's rule would send advisor cohorts to People.

14. **Rail keys for the program pages.**
    - g4 uses "Admin · Programs" for every `/admin/programs/*` page. g3 leaves it to the decision record. g2 points to the shell report, which lists both options.
    - The canvas keys "Approvals · Advisor cohort access", "Approvals · Referrals" and "Programs · Advisor cohorts" must stay reached (`fe/lib/railPages.js:270`, `:279`, `:387`; `frontend/test/rail_pages_d768.test.mjs:29-54`).
    - Boards S9, S18 and S21 need the new routes and files (`fe/lib/railOptions/admin.js:51`, `:60`, `:63`).
    - An `own()` entry without `exact` answers every sub-path (`railPages.js:47`, `:53`, `:417`).
    - **Fix:** one key plan:
      - an exact owner for `/admin/programs`;
      - the mentor-cohorts and refer-and-earn subtrees keep their Approvals keys, or get aliases;
      - the spinout-lab sub-path is listed with no rail.

15. **How placeholders draw their reason.**
    - g4 and the shell report (defect 3) require the reason as a visible line.
    - g1 §7, g2 §4 and g3 draw `Unrecorded`, whose reason is in `title=` only (`fe/ui/Honesty.jsx:37-50`).
    - **Fix:** every section draws the reason visibly, with D915's words (`fe/pages/admin/events/eventsDeskModel.js:21-28`, `:81`).

16. **The cohort deadline.**
    - lab_mentor §4.2 and §9 say "23:59" is the same instant as the stored deadline.
    - g2 §5.3 says the stored deadline is 00:00 ET and inclusive (`wk/services/cohortTiming.ts:104-106`).
    - g2 is correct.

17. **The Finder's Fee template "stub".**
    - The catalogue report §6.2 still cites the stub seed at `mig/085:1675`.
    - The bodies were filled later: Finder's Fee at `mig/113_refresh_legal_template_bodies.sql:180-221`, Partner Custom Deal at `:684-723`. The referral report §4, the bugs report M3 and g3 PG8 all say so.
    - **Fix the catalogue report.**

18. **Perks "Who".** There are three wordings:
    - perks_learning: "Founders claim; every member browses";
    - g1: "Founders claim; other members browse";
    - g3: "founders claim; members browse".
    - Partners are sent to their own listings and never see `/perks` (`fe/App.jsx:2960`), so "every member browses" is wrong.
    - **Fix:** one sentence that excludes partners.

19. **Cites that moved at `85746dd`.** These are wrong in every section.
    - **`wk/index.ts`**, +1 after `:236` and +4 after `:1077`:

      | Item | Cited | HEAD |
      |---|---|---|
      | Studio glance mount | `:1094` | `:1098` |
      | `/api/admin` catch-all | `:1101` | `:1105` |
      | Cohort mount | `:920` | `:921` |
      | Partners | `:848` | `:849` |
      | Credit rules | `:1072` | `:1073` |
      | Refer & Earn | `:1225` | `:1229` |
      | Perks | `:1294` | `:1298` |
      | Lab hosts | `:1326-1327` | `:1330-1331` |
      | Advisors and the `/api/mentors` alias | `:1330-1331` | `:1334-1335` |
      | Testing | `:1407-1410` | `:1411-1414` |
      | `onError` | `:1466` | `:1470` |
      | `admin_frozen` refusal | `:1473` | `:1477` |
      | `branch_suspended` refusal | `:1477` | `:1481` |
      | Cron ticks | `:1971-1972`, `:1983-1984` | `:1975-1976`, `:1987-1988` |
      | Mentor-notice sweep | `:2303-2308` | `:2307-2312` |
      | `investors` default | `:1517` | `:1521` |
      | Learning admin mounts | `:943-951` | `:944-952` |

    - **Insights files** (changed by the merge):
      - `insightsModel.js`: `PALETTE` `:61` → `:65`; the moved notice `:23-25` → `:24-25`; `scopeState` `:623-628` → `:630-634`.
      - `AdminInsights.jsx`: `RailFrame` `:433`, h1 `:436`, scope chip `:438`, moved notice `:440-442`, `ScopeSelect` `:283`, "Reading…" `:121`, `:157` and `:405`.
      - So these are stale: the shell report's `:238-255`, `:313-339`, `:345-349`; g1's `:62`, `:239-255`, `:330-338`, `:349-350`; and g4's `:99`, `:135`, `:299`.
    - **The shell report's test cites:** reachability `:425-436` → `:433`; `REDIRECTS` `:464` → `:472`; `COMPONENT_TARGETS` `:468-474` → `:476-482`.
    - **Other moves:**
      - `profile_routing_fresh.test.mjs:103` → `:104`, and its value is 150.
      - g3's `wk/routes/events.ts:489-500` moved up one line; the resubmit is at `:499`.
    - **`fe/App.jsx`:** the lead reports' cites below `:2837` are still four lines short (for example `/admin/advisor-cohorts` is `:3291`, `/referrals` `:3497`, `/perks` `:2960`). The gap sections already correct these.
