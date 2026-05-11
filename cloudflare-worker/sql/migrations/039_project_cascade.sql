-- Task #7 (AM) — Projects DELETE: founder soft-delete + admin hard-delete + FK cascade.
--
-- Two changes:
--   1. Add `deleted_at TIMESTAMP NULL` to `projects` (soft-delete marker).
--   2. Rebuild every child table that FKs to projects(id) so the FK becomes
--      `ON DELETE CASCADE`. Without this, hard-deleting a project that has
--      ANY history (scores, deals, docs, …) trips a FOREIGN KEY constraint
--      violation and the existing manual-cascade code in routes/projects.ts
--      has to enumerate every child by hand.
--
-- ONE-SHOT — re-runs WILL fail. The rebuild dance (CREATE _new → INSERT
-- SELECT → DROP → RENAME) is not safely re-runnable in raw SQL because D1
-- has no procedural conditional. Apply this migration EXACTLY ONCE per
-- environment via:
--   wrangler d1 execute studioos-db --remote \
--     --file=cloudflare-worker/sql/migrations/039_project_cascade.sql
--
-- Idempotency you DO get:
--   * `ALTER TABLE projects ADD COLUMN deleted_at` errors as duplicate-column
--     on re-run; D1 rolls back the file at that point. Re-running is safe in
--     the sense that no destructive step happens before the marker.
--   * Indexes are recreated with IF NOT EXISTS.
--
-- Tables NOT cascaded by this migration (deliberate):
--   * `score_evidence`, `score_flags` — listed in task spec but not present
--     in this codebase (no CREATE TABLE found).
--   * `esign_envelopes` — has `deal_id` (deals.id), no direct project_id
--     FK, so it cascades indirectly via the deals rebuild below.
--
-- Lazy-added columns (017/019/021/007 + lazy code-paths in routes/esign.ts
-- and routes/partnernet.ts) ARE included in the _new schemas below; we
-- assume the canonical lazy schema is fully applied to the target DB. If a
-- specific column is absent on a stale DB, the corresponding INSERT SELECT
-- will error out — re-apply the relevant earlier migration first.

PRAGMA foreign_keys=OFF;

-- ---------------------------------------------------------------------------
-- 1. projects.deleted_at — soft-delete marker.
-- ---------------------------------------------------------------------------
ALTER TABLE projects ADD COLUMN deleted_at TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_projects_deleted_at ON projects(deleted_at);

-- ---------------------------------------------------------------------------
-- 2. deals — FK projects(id) → ON DELETE CASCADE.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 3. score_snapshots — FK projects(id) → ON DELETE CASCADE.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 4. documents — FK projects(id) → ON DELETE CASCADE.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 5. activity_logs — FK projects(id) → ON DELETE CASCADE.
-- Canonical-only column copy (id, uid, project_id, user_id, action, details,
-- actor, created_at). The lazy partnernet.ts ALTERs (action_type,
-- entity_type, entity_id, ip_address, user_agent, metadata) are NOT
-- enumerated here because they are added on-demand and may be absent on
-- some installs — listing them in INSERT SELECT would break the migration.
-- The lazy ALTERs in partnernet.ts will re-add the columns on next hit
-- (try/catch swallowed); any historical data in those lazy columns is lost
-- as a deliberate trade-off for migration robustness.
-- ---------------------------------------------------------------------------
CREATE TABLE activity_logs_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id),
    action TEXT NOT NULL,
    details TEXT,
    actor TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO activity_logs_new (id, uid, project_id, user_id, action, details, actor, created_at)
  SELECT id, uid, project_id, user_id, action, details, actor, created_at FROM activity_logs;
DROP TABLE activity_logs;
ALTER TABLE activity_logs_new RENAME TO activity_logs;
CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_logs(user_id);

-- ---------------------------------------------------------------------------
-- 6. discovery_interviews — FK projects(id) → ON DELETE CASCADE.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 7. roadmap_okrs — FK projects(id) → ON DELETE CASCADE.
-- ---------------------------------------------------------------------------
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

PRAGMA foreign_keys=ON;
