/**
 * D4161 (#4161, H3 of #4137) — HQ's moderation of company skills: the open
 * flag or suspension on a skill, and THE RUN GATE.
 *
 * THE RUN GATE (`skillRunRefusal`). A skill version may not run when
 *   - the skill has an open suspension, whatever version is pinned; or
 *   - a suspension was lifted only because the company republished, and the
 *     pinned version is one that suspension covered (`version` and below).
 *     The new version starts clean; the old ones stay off until the team
 *     moves to it, or HQ clears the suspension outright.
 * A flag never stops a run. Every run path that puts a skill into an agent's
 * turn (D1612 part D, #3954) calls this before it does, and drops a refused
 * skill with `skill_suspended`. `attachCheck` refuses to pin a suspended skill.
 *
 * Reads only, plus the statement the publish route adds to its batch. The
 * routes are `routes/admin_company_skills.ts` (HQ) and `routes/team_skills.ts`
 * (publish).
 */
import type { Env } from '../../types';

export type ModerationAction = 'flag' | 'suspend';
export type ModerationRow = {
  id: number; skill_id: number; action: ModerationAction; version: number; reason: string;
  created_by: number; created_at: string; cleared_at: string | null; cleared_by: number | null;
  cleared_how: 'hq' | 'republished' | null; clear_reason: string | null;
};

export const SUSPENDED_MESSAGE = 'HQ suspended this skill. Agents do not use it until the company publishes a fixed version or HQ lifts the suspension.';

/** The skill's open flag or suspension, or null. */
export async function openModeration(env: Env, skillId: number): Promise<ModerationRow | null> {
  return env.DB.prepare('SELECT * FROM agent_skill_moderation WHERE skill_id = ? AND cleared_at IS NULL').bind(skillId).first<ModerationRow>();
}

/**
 * Why a pinned version of a skill may not run; null when it may. The one gate
 * for every run path (see the header).
 */
export async function skillRunRefusal(env: Env, skillId: number, pinnedVersion: number): Promise<{ code: 'skill_suspended'; message: string } | null> {
  const row = await env.DB.prepare(
    `SELECT 1 AS hit FROM agent_skill_moderation
      WHERE skill_id = ? AND action = 'suspend'
        AND (cleared_at IS NULL OR (cleared_how = 'republished' AND version >= ?))
      LIMIT 1`,
  ).bind(skillId, pinnedVersion).first();
  return row ? { code: 'skill_suspended', message: SUSPENDED_MESSAGE } : null;
}

/**
 * The statement that closes an open flag or suspension when the company
 * publishes `version`: the publish route runs it in the same batch.
 */
export function clearOnRepublish(env: Env, skillId: number, version: number, userId: number) {
  return env.DB.prepare(
    `UPDATE agent_skill_moderation SET cleared_at = CURRENT_TIMESTAMP, cleared_by = ?, cleared_how = 'republished', clear_reason = ?
      WHERE skill_id = ? AND cleared_at IS NULL`,
  ).bind(userId, `Republished as version ${version}.`, skillId);
}

/** A company's editors: the members `canEdit` lets write (Owner, Admin, Founder, or the primary admin). */
export async function companyEditorIds(env: Env, companyId: number): Promise<number[]> {
  const rows = (await env.DB.prepare(
    `SELECT DISTINCT user_id FROM user_company_links
      WHERE company_id = ? AND (is_primary_admin = 1 OR role_in_company IN ('Owner', 'Admin', 'Founder'))
      ORDER BY user_id`,
  ).bind(companyId).all<{ user_id: number }>()).results ?? [];
  return rows.map((r) => Number(r.user_id));
}
