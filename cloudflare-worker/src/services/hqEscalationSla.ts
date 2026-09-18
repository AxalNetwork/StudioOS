/**
 * A breached HQ SLA tells somebody (D143).
 *
 * WHAT WAS BROKEN. `hq_escalations` (migration 259) stores a `due_at` per row,
 * and `slaBand()` in `rpc/hqOps.ts` derives `ok` / `due_soon` / `past` from it
 * on every read — so S3 and H1 both draw the band, and both draw it correctly.
 * Nothing acted on it. `due_at` had no reader anywhere in the scheduled
 * handler, so a subsidiary that escalated something and heard nothing was
 * waiting on an answer no clock was chasing: the badge turned red and the
 * silence was the whole feature.
 *
 * WHY THIS IS IN `services/` AND NOT `util/`. `util/README.md` draws the line at
 * domain knowledge — "If a helper knows what a deal or a fund is, it belongs in
 * `../services/`" — and a sweep that knows what an escalation is and who HQ is
 * knows exactly that. `complianceLadder`, `renewalSweep` and `runCohortTimingTick`
 * are the precedents; the cron handler keeps only the cadence, the lazy import
 * and the `[cron]` line.
 *
 * `datetime()` ON BOTH SIDES, AND THIS IS THE LOAD-BEARING LINE IN THE FILE.
 * `hq_escalations` carries TWO timestamp formats in one row: `created_at` and
 * `updated_at` default to `datetime('now')` (SQLite's 'YYYY-MM-DD HH:MM:SS'),
 * while `due_at` is written from JavaScript as ISO-8601
 * (`new Date(...).toISOString()`, `rpc/hqOps.ts`). A bare
 * `due_at <= CURRENT_TIMESTAMP` therefore compares an ISO string against a
 * different format, which does not fail — it silently holds until the UTC date
 * rolls over. That is the defect class this repo has been bitten by in the magic
 * link, the support code and two trust sweeps. Wrapping BOTH sides in
 * `datetime()` normalises either format to the same one, so the comparison is
 * correct whichever way the column was written, and
 * `scripts/check-timestamp-comparisons.mjs` blesses exactly this shape through
 * its negative lookbehind. `due_at` joins that guard's `TTL_COLUMN` in the same
 * change, which is what the guard's own header asks for: "Adding the name here
 * and the column there in one commit is what keeps that true."
 *
 * THE CLAIM IS A COLUMN, NOT A STATE FLIP, AND THAT IS DELIBERATE. Every
 * minute-cadence sweep in this repo is idempotent by construction — the WHERE
 * matches only rows in the pre-transition state, so a second pass matches
 * nothing — and reserves a ledger row for side effects that are not a state
 * flip. Sending mail IS such a side effect, and there is no state flip to hang
 * it on: a breached escalation is still `open` afterwards, because a breach does
 * not answer it. Without `sla_breach_notified_at` the sweep would re-warn every
 * minute forever. Migration 267 adds it; the conditional UPDATE below is what
 * makes owning it atomic.
 *
 * IT STAMPS THE SWEEP'S OWN CLOCK, WHICH IS NOT A BREACH OF THE D122 RULE.
 * `complianceLadder.ts` states that rule for `froze_at`: stamp the computed
 * deadline, never the sweep's clock, because the account stopped being able to
 * write at `respond_by` and recording the sweep's clock would make the audit
 * untrue in the direction that flatters the operator. Here the act being
 * recorded is the NOTIFICATION, which genuinely happened when the sweep ran, and
 * the breach's own moment already has a column — `due_at`. So the two rules
 * agree: each stamp says when its own event happened.
 *
 * NOT GATED ON `hqCadences`, on the D122 precedent and for its stated reason:
 * `hq_escalations` is HQ's table and a branch holds none of its rows, so the
 * sweep's own predicate IS the tier discriminator and a better one — it selects
 * rows by what they are, not by which deployment is asking. On a branch it
 * matches nothing and costs an index probe.
 *
 * IT NEVER ANSWERS AN ESCALATION. The sweep reports that a deadline passed.
 * Answering stays a deliberate human act on `PATCH /api/admin/escalations/:uid`,
 * the same split that makes the compliance ladder's automatic half safe to run
 * on a clock.
 */
import type { Env } from '../types';

export interface SlaSweepResult {
  /** Rows past `due_at`, still open, and not yet reported. */
  breached: number;
  /**
   * Rows THIS pass owned. A second pass reports 0, which is the proof the claim
   * works rather than a sign nothing happened.
   */
  reported: number;
  /** HQ notifications actually sent. Best-effort; a failure never un-owns a row. */
  notified: number;
  /**
   * `false` when the table could not be read at all — a missing
   * `hq_escalations`, or a database that has not applied migration 267 and so
   * has no `sla_breach_notified_at` column. Neither is "no SLA has been
   * breached", which is the #204 lesson: an unreadable store must not answer as
   * a cheerful zero. The caller logs the distinction.
   */
  readable: boolean;
}

