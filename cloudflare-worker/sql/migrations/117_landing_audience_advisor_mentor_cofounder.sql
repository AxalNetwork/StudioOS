-- Per-audience copy overrides for the remaining 3 audiences — advisor, mentor,
-- co-founder. Mirrors the customer/partner/investor columns added in migration
-- 081, completing the full 6-audience taxonomy (see PAGE_AUDIENCE_SET in
-- routes/brand.ts). Additive-only; replay-safety on prod is guaranteed by
-- ensureLandingPageBrandKitColumns in landingPageSchema.ts (each ALTER wrapped
-- in try/catch — D1/SQLite has no ADD COLUMN IF NOT EXISTS). No CHECK; copy is
-- free text. The waitlist_signups.audience CHECK stays narrow on purpose.

ALTER TABLE landing_pages ADD COLUMN audience_advisor_headline TEXT;
ALTER TABLE landing_pages ADD COLUMN audience_advisor_body TEXT;
ALTER TABLE landing_pages ADD COLUMN audience_advisor_cta TEXT;
ALTER TABLE landing_pages ADD COLUMN audience_mentor_headline TEXT;
ALTER TABLE landing_pages ADD COLUMN audience_mentor_body TEXT;
ALTER TABLE landing_pages ADD COLUMN audience_mentor_cta TEXT;
ALTER TABLE landing_pages ADD COLUMN audience_cofounder_headline TEXT;
ALTER TABLE landing_pages ADD COLUMN audience_cofounder_body TEXT;
ALTER TABLE landing_pages ADD COLUMN audience_cofounder_cta TEXT;
