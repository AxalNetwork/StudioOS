-- D5315 part 1: one durable audit record per owner-cancelled request.
-- Like the D4670 answer history, this survives deletion of the proof item
-- and contains no attester address, invitation token, or code.
CREATE TABLE IF NOT EXISTS advisor_proof_consent_cancellations (
  consent_id   INTEGER PRIMARY KEY,
  cancelled_by INTEGER NOT NULL,
  cancelled_at TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS advisor_proof_consent_cancellations_revoke
AFTER INSERT ON advisor_proof_consent_cancellations
BEGIN
  UPDATE advisor_proof_consents SET request_token = NULL, updated_at = NEW.cancelled_at
   WHERE id = NEW.consent_id;
  UPDATE advisor_proof_consent_codes SET used_at = NEW.cancelled_at
   WHERE consent_id = NEW.consent_id AND used_at IS NULL;
END;

CREATE TRIGGER IF NOT EXISTS advisor_proof_consent_cancellations_block_update
BEFORE UPDATE ON advisor_proof_consent_cancellations
BEGIN
  SELECT RAISE(ABORT, 'advisor_proof_consent_cancellations is append-only (D5315).');
END;

CREATE TRIGGER IF NOT EXISTS advisor_proof_consent_cancellations_block_delete
BEFORE DELETE ON advisor_proof_consent_cancellations
BEGIN
  SELECT RAISE(ABORT, 'advisor_proof_consent_cancellations is append-only (D5315).');
END;
