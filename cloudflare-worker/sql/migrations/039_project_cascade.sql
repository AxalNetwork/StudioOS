-- Task #7 (AM) — Projects DELETE: founder soft-delete + admin hard-delete + FK cascade.
--
-- Two changes:
--   1. Add `deleted_at TIMESTAMP NULL` to `projects` (soft-delete marker).
--   2. Rebuild every child table that FKs to projects(id) so the FK becomes
--      `ON DELETE CASCADE`. Without this, hard-deleting a project that has
--      ANY history (scores, deals, docs, …) trips a FOREIGN KEY constraint
--      violation and the existing manual-cascade code in
--      services/projectTrash.ts has to enumerate every child by hand.
--
-- STRICT ONE-SHOT — re-running this file is a HARD ABORT (safe no-op):
--   The very first transaction inserts a marker row into
--   `_migrations_applied` with PRIMARY KEY 'name'. On any re-run the INSERT
--   errors with UNIQUE constraint, the BEGIN/COMMIT rolls back the marker
--   transaction, wrangler stops on first error, and NONE of the destructive
--   DDL below executes. This is the safest model in pure D1 SQL because
--   DROP TABLE / ALTER TABLE RENAME cannot be conditionally gated by a
--   WHERE clause (no procedural conditional in raw SQL), so any "skip if
--   already cascaded" data-copy gate would still leave DROP+RENAME running
--   unconditionally and DESTROY data. Marker-at-START avoids that footgun.
--
-- PARTIAL-FAILURE RECOVERY:
--   If a rebuild block (sections 2–6) fails, the marker IS already
--   committed and re-running won't help. To recover:
--     a. Inspect the failure (D1 prints the offending SQL).
--     b. Manually apply the remaining child rebuilds via wrangler `--command`
--        invocations (each block here is independent and self-contained).
--     c. Or: `DELETE FROM _migrations_applied WHERE name='039_project_cascade';`
--        then re-apply this file — but ONLY after manually dropping any
--        already-cascaded `<table>_new` artifacts to avoid duplicate-table
--        errors. This path is operator-only; do not automate it.
--   Each rebuild is wrapped in its own BEGIN/COMMIT so a mid-file failure
--   leaves earlier children fully migrated rather than half-rebuilt.
--
-- Tables NOT rebuilt (deliberate):
--   * `score_evidence`, `score_flags` — listed in spec but absent in repo.
--   * `esign_envelopes` — FKs deals (deals.id), not projects, so cascades
--     transitively via deals.
--   * `activity_logs` — has lazy-added partnernet.ts cols whose presence
--     varies per install; rebuilding here is fragile, AND we deliberately
--     preserve audit history on hard-delete by NULLing project_id (see
--     services/projectTrash.ts:hardDeleteProject) instead of cascading
--     the row away.
--
-- Apply via:
--   wrangler d1 execute studioos-db --remote \
--     --file=cloudflare-worker/sql/migrations/039_project_cascade.sql

-- ---------------------------------------------------------------------------
-- 0. Idempotency guard. Re-runs error here on UNIQUE constraint and the
--    file aborts BEFORE any destructive DDL runs.
-- ---------------------------------------------------------------------------
BEGIN;
CREATE TABLE IF NOT EXISTS _migrations_applied (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO _migrations_applied (name) VALUES ('039_project_cascade');
COMMIT;

PRAGMA foreign_keys=OFF;

-- ---------------------------------------------------------------------------
-- 1. projects.deleted_at — soft-delete marker.
-- ---------------------------------------------------------------------------
BEGIN;
ALTER TABLE projects ADD COLUMN deleted_at TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_projects_deleted_at ON projects(deleted_at);
COMMIT;

-- ---------------------------------------------------------------------------
-- 2. deals — FK projects(id) → ON DELETE CASCADE.
-- ---------------------------------------------------------------------------
BEGIN;
CREATE TABLE deals_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    partner_id INTEGER REFERENCES partners(id),
    status TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('applied', 'scored', 'active', 'funded', 'rejected')),
    notes TEXT,
    amount REAL,
    hubspot_deal_id TEXT,
    sf_opportunity_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO deals_new (id, uid, project_id, partner_id, status, notes, amount, hubspot_deal_id, sf_opportunity_id, created_at, updated_at)
  SELECT id, uid, project_id, partner_id, status, notes, amount, hubspot_deal_id, sf_opportunity_id, created_at, updated_at FROM deals;
DROP TABLE deals;
ALTER TABLE deals_new RENAME TO deals;
CREATE INDEX IF NOT EXISTS idx_deals_project ON deals(project_id);
CREATE INDEX IF NOT EXISTS idx_deals_sf_opp ON deals(sf_opportunity_id);
COMMIT;

