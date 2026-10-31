-- #3748 (N3): retain every saved deck and give each project a unique version.
-- The newest id keeps each duplicate's original number, except when the
-- current row must advance above repaired history. Older duplicates move
-- above that project's original maximum, in id order; no content is removed.
WITH duplicate_ids AS MATERIALIZED (
  SELECT id, project_id, version,
         ROW_NUMBER() OVER (PARTITION BY project_id, version ORDER BY id DESC) AS duplicate_rank
    FROM pitch_decks
), renumbered AS MATERIALIZED (
  SELECT d.id,
         (SELECT MAX(p.version) FROM pitch_decks p WHERE p.project_id = d.project_id)
           + ROW_NUMBER() OVER (PARTITION BY d.project_id ORDER BY d.id) AS new_version
    FROM duplicate_ids d
   WHERE d.duplicate_rank > 1
)
UPDATE pitch_decks
   SET version = (SELECT r.new_version FROM renumbered r WHERE r.id = pitch_decks.id)
 WHERE id IN (SELECT id FROM renumbered);

-- A project with versions has exactly one current row: its latest saved id.
UPDATE pitch_decks
   SET is_current = CASE WHEN id = (
     SELECT MAX(p.id) FROM pitch_decks p WHERE p.project_id = pitch_decks.project_id
   ) THEN 1 ELSE 0 END;

-- Existing readers also use the highest version as latest. Preserve the
-- latest saved payload as current when older duplicate ids were moved above
-- it, by advancing only that row above the repaired history.
UPDATE pitch_decks
   SET version = (SELECT MAX(p.version) + 1 FROM pitch_decks p WHERE p.project_id = pitch_decks.project_id)
 WHERE is_current = 1
   AND version < (SELECT MAX(p.version) FROM pitch_decks p WHERE p.project_id = pitch_decks.project_id);

-- Replace the bootstrap's old non-unique index under the same name.
DROP INDEX IF EXISTS idx_decks_project;
CREATE UNIQUE INDEX IF NOT EXISTS idx_decks_project ON pitch_decks(project_id, version);
CREATE UNIQUE INDEX IF NOT EXISTS idx_decks_one_current ON pitch_decks(project_id) WHERE is_current = 1;
