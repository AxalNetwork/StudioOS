-- D5864 (#5864, part 2b of #2401) — the "Add TikTok as a channel" proposal.
--
-- A sync raises it when the venture has no Distribution channel whose
-- `utm_source` is 'tiktok'. Accept creates that `growth_channels` row through
-- the existing channel writer (`addChannel`, `services/growWriters.ts`); Dismiss
-- is final. `UNIQUE (project_id, kind, subject)` is what keeps a decided
-- proposal from returning: a re-sync inserts nothing over it.
--
-- `kind` is `add_channel` only. The owner chose no TikTok KPI (#2401 decision
-- H (a)), so there is no `track_kpi` kind. `subject` is the UTM source the
-- channel would carry ('tiktok').
--
-- Disconnect deletes the connection's proposals with its facts (decision E);
-- the channel an accepted proposal created is the venture's and stays.

CREATE TABLE IF NOT EXISTS tiktok_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('add_channel')),
  subject TEXT NOT NULL CHECK (length(subject) BETWEEN 1 AND 80),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'accepted', 'dismissed')),
  -- The channel Accept created; NULL until then, and NULL again if that channel is removed.
  growth_channel_id INTEGER REFERENCES growth_channels(id) ON DELETE SET NULL,
  decided_by INTEGER REFERENCES users(id),
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, kind, subject)
);
CREATE INDEX IF NOT EXISTS idx_tiktok_proposals_integration ON tiktok_proposals (integration_id);
