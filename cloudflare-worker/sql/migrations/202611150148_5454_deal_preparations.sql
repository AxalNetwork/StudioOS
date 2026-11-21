-- D5454 (#5454, ADP-01 of #5453): the private preparation boundary for a deal.
--
-- Two new tables, both additive and re-runnable. Nothing is backfilled and no
-- existing row changes: a deal with no `deal_preparations` row is a legacy deal
-- and keeps today's behaviour until the owner decides the legacy mapping
-- (documentation/architecture/decisions/D5454.md, "Legacy").
--
--   deal_preparations           one row per preparation: its issuer pair
--                               (company_id AND project_id, owner 2026-11-10),
--                               its deployment scope, and three independent
--                               dimensions: preparation_state, publication_state
--                               and the existing deals.status (not stored here).
--   deal_preparation_revisions  immutable content revisions (triggers below).
--
-- THE STRUCTURAL PRIVACY RULE (CHECK dp_private_owns_no_deal): a preparation
-- whose origin is 'preparation' carries no deal_id until a revision has been
-- released. A never-released draft therefore owns no `deals` row, and none of
-- the ~50 existing `deals` readers can list, count, index, export or notify it.
-- Release (ADP-04) allocates the canonical deal identity in the same batch that
-- sets released_revision_id. Draft creation and release stay disabled in code
-- (services/dealPreparation.ts) until ADP-02 / ADP-04.
--
-- No transaction statements, no PRAGMA (scripts/check-sql-migrations.mjs).

CREATE TABLE IF NOT EXISTS deal_preparations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  contract_version INTEGER NOT NULL DEFAULT 1 CHECK (contract_version = 1),
  -- The deployment the row belongs to: 'hq' or the branch code. Each branch has
  -- its own database; the column makes a mis-routed read refusable, not a join key.
  scope_code TEXT NOT NULL CHECK (length(scope_code) BETWEEN 2 AND 16),
  -- The issuing/contracting company and its project scope. Both required: only
  -- a company-backed project scope may become a formal deal.
  company_id INTEGER NOT NULL REFERENCES company_profiles(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  deal_id INTEGER REFERENCES deals(id),
  origin TEXT NOT NULL CHECK (origin IN ('preparation', 'legacy_attach')),
  preparation_state TEXT NOT NULL DEFAULT 'draft'
    CHECK (preparation_state IN ('draft', 'in_review', 'changes_requested', 'approved')),
  publication_state TEXT NOT NULL DEFAULT 'unreleased'
    CHECK (publication_state IN ('unreleased', 'published', 'withdrawn', 'archived')),
  working_revision_id INTEGER,
  submitted_revision_id INTEGER,
  approved_revision_id INTEGER,
  released_revision_id INTEGER,
  lock_version INTEGER NOT NULL DEFAULT 0 CHECK (lock_version >= 0),
  created_by_user_id INTEGER NOT NULL REFERENCES users(id),
  updated_by_user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  released_at TEXT,
  withdrawn_at TEXT,
  archived_at TEXT,
  CONSTRAINT dp_private_owns_no_deal CHECK (origin <> 'preparation' OR deal_id IS NULL OR released_revision_id IS NOT NULL),
  CONSTRAINT dp_legacy_names_deal CHECK (origin <> 'legacy_attach' OR deal_id IS NOT NULL),
  CONSTRAINT dp_distribution_needs_release CHECK (publication_state = 'unreleased' OR released_revision_id IS NOT NULL),
  CONSTRAINT dp_release_has_deal CHECK (released_revision_id IS NULL OR deal_id IS NOT NULL)
);

-- One preparation per canonical deal; a never-released draft has none.
CREATE UNIQUE INDEX IF NOT EXISTS idx_deal_preparations_deal
  ON deal_preparations(deal_id) WHERE deal_id IS NOT NULL;
-- The admin queue: scope, state, last edit, deterministic tie-breaker.
CREATE INDEX IF NOT EXISTS idx_deal_preparations_queue
  ON deal_preparations(scope_code, preparation_state, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_deal_preparations_publication
  ON deal_preparations(scope_code, publication_state, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_deal_preparations_issuer
  ON deal_preparations(company_id, project_id);

CREATE TABLE IF NOT EXISTS deal_preparation_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  preparation_id INTEGER NOT NULL REFERENCES deal_preparations(id),
  revision_no INTEGER NOT NULL CHECK (revision_no >= 1),
  -- The legal party identity as it stood when this revision was written. A
  -- later project move never rewrites it.
  company_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL,
  content_json TEXT NOT NULL CHECK (json_valid(content_json) AND length(content_json) <= 65536),
  content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64),
  created_by_user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (preparation_id, revision_no)
);

CREATE INDEX IF NOT EXISTS idx_deal_preparation_revisions_prep
  ON deal_preparation_revisions(preparation_id, revision_no DESC);

-- A revision is written once. A correction is a new revision.
CREATE TRIGGER IF NOT EXISTS deal_preparation_revisions_no_update
BEFORE UPDATE ON deal_preparation_revisions
BEGIN
  SELECT RAISE(ABORT, 'deal_preparation_revisions are immutable');
END;

CREATE TRIGGER IF NOT EXISTS deal_preparation_revisions_no_delete
BEFORE DELETE ON deal_preparation_revisions
BEGIN
  SELECT RAISE(ABORT, 'deal_preparation_revisions are immutable');
END;
