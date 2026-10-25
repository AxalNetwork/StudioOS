/**
 * D945 (#2750) — Spin-Out Lab part 3: the queue's three writes beyond one
 * decision. Mounted inside admin_cohort.ts, so at /api/admin/cohort. Every
 * route is an admin's, frozen on a suspended branch (D107), and needs a reason.
 *
 *   POST /applications/:applicant_id/move → { cycle_id, reason, confirm_over_places? }
 *        SL4 D: an undecided, waitlisted or approved applicant to another OPEN
 *        cohort. The founder is told. One audit row and one cycle event.
 *   POST /applications/bulk-decide        → { applicant_ids (1–25), status: approved|waitlisted, reason, confirm_over_places? }
 *        SL2's bulk bar: each applicant through D943's one decision path, so
 *        places are enforced there and each has its own audit row.
 *   POST /applications/admit              → { user_id, cycle_id, reason, company_name?, confirm_over_places? }
 *        SL4 G: creates the application on the founder's behalf and its
 *        approved cohort_applicants row in an OPEN cohort, so the queue and the
 *        calendar agree. Users' "Spin-Out admit" (admin.ts) calls the same write.
 *
 * "Open" is the cycle's `app_status = 'open'`: its applications window has not
 * closed. Nobody is activated here; the scheduler starts approved founders on
 * the cohort's 1st (D943).
 */
import { Hono, type Context } from 'hono';
import type { Env, User } from '../types';
import { requireAdmin, requireBranchNotSuspended } from '../auth';
import { ensureCohortAppSchema, monthLabel, notifyOnce } from '../services/cohortApplications';
import {
  APPLICANT_BY_ID_SQL, activityValues, cohortPlaces, decideApplicant, tellDecision, type Refused,
} from '../services/labDecisions';

const r = new Hono<{ Bindings: Env }>();

export const BULK_MAX = 25;
const MOVABLE = ['pending', 'waitlisted', 'approved'];
// A live application: one the queue still holds, or a founder it already
// started — pending, waitlisted, approved or activated. Written out in both
// statements below that read it.

function refusal(c: Context<any>, status: number, code: string, message: string) {
  return c.json({ error: code, message, detail: message }, status as any);
}
const refused = (status: Refused['status'], code: string, message: string): Refused => ({ ok: false, status, code, message });

function reasonOf(raw: unknown): string {
  return (typeof raw === 'string' ? raw : '').trim().slice(0, 500);
}
function idOf(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw) : NaN;
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}
const labelOf = (row: Record<string, unknown>) => monthLabel(Number(row.year), Number(row.month));

async function openCycle(env: Env, cycleId: number): Promise<{ ok: true; cycle: Record<string, unknown> } | Refused> {
  const cycle = await env.DB.prepare('SELECT * FROM cohort_cycles WHERE id = ?').bind(cycleId).first<Record<string, unknown>>();
  if (!cycle) return refused(404, 'cohort_not_found', 'That cohort does not exist.');
  if (cycle.app_status !== 'open') {
    return refused(409, 'cohort_not_open', `Only an open cohort can take a founder. The ${labelOf(cycle)} cohort is ${cycle.app_status}.`);
  }
  return { ok: true, cycle };
}

// ---------------------------------------------------------------------------
// Move to another cohort (SL4 D)
// ---------------------------------------------------------------------------

