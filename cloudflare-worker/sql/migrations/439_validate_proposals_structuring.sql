-- 439 — Eadwyn turns an interview into proposals for every Validate module
-- (D658, #1471, part of #1469 / D656).
--
-- EXTEND, DO NOT ADD. `validate_proposals` (214, widened by 246) is already
-- the AI-proposes / founder-decides store for Validate: its accept path claims
-- a row with `WHERE id = ? AND status = 'pending'` and writes through the
-- module's own writer, so an accepted proposal and a hand-typed row are the
-- same row. A structured interview is more of the same, so it lands here.
--
--   session_id           the interview session (#1470, migration 438) the run
--                        read. NULL for proposals from the rail, which read
--                        no session.
--   cite_from / cite_to  the cited span, in milliseconds from the start of
--                        the session, matching the transcript segments'
--                        offsets. A placement with no span is never stored
--                        (services/interviewStructuring.ts drops it); the
--                        passage itself rides in `citation_json`
--                        ({"kind":"transcript","session_id",…,"quote"}).
--   edited_payload_json  what the founder changed before accepting. The
--                        model's own `payload_json` is kept as it was, so
--                        "proposed" and "written" can both be read back.
--   run_id               one structuring run. Compare runs a second model
--                        over the same session and gets a second run_id; the
--                        read aligns the two by module.
--
-- New kinds (validated in the route, like `kind` always was; D1 cannot
-- enforce the enum): pain_severity, icp_fit, segment, demand_signal,
-- evidence, competitor_mention, market_fact.
--
-- Additive: ADD COLUMN and CREATE INDEX IF NOT EXISTS. No row is changed.
-- No BEGIN/COMMIT (scripts/check-sql-migrations.mjs).
ALTER TABLE validate_proposals ADD COLUMN session_id INTEGER;
ALTER TABLE validate_proposals ADD COLUMN cite_from INTEGER;
ALTER TABLE validate_proposals ADD COLUMN cite_to INTEGER;
ALTER TABLE validate_proposals ADD COLUMN edited_payload_json TEXT;
ALTER TABLE validate_proposals ADD COLUMN run_id TEXT;

-- The review read: one session's runs, each run's placements in order.
CREATE INDEX IF NOT EXISTS idx_validate_proposals_session_run
    ON validate_proposals (session_id, run_id, id);
