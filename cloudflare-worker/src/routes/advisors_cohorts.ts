/**
 * #4715 (D4715) — Cohorts: an advisor's assigned batch and the founders who opt in or out (migration 206).
 *
 * Split out of routes/advisors.ts, which mounts it at the place these routes
 * held there (`advisors.route('/', …)`), so the paths and their order under
 * /api/advisors and /api/mentors are unchanged. Shared rows, checks and money
 * helpers come from services/advisorPractice.ts.
 */
import { withMentorEligible } from '../services/mentorEligibility';
import { holdsLicence, heldLicences } from '../services/accountLicences';
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, User } from '../types';
import { requireAdmin, requireAuth, requireBranchNotSuspended } from '../auth';
import { programRefusal } from '../services/programEnforcement';
import { refuse } from '../util/refusal';
import { logAdminAction } from '../services/adminAudit';
import { mapError, nowIso, newUid, trimOrNull } from './_t13t14t15_helpers';
import { ensureAdvisorStoresSchema } from '../services/advisorStoresSchema';
import { ensureCohortGuidanceSchema } from '../services/cohortGuidanceSchema';
import { founderAdvisorAccess, optedOutFounderIds, setFounderVisibility, syncCohortAdvisorNotices } from '../services/cohortAdvisorAccess';
import {
  guidanceCounts, oldestOpenHours, collisions, withinDays, guidanceStatus, parseGuidanceWeek,
  GUIDANCE_WEEK_FALLBACK_MAX, type GuidanceRow, type CalendarItem,
} from './_advisor_cohort_helpers';
import { pageFacts, pageWindow } from '../services/listPage';
import {
  THINKING_PAGE, myAdvisor,
} from '../services/advisorPractice';

const advisors = new Hono<{ Bindings: Env }>();


// ---------------------------------------------------------------------------
// 206 — Cohorts. An advisor's assigned batch, beside the Lab.
//
// NOTHING HERE TOUCHES THE SPIN-OUT LAB. It reads `cohort_cycles` through a
// foreign key and writes only `advisor_cohort_assignments`, a table this
// migration set introduced. No Lab table is written, no Lab route is changed,
// and no Lab surface is edited — the Lab keeps sole authority over cohorts,
// weeks, admission and graduation.
//
// ADMIN ASSIGNS, THE ADVISOR READS. An advisor cannot grant themselves a
// batch, because founder data in a cohort is not theirs to open. That matches
// how every other Lab decision is made.
// ---------------------------------------------------------------------------
/**
 * Who may hold a cohort assignment, and therefore read a batch's founders.
 *
 * ONE PREDICATE, THREE CALLERS — the write that grants, the read that spends,
 * and the admin picker that offers. Three copies is how one of them drifts,
 * and the one that drifts is the one nobody notices.
 *
 * `advisor` ONLY. Not `admin`: an admin already has the Lab's own review and
 * impersonation surfaces, both audited, and letting them hold a founders-read
 * row would blur which of the two they used. Not `exploring` with an advisor
 * overlay, which is a suggestion rather than a grant.
 */
export function mayHoldCohortAssignment(u: { role: string } | null | undefined): boolean {
  return !!u && holdsLicence(u, 'advisor');
}

/**
 * U6 (D492) — before an advisor reads a batch, every founder in it who is owed
 * a notice gets one, so a founder is told no later than the first read. Best
 * effort: a failed notice must not take the advisor's page down, and the
 * nightly sweep sends it again.
 */
async function noticeThenOptOuts(env: Env, advisorUserId: number, cycleId: number): Promise<Set<number>> {
  try { await syncCohortAdvisorNotices(env, { cycleId }); } catch (e) {
    console.error('[advisors] cohort notice sweep failed:', (e as Error).message);
  }
  return optedOutFounderIds(env, advisorUserId);
}

type CohortAssignmentRow = {
  id: number; uid: string; advisor_user_id: number; cohort_cycle_id: number;
  assigned_by_admin_id: number | null; assigned_at: string;
  unassigned_at: string | null; note: string | null; is_active: number;
  created_at: string; updated_at: string;
};

/**
 * U6 (D492) — the founder's side: which advisors can see them through a Lab
 * cohort, and the switch to hide from one. Scoped on the signed-in user only;
 * there is no user parameter. Opening the list also sends any notice still
 * owed to this founder, so the list and the inbox agree.
 */
advisors.get('/me/cohort-access', async (c) => {
  try {
    const user = await requireAuth(c);
    await ensureAdvisorStoresSchema(c.env);
    try { await syncCohortAdvisorNotices(c.env, { founderUserId: user.id }); } catch (e) {
      console.error('[advisors] founder notice sweep failed:', (e as Error).message);
    }
    return c.json({ items: await founderAdvisorAccess(c.env, user.id) });
  } catch (e) { return mapError(c, e); }
});

advisors.put('/me/cohort-access/:advisorUserId', async (c) => {
  try {
    const user = await requireAuth(c);
    await ensureAdvisorStoresSchema(c.env);
    const advisorUserId = Number(c.req.param('advisorUserId'));
    if (!Number.isInteger(advisorUserId) || advisorUserId <= 0) {
      return c.json({ detail: 'advisorUserId must be a user id' }, 400);
    }
    const b = await c.req.json().catch(() => ({} as Record<string, unknown>));
    if (typeof b.visible !== 'boolean') return c.json({ detail: 'visible must be true or false' }, 400);
    const ok = await setFounderVisibility(c.env, user.id, advisorUserId, b.visible);
    if (!ok) return c.json({ detail: 'That advisor has no access to a cohort you are in' }, 404);
    // Undoing a hide may make a start notice owed (one is never sent while hidden).
    if (b.visible) {
      try { await syncCohortAdvisorNotices(c.env, { founderUserId: user.id }); } catch { /* nightly retries */ }
    }
    return c.json({ items: await founderAdvisorAccess(c.env, user.id) });
  } catch (e) { return mapError(c, e); }
});

advisors.get('/me/cohort', async (c) => {
  try {
    const user = await requireAuth(c);
    await ensureAdvisorStoresSchema(c.env);
    // #4715: eligibility first, as every cohort read: an account that no longer
    // holds the Advisor licence keeps its assignment rows but lists no cohort.
    if (!mayHoldCohortAssignment(user)) return c.json({ items: [] });
    // Scoped on the SIGNED-IN USER, not on an advisor profile id and not on a
    // path parameter. 206 keys assignments on `users(id)` precisely so an
    // advisor with no profile row yet is still assignable — see its header.
    const rows = await c.env.DB.prepare(
      `SELECT a.id AS id, a.uid AS uid, a.cohort_cycle_id AS cohort_cycle_id,
              a.assigned_at AS assigned_at, a.note AS note,
              a.is_active AS is_active,
              c.year AS year, c.month AS month,
              c.start_at AS start_at, c.end_at AS end_at, c.status AS status
         FROM advisor_cohort_assignments a
         JOIN cohort_cycles c ON c.id = a.cohort_cycle_id
        WHERE a.advisor_user_id = ? AND a.is_active = 1
        ORDER BY c.start_at DESC
        LIMIT 50`
    ).bind(user.id).all<{
      id: number; uid: string; cohort_cycle_id: number; assigned_at: string;
      note: string | null; is_active: number; year: number; month: number;
      start_at: string; end_at: string; status: string;
    }>();
    return c.json({
      items: (rows.results || []).map((r) => ({
        id: r.id, uid: r.uid,
        cohort_cycle_id: r.cohort_cycle_id,
        assigned_at: r.assigned_at, note: r.note,
        cohort: {
          year: r.year, month: r.month,
          start_at: r.start_at, end_at: r.end_at, status: r.status,
        },
      })),
    });
  } catch (e) { return mapError(c, e); }
});

