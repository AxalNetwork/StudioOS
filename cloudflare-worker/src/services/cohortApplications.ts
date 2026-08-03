/**
 * Cohort Application Deadlines & Auto-Notifications — automated monthly
 * application lifecycle for Spin-Out Lab, layered on the cohort_cycles
 * calendar from cohortTiming.ts.
 *
 * Timeline for the cohort starting the 1st of month M (all America/New_York,
 * DST-correct — never a fixed UTC offset):
 *   • applications OPEN the 1st of month M-1, 00:00
 *   • applications CLOSE 7 days before the 1st of M, 23:59:59
 *   • close → decision window: pool freezes, cycle app_status='reviewing',
 *     admins notified with the pending count
 *   • ~12h before the 1st: capacity evaluation — below the admin-set
 *     minimum (unless force_proceed) the cycle is POSTPONED and approved/
 *     waitlisted/pending applicants roll forward to M+1 ("cohorts combined")
 *   • 00:00 Delaware on the 1st: activation — approved applicants are
 *     admitted, workspace unlocked at Week 1, "workspace live" notification
 *
 * Everything is cron-driven (`runCohortApplicationsTick`) and idempotent:
 * job runs claim scheduled_jobs_audit.idempotency_key via the crash-safe
 * two-phase claim from cohortTiming, and every user-facing notification is
 * deduped by the UNIQUE(user_id, cohort_cycle_id, notif_type) ledger — so
 * re-runs never double-send or double-activate.
 *
 * Pure calendar/decision functions live at the top for the test suite
 * (test/cohort_applications.test.ts) — no D1 binding needed there.
 */
import type { Env } from '../types';
import {
  COHORT_TZ, wallClockToUtcMs, delawareYearMonth, materializeCycle,
  claimOrResumeJob, completeJobRun,
} from './cohortTiming';

export const APP_REMINDER_THRESHOLDS_HOURS = [72, 24] as const;
export const DEFAULT_MIN_COHORT_SIZE = 1;
export const DEFAULT_MAX_COHORT_SIZE = 25;
/** Capacity check runs once the cycle start is within this many hours. */
export const CAPACITY_EVAL_HOURS_BEFORE_START = 12;

// ---------------------------------------------------------------------------
// Pure calendar math
// ---------------------------------------------------------------------------

export type ApplicationWindow = { year: number; month: number; openMs: number; closeMs: number; startMs: number };

/**
 * Application window for the cohort starting the 1st of `year`/`month`:
 * opens the 1st of the previous month 00:00 ET, closes 7 days before the
 * 1st at 23:59:59 ET. Day/month underflow uses Date.UTC semantics inside
 * wallClockToUtcMs (day "-6" = 7 days before the 1st), and the two-pass
 * tz refinement keeps both boundaries DST-correct.
 */
export function applicationWindowFor(year: number, month: number, tz: string = COHORT_TZ): ApplicationWindow {
  return {
    year, month,
    openMs: wallClockToUtcMs(year, month - 1, 1, 0, 0, 0, tz),
    closeMs: wallClockToUtcMs(year, month, -6, 23, 59, 59, tz),
    startMs: wallClockToUtcMs(year, month, 1, 0, 0, 0, tz),
  };
}

