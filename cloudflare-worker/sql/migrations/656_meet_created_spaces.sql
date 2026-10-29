-- D1376: the Meet spaces Axal created for a member (Meet API spaces.create), so a
-- call made in Record a Session is attached for transcript import without a
-- Calendar event. One row per created space; the member's own only.
CREATE TABLE IF NOT EXISTS meet_created_spaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  meeting_code TEXT NOT NULL,
  space_name TEXT NOT NULL,
  join_url TEXT NOT NULL,
  auto_transcribe INTEGER NOT NULL DEFAULT 0,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_meet_created_spaces_user_code ON meet_created_spaces (user_id, meeting_code);