/**
 * The founders in a cohort this advisor was assigned to.
 *
 * BOTH ARE NECESSARY, NEITHER IS SUFFICIENT — and that phrasing is deliberate,
 * because the sentence it replaces invited exactly the deletion that would
 * reopen the hole. It used to read "this returns 403 whatever the advisor's
 * role is", which reads as "the role check would be redundant". It is not.
 *
 * The ASSIGNMENT is the grant: an admin decided this person should see this
 * batch. The ROLE is the eligibility that grant presumes, and it must be
 * re-checked HERE rather than only where the row was written, because a
 * point-in-time check cannot see the future. `requireAuth` reloads the user
 * row on every request, so `user.role` is the CURRENT role — which makes this
 * check free and, more importantly, continuous. Without it an advisor who is
 * later demoted keeps an active row and keeps reading founder names and
 * emails indefinitely, with nothing anywhere recording that they still can.
 *
 * ONE COHORT AT A TIME, by cycle id, because a page must not show two batches
 * merged into one list. It reads `company_week_status`, which is the Lab's own
 * record of who is in a cycle, WITHOUT writing to it.
 */
advisors.get('/me/cohort/:cycleId/founders', async (c) => {
  try {
    const user = await requireAuth(c);
    await ensureAdvisorStoresSchema(c.env);
    // Eligibility first, then the grant. See the header.
    if (!mayHoldCohortAssignment(user)) {
      return c.json({ detail: 'Only an advisor can open a cohort batch' }, 403);
    }
    const cycleId = Number(c.req.param('cycleId'));
    // Fails closed today — a NaN bind matches no assignment — but through an
    // error path nobody has read. Say what is wrong instead.
    if (!Number.isInteger(cycleId)) {
      return c.json({ detail: 'cycleId must be a cohort cycle id' }, 400);
    }
    const assignment = await c.env.DB.prepare(
      `SELECT id FROM advisor_cohort_assignments
        WHERE advisor_user_id = ? AND cohort_cycle_id = ? AND is_active = 1`
    ).bind(user.id, cycleId).first<{ id: number }>();
    if (!assignment) {
      return c.json({ detail: 'You are not assigned to this cohort' }, 403);
    }
    // U6: a founder who hid themselves from this advisor is not listed.
    const hidden = await noticeThenOptOuts(c.env, user.id, cycleId);
    const rows = await c.env.DB.prepare(
      `SELECT DISTINCT w.user_id AS user_id, u.name AS name, u.email AS email
         FROM company_week_status w
         LEFT JOIN users u ON u.id = w.user_id
        WHERE w.cohort_cycle_id = ?
        ORDER BY u.name ASC
        LIMIT 200`
    ).bind(cycleId).all<{ user_id: number; name: string | null; email: string | null }>();
    return c.json({
      cohort_cycle_id: cycleId,
      // Seam-marked: this is the founder's own record, shown to an advisor an
      // admin put in front of it. It is not the practice's data.
      source: 'spinout_lab',
      // D4813: the read stops at 200 founders. `truncated` says when it did, so
      // a page never presents a capped list as the cohort's total.
      truncated: (rows.results || []).length >= 200,
      items: (rows.results || []).filter((r) => !hidden.has(Number(r.user_id))).map((r) => ({
        user_id: r.user_id, name: r.name ?? null, email: r.email ?? null,
      })),
    });
  } catch (e) { return mapError(c, e); }
});

/**
 * The batch's week, as the Lab records it. READ ONLY, and Lab-sourced entirely.
 *
 * SAME TWO-PART GATE AS FOUNDERS — eligibility then grant. This returns the
 * same founders' progress, so it must be no easier to reach.
 *
 * ONE ROUTE FOR THE WEEK VIEW, not two. `current_week` has to be computed in
 * one place or two pages eventually disagree about which week it is, and
 * "which week is it" is the sort of thing that looks obviously derivable right
 * up until a cycle has no `week_windows` rows at all.
 *
 * `windows_recorded: false` IS THE HONEST ANSWER for such a cycle. 156 created
 * `week_windows` and older cycles predate it. Rendering "week 1" for a cycle
 * whose windows nobody recorded would be inventing the one fact this page is
 * for. The client must treat `available: false` as unavailable, never as
 * empty — the same rule as everywhere else in this bucket.
 *
 * NO ADVISOR SLOTS ARE JOINED IN HERE, deliberately. The Cohorts · Calendar
 * card says nothing joins the Lab's dates to the advisor's own availability,
 * and that is still true. Joining them here would make that card false and
 * commit us to building the calendar; keeping this strictly Lab-sourced keeps
 * the boundary honest.
 */
advisors.get('/me/cohort/:cycleId/weeks', async (c) => {
  try {
    const user = await requireAuth(c);
    await ensureAdvisorStoresSchema(c.env);
    if (!mayHoldCohortAssignment(user)) {
      return c.json({ detail: 'Only an advisor can open a cohort batch' }, 403);
    }
    const cycleId = Number(c.req.param('cycleId'));
    if (!Number.isInteger(cycleId)) {
      return c.json({ detail: 'cycleId must be a cohort cycle id' }, 400);
    }
    const assignment = await c.env.DB.prepare(
      `SELECT id FROM advisor_cohort_assignments
        WHERE advisor_user_id = ? AND cohort_cycle_id = ? AND is_active = 1`
    ).bind(user.id, cycleId).first<{ id: number }>();
    if (!assignment) {
      return c.json({ detail: 'You are not assigned to this cohort' }, 403);
    }
    // U6: a founder who hid themselves from this advisor is not listed.
    const hidden = await noticeThenOptOuts(c.env, user.id, cycleId);

    // Lab tables. A missing one answers `available: false` rather than
    // throwing — the precedent `/spinout-lab/fund-metrics` sets — because an
    // advisor cannot act on a stack trace and an empty list would be a lie.
    try {
      const cycle = await c.env.DB.prepare(
        'SELECT year, month, start_at, end_at, status FROM cohort_cycles WHERE id = ?'
      ).bind(cycleId).first<{
        year: number; month: number; start_at: string; end_at: string; status: string;
      }>();
      if (!cycle) return c.json({ detail: 'No such cohort cycle' }, 404);

      const windows = await c.env.DB.prepare(
        `SELECT week_number, unlock_at, deadline_at FROM week_windows
          WHERE cohort_cycle_id = ? ORDER BY week_number ASC`
      ).bind(cycleId).all<{ week_number: number; unlock_at: string; deadline_at: string }>();
      const weeks = windows.results || [];

      const statuses = await c.env.DB.prepare(
        `SELECT w.user_id AS user_id, w.week_number AS week_number, w.status AS status,
                w.deliverables_done AS deliverables_done,
                w.deliverables_required AS deliverables_required,
                w.grace_until AS grace_until, w.grace_reason AS grace_reason,
                w.decided_at AS decided_at, w.decision_reason AS decision_reason,
                u.name AS name
           FROM company_week_status w
           LEFT JOIN users u ON u.id = w.user_id
          WHERE w.cohort_cycle_id = ?
          ORDER BY u.name ASC, w.week_number ASC
          LIMIT 1000`
      ).bind(cycleId).all<{
        user_id: number; week_number: number; status: string;
        deliverables_done: number; deliverables_required: number; name: string | null;
        grace_until: string | null; grace_reason: string | null;
        decided_at: string | null; decision_reason: string | null;
      }>();

      const byFounder = new Map<number, any>();
      for (const r of statuses.results || []) {
        if (hidden.has(Number(r.user_id))) continue;
        if (!byFounder.has(r.user_id)) {
          byFounder.set(r.user_id, { user_id: r.user_id, name: r.name ?? null, weeks: {} });
        }
        byFounder.get(r.user_id).weeks[r.week_number] = {
          status: r.status,
          deliverables_done: r.deliverables_done,
          deliverables_required: r.deliverables_required,
          // D4813: the Lab's own decision record for the week (migration 156),
          // so the Founders board can say WHY a founder is in grace or failed
          // and until when, rather than only that they are.
          grace_until: r.grace_until ?? null,
          grace_reason: r.grace_reason ?? null,
          decided_at: r.decided_at ?? null,
          decision_reason: r.decision_reason ?? null,
        };
      }

      // Which week the batch is in, computed once, server-side, from the
      // windows the Lab actually recorded. `null` when there are none — see
      // the header.
      const now = Date.now();
      let currentWeek: number | null = null;
      for (const w of weeks) {
        if (new Date(w.unlock_at).getTime() <= now) currentWeek = w.week_number;
      }

      return c.json({
        available: true,
        cohort_cycle_id: cycleId,
        // Seam-marked on the wire, the way the founders read already is.
        source: 'spinout_lab',
        server_time: nowIso(),
        cycle,
        windows_recorded: weeks.length > 0,
        current_week: currentWeek,
        weeks,
        founders: [...byFounder.values()],
      });
    } catch (e) {
      console.error('[advisors] cohort weeks read failed:', (e as Error).message);
      return c.json({
        available: false,
        cohort_cycle_id: cycleId,
        detail: 'The Lab\u2019s week record could not be read.',
      });
    }
  } catch (e) { return mapError(c, e); }
});

