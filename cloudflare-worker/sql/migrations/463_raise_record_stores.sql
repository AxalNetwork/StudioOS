-- 463 — the stores behind Raise's records and Add forms (D691 S19-B, #1699).
--
-- Every Raise row opens one record (CO:375-381) and every Add opens a form
-- (CO:317-323). This adds a home for each field no store held, and #1700
-- builds the writes on it. Decision numbers are #1699's.
--
-- Grep first (D-t): no column below exists on its table in schema_baseline.sql
-- or in any earlier migration (`prospect_id` exists only on safe_issuances,
-- 410), and none of the six tables exists. migration_463_d691.test.ts holds
-- that as an assertion.
--
--   pitch_deck_share_tokens.prospect_id / investor_label (decision 5)
--     The investor a share link was made for: a prospect of the venture, or a
--     name typed in. NULL on a link made before 463, which reads "Link
--     created <day>" as today. The deck version is the link's deck_id row's
--     pitch_decks.version, so no deck_version column.
--
--   pitch_deck_share_tokens.allow_download / allow_forwarding / bound_viewer_hash
--     A link's two settings. Both default to 1, so a link made before 463, or
--     through /api/decks/:id/share, opens in any browser and offers Save as
--     PDF, as today. With forwarding off, the first open stores the hash of a
--     random cookie in bound_viewer_hash, and another browser is refused.
--
--   data_room_files.access_tier / access_expires_at (decision 6)
--     Who outside the founder sees a file: 'invited' (any active grant, the
--     rule every read applies today, and the default, so no file's reach
--     changes), 'committed' (the grant's investor is a committed prospect of
--     the venture, read from the pipeline, so no grant column) or 'nobody'.
--     access_expires_at hides the file after that date. The NDA gate stays.
--
--   data_room_files.dd_request_id (decision 6)
--     The diligence request a file answers, when it answers one. Without it
--     the record reads checklist_item (442).
--
--   data_room_file_versions
--     A file's earlier uploads, one row per version, so Replace keeps them.
--
--   raise_prospects.research_fund_uid (decision 10)
--     The fund from the Research directory a prospect is. No foreign key: the
--     directory is reloaded with INSERT OR REPLACE and pruned with DELETE (378,
--     429), which a foreign key would trip. Every read goes through
--     SERVED_FUNDS (D597).
--
--   raise_prospect_events / raise_prospect_feedback (decision 10)
--     A prospect's timeline (each meeting, intro, email, call or note, with
--     what is due) and the objections it raised, with the founder's answer.
--
--   narrative_version_meta (decision 7)
--     What a narrative version's words do not hold: where it started from,
--     "Why now" (no deck key holds it) and what it is checked against. The
--     words stay in spinout_deck_overrides rows of that version, and so does
--     the investor type (442).
--
--   use_of_funds_hires (decision 9)
--     The hires a use-of-funds section pays for. The split stays in
--     projects.use_of_funds, and runway and milestones go in
--     projects.use_of_funds_meta, so neither needs a column here.
--
-- Not added, each for its decision: pitch_deck_share_tokens.deck_version (5),
-- data_room_grants.tier (6), cap_table_holders.prospect_id (4) and
-- narrative_version_meta.investor_type (7).
--
-- Additive: ADD COLUMN with a NULL or constant default, and CREATE TABLE /
-- INDEX IF NOT EXISTS. No backfill: an older row genuinely has no value. No
-- BEGIN/COMMIT.

ALTER TABLE pitch_deck_share_tokens ADD COLUMN prospect_id INTEGER REFERENCES raise_prospects(id) ON DELETE SET NULL;
ALTER TABLE pitch_deck_share_tokens ADD COLUMN investor_label TEXT;
ALTER TABLE pitch_deck_share_tokens ADD COLUMN allow_download INTEGER NOT NULL DEFAULT 1 CHECK (allow_download IN (0, 1));
ALTER TABLE pitch_deck_share_tokens ADD COLUMN allow_forwarding INTEGER NOT NULL DEFAULT 1 CHECK (allow_forwarding IN (0, 1));
ALTER TABLE pitch_deck_share_tokens ADD COLUMN bound_viewer_hash TEXT;

ALTER TABLE data_room_files ADD COLUMN access_tier TEXT NOT NULL DEFAULT 'invited' CHECK (access_tier IN ('invited', 'committed', 'nobody'));
ALTER TABLE data_room_files ADD COLUMN access_expires_at TEXT;
ALTER TABLE data_room_files ADD COLUMN dd_request_id INTEGER REFERENCES dd_requests(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS data_room_file_versions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  uid          TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  file_id      INTEGER NOT NULL REFERENCES data_room_files(id) ON DELETE CASCADE,
  version      INTEGER NOT NULL,
  r2_key       TEXT NOT NULL,
  content_type TEXT,
  size_bytes   INTEGER,
  uploaded_by  INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (file_id, version)
);

ALTER TABLE raise_prospects ADD COLUMN research_fund_uid TEXT;

CREATE TABLE IF NOT EXISTS raise_prospect_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  uid         TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  prospect_id INTEGER NOT NULL REFERENCES raise_prospects(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('meeting', 'intro', 'email', 'call', 'note')),
  note        TEXT,
  due_on      TEXT,
  done_at     TEXT,
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_raise_prospect_events_prospect ON raise_prospect_events (prospect_id, created_at);

CREATE TABLE IF NOT EXISTS raise_prospect_feedback (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  uid         TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  prospect_id INTEGER NOT NULL REFERENCES raise_prospects(id) ON DELETE CASCADE,
  objection   TEXT NOT NULL,
  answer      TEXT,
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_raise_prospect_feedback_prospect ON raise_prospect_feedback (prospect_id);

CREATE TABLE IF NOT EXISTS narrative_version_meta (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  project_id         INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version            INTEGER NOT NULL,
  start_from         TEXT NOT NULL DEFAULT 'live' CHECK (start_from IN ('live', 'version', 'blank')),
  based_on_version   INTEGER,
  why_now            TEXT,
  check_against_json TEXT,
  created_by         INTEGER REFERENCES users(id),
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, version)
);

CREATE TABLE IF NOT EXISTS use_of_funds_hires (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  uid          TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  category_key TEXT NOT NULL CHECK (category_key IN ('product', 'go-to-market', 'infrastructure', 'operations', 'reserve')),
  role         TEXT NOT NULL,
  start_month  TEXT,
  annual_cents INTEGER,
  currency     TEXT NOT NULL DEFAULT 'usd',
  created_by   INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_use_of_funds_hires_project ON use_of_funds_hires (project_id, category_key);
