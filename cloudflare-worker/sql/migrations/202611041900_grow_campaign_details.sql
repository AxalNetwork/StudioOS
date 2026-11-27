-- D4483 (#4483): additions to D4447's campaign plans. Nothing sends or spends.
-- ALTERs are NOT IDEMPOTENT: apply once through the migration ledger.
ALTER TABLE grow_campaigns ADD COLUMN audience_kind TEXT CHECK (audience_kind IN ('icp','segment','import','none'));
ALTER TABLE grow_campaign_channels ADD COLUMN budget_type TEXT CHECK (budget_type IN ('daily','lifetime'));
ALTER TABLE grow_campaign_channels ADD COLUMN starts_on TEXT;
ALTER TABLE grow_campaign_channels ADD COLUMN ends_on TEXT;
CREATE TABLE IF NOT EXISTS grow_campaign_creatives (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  campaign_id INTEGER NOT NULL REFERENCES grow_campaigns(id) ON DELETE CASCADE,
  placement TEXT NOT NULL CHECK (placement IN ('google_search_text','youtube_16_9','meta_feed_4_5','x_promoted_post')),
  field TEXT NOT NULL CHECK (field IN ('headline','body','script')),
  text TEXT NOT NULL CHECK (length(text) <= 2000),
  updated_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (campaign_id, placement, field)
);
