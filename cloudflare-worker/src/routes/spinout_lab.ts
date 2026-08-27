/**
 * Spin-Out Lab — 4-week guided sprint for pre-incorporation founders.
 *
 * Mounted at /api/spinout-lab. JWT-auth-gated for every route (no admin
 * escape hatch). The lab is detected from `users.spinout_lab_active`.
 *
 *   GET  /state      → current week, days remaining, milestones, unlocked
 *                       features for the caller
 *   POST /start      → flip the lab on for the caller (idempotent; 409 if
 *                       the caller is already incorporated)
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
 * Pure-logic functions (`getLabState`, `startLab`, `recordMilestone`,
 * `exitLab`) are exported so the smoke test can drive the full flow
 * against a mocked sql() helper without standing up Hono + JWT.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import { requireAuth } from '../auth';
import { lpSelfScope } from '../services/tenancyScope';
import { claimLpRowsByEmail } from '../services/lpClaim';
// Catalog moved to a pure module so non-route consumers (advisor
// state machine) can import it without dragging in Hono / db / auth.
// The route's original public surface is preserved by re-export.
import {
  MILESTONES,
  VALID_MILESTONE_KEYS,
  weekForKey,
  weekMet,
  unlockedFeaturesThrough,
} from '../services/spinoutLabCatalog';
// Re-export so existing external imports of these names from this
// module keep working unchanged.
export { MILESTONES, VALID_MILESTONE_KEYS, weekMet, unlockedFeaturesThrough };

const spinoutLab = new Hono<{ Bindings: Env }>();

/** Days elapsed since `started_at` (UTC). Returns 0 when started_at is null. */
function daysSince(startedAt: string | null | undefined, nowMs = Date.now()): number {
  if (!startedAt) return 0;
  const startMs = Date.parse(
    startedAt.replace(' ', 'T') + (startedAt.includes('Z') ? '' : 'Z'),
  );
  if (!Number.isFinite(startMs)) return 0;
  return Math.max(0, Math.floor((nowMs - startMs) / 86_400_000));
}

const SPRINT_DAYS = 28;

// ---------------------------------------------------------------------------
// Pure logic — exported so the test harness can drive the full flow against
// a mocked sql() helper. The wire handlers below are thin wrappers.
// ---------------------------------------------------------------------------

export type LabState = {
  active: boolean;
  week: number;
  days_remaining: number;
  started_at: string | null;
  is_incorporated: boolean;
  milestones: Array<{ key: string; week: number; completed_at: string }>;
  unlocked_features: string[];
};

// Concrete row shapes for every SELECT this module issues. Keeps the Sql
// helper's call sites typed without falling back to `any`.
type UserStateRow = {
  spinout_lab_active: number | null;
  spinout_lab_week: number | null;
  spinout_lab_started_at: string | null;
  is_incorporated: number | null;
};
type UserActiveWeekRow = {
  spinout_lab_active: number | null;
  spinout_lab_week: number | null;
};
type IsIncorporatedRow = { is_incorporated: number | null };
type MilestoneRow = { key: string; week: number; completed_at: string };
type MilestoneKeyRow = { milestone_key: string };

// Generic-tagged sql helper: each call site chooses the row type it expects.
// Mirrors the shape of `getSQL(c.env)` from `db.ts` (postgres-style template
// literal) without leaking `any` into the rest of the module.
type SqlValue = string | number | boolean | null;
type Sql = <T = unknown>(
  strings: TemplateStringsArray,
  ...values: SqlValue[]
) => Promise<T[]>;

// Named union return types — keep these as type aliases (not inline in the
// function signature) so the test harness's brace balancer can slice each
// logic function cleanly. See `cloudflare-worker/test/spinout_lab.test.mjs`.
export type StartResult =
  | { ok: true; state: LabState }
  | { ok: false; status: 409; error: string };

export type MilestoneResult =
  | { ok: true; state: LabState }
  | { ok: false; status: 400 | 409; error: string };

