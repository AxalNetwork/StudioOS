-- D5842 part 2 (#5842): a founder's explicit choice of one Search Console aggregate (D5842 part 1: the venture's
-- selected property, one whole Monday-Sunday week of final web-search data, one metric) as Raise evidence for one
-- claim. The side table D5842's "Left for part 2" names: `raise_evidence_items` has no revision column, and its
-- UNIQUE(project_id, area, source_table, source_ref) would make a corrected week reuse the same reference, so the
-- item stands on this row (source_ref `<uid>:<metric>`) and this row keeps the aggregate itself.
--
-- A selection keeps its own copy of what the founder chose (property, window, metric, value, unit, coverage, the
-- seven days' revisions and fingerprints, and part 1's keyed snapshot hash), so a pinned value stays intelligible to
-- the founder after Google corrects a day, access is revoked or the property is unselected. It never changes after
-- the choice (trigger below): a correction is a re-review, which writes a new selection that `replaces_id` the old
-- one. Only one selection of the same aggregate is current at a time. The evidence item it creates is an ordinary
-- `raise_evidence_items` row of kind `search-console-aggregate`, Private; sharing is the existing evidence sharing.
CREATE TABLE IF NOT EXISTS raise_search_console_selections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_ref TEXT NOT NULL,
  site_url TEXT NOT NULL,
  search_type TEXT NOT NULL DEFAULT 'web' CHECK (search_type IN ('web')),
  week_start TEXT NOT NULL,
  week_end TEXT NOT NULL,
  metric TEXT NOT NULL CHECK (metric IN ('clicks', 'impressions', 'ctr')),
  unit TEXT NOT NULL CHECK (unit IN ('count', 'ratio')),
  value REAL NOT NULL,
  numerator INTEGER,
  denominator INTEGER,
  days_reported INTEGER NOT NULL CHECK (days_reported BETWEEN 0 AND 7),
  days_not_returned INTEGER NOT NULL CHECK (days_not_returned BETWEEN 0 AND 7),
  revision_key TEXT NOT NULL,
  fingerprints TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  area TEXT NOT NULL,
  claim_id INTEGER REFERENCES raise_claims(id) ON DELETE SET NULL,
  item_id INTEGER REFERENCES raise_evidence_items(id) ON DELETE SET NULL,
  replaces_id INTEGER REFERENCES raise_search_console_selections(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'current' CHECK (status IN ('current', 'replaced', 'withdrawn')),
  selected_by INTEGER NOT NULL,
  selected_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  closed_by INTEGER,
  closed_at TEXT,
  closed_token TEXT
);
CREATE INDEX IF NOT EXISTS ix_raise_search_console_selections_project ON raise_search_console_selections(project_id, status, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_raise_search_console_selections_item ON raise_search_console_selections(item_id) WHERE item_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_raise_search_console_selections_current ON raise_search_console_selections(project_id, source_ref) WHERE status = 'current';

CREATE TRIGGER IF NOT EXISTS trg_raise_search_console_selection_fixed
BEFORE UPDATE OF uid, project_id, source_ref, site_url, search_type, week_start, week_end, metric, unit, value, numerator, denominator,
  days_reported, days_not_returned, revision_key, fingerprints, snapshot_hash, selected_by ON raise_search_console_selections
BEGIN SELECT RAISE(ABORT, 'raise_search_console_selections.fact: a pinned Search Console aggregate is never edited'); END;
