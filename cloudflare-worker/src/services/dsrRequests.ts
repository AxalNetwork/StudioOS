/**
 * D168 — the data-subject request ledger (migration 272).
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
import { adminAuditStatement } from './adminAudit';
import { hashEmail } from '../util/hashEmail';

/**
 * The outcomes HQ MAY RECORD — which is not the whole CHECK in migration 272.
 *
 * `withdrawn` is deliberately absent: it is the SUBJECT'S own act, written by
 * their cancel handler through `withdrawDsrRequest` below. An operator closing
 * a request as withdrawn would be recording that the subject changed their
 * mind when they did not.
 */
export const HQ_DSR_OUTCOMES = ['fulfilled', 'denied'] as const;

/**
 * The clock HQ's list runs, as the code has always run it (D4675 makes it
 * explicit and tested; it does not change it):
 *
 *   · it starts at RECEIPT, the stamp on `users.deletion_requested_at`;
 *   · it is DSR_CLOCK_DAYS spans of exactly 24 hours, counted in UTC, so a
 *     month's length, a leap day and a daylight-saving change move nothing;
 *   · nothing pauses or extends it — the ledger records no extension.
 *
 * Whether that is the right policy (a calendar month, an extension, a pause
 * while identity is checked) is the owner's and a legal reviewer's call,
 * asked on #4675. Until it is answered this is the rule, and the tests pin it.
 */
export const DSR_CLOCK_DAYS = 30;
export const DSR_DAY_MS = 86400000;

/**
 * A stored stamp as UTC milliseconds. D1 writes `datetime('now')`, which is
 * UTC with no zone suffix ('YYYY-MM-DD HH:MM:SS'); read without the `Z` it
 * would be taken as the server's local time and every clock would shift by
 * the offset. NaN for anything unparseable, so `dsrDaysLeft` says unknown.
 */
export function dsrStampMs(s: string | null | undefined): number {
  if (!s) return NaN;
  const iso = s.includes('T') ? s : `${s.replace(' ', 'T')}Z`;
  return Date.parse(iso);
}

/** The instant the clock runs out (receipt + DSR_CLOCK_DAYS × 24h), as ISO-8601 UTC, or null when unknown. */
export function dsrDeadlineIso(requestedMs: number, clockDays: number = DSR_CLOCK_DAYS): string | null {
  if (!Number.isFinite(requestedMs)) return null;
  return new Date(requestedMs + clockDays * DSR_DAY_MS).toISOString();
}

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
  return clockDays - Math.floor((nowMs - requestedMs) / DSR_DAY_MS);
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
 * D4675 — AN OPEN LEDGER ROW THE OPEN FLAG NO LONGER BACKS IS A WITHDRAWAL.
 *
 * Only two acts clear `users.deletion_requested_at`: the subject's cancel and
 * HQ's close, and HQ's close moves the ledger in the same batch. So an open
 * row whose `requested_at` is not the flag's current value is a cancel whose
 * ledger write did not land (before D4675 the two were separate writes). It is
 * recorded as the subject's withdrawal, which is what happened, and that frees
 * the one-open-row index for the request the flag now holds. A row that does
 * match the flag is left alone.
 */
function reconcileOrphanStatement(env: Env, userId: number) {
  return env.DB.prepare(
    `UPDATE dsr_requests SET outcome = 'withdrawn', closed_at = datetime('now')
      WHERE user_id = ? AND outcome IS NULL
        AND requested_at IS NOT (SELECT deletion_requested_at FROM users WHERE id = ?)`,
  ).bind(userId, userId);
}

/**
 * D4675 — THE SUBJECT ASKS: the open flag and the ledger row in ONE batch.
 *
 * Before, the flag was set first and the ledger row written after, as a
 * separate statement, so an interruption between them left an open request
 * the ledger did not hold. Now both land together. If the batch cannot run —
 * a database without migration 272 has no ledger — the flag alone is set,
 * because a member must never be unable to ask; HQ's close derives the row.
 * `ledger` says which happened.
 */
export async function requestErasure(env: Env, userId: number): Promise<{ ledger: boolean }> {
  const flag = env.DB.prepare(
    "UPDATE users SET deletion_requested_at = COALESCE(deletion_requested_at, datetime('now')) WHERE id = ?",
  ).bind(userId);
  try {
    await env.DB.batch([
      flag,
      reconcileOrphanStatement(env, userId),
      env.DB.prepare(
        `INSERT OR IGNORE INTO dsr_requests (user_id, requested_at)
         SELECT id, deletion_requested_at FROM users
          WHERE id = ? AND deletion_requested_at IS NOT NULL`,
      ).bind(userId),
    ]);
    return { ledger: true };
  } catch (e) {
    console.warn('[dsr] request ledger batch failed; recording the flag alone', (e as Error).message);
    await env.DB.prepare(
      "UPDATE users SET deletion_requested_at = COALESCE(deletion_requested_at, datetime('now')) WHERE id = ?",
    ).bind(userId).run();
    return { ledger: false };
  }
}