/**
 * THE SAME TWO-PART GATE THE THREE ROUTES BELOW ALL USE.
 *
 * Extracted rather than repeated: eligibility (`mayHoldCohortAssignment`, the
 * CURRENT role, re-read by `requireAuth` on every request so a demoted advisor
 * loses access immediately) AND the active assignment row (an admin's grant).
 * The founders handler above explains at length why neither is sufficient
 * alone; three more copies of that reasoning would be three places to get it
 * wrong.
 */
async function requireOwnCohort(
  c: Context<{ Bindings: Env }>, user: User, cycleId: number,
): Promise<Response | null> {
  if (!mayHoldCohortAssignment(user)) {
    return c.json({ detail: 'Only an advisor can open a cohort batch' }, 403);
  }
  if (!Number.isInteger(cycleId)) {
    return c.json({ detail: 'cycleId must be a cohort cycle id' }, 400);
  }
  const assignment = await c.env.DB.prepare(
    `SELECT id FROM advisor_cohort_assignments
      WHERE advisor_user_id = ? AND cohort_cycle_id = ? AND is_active = 1`
  ).bind(user.id, cycleId).first<{ id: number }>();
  if (!assignment) return c.json({ detail: 'You are not assigned to this cohort' }, 403);
  return null;
}

// ---------------------------------------------------------------------------
// D4813 (#4813, package 2) — titles, drafts, versions and edit history
// (migration 202611091920). Shared by the guidance routes below.
// ---------------------------------------------------------------------------

type GuidanceStore = GuidanceRow & {
  uid: string; cohort_cycle_id: number; advisor_user_id: number;
  title: string | null; body: string; week_number: number | null;
  is_draft: number; version: number; updated_at: string;
};

/** A title is one line; longer text belongs in the body. */
const TITLE_MAX = 200;

/**
 * The widest week this cohort's guidance may name: the last week the Lab
 * recorded a window for, else `GUIDANCE_WEEK_FALLBACK_MAX` for a cycle that
 * predates week windows (migration 156). Read, never assumed: the canvas draws
 * four weeks, and a cycle with a different record keeps its own.
 */
async function guidanceWeekLimit(env: Env, cycleId: number): Promise<{ max: number; source: 'week_windows' | 'default' }> {
  try {
    const r = await env.DB.prepare(
      'SELECT MAX(week_number) AS n FROM week_windows WHERE cohort_cycle_id = ?'
    ).bind(cycleId).first<{ n: number | null }>();
    const n = Number(r?.n);
    if (Number.isInteger(n) && n >= 1) return { max: n, source: 'week_windows' };
  } catch (e) {
    console.warn('[advisors] week window read failed:', (e as Error).message);
  }
  return { max: GUIDANCE_WEEK_FALLBACK_MAX, source: 'default' };
}

function weekRefusal(c: Context<{ Bindings: Env }>, message: string, max: number): Response {
  return refuse(c, 400, { code: 'guidance_week_invalid', message, extra: { field: 'week_number', max_week: max } });
}

/** What the page reads for one piece of guidance. Status is derived (212). */
function guidanceDto(r: GuidanceStore, actedBy: Array<{ user_id: number; name: string | null; acted_at: string }> = []) {
  return {
    id: r.id,
    uid: r.uid,
    cohort_cycle_id: r.cohort_cycle_id,
    asked_by_user_id: r.asked_by_user_id,
    title: r.title ?? null,
    body: r.body,
    answer: r.answer,
    answered_at: r.answered_at,
    week_number: r.week_number,
    posted_at: r.posted_at,
    retired_at: r.retired_at,
    updated_at: r.updated_at,
    is_draft: Boolean(r.is_draft),
    version: Number(r.version) || 1,
    status: guidanceStatus(r),
    kind: r.asked_by_user_id == null ? 'broadcast' : 'question',
    acted_by: actedBy,
  };
}

/** The author's own row, or null. Ownership is the advisor column (see PATCH). */
async function ownGuidance(env: Env, uid: string, advisorUserId: number): Promise<GuidanceStore | null> {
  return env.DB.prepare(
    `SELECT id, uid, cohort_cycle_id, advisor_user_id, asked_by_user_id, title, body,
            answer, answered_at, week_number, posted_at, retired_at, updated_at, is_draft, version
       FROM cohort_guidance WHERE uid = ? AND advisor_user_id = ?`
  ).bind(uid, advisorUserId).first<GuidanceStore>();
}

/**
 * ONE WRITE PATH FOR EVERY CHANGE, so every change is versioned the same way.
 *
 * `next` is the whole row as it should read afterwards. The UPDATE only lands
 * while the row is still at `expected`; when another tab got there first it
 * changes nothing and the caller answers 409 with the row as it now stands,
 * so the page can compare rather than overwrite. The history row is written in
 * the same batch, from the row as updated, and only when the update landed
 * (it selects the row at the new version, which a skipped update never made).
 */
