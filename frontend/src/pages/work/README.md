# pages/work — Work and company compliance (D1614, #3968)

Only projects have Work; a company carries its legal and compliance tasks
(the owner, 2026-11-01). The canvases are `design/incoming/Work Compliance Page.dc.html`
and `Work Compliance · Boards.dc.html`.

| File | What it holds |
| --- | --- |
| `WorkPage.jsx` | `/projects/:id/work`: the header, the Board · Backlog · Burn-up · My items · Workload views (WK1–WK3, WK7), the item sheet (WK4) and the run sheet (WK5, W3's detail with Retry). |
| `CompliancePage.jsx` | `/account/companies/:uid/settings/compliance`: the agenda (Overdue, then months, CO2), the task sheet with "Create work in a project…" (CO3), the read-only member (CO3r). |
| `workModel.js` | The words and rules as plain functions: columns, cards, the burn-up's geometry, the agenda, who may change compliance tasks. |
| `ActivityFeed.jsx` | WK6 (#3974): a project's activity feed on its Team page (Team › Activity): People · AI agents · Both, one person or agent with their lists, Show older, a run's sheet. |
| `WorkloadView.jsx` | WK7 (#3974): the project's Workload (Work › Workload): rows per person and agent, grouped by role (W8, #3994), weeks as columns, amber over a recorded capacity, drag to reassign, Schedule work. |
| `AssignPicker.jsx` | W8 (#3994): the Assignees picker on a task's sheet — this Team's people (role badge in their licence's accent, open tasks, capacity), then its AI agents (role, status); a refusal in the Worker's words. |
| `MyTasks.jsx` | W8 (#3994): every task given to the reader, by project then by company's compliance, with State and Due filters; placed in each licence's workspace (D1614 §14) and as Work › My items. |
| `workAdapter.js` | The one seam. Every method is off until its Worker part lands; `WORK_SEAM` names each method's issue. |
| `WorkSummaryCard.jsx` | #4420: project Portfolio ENTRY card, board counts and the two-week burn-up, with independent failed reads. |
| `work.css` | Styles scoped to `.wk-page`, each colour with its `.dark` pair. |
| `TaskTimeline.jsx` | W7 (#4419): Activity, Team mentions, own comment edits and deletes, run links and honest cost. |
| `TaskReview.jsx` | W7 (#4419): manager review with a required changes comment. |
| `TaskDraft.jsx` | W7 (#4419): accept, edit before accept and discard with reason. |
| `TaskDrafts.jsx` | W7 (#4419): Triage's draft proposals and their 560px sheet. |
| `TaskClassification.jsx` | WK9 (#4419): item labels and milestone pickers. |
| `WorkSettings.jsx` | WK9 (#4419): label and milestone management in Project settings. |

**Adding to it:** a new read or write goes through `workAdapter.js`, with its
client in `frontend/src/lib/api/` (D527) once its route is on `main`.
