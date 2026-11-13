-- 446 — One receipt line per model call that structures or questions an
-- interview session (D658, #1471, part of #1469 / D656). S1 gave this number.
--
-- WHY A TABLE BESIDE 438's `interview_session_receipts`: that table's CHECK
-- admits only 'live' and 'final', and widening a CHECK in SQLite means
-- rebuilding a table that already holds rows. 439 (part 1, #1489) merged
-- before the session routes, and a merged migration is never edited, so the
-- structuring lines get their own table. `GET /sessions/:id/receipt` reads
-- both tables as one list in time order.
--
--   step              'structured' (first run), 're_structured' (a compare
--                     run over the same session), or 'asked' (Ask the
--                     transcript).
--   run_id            the structuring run; NULL for an ask.
--   model             the model that answered.
--   requested_model   the model the founder picked; NULL when the default
--                     ran. `fallback_used` = 1 when the fallback answered.
--   cost_microusd     the call's estimated cost, in millionths of a dollar.
--   outcome           'ok', or 'refused' with the refusal code in `refusal`.
--
-- Additive: CREATE TABLE and CREATE INDEX IF NOT EXISTS. No row is changed.
-- Rows go with their session (ON DELETE CASCADE).

CREATE TABLE IF NOT EXISTS interview_structure_receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
    run_id TEXT,
    step TEXT NOT NULL CHECK (step IN ('structured', 're_structured', 'asked')),
    model TEXT NOT NULL,
    requested_model TEXT,
    fallback_used INTEGER NOT NULL DEFAULT 0,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    cost_microusd INTEGER NOT NULL DEFAULT 0,
    outcome TEXT NOT NULL CHECK (outcome IN ('ok', 'refused')),
    refusal TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_interview_structure_receipts_session
    ON interview_structure_receipts (session_id);
