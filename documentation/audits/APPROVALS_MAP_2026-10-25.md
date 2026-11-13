# Approvals — the canvas against the code, 2026-10-25

This is S21's map for D1038 (#2390). It reads the owner's "Approvals" canvas board by board against `origin/main` at `1fbe6ede58`, which includes D938's console split. The canvas has boards APR1–APR16, with lettered sub-boards, in `design/incoming/Approvals Page.dc.html` and `Approvals · Boards.dc.html`.

The map is true as of its date. Re-check the code before acting on a line here.

Paths: `fe/` is `frontend/src/`, `wk/` is `cloudflare-worker/src/`.

## 1. What #2390 called missing, re-checked

| # | #2390's gap | Today | Where |
|---|---|---|---|
| 1 | Counts only; no item, no oldest across lanes | **Open.** The branch has an item read (`approvalBoard`), but HQ has none. | `wk/routes/branch_approvals.ts` ~54 refuses off a branch |
| 2 | No assignment or history on HQ | **Open.** The tables exist; the routes refuse off a branch. | `wk/routes/branch_approval_assignments.ts` ~38, ~55 |
| 3 | Raw paths and internal words as copy | **Fixed by D1038.** Lanes show their canvas names and their pages. | `fe/pages/admin/approvals/AdminApprovals.jsx` |
| 4 | Dead and noisy rows | **Fixed by D1038.** "Content to HQ" is gone; the no-queue lanes are one card. | same |
| 5 | The Explorers lane counts every explorer | **Open.** D1038 says so on the lane. | `wk/services/approvalSources.ts` (`exploring`) |
| 6 | The Perks queue counts drafts | **Open.** | `wk/routes/perks.ts` ~773 |
| 7 | Wellbeing verification records nothing | **Open.** No reviewer, time, reason, declined state or credentials. | `wk/routes/wellbeing.ts` ~2066-2079 |
| 8 | Co-marketing decisions skip the freeze and tell nobody | **Open.** `requireAuth` plus a role check; no notice; the queue is newest first and unpaged. | `wk/routes/comarketing.ts` ~276-331 |
| 9 | Old addresses in every row | **Fixed by D938** (`/admin/kyc`, `/admin/directory`, the Refer & Earn queue), and by D1038 for Events' Review tab. | `fe/pages/admin/adminStudioOverview.js` `LANE_CONSOLES` |

## 2. The reads on `main`

| Read | Shape | Boards |
|---|---|---|
| `GET /api/admin/studio/glance` (`requireAdmin`) | `approvals.lanes[]`: `key`, `label`, `count` (null if unreadable), `oldest_age_hours`, `sla`; plus `pending_total` (null when a lane failed) and `no_queue` | APR1, APR2, APR11–APR13 |
| `GET /api/comarketing/admin/queue?status=` | `{ items }`, one state per call, newest first, no limit. Each item has partner and attribution counts. | APR6 |
| `GET /api/wellbeing/experts?limit=50` | `matches` (at most 50, ranked) and `total_active`; no created date | APR8 |

Not in any read:
- Items, who sent them and who holds them on HQ.
- Assignment counts.
- Any decision log, and the weekly arrived and decided series.
- Per-lane notifications.
- A count for the nine new lanes.
- HQ's own queues as lanes.
- Any product tester.
- A wellbeing decision record.
- Co-marketing attribution over 30 days.
- "Waiting on HQ" for a studio.

## 3. Board by board

| Board | Drawn by D1038 | Waits for |
|---|---|---|
| APR1 Inbox | **Tiles:** Waiting (with "+" and the failed lane named) and the oldest line. **Waiting by lane:** each lane's count, coloured by its oldest item's band. **Filters:** group chips and search. **Lanes:** the waiting lanes, oldest first, each with its door. | Items, assignment, Over 72 hours per item and the bulk bar (part 2); Decided this week and the weekly chart (part 6); Waiting on HQ and the full table (part 7) |
| APR2 Lanes | The four groups, the New pills, Waiting, Oldest and Decided on; "Could not be read" with Try again; "Not read here yet" for the nine new lanes; Not a queue | Notifies and counts for the new lanes (part 3) |
| APR3 Item drawer and Assign | — | parts 2 and 7 |
| APR4, APR5 Product testers | The board, saying no application is stored | parts 4 and 8 |
| APR6, APR7 Co-marketing | The five states as tabs, each read alone; the table oldest first; attribution codes and counts; decisions stay on `/comarketing` | the gate (part 1), notices and paging (part 5); the drawer and dialogs (part 8) |
| APR8 Wellbeing experts | Four tabs by the directory's own bar (no declined state yet); categories, pricing and completion; no counts when the read stopped at 50 | the decision record, credentials and the declined state (part 5); the drawer and dialogs (part 8) |
| APR9 HQ decides | For a Super Admin: the nine HQ lanes and their pages, two not built yet | counts (part 3) |
| APR10 Decided | "Not read here yet" | parts 6 and 7 |
| APR11–APR13 Empty, loading, error | A measured empty; Reading…; one failed lane named; a failed glance's card, never an empty table | the skeletons and the "Details" reference (part 7) |
| APR14 No permission | An Admin opening an HQ lane link sees the card. A non-admin is sent home by the guard. | the non-admin card (D936's SHL7b) |
| APR15 phone, APR16 dark | — | part 9 |