r.post('/applications/:applicant_id/move', async (c) => {
  const adminUser = await requireAdmin(c);
  await requireBranchNotSuspended(c);
  await ensureCohortAppSchema(c.env);
  const applicantId = idOf(c.req.param('applicant_id'));
  if (!applicantId) return refusal(c, 400, 'invalid_applicant', 'That applicant id is not valid.');
  const body = (await c.req.json().catch(() => ({}))) as { cycle_id?: unknown; reason?: unknown; confirm_over_places?: unknown };
  const reason = reasonOf(body.reason);
  if (!reason) return refusal(c, 400, 'reason_required', 'Say why this founder is moving to another cohort.');
  const cycleId = idOf(body.cycle_id);
  if (!cycleId) return refusal(c, 400, 'invalid_cohort', 'Choose the cohort to move them to.');

  const row = await c.env.DB.prepare(APPLICANT_BY_ID_SQL).bind(applicantId).first<Record<string, unknown>>();
  if (!row) return refusal(c, 404, 'applicant_not_found', 'That cohort applicant does not exist.');
  const status = String(row.status);
  if (!MOVABLE.includes(status)) {
    return refusal(c, 409, 'not_movable', `This applicant is ${status}; only an undecided, waitlisted or approved applicant moves.`);
  }
  if (Number(row.cohort_cycle_id) === cycleId) return refusal(c, 400, 'same_cohort', 'They are already in that cohort.');
  const open = await openCycle(c.env, cycleId);
  if (!open.ok) return refusal(c, open.status, open.code, open.message);
  const target = open.cycle;
  const already = await c.env.DB.prepare('SELECT id FROM cohort_applicants WHERE application_id = ? AND cohort_cycle_id = ?')
    .bind(row.application_id, cycleId).first();
  if (already) return refusal(c, 409, 'already_in_cohort', 'This application already has a place in that cohort’s history, so it cannot move there again.');
  let max = 0;
  if (status === 'approved') {
    const places = await cohortPlaces(c.env);
    if (typeof places !== 'number') return refusal(c, places.status, places.code, places.message);
    max = places;
  }
  const confirmed = status === 'approved' && body.confirm_over_places === true;
  const from = labelOf(row);
  const to = labelOf(target);
  const actor = `admin:${adminUser.id}`;
  const audit = await activityValues(adminUser, 'cohort_applicant_moved',
    `Admin ${adminUser.name} moved applicant #${applicantId} (${status}) from ${from} to ${to} (reason: ${reason})`);
  // One batch. The new row carries the applicant's status and its decision,
  // and is written only while the target is open, the applicant unchanged and,
  // for an approved founder, a place free there (D943's rule, in the same
  // statement). The old row is carried forward, as the scheduler's rollover
  // marks it, so every reader that knows `rolled_forward` reads a move too.
  const res = await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT OR IGNORE INTO cohort_applicants
         (application_id, user_id, cohort_cycle_id, status, rolled_from_cycle_id, decided_at, decided_by, decision_reason)
       SELECT ca.application_id, ca.user_id, ?, ca.status, ca.cohort_cycle_id, ca.decided_at, ca.decided_by, ca.decision_reason
         FROM cohort_applicants ca
        WHERE ca.id = ? AND ca.status = ?
          AND EXISTS (SELECT 1 FROM cohort_cycles WHERE id = ? AND app_status = 'open')
          AND (ca.status <> 'approved' OR ? = 1 OR
            (SELECT COUNT(*) FROM cohort_applicants WHERE cohort_cycle_id = ? AND status IN ('approved', 'activated')) < ?)`,
    ).bind(cycleId, applicantId, status, cycleId, confirmed ? 1 : 0, cycleId, max),
    c.env.DB.prepare(
      `UPDATE cohort_applicants SET status = 'rolled_forward', decided_at = datetime('now'), decided_by = ?, decision_reason = ?
        WHERE id = ? AND status = ? AND changes() = 1`,
    ).bind(actor, `Moved to ${to}: ${reason}`, applicantId, status),
    c.env.DB.prepare(
      `INSERT INTO cohort_cycle_events (cohort_cycle_id, event_type, details, actor)
       SELECT ?, 'applicant_moved', ?, ? WHERE changes() = 1`,
    ).bind(cycleId, `Applicant #${applicantId} (user_id=${row.user_id}, ${status}) moved from ${from} to ${to}: ${reason}; confirm_over_places=${confirmed}`, actor),
    c.env.DB.prepare(
      `INSERT INTO activity_logs (action, details, actor, user_id) SELECT action, details, actor, user_id
         FROM (SELECT ? AS action, ? AS details, ? AS actor, ? AS user_id) WHERE changes() = 1`,
    ).bind(...audit),
    c.env.DB.prepare(`UPDATE spinout_applications SET cohort = ? WHERE id = ? AND changes() = 1`).bind(to, row.application_id),
  ]);
  if (Number(res[0].meta?.changes ?? 0) !== 1) {
    const now = await c.env.DB.prepare('SELECT status FROM cohort_applicants WHERE id = ?').bind(applicantId).first<{ status: string }>();
    if (!now || now.status !== status) return refusal(c, 409, 'decision_conflict', 'This application changed while you were moving it. Refresh and try again.');
    const still = await openCycle(c.env, cycleId);
    if (!still.ok) return refusal(c, still.status, still.code, still.message);
    const raced = await c.env.DB.prepare('SELECT id FROM cohort_applicants WHERE application_id = ? AND cohort_cycle_id = ?')
      .bind(row.application_id, cycleId).first();
    if (raced) return refusal(c, 409, 'already_in_cohort', 'This application already has a place in that cohort’s history, so it cannot move there again.');
    return refusal(c, 409, 'over_places', `The ${to} cohort's ${max} places are taken. Confirm moving past the places to continue.`);
  }
  const moved = await c.env.DB.prepare('SELECT id FROM cohort_applicants WHERE application_id = ? AND cohort_cycle_id = ?')
    .bind(row.application_id, cycleId).first<{ id: number }>();
  const founderTold = await notifyOnce(c.env, {
    userId: Number(row.user_id), cycleId, notifType: 'moved_cohort',
    title: `Your Spin-Out Lab cohort moved to ${to}`,
    body: status === 'approved'
      ? `Your place moved from the ${from} cohort to the ${to} cohort. Your workspace unlocks when the ${to} cohort starts on the 1st.`
      : `Your application moved from the ${from} cohort to the ${to} cohort, and will be decided there. No action needed.`,
  }).catch((e) => { console.warn('[admin-lab/move] notify failed', e); return false; });
  return c.json({
    ok: true, applicant_id: moved?.id ?? null, moved_from_applicant_id: applicantId,
    status, from_cohort: from, cohort: to, cycle_id: cycleId, founder_told: founderTold,
  });
});

