-- 202611252031 — D5586 part 2 (#5586, WorkGraph under #5577): the swarm admission audit in D1, the owner's answer A1 of
-- 2026-11-25 to D5586 §6. Named by its UTC minute and its issue (D4106, D5398).
-- Decision: documentation/architecture/decisions/D5586-p2.md.
--
--   swarm_admission_events   one row per audit entry of #5586's swarm admission (`SwarmAudit`): a request, promotion,
--                            settlement, withdrawal or revocation of one ticket in one tenant and company, refusals
--                            included, copied from the coordinator's Durable Object state after the transaction that
--                            wrote it. Plus one `audit_gap` row per run of entries the state dropped before they were
--                            copied, so a missing range is recorded, never silent.
--
-- APPEND-ONLY, LIKE `work_graph_release_authority_events`. The key is the entry's own sequence number (`seq`, the
-- coordinator's `audit_seq`) under its tenant and company, so a copy that is replayed after a crash or a D1 failure lands
-- once (`ON CONFLICT DO NOTHING`), and the writer compares a conflicting row with the entry before it moves its
-- watermark. UPDATE and DELETE are refused by triggers.
--
-- A gap row belongs to no venture: tenant and company 0, no ticket, `seq` the first dropped number and `gap_to_seq`
-- the last. Every other row has a positive tenant, company and a ticket. The action, outcome and code lists are
-- `swarmAdmission.ts`'s vocabulary (`SWARM_AUDIT_ACTIONS`, `SWARM_AUDIT_OUTCOMES`, `SWARM_AUDIT_CODES` in
-- `swarmAudit.ts`); the CHECKs refuse any other, and a test pins them together. Ids and codes only. Additive only:
-- nothing else reads the table, and dropping it loses only the copy (the in-state audit is unchanged).

CREATE TABLE IF NOT EXISTS swarm_admission_events (
  tenant_id INTEGER NOT NULL CHECK (tenant_id >= 0),
  company_id INTEGER NOT NULL CHECK (company_id >= 0),
  seq INTEGER NOT NULL CHECK (seq >= 1),
  at INTEGER NOT NULL CHECK (at >= 0),
  ticket_uid TEXT CHECK (ticket_uid IS NULL OR length(ticket_uid) BETWEEN 1 AND 160),
  action TEXT NOT NULL CHECK (action IN ('request', 'promote', 'settle', 'withdraw', 'revoke', 'audit_gap')),
  outcome TEXT NOT NULL CHECK (outcome IN ('applied', 'queued', 'refused', 'dropped')),
  code TEXT CHECK (code IS NULL OR code IN ('swarm_halted', 'wrong_tenant', 'agent_revoked', 'agent_unverified',
    'modality_not_allowed', 'provider_not_allowed', 'model_not_allowed', 'revision_unverified', 'stale_revision',
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
