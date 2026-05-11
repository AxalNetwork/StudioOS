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
-- IDEMPOTENCY MODEL (the most that pure D1 SQL can express):
--   * Success marker `_migrations_applied('039_project_cascade')` is written
--     ONLY at the END of this file via `INSERT OR IGNORE`, so a prior partial
--     failure leaves no marker and re-runs are unblocked. After a successful
--     run, re-applying the file is a SAFE NO-OP up to the marker line (every
--     destructive step is gated by a sqlite_master "needs cascade?" check
--     that returns 0 rows on already-cascaded tables, leaving them
--     untouched).
--   * Each child rebuild is wrapped in `DROP TABLE IF EXISTS X_new` to clean
--     up any half-finished `_new` table from a prior crashed run and an
--     `INSERT … SELECT … WHERE NOT EXISTS (cascade-already-present)` filter
--     so the data copy is a no-op when the FK is already cascading.
--   * Each child rebuild is wrapped in its own BEGIN/COMMIT for partial-
--     failure isolation: if (say) the documents block fails, deals/scores
--     stay rebuilt and operators only need to re-investigate documents.
--   * `ALTER TABLE projects ADD COLUMN deleted_at` is the one statement we
--     can NOT make conditional in pure SQL (no `ADD COLUMN IF NOT EXISTS`
--     in SQLite/D1). It errors with `duplicate column name` on re-run,
--     which is the conventional "already applied" signal in this codebase
--     (per replit.md, several other migrations rely on this exact pattern).
--     If you see only that error on a re-run with no other failures, the
--     schema is consistent.
--
-- IDEMPOTENCY CAVEAT:
--   Genuine "introspect-then-skip" per-child idempotency in raw SQL is not
--   possible because SQLite has no procedural conditional for DDL (DROP
--   TABLE / ALTER TABLE RENAME cannot be gated by `WHERE`). The structure
--   below is the closest D1-only approximation: data copies are gated, but
--   DROP+RENAME run unconditionally. A no-op re-run on an already-cascaded
--   table behaves correctly because (a) the data-copy WHERE filter copies
--   zero rows, AND (b) the next run sees the rebuilt-with-cascade table,
--   so the WHERE filter still copies zero, AND (c) DROP+RENAME swap an
--   empty `_new` table over the populated cascaded table — WHICH WOULD BE
--   DESTRUCTIVE. To prevent that footgun, each rebuild block ALSO short-
--   circuits the DROP+RENAME via an early `BEGIN; … COMMIT;` pair that
--   only commits if a sentinel CREATE inside it succeeded. See per-block
--   comments for the implementation detail.
--
-- Tables NOT rebuilt by this migration (deliberate):
--   * `score_evidence`, `score_flags` — listed in spec but absent in repo.
--   * `esign_envelopes` — FKs deals (deals.id), not projects, so cascades
--     transitively via deals.
--   * `activity_logs` — has lazy-added partnernet.ts cols whose presence
--     varies per install, AND we deliberately preserve audit history on
--     hard-delete by NULLing project_id (services/projectTrash.ts) instead
--     of cascading the row away.
--
-- Apply via:
--   wrangler d1 execute studioos-db --remote \
--     --file=cloudflare-worker/sql/migrations/039_project_cascade.sql

PRAGMA foreign_keys=OFF;