// ---------------------------------------------------------------------------
// Bulk decisions (SL2's bulk bar)
// ---------------------------------------------------------------------------

r.post('/applications/bulk-decide', async (c) => {
  const adminUser = await requireAdmin(c);
  await requireBranchNotSuspended(c);
  await ensureCohortAppSchema(c.env);
  const body = (await c.req.json().catch(() => ({}))) as { applicant_ids?: unknown; status?: unknown; reason?: unknown; confirm_over_places?: unknown };
  const status = (typeof body.status === 'string' ? body.status : '').trim().toLowerCase();
  if (status !== 'approved' && status !== 'waitlisted') return refusal(c, 400, 'bad_status', 'A bulk decision approves or waitlists.');
  const reason = reasonOf(body.reason);
  if (!reason) return refusal(c, 400, 'reason_required', 'One reason covers them all, and it is required.');
  const raw = Array.isArray(body.applicant_ids) ? body.applicant_ids : [];
  const ids = raw.map(idOf);
  if (ids.length === 0) return refusal(c, 400, 'nothing_selected', 'Select at least one applicant.');
  if (ids.length > BULK_MAX) return refusal(c, 400, 'too_many', `A bulk decision takes up to ${BULK_MAX} applicants.`);
  if (ids.some((id) => id === null)) return refusal(c, 400, 'invalid_applicant', 'One of the applicant ids is not valid.');
  if (new Set(ids).size !== ids.length) return refusal(c, 400, 'duplicate_applicant', 'An applicant is selected twice.');
  // In the order given, each through the one decision path: the places count
  // is read again for each, so the bulk bar can never take more than a single
  // decision could.
  const results: Array<Record<string, unknown>> = [];
  for (const id of ids as number[]) {
    const row = await c.env.DB.prepare(APPLICANT_BY_ID_SQL).bind(id).first<Record<string, unknown>>();
    if (!row) { results.push({ applicant_id: id, ok: false, error: 'applicant_not_found', message: 'That cohort applicant does not exist.' }); continue; }
    const out = await decideApplicant(c.env, adminUser, row, { status, reason, confirmOverPlaces: body.confirm_over_places === true });
    results.push(out.ok
      ? { applicant_id: id, ok: true, status, emailed: out.emailed }
      : { applicant_id: id, ok: false, error: out.code, message: out.message });
  }
  const decided = results.filter((x) => x.ok).length;
  return c.json({ ok: true, status, decided, refused: results.length - decided, results });
});

