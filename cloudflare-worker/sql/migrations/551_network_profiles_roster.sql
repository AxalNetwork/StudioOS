-- 551 / D974 / #2760: the Advisors & Partners roster store, part 2 of #2369.
-- Assigned by S21 on #2760 (S21's range), 2026-10-24. Additive and data-preserving.
--
-- `network_profiles` is the roster HQ keeps and the Demo Day deck reads. Until
-- now hiding a row and archiving it were one act (`is_active = 0`). From here
-- a row is in one of three states:
--
--   shown     is_active = 1, archived_at NULL   the deck reads it, the public photo proxy serves it
--   hidden    is_active = 0, archived_at NULL   kept on the roster, off the deck
--   archived  archived_at set (is_active = 0)   out of the roster's working list, restorable
--
-- Every row hidden before this migration stays hidden: nothing sets
-- `archived_at` here, so no row is archived by the migration.
--
--   linked_user_id  the member account the person signs in with, when they
--                   have one; NULL is a roster row with no account.
--   created_by      the admin who added the row; NULL for rows added before 551.
--   archived_at     when the row was archived (UTC, D1's stamp); NULL otherwise.

ALTER TABLE network_profiles ADD COLUMN linked_user_id INTEGER REFERENCES users(id);
ALTER TABLE network_profiles ADD COLUMN created_by INTEGER REFERENCES users(id);
ALTER TABLE network_profiles ADD COLUMN archived_at TEXT;

CREATE INDEX IF NOT EXISTS idx_network_profiles_linked_user ON network_profiles(linked_user_id);
