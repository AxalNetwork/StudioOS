-- D6865 (#6865, the build of #6099's Grow v2 Feedback canvas): a feedback item
-- can name the contacts record of the person who gave it, and says where it came from.
--
--   product_feedback.contact_uid  the asker's `contacts.uid` in the same venture,
--                                 or NULL. The typed name, email and company
--                                 (from_name, from_email, from_company, 443/462)
--                                 stay as the fallback and are never cleared
--                                 by a link. The Worker checks the uid belongs
--                                 to the venture; a deleted contact reads
--                                 "Not linked", so no foreign key.
--   product_feedback.origin       where the item came from: inbox_reply,
--                                 interview, notion, posthog_survey or typed.
--                                 NULL on rows written before this migration,
--                                 which read "Not recorded".
--
-- Grep first (D689 D-t): no `contact_uid` or `origin` column exists on
-- product_feedback in schema_baseline.sql or any migration (443, 462,
-- 202611101053).
--
-- Additive: two ADD COLUMN and one index. NON-IDEMPOTENT (D1's ALTER TABLE has
-- no IF NOT EXISTS): the ledger runner applies it once.
ALTER TABLE product_feedback ADD COLUMN contact_uid TEXT;
ALTER TABLE product_feedback ADD COLUMN origin TEXT CHECK (origin IS NULL OR origin IN ('inbox_reply', 'interview', 'notion', 'posthog_survey', 'typed'));
CREATE INDEX IF NOT EXISTS idx_product_feedback_contact ON product_feedback(project_id, contact_uid) WHERE contact_uid IS NOT NULL;
