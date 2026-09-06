-- 217 — a benchmark, and the base it rests on.
--
-- `/research/benchmarking` has been a card refusing to exist, on a ground worth
-- keeping verbatim: "No benchmark set exists in the product. A benchmark drawn
-- from three companies and presented without its base is arithmetic wearing a
-- metric's clothes." This table is that sentence turned into a constraint.
--
-- THE CHECK IS THE WHOLE DESIGN. `peer_value` may be absent — a figure you are
-- tracking with nothing to compare it to is a metric, and that is fine. But a
-- peer figure WITHOUT its source and its sample size is the thing the card
-- refused, so the schema refuses it too:
--
--     CHECK (peer_value IS NULL OR (peer_source IS NOT NULL AND peer_sample_size IS NOT NULL))
--
-- A route that forgot to collect them cannot write the row at all. That is
-- deliberately stronger than validating in the handler: the handler is one
-- writer today and the constraint holds for every writer there will ever be.
--
-- VALUES ARE TEXT, NOT NUMBERS, and this is not laziness. The canvas's own rows
-- are TVPI 1.4x, DPI 0.2x, reserve ratio 18%, IRR 24% — multiples, ratios and
-- percentages in one column. Forcing them into REAL would either lose the unit
-- or need a second column to carry it, and a benchmark whose unit is implicit
-- is exactly how "1.4" gets read as a percentage. The unit travels with the
-- value.
--
-- EVERY ROW CARRIES ITS OWN READ. The canvas says why: "a number beside a peer
-- median invites the wrong conclusion". `reading` is where the analyst writes
-- what the comparison actually supports — the canvas's own example being that a
-- TVPI advantage resting on a single re-mark should not reach an LP as a trend.
--
-- NO TRANSACTION STATEMENTS. D1's HTTP API rejects BEGIN/COMMIT in a migration
-- file. `scripts/check-sql-migrations.mjs` now enforces it; until this
-- migration landed, 214 and 215 both cited that script and it did not exist.

CREATE TABLE IF NOT EXISTS research_benchmarks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL UNIQUE,
    owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- What is being compared, in the reader's own words: "TVPI", "Reserve
    -- ratio", "Time to first close".
    metric TEXT NOT NULL,
    -- Ours. Carried as text so the unit is never implicit — see above.
    our_value TEXT,
    -- Theirs, and the two facts without which it is not a benchmark.
    peer_value TEXT,
    peer_source TEXT,
    peer_sample_size INTEGER,
    -- When the peer set was measured. A 2023 comparison is a different claim
    -- from a 2026 one, and the zone shows the date rather than implying now.
    peer_as_of TEXT,
    -- What the comparison actually supports. Not optional in spirit; nullable
    -- only because a row may be entered before its read is written, and the
    -- zone marks those rather than hiding them.
    reading TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (peer_value IS NULL OR (peer_source IS NOT NULL AND peer_sample_size IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_research_benchmarks_owner
    ON research_benchmarks (owner_user_id, created_at DESC);