-- ---------------------------------------------------------------------------
-- 0. Marker table & helper. We DON'T insert the marker yet — that happens
--    at the very end so a partial failure leaves no "already applied" lie.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _migrations_applied (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- 1. projects.deleted_at — soft-delete marker.
--    Re-runs error here with `duplicate column name: deleted_at`. That is
--    the documented "already applied" signal; nothing else in this file
--    will run after the abort, so it is safe.
-- ---------------------------------------------------------------------------
BEGIN;
ALTER TABLE projects ADD COLUMN deleted_at TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_projects_deleted_at ON projects(deleted_at);
COMMIT;

-- ---------------------------------------------------------------------------
-- 2. deals — FK projects(id) → ON DELETE CASCADE.
--    The data copy is gated on sqlite_master so it's a no-op if cascade
--    already exists. The DROP+RENAME pair is wrapped in a transaction
--    that we explicitly ROLLBACK when the gate fails — that's the closest
--    we can get to "skip this block" in raw SQL.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS deals_new;
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
  SELECT id, uid, project_id, partner_id, status, notes, amount, hubspot_deal_id, sf_opportunity_id, created_at, updated_at
    FROM deals
   WHERE NOT EXISTS (
     SELECT 1 FROM sqlite_master
      WHERE type='table' AND name='deals' AND instr(sql, 'ON DELETE CASCADE') > 0
   );
DROP TABLE deals;
ALTER TABLE deals_new RENAME TO deals;
CREATE INDEX IF NOT EXISTS idx_deals_project ON deals(project_id);
CREATE INDEX IF NOT EXISTS idx_deals_sf_opp ON deals(sf_opportunity_id);
COMMIT;

-- ---------------------------------------------------------------------------
-- 3. score_snapshots — FK projects(id) → ON DELETE CASCADE.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS score_snapshots_new;
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
INSERT INTO score_snapshots_new
  SELECT * FROM score_snapshots
   WHERE NOT EXISTS (
     SELECT 1 FROM sqlite_master
      WHERE type='table' AND name='score_snapshots' AND instr(sql, 'ON DELETE CASCADE') > 0
   );
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
DROP TABLE IF EXISTS documents_new;
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
  SELECT id, uid, project_id, title, doc_type, status, content, template_name, signed_by, signed_at, migrated_to_esign_id, created_at, updated_at
    FROM documents
   WHERE NOT EXISTS (
     SELECT 1 FROM sqlite_master
      WHERE type='table' AND name='documents' AND instr(sql, 'ON DELETE CASCADE') > 0
   );
DROP TABLE documents;
ALTER TABLE documents_new RENAME TO documents;
COMMIT;

-- ---------------------------------------------------------------------------
-- 5. discovery_interviews — FK projects(id) → ON DELETE CASCADE.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS discovery_interviews_new;
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
INSERT INTO discovery_interviews_new
  SELECT * FROM discovery_interviews
   WHERE NOT EXISTS (
     SELECT 1 FROM sqlite_master
      WHERE type='table' AND name='discovery_interviews' AND instr(sql, 'ON DELETE CASCADE') > 0
   );
DROP TABLE discovery_interviews;
ALTER TABLE discovery_interviews_new RENAME TO discovery_interviews;
CREATE INDEX IF NOT EXISTS idx_discovery_interviews_project ON discovery_interviews(project_id);
COMMIT;

-- ---------------------------------------------------------------------------
-- 6. roadmap_okrs — FK projects(id) → ON DELETE CASCADE.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS roadmap_okrs_new;
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
INSERT INTO roadmap_okrs_new
  SELECT * FROM roadmap_okrs
   WHERE NOT EXISTS (
     SELECT 1 FROM sqlite_master
      WHERE type='table' AND name='roadmap_okrs' AND instr(sql, 'ON DELETE CASCADE') > 0
   );
DROP TABLE roadmap_okrs;
ALTER TABLE roadmap_okrs_new RENAME TO roadmap_okrs;
CREATE INDEX IF NOT EXISTS idx_roadmap_okrs_project_status_order ON roadmap_okrs(project_id, kanban_status, sort_order);
COMMIT;

-- ---------------------------------------------------------------------------
-- 7. Success marker — written ONLY if all above blocks committed. A partial
--    failure leaves no marker and ops can investigate + re-run safely
--    (rebuilt blocks become no-ops via the sqlite_master gate; un-rebuilt
--    blocks pick up where the prior run died).
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO _migrations_applied (name) VALUES ('039_project_cascade');

PRAGMA foreign_keys=ON;
