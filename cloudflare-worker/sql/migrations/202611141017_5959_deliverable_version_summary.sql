-- 202611141017 — D5959 (#5959, part of #4833): a deliverable version's summary,
-- stored apart from its change note.
-- Named by its UTC minute and its issue (D4106, D5398).
--
-- The Practice v2 canvas's Add version dialog (PX-06) asks for three fields:
--   Change note · required       → advisor_deliverable_versions.summary (as before)
--   Document or URL · required   → advisor_deliverable_versions.link_url (as before)
--   Summary · optional           → advisor_deliverable_versions.version_summary (this file)
--
-- `summary` KEEPS ITS MEANING. It has been the change note since migration 239
-- ("the trail's 'what' line"), and D4712 made it required on a new version.
-- Renaming it would break every reader. The optional summary is a new column,
-- so nothing already written changes meaning.
--
-- EXISTING ROWS. Nothing is backfilled. A version written before this file
-- reads `version_summary` NULL, and its `summary` is untouched.
--
-- WRITTEN ONCE. A version is recorded as it was sent (D4712: there is no route
-- that edits an older version). The trigger below holds the new column to
-- that rule in the database, too: once a version exists, its summary cannot be
-- changed by any UPDATE. The INSERT is the only write.
ALTER TABLE advisor_deliverable_versions ADD COLUMN version_summary TEXT;

CREATE TRIGGER IF NOT EXISTS advisor_deliverable_versions_summary_immutable
BEFORE UPDATE OF version_summary ON advisor_deliverable_versions
WHEN OLD.version_summary IS NOT NEW.version_summary
BEGIN
  SELECT RAISE(ABORT, 'version_summary_immutable');
END;
