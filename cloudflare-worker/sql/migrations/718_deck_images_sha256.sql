-- D1506 (#3757, deck v2 A13): an image is stored once per venture.
-- `deck_images` already has `width` and `height` (543); from this migration
-- the Worker fills them from the image's own header, never from the client.
-- `sha256` is the hash of the stored bytes, after their metadata is stripped,
-- and `UNIQUE(project_id, sha256)` holds one row per venture and picture. Rows
-- from before this migration keep a null hash, which the partial index leaves
-- out. Additive only; the ledger runner applies it.
ALTER TABLE deck_images ADD COLUMN sha256 TEXT CHECK (sha256 IS NULL OR length(sha256) = 64);
CREATE UNIQUE INDEX IF NOT EXISTS idx_deck_images_project_sha256 ON deck_images(project_id, sha256) WHERE sha256 IS NOT NULL;
