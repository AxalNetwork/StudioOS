/**
 * Spin-Out Lab — 4-week guided sprint, gated on evidence.
 *
 * OPEN TO FOUNDERS WITH AN ENTITY. `users.is_incorporated` is set only by
 * finishing (recordMilestone) or quitting (exitLab) the Lab, never by
 * arriving with a company, so a founder who incorporated elsewhere applies,
 * is admitted and starts like anyone else. Earlier wording here called this a
 * "pre-incorporation sprint", which described a restriction the code has
 * never implemented and which the public page repeated for months.
 *
 * Mounted at /api/spinout-lab. JWT-auth-gated (no admin escape hatch) for
 * every route EXCEPT four public reads the logged-out Lab pages need:
 * `/graduates`, `/stats`, `/brief` and `/cohort`. Those return company-level
 * facts only — never a founder's identity, track or milestones — and anything
 * added to them has to hold to that. The lab is detected from
 * `users.spinout_lab_active`.
 *
 *   GET  /state      → current week, days remaining, milestones, unlocked
 *                       features for the caller
 *   POST /start      → flip the lab on for the caller (idempotent; 409 if
 *                       the caller has already been through the Lab)
 *   POST /milestone  → mark a milestone done; auto-advances week when the
 *                       current week's bar is fully met. When week 4 is
 *                       met (i.e. `incorporation_completed` is recorded),
 *                       also flips `is_incorporated=1` and turns the lab
 *                       off in the same DB round-trip.
 *   POST /exit       → mark the user incorporated and turn the lab off
 *                       (idempotent; the explicit user-driven escape hatch)
 *
 * The MILESTONES catalog is the single source of truth for what counts
 * toward week advancement and what features the sidebar/dashboard unlocks.
 *
 * D4663: the handlers parse requests and return service outcomes. The
 * sprint's transitions (`getLabState`, `startLab`, `recordMilestone`,
 * `exitLab`, and `/start` and `/exit` whole) are `services/labLifecycle.ts`;
 * a milestone's completion is `services/labProgress.ts`; graduation is
 * `services/labGraduation.ts`; the public outcome reads are
 * `services/labReporting.ts`, bounded in SQL. Tests import those modules.
 */
import { holdsLicence } from '../services/accountLicences';
import { Hono, type Context } from 'hono';
import type { Env, User } from '../types';
import { getSQL } from '../db';
import { requireAuth } from '../auth';
import { refuse } from '../util/refusal';
import { lpSelfScope } from '../services/tenancyScope';
import { claimLpRowsByEmail } from '../services/lpClaim';
// Catalog moved to a pure module so non-route consumers (advisor
// state machine) can import it without dragging in Hono / db / auth.
// The route's original public surface is preserved by re-export.
import {
  MILESTONES,
  SPRINT_DAYS,
  VALID_MILESTONE_KEYS,
  weekMet,
  weekClearsFor,
  unlockedFeaturesThrough,
} from '../services/spinoutLabCatalog';
import { beginLab, getLabState, leaveLab } from '../services/labLifecycle';
import { bindingKey } from '../util/schemaBootstrap';
// Re-export so existing external imports of these names from this
// module keep working unchanged.
export { MILESTONES, VALID_MILESTONE_KEYS, weekMet, unlockedFeaturesThrough };

const spinoutLab = new Hono<{ Bindings: Env }>();

/**
 * Milliseconds for a SQLite `datetime('now')` string, which is UTC but carries
 * no zone marker. Without the appended Z, V8 reads it as LOCAL time and every
 * comparison drifts by the runtime's offset. Returns null rather than NaN so
 * callers can drop the row instead of comparing against a NaN that is false
 * in both directions.
 */
function parseTsUtc(s: string | null | undefined): number | null {
  if (!s) return null;
  const ms = Date.parse(s.replace(' ', 'T') + (s.includes('Z') ? '' : 'Z'));
  return Number.isFinite(ms) ? ms : null;
}

// ---------------------------------------------------------------------------
// Wire handlers. Each parses its request and returns a service outcome: the
// lifecycle (`services/labLifecycle.ts`), milestone completion
// (`services/labProgress.ts`), graduation (`services/labGraduation.ts`) and
// the public reports (`services/labReporting.ts`), D4663.
// ---------------------------------------------------------------------------

