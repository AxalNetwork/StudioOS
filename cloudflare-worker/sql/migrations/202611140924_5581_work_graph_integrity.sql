-- 202611140924 — D5581 part 3 (#5581, WorkGraph P0 under #5577): bytes, integrity, reconciliation and the bounded
-- effect outbox. Named by its UTC minute and its issue (D4106, D5398). Additive: five new tables and their triggers;
-- no existing table is altered, and nothing is backfilled.
--
--   work_graph_blobs             one content-addressed blob per (tenant, company, digest) that WorkGraph wrote to R2
--                                `FILES` under `wg/v1/t<tenant>/c<company>/sha256/<digest>`. Its byte length counts
--                                toward the tenant's byte limit while `deleted_at` is null. Only `deleted_at` changes:
--                                set when reconcile deletes the bytes, cleared when the same bytes are put again.
--   work_graph_revision_flags    a revision's integrity state: `bytes_missing` (a half-uploaded or lost object),
--                                `bytes_deleted` (the deletion tombstone of a retained-out revision), `offline` (metadata
--                                only) and `residency_mismatch`. The head swap refuses a revision with any live flag.
--                                Only `set_at` / `cleared_at` change; a flag is never deleted.
--   work_graph_holds             a legal hold over a whole company, or one asset of it, that blocks every byte deletion in
--                                its scope (orphans and retained-out tombstones). Only the release (once) may change.
--   work_graph_integrity_events  the audit trail of bytes: puts, reuses, refusals, reconcile findings, deletions, holds,
--                                tenant-limit refusals and effects, with the R2 and D1 cost of the call. Ids and digests
--                                only, never content. Append-only.
--   work_graph_effects           the bounded effect outbox: one row per effect, unique per (tenant, company, idempotency
--                                key), with attempts, backoff, a claim token and a dead-letter state. An effect is
--                                applied at most once by its key, whatever the delivery count.
--
-- NO BYTES, NO PREVIEWS. No column holds content or a preview. No transaction statements (D1 rejects them).

CREATE TABLE IF NOT EXISTS work_graph_blobs (
  tenant_id INTEGER NOT NULL CHECK (tenant_id > 0),
  company_id INTEGER NOT NULL CHECK (company_id > 0),
  digest TEXT NOT NULL CHECK (length(digest) = 64 AND digest NOT GLOB '*[^0-9a-f]*'),
  byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
  residency TEXT CHECK (residency IS NULL OR length(residency) <= 40),
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (tenant_id, company_id, digest)
);

CREATE TRIGGER IF NOT EXISTS work_graph_blobs_fixed
BEFORE UPDATE ON work_graph_blobs
WHEN NEW.tenant_id IS NOT OLD.tenant_id OR NEW.company_id IS NOT OLD.company_id OR NEW.digest IS NOT OLD.digest
  OR NEW.byte_length IS NOT OLD.byte_length OR NEW.residency IS NOT OLD.residency OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'work_graph_blobs: only deleted_at changes (D5581 part 3).');
END;

CREATE TRIGGER IF NOT EXISTS work_graph_blobs_no_delete
BEFORE DELETE ON work_graph_blobs
BEGIN
  SELECT RAISE(ABORT, 'work_graph_blobs is never deleted; set deleted_at (D5581 part 3).');
END;

CREATE TABLE IF NOT EXISTS work_graph_revision_flags (
  revision_uid TEXT NOT NULL REFERENCES work_graph_revisions(revision_uid),
  flag TEXT NOT NULL CHECK (flag IN ('bytes_missing', 'bytes_deleted', 'offline', 'residency_mismatch')),
  tenant_id INTEGER NOT NULL,
  company_id INTEGER NOT NULL,
  asset_uid TEXT NOT NULL,
  set_at TEXT NOT NULL,
  cleared_at TEXT,
  PRIMARY KEY (revision_uid, flag)
);
CREATE INDEX IF NOT EXISTS idx_work_graph_revision_flags_scope ON work_graph_revision_flags (tenant_id, company_id, flag);

-- A deletion tombstone is permanent: once bytes are deleted they never come back under the same revision.
CREATE TRIGGER IF NOT EXISTS work_graph_revision_flags_fixed
BEFORE UPDATE ON work_graph_revision_flags
WHEN NEW.revision_uid IS NOT OLD.revision_uid OR NEW.flag IS NOT OLD.flag OR NEW.tenant_id IS NOT OLD.tenant_id
  OR NEW.company_id IS NOT OLD.company_id OR NEW.asset_uid IS NOT OLD.asset_uid
  OR (OLD.flag = 'bytes_deleted' AND NEW.cleared_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'work_graph_revision_flags: only set_at and cleared_at change; bytes_deleted is permanent (D5581 part 3).');
END;

CREATE TRIGGER IF NOT EXISTS work_graph_revision_flags_no_delete
BEFORE DELETE ON work_graph_revision_flags
BEGIN
  SELECT RAISE(ABORT, 'work_graph_revision_flags is never deleted; clear it (D5581 part 3).');
END;

