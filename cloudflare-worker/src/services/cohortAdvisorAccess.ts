/**
 * U6 — a cohort's founders are told when an advisor can read them, and can
 * hide themselves from one (D492, migration 367).
 *
 * WHAT AN ASSIGNMENT OPENS (routes/advisors.ts, `/me/cohort/:cycleId/*`):
 *   - `founders`  — every founder's name and email address;
 *   - `weeks`     — every founder's name and week-by-week status and
 *                   deliverables done/required;
 *   - `guidance`  — the names of founders who acted on the advisor's guidance;
 *   - `calendar`  — Lab dates, plus founder names only from sessions the
 *                   founder booked with this advisor directly (not cohort data).
 * Membership is read live from `company_week_status`, so a founder who joins an
 * assigned cohort later is opened to the advisor without anyone acting.
 *
 * THE OWNER'S DECISION (2026-10-02): NOTIFY AND ALLOW OPT-OUT.
 *   - A founder gets an in-app notice naming the advisor when access starts:
 *     for an assignment already active at rollout, a new assignment, and a
 *     founder who joins an assigned cohort later. And another when it ends.
 *   - A founder can hide themselves from one advisor; the three reads above
 *     then leave them out. It is undone the same way.
 *
 * WHEN THE NOTICES GO. `syncCohortAdvisorNotices` is a sweep, not a hook into
 * the Lab: the Lab keeps sole authority over who is in a cohort (206's rule),
 * so nothing here writes to or listens inside a Lab table. The sweep runs when
 * an admin assigns or ends, before an advisor's founders/weeks/guidance read
 * returns (so a founder is told no later than the first time an advisor
 * reads them), when a founder opens their own access list, and nightly. It is
 * idempotent: a notice is sent only when its ledger row is newly inserted.
 *
 * WHAT IS NOT AN END. An advisor whose role changes away from `advisor` loses
 * access at once (every read re-checks the role) but is not reported to
 * founders as an ended assignment: the assignment row is still active, and an
 * admin sees the mismatch on the assignment list and ends it there — which
 * does send the notice.
 */
import type { Env } from '../types';
import { notify } from './notify';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const COHORT_ACCESS_NOTICE_TYPE = 'cohort_advisor_access';
export const COHORT_ACCESS_LINK = '/account/security-privacy';

const cohortLabel = (year: number | null, month: number | null) =>
  year && month && month >= 1 && month <= 12 ? `${MONTHS[month - 1]} ${year}` : 'your';

/** Founders who have hidden themselves from this advisor (an opt-out not undone). */
export async function optedOutFounderIds(env: Env, advisorUserId: number): Promise<Set<number>> {
  const res = await env.DB.prepare(
    'SELECT founder_user_id FROM cohort_advisor_optouts WHERE advisor_user_id = ?1 AND withdrawn_at IS NULL',
  ).bind(advisorUserId).all<{ founder_user_id: number }>();
  return new Set((res.results || []).map((r) => Number(r.founder_user_id)));
}

export interface SyncScope {
  cycleId?: number | null;
  founderUserId?: number | null;
  assignmentId?: number | null;
  /** Rows considered per kind in one call (default 500). */
  limit?: number;
}

/**
 * Send every start and end notice that is owed in `scope` and not yet sent.
 * Returns how many of each were sent.
 */
