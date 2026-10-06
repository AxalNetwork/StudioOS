/**
 * D579 (#1206) — storing a valid EIN marks the Lab's `ein_received`.
 *
 * The milestone belongs to the startup's owning founder, the account whose
 * Lab sprint the startup is: whoever stores the number (the founder, a
 * company editor or an admin), the owner's milestone is the one recorded.
 * It is recorded as `POST /api/spinout-lab/milestone` records one: the cohort
 * gate applies (a frozen sprint, or a Week 4 not yet unlocked, records
 * nothing), an inactive Lab records nothing, and credits are paid only by the
 * call that recorded it (D541). `ein_received` does not graduate anyone, so
 * no certificate is issued here.
 *
 * NEVER THROWS. The EIN is stored before this runs; a milestone that could
 * not be recorded is reported in the outcome and caught up the next time the
 * number is saved.
 */
import type { Env } from '../types';
import { getSQL } from '../db';

export const EIN_MILESTONE = 'ein_received';

export type EinMilestoneOutcome =
  | { user_id: number; recorded: true; milestone_credit: unknown }
  | { user_id: number; recorded: false; reason: 'already_recorded' | 'week_locked' | 'frozen' | 'lab_inactive' | 'error' };

const OWNERS = "SELECT id FROM users WHERE founder_id = ? AND role = 'founder' ORDER BY id";
const HAS_MILESTONE = 'SELECT 1 AS x FROM spinout_lab_milestones WHERE user_id = ? AND milestone_key = ?';

async function markFor(env: Env, userId: number): Promise<EinMilestoneOutcome> {
  try {
    if (await env.DB.prepare(HAS_MILESTONE).bind(userId, EIN_MILESTONE).first()) {
      return { user_id: userId, recorded: false, reason: 'already_recorded' };
    }
    try {
      const { getCohortGate } = await import('./cohortTiming');
      const gate = await getCohortGate(env, userId);
      if (gate?.frozen) return { user_id: userId, recorded: false, reason: 'frozen' };
      if (gate && gate.max_week < 4) return { user_id: userId, recorded: false, reason: 'week_locked' };
    } catch { /* gate tables not yet migrated: legacy behaviour, no gate */ }
    const { recordMilestone } = await import('../routes/spinout_lab');
    const sql = getSQL(env);
    const r = await recordMilestone(sql, userId, EIN_MILESTONE);
    await sql.end();
    if (!r.ok) return { user_id: userId, recorded: false, reason: r.status === 409 ? 'lab_inactive' : 'error' };
    const { creditLabMilestone } = await import('./labMilestoneCredits');
    return { user_id: userId, recorded: true, milestone_credit: await creditLabMilestone(env, userId, EIN_MILESTONE) };
  } catch (e) {
    console.warn('[lab] ein_received not recorded', (e as Error).message);
    return { user_id: userId, recorded: false, reason: 'error' };
  }
}

/** Record `ein_received` for the project's owning founder account(s). */
export async function markEinReceived(env: Env, project: { founder_id: number | null }): Promise<EinMilestoneOutcome[]> {
  if (project.founder_id == null) return [];
  try {
    const owners = (await env.DB.prepare(OWNERS).bind(project.founder_id).all<{ id: number }>()).results || [];
    const out: EinMilestoneOutcome[] = [];
    for (const o of owners) out.push(await markFor(env, Number(o.id)));
    return out;
  } catch (e) {
    console.warn('[lab] ein_received owners unreadable', (e as Error).message);
    return [];
  }
}
