-- D6788: resolutions belong to one held meeting, never to its mutable next due date.
CREATE TABLE IF NOT EXISTS board_resolutions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  event_id INTEGER NOT NULL REFERENCES compliance_events(id) ON DELETE CASCADE,
  occurrence_uid TEXT NOT NULL REFERENCES obligation_occurrences(uid) ON DELETE CASCADE,
  held_on TEXT NOT NULL CHECK (length(held_on) = 10 AND held_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  text TEXT NOT NULL CHECK (length(trim(text)) BETWEEN 1 AND 2000),
  passed_on TEXT NOT NULL CHECK (length(passed_on) = 10 AND passed_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  recorded_by INTEGER NOT NULL REFERENCES users(id),
  minutes_file_key TEXT,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_board_resolutions_event_meeting
  ON board_resolutions(event_id, held_on DESC, id DESC);
