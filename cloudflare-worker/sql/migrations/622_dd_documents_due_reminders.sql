-- 622 — Due diligence part 4 (D1248, #3263): documents in the case, request
-- due dates, reminders and withdraw. Assigned to #3263 by S1 (part 4 of #2385).
--
-- dd_requests gains three columns:
--   due_date             — when the team asks for an answer, a calendar day
--                          (YYYY-MM-DD). NULL is "no due date", never a guess.
--   withdrawn_at         — when the team withdrew the request. A withdrawn
--                          request leaves the subject's page and takes no answer.
--   withdrawn_by_user_id — who withdrew it.
--
-- dd_item_evidence — what backs a checklist item: a file (a dd_attachments
--   row, uploaded to the item's section) or a link, who added it and when.
--   It follows the item's section for who may see it.
--
-- dd_request_reminders — each reminder sent to the subject, by whom and when.
--   It is the log the remind route reads to refuse a second one inside a day.
--
-- dd_downloads — the single-use download ledger. A row is one link, issued to
--   one caller, for one document, for two minutes. Only the SHA-256 of the
--   token is stored; the token itself is never written. `consumed_at` is set by
--   one conditional UPDATE, so a link opens once.
--
-- NO BACKFILL. A request written before this migration keeps due_date and
-- withdrawn_at NULL.
--
-- Grep first (D689 D-t): no `due_date`, `withdrawn_at` or
-- `withdrawn_by_user_id` column exists on `dd_requests` in an earlier
-- migration or in schema_baseline.sql (`dd_checklist_items.due_date` is
-- another table's), and no table of these three names exists.

ALTER TABLE dd_requests ADD COLUMN due_date TEXT
  CHECK (due_date IS NULL OR due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');
ALTER TABLE dd_requests ADD COLUMN withdrawn_at TEXT;
ALTER TABLE dd_requests ADD COLUMN withdrawn_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS dd_item_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  case_id INTEGER NOT NULL REFERENCES dd_cases(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES dd_checklist_items(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('file', 'link')),
  attachment_id INTEGER REFERENCES dd_attachments(id) ON DELETE CASCADE,
  url TEXT,
  label TEXT,
  added_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((kind = 'file' AND attachment_id IS NOT NULL AND url IS NULL)
      OR (kind = 'link' AND url IS NOT NULL AND attachment_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_dd_item_evidence_case ON dd_item_evidence(case_id, item_id);

CREATE TABLE IF NOT EXISTS dd_request_reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  case_id INTEGER NOT NULL REFERENCES dd_cases(id) ON DELETE CASCADE,
  request_id INTEGER NOT NULL REFERENCES dd_requests(id) ON DELETE CASCADE,
  sent_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dd_request_reminders_request ON dd_request_reminders(request_id, created_at);

CREATE TABLE IF NOT EXISTS dd_downloads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL UNIQUE,
  case_id INTEGER NOT NULL REFERENCES dd_cases(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('attachment', 'request_file')),
  target_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dd_downloads_case ON dd_downloads(case_id, created_at);
