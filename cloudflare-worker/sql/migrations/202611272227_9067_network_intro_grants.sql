-- D9067 (#9067): who works the operator side of introduction requests (D7673). The owner's answer A of 2026-11-27
-- on #7673: an operator is a named grant a Super Admin makes (D7678), and a readiness reviewer is an HQ admin with a
-- Network reviewer entitlement (D7677 Q3). Being an HQ admin is no longer enough on its own.
--
-- One row per grant. At most one grant per person and kind is in force (the partial unique index); a revoke keeps
-- the row and records who revoked it, when and why. There is no validity period: no column holds one, and a grant
-- holds until a Super Admin revokes it. Every grant and revoke is written in one batch with its admin_audit_log row.
--
-- Additive and idempotent.
CREATE TABLE IF NOT EXISTS network_intro_staff_grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('operator', 'reviewer')),
  granted_by INTEGER NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 500),
  granted_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_by INTEGER REFERENCES users(id),
  revoked_at TEXT,
  revoke_reason TEXT CHECK (revoke_reason IS NULL OR length(revoke_reason) <= 500),
  CHECK ((revoked_by IS NULL) = (revoked_at IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_network_intro_staff_grants_active
  ON network_intro_staff_grants (user_id, kind) WHERE revoked_at IS NULL;
