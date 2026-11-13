-- D1484 part 2 (#3978, of #3723): a member's own calendar source settings.
--
-- `calendar_source_prefs` holds one row per source the member has changed:
-- whether it is shown on their calendar page and its colour. A colour is a
-- palette token (the page maps each to a light and a dark value), never hex.
-- A missing row means "shown, in its family's colour"; no default rows are
-- written. `source_key` is a registry kind (`services/calendar/registry.ts`),
-- or later 'external:google' / 'external:microsoft' (#3723 part 3).
--
-- `calendar_settings.copy_target` is where new Axal sessions are copied
-- (#3723 part 4 reads it; 'all' is today's behaviour).
--
-- The page read alone honours these: `.ics`, the subscription feeds and the
-- provider push ignore them. Additive only; the ledger runner applies it.
CREATE TABLE IF NOT EXISTS calendar_source_prefs (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_key TEXT    NOT NULL CHECK (length(source_key) BETWEEN 1 AND 64),
  shown      INTEGER NOT NULL DEFAULT 1 CHECK (shown IN (0, 1)),
  colour     TEXT CHECK (colour IS NULL OR colour IN ('violet', 'blue', 'teal', 'green', 'amber', 'orange', 'red', 'pink', 'slate')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, source_key)
);
CREATE TABLE IF NOT EXISTS calendar_settings (
  user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  copy_target TEXT NOT NULL DEFAULT 'all' CHECK (copy_target IN ('all', 'google', 'microsoft', 'none')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