export async function getLabState(sql: Sql, userId: number): Promise<LabState> {
  const rows = await sql<UserStateRow>`
    SELECT spinout_lab_active, spinout_lab_week, spinout_lab_started_at, is_incorporated
    FROM users WHERE id = ${userId}
  `;
  const row: Partial<UserStateRow> = rows[0] ?? {};
  const milestones = await sql<MilestoneRow>`
    SELECT milestone_key AS key, week, completed_at
    FROM spinout_lab_milestones
    WHERE user_id = ${userId}
    ORDER BY week ASC, completed_at ASC
  `;

  const week = Number(row.spinout_lab_week ?? 1);
  return {
    active: Number(row.spinout_lab_active ?? 0) === 1,
    week,
    days_remaining: Math.max(0, SPRINT_DAYS - daysSince(row.spinout_lab_started_at ?? null)),
    started_at: row.spinout_lab_started_at ?? null,
    is_incorporated: Number(row.is_incorporated ?? 0) === 1,
    milestones,
    unlocked_features: unlockedFeaturesThrough(week),
  };
}

export async function startLab(sql: Sql, userId: number): Promise<StartResult> {
  // Refuse to re-open the Lab for users who have already incorporated —
  // the Lab is strictly a pre-incorporation sprint.
  const probe = await sql<IsIncorporatedRow>`
    SELECT is_incorporated FROM users WHERE id = ${userId}
  `;
  if (probe[0] && Number(probe[0].is_incorporated) === 1) {
    return { ok: false, status: 409, error: 'User is already incorporated' };
  }
  // Idempotent: COALESCE preserves an existing started_at and a non-zero
  // week so re-calling start() doesn't reset progress.
  await sql`
    UPDATE users
    SET spinout_lab_active = 1,
        spinout_lab_week = COALESCE(NULLIF(spinout_lab_week, 0), 1),
        spinout_lab_started_at = COALESCE(spinout_lab_started_at, datetime('now'))
    WHERE id = ${userId}
  `;
  return { ok: true, state: await getLabState(sql, userId) };
}

export async function recordMilestone(
  sql: Sql,
  userId: number,
  rawKey: string,
): Promise<MilestoneResult> {
  const key = (rawKey ?? '').trim();
  if (!key) return { ok: false, status: 400, error: 'milestone_key is required' };
  if (!VALID_MILESTONE_KEYS.has(key)) {
    return { ok: false, status: 400, error: `Unknown milestone_key: ${key}` };
  }
  const week = weekForKey(key);
  if (!week) return { ok: false, status: 400, error: 'milestone_key has no week' };

  // Refuse to record milestones when the lab is off — prevents accidental
  // pollution from a feature page calling complete() after exit().
  const userRows = await sql<UserActiveWeekRow>`
    SELECT spinout_lab_active, spinout_lab_week FROM users WHERE id = ${userId}
  `;
  const u = userRows[0];
  if (!u || Number(u.spinout_lab_active) !== 1) {
    return { ok: false, status: 409, error: 'Spin-Out Lab is not active' };
  }

  // Idempotent — UNIQUE(user_id, milestone_key) prevents duplicates.
  await sql`
    INSERT OR IGNORE INTO spinout_lab_milestones (user_id, week, milestone_key)
    VALUES (${userId}, ${week}, ${key})
  `;

  // Auto-advance loop. Re-read the milestone set, then walk weeks from the
  // user's current week upward as long as each week is fully met. Cap at
  // week 4. When week 4 is met, also flip `is_incorporated=1` and turn
  // the lab off so the sidebar swaps without an extra round-trip.
  const completedRows = await sql<MilestoneKeyRow>`
    SELECT milestone_key FROM spinout_lab_milestones WHERE user_id = ${userId}
  `;
  const completed = new Set<string>(completedRows.map((r) => r.milestone_key));

  let newWeek = Number(u.spinout_lab_week ?? 1);
  while (newWeek < 4 && weekMet(newWeek, completed)) {
    newWeek += 1;
  }
  if (newWeek !== Number(u.spinout_lab_week)) {
    await sql`UPDATE users SET spinout_lab_week = ${newWeek} WHERE id = ${userId}`;
  }
  if (newWeek === 4 && weekMet(4, completed)) {
    // Single statement so a partial failure can't half-incorporate the user.
    // SQLite/D1 statement execution is atomic; either both columns flip or
    // neither does. Mirrors the explicit /exit route's effect.
    await sql`
      UPDATE users SET spinout_lab_active = 0, is_incorporated = 1 WHERE id = ${userId}
    `;
  }

  return { ok: true, state: await getLabState(sql, userId) };
}

