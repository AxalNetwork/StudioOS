-- 564_investor_cohort_access.sql — D959 (#2792, Programs part 6): an admin
-- gives a verified investor access to one Lab cohort; the investor reads that
-- cohort's ventures once they have signed the cohort NDA; founders are told,
-- can hide from one investor, and accept or decline an introduction request.
--
-- The owner's answers (D953 §5, on #2792, 2026-10-26):
--   O-VER A  verified = role investor, an active account, approved KYC (D653).
--   O-NDA B  one cohort NDA per grant, from an HQ template, signed by the investor.
--   O-INT B  intro requests live here, apart from the paid introductions quota.
--   O-SEE A  each venture's summary and weekly progress, never a founder's email.
--
-- investor_cohort_access: ONE ROW PER GRANT, not per pair. 206 keeps one row
-- per advisor and cycle and a re-assign overwrites the earlier dates (map F5);
-- here the unique index covers only the open grant, so an ended grant keeps its
-- dates and a new grant is a new row. `ends_at` is the last day of access
-- (YYYY-MM-DD, inclusive); the nightly sweep closes a grant past it with
-- end_reason 'expired'. `scope_json` is what the grant opens. The NDA columns
-- name the template slug and the envelope; `nda_signed_at` is set once by the
-- e-sign completion hook.
--
-- investor_cohort_notices: the delivery ledger, one row per notice sent; a
-- notice is sent only when its row is newly inserted.
--
-- investor_cohort_optouts: a founder hides from one investor. One row per hide;
-- the unique index covers only the hide in force, so hiding again while hidden
-- changes nothing and keeps the first date (367's re-hide overwrote it, map F6),
-- and showing again keeps the row with its `withdrawn_at`.
--
-- investor_cohort_intro_requests: one request per grant and founder; the
-- founder decides once.
--
-- STANDS ALONE: users and cohort_cycles are existing tables.
-- CREATE … IF NOT EXISTS only, no BEGIN/COMMIT.

CREATE TABLE IF NOT EXISTS investor_cohort_access (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  investor_user_id INTEGER NOT NULL REFERENCES users(id),
  cohort_cycle_id INTEGER NOT NULL REFERENCES cohort_cycles(id),
  granted_by_admin_id INTEGER REFERENCES users(id),
  granted_at TEXT NOT NULL DEFAULT (datetime('now')),
  ends_at TEXT NOT NULL,
  ended_at TEXT,
  ended_by_admin_id INTEGER REFERENCES users(id),
  end_reason TEXT CHECK (end_reason IS NULL OR end_reason IN ('admin', 'expired')),
  note TEXT CHECK (note IS NULL OR length(note) <= 1000),
  scope_json TEXT NOT NULL DEFAULT '["summary","weekly_progress"]',
  nda_template_slug TEXT NOT NULL DEFAULT 'investor_cohort_nda_v1',
  nda_envelope_uuid TEXT,
  nda_sent_at TEXT,
  nda_signed_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_investor_cohort_access_open
  ON investor_cohort_access (investor_user_id, cohort_cycle_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_investor_cohort_access_cycle
  ON investor_cohort_access (cohort_cycle_id, ended_at);
CREATE INDEX IF NOT EXISTS idx_investor_cohort_access_envelope
  ON investor_cohort_access (nda_envelope_uuid);

CREATE TABLE IF NOT EXISTS investor_cohort_notices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  grant_id INTEGER NOT NULL REFERENCES investor_cohort_access(id),
  founder_user_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('started', 'ended')),
  notified_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (grant_id, founder_user_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_investor_cohort_notices_founder
  ON investor_cohort_notices (founder_user_id, grant_id);

CREATE TABLE IF NOT EXISTS investor_cohort_optouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  founder_user_id INTEGER NOT NULL REFERENCES users(id),
  investor_user_id INTEGER NOT NULL REFERENCES users(id),
  opted_out_at TEXT NOT NULL DEFAULT (datetime('now')),
  withdrawn_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_investor_cohort_optouts_open
  ON investor_cohort_optouts (founder_user_id, investor_user_id) WHERE withdrawn_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_investor_cohort_optouts_investor
  ON investor_cohort_optouts (investor_user_id, withdrawn_at);

CREATE TABLE IF NOT EXISTS investor_cohort_intro_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  grant_id INTEGER NOT NULL REFERENCES investor_cohort_access(id),
  investor_user_id INTEGER NOT NULL REFERENCES users(id),
  founder_user_id INTEGER NOT NULL REFERENCES users(id),
  cohort_cycle_id INTEGER NOT NULL REFERENCES cohort_cycles(id),
  message TEXT CHECK (message IS NULL OR length(message) <= 1000),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at TEXT,
  decision TEXT CHECK (decision IS NULL OR decision IN ('accepted', 'declined')),
  UNIQUE (grant_id, founder_user_id)
);

CREATE INDEX IF NOT EXISTS idx_investor_cohort_intros_founder
  ON investor_cohort_intro_requests (founder_user_id, decided_at);
