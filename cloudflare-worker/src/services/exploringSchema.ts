/**
 * Task #9 — Intermediary "exploring" role onboarding.
 *
 * Schema bootstrap for the role-review holding state:
 *   (a) relax the users.role CHECK so 'exploring' is accepted. This CANNOT be
 *       a SQL migration — it needs the live-DDL-derived table rebuild (see
 *       util/usersRoleRebuild.ts) and non-idempotent files are recorded-
 *       without-running on baselined DBs.
 *   (b) create the `user_role_review` side table (users is at D1's ALTER
 *       column limit, so per-user review fields live here — same pattern as
 *       user_google_links / user_promotion_consent). Mirrors migration
 *       147_user_role_review.sql for cold DBs.
 *   (c) create the `explorer_needs` side table (Problem/Challenge Discovery
 *       answers for the Explorer question banks — see
 *       services/advisor/banks/explorer.ts's 4 tracks) + the
 *       `needs_assessment_completed` column on user_role_review. Mirrors
 *       migration 148_explorer_needs.sql for cold DBs. Keyed by user_id
 *       only (never founder_id/advisor_id/etc.) so answers survive the
 *       user being re-tagged from 'exploring' to founder/investor/advisor/
 *       partner. Only requireAuth-scoped routes (the answering user) and
 *       requireAdmin-scoped routes may read/write it.
 *
 * Idempotent + isolate-once. Wired into the fetch bootstrap in index.ts
 * (alongside ensureInvestorSchema/ensureAdvisorSchema) so the CHECK rebuild
 * is guaranteed to have run before any `UPDATE users SET role='exploring'`;
 * consuming routes also call it lazily as belt-and-braces.
 */
import type { Env } from '../types';
import { rebuildUsersRoleCheckForExploring } from '../util/usersRoleRebuild';

let _exploringSchemaReady = false;

export function exploringSchemaReady(): boolean {
  return _exploringSchemaReady;
}

export async function ensureExploringSchema(env: Env): Promise<void> {
  if (_exploringSchemaReady) return;
  try {
    // A successful call means the live CHECK now admits 'exploring' (either it
    // already did — no-op — or the table was rebuilt). Only then may the
    // isolate-once flag latch: latching after a swallowed rebuild failure
    // would pin every /save in this isolate into the CHECK-degrade path with
    // no retry.
    let roleCheckOk = false;
    try {
      await rebuildUsersRoleCheckForExploring(env);
      roleCheckOk = true;
    } catch (e) {
      console.warn('[boot] users role-CHECK exploring rebuild failed (will retry next request):', (e as Error).message);
    }
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS user_role_review (user_id INTEGER PRIMARY KEY, suggested_role TEXT, role_confirmed INTEGER NOT NULL DEFAULT 0, onboarded_at TEXT, binding_envelope_id INTEGER, binding_document_type TEXT, binding_sent_at TEXT, assigned_role TEXT, assigned_by_user_id INTEGER, assigned_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))"
    );
    await env.DB.exec(
      "CREATE INDEX IF NOT EXISTS idx_user_role_review_confirmed ON user_role_review(role_confirmed)"
    );
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS explorer_needs (user_id INTEGER PRIMARY KEY REFERENCES users(id), track TEXT, current_status TEXT, team_structure TEXT, sector TEXT, geography TEXT, challenge_1 TEXT, challenge_2 TEXT, challenge_3 TEXT, challenge_1_depth TEXT, timeline_urgency TEXT, hard_deadline TEXT, runway_months INTEGER, track_extra_json TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))"
    );
    await env.DB.exec(
      "CREATE INDEX IF NOT EXISTS idx_explorer_needs_track ON explorer_needs(track)"
    );
    await env.DB.exec(
      "CREATE INDEX IF NOT EXISTS idx_explorer_needs_status ON explorer_needs(current_status)"
    );
    await env.DB.exec(
      "CREATE INDEX IF NOT EXISTS idx_explorer_needs_challenges ON explorer_needs(challenge_1, challenge_2, challenge_3)"
    );
    await env.DB.exec(
      "CREATE INDEX IF NOT EXISTS idx_explorer_needs_timeline ON explorer_needs(timeline_urgency)"
    );
    // D1/SQLite rejects `ADD COLUMN IF NOT EXISTS` — guard individually so a
    // pre-migrated DB (column already added by 148_explorer_needs.sql) just
    // swallows the "duplicate column" error instead of aborting the boot.
    try {
      await env.DB.exec(
        "ALTER TABLE user_role_review ADD COLUMN needs_assessment_completed INTEGER DEFAULT 0"
      );
    } catch { /* column already exists */ }
    if (roleCheckOk) _exploringSchemaReady = true;
  } catch (e) {
    console.error('[boot] ensureExploringSchema failed:', (e as Error).message);
  }
}

/**
 * Upsert the chatbot/role-detector persona suggestion for a user. Never
 * touches users.role — the suggestion is applied only by an explicit admin
 * assignment (routes/admin_exploring.ts).
 */
export async function upsertSuggestedRole(
  env: Env,
  userId: number,
  suggestedRole: string | null,
  opts: { markOnboarded?: boolean } = {},
): Promise<void> {
  await ensureExploringSchema(env);
  if (opts.markOnboarded) {
    await env.DB.prepare(
      `INSERT INTO user_role_review (user_id, suggested_role, onboarded_at, updated_at)
       VALUES (?, ?, datetime('now'), datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         suggested_role = COALESCE(excluded.suggested_role, user_role_review.suggested_role),
         onboarded_at = COALESCE(user_role_review.onboarded_at, excluded.onboarded_at),
         updated_at = datetime('now')`
    ).bind(userId, suggestedRole).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO user_role_review (user_id, suggested_role, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         suggested_role = COALESCE(excluded.suggested_role, user_role_review.suggested_role),
         updated_at = datetime('now')`
    ).bind(userId, suggestedRole).run();
  }
}

/** Read a user's suggested role (null when none stored). */
export async function getSuggestedRole(env: Env, userId: number): Promise<string | null> {
  await ensureExploringSchema(env);
  try {
    const row = await env.DB.prepare(
      `SELECT suggested_role FROM user_role_review WHERE user_id = ?`
    ).bind(userId).first<{ suggested_role: string | null }>();
    return row?.suggested_role || null;
  } catch {
    return null;
  }
}

/**
 * Mark the explorer's Problem/Challenge Discovery bank as complete. Called
 * by writeRouter.ts's explorer branch when the last question of the user's
 * track bank (see banks/explorer.ts EXPLORER_*_BANK) is answered. Read by
 * the Phase-2 recommendation engine + the admin review queue to prioritise
 * which explorers have enough signal for a tailored suggestion.
 */
export async function markNeedsAssessmentCompleted(env: Env, userId: number): Promise<void> {
  await ensureExploringSchema(env);
  try {
    await env.DB.prepare(
      `INSERT INTO user_role_review (user_id, needs_assessment_completed, updated_at)
       VALUES (?, 1, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         needs_assessment_completed = 1,
         updated_at = datetime('now')`
    ).bind(userId).run();
  } catch (e) {
    console.warn('[exploringSchema] markNeedsAssessmentCompleted failed:', (e as Error).message);
  }
}
