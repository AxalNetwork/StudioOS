-- D1505 (#3756, deck v2 A12): the image pipeline's record of each drawn image,
-- and the deck's one seed base and art direction.
--
-- Named by its UTC minute (D4106). The issue handed out 719 before that rule;
-- this file is the same change under the new name.
--
-- deck_images gains, for a generated image:
--   seed             the seed it was drawn with: hash(seed_base, card_uid, area, variant)
--   steps            the pipeline's step lines (JSON: step, status, charged_microusd, note)
--   prompt_sha256    the hash of the prompt drawn (the prompt itself stays in `prompt`)
--   pipeline_uid     the run's id, also on every ai_usage_logs.record_ref of it
--   variant_index    0-based, among the variants one press asked for
--   qa_json          the checks' answers (face, text, screen, on_style); a refused
--                    image keeps them with its discarded row
--   provenance_json  models, seed, prompt hash, size, and the XMP written into the file
--
-- deck_art: one row per venture, the seed base every image's seed starts from
-- and the art direction (style, palette, colours, optional reference) every
-- image area inherits. Written once, on the first drawn image.
--
-- Additive: ADD COLUMN and CREATE TABLE IF NOT EXISTS. No row is changed.
ALTER TABLE deck_images ADD COLUMN seed INTEGER;
ALTER TABLE deck_images ADD COLUMN steps TEXT;
ALTER TABLE deck_images ADD COLUMN prompt_sha256 TEXT;
ALTER TABLE deck_images ADD COLUMN pipeline_uid TEXT;
ALTER TABLE deck_images ADD COLUMN variant_index INTEGER;
ALTER TABLE deck_images ADD COLUMN qa_json TEXT;
ALTER TABLE deck_images ADD COLUMN provenance_json TEXT;
CREATE INDEX IF NOT EXISTS idx_deck_images_pipeline ON deck_images(pipeline_uid);

CREATE TABLE IF NOT EXISTS deck_art (
  project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  seed_base TEXT NOT NULL,
  art_direction_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
