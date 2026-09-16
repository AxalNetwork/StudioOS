/**
 * The compliance ladder — HQ's notices, their clock, and the freeze (D135).
 *
 * THE RUNGS, in the owner's words: "first admins get notified; if admins do not
 * act on notifications, admin accounts are frozen until they act on things from
 * what they have been notified; and lastly if they don't comply admin accounts
 * are terminated."
 *
 * So: a notice is issued with a deadline. The deadline passing unanswered is
 * what freezes — a clock owns the REVERSIBLE rung. Ending an account stays a
 * deliberate human act, and NOTHING IN THIS FILE TERMINATES ANYTHING. The sweep
 * stamps "past its deadline" and suspends; the second deadline is surfaced for
 * HQ to act on, never acted on here. That split is the whole reason the
 * automatic half is safe to run every minute.
 *
 * WHY THIS IS IN `services/` AND NOT `util/`. `util/README.md` draws the line at
 * domain knowledge — "If a helper knows what a deal or a fund is, it belongs in
 * `../services/`" — and a licence-notice sweep knows exactly that.
 * `renewalSweep`, `expirePartnerDeals` and `runCohortTimingTick` are the
 * precedents; the cron handler keeps only the cadence, the lazy import and the
 * `[cron]` line.
 *
 * IDEMPOTENT BY CONSTRUCTION, not by a claim row. Every write here is
 * conditional on the PRE-transition state (`status = 'issued'` for the flip,
 * `status = 'active'` for the suspend), so a second pass matches nothing. That
 * is the shape every minute-cadence sweep in this repo uses INSTEAD of a
 * `scheduled_jobs_audit` claim, which is reserved for side effects that are not
 * a state flip.
 *
 * THE TWO WRITES ARE INDEPENDENTLY IDEMPOTENT, AND THAT IS DELIBERATE. An
 * earlier shape flipped the notice and then suspended the licence, which would
 * have left the suspend unretryable if it failed: the notice was no longer
 * `issued`, so the next pass would skip the row entirely and the account would
 * read frozen while its licence still traded. The suspend is therefore driven
 * by the notice's CURRENT state rather than by the flip that produced it, so a
 * failed half is picked up on the next minute.
 *
 * `froze_at` IS THE COMPUTED DEADLINE, NEVER THE SWEEP'S OWN CLOCK — the D122
 * rule. The account stopped being able to write at `respond_by`; stamping
 * `datetime('now')` would record a freeze up to a cadence-interval late and make
 * the audit untrue in the one direction that flatters the operator. The cadence
 * then affects WHEN a row is written and never WHAT IT SAYS.
 */
import type { Env } from '../types';
import { FREEZING_STATUSES } from '../util/authErrors';

/** What a notice can be about. Mirrors migration 264's CHECK. */
export const NOTICE_KINDS = ['renewal_terms', 'fees', 'term_violation', 'other'] as const;
export type NoticeKind = typeof NOTICE_KINDS[number];

/**
 * How long an addressee gets. Bounded at both ends rather than free-form: a
 * zero-day deadline is a freeze wearing a notice's clothes, and a thousand-day
 * one is a ladder with no second rung.
 */
export const MIN_RESPOND_DAYS = 1;
export const MAX_RESPOND_DAYS = 90;
export const DEFAULT_RESPOND_DAYS = 14;

export interface SweepResult {
  /** Rows whose deadline had passed and that were still `issued`. */
  due: number;
  /** Rows this pass moved to `overdue` — a second pass reports 0. */
  froze: number;
  /** Licences this pass moved from `active` to `suspended`. */
  suspended: number;
  /** Addressees told. Best-effort; a failure here never blocks the flip. */
  notified: number;
  /**
   * `false` when the table could not be read at all. A missing `admin_notices`
   * is NOT "no notices are due" — the #204 lesson, and the reason
   * `admin_governance.test.ts` asserts the same distinction one table over.
   */
  readable: boolean;
}

type DueRow = {
  id: number; uid: string; user_id: number; licence_id: number | null;
  subject: string; respond_by: string; issued_by_user_id: number | null;
};

/**
 * How many notices currently hold this licence frozen.
 *
 * The predicate HQ's review reads before lifting a suspension: accepting one
 * notice lifts the freeze only when it was the last one holding it. Counting
 * rather than existence-checking so the caller can say "two more outstanding"
 * instead of a bare no.
 */
