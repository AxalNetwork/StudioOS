-- D1065 (#2935): rule-based proposals from accepted Validate evidence.
-- No Build record is written by preparation; D1066 owns acceptance.
-- The shared AUTOFILL source fields are required by this task but are not
-- present in 506. Nullable additions preserve every existing rail proposal.
ALTER TABLE ai_rail_proposals ADD COLUMN source_kind TEXT;
ALTER TABLE ai_rail_proposals ADD COLUMN source_ref TEXT;
ALTER TABLE ai_rail_proposals ADD COLUMN source_label TEXT;

CREATE TABLE IF NOT EXISTS build_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scope TEXT NOT NULL DEFAULT 'venture',
  trigger TEXT NOT NULL CHECK (trigger IN ('manual', 'decision', 'update')),
  decision_id INTEGER REFERENCES validation_decisions(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'paused', 'superseded')),
  brief_json TEXT NOT NULL DEFAULT '{}',
  evidence_hash TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(id, project_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS build_plans_current
  ON build_plans(project_id, scope) WHERE status IN ('draft', 'open', 'paused');

CREATE TABLE IF NOT EXISTS build_plan_items (
  uid TEXT PRIMARY KEY,
  plan_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  module TEXT NOT NULL CHECK (module IN ('solution-design', 'prototype-mvp', 'product-roadmap', 'company-creation', 'operating-systems')),
  kind TEXT NOT NULL,
  item_key TEXT NOT NULL,
  proposal_uid TEXT NOT NULL UNIQUE REFERENCES ai_rail_proposals(uid),
  evidence_json TEXT NOT NULL,
  landed_table TEXT,
  landed_id TEXT,
  marker TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(plan_id, item_key),
  UNIQUE(project_id, marker),
  FOREIGN KEY(plan_id, project_id) REFERENCES build_plans(id, project_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS build_evidence_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  build_table TEXT NOT NULL,
  build_id TEXT NOT NULL,
  evidence_kind TEXT NOT NULL,
  evidence_ref TEXT NOT NULL,
  label_snapshot TEXT NOT NULL,
  plan_item_uid TEXT REFERENCES build_plan_items(uid),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(build_table, build_id, evidence_kind, evidence_ref)
);
CREATE INDEX IF NOT EXISTS build_evidence_project ON build_evidence_links(project_id, build_table, build_id);
