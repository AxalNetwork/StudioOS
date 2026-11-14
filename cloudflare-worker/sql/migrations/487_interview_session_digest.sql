-- 487 — D757 (#1898): one engine entry per conversation (services/validateEngine.ts).
-- The engine's state on each session: what ran last, whether it finished, and the
-- sentence the session page shows. digest_json, digest_kept_at and digest_kept_by
-- are written by D757's digest task (#1924), which adds no migration of its own.
--
-- Additive only: nine nullable columns on interview_sessions. No table is
-- rebuilt, and there is no BEGIN or pragma. Nothing is backfilled: a session
-- digested before this has no digest state, and the engine treats it as new.
-- Every column goes with its row (deleteSession), and an interview's delete
-- cascades to its sessions (438).

-- Where the engine stands. `digest_trigger` has no CHECK, so a new trigger
-- needs no migration.
ALTER TABLE interview_sessions ADD COLUMN digest_status TEXT
  CHECK (digest_status IS NULL OR digest_status IN ('queued', 'running', 'done', 'refused', 'skipped'));
-- The plain sentence the session page shows: the Worker's own words, never
-- provider or SQLite text, and never transcript text.
ALTER TABLE interview_sessions ADD COLUMN digest_note TEXT;
-- sha256 of the final transcript the last completed automatic run read: the
-- same transcript is digested once, whoever triggers it.
ALTER TABLE interview_sessions ADD COLUMN digest_hash TEXT;
ALTER TABLE interview_sessions ADD COLUMN digest_trigger TEXT;
ALTER TABLE interview_sessions ADD COLUMN digest_run_id TEXT;
-- The engine's last attempt, refused runs included (the quiet sweep's bound).
ALTER TABLE interview_sessions ADD COLUMN digested_at TEXT;
-- The digest task's (#1924): the Otter-like summary, a draft until kept.
ALTER TABLE interview_sessions ADD COLUMN digest_json TEXT;
ALTER TABLE interview_sessions ADD COLUMN digest_kept_at TEXT;
ALTER TABLE interview_sessions ADD COLUMN digest_kept_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
