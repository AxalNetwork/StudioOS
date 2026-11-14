-- D1590 (#3837, deck v2 F11): the recorded walkthrough.
--
-- `deck_recordings`: one row per take of one card of a deck version, by its
-- maker. The camera-and-microphone take is in R2 (`media_r2_key`); the
-- captions are the Listen job's timed cues for that take, in milliseconds from
-- its start. A card's newest take is the one shown; a retake removes the
-- card's earlier takes, row and object, and never another card's.
--
-- Owner decision W = A (2026-11-02): kept until its maker deletes it, or its
-- deck version or account goes (the cascades below). No automatic expiry. A
-- delete removes the R2 object, not only the row; a row that leaves by a
-- cascade leaves its object to the daily orphan sweep
-- (services/decks/recordings.ts `sweepOrphanRecordings`).
--
-- `deck_recording_links`: which share links play the walkthrough. Attaching is
-- per link ("Attach to [Fund]'s link"); the link plays every card's newest take.
CREATE TABLE IF NOT EXISTS deck_recordings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  deck_id INTEGER NOT NULL REFERENCES pitch_decks(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card INTEGER NOT NULL CHECK (card >= 1),
  take INTEGER NOT NULL CHECK (take >= 1),
  duration_ms INTEGER NOT NULL CHECK (duration_ms > 0),
  media_r2_key TEXT NOT NULL,
  media_mime TEXT NOT NULL,
  media_bytes INTEGER NOT NULL CHECK (media_bytes > 0),
  captions_json TEXT,
  caption_model TEXT,
  ai_usage_log_id INTEGER,
  charged_microusd INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (deck_id, user_id, card, take)
);
CREATE INDEX IF NOT EXISTS idx_deck_recordings_deck ON deck_recordings (deck_id, user_id, card, take);
CREATE INDEX IF NOT EXISTS idx_deck_recordings_project ON deck_recordings (project_id);

CREATE TABLE IF NOT EXISTS deck_recording_links (
  share_token_id INTEGER PRIMARY KEY,
  deck_id INTEGER NOT NULL REFERENCES pitch_decks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  attached_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_deck_recording_links_deck ON deck_recording_links (deck_id, user_id);
