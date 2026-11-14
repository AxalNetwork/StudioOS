-- D1043 (#2891): expert credentials, private evidence files and decision trail.
ALTER TABLE experts ADD COLUMN decision_state TEXT NOT NULL DEFAULT 'pending' CHECK (decision_state IN ('pending', 'verified', 'declined'));
ALTER TABLE experts ADD COLUMN decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE experts ADD COLUMN decided_at TEXT;
ALTER TABLE experts ADD COLUMN decline_reason TEXT;
ALTER TABLE experts ADD COLUMN licence_number TEXT;
ALTER TABLE experts ADD COLUMN licence_issuer TEXT;
ALTER TABLE experts ADD COLUMN licence_expires_on TEXT;
ALTER TABLE experts ADD COLUMN review_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE experts ADD COLUMN decision_token TEXT;
-- Existing verification is real; its actor and date are not recorded.
UPDATE experts SET decision_state = 'verified' WHERE verified = 1;

CREATE TABLE IF NOT EXISTS expert_credential_files (
  uid TEXT PRIMARY KEY,
  expert_id INTEGER NOT NULL REFERENCES experts(id) ON DELETE CASCADE,
  file_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size INTEGER NOT NULL CHECK (file_size > 0),
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_expert_credential_files_expert ON expert_credential_files(expert_id, created_at, uid);

CREATE TABLE IF NOT EXISTS expert_review_decisions (
  uid TEXT PRIMARY KEY,
  expert_id INTEGER NOT NULL REFERENCES experts(id) ON DELETE CASCADE,
  decision TEXT NOT NULL CHECK (decision IN ('verified', 'unverified', 'declined', 'hidden', 'restored')),
  decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decided_at TEXT NOT NULL,
  reason TEXT,
  credentials_checked INTEGER NOT NULL DEFAULT 0 CHECK (credentials_checked IN (0, 1)),
  review_version INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_expert_review_decisions_expert ON expert_review_decisions(expert_id, decided_at, uid);
