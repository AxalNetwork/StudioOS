# Community overview map — 2026-10-24 (#2367)

S1's map of the Admin · Community canvas against the code, made before
D930's integration. It is true at `origin/main` `031caf7b5a`. Like every
audit, it is a dated snapshot: re-check the code before you act on a row.

- **Canvas:** `design/incoming/Community · Boards.dc.html` and
  `design/incoming/Community Page.dc.html`, boards CM1 to CM13. The owner's
  artifacts are `3z8Z58GFCcS8SWMv4YbWiH` and `GewVUumBA5KASoPYNGUJuB`.
- **Prompt:** #2367.
- **Paths:**
  - `fe/` is `frontend/src/`;
  - `wk/` is `cloudflare-worker/src/`;
  - `mig/` is `cloudflare-worker/sql/migrations/`.

## 1. The shell today

| Thing | Where | Note |
|---|---|---|
| Route | `fe/App.jsx:2726`, `/admin/held/community`, `guard(['admin'], <HeldCommunity />)` | One of D286's held landings; never `hqOnly`. |
| Page | `fe/pages/admin/HeldCommunity.jsx` (99 lines) | Five link cards inside `HeldZone`. Two figures: pending Events and Jobs from the glance. |
| Sidebar row | `fe/sidebarConfig.js:230`, "Community", lit on `/admin/events`, `/admin/jobs`, `/admin/circles` | Pinned by `held_admin_shell_d286` (rows and order, `:80-100`). |
| Rail key | `fe/lib/railPages.js:284`, `own('/admin/held/community', key(AD, 'Community'))` | `/branch/community` is its alias (`:285`). |
| Rail board row | `fe/lib/railOptions/admin.js:66`, S24, `files: ['pages/admin/HeldCommunity.jsx']`, `rail: HELD` | Pinned by `rail_options_admin_d774`. |
| Placement | `fe/lib/adminPlacement.js:66-71` (Events, Jobs, Circles "card link"), `:117-121` (Wellbeing and Advisors & Partners tabs) | Circles is called "Also an Approvals lane". The Worker says Circles has no queue (`wk/services/approvalSources.ts`, `NOT_LANED`). |
| Tests that name the page | `held_admin_shell_d286` (`LANDINGS.Community`, the row list), `hq_studio_figures_d555:189-197` (`laneOf(glance.hq, key)` in the file) | Both move with the page. |
| Precedent | D893 moved Insights from `/admin/held/insights` to `/admin/insights`: `HeldInsightsRedirect`, `?moved=held-insights`, and a one-line notice | The reachability guard counts a `*Redirect` route as a redirect and resolves its target through `COMPONENT_TARGETS` (`admin_route_reachability:455-480`). |

## 2. Every read the canvas needs, at HEAD

