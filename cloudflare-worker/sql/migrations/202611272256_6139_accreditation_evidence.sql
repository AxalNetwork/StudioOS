-- D6139 part 1 (#6139): accreditation evidence, uploaded by the investor and
-- reviewed by the fund team. Owner answer A (2026-11-27): the only evidence is a
-- verification letter from a CPA, an attorney, a broker-dealer or a registered
-- adviser (`basis` names which). The file is a record in R2 under
-- `accreditation-evidence/<user_id>/` (written once, D6651); this row holds its
-- key, type, size and SHA-256, never its bytes.
--
-- `status` is the letter's review: `submitted` (uploaded, not yet opened),
-- `in_review`, `accepted` (with `expires_at`, the accreditation period from
-- `kyc_renewal_periods`) or `sent_back` (with `review_reason`). Only the review
-- route in `routes/trust_accreditation.ts` decides a letter, and it is the one
-- writer that sets `legal_obligations.accreditation_v1` to `satisfied`.
-- A member has at most one letter open (submitted or in review) at a time.

CREATE TABLE IF NOT EXISTS accreditation_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  basis TEXT NOT NULL
    CHECK (basis IN ('cpa_letter', 'attorney_letter', 'broker_dealer_letter', 'registered_adviser_letter')),
  file_key TEXT NOT NULL UNIQUE CHECK (file_key LIKE 'accreditation-evidence/%'),
  file_name TEXT NOT NULL CHECK (length(file_name) BETWEEN 1 AND 200),
  content_type TEXT NOT NULL CHECK (content_type IN ('application/pdf', 'image/png', 'image/jpeg')),
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  status TEXT NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'in_review', 'accepted', 'sent_back')),
  uploaded_at TEXT NOT NULL,
  reviewed_by INTEGER,
  reviewed_at TEXT,
  review_reason TEXT CHECK (review_reason IS NULL OR length(review_reason) <= 500),
  expires_at TEXT,
  CHECK (status <> 'accepted' OR (expires_at IS NOT NULL AND reviewed_by IS NOT NULL)),
  CHECK (status <> 'sent_back' OR (review_reason IS NOT NULL AND reviewed_by IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_accreditation_evidence_user ON accreditation_evidence(user_id, id);
CREATE INDEX IF NOT EXISTS idx_accreditation_evidence_status ON accreditation_evidence(status, uploaded_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_accreditation_evidence_open
  ON accreditation_evidence(user_id) WHERE status IN ('submitted', 'in_review');

-- The letter and who sent it are written once, with the upload.
CREATE TRIGGER IF NOT EXISTS trg_accreditation_evidence_file_frozen
BEFORE UPDATE ON accreditation_evidence
WHEN OLD.user_id IS NOT NEW.user_id
  OR OLD.basis IS NOT NEW.basis
  OR OLD.file_key IS NOT NEW.file_key
  OR OLD.file_name IS NOT NEW.file_name
  OR OLD.content_type IS NOT NEW.content_type
  OR OLD.size_bytes IS NOT NEW.size_bytes
  OR OLD.sha256 IS NOT NEW.sha256
  OR OLD.uploaded_at IS NOT NEW.uploaded_at
BEGIN
  SELECT RAISE(ABORT, 'accreditation_evidence.file: a letter is written once');
END;

-- A decided letter stays decided: a new letter is a new row.
CREATE TRIGGER IF NOT EXISTS trg_accreditation_evidence_decided
BEFORE UPDATE OF status, expires_at, review_reason, reviewed_by, reviewed_at ON accreditation_evidence
WHEN OLD.status IN ('accepted', 'sent_back')
BEGIN
  SELECT RAISE(ABORT, 'accreditation_evidence.status: a decided letter is not reopened');
END;
