/**
 * D168 — the data-subject request ledger (migration 271).
 *
 * WHY THIS IS A SERVICE AND NOT THREE COPIES IN THREE HANDLERS. The ledger has
 * three writers — the subject's request, the subject's cancel, and HQ's close —
 * living in two route files, and every one of them has to move
 * `users.deletion_requested_at` in the same breath as the ledger row or the two
 * disagree. Written three times, one of them eventually would not. It is in
 * `services/` rather than `util/` on `util/README.md`'s own line: this knows
 * what a data-subject request is, which is domain knowledge.
 *
 * The second reason is testability, and it is the `supportSessionSweep` (D122)
 * precedent: an invariant that only exists inside a Hono handler can be
 * asserted by scanning the handler's source, and a source scan cannot show that
 * a close actually clears the flag, that a second request after a denial opens
 * a NEW row, or that an unreadable ledger reports itself instead of reading as
 * "nobody has ever asked". Those are the claims, so they are exercised against
 * a real database here.
 *
 * WHAT `fulfilled` MEANS, once, where every caller can see it: the manual
 * erasure was carried out. This platform performs none — there is no
 * DELETE FROM users, no `deleted_at` and no anonymisation anywhere in the
 * codebase, and inventing one needs a retention and legal-hold policy nobody
 * has written. The outcome is a decision record. An audit row implying a
 * deletion that did not happen would be worse than the gap it closes.
 */
import type { Env } from '../types';

/**
 * The outcomes HQ MAY RECORD — which is not the whole CHECK in migration 271.
 *
 * `withdrawn` is deliberately absent: it is the SUBJECT'S own act, written by
 * their cancel handler through `withdrawDsrRequest` below. An operator closing
 * a request as withdrawn would be recording that the subject changed their
 * mind when they did not.
 */
export const HQ_DSR_OUTCOMES = ['fulfilled', 'denied'] as const;

/** GDPR Art. 12(3): one month from receipt. Counted from the request, not from triage. */
export const DSR_CLOCK_DAYS = 30;

/**
 * Days remaining on the statutory clock — negative once it has run out.
 *
 * EXTRACTED BECAUSE IT HAD NEVER BEEN TESTED. This arithmetic has driven an
 * amber zone, a red "Nd overdue" and a headline "inside deadline pressure"
 * count since the Security page shipped, and no assertion anywhere touched
 * it: inverting the subtraction would have turned every overdue request into
 * one with weeks left, on the one screen where that is a compliance failure
 * rather than a wrong number.
 *
 * `null` for an unparseable stamp, never 0: an unknown clock is not a clock
 * at zero, and rendering it as one would put a request at its deadline that
 * may have days left, or the reverse.
 */
export function dsrDaysLeft(requestedMs: number, nowMs: number, clockDays: number = DSR_CLOCK_DAYS): number | null {
  if (!Number.isFinite(requestedMs)) return null;
  return clockDays - Math.floor((nowMs - requestedMs) / 86400000);
}
export type HqDsrOutcome = (typeof HQ_DSR_OUTCOMES)[number];

export function isHqDsrOutcome(value: string): value is HqDsrOutcome {
  return (HQ_DSR_OUTCOMES as readonly string[]).includes(value);
}

export type DsrHistoryEntry = { prior: number; outcome: string | null; closed_at: string | null };
export type DsrHistory =
  | { available: true; byUser: Map<number, DsrHistoryEntry> }
  | { available: false; reason: string };

/**
 * OPEN THE ROW HQ CAN LATER CLOSE, from the timestamp the column already holds.
 *
 * `requested_at` is SELECTed rather than written a second time, so the
 * statutory clock has ONE value however often this runs, and `OR IGNORE`
 * against `uq_dsr_requests_open` mirrors the caller's own
 * `COALESCE(deletion_requested_at, …)`: asking twice while one is open is a
 * no-op on both halves rather than a second clock.
 *
 * Call it AFTER the column is set — it reads that column, and with it unset it
 * correctly writes nothing.
 */
