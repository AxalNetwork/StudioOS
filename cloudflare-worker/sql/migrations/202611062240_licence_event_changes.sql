-- D4707 (#4707) — licence history that says what changed and how it ended.
--
-- `licence_events.detail_json` (migration 187) holds whatever the write
-- carried: for seats and terms the NEW values only, for a suspension nothing.
-- The column's own comment promised "before and after"; nothing kept before.
--
--   before_json  the values the write replaced, read in the same request
--   after_json   the values it left
--   outcome      `committed` when HQ's write landed and the branch's copy did
--                too (or the licence has no branch), `partial` when HQ's write
--                landed and the push to the licence's branch did not
--
-- All three are NULL on every row written before this migration and on rows
-- written by paths that do not record them: the history reads that as "Not
-- recorded", never as "no change" or as success.
ALTER TABLE licence_events ADD COLUMN before_json TEXT;
ALTER TABLE licence_events ADD COLUMN after_json TEXT;
ALTER TABLE licence_events ADD COLUMN outcome TEXT;

CREATE INDEX IF NOT EXISTS idx_licence_events_licence_id_desc ON licence_events(licence_id, id);
