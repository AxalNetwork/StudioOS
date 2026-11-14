-- 202611140007 — D5581 part 1 (#5581, WorkGraph P0 under #5577): the revision registry, the compare-and-swap
-- head, the dependency edges and the append-only event trail. Named by its UTC minute and its issue (D4106, D5398).
--
--   work_graph_assets      one WorkGraph asset per row: its scope, kind (D5579 ASSET_KINDS), access class,
--                          approval policy, and the accepted head. The head moves ONLY by compare-and-swap
--                          (`... WHERE asset_uid = ? AND head_revision_uid IS ?`); head_seq counts accepted moves.
--   work_graph_revisions   one immutable revision per row: parents (same-asset DAG), digest, byte length, the
--                          SourceRef into the canonical domain store (D5579 §2), the author (person, or agent run on
--                          behalf of a person, with its charge), and the retry key. Only the legal hold and the
--                          one-way tombstone may change; nothing is ever deleted.
--   work_graph_edges       the dependency DAG: a revision's read set, write set, derivations and composite
--                          components, each pinned to the dependency revision it was taken at. Staleness is read,
--                          never stored: an edge is stale when its pinned revision is no longer its asset's head.
--   work_graph_events      the audit trail: who (actor, agent run, charge), from which base, which mutation, under
--                          which approval, to which published revision, and refusals. It holds no content.
--
-- WHY NOT admin_audit_log. That table is the Super Admin governance feed of privileged admin actions (D159), keyed
-- by an admin user and read unfiltered by HQ's feed; a WorkGraph write is a tenant's person or agent run, and its
-- record must land in the same D1 batch as the head move. Nothing here duplicates a domain revision table: a
-- revision POINTS at the domain row (source_*) and carries the digest WorkGraph computed (D5579 §5 step 2).
--
-- NO BYTES, NO PREVIEWS. No column holds document content, a preview or model text. Additive only; dropping these
-- four tables loses only WorkGraph's index (D5579 §5 step 4).

CREATE TABLE IF NOT EXISTS work_graph_assets (
  asset_uid TEXT PRIMARY KEY CHECK (length(asset_uid) BETWEEN 1 AND 80),
  tenant_id INTEGER NOT NULL,
  company_id INTEGER NOT NULL,
  project_id INTEGER,
  kind TEXT NOT NULL CHECK (kind IN ('code', 'legal_template', 'legal_signed', 'document', 'pitch_deck', 'offer',
    'brand', 'image', 'video', 'audio', 'model_3d', 'composite')),
  access_class TEXT NOT NULL CHECK (access_class IN ('public', 'internal', 'confidential', 'restricted')),
  approval_policy TEXT NOT NULL CHECK (length(approval_policy) BETWEEN 1 AND 80),
  head_revision_uid TEXT,
  head_seq INTEGER NOT NULL DEFAULT 0 CHECK (head_seq >= 0),
  version_count INTEGER NOT NULL DEFAULT 0 CHECK (version_count >= 0),
  created_by_user_id INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  created_at TEXT NOT NULL,
  UNIQUE (tenant_id, company_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_work_graph_assets_scope ON work_graph_assets (tenant_id, company_id, project_id);

CREATE TABLE IF NOT EXISTS work_graph_revisions (
  revision_uid TEXT PRIMARY KEY CHECK (length(revision_uid) BETWEEN 1 AND 80),
  asset_uid TEXT NOT NULL REFERENCES work_graph_assets(asset_uid),
  tenant_id INTEGER NOT NULL,
  company_id INTEGER NOT NULL,
  project_id INTEGER,
  seq INTEGER NOT NULL CHECK (seq >= 1),
  parent_uids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(parent_uids_json) AND json_type(parent_uids_json) = 'array'),
  digest TEXT NOT NULL CHECK (length(digest) = 64 AND digest NOT GLOB '*[^0-9a-f]*'),
  byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
  media_profile TEXT NOT NULL CHECK (length(media_profile) BETWEEN 1 AND 120),
  source_store TEXT NOT NULL CHECK (source_store IN ('git', 'd1_record', 'r2_object', 'esign_envelope', 'stream', 'external_editor')),
  source_locator TEXT NOT NULL CHECK (length(source_locator) BETWEEN 1 AND 200),
  source_id TEXT NOT NULL CHECK (length(source_id) BETWEEN 1 AND 500),
  source_revision TEXT NOT NULL CHECK (length(source_revision) BETWEEN 1 AND 200),
  recipe TEXT CHECK (recipe IS NULL OR length(recipe) <= 2000),
  residency TEXT CHECK (residency IS NULL OR length(residency) <= 40),
  license TEXT CHECK (license IS NULL OR length(license) <= 200),
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('person', 'agent')),
  actor_user_id INTEGER NOT NULL,
  agent_run_id TEXT,
  charge_id TEXT,
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  created_at TEXT NOT NULL,
  expires_at TEXT,
  legal_hold INTEGER NOT NULL DEFAULT 0 CHECK (legal_hold IN (0, 1)),
  tombstoned_at TEXT,
  tombstoned_by_user_id INTEGER,
  tombstone_reason TEXT CHECK (tombstone_reason IS NULL OR length(tombstone_reason) <= 500),
  CHECK ((actor_kind = 'agent') = (agent_run_id IS NOT NULL)),
  CHECK ((tombstoned_at IS NULL) = (tombstoned_by_user_id IS NULL)),
  UNIQUE (asset_uid, seq),
  UNIQUE (tenant_id, company_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_work_graph_revisions_asset ON work_graph_revisions (asset_uid, seq);

-- A revision is immutable. Only the legal hold may toggle, and the tombstone may be set once, never under a hold.
CREATE TRIGGER IF NOT EXISTS work_graph_revisions_immutable
BEFORE UPDATE ON work_graph_revisions
WHEN NEW.revision_uid IS NOT OLD.revision_uid OR NEW.asset_uid IS NOT OLD.asset_uid
  OR NEW.tenant_id IS NOT OLD.tenant_id OR NEW.company_id IS NOT OLD.company_id OR NEW.project_id IS NOT OLD.project_id
  OR NEW.seq IS NOT OLD.seq OR NEW.parent_uids_json IS NOT OLD.parent_uids_json OR NEW.digest IS NOT OLD.digest
  OR NEW.byte_length IS NOT OLD.byte_length OR NEW.media_profile IS NOT OLD.media_profile
  OR NEW.source_store IS NOT OLD.source_store OR NEW.source_locator IS NOT OLD.source_locator
  OR NEW.source_id IS NOT OLD.source_id OR NEW.source_revision IS NOT OLD.source_revision
  OR NEW.recipe IS NOT OLD.recipe OR NEW.residency IS NOT OLD.residency OR NEW.license IS NOT OLD.license
  OR NEW.actor_kind IS NOT OLD.actor_kind OR NEW.actor_user_id IS NOT OLD.actor_user_id
  OR NEW.agent_run_id IS NOT OLD.agent_run_id OR NEW.charge_id IS NOT OLD.charge_id
  OR NEW.idempotency_key IS NOT OLD.idempotency_key OR NEW.request_hash IS NOT OLD.request_hash
  OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at
  OR OLD.tombstoned_at IS NOT NULL
  OR (NEW.tombstoned_at IS NOT NULL AND NEW.legal_hold = 1)
BEGIN
  SELECT RAISE(ABORT, 'work_graph_revisions is immutable; only legal_hold and a one-way tombstone change (D5581).');
END;

CREATE TRIGGER IF NOT EXISTS work_graph_revisions_no_delete
BEFORE DELETE ON work_graph_revisions
BEGIN
  SELECT RAISE(ABORT, 'work_graph_revisions is never deleted; tombstone it (D5581).');
END;

-- The head may only name a live revision of the same asset; scope and kind never change.
CREATE TRIGGER IF NOT EXISTS work_graph_assets_fixed
BEFORE UPDATE ON work_graph_assets
WHEN NEW.asset_uid IS NOT OLD.asset_uid OR NEW.tenant_id IS NOT OLD.tenant_id OR NEW.company_id IS NOT OLD.company_id
  OR NEW.project_id IS NOT OLD.project_id OR NEW.kind IS NOT OLD.kind
  OR NEW.idempotency_key IS NOT OLD.idempotency_key OR NEW.request_hash IS NOT OLD.request_hash
  OR (NEW.head_revision_uid IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM work_graph_revisions r
     WHERE r.revision_uid = NEW.head_revision_uid AND r.asset_uid = NEW.asset_uid AND r.tombstoned_at IS NULL))
BEGIN
  SELECT RAISE(ABORT, 'work_graph_assets: fixed scope and kind; the head names a live revision of the asset (D5581).');
END;

CREATE TRIGGER IF NOT EXISTS work_graph_assets_no_delete
BEFORE DELETE ON work_graph_assets
BEGIN
  SELECT RAISE(ABORT, 'work_graph_assets is never deleted (D5581).');
END;

CREATE TABLE IF NOT EXISTS work_graph_edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  company_id INTEGER NOT NULL,
  from_revision_uid TEXT NOT NULL REFERENCES work_graph_revisions(revision_uid),
  from_asset_uid TEXT NOT NULL REFERENCES work_graph_assets(asset_uid),
  edge_kind TEXT NOT NULL CHECK (edge_kind IN ('read', 'write', 'derived', 'component')),
  to_asset_uid TEXT NOT NULL REFERENCES work_graph_assets(asset_uid),
  to_revision_uid TEXT NOT NULL REFERENCES work_graph_revisions(revision_uid),
  created_at TEXT NOT NULL,
  CHECK (to_asset_uid <> from_asset_uid),
  UNIQUE (from_revision_uid, edge_kind, to_revision_uid)
);
CREATE INDEX IF NOT EXISTS idx_work_graph_edges_to ON work_graph_edges (to_revision_uid);
CREATE INDEX IF NOT EXISTS idx_work_graph_edges_to_asset ON work_graph_edges (to_asset_uid);

CREATE TRIGGER IF NOT EXISTS work_graph_edges_append_only
BEFORE UPDATE ON work_graph_edges
BEGIN
  SELECT RAISE(ABORT, 'work_graph_edges is append-only (D5581).');
END;

CREATE TRIGGER IF NOT EXISTS work_graph_edges_no_delete
BEFORE DELETE ON work_graph_edges
BEGIN
  SELECT RAISE(ABORT, 'work_graph_edges is append-only (D5581).');
END;

CREATE TABLE IF NOT EXISTS work_graph_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  company_id INTEGER NOT NULL,
  project_id INTEGER,
  asset_uid TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('register_asset', 'create_revision', 'advance_head', 'advance_refused',
    'tombstone', 'legal_hold_set', 'legal_hold_released')),
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('person', 'agent')),
  actor_user_id INTEGER NOT NULL,
  agent_run_id TEXT,
  charge_id TEXT,
  base_revision_uid TEXT,
  revision_uid TEXT,
  head_seq INTEGER,
  approval_ref TEXT CHECK (approval_ref IS NULL OR length(approval_ref) <= 200),
  approval_digest TEXT CHECK (approval_digest IS NULL OR length(approval_digest) = 64),
  approver_user_id INTEGER,
  outcome TEXT NOT NULL CHECK (outcome IN ('applied', 'refused')),
  refusal_code TEXT CHECK (refusal_code IS NULL OR length(refusal_code) <= 60),
  idempotency_key TEXT CHECK (idempotency_key IS NULL OR length(idempotency_key) BETWEEN 1 AND 200),
  request_hash TEXT CHECK (request_hash IS NULL OR length(request_hash) = 64),
  detail_json TEXT CHECK (detail_json IS NULL OR (json_valid(detail_json) AND length(detail_json) <= 4000)),
  created_at TEXT NOT NULL,
  CHECK ((outcome = 'refused') = (refusal_code IS NOT NULL)),
  CHECK ((actor_kind = 'agent') = (agent_run_id IS NOT NULL)),
  UNIQUE (tenant_id, company_id, action, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_work_graph_events_asset ON work_graph_events (asset_uid, id);
CREATE INDEX IF NOT EXISTS idx_work_graph_events_revision ON work_graph_events (revision_uid, action);

CREATE TRIGGER IF NOT EXISTS work_graph_events_append_only
BEFORE UPDATE ON work_graph_events
BEGIN
  SELECT RAISE(ABORT, 'work_graph_events is append-only (D5581).');
END;

CREATE TRIGGER IF NOT EXISTS work_graph_events_no_delete
BEFORE DELETE ON work_graph_events
BEGIN
  SELECT RAISE(ABORT, 'work_graph_events is append-only (D5581).');
END;
