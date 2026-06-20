/**
 * Task #14 — Lazy schema bootstrap for the Axal-Fit / consultation tables.
 * Mirrors `ensureTelegramSchema()` / `ensureXSchema()` so the Worker self-heals
 * when migration 115 (axal_values / axal_fit_scores / axal_fit_reports /
 * admin_consultation_bookings) lands unapplied on prod (see replit.md
 * pending-migrations gotcha). Idempotent CREATE TABLE/INDEX IF NOT EXISTS,
 * mirrored exactly from migration 115 / schema.sql.
 */
import type { Env } from '../types';

let _ready = false;

export async function ensureAxalFitSchema(env: Env): Promise<void> {
  if (_ready) return;
  try {
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS axal_values (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, value_key TEXT NOT NULL, score REAL NOT NULL DEFAULT 0, confidence REAL NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (user_id, value_key))",
    );
    await env.DB.exec(
      "CREATE INDEX IF NOT EXISTS idx_axal_values_user ON axal_values (user_id, updated_at)",
    );
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS axal_fit_scores (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, persona TEXT NOT NULL, total_score REAL NOT NULL DEFAULT 0, band TEXT NOT NULL, rubric_json TEXT, red_flags_json TEXT, signal_quality REAL NOT NULL DEFAULT 0, narrative_fit TEXT, computed_at TEXT NOT NULL DEFAULT (datetime('now')))",
    );
    await env.DB.exec(
      "CREATE INDEX IF NOT EXISTS idx_axal_fit_scores_latest ON axal_fit_scores (user_id, persona, computed_at)",
    );
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS axal_fit_reports (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))), user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, persona TEXT, report_json TEXT NOT NULL, computed_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now')))",
    );
    await env.DB.exec(
      "CREATE INDEX IF NOT EXISTS idx_axal_fit_reports_user ON axal_fit_reports (user_id, created_at)",
    );
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS admin_consultation_bookings (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))), user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, admin_id INTEGER REFERENCES users(id), requested_at TEXT NOT NULL DEFAULT (datetime('now')), slot_at TEXT, status TEXT NOT NULL DEFAULT 'requested', topic TEXT, notes TEXT, report_id INTEGER REFERENCES axal_fit_reports(id), created_at TEXT NOT NULL DEFAULT (datetime('now')))",
    );
    await env.DB.exec(
      "CREATE INDEX IF NOT EXISTS idx_consultation_bookings_user ON admin_consultation_bookings (user_id, created_at)",
    );
    await env.DB.exec(
      "CREATE INDEX IF NOT EXISTS idx_consultation_bookings_status ON admin_consultation_bookings (status, requested_at)",
    );
    _ready = true;
  } catch (e) {
    console.warn('[axalFitSchema] ensure failed:', (e as Error).message);
  }
}
