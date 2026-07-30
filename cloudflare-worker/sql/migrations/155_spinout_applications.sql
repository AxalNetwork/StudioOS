-- Spin-Out Lab cohort applications. One row per submission; founders may
-- re-apply after a refusal. Reviewed by admins (accept → admitted flags on
-- users + spinout_admitted email; refuse → spinout_refused email).
CREATE TABLE IF NOT EXISTS spinout_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  company_name TEXT NOT NULL,
  idea TEXT NOT NULL,
  incorporated TEXT NOT NULL DEFAULT 'no',
  stage TEXT,
  jurisdiction TEXT,
  cohort TEXT NOT NULL DEFAULT 'Cohort 4',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_spinout_applications_user ON spinout_applications(user_id);
CREATE INDEX IF NOT EXISTS ix_spinout_applications_status ON spinout_applications(status);