async function writeGuidanceVersion(
  env: Env, row: GuidanceStore, expected: number, actorUserId: number, action: string,
  next: { title: string | null; body: string; week_number: number | null; is_draft: number;
    answer: string | null; answered_at: string | null; retired_at: string | null; posted_at: string },
): Promise<boolean> {
  const now = nowIso();
  const [upd] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE cohort_guidance
          SET title = ?, body = ?, week_number = ?, is_draft = ?, answer = ?, answered_at = ?,
              retired_at = ?, posted_at = ?, version = version + 1, updated_at = ?
        WHERE id = ? AND version = ?`
    ).bind(next.title, next.body, next.week_number, next.is_draft, next.answer, next.answered_at,
      next.retired_at, next.posted_at, now, row.id, expected),
    env.DB.prepare(
      `INSERT OR IGNORE INTO cohort_guidance_versions
         (guidance_id, version, action, title, body, week_number, is_draft, actor_user_id, created_at)
       SELECT id, version, ?, title, body, week_number, is_draft, ?, ?
         FROM cohort_guidance WHERE id = ? AND version = ? AND updated_at = ?`
    ).bind(action, actorUserId, now, row.id, expected + 1, now),
  ]);
  return Number(upd?.meta?.changes) > 0;
}

/** 409 with the row as it stands, so the page offers reload and compare. */
async function conflict(c: Context<{ Bindings: Env }>, uid: string, advisorUserId: number): Promise<Response> {
  const fresh = await ownGuidance(c.env, uid, advisorUserId);
  return refuse(c, 409, {
    code: 'guidance_version_conflict',
    message: 'This guidance changed somewhere else since you opened it. Nothing was saved; your text is kept so you can compare.',
    extra: { current: fresh ? guidanceDto(fresh) : null },
  });
}

/** A version the caller names: a positive whole number, or undefined when absent. */
function readVersion(raw: unknown): number | null | undefined {
  if (raw === undefined || raw === null) return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

/**
 * Cohorts · Guidance — what was said to the batch, and who acted on it.
 *
 * MIGRATION 212 IS THE ONLY NEW STORE IN THIS PASS, and this is the card it
 * answers: "nothing records a piece of guidance addressed to a batch, and
 * nothing records a founder acting on one."
 *
 * WHAT THE COUNTS DO NOT INCLUDE. There is no `overdue`. The canvas draws one
 * against "your 24h commitment"; nothing stores a commitment and no advisor has
 * been asked for one, so deriving 24h from a designer's example would report
 * someone as having broken a promise they never made. `oldest_open_hours` is
 * the fact underneath it — how long the longest-waiting question has actually
 * waited — and the page says the commitment is not recorded.
 *
 * `median_response_hours` is null when nothing has been answered, never 0. See
 * `_advisor_cohort_helpers.ts`.
 */
advisors.get('/me/cohort/:cycleId/guidance', async (c) => {
  try {
    const user = await requireAuth(c);
    await ensureAdvisorStoresSchema(c.env);
    await ensureCohortGuidanceSchema(c.env);
    const cycleId = Number(c.req.param('cycleId'));
    const refused = await requireOwnCohort(c, user as User, cycleId);
    if (refused) return refused;
    // U6: who acted is a founder's name; a founder hidden from this advisor is left out.
    const hidden = await noticeThenOptOuts(c.env, user.id, cycleId);

    // D4813: `advisor_user_id = ?` is also what keeps a draft private — the
    // only reader of a row is the advisor who wrote it. Another advisor on the
    // same cohort reads their own guidance and never this one's drafts.
    const rows = await c.env.DB.prepare(
      `SELECT id, uid, cohort_cycle_id, advisor_user_id, asked_by_user_id, title, body,
              answer, answered_at, week_number, posted_at, retired_at, updated_at, is_draft, version
         FROM cohort_guidance
        WHERE cohort_cycle_id = ? AND advisor_user_id = ?
        ORDER BY posted_at DESC, id DESC
        LIMIT 200`
    ).bind(cycleId, user.id).all<GuidanceStore>();
    const items = rows.results || [];

    // Who acted, by name — the card's second sentence. A count would answer
    // "how many" and lose "who", which is the thing an advisor with twelve
    // founders actually needs.
    const acks = await c.env.DB.prepare(
      `SELECT k.guidance_id AS guidance_id, k.founder_user_id AS founder_user_id,
              k.acted_at AS acted_at, u.name AS name
         FROM cohort_guidance_acks k
         JOIN cohort_guidance g ON g.id = k.guidance_id
         LEFT JOIN users u ON u.id = k.founder_user_id
        WHERE g.cohort_cycle_id = ? AND g.advisor_user_id = ?`
    ).bind(cycleId, user.id).all<{
      guidance_id: number; founder_user_id: number; acted_at: string; name: string | null;
    }>();
    const ackBy = new Map<number, Array<{ user_id: number; name: string | null; acted_at: string }>>();
    for (const a of acks.results || []) {
      if (hidden.has(Number(a.founder_user_id))) continue;
      if (!ackBy.has(a.guidance_id)) ackBy.set(a.guidance_id, []);
      ackBy.get(a.guidance_id)!.push({ user_id: a.founder_user_id, name: a.name, acted_at: a.acted_at });
    }

    return c.json({
      cohort_cycle_id: cycleId,
      // D4813: the counts are over the newest 200 rows. `truncated` says when
      // the read stopped there, so an open-question count is never a total.
      truncated: items.length >= 200,
      counts: guidanceCounts(items),
      oldest_open_hours: oldestOpenHours(items, nowIso()),
      // Named so no reader mistakes its absence for zero.
      commitment_hours: null,
      // D4813: the composer checks the week against the same bound the write
      // enforces; the server stays the authority.
      week_limit: await guidanceWeekLimit(c.env, cycleId),
      // D4813: nothing a founder uses writes an acknowledgement yet, so the
      // page says "not recorded" rather than "0 acknowledged".
      acknowledgements_recorded: false,
      items: items.map((r) => guidanceDto(r, ackBy.get(r.id) || [])),
    });
  } catch (e) { return mapError(c, e); }
});

advisors.post('/me/cohort/:cycleId/guidance', async (c) => {
  try {
    const user = await requireAuth(c);
    await ensureAdvisorStoresSchema(c.env);
    await ensureCohortGuidanceSchema(c.env);
    const cycleId = Number(c.req.param('cycleId'));
    const refused = await requireOwnCohort(c, user as User, cycleId);
    if (refused) return refused;

    const b = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const draft = b.draft === true;
    const title = trimOrNull(b.title, TITLE_MAX);
    const body = trimOrNull(b.body);
    // A draft may be only a title for now; published guidance needs a body.
    if (!body && !(draft && title)) return c.json({ detail: 'Guidance needs something to say' }, 400);
    // A week is optional and stays NULL when unstated: guidance about the whole
    // programme has no week. D4813: a week that is stated but not one of this
    // cohort's is REFUSED. It used to be stored as NULL — general guidance —
    // so a typo published a note to the whole programme without a word.
    const limit = await guidanceWeekLimit(c.env, cycleId);
    const week = parseGuidanceWeek(b.week_number, limit.max);
    if (!week.ok) return weekRefusal(c, week.message, limit.max);

    const uid = newUid();
    const now = nowIso();
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO cohort_guidance
           (uid, cohort_cycle_id, advisor_user_id, title, body, week_number, is_draft, version,
            posted_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
      ).bind(uid, cycleId, user.id, title, body || '', week.week, draft ? 1 : 0, now, now, now),
      c.env.DB.prepare(
        `INSERT INTO cohort_guidance_versions
           (guidance_id, version, action, title, body, week_number, is_draft, actor_user_id, created_at)
         SELECT id, 1, ?, title, body, week_number, is_draft, ?, ?
           FROM cohort_guidance WHERE uid = ?`
      ).bind(draft ? 'created' : 'published', user.id, now, uid),
    ]);
    const row = await ownGuidance(c.env, uid, user.id);
    return c.json(row ? guidanceDto(row) : { uid, body, week_number: week.week }, 201);
  } catch (e) { return mapError(c, e); }
});

advisors.patch('/me/guidance/:uid', async (c) => {
  try {
    const user = await requireAuth(c);
    await ensureAdvisorStoresSchema(c.env);
    await ensureCohortGuidanceSchema(c.env);
    // #4715: writing guidance founders read is an advisor's act, so the
    // licence is checked today, as `requireOwnCohort` does for the other writes.
    if (!mayHoldCohortAssignment(user)) {
      return c.json({ detail: 'Only an advisor can open a cohort batch' }, 403);
    }
    const uid = String(c.req.param('uid') || '');
    // Ownership is the advisor column on the row itself — the assignment may
    // since have been withdrawn, and guidance already written must still be
    // editable by the person who wrote it and nobody else.
    const row = await ownGuidance(c.env, uid, user.id);
    if (!row) return c.json({ detail: 'Guidance not found' }, 404);

    const b = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const editsTitle = Object.prototype.hasOwnProperty.call(b, 'title');
    const editsWeek = Object.prototype.hasOwnProperty.call(b, 'week_number');
    const body = trimOrNull(b.body);
    const answer = trimOrNull(b.answer);
    const retire = b.retired === true ? nowIso() : b.retired === false ? null : undefined;
    if (!editsTitle && !editsWeek && body === null && answer === null && retire === undefined) {
      return c.json({ detail: 'Nothing to change' }, 400);
    }

    // D4813: a write names the version it was made against. An edit of the
    // words must (two tabs editing one note is the case this exists for); an
    // answer or a retirement from a page that predates versions may omit it
    // and is checked against the row as just read.
    const named = readVersion(b.version);
    if (named === null) return c.json({ detail: 'version must be a positive whole number' }, 400);
    if ((editsTitle || editsWeek || body !== null) && named === undefined) {
      return refuse(c, 400, {
        code: 'guidance_version_required',
        message: 'Reload this guidance before editing it: the edit has to name the version it was made against.',
      });
    }
    const expected = named ?? Number(row.version);
    if (expected !== Number(row.version)) return conflict(c, uid, user.id);

    let week = row.week_number;
    if (editsWeek) {
      const limit = await guidanceWeekLimit(c.env, row.cohort_cycle_id);
      const parsed = parseGuidanceWeek(b.week_number, limit.max);
      if (!parsed.ok) return weekRefusal(c, parsed.message, limit.max);
      week = parsed.week;
    }
    const nextBody = body ?? row.body;
    if (editsTitle && b.title !== null && typeof b.title !== 'string') {
      return c.json({ detail: 'title must be text' }, 400);
    }
    const nextTitle = editsTitle ? trimOrNull(b.title, TITLE_MAX) : row.title;
    if (!row.is_draft && !String(nextBody).trim()) {
      return c.json({ detail: 'Published guidance needs something to say' }, 400);
    }

    const action = answer !== null ? 'answered'
      : retire !== undefined ? (retire ? 'retired' : 'restored')
        : 'edited';
    const ok = await writeGuidanceVersion(c.env, row, expected, user.id, action, {
      title: nextTitle,
      body: nextBody,
      week_number: week,
      is_draft: Number(row.is_draft) ? 1 : 0,
      // `answered_at` is stamped with the answer and never separately: the
      // median response time is the gap between the two, so a stamp without a
      // reply would report an answer nobody wrote.
      answer: answer ?? row.answer,
      answered_at: answer !== null ? nowIso() : row.answered_at,
      retired_at: retire === undefined ? row.retired_at : retire,
      posted_at: row.posted_at,
    });
    if (!ok) return conflict(c, uid, user.id);
    const fresh = await ownGuidance(c.env, uid, user.id);
    return c.json({ ok: true, item: fresh ? guidanceDto(fresh) : null });
  } catch (e) { return mapError(c, e); }
});

/**
 * D4813 — publish a draft. Publishing reaches the batch, so it needs the
 * assignment as it stands today (`requireOwnCohort`), not only authorship:
 * an advisor whose access ended can still edit what they wrote, but cannot
 * send something new to founders they no longer advise.
 */
advisors.post('/me/guidance/:uid/publish', async (c) => {
  try {
    const user = await requireAuth(c);
    await ensureAdvisorStoresSchema(c.env);
    await ensureCohortGuidanceSchema(c.env);
    if (!mayHoldCohortAssignment(user)) {
      return c.json({ detail: 'Only an advisor can open a cohort batch' }, 403);
    }
    const uid = String(c.req.param('uid') || '');
    const row = await ownGuidance(c.env, uid, user.id);
    if (!row) return c.json({ detail: 'Guidance not found' }, 404);
    const refused = await requireOwnCohort(c, user as User, row.cohort_cycle_id);
    if (refused) return refused;

    const b = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const named = readVersion(b.version);
    if (named == null) {
      return refuse(c, 400, {
        code: 'guidance_version_required',
        message: 'Reload this guidance before publishing it: the publish has to name the version it was made against.',
      });
    }
    if (named !== Number(row.version)) return conflict(c, uid, user.id);
    if (!Number(row.is_draft)) {
      return refuse(c, 409, { code: 'guidance_not_draft', message: 'This guidance is already published.' });
    }
    if (row.retired_at) {
      return refuse(c, 409, { code: 'guidance_retired', message: 'Restore this draft before publishing it.' });
    }
    if (!String(row.body || '').trim()) {
      return c.json({ detail: 'Guidance needs something to say before it is published' }, 400);
    }
    // The week is checked again: the Lab may have changed the cohort's weeks
    // since the draft was saved.
    if (row.week_number != null) {
      const limit = await guidanceWeekLimit(c.env, row.cohort_cycle_id);
      const parsed = parseGuidanceWeek(row.week_number, limit.max);
      if (!parsed.ok) return weekRefusal(c, parsed.message, limit.max);
    }
    const ok = await writeGuidanceVersion(c.env, row, named, user.id, 'published', {
      title: row.title, body: row.body, week_number: row.week_number, is_draft: 0,
      answer: row.answer, answered_at: row.answered_at, retired_at: null,
      // The published date is when it reached the batch, not when it was begun.
      posted_at: nowIso(),
    });
    if (!ok) return conflict(c, uid, user.id);
    const fresh = await ownGuidance(c.env, uid, user.id);
    return c.json({ ok: true, item: fresh ? guidanceDto(fresh) : null });
  } catch (e) { return mapError(c, e); }
});

/** D4813 — the edit history, newest first. The author's only. */
advisors.get('/me/guidance/:uid/history', async (c) => {
  try {
    const user = await requireAuth(c);
    await ensureAdvisorStoresSchema(c.env);
    await ensureCohortGuidanceSchema(c.env);
    if (!mayHoldCohortAssignment(user)) {
      return c.json({ detail: 'Only an advisor can open a cohort batch' }, 403);
    }
    const uid = String(c.req.param('uid') || '');
    const row = await ownGuidance(c.env, uid, user.id);
    if (!row) return c.json({ detail: 'Guidance not found' }, 404);
    const versions = await c.env.DB.prepare(
      `SELECT version, action, title, body, week_number, is_draft, created_at
         FROM cohort_guidance_versions
        WHERE guidance_id = ?
        ORDER BY version DESC
        LIMIT 100`
    ).bind(row.id).all<{
      version: number; action: string; title: string | null; body: string;
      week_number: number | null; is_draft: number; created_at: string;
    }>();
    return c.json({
      uid,
      version: Number(row.version) || 1,
      items: (versions.results || []).map((v) => ({ ...v, is_draft: Boolean(v.is_draft) })),
    });
  } catch (e) { return mapError(c, e); }
});

/**
 * Cohorts · Calendar — the Lab's dates and the advisor's own slots, joined.
 *
 * THE CARD SAID "both halves exist and nothing joins them", AND IT WAS RIGHT.
 * This is the join, and it needs no migration: `week_windows` has held the
 * Lab's unlock/deadline pairs since migration 156, and the advisor's slots and
 * bookings have existed since T13.
 *
 * THE WEEKS ROUTE ABOVE DELIBERATELY DOES NOT DO THIS. Its comment says so —
 * "NO ADVISOR SLOTS ARE JOINED IN HERE, deliberately… joining them here would
 * make that card false". The join belongs on the zone the card is about, which
 * is this one, and the weeks route stays Lab-sourced entirely.
 *
 * MISSING PREP IS NOT COMPUTED. The canvas draws "Missing prep · session
 * without a brief"; nothing stores a brief, so the tile reads not-recorded
 * rather than counting every session as unprepared.
 */
advisors.get('/me/cohort/:cycleId/calendar', async (c) => {
  try {
    const user = await requireAuth(c);
    await ensureAdvisorStoresSchema(c.env);
    const cycleId = Number(c.req.param('cycleId'));
    const refused = await requireOwnCohort(c, user as User, cycleId);
    if (refused) return refused;

    const cycle = await c.env.DB.prepare(
      'SELECT year, month, start_at, end_at, status FROM cohort_cycles WHERE id = ?'
    ).bind(cycleId).first<{
      year: number; month: number; start_at: string; end_at: string; status: string;
    }>();
    if (!cycle) return c.json({ detail: 'No such cohort cycle' }, 404);

    const items: CalendarItem[] = [];

    // The Lab's half. A cycle predating migration 156 has no windows at all,
    // and `windows_recorded: false` is the honest answer for it — the same rule
    // the weeks route states. Rendering an empty calendar would say the batch
    // has no obligations, which is the one thing this page must not claim.
    const windows = await c.env.DB.prepare(
      `SELECT week_number, unlock_at, deadline_at FROM week_windows
        WHERE cohort_cycle_id = ? ORDER BY week_number ASC`
    ).bind(cycleId).all<{ week_number: number; unlock_at: string; deadline_at: string }>();
    const weekRows = windows.results || [];
    for (const w of weekRows) {
      items.push({
        kind: 'cohort', title: `Week ${w.week_number} opens`,
        starts_at: w.unlock_at, ends_at: null, ref: `week:${w.week_number}:unlock`,
      });
      items.push({
        kind: 'cohort', title: `Week ${w.week_number} deliverables due`,
        starts_at: w.deadline_at, ends_at: null, ref: `week:${w.week_number}:deadline`,
      });
    }
    if (cycle.end_at) {
      items.push({
        kind: 'demo_day', title: 'Demo Day', starts_at: cycle.end_at, ends_at: null,
        ref: `cycle:${cycleId}:end`,
      });
    }

    // The advisor's half — booked sessions only. An unbooked slot is
    // availability, not an obligation, and putting it on the same calendar as a
    // deadline would make a free afternoon look like a commitment.
    // `advisor_id`, not production's legacy `mentor_id`:
    // `ensureAdvisorStoresSchema` above renames it on first touch, so by the
    // time this runs the column has the name the whole repository uses. Writing
    // `mentor_id` here would be correct today and wrong the moment the rename
    // lands, and would fail `check-sqlite-columns` against the repo's own DDL.
    //
    // `advisors.id` is the owner, NOT `users.id`: slots are keyed on the
    // advisor PROFILE row, which is what `POST /me/slots` binds (`m.id` from
    // `myAdvisor`). Passing the user id would return an empty calendar for
    // every advisor whose two ids differ, which is all of them.
    //
    // D4813: FROM NOW ON, in SQL. The read used to take the advisor's first 200
    // bookings ever, oldest first, and only then keep the next 14 days — so an
    // advisor with 200 past sessions saw no upcoming ones at all. The window
    // filter below (`withinDays`) still decides what is shown; this only stops
    // history from spending the cap. `sessions_truncated` says when the cap
    // was still reached.
    const me = await myAdvisor(c.env, user as User);
    const booked = me ? await c.env.DB.prepare(
      `SELECT s.id AS slot_id, s.starts_at AS starts_at, s.ends_at AS ends_at,
              b.topic AS topic, u.name AS founder_name
         FROM advisor_bookings b
         JOIN advisor_office_hour_slots s ON s.id = b.slot_id
         LEFT JOIN users u ON u.id = b.founder_user_id
        WHERE s.advisor_id = ? AND s.is_cancelled = 0
          AND b.status IN ('pending', 'confirmed')
          AND datetime(s.starts_at) >= datetime(?)
        ORDER BY s.starts_at ASC
        LIMIT 200`
    ).bind(me.id, nowIso()).all<{
      slot_id: number; starts_at: string; ends_at: string;
      topic: string | null; founder_name: string | null;
    }>() : { results: [] as Array<{
      slot_id: number; starts_at: string; ends_at: string;
      topic: string | null; founder_name: string | null;
    }> };
    for (const s of booked.results || []) {
      items.push({
        kind: 'client',
        title: s.topic || (s.founder_name ? `Session with ${s.founder_name}` : 'Booked session'),
        starts_at: s.starts_at, ends_at: s.ends_at, ref: `slot:${s.slot_id}`,
      });
    }

    const now = nowIso();
    const upcoming = withinDays(items, now, 14);
    const clashes = collisions(upcoming);
    return c.json({
      cohort_cycle_id: cycleId,
      windows_recorded: weekRows.length > 0,
      sessions_truncated: (booked.results || []).length >= 200,
      items: upcoming,
      collisions: clashes.map(([a, b]) => ({ a: upcoming[a].ref, b: upcoming[b].ref })),
      counts: {
        next_14_days: upcoming.length,
        cohort_obligations: upcoming.filter((i) => i.kind !== 'client').length,
        collisions: clashes.length,
        // Nothing stores a session brief, so this is not a zero.
        missing_prep: null,
      },
    });
  } catch (e) { return mapError(c, e); }
});

/**
 * Expertise · Thinking — what this advisor has published.
 *
 * THE CARD WAS WRONG AND IS REPLACED. It said `articles` "has no advisor owner,
 * no reach figure and no record of where a piece ran", and that listing them
 * "would require a join that does not exist". Checked against production:
 * `articles.author_user_id` is NOT NULL and `articles.views` is a real counter
 * incremented on every published read (`routes/articles.ts:320`), non-zero on
 * four published pieces today. Two of the three claims were false; only the
 * third — where a piece ran — is a genuine absence, and the zone states it.
 *
 * OWN DRAFTS ARE INCLUDED, which is why this is not just the public
 * `/articles/by-author/:user_id`. That endpoint filters `status = 'published'`
 * because it serves a public profile. An advisor looking at their own thinking
 * needs the drafts too, and only their own — hence the authenticated route with
 * `author_user_id = user.id` rather than a path parameter anyone could change.
 */
advisors.get('/me/thinking', async (c) => {
  try {
    const user = await requireAuth(c);
    if (!holdsLicence(user, 'advisor')) {
      return c.json({ detail: 'Only an advisor has a thinking shelf' }, 403);
    }
    // #4689: a page of the shelf, ordered to a unique column. The counts are
    // read over the whole shelf by their own query, so a writer with 101
    // pieces is not told about their first 100.
    const w = pageWindow(c.req.query(), THINKING_PAGE);
    const rows = await c.env.DB.prepare(
      `SELECT id, slug, title, subtitle, status, published_at, publish_at, word_count,
              read_minutes, views, sector, created_at, updated_at
         FROM articles
        WHERE author_user_id = ?
        ORDER BY COALESCE(published_at, created_at) DESC, id DESC
        LIMIT ? OFFSET ?`
    ).bind(user.id, w.limit, w.offset).all<{
      id: number; slug: string; title: string; subtitle: string | null;
      status: string; published_at: string | null; publish_at: string | null; word_count: number;
      read_minutes: number; views: number; sector: string | null;
    }>();
    const items = rows.results || [];
    const whole = await c.env.DB.prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END), 0) AS published,
              MAX(CASE WHEN status = 'published' THEN COALESCE(views, 0) END) AS best_reach,
              SUM(CASE WHEN status = 'published' THEN COALESCE(views, 0) END) AS total_reach
         FROM articles WHERE author_user_id = ?`
    ).bind(user.id).first<{ total: number; published: number; best_reach: number | null; total_reach: number | null }>();
    const total = Number(whole?.total) || 0;
    const published = Number(whole?.published) || 0;
    return c.json({
      items,
      page: pageFacts(w, total, items.length),
      counts: {
        published,
        drafts: total - published,
        // Opens here on Axal, from a counter incremented on every published
        // read (`routes/articles.ts`): times opened, not people. Null when
        // nothing is published, since there is no piece to have been opened.
        best_reach: published > 0 ? Number(whole?.best_reach) || 0 : null,
        total_reach: published > 0 ? Number(whole?.total_reach) || 0 : null,
        // "Where it ran" — the one claim on the old card that WAS true.
        // Nothing records an external publication or a talk, so no number.
        talk_reach: null,
      },
    });
  } catch (e) { return mapError(c, e); }
});

