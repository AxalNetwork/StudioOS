# `pages/advisor/cohorts` — the Cohorts workspace

An advisor's assigned cohort, read from the Spin-Out Lab and read-only both
ways. D4813 (#4813) turned `/cohorts` from a directory of zone cards into a
command centre with **one selected cohort for the whole workspace**: the
`?cohort=<cycleId>` query parameter, validated against the advisor's own
assignments and carried by every section link. The shell (crumb, title, the
selector row, the section tabs and the Worker AI rail) is drawn by
`frontend/src/workspaces/advisor/AdvisorBucketRoutes.jsx`; every file here
except the provider renders a body only.

| File | What it is | Reads |
| --- | --- | --- |
| `CohortWorkspace.jsx` | The provider that resolves and writes back the selected cohort, the header row (selector, dates, Week n of 4, Refresh) and the six section tabs, `useCohortRead`, and the status badge | `/me/cohort`, and the shared `/me/cohort/:id/weeks` |
| `cohortModel.js` | Pure decisions: selection and fallback, `guardedRead` (a late response for another cohort is dropped), founder states, the progress grid, attention items, the agenda, guidance activity and the summary figures | — |
| `OverviewZone.jsx` | `/cohorts`, board C1: needs your attention, cohort progress, next 7 days, recorded activity; the C18 preview | founders, guidance, calendar |
| `FoundersZone.jsx` | `/cohorts/founders`, boards C2, C3 and C13: state board, semantic table, phone cards | founders, guidance |
| `GuidanceZone.jsx` | `/cohorts/guidance`, boards C5 and C14: the feed with New guidance always available, the five filters (`?filter=`), and Edit, Publish, Retire, Restore, Answer and History per item | guidance, and its publish and history routes |
| `GuidanceComposer.jsx` | Board C6 (full screen at 390px, C14): title, cohort, optional week, body, preview, Save draft and Publish, with every save state announced and a version conflict offered as compare | guidance writes |
| `guidanceModel.js` | Pure decisions for guidance: status, filters, titles, the week rule the Worker enforces, unsaved text kept per cohort, and `guardedWrite` (a write that answers after the cohort changed is dropped) | — |
| `ThisWeekZone.jsx` | `/cohorts/this-week`: the batch's week from the Lab | the shared week record |
| `CalendarZone.jsx` | `/cohorts/calendar`: Lab dates and booked sessions, the next 14 days | calendar |
| `OutcomesZone.jsx` | `/cohorts/outcomes`: programme outcomes, company-level and anonymous | the public Spin-Out Lab endpoints |
| `kit.jsx` | The seam line, the no-batch boundary and the week tones | — |

Rules for adding here: a new section reads through `useCohortRead` (or the
provider's week record) so it follows the selection and drops stale
responses; unknown is drawn as Not recorded, never zero; a founder the Worker
does not return is never shown; and a Worker read comes before any frontend
method (`cloudflare-worker/src/routes/advisors_cohorts.ts`).
