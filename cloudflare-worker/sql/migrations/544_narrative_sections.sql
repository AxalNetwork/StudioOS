-- 544 — D908 (#2692): the Investor narrative's own stores, part 2 of #2454.
--
-- A narrative version (D663 decision 7) is a set of `spinout_deck_overrides`
-- rows sharing a `version`, with its meta in `narrative_version_meta` (463).
-- Its words for a section with a deck key stay in that version's deck row, so
-- the deck and the narrative never disagree about one sentence. These three
-- tables hold what had no home.
--
--   narrative_sections
--     One row per (venture, version, section): the section's place, the
--     audience note, and where its words came from. `body` holds the words of
--     a section the deck has no key for (Solution, Business model, Team); for
--     a section with a deck key it stays NULL, because the words are the deck
--     row's; for Why now it stays NULL, because the words are
--     `narrative_version_meta.why_now`. Version 0 is the live deck and has no
--     row here.
--
--   narrative_positioning
--     The venture's core positioning (`version` NULL), and a version's own
--     wording for a field it adjusts (`version` set). A field a version does
--     not adjust reads the core. `line` may hold several, by `position`; every
--     other kind holds one, at position 0.
--
--   narrative_bindings
--     A figure bound into a section: the same five fields a Pitch deck binding
--     carries (D896, `services/decks/sources.ts`), so one compare reads both.
--
-- The provenance columns are #2431's contract, as written there:
-- `source_kind` is eadwyn, connector or module, NULL for words typed by hand;
-- `source_label` is connector, document, recorded, signed or typed, NULL for
-- an Eadwyn value; `prior_value`, `undone_at` and `undone_by` let a fill be
-- undone.
--
-- Additive: three new tables and their indexes, nothing backfilled, no row of
-- an earlier table changed.

CREATE TABLE IF NOT EXISTS narrative_sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  version INTEGER NOT NULL CHECK (version >= 1),
  section TEXT NOT NULL,
  -- The section's place in the story; NULL keeps the default order.
  position INTEGER,
  body TEXT,
  audience_note TEXT,
  source_kind TEXT CHECK (source_kind IS NULL OR source_kind IN ('eadwyn', 'connector', 'module')),
  source_ref TEXT,
  source_label TEXT CHECK (source_label IS NULL OR source_label IN ('connector', 'document', 'recorded', 'signed', 'typed')),
  prior_value TEXT,
  undone_at TEXT,
  undone_by INTEGER REFERENCES users(id),
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_narrative_sections_version_section
  ON narrative_sections(project_id, version, section);

CREATE TABLE IF NOT EXISTS narrative_positioning (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  -- NULL is the venture's core positioning; a number is that version's own.
  version INTEGER CHECK (version IS NULL OR version >= 1),
  kind TEXT NOT NULL CHECK (kind IN ('one_liner', 'elevator', 'line', 'category', 'wedge', 'for_whom', 'instead_of')),
  position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  text TEXT NOT NULL,
  source_kind TEXT CHECK (source_kind IS NULL OR source_kind IN ('eadwyn', 'connector', 'module')),
  source_ref TEXT,
  source_label TEXT CHECK (source_label IS NULL OR source_label IN ('connector', 'document', 'recorded', 'signed', 'typed')),
  prior_value TEXT,
  undone_at TEXT,
  undone_by INTEGER REFERENCES users(id),
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- One row per field and place, the core (version NULL) counted as 0.
CREATE UNIQUE INDEX IF NOT EXISTS uq_narrative_positioning_field
  ON narrative_positioning(project_id, COALESCE(version, 0), kind, position);

CREATE TABLE IF NOT EXISTS narrative_bindings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  version INTEGER NOT NULL CHECK (version >= 1),
  section TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  -- D896's binding: the store's item, its record, its date, its grade and the hash of what was bound.
  source_key TEXT NOT NULL,
  record_ref TEXT,
  as_of TEXT,
  grade TEXT NOT NULL CHECK (grade IN ('Measured', 'Reviewed', 'Sourced', 'Stated')),
  snapshot_hash TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_narrative_bindings_section
  ON narrative_bindings(project_id, version, section, position);