type BreachedRow = {
  id: number;
  uid: string;
  branch_code: string;
  kind: string;
  subject: string;
  due_at: string;
  raised_by_name: string | null;
};

/**
 * Whole days a deadline is past, floored, for copy that reads naturally.
 *
 * Exported so the test can pin it without going through the sweep: "3 days
 * overdue" is the kind of arithmetic that is wrong by one for a week before
 * anybody notices.
 */
export function daysOverdue(dueAt: string, nowMs: number): number {
  const due = Date.parse(dueAt.includes('T') ? dueAt : `${dueAt.replace(' ', 'T')}Z`);
  if (!Number.isFinite(due)) return 0;
  return Math.max(0, Math.floor((nowMs - due) / 86_400_000));
}

/** How the breach reads to the person who has to act on it. */
function breachBody(row: BreachedRow, nowMs: number): string {
  const days = daysOverdue(row.due_at, nowMs);
  const late = days >= 1 ? `${days} day${days === 1 ? '' : 's'} past its deadline` : 'past its deadline';
  const who = row.raised_by_name ? ` (raised by ${row.raised_by_name})` : '';
  return `${row.branch_code} raised "${row.subject}"${who} and it is ${late}. `
    + 'It is still open and still waiting on an answer from HQ.';
}

/**
 * Report every open escalation whose SLA has passed, exactly once each.
 *
 * `deps.notify` is injectable for the same reason `complianceLadder`'s is: a
 * sweep whose only observable effect is a fan-out cannot be tested without
 * standing in for the fan-out.
 */
export async function reportBreachedEscalations(
  env: Env,
  deps: { notify?: (env: Env, args: any) => Promise<unknown>; now?: number } = {},
): Promise<SlaSweepResult> {
  const out: SlaSweepResult = { breached: 0, reported: 0, notified: 0, readable: true };
  const nowMs = deps.now ?? Date.now();

  let rows: BreachedRow[] = [];
  try {
    const res = await env.DB.prepare(
      `SELECT id, uid, branch_code, kind, subject, due_at, raised_by_name
         FROM hq_escalations
        WHERE status = 'open'
          AND due_at IS NOT NULL
          AND sla_breach_notified_at IS NULL
          AND datetime(due_at) <= datetime('now')
        ORDER BY datetime(due_at)`,
    ).all<BreachedRow>();
    rows = res.results ?? [];
  } catch (e) {
    console.warn('[hq-sla] hq_escalations unreadable on the sweep', (e as Error).message);
    out.readable = false;
    return out;
  }
  out.breached = rows.length;
  if (!rows.length) return out;

  // HQ IS WHOEVER HOLDS THE ELEVATION, read once rather than per row. The same
  // lookup `routes/licence.ts` already uses to tell HQ a notice was answered.
  let hq: number[] = [];
  try {
    const res = await env.DB.prepare('SELECT user_id FROM super_admins').all<{ user_id: number }>();
    hq = (res.results || []).map((r) => Number(r.user_id)).filter((n) => Number.isFinite(n) && n > 0);
  } catch (e) {
    console.warn('[hq-sla] super_admins unreadable; breaches will be claimed but not sent', (e as Error).message);
  }

  for (const row of rows) {
    // THE CONDITIONAL UPDATE IS THE CLAIM. `changes === 1` means this pass — and
    // not a concurrent isolate, and not a previous minute — owned this row, so
    // the notification below fires exactly once per escalation.
    let owned = false;
    try {
      const r: any = await env.DB.prepare(
        `UPDATE hq_escalations
            SET sla_breach_notified_at = datetime('now'), updated_at = datetime('now')
          WHERE id = ? AND sla_breach_notified_at IS NULL`,
      ).bind(row.id).run();
      owned = Number(r?.meta?.changes ?? 0) === 1;
    } catch (e) {
      console.error('[hq-sla] claim failed', (e as Error).message);
      continue;
    }
    if (!owned) continue;
    out.reported += 1;

    // NEVER A DIRECT sendEmail. `notify()` alone honours `notification_prefs`,
    // quiet hours, digest buffering and the WebSocket push. `compliance` is
    // deliberately NOT a critical category — a missed deadline is exactly what
    // quiet hours and the digest exist for.
    //
    // A SEND THAT FAILS DOES NOT UN-CLAIM THE ROW, and that is the safer
    // direction: re-claiming would re-warn on every subsequent minute, turning
    // one unreachable mailbox into an unbounded stream. The failure is logged
    // and the row stays reported.
    try {
      const notify = deps.notify ?? (await import('./notify')).notify;
      for (const userId of hq) {
        await notify(env, {
          userId,
          type: 'hq_escalation_sla_breached',
          title: 'An escalation is past its SLA',
          body: breachBody(row, nowMs),
          link: '/hq',
          category: 'compliance',
          payload: { escalation_uid: row.uid, branch_code: row.branch_code, kind: row.kind, due_at: row.due_at },
        });
        out.notified += 1;
      }
    } catch (e) {
      console.warn('[hq-sla] notify failed', (e as Error).message);
    }
  }

  return out;
}