// Cohort applications — lazy table ensure (mirrors migration 155) so
// databases that haven't run the migration yet still answer.
const APPLICATIONS_SCHEMA_ENSURED = new WeakMap<object, boolean>();
async function ensureApplicationsTable(env: Env): Promise<void> {
  if (APPLICATIONS_SCHEMA_ENSURED.get(bindingKey(env))) return;
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS spinout_applications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        company_name TEXT NOT NULL,
        idea TEXT NOT NULL,
        incorporated TEXT NOT NULL DEFAULT 'no',
        stage TEXT,
        jurisdiction TEXT,
        cohort TEXT NOT NULL DEFAULT 'Cohort 4',
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        decided_at TEXT
      )`,
    ).run();
  } catch { /* ignore */ }
  APPLICATIONS_SCHEMA_ENSURED.set(bindingKey(env), true);
}

type ApplicationRow = {
  id: number;
  company_name: string;
  incorporated: string;
  stage: string | null;
  jurisdiction: string | null;
  cohort: string;
  status: string;
  created_at: string;
  decided_at: string | null;
};

async function latestApplication(env: Env, userId: number): Promise<ApplicationRow | null> {
  try {
    const row = await env.DB.prepare(
      `SELECT id, company_name, incorporated, stage, jurisdiction, cohort, status, created_at, decided_at
       FROM spinout_applications WHERE user_id = ? ORDER BY id DESC LIMIT 1`,
    ).bind(userId).first<ApplicationRow>();
    return row ?? null;
  } catch {
    return null; // table not yet migrated
  }
}

/**
 * The applicant's own view of their latest application (D383): its status,
 * answers, pool row, the note an admin wrote FOR them, the live interview and,
 * once declined, when they can reapply. Read at the wire layer, like every
 * other /state addition, and try/caught so a database without migrations
 * 315–316 still answers — with `applicant: null` rather than a guess.
 */
async function loadApplicantBlock(env: Env, userId: number) {
  const { applicantView } = await import('../services/applicationLifecycle');
  let app: import('../services/applicationLifecycle').ApplicationRowForView | null = null;
  try {
    app = await env.DB.prepare(
      `SELECT id, status, created_at, decided_at, withdrawn_at, answers_json,
              applicant_note, applicant_asks_json, applicant_note_at
         FROM spinout_applications WHERE user_id = ? ORDER BY id DESC LIMIT 1`,
    ).bind(userId).first();
  } catch {
    return null; // columns from migration 315 not applied here
  }
  if (!app) return null;
  let pool: import('../services/applicationLifecycle').PoolRowForView = null;
  try {
    const { monthLabel } = await import('../services/cohortApplications');
    const r = await env.DB.prepare(
      `SELECT ca.status, ca.decided_at, cc.year, cc.month, cc.app_status, cc.start_at,
              cc.applications_close_at AS close_at
         FROM cohort_applicants ca JOIN cohort_cycles cc ON cc.id = ca.cohort_cycle_id
        WHERE ca.application_id = ? ORDER BY ca.id DESC LIMIT 1`,
    ).bind(app.id).first<{ status: string; decided_at: string | null; year: number; month: number;
      app_status: string | null; start_at: string | null; close_at: string | null }>();
    if (r) {
      pool = {
        status: r.status, decided_at: r.decided_at,
        cycle_label: monthLabel(Number(r.year), Number(r.month)),
        cycle_app_status: r.app_status, cycle_start_at: r.start_at, cycle_close_at: r.close_at,
      };
    }
  } catch { /* cycle tables not migrated: no pool row to show */ }
  let interview: import('../services/applicationLifecycle').InterviewRowForView = null;
  try {
    interview = await env.DB.prepare(
      `SELECT id, scheduled_at, duration_min, location, note, status, reschedule_requested_at
         FROM spinout_application_interviews WHERE application_id = ? ORDER BY id DESC LIMIT 1`,
    ).bind(app.id).first();
  } catch { /* migration 316 not applied: no interview can exist */ }
  let reapply: { label: string; opens_at: string; closes_at: string } | null = null;
  try {
    const { resolveApplicationTarget, monthLabel } = await import('../services/cohortApplications');
    const t = resolveApplicationTarget(Date.now());
    const w = t.ok ? { y: t.year, m: t.month, win: t.window } : { y: t.next.year, m: t.next.month, win: t.next.window };
    reapply = {
      label: monthLabel(w.y, w.m),
      opens_at: new Date(w.win.openMs).toISOString(),
      closes_at: new Date(w.win.closeMs).toISOString(),
    };
  } catch { /* calendar unavailable: no reapply window to state */ }
  return applicantView(app, pool, interview, reapply);
}

spinoutLab.get('/state', async (c) => {
  const user = await requireAuth(c);
  // D585: a founder paid while week 4 was still locked is recorded once it
  // unlocks. Cheap when there is nothing to do (one indexed read); never throws.
  try {
    const { syncIncorporationMilestone } = await import('../services/labIncorporationMilestone');
    await syncIncorporationMilestone(c.env, user.id);
  } catch { /* the state read never fails on this */ }
  const sql = getSQL(c.env);
  const state = await getLabState(sql, user.id);
  // Task #7 — admission fields, try/caught so databases predating migration
  // 154 still answer (admitted=false).
  let admitted = false;
  let cohort: string | null = null;
  try {
    const rows = (await sql`
      SELECT spinout_lab_admitted, spinout_lab_cohort FROM user_spinout_flags WHERE user_id = ${user.id}
    `) as Array<{ spinout_lab_admitted: number | null; spinout_lab_cohort: string | null }>;
    admitted = Number(rows[0]?.spinout_lab_admitted ?? 0) === 1;
    cohort = rows[0]?.spinout_lab_cohort ?? null;
  } catch { /* columns not yet migrated */ }
  await sql.end();
  const application = await latestApplication(c.env, user.id);
  // Cohort timing gate. Null for legacy founders whose sprint predates the
  // calendar system. `unlocked_features` is re-capped by the
  // gate's max_week so calendar/freeze enforcement is server-side.
  let cohortTiming: import('../services/cohortTiming').CohortGate | null = null;
  try {
    const { getCohortGate } = await import('../services/cohortTiming');
    cohortTiming = await getCohortGate(c.env, user.id);
  } catch { /* tables not yet migrated */ }
  // Task #5 — application-window info (wire-layer only, never in
  // getLabState): which cohort a new application would land in and when
  // its window closes, so the apply page can show real deadlines.
  let applicationWindow: Record<string, unknown> | null = null;
  try {
    const { resolveApplicationTarget, monthLabel } = await import('../services/cohortApplications');
    const t = resolveApplicationTarget(Date.now());
    if (t.ok) {
      applicationWindow = {
        year: t.year, month: t.month,
        label: monthLabel(t.year, t.month),
        opens_at: new Date(t.window.openMs).toISOString(),
        closes_at: new Date(t.window.closeMs).toISOString(),
        starts_at: new Date(t.window.startMs).toISOString(),
      };
    }
  } catch { /* service not available */ }
  const applicant = await loadApplicantBlock(c.env, user.id);
  // D541 — what each milestone pays, and which have been paid. A failed read
  // is said, never drawn as nothing earned.
  let milestoneCredits: unknown = null;
  let milestoneCreditsUnreadable = false;
  try {
    const { milestoneCreditsFor } = await import('../services/labMilestoneCredits');
    milestoneCredits = await milestoneCreditsFor(c.env, user.id, String(user.role || ''));
  } catch (e) {
    console.warn('[spinout-lab] milestone credits unreadable', (e as Error).message);
    milestoneCreditsUnreadable = true;
  }
  // D576 — the caller's own Week 1 plan. Null when none is stored; a failed
  // read is said, never drawn as the standard order.
  let week1Plan: unknown = null;
  let week1PlanUnreadable = false;
  try {
    const { readWeek1Plan } = await import('../services/week1PlanStore');
    week1Plan = await readWeek1Plan(c.env, user.id);
  } catch (e) {
    console.warn('[spinout-lab] week 1 plan unreadable', (e as Error).message);
    week1PlanUnreadable = true;
  }
  // D4659: the enrolled venture and the one graduation rule, from the server,
  // so the workspace, the certificate and the public list agree. A read that
  // fails is said, never drawn as "no venture" or "not graduated".
  let venture: unknown = null;
  let ventureUnreadable = false;
  let graduated: boolean | null = null;
  try {
    const { resolveVenture } = await import('../services/labVenture');
    const { graduationOf } = await import('../services/labGraduation');
    venture = await resolveVenture(c.env, user.id);
    graduated = (await graduationOf(c.env, user.id)).graduated;
  } catch {
    console.warn('[spinout-lab] venture unreadable');
    ventureUnreadable = true;
  }
  const payload: Record<string, unknown> = {
    ...state, admitted, cohort, application, applicant,
    venture, venture_unreadable: ventureUnreadable, graduated,
    week1_plan: week1Plan,
    week1_plan_unreadable: week1PlanUnreadable,
    milestone_credits: milestoneCredits,
    milestone_credits_unreadable: milestoneCreditsUnreadable,
    cohort_timing: cohortTiming,
    application_window: applicationWindow,
    server_time: new Date().toISOString(),
  };
  // D4657: catch up the caller's own progress (work saved while no Lab page
  // recorded it, or a grant an interrupted request left unpaid), after the
  // response, at most every RECONCILE_EVERY_MS. The cron does the same for
  // founders who never open the page.
  try {
    const { reconcileDue, reconcileLabProgress } = await import('../services/labProgress');
    if (state.active && (await reconcileDue(c.env, user.id))) {
      const pass = reconcileLabProgress(c.env, user.id).catch(() => undefined);
      try { c.executionCtx.waitUntil(pass); } catch { await pass; }
    }
  } catch { /* the state read never fails on this */ }
  if (cohortTiming) {
    const cap = Math.min(state.week, cohortTiming.max_week);
    payload.week = cap;
    payload.unlocked_features = unlockedFeaturesThrough(cap);
  }
  return c.json(payload);
});

// POST /apply — submit a cohort application. Signed-in founders only, so no
// contact fields: name/email come from the account. Sends a confirmation
// email (failures logged, never block the submission). One pending
// application at a time; re-apply is allowed after a refusal.
type ApplyBody = {
  company_name?: unknown;
  idea?: unknown;
  incorporated?: unknown;
  stage?: unknown;
  jurisdiction?: unknown;
  cohort?: unknown;
  target_cycle?: unknown; // Task #5 — optional {year, month} the applicant is targeting
  answers?: unknown; // D383 — steps 2–5; required when present, see missingForSubmit
};

spinoutLab.post('/apply', async (c) => {
  const user = await requireAuth(c);
  // Founder and Explorer accounts may apply — the Lab is exactly how an
  // explorer graduates into a founder-track company.
  if (!(holdsLicence(user, 'founder') || user.role === 'exploring')) {
    return c.json({ error: 'Only founder and explorer accounts can apply to the Lab' }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as ApplyBody;
  const company = (typeof body.company_name === 'string' ? body.company_name : '').trim().slice(0, 200);
  const idea = (typeof body.idea === 'string' ? body.idea : '').trim().slice(0, 4000);
  if (!company) return c.json({ error: 'Company / working name is required' }, 400);
  if (!idea) return c.json({ error: 'Please describe your idea or project' }, 400);
  // D383 — the wizard sends steps 2–5 as `answers`. An older client that
  // sends none still submits (its application simply records no answers);
  // one that sends answers must send the required ones.
  let answersJson: string | null = null;
  if (body.answers !== undefined && body.answers !== null) {
    const { normaliseAnswers, missingForSubmit } = await import('../services/applicationLifecycle');
    const answers = normaliseAnswers(body.answers);
    const missing = missingForSubmit(answers);
    if (missing.length) {
      const message = 'Some required answers are missing. Complete every step before submitting.';
      return c.json({ error: 'answers_incomplete', message, detail: message, missing }, 400);
    }
    answersJson = JSON.stringify(answers);
  }
  const incorporated = (typeof body.incorporated === 'string' && body.incorporated.toLowerCase() === 'yes') ? 'yes' : 'no';
  const stage = (typeof body.stage === 'string' ? body.stage : '').trim().slice(0, 100) || null;
  const jurisdiction = (typeof body.jurisdiction === 'string' ? body.jurisdiction : '').trim().slice(0, 100) || null;
  // Task #5 — hard deadline enforcement at the API. Applications close
  // 7 days before the 1st at 23:59:59 America/New_York (DST-correct).
  // A submission targeting a closed cycle is rejected outright; without
  // an explicit target it lands in the earliest still-open cycle.
  let targetCycle: { year: number; month: number } | null = null;
  let targetLabel: string | null = null;
  try {
    const { resolveApplicationTarget, monthLabel } = await import('../services/cohortApplications');
    const raw = body.target_cycle as { year?: unknown; month?: unknown } | undefined;
    const requested = raw && Number.isFinite(Number(raw.year)) && Number.isFinite(Number(raw.month))
      ? { year: Number(raw.year), month: Number(raw.month) } : null;
    const t = resolveApplicationTarget(Date.now(), requested);
    if (!t.ok) {
      return c.json({
        error: `Applications for the ${monthLabel(t.closed.year, t.closed.month)} cohort are closed — you're eligible for the ${monthLabel(t.next.year, t.next.month)} cohort.`,
        next_cycle: { year: t.next.year, month: t.next.month, label: monthLabel(t.next.year, t.next.month), closes_at: new Date(t.next.window.closeMs).toISOString() },
      }, 403);
    }
    targetCycle = { year: t.year, month: t.month };
    targetLabel = monthLabel(t.year, t.month);
  } catch { /* deadline service unavailable — legacy behavior */ }

  const cohort = (targetLabel && `${targetLabel} Cohort`)
    || ((typeof body.cohort === 'string' && body.cohort.trim()) || 'Cohort 4').slice(0, 50);

  await ensureApplicationsTable(c.env);
  try {
    const u = await c.env.DB.prepare(
      `SELECT spinout_lab_admitted FROM user_spinout_flags WHERE user_id = ?`,
    ).bind(user.id).first<{ spinout_lab_admitted: number | null }>();
    if (Number(u?.spinout_lab_admitted ?? 0) === 1) {
      return c.json({ error: 'You are already admitted to the Lab' }, 409);
    }
  } catch { /* admission columns not yet migrated */ }
  const existing = await latestApplication(c.env, user.id);
  if (existing && existing.status === 'pending') {
    return c.json({ error: 'You already have an application in review' }, 409);
  }

  // Conditional insert — the NOT EXISTS guard makes "one pending application
  // per user" atomic, so concurrent submissions can't both pass the pre-check.
  // D383 — the answers go in the same statement, so an application is never
  // stored without the answers it was submitted with. Only when some were
  // sent: an older client's insert names no column migration 315 added.
  // A database without 315 refuses rather than storing the application
  // without the answers it was submitted with.
  const withAnswers = async () => {
    try {
      return await c.env.DB.prepare(
        `INSERT INTO spinout_applications (user_id, company_name, idea, incorporated, stage, jurisdiction, cohort, answers_json)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?
         WHERE NOT EXISTS (
           SELECT 1 FROM spinout_applications WHERE user_id = ? AND status = 'pending'
         )`,
      ).bind(user.id, company, idea, incorporated, stage, jurisdiction, cohort, answersJson, user.id).run();
    } catch (err) {
      console.error('[spinout-lab/apply] insert with answers failed', err);
      return null;
    }
  };
  const ins = answersJson
    ? await withAnswers()
    : await c.env.DB.prepare(
      `INSERT INTO spinout_applications (user_id, company_name, idea, incorporated, stage, jurisdiction, cohort)
       SELECT ?, ?, ?, ?, ?, ?, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM spinout_applications WHERE user_id = ? AND status = 'pending'
       )`,
    ).bind(user.id, company, idea, incorporated, stage, jurisdiction, cohort, user.id).run();
  if (!ins) {
    return refusal(c, 503, 'application_not_saved', 'Your application could not be saved just now. Your answers are still on this page; try again in a moment.');
  }
  if ((ins.meta?.changes ?? 1) === 0) {
    return c.json({ error: 'You already have an application in review' }, 409);
  }

  // D383 — the draft this application came from is done with.
  try {
    await c.env.DB.prepare(`DELETE FROM spinout_application_drafts WHERE user_id = ?`).bind(user.id).run();
  } catch { /* drafts table not migrated */ }

  // D576 — the answer is saved, so the member's Week 1 plan is (re)computed
  // from it now. A failed write never refuses the application: the plan is
  // computed again when Week 1 starts, if none is stored by then.
  try {
    const { writeWeek1Plan } = await import('../services/week1PlanStore');
    await writeWeek1Plan(c.env, user.id, 'applied', `user:${user.id}`);
  } catch (e) {
    console.warn('[spinout-lab/apply] week 1 plan not written', (e as Error)?.message);
  }

  // Task #5 — pin the application to its target cycle so the close/
  // capacity/activation jobs know exactly which pool it belongs to.
  if (targetCycle) {
    try {
      const { ensureCohortAppSchema, ensureCycleWithWindow, assignApplicationToCycle } = await import('../services/cohortApplications');
      await ensureCohortAppSchema(c.env);
      const cyc = await ensureCycleWithWindow(c.env, targetCycle.year, targetCycle.month);
      const appRow = await latestApplication(c.env, user.id);
      if (cyc && appRow) await assignApplicationToCycle(c.env, Number((appRow as { id: number }).id), user.id, cyc.id);
    } catch (e) {
      console.error('[spinout-lab/apply] cycle assignment failed', e);
    }
  }

  let emailed = false;
  try {
    const { send } = await import('../services/email/send');
    const r = await send(c.env, 'spinout_application_received', user.email, {
      name: user.name || 'there',
      company_name: company,
      cohort_label: cohort,
    }, { userId: user.id });
    emailed = !!r?.ok;
  } catch (e) {
    console.error('[spinout-lab/apply] confirmation email failed', e);
  }

  return c.json({ ok: true, emailed, application: await latestApplication(c.env, user.id) });
});

