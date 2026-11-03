### Learning: per-video analytics (D4181, #4181)

- **Worker:** `routes/admin_learning.ts`, at `/api/admin/learning`:
  - `GET /items/:uid/analytics`, Super Admin only.
  - It answers `{ item: { uid, title, duration_seconds }, analytics }`.
  - The figures come from `services/learningAnalytics.ts`, over `learning_progress` (`subject_kind = 'item'`): views, completion %, median watch time, and the share still watching at the start of each of 20 spans, with the biggest drop and its chapter.
  - A reading is 422 `not_a_video`; an unknown item is 404.
- **No small cohorts:** under five viewers, `analytics` is `{ enough: false, reason: 'Not enough views to show' }` and carries no figure. The curve has the same floor over viewers whose position is known.
- **Not recorded, never 0:** a null duration makes the curve `{ available: false, reason: 'Not recorded' }`. A view with no position is counted as a view and left out of the curve (`unrecorded`).
- **No member is named:** the read selects no user id, and the reply is counts, a rate, a median and shares.
- **Client:** `adminLearningApi.itemAnalytics(uid)`.
- **Page:** "Analytics" on a video's row of the studio content table opens `VideoAnalyticsSheet.jsx`.
