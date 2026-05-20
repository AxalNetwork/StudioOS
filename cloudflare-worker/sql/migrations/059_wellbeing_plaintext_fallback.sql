-- Task #33 — Wellbeing plaintext fallback columns.
--
-- The /daily and /checkins POST handlers AES-GCM-encrypt every answer at
-- rest using a key derived from AXAL_ENCRYPTION_SECRET || JWT_SECRET
-- (see services/cryptoBox.ts). When neither secret is configured (dev
-- accidents, key-rotation windows, or a freshly cloned preview env),
-- encryptString() throws and the entire POST returned a generic 500.
--
-- These additive columns let the handler fall back to plaintext storage
-- and still return 201, emitting a structured warn log so an operator
-- can spot the missed-secret incident.
--
-- IMPORTANT: SQLite/D1 `ALTER TABLE ADD COLUMN` is NOT idempotent. The
-- worker's lazy schema bootstrap (ensureWellbeingSchema) re-runs each
-- ALTER inside a try/catch so a re-applied migration is harmless.

ALTER TABLE wellbeing_daily_pulses ADD COLUMN mood_plain INTEGER;
ALTER TABLE wellbeing_daily_pulses ADD COLUMN stress_plain INTEGER;
ALTER TABLE wellbeing_daily_pulses ADD COLUMN sleep_plain INTEGER;
ALTER TABLE wellbeing_daily_pulses ADD COLUMN energy_plain INTEGER;
ALTER TABLE wellbeing_daily_pulses ADD COLUMN focus_plain INTEGER;
ALTER TABLE wellbeing_daily_pulses ADD COLUMN social_plain INTEGER;
ALTER TABLE wellbeing_daily_pulses ADD COLUMN free_text_plain TEXT;
ALTER TABLE wellbeing_daily_pulses ADD COLUMN tags_plain TEXT;

ALTER TABLE wellbeing_checkins ADD COLUMN stress_plain INTEGER;
ALTER TABLE wellbeing_checkins ADD COLUMN sleep_plain INTEGER;
ALTER TABLE wellbeing_checkins ADD COLUMN support_plain INTEGER;
ALTER TABLE wellbeing_checkins ADD COLUMN decisions_plain INTEGER;
ALTER TABLE wellbeing_checkins ADD COLUMN energy_plain INTEGER;
ALTER TABLE wellbeing_checkins ADD COLUMN notes_plain TEXT;
