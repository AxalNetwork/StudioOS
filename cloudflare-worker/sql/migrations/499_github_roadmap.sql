-- 499 — GitHub feeds Product roadmap: milestones and releases (D782, #2111).
--
-- An issue already lands as a `roadmap_okrs` item through the
-- `connector_fed_items` ledger (D655, migration 445). This adds what its
-- milestone and the repository's releases need. Additive only: no backfill,
-- because an older row genuinely has no milestone and no release. No
-- BEGIN/COMMIT.
--
-- Grep first (D-t): no column below exists on `roadmap_okrs` in
-- schema_baseline.sql or in any earlier migration, and no table named
-- `roadmap_releases` exists. `target_date` already exists (migration 441), so
-- a milestone's due date is written there and is not added again.
-- github_roadmap_d782.test.ts holds that as an assertion.
--
--   roadmap_okrs.milestone_title / milestone_due
--     The GitHub milestone an item's issue sits in: its title is the item's
--     group on the module ("From GitHub"), and its due date the group's
--     target. A milestone with no due date leaves `milestone_due` NULL.
--
--   roadmap_okrs.shipped_release_id
--     The release that shipped the item, set only on evidence
--     (`integrations/providers/github/roadmap.ts` names the rule). A deleted
--     release clears it.
--
--   roadmap_releases
--     One row per GitHub release, for the project the connection syncs into.
--     Written only by the sync, through the ledger: a re-sync updates the row
--     and a deleted row stays deleted.

ALTER TABLE roadmap_okrs ADD COLUMN milestone_title TEXT;
ALTER TABLE roadmap_okrs ADD COLUMN milestone_due TEXT;

CREATE TABLE IF NOT EXISTS roadmap_releases (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  repository   TEXT NOT NULL,
  tag          TEXT NOT NULL,
  name         TEXT,
  published_at TEXT,
  url          TEXT,
  prerelease   INTEGER NOT NULL DEFAULT 0 CHECK (prerelease IN (0, 1)),
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_roadmap_releases_project ON roadmap_releases(project_id, published_at);

ALTER TABLE roadmap_okrs ADD COLUMN shipped_release_id INTEGER REFERENCES roadmap_releases(id) ON DELETE SET NULL;
