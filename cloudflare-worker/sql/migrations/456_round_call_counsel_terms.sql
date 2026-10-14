-- 456 — D686 #1594: counsel requests, structured key terms and commitment dates.
-- Additive. The round-call feature flag stays off; no approval/date backfill.
ALTER TABLE round_calls ADD COLUMN counsel_requested_at TEXT;
ALTER TABLE round_calls ADD COLUMN counsel_requested_by INTEGER REFERENCES users(id);
ALTER TABLE round_calls ADD COLUMN counsel_requested_hash TEXT;
ALTER TABLE round_calls ADD COLUMN valuation_cap_cents INTEGER CHECK (valuation_cap_cents IS NULL OR valuation_cap_cents > 0);
ALTER TABLE round_calls ADD COLUMN discount_bps INTEGER CHECK (discount_bps IS NULL OR discount_bps BETWEEN 1 AND 9000);
ALTER TABLE round_calls ADD COLUMN pre_money_cents INTEGER CHECK (pre_money_cents IS NULL OR pre_money_cents > 0);
ALTER TABLE round_call_recipients ADD COLUMN committed_at TEXT;