// ---------------------------------------------------------------------------
// Admit without an application (SL4 G; also Users' "Spin-Out admit")
// ---------------------------------------------------------------------------

export type Admitted = { ok: true; application_id: number; applicant_id: number; cycle_id: number; cohort: string; emailed: boolean };

export async function admitWithoutApplication(env: Env, adminUser: User, input: {
  userId: number; cycleId: number; reason: string; companyName: string; confirmOverPlaces: boolean;
}): Promise<Admitted | Refused> {
  await ensureCohortAppSchema(env);
  const { userId, cycleId, reason } = input;
  const user = await env.DB.prepare('SELECT id, role, spinout_lab_active, is_incorporated FROM users WHERE id = ?')
    .bind(userId).first<Record<string, unknown>>();
  if (!user) return refused(404, 'user_not_found', 'That account does not exist.');
  if (user.role === 'admin') return refused(400, 'admin_not_admissible', 'Admins cannot be admitted to the Lab.');
  // `is_incorporated` is only ever set by finishing or exiting the Lab, so
  // this refuses an alumnus, not a founder who arrived with a company.
  if (Number(user.is_incorporated) === 1) return refused(409, 'lab_alumnus', 'This account has already been through the Lab.');
  if (Number(user.spinout_lab_active) === 1) return refused(409, 'already_in_lab', 'This founder is already in the Lab.');
  const live = await liveApplicant(env, userId);
  if (live) return live;
  const open = await openCycle(env, cycleId);
  if (!open.ok) return open;
  const cycle = open.cycle;
  const places = await cohortPlaces(env);
  if (typeof places !== 'number') return places;
  const confirmed = input.confirmOverPlaces === true;
  const label = labelOf(cycle);
  const actor = `admin:${adminUser.id}`;
  const audit = await activityValues(adminUser, 'cohort_applicant_admitted',
    `Admin ${adminUser.name} admitted user_id=${userId} to ${label} without an application (reason: ${reason})`);
  // One batch: the application, its approved place, the cycle event and the
  // audit row, or none of them. The first statement holds every check that a
  // concurrent write could change — the cohort still open, no live
  // application for this founder, and a place free (D943's count).
  const res = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO spinout_applications (user_id, company_name, idea, cohort, status)
       SELECT ?, ?, '', ?, 'pending'
        WHERE EXISTS (SELECT 1 FROM cohort_cycles WHERE id = ? AND app_status = 'open')
          AND NOT EXISTS (SELECT 1 FROM cohort_applicants WHERE user_id = ? AND status IN ('pending', 'waitlisted', 'approved', 'activated'))
          AND (? = 1 OR (SELECT COUNT(*) FROM cohort_applicants WHERE cohort_cycle_id = ? AND status IN ('approved', 'activated')) < ?)`,
    ).bind(userId, input.companyName, label, cycleId, userId, confirmed ? 1 : 0, cycleId, places),
    env.DB.prepare(
      `INSERT INTO cohort_applicants (application_id, user_id, cohort_cycle_id, status, decided_at, decided_by, decision_reason)
       SELECT last_insert_rowid(), ?, ?, 'approved', datetime('now'), ?, ? WHERE changes() = 1`,
    ).bind(userId, cycleId, actor, reason),
    env.DB.prepare(
      `INSERT INTO cohort_cycle_events (cohort_cycle_id, event_type, details, actor)
       SELECT ?, 'applicant_admitted_without_application', ?, ? WHERE changes() = 1`,
    ).bind(cycleId, `User #${userId} admitted to ${label} without an application: ${reason}; confirm_over_places=${confirmed}`, actor),
    env.DB.prepare(
      `INSERT INTO activity_logs (action, details, actor, user_id) SELECT action, details, actor, user_id
         FROM (SELECT ? AS action, ? AS details, ? AS actor, ? AS user_id) WHERE changes() = 1`,
    ).bind(...audit),
  ]);
  if (Number(res[0].meta?.changes ?? 0) !== 1) {
    const raced = await liveApplicant(env, userId);
    if (raced) return raced;
    const still = await openCycle(env, cycleId);
    if (!still.ok) return still;
    return refused(409, 'over_places', `This admission would exceed the ${places} cohort places. Confirm admitting past the places to continue.`);
  }
  const applicationId = Number(res[0].meta?.last_row_id);
  const applicantId = Number(res[1].meta?.last_row_id);
  const emailed = await tellDecision(env, {
    userId, cycleId, status: 'approved', year: Number(cycle.year), month: Number(cycle.month), companyName: input.companyName,
  });
  return { ok: true, application_id: applicationId, applicant_id: applicantId, cycle_id: cycleId, cohort: label, emailed };
}

