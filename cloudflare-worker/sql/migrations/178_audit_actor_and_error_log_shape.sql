-- 178 — Two column sets the worker writes and the schema never had.
--
-- Found by `scripts/check-sqlite-columns.mjs`, the column-level sibling of the
-- table check added in 177. Both of these are INSERTs naming columns that do
-- not exist, both wrapped in a swallowing catch, so both have simply never
-- written a row.
--
-- 1. admin_audit_log.actor
--
--    Seven admin routers — circles, events, integration_keys, jobs,
--    publications, telegram, x — call `auditHasActor(env)`, a runtime PRAGMA
--    probe, and branch on it: with the column they write a hashed admin email
--    for attribution, without it they write the row unattributed. Nothing has
--    ever created the column, so the probe has always returned false and the
--    attributed branch has never executed. Half of each of those helpers is
--    code that has never run, and the audit trail on seven admin surfaces
--    cannot say who acted.
--
--    The column is a hash, never a plaintext address — that is what
--    `hashEmail()` produces at each call site and the property this table
--    depends on for its own PII posture.
--
-- 2. error_logs.level / source / details
--
--    `error_logs` was designed for HTTP failures: user_id, endpoint, method,
--    status_code, message, stack_snippet. The queue consumer and queue worker
--    are not HTTP requests, and they write (level, source, message, details)
--    instead — none of which except `message` existed. The queue-consumer site
--    is the sharpest: its comment says it exists to "surface the bug in
--    error_logs rather than running it", and it surfaced nothing.
--
--    Adding the three columns rather than mapping onto the HTTP ones on
--    purpose: endpoint/method/status_code are meaningless for a queue message,
--    and stuffing a source name into `endpoint` would make the table lie about
--    what it holds. The HTTP columns stay nullable and untouched.

ALTER TABLE admin_audit_log ADD COLUMN actor TEXT;

-- Every current write is (performed_by-equivalent, action, ts); this index is
-- the "what did this admin do" read those seven routers exist to support.
CREATE INDEX IF NOT EXISTS idx_admin_audit_actor
  ON admin_audit_log(actor, exported_at DESC);

ALTER TABLE error_logs ADD COLUMN level  TEXT;
ALTER TABLE error_logs ADD COLUMN source TEXT;
ALTER TABLE error_logs ADD COLUMN details TEXT;

-- Reading error_logs means "recent errors from this subsystem", which is
-- (source, created_at) — the queue consumer and queue worker are separate
-- sources writing into the same table.
CREATE INDEX IF NOT EXISTS idx_errlog_source_ts ON error_logs(source, created_at);
CREATE INDEX IF NOT EXISTS idx_errlog_level_ts  ON error_logs(level, created_at);
