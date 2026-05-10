-- Task #5 (Z) — Cross-link due-diligence findings back to the envelope
-- they relate to so Admin > Contracts can render an "Open in DD"
-- deep-link button on the contract detail modal AND so the void
-- handler can mirror its action into dd_audit_log when the contract
-- has open findings.
--
-- Nullable + indexed; legacy findings keep working because the column
-- defaults to NULL.
ALTER TABLE dd_findings ADD COLUMN esign_envelope_uuid TEXT;
CREATE INDEX IF NOT EXISTS idx_dd_findings_envelope ON dd_findings(esign_envelope_uuid);