/**
 * D960 (#2793) — WHO MAY HOLD AN ASSIGNMENT, in one place: the picker below and
 * the POST ask the same question, so the picker can only offer what the POST
 * accepts. An advisor (the role) whose account is active (`users.is_active`,
 * the rule `getCurrentUser` applies to every request). A deactivated holder
 * would be granted founders' names and could read none of them.
 */
const accountActive = (u: { is_active?: unknown } | null | undefined) => !!u && Number(u.is_active) === 1;

/**
 * Admin: the users who may actually be assigned.
 *
 * Same predicate as the write, so the picker can only ever offer what the POST
 * will accept. Putting the eligibility rule in the UI instead would give two
 * answers to one question.
 *
 * D960 — `requireAdmin`, as every other admin route. A read, so a frozen admin
 * still reads it: the freeze never gates a read.
 */
advisors.get('/admin/cohort-assignments/assignable', async (c) => {
  try {
    await requireAdmin(c);
    await ensureAdvisorStoresSchema(c.env);
    // D4807: the one mentor-eligibility rule (services/mentorEligibility.ts), shared with the catalogue's counts.
    const rows = await c.env.DB.prepare(await withMentorEligible(c.env,
      `SELECT u.id AS id, u.name AS name, u.email AS email, a.id AS advisor_profile_id
         FROM users u
         LEFT JOIN advisors a ON a.user_id = u.id
        WHERE {ELIGIBLE}
        ORDER BY u.name ASC
        LIMIT 500`)
    ).all<{ id: number; name: string | null; email: string | null; advisor_profile_id: number | null }>();
    return c.json({
      items: (rows.results || []).map((r) => ({
        id: r.id, name: r.name ?? null, email: r.email ?? null,
        // An advisor with no profile row can still hold an assignment — 206
        // keys on users(id) precisely so a newly created account is
        // assignable. Reported so an admin knows what they are looking at.
        has_advisor_profile: r.advisor_profile_id != null,
      })),
    });
  } catch (e) { return mapError(c, e); }
});

