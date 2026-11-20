-- 202611190940 — D5585 part 2 (#5585, WorkGraph P1 under #5577): takedowns of published releases, with retention, and
-- the delivery evidence of the queued `release_*` outbox effects. Named by its UTC minute and its issue (D4106, D5398).
-- Decision: documentation/architecture/decisions/D5585-p2.md.
--
--   work_graph_release_takedowns    a person's takedown of a release (one manifest) or of one component revision at its
--                                   digest wherever it is pinned, with a reason code, the evidence it rests on and the
--                                   authority acted under. Refused takedowns are recorded too (outcome `refused`). A
--                                   takedown is permanent: content it covers is never served, published or re-pinned
--                                   again. Nothing it covers is deleted: manifests, decisions, attestations, revisions
--                                   and the audit stay (retention), so the historical evidence survives the takedown.
--   work_graph_release_deliveries   one row per delivered `release_*` effect: what the provider confirmed, what was
--                                   withheld (taken down, superseded by a newer publication, a stale digest, another
--                                   tenant) and what was retracted, with whether the outcome was found by reconciliation
--                                   (the provider already held the delivery under its idempotency key) or sent now.
--
-- EXTENDS #5581's AND PART 1's TABLES, NOT A SECOND LEDGER. The effects stay rows of `work_graph_effects`, delivered by
-- `deliverEffect` (D5581 part 3); this table is only what their handlers found. Ids, codes and digests only: no column
-- holds content, a preview or model text. Additive only: dropping both tables loses the takedown and delivery records;
-- nothing else reads them.

CREATE TABLE IF NOT EXISTS work_graph_release_takedowns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  company_id INTEGER NOT NULL,
  project_id INTEGER,
  line_asset_uid TEXT NOT NULL REFERENCES work_graph_release_lines(line_asset_uid),
  manifest_uid TEXT NOT NULL REFERENCES work_graph_release_manifests(manifest_uid),
  manifest_digest TEXT NOT NULL CHECK (length(manifest_digest) = 64 AND manifest_digest NOT GLOB '*[^0-9a-f]*'),
  scope TEXT NOT NULL CHECK (scope IN ('manifest', 'component')),
  revision_uid TEXT CHECK (revision_uid IS NULL OR length(revision_uid) BETWEEN 1 AND 80),
  digest TEXT CHECK (digest IS NULL OR (length(digest) = 64 AND digest NOT GLOB '*[^0-9a-f]*')),
  reason_code TEXT NOT NULL CHECK (reason_code IN ('rights_withdrawn', 'consent_withdrawn', 'legal_order', 'security',
    'inaccurate', 'policy')),
  evidence_ref TEXT NOT NULL CHECK (length(evidence_ref) BETWEEN 1 AND 200),
  authority TEXT CHECK (authority IS NULL OR length(authority) BETWEEN 1 AND 40),
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('person', 'agent')),
  actor_user_id INTEGER NOT NULL,
  agent_run_id TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('applied', 'refused')),
  refusal_code TEXT CHECK (refusal_code IS NULL OR length(refusal_code) <= 60),
  idempotency_key TEXT CHECK (idempotency_key IS NULL OR length(idempotency_key) BETWEEN 1 AND 200),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  retract_count INTEGER NOT NULL DEFAULT 0 CHECK (retract_count >= 0),
  d1_statements INTEGER NOT NULL DEFAULT 0 CHECK (d1_statements >= 0),
  created_at TEXT NOT NULL,
  CHECK ((scope = 'component') = (revision_uid IS NOT NULL AND digest IS NOT NULL)),
  CHECK ((outcome = 'refused') = (refusal_code IS NOT NULL)),
  CHECK ((outcome = 'applied') = (idempotency_key IS NOT NULL)),
  CHECK ((actor_kind = 'agent') = (agent_run_id IS NOT NULL)),
  UNIQUE (tenant_id, company_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_work_graph_release_takedowns_manifest ON work_graph_release_takedowns (manifest_uid, outcome);
CREATE INDEX IF NOT EXISTS idx_work_graph_release_takedowns_revision ON work_graph_release_takedowns (revision_uid, outcome);

CREATE TRIGGER IF NOT EXISTS work_graph_release_takedowns_append_only
BEFORE UPDATE ON work_graph_release_takedowns
BEGIN
  SELECT RAISE(ABORT, 'work_graph_release_takedowns is append-only; a takedown is permanent (D5585 part 2).');
END;

CREATE TRIGGER IF NOT EXISTS work_graph_release_takedowns_no_delete
BEFORE DELETE ON work_graph_release_takedowns
BEGIN
  SELECT RAISE(ABORT, 'work_graph_release_takedowns is append-only (D5585 part 2).');
END;

CREATE TABLE IF NOT EXISTS work_graph_release_deliveries (
  effect_id INTEGER PRIMARY KEY REFERENCES work_graph_effects(id),
  tenant_id INTEGER NOT NULL,
  company_id INTEGER NOT NULL,
  line_asset_uid TEXT NOT NULL CHECK (length(line_asset_uid) BETWEEN 1 AND 80),
  manifest_uid TEXT NOT NULL CHECK (length(manifest_uid) BETWEEN 1 AND 80),
  manifest_digest TEXT NOT NULL CHECK (length(manifest_digest) = 64),
  op TEXT NOT NULL CHECK (op IN ('publish', 'retract')),
  target TEXT NOT NULL CHECK (target IN ('github_pr', 'stream', 'signed_document', 'website_cdn', 'external_distribution')),
  target_ref TEXT NOT NULL CHECK (length(target_ref) BETWEEN 1 AND 120),
  outcome TEXT NOT NULL CHECK (outcome IN ('confirmed', 'withheld', 'superseded', 'retracted', 'nothing_to_retract')),
  reason_code TEXT CHECK (reason_code IS NULL OR length(reason_code) <= 60),
  external_ref TEXT CHECK (external_ref IS NULL OR length(external_ref) BETWEEN 1 AND 200),
  reconciled INTEGER NOT NULL DEFAULT 0 CHECK (reconciled IN (0, 1)),
  attempt INTEGER NOT NULL CHECK (attempt >= 1),
  d1_statements INTEGER NOT NULL DEFAULT 0 CHECK (d1_statements >= 0),
  provider_calls INTEGER NOT NULL DEFAULT 0 CHECK (provider_calls >= 0),
  created_at TEXT NOT NULL,
  CHECK ((outcome IN ('withheld', 'superseded')) = (reason_code IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_work_graph_release_deliveries_manifest ON work_graph_release_deliveries (tenant_id, company_id, manifest_uid, op, outcome);

CREATE TRIGGER IF NOT EXISTS work_graph_release_deliveries_append_only
BEFORE UPDATE ON work_graph_release_deliveries
BEGIN
  SELECT RAISE(ABORT, 'work_graph_release_deliveries is append-only (D5585 part 2).');
END;

CREATE TRIGGER IF NOT EXISTS work_graph_release_deliveries_no_delete
BEFORE DELETE ON work_graph_release_deliveries
BEGIN
  SELECT RAISE(ABORT, 'work_graph_release_deliveries is append-only (D5585 part 2).');
END;
