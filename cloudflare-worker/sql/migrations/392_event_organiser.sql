-- D567 / #1173: decision history and agenda room/link. Legacy rows stay unrecorded.
ALTER TABLE event_registrations ADD COLUMN decision_reason TEXT;
ALTER TABLE event_registrations ADD COLUMN decided_by_user_id INTEGER REFERENCES users(id);
ALTER TABLE event_registrations ADD COLUMN decided_at TEXT;
ALTER TABLE event_agenda_items ADD COLUMN location_text TEXT;
ALTER TABLE event_agenda_items ADD COLUMN location_url TEXT;