/**
 * D960 — how many founders are hidden from each holder, as counts only.
 *
 * A founder counts against a row when their opt-out from that advisor is in
 * force (367: `withdrawn_at IS NULL`) and they are in that row's cycle as the
 * mentor's own reads count them (`company_week_status`, the founders read
 * above). An ended row still carries its count; the page decides what to draw.
 *
 * The total is for PG4's tile: distinct founders hidden from at least one
 * active holder (an open row, held by an advisor whose account is active), so
 * a founder hidden from two mentors counts once.
 *
 * Null, not 0, when the opt-outs or the cohort membership cannot be read.
 */
async function hiddenFounderCounts(env: Env): Promise<{ byRow: Map<number, number>; total: number } | null> {
  try {
    const rows = await env.DB.prepare(
      `SELECT a.id AS id, COUNT(DISTINCT o.founder_user_id) AS n
         FROM advisor_cohort_assignments a
         JOIN cohort_advisor_optouts o
           ON o.advisor_user_id = a.advisor_user_id AND o.withdrawn_at IS NULL
        WHERE EXISTS (SELECT 1 FROM company_week_status w
                       WHERE w.user_id = o.founder_user_id AND w.cohort_cycle_id = a.cohort_cycle_id)
        GROUP BY a.id`
    ).all<{ id: number; n: number }>();
    const total = await env.DB.prepare(await withMentorEligible(env,
      `SELECT COUNT(DISTINCT o.founder_user_id) AS n
         FROM advisor_cohort_assignments a
         JOIN users u ON u.id = a.advisor_user_id
         JOIN cohort_advisor_optouts o
           ON o.advisor_user_id = a.advisor_user_id AND o.withdrawn_at IS NULL
        WHERE a.is_active = 1 AND {ELIGIBLE}
          AND EXISTS (SELECT 1 FROM company_week_status w
                       WHERE w.user_id = o.founder_user_id AND w.cohort_cycle_id = a.cohort_cycle_id)`)
    ).first<{ n: number }>();
    return {
      byRow: new Map((rows.results || []).map((r) => [Number(r.id), Number(r.n) || 0])),
      total: Number(total?.n) || 0,
    };
  } catch (e) {
    console.error('[advisors] hidden founder counts unreadable:', (e as Error).message);
    return null;
  }
}

