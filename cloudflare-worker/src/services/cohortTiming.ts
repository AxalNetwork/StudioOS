/**
 * Cohort Timing & Gating — automated monthly cohort calendar for Spin-Out Lab.
 *
 * Cohorts start the 1st of every month at 00:00 America/New_York (Delaware
 * time, DST-correct — never a fixed UTC offset) and run 4 weeks of exactly
 * 7 wall-clock days. All decisions are computed server-side on the Worker
 * cron (`runCohortTimingTick`), never by client timers:
 *   • week_unlock  — at each window's unlock_at
 *   • week_deadline — snapshot deliverables + pass/fail at each deadline_at
 *   • grace expiry — finalize 'grace' rows once grace_until passes
 *   • reminders    — 48h/24h/3h before the current deadline (ledger-deduped)
 *
 * Idempotency: every job run is claimed via INSERT OR IGNORE on
 * scheduled_jobs_audit.idempotency_key, so re-runs (missed minutes, retries,
 * concurrent isolates) are no-ops.
 *
 * Pure calendar + decision functions are exported at the top so the test
 * suite (test/cohort_timing.test.ts) can exercise DST math and pass/fail
 * outcomes without a D1 binding.
 *
 * Per-user cohort state lives in sidecar tables (users is at D1's
 * 100-column ALTER limit — see migration 156).
 */
import type { Env } from '../types';
import { MILESTONES } from './spinoutLabCatalog';

export const COHORT_TZ = 'America/New_York';
export const REMINDER_THRESHOLDS_HOURS = [48, 24, 3] as const;

// ---------------------------------------------------------------------------
// Pure calendar math (DST-correct via Intl, no tz library)
// ---------------------------------------------------------------------------

/** Offset (ms) of `tz` from UTC at the instant `utcMs`. EST → -18000000. */
export function tzOffsetMs(utcMs: number, tz: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(new Date(utcMs))) p[part.type] = part.value;
  const asUtc = Date.UTC(
    Number(p.year), Number(p.month) - 1, Number(p.day),
    Number(p.hour), Number(p.minute), Number(p.second),
  );
  return asUtc - utcMs;
}

/**
 * UTC instant (ms) of the given wall-clock time in `tz`. Two-pass
 * refinement resolves correctly across DST transitions. Day may overflow
 * the month (Date.UTC semantics) — used for "day 29" cycle ends.
 */
export function wallClockToUtcMs(
  year: number, month: number, day: number,
  hour = 0, minute = 0, second = 0, tz: string = COHORT_TZ,
): number {
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = wallAsUtc;
  for (let i = 0; i < 2; i++) guess = wallAsUtc - tzOffsetMs(guess, tz);
  return guess;
}

export type WeekWindowSpec = { week: number; unlockMs: number; deadlineMs: number };

/**
 * The four 7-day week windows for the cohort starting the 1st of
 * `year`/`month` at midnight Delaware time. Week N unlocks at day
 * 1+(N-1)·7 00:00 ET and its deadline is day 1+N·7 00:00 ET — true
 * wall-clock boundaries, so a DST week is 167 or 169 real hours.
 */
export function cycleWeekWindows(year: number, month: number): WeekWindowSpec[] {
  const out: WeekWindowSpec[] = [];
  for (let w = 1; w <= 4; w++) {
    out.push({
      week: w,
      unlockMs: wallClockToUtcMs(year, month, 1 + (w - 1) * 7),
      deadlineMs: wallClockToUtcMs(year, month, 1 + w * 7),
    });
  }
  return out;
}

/** Delaware-local {year, month} for a UTC instant — picks which cycle "now" belongs to. */
export function delawareYearMonth(utcMs: number, tz: string = COHORT_TZ): { year: number; month: number } {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit' });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(new Date(utcMs))) p[part.type] = part.value;
  return { year: Number(p.year), month: Number(p.month) };
}

export type WeekOutcome = {
  passed: boolean;
  missing: string[];
  requiredCount: number;
  doneCount: number;
  snapshot: Array<{ key: string; completed: boolean; completed_at_ms: number | null }>;
};

/**
 * Pure pass/fail decision for `week` given the founder's completed
 * milestones. A deliverable counts iff completed_at_ms <= cutoffMs
 * (INCLUSIVE — completing at the exact deadline second passes).
 * requiredAll must all be present; requiredAny needs at least one.
 */
