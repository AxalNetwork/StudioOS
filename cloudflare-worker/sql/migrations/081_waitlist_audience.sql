-- Task #4 — Waitlist audience segmentation + private preview URL
-- Additive-only, IF NOT EXISTS per project conventions.

ALTER TABLE waitlist_signups ADD COLUMN audience TEXT CHECK (audience IN ('customer', 'partner', 'investor'));

ALTER TABLE landing_pages ADD COLUMN preview_token TEXT;
ALTER TABLE landing_pages ADD COLUMN audience_customer_headline TEXT;
ALTER TABLE landing_pages ADD COLUMN audience_customer_body TEXT;
ALTER TABLE landing_pages ADD COLUMN audience_customer_cta TEXT;
ALTER TABLE landing_pages ADD COLUMN audience_partner_headline TEXT;
ALTER TABLE landing_pages ADD COLUMN audience_partner_body TEXT;
ALTER TABLE landing_pages ADD COLUMN audience_partner_cta TEXT;
ALTER TABLE landing_pages ADD COLUMN audience_investor_headline TEXT;
ALTER TABLE landing_pages ADD COLUMN audience_investor_body TEXT;
ALTER TABLE landing_pages ADD COLUMN audience_investor_cta TEXT;

CREATE INDEX IF NOT EXISTS idx_landing_preview_token ON landing_pages(preview_token);
CREATE INDEX IF NOT EXISTS idx_waitlist_audience ON waitlist_signups(project_id, audience);
