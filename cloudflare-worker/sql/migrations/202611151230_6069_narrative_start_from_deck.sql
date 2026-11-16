-- D6069 (#6069) — a narrative version can start from a saved pitch deck
-- version's words. Migration 463 limits narrative_version_meta.start_from to
-- 'live', 'version' or 'blank' with a CHECK, and SQLite cannot widen a CHECK,
-- so the table is rebuilt with every row and column kept.
--
--   start_from = 'deck'  the version copied pitch deck vN's words by card;
--       based_on_version holds that deck version N (pitch_decks.version of
--       the same venture), never a narrative version. The new CHECK requires
--       it, so a deck start always names its deck.
--
-- The two pitch_decks triggers of 202611031522 read this table, so they are
-- dropped first and created again unchanged: SQLite refuses to rename a table
-- while a trigger names a table that does not exist. No data changes.

DROP TRIGGER IF EXISTS pitch_decks_narrative_version_bound;
DROP TRIGGER IF EXISTS pitch_decks_narrative_version_bound_update;

CREATE TABLE narrative_version_meta_6069 (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  project_id         INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version            INTEGER NOT NULL,
  start_from         TEXT NOT NULL DEFAULT 'live' CHECK (start_from IN ('live', 'version', 'blank', 'deck')),
  based_on_version   INTEGER,
  why_now            TEXT,
  check_against_json TEXT,
  created_by         INTEGER REFERENCES users(id),
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  revision           INTEGER NOT NULL DEFAULT 0,
  claim              TEXT,
  UNIQUE (project_id, version),
  CHECK (start_from != 'deck' OR (based_on_version IS NOT NULL AND based_on_version >= 1))
);

INSERT INTO narrative_version_meta_6069
  (id, uid, project_id, version, start_from, based_on_version, why_now, check_against_json, created_by, created_at, updated_at, revision, claim)
SELECT id, uid, project_id, version, start_from, based_on_version, why_now, check_against_json, created_by, created_at, updated_at, revision, claim
  FROM narrative_version_meta;

DROP TABLE narrative_version_meta;
ALTER TABLE narrative_version_meta_6069 RENAME TO narrative_version_meta;

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
