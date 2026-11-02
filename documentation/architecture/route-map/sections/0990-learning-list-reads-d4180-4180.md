### Learning list reads (D4180, #4180)

- **Worker:** `routes/learning_lists.ts`, mounted by the route registry at `/api/learning`, beside `learning.ts` and `learning_assessment.ts`:
  - `GET /exercises?limit&offset` → `{ items: [{ uid, title, where, status, updated_at, … }], total, limit, offset }`
  - `GET /exams?limit&offset` → `{ items: [{ uid, title, where, question_count, time_limit_minutes, pass_mark_percent, attempts_left, best_score_percent, passed, … }], total, limit, offset }`
  - `GET /me/submissions` and `GET /me/attempts` → the caller's own rows, newest first.
  - `GET /me/stats` → `{ month, courses_in_progress, lessons_completed_this_month, watch_seconds_this_month, exams: { passed, sat } }`.
- **Visibility:** the lists show published items only, and a `program` item only to an enrolled member, whatever the role. Every row also goes through `canSeeLearning`.
- **Not recorded is null, never 0:** a best score with no submitted attempt, watch time with no recorded position, and a figure whose store cannot be read.
- **Changed reads in `learning.ts`:**
  - `GET /courses/:slug` gives each lesson `duration_seconds`: its item's length, or null.
  - `GET /catalog`'s `q` reaches a video's or reading's transcript, and such a row carries `match: { in, snippet, at_seconds }`. `max_minutes` keeps what has a recorded length within it, and a source with no length is `filtered_out`.
- **Webinars:** the detail read (`learning_webinars.ts`) gives the host `attended_count` (null when no attendance is recorded) and `registered_count`. The host is the Super Admin or the webinar's maker.
- **Client:** `lib/api/learning.js`: `exercises`, `exams`, `mySubmissions`, `myAttempts`, `myStats`.
- **Pages:** the Exercises and Exams tabs (`LearningHome.jsx`'s `AssessmentList`), My learning's Exercises and Exam results (`LearningWired.jsx`), the catalog's transcript line, and lesson lengths on the course outline.
