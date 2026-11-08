-- #4702 (Practice audit 4/6, D4702): the advisor's answer to a request is its
-- own fact, kept apart from what happens to the session afterwards.
--
-- Before this, a booking's `status` was the only record. An advisor's accept
-- confirmed the booking; if the CLIENT later cancelled, `status` became
-- 'cancelled' and the acceptance rate counted it as a decline, so a client
-- cancelling an accepted session lowered the advisor's rate. And a cancel by
-- either side wrote the same row, so a decline could not be told from a
-- withdrawal.
--
--   advisor_decision    'accepted' | 'declined' | NULL. NULL = no answer on
--                       record: still waiting, withdrawn by the client before an
--                       answer, withdrawn by the system, or a cancelled row from
--                       before this column whose answer was never stored.
--   advisor_decided_at  when the advisor answered; NULL when unknown.
--   cancelled_by        'advisor' | 'client' | 'admin' | 'system' | NULL (NULL =
--                       not cancelled, or a cancellation from before this column).
--
-- THE BACKFILL STATES ONLY WHAT THE ROW PROVES. A booking that is confirmed,
-- completed or no-show was accepted: it could not have reached those states
-- otherwise. A cancelled row's answer is NOT inferred: it may have been a
-- decline, or a client cancelling an accepted session, and the old row does not
-- say which, so it stays NULL (the page shows it as "decision not recorded" and
-- leaves it out of the rate, rather than counting it either way). A cancel the
-- worker itself wrote (`slot_cancelled`, `capacity_race`) is the system's.

ALTER TABLE advisor_bookings ADD COLUMN advisor_decision TEXT CHECK (advisor_decision IS NULL OR advisor_decision IN ('accepted', 'declined'));
ALTER TABLE advisor_bookings ADD COLUMN advisor_decided_at TEXT;
ALTER TABLE advisor_bookings ADD COLUMN cancelled_by TEXT CHECK (cancelled_by IS NULL OR cancelled_by IN ('advisor', 'client', 'admin', 'system'));

UPDATE advisor_bookings SET advisor_decision = 'accepted' WHERE status IN ('confirmed', 'completed', 'no_show') AND advisor_decision IS NULL;
UPDATE advisor_bookings SET cancelled_by = 'system' WHERE status = 'cancelled' AND cancel_reason IN ('slot_cancelled', 'capacity_race') AND cancelled_by IS NULL;