/** O-FND A (D960): the Lab's activated applicants, distinct by founder and
 * cycle. Week records and the user's current Lab flag do not define admission.
 * One aggregate serves every assignment; unreadable is null, never zero. */
async function activatedFounderCounts(env: Env): Promise<Map<number, number> | null> {
  try {
    const rows = await env.DB.prepare(
      `SELECT cohort_cycle_id, COUNT(DISTINCT user_id) AS n
         FROM cohort_applicants WHERE status = ? GROUP BY cohort_cycle_id`
    ).bind('activated').all<{ cohort_cycle_id: number; n: number }>();
    if (!rows.success || !Array.isArray(rows.results) || rows.results.some((r) =>
      !Number.isSafeInteger(r.cohort_cycle_id) || !Number.isSafeInteger(r.n) || r.n < 0)) {
      throw new Error('cohort_founder_counts_unreadable');
    }
    return new Map(rows.results.map((r) => [r.cohort_cycle_id, r.n]));
  } catch {
    console.error('[advisors] cohort founder counts unreadable');
    return null;
  }
}

/**
 * Admin: who is assigned to which cohort.
 *
 * Registered under `/admin/...` — two segments with a literal first — so the
 * single-segment `/:uid` route far above cannot shadow it. `/match` carries the
 * same warning in its own comment.
 */
advisors.get('/admin/cohort-assignments', async (c) => {
  try {
    await requireAdmin(c);
    await ensureAdvisorStoresSchema(c.env);
    const rows = await c.env.DB.prepare(await withMentorEligible(c.env,
      // `advisor_role` is the target's CURRENT role, not the one they had when
      // the row was written. That is what turns this list from a log into
      // something that can answer "who has access who should not": a still
      // active row beside a role that is no longer advisor is exactly the case
      // the read now refuses, and an admin needs to see it to end it.
      // `advisor_is_active` (D960) is the same question for the account: a
      // deactivated holder reads nothing either.
      `SELECT a.id AS id, a.uid AS uid, a.advisor_user_id AS advisor_user_id,
              a.cohort_cycle_id AS cohort_cycle_id, a.assigned_at AS assigned_at,
              a.unassigned_at AS unassigned_at, a.is_active AS is_active,
              a.note AS note, u.name AS advisor_name, u.email AS advisor_email,
              u.role AS advisor_role, u.is_active AS advisor_is_active,
              -- D4807: eligibility is the one rule, not the role string: an additional Advisor licence counts, a revoked one does not.
              COALESCE({ELIGIBLE}, 0) AS advisor_eligible
         FROM advisor_cohort_assignments a
         LEFT JOIN users u ON u.id = a.advisor_user_id
        ORDER BY a.assigned_at DESC
        LIMIT 500`)
    ).all<{
      id: number; uid: string; advisor_user_id: number; cohort_cycle_id: number;
      assigned_at: string; unassigned_at: string | null; is_active: number;
      note: string | null; advisor_name: string | null; advisor_email: string | null;
      advisor_role: string | null; advisor_is_active: number | null; advisor_eligible: number;
    }>();
    const hidden = await hiddenFounderCounts(c.env);
    const founders = await activatedFounderCounts(c.env);
    return c.json({
      items: (rows.results || []).map((r) => ({
        ...r,
        is_active: !!r.is_active,
        // A deleted user has no account to be active: null, not false.
        advisor_is_active: r.advisor_is_active == null ? null : Number(r.advisor_is_active) === 1,
        // D4807: the one mentor-eligibility rule, so the page's role-change warning agrees with the counts.
        advisor_eligible: Number(r.advisor_eligible) === 1,
        founders_hidden: hidden ? hidden.byRow.get(Number(r.id)) ?? 0 : null,
        founders_in_cohort: founders ? founders.get(Number(r.cohort_cycle_id)) ?? 0 : null,
      })),
      founders_hidden_total: hidden ? hidden.total : null,
    });
  } catch (e) { return mapError(c, e); }
});

/**
 * D960 — every grant and end, newest first, from 565's history. A re-assign
 * adds a row here instead of overwriting the last one. Counts and ids only:
 * `by_admin` says whether an admin was recorded, never which.
 */
advisors.get('/admin/cohort-assignments/history', async (c) => {
  try {
    await requireAdmin(c);
    await ensureAdvisorStoresSchema(c.env);
    const intOrNull = (v: string | undefined) => (v != null && /^\d+$/.test(v) ? Number(v) : null);
    const assignmentId = intOrNull(c.req.query('assignment_id'));
    const cycleId = intOrNull(c.req.query('cohort_cycle_id'));
    const limit = Math.min(200, Math.max(1, intOrNull(c.req.query('limit')) ?? 50));
    const offset = Math.max(0, intOrNull(c.req.query('offset')) ?? 0);
    const [rows, total] = await Promise.all([
      c.env.DB.prepare(
        `SELECT kind, created_at, assignment_id, advisor_user_id, cohort_cycle_id, admin_user_id
           FROM advisor_cohort_assignment_events
          WHERE (?1 IS NULL OR assignment_id = ?1) AND (?2 IS NULL OR cohort_cycle_id = ?2)
          ORDER BY created_at DESC, id DESC
          LIMIT ?3 OFFSET ?4`
      ).bind(assignmentId, cycleId, limit, offset).all<{
        kind: string; created_at: string; assignment_id: number; advisor_user_id: number;
        cohort_cycle_id: number; admin_user_id: number | null;
      }>(),
      c.env.DB.prepare(
        `SELECT COUNT(*) AS n FROM advisor_cohort_assignment_events
          WHERE (?1 IS NULL OR assignment_id = ?1) AND (?2 IS NULL OR cohort_cycle_id = ?2)`
      )
        .bind(assignmentId, cycleId).first<{ n: number }>(),
    ]);
    return c.json({
      items: (rows.results || []).map((r) => ({
        kind: r.kind, created_at: r.created_at, assignment_id: r.assignment_id,
        advisor_user_id: r.advisor_user_id, cohort_cycle_id: r.cohort_cycle_id,
        by_admin: r.admin_user_id != null,
      })),
      total: Number(total?.n) || 0,
      limit, offset,
    });
  } catch (e) { return mapError(c, e); }
});