/**
 * D4675 — THE SUBJECT CANCELS: the flag and the withdrawal in ONE batch.
 *
 * `cancelled` is true only when a request was actually open. A cancel that
 * finds none (HQ closed it a moment earlier) changes nothing and says so,
 * rather than writing "cancelled" over a decision already recorded. The same
 * fallback as `requestErasure`: without a ledger the flag is still cleared.
 */
export async function cancelErasure(env: Env, userId: number): Promise<{ cancelled: boolean; ledger: boolean }> {
  try {
    const out = await env.DB.batch([
      env.DB.prepare(
        'UPDATE users SET deletion_requested_at = NULL WHERE id = ? AND deletion_requested_at IS NOT NULL',
      ).bind(userId),
      env.DB.prepare(
        `UPDATE dsr_requests SET outcome = 'withdrawn', closed_at = datetime('now')
          WHERE user_id = ? AND outcome IS NULL`,
      ).bind(userId),
    ]);
    return { cancelled: Number(out?.[0]?.meta?.changes) > 0, ledger: true };
  } catch (e) {
    console.warn('[dsr] cancel ledger batch failed; clearing the flag alone', (e as Error).message);
    const r = await env.DB.prepare(
      'UPDATE users SET deletion_requested_at = NULL WHERE id = ? AND deletion_requested_at IS NOT NULL',
    ).bind(userId).run();
    return { cancelled: Number(r?.meta?.changes) > 0, ledger: false };
  }
}

/** A close key: what the client generated once for one close, and reuses on every retry of it. */
export const DSR_CLOSE_KEY_RE = /^[A-Za-z0-9_-]{16,100}$/;

export type DsrCloseInput = {
  userId: number;
  actorUserId: number;
  actorEmail: string;
  outcome: HqDsrOutcome;
  reason: string;
  /** The receipt stamp of the request the operator reviewed, exactly as the list showed it. */
  requestedAt: string;
  /** The ledger row the list showed, or null for a request the ledger does not hold yet. */
  requestId: number | null;
  closeKey: string;
};

export type DsrClosedLedgerRow = {
  id: number; user_id: number; requested_at: string; outcome: string;
  closed_at: string | null; closed_by_user_id: number | null;
};

export type DsrCloseResult =
  /** This close is on record. `replayed`: it was already, from an earlier attempt with the same key. */
  | { status: 'closed'; replayed: boolean; row: DsrClosedLedgerRow }
  /** A different request is open now (the subject withdrew and asked again). Nothing was written. */
  | { status: 'stale'; current_requested_at: string }
  /** No request is open: it was closed or withdrawn first. Nothing was written. */
  | { status: 'not_open'; last: { outcome: string; closed_at: string | null } | null }
  /** The key belongs to a different close. Nothing was written. */
  | { status: 'key_conflict' }
  /** The batch ran, and what it did could not be read back. Retrying with the same key is safe. */
  | { status: 'unconfirmed'; reason: string };

async function closedByKey(env: Env, closeKey: string): Promise<DsrClosedLedgerRow | null> {
  return (await env.DB.prepare(
    `SELECT id, user_id, requested_at, outcome, closed_at, closed_by_user_id
       FROM dsr_requests WHERE close_key = ?`,
  ).bind(closeKey).first<DsrClosedLedgerRow>()) ?? null;
}

/** A row found by key is this close only if it is the same subject, operator and outcome. */
function sameClose(row: DsrClosedLedgerRow, input: DsrCloseInput): boolean {
  return Number(row.user_id) === input.userId
    && Number(row.closed_by_user_id) === input.actorUserId
    && row.outcome === input.outcome;
}

/**
 * HQ CLOSES ONE REQUEST — THE ONE THE OPERATOR REVIEWED — IN ONE BATCH.
 *
 * D168 put the ledger row and the open flag in one batch. D4675 adds what
 * that batch did not guarantee:
 *
 *   · THE EXACT REQUEST. The caller names the request it reviewed by its
 *     receipt stamp (and ledger id when it has one). The close applies only
 *     while that request is still the open one; if the subject withdrew and
 *     asked again, the new request is NOT closed on the strength of a review
 *     of the old one.
 *   · ONE RECORD PER ACT. Every statement after the claim is conditioned on
 *     the claim having changed a row, so a close that lost a race writes no
 *     notice to the subject and no audit row for an act that did not happen.
 *   · THE AUDIT EVIDENCE IN THE SAME UNIT. The `admin_audit_log` row and the
 *     actor's `activity_logs` row are in the batch, not written afterwards,
 *     so the decision and its record land together or not at all.
 *   · A RETRY IS NOT A SECOND ACT. The key is stored on the row; an attempt
 *     whose key is already on record answers with that record.
 *
 * Statement order is load-bearing: each `changes() > 0` reads the statement
 * just before it. The caller must have run `ensureAdminAuditLogTable`.
 * Throws when the batch cannot run; D1 rolls a failed batch back whole.
 */
