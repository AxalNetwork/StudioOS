-- D1068 (#2938): the one handoff store (#2426 "Out and back in, per tool").
-- A row is StudioOS's record of the founder's own press of Send to…: who,
-- when, which plan items or which record, the target, the text's hash and the
-- markers planted in it. It is never a claim that the tool built anything.
-- #2398's Lovable launch link writes here too, with provider = 'lovable' and
-- no plan items, and has no table of its own.
--
-- prompt_text is readable by the venture's team only; logs keep the uid, the
-- provider and the hash, never the text. A Vercel import carries no text, so
-- its prompt_text, prompt_chars and text_hash are NULL (unknown, never 0).
-- marker holds the markers planted in the text, space-separated: one for a
-- GitHub issue (one row per item), one per item for a Lovable prompt or a
-- Notion page.
CREATE TABLE IF NOT EXISTS build_handoffs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('lovable', 'github', 'notion', 'vercel')),
  module TEXT,
  record_table TEXT,
  record_id TEXT,
  plan_item_uids TEXT NOT NULL DEFAULT '[]',
  target TEXT,
  prompt_text TEXT,
  prompt_chars INTEGER,
  text_hash TEXT,
  marker TEXT,
  opened_by INTEGER NOT NULL REFERENCES users(id),
  opened_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS build_handoffs_project ON build_handoffs(project_id, opened_at);
