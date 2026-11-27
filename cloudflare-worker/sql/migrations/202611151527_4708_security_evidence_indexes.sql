-- 202611151527 — #4708 part 2 (D4708-p2): the indexes HQ Security's evidence
-- reads call for, and no others.
--
-- The ledger (`/api/admin/security/governance`, services/adminSecurity/
-- governanceFeed.ts) reads each of its five stores newest first, ordered on
-- the EXPRESSION `datetime(col) DESC, id DESC` (D124: one column can hold both
-- `YYYY-MM-DD HH:MM:SS` and ISO 8601, so a timestamp is never ordered bare),
-- and keeps the newest page. A plain index on the column cannot answer that
-- order, so before this file every store was read whole and sorted for one
-- page. An index on the same expression is read backwards and stops at the
-- page (the rowid, which is `id`, breaks ties inside the index).
--
-- The Data access zone and the Overview read two lists ordered on the bare
-- column (`exported_at`, `started_at`); those get a plain index for the same
-- reason.
--
-- Measured on the large fixture (`cloudflare-worker/test/_security_scale_fixture.ts`;
-- plans and local timings in documentation/architecture/decisions/D4708-p2.md):
--
--   admin_audit_log (datetime(exported_at))     the audit and export arms
--   admin_audit_log (exported_at)               Data access: the newest exports
--   licence_events (datetime(created_at))       the licence arms
--   security_events (datetime(occurred_at))     the sign-in and step-up arm
--   impersonation_sessions (datetime(started_at))  the filtered support-session arm
--   impersonation_sessions (started_at)         the newest support sessions
--
-- NOT HERE: activity_logs. Its arm filters on an action list first, and the
-- plan already reads only those actions through idx_activity_action_created;
-- an index on the time expression went unused in the plan and would only add
-- write cost to the busiest log table.
--
-- The Overview's security_events counts (services/securityEvents.ts) now name
-- the window they count in, so the same time index serves them rather than a
-- read of the whole ledger.
--
-- Additive and idempotent: CREATE INDEX IF NOT EXISTS, no data change. Every
-- table here is in the schema baseline.

CREATE INDEX IF NOT EXISTS idx_admin_audit_feed_at
  ON admin_audit_log (datetime(exported_at));

CREATE INDEX IF NOT EXISTS idx_admin_audit_exported
  ON admin_audit_log (exported_at);

CREATE INDEX IF NOT EXISTS idx_licence_events_feed_at
  ON licence_events (datetime(created_at));

CREATE INDEX IF NOT EXISTS idx_security_events_feed_at
  ON security_events (datetime(occurred_at));

CREATE INDEX IF NOT EXISTS idx_impersonation_feed_at
  ON impersonation_sessions (datetime(started_at));

CREATE INDEX IF NOT EXISTS idx_impersonation_started
  ON impersonation_sessions (started_at);
