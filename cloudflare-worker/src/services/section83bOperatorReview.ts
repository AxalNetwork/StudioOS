/**
 * D580 (#1207) — 83(b) operator review: an Axal admin assigned to a startup
 * checks its 83(b) filing record (the owner's answers 1A, 2A, 3A).
 *
 * Operator review is a check that the filing record is complete. It is not tax
 * or legal advice. It does not gate graduation: nothing here is read by a Lab
 * milestone, the certificate or the cohort gate.
 *
 * THE STORE is migration 398: append-only assignments (the newest is the
 * current operator; a NULL operator is an unassignment) and append-only
 * reviews (the newest is the last review, and its follow-up date is the next
 * one). Only an admin writes (routes/admin_83b_review.ts), and each write is
 * also recorded through logAdminAction.
 *
 * WHO READS. An admin reads any startup's. A founder reads their own
 * startup's: its owning founder, or an accepted owner or co-founder member
 * (`canAccessProject` with `write`, so an advisor member does not). Anyone
 * else, a partner and an investor included, is told the startup does not
 * exist (404), as the issue asks.
 */
import type { Env, User } from '../types';
import { canAccessProject } from './projectAccess';
import { isCalendarDate } from './section83b';

export const OPERATOR_REVIEW_ITEM = 'section_83b_filing_record';
export const REVIEW_OUTCOMES = ['complete', 'incomplete'] as const;
export type ReviewOutcome = (typeof REVIEW_OUTCOMES)[number];

/** The on-screen wording of the role (#1207 question 4, proposed by S08). */
export const OPERATOR_ROLE_NOTE = 'Operator review is a check that the filing record is complete. It is not tax or legal advice.';

const PROJECT_BY_ID = 'SELECT id, name, founder_id FROM projects WHERE id = ?';

const CURRENT_ASSIGNMENT =
  'SELECT a.operator_user_id AS operator_user_id, u.name AS operator_name, a.created_at AS assigned_at '
  + 'FROM section_83b_operator_assignments a LEFT JOIN users u ON u.id = a.operator_user_id '
  + 'WHERE a.project_id = ? ORDER BY a.id DESC LIMIT 1';

const LAST_REVIEW =
  'SELECT r.uid AS uid, r.tracker_id AS tracker_id, r.outcome AS outcome, r.note AS note, '
  + 'r.follow_up_date AS follow_up_date, r.created_at AS reviewed_at, '
  + 'r.operator_user_id AS operator_user_id, u.name AS operator_name '
  + 'FROM section_83b_operator_reviews r LEFT JOIN users u ON u.id = r.operator_user_id '
  + 'WHERE r.project_id = ? ORDER BY r.id DESC LIMIT 1';

const INSERT_ASSIGNMENT =
  'INSERT INTO section_83b_operator_assignments (project_id, operator_user_id, assigned_by) VALUES (?, ?, ?)';

const INSERT_REVIEW =
  'INSERT INTO section_83b_operator_reviews '
  + '(project_id, tracker_id, item, operator_user_id, outcome, note, follow_up_date, reviewed_by) '
  + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING uid';

const ACTIVE_ADMIN = "SELECT id, name FROM users WHERE id = ? AND role = 'admin' AND is_active = 1";

const TRACKER_OF_PROJECT = 'SELECT id FROM section_83b_trackers WHERE id = ? AND project_id = ?';

export type ProjectRow = { id: number; name: string; founder_id: number | null };

export async function projectById(env: Env, projectId: number): Promise<ProjectRow | null> {
  if (!Number.isInteger(projectId) || projectId <= 0) return null;
  return (await env.DB.prepare(PROJECT_BY_ID).bind(projectId).first<ProjectRow>()) || null;
}

/** Whether `user` may read this startup's operator and reviews. See the header. */
export async function canReadOperatorReview(
  env: Env, user: Pick<User, 'id' | 'role' | 'founder_id'>, project: ProjectRow,
): Promise<boolean> {
  if (user.role === 'partner' || user.role === 'investor') return false;
  // An admin passes `canAccessProject` on role alone.
  return canAccessProject(env, user, project, { write: true });
}

export type OperatorReviewRead = {
  role_note: string;
  operator: { user_id: number; name: string | null; assigned_at: string } | null;
  last_review: {
    uid: string; tracker_id: number | null; outcome: ReviewOutcome; note: string | null;
    follow_up_date: string | null; reviewed_at: string; operator_name: string | null;
  } | null;
  next_follow_up: string | null;
};

/**
 * The startup's current operator, last review and next follow-up date. Each is
 * null when nothing is recorded; the caller prints "Not recorded" with its
 * reason. Throws when the store cannot be read, so the caller says Unreadable.
 */
