-- D4628 (#4628) — `openOn` inserts the session, then a second D1 batch
-- writes the talking points, the output preference, the interview's channel
-- and quote consent, and the audit row; an upload or a pasted chat adds the
-- held-stage move and the content itself on top of that. Those later writes
-- used to be read back by a broad catch that treated "a row with this
-- client_key exists" as "setup finished" — so a failure after the insert
-- (a failed points write, a failed pasted-transcript write) answered a
-- duplicate-start replay as success, with the later content silently
-- missing.
--
-- interview_sessions.setup_complete_at   NULL until every required
--     initialization/content write for this session has landed (routes/
--     founder_validate_sessions.ts `finishSetup`). The setup routes check it
--     before answering a repeated client_key as a completed replay: set,
--     the committed result; unset, they finish the missing work first (or
--     answer an explicit `setup_incomplete` when that also fails), never a
--     silent "it worked" for writes that never ran.
--
-- Existing rows predate this column and were never read this way, so they
-- are backfilled complete rather than left to look unfinished forever.
ALTER TABLE interview_sessions ADD COLUMN setup_complete_at TEXT;

UPDATE interview_sessions
   SET setup_complete_at = COALESCE(stopped_at, started_at, updated_at, created_at)
 WHERE setup_complete_at IS NULL;
