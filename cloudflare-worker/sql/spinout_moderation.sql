-- Spin-Out Lab participant moderation.
--
-- The distinction this table exists to preserve: EJECTING someone from a
-- cohort is not DEACTIVATING their account.
--
-- The platform already has `adminToggleActive` (admin.ts), which flips
-- users.is_active and locks the person out of StudioOS entirely. That is far
-- too blunt for cohort moderation — the same person may hold investor,
-- partner or advisor roles that have nothing to do with the Lab, and a
-- graduate's projects, documents and issued credential should survive.
--
-- Cohort access is governed by users.spinout_lab_active (set to 1 on
-- acceptance in services/cohortApplications.ts, read by
-- services/projectAccess.ts and by labRoles() in the SPA). That is the
-- correct lever, so moderation moves THAT flag and never touches is_active.
--
-- One row per moderation case. History is preserved: reinstating opens no
-- new access grant beyond flipping the flag back, and the closed case stays
-- for audit. Human-readable audit events are ALSO written to the existing
-- activity_logs table, matching the pattern admin.ts already uses for
-- user_toggled / account_status_changed.

CREATE TABLE IF NOT EXISTS spinout_moderation_cases (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL,

  -- active | under_review | suspended | ejected
  -- 'active' rows exist only as the tail of a reinstatement.
  status        TEXT NOT NULL,

  -- abuse | harassment | spam | fraudulent_application | policy_violation |
  -- legal_compliance | inactivity | other
  reason_code   TEXT NOT NULL,
  severity      TEXT NOT NULL DEFAULT 'medium',   -- low | medium | high
  summary       TEXT,                              -- internal only, never served to the member
  details       TEXT,                              -- internal only

  -- What the action did, so the audit trail is readable years later without
  -- re-deriving it from the flag's current value.
  lab_access_before INTEGER,
  lab_access_after  INTEGER,

  opened_by     INTEGER NOT NULL,                  -- admin user id
  opened_at     TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_by   INTEGER,
  resolved_at   TEXT,

  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_spinout_mod_user   ON spinout_moderation_cases(user_id);
CREATE INDEX IF NOT EXISTS idx_spinout_mod_status ON spinout_moderation_cases(status);
CREATE INDEX IF NOT EXISTS idx_spinout_mod_open   ON spinout_moderation_cases(user_id, resolved_at);
