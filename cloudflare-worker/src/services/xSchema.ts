/**
 * Task #4 — Lazy schema bootstrap for X (Twitter) accounts + posts.
 * Mirrors `ensureTelegramSchema()` so the worker self-heals when migration
 * 068 lands unapplied on prod (see replit.md pending-migrations gotcha).
 */
import type { Env } from '../types';

let _ready = false;

export async function ensureXSchema(env: Env): Promise<void> {
  if (_ready) return;
  try {
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS x_accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, handle TEXT NOT NULL UNIQUE, display_name TEXT, x_user_id TEXT, scopes TEXT, access_token_ct TEXT, refresh_token_ct TEXT, expires_at TEXT, enabled INTEGER NOT NULL DEFAULT 1, last_test_at TEXT, last_error TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))",
    );
    await env.DB.exec(
      "CREATE INDEX IF NOT EXISTS idx_x_accounts_enabled ON x_accounts(enabled)",
    );
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS x_posts (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL REFERENCES x_accounts(id), status TEXT NOT NULL DEFAULT 'draft', body TEXT NOT NULL, hashtags TEXT, media_r2_keys TEXT, alt_texts TEXT, scheduled_for TEXT, sent_at TEXT, tweet_id TEXT, tweet_link TEXT, in_reply_to_tweet_id TEXT, thread_continuation_of INTEGER REFERENCES x_posts(id), thread_position INTEGER, source TEXT NOT NULL DEFAULT 'manual', source_kind TEXT, body_hash TEXT, send_error TEXT, override_reason TEXT, override_findings TEXT, approved_by INTEGER REFERENCES users(id), approved_at TEXT, retracted_at TEXT, retracted_by INTEGER REFERENCES users(id), retraction_reason TEXT, created_by INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))",
    );
    await env.DB.exec(
      "CREATE INDEX IF NOT EXISTS idx_x_posts_status ON x_posts(status, created_at DESC)",
    );
    await env.DB.exec(
      "CREATE INDEX IF NOT EXISTS idx_x_posts_account ON x_posts(account_id, created_at DESC)",
    );
    await env.DB.exec(
      "CREATE INDEX IF NOT EXISTS idx_x_posts_thread ON x_posts(thread_continuation_of, thread_position)",
    );
    _ready = true;
  } catch (e) {
    console.warn('[xSchema] ensure failed:', (e as Error).message);
  }
}

// Hard ceiling: X API rule.
export const X_MAX_TWEET_LEN = 280;
export const X_MAX_MEDIA_PER_TWEET = 4;
export const X_DEFAULT_DAILY_CAP = 20;
