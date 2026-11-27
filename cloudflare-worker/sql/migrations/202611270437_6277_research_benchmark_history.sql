-- D6277 (#6277): each restatement of a benchmark, kept.
--
-- `PATCH /api/research/benchmarks/:uid` overwrites the row (migration 217), so
-- an investor tracking a figure quarter by quarter lost the earlier value, the
-- earlier peer figure and the earlier reading. This table keeps them: one row
-- per change, holding the six fields and the reading AS THEY WERE before the
-- change, and `changed_at`, the moment they were replaced.
--
-- A ROW IS WRITTEN ONLY WHEN A VALUE CHANGES. A save that changes nothing
-- writes nothing, so the history is a list of restatements, not of clicks.
-- The route writes the history row and the update in one batch, so neither
-- lands without the other.
--
-- NOTHING BEFORE THIS MIGRATION CAN BE RECOVERED. The values a PATCH
-- overwrote before it shipped are gone; the history starts empty for every
-- existing row and the page says "No earlier version is recorded".
--
-- VALUES ARE TEXT, as in 217, so a unit is never implicit ("1.4x", "18%").
-- No CHECK mirrors 217's peer-base rule: every row here is a copy of a row
-- that already passed it.
--
-- `owner_user_id` is denormalised from the benchmark, as in 303, so every read
-- and the delete are one owner-scoped predicate. The route removes a
-- benchmark's history before the benchmark itself (D1 does not run the
-- cascade inside a batch).
--
-- Additive. No transaction statements: D1 rejects `BEGIN;`/`COMMIT;`.

CREATE TABLE IF NOT EXISTS research_benchmark_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    benchmark_id INTEGER NOT NULL REFERENCES research_benchmarks(id) ON DELETE CASCADE,
    owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    metric TEXT NOT NULL,
    our_value TEXT,
    peer_value TEXT,
    peer_source TEXT,
    peer_sample_size INTEGER,
    peer_as_of TEXT,
    reading TEXT,
    changed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_research_benchmark_history_benchmark
    ON research_benchmark_history (benchmark_id, owner_user_id, changed_at);
