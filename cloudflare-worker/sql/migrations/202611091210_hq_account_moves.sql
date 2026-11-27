-- D5043 (#5043) — HQ's own record of each cross-branch account move, so a move
-- whose destination invitation did not land can be finished later.
--
-- A move is two writes on two databases (D121): the source branch closes the
-- account, then the destination branch stores an invitation. Nothing joins the
-- two, so before this table a failed second leg lived only in one HTTP reply:
-- the reply said "retry the invitation alone", HQ had no action for it, and a
-- refresh lost even the sentence.
--
-- One row per move, written BEFORE the source is called (a move HQ cannot
-- record is refused with nothing done). The row is what the recovery reads:
--
--   status          started        recorded; the source has not confirmed
--                   source_refused the source refused; nothing happened
--                   inviting       the source closed the account; the
--                                  invitation is being asked for now
--                   invite_failed  the invitation did not land (retryable)
--                   invited        the destination stored the invitation
--   moved_out_at    set only after the source answered that it closed the
--                   account. It is the proof the retry requires: no stamp, no
--                   retry.
--   target_*        what the SOURCE answered about the account. The retry
--                   sends these, never anything the browser sends.
--   branch_user_id  the account's id on the SOURCE database. Not an HQ users
--                   id and never joined to one (D259).
--   last_error_code destination_unreachable | destination_refused |
--                   destination_active | destination_not_bound
--   invite_email_sent  NULL until the destination answers; then 1 when its
--                   mailer sent the message, 0 when the invitation exists and
--                   nobody was told (migration 263's distinction).
--
-- Stamps are SQLite `datetime('now')` and are compared against SQLite (D120).

CREATE TABLE IF NOT EXISTS hq_account_moves (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                 TEXT    NOT NULL UNIQUE,
  from_code           TEXT    NOT NULL,
  to_code             TEXT    NOT NULL,
  branch_user_id      INTEGER NOT NULL,
  reason              TEXT    NOT NULL,
  actor_user_id       INTEGER NOT NULL,
  actor_name          TEXT    NOT NULL,
  status              TEXT    NOT NULL DEFAULT 'started'
                        CHECK (status IN ('started', 'source_refused', 'inviting', 'invite_failed', 'invited')),
  target_email        TEXT,
  target_name         TEXT,
  target_role         TEXT,
  moved_out_at        TEXT,
  attempts            INTEGER NOT NULL DEFAULT 0,
  last_attempt_at     TEXT,
  last_error_code     TEXT,
  last_error          TEXT,
  invite_uid          TEXT,
  invite_email_sent   INTEGER,
  invite_email_reason TEXT,
  invited_at          TEXT,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS ix_hq_account_moves_status ON hq_account_moves(status, updated_at DESC);
