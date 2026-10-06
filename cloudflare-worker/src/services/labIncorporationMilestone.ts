/**
 * D585 (#1212) — `incorporation_completed` is recorded by the Worker, from the
 * server's own order status, at payment (the owner's answer A).
 *
 * WHY. Recording that milestone graduates the founder: it issues the
 * certificate (certificateIssuance) and pays D541's graduation bonus. It used
 * to be recorded by the browser, once the Lab Incorporate page saw a paid
 * order, and by Eadwyn's answer to the entity question, with no payment at
 * all. Now the only way it is recorded is this function, and this function
 * records it only when the founder has an order the payment webhook marked
 * paid (or later in the filing flow).
 *
 * WHERE IT RUNS.
 *   - The payment webhook, the moment an order moves from pending_payment to
 *     paid (`recordPaidIncorporation` and `…FromPaymentIntent`).
 *   - `GET /api/spinout-lab/state`, so a founder whose week 4 was still locked
 *     by the cohort calendar at payment is recorded once it unlocks. The
 *     calendar lock and a frozen sprint apply here exactly as they do to
 *     `POST /milestone`.
 *   - `POST /api/spinout-lab/milestone` and Eadwyn's entity answer, which
 *     used to record it directly, now call this and record nothing without a
 *     paid order.
 *
 * EXACTLY ONCE. The milestone row is unique per user, the credit grants are
 * keyed per milestone, and the certificate is issued once. A replayed webhook
 * finds the milestone already recorded and does nothing.
 *
 * NEVER THROWS. A payment or a state read must not fail because the
 * milestone could not be written; the outcome says what happened, and the
 * next state read tries again.
 */
import type { Env } from '../types';
import { getSQL } from '../db';

export const INCORPORATION_MILESTONE = 'incorporation_completed';

/** Order statuses at or past payment. `filed` is #998's; nothing sets it yet. */
export const PAID_ORDER_STATUSES = ['paid', 'packet_processing', 'packet_ready', 'filed'] as const;

const PAID_ORDER_SQL =
  'SELECT id FROM incorporations WHERE user_id = ? AND status IN (' + PAID_ORDER_STATUSES.map(() => '?').join(', ') + ') LIMIT 1';

export type IncorporationMilestoneOutcome =
  | { recorded: true; milestone_credit: unknown; graduation_credit: unknown }
  | { recorded: false; reason: 'not_paid' | 'already_recorded' | 'week_locked' | 'frozen' | 'lab_inactive' | 'error' };

/** True when the user has an incorporation order at or past payment. */
export async function hasPaidIncorporation(env: Env, userId: number): Promise<boolean> {
  const row = await env.DB.prepare(PAID_ORDER_SQL).bind(userId, ...PAID_ORDER_STATUSES).first<{ id: number }>();
  return !!row;
}

/** Record `incorporation_completed` for `userId` if, and only if, a paid order backs it. */
export async function syncIncorporationMilestone(env: Env, userId: number): Promise<IncorporationMilestoneOutcome> {
  try {
    const done = await env.DB.prepare(
      'SELECT 1 AS x FROM spinout_lab_milestones WHERE user_id = ? AND milestone_key = ?',
    ).bind(userId, INCORPORATION_MILESTONE).first();
    if (done) return { recorded: false, reason: 'already_recorded' };
    if (!(await hasPaidIncorporation(env, userId))) return { recorded: false, reason: 'not_paid' };

    // The cohort calendar and a frozen sprint gate this milestone as they gate
    // every other one (POST /milestone). A locked week is caught up on the
    // next state read.
    try {
      const { getCohortGate } = await import('./cohortTiming');
      const gate = await getCohortGate(env, userId);
      if (gate?.frozen) return { recorded: false, reason: 'frozen' };
      if (gate && gate.max_week < 4) return { recorded: false, reason: 'week_locked' };
    } catch { /* gate tables not yet migrated: legacy behaviour, no gate */ }

    const { recordMilestone } = await import('../routes/spinout_lab');
    const sql = getSQL(env);
    const r = await recordMilestone(sql, userId, INCORPORATION_MILESTONE);
    await sql.end();
    if (!r.ok) return { recorded: false, reason: r.status === 409 ? 'lab_inactive' : 'error' };

    const { creditLabMilestone, creditLabGraduation } = await import('./labMilestoneCredits');
    const milestone_credit = await creditLabMilestone(env, userId, INCORPORATION_MILESTONE);
    let graduation_credit: unknown = null;
    try {
      const { issueOnGraduation } = await import('./certificateIssuance');
      if ((await issueOnGraduation(env, userId)) === 'issued') {
        graduation_credit = await creditLabGraduation(env, userId);
      }
    } catch { /* issuance is best-effort; the backfill picks up what it misses */ }
    return { recorded: true, milestone_credit, graduation_credit };
  } catch (e) {
    console.warn('[lab] incorporation milestone not recorded', (e as Error).message);
    return { recorded: false, reason: 'error' };
  }
}

/** The order's user, for the webhook paths that hold only the order id. */
export async function syncIncorporationMilestoneForOrder(env: Env, incorporationId: number): Promise<IncorporationMilestoneOutcome> {
  try {
    const row = await env.DB.prepare('SELECT user_id FROM incorporations WHERE id = ?').bind(incorporationId).first<{ user_id: number }>();
    if (!row) return { recorded: false, reason: 'not_paid' };
    return await syncIncorporationMilestone(env, Number(row.user_id));
  } catch (e) {
    console.warn('[lab] incorporation milestone not recorded', (e as Error).message);
    return { recorded: false, reason: 'error' };
  }
}