export async function exitLab(sql: Sql, userId: number): Promise<LabState> {
  // Single statement so a partial failure can't half-incorporate the user.
  await sql`
    UPDATE users
    SET spinout_lab_active = 0, is_incorporated = 1
    WHERE id = ${userId}
  `;
  return getLabState(sql, userId);
}

// ---------------------------------------------------------------------------
// Wire handlers — thin wrappers around the pure logic above.
// ---------------------------------------------------------------------------

// Cohort applications — lazy table ensure (mirrors migration 155) so
// databases that haven't run the migration yet still answer.
let applicationsSchemaEnsured = false;
async function ensureApplicationsTable(env: Env): Promise<void> {
  if (applicationsSchemaEnsured) return;
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
  applicationsSchemaEnsured = true;
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

spinoutLab.get('/state', async (c) => {
  const user = await requireAuth(c);
  const sql = getSQL(c.env);
  const state = await getLabState(sql, user.id);
  // Task #7 — admission fields. Queried at the wire layer (not inside
  // getLabState) so the pure-logic test harness's exact-SELECT mocks stay
  // untouched, and try/caught so databases predating migration 154 still
  // answer (admitted=false).
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
  // Cohort timing gate — added at the wire layer (same rule as the
  // admission fields above: never inside getLabState, so the exact-slice
  // test harness stays intact). Null for legacy founders whose sprint
  // predates the calendar system. `unlocked_features` is re-capped by the
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
  const payload: Record<string, unknown> = {
    ...state, admitted, cohort, application,
    cohort_timing: cohortTiming,
    application_window: applicationWindow,
    server_time: new Date().toISOString(),
  };
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
};

spinoutLab.post('/apply', async (c) => {
  const user = await requireAuth(c);
  // Founder and Explorer accounts may apply — the Lab is exactly how an
  // explorer graduates into a founder-track company.
  if (!['founder', 'exploring'].includes((user.role || '').toLowerCase())) {
    return c.json({ error: 'Only founder and explorer accounts can apply to the Lab' }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as ApplyBody;
  const company = (typeof body.company_name === 'string' ? body.company_name : '').trim().slice(0, 200);
  const idea = (typeof body.idea === 'string' ? body.idea : '').trim().slice(0, 4000);
  if (!company) return c.json({ error: 'Company / working name is required' }, 400);
  if (!idea) return c.json({ error: 'Please describe your idea or project' }, 400);
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
  const ins = await c.env.DB.prepare(
    `INSERT INTO spinout_applications (user_id, company_name, idea, incorporated, stage, jurisdiction, cohort)
     SELECT ?, ?, ?, ?, ?, ?, ?
     WHERE NOT EXISTS (
       SELECT 1 FROM spinout_applications WHERE user_id = ? AND status = 'pending'
     )`,
  ).bind(user.id, company, idea, incorporated, stage, jurisdiction, cohort, user.id).run();
  if ((ins.meta?.changes ?? 1) === 0) {
    return c.json({ error: 'You already have an application in review' }, 409);
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

spinoutLab.post('/start', async (c) => {
  const user = await requireAuth(c);
  const sql = getSQL(c.env);
  const r = await startLab(sql, user.id);
  await sql.end();
  if (!r.ok) return c.json({ error: r.error }, r.status);
  return c.json(r.state);
});

type MilestoneBody = { milestone_key?: unknown };

spinoutLab.post('/milestone', async (c) => {
  const user = await requireAuth(c);
  const body = (await c.req.json().catch(() => ({}))) as MilestoneBody;
  const key = typeof body.milestone_key === 'string' ? body.milestone_key : '';
  // Cohort week gating — enforced at the wire layer (keeps the pure
  // recordMilestone logic sliceable by the test harness). A founder may
  // only record milestones for weeks at or below their gate's max_week:
  // calendar-locked future weeks and weeks beyond a failed (frozen) week
  // are rejected with 423 Locked.
  try {
    const { getCohortGate } = await import('../services/cohortTiming');
    const gate = await getCohortGate(c.env, user.id);
    if (gate) {
      // A failed (frozen) founder can record NOTHING — not even the frozen
      // week — otherwise recordMilestone's auto-advance loop could bump
      // users.spinout_lab_week and bypass the freeze at the data layer.
      // Unfreezing requires an admin grace extension or force-pass.
      if (gate.frozen) {
        return c.json({
          error: `Your sprint is paused at Week ${gate.frozen_week} pending admin review — deliverables can't be recorded until an admin grants a grace extension or an override.`,
          locked: true, max_week: gate.max_week,
        }, 423);
      }
      const keyWeek = weekForKey((key ?? '').trim());
      if (keyWeek && keyWeek > gate.max_week) {
        const why = gate.frozen
          ? `Your sprint is paused at Week ${gate.frozen_week} pending admin review.`
          : `Week ${keyWeek} unlocks on schedule — it is locked until ${gate.weeks.find((w) => w.week === keyWeek)?.unlock_at ?? 'its unlock time'} UTC.`;
        return c.json({ error: `Week ${keyWeek} is locked. ${why}`, locked: true, max_week: gate.max_week }, 423);
      }
    }
  } catch { /* gate unavailable (pre-migration) — legacy behavior */ }
  const sql = getSQL(c.env);
  const r = await recordMilestone(sql, user.id, key);
  await sql.end();
  if (!r.ok) return c.json({ error: r.error }, r.status);

  // Graduation issues the credential. `incorporation_completed` is already
  // the definition of "graduated" everywhere else (public graduate list,
  // /stats, week-4 gating), so keying issuance on the same row avoids
  // inventing a second, competing definition.
  //
  // Deliberately after recordMilestone and outside its transaction: a founder
  // finishing the program must not have their completion rejected because a
  // certificate insert failed. issueOnGraduation never throws and is
  // idempotent, and the backfill picks up anything it missed.
  if (key === 'incorporation_completed') {
    try {
      const { issueOnGraduation } = await import('../services/certificateIssuance');
      await issueOnGraduation(c.env, user.id);
    } catch { /* issuance is best-effort — never blocks graduation */ }
  }

  return c.json(r.state);
});

spinoutLab.post('/exit', async (c) => {
  const user = await requireAuth(c);
  const sql = getSQL(c.env);
  const state = await exitLab(sql, user.id);
  await sql.end();
  return c.json(state);
});

// GET /graduates — PUBLIC (deliberately no requireAuth): powers the
// "Graduate companies." section, which also renders on the logged-out
// marketing page. A graduate is a user with the week-4
// `incorporation_completed` milestone on record — the strongest completion
// signal (the /exit escape hatch flips is_incorporated without finishing
// the sprint, so it does NOT count). Company facts come from the founder's
// project; the cohort application's working name is the fallback. Never
// throws — answers [] when tables predate the Lab migrations. Exposes only
// company-level facts (no founder emails/ids).
type GraduateRow = {
  user_id: number;
  completed_at: string | null;
  cohort: string | null;
  uid: string | null;
  name: string | null;
  sector: string | null;
  stage: string | null;
  status: string | null;
  total_funding: number | null;
  last_funding_round: string | null;
};

spinoutLab.get('/graduates', async (c) => {
  let rows: GraduateRow[] = [];
  try {
    const res = await c.env.DB.prepare(
      `SELECT m.user_id, m.completed_at, usf.spinout_lab_cohort AS cohort,
              p.uid, p.name, p.sector, p.stage, p.status, p.total_funding, p.last_funding_round
       FROM spinout_lab_milestones m
       JOIN users u ON u.id = m.user_id
       LEFT JOIN user_spinout_flags usf ON usf.user_id = u.id
       LEFT JOIN projects p ON p.founder_id = u.founder_id AND p.deleted_at IS NULL
       WHERE m.milestone_key = 'incorporation_completed'
       ORDER BY m.completed_at DESC, p.id ASC`,
    ).all<GraduateRow>();
    rows = res.results ?? [];
  } catch {
    return c.json([]);
  }
  type GraduateCard = {
    name: string | null;
    sector: string | null;
    stage: string | null;
    cohort: string | null;
    uid: string | null;
    graduated_at: string | null;
    raised: number | null;
    last_round: string | null;
  };
  // One card per graduate. Founders can have several projects — prefer the
  // first one whose public profile will actually resolve
  // (public.ts GET /startup/:handle 404s archived/rejected/intake projects).
  const byUser = new Map<number, GraduateCard>();
  const order: number[] = [];
  for (const r of rows) {
    const linkable =
      !!r.uid && !['archived', 'rejected', 'intake'].includes(String(r.status || '').toLowerCase());
    const entry: GraduateCard = {
      name: r.name ?? null,
      sector: r.sector ?? null,
      stage: r.stage ?? null,
      cohort: r.cohort ?? null,
      uid: linkable ? r.uid : null,
      graduated_at: r.completed_at ?? null,
      raised: r.total_funding ?? null,
      last_round: r.last_funding_round ?? null,
    };
    const existing = byUser.get(r.user_id);
    if (!existing) {
      byUser.set(r.user_id, entry);
      order.push(r.user_id);
    } else if (existing.uid === null && entry.uid) {
      byUser.set(r.user_id, entry); // upgrade to the publicly linkable project
    }
  }
  const out: GraduateCard[] = [];
  for (const userId of order) {
    const entry = byUser.get(userId)!;
    if (!entry.name) {
      entry.name = (await latestApplication(c.env, userId))?.company_name ?? null;
    }
    if (!entry.name) continue; // nothing real to show for this graduate
    out.push(entry);
    if (out.length >= 12) break;
  }
  return c.json(out);
});

// GET /cohort — PUBLIC (deliberately no requireAuth): powers the "Active
// cohort." live tracker, which also renders on the logged-out marketing
// page. Returns company-level facts only (working name, sector, week, day)
// — never founder names, emails, or ids. Members are users currently in
// the sprint (`spinout_lab_active = 1`); recent graduates (week-4
// `incorporation_completed` within the last 45 days) fill the final
// column. Never throws — answers [] when tables predate the Lab
// migrations.
type CohortActiveRow = {
  user_id: number;
  week: number | null;
  started_at: string | null;
  cohort: string | null;
  name: string | null;
  sector: string | null;
};

type CohortGradRow = {
  user_id: number;
  completed_at: string | null;
  started_at: string | null;
  cohort: string | null;
  name: string | null;
  sector: string | null;
};

type CohortMember = {
  name: string;
  sector: string | null;
  cohort: string | null;
  status: 'active' | 'graduated';
  week: number;
  day: number | null;
  started_at: string | null;
};

// GET /stats — PUBLIC (deliberately no requireAuth): real numbers for the
// hero stats panel (also on the logged-out marketing page). Companies
// built = distinct founders who completed the week-4 incorporation
// milestone; total_raised sums each graduate's first (non-deleted)
// project's total_funding. Never throws — answers zeros when tables
// predate the Lab migrations.
spinoutLab.get('/stats', async (c) => {
  try {
    const res = await c.env.DB.prepare(
      `SELECT m.user_id, p.total_funding
       FROM spinout_lab_milestones m
       LEFT JOIN projects p ON p.founder_id = (SELECT founder_id FROM users WHERE id = m.user_id)
         AND p.deleted_at IS NULL
       WHERE m.milestone_key = 'incorporation_completed'
       ORDER BY m.user_id ASC, p.id ASC`,
    ).all<{ user_id: number; total_funding: number | null }>();
    const rows = res.results ?? [];
    const seen = new Set<number>();
    let companies = 0;
    let totalRaised = 0;
    for (const r of rows) {
      if (seen.has(r.user_id)) continue; // several projects: count the first
      seen.add(r.user_id);
      companies += 1;
      const funding = Number(r.total_funding ?? 0);
      if (Number.isFinite(funding) && funding > 0) totalRaised += funding;
    }
    return c.json({ companies, total_raised: totalRaised > 0 ? totalRaised : null });
  } catch {
    return c.json({ companies: 0, total_raised: null });
  }
});

spinoutLab.get('/cohort', async (c) => {
  const parseTs = (s: string | null | undefined): number | null => {
    if (!s) return null;
    const ms = Date.parse(s.replace(' ', 'T') + (s.includes('Z') ? '' : 'Z'));
    return Number.isFinite(ms) ? ms : null;
  };
  const companyName = async (rowName: string | null, userId: number): Promise<string | null> =>
    rowName ?? ((await latestApplication(c.env, userId))?.company_name ?? null);

  const members: CohortMember[] = [];
  const seen = new Set<number>();

  let activeRows: CohortActiveRow[] = [];
  try {
    const res = await c.env.DB.prepare(
      `SELECT u.id AS user_id, u.spinout_lab_week AS week,
              u.spinout_lab_started_at AS started_at, usf.spinout_lab_cohort AS cohort,
              p.name, p.sector
       FROM users u
       LEFT JOIN user_spinout_flags usf ON usf.user_id = u.id
       LEFT JOIN projects p ON p.founder_id = u.founder_id AND p.deleted_at IS NULL
       WHERE u.spinout_lab_active = 1
       ORDER BY u.spinout_lab_started_at ASC, p.id ASC`,
    ).all<CohortActiveRow>();
    activeRows = res.results ?? [];
  } catch {
    return c.json([]);
  }
  for (const r of activeRows) {
    if (seen.has(r.user_id)) continue; // several projects: keep the first
    seen.add(r.user_id);
    const name = await companyName(r.name, r.user_id);
    if (!name) continue;
    const week = Math.max(1, Math.min(4, Number(r.week ?? 1) || 1));
    members.push({
      name,
      sector: r.sector ?? null,
      cohort: r.cohort ?? null,
      status: 'active',
      week,
      day: Math.min(SPRINT_DAYS, daysSince(r.started_at) + 1),
      started_at: r.started_at ?? null,
    });
    if (members.length >= 24) break;
  }

  // Recent graduates fill the final ("Incorporated") column.
  let gradRows: CohortGradRow[] = [];
  try {
    const res = await c.env.DB.prepare(
      `SELECT m.user_id, m.completed_at, u.spinout_lab_started_at AS started_at,
              usf.spinout_lab_cohort AS cohort, p.name, p.sector
       FROM spinout_lab_milestones m
       JOIN users u ON u.id = m.user_id
       LEFT JOIN user_spinout_flags usf ON usf.user_id = u.id
       LEFT JOIN projects p ON p.founder_id = u.founder_id AND p.deleted_at IS NULL
       WHERE m.milestone_key = 'incorporation_completed'
         AND datetime(m.completed_at) >= datetime('now', '-45 days')
       ORDER BY m.completed_at DESC, p.id ASC`,
    ).all<CohortGradRow>();
    gradRows = res.results ?? [];
  } catch {
    gradRows = [];
  }
  const gradSeen = new Set<number>();
  for (const r of gradRows) {
    if (gradSeen.has(r.user_id) || seen.has(r.user_id)) continue;
    gradSeen.add(r.user_id);
    const name = await companyName(r.name, r.user_id);
    if (!name) continue;
    const startMs = parseTs(r.started_at);
    const doneMs = parseTs(r.completed_at);
    const day =
      startMs !== null && doneMs !== null && doneMs >= startMs
        ? Math.max(1, Math.floor((doneMs - startMs) / 86_400_000) + 1)
        : null;
    members.push({
      name,
      sector: r.sector ?? null,
      cohort: r.cohort ?? null,
      status: 'graduated',
      week: 5,
      day,
      started_at: r.started_at ?? null,
    });
    if (gradSeen.size >= 8) break;
  }
  return c.json(members);
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
      `SELECT m.user_id, m.completed_at, u.spinout_lab_started_at AS started_at,
              p.total_funding, p.revenue, p.mrr, p.paying_customers,
              p.paid_pilot_status,
              (SELECT COUNT(*) FROM discovery_interviews di
                WHERE di.project_id = p.id) AS interview_count,
              (SELECT COUNT(*) FROM portfolio_positions pp
                WHERE pp.project_id = p.id) AS backed
       FROM spinout_lab_milestones m
       JOIN users u ON u.id = m.user_id
       LEFT JOIN projects p ON p.founder_id = u.founder_id AND p.deleted_at IS NULL
       WHERE m.milestone_key = 'incorporation_completed'
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
    let entitled = ['admin', 'partner', 'investor'].includes(user?.role);
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
let _lpAppSchemaReady = false;
async function ensureLpApplicationsSchema(env: Env): Promise<void> {
  if (_lpAppSchemaReady) return;
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
  _lpAppSchemaReady = true;
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