export async function openDsrRequest(env: Env, userId: number): Promise<void> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO dsr_requests (user_id, requested_at)
     SELECT id, deletion_requested_at FROM users
      WHERE id = ? AND deletion_requested_at IS NOT NULL`,
  ).bind(userId).run();
}

/**
 * The subject withdrew it themselves. `closed_by_user_id` stays NULL on
 * purpose: naming an operator here would record an act nobody performed.
 */
export async function withdrawDsrRequest(env: Env, userId: number): Promise<void> {
  await env.DB.prepare(
    `UPDATE dsr_requests SET outcome = 'withdrawn', closed_at = datetime('now')
      WHERE user_id = ? AND outcome IS NULL`,
  ).bind(userId).run();
}

/**
 * HQ closes one, and BOTH HALVES MOVE IN ONE BATCH.
 *
 * The ledger row is the record and `users.deletion_requested_at` is the open
 * flag. If either moved alone they would disagree and the disagreement would
 * be invisible — a closed request still listed, or an open one nobody can see.
 * If the batch cannot run, nothing moves: clearing the flag with no record is
 * strictly worse than failing, so this throws and the caller says why.
 *
 * Statement 1 DERIVES the open row when there is none. A request made before
 * migration 271 has a timestamp on `users` and no ledger row, and carrying the
 * fact the database already holds is a different act from the backfill D136
 * refused — that one would have written an acceptance nobody gave.
 */
export async function closeDsrRequest(
  env: Env,
  opts: { userId: number; actorUserId: number; outcome: HqDsrOutcome; reason: string },
): Promise<void> {
  const { userId, actorUserId, outcome, reason } = opts;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO dsr_requests (user_id, requested_at)
       SELECT id, deletion_requested_at FROM users
        WHERE id = ? AND deletion_requested_at IS NOT NULL`,
    ).bind(userId),
    env.DB.prepare(
      `UPDATE dsr_requests
          SET outcome = ?, closed_at = datetime('now'), closed_by_user_id = ?, close_reason = ?
        WHERE user_id = ? AND outcome IS NULL`,
    ).bind(outcome, actorUserId, reason, userId),
    env.DB.prepare(
      'UPDATE users SET deletion_requested_at = NULL WHERE id = ?',
    ).bind(userId),
    // ADDRESSED TO THE SUBJECT, not to the operator: `user_id` is what
    // routes/activity.ts GET /recent reads for a person's own feed, so this
    // row is how they learn the outcome. HQ's side is `logAdminAction` at the
    // call site; this one is theirs — the two-row shape `toggle-active` uses.
    env.DB.prepare(
      `INSERT INTO activity_logs (action, details, actor, user_id)
       VALUES ('account_deletion_request_closed', ?, ?, ?)`,
    ).bind(
      `Your erasure request was recorded as ${outcome} by Axal VC HQ. Reason: ${reason}`,
      'Axal VC HQ',
      userId,
    ),
  ]);
}

/**
 * WHAT EACH SUBJECT HAS ASKED BEFORE — and its failure is its own state.
 *
 * `dsr_requests` arrives with migration 271 and carries no runtime bootstrap
 * (migration 264's shape), so a database that has not applied it has no table.
 * "This subject has never asked before" is a CLAIM; an unreadable store has
 * not made it. Returning zeros here would be the #204 defect — a cheerful
 * number standing in for an answer nobody has — on a screen where a third ask
 * read as a first changes what an operator decides.
 */
export async function loadDsrHistory(env: Env): Promise<DsrHistory> {
  try {
    // The bare columns beside MAX() are SQLite's documented min/max rule: they
    // come from the row that supplied the maximum, so `outcome` is the outcome
    // OF the most recent close rather than an arbitrary one. Deliberate, and
    // named because it reads as accidental otherwise.
    const closed = await env.DB.prepare(
      `SELECT user_id, COUNT(*) AS prior, outcome, MAX(closed_at) AS closed_at
         FROM dsr_requests
        WHERE outcome IS NOT NULL
        GROUP BY user_id`,
    ).all<{ user_id: number; prior: number; outcome: string; closed_at: string }>();
    const byUser = new Map<number, DsrHistoryEntry>();
    for (const row of closed.results || []) {
      byUser.set(Number(row.user_id), {
        prior: Number(row.prior) || 0,
        outcome: row.outcome ?? null,
        closed_at: row.closed_at ?? null,
      });
    }
    return { available: true, byUser };
  } catch (e) {
    return {
      available: false,
      reason: 'The request ledger could not be read, so how often each subject has asked before is unknown — '
        + `not zero. Migration 271 creates it. (${(e as Error).message})`,
    };
  }
}
