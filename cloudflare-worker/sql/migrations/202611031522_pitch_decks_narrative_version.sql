-- D1516 (#3768, deck v2 A5): a deck version built from the investor narrative
-- records which narrative version it was built from. Named by its UTC minute
-- (D4106); #3768 named this file 721.
--
--   narrative_version  the `narrative_version_meta.version` of the same
--                      venture the build read its words from; null for a deck
--                      not built from the narrative
--
-- The binding is (project_id, narrative_version) → narrative_version_meta
-- (project_id, version), which SQLite cannot declare on an added column; the
-- two triggers refuse a version that names no saved narrative version. No data.
ALTER TABLE pitch_decks ADD COLUMN narrative_version INTEGER CHECK (narrative_version IS NULL OR narrative_version >= 1);

CREATE TRIGGER IF NOT EXISTS pitch_decks_narrative_version_bound
BEFORE INSERT ON pitch_decks
WHEN NEW.narrative_version IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM narrative_version_meta m WHERE m.project_id = NEW.project_id AND m.version = NEW.narrative_version)
BEGIN
  SELECT RAISE(ABORT, 'narrative_version names no saved narrative version of this venture');
END;

CREATE TRIGGER IF NOT EXISTS pitch_decks_narrative_version_bound_update
BEFORE UPDATE OF narrative_version ON pitch_decks
WHEN NEW.narrative_version IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM narrative_version_meta m WHERE m.project_id = NEW.project_id AND m.version = NEW.narrative_version)
BEGIN
  SELECT RAISE(ABORT, 'narrative_version names no saved narrative version of this venture');
END;
