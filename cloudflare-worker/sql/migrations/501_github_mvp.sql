-- 501 — GitHub feeds Prototype / MVP: a must-have follows its pull request,
-- and each release records an MVP release check (D782, #2112).
--
-- A pull request already lands as an `mvp_features` must-have through the
-- `connector_fed_items` ledger (D655, migration 445), and `mvp_release_checks`
-- already holds a must-have's release checklist (461). This adds what the
-- pull request's state and the release need. Additive only: no backfill,
-- because an older row genuinely has no pull request state and no release.
-- No BEGIN/COMMIT.
--
-- Grep first (D-t): no column below exists on its table in
-- schema_baseline.sql or in any earlier migration. `delivery_status` (153),
-- `is_must_have` and `done_at` (441) already exist, so the state is written
-- there and not added again. github_mvp_d782.test.ts holds that as an
-- assertion.
--
--   mvp_features.pr_state
--     GitHub's state for a fed must-have: planned (draft), in_progress (open),
--     in_review (review requested or approved), built (merged) or dropped
--     (closed unmerged). The sync writes `delivery_status` from it only when
--     it changes, so a founder's own edit, an undone Dropped among them,
--     stands until GitHub's state moves again.
--
--   mvp_features.pr_url
--     The pull request's page on github.com.
--
--   mvp_release_checks.release_id / in_release
--     The release a check is for (`roadmap_releases`, 499), and whether the
--     must-have is in it (1) or was still open when it was published (0). A
--     founder's own check has neither.

ALTER TABLE mvp_features ADD COLUMN pr_state TEXT CHECK (pr_state IS NULL OR pr_state IN ('planned', 'in_progress', 'in_review', 'built', 'dropped'));
ALTER TABLE mvp_features ADD COLUMN pr_url TEXT;

ALTER TABLE mvp_release_checks ADD COLUMN release_id INTEGER REFERENCES roadmap_releases(id) ON DELETE SET NULL;
ALTER TABLE mvp_release_checks ADD COLUMN in_release INTEGER CHECK (in_release IS NULL OR in_release IN (0, 1));
