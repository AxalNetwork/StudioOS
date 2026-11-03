-- D4155 K5 (#4192): HQ's stage norms, the platform defaults the deck critic
-- cites after a venture's own (746's `stage_norms`, D1589).
--
-- A SIBLING TABLE, not a scope column on `stage_norms`: that table's
-- `project_id` is NOT NULL and its rows carry a sample size and a founder's
-- free-text value, while an HQ norm is a range (low, high, unit) with a
-- review date. Adding a scope would mean rebuilding 746's table; this is
-- additive only.
--
-- THE CHECKS ARE THE DESIGN, as in 746:
--   · no source, no norm: a norm without one can never be cited;
--   · a range has at least one bound, and low <= high when it has both
--     ("5+ logos" is a low with no high);
--   · a retired norm carries its reason (ten characters or more) and stays,
--     so the page can say who retired it and why. Only `active` rows are
--     cited.
--
-- `last_reviewed` is a day (YYYY-MM-DD). Who added, changed and retired a row
-- are user ids; reads name them by uid and name, never by email.
--
-- NO TRANSACTION STATEMENTS (D1's HTTP API refuses them in a migration file).

CREATE TABLE IF NOT EXISTS hq_stage_norms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL UNIQUE,
    stage TEXT NOT NULL CHECK (stage IN ('pre_seed', 'seed', 'series_a', 'series_b_plus')),
    metric TEXT NOT NULL CHECK (length(trim(metric)) > 0),
    range_low REAL,
    range_high REAL,
    range_unit TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL CHECK (length(trim(source)) > 0),
    last_reviewed TEXT NOT NULL CHECK (last_reviewed GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
    retired_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    retired_reason TEXT,
    retired_at TEXT,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (range_low IS NOT NULL OR range_high IS NOT NULL),
    CHECK (range_low IS NULL OR range_high IS NULL OR range_low <= range_high),
    CHECK (status = 'active' OR (retired_reason IS NOT NULL AND length(trim(retired_reason)) >= 10 AND retired_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_hq_stage_norms_stage_status ON hq_stage_norms(stage, status);
