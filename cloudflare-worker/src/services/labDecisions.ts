/**
 * D943's one Lab decision path, shared by every door that decides an
 * applicant: the cohort queue's decide, the legacy spinout-applications decide,
 * D945's bulk decisions, and D945's admit without an application. Places are
 * enforced here and nowhere else.
 *
 *   decideApplicant(env, admin, row, input) → one applicant's decision
 *   tellDecision(env, …)                    → the decision email + in-app notice
 *   activityValues(admin, action, text)     → an activity_logs row's four values, for a batch
 */
import type { Env, User } from '../types';
import { hashEmail } from '../util/hashEmail';
import { getCohortSizeSettings, notifyOnce, monthLabel, claimDecisionEmail } from './cohortApplications';

export type DecisionStatus = 'approved' | 'rejected' | 'waitlisted';
export const DECISION_STATUSES: readonly DecisionStatus[] = ['approved', 'rejected', 'waitlisted'];
/** Statuses no decision or move can leave. */
export const TERMINAL_APPLICANT_STATUSES = ['activated', 'rolled_forward', 'withdrawn'] as const;

export type Refused = { ok: false; status: 400 | 404 | 409 | 503; code: string; message: string };
export type Decided = { ok: true; emailed: boolean; applicant_note_saved: boolean | null };

/** The applicant row every decision reads: the applicant, its cycle and its user's role. */
export const APPLICANT_ROW_SQL =
  `SELECT ca.*, cc.year, cc.month, cc.app_status, sa.company_name, u.role
     FROM cohort_applicants ca JOIN cohort_cycles cc ON cc.id = ca.cohort_cycle_id
     JOIN spinout_applications sa ON sa.id = ca.application_id JOIN users u ON u.id = ca.user_id`;
export const APPLICANT_BY_ID_SQL = APPLICANT_ROW_SQL + ' WHERE ca.id = ?';
/** The legacy door's read: the application's newest cohort row. */
export const APPLICANT_BY_APPLICATION_SQL = APPLICANT_ROW_SQL + ' WHERE ca.application_id = ? ORDER BY ca.id DESC LIMIT 1';

/** [action, details, actor, user_id]: the admin's email is kept only as its hash. */
export async function activityValues(admin: User, action: string, details: string): Promise<[string, string, string, number]> {
  return [action, details, await hashEmail(admin.email), admin.id];
}

async function logActivity(env: Env, admin: User, action: string, details: string): Promise<void> {
  try {
    await env.DB.prepare(`INSERT INTO activity_logs (action, details, actor, user_id) VALUES (?, ?, ?, ?)`)
      .bind(...(await activityValues(admin, action, details))).run();
  }
  catch (e) { console.warn('[lab-decisions] activity log failed', e); }
}

/** The cohort's places, or a refusal when the settings cannot be read. */
export async function cohortPlaces(env: Env): Promise<number | Refused> {
  try { return (await getCohortSizeSettings(env)).max; }
  catch { return { ok: false, status: 503, code: 'cohort_settings_unreadable', message: 'The cohort places could not be read, so no approval was saved. Try again.' }; }
}

/**
 * The templated decision email (accepted → welcome link, refused → re-apply
 * link) and the in-app notice, after a decision has committed. Returns whether
 * this call sent the email.
 */
export async function tellDecision(env: Env, args: {
  userId: number; cycleId: number; status: DecisionStatus; year: number; month: number; companyName: unknown;
}): Promise<boolean> {
  const { userId, cycleId, status } = args;
  const label = monthLabel(args.year, args.month);
  // The in-app notification below stays, but with email: false for
  // approved/rejected so candidates don't get two emails for one decision.
  let emailed = false;
  // True once the templated decision email is accounted for — either sent by
  // this call, or already claimed earlier (re-decide, retry, or the legacy
  // admin decide route which claims the same ledger key). notifyOnce below
  // must not email in either case, only when no decision email ever went out.
  let emailHandled = false;
  if (status === 'approved' || status === 'rejected') {
    try {
      // Idempotency: at most ONE decision email per (user, cycle, decision).
      const alreadyClaimed = !(await claimDecisionEmail(env, userId, cycleId, status));
      if (alreadyClaimed) emailHandled = true;
      const target = alreadyClaimed
        ? null
        : await env.DB.prepare(`SELECT email, name FROM users WHERE id = ?`)
            .bind(userId).first<{ email: string; name: string | null }>();
      if (target?.email) {
        const { send } = await import('./email/send');
        const appUrl = (env.APP_URL || 'https://axal.vc').replace(/\/+$/, '');
        if (status === 'approved') {
          const labUrl = `${appUrl}/spinout-lab`;
          const r = await send(env, 'spinout_admitted', target.email, {
            name: target.name || 'there',
            cohort_label: label,
            lab_url: labUrl,
          }, { userId, ctaUrl: labUrl });
          emailed = !!r?.ok;
          if (emailed) emailHandled = true;
        } else {
          const y = args.year; const m = args.month;
          const nextLabel = monthLabel(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1);
          const applyUrl = `${appUrl}/spinout-lab/apply`;
          const r = await send(env, 'spinout_refused', target.email, {
            name: target.name || 'there',
            company_name: String(args.companyName || 'your startup'),
            cohort_label: label,
            next_cohort_label: nextLabel,
            apply_url: applyUrl,
          }, { userId, ctaUrl: applyUrl });
          emailed = !!r?.ok;
          if (emailed) emailHandled = true;
        }
      }
    } catch (e) {
      console.error('[admin-cohort/decide] decision email failed', e);
    }
  }
  if (status === 'approved') {
    await notifyOnce(env, {
      userId, cycleId, notifType: 'decision_approved',
      title: `You're in — ${label} Spin-Out Lab cohort`,
      body: `Your application was approved for the ${label} cohort. Your workspace unlocks automatically when the cohort starts on the 1st.`,
      email: !emailHandled,
    });
  } else if (status === 'rejected') {
    await notifyOnce(env, {
      userId, cycleId, notifType: 'decision_rejected',
      title: `Spin-Out Lab ${label} cohort decision`,
      body: `Your application wasn't selected for the ${label} cohort this time. You're welcome to apply again for a future cohort.`,
      link: '/spinout-lab/apply',
      email: !emailHandled,
    });
  } else {
    await notifyOnce(env, {
      userId, cycleId, notifType: 'decision_waitlisted',
      title: `You're waitlisted for the ${label} cohort`,
      body: `Your application is on the waitlist for the ${label} cohort. If a spot opens — or the cohort rolls forward — you'll be moved automatically.`,
    });
  }
  return emailed;
}

