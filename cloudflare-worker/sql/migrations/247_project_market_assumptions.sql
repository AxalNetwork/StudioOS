-- 247_project_market_assumptions.sql — Task #188 / #198
--
-- The table `SpinoutLabMarketPage.jsx` has been asking for in a comment since
-- it was written:
--
--     Assumptions (drawer) — page-local session state. Only TAM/SAM/SOM persist
--     (PUT /projects/:id); the other fields need backend columns (or a
--     project_market_assumptions table) that don't exist yet, so they seed from
--     real project data where possible and otherwise start empty — never with
--     invented market numbers.
--
-- WHAT IS ACTUALLY LOST TODAY. A founder opens the drawer, types an addressable
-- population and an ACV, names a geography and a target year, picks a
-- methodology, sets a CAGR and a growth driver, and presses Recalculate. Three
-- numbers are saved — `projects.tam`, `.sam`, `.som` — and the twelve inputs
-- that produced them are dropped when the tab closes. What survives is the
-- CONCLUSION with none of the reasoning, on a page whose whole claim is that its
-- figures are derived rather than invented. The next person to open it, including
-- the founder a month later, cannot see what the derivation was: the drawer
-- re-seeds `samPct` and `winRate` by INVERTING the saved ratios and leaves the
-- rest blank, so a population of 41,200 firms reads as no population at all.
--
-- AND IT IS WHAT "AI FILLS THE BLANKS" NEEDS. The page derives TAM from
-- population × ACV, so the honest thing for a fill to propose is those INPUTS
-- with a citation each, not a TAM to write over the founder's own arithmetic.
-- With nowhere to put an addressable population, a sourced fill would have had
-- to write to `projects.tam` — the one column `fill_provenance` exists to stop a
-- model quietly occupying. This table is where a cited input lands, and the
-- reason the market surface can be `sourced` rather than a figure with a label.
--
-- ONE ROW PER PROJECT. `UNIQUE(project_id)` and an upsert, not an append: this
-- is the current state of a drawer, not a history of edits. Provenance of a
-- CHANGE belongs in `fill_provenance` (246), which records per column what was
-- proposed, what was written, and what it was drawn from — so a versioned table
-- here would be a second, worse answer to a question already answered.
--
-- EVERY COLUMN IS NULLABLE AND NOTHING HAS A DEFAULT VALUE FOR A MARKET FACT.
-- The page's rule is "empty means not researched yet", and a default would make
-- a number the founder never supplied indistinguishable from one they did. The
-- two columns that do carry defaults — `methodology` and `maturity` — are
-- PICKERS whose first option is what the drawer already shows unselected, so a
-- default there states what the screen states.
--
-- TEXT, not REAL, for the free-typed numerics. `population` and `acv` are what
-- the founder typed, and the page parses them with `parseFloat`; storing "41,200
-- firms" as a REAL would silently become 41 and storing it as NULL would lose
-- the note. The derived figures stay numeric where they already are, in
-- `projects`.
--
-- Apply with:
--   wrangler d1 execute studioos-db --remote --env production \
--     --file=cloudflare-worker/sql/migrations/247_project_market_assumptions.sql
--
-- No BEGIN/COMMIT: D1's HTTP API rejects transaction statements inside a
-- migration file (migration 200 failed a production deploy that way).

CREATE TABLE IF NOT EXISTS project_market_assumptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,

    -- Scope: what is being sized, where, and as of when.
    category TEXT,
    geography TEXT,
    target_year TEXT,
    methodology TEXT DEFAULT 'Top-down',

    -- The derivation itself. `tam_override` is deliberately separate from the
    -- computed TAM: a founder who overrides has made a judgement, and folding it
    -- into `projects.tam` would erase the fact that it was an override rather
    -- than the arithmetic's own answer.
    population TEXT,
    acv TEXT,
    tam_override TEXT,
    sam_pct TEXT,
    win_rate TEXT,
    runway TEXT,
    capacity TEXT,

    -- Growth. `cagr` stays NULL until the founder sets it; the page's visuals
    -- fall back to the design's 24 and say so on screen, which is a labelled
    -- placeholder rather than a stored guess.
    cagr TEXT,
    growth_driver TEXT,
    maturity TEXT DEFAULT 'Growing',

    -- The segment filter, as a JSON array of the labels the founder ticked.
    -- JSON rather than a join table: it is a view preference on one drawer, it
    -- has no identity of its own, and nothing else ever reads one segment.
    seg_filter_json TEXT,

    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The UNIQUE above already indexes `project_id`, which is the only way this
-- table is ever read. No second index.
