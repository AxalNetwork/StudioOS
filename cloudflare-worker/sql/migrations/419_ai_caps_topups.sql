-- D629: exact sub-cent AI accounting. One microusd = USD 0.000001.
-- No product, price, tier allowance or historical paid balance is invented.
CREATE TABLE IF NOT EXISTS ai_licence_caps (
  uid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  licence_key TEXT PRIMARY KEY NOT NULL,
  daily_microusd INTEGER NOT NULL CHECK(typeof(daily_microusd)='integer' AND daily_microusd BETWEEN 0 AND 9007199254740991),
  monthly_microusd INTEGER NOT NULL CHECK(typeof(monthly_microusd)='integer' AND monthly_microusd BETWEEN 0 AND 9007199254740991),
  recorded_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS ai_topup_accounts (
  uid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  user_id INTEGER PRIMARY KEY NOT NULL REFERENCES users(id),
  balance_microusd INTEGER NOT NULL DEFAULT 0 CHECK(typeof(balance_microusd)='integer' AND balance_microusd BETWEEN 0 AND 9007199254740991),
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS ai_included_spend (
  uid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  user_id INTEGER NOT NULL REFERENCES users(id),
  period_kind TEXT NOT NULL CHECK(period_kind IN ('day','month')), period_key TEXT NOT NULL,
  spend_microusd INTEGER NOT NULL CHECK(typeof(spend_microusd)='integer' AND spend_microusd BETWEEN 0 AND 9007199254740991),
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(user_id,period_kind,period_key)
);
CREATE TABLE IF NOT EXISTS ai_budget_reservations (
  uid TEXT NOT NULL UNIQUE PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id), day_key TEXT NOT NULL, month_key TEXT NOT NULL,
  included_microusd INTEGER NOT NULL CHECK(typeof(included_microusd)='integer' AND included_microusd BETWEEN 0 AND 9007199254740991),
  topup_microusd INTEGER NOT NULL CHECK(typeof(topup_microusd)='integer' AND topup_microusd BETWEEN 0 AND 9007199254740991),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','settled','refunded','review')),
  settlement_uid TEXT UNIQUE,
  actual_included_microusd INTEGER CHECK(actual_included_microusd IS NULL OR (typeof(actual_included_microusd)='integer' AND actual_included_microusd BETWEEN 0 AND included_microusd)),
  actual_topup_microusd INTEGER CHECK(actual_topup_microusd IS NULL OR (typeof(actual_topup_microusd)='integer' AND actual_topup_microusd BETWEEN 0 AND topup_microusd)),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK((status IN ('pending','review') AND settlement_uid IS NULL AND actual_included_microusd IS NULL AND actual_topup_microusd IS NULL) OR
    (status IN ('settled','refunded') AND settlement_uid IS NOT NULL AND actual_included_microusd IS NOT NULL AND actual_topup_microusd IS NOT NULL)),
  CHECK(status!='refunded' OR (actual_included_microusd=0 AND actual_topup_microusd=0))
);
CREATE INDEX IF NOT EXISTS idx_ai_reservations_user_state ON ai_budget_reservations(user_id,status,expires_at);
CREATE TABLE IF NOT EXISTS ai_topup_purchases (
  uid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  payment_intent_id TEXT PRIMARY KEY NOT NULL, order_ref TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id),
  price_id TEXT NOT NULL,
  credit_microusd INTEGER NOT NULL CHECK(typeof(credit_microusd)='integer' AND credit_microusd BETWEEN 1 AND 9007199254740991),
  expected_total_cents INTEGER NOT NULL CHECK(typeof(expected_total_cents)='integer' AND expected_total_cents BETWEEN 1 AND 9007199254740991),
  currency TEXT NOT NULL CHECK(currency='usd'), credited_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS ai_topup_ledger (
  uid TEXT NOT NULL UNIQUE PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK(kind IN ('credit','draw')),
  amount_microusd INTEGER NOT NULL CHECK(typeof(amount_microusd)='integer' AND amount_microusd BETWEEN 1 AND 9007199254740991),
  payment_intent_id TEXT UNIQUE REFERENCES ai_topup_purchases(payment_intent_id),
  reservation_uid TEXT UNIQUE REFERENCES ai_budget_reservations(uid),
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK((kind='credit' AND payment_intent_id IS NOT NULL AND reservation_uid IS NULL) OR
        (kind='draw' AND reservation_uid IS NOT NULL AND payment_intent_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_ai_topup_ledger_user ON ai_topup_ledger(user_id,created_at);
