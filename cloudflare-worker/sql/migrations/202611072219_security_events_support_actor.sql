-- #4691 (D4691) — a security event records when its caller was a support
-- operator rather than the account holder.
--
-- A gate refusal or a step-up recorded during a support session was stored
-- under the account it was opened on, so HQ read the operator's event as the
-- holder's own. `support_user_id` names the operator: an HQ account id, or 0
-- for a branch support session, whose operator is held at HQ and has no local
-- row (the convention `impersonation_sessions.admin_user_id` already uses).
-- NULL means the caller acted as themselves, which is every row written before
-- this file and every row written outside a support session.
--
-- Additive and nullable. The append-only seal of migration 282 refuses
-- UPDATE and DELETE on rows, not a new column, and nothing is backfilled:
-- an older row has no way to say who held its session, so it claims nothing.
-- ALTER TABLE ... ADD COLUMN is not re-runnable; the migration ledger applies
-- it once.

ALTER TABLE security_events ADD COLUMN support_user_id INTEGER;
