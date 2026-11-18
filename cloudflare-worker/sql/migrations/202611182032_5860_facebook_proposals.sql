-- D5860 (#5860): one channel-link decision per venture and linked Facebook Page.
-- A dismissed row survives sync and relinking. Disconnect and Meta deletion purge it.
-- Acceptance reserves the decision before calling the existing channel writer.
-- accepted with decided_at NULL is recoverable work, not a completed decision.
CREATE TABLE IF NOT EXISTS facebook_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind = 'channel_link'),
  subject TEXT NOT NULL CHECK (length(subject) BETWEEN 1 AND 32),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'accepted', 'dismissed')),
  growth_channel_id INTEGER REFERENCES growth_channels(id) ON DELETE SET NULL,
  decided_by INTEGER REFERENCES users(id),
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, kind, subject)
);
CREATE INDEX IF NOT EXISTS idx_facebook_proposals_integration ON facebook_proposals (integration_id);
