-- D1487 (#3724): owner-private event preferences, feedback and ranking vectors.
-- Event vectors stay in D1; they are never published to the search index.
ALTER TABLE events ADD COLUMN topics_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(topics_json) AND json_type(topics_json) = 'array');
CREATE TABLE IF NOT EXISTS event_rec_prefs (
 user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
 interests_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(interests_json)),
 goals_90d TEXT CHECK (goals_90d IS NULL OR length(goals_90d) <= 500),
 formats_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(formats_json)),
 types_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(types_json)),
 home_city TEXT,
 travel_km INTEGER CHECK (travel_km IS NULL OR travel_km BETWEEN 0 AND 20000),
 updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS event_rec_feedback (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
 verdict TEXT NOT NULL CHECK (verdict IN ('saved','not_for_me')),
 reason TEXT CHECK (reason IN ('topic','format','location','timing','other')),
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 UNIQUE(user_id,event_id)
);
CREATE INDEX IF NOT EXISTS idx_event_rec_feedback_user ON event_rec_feedback(user_id,verdict);
CREATE TABLE IF NOT EXISTS event_rec_vectors (
 event_id INTEGER PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
 vector BLOB NOT NULL,
 norm REAL NOT NULL CHECK (norm > 0),
 content_hash TEXT NOT NULL,
 updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS event_rec_member_vectors (
 user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 vector BLOB NOT NULL,
 norm REAL NOT NULL CHECK (norm > 0),
 content_hash TEXT NOT NULL,
 updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
