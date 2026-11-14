-- Task #32 — DB-level guarantee: at most ONE canonical cap table per project.
--
-- Task #28 enforces "one cap table per project" in application code (the POST
-- upsert SELECTs the project's canonical scenario then UPDATEs it; the PUT
-- refuses to bind a second). That guards SEQUENTIAL saves, but two saves fired
-- at the same moment (double-click / two tabs / a retry) can race between the
-- SELECT and the INSERT and create two canonical rows for one project. This
-- migration makes the invariant unbreakable at the database level.
--
-- Scope: CANONICAL rows only (is_variant = 0). A project legitimately keeps ONE
-- canonical cap table PLUS any number of named DRAFT variants (is_variant = 1,
-- Task #29) that all share the same project_id — so the unique index MUST be
-- partial, or it would reject every variant insert.
--
-- Idempotent: the dedup UPDATE is a no-op once collapsed and the index uses
-- IF NOT EXISTS, so this is safe to replay / baseline. Depends on migration 118
-- having added is_variant (guaranteed by numeric order; also self-healed at
-- runtime by ensureCapTableVariantColumn / _ensure_schema).

-- 1. Collapse any pre-existing duplicate canonicals so the unique index can be
--    built. Keep the most-recently-updated canonical per project and demote the
--    rest to draft variants (non-destructive — no cap-table row is deleted).
UPDATE cap_table_scenarios
   SET is_variant = 1
 WHERE id IN (
   SELECT id FROM (
     SELECT id,
            ROW_NUMBER() OVER (
              PARTITION BY project_id
              ORDER BY updated_at DESC, id DESC
            ) AS rn
       FROM cap_table_scenarios
      WHERE project_id IS NOT NULL
        AND COALESCE(is_variant, 0) = 0
   ) ranked
   WHERE rn > 1
 );

-- 2. Enforce one canonical cap table per project at the DB level.
CREATE UNIQUE INDEX IF NOT EXISTS uq_captable_one_canonical_per_project
  ON cap_table_scenarios(project_id)
  WHERE project_id IS NOT NULL AND COALESCE(is_variant, 0) = 0;
