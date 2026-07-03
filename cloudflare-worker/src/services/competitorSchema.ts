/**
 * Lazy schema bootstrap for the Competitor Analysis feature. Mirrors the
 * pattern of `ensureAxalFitSchema()` so the Worker self-heals if the migration
 * (`cloudflare-worker/sql/competitor_analysis.sql`) lands unapplied on prod.
 * Idempotent CREATE TABLE / INDEX IF NOT EXISTS.
 *
 * Tables:
 *  - competitor_analyses          one row per saved analysis (inputs stored as JSON)
 *  - competitor_candidates        discovered / manual competitors + per-source scores
 *  - competitor_sources           provenance: which URLs fed a candidate
 *  - competitor_signals           traction / hiring / funding / content signals
 *  - competitor_analysis_outputs  the generated (and editable) structured report
 *  - competitor_cached_fetches    normalized text cache for the crawl pipeline
 */
import type { Env } from '../types';

let _ready = false;

export async function ensureCompetitorSchema(env: Env): Promise<void> {
  if (_ready) return;
  try {
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS competitor_analyses (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, project_id INTEGER, mode TEXT NOT NULL DEFAULT 'custom', title TEXT, inputs_json TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'draft', edited INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))",
    );
    await env.DB.exec(
      "CREATE INDEX IF NOT EXISTS idx_competitor_analyses_user ON competitor_analyses (user_id, updated_at)",
    );
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS competitor_candidates (id TEXT PRIMARY KEY, analysis_id TEXT NOT NULL REFERENCES competitor_analyses(id) ON DELETE CASCADE, name TEXT NOT NULL, domain TEXT, url TEXT, category TEXT NOT NULL DEFAULT 'direct', relevance_score REAL NOT NULL DEFAULT 0, scores_json TEXT NOT NULL DEFAULT '{}', summary TEXT, details_json TEXT NOT NULL DEFAULT '{}', origin TEXT NOT NULL DEFAULT 'discovered', position INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')))",
    );
    await env.DB.exec(
      "CREATE INDEX IF NOT EXISTS idx_competitor_candidates_analysis ON competitor_candidates (analysis_id, position)",
    );
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS competitor_sources (id TEXT PRIMARY KEY, analysis_id TEXT NOT NULL REFERENCES competitor_analyses(id) ON DELETE CASCADE, candidate_id TEXT, url TEXT NOT NULL, kind TEXT, title TEXT, status INTEGER, fetched_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))",
    );
    await env.DB.exec(
      "CREATE INDEX IF NOT EXISTS idx_competitor_sources_analysis ON competitor_sources (analysis_id)",
    );
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS competitor_signals (id TEXT PRIMARY KEY, analysis_id TEXT NOT NULL REFERENCES competitor_analyses(id) ON DELETE CASCADE, candidate_id TEXT, signal_type TEXT NOT NULL, label TEXT, detail TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))",
    );
    await env.DB.exec(
      "CREATE INDEX IF NOT EXISTS idx_competitor_signals_analysis ON competitor_signals (analysis_id)",
    );
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS competitor_analysis_outputs (analysis_id TEXT PRIMARY KEY REFERENCES competitor_analyses(id) ON DELETE CASCADE, output_json TEXT NOT NULL DEFAULT '{}', edited INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT (datetime('now')))",
    );
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS competitor_cached_fetches (url_hash TEXT PRIMARY KEY, url TEXT NOT NULL, status INTEGER, title TEXT, description TEXT, text TEXT, headings_json TEXT, pricing_json TEXT, fetched_at TEXT, expires_at TEXT)",
    );
    await env.DB.exec(
      "CREATE INDEX IF NOT EXISTS idx_competitor_cached_fetches_exp ON competitor_cached_fetches (expires_at)",
    );
    _ready = true;
  } catch (e) {
    console.warn('[competitorSchema] ensure failed:', (e as Error).message);
  }
}
