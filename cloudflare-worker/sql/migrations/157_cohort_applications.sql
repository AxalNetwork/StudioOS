-- Cohort Application Deadlines & Auto-Notifications — automated monthly
-- application lifecycle on top of the cohort_cycles calendar (migration 156).
-- Applications close 7 days before the 1st at 23:59:59 America/New_York
-- (DST-correct; stored as UTC), admins review during the decision window,
-- capacity rules may postpone + roll a cohort forward, and accepted founders
-- are activated at 00:00 Delaware time on the 1st — all via Worker cron.
--
-- NOTE: users is at D1's 100-column ALTER limit — all per-user state lives
-- in sidecar tables keyed by user_id (pattern: user_spinout_flags).

-- Application-window fields on the cycle. app_status lifecycle:
--   open → reviewing (at close) → active (activated on the 1st)
--                               → postponed (below-minimum, rolled forward)
ALTER TABLE cohort_cycles ADD COLUMN applications_open_at TEXT;
ALTER TABLE cohort_cycles ADD COLUMN applications_close_at TEXT;
ALTER TABLE cohort_cycles ADD COLUMN app_status TEXT NOT NULL DEFAULT 'open';
ALTER TABLE cohort_cycles ADD COLUMN force_proceed INTEGER NOT NULL DEFAULT 0;

-- Applicant ↔ cycle assignment (rollover-aware). One row per application
-- per cycle; a rolled-forward applicant gets a NEW row on the next cycle
-- with rolled_from_cycle_id pointing back. status lifecycle:
--   pending → approved | rejected | waitlisted
--   approved/waitlisted/pending → rolled_forward (cycle postponed)
--   approved → activated (workspace unlocked on the 1st)
CREATE TABLE IF NOT EXISTS cohort_applicants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  cohort_cycle_id INTEGER NOT NULL REFERENCES cohort_cycles(id),
  status TEXT NOT NULL DEFAULT 'pending',
  rolled_from_cycle_id INTEGER,
  decided_at TEXT,
  decided_by TEXT,                      -- 'system' | 'admin:<id>'
  decision_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(application_id, cohort_cycle_id)
);
CREATE INDEX IF NOT EXISTS ix_cohort_applicants_cycle ON cohort_applicants(cohort_cycle_id, status);
CREATE INDEX IF NOT EXISTS ix_cohort_applicants_user ON cohort_applicants(user_id);

-- Cycle lifecycle audit (close/postpone/force-proceed/activation/settings…).
CREATE TABLE IF NOT EXISTS cohort_cycle_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cohort_cycle_id INTEGER,
  event_type TEXT NOT NULL,
  details TEXT,
  actor TEXT NOT NULL DEFAULT 'scheduler',  -- 'scheduler' | 'admin:<id>'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_cohort_cycle_events_cycle ON cohort_cycle_events(cohort_cycle_id, created_at);

-- Notification send ledger — one row per (user, cycle, type); the UNIQUE
-- key is the idempotency claim so cron re-runs never double-send.
CREATE TABLE IF NOT EXISTS cohort_app_notification_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  cohort_cycle_id INTEGER NOT NULL,
  notif_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent',
  sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, cohort_cycle_id, notif_type)
);
CREATE INDEX IF NOT EXISTS ix_cohort_app_ledger_cycle ON cohort_app_notification_ledger(cohort_cycle_id, notif_type);

-- Admin-editable settings (min_cohort_size / max_cohort_size).
CREATE TABLE IF NOT EXISTS cohort_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT
);
