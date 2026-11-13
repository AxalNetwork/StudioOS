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
import { bindingKey, runSchemaBootstrap } from '../util/schemaBootstrap';

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

/**
 * #4568 R2-04: the bootstrap a preview or local database needs, run through
 * `runSchemaBootstrap`, which reads `cohort_cycles`' columns once per binding
 * and skips the ALTERs whose column is there. Migration 157 declares all four,
 * so against an up-to-date database (production) this issues no ALTER at all.
 * Before, it tried all four on every fresh isolate — the cron tick runs it
 * each time — and each failed with `duplicate column name`, which the audit
 * saw as recurring D1 errors.
 *
 * A bootstrap that genuinely fails now throws `cohort_schema_not_ready`
 * (logged once, with no value) and is not marked ready, so the next call
 * tries again. Before, it logged and returned, and the caller went on against
 * tables that might be incomplete. Every caller already handles a throw: the
 * cron tick and the apply route catch and log, and the admin routes answer
 * the app's 500.
 */
const SCHEMA_READY = new WeakMap<object, boolean>();
export const COHORT_SCHEMA = Object.freeze([
  `ALTER TABLE cohort_cycles ADD COLUMN applications_open_at TEXT`,
  `ALTER TABLE cohort_cycles ADD COLUMN applications_close_at TEXT`,
  `ALTER TABLE cohort_cycles ADD COLUMN app_status TEXT NOT NULL DEFAULT 'open'`,
  `ALTER TABLE cohort_cycles ADD COLUMN force_proceed INTEGER NOT NULL DEFAULT 0`,
  `CREATE TABLE IF NOT EXISTS cohort_applicants (id INTEGER PRIMARY KEY AUTOINCREMENT, application_id INTEGER NOT NULL, user_id INTEGER NOT NULL, cohort_cycle_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', rolled_from_cycle_id INTEGER, decided_at TEXT, decided_by TEXT, decision_reason TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(application_id, cohort_cycle_id))`,
  `CREATE TABLE IF NOT EXISTS cohort_cycle_events (id INTEGER PRIMARY KEY AUTOINCREMENT, cohort_cycle_id INTEGER, event_type TEXT NOT NULL, details TEXT, actor TEXT NOT NULL DEFAULT 'scheduler', created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS cohort_app_notification_ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, cohort_cycle_id INTEGER NOT NULL, notif_type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'sent', sent_at TEXT NOT NULL DEFAULT (datetime('now')), title TEXT, body TEXT, link TEXT, email INTEGER, attempts INTEGER NOT NULL DEFAULT 0, delivered_at TEXT, UNIQUE(user_id, cohort_cycle_id, notif_type))`,
  `CREATE TABLE IF NOT EXISTS cohort_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')), updated_by TEXT)`,
  // D4658 (migration 202611071730): the ledger carries its message and attempts.
  `ALTER TABLE cohort_app_notification_ledger ADD COLUMN title TEXT`,
  `ALTER TABLE cohort_app_notification_ledger ADD COLUMN body TEXT`,
  `ALTER TABLE cohort_app_notification_ledger ADD COLUMN link TEXT`,
  `ALTER TABLE cohort_app_notification_ledger ADD COLUMN email INTEGER`,
  `ALTER TABLE cohort_app_notification_ledger ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE cohort_app_notification_ledger ADD COLUMN delivered_at TEXT`,
]);
export async function ensureCohortAppSchema(env: Env): Promise<void> {
  if (SCHEMA_READY.get(bindingKey(env))) return;
  try {
    await runSchemaBootstrap(env, COHORT_SCHEMA);
  } catch {
    console.error('[cohort-apps] schema_not_ready');
    throw new Error('cohort_schema_not_ready');
  }
  SCHEMA_READY.set(bindingKey(env), true);
}

// ---------------------------------------------------------------------------
// Settings, events, ledger-deduped notifications
// ---------------------------------------------------------------------------

/**
 * D511 — the cohort size settings could not be read. Thrown by
 * `getCohortSizeSettings` instead of answering the defaults: a default handed
 * back for a failed read is a number nobody set, and its callers used to act
 * on it — postponing a cohort against a minimum, or printing the places.
 */
