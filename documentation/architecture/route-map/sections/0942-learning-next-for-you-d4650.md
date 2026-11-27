### Learning: the member's next learning action (#4650, D4650)

- **Worker:** `GET /api/learning/plan/next` in `routes/learning_plan.ts` (read-only, the caller's own data). Service `services/learningNext.ts`. Answer: `{ next: { rule, kind, uid, title, href, reason, plan } | null, checked, empty }`.
- **Rules, in order:** `continue_course` (the next required lesson of the course most recently worked on), `program` (the first content not complete by D4643 in the published programs the member is enrolled in), `plan` (the next planned, upcoming item). Every candidate passes `resolveSubject` (`canSeeLearning`) first; one the member cannot see is skipped.
- **Client:** `lib/api/learningPlan.js` `next()`. My learning's "Next for you" card (`pages/learning/NextForYou.jsx`) replaces the old future-recommendation block; its "Add to my plan" is D3959's sheet.
