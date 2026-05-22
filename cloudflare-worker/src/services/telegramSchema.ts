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
