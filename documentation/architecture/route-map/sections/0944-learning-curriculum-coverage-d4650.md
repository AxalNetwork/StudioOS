### Learning: the curriculum coverage record (#4650, D4650 part 4)

- **Worker:** `GET /api/admin/learning/coverage` in `routes/admin_learning.ts` (Super Admin, read-only). Service `services/learningCoverage.ts`. It reads the course catalogue only: title, status, visibility, audience and stage, and no learner's row. Answer: `{ coverage: { journeys: [{ journey, state, published, inaccessible, unknown, stages, stage_not_recorded }], courses, audience_not_recorded, audience_recorded, truncated } }`. A failed read is `503 coverage_unreadable`.
- **States:** `published`, `inaccessible` (draft, archived or program-only), `unknown` (a course records no audience) and `missing` (every course records an audience, and none names the journey).
- **Client:** `lib/api/adminLearning.js` `coverage()`, called from `pages/learning/studioActions.js` (`readCoverage`). The studio's `pages/learning/CurriculumCoverage.jsx` draws it under the content table.
