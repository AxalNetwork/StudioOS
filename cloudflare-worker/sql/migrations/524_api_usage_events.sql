-- 524 — api_usage_events: one attributable row per MCP tool call and
-- API-key request (D843, #2465; part of #2463).
--
-- Each row says who made the call (user, and the API key or the OAuth grant
-- and client), on which company, what operation it was, how long it took and
-- how it ended. `execution_id` is the id the call's result hands back in
-- `_meta`, so a member can quote it.
--
-- WHAT IS NEVER HERE: an argument, a result, a secret or a key. `operation`
-- is the tool's name; `client` is the OAuth client's display name.
--
-- UNKNOWN IS NULL, never 0. `reservation_uid`, `held_microusd`,
-- `charged_microusd`, `model`, `provider` and `connector` stay NULL until
-- metering (#2466), the providers (#2474) or a connector fills them; NULL
-- means "not metered", which a report must not add up as nothing spent.
-- Money is integer micro-USD, as in `ai_usage_logs`.
--
-- `error_category` is one of a fixed list (D843), set when the outcome is
-- not `ok`. `api_key_uid` is the member's key (#2464) and `grant_id` the OAuth
-- grant; a call has at most one of the two.
--
-- Additive. No read route here: #2471 adds the reads, with tenant checks.
CREATE TABLE IF NOT EXISTS api_usage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  execution_id TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL,
  api_key_uid TEXT,
  grant_id TEXT,
  client TEXT,
  company_id INTEGER,
  surface TEXT NOT NULL CHECK (surface IN ('mcp', 'api')),
  operation TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('ok', 'refused', 'error', 'rate_limited')),
  error_category TEXT CHECK (error_category IS NULL OR error_category IN (
    'auth', 'scope', 'company', 'rate_limited', 'insufficient_tokens', 'timeout', 'provider', 'invalid_input', 'internal'
  )),
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
  reservation_uid TEXT,
  held_microusd INTEGER CHECK (held_microusd IS NULL OR held_microusd >= 0),
  charged_microusd INTEGER CHECK (charged_microusd IS NULL OR charged_microusd >= 0),
  model TEXT,
  provider TEXT,
  connector TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_api_usage_events_user ON api_usage_events(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_api_usage_events_key ON api_usage_events(api_key_uid, created_at);
CREATE INDEX IF NOT EXISTS idx_api_usage_events_grant ON api_usage_events(grant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_api_usage_events_operation ON api_usage_events(user_id, operation, created_at);
-- `execution_id` is UNIQUE, which already indexes it; a second index would only cost writes.
