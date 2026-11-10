-- #5207: Persist outbound copy intent without storing event content or credentials.
CREATE TABLE calendar_copy_jobs (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'microsoft')),
  source_kind TEXT NOT NULL,
  source_id INTEGER NOT NULL,
  source_day TEXT NOT NULL,
  generation INTEGER NOT NULL DEFAULT 1,
  attempts INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'parked', 'refused', 'cancelled', 'complete')),
  outcome_code TEXT,
  next_attempt_at INTEGER NOT NULL,
  lease_until INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, provider, source_kind, source_id)
);

CREATE INDEX calendar_copy_jobs_due
  ON calendar_copy_jobs (next_attempt_at)
  WHERE state = 'pending';
