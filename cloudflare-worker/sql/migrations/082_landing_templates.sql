-- Task #5 — Landing page template library (5 layouts)
-- Add template choice and media fields to landing_pages.
-- Additive only; worker carries lazy bootstrap for self-healing.
ALTER TABLE landing_pages ADD COLUMN template TEXT;
ALTER TABLE landing_pages ADD COLUMN hero_media_url TEXT;
ALTER TABLE landing_pages ADD COLUMN product_screenshot_url TEXT;

-- Default existing rows to the minimal template (the original layout).
UPDATE landing_pages SET template = 'minimal' WHERE template IS NULL;
