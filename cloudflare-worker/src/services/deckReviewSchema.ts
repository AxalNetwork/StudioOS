/**
 * Lazy schema bootstrap for the Pitch Deck Reviewer feature. Mirrors
 * `ensureAxalFitSchema()` so the Worker self-heals if the migration
 * (`cloudflare-worker/sql/deck_reviews.sql`) lands unapplied on prod.
 *
 * Tables:
 *  - deck_reviews          one row per uploaded/pasted deck (metadata + mapped
 *                          sections + generated review). Raw bytes live in R2
 *                          (r2_key); `raw_retained` tracks the retention cycle.
 *                          D900: `deck_id` and `deck_version` name the studio
 *                          version a review read (migration 541); NULL for an
 *                          upload or pasted text.
 *  - deck_review_history   append-only snapshots of each generated review, so a
 *                          user can compare regenerations.
 */
import type { Env } from '../types';
import { bindingKey } from '../util/schemaBootstrap';

const READY = new WeakMap<object, boolean>();

export async function ensureDeckReviewSchema(env: Env): Promise<void> {
  if (READY.get(bindingKey(env))) return;
  try {
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS deck_reviews (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, project_id INTEGER, source TEXT NOT NULL DEFAULT 'upload', filename TEXT, mime TEXT, size INTEGER NOT NULL DEFAULT 0, r2_key TEXT, raw_retained INTEGER NOT NULL DEFAULT 0, extraction_status TEXT NOT NULL DEFAULT 'pending', chunks_json TEXT NOT NULL DEFAULT '[]', sections_json TEXT NOT NULL DEFAULT '[]', review_json TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'draft', title TEXT, edited INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), deck_id INTEGER, deck_version INTEGER)",
    );
    // D900 (migration 541): the studio version a review read. A table made before
    // 541 gains both columns here; two literal statements, never a built name.
    const info = await env.DB.prepare('PRAGMA table_info(deck_reviews)').all<{ name: string }>();
    const have = new Set((info.results || []).map((r) => r.name));
    if (!have.has('deck_id')) await env.DB.prepare('ALTER TABLE deck_reviews ADD COLUMN deck_id INTEGER').run();
    if (!have.has('deck_version')) await env.DB.prepare('ALTER TABLE deck_reviews ADD COLUMN deck_version INTEGER').run();
    await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_deck_reviews_deck ON deck_reviews (deck_id, created_at)');
    await env.DB.exec(
      "CREATE INDEX IF NOT EXISTS idx_deck_reviews_user ON deck_reviews (user_id, updated_at)",
    );
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS deck_review_history (id TEXT PRIMARY KEY, review_id TEXT NOT NULL REFERENCES deck_reviews(id) ON DELETE CASCADE, review_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT (datetime('now')))",
    );
    await env.DB.exec(
      "CREATE INDEX IF NOT EXISTS idx_deck_review_history_review ON deck_review_history (review_id, created_at)",
    );
    READY.set(bindingKey(env), true);
  } catch (e) {
    console.warn('[deckReviewSchema] ensure failed:', (e as Error).message);
  }
}
