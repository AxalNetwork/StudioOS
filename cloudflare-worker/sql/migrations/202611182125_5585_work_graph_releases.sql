-- 202611182125 — D5585 part 1 (#5585, WorkGraph P1 under #5577): composite release manifests, the component
-- attestations their policy profiles require, and the publish decisions bound to a manifest's digest. Named by its
-- UTC minute and its issue (D4106, D5398).
--
-- EXTENDS #5581's REGISTRY, NOT A SECOND LEDGER. A release line is a `composite` asset in `work_graph_assets`; a
-- manifest is one immutable revision of it in `work_graph_revisions`, whose digest is the manifest's digest and whose
-- `component` edges in `work_graph_edges` pin each component revision. The publication pointer is that asset's head,
-- moved only by #5581's compare-and-swap, audited in `work_graph_events`, and its outbox effects are rows of
-- `work_graph_effects` written in the same batch. These four tables hold only what those cannot:
--
--   work_graph_release_lines         the audience of a release line (one row per composite asset, fixed).
--   work_graph_release_manifests     what a manifest pins, by revision uid and digest, with each component's role
--                                    and policy profiles (ids and digests only), and whether it is a partial package.
--   work_graph_release_attestations  the evidence a profile requires of one component revision at one digest
--                                    (PR and CI, rights, claims, evidence, counsel, signing authority, residency,
--                                    security), with who attested it. A new revision has none.
--   work_graph_release_decisions     a reviewer's decision on one manifest digest for one audience, profile and
--                                    purpose (publish, or the separate render approval), with the reviewer's
--                                    authority, the approval-inbox item it came from, citations, disclosure and rights.
--
-- All four are append-only (triggers): a withdrawn approval is a later `withdraw` row, never an edit. No column holds
-- content, a preview or model text. Additive only: dropping the four tables loses only the release metadata; the
-- composite assets, revisions, edges, events and effects stay #5581's.

CREATE TABLE IF NOT EXISTS work_graph_release_lines (
  line_asset_uid TEXT PRIMARY KEY REFERENCES work_graph_assets(asset_uid),
  tenant_id INTEGER NOT NULL,
  company_id INTEGER NOT NULL,
  project_id INTEGER,
  audience TEXT NOT NULL CHECK (audience IN ('internal', 'investors', 'partners', 'public')),
  created_by_user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_work_graph_release_lines_scope ON work_graph_release_lines (tenant_id, company_id);

CREATE TRIGGER IF NOT EXISTS work_graph_release_lines_fixed
BEFORE UPDATE ON work_graph_release_lines
BEGIN
  SELECT RAISE(ABORT, 'work_graph_release_lines is fixed; start a new line for another audience (D5585).');
END;

CREATE TRIGGER IF NOT EXISTS work_graph_release_lines_no_delete
BEFORE DELETE ON work_graph_release_lines
BEGIN
  SELECT RAISE(ABORT, 'work_graph_release_lines is never deleted (D5585).');
END;

CREATE TABLE IF NOT EXISTS work_graph_release_manifests (
  manifest_uid TEXT PRIMARY KEY REFERENCES work_graph_revisions(revision_uid),
  line_asset_uid TEXT NOT NULL REFERENCES work_graph_release_lines(line_asset_uid),
  tenant_id INTEGER NOT NULL,
  company_id INTEGER NOT NULL,
  project_id INTEGER,
  audience TEXT NOT NULL CHECK (audience IN ('internal', 'investors', 'partners', 'public')),
  manifest_digest TEXT NOT NULL CHECK (length(manifest_digest) = 64 AND manifest_digest NOT GLOB '*[^0-9a-f]*'),
  base_manifest_uid TEXT,
  partial INTEGER NOT NULL DEFAULT 0 CHECK (partial IN (0, 1)),
  component_count INTEGER NOT NULL CHECK (component_count >= 1),
  body_json TEXT NOT NULL CHECK (json_valid(body_json) AND length(body_json) <= 32000),
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('person', 'agent')),
  actor_user_id INTEGER NOT NULL,
  agent_run_id TEXT,
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  created_at TEXT NOT NULL,
  CHECK ((actor_kind = 'agent') = (agent_run_id IS NOT NULL)),
  UNIQUE (tenant_id, company_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_work_graph_release_manifests_line ON work_graph_release_manifests (line_asset_uid, created_at);

CREATE TRIGGER IF NOT EXISTS work_graph_release_manifests_immutable
BEFORE UPDATE ON work_graph_release_manifests
BEGIN
  SELECT RAISE(ABORT, 'work_graph_release_manifests is immutable; cut a new manifest (D5585).');
END;

CREATE TRIGGER IF NOT EXISTS work_graph_release_manifests_no_delete
BEFORE DELETE ON work_graph_release_manifests
BEGIN
  SELECT RAISE(ABORT, 'work_graph_release_manifests is never deleted (D5585).');
END;

CREATE TABLE IF NOT EXISTS work_graph_release_attestations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  company_id INTEGER NOT NULL,
  revision_uid TEXT NOT NULL REFERENCES work_graph_revisions(revision_uid),
  digest TEXT NOT NULL CHECK (length(digest) = 64 AND digest NOT GLOB '*[^0-9a-f]*'),
  requirement TEXT NOT NULL CHECK (requirement IN ('pr_validated', 'ci_passed', 'brand_rights', 'claims_review',
    'evidence_review', 'counsel_review', 'signing_authority', 'residency_review', 'security_review')),
  evidence_ref TEXT NOT NULL CHECK (length(evidence_ref) BETWEEN 1 AND 200),
  authority TEXT CHECK (authority IS NULL OR length(authority) BETWEEN 1 AND 40),
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('person', 'agent')),
  actor_user_id INTEGER NOT NULL,
  agent_run_id TEXT,
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  created_at TEXT NOT NULL,
  CHECK ((actor_kind = 'agent') = (agent_run_id IS NOT NULL)),
  UNIQUE (tenant_id, company_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_work_graph_release_attestations_rev ON work_graph_release_attestations (revision_uid, requirement);

CREATE TRIGGER IF NOT EXISTS work_graph_release_attestations_append_only
BEFORE UPDATE ON work_graph_release_attestations
BEGIN
  SELECT RAISE(ABORT, 'work_graph_release_attestations is append-only (D5585).');
END;

CREATE TRIGGER IF NOT EXISTS work_graph_release_attestations_no_delete
BEFORE DELETE ON work_graph_release_attestations
BEGIN
  SELECT RAISE(ABORT, 'work_graph_release_attestations is append-only (D5585).');
END;

CREATE TABLE IF NOT EXISTS work_graph_release_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  company_id INTEGER NOT NULL,
  project_id INTEGER,
  manifest_uid TEXT NOT NULL REFERENCES work_graph_release_manifests(manifest_uid),
  manifest_digest TEXT NOT NULL CHECK (length(manifest_digest) = 64 AND manifest_digest NOT GLOB '*[^0-9a-f]*'),
  audience TEXT NOT NULL CHECK (audience IN ('internal', 'investors', 'partners', 'public')),
  purpose TEXT NOT NULL CHECK (purpose IN ('publish', 'render')),
  profile TEXT NOT NULL CHECK (profile IN ('code', 'marketing', 'investor_pitch', 'contract', 'protected_data')),
  authority TEXT NOT NULL CHECK (length(authority) BETWEEN 1 AND 40),
  decision TEXT NOT NULL CHECK (decision IN ('approve', 'reject', 'request_changes', 'withdraw')),
  reviewer_user_id INTEGER NOT NULL,
  approval_ref TEXT NOT NULL CHECK (length(approval_ref) BETWEEN 1 AND 200),
  citations_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(citations_json) AND json_type(citations_json) = 'array'
    AND length(citations_json) <= 4000),
  disclosure_ref TEXT CHECK (disclosure_ref IS NULL OR length(disclosure_ref) BETWEEN 1 AND 200),
  rights_ref TEXT CHECK (rights_ref IS NULL OR length(rights_ref) BETWEEN 1 AND 200),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  decided_at TEXT NOT NULL,
  UNIQUE (tenant_id, company_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_work_graph_release_decisions_manifest ON work_graph_release_decisions (manifest_uid, purpose, profile, id);

CREATE TRIGGER IF NOT EXISTS work_graph_release_decisions_append_only
BEFORE UPDATE ON work_graph_release_decisions
BEGIN
  SELECT RAISE(ABORT, 'work_graph_release_decisions is append-only; withdraw with a new row (D5585).');
END;

CREATE TRIGGER IF NOT EXISTS work_graph_release_decisions_no_delete
BEFORE DELETE ON work_graph_release_decisions
BEGIN
  SELECT RAISE(ABORT, 'work_graph_release_decisions is append-only (D5585).');
END;
