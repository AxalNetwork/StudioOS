-- 255 — what a claim's verdict was, the last time anyone looked.
--
-- WHY. `/validate/verdict` draws `As of last week` and `Changed this month`, and
-- `/validate/hypotheses` draws `Recently moved`. All three were registered
-- `unbuilt`, which draws a DISABLED chip whose only explanation is a hover
-- title — so two thirds of one filter row and a quarter of another were inert
-- controls naming questions nothing could answer — under a reason that was
-- exactly right: "a claim's verdict is recomputed from its evidence on every
-- request and never stored, so no earlier state of the board exists to compare
-- against", and "snapshotting it is a change to the model, not a predicate this
-- row can carry". This is the model change.
--
-- IT IS NOT A COLUMN ON `hypotheses`. That table carries id, project_id, code,
-- claim, sort_order, retired_at, created_at, updated_at — no lane and no verdict
-- — and a verdict column would hold ONE verdict, the current one, which is the
-- thing already derivable. History on a single column is a column that gets
-- overwritten. `validation_decisions` is a real ledger with decided_at and
-- superseded_at, but it records the founder's PROJECT-level proceed/pivot/stop,
-- not a per-claim verdict. Neither answers these three chips.
--
-- THE LANE IS STORED BESIDE THE VERDICT, and that is what makes the third chip
-- work. `laneFor(verdict, evidence)` is derived too, and a claim can move lane
-- without its verdict changing — `none` to `testing` the moment its first
-- supporting interview lands. "Recently moved" is about the board's columns, so
-- the board's columns are what is recorded.
--
-- A ROW IS AN OBSERVED CHANGE, NOT A HEARTBEAT. Nothing is written when the
-- recomputed pair matches the last row, so a project whose board is opened daily
-- for a year holds one row per claim, not three hundred and sixty-five.
--
-- NO UNIQUE INDEX on (hypothesis_id, verdict, lane) or any date bucket. A claim
-- may go validated → unproven → validated, and all three are facts about the
-- same day; deduplicating them would erase the one sequence a founder most wants
-- to see. Append-only, exactly as `okr_column_moves` (252) is, and for the same
-- reason it gives.
--
-- NO BACKFILL, AND THE REASON IS THAT A BACKFILL WOULD BE A GUESS. Every claim
-- that exists today has no history row, and the only timestamp available to
-- invent one from is `hypotheses.updated_at`, which moves when the CLAIM TEXT is
-- edited. A verdict dated from that would be a specific, confident, wrong answer.
-- So the board returns `verdict_history_since` — the earliest observation on
-- record — and the page says when the history starts, the way `/build/this-week`
-- already does for its own un-backfilled log. The seam heals with use and never
-- lies in the meantime.
--
-- No BEGIN/COMMIT: D1 rejects transaction statements inside a migration
-- (migration 200 learned that the hard way).

CREATE TABLE IF NOT EXISTS hypothesis_verdict_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    hypothesis_id INTEGER NOT NULL,
    -- 'validated' | 'invalidated' | 'unproven', or NULL. NULL IS A REAL VALUE
    -- here and not a missing one: `verdictFor` returns null when interviews
    -- touching the claim have no ICP fit recorded, because the answer depends on
    -- a count nobody has. Storing it as null keeps "we did not know yet"
    -- distinguishable from "we knew it was unproven", which is the distinction
    -- the whole helper exists to preserve.
    verdict TEXT,
    -- 'none' | 'testing' | 'validated' | 'invalidated' | 'unknown'.
    lane TEXT NOT NULL,
    observed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The two shapes every read uses: "this project's history" and "this claim's".
CREATE INDEX IF NOT EXISTS idx_hypothesis_verdict_history_project
    ON hypothesis_verdict_history(project_id, observed_at);

CREATE INDEX IF NOT EXISTS idx_hypothesis_verdict_history_claim
    ON hypothesis_verdict_history(hypothesis_id, id);
