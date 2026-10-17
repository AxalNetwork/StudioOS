-- 460 — the stores behind Validate's six records and their forms (D690, #1692).
--
-- The canvas's Add forms (design/canvases/integrated/Cycle Overview.dc.html,
-- CO:306-310) ask for fields no store held. This migration adds a store for
-- each, and nothing a reader computes:
--
--   hypotheses          success_bar, disproof, deadline (YYYY-MM-DD): New
--                       hypothesis's "What would prove it", "What would
--                       disprove it" and "Owner · deadline".
--   customer_segments   the five steps (who_they_are, context, job_to_be_done,
--                       urgency, value_promised), value_source (Value promised
--                       with none reads "Needs a source") and score_since
--                       (NULL: every interview is listed against it).
--   competitor_signals  amount_cents and currency, for a funding signal.
--                       Money is cents with its currency (D-t).
--   demand_signals      the evidence file a signal carries (Attach), as an R2
--                       key and the file's own name. It leaves through the
--                       signed download, never a second stream. A signal feeds
--                       a claim through hypothesis_evidence_links, the one
--                       store of claim evidence, so it gains no hypothesis
--                       column.
--
--   hypothesis_experiments     a claim's experiments (Add an experiment).
--   hypothesis_evidence_links  a claim's evidence other than a pain link: an
--                              interview, a demand signal, a KPI or an
--                              experiment, each with its direction and
--                              strength. Pain links stay in
--                              hypothesis_pain_links.
--   competitor_tracking        the venture's watch settings, positioning and
--                              Stop, per competitor name. Not columns on
--                              competitor_candidates: every re-run, refresh
--                              and analysis edit rewrites that table
--                              (routes/competitors.ts persistResult).
--                              name_norm is the key loadTracked groups by:
--                              the name trimmed and lower-cased.
--
-- Every column was grepped first in schema_baseline.sql and every migration
-- (D-t). discovery_interviews.interviewee_role and
-- competitor_candidates.category already exist and are not added.
--
-- A new table's project_id and hypothesis_id cascade, as 440's tables do:
-- hardDeleteProject deletes the tables it lists and then the project
-- (services/projectTrash.ts), so a plain reference would leave a deleted
-- venture's rows behind or stop the delete. uid is set by the writer with
-- crypto.randomUUID(). The three new tables have no runtime CREATE. The one
-- runtime CREATE of a table altered here, competitor_signals in
-- services/competitorSchema.ts, declares amount_cents and currency too, as it
-- declares 440's columns (scripts/check-schema-pair-drift.mjs). It runs only
-- where the table is missing, and in production the table exists before this
-- file, so these ALTERs meet no column a runtime created first.
--
-- No BEGIN/COMMIT.

ALTER TABLE hypotheses ADD COLUMN success_bar TEXT;
ALTER TABLE hypotheses ADD COLUMN disproof TEXT;
ALTER TABLE hypotheses ADD COLUMN deadline TEXT;

ALTER TABLE customer_segments ADD COLUMN who_they_are TEXT;
ALTER TABLE customer_segments ADD COLUMN context TEXT;
ALTER TABLE customer_segments ADD COLUMN job_to_be_done TEXT;
ALTER TABLE customer_segments ADD COLUMN urgency TEXT CHECK (urgency IS NULL OR urgency IN ('low', 'medium', 'high'));
ALTER TABLE customer_segments ADD COLUMN value_promised TEXT;
ALTER TABLE customer_segments ADD COLUMN value_source TEXT;
ALTER TABLE customer_segments ADD COLUMN score_since TEXT;

ALTER TABLE competitor_signals ADD COLUMN amount_cents INTEGER;
ALTER TABLE competitor_signals ADD COLUMN currency TEXT;

ALTER TABLE demand_signals ADD COLUMN evidence_file_key TEXT;
ALTER TABLE demand_signals ADD COLUMN evidence_file_name TEXT;

CREATE TABLE IF NOT EXISTS hypothesis_experiments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL UNIQUE,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    hypothesis_id INTEGER NOT NULL REFERENCES hypotheses(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    method TEXT,
    target TEXT,
    result TEXT,
    status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'running', 'done')),
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_hypothesis_experiments_project
    ON hypothesis_experiments (project_id, hypothesis_id);

CREATE TABLE IF NOT EXISTS hypothesis_evidence_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL UNIQUE,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    hypothesis_id INTEGER NOT NULL REFERENCES hypotheses(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('interview', 'signal', 'metric', 'experiment')),
    ref_id TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('supports', 'contradicts')),
    strength TEXT CHECK (strength IS NULL OR strength IN ('anecdote', 'pattern', 'measured')),
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (hypothesis_id, kind, ref_id)
);
CREATE INDEX IF NOT EXISTS idx_hypothesis_evidence_links_ref
    ON hypothesis_evidence_links (project_id, kind, ref_id);

CREATE TABLE IF NOT EXISTS competitor_tracking (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL UNIQUE,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name_norm TEXT NOT NULL,
    watch_json TEXT NOT NULL DEFAULT '{"funding":true,"launch":true,"hiring":false}',
    why_it_matters TEXT,
    price_position TEXT,
    depth_position TEXT,
    stopped_at TEXT,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (project_id, name_norm)
);
