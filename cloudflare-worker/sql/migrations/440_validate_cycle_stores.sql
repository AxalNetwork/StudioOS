-- 440 — D659: the stores the Validate cycle's six modules read, and nothing
-- derived (#1472, part of #1469 / D656).
--
-- Every figure and card on `/api/cycles/validate` is computed at read time
-- from the rows below plus the stores that already existed
-- (`discovery_interviews`, `interview_pain_severities`, `pain_groups`,
-- `hypotheses`, `hypothesis_pain_links`, `waitlist_signups`,
-- `revenue_entries`, `metric_targets`, `competitor_*`, `projects`). No count,
-- status, lane or share is stored here: each would be a second answer to a
-- question the records already answer.
--
-- EVERY NEW COLUMN IS NULLABLE AND NULL MEANS "NOT RECORDED". An interview
-- logged before this file has no stage, no segment, no booking time; a link
-- written before it has no strength. None of them is backfilled — the read
-- says "Not recorded" for each, and the one mapping it applies (an interview
-- with no stage was logged after it was held, so it reads as done) is stated
-- in `services/cycleValidate.ts` where it is applied.
--
-- SEVERITY NEEDS NO COLUMN. `interview_pain_severities.severity` is TEXT, and
-- the three levels the canvas draws (Severe, Real, Mild) are new VALUES of it.
-- Old rows keep `need` and `nice` and are read as Severe and Mild by
-- `severityLevel()` in `services/painGroups.ts`; no row is rewritten.
--
-- THE WAITLIST BAR NEEDS NO COLUMN. It is the `waitlist_target` key of
-- `metric_targets`, one row per project like every other target.
--
-- IDEMPOTENCY CAVEAT, as migration 211 states it: D1's `ALTER TABLE … ADD
-- COLUMN` has no IF NOT EXISTS, so a re-run stops at the first ALTER with
-- "duplicate column name" and changes nothing. The runner's ledger applies
-- each file once. Every CREATE below is IF NOT EXISTS.

-- ============================================================================
-- Ideal customer profile — segments, and which segment an interview belongs to
-- ============================================================================
--
-- Until now a segment existed only as a filter inside
-- `project_market_assumptions.seg_filter_json`, so no interview could say
-- whom it was with. `source` says where the row came from: `icp_definition`
-- for the one seeded from the project's ICP wizard, `manual` for the form,
-- `interview` for one accepted from an interview proposal (#1471).
CREATE TABLE IF NOT EXISTS customer_segments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    name_norm TEXT NOT NULL,
    description TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    source_ref TEXT,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    archived_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_segments_project_name
    ON customer_segments (project_id, name_norm);

ALTER TABLE discovery_interviews ADD COLUMN segment_id INTEGER REFERENCES customer_segments(id) ON DELETE SET NULL;

-- ============================================================================
-- Customer research — the recruiting pipeline on the interview itself
-- ============================================================================
--
-- `stage` is lead / invited / booked / done. Each stage keeps the time it was
-- reached, so the funnel and the weekly chart are both bucketed in SQL from
-- these columns rather than counted in a browser.
ALTER TABLE discovery_interviews ADD COLUMN stage TEXT;
ALTER TABLE discovery_interviews ADD COLUMN invited_at TEXT;
ALTER TABLE discovery_interviews ADD COLUMN booked_at TEXT;
ALTER TABLE discovery_interviews ADD COLUMN done_at TEXT;
ALTER TABLE discovery_interviews ADD COLUMN channel TEXT;

CREATE INDEX IF NOT EXISTS idx_discovery_interviews_project_stage
    ON discovery_interviews (project_id, stage);

-- ============================================================================
-- Demand and urgency signals — letters of intent, pre-sales, need-to-have
-- ============================================================================
--
-- A pre-sale paid through the revenue ledger is NOT copied here: the read
-- takes `revenue_entries` of type `deposit` and `pilot` as they are. This
-- table holds what no other store does — a letter of intent, a promise to
-- pay, a need-to-have a founder confirmed from an interview, a waitlist
-- signal from outside the platform's own waitlist.
--
-- `amount_cents` is NULL when no amount was named, never 0.
-- `status`: confirmed / counted / to_confirm. A signal proposed from an
-- interview arrives `to_confirm` and is counted only once the founder says so.
CREATE TABLE IF NOT EXISTS demand_signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    who TEXT,
    amount_cents INTEGER,
    currency TEXT,
    period TEXT,
    signal_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'to_confirm',
    source_kind TEXT NOT NULL DEFAULT 'manual',
    interview_id INTEGER REFERENCES discovery_interviews(id) ON DELETE SET NULL,
    session_id INTEGER,
    note TEXT,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_demand_signals_project
    ON demand_signals (project_id, signal_date);

-- ============================================================================
-- Market intelligence — a competitor signal knows its project and its source
-- ============================================================================
--
-- The tracked list stays `competitor_candidates` under the project's
-- `competitor_analyses`, as `/api/competitors` writes it. A signal on one of
-- them gains the project it is about (an interview mention has no analysis
-- run behind it to scope it) and where it came from.
ALTER TABLE competitor_signals ADD COLUMN project_id INTEGER;
ALTER TABLE competitor_signals ADD COLUMN source_url TEXT;
ALTER TABLE competitor_signals ADD COLUMN source_kind TEXT;
ALTER TABLE competitor_signals ADD COLUMN observed_on TEXT;

CREATE INDEX IF NOT EXISTS idx_competitor_signals_project
    ON competitor_signals (project_id, created_at);

-- The Lab market page's readiness checklist held three of its nine checks in
-- browser state, so a reload undid them. Two are marks a founder sets
-- (`positioning_map`, `assumptions_reviewed`); the third is a list of sources
-- they added by hand.
CREATE TABLE IF NOT EXISTS market_readiness_marks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    item TEXT NOT NULL,
    marked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    marked_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_market_readiness_marks_item
    ON market_readiness_marks (project_id, item);

CREATE TABLE IF NOT EXISTS market_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    url TEXT,
    kind TEXT NOT NULL DEFAULT 'manual',
    added_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_market_sources_project
    ON market_sources (project_id);

-- ============================================================================
-- Experiments and evidence
-- ============================================================================
--
-- A claim's verdict stays computed (`_founder_validate_helpers.ts`). What a
-- founder can add is the sprint it is tested in, who owns it, and the mark
-- that a sprint closed on it without a result — Inconclusive, which no count
-- of interviews computes. A computed Supported or Refuted outranks the mark.
ALTER TABLE hypotheses ADD COLUMN sprint TEXT;
ALTER TABLE hypotheses ADD COLUMN owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE hypotheses ADD COLUMN inconclusive_at TEXT;

-- Strength per evidence item: anecdote / pattern / measured. NULL is not
-- recorded, never "anecdote".
ALTER TABLE hypothesis_pain_links ADD COLUMN strength TEXT;
