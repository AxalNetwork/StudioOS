-- 746 — D1589 (#3836): stage norms, the only benchmarks a deck critic may cite.
--
-- The stage plan (#3774) and the investor critic (#3804) warn when a deck is
-- missing the proof its stage needs ("Seed deck with no traction slide"). A
-- warning that also states a benchmark ("seed rounds show 15% month-on-month
-- growth") is a claim about other companies, and it needs a base. This table
-- is that base. A critic cites a row from here, or the founder's own entered
-- benchmark with its source and sample size, or it makes no benchmark claim:
-- "No stage benchmark recorded".
--
-- OWNER DECISION S = A now, C later (2026-11-01). The rows are entered by the
-- venture's founder or team (origin 'founder'). Axal's own anonymised ventures
-- (origin 'axal_anonymised') are a follow-up issue; the value is in the CHECK
-- now so that follow-up adds a writer, not a table rebuild. No route writes it
-- yet.
--
-- THE CHECKS ARE THE DESIGN, as in 217's research_benchmarks: a norm without
-- its source, or without the sample it was measured over, cannot be written by
-- any writer, not only by the route that validates it first.
--
-- VALUES ARE TEXT. "15% MoM", "$1.2M ARR", "18 months": the unit travels with
-- the value, so "15" is never read as a count.
--
-- SCOPE. A row belongs to one venture (project_id) and is read through
-- `projectOwned`, as every deck read is; the critic for a deck reads its own
-- venture's norms only. `entered_by` is who wrote it.
--
-- NO TRANSACTION STATEMENTS (D1's HTTP API refuses them in a migration file).

CREATE TABLE IF NOT EXISTS stage_norms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL UNIQUE,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    entered_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    origin TEXT NOT NULL DEFAULT 'founder' CHECK (origin IN ('founder', 'axal_anonymised')),
    stage TEXT NOT NULL CHECK (stage IN ('pre_seed', 'seed', 'series_a', 'series_b_plus')),
    -- NULL means the norm holds for every investor type at that stage.
    investor_type TEXT,
    -- What is measured, in the founder's words: "Month-on-month revenue growth".
    metric TEXT NOT NULL CHECK (length(trim(metric)) > 0),
    value TEXT NOT NULL CHECK (length(trim(value)) > 0),
    -- Where the figure comes from, and how many companies it was measured over.
    source TEXT NOT NULL CHECK (length(trim(source)) > 0),
    sample_size INTEGER NOT NULL CHECK (sample_size > 0),
    -- When the set was measured. Optional; the read says "Not recorded" rather
    -- than implying today.
    as_of TEXT CHECK (as_of IS NULL OR as_of GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_stage_norms_project_stage ON stage_norms(project_id, stage);
