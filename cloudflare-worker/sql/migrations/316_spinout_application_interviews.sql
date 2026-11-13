-- 316_spinout_application_interviews.sql — the partner interview on a
-- Spin-Out Lab application (D383, wave 8, Session 10, item 4).
--
-- The Apply & Status canvas puts a "Partner interview" stage in the
-- application's timeline and an interview card on the status screen: when it
-- is, how long, where, with "Add to calendar" and "Reschedule". Nothing stored
-- an interview; the apply page's own copy promised "a 30-minute call" that no
-- row could confirm had been booked.
--
--   spinout_application_interviews — one row per scheduled interview. An
--     admin schedules it (`scheduled_by`) against the application; the
--     applicant can ask to move it (`reschedule_requested_at` and their
--     reason), which does not move it — an admin does, by scheduling again.
--     `status` is scheduled, cancelled or completed. Only the latest row for
--     an application is the live one; earlier rows are its history.
--
-- STANDS ALONE and idempotent. CREATE … IF NOT EXISTS only.

CREATE TABLE IF NOT EXISTS spinout_application_interviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  scheduled_at TEXT NOT NULL,
  duration_min INTEGER NOT NULL DEFAULT 30,
  location TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled',
  scheduled_by INTEGER,
  reschedule_requested_at TEXT,
  reschedule_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_spinout_app_interviews_app
  ON spinout_application_interviews(application_id, id);
CREATE INDEX IF NOT EXISTS ix_spinout_app_interviews_user
  ON spinout_application_interviews(user_id);
