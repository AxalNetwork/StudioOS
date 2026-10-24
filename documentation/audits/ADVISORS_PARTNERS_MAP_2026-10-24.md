# Advisors & Partners — the canvas read against the code (2026-10-24)

**A dated snapshot, true on 2026-10-24 only.** Read on `origin/main` at
`cc35435fd5` by S21 for #2369, before D972 was written. `wk/` is
`cloudflare-worker/src/`, `fe/` is `frontend/src/`.

The canvas is `design/incoming/Advisors Partners Page.dc.html`, boards AP1–AP14
(`board` options AP1 … AP14, with AP8a–b, AP9a–d, AP11a–b, AP12a–c and
AP13a–d). #2369's body maps the page as it was on `537f646a3f`; this map
re-checks what D972 rests on.

## A. Board by board

| Board | What it needs | What exists on `main` | Where it goes |
|---|---|---|---|
| AP1 header | crumb, one h1, line, tabs with counts, rail | the console's h1 plus the roster's own h1 "Mentor & partner network" (`fe/pages/admin/AdminNetworkProfiles.jsx`) | D936's header; the roster embedded with no h1 (D972) |
| AP1 tiles: Advisors, Operating partners, Firms, Active deals | counts and their warnings | `GET /api/advisors/admin/cohort-assignments/assignable` (`has_advisor_profile`); `GET /api/admin/partners/links` (`attached`, `unattached`, firms with `accounts`); `/directory`; `/deals?status=active` (`wk/routes/admin_partners.ts`) | drawn (D972) |
| AP1 tiles: hosts, assignments | counts | `GET /api/admin/lab-hosts` counts; `GET /api/advisors/admin/cohort-assignments` | drawn |
| AP1 tiles: sessions, settlements | per month; due in 30 days | no cross-office-hours count; settlements read is HQ's (`wk/routes/partner_settlements.ts`) | part 1 |
| AP1 Needs you | six rows | links, assignable advisors, deals, hosts, roster photos | five drawn; settlements with part 1 |
| AP1 C1–C4 | stage, sessions per week, skills vs demand, deals by type | no stage, no session count, no demand store; deals by type is countable | parts 1, 4, 5 |
| AP3, AP4 | one people table and a person drawer | pieces over five reads; no single read | parts 1, 4, 6 |
| AP5 | firms table | links' firms, directory flags, active deals | drawn without search or pages; part 7 |
| AP6, AP10, AP9d | firm drawer, attach, detach | `POST /api/admin/partners/links`; directory toggle | part 7 with #2728 |
| AP7, AP8, AP9a–b | roster with reach, one-save dialog, hide, archive | `wk/routes/admin_network_profiles.ts`; reach rule in `wk/services/decks/deckRoster.ts` | today's roster; parts 2, 3, 8 |
| AP9c | pause with a reason | no admin write to `advisors` | part 4 |
| AP11–AP14 | states, no permission, phone, dark | each block's own states; `RoleGuard` | parts 5–8; D940 |

## B. The defects D972 rests on, re-checked at HEAD

1. **Two h1s and four names.** The console's "Admin Console" and the roster's "Mentor & partner network" (`AdminNetworkProfiles.jsx`); "Advisors & Partners" in the console and Content's strip; "Network profiles" on the branch card. D972 draws one h1.
2. **"Mentor" saved as a kind.** The editor defaults to and offers `mentor`; the deck counts it as an Advisor. Part 3.
3. **Hide and Archive are one write** (`is_active = 0`), and Archive uses `window.confirm`. Parts 2, 3, 8.
4. **A hidden row's photo is broken**: the public proxy serves active rows only (`wk/routes/network_public.ts`). Parts 2, 3.
5. **No search, filter, sort or pages**; the roster GET returns every row. Part 2.
6. **Roster writes skip `logAdminAction`**, and the payload carries `photo_r2_key`. Part 2.
7. **No admin can hide an advisor from the directory**; only the advisor writes `advisors`. Part 4.