export async function syncCohortAdvisorNotices(env: Env, scope: SyncScope = {}): Promise<{ started: number; ended: number }> {
  const cycle = scope.cycleId ?? null;
  const founder = scope.founderUserId ?? null;
  const assignment = scope.assignmentId ?? null;
  const limit = Math.max(1, Math.min(2000, Math.floor(scope.limit ?? 500)));
  let started = 0;
  let ended = 0;

  // STARTED — an active assignment held by a current advisor, over a founder in
  // that cohort who has not hidden themselves from that advisor, whose notice
  // for this episode has not been sent.
  const owedStart = await env.DB.prepare(
    `SELECT a.id AS assignment_id, a.assigned_at AS episode_at, a.advisor_user_id AS advisor_user_id,
            u.name AS advisor_name, c.year AS year, c.month AS month, w.user_id AS founder_user_id
       FROM advisor_cohort_assignments a
       JOIN users u ON u.id = a.advisor_user_id
       LEFT JOIN cohort_cycles c ON c.id = a.cohort_cycle_id
       JOIN (SELECT DISTINCT user_id, cohort_cycle_id FROM company_week_status) w
         ON w.cohort_cycle_id = a.cohort_cycle_id
      WHERE a.is_active = 1 AND u.role = 'advisor'
        AND (?1 IS NULL OR a.cohort_cycle_id = ?1)
        AND (?2 IS NULL OR w.user_id = ?2)
        AND (?3 IS NULL OR a.id = ?3)
        AND NOT EXISTS (SELECT 1 FROM cohort_advisor_optouts o
                         WHERE o.founder_user_id = w.user_id AND o.advisor_user_id = a.advisor_user_id
                           AND o.withdrawn_at IS NULL)
        AND NOT EXISTS (SELECT 1 FROM cohort_advisor_notices n
                         WHERE n.assignment_id = a.id AND n.founder_user_id = w.user_id
                           AND n.kind = 'started' AND n.episode_at = a.assigned_at)
      ORDER BY a.id, w.user_id
      LIMIT ?4`,
  ).bind(cycle, founder, assignment, limit).all<{
    assignment_id: number; episode_at: string; advisor_user_id: number; advisor_name: string | null;
    year: number | null; month: number | null; founder_user_id: number;
  }>();
  for (const r of owedStart.results || []) {
    const ins = await env.DB.prepare(
      `INSERT OR IGNORE INTO cohort_advisor_notices (assignment_id, founder_user_id, kind, episode_at)
       VALUES (?1, ?2, 'started', ?3)`,
    ).bind(r.assignment_id, r.founder_user_id, r.episode_at).run();
    if (!(Number(ins.meta?.changes) > 0)) continue;
    started += 1;
    const who = r.advisor_name?.trim() || 'An advisor';
    const label = cohortLabel(r.year, r.month);
    await notify(env, {
      userId: r.founder_user_id,
      type: COHORT_ACCESS_NOTICE_TYPE,
      category: 'privacy',
      title: `${who} can see you in your Spin-Out Lab cohort`,
      body: `Axal assigned ${who} to the ${label} cohort. They can see your name, email address and weekly progress. You can hide yourself from them in Account → Security & Privacy.`,
      link: COHORT_ACCESS_LINK,
      payload: { kind: 'started', assignment_id: r.assignment_id, advisor_user_id: r.advisor_user_id },
    });
  }

  // ENDED — a founder who was told an episode started, where that episode is
  // over (the assignment was ended, or re-assigned, which is a new episode) and
  // the end has not been sent.
  const owedEnd = await env.DB.prepare(
    `SELECT n.assignment_id AS assignment_id, n.episode_at AS episode_at, n.founder_user_id AS founder_user_id,
            a.advisor_user_id AS advisor_user_id, u.name AS advisor_name, c.year AS year, c.month AS month
       FROM cohort_advisor_notices n
       JOIN advisor_cohort_assignments a ON a.id = n.assignment_id
       LEFT JOIN users u ON u.id = a.advisor_user_id
       LEFT JOIN cohort_cycles c ON c.id = a.cohort_cycle_id
      WHERE n.kind = 'started'
        AND (a.is_active = 0 OR a.assigned_at <> n.episode_at)
        AND (?1 IS NULL OR a.cohort_cycle_id = ?1)
        AND (?2 IS NULL OR n.founder_user_id = ?2)
        AND (?3 IS NULL OR a.id = ?3)
        AND NOT EXISTS (SELECT 1 FROM cohort_advisor_notices e
                         WHERE e.assignment_id = n.assignment_id AND e.founder_user_id = n.founder_user_id
                           AND e.kind = 'ended' AND e.episode_at = n.episode_at)
      ORDER BY n.assignment_id, n.founder_user_id
      LIMIT ?4`,
  ).bind(cycle, founder, assignment, limit).all<{
    assignment_id: number; episode_at: string; founder_user_id: number; advisor_user_id: number;
    advisor_name: string | null; year: number | null; month: number | null;
  }>();
  for (const r of owedEnd.results || []) {
    const ins = await env.DB.prepare(
      `INSERT OR IGNORE INTO cohort_advisor_notices (assignment_id, founder_user_id, kind, episode_at)
       VALUES (?1, ?2, 'ended', ?3)`,
    ).bind(r.assignment_id, r.founder_user_id, r.episode_at).run();
    if (!(Number(ins.meta?.changes) > 0)) continue;
    ended += 1;
    const who = r.advisor_name?.trim() || 'An advisor';
    await notify(env, {
      userId: r.founder_user_id,
      type: COHORT_ACCESS_NOTICE_TYPE,
      category: 'privacy',
      title: `${who} can no longer see you in your Spin-Out Lab cohort`,
      body: `${who}'s access to the ${cohortLabel(r.year, r.month)} cohort has ended.`,
      link: COHORT_ACCESS_LINK,
      payload: { kind: 'ended', assignment_id: r.assignment_id, advisor_user_id: r.advisor_user_id },
    });
  }
  return { started, ended };
}