export function monthLabel(year: number, month: number): string {
  return new Date(Date.UTC(year, month - 1, 15)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function nextYearMonth(year: number, month: number): { year: number; month: number } {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

export type ApplicationTarget =
  | { ok: true; year: number; month: number; window: ApplicationWindow }
  | { ok: false; closed: { year: number; month: number }; next: { year: number; month: number; window: ApplicationWindow } };

/**
 * Which cohort a NEW application lands in at `nowMs`. The earliest future
 * cycle whose close deadline hasn't passed — during the review window
 * (close → 1st) that is already the month after next. If the caller
 * explicitly targeted a cycle whose deadline HAS passed, the submission is
 * rejected (ok:false) with the next eligible cycle attached, so the API
 * can hard-block late submissions with an actionable message.
 */
export function resolveApplicationTarget(
  nowMs: number, requested?: { year: number; month: number } | null,
): ApplicationTarget {
  const cur = delawareYearMonth(nowMs);
  let { year, month } = nextYearMonth(cur.year, cur.month);
  let w = applicationWindowFor(year, month);
  // Between close and the 1st, the next-month window is shut — advance.
  while (w.closeMs <= nowMs) {
    ({ year, month } = nextYearMonth(year, month));
    w = applicationWindowFor(year, month);
  }
  if (requested && Number.isFinite(requested.year) && Number.isFinite(requested.month)) {
    const rw = applicationWindowFor(requested.year, requested.month);
    if (rw.closeMs <= nowMs) {
      return { ok: false, closed: { year: requested.year, month: requested.month }, next: { year, month, window: w } };
    }
    return { ok: true, year: requested.year, month: requested.month, window: rw };
  }
  return { ok: true, year, month, window: w };
}

/**
 * Pure capacity decision run before the 1st: below the admin-set minimum
 * the cycle postpones and rolls forward — unless an admin flipped
 * force_proceed. Cohorts with nobody in the pool never "postpone" (there
 * is nothing to combine; the empty cycle just stays quiet).
 */
export function capacityDecision(
  approvedCount: number, poolCount: number, minSize: number, forceProceed: boolean,
): 'proceed' | 'postpone' {
  if (forceProceed) return 'proceed';
  if (poolCount === 0) return 'proceed';
  return approvedCount < minSize ? 'postpone' : 'proceed';
}

const iso = (ms: number): string => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const msOf = (ts: string): number => Date.parse(ts.replace(' ', 'T') + 'Z');

// ---------------------------------------------------------------------------
// Schema ensure (mirrors migration 157 for dev/preview D1)
// ---------------------------------------------------------------------------

let schemaReady = false;
export async function ensureCohortAppSchema(env: Env): Promise<void> {
  if (schemaReady) return;
  const alters = [
    `ALTER TABLE cohort_cycles ADD COLUMN applications_open_at TEXT`,
    `ALTER TABLE cohort_cycles ADD COLUMN applications_close_at TEXT`,
    `ALTER TABLE cohort_cycles ADD COLUMN app_status TEXT NOT NULL DEFAULT 'open'`,
    `ALTER TABLE cohort_cycles ADD COLUMN force_proceed INTEGER NOT NULL DEFAULT 0`,
  ];
  const ddl = [
    `CREATE TABLE IF NOT EXISTS cohort_applicants (id INTEGER PRIMARY KEY AUTOINCREMENT, application_id INTEGER NOT NULL, user_id INTEGER NOT NULL, cohort_cycle_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', rolled_from_cycle_id INTEGER, decided_at TEXT, decided_by TEXT, decision_reason TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(application_id, cohort_cycle_id))`,
    `CREATE TABLE IF NOT EXISTS cohort_cycle_events (id INTEGER PRIMARY KEY AUTOINCREMENT, cohort_cycle_id INTEGER, event_type TEXT NOT NULL, details TEXT, actor TEXT NOT NULL DEFAULT 'scheduler', created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS cohort_app_notification_ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, cohort_cycle_id INTEGER NOT NULL, notif_type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'sent', sent_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(user_id, cohort_cycle_id, notif_type))`,
    `CREATE TABLE IF NOT EXISTS cohort_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')), updated_by TEXT)`,
  ];
  try {
    for (const s of alters) {
      try { await env.DB.prepare(s).run(); } catch { /* column exists */ }
    }
    for (const s of ddl) await env.DB.prepare(s).run();
    schemaReady = true;
  } catch (e) {
    console.error('[cohort-apps] schema ensure failed', e);
  }
}

// ---------------------------------------------------------------------------
// Settings, events, ledger-deduped notifications
// ---------------------------------------------------------------------------

export async function getCohortSizeSettings(env: Env): Promise<{ min: number; max: number }> {
  let min = DEFAULT_MIN_COHORT_SIZE;
  let max = DEFAULT_MAX_COHORT_SIZE;
  try {
    const rs = await env.DB.prepare(
      `SELECT key, value FROM cohort_settings WHERE key IN ('min_cohort_size', 'max_cohort_size')`,
    ).all<{ key: string; value: string }>();
    for (const r of rs.results || []) {
      const n = Number(r.value);
      if (!Number.isFinite(n) || n < 0) continue;
      if (r.key === 'min_cohort_size') min = n;
      if (r.key === 'max_cohort_size') max = n;
    }
  } catch { /* table not yet migrated */ }
  return { min, max };
}

export async function logCycleEvent(
  env: Env, cycleId: number | null, eventType: string, details: string, actor = 'scheduler',
): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO cohort_cycle_events (cohort_cycle_id, event_type, details, actor) VALUES (?, ?, ?, ?)`,
    ).bind(cycleId, eventType, details, actor).run();
  } catch (e) { console.warn('[cohort-apps] event log failed', e); }
}

/**
 * Send at most ONE notification per (user, cycle, type) — INSERT OR IGNORE
 * on the ledger's UNIQUE key is the claim, so concurrent/resumed runs
 * can't double-send. Returns true iff this call actually sent.
 */
export async function notifyOnce(
  env: Env,
  args: { userId: number; cycleId: number; notifType: string; title: string; body: string; link?: string; email?: boolean },
): Promise<boolean> {
  const claim = await env.DB.prepare(
    `INSERT OR IGNORE INTO cohort_app_notification_ledger (user_id, cohort_cycle_id, notif_type) VALUES (?, ?, ?)`,
  ).bind(args.userId, args.cycleId, args.notifType).run();
  if ((claim.meta?.changes ?? 0) === 0) return false;
  try {
    const { notify } = await import('./notify');
    await notify(env, {
      userId: args.userId, type: `cohort_app_${args.notifType}`,
      title: args.title, body: args.body, link: args.link ?? '/spinout-lab',
      channels: args.email === false ? ['in_app'] : ['in_app', 'email'],
      category: 'deals',
    });
  } catch (e) {
    console.warn('[cohort-apps] notify failed', e);
    await env.DB.prepare(
      `UPDATE cohort_app_notification_ledger SET status = 'failed' WHERE user_id = ? AND cohort_cycle_id = ? AND notif_type = ?`,
    ).bind(args.userId, args.cycleId, args.notifType).run();
  }
  return true;
}

/**
 * Claim the right to send THE one admission-decision email for
 * (user, cycle, decision). Both admin decide surfaces (the cohort route and
 * the legacy spinout-applications route) must call this before sending
 * spinout_admitted / spinout_refused, so a candidate never receives the same
 * decision email twice regardless of which surface — or how many times — the
 * decision is made. Returns true iff this caller won the claim and should send.
 */
export async function claimDecisionEmail(
  env: Env, userId: number, cycleId: number, decision: 'approved' | 'rejected',
): Promise<boolean> {
  const claim = await env.DB.prepare(
    `INSERT OR IGNORE INTO cohort_app_notification_ledger (user_id, cohort_cycle_id, notif_type) VALUES (?, ?, ?)`,
  ).bind(userId, cycleId, `decision_email_${decision}`).run();
  return (claim.meta?.changes ?? 0) > 0;
}

async function notifyAdminsOnce(
  env: Env, cycleId: number, notifType: string, title: string, body: string,
): Promise<void> {
  try {
    const admins = await env.DB.prepare(`SELECT id FROM users WHERE role = 'admin' AND is_active = 1`).all<{ id: number }>();
    for (const a of admins.results || []) {
      await notifyOnce(env, { userId: a.id, cycleId, notifType, title, body, link: '/admin/spinout-lab' });
    }
  } catch (e) { console.warn('[cohort-apps] admin notify failed', e); }
}

// ---------------------------------------------------------------------------
// Cycle + assignment plumbing
// ---------------------------------------------------------------------------

export type AppCycleRow = {
  id: number; year: number; month: number; start_at: string; end_at: string;
  status: string; applications_open_at: string | null; applications_close_at: string | null;
  app_status: string; force_proceed: number;
};

/** Materialize the cycle row (+ week windows) and stamp its application window. */
export async function ensureCycleWithWindow(env: Env, year: number, month: number): Promise<AppCycleRow | null> {
  await materializeCycle(env, year, month);
  const w = applicationWindowFor(year, month);
  await env.DB.prepare(
    `UPDATE cohort_cycles SET applications_open_at = ?, applications_close_at = ?
      WHERE year = ? AND month = ? AND applications_close_at IS NULL`,
  ).bind(iso(w.openMs), iso(w.closeMs), year, month).run();
  return env.DB.prepare(`SELECT * FROM cohort_cycles WHERE year = ? AND month = ?`)
    .bind(year, month).first<AppCycleRow>();
}

/** Idempotent applicant↔cycle assignment (UNIQUE(application_id, cycle)). */
export async function assignApplicationToCycle(
  env: Env, applicationId: number, userId: number, cycleId: number,
  opts: { status?: string; rolledFromCycleId?: number | null } = {},
): Promise<void> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO cohort_applicants (application_id, user_id, cohort_cycle_id, status, rolled_from_cycle_id)
     VALUES (?, ?, ?, ?, ?)`,
  ).bind(applicationId, userId, cycleId, opts.status ?? 'pending', opts.rolledFromCycleId ?? null).run();
}

// ---------------------------------------------------------------------------
// Cron tick — reminders → close → capacity → activation
// ---------------------------------------------------------------------------

export async function runCohortApplicationsTick(env: Env, now: Date): Promise<void> {
  const nowMs = now.getTime();
  await ensureCohortAppSchema(env);

  // Keep the next two cycles materialized with stamped windows so the
  // close/capacity/activation scans below always have rows to work on.
  const cur = delawareYearMonth(nowMs);
  const n1 = nextYearMonth(cur.year, cur.month);
  const n2 = nextYearMonth(n1.year, n1.month);
  await ensureCycleWithWindow(env, cur.year, cur.month);
  await ensureCycleWithWindow(env, n1.year, n1.month);
  await ensureCycleWithWindow(env, n2.year, n2.month);

  try { await remindBeforeClose(env, nowMs); } catch (e) { console.error('[cohort-apps] reminders failed', e); }
  try { await closeExpiredWindows(env, nowMs); } catch (e) { console.error('[cohort-apps] close failed', e); }
  try { await evaluateCapacity(env, nowMs); } catch (e) { console.error('[cohort-apps] capacity failed', e); }
  try { await activateDueCycles(env, nowMs); } catch (e) { console.error('[cohort-apps] activation failed', e); }
}

/** 3d / 24h "applications close soon" reminders to undecided applicants. */
async function remindBeforeClose(env: Env, nowMs: number): Promise<void> {
  const rs = await env.DB.prepare(
    `SELECT * FROM cohort_cycles WHERE app_status = 'open' AND applications_close_at IS NOT NULL`,
  ).all<AppCycleRow>();
  for (const cyc of rs.results || []) {
    const closeMs = msOf(cyc.applications_close_at!);
    if (closeMs <= nowMs) continue;
    const hoursLeft = (closeMs - nowMs) / 3_600_000;
    // Most-urgent satisfied threshold only (matches the timing reminders).
    const due = APP_REMINDER_THRESHOLDS_HOURS.filter((h) => hoursLeft <= h).sort((a, b) => a - b)[0];
    if (due === undefined) continue;
    const label = monthLabel(cyc.year, cyc.month);
    const closeDate = new Date(closeMs).toLocaleString('en-US', {
      timeZone: COHORT_TZ, month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    });
    const pending = await env.DB.prepare(
      `SELECT ca.user_id FROM cohort_applicants ca WHERE ca.cohort_cycle_id = ? AND ca.status = 'pending'`,
    ).bind(cyc.id).all<{ user_id: number }>();
    for (const p of pending.results || []) {
      await notifyOnce(env, {
        userId: p.user_id, cycleId: cyc.id, notifType: `close_reminder_${due}h`,
        title: `Spin-Out Lab: ${label} applications close soon`,
        body: `Applications for the ${label} cohort close ${closeDate}. Your application is in — decisions go out before the cohort starts on the 1st.`,
        link: '/spinout-lab/apply',
      });
    }
  }
}

/** Freeze the pool at the deadline: cycle → 'reviewing', notify admins. */
async function closeExpiredWindows(env: Env, nowMs: number): Promise<void> {
  const rs = await env.DB.prepare(
    `SELECT * FROM cohort_cycles WHERE app_status = 'open' AND applications_close_at IS NOT NULL AND applications_close_at <= ?`,
  ).bind(iso(nowMs)).all<AppCycleRow>();
  for (const cyc of rs.results || []) {
    const key = `apps_close:${cyc.id}`;
    const claim = await claimOrResumeJob(env, 'apps_close', cyc.id, null, key);
    if (claim === 'done') continue;
    // Adopt any pending legacy applications never assigned to a cycle so
    // the review pool is complete at freeze time.
    await env.DB.prepare(
      `INSERT OR IGNORE INTO cohort_applicants (application_id, user_id, cohort_cycle_id, status)
       SELECT a.id, a.user_id, ?, 'pending' FROM spinout_applications a
        WHERE a.status = 'pending'
          AND NOT EXISTS (SELECT 1 FROM cohort_applicants ca WHERE ca.application_id = a.id AND ca.status != 'rolled_forward')`,
    ).bind(cyc.id).run();
    await env.DB.prepare(
      `UPDATE cohort_cycles SET app_status = 'reviewing' WHERE id = ? AND app_status = 'open'`,
    ).bind(cyc.id).run();
    const cnt = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM cohort_applicants WHERE cohort_cycle_id = ? AND status = 'pending'`,
    ).bind(cyc.id).first<{ n: number }>();
    const label = monthLabel(cyc.year, cyc.month);
    await logCycleEvent(env, cyc.id, 'applications_closed', `Pool frozen with ${cnt?.n ?? 0} pending application(s)`);
    await notifyAdminsOnce(env, cyc.id, 'apps_closed_admin',
      `${label} cohort applications closed`,
      `${cnt?.n ?? 0} application(s) are waiting for review. Decisions are due before the cohort starts on the 1st.`);
    await completeJobRun(env, key, `pending=${cnt?.n ?? 0}`);
  }
}

/** Below-minimum cycles postpone and roll everyone forward (unless forced). */
async function evaluateCapacity(env: Env, nowMs: number): Promise<void> {
  // No lower bound on start_at: a cron that resumes late (even after the
  // 1st) must still run the capacity check BEFORE activation picks the
  // cycle up — activateDueCycles runs after this in the same tick and
  // skips cycles this function flips to 'postponed'.
  const horizon = iso(nowMs + CAPACITY_EVAL_HOURS_BEFORE_START * 3_600_000);
  const rs = await env.DB.prepare(
    `SELECT * FROM cohort_cycles WHERE app_status = 'reviewing' AND start_at <= ?`,
  ).bind(horizon).all<AppCycleRow>();
  const { min } = await getCohortSizeSettings(env);
  for (const cyc of rs.results || []) {
    const key = `apps_capacity:${cyc.id}`;
    const claim = await claimOrResumeJob(env, 'apps_capacity', cyc.id, null, key);
    if (claim === 'done') continue;
    const counts = await env.DB.prepare(
      `SELECT status, COUNT(*) AS n FROM cohort_applicants WHERE cohort_cycle_id = ? GROUP BY status`,
    ).bind(cyc.id).all<{ status: string; n: number }>();
    const byStatus: Record<string, number> = {};
    for (const r of counts.results || []) byStatus[r.status] = r.n;
    const approved = byStatus['approved'] ?? 0;
    const pool = approved + (byStatus['pending'] ?? 0) + (byStatus['waitlisted'] ?? 0);
    const decision = capacityDecision(approved, pool, min, cyc.force_proceed === 1);
    const label = monthLabel(cyc.year, cyc.month);
    if (decision === 'proceed') {
      await logCycleEvent(env, cyc.id, 'capacity_ok',
        `Capacity check passed: ${approved} approved (minimum ${min})${cyc.force_proceed === 1 ? ' — force-proceed set' : ''}`);
      await completeJobRun(env, key, `approved=${approved} min=${min}`);
      continue;
    }
    // Postpone: roll approved/pending/waitlisted forward to next month.
    const nxt = nextYearMonth(cyc.year, cyc.month);
    const nextCycle = await ensureCycleWithWindow(env, nxt.year, nxt.month);
    if (!nextCycle) { await completeJobRun(env, key, 'postpone aborted: next cycle missing'); continue; }
    const nextLabel = monthLabel(nxt.year, nxt.month);
    const movers = await env.DB.prepare(
      `SELECT id, application_id, user_id, status FROM cohort_applicants
        WHERE cohort_cycle_id = ? AND status IN ('approved', 'pending', 'waitlisted')`,
    ).bind(cyc.id).all<{ id: number; application_id: number; user_id: number; status: string }>();
    for (const m of movers.results || []) {
      await assignApplicationToCycle(env, m.application_id, m.user_id, nextCycle.id, {
        status: m.status, rolledFromCycleId: cyc.id,
      });
      await env.DB.prepare(
        `UPDATE cohort_applicants SET status = 'rolled_forward', decided_at = datetime('now'), decided_by = 'system',
                decision_reason = ? WHERE id = ? AND status != 'rolled_forward'`,
      ).bind(`Below minimum cohort size (${approved} approved < ${min}) — combined into ${nextLabel}`, m.id).run();
      await notifyOnce(env, {
        userId: m.user_id, cycleId: cyc.id, notifType: 'cohorts_combined',
        title: `Your Spin-Out Lab cohort moved to ${nextLabel}`,
        body: `The ${label} cohort didn't reach its minimum size, so it has been combined with the ${nextLabel} cohort. Your application carries over automatically — no action needed.`,
      });
    }
    await env.DB.prepare(
      `UPDATE cohort_cycles SET app_status = 'postponed' WHERE id = ? AND app_status = 'reviewing'`,
    ).bind(cyc.id).run();
    await logCycleEvent(env, cyc.id, 'cycle_postponed',
      `Below minimum (${approved} approved < ${min}); ${movers.results?.length ?? 0} applicant(s) rolled forward to ${nextLabel}`);
    await notifyAdminsOnce(env, cyc.id, 'postponed_admin',
      `${label} cohort postponed`,
      `Only ${approved} approved applicant(s) (minimum ${min}). ${movers.results?.length ?? 0} applicant(s) rolled forward to ${nextLabel}. Use force-proceed before the capacity check to run a small cohort anyway.`);
    await completeJobRun(env, key, `postponed approved=${approved} min=${min} rolled=${movers.results?.length ?? 0}`);
  }
}

