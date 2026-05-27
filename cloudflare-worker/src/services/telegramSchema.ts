/**
 * Task #3 — Lazy schema bootstrap for Telegram channels/posts/aggregations
 * + promotion consent side table. Mirrors `ensureTeamMembersSchema()` so
 * the worker self-heals when migration 067 lands unapplied on prod (see
 * replit.md pending-migrations gotcha).
 */
import type { Env } from '../types';

let _ready = false;

export async function ensureTelegramSchema(env: Env): Promise<void> {
  if (_ready) return;
  try {
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS telegram_channels (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, label TEXT NOT NULL, chat_id TEXT, audience TEXT NOT NULL, is_invite_only INTEGER NOT NULL DEFAULT 1, enabled INTEGER NOT NULL DEFAULT 1, last_test_at TEXT, last_error TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))",
    );
    await env.DB.exec(
      "CREATE INDEX IF NOT EXISTS idx_telegram_channels_audience ON telegram_channels(audience, enabled)",
    );
    // Lazy ALTER for per-channel author signature appended at send time.
    // Same PRAGMA pattern as ensureAdvisorWeekColumn / ensureMarketIntelSchema.
    try {
      const cols = await env.DB.prepare("PRAGMA table_info('telegram_channels')").all<{ name: string }>();
      const hasSig = (cols.results || []).some((c) => String(c.name) === 'signature');
      if (!hasSig) {
        await env.DB.exec("ALTER TABLE telegram_channels ADD COLUMN signature TEXT");
        // Backfill default for the canonical seeded rows so existing posts
        // immediately render the human signature.
        await env.DB.exec("UPDATE telegram_channels SET signature = 'Guillaume Lauzier' WHERE signature IS NULL");
      }
    } catch (e) {
      console.warn('[telegramSchema] signature column ensure failed:', (e as Error).message);
    }
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS telegram_posts (id INTEGER PRIMARY KEY AUTOINCREMENT, channel_id INTEGER NOT NULL REFERENCES telegram_channels(id), audience TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', title TEXT, body_md TEXT NOT NULL, media_r2_key TEXT, media_kind TEXT, scheduled_for TEXT, sent_at TEXT, telegram_message_id INTEGER, telegram_link TEXT, source TEXT NOT NULL DEFAULT 'manual', source_kind TEXT, body_hash TEXT, send_error TEXT, override_reason TEXT, override_findings TEXT, created_by INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))",
    );
    await env.DB.exec(
      "CREATE INDEX IF NOT EXISTS idx_telegram_posts_status ON telegram_posts(status, created_at DESC)",
    );
    await env.DB.exec(
      "CREATE INDEX IF NOT EXISTS idx_telegram_posts_channel ON telegram_posts(channel_id, created_at DESC)",
    );
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS telegram_aggregations (id INTEGER PRIMARY KEY AUTOINCREMENT, audience TEXT NOT NULL, kind TEXT NOT NULL, payload_json TEXT NOT NULL, period_start TEXT NOT NULL, period_end TEXT NOT NULL, draft_post_id INTEGER REFERENCES telegram_posts(id), created_at TEXT NOT NULL DEFAULT (datetime('now')))",
    );
    await env.DB.exec(
      "CREATE INDEX IF NOT EXISTS idx_telegram_aggregations_audience ON telegram_aggregations(audience, created_at DESC)",
    );
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS user_promotion_consent (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, consented INTEGER NOT NULL DEFAULT 0, consented_at TEXT, source TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')))",
    );
    // Race-safe idempotency ledger for user-initiated channel join requests.
    // UNIQUE(user_id, channel_slug, day_bucket) lets the route use
    // INSERT OR IGNORE as an atomic compare-and-set so two concurrent
    // requests can't both ping the studio Slack inbox.
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS telegram_join_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, channel_slug TEXT NOT NULL, day_bucket TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(user_id, channel_slug, day_bucket))",
    );
    await env.DB.exec(
      "CREATE INDEX IF NOT EXISTS idx_telegram_join_requests_user ON telegram_join_requests(user_id, created_at DESC)",
    );
    // Seed canonical channels — idempotent.
    await env.DB.exec(
      "INSERT OR IGNORE INTO telegram_channels (slug, label, audience, is_invite_only) VALUES " +
        "('axalvc-public', '@axalvc Public', 'public', 0)," +
        "('axal-founders', 'Axal Founders', 'founders', 1)," +
        "('axal-investors', 'Axal Investors', 'investors', 1)," +
        "('axal-mentors', 'Axal Mentors', 'mentors', 1)," +
        "('axal-partners', 'Axal Operating Partners', 'partners', 1)," +
        "('axal-alumni', 'Axal Alumni', 'alumni', 1)",
    );
    _ready = true;
  } catch (e) {
    console.warn('[telegramSchema] ensure failed:', (e as Error).message);
  }
}

export const TELEGRAM_AUDIENCES = [
  'public',
  'founders',
  'investors',
  'mentors',
  'partners',
  'alumni',
] as const;
export type TelegramAudience = (typeof TELEGRAM_AUDIENCES)[number];