export function evaluateWeekOutcome(
  week: number,
  completed: Array<{ key: string; completed_at_ms: number }>,
  cutoffMs: number,
): WeekOutcome {
  const def = MILESTONES.find((w) => w.week === week);
  if (!def) return { passed: false, missing: [], requiredCount: 0, doneCount: 0, snapshot: [] };
  const byKey = new Map<string, number>();
  for (const c of completed) {
    if (c.completed_at_ms <= cutoffMs && !byKey.has(c.key)) byKey.set(c.key, c.completed_at_ms);
  }
  const snapshot: WeekOutcome['snapshot'] = [];
  const missing: string[] = [];
  let doneCount = 0;
  for (const k of def.requiredAll) {
    const at = byKey.get(k);
    const ok = at !== undefined;
    snapshot.push({ key: k, completed: ok, completed_at_ms: ok ? at! : null });
    if (ok) doneCount += 1; else missing.push(k);
  }
  let requiredCount = def.requiredAll.length;
  const anyKeys = def.requiredAny ?? [];
  if (anyKeys.length > 0) {
    requiredCount += 1;
    const met = anyKeys.some((k) => byKey.has(k));
    for (const k of anyKeys) {
      const at = byKey.get(k);
      snapshot.push({ key: k, completed: at !== undefined, completed_at_ms: at ?? null });
    }
    if (met) doneCount += 1;
    else missing.push(`any_of:${anyKeys.join('|')}`);
  }
  return { passed: missing.length === 0, missing, requiredCount, doneCount, snapshot };
}

/**
 * A week-N decision must NOT be made while an EARLIER week in the same
 * cycle is unresolved (failed → frozen pending admin review, or in an
 * active grace window). Otherwise the scheduler would cascade false
 * failures onto a founder who is already paused — and an admin force-pass
 * of the original week could never unfreeze them. Once the prior week is
 * resolved to passed (admin override or grace finalize), later weeks
 * evaluate normally again.
 */
export function blockedByPriorWeek(
  priorStatuses: Array<{ week: number; status: string }>,
  week: number,
): boolean {
  return priorStatuses.some((p) => p.week < week && (p.status === 'failed' || p.status === 'grace'));
}

/** Milestone-row timestamp → epoch ms (D1 stores 'YYYY-MM-DD HH:MM:SS' UTC). */
export function sqliteUtcToMs(ts: string | null | undefined): number | null {
  if (!ts) return null;
  const ms = Date.parse(ts.replace(' ', 'T') + (ts.includes('Z') || ts.includes('+') ? '' : 'Z'));
  return Number.isFinite(ms) ? ms : null;
}

const iso = (ms: number): string => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);

// ---------------------------------------------------------------------------
// Schema ensure (mirrors migration 156 for dev/preview D1)
// ---------------------------------------------------------------------------

let schemaReady = false;
export async function ensureCohortTimingSchema(env: Env): Promise<void> {
  if (schemaReady) return;
  const ddl = [
    `CREATE TABLE IF NOT EXISTS cohort_cycles (id INTEGER PRIMARY KEY AUTOINCREMENT, year INTEGER NOT NULL, month INTEGER NOT NULL, start_at TEXT NOT NULL, end_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'scheduled', created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(year, month))`,
    `CREATE TABLE IF NOT EXISTS week_windows (id INTEGER PRIMARY KEY AUTOINCREMENT, cohort_cycle_id INTEGER NOT NULL, week_number INTEGER NOT NULL, unlock_at TEXT NOT NULL, deadline_at TEXT NOT NULL, UNIQUE(cohort_cycle_id, week_number))`,
    `CREATE TABLE IF NOT EXISTS company_week_status (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, cohort_cycle_id INTEGER NOT NULL, week_number INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', deliverables_done INTEGER NOT NULL DEFAULT 0, deliverables_required INTEGER NOT NULL DEFAULT 0, grace_until TEXT, grace_reason TEXT, decided_at TEXT, decided_by TEXT, decision_reason TEXT, UNIQUE(user_id, cohort_cycle_id, week_number))`,
    `CREATE TABLE IF NOT EXISTS deliverable_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, cohort_cycle_id INTEGER NOT NULL, week_number INTEGER NOT NULL, deliverable_key TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0, completed_at TEXT, snapshotted_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS stage_transition_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, cohort_cycle_id INTEGER, week_number INTEGER, from_status TEXT, to_status TEXT NOT NULL, reason TEXT, triggered_by TEXT NOT NULL DEFAULT 'scheduler', admin_user_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS scheduled_jobs_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, job_type TEXT NOT NULL, cohort_cycle_id INTEGER, week_number INTEGER, idempotency_key TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'completed', notes TEXT, ran_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS cohort_reminder_ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, week_window_id INTEGER NOT NULL, threshold_hours INTEGER NOT NULL, sent_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(user_id, week_window_id, threshold_hours))`,
    `CREATE TABLE IF NOT EXISTS impersonation_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, admin_user_id INTEGER NOT NULL, target_user_id INTEGER NOT NULL, context TEXT, started_at TEXT NOT NULL DEFAULT (datetime('now')), ended_at TEXT)`,
  ];
  try {
    for (const s of ddl) await env.DB.prepare(s).run();
    schemaReady = true;
  } catch (e) {
    console.error('[cohort] schema ensure failed', e);
  }
}

