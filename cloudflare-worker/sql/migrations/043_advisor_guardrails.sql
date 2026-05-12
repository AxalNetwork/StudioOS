-- Task #4 (AW) — Personal Advisor guardrails + scope lock.
--
-- Adds the columns + table needed by the 7-layer defence in
-- services/advisor/guardrails.ts. The route layer also runs lazy
-- PRAGMA-checks (`ensureGuardrailColumns()`, `ensureAuditSchema()`)
-- as a self-healing fallback so dev / un-migrated D1 still boots.
--
-- ALTER TABLE statements are NOT idempotent on D1 — re-runs will
-- fail at the first duplicate-column. Apply once via:
--   wrangler d1 execute studioos-db --remote \
--     --file=cloudflare-worker/sql/migrations/043_advisor_guardrails.sql

ALTER TABLE advisor_messages ADD COLUMN safety_score REAL;
ALTER TABLE advisor_messages ADD COLUMN sanitisation_actions_json TEXT;

ALTER TABLE users ADD COLUMN advisor_locked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN advisor_shadow_flag INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS advisor_turn_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  conversation_id INTEGER,
  model TEXT,
  -- 16-hex truncated SHA-256 of the canonical server-side system prompt.
  -- Lets us correlate audit rows across prompt revisions without
  -- storing the prompt itself.
  prompt_hash TEXT NOT NULL,
  -- JSON array of { name, args_summary, gate_result }.
  tool_calls_json TEXT,
  ai_spend_usd REAL NOT NULL DEFAULT 0,
  safety_score REAL,
  sanitisation_actions_json TEXT,
  -- Populated when the turn was refused: 'safety_block' | 'kill_switch' |
  -- 'shadow_flag' | 'destructive' | 'budget_*' | 'rate_limited'.
  refusal_reason TEXT,
  shadow_flagged INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_advisor_turn_audit_user    ON advisor_turn_audit(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_advisor_turn_audit_flagged ON advisor_turn_audit(shadow_flagged, created_at DESC);
