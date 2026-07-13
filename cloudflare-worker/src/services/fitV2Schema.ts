/**
 * Fit v2 — lazy schema bootstrap for the staged-session / decision / review
 * tables. Mirrors `ensureAxalFitSchema()` so the Worker self-heals when
 * migration 151 lands unapplied on prod (pending-migrations gotcha).
 * Idempotent CREATE TABLE/INDEX IF NOT EXISTS, mirrored exactly from
 * migration 151 / schema.sql. The fitv2_* skills seed is NOT mirrored here —
 * seeds only ever apply via the migration (same split as
 * skillsTaxonomySchema), and the engine tolerates its absence.
 */
import type { Env } from '../types';

let _ready = false;

export async function ensureFitV2Schema(env: Env): Promise<void> {
  if (_ready) return;
  try {
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS fit_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))), user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, role_context TEXT NOT NULL, bank_version TEXT NOT NULL DEFAULT 'v2.0', core_only INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'in_progress', current_stage TEXT NOT NULL DEFAULT 'context', conversation_id INTEGER REFERENCES advisor_conversations(id), progress_json TEXT, decision_id INTEGER, source TEXT NOT NULL DEFAULT 'staged', started_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), submitted_at TEXT)",
    );
    await env.DB.exec(
      'CREATE INDEX IF NOT EXISTS idx_fit_sessions_user ON fit_sessions (user_id, status, updated_at)',
    );
    await env.DB.exec(
      'CREATE INDEX IF NOT EXISTS idx_fit_sessions_role ON fit_sessions (user_id, role_context, started_at)',
    );
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS fit_decisions (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))), user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, session_id INTEGER REFERENCES fit_sessions(id), role_context TEXT NOT NULL, bank_version TEXT NOT NULL DEFAULT 'v2.0', engine_version TEXT NOT NULL DEFAULT 'v2.0', outcome TEXT NOT NULL, culture_score REAL NOT NULL DEFAULT 0, role_score REAL NOT NULL DEFAULT 0, archetype_primary TEXT, archetype_secondary TEXT, archetype_margin REAL NOT NULL DEFAULT 0, confidence REAL NOT NULL DEFAULT 0, evidence_quality REAL NOT NULL DEFAULT 0, coverage_json TEXT, values_json TEXT, skills_json TEXT, rubric_json TEXT, gaps_json TEXT, flags_json TEXT, contradictions_json TEXT, narrative TEXT, computed_by INTEGER REFERENCES users(id), computed_at TEXT NOT NULL DEFAULT (datetime('now')))",
    );
    await env.DB.exec(
      'CREATE INDEX IF NOT EXISTS idx_fit_decisions_latest ON fit_decisions (user_id, role_context, computed_at)',
    );
    await env.DB.exec(
      'CREATE INDEX IF NOT EXISTS idx_fit_decisions_review ON fit_decisions (outcome, computed_at)',
    );
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS fit_reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, decision_id INTEGER NOT NULL REFERENCES fit_decisions(id) ON DELETE CASCADE, subject_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, reviewer_id INTEGER NOT NULL REFERENCES users(id), evidence_ratings_json TEXT, override_outcome TEXT, override_reason TEXT, requires_followup INTEGER NOT NULL DEFAULT 0, followup_json TEXT, notes TEXT, status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (decision_id, reviewer_id))",
    );
    await env.DB.exec(
      'CREATE INDEX IF NOT EXISTS idx_fit_reviews_subject ON fit_reviews (subject_user_id, created_at)',
    );
    _ready = true;
  } catch (e) {
    console.warn('[fitV2Schema] ensure failed:', (e as Error).message);
  }
}
