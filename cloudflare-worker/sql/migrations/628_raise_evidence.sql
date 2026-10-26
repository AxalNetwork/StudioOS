-- D1263 (#3286): founder-decided Raise evidence, claims and links.
-- Source vocabulary is #2430 / D1261. No source value is backfilled or graded.
-- AUTOFILL's proposal source columns were declared by migration 581.
CREATE TABLE IF NOT EXISTS raise_evidence_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  area TEXT NOT NULL CHECK (area IN ('Fundraising readiness','Investor narrative and Pitch deck','Use of funds','Data room','Cap table','Capital relationships','Legal','Capital model')),
  kind TEXT NOT NULL,
  source_table TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  provider TEXT,
  source_label TEXT NOT NULL CHECK (source_label IN ('connector','document','recorded','signed','typed')),
  strength TEXT NOT NULL CHECK (strength IN ('anecdote','pattern','measured')),
  observed_on TEXT,
  summary TEXT NOT NULL,
  value_num REAL,
  value_unit TEXT,
  currency TEXT,
  snapshot_hash TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pinned' CHECK (state IN ('pinned','unpinned')),
  proposal_uid TEXT REFERENCES ai_rail_proposals(uid) ON DELETE SET NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('private','summary','after_nda')),
  private_reason TEXT CHECK (private_reason IS NULL OR private_reason IN ('bank','quote')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  mutation_uid TEXT NOT NULL,
  accepted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  accepted_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(project_id, area, source_table, source_ref),
  UNIQUE(id, project_id)
);
CREATE INDEX IF NOT EXISTS ix_raise_evidence_project ON raise_evidence_items(project_id, state, area, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_raise_evidence_proposal_source
  ON ai_rail_proposals(record_ref, source_ref) WHERE rail_option = 'raise:evidence' AND kind = 'proposal';

CREATE TABLE IF NOT EXISTS raise_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  surface TEXT NOT NULL,
  surface_version TEXT NOT NULL,
  field_key TEXT NOT NULL,
  claim_kind TEXT NOT NULL,
  stated_value TEXT,
  state TEXT NOT NULL DEFAULT 'not_backed' CHECK (state IN ('backed','founders_figure','mismatch','not_backed')),
  checked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(project_id, surface, surface_version, field_key),
  UNIQUE(id, project_id)
);
CREATE TABLE IF NOT EXISTS raise_claim_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  claim_id INTEGER NOT NULL,
  item_id INTEGER NOT NULL,
  how TEXT NOT NULL CHECK (how IN ('computed','founder','eadwyn_accepted')),
  proposal_uid TEXT REFERENCES ai_rail_proposals(uid) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  mutation_uid TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(claim_id, item_id),
  FOREIGN KEY(claim_id, project_id) REFERENCES raise_claims(id, project_id) ON DELETE CASCADE,
  FOREIGN KEY(item_id, project_id) REFERENCES raise_evidence_items(id, project_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_raise_claims_project ON raise_claims(project_id, surface, id);

-- A small per-venture freshness/lease record, not a scheduled job.
CREATE TABLE IF NOT EXISTS raise_evidence_refreshes (
  project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  last_built_at TEXT,
  last_attempt_at TEXT,
  lease_uid TEXT,
  lease_until TEXT,
  outcome TEXT NOT NULL DEFAULT 'not_recorded' CHECK (outcome IN ('not_recorded','recorded','partial','unreadable')),
  blocks_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(blocks_json))
);