// ---------------------------------------------------------------------------
// D383 — the application lifecycle, applicant side. Every route here acts on
// the caller's OWN application or draft; there is no id in any path, so there
// is no way to address someone else's.
// ---------------------------------------------------------------------------

/** Founder and explorer accounts apply (the /apply rule); nobody else drafts. */
function mayApply(user: User): boolean {
  return holdsLicence(user, 'founder') || user.role === 'exploring';
}
function refusal(c: any, status: number, code: string, message: string) {
  return c.json({ error: code, message, detail: message }, status);
}

// GET /apply/draft — the caller's saved draft, or null.
spinoutLab.get('/apply/draft', async (c) => {
  const user = await requireAuth(c);
  if (!mayApply(user)) return refusal(c, 403, 'role_cannot_apply', 'Only founder and explorer accounts can apply to the Lab.');
  const { parseStoredAnswers } = await import('../services/applicationLifecycle');
  let row: { answers_json: string; updated_at: string } | null = null;
  try {
    row = await c.env.DB.prepare(
      `SELECT answers_json, updated_at FROM spinout_application_drafts WHERE user_id = ?`,
    ).bind(user.id).first();
  } catch (e) {
    console.error('[spinout-lab/draft] read failed', (e as Error)?.message);
    return refusal(c, 503, 'draft_unreadable', 'Your saved draft could not be read. Nothing was lost; try again.');
  }
  if (!row) return c.json({ draft: null });
  // A draft is saved as typed, including the step-1 basics, so it is parsed
  // as an object rather than normalised to the submitted shape.
  let answers: Record<string, unknown> = {};
  try { const v = JSON.parse(row.answers_json); if (v && typeof v === 'object' && !Array.isArray(v)) answers = v; } catch { /* keep {} */ }
  return c.json({ draft: { answers, steps: parseStoredAnswers(row.answers_json), updated_at: row.updated_at } });
});