export class CohortSettingsUnreadable extends Error {
  readonly code = 'cohort_settings_unreadable';
  constructor(cause?: unknown) {
    super('The cohort size settings could not be read.');
    (this as any).cause = cause;
  }
}

/**
 * The minimum and maximum cohort size. A key no admin has set answers its
 * product default (`DEFAULT_MIN_COHORT_SIZE` / `DEFAULT_MAX_COHORT_SIZE`): that
 * default IS the operative number until someone overrides it. A read that
 * FAILS is different, and throws `CohortSettingsUnreadable` (D511).
 */
export async function getCohortSizeSettings(env: Env): Promise<{ min: number; max: number }> {
  let min = DEFAULT_MIN_COHORT_SIZE;
  let max = DEFAULT_MAX_COHORT_SIZE;
  let rs: { results?: Array<{ key: string; value: string }> };
  try {
    rs = await env.DB.prepare(
      `SELECT key, value FROM cohort_settings WHERE key IN ('min_cohort_size', 'max_cohort_size')`,
    ).all<{ key: string; value: string }>();
  } catch (e) {
    console.error('[cohort-apps] cohort_settings unreadable', (e as Error)?.message);
    throw new CohortSettingsUnreadable(e);
  }
  for (const r of rs.results || []) {
    const n = Number(r.value);
    if (!Number.isFinite(n) || n < 0) continue;
    if (r.key === 'min_cohort_size') min = n;
    if (r.key === 'max_cohort_size') max = n;
  }
  return { min, max };
}

/** The settings, or null when they could not be read — for a caller that says "Unreadable". */
export async function readCohortSizeSettings(env: Env): Promise<{ min: number; max: number } | null> {
  // `getCohortSizeSettings` throws nothing but `CohortSettingsUnreadable`.
  try { return await getCohortSizeSettings(env); } catch { return null; }
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
  // D4658: the claim stores the message as 'pending'; the send marks it 'sent'.
  // A send that fails is 'failed', and one cut off before it finished stays
  // 'pending' — both are delivered later by retryCohortNotifications, so a
  // claim is never a promise that silently went undelivered.
  const claim = await env.DB.prepare(
    `INSERT OR IGNORE INTO cohort_app_notification_ledger
       (user_id, cohort_cycle_id, notif_type, status, title, body, link, email, attempts)
     VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, 0)`,
  ).bind(args.userId, args.cycleId, args.notifType, args.title, args.body, args.link ?? '/spinout-lab', args.email === false ? 0 : 1).run();
  if ((claim.meta?.changes ?? 0) === 0) return false;
  await deliverLedgerRow(env, { user_id: args.userId, cohort_cycle_id: args.cycleId, notif_type: args.notifType,
    title: args.title, body: args.body, link: args.link ?? '/spinout-lab', email: args.email === false ? 0 : 1 });
  return true;
}

type LedgerRow = { user_id: number; cohort_cycle_id: number; notif_type: string; title: string | null; body: string | null; link: string | null; email: number | null };

/** One delivery attempt for a claimed row; records the outcome. Never throws. */
async function deliverLedgerRow(env: Env, r: LedgerRow): Promise<boolean> {
  try {
    const { notify } = await import('./notify');
    await notify(env, {
      userId: r.user_id, type: `cohort_app_${r.notif_type}`,
      title: String(r.title ?? ''), body: String(r.body ?? ''), link: r.link ?? '/spinout-lab',
      channels: Number(r.email ?? 1) === 0 ? ['in_app'] : ['in_app', 'email'],
      category: 'deals',
    });
    await env.DB.prepare(
      `UPDATE cohort_app_notification_ledger SET status = 'sent', attempts = attempts + 1, delivered_at = datetime('now')
        WHERE user_id = ? AND cohort_cycle_id = ? AND notif_type = ?`,
    ).bind(r.user_id, r.cohort_cycle_id, r.notif_type).run();
    return true;
  } catch {
    console.warn('[cohort-apps] notify failed', { type: r.notif_type });
    try {
      await env.DB.prepare(
        `UPDATE cohort_app_notification_ledger SET status = 'failed', attempts = attempts + 1, sent_at = datetime('now')
          WHERE user_id = ? AND cohort_cycle_id = ? AND notif_type = ?`,
      ).bind(r.user_id, r.cohort_cycle_id, r.notif_type).run();
    } catch { /* the row stays 'pending' and is retried */ }
    return false;
  }
}

