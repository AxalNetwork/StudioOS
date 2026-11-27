-- #4375 (D4375): HQ takes down one deck image.
--
-- taken_down_at marks the row taken down; taken_down_by names the admin and
-- taken_down_reason keeps why (required, at most 1000 characters). The R2
-- object is deleted by the route; the row stays, with its r2_key, as the
-- record of what was removed, so the file route answers the neutral
-- placeholder ("Image removed by Axal HQ") for every card, version, draft or
-- export that still names the image, and the daily sweep never removes it.
-- Additive; no transaction statements (D1 rejects them).
ALTER TABLE deck_images ADD COLUMN taken_down_at TEXT;
ALTER TABLE deck_images ADD COLUMN taken_down_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE deck_images ADD COLUMN taken_down_reason TEXT CHECK (taken_down_reason IS NULL OR length(taken_down_reason) BETWEEN 1 AND 1000);
CREATE INDEX IF NOT EXISTS idx_deck_images_taken_down ON deck_images(taken_down_at) WHERE taken_down_at IS NOT NULL;
