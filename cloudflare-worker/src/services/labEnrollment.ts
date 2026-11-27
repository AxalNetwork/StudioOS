/**
 * D4657 (#4657) — who may be in the Spin-Out Lab, and under which enrollment.
 *
 * ONE POLICY, ONE PLACE. `POST /spinout-lab/start`, every milestone write
 * (`services/labProgress.ts`) and the cohort calendar gate all ask
 * `resolveLabEligibility`. Before, `/start` checked only "already graduated",
 * so a signed-in account that was never admitted, or one an admin had
 * suspended, could switch the Lab on itself; and a gate read that failed let
 * a milestone through "as legacy". Now the answer is one of:
 *
 *   eligible     an admitted cohort member whose assigned cycle has started.
 *   legacy       a founder enrolled before this policy existed, recorded as
 *                such by migration 202611071700. Permitted, never inferred
 *                again from loose columns.
 *   not_started  admitted, but the assigned cycle opens later (`opens_at`).
 *   ineligible   `not_admitted` | `restricted` (a moderation sanction in
 *                force) | `graduated` (has already been through the Lab).
 *   unavailable  a read this decision needs failed. Retryable, and never
 *                treated as permission: the caller answers 503.
 *
 * THE ENROLLMENT. `spinout_lab_enrollments` is the stable reference: the
 * founder, the cycle they were assigned (or, for a legacy founder, the cycle
 * their start fell in), the applicant row and the start instant. The cycle
 * activation writes it (`ensureCohortEnrollment`); an activated applicant
 * whose enrollment is missing (written by an older Worker) is healed on read.
 *
 * Reads only, apart from that heal. Logs carry codes, never values.
 */
import type { Env } from '../types';
import { MODERATION_SANCTION_SQL } from './moderationOpen';

export type LabEnrollment = {
  id: number;
  user_id: number;
  kind: 'cohort' | 'legacy';
  cohort_cycle_id: number | null;
  cycle_source: 'assigned' | 'inferred_start' | null;
  cohort_applicant_id: number | null;
  application_id: number | null;
  project_id: number | null;
  started_at: string | null;
  /** The cycle's own start instant, when the enrollment has a cycle. */
  cycle_start_at: string | null;
  cycle_end_at: string | null;
};

export type LabEligibility =
  | { status: 'eligible'; enrollment: LabEnrollment }
  | { status: 'legacy'; enrollment: LabEnrollment }
  | { status: 'not_started'; enrollment: LabEnrollment; opens_at: string }
  | { status: 'ineligible'; reason: 'not_admitted' | 'restricted' | 'graduated' }
  | { status: 'unavailable'; part: 'user' | 'moderation' | 'enrollment' };

/** A sanction in force for this user (D448's shared predicate, concatenated as a constant). */
const SANCTION_SQL = 'SELECT 1 AS x FROM spinout_moderation_cases WHERE user_id = ? AND ' + MODERATION_SANCTION_SQL + ' LIMIT 1';

/** Permitted to be in the Lab now. */
export const mayParticipate = (e: LabEligibility): e is Extract<LabEligibility, { status: 'eligible' | 'legacy' }> =>
  e.status === 'eligible' || e.status === 'legacy';

/** The HTTP answer for an eligibility that does not permit the action. */
export function refusal(e: LabEligibility): { status: 403 | 409 | 503; body: Record<string, unknown> } {
  if (e.status === 'unavailable') {
    return { status: 503, body: { error: 'Your Lab eligibility could not be read just now. Try again in a moment.', code: 'lab_eligibility_unavailable', retryable: true } };
  }
  if (e.status === 'not_started') {
    return { status: 409, body: { error: 'Your cohort has not started yet. Your workspace opens when it does.', code: 'lab_cohort_not_started', opens_at: e.opens_at } };
  }
  if (e.status === 'ineligible' && e.reason === 'graduated') {
    return { status: 409, body: { error: 'This account has already been through the Lab', code: 'lab_graduated' } };
  }
  if (e.status === 'ineligible' && e.reason === 'restricted') {
    return { status: 403, body: { error: 'Your Lab access is paused while a review is open.', code: 'lab_restricted' } };
  }
  return { status: 403, body: { error: 'The Lab opens to founders admitted to a cohort. Apply for the next cohort to join.', code: 'lab_not_admitted' } };
}

function shape(r: Record<string, unknown>): LabEnrollment {
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const s = (v: unknown) => (v === null || v === undefined ? null : String(v));
  return {
    id: Number(r.id), user_id: Number(r.user_id),
    kind: String(r.kind) === 'cohort' ? 'cohort' : 'legacy',
    cohort_cycle_id: n(r.cohort_cycle_id),
    cycle_source: (s(r.cycle_source) as LabEnrollment['cycle_source']),
    cohort_applicant_id: n(r.cohort_applicant_id), application_id: n(r.application_id),
    project_id: n(r.project_id), started_at: s(r.started_at),
    cycle_start_at: s(r.cycle_start_at), cycle_end_at: s(r.cycle_end_at),
  };
}

