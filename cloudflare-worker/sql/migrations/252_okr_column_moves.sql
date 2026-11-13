-- 252 — when a key result entered the Now column, and when it left.
--
-- WHY. `/build/this-week` (FB1) reads the Now column of the stored roadmap and
-- draws four filter chips. Three of them — `Last 4`, `All 14`, `Carried only` —
-- were registered `unbuilt` under one reason: "a key result carries no week, so
-- there is no earlier week to open", and "nothing records a commitment moving
-- from one week to the next". Both were true: `roadmap_okrs` has a
-- `kanban_status` and an `updated_at`, and `updated_at` moves when the TITLE is
-- edited, so it cannot say when the objective was committed. An `unbuilt` chip
-- renders NOTHING, so three quarters of the artboard's filter row was invisible.
--
-- WHAT IS STORED IS THE TRANSITION, NOT THE WEEK. A `week_start` column on
-- `roadmap_okrs` would hold one week — the current one — and answer none of the
-- three questions: "was it in Now four weeks ago" needs history, and history on a
-- single column is a column that gets overwritten. So this is an append-only log
-- of column changes, and every week figure is derived from it.
--
--   · `This week`    — the OKR's CURRENT `kanban_status`, which needs no history.
--   · `Last 4`       — has a move to `now` whose week is one of the last four.
--   · `All weeks`    — has ever had a move to `now`.
--   · `Carried only` — is in `now` now, and its first move to `now` was in an
--                      EARLIER week. That is what "carried" means: committed
--                      before this week and still open.
--
-- NO BACKFILL, AND THE REASON IS THAT A BACKFILL WOULD BE A GUESS. An OKR already
-- sitting in `now` has no move row, so it appears under `This week` and not under
-- `Last 4`. The only timestamp available to invent one from is `updated_at`, which
-- may be when someone fixed a typo. A week derived from that would be a specific,
-- confident, wrong answer. Instead the route returns `history_since` — the
-- earliest week on record — so the page can say when the history starts and the
-- reader can see why an older commitment is missing from it. The seam heals in
-- four weeks of use and never lies in the meantime.
--
-- APPEND-ONLY, SO NO UNIQUE INDEX ON (okr_id, week_start). An OKR may leave Now
-- and come back in the same week, and both moves are facts. Deduplicating them
-- would erase the one case a founder most wants to see.
--
-- No BEGIN/COMMIT: D1 rejects transaction statements inside a migration
-- (migration 200 learned that the hard way).

CREATE TABLE IF NOT EXISTS okr_column_moves (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    okr_id INTEGER NOT NULL,
    -- Where it came from. NULL when the row is the first move ever recorded for
    -- this OKR and the previous column was not read — an honest unknown rather
    -- than a guessed 'next'.
    from_status TEXT,
    to_status TEXT NOT NULL,
    -- The MONDAY of the week the move happened in, `YYYY-MM-DD`. Text, sorting
    -- lexicographically in date order, which is what every window below compares
    -- by. Monday because the product's week is a working week: the canvas's own
    -- copy is "Five commitments set. Two carried in." on a Monday plan.
    week_start TEXT NOT NULL,
    moved_at TEXT NOT NULL DEFAULT (datetime('now')),
    moved_by INTEGER
);

-- The two shapes every read uses: "this project's weeks" and "this OKR's moves".
CREATE INDEX IF NOT EXISTS idx_okr_moves_project_week
    ON okr_column_moves(project_id, week_start DESC);

CREATE INDEX IF NOT EXISTS idx_okr_moves_okr
    ON okr_column_moves(okr_id, moved_at);
