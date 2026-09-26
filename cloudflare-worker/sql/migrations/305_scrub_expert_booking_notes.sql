-- 305_scrub_expert_booking_notes.sql — D331 (wave 8, Session 4, item 3).
--
-- `calendar_events.notes` should never have carried a founder's private
-- booking note for an `expert_booking` row: that column feeds an admin's
-- platform-wide /calendar read, the .ics feed and the Google/Outlook sync,
-- none of which is the expert-facing surface the note is for
-- (`fanoutBookingNotifications` already sends it to the expert directly).
-- `services/wellbeing/bookings.ts`'s `mirrorBookingToCalendar` stops writing
-- it in the same PR; this scrubs what it already wrote.
--
-- An UPDATE, not an additive change — the standing rule's "additive only"
-- does not cover it, and it is allowed here because it removes data that
-- should never have been written in the first place. Idempotent: a second
-- run matches zero rows, since the first run already cleared every one.
-- Measured read-only against production before this migration was written:
-- 0 of 0 `expert_booking` rows carried a `notes` value (D331's entry has the
-- query and both counts).
UPDATE calendar_events
   SET notes = NULL
 WHERE kind = 'expert_booking'
   AND notes IS NOT NULL;