// PUT /apply/draft { answers } — save (replace) the caller's draft.
spinoutLab.put('/apply/draft', async (c) => {
  const user = await requireAuth(c);
  if (!mayApply(user)) return refusal(c, 403, 'role_cannot_apply', 'Only founder and explorer accounts can apply to the Lab.');
  const body = (await c.req.json().catch(() => ({}))) as { answers?: unknown };
  const raw = body.answers && typeof body.answers === 'object' && !Array.isArray(body.answers) ? body.answers : null;
  if (!raw) return refusal(c, 400, 'answers_required', 'A draft needs its answers.');
  const json = JSON.stringify(raw);
  if (json.length > 20000) return refusal(c, 413, 'draft_too_large', 'This draft is longer than an application can be. Shorten an answer and save again.');
  try {
    await c.env.DB.prepare(
      `INSERT INTO spinout_application_drafts (user_id, answers_json) VALUES (?, ?)
       ON CONFLICT(user_id) DO UPDATE SET answers_json = excluded.answers_json, updated_at = datetime('now')`,
    ).bind(user.id, json).run();
    const row = await c.env.DB.prepare(`SELECT updated_at FROM spinout_application_drafts WHERE user_id = ?`)
      .bind(user.id).first<{ updated_at: string }>();
    return c.json({ ok: true, updated_at: row?.updated_at ?? null });
  } catch (e) {
    console.error('[spinout-lab/draft] save failed', (e as Error)?.message);
    return refusal(c, 503, 'draft_not_saved', 'Your draft was not saved. Your answers are still on this page; try again.');
  }
});

// DELETE /apply/draft — discard the caller's draft.
spinoutLab.delete('/apply/draft', async (c) => {
  const user = await requireAuth(c);
  try {
    await c.env.DB.prepare(`DELETE FROM spinout_application_drafts WHERE user_id = ?`).bind(user.id).run();
  } catch (e) {
    console.error('[spinout-lab/draft] delete failed', (e as Error)?.message);
    return refusal(c, 503, 'draft_not_deleted', 'The draft could not be discarded. Try again.');
  }
  return c.json({ ok: true });
});

