### Learning on the Calendar: a member's own learning plan (#3959, Worker half)

- **Worker:** `routes/learning_plan.ts` at `/api/learning/plan` (mounted before `learning.ts`): `GET /?from=&to=` (at most 92 days; each item with its `occurrences`, `href`, `available`, `status` and `done_recorded_by`), `POST /`, `PATCH /:uid`, `DELETE /:uid`, `POST /:uid/done`. Service `services/learningPlan.ts`; migration 758 (`learning_plan_items`, `learning_plan_reminders`).
- **Rules:** only a subject `canSeeLearning` allows is planned (else 404 `not_found`); a webinar keeps its own time (409 `webinar_time_fixed` on a move) and registers through D560's capacity check (409 `full`); an exam plan never starts an attempt; done is automatic when Learning records it; every statement binds the caller; a support session is refused.
- **Calendar:** the `learning` kind in the source registry (`services/calendar.ts`, family "Learning"), page-only like `compliance_due`: plan occurrences and registered webinars, each linked to its Learning page. Program due dates are not included: no program records one.
- **Reminders:** the 5-minute cron's `sendPlanReminders`, through `notify()` (category `calendar`).
- **Client:** `lib/api/learningPlan.js` (`learningPlanApi`). **Pages wait on design:** "Add to my plan", `/learning/plan` and the Calendar's Learning actions wait on LRN1–LRN3 and CAL12 (#3723, `needs-design`).

