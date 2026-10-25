-- 596 — Data room part 4: where each file came from (D1105, #2985).
-- Reserved for this part by #2985.
--
-- `source_kind` is one of three words:
--   document   a file a person put in the room: an upload, or a paper the
--              platform made and filed there (the cap table snapshot);
--   connector  a file a connected service delivered (a Mercury statement,
--              `services/mercury/raiseFeeds.ts`);
--   signed     a signed copy filed from e-sign. No writer files one yet; the
--              word is reserved so that writer adds no migration.
-- `source_ref` names the source within its kind, never an account, key or
-- token: `mercury` for a Mercury statement, `cap_table` for the snapshot,
-- NULL for an upload.
--
-- THE BACKFILL. Every file a Mercury statement landed as (its proposal's
-- `local_table` and `local_id`, migration 520) is `connector` / `mercury`.
-- Every other existing file stays `document`, which is what they all are.
--
-- Grep first (D689 D-t): no `source_kind` or `source_ref` column exists on
-- `data_room_files` in an earlier migration or in schema_baseline.sql.

ALTER TABLE data_room_files ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'document'
  CHECK (source_kind IN ('document', 'connector', 'signed'));
ALTER TABLE data_room_files ADD COLUMN source_ref TEXT;

UPDATE data_room_files
   SET source_kind = 'connector', source_ref = 'mercury'
 WHERE id IN (SELECT local_id FROM mercury_raise_proposals
               WHERE local_table = 'data_room_files' AND local_id IS NOT NULL);
