-- D5049 (#5049, part 2 of #5047) — a package or program agreement version
-- carries the document it is: the rendered text, the values that filled it, and
-- what was left unfilled, all frozen once the version is sent.
--
-- WHAT IS ADDED. Five nullable columns on `licence_program_agreements`
-- (migration 202611082025) and one trigger. No existing row is read or changed:
-- the backfilled schedule versions keep NULL here, because their text lives on
-- their envelope (`esign_envelopes.document_body`) and was never stored apart.
--
--   title                   the document's title, as sent
--   body_md                 the rendered body, byte for byte what is sent: the
--                           send passes it to e-sign as a rendered body (D416),
--                           and `body_sha256` is its SHA-256 (D4671's rule)
--   merge_values_json       the namespaced values the draft was rendered from
--                           (licence.*, package.*, program.*, grant.*, terms.*,
--                           signer.*, entity.*, agreement.*), frozen with it
--   unresolved_fields_json  every `{{field}}` still standing in the body
--   counsel_review          1 when the template is marked for counsel review
--
-- FROZEN ONCE SENT. The trigger refuses changing the title, the body, the
-- values or the unresolved list after the version left draft/ready, as
-- 202611082025's trigger already refuses the template, its version and the hash.

ALTER TABLE licence_program_agreements ADD COLUMN title TEXT;
ALTER TABLE licence_program_agreements ADD COLUMN body_md TEXT;
ALTER TABLE licence_program_agreements ADD COLUMN merge_values_json TEXT;
ALTER TABLE licence_program_agreements ADD COLUMN unresolved_fields_json TEXT;
ALTER TABLE licence_program_agreements ADD COLUMN counsel_review INTEGER CHECK (counsel_review IS NULL OR counsel_review IN (0, 1));

CREATE TRIGGER IF NOT EXISTS licence_program_agreements_body_frozen
BEFORE UPDATE ON licence_program_agreements
WHEN OLD.status NOT IN ('draft', 'ready')
 AND (OLD.title IS NOT NEW.title
      OR OLD.body_md IS NOT NEW.body_md
      OR OLD.merge_values_json IS NOT NEW.merge_values_json
      OR OLD.unresolved_fields_json IS NOT NEW.unresolved_fields_json
      OR OLD.counsel_review IS NOT NEW.counsel_review)
BEGIN
  SELECT RAISE(ABORT,
    'licence_program_agreements: the text of a sent agreement version is frozen (D5049). Draft a new version instead.');
END;
