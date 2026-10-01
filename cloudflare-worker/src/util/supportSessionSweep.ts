/**
 * Close the audit row an HQ support session leaves on a branch (D122).
 *
 * WHY THIS EXISTS. D120 gave HQ a way to look at a subsidiary's account with
 * that account's own eyes, and made the branch keep its own audit trail so that
 * — in the canvas's words — a tenant does not have to ask HQ what was done to
 * it. The opening is recorded well. The closing could not happen at all.
 *
 * `redeemSupportCode` writes `impersonation_sessions` with `admin_user_id = 0`
 * (`rpc/branchOps.ts`), deliberately: the column is NOT NULL with no foreign
 * key, no user in THIS database opened the session, and a real HQ id there
 * would be joinable to a local `users` row and would name the wrong person with
 * complete confidence. Zero matches nobody, because AUTOINCREMENT starts at 1.
 *
 * That last clause is also, word for word, why the row could never close. The
 * only `SET ended_at` in the repo is `routes/admin.ts`'s
 * `POST /api/admin/impersonate-sessions/:id/end`, whose predicate is
 * `WHERE id = ? AND admin_user_id = ? AND ended_at IS NULL` — an HQ route, over
 * HQ's database, binding an id that can never equal 0. There is no branch-side
 * end route, and `SupportRedeemPage.jsx` has no exit handler, so nothing ever
 * stamped these rows.
 *
 * WHAT WAS ACTUALLY WRONG. Access expired on time: the token is minted for
 * `SUPPORT_SESSION_MINUTES` and `user_sessions.factor = 'hq_support'` is a gate
 * `requireFactor` fails closed on. The damage was to the record. HQ's Security
 * page reads `ended_at IS NULL` two ways — per row, where past the limit it
 * renders a red `not closed` card, and as the `Impersonations live` counter,
 * which every branch support session ever opened incremented permanently.
 *
 * THE END TIME IS COMPUTED, NOT OBSERVED. `ended_at` is
 * `started_at + SUPPORT_SESSION_MINUTES`, which is the instant the token
 * actually stopped working — not `datetime('now')`, which would record whenever
 * the sweep happened to run. That keeps the cadence a question of how promptly
 * a row is stamped and never a question of what it says, and it is the whole
 * reason this sweep can be exact.
 *
 * WHY IT IS SAFE ON EVERY TIER, AND THEREFORE NOT TIER-GATED. The obvious shape
 * was a branch-only cron block. It is unnecessary and weaker. `admin_user_id = 0`
 * is a value HQ can never write, so the predicate *is* the tier discriminator,
 * and it selects rows by what they are rather than by which deployment is
 * asking; on HQ it matches nothing and rides the `ix_imp_admin(admin_user_id,
 * started_at DESC)` prefix, so it costs an index probe. It also means a future
 * HQ-side support-session writer is covered the day it exists.
 *
 * AND WHY IT MUST NOT BE WIDENED TO ORDINARY IMPERSONATIONS. An HQ session can
 * be EXTENDED — `POST /api/admin/impersonate-sessions/:id/extend` grants a fresh
 * window and writes only an `activity_logs` row. Nothing about an extension
 * reaches this table, so on HQ `started_at + 30 minutes` is NOT the expiry, and
 * sweeping those rows would stamp a *false* end time where a null at least
 * claims nothing. A branch session has no extend path — one single-use code,
 * one mint — which is exactly what makes the arithmetic true here and only here.
 *
 * DATES ARE COMPARED IN ONE FORMAT, ON PURPOSE. `started_at` is
 * `TEXT NOT NULL DEFAULT (datetime('now'))`, i.e. `YYYY-MM-DD HH:MM:SS`, so
 * `datetime(started_at, …)` and `datetime('now')` are the same shape. A
 * JS `new Date().toISOString()` anywhere in here would reintroduce the defect
 * D120's own header describes at length: compared as TEXT, position 10 decides
 * it, `'T'` (0x54) beats `' '` (0x20), and the comparison stops meaning what it
 * reads as until the UTC date rolls over.
 */
import type { Env } from '../types';
import { SUPPORT_SESSION_MINUTES } from '../rpc/branchOps';

export interface SupportSessionSweepResult {
  /** Rows stamped on this pass. Zero is the steady state. */
  closed: number;
  /**
   * True when the table could not be read at all. `impersonation_sessions` is
   * runtime-bootstrapped as well as migrated (`services/cohortTiming.ts` mirrors
   * migration 156), so "no table" is a readable state a caller must be able to
   * tell apart from "no sessions have occurred" — the distinction #204 was
   * written about.
   */
  unreadable: boolean;
}

/**
 * Stamp `ended_at` on every HQ support session whose window has passed.
 *
 * Idempotent by construction: the `ended_at IS NULL` conjunct means a second
 * pass matches nothing, which is the same shape every other minute-cadence
 * sweep in the scheduled handler uses instead of a `scheduled_jobs_audit`
 * claim — that store is for jobs whose side effects are not a state flip.
 */
export async function closeExpiredSupportSessions(
  env: Env,
  minutes: number = SUPPORT_SESSION_MINUTES,
): Promise<SupportSessionSweepResult> {
  try {
    const r: any = await env.DB.prepare(
      `UPDATE impersonation_sessions
          SET ended_at = datetime(started_at, '+' || ? || ' minutes')
        WHERE admin_user_id = 0
          AND context LIKE 'hq_support:%'
          AND ended_at IS NULL
          AND datetime(started_at, '+' || ? || ' minutes') <= datetime('now')`,
    ).bind(minutes, minutes).run();
    return { closed: (r?.meta?.changes ?? r?.changes ?? 0) as number, unreadable: false };
  } catch (e) {
    console.error('[support-sweep] could not read impersonation_sessions', (e as Error).message);
    return { closed: 0, unreadable: true };
  }
}
