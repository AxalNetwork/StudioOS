-- D5581 part 2 (#5581) — the audit trail of WorkGraph leases.
--
-- One row per lease outcome the service (`services/workGraphLeases.ts`) saw:
-- an acquire, a renew, a release, a lease that expired, a busy answer, a
-- fence check, and every refusal (flag off, wrong tenant, not the holder, a
-- stale fence, no capability). The lease itself lives in the asset's
-- `WorkGraphLease` Durable Object; this table only records what happened.
--
-- IDS ONLY. A holder is a user id or an agent run id, never a name or an
-- email; a unit is its kind and id. No content of the asset is kept.
--
-- COST. `do_calls`, `storage_reads` and `storage_writes` are what the call
-- that wrote the row cost (one Durable Object call, its storage reads and
-- writes), so the spend of leases can be read from here.
--
-- APPEND-ONLY: the two triggers refuse every UPDATE and DELETE. Additive: one
-- new table, its indexes and triggers; no existing table is touched, and
-- nothing depends on part 1's `work_graph_*` tables.
--
-- No transaction statements: D1 rejects them (scripts/check-sql-migrations.mjs).

CREATE TABLE IF NOT EXISTS work_graph_lease_events (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id        INTEGER NOT NULL CHECK (tenant_id > 0),
  company_id       INTEGER NOT NULL CHECK (company_id > 0),
  project_id       INTEGER CHECK (project_id IS NULL OR project_id > 0),
  asset_id         TEXT NOT NULL CHECK (length(asset_id) BETWEEN 1 AND 80),
  unit_kind        TEXT CHECK (unit_kind IS NULL OR unit_kind IN ('whole', 'section', 'segment')),
  unit_id          TEXT CHECK (unit_id IS NULL OR length(unit_id) BETWEEN 1 AND 80),
  unit_section_id  TEXT CHECK (unit_section_id IS NULL OR length(unit_section_id) BETWEEN 1 AND 80),
  action           TEXT NOT NULL CHECK (action IN ('acquire', 'renew', 'release', 'expire', 'busy', 'check', 'refuse')),
  fence            INTEGER CHECK (fence IS NULL OR fence > 0),
  actor_kind       TEXT CHECK (actor_kind IS NULL OR actor_kind IN ('person', 'agent')),
  actor_user_id    INTEGER,
  agent_run_id     TEXT,
  expires_at_ms    INTEGER,
  refusal_code     TEXT CHECK (refusal_code IS NULL OR length(refusal_code) BETWEEN 1 AND 40),
  do_calls         INTEGER NOT NULL DEFAULT 0 CHECK (do_calls >= 0),
  storage_reads    INTEGER NOT NULL DEFAULT 0 CHECK (storage_reads >= 0),
  storage_writes   INTEGER NOT NULL DEFAULT 0 CHECK (storage_writes >= 0),
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (actor_kind IS NULL
    OR (actor_kind = 'person' AND actor_user_id IS NOT NULL AND agent_run_id IS NULL)
    OR (actor_kind = 'agent' AND agent_run_id IS NOT NULL AND actor_user_id IS NULL)),
  CHECK ((action = 'refuse' OR action = 'busy') = (refusal_code IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_work_graph_lease_events_asset
  ON work_graph_lease_events(tenant_id, company_id, asset_id, id);

CREATE TRIGGER IF NOT EXISTS trg_work_graph_lease_events_no_update
BEFORE UPDATE ON work_graph_lease_events
BEGIN
  SELECT RAISE(ABORT, 'work_graph_lease_events is append-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_work_graph_lease_events_no_delete
BEFORE DELETE ON work_graph_lease_events
BEGIN
  SELECT RAISE(ABORT, 'work_graph_lease_events is append-only');
END;
