-- D5456 (#5456, ADP-02 of #5453): the operation ledger for private deal
-- preparation saves.
--
-- One new table, additive and re-runnable; nothing is backfilled and no
-- existing row changes. It records each create or save that committed, keyed
-- by the caller's operation key, so a retry after a lost response returns the
-- original outcome instead of writing a second preparation or revision:
--
--   scope_code + actor_user_id + action + target_uid + op_key   is the key
--                    (the deployment, the admin, 'create' or 'save', the
--                    preparation uid for a save or '' for a create, and the
--                    key the client sent). The same key with the same payload
--                    returns the stored outcome; the same key with another
--                    payload is refused (payload_sha256 differs).
--   preparation_id, revision_id, lock_version   the outcome the operation
--                    produced, enough to answer a retry after a timeout.
--
-- The row is written in the same D1 batch as the revision, the pointer move
-- and the admin_audit_log row (documentation/architecture/decisions/D5456.md),
-- so either all of them land or none does. Creation and editing stay disabled
-- in code (services/dealPreparation.ts PREPARATION_MUTATIONS_ENABLED); until
-- they are enabled no row is written here.
--
-- No transaction statements, no PRAGMA (scripts/check-sql-migrations.mjs).

CREATE TABLE IF NOT EXISTS deal_preparation_operations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope_code TEXT NOT NULL CHECK (length(scope_code) BETWEEN 2 AND 16),
  actor_user_id INTEGER NOT NULL REFERENCES users(id),
  action TEXT NOT NULL CHECK (action IN ('create', 'save')),
  target_uid TEXT NOT NULL CHECK (length(target_uid) <= 64),
  op_key TEXT NOT NULL CHECK (length(op_key) BETWEEN 8 AND 128),
  payload_sha256 TEXT NOT NULL CHECK (length(payload_sha256) = 64),
  preparation_id INTEGER NOT NULL REFERENCES deal_preparations(id),
  revision_id INTEGER NOT NULL REFERENCES deal_preparation_revisions(id),
  lock_version INTEGER NOT NULL CHECK (lock_version >= 1),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (scope_code, actor_user_id, action, target_uid, op_key)
);

CREATE INDEX IF NOT EXISTS idx_deal_preparation_operations_prep
  ON deal_preparation_operations(preparation_id, id DESC);

-- An outcome is written once. A retry reads it; nothing rewrites it.
CREATE TRIGGER IF NOT EXISTS deal_preparation_operations_no_update
BEFORE UPDATE ON deal_preparation_operations
BEGIN
  SELECT RAISE(ABORT, 'deal_preparation_operations are append-only');
END;

CREATE TRIGGER IF NOT EXISTS deal_preparation_operations_no_delete
BEFORE DELETE ON deal_preparation_operations
BEGIN
  SELECT RAISE(ABORT, 'deal_preparation_operations are append-only');
END;