// POST /apply/withdraw — withdraw the caller's application while it is still
// undecided (pending, or waitlisted in the pool). The row stays, because the
// cohort pool's history points at it; its answers and idea are cleared, which
// is the "we delete the file" the apply page promises.
spinoutLab.post('/apply/withdraw', async (c) => {
  const user = await requireAuth(c);
  const app = await latestApplication(c.env, user.id);
  if (!app) return refusal(c, 404, 'no_application', 'There is no application to withdraw.');
  let poolStatus: string | null = null;
  try {
    const r = await c.env.DB.prepare(
      `SELECT status FROM cohort_applicants WHERE application_id = ? ORDER BY id DESC LIMIT 1`,
    ).bind(app.id).first<{ status: string }>();
    poolStatus = r?.status ?? null;
  } catch { /* pool not migrated */ }
  if (app.status !== 'pending' || (poolStatus && !['pending', 'waitlisted'].includes(poolStatus))) {
    return refusal(c, 409, 'not_withdrawable',
      'This application has already been decided, so there is nothing to withdraw. Contact the programme team if you need to step back.');
  }
  // D4658: one decision wins. The withdrawal, the pool row and the interview
  // are one batch (one D1 transaction), and the application is withdrawn only
  // while no admin decision has landed on its pool row — the approval checks
  // the same thing from its side (labDecisions.decideApplicant). The answers
  // are deleted, and the interview cancelled, only by the withdrawal that won.
  let changed = 0;
  try {
    const [upd] = await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE spinout_applications
            SET status = 'withdrawn', withdrawn_at = datetime('now'), answers_json = NULL, idea = ''
          WHERE id = ? AND user_id = ? AND status = 'pending'
            AND NOT EXISTS (SELECT 1 FROM cohort_applicants ca
                             WHERE ca.application_id = spinout_applications.id
                               AND ca.status IN ('approved', 'activated', 'rejected'))`,
      ).bind(app.id, user.id),
      c.env.DB.prepare(
        `UPDATE cohort_applicants SET status = 'withdrawn', decided_at = datetime('now'), decided_by = ?
          WHERE application_id = ? AND status IN ('pending', 'waitlisted')
            AND (SELECT status FROM spinout_applications WHERE id = ?) = 'withdrawn'`,
      ).bind(`user:${user.id}`, app.id, app.id),
      c.env.DB.prepare(
        `UPDATE spinout_application_interviews SET status = 'cancelled', updated_at = datetime('now')
          WHERE application_id = ? AND status = 'scheduled' AND outcome IS NULL
            AND (SELECT status FROM spinout_applications WHERE id = ?) = 'withdrawn'`,
      ).bind(app.id, app.id),
    ]);
    changed = Number(upd?.meta?.changes ?? 0);
  } catch (err) {
    console.error('[spinout-lab/apply/withdraw] update failed', (err as Error)?.message);
    return refusal(c, 503, 'withdraw_unavailable', 'Your application could not be withdrawn just now. Try again in a moment.');
  }
  if (changed === 0) {
    return refusal(c, 409, 'not_withdrawable', 'This application changed while you were withdrawing it. Refresh and check its status.');
  }
  return c.json({ ok: true, applicant: await loadApplicantBlock(c.env, user.id) });
});

// POST /apply/interview/reschedule { reason } — ask to move the interview.
// It does not move it: an admin does, by scheduling again.
spinoutLab.post('/apply/interview/reschedule', async (c) => {
  const user = await requireAuth(c);
  const body = (await c.req.json().catch(() => ({}))) as { reason?: unknown };
  const reason = (typeof body.reason === 'string' ? body.reason : '').trim().slice(0, 500);
  if (!reason) return refusal(c, 400, 'reason_required', 'Say what time would work, or why this one does not.');
  const app = await latestApplication(c.env, user.id);
  if (!app) return refusal(c, 404, 'no_application', 'There is no application with an interview.');
  let iv: { id: number; status: string; outcome: string | null } | null = null;
  try {
    iv = await c.env.DB.prepare(
      `SELECT id, status, outcome FROM spinout_application_interviews WHERE application_id = ? ORDER BY id DESC LIMIT 1`,
    ).bind(app.id).first();
  } catch (e) {
    console.error('[spinout-lab/reschedule] read failed', (e as Error)?.message);
    return refusal(c, 503, 'interview_unreadable', 'Your interview could not be read. Try again.');
  }
  // D1123: an interview whose outcome is recorded has happened (or was missed); it is not moved.
  if (!iv || iv.status !== 'scheduled' || iv.outcome) return refusal(c, 409, 'no_scheduled_interview', 'There is no scheduled interview to move.');
  await c.env.DB.prepare(
    `UPDATE spinout_application_interviews
        SET reschedule_requested_at = datetime('now'), reschedule_reason = ?, updated_at = datetime('now')
      WHERE id = ?`,
  ).bind(reason, iv.id).run();
  return c.json({ ok: true, applicant: await loadApplicantBlock(c.env, user.id) });
});

spinoutLab.post('/start', async (c) => {
  const user = await requireAuth(c);
  const out = await beginLab(c.env, user.id);
  return c.json(out.body, out.status);
});

type MilestoneBody = { milestone_key?: unknown };

spinoutLab.post('/milestone', async (c) => {
  const user = await requireAuth(c);
  const body = (await c.req.json().catch(() => ({}))) as MilestoneBody;
  const { completeLabMilestone } = await import('../services/labProgress');
  const out = await completeLabMilestone(c.env, user.id, body.milestone_key);
  return c.json(out.body, out.status);
});

// POST /venture { project_id } — D4659: name which of your own projects is the
// Lab venture, when you own several and none is recorded, or the recorded one
// was deleted. A recorded, live venture is never switched here.
spinoutLab.post('/venture', async (c) => {
  const user = await requireAuth(c);
  const body = (await c.req.json().catch(() => ({}))) as { project_id?: unknown };
  const { chooseVenture } = await import('../services/labVenture');
  try {
    const r = await chooseVenture(c.env, user.id, Number(body.project_id), `user:${user.id}`);
    if (!r.ok) return c.json({ error: r.error, code: r.code }, r.status);
    return c.json({ ok: true, venture: r.venture });
  } catch {
    return c.json({ error: 'Your venture could not be saved just now. Try again in a moment.', code: 'venture_unavailable', retryable: true }, 503);
  }
});

spinoutLab.post('/exit', async (c) => {
  const user = await requireAuth(c);
  return c.json(await leaveLab(c.env, user.id));
});

// D4661 — A PUBLIC OUTCOME READ THAT COULD NOT BE READ SAYS SO. `/graduates`, `/stats`,
// `/cohort` and `/shipped` used to answer `[]` or zeros when D1 failed, which a page
// draws as proof: "no graduates yet", "0 companies built", "no one in the sprint".
// A failed read is now a 503 with a code and our own sentence (the exception's text
// goes to the log), and every page that reads them already draws a rejected read as
// unreadable with a retry. A read that succeeded and found nothing still answers
// `[]` (or a measured zero): that is a different fact.
function outcomesUnreadable(c: Context<any>, what: string, raw: unknown): Response {
  return refuse(c, 503, {
    code: 'lab_outcomes_unreadable',
    message: `${what} could not be read just now. Try again in a moment.`,
    raw,
  });
}

// A company's name falls back to its application (`/shipped`; the other public reads do
// this in SQL, D4663). A failed fallback read is not "no name": the row would be dropped
// and the list would read as complete. It is recorded, and the handler answers
// unreadable instead of a shorter list.
function applicationNames(env: Env) {
  let failure: unknown = null;
  return {
    async of(rowName: string | null, userId: number): Promise<string | null> {
      if (rowName) return rowName;
      try {
        const row = await env.DB.prepare(
          `SELECT company_name FROM spinout_applications WHERE user_id = ? ORDER BY id DESC LIMIT 1`,
        ).bind(userId).first<{ company_name: string | null }>();
        return row?.company_name ?? null;
      } catch (e) {
        failure = failure ?? e;
        return null;
      }
    },
    get failure(): unknown { return failure; },
  };
}

// GET /graduates — PUBLIC (deliberately no requireAuth): powers the
// "Graduate companies." section, which also renders on the logged-out
// marketing page. A graduate is D4659's one rule (the view
// `spinout_lab_graduates`); the /exit escape hatch flips is_incorporated
// without finishing the sprint, so it does NOT count. Company facts come from
// the enrolled venture; the latest application's working name is the
// fallback. D4661: a read that fails is a 503 (see `outcomesUnreadable`),
// never []; [] means the read worked and no one has graduated. Exposes only
// company-level facts (no founder emails/ids). D4663: bounded in SQL
// (`services/labReporting.ts`).
spinoutLab.get('/graduates', async (c) => {
  const { graduateCards } = await import('../services/labReporting');
  const r = await graduateCards(c.env);
  return r.ok ? c.json(r.value) : outcomesUnreadable(c, r.what, r.raw);
});

// GET /stats — PUBLIC (deliberately no requireAuth): real numbers for the
// hero stats panel (also on the logged-out marketing page). Companies
// built = every graduate (D4659's rule), once; total_raised sums each
// graduate's enrolled venture's positive total_funding. D4661: a read that
// fails is a 503, not zeros — a measured zero (the read worked and no one has
// graduated) is a different fact. D4663: counted and summed in SQL.
spinoutLab.get('/stats', async (c) => {
  const { programmeFigures } = await import('../services/labReporting');
  const r = await programmeFigures(c.env);
  return r.ok ? c.json(r.value) : outcomesUnreadable(c, r.what, r.raw);
});

// GET /brief — PUBLIC (deliberately no requireAuth, the `/stats` precedent
// above): the six live values the Programme Brief prints. The brief is a
// marketing page a prospective founder reads before they have an account, so a
// gated route here would leave every figure on it blank for exactly the reader
// it is written for.
//
// WHY THE PAYLOAD IS SHAPED LIKE THIS. The brief's design names each live value
// as a dotted token — `{cohort.close_at}`, `{brief.year}` — and there are
// exactly six. The response mirrors those paths one for one, so the page has no
// mapping layer to get wrong and a test can assert that every token the design
// declares resolves to a key the route sends.
//
// FIVE OF THE SIX ARE PURE ARITHMETIC AND CANNOT FAIL. `resolveApplicationTarget`
// derives the cohort a new application lands in from the wall clock in
// `COHORT_TZ` and nothing else — no table is read — so the brief's dates are
// correct on a database that has never run the cohort migrations. Only `places`
// touches D1, through the shared settings read: a key nobody set answers the
// product default, which IS the operative number. A read that FAILS is not
// that (D511): `places` is then null and `places_unreadable` says why, so the
// pages print "could not be read" rather than a count nobody set.
//
// NOTHING ELSE ON THE BRIEF COMES FROM HERE. The tracks, the tools, the gates,
// the jurisdictions and the deliverables are the programme's own description,
// held in the SPA beside the pages that already render them. A route that also
// served those would be a store invented so a page could look dynamic, holding
// values nobody measures and nobody edits.
spinoutLab.get('/brief', async (c) => {
  const nowMs = Date.now();
  const { resolveApplicationTarget, monthLabel, readCohortSizeSettings } =
    await import('../services/cohortApplications');
  // From `cohortTiming`, which DECLARES it — `cohortApplications` imports the
  // constant but does not re-export it, so destructuring it there is undefined.
  const { COHORT_TZ, cycleWeekWindows } = await import('../services/cohortTiming');
  const t = resolveApplicationTarget(nowMs);
  // `resolveApplicationTarget` reports `ok: false` when no window is open —
  // between a close and the next month's opening. The brief then has no cohort
  // to name, and says so rather than naming the wrong one.
  const cohortOpen = t.ok;
  const settings = await readCohortSizeSettings(c.env);
  const max = settings ? settings.max : null;
  return c.json({
    brief: {
      generated_at: new Date(nowMs).toISOString(),
      year: new Date(nowMs).toISOString().slice(0, 4),
    },
    cohort: cohortOpen ? {
      name: monthLabel(t.year, t.month),
      start_date: new Date(t.window.startMs).toISOString(),
      close_at: new Date(t.window.closeMs).toISOString(),
      // D385 — the landing's "Ends" row. Week 4's deadline from the same week
      // windows the Lab enforces, so the page never computes its own end.
      end_date: new Date(cycleWeekWindows(t.year, t.month)[3].deadlineMs).toISOString(),
      places: max,
    } : { name: null, start_date: null, end_date: null, close_at: null, places: max },
    // The zone every date above is enforced in. Named rather than assumed: a
    // reader outside America/New_York is told which midnight the deadline is.
    zone: COHORT_TZ,
    applications_open: cohortOpen,
    places_unreadable: settings === null,
  });
});

// GET /cohort — PUBLIC (deliberately no requireAuth): powers the "Active
// cohort." live tracker, which also renders on the logged-out marketing
// page. Returns company-level facts only (working name, sector, week, day)
// — never founder names, emails, or ids. Members are users currently in
// the sprint (`spinout_lab_active = 1`), named by their enrolled venture;
// recent graduates (D4659's rule, within the last 45 days) fill the final
// column. D4661: a read that fails is a 503, never [] — an empty directory
// means no company is in the sprint, a failed one means we do not know.
// D4663: bounded in SQL (`services/labReporting.ts`).
spinoutLab.get('/cohort', async (c) => {
  const { cohortBoard } = await import('../services/labReporting');
  const r = await cohortBoard(c.env);
  return r.ok ? c.json(r.value) : outcomesUnreadable(c, r.what, r.raw);
});

// GET /shipped — which cohort companies cleared which gate, and when.
//
// AUTH-GATED, and this is the one route here where that needs an argument.
// `/cohort` above is public and already publishes every active company's
// working name, sector and week to anyone who asks. This route reports the
// same population at the same grain — a WEEK turning — so what it adds is a
// timestamp on a transition whose state is already published. That is why it
// stops at the week boundary: individual milestone keys are a different class
// of fact. `section83b_filed`, `founder_stock_issued`, `fundraise_ask_locked`,
// `investor_intros_secured` and `revenue_proof_added`, tied to a named
// company, are material corporate and financial statements about a private
// company, and nothing in the application flow asks a founder's consent to
// publish them. See weekClearsFor() in services/spinoutLabCatalog.ts, which is
// where that limit is enforced rather than left to this handler to remember.
//
// The login requirement is defence in depth rather than strictly load-bearing:
// the feed's value is peer accountability inside a cohort and its risk is bulk
// scraping, so a session costs the product nothing and removes the anonymous
// case. The logged-out intro renders the public directory and says plainly
// that the feed is visible inside the Lab.
//
// Company-level facts only, exactly like `/cohort`: the working name from the
// founder's project (or their application), never a founder name, email or id.
//
// D4661: a read that fails is a 503, never [] — the same contract as `/cohort` and `/stats`.
type ShippedRow = {
  user_id: number;
  milestone_key: string;
  completed_at: string | null;
  cohort: string | null;
  name: string | null;
  sector: string | null;
};

const SHIPPED_WINDOW_DAYS = 21;
const SHIPPED_MAX_EVENTS = 12;

spinoutLab.get('/shipped', async (c) => {
  await requireAuth(c);

  let rows: ShippedRow[] = [];
  try {
    // EVERY milestone for the active cohort, not just recent ones: weekMet
    // needs a founder's whole set to decide whether a week closed, so a
    // date-filtered fetch would silently report no clears for anyone whose
    // earlier milestones fell outside the window.
    const res = await c.env.DB.prepare(
      `SELECT m.user_id, m.milestone_key, m.completed_at,
              usf.spinout_lab_cohort AS cohort, p.name, p.sector
       FROM spinout_lab_milestones m
       JOIN users u ON u.id = m.user_id
       LEFT JOIN user_spinout_flags usf ON usf.user_id = u.id
       LEFT JOIN spinout_lab_enrollments le ON le.id = (SELECT MAX(x.id) FROM spinout_lab_enrollments x WHERE x.user_id = m.user_id)
       LEFT JOIN projects p ON p.id = le.project_id AND p.deleted_at IS NULL
       WHERE u.spinout_lab_active = 1
       ORDER BY m.user_id ASC, m.completed_at ASC, p.id ASC
       LIMIT 2000`,
    ).all<ShippedRow>();
    rows = res.results ?? [];
  } catch (e) {
    return outcomesUnreadable(c, 'The Lab’s shipped feed', e);
  }

  // The projects LEFT JOIN repeats every milestone once per project, so fold
  // to one row per (founder, milestone) before replaying — a duplicate would
  // not change weekMet's answer, but it would make the row that "closed" the
  // week ambiguous.
  const byUser = new Map<number, { meta: ShippedRow; keys: Map<string, string | null> }>();
  for (const r of rows) {
    let entry = byUser.get(r.user_id);
    if (!entry) {
      entry = { meta: r, keys: new Map() };
      byUser.set(r.user_id, entry);
    }
    if (!entry.keys.has(r.milestone_key)) entry.keys.set(r.milestone_key, r.completed_at);
    if (!entry.meta.name && r.name) entry.meta = { ...entry.meta, name: r.name, sector: r.sector };
  }

  const cutoffMs = Date.now() - SHIPPED_WINDOW_DAYS * 86_400_000;
  const events: Array<{
    company: string;
    sector: string | null;
    cohort: string | null;
    week: number;
    cleared_at: string;
  }> = [];

  const names = applicationNames(c.env);
  for (const [userId, entry] of byUser) {
    const clears = weekClearsFor(
      [...entry.keys].map(([milestone_key, completed_at]) => ({ milestone_key, completed_at })),
    );
    if (!clears.length) continue;
    const company = await names.of(entry.meta.name, userId);
    // A cohort member with no company name anywhere is skipped rather than
    // drawn as "Untitled": the row is about a company, and we do not have one.
    if (!company) continue;
    for (const cl of clears) {
      const ms = parseTsUtc(cl.cleared_at);
      if (ms === null || ms < cutoffMs) continue;
      events.push({
        company,
        sector: entry.meta.sector ?? null,
        cohort: entry.meta.cohort ?? null,
        week: cl.week,
        cleared_at: cl.cleared_at,
      });
    }
  }

  if (names.failure) return outcomesUnreadable(c, 'The Lab’s shipped feed', names.failure);
  events.sort((a, b) => b.cleared_at.localeCompare(a.cleared_at));
  return c.json(events.slice(0, SHIPPED_MAX_EVENTS));
});

// GET /fund-metrics — auth-gated: live program + raise numbers for the LP &
// Investor Workspace. Program figures come from real graduate rows (the same
// week-4 `incorporation_completed` signal /stats uses, plus on-time timing
// against `spinout_lab_started_at`); raise figures aggregate the Spin-Out
// fund's own `limited_partners` rows. Aggregation lives in
// services/spinoutFundMetrics.ts (pure, tested); this handler only queries.
// Each block carries `available` so the SPA can fall back to its
// operator-maintained model with honest provenance instead of rendering
// zeros as facts. Never throws — a missing table answers `available: false`.
spinoutLab.get('/fund-metrics', async (c) => {
  const user = await requireAuth(c);
  const { summarizeGraduates, summarizeLpRows } = await import('../services/spinoutFundMetrics');

  let program: import('../services/spinoutFundMetrics').ProgramSummary = {
    available: false, graduates: 0, on_time_pct: null, alumni_raised: null,
    entrants: null, incorporation_pct: null, verified_discovery_pct: null,
    revenue_proof_pct: null, formation_velocity_days: null,
    graduation_to_investment_pct: null,
  };
  try {
    // One row per graduate (a founder with the week-4 incorporation
    // milestone), carrying the evidence each studio-throughput tile needs.
    // Correlated subqueries rather than joins: a founder with 18 interviews
    // and 3 portfolio positions must stay ONE row, or every aggregate would
    // be multiplied by the fan-out. `ORDER BY p.id` keeps the first project
    // per user deterministic, matching GET /stats.
    const res = await c.env.DB.prepare(
      `SELECT m.user_id, m.graduated_at AS completed_at, u.spinout_lab_started_at AS started_at,
              p.total_funding, p.revenue, p.mrr, p.paying_customers,
              p.paid_pilot_status,
              (SELECT COUNT(*) FROM discovery_interviews di
                WHERE di.project_id = p.id) AS interview_count,
              (SELECT COUNT(*) FROM portfolio_positions pp
                WHERE pp.project_id = p.id) AS backed
       FROM spinout_lab_graduates m
       JOIN users u ON u.id = m.user_id
       LEFT JOIN spinout_lab_enrollments le ON le.id = (SELECT MAX(x.id) FROM spinout_lab_enrollments x WHERE x.user_id = m.user_id)
       LEFT JOIN projects p ON p.id = le.project_id AND p.deleted_at IS NULL
       ORDER BY m.user_id ASC, p.id ASC`,
    ).all<import('../services/spinoutFundMetrics').GraduateTimingRow>();

    // The incorporation-rate DENOMINATOR: everyone who ever started the Lab.
    // Counted separately (not derivable from the graduate rows) and left null
    // on failure, so the rate degrades to "unmeasured" rather than to a
    // fabricated 100%.
    let entrants: number | null = null;
    try {
      const e = await c.env.DB.prepare(
        `SELECT COUNT(*) AS n FROM users WHERE spinout_lab_started_at IS NOT NULL`,
      ).first<{ n: number }>();
      const n = Number(e?.n ?? NaN);
      if (Number.isFinite(n)) entrants = n;
    } catch { /* column predates the Lab migrations */ }

    program = summarizeGraduates(res.results ?? [], SPRINT_DAYS, entrants);
  } catch { /* tables predate the Lab migrations */ }

  // The fund this workspace reports on — resolved by slug, not name, for the
  // same rename-safety reason the SPA's SPINOUT_FUND_SLUG comment gives.
  //
  // Raise aggregates (committed, soft-circled, LP count, median ticket) are
  // capital-side facts, so they are scoped beyond bare authentication:
  // admin/partner/investor roles see them, as does any caller who actually
  // holds an LP row in this fund. Everyone else gets `available: false` and
  // the SPA's operator-maintained figures — exactly what such a viewer saw
  // before this endpoint existed, so nothing is newly exposed to founders or
  // guests. The program block above stays role-free: it is the same
  // graduate-level data the public GET /stats already serves.
  let fund: Record<string, unknown> = { available: false };
  try {
    const { Funds } = await import('../models/funds');
    const row = await Funds.bySlug(c.env, 'spinout-fund-i');
    let entitled = !!user && (user.role === 'admin' || holdsLicence(user, 'partner') || holdsLicence(user, 'investor'));
    if (row && !entitled) {
      // lpSelfScope, not the hand-rolled predicate this line used to carry.
      // It bound `user.email ?? ''`, and `LOWER(email) = LOWER('')` is true for
      // every row with an empty email — so a session with no address on it
      // matched any such row and was entitled to the fund's raise aggregates.
      // The scope drops the email arm entirely when there is nothing to match.
      await claimLpRowsByEmail(c.env, Number(user.id), user.email, Number(row.id));
      const scope = lpSelfScope(user as any);
      const mine = await c.env.DB.prepare(
        `SELECT 1 FROM limited_partners lp WHERE lp.fund_id = ? AND ${scope.sql} LIMIT 1`,
      ).bind(row.id, ...scope.binds).first();
      entitled = !!mine;
    }
    if (row && entitled) {
      const lps = await c.env.DB.prepare(
        `SELECT commitment_amount, lpa_signed FROM limited_partners WHERE fund_id = ?`,
      ).bind(row.id).all<import('../services/spinoutFundMetrics').LpCommitmentRow>();
      fund = {
        available: true,
        fund_id: row.id,
        name: row.name,
        slug: row.slug,
        // Fund size (target) is the v2 `fund_size_cents` column —
        // `total_commitment` is aggregated LP commitments, which would make
        // the raise bar read 100% by definition. Null falls back to the
        // operator-stated target in the SPA.
        target: Number(row.fund_size_cents || 0) > 0 ? Number(row.fund_size_cents) / 100 : null,
        ...summarizeLpRows(lps.results ?? []),
      };
    }
  } catch { /* fund tables absent or pre-slug */ }

  return c.json({ ok: true, program, fund });
});

// ---------------------------------------------------------------------------
// LP applications — the Spin-Out Fund I request-for-access flow.
//
// The workspace's application step used to be a dead end: no endpoint, so the
// page routed applicants through support and said so. These two routes are
// that endpoint.
//
// SECURITY MODEL. An application is an expression of interest, NOT an
// entitlement. Nothing reads this table to decide what a viewer may see — the
// access ladder derives from `limited_partners` rows via lpAccessState(), and a
// submitted application only moves a viewer from 'visitor' to 'pending', which
// unlocks nothing at all. That is what makes it safe for the applicant to be
// the author of their own row: the worst a hostile submitter achieves is
// telling the GP they are interested. Every read and write below is scoped to
// `user.id` — no route here returns anyone else's application.
// ---------------------------------------------------------------------------

const LP_FUND_SLUG = 'spinout-fund-i';

/** Self-heal on a cold isolate (migration 165 is the canonical DDL). */
const LP_APP_SCHEMA_READY = new WeakMap<object, boolean>();
async function ensureLpApplicationsSchema(env: Env): Promise<void> {
  if (LP_APP_SCHEMA_READY.get(bindingKey(env))) return;
  await env.DB.exec(
    'CREATE TABLE IF NOT EXISTS lp_applications ('
    + 'id INTEGER PRIMARY KEY AUTOINCREMENT, '
    + 'user_id INTEGER NOT NULL, '
    + "fund_slug TEXT NOT NULL DEFAULT 'spinout-fund-i', "
    + 'investor_type TEXT NOT NULL, '
    + 'target_commitment REAL, '
    + "preference_areas TEXT NOT NULL DEFAULT '[]', "
    + 'accredited INTEGER NOT NULL DEFAULT 0, '
    + 'note TEXT, '
    + "status TEXT NOT NULL DEFAULT 'pending', "
    + 'reviewed_by INTEGER, '
    + 'reviewed_at TEXT, '
    + 'review_note TEXT, '
    + "created_at TEXT NOT NULL DEFAULT (datetime('now')), "
    + "updated_at TEXT NOT NULL DEFAULT (datetime('now'))"
    + ')',
  );
  await env.DB.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_lp_applications_user_fund '
    + 'ON lp_applications(user_id, fund_slug)',
  );
  LP_APP_SCHEMA_READY.set(bindingKey(env), true);
}

// GET /lp-application — the caller's own application, or null.
spinoutLab.get('/lp-application', async (c) => {
  const user = await requireAuth(c);
  const { presentLpApplication } = await import('../services/lpApplications');
  try {
    await ensureLpApplicationsSchema(c.env);
    const row = await c.env.DB.prepare(
      'SELECT * FROM lp_applications WHERE user_id = ? AND fund_slug = ?',
    ).bind(user.id, LP_FUND_SLUG).first<any>();
    return c.json({ ok: true, application: presentLpApplication(row) });
  } catch {
    // A store that cannot be read must not read as "never applied" — that
    // would invite a duplicate submission and show the form to someone who
    // already used it. Say so instead.
    return c.json({ error: 'Could not load your application status.' }, 503);
  }
});

// POST /lp-application — submit or update the caller's own application.
//
// Upsert on (user_id, fund_slug): re-submitting edits the existing row rather
// than stacking duplicates in the GP's queue. An application already APPROVED
// or DECLINED is not re-openable by the applicant — that is the GP's decision
// to revisit, so a resubmission after review is refused with a 409 rather than
// silently resetting the row to pending.
spinoutLab.post('/lp-application', async (c) => {
  const user = await requireAuth(c);
  const { validateLpApplication, presentLpApplication } = await import('../services/lpApplications');

  let body: unknown = {};
  try { body = await c.req.json(); } catch { body = {}; }
  const parsed = validateLpApplication(body);
  if (!parsed.ok) {
    return c.json({ error: parsed.errors.join(' '), errors: parsed.errors }, 400);
  }

  try {
    await ensureLpApplicationsSchema(c.env);
    const existing = await c.env.DB.prepare(
      'SELECT status FROM lp_applications WHERE user_id = ? AND fund_slug = ?',
    ).bind(user.id, LP_FUND_SLUG).first<{ status: string }>();
    if (existing && (existing.status === 'approved' || existing.status === 'declined')) {
      return c.json({
        error: `Your application has already been ${existing.status}. Contact the fund team to revisit it.`,
        status: existing.status,
      }, 409);
    }

    const v = parsed.value;
    await c.env.DB.prepare(
      'INSERT INTO lp_applications '
      + '(user_id, fund_slug, investor_type, target_commitment, preference_areas, accredited, note, status, updated_at) '
      + "VALUES (?, ?, ?, ?, ?, 1, ?, 'pending', datetime('now')) "
      + 'ON CONFLICT(user_id, fund_slug) DO UPDATE SET '
      + 'investor_type = excluded.investor_type, '
      + 'target_commitment = excluded.target_commitment, '
      + 'preference_areas = excluded.preference_areas, '
      + 'accredited = excluded.accredited, '
      + 'note = excluded.note, '
      + "status = 'pending', "
      + "updated_at = datetime('now')",
    ).bind(
      user.id, LP_FUND_SLUG, v.investor_type, v.target_commitment,
      JSON.stringify(v.preference_areas), v.note,
    ).run();

    const row = await c.env.DB.prepare(
      'SELECT * FROM lp_applications WHERE user_id = ? AND fund_slug = ?',
    ).bind(user.id, LP_FUND_SLUG).first<any>();
    return c.json({ ok: true, application: presentLpApplication(row) });
  } catch (e) {
    console.error('[spinout-lab] lp-application submit failed:', (e as Error).message);
    return c.json({ error: 'Could not submit your application. Please try again.' }, 500);
  }
});

export default spinoutLab;
