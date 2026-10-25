-- 552 — an admin pause per person in the advisor and partner network, and an
-- admin switch that hides an advisor from the advisor directory (D976, #2762).
-- Reserved by S21 on #2742 (D972 §6), 2026-10-24.
--
-- One row per member account (`users.id`), written only by
-- `routes/admin_network.ts`. Nothing else in the network could be paused: only
-- the advisor writes `advisors`, and `advisors.is_active` has no admin writer.
--
--   paused_at / paused_reason / paused_by   set by Pause, which needs a reason;
--                                           NULL while the person is not paused.
--   resumed_at / resume_reason / resumed_by the last Resume, which needs a reason.
--   directory_hidden_at / directory_hidden_by  set while an admin hides the
--                                           advisor from the advisor directory.
--
-- A row exists only once an admin has acted; no row means never paused and
-- never hidden. Nothing is backfilled. Who did what, and when, is also in
-- `admin_audit_log` through `logAdminAction`.
--
-- Grep first (D689 D-t): `network_member_states` exists in no earlier migration
-- and not in schema_baseline.sql.
CREATE TABLE IF NOT EXISTS network_member_states (
  user_id              INTEGER PRIMARY KEY REFERENCES users(id),
  paused_at            TEXT,
  paused_reason        TEXT,
  paused_by            INTEGER REFERENCES users(id),
  resumed_at           TEXT,
  resume_reason        TEXT,
  resumed_by           INTEGER REFERENCES users(id),
  directory_hidden_at  TEXT,
  directory_hidden_by  INTEGER REFERENCES users(id),
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