CREATE TABLE IF NOT EXISTS work_graph_holds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL CHECK (tenant_id > 0),
  company_id INTEGER NOT NULL CHECK (company_id > 0),
  asset_uid TEXT CHECK (asset_uid IS NULL OR length(asset_uid) BETWEEN 1 AND 80),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
  placed_by_user_id INTEGER NOT NULL,
  placed_at TEXT NOT NULL,
  released_by_user_id INTEGER,
  released_at TEXT,
  CHECK ((released_at IS NULL) = (released_by_user_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_work_graph_holds_scope ON work_graph_holds (tenant_id, company_id, asset_uid);

CREATE TRIGGER IF NOT EXISTS work_graph_holds_fixed
BEFORE UPDATE ON work_graph_holds
WHEN NEW.tenant_id IS NOT OLD.tenant_id OR NEW.company_id IS NOT OLD.company_id OR NEW.asset_uid IS NOT OLD.asset_uid
  OR NEW.reason IS NOT OLD.reason OR NEW.placed_by_user_id IS NOT OLD.placed_by_user_id OR NEW.placed_at IS NOT OLD.placed_at
  OR OLD.released_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'work_graph_holds: only the release changes, once (D5581 part 3).');
END;

CREATE TRIGGER IF NOT EXISTS work_graph_holds_no_delete
BEFORE DELETE ON work_graph_holds
BEGIN
  SELECT RAISE(ABORT, 'work_graph_holds is never deleted; release it (D5581 part 3).');
END;

CREATE TABLE IF NOT EXISTS work_graph_integrity_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  company_id INTEGER NOT NULL,
  asset_uid TEXT,
  revision_uid TEXT,
  digest TEXT CHECK (digest IS NULL OR length(digest) = 64),
  effect_id INTEGER,
  action TEXT NOT NULL CHECK (action IN ('blob_put', 'blob_reused', 'blob_refused', 'bytes_read', 'read_refused',
    'bytes_missing', 'bytes_restored', 'orphan_listed', 'blob_deleted', 'deletion_blocked', 'residency_flagged',
    'lease_expiry_observed', 'offline_set', 'offline_cleared', 'hold_placed', 'hold_released', 'limit_refused',
    'effect_enqueued', 'effect_refused', 'effect_applied', 'effect_retry', 'effect_dead')),
  outcome TEXT NOT NULL CHECK (outcome IN ('applied', 'refused', 'flagged')),
  refusal_code TEXT CHECK (refusal_code IS NULL OR length(refusal_code) <= 60),
  actor_kind TEXT CHECK (actor_kind IS NULL OR actor_kind IN ('person', 'agent', 'system')),
  actor_user_id INTEGER,
  agent_run_id TEXT,
  detail_json TEXT CHECK (detail_json IS NULL OR (json_valid(detail_json) AND length(detail_json) <= 4000)),
  d1_statements INTEGER NOT NULL DEFAULT 0 CHECK (d1_statements >= 0),
  r2_class_a INTEGER NOT NULL DEFAULT 0 CHECK (r2_class_a >= 0),
  r2_class_b INTEGER NOT NULL DEFAULT 0 CHECK (r2_class_b >= 0),
  created_at TEXT NOT NULL,
  CHECK ((outcome = 'refused') = (refusal_code IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_work_graph_integrity_events_scope ON work_graph_integrity_events (tenant_id, company_id, id);

CREATE TRIGGER IF NOT EXISTS work_graph_integrity_events_append_only
BEFORE UPDATE ON work_graph_integrity_events
BEGIN
  SELECT RAISE(ABORT, 'work_graph_integrity_events is append-only (D5581 part 3).');
END;

CREATE TRIGGER IF NOT EXISTS work_graph_integrity_events_no_delete
BEFORE DELETE ON work_graph_integrity_events
BEGIN
  SELECT RAISE(ABORT, 'work_graph_integrity_events is append-only (D5581 part 3).');
END;

CREATE TABLE IF NOT EXISTS work_graph_effects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL CHECK (tenant_id > 0),
  company_id INTEGER NOT NULL CHECK (company_id > 0),
  asset_uid TEXT CHECK (asset_uid IS NULL OR length(asset_uid) BETWEEN 1 AND 80),
  effect_kind TEXT NOT NULL CHECK (length(effect_kind) BETWEEN 1 AND 40 AND effect_kind NOT GLOB '*[^a-z_]*'),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json) AND length(payload_json) <= 2000),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'claimed', 'applied', 'dead')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL CHECK (max_attempts BETWEEN 1 AND 20),
  next_attempt_ms INTEGER NOT NULL,
  claim_token TEXT,
  claimed_until_ms INTEGER,
  last_error_code TEXT CHECK (last_error_code IS NULL OR length(last_error_code) <= 60),
  created_at TEXT NOT NULL,
  applied_at TEXT,
  CHECK ((state = 'claimed') = (claim_token IS NOT NULL)),
  CHECK ((state = 'applied') = (applied_at IS NOT NULL)),
  UNIQUE (tenant_id, company_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_work_graph_effects_due ON work_graph_effects (state, next_attempt_ms);
CREATE INDEX IF NOT EXISTS idx_work_graph_effects_tenant ON work_graph_effects (tenant_id, state);

-- Applied and dead are terminal: a second delivery can never re-open an effect. Identity never changes.
CREATE TRIGGER IF NOT EXISTS work_graph_effects_terminal
BEFORE UPDATE ON work_graph_effects
WHEN OLD.state IN ('applied', 'dead')
  OR NEW.tenant_id IS NOT OLD.tenant_id OR NEW.company_id IS NOT OLD.company_id OR NEW.asset_uid IS NOT OLD.asset_uid
  OR NEW.effect_kind IS NOT OLD.effect_kind OR NEW.idempotency_key IS NOT OLD.idempotency_key
  OR NEW.request_hash IS NOT OLD.request_hash OR NEW.payload_json IS NOT OLD.payload_json
  OR NEW.attempts < OLD.attempts
BEGIN
  SELECT RAISE(ABORT, 'work_graph_effects: applied and dead are terminal; identity is fixed (D5581 part 3).');
END;

CREATE TRIGGER IF NOT EXISTS work_graph_effects_no_delete
BEFORE DELETE ON work_graph_effects
BEGIN
  SELECT RAISE(ABORT, 'work_graph_effects is never deleted (D5581 part 3).');
END;
