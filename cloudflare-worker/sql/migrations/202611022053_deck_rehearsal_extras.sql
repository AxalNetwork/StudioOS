-- D1580 part 2a (#3827): a rehearsal's audio size and its coaching, beside the
-- rehearsal (743_deck_rehearsals) in a table of their own, one row per
-- rehearsal.
-- audio_bytes: the recording's size, so kept audio counts against the
-- venture's storage plan (services/storageUsage.ts, area deck_rehearsals).
-- A part 1 rehearsal has no row here: its audio counts as a file of unknown size.
-- coach_json: rehearse_coach's points ({ points: [{ card, point }], dropped }),
-- written once; coach_model, coach_usage_log_id and coach_charged_microusd are
-- its run; coached_at is when it was written (the audio's hour counts from it).
-- A new table, not ALTERs on 743: a stamped file (D4106) sorts before the
-- numbered ones in a plain sort, and a CREATE does not depend on that order.
-- Additive; no transaction statements (D1 rejects them).
CREATE TABLE IF NOT EXISTS deck_rehearsal_extras (
  rehearsal_id INTEGER PRIMARY KEY REFERENCES deck_rehearsals(id) ON DELETE CASCADE,
  audio_bytes INTEGER CHECK (audio_bytes IS NULL OR audio_bytes >= 0),
  coach_json TEXT CHECK (coach_json IS NULL OR json_valid(coach_json)),
  coach_model TEXT,
  coach_usage_log_id INTEGER,
  coach_charged_microusd INTEGER,
  coached_at TEXT
);
