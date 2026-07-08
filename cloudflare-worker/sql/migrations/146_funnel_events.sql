-- 146 — Signup funnel instrumentation (first-party, consent-aware analytics).
--
-- One append-only table receives batched events from POST /api/track (new
-- routes/track.ts). Rows are pseudonymous: anon_id is a client-generated
-- UUID minted ONLY after the visitor grants the "analytics" cookie-consent
-- category; there is no IP, no email, no user_id, and no full user-agent
-- (only a coarse browser family derived server-side). Query-string capture
-- on the client is allowlisted (utm_*, ref, lane, invite) so magic-link /
-- verification tokens can never ride along.
--
-- Segmentation dimensions the funnel queries GROUP BY are discrete columns;
-- everything event-specific lives in the props JSON blob.
--
-- Retention: rows older than 180 days are purged by the nightly cron in
-- index.ts (04:20 UTC) — see ANALYTICS_FUNNEL.md.
--
-- Idempotent (IF NOT EXISTS, no ALTER, no BEGIN/COMMIT) so the deploy
-- migration runner real-applies it on baseline/deploy; the worker also
-- carries services/funnelEventsSchema.ts::ensureFunnelEventsSchema() as the
-- lazy bootstrap so /api/track self-heals on a DB this file has not reached.

CREATE TABLE IF NOT EXISTS funnel_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event TEXT NOT NULL,
  anon_id TEXT,
  session_id TEXT,
  client_ts INTEGER,
  path TEXT,
  referrer TEXT,
  device TEXT,
  browser TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  ref_code TEXT,
  lane TEXT,
  invite_type TEXT,
  props TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_funnel_events_event ON funnel_events(event, created_at);
CREATE INDEX IF NOT EXISTS idx_funnel_events_anon ON funnel_events(anon_id, created_at);
