-- D925 (#2721): retryable signed-deal activation and the paid plans it preserved.
ALTER TABLE partner_deals ADD COLUMN activation_error TEXT;
ALTER TABLE partner_deals ADD COLUMN activation_failed_at TEXT;
ALTER TABLE partner_deals ADD COLUMN activation_preserved_founder INTEGER NOT NULL DEFAULT 0;
ALTER TABLE partner_deals ADD COLUMN activation_preserved_investor INTEGER NOT NULL DEFAULT 0;
