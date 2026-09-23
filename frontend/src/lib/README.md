# frontend/src/lib — non-visual browser code

The API client, formatters and helpers. Nothing here renders.

| File | What it is |
| --- | --- |
| `absence.js` | `NOT_RECORDED`, `text`, `titleCase` — how a string says the store has nothing. The string-level half of `../ui/Honesty.jsx`'s rule. `titleCase` deliberately takes no fallback: one that did re-cased its own sentence and shipped "Stage Not Recorded". |
| `api.js` | **The only way the SPA talks to the worker.** Every endpoint the frontend uses is a method here. |
| `bps.js` | `bpsPercent` — basis points as a percentage a person reads, and the ONLY place that fraction is computed (D149). It was written six times before this: `pct`, `fmtBps`, `feePct` and three inline expressions, three of which had drifted into a different format, so one 3550 rendered "35.5%" on three surfaces and "35.50%" on a fourth. It returns `null` for an absent value and never a sentence — each page keeps its own absent copy, D117's split one layer down — and it rejects the empty string and `[]` BEFORE coercing, because `Number` makes all three 0 and "0%" on a revenue share says a branch owes nothing. |
| `cohortTimeline.js` | `cycleLabel`, `statusesByWeek`, `currentCycle`, `WEEK_STATUSES`, `weekOutcome` — reading `GET /api/admin/cohort/timeline` for the two branch pages that draw it (S4 Programs and S15 Analytics, D210). The first two were lifted out of `BranchPrograms.jsx` when S15 became their second caller, with their test's assertions unchanged. `currentCycle` picks the newest cycle that has started by the SERVER's clock, and `weekOutcome` separates a deadline not yet due, a due week nobody was judged in, and the counts — never a rate, because the participant figure is today's membership. |
| `deployTimeline.js` | `DEPLOY_TIMELINE`, `deployProgress`, `liveChip`, `residencyLine` — migration 258's eight provisioning steps, and what a deployment's single `status` can honestly say about them (D149). Three states: `ok` behind the one reached, `wait` ahead of it, and `unknown` for every step of a FAILED deployment, because `status` was overwritten and which step failed is not recorded — marking them `fail` would claim the request was never made. It lives here rather than in the page so a test can put a running deployment and a failed one through it and see them differ; the binary render they replaced drew both the same. `liveChip` (one branch's live read as a chip; a branch that answers while its database fails is amber, not green) and `residencyLine` (a jurisdiction reads as residency, a location hint as not guaranteed) moved here in D209, when Platform → Topology became their second reader. |
| `notices.js` | `FREEZING_STATUSES`, `NOTICE_KINDS`, `noticeKindLabel`, `RUNGS`/`rungRank`/`noticeRank`, `toUtcInstant`/`daysTo` — the compliance ladder's vocabulary, shared by HQ's licence detail, the addressee's own page and HQ's Team table. The two pages' `NOTICE_TONE` maps deliberately did NOT move: same hues, two visual treatments, and Tailwind cannot build a class name at runtime. |
| `branchHost.js` | `branchCodeFromHost`, `csrfCookieNameFor` — the SPA's half of D104: which CSRF cookie this page mirrors, decided from the hostname so it agrees with the Worker's `BRANCH_CODE` without a request. |
| `platformSwitches.js` | `SWITCH_TONE`, `setByLabel`, `operatorLine`, `stampMinutes` — the platform switches as HQ's two pages draw them: Platform's read-only list (D202) and Switches' control (D203). Nothing here decides a state; the worker computes it through the predicate the code that obeys it calls. An unknown state takes the unreadable tone, never "on" or "off", and an unreadable store reads "Unreadable" with its reason, never "never thrown". |
| `url.js` | `safeExternalUrl` and link handling — user-supplied URLs pass through it. |
| `seo.js` | `usePageMeta`, for title/description/OG on public routes. |
| `log.js` | `reportError`, the client error channel. |
| `statusOverall.js` | The single roll-up rule for platform health, shared by `/status` and the Help Center. |
| `branchFreeze.js` | What a suspended branch can still do (D142) — `FROZEN` (with the route files that enforce each row), `STILL_READABLE`, `FREEZE_RULE`, and `NOT_BUILT` for the one row S7 draws that has no control behind it. The Locked column is a claim about what the SERVER refuses, so `branch_shell_s7_s13.test.mjs` asserts the files named here are exactly the files calling `requireBranchNotSuspended`: a new gate needs a row, and a row whose file stopped gating loses it. |
| `supportSession.js` | `KEY`, `activeSupportSession`, `clearSupportSession`, `timeLeftLabel` — the HQ support-session payload `SupportRedeemPage` has written since D120 and nothing read. It expires against its own `expires_at` and clears itself on the way past, because the un-expiring version outlived both the session and sign-out. One owner for the key, so the reader and `clearSession`'s purge cannot be renamed apart. |
| `spinoutBrief.js` | The Programme Brief's CONTENT (D141) — `WEEKS`, `TRACK_GATES`, `TERMS`, `JURISDICTIONS`, `DELIVERABLES`, `COMMUNITY`, `SUPPORT`, `FIT`/`NOT_FIT`, the nine `TOOL_EXAMPLE_READS` with the `EXAMPLE_LABEL` they may not be drawn without, and `numberWord`/`numberWordCap` so the brief's spelled-out counts are derived rather than typed. The programme describing itself: prose somebody wrote, changed by editing it, reviewed in a diff. It declares **no tools and no tracks** — those are `spinoutLabArsenal.js`'s, and the brief reads them so it cannot describe a programme the product does not have. |
| `weeklyChart.js` | `weeklyChartGeometry`, `niceStep`, `weekLabel`, `VIEW_W`/`VIEW_H` — the arithmetic behind `../components/WeeklyLineChart.jsx` (D210), pure so a test reads it rather than restating it. A `null` week is never plotted as zero and never bridged: a line breaks into runs, a run of one is a dot, the newest point is flagged partial because its week has not ended, the y axis starts at zero, and a median sits at its true value on the same scale, widening it if it must. |
| `zoneTime.js` | `inZone`, `dateInZone` — an instant rendered in the zone it is **enforced** in, with that zone named. The zone is a required argument, never a default: the Spin-Out Lab programme runs on America/New_York for every territory and a branch admin does not, so a formatter that fell back to the reader's zone would print the wrong hour. Deliberately not merged with `spinoutLab.js`'s date helpers, which bake the zone in for a reader who is on that clock. |

## Subfolders

| Folder | What lives there |
| --- | --- |
| `advisor/` | Advisor-side client logic. |
| `brand/` | Brand template content model. |
| `docs/` | Help Center search index. |
| `spinout/` | Spin-Out Lab client logic. |

## The drift rule

**Do not add an `/api/*` method to `api.js` without a matching worker route in
`cloudflare-worker/src/index.ts`.** `npm run test:drift` walks every call site
here, resolves it against the worker's real mount table, and fails the build on
a mismatch. This is the guard that catches "the UI calls an endpoint nobody
built" before it reaches production — which has happened, in both directions.

If a helper appears in two places, put it here once rather than a third time.

**`csvExport.js` — a CSV of the rows a page has already loaded.** It exists
beside `api._downloadCsv`, which asks the worker for the whole table. Most
zone-header "Export" actions do not need that, and twenty worker routes for
twenty zones would be twenty chances for a count on screen to disagree with a
count in a file. What it costs is said on the button: the label reads
"Export this view" and the filename carries the row count, because an export
over a truncated list with no hint of the truncation is how a founder pastes
twenty-five of two hundred rows into an investor update. Its escaping is
`cloudflare-worker/src/services/csv.ts`'s, character for character.
