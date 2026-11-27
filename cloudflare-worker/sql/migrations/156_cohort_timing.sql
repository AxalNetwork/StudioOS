-- Cohort Timing & Gating System — automated monthly cohort calendar for
-- Spin-Out Lab. Cohorts start the 1st of each month at 00:00 America/New_York
-- (DST-correct; all values below stored as UTC ISO strings), run 4×7-day
-- weeks. Server-side cron unlocks weeks + evaluates pass/fail at each
-- week's midnight-Delaware deadline.
--
-- NOTE: users is at D1's 100-column ALTER TABLE limit — all per-user cohort
-- state lives in these sidecar tables keyed by user_id (pattern: migration
-- 154 / user_spinout_flags).

CREATE TABLE IF NOT EXISTS cohort_cycles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,               -- 1..12
  start_at TEXT NOT NULL,               -- UTC instant of 1st 00:00:00 ET
  end_at TEXT NOT NULL,                 -- UTC instant of day-29 00:00:00 ET (start + 28 wall-clock days)
  status TEXT NOT NULL DEFAULT 'scheduled',  -- scheduled | active | completed
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(year, month)
);

CREATE TABLE IF NOT EXISTS week_windows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cohort_cycle_id INTEGER NOT NULL REFERENCES cohort_cycles(id),
  week_number INTEGER NOT NULL,         -- 1..4
  unlock_at TEXT NOT NULL,              -- UTC
  deadline_at TEXT NOT NULL,            -- UTC (midnight ET ending day 7·N)
  UNIQUE(cohort_cycle_id, week_number)
);

-- Per-company (per-founder) weekly outcome. status transitions:
-- pending → passed | failed | grace; grace → passed | failed;
-- admin overrides may set passed/failed at any time (decided_by='admin:<id>').
CREATE TABLE IF NOT EXISTS company_week_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  cohort_cycle_id INTEGER NOT NULL REFERENCES cohort_cycles(id),
  week_number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | passed | failed | grace
  deliverables_done INTEGER NOT NULL DEFAULT 0,
  deliverables_required INTEGER NOT NULL DEFAULT 0,
  grace_until TEXT,                     -- UTC; active grace extension deadline
  grace_reason TEXT,
  decided_at TEXT,
  decided_by TEXT,                      -- 'system' | 'admin:<id>'
  decision_reason TEXT,
  UNIQUE(user_id, cohort_cycle_id, week_number)
);
CREATE INDEX IF NOT EXISTS ix_cws_cycle_week ON company_week_status(cohort_cycle_id, week_number, status);
CREATE INDEX IF NOT EXISTS ix_cws_user ON company_week_status(user_id);

-- Frozen copy of each gating deliverable at decision time.
CREATE TABLE IF NOT EXISTS deliverable_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  cohort_cycle_id INTEGER NOT NULL,
  week_number INTEGER NOT NULL,
  deliverable_key TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  snapshotted_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_ds_user_cycle ON deliverable_snapshots(user_id, cohort_cycle_id, week_number);

-- Every automated + manual stage decision, for audit.
CREATE TABLE IF NOT EXISTS stage_transition_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  cohort_cycle_id INTEGER,
  week_number INTEGER,
  from_status TEXT,
  to_status TEXT NOT NULL,
  reason TEXT,
  triggered_by TEXT NOT NULL DEFAULT 'scheduler',  -- scheduler | admin
  admin_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_stl_user ON stage_transition_log(user_id, created_at DESC);

-- Idempotency ledger for scheduled jobs. idempotency_key example:
-- 'week_unlock:12:3' (job:cycle:week). INSERT OR IGNORE claims the run.
CREATE TABLE IF NOT EXISTS scheduled_jobs_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_type TEXT NOT NULL,
  cohort_cycle_id INTEGER,
  week_number INTEGER,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'completed',
  notes TEXT,
  ran_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per (user, window, threshold) reminder — retries can't double-send.
CREATE TABLE IF NOT EXISTS cohort_reminder_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  week_window_id INTEGER NOT NULL,
  threshold_hours INTEGER NOT NULL,     -- 48 | 24 | 3
  sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, week_window_id, threshold_hours)
);

-- Admin "view as founder" session audit trail.
CREATE TABLE IF NOT EXISTS impersonation_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_user_id INTEGER NOT NULL,
  target_user_id INTEGER NOT NULL,
  context TEXT,                         -- e.g. 'cohort_review:cycle=12:week=2'
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_imp_admin ON impersonation_sessions(admin_user_id, started_at DESC);
