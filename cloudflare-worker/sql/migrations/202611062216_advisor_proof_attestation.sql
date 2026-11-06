-- 202611062216_advisor_proof_attestation.sql — D4670 (#4670): an advisor's
-- proof claim is confirmed by the person named, not by whoever holds the link.
-- Additive: two columns on advisor_proof_consents and two new tables.
--
-- 1. `advisor_proof_consents.claim_sha256` / `claim_json`: the claim exactly as
--    it read when the confirmation was asked for (kind, title, organization,
--    period, detail). The person asked is shown it, and a confirmation counts
--    only while the claim still reads that way: an edited claim needs asking
--    again. A row recorded before this migration has neither, so its
--    confirmation is kept and shown, and no longer counts as confirmed (the
--    owner's call on #4670: "needs reconfirmation").
-- 2. `advisor_proof_consent_codes`: the one-time codes that prove the person
--    answering reads the email address the advisor named. Only a SHA-256 of
--    each code is kept; a code lasts 15 minutes, allows 5 tries and is used
--    once.
-- 3. `advisor_proof_consent_events`: every answer, append-only (two triggers),
--    so a withdrawal and any later reconfirmation stay on the record in order.
--
-- `services/advisorStoresSchema.ts` heals a database baselined past this file
-- with the same statements (an ALTER file is recorded without running by a
-- `--baseline` adoption).
--
-- STANDS ALONE under the runner: no BEGIN/COMMIT.

ALTER TABLE advisor_proof_consents ADD COLUMN claim_sha256 TEXT;
ALTER TABLE advisor_proof_consents ADD COLUMN claim_json TEXT;

CREATE TABLE IF NOT EXISTS advisor_proof_consent_codes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  consent_id  INTEGER NOT NULL REFERENCES advisor_proof_consents(id),
  code_hash   TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  used_at     TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_advisor_proof_consent_codes_consent
  ON advisor_proof_consent_codes(consent_id, created_at);

CREATE TABLE IF NOT EXISTS advisor_proof_consent_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  -- No REFERENCES: the history outlives a claim its advisor deletes, and it
  -- holds no name or address, only what happened and when.
  consent_id    INTEGER NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('requested', 'confirmed', 'declined', 'withdrawn', 'reconfirmed')),
  claim_sha256  TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_advisor_proof_consent_events_consent
  ON advisor_proof_consent_events(consent_id, id);

CREATE TRIGGER IF NOT EXISTS advisor_proof_consent_events_block_update
BEFORE UPDATE ON advisor_proof_consent_events
BEGIN
    SELECT RAISE(ABORT, 'advisor_proof_consent_events is append-only (D4670).');
END;

CREATE TRIGGER IF NOT EXISTS advisor_proof_consent_events_block_delete
BEFORE DELETE ON advisor_proof_consent_events
BEGIN
    SELECT RAISE(ABORT, 'advisor_proof_consent_events is append-only (D4670).');
END;
