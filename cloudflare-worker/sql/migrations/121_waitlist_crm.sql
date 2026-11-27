-- Task #5 — Waitlist Customers in Customer Discovery (lightweight CRM layer).
-- Adds per-signup CRM state to waitlist_signups so founders can track which
-- customer-audience signups they have invited, followed up with, or promoted
-- to a discovery interview.
--   crm_status            : 'new' | 'invited' | 'followed_up' | 'promoted'
--                           (monotonic precedence new<invited<followed_up<promoted;
--                            the *_at timestamps below are independent activity marks)
--   invited_at            : last product-invitation email send (ISO-8601)
--   followed_up_at        : last follow-up email send (ISO-8601)
--   promoted_at           : when the signup was promoted to an interview
--   promoted_interview_id : the discovery_interviews row created on promote
-- Additive-only; replay-safety on prod is guaranteed by
-- ensureWaitlistCrmColumns() in services/waitlistCrmSchema.ts (each ALTER is
-- PRAGMA-guarded — D1/SQLite has no ADD COLUMN IF NOT EXISTS).

ALTER TABLE waitlist_signups ADD COLUMN crm_status TEXT DEFAULT 'new';
ALTER TABLE waitlist_signups ADD COLUMN invited_at TEXT;
ALTER TABLE waitlist_signups ADD COLUMN followed_up_at TEXT;
ALTER TABLE waitlist_signups ADD COLUMN promoted_at TEXT;
ALTER TABLE waitlist_signups ADD COLUMN promoted_interview_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_waitlist_crm ON waitlist_signups(project_id, crm_status);
