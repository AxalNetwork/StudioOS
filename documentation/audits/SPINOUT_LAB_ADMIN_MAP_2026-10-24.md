# Spin-Out Lab admin — the canvas read against the code (2026-10-24)

**A dated snapshot, true on 2026-10-24 only.** Read on `origin/main` at
`cc35435fd5` by S21 for #2374, before D937 was written. `wk/` is
`cloudflare-worker/src/`, `fe/` is `frontend/src/`.

The canvas is `design/incoming/Spin-Out Lab Admin Page.dc.html`, boards SL1–SL21
(`board` options SL1 … SL21c). #2374's body maps the page as it was on
`537f646a3f`; this map re-checks what D937 rests on.

## A. Board by board

| Board | What it needs | What exists on `main` | Where it goes |
|---|---|---|---|
| SL1 header | crumb, title, pills, line, facts, tabs with counts, preview, Updated | the console's 18 px heading, Preview and Refresh (`fe/pages/admin/AdminSpinoutLab.jsx`); no shared header | D936's header (this PR) |
| SL1 tile: Applications waiting | count, oldest, the next close | the glance's `cohort` lane: `count`, `oldest_age_hours` (`wk/services/approvalSources.ts`, `cohort`); `applications_close_at` on `cohort_cycles` (migration 157) | drawn (D937) |
| SL1 tile: Next cohort | approved of places, minimum | `GET /api/admin/cohort/applications`: `applicant_counts`, `settings` (null when unreadable) (`wk/routes/admin_cohort.ts`, `r.get('/applications'`) | drawn |
| SL1 tile: In the Lab now | count, week and day | `GET /api/admin/cohort/timeline`: `participant_count` per cycle | drawn, for the running cycle |
| SL1 tile: Graduated | graduates, certificates | `GET /api/spinout-lab/certificates`: `eligible_total`, newest 500 rows, `awaiting` (null when unread) | drawn |
| SL1 calendar | lanes per cohort with windows and weeks | timeline's `windows`, applications' window columns | a table now; the timeline is part 5 |
| SL1 by cohort, weeks passed, funnel, per week | per-cohort counts by outcome, weekly | per-cycle status counts only; no per-week applications, no funnel | part 2 (Worker), part 5 |
| SL1 Needs you | six queues | glance lane; review `at_risk` and grace rows; hosts `counts.pending`; certificates `awaiting`; formation orders (every startup's) | five drawn; formation stays on its tab |
| SL2 queue | paged, filtered, total, chips, capacity bar, bulk | 12 cycles × 200 applicants, filters in the browser | part 2, part 6 |
| SL3 drawer | one application's facts, plan, interview, history | answers, week 1 plan, interview on the applications read | part 6 |
| SL4 A–G dialogs | approve with places, waitlist, decline with note, move, interview, run below minimum, admit | decide, interview, force proceed exist; no move, no bulk, no admit-with-application; places never enforced | parts 1, 3, 6 |
| SL5, SL6 | cohorts calendar and list; one cohort | timeline and applications reads; notifications and events reads per cycle | part 5 |
| SL7, SL8 | participants with week outcome and moderation; founder drawer and three dialogs | `GET /api/admin/spinout-participants` (Guard H); review read; grace and override; impersonation with a reason | parts 4, 7 |
| SL9 | hosts by status | `GET /api/admin/lab-hosts` and its decision | drawn as today's console; canvas in part 8 |
| SL10 | 83(b) and formation, Lab ventures switch | both desks list every startup | today's consoles; switch in parts 4 and 8 |
| SL11 | graduation | certificates read, issue, revoke, backfill | today's console; canvas in part 8 |
| SL12–SL14 | playbook, settings with grant terms, one log | no playbook store; settings live in the applications read; events and notifications per cycle; impersonation audit with no client | part 9 |
| SL15–SL18 | dark, empty, loading, error | each block's own states today | part 5 |
| SL19 | no permission | `RoleGuard` bounces | D936 part 3 |
| SL20 | phone | — | each part |
| SL21 | Super Admin callouts | — | parts 4 and 9 |

## B. The defects D937 rests on, re-checked at HEAD

1. **Two doors decide one row differently.** `POST /api/admin/spinout-applications/:app_id/decide` (`wk/routes/admin.ts:1209`) writes `decision_reason = 'Legacy admin decision'` (`:1260`) and needs no reason; `POST /api/admin/cohort/applications/:applicant_id/decide` (`wk/routes/admin_cohort.ts:357`) requires one. Part 1.
2. **Guard H.** `GET /api/admin/spinout-applications` answers `{ applications: [] }` after a caught error (`wk/routes/admin.ts:1190`, its `catch` "table not yet migrated → empty queue"); `GET /api/admin/spinout-participants` returns `participants: []` from its `catch` (`admin.ts:1385`, "tables predate the Lab migrations"). D953's part 7.
3. **The licence freeze is on three Lab writes only.** `requireBranchNotSuspended` is called by decide, interview and cancel (`admin_cohort.ts:360`, `:523`, `:569`), not by grace (`:128`), override (`:160`), settings (`:332`) or force proceed (`:584`), nor by the host decision (`wk/routes/lab_hosts.ts:224`). Part 1.
4. **Browser pop-ups.** `window.prompt` and `window.alert` for reasons, Min and Max (`fe/pages/admin/AdminCohortApplications.jsx:124-155`) and actions on Timing (`AdminCohortTiming.jsx:71`). Parts 6–8.
5. **A failed read called a dev-only feature.** "it isn't available on the local dev backend" (`AdminCohortApplications.jsx:164`). Part 6.
6. **Notices carry the old address.** `link: '/admin/spinout-lab'` in `wk/services/cohortApplications.ts:264` and `wk/services/cohortTiming.ts:402`. The address stays a redirect for good; D936's part 2 moves the link.
7. **Users › "Spin-Out admit"** (`POST /api/admin/users/:user_id/spinout-admit`, `admin.ts:1122`) writes no application or cycle row. Part 3.

## C. Production, read 2026-10-24 (read only)

- `cohort_cycles`: Aug and Sep 2026 completed, Oct 2026 active, Nov and Dec 2026 scheduled with applications open.
- `spinout_applications`: no rows, so retiring the old list's door leaves no row without one.
