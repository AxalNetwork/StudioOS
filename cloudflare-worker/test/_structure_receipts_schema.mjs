/**
 * D658 (#1471) — `interview_structure_receipts`, as its migration will create
 * it. HELD HERE UNTIL S1 GIVES THE MIGRATION NUMBER: 439 merged without it
 * (the session routes landed after #1489), and a merged migration is never
 * edited. When the number comes, this text moves verbatim into
 * `cloudflare-worker/sql/migrations/<n>_interview_structure_receipts.sql` and
 * the tests read that file instead.
 *
 * Why a table beside 438's `interview_session_receipts`: that table's CHECK
 * admits only 'live' and 'final', and widening a CHECK in SQLite means
 * rebuilding a table that already holds rows.
 */
export const STRUCTURE_RECEIPTS_SQL = `
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
`;
