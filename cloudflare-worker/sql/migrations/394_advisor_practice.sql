-- D573: additive practice facts. Legacy rows remain unrecorded.
ALTER TABLE advisor_deliverables ADD COLUMN due_date TEXT;
ALTER TABLE advisor_deliverables ADD COLUMN manual_status TEXT;
ALTER TABLE advisor_session_types ADD COLUMN is_included INTEGER;
ALTER TABLE advisor_bookings ADD COLUMN session_type_id INTEGER;
ALTER TABLE advisor_bookings ADD COLUMN booking_link_id INTEGER;
-- NULL means opens before instrumentation were not recorded.
ALTER TABLE advisor_booking_links ADD COLUMN opens_count INTEGER;
