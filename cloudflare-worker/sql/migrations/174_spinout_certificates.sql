-- Spin-Out Lab graduation certificates: persistence and public verification.
-- This is deliberately additive and idempotent so it can be applied safely to
-- the existing production database without replaying its historical ledger.

CREATE TABLE IF NOT EXISTS spinout_certificates (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  credential_id       TEXT UNIQUE NOT NULL,
  public_token        TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
  user_id             INTEGER NOT NULL,
  project_id          INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  public_name         TEXT NOT NULL,
  public_company      TEXT,
  public_cohort       TEXT,
  public_issued_on    TEXT NOT NULL,
  public_jurisdiction TEXT,
  public_program_days INTEGER,
  status              TEXT NOT NULL DEFAULT 'issued',
  revoked_at          TEXT,
  revocation_reason   TEXT,
  public_share_enabled INTEGER NOT NULL DEFAULT 1,
  issued_by_user_id   INTEGER,
  issued_at           TEXT NOT NULL DEFAULT (datetime('now')),
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_spinout_cert_user_issued
  ON spinout_certificates(user_id) WHERE status = 'issued';
CREATE INDEX IF NOT EXISTS idx_spinout_cert_token ON spinout_certificates(public_token);
CREATE INDEX IF NOT EXISTS idx_spinout_cert_credid ON spinout_certificates(credential_id);
CREATE INDEX IF NOT EXISTS idx_spinout_cert_user ON spinout_certificates(user_id);