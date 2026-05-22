/**
 * Task #2 — Lazy schema bootstrap for `articles`, `article_revisions`,
 * `article_review_comments`, `article_submission_log`.
 *
 * Mirrors `ensureTelegramSchema()` / `ensureTeamMembersSchema()` so the
 * worker self-heals when migration 068 lands unapplied on prod (see
 * replit.md pending-migrations gotcha).
 */
import type { Env } from '../types';

let _ready = false;

export async function ensureNewsSchema(env: Env): Promise<void> {
  if (_ready) return;
  try {
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS articles (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, subtitle TEXT, body_markdown TEXT NOT NULL DEFAULT '', body_html TEXT, cover_r2_key TEXT, cover_mime TEXT, tags TEXT, sector TEXT, status TEXT NOT NULL DEFAULT 'draft', author_user_id INTEGER NOT NULL REFERENCES users(id), reviewer_user_id INTEGER REFERENCES users(id), submitted_at TEXT, reviewed_at TEXT, approved_at TEXT, published_at TEXT, rejected_at TEXT, rejection_reason TEXT, word_count INTEGER NOT NULL DEFAULT 0, read_minutes INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))",
    );
    await env.DB.exec(
      'CREATE INDEX IF NOT EXISTS idx_articles_status_pub ON articles(status, published_at DESC)',
    );
    await env.DB.exec(
      'CREATE INDEX IF NOT EXISTS idx_articles_author ON articles(author_user_id, status, updated_at DESC)',
    );
    await env.DB.exec(
      'CREATE INDEX IF NOT EXISTS idx_articles_queue ON articles(status, submitted_at)',
    );
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS article_revisions (id INTEGER PRIMARY KEY AUTOINCREMENT, article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE, rev INTEGER NOT NULL, title TEXT NOT NULL, subtitle TEXT, body_markdown TEXT NOT NULL, status_at_save TEXT NOT NULL, saved_by INTEGER NOT NULL REFERENCES users(id), reason TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))",
    );
    await env.DB.exec(
      'CREATE INDEX IF NOT EXISTS idx_article_revisions_article ON article_revisions(article_id, rev DESC)',
    );
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS article_review_comments (id INTEGER PRIMARY KEY AUTOINCREMENT, article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE, author_id INTEGER NOT NULL REFERENCES users(id), body TEXT NOT NULL, anchor TEXT, resolved_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))",
    );
    await env.DB.exec(
      'CREATE INDEX IF NOT EXISTS idx_article_comments_article ON article_review_comments(article_id, created_at)',
    );
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS article_submission_log (id INTEGER PRIMARY KEY AUTOINCREMENT, author_id INTEGER NOT NULL REFERENCES users(id), article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE, submitted_at TEXT NOT NULL DEFAULT (datetime('now')))",
    );
    await env.DB.exec(
      'CREATE INDEX IF NOT EXISTS idx_article_submission_log_author ON article_submission_log(author_id, submitted_at DESC)',
    );
    _ready = true;
  } catch (e) {
    console.warn('[newsSchema] ensure failed:', (e as Error).message);
  }
}

export const NEWS_STATUSES = [
  'draft',
  'submitted',
  'in_review',
  'changes_requested',
  'approved',
  'published',
  'rejected',
] as const;
export type NewsStatus = (typeof NEWS_STATUSES)[number];

export const TRUST_AUTHOR_MIN = 70;
export const SUBMISSIONS_PER_WEEK = 3;