export const NOTIFY_MAX_ATTEMPTS = 5;
/** A 'pending' row older than this was cut off before its send finished. */
export const NOTIFY_STALE_MS = 10 * 60_000;

/**
 * Deliver what an earlier claim did not: 'failed' rows, and 'pending' rows
 * older than NOTIFY_STALE_MS. Each row is re-claimed by a conditional update
 * first, so two ticks never send it twice; after NOTIFY_MAX_ATTEMPTS it is
 * 'abandoned' and an admin can see it. Bounded per call. Never throws.
 */
export async function retryCohortNotifications(env: Env, nowMs: number, limit = 20): Promise<{ sent: number; failed: number; abandoned: number }> {
  const out = { sent: 0, failed: 0, abandoned: 0 };
  try {
    const stale = iso(nowMs - NOTIFY_STALE_MS);
    const rows = await env.DB.prepare(
      `SELECT id, user_id, cohort_cycle_id, notif_type, status, title, body, link, email, attempts
         FROM cohort_app_notification_ledger
        WHERE title IS NOT NULL AND (status = 'failed' OR (status = 'pending' AND sent_at <= ?))
        ORDER BY id LIMIT ?`,
    ).bind(stale, limit).all<LedgerRow & { id: number; status: string; attempts: number }>();
    for (const r of rows.results || []) {
      if (Number(r.attempts) >= NOTIFY_MAX_ATTEMPTS) {
        await env.DB.prepare(`UPDATE cohort_app_notification_ledger SET status = 'abandoned' WHERE id = ? AND status = ?`).bind(r.id, r.status).run();
        out.abandoned += 1;
        continue;
      }
      const claim = await env.DB.prepare(
        `UPDATE cohort_app_notification_ledger SET status = 'pending', sent_at = datetime('now') WHERE id = ? AND status = ? AND attempts = ?`,
      ).bind(r.id, r.status, r.attempts).run();
      if (Number(claim.meta?.changes ?? 0) !== 1) continue;
      if (await deliverLedgerRow(env, r)) out.sent += 1; else out.failed += 1;
    }
  } catch { console.warn('[cohort-apps] notification retry unreadable'); }
  return out;
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
      await notifyOnce(env, { userId: a.id, cycleId, notifType, title, body, link: '/admin/programs/spinout-lab/applications' });
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
  try { await evaluateCapacity(env, nowMs); } catch (e) {
    console.error('[cohort-apps] capacity failed', e);
    // D511 — capacity could not be checked against a minimum anyone read, so
    // nothing is activated on this tick either.
    if (e instanceof CohortSettingsUnreadable) return;
  }
  try { await activateDueCycles(env, nowMs); } catch (e) { console.error('[cohort-apps] activation failed', e); }
  // D4658: deliver what an earlier claim did not.
  await retryCohortNotifications(env, nowMs);
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

const CAPACITY_UNREADABLE_DETAILS =
  'The minimum cohort size could not be read, so the capacity check did not run and the cycle was not activated. The next tick tries again.';

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
  // D511 — no minimum, no capacity check. Each due cycle's history says why,
  // and the error goes up so the tick skips activation too: activating a
  // cycle whose capacity was never checked is acting on a number nobody read.
  // The cron retries every tick, so the line is written once per outage: only
  // when the cycle's latest event is not already this one. The check and the
  // write are one statement, so two overlapping ticks cannot both add it.
  let min: number;
  try {
    ({ min } = await getCohortSizeSettings(env));
  } catch (e) {
    if (e instanceof CohortSettingsUnreadable) {
      for (const cyc of rs.results || []) {
        try {
          await env.DB.prepare(
            `INSERT INTO cohort_cycle_events (cohort_cycle_id, event_type, details, actor)
             SELECT ?, 'capacity_unreadable', ?, 'scheduler'
             WHERE COALESCE((SELECT event_type FROM cohort_cycle_events WHERE cohort_cycle_id = ? ORDER BY id DESC LIMIT 1), '') <> 'capacity_unreadable'`,
          ).bind(cyc.id, CAPACITY_UNREADABLE_DETAILS, cyc.id).run();
        } catch (logErr) { console.warn('[cohort-apps] event log failed', logErr); }
      }
    }
    throw e;
  }
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
    // D4658: each applicant is one batch (one D1 transaction): enrollment,
    // admission flag, workspace, accepted application and, last, the
    // applicant's own 'activated'. Either every effect lands or none does, so
    // an interrupted run leaves the applicant 'approved' and the next run does
    // it whole. Applicants already 'activated' are selected too: a run that
    // resumes re-applies their (idempotent) effects and their notification.
    // The job completes only when every applicant has; a failure is recorded
    // and the job resumes on the next tick.
    const approved = await env.DB.prepare(
      `SELECT ca.id, ca.application_id, ca.user_id, ca.status
         FROM cohort_applicants ca JOIN users u ON u.id = ca.user_id
        WHERE ca.cohort_cycle_id = ? AND ca.status IN ('approved', 'activated')`,
    ).bind(cyc.id).all<{ id: number; application_id: number; user_id: number; status: string }>();
    let activated = 0;
    let failed = 0;
    for (const a of approved.results || []) {
      try {
        const res = await env.DB.batch([
          env.DB.prepare(
            `INSERT OR IGNORE INTO spinout_lab_enrollments
               (user_id, kind, cohort_cycle_id, cycle_source, cohort_applicant_id, application_id, started_at)
             VALUES (?, 'cohort', ?, 'assigned', ?, ?, ?)`,
          ).bind(a.user_id, cyc.id, a.id, a.application_id, cyc.start_at),
          env.DB.prepare(
            `INSERT INTO user_spinout_flags (user_id, spinout_lab_admitted, spinout_lab_cohort)
             VALUES (?, 1, ?)
             ON CONFLICT(user_id) DO UPDATE SET spinout_lab_admitted = 1, spinout_lab_cohort = excluded.spinout_lab_cohort`,
          ).bind(a.user_id, cohortLabel),
          // started_at = the cycle's own start instant, so the founder is
          // calendar-gated by exactly this cycle's week windows. A sprint that
          // ended (is_incorporated) is never reopened.
          env.DB.prepare(
            `UPDATE users SET spinout_lab_active = 1, spinout_lab_week = 1, spinout_lab_started_at = ?
              WHERE id = ? AND (spinout_lab_active IS NULL OR spinout_lab_active = 0) AND COALESCE(is_incorporated, 0) = 0`,
          ).bind(cyc.start_at, a.user_id),
          env.DB.prepare(
            `UPDATE spinout_applications SET status = 'accepted', decided_at = datetime('now') WHERE id = ? AND status = 'pending'`,
          ).bind(a.application_id),
          env.DB.prepare(
            `UPDATE cohort_applicants SET status = 'activated', decided_at = datetime('now') WHERE id = ? AND status = 'approved'`,
          ).bind(a.id),
        ]);
        if (Number(res[res.length - 1]?.meta?.changes ?? 0) === 1) activated += 1;
      } catch (e) {
        failed += 1;
        console.error('[cohort-apps] activation failed for an applicant', { cycle: cyc.id, applicant: a.id, code: (e as Error)?.name });
        continue;
      }
      // After the state transition, durable and idempotent (one ledger row per
      // user, cycle and type; a failed delivery is retried by the tick).
      await notifyOnce(env, {
        userId: a.user_id, cycleId: cyc.id, notifType: 'workspace_live',
        title: `Your Spin-Out Lab workspace is live`,
        body: `Welcome to the ${label} cohort! Week 1 is unlocked now — head to your workspace to get started.`,
        link: '/spinout-lab',
      });
    }
    if (failed > 0) {
      await logCycleEvent(env, cyc.id, 'activation_incomplete',
        `${failed} applicant(s) could not be activated; the activation resumes on the next run`);
      continue;
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
