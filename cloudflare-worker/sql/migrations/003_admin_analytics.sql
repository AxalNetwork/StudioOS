-- Task #3 — Admin analytics audit trail.
-- Records every export generated from MonitoringPage → Analytics tab so an
-- admin can see (and prove) who pulled which report and when. Surfaces in
-- the "Recent Exports" panel in the same tab.
--
-- Apply via:
--   wrangler d1 execute studioos-db --file=cloudflare-worker/sql/migrations/003_admin_analytics.sql --remote --env=""

CREATE TABLE IF NOT EXISTS admin_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_user_id INTEGER NOT NULL REFERENCES users(id),
    action TEXT NOT NULL,                 -- e.g. 'analytics_export'
    report_type TEXT,                     -- overview|users|financial|technical|management
    format TEXT,                          -- csv|pdf|html
    filters_json TEXT,                    -- JSON dump of the request body filters
    storage_key TEXT,                     -- R2 object key (or NULL when inline)
    download_url TEXT,                    -- last-issued signed URL (for display only)
    exported_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_user_ts ON admin_audit_log(admin_user_id, exported_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_action_ts ON admin_audit_log(action, exported_at DESC);