export async function freezeHoldersForLicence(env: Env, licenceId: number): Promise<number> {
  try {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM admin_notices
        WHERE licence_id = ? AND status IN (?, ?)`,
    ).bind(licenceId, ...FREEZING_STATUSES).first<{ n: number }>();
    return Number(row?.n ?? 0);
  } catch {
    // Unreadable answers "something still holds it", which is the safe
    // direction here: it declines to LIFT a freeze rather than declining to
    // apply one. The gate's own unreadable case fails the other way, and the
    // asymmetry is the point — neither guesses in the direction that acts.
    return 1;
  }
}

/**
 * Tell whoever administers this licence that something happened to it.
 *
 * WHY THIS EXISTS AT ALL. `routes/admin_licences.ts` contained ZERO `notify()`
 * calls before D135: suspending or terminating a licence changed four columns
 * in HQ's ledger and told the holder NOTHING — they found out by hitting a 423,
 * or by noticing their territory had been released. The owner's first sentence
 * about the ladder is "first admins get notified", so this is not an addition
 * to that flow; it is the missing half of it.
 *
 * FAN-OUT IS `notify()` AND NEVER A DIRECT SEND. It alone honours
 * `users.notification_prefs`, quiet hours, digest buffering and the WebSocket
 * push, and 37 modules already go through it.
 *
 * EVERY ADMINISTRATOR, not just the principal: `licence_admins` carries
 * `principal` and `delegate`, and a delegate who is not told their licence was
 * suspended is a delegate who keeps trading on it.
 *
 * BEST-EFFORT, and the caller never awaits it in a way that can fail the
 * transition. A licence that was suspended and whose holder could not be
 * reached is still suspended; reversing the write because the mail failed would
 * be the wrong half to undo.
 */
export async function notifyLicenceAdmins(
  env: Env,
  licenceId: number,
  args: { type: string; title: string; body: string; payload?: Record<string, unknown> },
  deps: { notify?: (env: Env, a: any) => Promise<unknown> } = {},
): Promise<number> {
  let ids: number[] = [];
  try {
    const res = await env.DB.prepare(
      'SELECT user_id FROM licence_admins WHERE licence_id = ?',
    ).bind(licenceId).all<{ user_id: number }>();
    ids = (res.results ?? []).map((r) => Number(r.user_id)).filter((n) => Number.isFinite(n));
  } catch (e) {
    console.warn('[compliance] licence_admins unreadable for notify', (e as Error).message);
    return 0;
  }
  if (ids.length === 0) return 0;
  let sent = 0;
  const notify = deps.notify ?? (await import('./notify')).notify;
  for (const userId of ids) {
    try {
      await notify(env, {
        userId,
        type: args.type,
        title: args.title,
        body: args.body,
        link: '/admin/my-licence',
        category: 'compliance',
        payload: args.payload,
      });
      sent += 1;
    } catch (e) { console.warn('[compliance] notify failed', (e as Error).message); }
  }
  return sent;
}

/**
 * The sweep. Moves every notice past its deadline to `overdue`, suspends the
 * licence behind it, and tells the addressee.
 *
 * `notify` is injected so the unit test can observe the fan-out without a
 * mailer — the `renewalSweep` shape.
 */
export async function freezeOverdueNotices(
  env: Env,
  deps: { notify?: (env: Env, args: any) => Promise<unknown> } = {},
): Promise<SweepResult> {
  const out: SweepResult = { due: 0, froze: 0, suspended: 0, notified: 0, readable: true };

  let due: DueRow[] = [];
  try {
    const res = await env.DB.prepare(
      `SELECT id, uid, user_id, licence_id, subject, respond_by, issued_by_user_id
         FROM admin_notices
        WHERE status = 'issued'
          AND datetime(respond_by) <= datetime('now')
        ORDER BY datetime(respond_by)`,
    ).all<DueRow>();
    due = res.results ?? [];
  } catch (e) {
    console.warn('[compliance] admin_notices unreadable on the sweep', (e as Error).message);
    out.readable = false;
    return out;
  }
  out.due = due.length;

  for (const row of due) {
    // THE CONDITIONAL UPDATE IS THE CLAIM. `changes === 1` means this pass — and
    // not a concurrent isolate, and not a previous minute — owned the
    // transition, so the notification below fires exactly once per notice
    // without a ledger table to keep.
    let owned = false;
    try {
      const r: any = await env.DB.prepare(
        `UPDATE admin_notices
            SET status = 'overdue', froze_at = respond_by, updated_at = datetime('now')
          WHERE id = ? AND status = 'issued'`,
      ).bind(row.id).run();
      owned = Number(r?.meta?.changes ?? 0) === 1;
    } catch (e) {
      console.error('[compliance] overdue flip failed', (e as Error).message);
      continue;
    }
    if (owned) out.froze += 1;

    if (!owned) continue;
    // NEVER A DIRECT sendEmail. `notify()` alone honours `notification_prefs`,
    // quiet hours, digest buffering and the WebSocket push, and 37 modules go
    // through it. `compliance` is deliberately NOT a critical category — a
    // deadline is exactly what quiet hours exist for.
    try {
      const notify = deps.notify ?? (await import('./notify')).notify;
      await notify(env, {
        userId: row.user_id,
        type: 'compliance_frozen',
        title: 'Your account is frozen until you answer HQ',
        body: `"${row.subject}" was not answered by ${row.respond_by}. Writes are paused; reading is not. Answering the notice is what lifts it.`,
        link: '/admin/my-licence',
        category: 'compliance',
        payload: { notice_uid: row.uid, respond_by: row.respond_by },
      });
      out.notified += 1;
    } catch (e) {
      console.warn('[compliance] freeze notification failed', (e as Error).message);
    }
  }

  // ── PASS TWO: SUSPEND, DRIVEN BY WHAT THE NOTICES SAY NOW ────────────────
  //
  // A SEPARATE PASS, AND A TEST IS WHY. The first draft suspended inside the
  // loop above, which meant the suspend could only ever run for a row this pass
  // had just flipped — so a pass that flipped the notice and then failed to
  // suspend would never be retried, because the next pass no longer selects a
  // row that is not `issued`. The account would read frozen while its licence
  // went on trading. The test written for the retry is what caught it.
  //
  // So the selection here is "every ACTIVE licence with a notice currently
  // holding it frozen", which is true of a row flipped a second ago and of one
  // flipped an hour ago whose suspend failed. Idempotent by the `status =
  // 'active'` predicate: once suspended, it matches nothing.
  let toSuspend: Array<{ id: number; uid: string; subject: string; issued_by_user_id: number | null }> = [];
  try {
    const res = await env.DB.prepare(
      `SELECT l.id, n.uid, n.subject, n.issued_by_user_id
         FROM territory_licences l
         JOIN admin_notices n ON n.licence_id = l.id
        WHERE l.status = 'active' AND n.status IN (?, ?)
        GROUP BY l.id`,
    ).bind(...FREEZING_STATUSES).all<{ id: number; uid: string; subject: string; issued_by_user_id: number | null }>();
    toSuspend = res.results ?? [];
  } catch (e) {
    console.error('[compliance] suspend scan failed', (e as Error).message);
    return out;
  }

  for (const l of toSuspend) {
    const note = `Frozen by HQ: "${l.subject}" was not answered by its deadline.`;
    const stamp = new Date().toISOString();
    try {
      const r: any = await env.DB.prepare(
        `UPDATE territory_licences
            SET status = 'suspended', status_note = ?, suspended_at = ?, updated_at = ?
          WHERE id = ? AND status = 'active'`,
      ).bind(note, stamp, stamp, l.id).run();
      if (Number(r?.meta?.changes ?? 0) !== 1) continue;
      out.suspended += 1;
      // Audited like every other licence transition. `suspended` is one of
      // migration 187's NINE allowed event values; inventing a tenth would
      // violate the CHECK — a live defect one route over, and not one to
      // reproduce here. The actor is the notice's ISSUER, because a sweep has
      // no human behind it and the decision that caused this was HQ's.
      await env.DB.prepare(
        `INSERT INTO licence_events (licence_id, event, detail_json, note, actor_user_id, created_at)
         VALUES (?, 'suspended', ?, ?, ?, ?)`,
      ).bind(
        l.id, JSON.stringify({ notice_uid: l.uid, automatic: true }), note,
        l.issued_by_user_id ?? null, stamp,
      ).run();
    } catch (e) {
      console.error('[compliance] licence suspend failed', (e as Error).message);
    }
  }

  return out;
}
