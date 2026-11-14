-- D1505 (#3756, deck v2 A12): the image pipeline's record of each drawn image.
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
-- The deck's seed base and art direction are D1544's (`theme.art_direction`,
-- migration 735's PR), so no table holds them a second time.
--
-- Additive: ADD COLUMN and an index. No row is changed.
ALTER TABLE deck_images ADD COLUMN seed INTEGER;
ALTER TABLE deck_images ADD COLUMN steps TEXT;
ALTER TABLE deck_images ADD COLUMN prompt_sha256 TEXT;
ALTER TABLE deck_images ADD COLUMN pipeline_uid TEXT;
ALTER TABLE deck_images ADD COLUMN variant_index INTEGER;
ALTER TABLE deck_images ADD COLUMN qa_json TEXT;
ALTER TABLE deck_images ADD COLUMN provenance_json TEXT;
CREATE INDEX IF NOT EXISTS idx_deck_images_pipeline ON deck_images(pipeline_uid);