| # | Read | Gate | Answers | Fails how | Verdict for the overview |
|---|---|---|---|---|---|
| R1 | `GET /api/admin/studio/glance`, lanes `events`, `jobs` | `requireAdmin` | Count per lane; `oldest_at` is the item's `created_at` (`approvalSources.ts:210`, `:221`, `:453-469`) | Lane `count: null` | **Use it** for "Waiting on you" counts. **Not** for "waiting [n] days": creation is not submission. |
| R2 | `GET /api/admin/events?status&limit≤200&offset` | admin | Every event's own row (`shapeEvent`: type, status, starts/ends, capacity, visibility, `host_user_id`) | 5xx on a D1 error | **Use it**, paged until a short page, as D915 does. No host name. |
| R3 | `GET /api/admin/events/analytics` | admin | `summary` (all time) and the 200 events with the latest start, with seats taken, attended, waitlisted | D916 (#2708): `summary: null` and `unreadable: ['summary'\|'events']`. Rows are still capped at 200. | **Rows only, under D915's Guard G.** `summary` is all-time, so it never feeds a period figure. |
| R4 | `GET /api/admin/jobs?status&limit≤200&offset` | admin | Every posting with `status`, `created_at`, `project_name`, `application_count` (all time) | 5xx | **Use it**, paged. Applications have no date here, so they cannot give "this period". |
| R5 | `GET /api/admin/circles` | admin | Every circle: type, access, published, featured, and the typed `members`, `activity`, `discussions` | 5xx | **Use it.** Members and activity carry the "As entered" tag (CM5's caption). |
| R6 | `GET /api/admin/network-profiles` | `requireAdmin` | Every roster row (kind, `is_active`) and `count` | 5xx | **Use it, counts only.** `mentor` counts as Advisor (`networkProfilesSchema.ts:31`). The rows carry names; the page draws none. |
| R7 | `GET /api/wellbeing/experts` | any member; an admin gets every active expert, samples included | `matches` is ranked and capped at 50 (`clampLimit(…, 6, 50)`). `total_active` counts samples. | `unreadable` with a sentence | **Do not use** for "verified of N": the cap and the samples make it wrong. |
| R8 | `GET /api/wellbeing/aggregate?days=30` | admin | Decrypts every pulse in the window to average six scores. Below seven founders, a bucketed cohort | 5xx | **Do not use.** The page needs a cohort band and nothing else. Calling this decrypts members' wellbeing answers to show a count, and logs an access each time. |

Stores with no read for the overview yet:
- `event_registrations.registered_at` and `status` (`mig/109_events_core.sql:119-138`);
- `event_checkins`;
- `job_applications.created_at` (`mig/132_job_board.sql:43-58`);
- `expert_bookings.created_at` (`mig/052_wellbeing_experts.sql:104-115`);
- `experts.verified` and `hidden_by_admin`;
- `users.role`, for "Who takes part";
- `admin_audit_log` rows with report types `events`, `jobs`, `circles`, for Recent activity.

Not recorded anywhere:
- active members (no per-account sign-in for this purpose; Insights' `activity_logs` rule is platform-wide and belongs there, `#2366`);
- circle membership and discussions (`circlesCommon.ts:115-122`: typed numbers);
- when an event or job was submitted for review (#2700 adds `submitted_at` for events; job postings have none).

## 3. Board by board

| Board | What it draws | Today | Gap |
|---|---|---|---|
| CM1 header | Title, line, scope chip, period control, Updated, refresh | — | The period control needs the overview read (part 1). |
| CM1 Waiting on you | Count, "[4] events · [3] jobs", oldest, amber over two days | R1 | Oldest and overdue need submitted times (#2700; jobs none). |
| CM1 Upcoming events | Next 30 days, "[318] registered" | R2, R3 rows under Guard G | None for the count. Registered is safe only under Guard G. |
| CM1 Event registrations, Job applications, Show-up rate | This period, with deltas | — | Overview read (part 1). |
| CM1 Published circles | "[9] of [11]" | R5 | None. |
| CM1 Advisors & partners | Active on the roster | R6 | None. |
| CM1 Wellbeing experts | Verified of N | — | Part 1 (R7 cannot give it). |
| CM1 Community activity by week + CM7 | Three weekly series, the table | — | Part 1. Chart parts: D893's `InsightsCharts` (`WeekLine`). |
| CM1 Events card | Funnel, by type, Next up | Next up: R2 and R3 under Guard G | Funnel: part 1. By type: part 1, after #2699 (four of twelve types are stored as Meetup, and In person as Online). |
| CM1 Who takes part | Registrations and applications by role | — | Part 1. |
| CM1 Jobs card | Postings by status, Most applications | R4 | None. "Most applications" is all time; the card says so. |
| CM1 Circles and roster | By type; published, draft, featured; members as entered; roster by kind | R5, R6 | None. |
| CM1 Wellbeing card | Experts bar, bookings by week, check-ins band | — | Part 1. The check-in band must come from a counts-only query, never R8. |
| CM1 Needs a decision | Pending events and jobs, oldest first, six rows, Review | R2 (pending), R4 (pending) | "Waiting [n] days" and Overdue need submitted times. An event row has no host name. |
| CM1 Recent activity + CM6 | Ten newest, filters | — | The activity read (part 2). |
| CM1 Consoles strip | Five doors, one figure each | R1, R5, R6 | None. Wellbeing and Advisors & Partners open console tabs until #2375. |
| CM1 two Not recorded cards | Active members, Circle discussions | — | None: drawn as the canvas says. |
| CM2 | Dark | — | Every class carries its dark pair. |
| CM3–CM5 | Lightboxes over R2/R3, R4, R5 | — | Part 4. Lightboxes, never drawers (the canvas caption). |
| CM8 | Empty | — | Real zeros from the reads that answered. |
| CM9 | Loading | — | Each block reads alone. |
| CM10 | A: one block failed; B: everything failed, the strip still works | — | Each read fails alone. |
| CM11 | Not an admin | `RoleGuard` redirects | Not drawn, as D915 decided for EV16. |
| CM12 | Phone | — | Responsive grid; lightboxes become full-screen through `Lightbox` (part 4). |
| CM13 | Moved notice | — | The D893 pattern. |

## 4. Defects, re-checked at HEAD

1. **Circle counts are typed.** `members`, `activity` and `discussions` come from the admin's form (`circlesCommon.ts:115-122`). This is confirmed. The page tags them "As entered".
2. **The event analytics zeros are gone** (D916, #2708). Its rows still stop at 200, so Guard G stays.
3. **A lane's age is creation, not submission.** This is confirmed for both lanes (`approvalSources.ts:210`, `:221`). The overview must not say "waiting [n] days" from it.
4. **The wellbeing aggregate decrypts to count.** This is confirmed (`wellbeing.ts:574-640`). It is a privacy cost the overview should not pay.
5. **The experts read caps at 50 and counts samples.** This is confirmed (`wellbeing.ts:1157-1240`).
6. **The branch twin's Wellbeing copy is stale** (`fe/pages/branch/BranchCommunity.jsx:112-115`). The resource library calls the resource routes (`fe/pages/wellbeing/WellbeingResourceLibrary.jsx`). Confirmed.
7. **The placement map calls Circles an Approvals lane** (`adminPlacement.js:70-71`). The Worker says it has no queue. Confirmed.
8. **The rail map and the placement map disagree** on Directory and Partner invitations: Community in `railPages.js` and `railOptions/admin.js` (S30, S31); Approvals lanes in `adminPlacement.js:84`, `:106`. Confirmed. This is #2370's and #2375's to settle, not the overview's.

## 5. Completeness check

- Every board CM1–CM13 has a row in §3. No board was left out.
- Every read the prompt's wiring table named was re-read at HEAD. R3 changed since the prompt (D916). R7 and R8 are refused here for the reasons in §2.
- The canvas names no member anywhere. Of the reads used here, only R6 carries people's names (the curated roster). The page draws counts from it and no name. R2 and R4 carry item titles and a posting's company, which the canvas draws.
