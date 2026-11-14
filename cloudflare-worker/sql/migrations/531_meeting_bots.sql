-- D886 B1 (#2579). Meeting links and runtime event content are encrypted.
CREATE TABLE IF NOT EXISTS meeting_bots (
  uid TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  session_id INTEGER NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK(platform IN ('zoom','google_meet','teams')),
  meeting_url_enc TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','joining','waiting_room','recording','processing','done','failed','stopped')),
  failure_code TEXT,
  scheduled_at INTEGER NOT NULL,
  started_at INTEGER,
  ended_at INTEGER,
  minutes INTEGER,
  participant_count INTEGER,
  heartbeat_at INTEGER,
  limit_minutes INTEGER NOT NULL CHECK(limit_minutes IN (30,120)),
  cost_per_minute_microusd INTEGER NOT NULL CHECK(cost_per_minute_microusd > 0),
  rate_per_minute_microusd INTEGER NOT NULL CHECK(rate_per_minute_microusd > 0),
  reservation_uid TEXT,
  settled_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS meeting_bots_active_session ON meeting_bots(session_id)
  WHERE status NOT IN ('done','failed','stopped');
CREATE INDEX IF NOT EXISTS meeting_bots_member ON meeting_bots(user_id,created_at);
-- A sequence is replayed without being applied again; names/timelines stay encrypted.
CREATE TABLE IF NOT EXISTS meeting_bot_events (
  run_uid TEXT NOT NULL REFERENCES meeting_bots(uid) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL,
  payload_enc TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  PRIMARY KEY(run_uid,seq)
);