advisors.post('/admin/cohort-assignments', async (c) => {
  try {
    const user = await requireAdmin(c);
    // D960: a write, so a suspended branch refuses it, as the Lab's decide does.
    await requireBranchNotSuspended(c);
    // D985 — assigning a mentor needs the branch's Mentor cohorts grant; the
    // DELETE that ends an assignment stays open.
    const notGranted = await programRefusal(c.env, 'mentor-cohorts');
    if (notGranted) return c.json(notGranted.body, notGranted.status);
    await ensureAdvisorStoresSchema(c.env);
    const body = await c.req.json().catch(() => ({} as any));
    const advisorUserId = Number(body.advisor_user_id);
    const cycleId = Number(body.cohort_cycle_id);
    if (!Number.isInteger(advisorUserId) || !Number.isInteger(cycleId)) {
      return c.json({ detail: 'advisor_user_id and cohort_cycle_id are required' }, 400);
    }
    // Both ends are checked before the write so a bad id fails with a sentence
    // rather than a foreign-key error nobody can read.
    const target = await c.env.DB.prepare('SELECT id, role, is_active FROM users WHERE id = ?')
      .bind(advisorUserId).first<{ id: number; role: string; is_active: number }>();
    if (!target) return c.json({ detail: 'No such user' }, 404);
    Object.assign(target, { licences: await heldLicences(c.env.DB, target) });
    // `role` was SELECTed here from the day this shipped and never read, so the
    // only check was that the id existed. The parameter is named
    // `advisor_user_id`; accepting any user made that name a lie, and removed
    // the one thing that would catch a mistyped id that happens to exist — a
    // typo becoming a grant of another cohort's founder names and emails.
    //
    // 400 rather than 403: the caller IS authorised — they are an admin. What
    // is wrong is the subject they named, which is a bad request, and matches
    // the 400 this handler already returns for a malformed id.
    if (!mayHoldCohortAssignment(target)) {
      return c.json({
        detail: 'Only a user with the advisor role can be assigned a cohort',
      }, 400);
    }
    // D960: the picker's rule. A deactivated account would read nothing.
    if (!accountActive(target)) {
      return refuse(c, 400, {
        code: 'account_inactive',
        message: 'This account is deactivated, so it cannot be given a cohort.',
      });
    }
    const cycle = await c.env.DB.prepare('SELECT id FROM cohort_cycles WHERE id = ?')
      .bind(cycleId).first<{ id: number }>();
    if (!cycle) return c.json({ detail: 'No such cohort cycle' }, 404);

    const now = nowIso();
    const note = trimOrNull(body.note, 1000);
    // UNIQUE (advisor_user_id, cohort_cycle_id) — reassigning the same pair
    // REACTIVATES the existing row rather than stacking a second one that
    // every read would then have to de-duplicate. See 206's header.
    //
    // D960: only an ENDED row is reactivated. A pair that is already open
    // changes nothing (the `WHERE` on the update), so a second POST no longer
    // starts a new episode: founders were sent a fresh "can see you" and then
    // an "access has ended" that was not true. The history row is written in
    // the same batch, and only when the upsert opened access: it selects the
    // row only if it is open with this call's `assigned_at`, which a skipped
    // update leaves at its earlier value.
    const [upsert] = await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO advisor_cohort_assignments
           (uid, advisor_user_id, cohort_cycle_id, assigned_by_admin_id,
            assigned_at, note, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT (advisor_user_id, cohort_cycle_id) DO UPDATE SET
           is_active = 1, unassigned_at = NULL, assigned_by_admin_id = excluded.assigned_by_admin_id,
           assigned_at = excluded.assigned_at, note = excluded.note, updated_at = excluded.updated_at
         WHERE advisor_cohort_assignments.is_active = 0`
      ).bind(newUid(), advisorUserId, cycleId, user.id, now, note, now, now),
      c.env.DB.prepare(
        `INSERT INTO advisor_cohort_assignment_events
           (assignment_id, advisor_user_id, cohort_cycle_id, kind, admin_user_id, note, created_at)
         SELECT id, advisor_user_id, cohort_cycle_id, 'assigned', ?, ?, ?
           FROM advisor_cohort_assignments
          WHERE advisor_user_id = ? AND cohort_cycle_id = ? AND is_active = 1 AND assigned_at = ?`
      ).bind(user.id, note, now, advisorUserId, cycleId, now),
    ]);
    if (!(Number(upsert?.meta?.changes) > 0)) {
      return refuse(c, 409, {
        code: 'already_assigned',
        message: 'This mentor already has access to this cohort, so nothing changed.',
      });
    }
    const fresh = await c.env.DB.prepare(
      'SELECT * FROM advisor_cohort_assignments WHERE advisor_user_id = ? AND cohort_cycle_id = ?'
    ).bind(advisorUserId, cycleId).first<CohortAssignmentRow>();
    await logAdminAction(c.env, user.id, user.email, 'advisor_cohort.assigned', {
      target_user_id: advisorUserId, assignment_id: fresh!.id, cohort_cycle_id: cycleId,
    });
    // U6 (D492): every founder in the cohort is told, now. D960: null, not 0,
    // when the sweep failed — nobody knows how many were told.
    let notified: number | null = 0;
    try { notified = (await syncCohortAdvisorNotices(c.env, { assignmentId: fresh!.id })).started; } catch (e) {
      notified = null;
      console.error('[advisors] cohort start notices failed:', (e as Error).message);
    }
    return c.json({ ...fresh!, is_active: !!fresh!.is_active, founders_notified: notified });
  } catch (e) { return mapError(c, e); }
});

/**
 * End an assignment. The row stays and says when it ended — see 206's header.
 * A record that vanishes cannot answer who had access to a cohort's founders
 * and when, which is the question an access record exists to answer.
 *
 * D960: ending a row that is already ended changes nothing and says so. It
 * used to move the end date to now. The end is also a row in 565's history.
 */
advisors.delete('/admin/cohort-assignments/:id', async (c) => {
  try {
    const user = await requireAdmin(c);
    await requireBranchNotSuspended(c);
    await ensureAdvisorStoresSchema(c.env);
    const row = await c.env.DB.prepare('SELECT * FROM advisor_cohort_assignments WHERE id = ?')
      .bind(Number(c.req.param('id'))).first<CohortAssignmentRow>();
    if (!row) return c.json({ detail: 'Assignment not found' }, 404);
    const now = nowIso();
    const [ended] = await c.env.DB.batch([
      c.env.DB.prepare(
        'UPDATE advisor_cohort_assignments SET is_active = 0, unassigned_at = ?, updated_at = ? WHERE id = ? AND is_active = 1'
      ).bind(now, now, row.id),
      c.env.DB.prepare(
        `INSERT INTO advisor_cohort_assignment_events
           (assignment_id, advisor_user_id, cohort_cycle_id, kind, admin_user_id, note, created_at)
         SELECT id, advisor_user_id, cohort_cycle_id, 'ended', ?, NULL, ?
           FROM advisor_cohort_assignments
          WHERE id = ? AND is_active = 0 AND unassigned_at = ?`
      ).bind(user.id, now, row.id, now),
    ]);
    if (!(Number(ended?.meta?.changes) > 0)) {
      return refuse(c, 409, {
        code: 'already_ended',
        message: 'This access has already ended, so nothing changed.',
      });
    }
    await logAdminAction(c.env, user.id, user.email, 'advisor_cohort.ended', {
      target_user_id: row.advisor_user_id, assignment_id: row.id, cohort_cycle_id: row.cohort_cycle_id,
    });
    // U6 (D492): every founder who was told it started is told it ended.
    let notified: number | null = 0;
    try { notified = (await syncCohortAdvisorNotices(c.env, { assignmentId: row.id })).ended; } catch (e) {
      notified = null;
      console.error('[advisors] cohort end notices failed:', (e as Error).message);
    }
    return c.json({ ok: true, id: row.id, is_active: false, unassigned_at: now, founders_notified: notified });
  } catch (e) { return mapError(c, e); }
});

export default advisors;