/** Midnight Delaware on the 1st: admit + unlock Week 1 for approved applicants. */
async function activateDueCycles(env: Env, nowMs: number): Promise<void> {
  const rs = await env.DB.prepare(
    `SELECT * FROM cohort_cycles WHERE app_status = 'reviewing' AND start_at <= ?`,
  ).bind(iso(nowMs)).all<AppCycleRow>();
  for (const cyc of rs.results || []) {
    const key = `apps_activate:${cyc.id}`;
    const claim = await claimOrResumeJob(env, 'apps_activate', cyc.id, null, key);
    if (claim === 'done') continue;
    const label = monthLabel(cyc.year, cyc.month);
    const cohortLabel = `${label} Cohort`;
    const approved = await env.DB.prepare(
      `SELECT ca.id, ca.application_id, ca.user_id, u.email, u.name
         FROM cohort_applicants ca JOIN users u ON u.id = ca.user_id
        WHERE ca.cohort_cycle_id = ? AND ca.status = 'approved'`,
    ).bind(cyc.id).all<{ id: number; application_id: number; user_id: number; email: string; name: string | null }>();
    let activated = 0;
    for (const a of approved.results || []) {
      // Per-applicant idempotent flip: 'approved' → 'activated' guards the
      // side effects, so a resumed run never re-admits or re-notifies.
      const upd = await env.DB.prepare(
        `UPDATE cohort_applicants SET status = 'activated', decided_at = datetime('now') WHERE id = ? AND status = 'approved'`,
      ).bind(a.id).run();
      if ((upd.meta?.changes ?? 0) === 0) continue;
      await env.DB.prepare(
        `INSERT INTO user_spinout_flags (user_id, spinout_lab_admitted, spinout_lab_cohort)
         VALUES (?, 1, ?)
         ON CONFLICT(user_id) DO UPDATE SET spinout_lab_admitted = 1, spinout_lab_cohort = excluded.spinout_lab_cohort`,
      ).bind(a.user_id, cohortLabel).run();
      // started_at = the cycle's own start instant, so the founder is
      // calendar-gated by exactly this cycle's week windows.
      await env.DB.prepare(
        `UPDATE users SET spinout_lab_active = 1, spinout_lab_week = 1, spinout_lab_started_at = ?
          WHERE id = ? AND (spinout_lab_active IS NULL OR spinout_lab_active = 0)`,
      ).bind(cyc.start_at, a.user_id).run();
      await env.DB.prepare(
        `UPDATE spinout_applications SET status = 'accepted', decided_at = datetime('now') WHERE id = ? AND status = 'pending'`,
      ).bind(a.application_id).run();
      await notifyOnce(env, {
        userId: a.user_id, cycleId: cyc.id, notifType: 'workspace_live',
        title: `Your Spin-Out Lab workspace is live`,
        body: `Welcome to the ${label} cohort! Week 1 is unlocked now — head to your workspace to get started.`,
        link: '/spinout-lab',
      });
      activated += 1;
    }
    // Undecided applicants at the start instant roll to next month so
    // nobody silently falls out of the funnel.
    const nxt = nextYearMonth(cyc.year, cyc.month);
    const nextCycle = await ensureCycleWithWindow(env, nxt.year, nxt.month);
    if (nextCycle) {
      const undecided = await env.DB.prepare(
        `SELECT id, application_id, user_id, status FROM cohort_applicants
          WHERE cohort_cycle_id = ? AND status IN ('pending', 'waitlisted')`,
      ).bind(cyc.id).all<{ id: number; application_id: number; user_id: number; status: string }>();
      for (const m of undecided.results || []) {
        await assignApplicationToCycle(env, m.application_id, m.user_id, nextCycle.id, {
          status: m.status, rolledFromCycleId: cyc.id,
        });
        await env.DB.prepare(
          `UPDATE cohort_applicants SET status = 'rolled_forward', decided_at = datetime('now'), decided_by = 'system',
                  decision_reason = 'Undecided at cohort start — carried to the next cycle' WHERE id = ? AND status != 'rolled_forward'`,
        ).bind(m.id).run();
      }
    }
    await env.DB.prepare(
      `UPDATE cohort_cycles SET app_status = 'active' WHERE id = ? AND app_status = 'reviewing'`,
    ).bind(cyc.id).run();
    await logCycleEvent(env, cyc.id, 'cycle_activated', `${activated} founder(s) activated for ${label}`);
    if (activated > 0) {
      await notifyAdminsOnce(env, cyc.id, 'activated_admin',
        `${label} cohort is live`, `${activated} founder(s) were admitted and their workspaces unlocked at Week 1.`);
    }
    await completeJobRun(env, key, `activated=${activated}`);
  }
}
