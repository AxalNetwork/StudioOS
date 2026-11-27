# frontend/src/pages/partner/delivery — the partner Delivery bucket's zones

The five Delivery zones of the Partner Operator Canvas, each the body of one
`/delivery/*` address. `frontend/src/workspaces/partner/PartnerBucketRoutes.jsx`
maps each address to its zone; the bucket root's board is
`frontend/src/workspaces/boards/partnerDelivery.js`.

| File | What it is |
| --- | --- |
| `BoardZone.jsx` | `/delivery/board`, and `/delivery` itself since D4822: the action-first Board (Attention/All/Projects/Embedded), one empty state, the engagement Sheet, and the lifecycle from `EngagementLifecycle.jsx` (D395). |
| `EngagementLifecycle.jsx` | An engagement's lifecycle and invoice ledger, drawn inside the board. |
| `DeliverablesZone.jsx` | `/delivery/deliverables`. |
| `CapacityZone.jsx` | `/delivery/capacity`: seats inside client systems, client and internal hours, the firm's own cap. |
| `StatusReportsZone.jsx` | `/delivery/status-reports`. Its amber header primary "New report" (D1424) opens and focuses the Composer, where Ask fills Done and Next (D1329). The other four zones have no primary: their header ops are stated gaps (owner answer I). |
| `statusReportDraft.js` | #4673 (D4673): a composed report belongs to the engagement and period it was composed for. `latestOnly` drops a response that lands after the selection moved, `draftFrom` keeps the identity asked for, and `saveRequest` saves into the draft's own engagement and period, which the Worker checks. |
| `useZoneMutations.js` | #4698 (D4698): `useZoneRead` keeps a zone's populated content mounted while it re-reads (the skeleton is for the first read only) and keeps the rows if a re-read fails; `useMutations` tracks each write by key before its request starts, so a repeated click sends nothing and independent rows do not block each other, and resolves `{ ok }` so an editor closes or resets only on a confirmed save. |
| `HealthZone.jsx` | `/delivery/health`: each engagement's health, milestones and blockers, with `FounderReviews.jsx` (D390). |
| `FounderReviews.jsx` | The founders' reviews of this firm, shown on Health. |
| `deliveryEdits.jsx` | The edits Health and Capacity share (D637): a blocker's Clear and Delete as two actions, a seat's scope edited in place, and client hours by entry, where a deleted entry reads "Not recorded", never 0. |
| `boardAttention.js` | D4822 (#4822): Board v2's pure reading of a row — the attention reasons (facts only, never an unrated row), the next action, progress in the mode's own measure, mode and value, the view counts and the page's one primary action. |
| `EngagementSheet.jsx` | D4822 (#4822): PD6, the cross-zone engagement Sheet opened from a Board row (`?engagement=`), built from that row: next action and one summary per zone, each linking into it. |
| `engagementFocus.jsx` | D4822 (#4822, part 2): the Sheet's engagement kept across zones — each zone reads `?engagement=` (uid or id), narrows its rows to it, draws the focus bar (whose rows, how many of the total, Back to engagement, Show all) and preselects it in its create form. An unknown value narrows to nothing and says so. |
| `HealthPill.jsx` | D4822 (#4822): an engagement's health as word and mark, with Not rated dashed and never green. |

**Adding a zone.** A zone body imports from `../kit.jsx`, draws the canvas's
four states (loading, empty, "Not recorded" with its reason, "Unreadable" with
Try again), and is mapped in `PartnerBucketRoutes.jsx`. A piece two zones
share goes in `deliveryEdits.jsx` or a file like it, pure over its props, so a
test can render it.
