-- D1506 (#3757, A13 part 2): one stored copy per image per venture.
--
-- `sha256` is the hex SHA-256 of the bytes as stored: an upload's or an
-- outside image's after its metadata is stripped. A second upload of the same
-- picture, or a deck that names an outside image a venture already holds,
-- reuses that row instead of storing it again. A generated image keeps NULL:
-- each is its own run, and SQLite's UNIQUE treats every NULL as distinct.
--
-- `width` and `height` already exist (migration 543); uploads now fill them
-- from the header. Older rows keep NULL: nobody measured them.
ALTER TABLE deck_images ADD COLUMN sha256 TEXT
  CHECK (sha256 IS NULL OR (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'));

CREATE UNIQUE INDEX IF NOT EXISTS deck_images_project_sha256 ON deck_images(project_id, sha256);
