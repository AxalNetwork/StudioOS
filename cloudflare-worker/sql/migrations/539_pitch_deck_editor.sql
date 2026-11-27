-- 539 / D898 / #2676: what a pitch deck version records about itself, for the editor.
-- Assigned by S1 on #2676, 2026-10-24. Additive: four nullable columns, nothing backfilled.
--
-- `pitch_decks` keeps one row per version. The slides JSON already holds each
-- card; from D898 a card also carries its layout, notes, background and blocks
-- on the 12 × 6 grid (services/decks/slideModel.ts). These columns hold what
-- belongs to the whole version:
--
--   audience      who the version is written for (PD3): angel, pre_seed_fund,
--                 seed_fund, series_a_fund, strategic, grant or other.
--                 NULL is a version saved before D898, read "Not recorded".
--   round_ref     the `raise_rounds.uid` it was written for, of the same venture.
--   theme_json    the deck's theme (PD8): {"kind": "brand" | "neutral_light" |
--                 "neutral_dark", "background": {...} | null}. NULL is the
--                 venture's brand kit with no deck background.
--   content_hash  SHA-256 of the slides and theme as stored, lowercase hex, so
--                 two versions that read the same say so without a diff.
--
-- `created_by` already exists and is now returned, as the versions table's By.

ALTER TABLE pitch_decks ADD COLUMN audience TEXT CHECK (audience IS NULL OR audience IN ('angel', 'pre_seed_fund', 'seed_fund', 'series_a_fund', 'strategic', 'grant', 'other'));
ALTER TABLE pitch_decks ADD COLUMN round_ref TEXT;
ALTER TABLE pitch_decks ADD COLUMN theme_json TEXT;
ALTER TABLE pitch_decks ADD COLUMN content_hash TEXT CHECK (content_hash IS NULL OR (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'));
