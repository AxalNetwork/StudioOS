/**
 * Task #2 — Lazy schema bootstrap for the signup-funnel analytics table.
 * Mirrors `ensureTelegramSchema()` / `ensureXSchema()`: migration
 * 146_funnel_events.sql is the canonical record; this self-heals the shape
 * on a D1 the migration has not reached yet so POST /api/track never 500s
 * on a cold database.
 *
 * Privacy contract (see documentation/architecture/ANALYTICS_FUNNEL.md): rows are pseudonymous —
 * anon_id is a client UUID minted only after analytics cookie-consent,
 * there is no IP / email / user_id, and `browser` is a coarse family
 * derived server-side (never the full user-agent). Rows older than 180
 * days are purged by the nightly cron in index.ts.
 */
import type { Env } from '../types';

let _ready = false;

export async function ensureFunnelEventsSchema(env: Env): Promise<void> {
  if (_ready) return;
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS funnel_events (id INTEGER PRIMARY KEY AUTOINCREMENT, event TEXT NOT NULL, anon_id TEXT, session_id TEXT, client_ts INTEGER, path TEXT, referrer TEXT, device TEXT, browser TEXT, utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, ref_code TEXT, lane TEXT, invite_type TEXT, props TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))",
  );
  await env.DB.exec(
    "CREATE INDEX IF NOT EXISTS idx_funnel_events_event ON funnel_events(event, created_at)",
  );
  await env.DB.exec(
    "CREATE INDEX IF NOT EXISTS idx_funnel_events_anon ON funnel_events(anon_id, created_at)",
  );
  _ready = true;
}
