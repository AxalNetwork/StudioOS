-- 035_trust_center_pairwise_sanctions.sql — Task AH (Trust Center pairwise NDAs + sanctions)
--
-- This migration is fully idempotent (every statement is `CREATE … IF NOT
-- EXISTS`). It adds:
--   1. `sanctions_screenings` — per-user scan history (OFAC/EU/UK aggregate).
--      Source list payloads cache in KV (`sanctions:list:v1:*`); D1 only
--      records the per-user verdict + admin review trail.
--
-- The three new pairwise_ndas columns Task AH needs (`signers_json`,
-- `voided_at`, `voided_reason`) are intentionally NOT added here. D1's
-- `ALTER TABLE … ADD COLUMN` has no `IF NOT EXISTS` form and the
-- migration runner aborts on the first duplicate-column error, which
-- would brick re-runs and partial replays. Instead they are:
--   - Inlined in `cloudflare-worker/sql/schema.sql` so fresh provisions
--     get them at table-creation time, AND
--   - Lazily added by `ensureSanctionsSchema()` in
--     `cloudflare-worker/src/services/sanctions.ts` on the first request
--     against a stale D1 (per the "lazy bootstrap" pattern used by
--     `services/trust.ts`).
-- This way both fresh + already-deployed environments converge to the
-- same schema without an ordering-sensitive ALTER chain.

CREATE TABLE IF NOT EXISTS sanctions_screenings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  provider TEXT NOT NULL,                        -- 'ofac' | 'eu' | 'uk_hmt' | 'aggregate'
  run_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  hit INTEGER NOT NULL DEFAULT 0,                -- 1 if any list matched, else 0
  severity TEXT NOT NULL DEFAULT 'none',         -- none | review | block
  match_count INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT,                             -- raw matches array
  reviewed_by INTEGER,                           -- admin user_id who cleared/blocked
  reviewed_at TIMESTAMP,
  review_notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_sanctions_user      ON sanctions_screenings(user_id);
CREATE INDEX IF NOT EXISTS idx_sanctions_run_at    ON sanctions_screenings(run_at);
CREATE INDEX IF NOT EXISTS idx_sanctions_hit       ON sanctions_screenings(hit, run_at);
