-- 254 — what a roadmap item blocks, and the scenarios a founder saves beside it.
--
-- WHAT WAS MISSING, AND ONE OF IT WAS WORSE THAN MISSING. `/build/roadmap` (FB3)
-- draws four chips — Timeline · Board · Dependencies · Scenarios — and its
-- instrument is headed "Dependency chain · Unresolved links flagged" over a
-- `Item | Quarter | State | Blocks` table whose states are Blocked, In flight, At
-- risk and Provisional.
--
--   · `Scenarios` was honestly refused: "no roadmap scenario is stored".
--   · `Dependencies` WAS NOT. It is a live, selectable chip, and it could never
--     show a row. The page filtered on `item.dependency || item.dependencies ||
--     item.blocks`; `roadmap_okrs` has none of those columns and `OKR_SELECT`
--     returns none of them, so the filter was over three fields that do not
--     exist. Choosing it emptied the table under the words "items naming a
--     dependency" — which reads as "this venture has none", not as "nothing here
--     can have one". `unbuilt` at least draws nothing and says why; this drew a
--     working control over a store that was not there. Same class as the
--     `Carried only` chip D90 records, and worse for being invisible to the
--     guards, which only count refusals.
--
-- The `Blocks` column and the `At risk` stat were the same emptiness wearing
-- different words: "Not recorded" on every row, "Unavailable · Risk is not stored
-- on roadmap items" on the stat.
--
-- A DEPENDENCY IS AN EDGE, NOT A COLUMN. A `depends_on TEXT` on `roadmap_okrs`
-- would hold one name, unvalidated, and could not answer "what does this block",
-- which is the column the artboard actually draws. So it is its own table, keyed
-- both ways round, and the edge points from the BLOCKER to the BLOCKED — the
-- direction the `Blocks` cell reads ("Handoff schema … blocks Async digest, Slack
-- integration").
--
-- RISK IS DERIVED, NOT STORED, and the artboard's own note is the authority for
-- that: "One unresolved dependency explains both Q4 risks: the handoff schema
-- blocks two items and has been open eleven days." Risk there is a consequence of
-- the graph, not a label somebody typed. Storing a separate `at_risk` flag would
-- let the flag and the graph disagree, and then the page would have to choose.
-- See `services/okrGraph.ts` for the two rules and their limits.
--
-- No BEGIN/COMMIT: D1 rejects transaction statements inside a migration
-- (migration 200 learned that the hard way).

-- ── What blocks what ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS okr_dependencies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    -- The blocker. Work on `blocks_okr_id` cannot finish until this one does.
    okr_id INTEGER NOT NULL,
    -- The blocked.
    blocks_okr_id INTEGER NOT NULL,
    note TEXT,
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One edge per ordered pair. Adding the same link twice would double every count
-- the page draws from it, including the `Dependencies` stat.
CREATE UNIQUE INDEX IF NOT EXISTS idx_okr_dependencies_pair
    ON okr_dependencies(okr_id, blocks_okr_id);
CREATE INDEX IF NOT EXISTS idx_okr_dependencies_project
    ON okr_dependencies(project_id);
-- The reverse lookup the `Blocked` rule needs: "what blocks this item".
CREATE INDEX IF NOT EXISTS idx_okr_dependencies_blocked
    ON okr_dependencies(blocks_okr_id);

-- ── A saved what-if ──────────────────────────────────────────────────────────
-- The artboard's stat reads `Saved scenarios · 2 · "raise slips 6wk"`, so a
-- scenario is a NAMED alternative a founder wrote down, not a computed variant.
--
-- WHAT IT HOLDS IS AN ALTERNATIVE QUARTER PER ITEM, and no more than that. The
-- quarter is the only field on a roadmap item a what-if plausibly moves — an
-- objective's text and key results are the same objective whenever it happens —
-- and it is what "raise slips 6wk" means. Storing a whole copy of each OKR would
-- make a scenario go stale the moment somebody fixed a typo on the live item.
CREATE TABLE IF NOT EXISTS roadmap_scenarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    note TEXT,
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT,
    -- Two scenarios called "raise slips 6wk" on one venture are one scenario
    -- somebody saved twice.
    UNIQUE (project_id, name)
);

CREATE INDEX IF NOT EXISTS idx_roadmap_scenarios_project
    ON roadmap_scenarios(project_id, created_at);

CREATE TABLE IF NOT EXISTS roadmap_scenario_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scenario_id INTEGER NOT NULL,
    okr_id INTEGER NOT NULL,
    -- The quarter this item would sit in UNDER this scenario. NULL means the
    -- scenario says nothing about it, which is different from "no quarter" — an
    -- item the scenario does not move simply has no row here.
    quarter TEXT,
    UNIQUE (scenario_id, okr_id)
);

CREATE INDEX IF NOT EXISTS idx_roadmap_scenario_items_scenario
    ON roadmap_scenario_items(scenario_id);
