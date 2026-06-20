-- Audience-first Brand & Landing — persist page audience, goal & template kit.
-- Additive-only, following the SAME convention as the sibling brand-kit column
-- migrations 079/080/081/082: plain ADD COLUMN here, with the worker lazy
-- bootstrap as the real self-healing path. D1/SQLite lacks ALTER TABLE …
-- ADD COLUMN IF NOT EXISTS, so replay-safety for prod is guaranteed by
-- ensureLandingPageBrandKitColumns in landingPageSchema.ts (each ALTER is
-- wrapped in try/catch). This file is applied once, in order.
--
-- NO CHECK on `audience`: it carries the full 6-audience taxonomy
-- (customer/investor/partner/advisor/mentor/cofounder), distinct from the
-- narrow 3-value `waitlist_signups.audience` CHECK added in migration 081.
-- Validation lives at the API layer (routes/brand.ts + backend/.../brand.py).
-- `template_kit` is the catalog id; the existing `template` column stays and
-- continues to hold the visual key (minimal/bold-hero/video-first/editorial/
-- product-mock) used for rendering.

ALTER TABLE landing_pages ADD COLUMN audience TEXT;
ALTER TABLE landing_pages ADD COLUMN goal TEXT;
ALTER TABLE landing_pages ADD COLUMN template_kit TEXT;