export async function readOperatorReview(env: Env, projectId: number): Promise<OperatorReviewRead> {
  const a = await env.DB.prepare(CURRENT_ASSIGNMENT).bind(projectId)
    .first<{ operator_user_id: number | null; operator_name: string | null; assigned_at: string }>();
  const r = await env.DB.prepare(LAST_REVIEW).bind(projectId)
    .first<{ uid: string; tracker_id: number | null; outcome: ReviewOutcome; note: string | null;
      follow_up_date: string | null; reviewed_at: string; operator_user_id: number; operator_name: string | null }>();
  return {
    role_note: OPERATOR_ROLE_NOTE,
    operator: a && a.operator_user_id != null
      ? { user_id: Number(a.operator_user_id), name: a.operator_name ?? null, assigned_at: a.assigned_at }
      : null,
    last_review: r
      ? { uid: r.uid, tracker_id: r.tracker_id ?? null, outcome: r.outcome, note: r.note ?? null,
        follow_up_date: r.follow_up_date ?? null, reviewed_at: r.reviewed_at, operator_name: r.operator_name ?? null }
      : null,
    next_follow_up: r?.follow_up_date ?? null,
  };
}

export type WriteResult<T> = { ok: true; value: T } | { ok: false; status: 400 | 404 | 409; error: string };

/** Assign (or, with null, unassign) the startup's operator. The operator must be an active admin. */
export async function assignOperator(
  env: Env, projectId: number, operatorUserId: number | null, adminId: number,
): Promise<WriteResult<{ operator_user_id: number | null; operator_name: string | null }>> {
  let name: string | null = null;
  if (operatorUserId !== null) {
    if (!Number.isInteger(operatorUserId) || operatorUserId <= 0) return { ok: false, status: 400, error: 'operator_user_id_invalid' };
    const op = await env.DB.prepare(ACTIVE_ADMIN).bind(operatorUserId).first<{ id: number; name: string | null }>();
    if (!op) return { ok: false, status: 400, error: 'operator_not_an_admin' };
    name = op.name ?? null;
  }
  await env.DB.prepare(INSERT_ASSIGNMENT).bind(projectId, operatorUserId, adminId).run();
  return { ok: true, value: { operator_user_id: operatorUserId, operator_name: name } };
}

export type ReviewBody = { outcome?: unknown; note?: unknown; follow_up_date?: unknown; tracker_id?: unknown };

/**
 * Record a review of the startup's 83(b) filing record by its current operator.
 * Refused with no operator assigned (409), an unknown outcome, a follow-up date
 * that is not a calendar date or is before `today`, or a tracker of another
 * startup.
 */
export async function recordReview(
  env: Env, projectId: number, body: ReviewBody, adminId: number,
  today = new Date().toISOString().slice(0, 10),
): Promise<WriteResult<{ uid: string; operator_user_id: number; outcome: ReviewOutcome; follow_up_date: string | null }>> {
  const outcome = body.outcome;
  if (!REVIEW_OUTCOMES.includes(outcome as ReviewOutcome)) return { ok: false, status: 400, error: 'outcome_invalid' };
  const followUp = body.follow_up_date == null || body.follow_up_date === '' ? null : body.follow_up_date;
  if (followUp !== null && !isCalendarDate(followUp)) return { ok: false, status: 400, error: 'follow_up_date_invalid' };
  if (followUp !== null && followUp < today) return { ok: false, status: 400, error: 'follow_up_date_past' };
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 2000) : null;
  let trackerId: number | null = null;
  if (body.tracker_id != null && body.tracker_id !== '') {
    trackerId = Number(body.tracker_id);
    const t = Number.isInteger(trackerId) && trackerId > 0
      ? await env.DB.prepare(TRACKER_OF_PROJECT).bind(trackerId, projectId).first()
      : null;
    if (!t) return { ok: false, status: 400, error: 'tracker_not_on_project' };
  }
  const a = await env.DB.prepare(CURRENT_ASSIGNMENT).bind(projectId).first<{ operator_user_id: number | null }>();
  if (!a || a.operator_user_id == null) return { ok: false, status: 409, error: 'no_operator_assigned' };
  const operatorId = Number(a.operator_user_id);
  const row = await env.DB.prepare(INSERT_REVIEW)
    .bind(projectId, trackerId, OPERATOR_REVIEW_ITEM, operatorId, outcome, note, followUp, adminId)
    .first<{ uid: string }>();
  return { ok: true, value: { uid: String(row?.uid), operator_user_id: operatorId, outcome: outcome as ReviewOutcome, follow_up_date: followUp } };
}
