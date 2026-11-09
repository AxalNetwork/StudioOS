-- D5069 (#5069) — a saved narrative version has a revision, so a save made from
-- a stale read is refused instead of replacing newer words.
--
--   narrative_version_meta.revision  starts at 0 and goes up by one on every
--       write to the version: a section save, a whole-version save, and an
--       objection answer saved with it. A client reads it with the version and
--       sends it back as `expected_revision`; a write whose revision is not the
--       stored one changes no row and answers 409 `changed_since_open`.
--
--   narrative_version_meta.claim  names the one save that holds the latest
--       revision. The save's guarded writes match only its own claim, so a
--       different writer who reached the same number cannot let them through.
--
-- Existing versions read 0. A version with no meta row yet reads 0 too, and
-- the first write creates the row.

ALTER TABLE narrative_version_meta ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE narrative_version_meta ADD COLUMN claim TEXT;
