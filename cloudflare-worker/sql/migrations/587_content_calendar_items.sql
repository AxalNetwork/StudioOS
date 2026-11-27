-- 587 — Distribution's content calendar (D1090, #2955; part 6 of #2405).
--
-- A planned piece: an idea, planned, scheduled, published or dropped. It is a
-- plan, never a record of what was sent: #2400 (plan versus send) links a
-- `publish_drafts` row to it through its own `calendar_item_id`, and nothing
-- here reads or writes #2400's tables.
--
-- Typed by hand (`source = 'manual'`, POST /api/cycles/grow/channels/content)
-- or fed by a founder's Notion database (`source = 'notion'`, linked through
-- `connector_fed_items`). A Notion sync only ever updates a row its own ledger
-- links, so it never edits a typed item. A channel is a `growth_channels` row
-- of the same venture, or none: deleting the channel leaves the item.
--
-- Additive: CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS content_calendar_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  channel_id INTEGER REFERENCES growth_channels(id) ON DELETE SET NULL,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  planned_on TEXT,
  status TEXT NOT NULL DEFAULT 'idea' CHECK (status IN ('idea', 'planned', 'scheduled', 'published', 'dropped')),
  url TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'notion')),
  created_by INTEGER REFERENCES users(id),
  updated_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_content_calendar_items_project ON content_calendar_items(project_id, planned_on);
