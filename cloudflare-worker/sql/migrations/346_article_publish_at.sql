-- D484 (#1025) — an approved article can carry the time it is meant to go out.
--
-- Until now "Scheduled" on HQ · Content (H6) meant only "approved": publishing
-- was a manual step and nothing stored when a piece should go out.
--
-- `publish_at`: ISO-8601 UTC, set on an APPROVED article by
-- `POST /api/admin/articles/:id/schedule`. NULL is "no time set", and the
-- article waits for someone to publish it by hand, as before. The per-minute
-- cron publishes an approved article once its time has passed, through the
-- same path the manual publish uses.
-- `publish_at_set_by`: the admin who set the time. The cron's publish is
-- recorded in the article's revisions as theirs, because it is their decision
-- carried out later.
--
-- Unpublishing returns an article to `approved` and clears both, so it is not
-- published again the next minute.
ALTER TABLE articles ADD COLUMN publish_at TEXT;
ALTER TABLE articles ADD COLUMN publish_at_set_by INTEGER;

CREATE INDEX IF NOT EXISTS idx_articles_publish_due ON articles(status, publish_at);
