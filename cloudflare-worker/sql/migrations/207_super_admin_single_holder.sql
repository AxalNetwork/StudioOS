-- 207 — one Super Admin, by name.
--
-- Migration 199 added `users.is_super_admin` and backfilled EVERY existing
-- admin to 1, on the reasoning that a schema change is the wrong place to make
-- an authorisation decision about named people. That reasoning was right, and
-- this file is the decision it deferred, made by the platform's owner on
-- 2026-09-03: the Super Admin — the franchisor, who licenses the platform to
-- subsidiaries — is a single authority, and it is guillaume.lauzier@axal.vc.
--
-- Production held two admin accounts when this was written, both belonging to
-- the same person; the other stays a plain admin and keeps every admin
-- destination. Only the licence console (routes/admin_licences.ts) and the
-- Super Admin holder list (routes/admin_super_admins.ts) are HQ-only.
--
-- FORWARD-ONLY, LIKE 199. 199 is not edited: it may already have run on a
-- local or preview database, and editing an applied file makes the ledger and
-- the disk disagree. This file narrows the grant after it, in order.
--
-- Changing the holder afterwards is a deliberate act by a holder through
-- POST/DELETE /api/admin/super-admins/:userId — TOTP, step-up, audited in
-- admin_audit_log, and never the last holder — not another migration.
--
-- Both statements are idempotent, so the runner applies them for real even on
-- a baseline, and re-running them is a no-op.

UPDATE users
   SET is_super_admin = 0
 WHERE is_super_admin = 1
   AND LOWER(email) <> 'guillaume.lauzier@axal.vc';

UPDATE users
   SET is_super_admin = 1
 WHERE LOWER(email) = 'guillaume.lauzier@axal.vc'
   AND LOWER(role) = 'admin';
