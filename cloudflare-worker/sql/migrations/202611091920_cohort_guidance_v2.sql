-- D4813 (#4813, package 2): guidance titles, drafts, versions and edit history.
--
-- Migration 212 stored a body, a week and a retirement stamp. The Cohorts v2
-- composer (canvas boards C5, C6, C14) needs four more facts, all additive:
--
--   title     what the guidance is called. NULLABLE: every row written before
--             this migration has none, and inventing one from the body would
--             put words in the advisor's mouth. The page shows the body's first
--             line for a row without a title.
--   is_draft  1 while the advisor is still writing it. A draft is read only by
--             its author; it is never counted as posted, never shown as
--             activity and never reaches a founder. Existing rows were all
--             posted, so the default is 0 (published).
--   version   bumped by every change (edit, publish, retire, restore, answer).
--             A write names the version it was made against; a write against an
--             older one is refused with 409, so two tabs never overwrite each
--             other silently. Existing rows start at 1.
--
-- STATUS IS STILL DERIVED, as 212 says it should be: retired when
-- `retired_at` is set, else draft when `is_draft = 1`, else published. A stored
-- status would disagree with those the first time one of them is edited.
--
-- `cohort_guidance_versions` is the edit history, append-only: one row per
-- version, holding what the guidance said at that version and what was done.
-- UNIQUE (guidance_id, version) makes a second writer of the same version fail
-- rather than fork the history. Existing rows are backfilled as version 1,
-- action 'backfilled', so every row has a history from where it stands today.
--
-- Acknowledgements stay in 212's `cohort_guidance_acks`. Nothing writes them
-- yet (no founder surface exists), and the page says so rather than counting 0.

ALTER TABLE cohort_guidance ADD COLUMN title TEXT;
ALTER TABLE cohort_guidance ADD COLUMN is_draft INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cohort_guidance ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS cohort_guidance_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guidance_id INTEGER NOT NULL REFERENCES cohort_guidance(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    -- created | edited | published | retired | restored | answered | backfilled
    action TEXT NOT NULL,
    title TEXT,
    body TEXT NOT NULL,
    week_number INTEGER,
    is_draft INTEGER NOT NULL DEFAULT 0,
    actor_user_id INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (guidance_id, version)
);

CREATE INDEX IF NOT EXISTS idx_cohort_guidance_versions_guidance
    ON cohort_guidance_versions (guidance_id, version);

INSERT OR IGNORE INTO cohort_guidance_versions
    (guidance_id, version, action, title, body, week_number, is_draft, actor_user_id, created_at)
SELECT id, 1, 'backfilled', NULL, body, week_number, 0, advisor_user_id, posted_at
  FROM cohort_guidance;
