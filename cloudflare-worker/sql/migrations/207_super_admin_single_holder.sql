-- 207 — one Super Admin, by name.
--
-- Migration 199 creates `super_admins`, the side table that says which admin
-- accounts may franchise the platform (a side table because `users` sits at
-- D1's 100-column ceiling — 199's header has the story). It grants nobody.
-- This file is the decision 199 defers, made by the platform's owner on
-- 2026-09-03: the Super Admin — the franchisor, who licenses the platform to
-- subsidiaries — is a single authority, and it is guillaume.lauzier@axal.vc.
--
-- Production held two admin accounts when this was written, both belonging to
-- the same person; the other stays a plain admin and keeps every admin
-- destination. Only the licence console (routes/admin_licences.ts), the HQ
-- pages and the Super Admin holder list (routes/admin_super_admins.ts) are
-- HQ-only.
--
-- FORWARD-ONLY, LIKE 199. This file sorts after 199, so the table exists when
-- it runs. It was rewritten alongside 199 on 2026-09-03, before either had
-- applied to production.
--
-- Changing the holder afterwards is a deliberate act by a holder through
-- POST/DELETE /api/admin/super-admins/:userId — TOTP, step-up, audited in
-- admin_audit_log, and never the last holder — not another migration.
--
-- Both statements are idempotent: the DELETE removes every holder who is not
-- the named account (including any an old-shape database elevated), and the
-- INSERT OR IGNORE grants the named account only while it is an admin.
-- Re-running them is a no-op.

DELETE FROM super_admins
 WHERE user_id NOT IN (
   SELECT id FROM users WHERE LOWER(email) = 'guillaume.lauzier@axal.vc'
 );

INSERT OR IGNORE INTO super_admins (user_id, granted_by_user_id, note)
SELECT id, NULL, 'Migration 207: the single Super Admin, named by the platform owner on 2026-09-03.'
  FROM users
 WHERE LOWER(email) = 'guillaume.lauzier@axal.vc'
   AND LOWER(role) = 'admin';
