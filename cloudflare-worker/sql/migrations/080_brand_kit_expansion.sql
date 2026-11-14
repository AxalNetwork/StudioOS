-- Task #3 (Brand Kit Expansion) — extend landing_pages with palette
-- secondary/accent + logo_asset_id for uploaded logos.
-- Additive, idempotent. The worker carries a lazy bootstrap so the columns
-- self-heal on prod regardless of whether this file is applied.
ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS palette_secondary TEXT;
ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS palette_accent TEXT;
ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS logo_asset_id TEXT;
