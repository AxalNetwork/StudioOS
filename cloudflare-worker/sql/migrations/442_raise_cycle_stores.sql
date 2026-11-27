-- 442 — the Raise cycle's stores (D663, #1476), read by /api/cycles/raise.
--
-- The Raise overview and its seven module pages draw from stores that mostly
-- exist (the raise pipeline, the cap table, the data room, the deck share
-- views, use of funds). This adds what had no home.
--
--   readiness_items / readiness_scores
--     Fundraising readiness: each item (narrative, deck, data room, cap table,
--     use of funds, traction, team) and every score it was given, out of 10,
--     with its evidence strength, what is missing, and whether a person or the
--     computed check gave it. The history is the readiness-over-time line.
--     The Lab's browser-only data-room readiness and diligence gates become
--     the computed scores, so a Lab venture and a founder see the same.
--
--   spinout_deck_overrides.version / investor_type / deck_version
--     Investor narrative versions live on the deck wording overrides (one
--     store, not a parallel one). version 0 is the live wording the deck
--     reads, exactly as before; a saved version copies it to version N with
--     the investor type it was written for and the deck version it went with.
--     The unique key gains `version` so a field can hold one value per version.
--
--   narrative_checks
--     The consistency check's findings for a saved version: each figure the
--     narrative or deck states (MRR, paying customers, the raise) that differs
--     from the stored metric, with both values and both sources. Computed,
--     never written by an LLM.
--
--   deck_view_slides
--     Seconds a share-link view spent on each slide. The viewer's heartbeat
--     sends the slide it is on; the Worker never lets a view's slides add up
--     to more than its `read_seconds`.
--
--   data_room_files.checklist_item
--     Which diligence-checklist item a file answers (a fixed list in
--     services/raiseCycle.ts). NULL means not mapped.
--
--   raise_prospects.next_step / next_step_due / warm_path
--     The next step with a prospect, when it is due, and who can introduce.
--     A prospect's last contact is read from its stored contact
--     (contacts.last_activity_at through contact_id), never stored or guessed.
--
-- Additive: CREATE TABLE IF NOT EXISTS and ADD COLUMN. The one index swap on
-- spinout_deck_overrides keeps every existing row (all become version 0).

CREATE TABLE IF NOT EXISTS readiness_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    item_key TEXT NOT NULL,
    label TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_readiness_items_project_key ON readiness_items(project_id, item_key);

CREATE TABLE IF NOT EXISTS readiness_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL REFERENCES readiness_items(id) ON DELETE CASCADE,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 10),
    evidence TEXT NOT NULL CHECK (evidence IN ('anecdote', 'pattern', 'measured')),
    missing TEXT,
    source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'computed')),
    scored_by INTEGER REFERENCES users(id),
    scored_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_readiness_scores_project ON readiness_scores(project_id, scored_at);
CREATE INDEX IF NOT EXISTS idx_readiness_scores_item ON readiness_scores(item_id, scored_at);

ALTER TABLE spinout_deck_overrides ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE spinout_deck_overrides ADD COLUMN investor_type TEXT;
ALTER TABLE spinout_deck_overrides ADD COLUMN deck_version INTEGER;
DROP INDEX IF EXISTS idx_spinout_deck_overrides_project_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_spinout_deck_overrides_project_key_version
    ON spinout_deck_overrides(project_id, field_key, version);

CREATE TABLE IF NOT EXISTS narrative_checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    figure TEXT NOT NULL,
    stated_value REAL NOT NULL,
    stated_source TEXT NOT NULL,
    metric_value REAL NOT NULL,
    metric_source TEXT NOT NULL,
    checked_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_narrative_checks_project_version ON narrative_checks(project_id, version);

CREATE TABLE IF NOT EXISTS deck_view_slides (
    view_id INTEGER NOT NULL REFERENCES deck_share_views(id) ON DELETE CASCADE,
    slide_index INTEGER NOT NULL CHECK (slide_index BETWEEN 0 AND 199),
    seconds INTEGER NOT NULL DEFAULT 0 CHECK (seconds >= 0),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (view_id, slide_index)
);

ALTER TABLE data_room_files ADD COLUMN checklist_item TEXT;

ALTER TABLE raise_prospects ADD COLUMN next_step TEXT;
ALTER TABLE raise_prospects ADD COLUMN next_step_due TEXT;
ALTER TABLE raise_prospects ADD COLUMN warm_path TEXT;
