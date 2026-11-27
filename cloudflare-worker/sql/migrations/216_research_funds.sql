-- 216 — the funds a founder has actually researched, and what the research said.
--
-- `/research/funds` has been a card reading "Fund research is not built yet"
-- since the zone existed. Its card was right about the gap and right about the
-- boundary: this is FOUNDER-FACING fund research and does not overlap the
-- investor-only fund pages, which are GP back-office tooling behind a different
-- licence. `vc_funds`, `fund_distributions`, `fund_report_periods`,
-- `fund_reserve_allocations` and `fund_scenarios` all already exist and are all
-- that other thing, which is why this table is named for the zone it serves.
--
-- TWO AXES, NOT ONE STATE. The canvas (Pages · Founder Research, FS4) pills a
-- fund as "Warm path", "Right stage", "Wrong stage" or "Passed", and filters on
-- "Best fit / Right stage / Warm path / Passed". Those are not four values of
-- one column: a fund can be right-stage AND have a warm path, and most of the
-- interesting ones are. Collapsing them would force a founder to choose which
-- true thing to record. So `stage_fit` answers "do they write at our stage",
-- `path` answers "do we have a route in", and `status` answers "is this still
-- live" — three questions, three columns.
--
-- THE PASS REASON IS THE POINT OF RECORDING A PASS AT ALL. The canvas row reads
-- "One thesis mismatch, one 'too early — return at $30k MRR'. Both worth
-- revisiting." A pass with no reason is indistinguishable from a fund nobody
-- got to, and the founder rediscovers it in three months. `pass_reason` is
-- nullable because a pass can arrive without one, and the zone says which rows
-- lack it rather than inventing one.
--
-- MONEY IS CENTS. `scripts/check-money-cents.mjs` enforces it, and the two
-- older tables that hold REAL dollars (`founder_needs.budget_*`, `quotes.price`)
-- are grandfathered rather than a precedent.
--
-- NO TRANSACTION STATEMENTS. D1's HTTP API rejects BEGIN/COMMIT in a migration
-- file — migration 200 shipped with them and failed the production deploy at
-- the migration step. `scripts/check-sql-migrations.mjs` now enforces it; until
-- this migration landed, 214 and 215 both cited that script and it did not exist.

CREATE TABLE IF NOT EXISTS research_funds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL UNIQUE,
    -- Keyed on the USER, like `research_documents`, not on a founder profile
    -- row: the zone is a founder's own research and every read is owner-scoped.
    owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Optional: research done before a project exists is still research. When
    -- set, it is what the cheque-overlap figure is computed against.
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    -- The cheque range in the fund's own terms. Either end may be unknown; a
    -- missing end is not zero and the zone renders it as unrecorded.
    cheque_min_cents INTEGER,
    cheque_max_cents INTEGER,
    -- 'right' | 'wrong' | NULL. NULL means not yet assessed, which is a
    -- different fact from "wrong" and must not render as one.
    stage_fit TEXT,
    -- 'warm' | 'cold' | NULL. Whether there is a route in, independent of fit.
    path TEXT,
    -- 'researching' | 'passed'. A pass is a state, never a delete: the whole
    -- value of the row afterwards is that you stop rediscovering the fund.
    status TEXT NOT NULL DEFAULT 'researching',
    pass_reason TEXT,
    -- The fund's thesis IN ITS OWN WORDS, quoted rather than summarised, and
    -- the founder's own note on what the research turned up.
    thesis TEXT,
    note TEXT,
    source_url TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- The list query: one founder's funds, newest first.
CREATE INDEX IF NOT EXISTS idx_research_funds_owner
    ON research_funds (owner_user_id, created_at DESC);

-- The filter row: best fit, right stage, warm path, passed.
CREATE INDEX IF NOT EXISTS idx_research_funds_state
    ON research_funds (owner_user_id, status, stage_fit, path);
