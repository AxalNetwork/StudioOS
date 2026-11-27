-- D5247 (#5247) — when each Security store was last read successfully, so the
-- Security Overview can mark a source Stale past its own age (owner answers C1
-- and B2 on #4800, 2026-11-09).
--
-- One row per store, keyed by the store's name in `sources[]`
-- (security_events, admin_audit_log, activity_logs, impersonation_sessions,
-- licence_events, backup_d1, backup_kv, restore_drill, sanctions_screenings).
-- A small table rather than a column on each store: the stores are ledgers, an
-- R2 object and a marker, and none of them should change shape to say when
-- HQ last read it.
--
--   last_read_at  the last time a Security read of the store answered
--                 (ISO 8601, UTC). Written only on success: a failed read
--                 never moves it, so it is the last good read.
--   evidence_at   for a store whose age is measured from its own evidence
--                 (the backup heartbeats' recovery point, the restore drill's
--                 marker), that stamp as of the last good read; NULL for the
--                 rest. It lets a later failed read still say how old the
--                 last good evidence was.
--
-- No row means the store has never been read successfully here, which the
-- page shows as "Not recorded", never as a time and never as Stale.
--
-- STANDS ALONE under the runner: no BEGIN/COMMIT.

CREATE TABLE IF NOT EXISTS security_source_reads (
  source TEXT PRIMARY KEY,
  last_read_at TEXT NOT NULL,
  evidence_at TEXT
);