export async function closeDsrRequest(env: Env, input: DsrCloseInput): Promise<DsrCloseResult> {
  const { userId, actorUserId, outcome, reason, requestedAt, requestId, closeKey } = input;

  const prior = await closedByKey(env, closeKey);
  if (prior) return sameClose(prior, input) ? { status: 'closed', replayed: true, row: prior } : { status: 'key_conflict' };

  const auditDetails = { reason, target_user_id: userId, outcome, requested_at: requestedAt, close_key: closeKey };
  const actorHash = await hashEmail(input.actorEmail || '');
  try {
    await env.DB.batch([
      reconcileOrphanStatement(env, userId),
      // Derive the row for a request made before migration 272 — only for the
      // request reviewed: the flag must still hold that exact stamp.
      env.DB.prepare(
        `INSERT OR IGNORE INTO dsr_requests (user_id, requested_at)
         SELECT id, deletion_requested_at FROM users
          WHERE id = ? AND deletion_requested_at = ?`,
      ).bind(userId, requestedAt),
      // THE CLAIM. Everything below is conditioned on it.
      env.DB.prepare(
        `UPDATE dsr_requests
            SET outcome = ?, closed_at = datetime('now'), closed_by_user_id = ?, close_reason = ?, close_key = ?
          WHERE user_id = ? AND outcome IS NULL AND requested_at = ?
            AND (? IS NULL OR id = ?)
            AND EXISTS (SELECT 1 FROM users WHERE id = ? AND deletion_requested_at = ?)`,
      ).bind(outcome, actorUserId, reason, closeKey, userId, requestedAt, requestId, requestId, userId, requestedAt),
      // ADDRESSED TO THE SUBJECT: `user_id` is what routes/activity.ts
      // GET /recent reads for a person's own feed.
      env.DB.prepare(
        `INSERT INTO activity_logs (action, details, actor, user_id)
         SELECT 'account_deletion_request_closed', ?, 'Axal VC HQ', ? WHERE changes() > 0`,
      ).bind(`Your erasure request was recorded as ${outcome} by Axal VC HQ. Reason: ${reason}`, userId),
      // HQ's governance feed reads this one (D159).
      adminAuditStatement(env, actorUserId, 'dsr_request_closed', auditDetails, { onlyIfChanged: true }),
      // The hashed-actor row `logAdminAction` writes for every admin act (T22.1).
      env.DB.prepare(
        `INSERT INTO activity_logs (action, details, actor, user_id)
         SELECT 'dsr_request_closed', ?, ?, ? WHERE changes() > 0`,
      ).bind(JSON.stringify(auditDetails), actorHash, actorUserId),
      // The open flag, last, and only for the request this close claimed.
      env.DB.prepare(
        `UPDATE users SET deletion_requested_at = NULL
          WHERE id = ? AND deletion_requested_at = ?
            AND EXISTS (SELECT 1 FROM dsr_requests WHERE close_key = ?)`,
      ).bind(userId, requestedAt, closeKey),
    ]);
  } catch (e) {
    // Two identical retries racing: the second hits the key's unique index.
    // If the key is on record, that is this close; otherwise the failure is real.
    let raced: DsrClosedLedgerRow | null = null;
    try { raced = await closedByKey(env, closeKey); } catch { raced = null; }
    if (raced) return sameClose(raced, input) ? { status: 'closed', replayed: true, row: raced } : { status: 'key_conflict' };
    throw e;
  }

  try {
    const row = await closedByKey(env, closeKey);
    if (row) return sameClose(row, input) ? { status: 'closed', replayed: false, row } : { status: 'key_conflict' };
    const user = await env.DB.prepare('SELECT deletion_requested_at FROM users WHERE id = ?')
      .bind(userId).first<{ deletion_requested_at: string | null }>();
    if (user?.deletion_requested_at) return { status: 'stale', current_requested_at: user.deletion_requested_at };
    const last = await env.DB.prepare(
      `SELECT outcome, closed_at FROM dsr_requests
        WHERE user_id = ? AND outcome IS NOT NULL
        ORDER BY closed_at DESC, id DESC LIMIT 1`,
    ).bind(userId).first<{ outcome: string; closed_at: string | null }>();
    return { status: 'not_open', last: last ? { outcome: last.outcome, closed_at: last.closed_at ?? null } : null };
  } catch (e) {
    return {
      status: 'unconfirmed',
      reason: `The close was sent, and what it recorded could not be read back. (${(e as Error).message})`,
    };
  }
}

