-- D5979 (#5979): section incident episodes and deduplicated observations.
CREATE TABLE IF NOT EXISTS section_incident_outbox (
  episode_id TEXT PRIMARY KEY NOT NULL,
  fingerprint TEXT NOT NULL,
  section_slug TEXT NOT NULL,
  impacted_sections TEXT NOT NULL DEFAULT '[]',
  occurrence_total INTEGER NOT NULL DEFAULT 0,
  checkpoint INTEGER NOT NULL DEFAULT 0,
  version TEXT,
  posted_version TEXT,
  recovered INTEGER NOT NULL DEFAULT 0,
  recovery_posted INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'sending', 'delivered', 'uncertain', 'exhausted')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_at INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER,
  claim_token TEXT,
  channel_id TEXT,
  message_ts TEXT,
  last_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_section_incident_due ON section_incident_outbox(state, next_at);
CREATE TABLE IF NOT EXISTS section_incident_observations (
  episode_id TEXT NOT NULL REFERENCES section_incident_outbox(episode_id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('occurrence', 'version', 'recovery')),
  PRIMARY KEY (episode_id, event_id)
);
