-- D5315 part 2: publication names one current confirmation. Existing flags
-- cannot publish proof, and a later reconfirmation never republishes it.
ALTER TABLE advisor_proof_items ADD COLUMN published_consent_id INTEGER;

CREATE TRIGGER IF NOT EXISTS advisor_proof_withdrawal_unpublishes
AFTER UPDATE OF consent_given, withdrawn_at ON advisor_proof_consents
WHEN NEW.consent_given <> 1 OR COALESCE(NEW.withdrawn_at, '') <> ''
BEGIN
  UPDATE advisor_proof_items SET published_consent_id = NULL
   WHERE id = NEW.proof_item_id AND published_consent_id = NEW.id;
END;
