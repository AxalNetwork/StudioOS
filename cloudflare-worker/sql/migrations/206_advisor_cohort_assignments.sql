-- 206 — the join between an advisor and a Lab cohort, beside the Lab.
--
-- WHAT IS MISSING TODAY, in the words the product already uses:
-- `AdvisorBucketRoutes.jsx` renders the whole Cohorts bucket as a deliberate
-- empty state saying "Nothing in the product links an advisor to a cohort. The
-- Lab knows its founders and the practice knows its clients; no table joins
-- them." This is that table. Every Cohorts zone — Founders, Guidance, This
-- week, Calendar, Outcomes — is inexpressible without it: the public endpoints
-- `/api/spinout-lab/cohort` and `/graduates` are company-level and anonymous,
-- so "my batch" cannot be said at all.
--
-- IT CHANGES NO LAB TABLE, ROUTE OR SURFACE. That is a standing instruction —
-- do not touch the Spin-Out Lab or the features within it — and it is honoured
-- literally: this is a NEW table that REFERENCES `cohort_cycles(id)` and
-- nothing else about the Lab is edited. The Lab keeps sole write authority over
-- cohorts, weeks, admission and graduation; this records only who was asked to
-- advise which cycle. Reading a foreign key is not touching the table it points
-- at.
--
-- ADMIN ASSIGNS; THE ADVISOR READS THEIR BATCH. Every other Lab decision is
-- made this way — admission, dates, graduation are all admin acts — and
-- founder data in a cohort is not something an advisor should be able to grant
-- themselves. `assigned_by_admin_id` records who made the call, so the batch an
-- advisor can see always traces back to a person who decided they should.
--
-- WHY `is_active` AND NOT A DELETE. Ending an assignment must not erase that it
-- existed: an advisor who saw a cohort's founders for six weeks saw them, and
-- a record that disappears cannot answer who had access when. `unassigned_at`
-- says when it stopped.
--
-- ONE ROW PER PAIR. UNIQUE (advisor_user_id, cohort_cycle_id) — reassigning
-- the same advisor to the same cycle reactivates the existing row rather than
-- stacking a second one that the reads would then have to de-duplicate.
--
-- KEYED ON `users(id)`, NOT `advisors(id)`, and the distinction matters. The
-- read is authorisation ("may this signed-in person see this batch?"), and
-- authorisation is about the user. An advisor with no `advisors` profile row —
-- the state every newly created advisor account is in — would otherwise be
-- unassignable, which is 197's finding in a different table.

CREATE TABLE IF NOT EXISTS advisor_cohort_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  advisor_user_id INTEGER NOT NULL REFERENCES users(id),
  cohort_cycle_id INTEGER NOT NULL REFERENCES cohort_cycles(id),
  assigned_by_admin_id INTEGER,
  assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  unassigned_at TEXT,
  note TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (advisor_user_id, cohort_cycle_id)
);

CREATE INDEX IF NOT EXISTS idx_advisor_cohort_assignments_advisor
  ON advisor_cohort_assignments(advisor_user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_advisor_cohort_assignments_cycle
  ON advisor_cohort_assignments(cohort_cycle_id, is_active);