// ---------------------------------------------------------------------------
// Cycle materialization
// ---------------------------------------------------------------------------

type CycleRow = { id: number; year: number; month: number; start_at: string; end_at: string; status: string };
type WindowRow = { id: number; cohort_cycle_id: number; week_number: number; unlock_at: string; deadline_at: string };

export async function materializeCycle(env: Env, year: number, month: number): Promise<void> {
  const windows = cycleWeekWindows(year, month);
  const startAt = iso(windows[0].unlockMs);
  const endAt = iso(windows[3].deadlineMs);
  await env.DB.prepare(
    `INSERT OR IGNORE INTO cohort_cycles (year, month, start_at, end_at) VALUES (?, ?, ?, ?)`,
  ).bind(year, month, startAt, endAt).run();
  const row = await env.DB.prepare(
    `SELECT id FROM cohort_cycles WHERE year = ? AND month = ?`,
  ).bind(year, month).first<{ id: number }>();
  if (!row) return;
  for (const w of windows) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO week_windows (cohort_cycle_id, week_number, unlock_at, deadline_at) VALUES (?, ?, ?, ?)`,
    ).bind(row.id, w.week, iso(w.unlockMs), iso(w.deadlineMs)).run();
  }
}

/** Ensure the cycle containing `now` (Delaware-local month) + the next month exist. */
export async function materializeCurrentCycles(env: Env, nowMs: number): Promise<void> {
  const cur = delawareYearMonth(nowMs);
  await materializeCycle(env, cur.year, cur.month);
  const nextMonth = cur.month === 12 ? 1 : cur.month + 1;
  const nextYear = cur.month === 12 ? cur.year + 1 : cur.year;
  await materializeCycle(env, nextYear, nextMonth);
}

// ---------------------------------------------------------------------------
// Participants — active lab founders whose sprint started inside the cycle.
// Legacy founders whose started_at predates any materialized cycle are NOT
// calendar-gated (back-compat: milestone-only flow keeps working).
// ---------------------------------------------------------------------------

type ParticipantRow = { id: number; spinout_lab_week: number | null; email: string; name: string | null };

async function cycleParticipants(env: Env, cycle: CycleRow): Promise<ParticipantRow[]> {
  const r = await env.DB.prepare(
    `SELECT id, spinout_lab_week, email, name FROM users
      WHERE spinout_lab_active = 1
        AND spinout_lab_started_at IS NOT NULL
        AND spinout_lab_started_at >= ? AND spinout_lab_started_at < ?`,
  ).bind(cycle.start_at, cycle.end_at).all<ParticipantRow>();
  return r.results || [];
}

async function completedMilestones(env: Env, userId: number): Promise<Array<{ key: string; completed_at_ms: number }>> {
  const r = await env.DB.prepare(
    `SELECT milestone_key, completed_at FROM spinout_lab_milestones WHERE user_id = ?`,
  ).bind(userId).all<{ milestone_key: string; completed_at: string }>();
  const out: Array<{ key: string; completed_at_ms: number }> = [];
  for (const row of r.results || []) {
    const ms = sqliteUtcToMs(row.completed_at);
    if (ms !== null) out.push({ key: row.milestone_key, completed_at_ms: ms });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Idempotent job claim
// ---------------------------------------------------------------------------

export async function claimJobRun(
  env: Env, jobType: string, cycleId: number | null, week: number | null, key: string, notes?: string,
): Promise<boolean> {
  const r = await env.DB.prepare(
    `INSERT OR IGNORE INTO scheduled_jobs_audit (job_type, cohort_cycle_id, week_number, idempotency_key, notes) VALUES (?, ?, ?, ?, ?)`,
  ).bind(jobType, cycleId, week, key, notes ?? null).run();
  return (r.meta?.changes ?? 0) > 0;
}

/**
 * Crash-safe two-phase claim. Rows are inserted with status='started' and
 * flipped to 'completed' by completeJobRun once every unit of work is
 * done. A run that dies mid-job leaves status='started', which the next
 * tick RESUMES (the per-user decision path is itself idempotent — decided
 * rows are never re-decided). Concurrent isolates are already excluded by
 * the cron KV lease in index.ts.
 */
export async function claimOrResumeJob(
  env: Env, jobType: string, cycleId: number | null, week: number | null, key: string,
): Promise<'new' | 'resume' | 'done'> {
  const ins = await env.DB.prepare(
    `INSERT OR IGNORE INTO scheduled_jobs_audit (job_type, cohort_cycle_id, week_number, idempotency_key, status) VALUES (?, ?, ?, ?, 'started')`,
  ).bind(jobType, cycleId, week, key).run();
  if ((ins.meta?.changes ?? 0) > 0) return 'new';
  const row = await env.DB.prepare(
    `SELECT status FROM scheduled_jobs_audit WHERE idempotency_key = ?`,
  ).bind(key).first<{ status: string }>();
  return row?.status === 'started' ? 'resume' : 'done';
}

export async function completeJobRun(env: Env, key: string, notes?: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE scheduled_jobs_audit SET status = 'completed', notes = COALESCE(?, notes), ran_at = datetime('now') WHERE idempotency_key = ?`,
  ).bind(notes ?? null, key).run();
}

