-- D917 (#2700): review history for the Events desk and My events.
-- "Sent back" is its own status, stored as rejected; it is not draft.
-- Timestamp columns are nullable ISO TEXT; review_note holds the last send-back reason.
-- A material host edit flags approval history without re-queuing the event.
ALTER TABLE events ADD COLUMN submitted_at TEXT;
ALTER TABLE events ADD COLUMN approved_at TEXT;
ALTER TABLE events ADD COLUMN review_note TEXT;
ALTER TABLE events ADD COLUMN changed_after_approval_at TEXT;
