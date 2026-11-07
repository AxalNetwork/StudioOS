-- 202611070900 — #4717 package 5 (D4717): the indexes the Community reads'
-- query plans call for, and no others.
--
-- Every one is on the EXPRESSION the reads compare, `datetime(col)` or
-- `date(col)` (D124: a timestamp is never compared bare, because one column
-- can hold both `YYYY-MM-DD HH:MM:SS` and ISO 8601). A plain index on the
-- column cannot answer `datetime(col) >= datetime(?)`; an index on the same
-- expression can, as `idx_integration_logs_*` (migration 016) already do.
--
-- Measured on the large fixture (`cloudflare-worker/test/_community_scale_fixture.ts`;
-- the plans, before and after, are in decisions/D4717.md, package 5):
--
--   admin_audit_log (report_type, datetime(exported_at), action)
--       Recent activity's admin arms: `report_type = ? AND action IN (…)`,
--       the window, newest first. Before: every audit row read and sorted.
--   admin_audit_log (action, datetime(exported_at))
--       The `event_submitted` arm (no report_type), newest first.
--   event_registrations (date(registered_at), event_id, datetime(registered_at))
--       Registrations per event per day: the window is a range of days, the
--       grouping follows the index, and the count is read from the index
--       alone. Also the Events overview's period reads (D918), which now
--       compare `date(registered_at)`. Before: every registration grouped.
--   job_applications (datetime(created_at)) and expert_bookings (datetime(created_at))
--       The Community overview's period and the period before it, and the
--       weekly series. Before: every application and every booking read.
--   event_checkins (date(checked_in_at))
--       D918's weekly check-ins. Before: every check-in read.
--
-- Additive and idempotent: CREATE INDEX IF NOT EXISTS, no data change.

CREATE INDEX IF NOT EXISTS idx_admin_audit_type_at
  ON admin_audit_log (report_type, datetime(exported_at), action);

CREATE INDEX IF NOT EXISTS idx_admin_audit_action_at
  ON admin_audit_log (action, datetime(exported_at));

CREATE INDEX IF NOT EXISTS idx_event_registrations_day
  ON event_registrations (date(registered_at), event_id, datetime(registered_at));

CREATE INDEX IF NOT EXISTS idx_job_applications_at
  ON job_applications (datetime(created_at));

CREATE INDEX IF NOT EXISTS idx_expert_bookings_at
  ON expert_bookings (datetime(created_at));

CREATE INDEX IF NOT EXISTS idx_event_checkins_day
  ON event_checkins (date(checked_in_at));
