-- D156 — the three audit tables stop being append-only by convention.
--
-- `admin_audit_log`, `licence_events` and `impersonation_sessions` are the
-- platform's record of what a privileged operator did. HQ's Security page
-- renders all three and says the feed is IMMUTABLE. Measured against the
-- code on 2026-09-18, that word was a description of the writers' habits
-- rather than a property of the database:
--
--   admin_audit_log       33 INSERTs, zero UPDATEs, zero DELETEs, repo-wide
--   licence_events         2 INSERTs, zero UPDATEs, zero DELETEs, repo-wide
--   impersonation_sessions 2 INSERTs and 2 UPDATEs, both `SET ended_at`
--
-- So nothing in the repo rewrites an audit row today. What was missing is
-- anything that would REFUSE one — a `wrangler d1 execute`, a queue job
-- reaching DB.prepare() directly, or a future handler written without the
-- convention in mind, all bypass the source-level guard that
-- `frontend/test/territory_licences.test.mjs:239` holds over `licence_events`.
-- A lexical scan of the source cannot see a write that does not live in the
-- source. These triggers move the guarantee into the database, which is the
-- only place it can hold against every writer.
--
-- THE THIRD TABLE CANNOT TAKE THE SAME SEAL, AND THAT IS THE FINDING.
-- `impersonation_sessions` has one legitimate mutation: closing a session by
-- stamping `ended_at`, written by `routes/admin.ts` (the operator's own exit)
-- and by `util/supportSessionSweep.ts` (D122's sweep, for a branch row that
-- can never be closed by HQ's route). Both are guarded `ended_at IS NULL`.
-- A blanket UPDATE seal here would break D122 and leave every branch support
-- session reading `not closed` on HQ's Security page for ever — the exact
-- defect D122 was written to fix. So this table gets a WHEN-guarded seal
-- that permits precisely that transition and refuses everything else:
-- no re-closing a closed session, and no rewriting who supported whom.
--
-- Shape and idiom copied from `sql/historical/lp_investors_seal.sql`, the
-- in-repo precedent, which states the same fail-loud contract and the same
-- idempotence rule. READS are never affected by a BEFORE trigger.
--
-- IDEMPOTENT: CREATE TRIGGER IF NOT EXISTS throughout. To replay, drop the
-- six triggers named below first.
--
-- NOTE FOR ANYONE REBUILDING A SEALED TABLE. SQLite cannot ALTER a CHECK, so
-- widening one means create-copy-drop-rename — which is what migration 266
-- did to `licence_events`. DROP TABLE drops its triggers with it. Any future
-- rebuild of a table sealed here must re-run these statements at the end of
-- its own migration, or the seal silently disappears. The guard test
-- `cloudflare-worker/test/audit_immutability_d156.test.ts` asserts every
-- sealed table against this file, so a rebuild that forgets fails the build.
--
-- The `BEGIN` below opens a TRIGGER BODY, not a transaction. D1's HTTP API
-- rejects BEGIN/COMMIT as statements and `scripts/check-sql-migrations.mjs`
-- refuses them — its own comment (:27-29) records that it matches
-- statement-leading `BEGIN` only, for exactly this reason.

-- ---------------------------------------------------------------- audit log
CREATE TRIGGER IF NOT EXISTS admin_audit_log_block_update
BEFORE UPDATE ON admin_audit_log
BEGIN
    SELECT RAISE(ABORT,
        'admin_audit_log is append-only (D156). A privileged action already recorded cannot be rewritten; record a correcting row instead.'
    );
END;

CREATE TRIGGER IF NOT EXISTS admin_audit_log_block_delete
BEFORE DELETE ON admin_audit_log
BEGIN
    SELECT RAISE(ABORT,
        'admin_audit_log is append-only (D156). Deleting an audit row would remove the record of an action that happened.'
    );
END;

-- ----------------------------------------------------------- licence events
CREATE TRIGGER IF NOT EXISTS licence_events_block_update
BEFORE UPDATE ON licence_events
BEGIN
    SELECT RAISE(ABORT,
        'licence_events is append-only (D156, and migration 187 said so in prose). A licence transition already recorded cannot be rewritten; append the correcting event.'
    );
END;

CREATE TRIGGER IF NOT EXISTS licence_events_block_delete
BEFORE DELETE ON licence_events
BEGIN
    SELECT RAISE(ABORT,
        'licence_events is append-only (D156). Deleting an event would remove the record of a licence transition that happened.'
    );
END;

-- --------------------------------------------------- impersonation sessions
CREATE TRIGGER IF NOT EXISTS impersonation_sessions_block_delete
BEFORE DELETE ON impersonation_sessions
BEGIN
    SELECT RAISE(ABORT,
        'impersonation_sessions is append-only (D156). A support session that was opened cannot be un-opened.'
    );
END;

-- The one permitted mutation, stated as what it is: an OPEN session being
-- CLOSED, with nothing else about it changing. Every other UPDATE aborts —
-- including a second close, which would move an end time that has already
-- been reported to the supervised party.
CREATE TRIGGER IF NOT EXISTS impersonation_sessions_seal_update
BEFORE UPDATE ON impersonation_sessions
WHEN OLD.ended_at IS NOT NULL
  OR NEW.ended_at IS NULL
  OR NEW.id <> OLD.id
  OR NEW.admin_user_id <> OLD.admin_user_id
  OR NEW.target_user_id <> OLD.target_user_id
  OR NEW.started_at <> OLD.started_at
  OR IFNULL(NEW.context, '') <> IFNULL(OLD.context, '')
BEGIN
    SELECT RAISE(ABORT,
        'impersonation_sessions permits exactly one update: stamping ended_at on a session that is still open (D156). Who supported whom, and when it started, are not rewritable; neither is an end time already recorded.'
    );
END;