/**
 * Decide one applicant, read with APPLICANT_ROW_SQL. The caller has already
 * checked the admin, the branch freeze, the status and the reason.
 */
export async function decideApplicant(env: Env, admin: User, row: Record<string, unknown>, input: {
  status: DecisionStatus; reason: string; confirmOverPlaces: boolean;
  applicantNote?: string; applicantAsks?: unknown[];
}): Promise<Decided | Refused> {
  const { status, reason } = input;
  const applicantId = Number(row.id);
  if ((TERMINAL_APPLICANT_STATUSES as readonly string[]).includes(String(row.status))) {
    return { ok: false, status: 409, code: 'applicant_terminal', message: `Applicant is already ${row.status}` };
  }
  if (status === 'approved' && row.role === 'admin') return { ok: false, status: 400, code: 'admin_not_admissible', message: 'Admins cannot be admitted to the Lab.' };
  let max = 0;
  if (status === 'approved') {
    const places = await cohortPlaces(env);
    if (typeof places !== 'number') return places;
    max = places;
  }
  const confirmed = status === 'approved' && input.confirmOverPlaces === true;
  const appId = Number(row.application_id);
  // D943: the count and guarded write are one SQLite statement, so concurrent
  // approvals cannot both consume the final place. The batch commits the
  // decision, confirmation audit and legacy mirror together, or none of them.
  const [updated] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE cohort_applicants SET status = ?, decided_at = datetime('now'), decided_by = ?, decision_reason = ?
       WHERE id = ? AND status = ?
         AND (? <> 'approved' OR status = 'approved' OR ? = 1 OR
           (SELECT COUNT(*) FROM cohort_applicants WHERE cohort_cycle_id = ? AND id <> ? AND status IN ('approved', 'activated')) < ?)`
    ).bind(status, `admin:${admin.id}`, reason, applicantId, row.status, status, confirmed ? 1 : 0, row.cohort_cycle_id, applicantId, max),
    env.DB.prepare(
      `INSERT INTO cohort_cycle_events (cohort_cycle_id, event_type, details, actor)
       SELECT ?, ?, ?, ? WHERE changes() = 1`
    ).bind(row.cohort_cycle_id, `applicant_${status}`,
      `Applicant #${applicantId} (user_id=${row.user_id}) ${status}: ${reason}; confirm_over_places=${confirmed}`, `admin:${admin.id}`),
    env.DB.prepare(
      `UPDATE spinout_applications SET status = CASE WHEN ? = 'rejected' THEN 'refused' ELSE 'pending' END,
         decided_at = CASE WHEN ? = 'rejected' THEN datetime('now') ELSE NULL END
       WHERE id = ? AND changes() = 1
         AND ((? = 'rejected' AND status = 'pending') OR (? <> 'rejected' AND status = 'refused'))`
    ).bind(status, status, appId, status, status),
  ]);
  if (Number(updated.meta?.changes ?? 0) !== 1) {
    const current = await env.DB.prepare('SELECT status FROM cohort_applicants WHERE id = ?').bind(applicantId).first<{ status: string }>();
    if (!current || current.status !== row.status) return { ok: false, status: 409, code: 'decision_conflict', message: 'This application changed while you were deciding it. Refresh and try again.' };
    return { ok: false, status: 409, code: 'over_places', message: `This approval would exceed the ${max} cohort places. Confirm approving past the places to continue.` };
  }
  // null when no note was sent; false when one was sent and did not save, so
  // the console can say the applicant was not told rather than assume it.
  let applicantNoteSaved: boolean | null = null;
  if (input.applicantNote) {
    applicantNoteSaved = false;
    const asks = input.applicantAsks || [];
    try {
      await env.DB.prepare(
        `UPDATE spinout_applications
            SET applicant_note = ?, applicant_asks_json = ?, applicant_note_at = datetime('now')
          WHERE id = ?`,
      ).bind(input.applicantNote, asks.length ? JSON.stringify(asks) : null, appId).run();
      applicantNoteSaved = true;
    } catch (e) {
      console.error('[admin-cohort/decide] applicant note write failed', (e as Error)?.message);
    }
  }
  const emailed = await tellDecision(env, {
    userId: Number(row.user_id), cycleId: Number(row.cohort_cycle_id), status,
    year: Number(row.year), month: Number(row.month), companyName: row.company_name,
  });
  const label = monthLabel(Number(row.year), Number(row.month));
  await logActivity(env, admin, `cohort_applicant_${status}`,
    `Admin ${admin.name} marked applicant #${applicantId} ${status} for ${label} (reason: ${reason})`);
  return { ok: true, emailed, applicant_note_saved: applicantNoteSaved };
}
