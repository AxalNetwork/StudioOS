-- 648 — Eadwyn's email drafts (D1341, #3549; part 2 of #3547).
--
-- One row per draft and per revision: a revision is a new row whose
-- `parent_uid` names the draft it revised, so every version stays. A draft
-- needs no mailbox (#3548 sends it).
--
-- `person_ref` is `kind:id` (an interviewee, a prospect, a co-founder, an
-- advisor or partner engagement, a growth partner); `refs_json` is the refs
-- the member ticked, the only records the prompt carried; `blocks_json` is the
-- live update blocks inserted, each with its `as_of`. The cost is the router's
-- receipt for the run, in micro-USD, as `ai_usage_logs` holds it.
--
-- Additive: CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS mail_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  person_ref TEXT NOT NULL,
  intent TEXT NOT NULL,
  tone TEXT NOT NULL CHECK (tone IN ('warm', 'direct', 'formal')),
  length TEXT NOT NULL CHECK (length IN ('short', 'medium', 'long')),
  refs_json TEXT NOT NULL DEFAULT '[]',
  blocks_json TEXT NOT NULL DEFAULT '[]',
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  parent_uid TEXT,
  instruction TEXT,
  model TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  cost_micro_usd INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mail_drafts_user ON mail_drafts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mail_drafts_parent ON mail_drafts(parent_uid);
