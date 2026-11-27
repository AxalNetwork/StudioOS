### Learning on the Calendar: a member's own learning plan (#3959, Worker half)

- **Worker:** `routes/learning_plan.ts` at `/api/learning/plan` (mounted before `learning.ts`): `GET /?from=&to=` (at most 92 days; each item with its `occurrences`, `href`, `available`, `status` and `done_recorded_by`), `POST /`, `PATCH /:uid`, `DELETE /:uid`, `POST /:uid/done`. Service `services/learningPlan.ts`; migration 758 (`learning_plan_items`, `learning_plan_reminders`).
- **Rules:** only a subject `canSeeLearning` allows is planned (else 404 `not_found`); a webinar keeps its own time (409 `webinar_time_fixed` on a move) and registers through D560's capacity check (409 `full`); an exam plan never starts an attempt; done is automatic when Learning records it; every statement binds the caller; a support session is refused.
- **Calendar:** the `learning` kind in the source registry (`services/calendar.ts`, family "Learning"), page-only like `compliance_due`: plan occurrences and registered webinars, each linked to its Learning page. Program due dates are not included: no program records one.
- **Reminders:** the 5-minute cron's `sendPlanReminders`, through `notify()` (category `calendar`).
- **Client:** `lib/api/learningPlan.js` (`learningPlanApi`), called only from `pages/learning/planReads.js`.
- **Pages (D3959, the frontend half).** The owner chose to build them without new boards, from the existing Learning and Calendar boards:
  - **"Add to my plan"** is a header action on `/learning/courses/:slug`, `/learning/courses/:slug/:lesson`, `/learning/videos/:uid` (a video), `/learning/webinars/:slug`, `/learning/exercises/:slug` and `/learning/exams/:slug`. Its sheet is `PlanSheet.jsx`, from CAL7.
  - **`/learning/plan`** is My learning plan (`LearningPlanPage.jsx`), from LR12 and, since #4742, LR1: "My learning plan" sits in the progress strip (`ProgressStrip`'s `links`, `LearningPage.jsx`'s `learnerLinks()`) for every profile the gate admits, not only an admin, and unlabelled on the phone. My learning links to it too.
  - **The Calendar:** a Learning entry offers Mark done, Reschedule, Open in Learning and Remove (`PlanRowActions.jsx`, CAL19's dialogs). A webinar keeps its own time, and a webinar the member is only registered for just opens.
  - **"New ▾ › Plan learning"** opens the sheet with its picker (CAL6's menu).

