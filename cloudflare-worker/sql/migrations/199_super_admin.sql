-- 199 — the Super Admin: who may franchise the platform.
--
-- WHAT WAS MISSING, and it was not the ledger. Migration 187 built the licence
-- ledger (`territory_licences`, `licence_territories`, `licence_seats`,
-- `licence_events`) and 190 added `licence_admins` — who administers a
-- licence. `routes/admin_licences.ts` is the console that issues, activates,
-- suspends, renews and terminates them. All of it exists and all of it works.
--
-- What nothing said is who may OPERATE that console. Every route in it gates
-- on `requireAdmin`, so today any admin can license the platform to a new
-- subsidiary, change another licensee's terms, or terminate one. In a
-- franchise model that is the one power the franchisor cannot share with the
-- franchisees: a subsidiary admin who can issue licences is not a subsidiary.
--
-- WHY A FLAG AND NOT A ROLE. `super_admin` as a distinct `users.role` value
-- would be the obvious modelling, and it is the wrong one here: 468 call sites
-- across the worker check `role === 'admin'` by exact equality (`isAdmin`,
-- `requireAdmin`, `UNSCOPED_ROLES`, per-file exemption sets). A new role value
-- fails every one of them, so a super admin would be locked out of the entire
-- admin product and each of the 468 would have to be found and widened — with
-- every miss a silent loss of access, discovered by a person hitting a 403.
--
-- The user's own description is additive: the Super Admin "is the same as the
-- Admin, but has the power to license". So the model is additive too. The role
-- stays `admin` and this column adds the one power on top. Every existing
-- check passes unchanged, and the new gate (`requireSuperAdmin`) fails CLOSED:
-- a surface that forgets it stays admin-only, which is the pre-existing
-- behaviour, rather than accidentally granting the franchise.
--
-- BACKFILL: EVERY EXISTING ADMIN BECOMES A SUPER ADMIN, and that is
-- deliberate rather than lazy. Today every admin can already do all of this;
-- backfilling 0 would silently revoke a power the platform's operators
-- currently hold and are presumably using — a migration is the wrong place to
-- make that authorization decision about named people. So this preserves
-- today's behaviour exactly, and the boundary starts applying to admins
-- created FROM NOW ON, who default to 0. Demoting a specific existing admin is
-- then a deliberate act by a super admin, recorded in `admin_audit_log`, and
-- not something a schema change guessed at.
--
-- WHAT THIS IS STILL NOT. It is not the tenancy scoping half. Migration 190's
-- header says the same thing about itself and it is still true: subsidiary
-- admins remain UNSCOPED across the platform, because scoping every account,
-- project, deal and document to a licence is a programme across 151 route
-- files. This column answers "who may franchise", not "what may a franchisee
-- see". Those are different questions and only the first is answered here.

ALTER TABLE users ADD COLUMN is_super_admin INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_users_super_admin
  ON users(is_super_admin) WHERE is_super_admin = 1;

UPDATE users
   SET is_super_admin = 1
 WHERE LOWER(role) = 'admin';
