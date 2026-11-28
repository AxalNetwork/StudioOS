/**
 * Task #2 — Lazy schema bootstrap for `articles`, `article_revisions`,
 * `article_review_comments`, `article_submission_log`.
 *
 * Mirrors `ensureTelegramSchema()` / `ensureTeamMembersSchema()` so the
 * worker self-heals when migration 068 lands unapplied on prod (see
 * replit.md pending-migrations gotcha).
 */
import type { Env } from '../types';
import { bindingKey, runSchemaBootstrap } from '../util/schemaBootstrap';

const READY = new WeakMap<object, boolean>();

export async function ensureNewsSchema(env: Env): Promise<void> {
  if (READY.get(bindingKey(env))) return;
  try {
    // `publish_at` and `publish_at_set_by` are migration 346's (D484),
    // `approved_by` is migration 635's (D1292), and `featured_at`,
    // `featured_by` and the comments' `parent_id`, `resolved_by` and
    // `edited_at` are migration 636's (D1293), named here so a database this
    // creates matches one the migrations built.
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS articles (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, subtitle TEXT, body_markdown TEXT NOT NULL DEFAULT '', body_html TEXT, cover_r2_key TEXT, cover_mime TEXT, tags TEXT, sector TEXT, status TEXT NOT NULL DEFAULT 'draft', author_user_id INTEGER NOT NULL REFERENCES users(id), reviewer_user_id INTEGER REFERENCES users(id), submitted_at TEXT, reviewed_at TEXT, approved_at TEXT, approved_by INTEGER REFERENCES users(id), published_at TEXT, rejected_at TEXT, rejection_reason TEXT, word_count INTEGER NOT NULL DEFAULT 0, read_minutes INTEGER NOT NULL DEFAULT 0, excerpt TEXT, seo_title TEXT, canonical_url TEXT, publish_at TEXT, publish_at_set_by INTEGER, featured_at TEXT, featured_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))",
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
      "CREATE TABLE IF NOT EXISTS article_review_comments (id INTEGER PRIMARY KEY AUTOINCREMENT, article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE, author_id INTEGER NOT NULL REFERENCES users(id), body TEXT NOT NULL, anchor TEXT, resolved_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), parent_id INTEGER REFERENCES article_review_comments(id) ON DELETE CASCADE, resolved_by INTEGER REFERENCES users(id), edited_at TEXT)",
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
    // Lazy column backfill for migration 092, and D1292's migration 635
    // approver, for a database the migrations have not reached. #5343
    // (#4568 R2-04): through `runSchemaBootstrap`, which reads the columns once
    // per binding and skips an ALTER whose column is there. A failed ALTER used
    // to be swallowed and the schema marked ready; it now reaches the catch
    // below and the next call tries again.
    await runSchemaBootstrap(env, [
      'ALTER TABLE articles ADD COLUMN excerpt TEXT',
      'ALTER TABLE articles ADD COLUMN seo_title TEXT',
      'ALTER TABLE articles ADD COLUMN canonical_url TEXT',
      'ALTER TABLE articles ADD COLUMN views INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE articles ADD COLUMN approved_by INTEGER REFERENCES users(id)',
    ]);
    READY.set(bindingKey(env), true);
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
