-- 530 — how long Axal keeps a call's audio, separately from its text (D877, #2524).
--
-- Additive. A "call" is a session with a Zoom or Google Meet ref
-- (`interview_channel_refs`, migration 449) or an uploaded recording
-- (`interview_sessions.submitted_via = 'upload'`, D872). Its audio is the
-- R2 chunks in `interview_session_chunks`; its text is the segments, which
-- stay until the founder deletes the session.
--
-- Grep first: no table or column named call_audio* or audio_removed* exists
-- in schema_baseline.sql or any earlier migration. No BEGIN/COMMIT.
--
--   member_call_audio_settings
--     One row per member who chose a retention. No row means the default
--     (D877: 30 days). `call_audio_retention_days` NULL means keep the audio
--     until the founder deletes it.
--
--   interview_sessions.audio_removed_at, .audio_removed_reason
--     When the session's audio was removed while its text stayed, and why:
--     `retention` (the daily purge) or `deleted` (the founder's audio-only
--     delete). NULL means the audio was never removed. Deleting the whole
--     session removes the row, so no reason is recorded for that here.
CREATE TABLE IF NOT EXISTS member_call_audio_settings (
  user_id INTEGER PRIMARY KEY,
  call_audio_retention_days INTEGER
    CHECK (call_audio_retention_days IS NULL OR (typeof(call_audio_retention_days) = 'integer' AND call_audio_retention_days BETWEEN 1 AND 3650)),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE interview_sessions ADD COLUMN audio_removed_at TEXT;
ALTER TABLE interview_sessions ADD COLUMN audio_removed_reason TEXT
  CHECK (audio_removed_reason IS NULL OR audio_removed_reason IN ('retention', 'deleted'));
