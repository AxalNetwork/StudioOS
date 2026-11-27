-- 611 — My events gaps (D1131, #3011): where a free seat came from, and when a
-- seat came off the waitlist. Assigned to #3011 by S21 (option A).
--
-- comp_source — which source made the seat free, written by
--   `registerPrincipal` in the same statement that writes the seat. It uses the
--   invitation sources' words (`event_invitations.source`): `manual` for a
--   comp invitation the host sent, and `auto_partner`, `auto_lp`,
--   `auto_investor`, `auto_founder` or `auto_connection` for the audience rule
--   (`isPrincipalCompEligible`) that comped the seat at that moment. A seat
--   that is not free holds NULL. Today's rules are never re-evaluated to fill
--   it in later.
-- promoted_at — when a waitlisted place gained a seat, stamped by the same
--   compare-and-set UPDATE that moves it off the waitlist (the host's Approve
--   and Promote, and `promoteWaitlist` when a seat frees up). A new
--   registration on the same row (after a cancel) clears it.
--
-- NO BACKFILL. A row written before this migration keeps both NULL, and My
-- events reads NULL as "Not recorded", never as a guess.
--
-- Grep first (D689 D-t): no `comp_source` or `promoted_at` column exists on
-- `event_registrations` in an earlier migration or in schema_baseline.sql
-- (`waitlist_signups.promoted_at` is another table's).

ALTER TABLE event_registrations ADD COLUMN comp_source TEXT
  CHECK (comp_source IS NULL OR comp_source IN ('manual', 'auto_partner', 'auto_lp', 'auto_investor', 'auto_founder', 'auto_connection'));
ALTER TABLE event_registrations ADD COLUMN promoted_at TEXT;
