-- D6424: owner chose a per-firm threshold, with no invented default.
CREATE TABLE deal_flow_attention_rules (
 company_id INTEGER PRIMARY KEY REFERENCES company_profiles(id) ON DELETE CASCADE,
 stale_after_days INTEGER CHECK(stale_after_days IS NULL OR (stale_after_days BETWEEN 1 AND 3650)),
 updated_by_user_id INTEGER NOT NULL REFERENCES users(id),
 updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
