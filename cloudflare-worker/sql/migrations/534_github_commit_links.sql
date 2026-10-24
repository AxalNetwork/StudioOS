-- D782 / #2414: retain exact GitHub commit evidence for deployment joins.
-- Existing rows remain NULL until GitHub resync; no guessed backfill.
ALTER TABLE mvp_features ADD COLUMN merge_commit_sha TEXT;
ALTER TABLE roadmap_releases ADD COLUMN commit_sha TEXT;