async function liveApplicant(env: Env, userId: number): Promise<Refused | null> {
  const live = await env.DB.prepare(
    `SELECT ca.status, cc.year, cc.month FROM cohort_applicants ca JOIN cohort_cycles cc ON cc.id = ca.cohort_cycle_id
      WHERE ca.user_id = ? AND ca.status IN ('pending', 'waitlisted', 'approved', 'activated') ORDER BY ca.id DESC LIMIT 1`,
  ).bind(userId).first<Record<string, unknown>>();
  if (!live) return null;
  return refused(409, 'already_in_queue',
    `This founder already has an application in the ${labelOf(live)} cohort (${live.status}). Decide or move it there instead.`);
}

/** The admit write over HTTP, for this route and Users' "Spin-Out admit". */
export async function admitRoute(c: Context<{ Bindings: Env }>, adminUser: User, userIdRaw: unknown, body: Record<string, unknown>) {
  const userId = idOf(userIdRaw);
  if (!userId) return refusal(c, 400, 'invalid_user', 'That account id is not valid.');
  if (body.cohort != null) {
    return refusal(c, 400, 'cohort_label_unsupported', 'Choose an open cohort; a free-text cohort label no longer admits anyone.');
  }
  const reason = reasonOf(body.reason);
  if (!reason) return refusal(c, 400, 'reason_required', 'Say why this founder is admitted without an application.');
  const cycleId = idOf(body.cycle_id);
  if (!cycleId) return refusal(c, 400, 'invalid_cohort', 'Choose the open cohort to admit them to.');
  const companyName = (typeof body.company_name === 'string' ? body.company_name : '').trim().slice(0, 200);
  const out = await admitWithoutApplication(c.env, adminUser, {
    userId, cycleId, reason, companyName, confirmOverPlaces: body.confirm_over_places === true,
  });
  if (!out.ok) return refusal(c, out.status, out.code, out.message);
  return c.json({ ...out, already_admitted: false }, 201);
}

r.post('/applications/admit', async (c) => {
  const adminUser = await requireAdmin(c);
  await requireBranchNotSuspended(c);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  return admitRoute(c, adminUser, body.user_id, body);
});

export default r;