-- ---------------------------------------------------------------------------
-- 3. score_snapshots — FK projects(id) → ON DELETE CASCADE.
-- ---------------------------------------------------------------------------
BEGIN;
CREATE TABLE score_snapshots_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    total_score REAL NOT NULL,
    tier TEXT NOT NULL,
    market_size REAL DEFAULT 0,
    market_urgency REAL DEFAULT 0,
    market_trend REAL DEFAULT 0,
    market_total REAL DEFAULT 0,
    team_expertise REAL DEFAULT 0,
    team_execution REAL DEFAULT 0,
    team_network REAL DEFAULT 0,
    team_total REAL DEFAULT 0,
    product_mvp_time REAL DEFAULT 0,
    product_complexity REAL DEFAULT 0,
    product_dependency REAL DEFAULT 0,
    product_total REAL DEFAULT 0,
    capital_cost_mvp REAL DEFAULT 0,
    capital_time_revenue REAL DEFAULT 0,
    capital_burn_traction REAL DEFAULT 0,
    capital_total REAL DEFAULT 0,
    fit_alignment REAL DEFAULT 0,
    fit_synergy REAL DEFAULT 0,
    fit_total REAL DEFAULT 0,
    distribution_channels REAL DEFAULT 0,
    distribution_virality REAL DEFAULT 0,
    distribution_total REAL DEFAULT 0,
    ai_adjustment REAL DEFAULT 0,
    ai_notes TEXT,
    scored_by TEXT,
    is_sandbox INTEGER NOT NULL DEFAULT 0,
    integrity_hash TEXT,
    integrity_version TEXT NOT NULL DEFAULT 'v1',
    inputs_json TEXT,
    qualitative_text TEXT,
    anomaly_flags TEXT,
    admin_review_status TEXT NOT NULL DEFAULT 'auto_approved',
    admin_review_notes TEXT,
    admin_reviewed_by INTEGER REFERENCES users(id),
    admin_reviewed_at TEXT,
    locked_until TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO score_snapshots_new SELECT * FROM score_snapshots;
DROP TABLE score_snapshots;
ALTER TABLE score_snapshots_new RENAME TO score_snapshots;
CREATE INDEX IF NOT EXISTS idx_scores_project      ON score_snapshots(project_id);
CREATE INDEX IF NOT EXISTS idx_scores_sandbox      ON score_snapshots(project_id, is_sandbox, created_at);
CREATE INDEX IF NOT EXISTS idx_scores_review       ON score_snapshots(admin_review_status);
CREATE INDEX IF NOT EXISTS idx_scores_locked_until ON score_snapshots(project_id, locked_until);
COMMIT;

-- ---------------------------------------------------------------------------
-- 4. documents — FK projects(id) → ON DELETE CASCADE.
--    Includes migration 007's `migrated_to_esign_id` column.
-- ---------------------------------------------------------------------------
BEGIN;
CREATE TABLE documents_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    doc_type TEXT NOT NULL DEFAULT 'other',
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'generated', 'sent', 'signed')),
    content TEXT,
    template_name TEXT,
    signed_by TEXT,
    signed_at TEXT,
    migrated_to_esign_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO documents_new (id, uid, project_id, title, doc_type, status, content, template_name, signed_by, signed_at, migrated_to_esign_id, created_at, updated_at)
  SELECT id, uid, project_id, title, doc_type, status, content, template_name, signed_by, signed_at, migrated_to_esign_id, created_at, updated_at FROM documents;
DROP TABLE documents;
ALTER TABLE documents_new RENAME TO documents;
COMMIT;

-- ---------------------------------------------------------------------------
-- 5. discovery_interviews — FK projects(id) → ON DELETE CASCADE.
-- ---------------------------------------------------------------------------
BEGIN;
CREATE TABLE discovery_interviews_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    interviewee_name TEXT NOT NULL,
    interviewee_role TEXT,
    interview_date TEXT,
    notes TEXT,
    hypotheses_json TEXT,
    pains_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO discovery_interviews_new SELECT * FROM discovery_interviews;
DROP TABLE discovery_interviews;
ALTER TABLE discovery_interviews_new RENAME TO discovery_interviews;
CREATE INDEX IF NOT EXISTS idx_discovery_interviews_project ON discovery_interviews(project_id);
COMMIT;

-- ---------------------------------------------------------------------------
-- 6. roadmap_okrs — FK projects(id) → ON DELETE CASCADE.
-- ---------------------------------------------------------------------------
BEGIN;
CREATE TABLE roadmap_okrs_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    objective TEXT NOT NULL,
    key_results_json TEXT,
    kanban_status TEXT NOT NULL DEFAULT 'now',
    quarter TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO roadmap_okrs_new SELECT * FROM roadmap_okrs;
DROP TABLE roadmap_okrs;
ALTER TABLE roadmap_okrs_new RENAME TO roadmap_okrs;
CREATE INDEX IF NOT EXISTS idx_roadmap_okrs_project_status_order ON roadmap_okrs(project_id, kanban_status, sort_order);
COMMIT;

PRAGMA foreign_keys=ON;