/**
 * D4675 — the open ledger row behind each open request, so HQ's list can name
 * the exact request a close targets. `null` when the ledger cannot be read:
 * the close then targets the request by its receipt stamp alone.
 */
export async function loadOpenDsrRequestIds(env: Env): Promise<Map<number, { id: number; requested_at: string }> | null> {
  try {
    const rows = await env.DB.prepare(
      'SELECT id, user_id, requested_at FROM dsr_requests WHERE outcome IS NULL',
    ).all<{ id: number; user_id: number; requested_at: string }>();
    const out = new Map<number, { id: number; requested_at: string }>();
    for (const r of rows.results || []) out.set(Number(r.user_id), { id: Number(r.id), requested_at: r.requested_at });
    return out;
  } catch {
    return null;
  }
}

/**
 * WHAT EACH SUBJECT HAS ASKED BEFORE — and its failure is its own state.
 *
 * `dsr_requests` arrives with migration 272 and carries no runtime bootstrap
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
        + `not zero. Migration 272 creates it. (${(e as Error).message})`,
    };
  }
}

export type DsrClosedRow = { outcome: string; closed_at: string | null; close_reason: string | null };
export type DsrOwnOutcome =
  | { available: true; last_closed: DsrClosedRow | null }
  | { available: false; reason: string };

/**
 * D169 — WHAT THE SUBJECT IS TOLD, on the screen where they asked.
 *
 * THE DEFECT THIS CLOSES. `users.deletion_requested_at` is the open flag and
 * `closeDsrRequest` clears it, so the moment HQ decides, Settings' amber
 * "Deletion requested <date>" line simply DISAPPEARS. The subject asked,
 * waited out a statutory clock, and the screen returns to as if they never
 * asked. D168's close does write them an `activity_logs` row, so the outcome
 * reaches the Cmd+K recent feed — capped at 20 rows, on a surface nobody
 * checks for this. A denial that vanishes silently is the worst of the three
 * outcomes, and this is the read that stops it.
 *
 * THE SUBJECT'S OWN ROW, not HQ's rollup. `loadDsrHistory` above is the
 * cross-subject GROUP BY that HQ's list needs; this is one subject's terminal
 * state, so it is a different query rather than a filter over that one — and
 * it rides `idx_dsr_requests_user(user_id, …)`.
 *
 * `outcome` IS THE DISCRIMINATOR between HQ's decision and the subject's own
 * withdrawal, and `closed_by_user_id` is deliberately not selected for it:
 * `withdrawn` is writable only by `withdrawDsrRequest`, since HQ's route gates
 * on `isHqDsrOutcome` and that list omits it. A second column to say the same
 * thing would be a second thing that can disagree.
 *
 * NO OUTCOME IS FILTERED OUT, and the reason is a bug that filtering causes.
 * Hiding `withdrawn` because the subject already knows they cancelled would
 * surface the NEXT row down — so someone who was denied, asked again and then
 * withdrew would be shown the OLD denial as their current state. One row, the
 * last one, whatever it says.
 *
 * UNREADABLE IS NOT "NEVER ASKED" (#204, and `loadDsrHistory`'s own rule).
 * `dsr_requests` arrives with migration 272 and has no runtime bootstrap, so a
 * database behind on migrations has no table — and rendering that as silence
 * would reproduce the exact defect above, on the exact screen, for the subject
 * whose request WAS decided.
 */
export async function loadOwnDsrOutcome(env: Env, userId: number): Promise<DsrOwnOutcome> {
  try {
    const row = await env.DB.prepare(
      `SELECT outcome, closed_at, close_reason
         FROM dsr_requests
        WHERE user_id = ? AND outcome IS NOT NULL
        ORDER BY closed_at DESC, id DESC
        LIMIT 1`,
    ).bind(userId).first<{ outcome: string; closed_at: string | null; close_reason: string | null }>();
    if (!row) return { available: true, last_closed: null };
    return {
      available: true,
      last_closed: {
        outcome: row.outcome,
        closed_at: row.closed_at ?? null,
        close_reason: row.close_reason ?? null,
      },
    };
  } catch (e) {
    return {
      available: false,
      reason: 'The record of any earlier deletion request could not be read just now, so what was decided '
        + `is unknown — not "nothing was". Migration 272 creates it. (${(e as Error).message})`,
    };
  }
}
