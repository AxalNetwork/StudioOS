-- D5043 (#5043) — the destination branch remembers which HQ move asked for an
-- invitation, so asking twice cannot create two.
--
-- `move_ref` is HQ's move operation uid (`mvop_…`, HQ's `hq_account_moves`).
-- `inviteAccount` looks it up before it writes: a pending or accepted
-- invitation already stored for the same move is answered again instead of a
-- second row being written. That is what makes HQ's "Retry invitation" safe
-- when HQ never heard the first answer (the call failed after the branch had
-- written), and it is what tells "the person accepted our invitation" apart
-- from "another active account appeared here on its own". NULL on every
-- invitation written before this, and on any invitation not made by a move.

ALTER TABLE branch_invitations ADD COLUMN move_ref TEXT;

CREATE INDEX IF NOT EXISTS ix_branch_inv_move_ref ON branch_invitations(move_ref);
