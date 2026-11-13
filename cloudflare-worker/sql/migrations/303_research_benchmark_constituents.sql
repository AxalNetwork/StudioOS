-- 303 — the named members of a benchmark's peer set (D314, Session 2 item 3).
--
-- Migration 217 stores a peer figure with its source and its sample size, and
-- its CHECK refuses a peer figure without both. What it does not store is WHO
-- the sample is: the benchmark canvas (f2eb2046) draws a peer-constituents
-- table — Name, Value, As of — under every comparison, and its own caption
-- says the product stores n only. This is that table.
--
-- A CONSTITUENT IS A NAME THE READER TYPED, never one the product found. The
-- product ships no peer data set, so every row here is entered by the owner of
-- the benchmark it belongs to, and the page says so beside the Add form.
--
-- THE COUNT IS NOT FORCED TO MATCH n. A list of three against a stored sample
-- of five is shown as a discrepancy and left alone: rewriting the sample to
-- match the list would be the product deciding which of two entries was the
-- mistake. So there is deliberately no trigger or CHECK tying the two.
--
-- VALUES ARE TEXT, as in 217, so a unit is never implicit ("0.6x", "18%").
--
-- `owner_user_id` is denormalised from the benchmark so every read and write
-- is one owner-scoped predicate, the same shape as every other research store.

CREATE TABLE IF NOT EXISTS research_benchmark_constituents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL UNIQUE,
    benchmark_id INTEGER NOT NULL REFERENCES research_benchmarks(id) ON DELETE CASCADE,
    owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- A constituent is a name first. A blank one is not a member of anything.
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    value TEXT,
    as_of TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_research_benchmark_constituents_benchmark
    ON research_benchmark_constituents (benchmark_id, position);
