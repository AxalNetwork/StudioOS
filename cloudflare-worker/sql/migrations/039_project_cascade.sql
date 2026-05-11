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
-- IDEMPOTENCY CONTRACT:
--   * The first transaction inserts a marker into `_migrations_applied` with
--     PRIMARY KEY = '039_project_cascade'. On re-run the INSERT errors with
--     UNIQUE constraint and the file aborts BEFORE any destructive DDL has
--     a chance to run. wrangler stops on first error and never reaches the
--     subsequent rebuild blocks. So re-running this file is safe.
--   * Every subsequent rebuild is wrapped in its own BEGIN/COMMIT so a
--     mid-file failure (e.g. unexpected schema drift on one child) leaves
--     all OTHER children intact rather than half-rebuilt.
--
-- Tables NOT rebuilt by this migration (deliberate):
--   * `score_evidence`, `score_flags` — listed in the task spec but do not
--     exist in this codebase (no CREATE TABLE found anywhere).
--   * `esign_envelopes` — has `deal_id` (deals.id), no direct project FK,
--     so it cascades indirectly via the deals rebuild below.
--   * `activity_logs` — DELIBERATELY NOT REBUILT. It has lazy-added
--     columns (action_type, entity_type, entity_id, ip_address,
--     user_agent, metadata) that are added on-demand by partnernet.ts
--     and may or may not exist on a given install; an INSERT SELECT that
--     enumerates them would either lose data (if omitted) or break the
--     migration (if listed). Audit-history rows for a hard-deleted project
--     are PRESERVED on purpose (services/projectTrash.ts:hardDeleteProject
--     nulls out `project_id` rather than deleting the row), so a CASCADE
--     FK is not desired here in the first place.
--
-- Apply via:
--   wrangler d1 execute studioos-db --remote \
--     --file=cloudflare-worker/sql/migrations/039_project_cascade.sql

-- ---------------------------------------------------------------------------
-- 0. Idempotency guard. On a second run, the INSERT below errors with
--    UNIQUE constraint, the file aborts, and nothing destructive happens.
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