// ---------------------------------------------------------------------------
// Decision application — shared by the scheduler and admin overrides.
// ---------------------------------------------------------------------------

export type DecisionInput = {
  userId: number;
  cycleId: number;
  week: number;
  toStatus: 'passed' | 'failed' | 'grace';
  fromStatus?: string | null;
  doneCount?: number;
  requiredCount?: number;
  reason?: string | null;
  triggeredBy: 'scheduler' | 'admin';
  adminUserId?: number | null;
  graceUntil?: string | null;
  graceReason?: string | null;
};

/** Upsert company_week_status + append stage_transition_log. */
export async function applyWeekDecision(env: Env, d: DecisionInput): Promise<void> {
  const decidedBy = d.triggeredBy === 'admin' ? `admin:${d.adminUserId ?? 0}` : 'system';
  await env.DB.prepare(
    `INSERT INTO company_week_status
       (user_id, cohort_cycle_id, week_number, status, deliverables_done, deliverables_required,
        grace_until, grace_reason, decided_at, decided_by, decision_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?)
     ON CONFLICT(user_id, cohort_cycle_id, week_number) DO UPDATE SET
       status = excluded.status,
       deliverables_done = excluded.deliverables_done,
       deliverables_required = excluded.deliverables_required,
       grace_until = COALESCE(excluded.grace_until, company_week_status.grace_until),
       grace_reason = COALESCE(excluded.grace_reason, company_week_status.grace_reason),
       decided_at = excluded.decided_at,
       decided_by = excluded.decided_by,
       decision_reason = excluded.decision_reason`,
  ).bind(
    d.userId, d.cycleId, d.week, d.toStatus,
    d.doneCount ?? 0, d.requiredCount ?? 0,
    d.graceUntil ?? null, d.graceReason ?? null,
    decidedBy, d.reason ?? null,
  ).run();
  await env.DB.prepare(
    `INSERT INTO stage_transition_log (user_id, cohort_cycle_id, week_number, from_status, to_status, reason, triggered_by, admin_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    d.userId, d.cycleId, d.week, d.fromStatus ?? null, d.toStatus,
    d.reason ?? null, d.triggeredBy, d.adminUserId ?? null,
  ).run();
}

async function snapshotDeliverables(env: Env, userId: number, cycleId: number, week: number, outcome: WeekOutcome): Promise<void> {
  // Re-snapshot on re-decision is intentional (grace finalize, override) —
  // rows are append-only history keyed by snapshotted_at.
  for (const s of outcome.snapshot) {
    await env.DB.prepare(
      `INSERT INTO deliverable_snapshots (user_id, cohort_cycle_id, week_number, deliverable_key, completed, completed_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(userId, cycleId, week, s.key, s.completed ? 1 : 0, s.completed_at_ms ? iso(s.completed_at_ms) : null).run();
  }
}

async function notifyFounder(env: Env, userId: number, type: string, title: string, body: string, instant = false): Promise<void> {
  try {
    const { notify } = await import('./notify');
    await notify(env, {
      userId, type, title, body,
      link: '/spinout-lab',
      channels: ['in_app', 'email'],
      // Uncategorised notifications bypass digest/quiet-hours buffering —
      // pass/fail/grace decisions must land instantly per spec; the softer
      // 48h/24h/3h reminders route through the normal 'deals' pipeline.
      ...(instant ? {} : { category: 'deals' as const }),
    });
  } catch (e) { console.warn('[cohort] founder notify failed', e); }
}

async function broadcastCohortEvent(env: Env, userId: number, payload: Record<string, unknown>): Promise<void> {
  // Personal frame via the pipeline room 'overview' channel — the DO
  // routes {type:'notification', user_id} frames to the recipient only.
  try {
    const { notifyPipelineRoom } = await import('./realtime');
    await notifyPipelineRoom(env, 'overview', {
      type: 'notification',
      user_id: userId,
      notification: {
        id: null,
        type: 'cohort_status',
        title: 'Spin-Out Lab status updated',
        body: null,
        link: '/spinout-lab',
        read_at: null,
        created_at: new Date().toISOString(),
        payload,
      },
    });
  } catch (e) { console.warn('[cohort] broadcast failed', e); }
}

async function notifyAdmins(env: Env, type: string, title: string, body: string): Promise<void> {
  try {
    const admins = await env.DB.prepare(`SELECT id FROM users WHERE role = 'admin' AND is_active = 1`).all<{ id: number }>();
    const { notify } = await import('./notify');
    for (const a of admins.results || []) {
      await notify(env, { userId: a.id, type, title, body, link: '/admin/spinout-lab', channels: ['in_app', 'email'], category: 'deals' });
    }
  } catch (e) { console.warn('[cohort] admin notify failed', e); }
}

// ---------------------------------------------------------------------------
// Deadline evaluation for one (user, cycle, week)
// ---------------------------------------------------------------------------

async function decideUserWeek(
  env: Env, user: ParticipantRow, cycle: CycleRow, week: number, cutoffMs: number,
): Promise<'passed' | 'failed' | 'grace' | 'skipped'> {
  // Freeze halts the pipeline: never evaluate week N while an earlier
  // week is failed or in grace (see blockedByPriorWeek).
  const allRows = await env.DB.prepare(
    `SELECT week_number, status, grace_until FROM company_week_status WHERE user_id = ? AND cohort_cycle_id = ?`,
  ).bind(user.id, cycle.id).all<{ week_number: number; status: string; grace_until: string | null }>();
  const rows = allRows.results || [];
  if (blockedByPriorWeek(rows.map((r) => ({ week: r.week_number, status: r.status })), week)) return 'skipped';
  const existing = rows.find((r) => r.week_number === week) ?? null;
  // Already finally decided (incl. admin override) — never re-decide.
  if (existing && (existing.status === 'passed' || existing.status === 'failed')) return 'skipped';

  // Active grace extension: defer the decision until grace_until.
  const graceMs = sqliteUtcToMs(existing?.grace_until);
  const nowMs = Date.now();
  if (graceMs !== null && graceMs > nowMs) {
    if (existing?.status !== 'grace') {
      await applyWeekDecision(env, {
        userId: user.id, cycleId: cycle.id, week, toStatus: 'grace',
        fromStatus: existing?.status ?? 'pending',
        reason: 'grace period active at deadline', triggeredBy: 'scheduler',
      });
    }
    return 'grace';
  }
  const effectiveCutoff = graceMs !== null ? Math.max(cutoffMs, graceMs) : cutoffMs;

  const completed = await completedMilestones(env, user.id);
  const outcome = evaluateWeekOutcome(week, completed, effectiveCutoff);
  await snapshotDeliverables(env, user.id, cycle.id, week, outcome);
  await applyWeekDecision(env, {
    userId: user.id, cycleId: cycle.id, week,
    toStatus: outcome.passed ? 'passed' : 'failed',
    fromStatus: existing?.status ?? 'pending',
    doneCount: outcome.doneCount, requiredCount: outcome.requiredCount,
    reason: outcome.passed ? 'all deliverables complete at deadline' : `missing: ${outcome.missing.join(', ')}`,
    triggeredBy: 'scheduler',
  });
  if (outcome.passed) {
    // Advance the founder into the next week (cap 4) if the milestone
    // auto-advance hasn't already done it.
    if (week < 4 && Number(user.spinout_lab_week ?? 1) <= week) {
      await env.DB.prepare(`UPDATE users SET spinout_lab_week = ? WHERE id = ?`).bind(week + 1, user.id).run();
    }
    await notifyFounder(env, user.id, 'cohort_week_passed',
      `Week ${week} complete — Week ${Math.min(4, week + 1)} is open`,
      `You completed all Week ${week} deliverables on time. ${week < 4 ? `Week ${week + 1} of your Spin-Out Lab sprint is now unlocked.` : 'You finished the final week of the sprint.'}`, true);
  } else {
    await notifyFounder(env, user.id, 'cohort_week_failed',
      `Week ${week} deadline passed — deliverables incomplete`,
      `The Week ${week} deadline has passed with ${outcome.requiredCount - outcome.doneCount} required deliverable(s) incomplete. Your workspace is paused at Week ${week} pending admin review — an admin may grant a grace extension or advance you manually.`, true);
  }
  await broadcastCohortEvent(env, user.id, { week, status: outcome.passed ? 'passed' : 'failed', cycle_id: cycle.id });
  return outcome.passed ? 'passed' : 'failed';
}

// ---------------------------------------------------------------------------
// Cron tick — called every minute from index.ts scheduled()
// ---------------------------------------------------------------------------

export async function runCohortTimingTick(env: Env, now: Date): Promise<void> {
  await ensureCohortTimingSchema(env);
  const nowMs = now.getTime();
  const nowIso = iso(nowMs);

  // 1. Materialize current + next cycles (cheap INSERT OR IGNORE; every 15 min).
  if (now.getUTCMinutes() % 15 === 1) {
    await materializeCurrentCycles(env, nowMs);
  } else {
    // Cold DB safety: if no cycle exists at all, materialize immediately.
    const any = await env.DB.prepare(`SELECT id FROM cohort_cycles LIMIT 1`).first<{ id: number }>();
    if (!any) await materializeCurrentCycles(env, nowMs);
  }

  // 2. Week unlock jobs — every due window not yet claimed.
  const dueUnlocks = await env.DB.prepare(
    `SELECT w.*, c.year, c.month, c.start_at, c.end_at, c.status AS cycle_status
       FROM week_windows w JOIN cohort_cycles c ON c.id = w.cohort_cycle_id
      WHERE w.unlock_at <= ? AND c.status != 'completed'
        AND NOT EXISTS (SELECT 1 FROM scheduled_jobs_audit a WHERE a.idempotency_key = 'week_unlock:' || w.cohort_cycle_id || ':' || w.week_number AND a.status = 'completed')`,
  ).bind(nowIso).all<WindowRow & CycleRow & { cycle_status: string }>();
  for (const w of dueUnlocks.results || []) {
    const unlockKey = `week_unlock:${w.cohort_cycle_id}:${w.week_number}`;
    const claim = await claimOrResumeJob(env, 'week_unlock', w.cohort_cycle_id, w.week_number, unlockKey);
    if (claim === 'done') continue;
    if (w.week_number === 1) {
      await env.DB.prepare(`UPDATE cohort_cycles SET status = 'active' WHERE id = ? AND status = 'scheduled'`).bind(w.cohort_cycle_id).run();
    }
    console.info(`[cron] cohort week_unlock cycle=${w.cohort_cycle_id} week=${w.week_number}`);
    // Notify participants who passed the prior week (or all, for week 1).
    try {
      const cycle: CycleRow = { id: w.cohort_cycle_id, year: w.year, month: w.month, start_at: w.start_at, end_at: w.end_at, status: w.cycle_status };
      const parts = await cycleParticipants(env, cycle);
      for (const p of parts) {
        await broadcastCohortEvent(env, p.id, { week: w.week_number, status: 'unlocked', cycle_id: w.cohort_cycle_id });
      }
    } catch (e) { console.warn('[cohort] unlock fanout failed', e); }
    await completeJobRun(env, unlockKey);
  }

  // 3. Deadline evaluation jobs.
  const dueDeadlines = await env.DB.prepare(
    `SELECT w.*, c.year, c.month, c.start_at, c.end_at, c.status AS cycle_status
       FROM week_windows w JOIN cohort_cycles c ON c.id = w.cohort_cycle_id
      WHERE w.deadline_at <= ? AND c.status != 'completed'
        AND NOT EXISTS (SELECT 1 FROM scheduled_jobs_audit a WHERE a.idempotency_key = 'week_deadline:' || w.cohort_cycle_id || ':' || w.week_number AND a.status = 'completed')`,
  ).bind(nowIso).all<WindowRow & CycleRow & { cycle_status: string }>();
  for (const w of dueDeadlines.results || []) {
    const deadlineKey = `week_deadline:${w.cohort_cycle_id}:${w.week_number}`;
    const claim = await claimOrResumeJob(env, 'week_deadline', w.cohort_cycle_id, w.week_number, deadlineKey);
    if (claim === 'done') continue;
    const cycle: CycleRow = { id: w.cohort_cycle_id, year: w.year, month: w.month, start_at: w.start_at, end_at: w.end_at, status: w.cycle_status };
    const cutoffMs = sqliteUtcToMs(w.deadline_at) ?? nowMs;
    const parts = await cycleParticipants(env, cycle);
    let passed = 0, failed = 0, grace = 0;
    for (const p of parts) {
      try {
        const r = await decideUserWeek(env, p, cycle, w.week_number, cutoffMs);
        if (r === 'passed') passed++;
        else if (r === 'failed') failed++;
        else if (r === 'grace') grace++;
      } catch (e) { console.error(`[cohort] decide failed user=${p.id} week=${w.week_number}`, e); }
    }
    console.info(`[cron] cohort week_deadline cycle=${cycle.id} week=${w.week_number} passed=${passed} failed=${failed} grace=${grace}`);
    if (parts.length > 0) {
      await notifyAdmins(env, 'cohort_deadline_summary',
        `Week ${w.week_number} deadline processed — ${cycle.year}-${String(cycle.month).padStart(2, '0')} cohort`,
        `Deadline evaluation complete: ${passed} passed, ${failed} failed, ${grace} in grace (of ${parts.length} participants). ${failed > 0 ? 'Review the failed companies in the Spin-Out Lab admin review queue.' : ''}`);
    }
    if (w.week_number === 4) {
      await env.DB.prepare(`UPDATE cohort_cycles SET status = 'completed' WHERE id = ?`).bind(cycle.id).run();
    }
    await completeJobRun(env, deadlineKey, `passed=${passed} failed=${failed} grace=${grace}`);
  }

  // 4. Grace expiry — finalize 'grace' rows whose extension has lapsed.
  const lapsed = await env.DB.prepare(
    `SELECT s.user_id, s.cohort_cycle_id, s.week_number, s.grace_until,
            c.year, c.month, c.start_at, c.end_at, c.status AS cycle_status
       FROM company_week_status s JOIN cohort_cycles c ON c.id = s.cohort_cycle_id
      WHERE s.status = 'grace' AND s.grace_until IS NOT NULL AND s.grace_until <= ?`,
  ).bind(nowIso).all<{ user_id: number; cohort_cycle_id: number; week_number: number; grace_until: string; year: number; month: number; start_at: string; end_at: string; cycle_status: string }>();
  for (const s of lapsed.results || []) {
    const key = `grace_final:${s.cohort_cycle_id}:${s.week_number}:${s.user_id}:${s.grace_until}`;
    const claim = await claimOrResumeJob(env, 'grace_finalize', s.cohort_cycle_id, s.week_number, key);
    if (claim === 'done') continue;
    const u = await env.DB.prepare(`SELECT id, spinout_lab_week, email, name FROM users WHERE id = ?`).bind(s.user_id).first<ParticipantRow>();
    if (!u) continue;
    const cycle: CycleRow = { id: s.cohort_cycle_id, year: s.year, month: s.month, start_at: s.start_at, end_at: s.end_at, status: s.cycle_status };
    // Force re-decision: flip status back to pending so decideUserWeek runs.
    await env.DB.prepare(
      `UPDATE company_week_status SET status = 'pending' WHERE user_id = ? AND cohort_cycle_id = ? AND week_number = ? AND status = 'grace'`,
    ).bind(s.user_id, s.cohort_cycle_id, s.week_number).run();
    try {
      await decideUserWeek(env, u, cycle, s.week_number, sqliteUtcToMs(s.grace_until) ?? nowMs);
      await completeJobRun(env, key);
    } catch (e) { console.error('[cohort] grace finalize failed', e); }
  }

  // 5. Deadline reminders — 48h/24h/3h, only to founders with incomplete weeks.
  if (now.getUTCMinutes() % 5 === 0) {
    await sendDeadlineReminders(env, nowMs);
  }
}

async function sendDeadlineReminders(env: Env, nowMs: number): Promise<void> {
  const nowIso2 = iso(nowMs);
  const horizon = iso(nowMs + 48 * 3600_000);
  const windows = await env.DB.prepare(
    `SELECT w.*, c.year, c.month, c.start_at, c.end_at, c.status AS cycle_status
       FROM week_windows w JOIN cohort_cycles c ON c.id = w.cohort_cycle_id
      WHERE w.deadline_at > ? AND w.deadline_at <= ? AND w.unlock_at <= ? AND c.status != 'completed'`,
  ).bind(nowIso2, horizon, nowIso2).all<WindowRow & CycleRow & { cycle_status: string }>();
  for (const w of windows.results || []) {
    const deadlineMs = sqliteUtcToMs(w.deadline_at);
    if (deadlineMs === null) continue;
    const hoursLeft = (deadlineMs - nowMs) / 3600_000;
    // Every threshold at or above the time remaining is "satisfied". All
    // satisfied thresholds get ledger rows (so a founder reminded at 48h
    // is reminded AGAIN at 24h and 3h — each threshold claims its own
    // row), but only ONE message is sent per tick: the most urgent one.
    const satisfied = REMINDER_THRESHOLDS_HOURS.filter((t) => hoursLeft <= t);
    if (satisfied.length === 0) continue;
    const mostUrgent = Math.min(...satisfied);
    const cycle: CycleRow = { id: w.cohort_cycle_id, year: w.year, month: w.month, start_at: w.start_at, end_at: w.end_at, status: w.cycle_status };
    const parts = await cycleParticipants(env, cycle);
    for (const p of parts) {
      try {
        // Skip founders who already completed the week.
        const completed = await completedMilestones(env, p.id);
        const outcome = evaluateWeekOutcome(w.week_number, completed, deadlineMs);
        if (outcome.passed) continue;
        // Claim a ledger row for EVERY satisfied threshold (a founder who
        // joins late still burns the 48h row at hour 23, so each of the
        // three reminders fires at most once) — send one message if any
        // claim was new, labeled with the most urgent threshold.
        let anyNew = false;
        for (const t of satisfied) {
          const claim = await env.DB.prepare(
            `INSERT OR IGNORE INTO cohort_reminder_ledger (user_id, week_window_id, threshold_hours) VALUES (?, ?, ?)`,
          ).bind(p.id, w.id, t).run();
          if ((claim.meta?.changes ?? 0) > 0) anyNew = true;
        }
        if (!anyNew) continue;
        const remaining = outcome.requiredCount - outcome.doneCount;
        const hLabel = mostUrgent === 48 ? '48 hours' : mostUrgent === 24 ? '24 hours' : '3 hours';
        await notifyFounder(env, p.id, 'cohort_deadline_reminder',
          `Week ${w.week_number} deadline in under ${hLabel}`,
          `Your Spin-Out Lab Week ${w.week_number} deadline is approaching (midnight Delaware time). ${remaining} required deliverable(s) still incomplete — finish them before the deadline to advance.`);
      } catch (e) { console.warn('[cohort] reminder failed', e); }
    }
  }
}

// ---------------------------------------------------------------------------
// Gate — server-side week accessibility for a founder. Used by the
// /spinout-lab wire handlers and admin views.
// ---------------------------------------------------------------------------

export type CohortGate = {
  in_cohort: boolean;
  cycle_id: number | null;
  cycle_label: string | null;
  /** Highest week the founder may access right now (calendar ∧ pass/fail). */
  max_week: number;
  /** True when a failed week freezes the founder in place. */
  frozen: boolean;
  frozen_week: number | null;
  current_week: number;
  current_deadline_at: string | null;
  grace_until: string | null;
  weeks: Array<{
    week: number;
    unlock_at: string;
    deadline_at: string;
    unlocked: boolean;
    status: string; // pending | passed | failed | grace
  }>;
  server_time: string;
};

export async function getCohortGate(env: Env, userId: number, nowMs = Date.now()): Promise<CohortGate | null> {
  await ensureCohortTimingSchema(env);
  const u = await env.DB.prepare(
    `SELECT spinout_lab_active, spinout_lab_started_at FROM users WHERE id = ?`,
  ).bind(userId).first<{ spinout_lab_active: number | null; spinout_lab_started_at: string | null }>();
  if (!u || Number(u.spinout_lab_active) !== 1 || !u.spinout_lab_started_at) return null;
  const cycle = await env.DB.prepare(
    `SELECT * FROM cohort_cycles WHERE start_at <= ? AND end_at > ? ORDER BY id DESC LIMIT 1`,
  ).bind(u.spinout_lab_started_at, u.spinout_lab_started_at).first<CycleRow>();
  if (!cycle) return null; // legacy founder — not calendar-gated
  const windows = await env.DB.prepare(
    `SELECT * FROM week_windows WHERE cohort_cycle_id = ? ORDER BY week_number ASC`,
  ).bind(cycle.id).all<WindowRow>();
  const statusRows = await env.DB.prepare(
    `SELECT week_number, status, grace_until FROM company_week_status WHERE user_id = ? AND cohort_cycle_id = ?`,
  ).bind(userId, cycle.id).all<{ week_number: number; status: string; grace_until: string | null }>();
  const statusByWeek = new Map<number, { status: string; grace_until: string | null }>();
  for (const s of statusRows.results || []) statusByWeek.set(s.week_number, s);

  let frozen = false;
  let frozenWeek: number | null = null;
  let currentWeek = 1;
  let currentDeadline: string | null = null;
  let graceUntil: string | null = null;
  const weeks: CohortGate['weeks'] = [];
  for (const w of windows.results || []) {
    const unlockMs = sqliteUtcToMs(w.unlock_at) ?? Infinity;
    const st = statusByWeek.get(w.week_number);
    const status = st?.status ?? 'pending';
    const unlocked = unlockMs <= nowMs;
    if (unlocked) {
      currentWeek = w.week_number;
      currentDeadline = w.deadline_at;
    }
    if (!frozen && (status === 'failed' || status === 'grace')) {
      frozen = status === 'failed';
      if (status === 'failed') frozenWeek = w.week_number;
      if (status === 'grace') graceUntil = st?.grace_until ?? null;
    }
    weeks.push({ week: w.week_number, unlock_at: w.unlock_at, deadline_at: w.deadline_at, unlocked, status });
  }
  // Frozen founders stay capped at the failed week; a grace week also holds
  // the founder at that week until it resolves.
  let maxWeek = currentWeek;
  const firstUnresolved = weeks.find((w) => w.status === 'failed' || w.status === 'grace');
  if (firstUnresolved) {
    maxWeek = Math.min(maxWeek, firstUnresolved.week);
    currentDeadline = firstUnresolved.deadline_at;
  }
  if (frozen && frozenWeek !== null) {
    const fw = weeks.find((w) => w.week === frozenWeek);
    if (fw) currentDeadline = fw.deadline_at;
  }
  return {
    in_cohort: true,
    cycle_id: cycle.id,
    cycle_label: `${cycle.year}-${String(cycle.month).padStart(2, '0')}`,
    max_week: maxWeek,
    frozen,
    frozen_week: frozenWeek,
    current_week: Math.min(currentWeek, maxWeek),
    current_deadline_at: currentDeadline,
    grace_until: graceUntil,
    weeks,
    server_time: new Date(nowMs).toISOString(),
  };
}
