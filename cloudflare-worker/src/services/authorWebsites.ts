/**
 * Task #9 — Author personal-website mapping.
 *
 * The article byline links to the author's personal website. `users` is at
 * D1's ALTER-rewrite column limit (see replit.md), so the website lives in a
 * lightweight side table keyed by `user_id` (same pattern as
 * `user_google_links` from migration 065). Lazy bootstrap mirrors
 * `ensureNewsSchema()` / `ensureTeamMembersSchema()` so prod self-heals with
 * no migration on the hot path.
 *
 * Seeds Guillaume Lauzier's site. His user id is resolved at seed time by
 * email (stable across envs) then name, so we never hard-code a row id. The
 * seed is a no-op where the user doesn't exist (e.g. dev) or already mapped.
 *
 * Task #31 — Extended with bio, twitter_url, linkedin_url, photo_url.
 * D1/SQLite has no ALTER TABLE … ADD COLUMN IF NOT EXISTS, so each new column
 * is added via an individually try/catched exec; a "duplicate column" error on
 * a live DB is swallowed and _ready still flips true.
 */
import type { Env } from '../types';

let _ready = false;

const GUILLAUME_WEBSITE = 'https://guillaumelauzier.com';

export async function ensureAuthorWebsites(env: Env): Promise<void> {
  if (_ready) return;
  try {
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS author_websites (user_id INTEGER PRIMARY KEY REFERENCES users(id), website_url TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))",
    );
    // Task #31 — profile fields. Each ALTER is individually guarded because
    // D1/SQLite rejects IF NOT EXISTS on ADD COLUMN (migration 102 lands these
    // on prod; the loop self-heals a cold DB that missed the migration).
    for (const ddl of [
      'ALTER TABLE author_websites ADD COLUMN bio TEXT',
      'ALTER TABLE author_websites ADD COLUMN twitter_url TEXT',
      'ALTER TABLE author_websites ADD COLUMN linkedin_url TEXT',
      'ALTER TABLE author_websites ADD COLUMN photo_url TEXT',
    ]) {
      try { await env.DB.exec(ddl); } catch { /* column already exists — ignore */ }
    }
    await env.DB.prepare(
      `INSERT OR IGNORE INTO author_websites (user_id, website_url)
       SELECT id, ? FROM users
        WHERE lower(email) = 'gl@axal.vc' OR name = 'Guillaume Lauzier'
        ORDER BY (lower(email) = 'gl@axal.vc') DESC
        LIMIT 1`,
    ).bind(GUILLAUME_WEBSITE).run();
    _ready = true;
  } catch (e) {
    console.warn('[authorWebsites] ensure failed:', (e as Error).message);
  }
}
