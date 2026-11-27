-- 367_cohort_advisor_founder_notice.sql — a cohort's founders are told when an
-- advisor can read them, and can hide themselves from that advisor (D492, U6).
--
-- Migration 206 lets an admin assign an advisor to a Spin-Out Lab cohort, and
-- the assignment opens the cohort's founders — names, email addresses and
-- weekly progress — to that advisor. Founders were never told. The owner's
-- decision (2026-10-02): NOTIFY AND ALLOW OPT-OUT.
--
--   * Each founder gets an in-app notice naming the advisor when access starts
--     — for an assignment already active at rollout, for a new assignment, and
--     for a founder who joins an assigned cohort later — and another when the
--     access ends.
--   * A founder can hide themselves from one advisor. The advisor's founders,
--     weeks and guidance reads then leave them out. The founder can undo it.
--
-- `cohort_advisor_notices` is the delivery ledger, one row per notice actually
-- sent. Its UNIQUE key is what makes the sweep safe to run on every read and
-- every night: a notice is sent only when its row is newly inserted.
-- `episode_at` is the assignment's `assigned_at`: ending and re-assigning the
-- same pair reactivates the same 206 row with a new `assigned_at`, which is a
-- new episode the founder is told about again.
--
-- `cohort_advisor_optouts` is the founder's own choice, kept after it is undone
-- (`withdrawn_at`) so the record of who could see whom, and when, survives.
--
-- STANDS ALONE: users and advisor_cohort_assignments are existing tables.
-- CREATE … IF NOT EXISTS only, no BEGIN/COMMIT.

CREATE TABLE IF NOT EXISTS cohort_advisor_notices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id INTEGER NOT NULL REFERENCES advisor_cohort_assignments(id),
  founder_user_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('started', 'ended')),
  episode_at TEXT NOT NULL,
  notified_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (assignment_id, founder_user_id, kind, episode_at)
);

CREATE INDEX IF NOT EXISTS idx_cohort_advisor_notices_founder
  ON cohort_advisor_notices (founder_user_id, assignment_id);

CREATE TABLE IF NOT EXISTS cohort_advisor_optouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  founder_user_id INTEGER NOT NULL REFERENCES users(id),
  advisor_user_id INTEGER NOT NULL REFERENCES users(id),
  opted_out_at TEXT NOT NULL DEFAULT (datetime('now')),
  withdrawn_at TEXT,
  UNIQUE (founder_user_id, advisor_user_id)
);

CREATE INDEX IF NOT EXISTS idx_cohort_advisor_optouts_advisor
  ON cohort_advisor_optouts (advisor_user_id, withdrawn_at);
