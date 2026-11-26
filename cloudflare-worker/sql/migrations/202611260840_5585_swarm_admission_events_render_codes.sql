-- D5585 part 15 (#5585): swarm_admission_events learns the render approval codes.
--
-- #5585 part 15 adds three refusal codes to #5586's swarm admission (`render_approval_unverified`,
-- `render_unapproved`, `render_over_approved`; D5585-p15). `swarm_admission_events` (D5586-p2) lists the codes it
-- accepts in a CHECK, and SQLite cannot widen a CHECK in place, so this migration rebuilds the table with the wider
-- list:
--   1. create it under a new name;
--   2. copy every row;
--   3. drop the old table;
--   4. rename the new one;
--   5. recreate the index and the two append-only triggers.
-- Every other column, CHECK and the key are as D5586-p2 wrote them.
--
-- The owner approved the rebuild on 2026-11-26. Nothing writes the table yet (no caller mounts the coordinator's
-- audit copy), so it holds no rows in production. The copy in step 2 keeps whatever a preview database holds. Rollback
-- reverts the Worker: the wider CHECK accepts every row the narrower one did.
--
-- forward-fix: cloudflare-worker/sql/forward-fixes/202611260840_5585_swarm_admission_events_render_codes.fix.sql

CREATE TABLE IF NOT EXISTS swarm_admission_events_next (
  tenant_id INTEGER NOT NULL CHECK (tenant_id >= 0),
  company_id INTEGER NOT NULL CHECK (company_id >= 0),
  seq INTEGER NOT NULL CHECK (seq >= 1),
  at INTEGER NOT NULL CHECK (at >= 0),
  ticket_uid TEXT CHECK (ticket_uid IS NULL OR length(ticket_uid) BETWEEN 1 AND 160),
  action TEXT NOT NULL CHECK (action IN ('request', 'promote', 'settle', 'withdraw', 'revoke', 'audit_gap')),
  outcome TEXT NOT NULL CHECK (outcome IN ('applied', 'queued', 'refused', 'dropped')),
  code TEXT CHECK (code IS NULL OR code IN ('swarm_halted', 'wrong_tenant', 'agent_revoked', 'agent_unverified',
    'modality_not_allowed', 'provider_not_allowed', 'model_not_allowed', 'revision_unverified', 'stale_revision',
    'render_approval_unverified', 'render_unapproved', 'render_over_approved',
    'budget_unverified', 'budget_exhausted', 'storage_unverified', 'storage_quota_exhausted', 'no_capacity',
    'venture_capacity', 'modality_capacity', 'publication_in_flight', 'audit_dropped')),
  charged_microusd INTEGER CHECK (charged_microusd IS NULL OR charged_microusd >= 0),
  measured INTEGER CHECK (measured IS NULL OR measured IN (0, 1)),
  gap_to_seq INTEGER,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- A gap row and only a gap row: no venture, no ticket, a dropped range and the code `audit_dropped`.
  CHECK ((action = 'audit_gap') = (outcome = 'dropped')),
  CHECK ((action = 'audit_gap') = (tenant_id = 0 AND company_id = 0)),
  CHECK ((action = 'audit_gap') = (ticket_uid IS NULL)),
  CHECK ((action = 'audit_gap') = (gap_to_seq IS NOT NULL)),
  CHECK (gap_to_seq IS NULL OR gap_to_seq >= seq),
  CHECK (action <> 'audit_gap' OR code = 'audit_dropped'),
  CHECK (action = 'audit_gap' OR (tenant_id > 0 AND company_id > 0)),
  -- A refusal names its code; a settlement, and only a settlement, carries its bill.
  CHECK (outcome <> 'refused' OR code IS NOT NULL),
  CHECK ((action = 'settle') = (charged_microusd IS NOT NULL)),
  CHECK ((charged_microusd IS NULL) = (measured IS NULL)),
  PRIMARY KEY (tenant_id, company_id, seq)
);

INSERT INTO swarm_admission_events_next (tenant_id, company_id, seq, at, ticket_uid, action, outcome, code,
  charged_microusd, measured, gap_to_seq, recorded_at)
SELECT tenant_id, company_id, seq, at, ticket_uid, action, outcome, code, charged_microusd, measured, gap_to_seq, recorded_at
  FROM swarm_admission_events;

DROP TABLE swarm_admission_events;

ALTER TABLE swarm_admission_events_next RENAME TO swarm_admission_events;

CREATE INDEX IF NOT EXISTS idx_swarm_admission_events_ticket ON swarm_admission_events (tenant_id, company_id, ticket_uid);

CREATE TRIGGER IF NOT EXISTS swarm_admission_events_append_only
BEFORE UPDATE ON swarm_admission_events
BEGIN
  SELECT RAISE(ABORT, 'swarm_admission_events is append-only (D5586 part 2).');
END;

CREATE TRIGGER IF NOT EXISTS swarm_admission_events_no_delete
BEFORE DELETE ON swarm_admission_events
BEGIN
  SELECT RAISE(ABORT, 'swarm_admission_events is append-only (D5586 part 2).');
END;
