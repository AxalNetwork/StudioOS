-- 202611100853 — D5336 (#5336): a seeded skill case records the source identity it came from.
-- Named by its UTC minute (D4106).
--
-- WHY. The library now ships several cases per skill: the v1 golden case and #4588's qualification
-- scenarios. The seed adds a case only when no live case has its identity, and a scenario's identity
-- is its source `case_id` plus its integer `revision`, which its text alone cannot give back. So the
-- row keeps them. A golden case's identity is `<slug>#<sha12>` of its content (D4532 §2); the seed
-- writes that into `source_case_id` too, with no revision.
--
-- NULL IS "NOT RECORDED". Rows written before this migration, and every case an HQ admin adds by
-- hand, keep NULL and are identified by their content, exactly as before. No backfill.
--
-- Additive only: two nullable columns, one partial unique index and one trigger. A case row stays
-- immutable (trg_agent_skill_cases_immutable, 202611081919); the trigger below extends that to the
-- two new columns, which that trigger does not name.
ALTER TABLE agent_skill_cases ADD COLUMN source_case_id TEXT CHECK (source_case_id IS NULL OR length(source_case_id) BETWEEN 1 AND 120);
ALTER TABLE agent_skill_cases ADD COLUMN source_revision INTEGER CHECK (source_revision IS NULL OR source_revision >= 1);

-- Two live cases of one skill never share a source identity.
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_skill_cases_source_live
  ON agent_skill_cases (skill_id, source_case_id, COALESCE(source_revision, 0))
  WHERE removed_at IS NULL AND source_case_id IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS trg_agent_skill_cases_source_kept
BEFORE UPDATE ON agent_skill_cases
WHEN NEW.source_case_id IS NOT OLD.source_case_id OR NEW.source_revision IS NOT OLD.source_revision
BEGIN
  SELECT RAISE(ABORT, 'agent_skill_cases source identity is immutable');
END;
