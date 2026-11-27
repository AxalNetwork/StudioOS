/**
 * D4663 (#4663) — the Spin-Out Lab's enrollment transitions: switching a
 * founder's sprint on, advancing its week, closing it, and reading it back.
 *
 * WHAT MOVED HERE. These functions lived in `routes/spinout_lab.ts`, written
 * so a test could slice each one out of the route's source by brace counting.
 * That shaped the route around its test: wire-only reads had to stay out of
 * `getLabState`, and `services/labProgress.ts` imported the week advance back
 * from a route. They are a module now; tests import it, and the route only
 * parses the request and returns the outcome.
 *
 *   getLabState      the caller's sprint: on/off, week, days left, milestones.
 *   startLab         the guarded switch-on (D4658: the write refuses a
 *                    graduate inside its own UPDATE).
 *   recordMilestone  the pure week advance and week 4's close. The evidence,
 *                    the policy and the credit are `labProgress.ts`'s; this
 *                    only moves the week forward (D4658) from recorded rows.
 *   exitLab          the founder's own way out.
 *   beginLab         `POST /start`: the eligibility policy (D4657), the
 *                    cohort's own start instant, the switch-on, then the
 *                    Week 1 plan (D576).
 *   leaveLab         `POST /exit`.
 *
 * The statements are unchanged, byte for byte where a test pins them.
 */
import type { Env } from '../types';
import { getSQL } from '../db';
import { SPRINT_DAYS, VALID_MILESTONE_KEYS, weekForKey, weekMet, unlockedFeaturesThrough } from './spinoutLabCatalog';

/** What a Lab service answers a route with: the HTTP status and the JSON body, decided here. */
export type LabOutcome = {
  status: 200 | 400 | 403 | 409 | 423 | 503;
  body: Record<string, unknown>;
};

/** Days elapsed since `started_at` (UTC). Returns 0 when started_at is null. */
export function daysSince(startedAt: string | null | undefined, nowMs = Date.now()): number {
  if (!startedAt) return 0;
  const startMs = Date.parse(
    startedAt.replace(' ', 'T') + (startedAt.includes('Z') ? '' : 'Z'),
  );
  if (!Number.isFinite(startMs)) return 0;
  return Math.max(0, Math.floor((nowMs - startMs) / 86_400_000));
}

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
export type Sql = <T = unknown>(
  strings: TemplateStringsArray,
  ...values: SqlValue[]
) => Promise<T[]>;

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
  // RE-ENTRY GUARD, not an eligibility rule. `users.is_incorporated` is set in
  // exactly two places — completing the week-4 milestone (recordMilestone
  // below) and `exitLab` — so a 1 here means "has already been through the
  // Lab", never "arrived with a company". Founders who incorporated elsewhere
  // have is_incorporated = 0 and are welcome: the Lab is not restricted to
  // pre-incorporation founders, and this check has never made it so. It only
  // stops a graduate re-opening a sprint whose week is already 4 and whose
  // workspace `spinout_lab_active = 0` deliberately closed.
  const probe = await sql<IsIncorporatedRow>`
    SELECT is_incorporated FROM users WHERE id = ${userId}
  `;
  if (probe[0] && Number(probe[0].is_incorporated) === 1) {
    return { ok: false, status: 409, error: 'This account has already been through the Lab' };
  }
  // Idempotent: COALESCE preserves an existing started_at and a non-zero
  // week so re-calling start() doesn't reset progress. D4658: the write
  // itself refuses a graduate, so an exit that lands between the probe above
  // and this statement cannot be reopened by a start that read before it.
  const started: Array<{ id: number }> = await sql`
    UPDATE users
    SET spinout_lab_active = 1,
        spinout_lab_week = COALESCE(NULLIF(spinout_lab_week, 0), 1),
        spinout_lab_started_at = COALESCE(spinout_lab_started_at, datetime('now'))
    WHERE id = ${userId} AND COALESCE(is_incorporated, 0) = 0
    RETURNING id
  `;
  if (started.length === 0) {
    return { ok: false, status: 409, error: 'This account has already been through the Lab' };
  }
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
  // D4658: the week only moves forward, and only while the Lab is on. Two
  // requests that each computed a week from their own read cannot write the
  // lower one over the higher, and a sprint that closed meanwhile stays closed.
  if (newWeek !== Number(u.spinout_lab_week)) {
    await sql`UPDATE users SET spinout_lab_week = MAX(COALESCE(spinout_lab_week, 1), ${newWeek}) WHERE id = ${userId} AND spinout_lab_active = 1`;
  }
  if (newWeek === 4 && weekMet(4, completed)) {
    // Single statement so a partial failure can't half-incorporate the user.
    // SQLite/D1 statement execution is atomic; either both columns flip or
    // neither does. Mirrors the explicit /exit route's effect.
    await sql`
      UPDATE users SET spinout_lab_active = 0, is_incorporated = 1 WHERE id = ${userId} AND spinout_lab_active = 1
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

/** `POST /start` for `userId`: the eligibility policy decides, the write guards, the Week 1 plan follows. */
export async function beginLab(env: Env, userId: number): Promise<LabOutcome> {
  // D4657: starting follows the recorded enrollment, not the button. An
  // account never admitted, one under a moderation sanction, or one whose
  // cohort opens later is refused; a read that fails is a retryable 503,
  // never a start. A cohort member starts on their cycle's own instant.
  const { resolveLabEligibility, mayParticipate, refusal } = await import('./labEnrollment');
  const elig = await resolveLabEligibility(env, userId);
  if (!mayParticipate(elig)) return refusal(elig);
  if (elig.status === 'eligible' && elig.enrollment.cycle_start_at) {
    try {
      await env.DB.prepare(
        `UPDATE users SET spinout_lab_started_at = ? WHERE id = ? AND spinout_lab_started_at IS NULL`,
      ).bind(elig.enrollment.cycle_start_at, userId).run();
    } catch {
      return { status: 503, body: { error: 'Your Lab could not be started just now. Try again in a moment.', code: 'lab_start_unavailable', retryable: true } };
    }
  }
  const sql = getSQL(env);
  let r: StartResult;
  try { r = await startLab(sql, userId); } finally { await sql.end(); }
  if (!r.ok) return { status: r.status, body: { error: r.error } };
  // D576 — Week 1 begins with a plan: the one written when the member
  // applied, or one computed now from their latest application.
  try {
    const { ensureWeek1Plan } = await import('./week1PlanStore');
    await ensureWeek1Plan(env, userId, `user:${userId}`);
  } catch (e) {
    console.warn('[spinout-lab/start] week 1 plan not written', (e as Error)?.message);
  }
  return { status: 200, body: r.state };
}

/** `POST /exit` for `userId`. */
export async function leaveLab(env: Env, userId: number): Promise<LabState> {
  const sql = getSQL(env);
  try { return await exitLab(sql, userId); } finally { await sql.end(); }
}
