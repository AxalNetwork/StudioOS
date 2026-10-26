-- 614 — KYC part 1 (D1229, #3237): the people queue's assignment, its notes,
-- the case's history and several documents per case. Assigned to #3237 by S1.
--
-- THE STATUS STAYS ON `users`. `users.kyc_status` is TEXT with no CHECK, so
-- the two new words, `needs_info` (Needs information) and `expired`
-- (Expired), need no column change. The full set the Worker writes is
-- not_started, pending, needs_info, approved, rejected and expired.
--
-- users.kyc_assignee_id / kyc_assigned_at — who on HQ holds the case, and
--   since when. NULL is unassigned. Written only by
--   `PATCH /api/kyc/admin/:userId/assign`.
--
-- kyc_case_events — one row per thing that happened to a case: a submission,
--   a decision (approved, rejected, needs_info), a re-check, an expiry, an
--   assignment. `submitted_at` copies the submission a decision answers, so
--   the figures' time to decision is `created_at - submitted_at` without a
--   join. `note` is the reviewer's words (a reason, the information asked
--   for, an approval note); identity values never go in it.
--
-- kyc_notes — HQ's notes on a case. Never shown to the member.
--
-- kyc_documents — several documents per case, each with a kind. R2 keys
--   only (the `kyc/` prefix `services/r2.ts` guards); no bytes and no data
--   URI are stored. A rejected case's bytes are purged and the row keeps
--   `removed_at`, as the single legacy document's pointer did.
--
-- APPEND-ONLY BUT ERASABLE. Events and notes refuse an UPDATE; documents
-- allow only `removed_at` to be set. None refuses a DELETE, so an account
-- erasure can still remove a member's rows. No REFERENCES on the user ids,
-- for the same reason.
--
-- NO BACKFILL. A case decided before this migration has no events; the
-- figures read only what is recorded and say so.
--
-- Grep first (D689 D-t): no `kyc_case_events`, `kyc_notes` or
-- `kyc_documents` table and no `kyc_assignee_id` or `kyc_assigned_at` column
-- exists in schema_baseline.sql or an earlier migration.
--
-- STANDS ALONE under the runner: no BEGIN/COMMIT outside trigger bodies.

ALTER TABLE users ADD COLUMN kyc_assignee_id INTEGER;
ALTER TABLE users ADD COLUMN kyc_assigned_at TEXT;

CREATE TABLE IF NOT EXISTS kyc_case_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('submitted', 'approved', 'rejected', 'needs_info', 'recheck', 'expired', 'assigned', 'unassigned')),
  actor_user_id  INTEGER,
  note           TEXT CHECK (note IS NULL OR length(note) <= 2000),
  submitted_at   TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_kyc_case_events_user ON kyc_case_events(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_kyc_case_events_kind ON kyc_case_events(kind, created_at);

CREATE TRIGGER IF NOT EXISTS kyc_case_events_block_update
BEFORE UPDATE ON kyc_case_events
BEGIN
    SELECT RAISE(ABORT, 'kyc_case_events is append-only (D1229). A case''s history is a record of what happened.');
END;

CREATE TABLE IF NOT EXISTS kyc_notes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL,
  author_user_id  INTEGER NOT NULL,
  body            TEXT NOT NULL CHECK (length(trim(body)) > 0 AND length(body) <= 2000),
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_kyc_notes_user ON kyc_notes(user_id, created_at);

CREATE TRIGGER IF NOT EXISTS kyc_notes_block_update
BEFORE UPDATE ON kyc_notes
BEGIN
    SELECT RAISE(ABORT, 'kyc_notes is append-only (D1229). Add a note; never rewrite one.');
END;

CREATE TABLE IF NOT EXISTS kyc_documents (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('id_front', 'id_back', 'proof_of_address', 'selfie', 'other')),
  file_key      TEXT NOT NULL UNIQUE CHECK (substr(file_key, 1, 4) = 'kyc/'),
  content_type  TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  size_bytes    INTEGER NOT NULL CHECK (size_bytes > 0),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  removed_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_kyc_documents_user ON kyc_documents(user_id, created_at);

-- Only `removed_at` may change, and only from NULL.
CREATE TRIGGER IF NOT EXISTS kyc_documents_block_update
BEFORE UPDATE ON kyc_documents
WHEN NEW.user_id IS NOT OLD.user_id OR NEW.kind IS NOT OLD.kind OR NEW.file_key IS NOT OLD.file_key
  OR NEW.content_type IS NOT OLD.content_type OR NEW.size_bytes IS NOT OLD.size_bytes
  OR NEW.created_at IS NOT OLD.created_at OR OLD.removed_at IS NOT NULL
BEGIN
    SELECT RAISE(ABORT, 'kyc_documents: only removed_at may be set, once (D1229).');
END;