/** The founder's current enrollment (the newest), or null. Throws when unreadable. */
export async function readEnrollment(env: Env, userId: number): Promise<LabEnrollment | null> {
  const row = await env.DB.prepare(
    `SELECT e.id, e.user_id, e.kind, e.cohort_cycle_id, e.cycle_source, e.cohort_applicant_id, e.application_id,
            e.project_id, e.started_at, cc.start_at AS cycle_start_at, cc.end_at AS cycle_end_at
       FROM spinout_lab_enrollments e LEFT JOIN cohort_cycles cc ON cc.id = e.cohort_cycle_id
      WHERE e.user_id = ? ORDER BY e.id DESC LIMIT 1`,
  ).bind(userId).first<Record<string, unknown>>();
  return row ? shape(row) : null;
}

/**
 * Record a cohort enrollment for an admitted applicant. Idempotent on
 * (user, cycle): a resumed activation writes nothing new. Throws on failure,
 * so the activation that calls it can leave the applicant for the next run.
 */
export async function ensureCohortEnrollment(env: Env, a: {
  userId: number; cycleId: number; applicantId: number; applicationId: number; startAt: string;
}): Promise<void> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO spinout_lab_enrollments
       (user_id, kind, cohort_cycle_id, cycle_source, cohort_applicant_id, application_id, started_at)
     VALUES (?, 'cohort', ?, 'assigned', ?, ?, ?)`,
  ).bind(a.userId, a.cycleId, a.applicantId, a.applicationId, a.startAt).run();
}

/** An activated applicant whose enrollment row was never written (older Worker). */
async function healFromActivatedApplicant(env: Env, userId: number): Promise<LabEnrollment | null> {
  const a = await env.DB.prepare(
    `SELECT ca.id, ca.application_id, ca.cohort_cycle_id, cc.start_at
       FROM cohort_applicants ca JOIN cohort_cycles cc ON cc.id = ca.cohort_cycle_id
      WHERE ca.user_id = ? AND ca.status = 'activated' ORDER BY ca.id DESC LIMIT 1`,
  ).bind(userId).first<{ id: number; application_id: number; cohort_cycle_id: number; start_at: string }>();
  if (!a) return null;
  await ensureCohortEnrollment(env, {
    userId, cycleId: Number(a.cohort_cycle_id), applicantId: Number(a.id),
    applicationId: Number(a.application_id), startAt: String(a.start_at),
  });
  return readEnrollment(env, userId);
}

const msOf = (ts: string | null): number | null => {
  if (!ts) return null;
  const ms = Date.parse(ts.replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(ts) ? '' : 'Z'));
  return Number.isFinite(ms) ? ms : null;
};

/**
 * The shared decision. `forStart` asks "may this founder switch the Lab on";
 * without it the question is "may this founder record Lab work now", which a
 * graduate (Lab already off) is refused by the caller's own active check.
 */
export async function resolveLabEligibility(env: Env, userId: number, nowMs = Date.now()): Promise<LabEligibility> {
  let user: { is_incorporated: number | null } | null;
  try {
    user = await env.DB.prepare('SELECT is_incorporated FROM users WHERE id = ?').bind(userId).first();
  } catch { console.warn('[lab-eligibility] unreadable', { part: 'user' }); return { status: 'unavailable', part: 'user' }; }
  if (!user) return { status: 'ineligible', reason: 'not_admitted' };

  try {
    const sanction = await env.DB.prepare(SANCTION_SQL).bind(userId).first();
    if (sanction) return { status: 'ineligible', reason: 'restricted' };
  } catch { console.warn('[lab-eligibility] unreadable', { part: 'moderation' }); return { status: 'unavailable', part: 'moderation' }; }

  if (Number(user.is_incorporated ?? 0) === 1) return { status: 'ineligible', reason: 'graduated' };

  let enrollment: LabEnrollment | null;
  try {
    enrollment = await readEnrollment(env, userId);
    if (!enrollment) enrollment = await healFromActivatedApplicant(env, userId);
  } catch { console.warn('[lab-eligibility] unreadable', { part: 'enrollment' }); return { status: 'unavailable', part: 'enrollment' }; }
  if (!enrollment) return { status: 'ineligible', reason: 'not_admitted' };

  if (enrollment.kind === 'legacy') return { status: 'legacy', enrollment };
  const opens = msOf(enrollment.cycle_start_at);
  if (opens === null) return { status: 'unavailable', part: 'enrollment' };
  if (opens > nowMs) return { status: 'not_started', enrollment, opens_at: new Date(opens).toISOString() };
  return { status: 'eligible', enrollment };
}
