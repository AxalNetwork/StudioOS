-- D8259 (#8259, Build v2 BD28, the brief's Q3 answer A): "Not now" on a suggested filing.
--
-- Company creation offers a founder the filings of Axal's US Delaware pack
-- for their company's jurisdiction (`services/suggestedFilings.ts`). "Not now"
-- hides one suggestion for this venture and stays: the row is the record of
-- that choice. The suggestion's key is the pack rule's own key
-- (`<pack>:<event_type>`, as `entity_obligations.pack_key` names it), so a
-- dismissal is one row per venture and suggestion, and a second "Not now" is a
-- no-op (the UNIQUE key). Nothing else is stored: a suggestion that was added
-- is a filing, and the read recognises it as one.
--
-- Expand only: one new table and its index. The venture's erasure removes it
-- with the project row (ON DELETE CASCADE).

CREATE TABLE IF NOT EXISTS company_filing_suggestion_dismissals (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  suggestion_key TEXT    NOT NULL CHECK (length(suggestion_key) BETWEEN 3 AND 64),
  dismissed_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  dismissed_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, suggestion_key)
);