export interface FounderAdvisorAccess {
  advisor_user_id: number;
  advisor_name: string | null;
  cohort_cycle_id: number;
  cohort_label: string;
  assigned_at: string;
  ended_at: string | null;
  /** True when this advisor can read the founder right now. */
  can_see: boolean;
  /** The founder's own opt-out, when one is in force. */
  hidden_at: string | null;
}

/** Every advisor assignment on a cohort the founder is in, current first. */
export async function founderAdvisorAccess(env: Env, founderUserId: number): Promise<FounderAdvisorAccess[]> {
  const res = await env.DB.prepare(
    `SELECT a.advisor_user_id AS advisor_user_id, u.name AS advisor_name, u.role AS advisor_role,
            a.cohort_cycle_id AS cohort_cycle_id, c.year AS year, c.month AS month,
            a.assigned_at AS assigned_at, a.unassigned_at AS unassigned_at, a.is_active AS is_active,
            (SELECT o.opted_out_at FROM cohort_advisor_optouts o
              WHERE o.founder_user_id = ?1 AND o.advisor_user_id = a.advisor_user_id AND o.withdrawn_at IS NULL) AS hidden_at
       FROM advisor_cohort_assignments a
       LEFT JOIN users u ON u.id = a.advisor_user_id
       LEFT JOIN cohort_cycles c ON c.id = a.cohort_cycle_id
      WHERE a.cohort_cycle_id IN (SELECT DISTINCT cohort_cycle_id FROM company_week_status WHERE user_id = ?1)
      ORDER BY a.is_active DESC, a.assigned_at DESC
      LIMIT 100`,
  ).bind(founderUserId).all<{
    advisor_user_id: number; advisor_name: string | null; advisor_role: string | null; cohort_cycle_id: number;
    year: number | null; month: number | null; assigned_at: string; unassigned_at: string | null;
    is_active: number; hidden_at: string | null;
  }>();
  return (res.results || []).map((r) => {
    const live = Number(r.is_active) === 1 && r.advisor_role === 'advisor';
    return {
      advisor_user_id: Number(r.advisor_user_id),
      advisor_name: r.advisor_name ?? null,
      cohort_cycle_id: Number(r.cohort_cycle_id),
      cohort_label: cohortLabel(r.year, r.month) === 'your' ? 'Spin-Out Lab cohort' : `${cohortLabel(r.year, r.month)} cohort`,
      assigned_at: r.assigned_at,
      ended_at: live ? null : (r.unassigned_at ?? null),
      can_see: live && !r.hidden_at,
      hidden_at: r.hidden_at ?? null,
    };
  });
}

/**
 * The founder hides themselves from one advisor, or undoes it. Only an advisor
 * who holds or held an assignment on one of the founder's cohorts can be named:
 * the opt-out is about a real grant, not a list of arbitrary user ids.
 * Returns false when the advisor is not one of those.
 */
export async function setFounderVisibility(env: Env, founderUserId: number, advisorUserId: number, visible: boolean): Promise<boolean> {
  const known = await env.DB.prepare(
    `SELECT 1 AS ok FROM advisor_cohort_assignments
      WHERE advisor_user_id = ?1
        AND cohort_cycle_id IN (SELECT DISTINCT cohort_cycle_id FROM company_week_status WHERE user_id = ?2)
      LIMIT 1`,
  ).bind(advisorUserId, founderUserId).first<{ ok: number }>();
  if (!known) return false;
  const now = new Date().toISOString();
  if (visible) {
    await env.DB.prepare(
      'UPDATE cohort_advisor_optouts SET withdrawn_at = ?3 WHERE founder_user_id = ?1 AND advisor_user_id = ?2 AND withdrawn_at IS NULL',
    ).bind(founderUserId, advisorUserId, now).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO cohort_advisor_optouts (founder_user_id, advisor_user_id, opted_out_at, withdrawn_at)
       VALUES (?1, ?2, ?3, NULL)
       ON CONFLICT (founder_user_id, advisor_user_id) DO UPDATE SET opted_out_at = excluded.opted_out_at, withdrawn_at = NULL`,
    ).bind(founderUserId, advisorUserId, now).run();
  }
  return true;
}
