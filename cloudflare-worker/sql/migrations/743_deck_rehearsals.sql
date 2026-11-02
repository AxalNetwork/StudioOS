-- D1580 F1 (#3827): a founder's rehearsal of a deck version, and its report.
-- One row per rehearsal. The pitch length is 2, 3 or 5 minutes. The client
-- records when each card was shown (card_marks_json: [{ card, at_ms }]); the
-- Worker transcribes the audio through the router and writes the report
-- (report_json: per-card time, words a minute, filler words, pauses and notes
-- covered, plus the figures said that disagree with a linked figure).
-- The audio is kept in R2 under audio_r2_key only until audio_delete_after,
-- unless the founder turns "Keep the audio" on (keep_audio = 1); the sweep
-- clears audio_r2_key and stamps audio_deleted_at. The transcript stays.
-- The run's charge is the usage row's (ai_usage_log_id, charged_microusd).
-- Additive; no transaction statements (D1 rejects them).
CREATE TABLE IF NOT EXISTS deck_rehearsals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  deck_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  pitch_seconds INTEGER NOT NULL CHECK (pitch_seconds IN (120, 180, 300)),
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0 AND duration_ms <= 600000),
  status TEXT NOT NULL DEFAULT 'reported' CHECK (status IN ('reported', 'failed')),
  card_marks_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(card_marks_json) AND json_type(card_marks_json) = 'array'),
  transcript_json TEXT CHECK (transcript_json IS NULL OR json_valid(transcript_json)),
  report_json TEXT CHECK (report_json IS NULL OR json_valid(report_json)),
  model TEXT,
  ai_usage_log_id INTEGER,
  charged_microusd INTEGER,
  audio_r2_key TEXT,
  audio_mime TEXT,
  keep_audio INTEGER NOT NULL DEFAULT 0 CHECK (keep_audio IN (0, 1)),
  audio_delete_after TEXT,
  audio_deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_deck_rehearsals_deck ON deck_rehearsals (deck_id, user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_deck_rehearsals_audio_due ON deck_rehearsals (audio_delete_after) WHERE audio_r2_key IS NOT NULL AND keep_audio = 0;
