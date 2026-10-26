-- D1230 / #3238: KYC part 2. A case sent to HQ, and each screening attempt
-- made on submission.
--
-- kyc_hq_referrals: one row per reason a person's KYC case went to HQ. The
-- Worker raises `pep` (self-disclosed) and `sanctions_match` (an unreviewed
-- match on the submission screening) on its own, with raised_by NULL; an
-- admin raises `admin` with a note. While a row is undecided only a Super
-- Admin decides the case, on `POST /api/kyc/admin/:userId/hq/decide`.
CREATE TABLE IF NOT EXISTS kyc_hq_referrals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (reason IN ('pep', 'sanctions_match', 'admin')),
  note TEXT CHECK (note IS NULL OR length(note) <= 1000),
  screening_id INTEGER,
  raised_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  raised_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decided_at TEXT,
  decision TEXT CHECK (decision IS NULL OR decision IN ('approved', 'rejected')),
  decision_note TEXT CHECK (decision_note IS NULL OR length(decision_note) <= 1000)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_kyc_hq_referrals_open
  ON kyc_hq_referrals(user_id, reason) WHERE decided_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_kyc_hq_referrals_user ON kyc_hq_referrals(user_id, id);

-- kyc_screening_attempts: whether the submission screening ran. A failed run
-- writes no sanctions_screenings row, so without this the case could not tell
-- "could not be read" from "never screened", and must never read either as
-- clear. Reasons are codes, never list text or names.
CREATE TABLE IF NOT EXISTS kyc_screening_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  outcome TEXT NOT NULL CHECK (outcome IN ('screened', 'unreadable')),
  reason TEXT CHECK (reason IS NULL OR reason IN ('lists_unavailable', 'not_recorded', 'error')),
  screening_id INTEGER,
  attempted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_kyc_screening_attempts_user ON kyc_screening_attempts(user_id, id);
