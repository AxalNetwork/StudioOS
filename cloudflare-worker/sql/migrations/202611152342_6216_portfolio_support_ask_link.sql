-- D6216 (#6216): retain the originating ask through the support lifecycle.
ALTER TABLE portfolio_support_entries ADD COLUMN ask_uid TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_portfolio_support_ask_recorder
  ON portfolio_support_entries(ask_uid, recorded_by);
