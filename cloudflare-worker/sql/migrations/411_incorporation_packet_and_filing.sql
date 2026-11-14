-- 411 — the formation packet and the state filing, recorded by an Axal admin
-- by hand (D601, #998; the owner's answer 1A).
--
-- After payment the Worker moves an order to `packet_processing` and builds
-- nothing (D367). Under 1A an admin moves it on in HQ, in two steps:
--   "Packet ready"          packet_processing (or paid) → packet_ready, with the
--                           packet attached: a `documents` row of the order's
--                           own project (packet_document_id).
--   "Filed with the state"  packet_ready → filed, with the date the filing was
--                           submitted (filed_on, YYYY-MM-DD, never later than
--                           the day it is recorded).
-- Each step stores who recorded it and when; the route also writes it through
-- logAdminAction. Nothing is backfilled: an order paid before this migration
-- has no packet and no filing on record, because none was.
--
-- Not re-runnable (SQLite has no ADD COLUMN IF NOT EXISTS); the migration
-- ledger stops the replay. services/incorporations.ts carries the same columns
-- as its D235 safety net and swallows "duplicate column".
ALTER TABLE incorporations ADD COLUMN packet_document_id INTEGER REFERENCES documents(id);
ALTER TABLE incorporations ADD COLUMN packet_ready_at TEXT;
ALTER TABLE incorporations ADD COLUMN packet_ready_by INTEGER REFERENCES users(id);
ALTER TABLE incorporations ADD COLUMN filed_on TEXT;
ALTER TABLE incorporations ADD COLUMN filed_recorded_at TEXT;
ALTER TABLE incorporations ADD COLUMN filed_by INTEGER REFERENCES users(id);
