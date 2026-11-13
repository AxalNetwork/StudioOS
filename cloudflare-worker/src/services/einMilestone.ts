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

export const EIN_MILESTONE = 'ein_received';

export type EinMilestoneOutcome =
  | { user_id: number; recorded: true; milestone_credit: unknown }
  | { user_id: number; recorded: false; reason: 'already_recorded' | 'week_locked' | 'frozen' | 'lab_inactive' | 'ineligible' | 'unavailable' | 'not_paid' | 'error' };

const OWNERS = "SELECT id FROM users WHERE founder_id = ? AND role = 'founder' ORDER BY id";
const HAS_MILESTONE = 'SELECT 1 AS x FROM spinout_lab_milestones WHERE user_id = ? AND milestone_key = ?';

async function markFor(env: Env, userId: number): Promise<EinMilestoneOutcome> {
  try {
    if (await env.DB.prepare(HAS_MILESTONE).bind(userId, EIN_MILESTONE).first()) {
      return { user_id: userId, recorded: false, reason: 'already_recorded' };
    }
    // D4657: one recorder, one policy; the saved EIN is the evidence.
    const { recordLabMilestone, outcomeReason } = await import('./labProgress');
    const r = await recordLabMilestone(env, userId, EIN_MILESTONE, 'ein');
    if (!r.ok) return { user_id: userId, recorded: false, reason: outcomeReason(r) };
    if (!r.inserted) return { user_id: userId, recorded: false, reason: 'already_recorded' };
    return { user_id: userId, recorded: true, milestone_credit: r.milestone_credit };
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
