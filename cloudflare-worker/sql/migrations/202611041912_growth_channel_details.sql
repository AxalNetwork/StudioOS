-- D4486 (#4486): Distribution channel kind, purpose and venture-member owner.
-- NON-IDEMPOTENT ALTERs: apply once through the migration ledger.
-- Migration 462 already added kind with another vocabulary. Preserve every
-- original value; map only clear equivalents and leave other new kinds NULL.
ALTER TABLE growth_channels RENAME COLUMN kind TO legacy_kind;
ALTER TABLE growth_channels ADD COLUMN kind TEXT CHECK (kind IS NULL OR kind IN ('organic', 'ads', 'newsletter', 'outreach', 'signups', 'partner'));
UPDATE growth_channels SET kind = CASE legacy_kind
  WHEN 'content' THEN 'organic' WHEN 'paid_search' THEN 'ads'
  WHEN 'paid_social' THEN 'ads' WHEN 'outbound' THEN 'outreach'
  WHEN 'partner' THEN 'partner' ELSE NULL END;
ALTER TABLE growth_channels ADD COLUMN purpose TEXT CHECK (purpose IS NULL OR length(purpose) <= 140);
ALTER TABLE growth_channels ADD COLUMN owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
