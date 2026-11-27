-- D4811 (#4811) part 18 — execution evidence attached to an agreement
-- (board CT-02 "Attach execution evidence", CT-12 B). A legacy `documents`
-- agreement marked signed has no column for the signed file, so the desk
-- shows it as a contradiction ("Marked signed · no execution evidence") with
-- nothing anyone could do. This table holds the externally signed copy for
-- such an agreement: the file in R2, its hash, the signature date, the
-- signatory and the admin who attested it. One per agreement, written once;
-- the list reads it as the agreement's evidence.
--
-- STANDS ALONE under the runner: no BEGIN/COMMIT.

CREATE TABLE IF NOT EXISTS agreement_evidence (
  agreement_uid TEXT PRIMARY KEY CHECK (length(agreement_uid) BETWEEN 1 AND 120),
  r2_key        TEXT NOT NULL,
  file_sha256   TEXT NOT NULL CHECK (length(file_sha256) = 64),
  file_bytes    INTEGER NOT NULL CHECK (typeof(file_bytes) = 'integer' AND file_bytes > 0),
  signed_on     TEXT NOT NULL,
  signatory     TEXT NOT NULL CHECK (length(signatory) BETWEEN 2 AND 200),
  attested_by   INTEGER NOT NULL,
  attached_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TRIGGER IF NOT EXISTS agreement_evidence_block_update
BEFORE UPDATE ON agreement_evidence
BEGIN
  SELECT RAISE(ABORT, 'agreement_evidence is written once (D4811).');
END;

CREATE TRIGGER IF NOT EXISTS agreement_evidence_block_delete
BEFORE DELETE ON agreement_evidence
BEGIN
  SELECT RAISE(ABORT, 'agreement_evidence is written once (D4811).');
END;
