-- Task #4 (Spin-Out Deck Brand Kit Branding) — extend the brand kit stored
-- on landing_pages to a full palette + typography pairing, so the Spin-Out
-- deck can auto-theme as the founder's "My brand kit" look.
--   palette_bg   — page/canvas background hex (#rrggbb)
--   palette_ink  — primary text hex (#rrggbb)
--   font_pairing — one of: editorial | modern | humanist | classic
-- Additive only. The worker carries a lazy bootstrap
-- (ensureLandingPageBrandKitColumns in services/landingPageSchema.ts) so the
-- columns self-heal on prod regardless of whether this file is applied.
ALTER TABLE landing_pages ADD COLUMN palette_bg TEXT;
ALTER TABLE landing_pages ADD COLUMN palette_ink TEXT;
ALTER TABLE landing_pages ADD COLUMN font_pairing TEXT;
