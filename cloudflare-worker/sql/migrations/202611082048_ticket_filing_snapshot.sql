-- 202611082048 — D5030 (#5030): a ticket keeps the support context it was filed in.
-- Named by its UTC minute (D4106).
--
-- WHAT WAS WRONG. HQ · Support sorted every open ticket by its requester's
-- account AS IT STANDS NOW (`personaOf`, D204). A ticket filed by a licence's
-- Administrator moved to another queue — or out of both — the day that account
-- was demoted, closed or detached, and nothing on the row said where it had
-- been filed. Four facts are known at the moment of filing and cannot be
-- derived afterwards:
--
--   tickets.filed_persona       the queue the filing belonged to, in
--                               `TICKET_PERSONAS` vocabulary (`hq_held`,
--                               `admin_product`, `hq_staff`, `account_closed`,
--                               `not_on_record`), or `branch_member` for a
--                               member filing on a branch host
--   tickets.filed_role          the requester's `users.role` then
--   tickets.filed_licence_uid   the licence the requester administered then
--                               (`licence_admins`), NULL when none
--   tickets.filed_branch_code   the branch host the ticket was filed on, or the
--                               branch of the licence administered, NULL on HQ
--                               with no deployment
--
-- Written once, by the one INSERT (`routes/tickets.ts`), and never updated.
--
-- HISTORICAL ROWS. Nothing is backfilled. A ticket filed before this file has
-- NULL here because nobody recorded its filing context, and today's standing
-- is not that context. Such a ticket is still queued from current standing,
-- and the page says so on it rather than presenting the queue as recorded.
--
-- ALTER TABLE ... ADD COLUMN is not re-runnable; the migration ledger stops the replay.
-- No BEGIN/COMMIT: D1 applies a migration file as one batch.

ALTER TABLE tickets ADD COLUMN filed_persona TEXT CHECK (filed_persona IS NULL OR filed_persona IN (
  'hq_held', 'admin_product', 'hq_staff', 'account_closed', 'not_on_record', 'branch_member'
));
ALTER TABLE tickets ADD COLUMN filed_role TEXT;
ALTER TABLE tickets ADD COLUMN filed_licence_uid TEXT;
ALTER TABLE tickets ADD COLUMN filed_branch_code TEXT;
