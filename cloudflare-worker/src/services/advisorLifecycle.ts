/**
 * D4692 (#4692) — the two lifecycle graphs of Advisor › Practice, each ONE table
 * every route that changes the state reads, and the ledger of who decided.
 *
 * BOOKINGS. `pending` is a request, `confirmed` an agreed session; `completed`,
 * `cancelled` and `no_show` are final. `BOOKING_TRANSITIONS` lists, for each
 * state, the states a route may move it to. A write is `UPDATE … WHERE id = ?
 * AND status = <the state the caller read>` and its affected-row count is
 * checked: a request that lost a race changed nothing and answers 409.
 *
 * ENGAGEMENTS. `ENGAGEMENT_ADVANCE` lists the lane moves `POST /advance` may
 * make. Moves that end or renew a SIGNED relationship are not in it; they go
 * through `POST /renewal`, which records the decision the renewal rate counts.
 * WHETHER AN ENGAGEMENT WAS EVER SIGNED IS A FACT OF ITS HISTORY, NOT OF ITS
 * LANE: `cycles` is 0 until signing starts the first term and never goes down,
 * so `cycles > 0` (or a `started_at`) means signed once, whatever lane it is in
 * now. The rule that ending needs the outcome decision follows that fact, so a
 * path through an intermediate lane cannot shed it.
 */
import type { Env } from '../types';

export type BookingStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';

export const BOOKING_TRANSITIONS: Readonly<Record<BookingStatus, readonly BookingStatus[]>> = Object.freeze({
  pending: ['confirmed', 'cancelled', 'completed', 'no_show'],
  confirmed: ['cancelled', 'completed', 'no_show'],
  completed: [],
  cancelled: [],
  no_show: [],
});

export function bookingMoveAllowed(from: string, to: string): boolean {
  return ((BOOKING_TRANSITIONS as Record<string, readonly string[]>)[from] || []).includes(to);
}
/** The states a booking may be moved to `to` from — what a bulk cancel may touch. */
export function bookingSourcesOf(to: BookingStatus): BookingStatus[] {
  return (Object.keys(BOOKING_TRANSITIONS) as BookingStatus[]).filter((f) => BOOKING_TRANSITIONS[f].includes(to));
}

export const SIGNED_LANE_SET: ReadonlySet<string> = new Set(['signed', 'renewal_due']);

export const ENGAGEMENT_ADVANCE: Readonly<Record<string, readonly string[]>> = Object.freeze({
  drafting: ['proposed', 'signed', 'ended'],
  proposed: ['drafting', 'signed', 'ended'],
  signed: ['renewal_due'],
  renewal_due: ['signed'],
  ended: [],
});

export type EngagementFacts = { lane: string; cycles: number | null; started_at?: string | null };

/** True when the engagement was ever signed, in whatever lane it is now. */
export function everSigned(e: EngagementFacts): boolean {
  return Number(e.cycles || 0) > 0 || !!e.started_at;
}

export type LifecycleRefusal = { status: 409; code: string; message: string };

export function advanceRefusal(e: EngagementFacts, to: string): LifecycleRefusal | null {
  if (e.lane === 'ended') {
    return { status: 409, code: 'engagement_ended', message: 'an engagement that has ended cannot change lane' };
  }
  if (to === 'ended' && everSigned(e)) {
    return {
      status: 409, code: 'outcome_required',
      message: 'a signed engagement ends through a renewal decision — POST /me/engagements/:id/renewal with decision "ended"',
    };
  }
  if (!(ENGAGEMENT_ADVANCE[e.lane] || []).includes(to)) {
    return { status: 409, code: 'lane_move_not_allowed', message: 'That engagement cannot move to that lane from where it is now.' };
  }
  return null;
}

export function renewalRefusal(e: EngagementFacts, decision: 'renewed' | 'ended'): LifecycleRefusal | null {
  if (e.lane === 'ended') {
    return { status: 409, code: 'engagement_ended', message: 'this engagement has already ended' };
  }
  const underContract = SIGNED_LANE_SET.has(e.lane);
  // Ending is a decision about a relationship that was signed once, wherever its lane has since been put.
  if (decision === 'ended' ? underContract || everSigned(e) : underContract) return null;
  return { status: 409, code: 'not_signed', message: 'only a signed engagement has a renewal to decide' };
}

export const CHANGED_WHILE_LOOKING = 'This record changed while you were looking at it. Reload it and try again.';

export type LifecycleEvent = {
  kind: 'booking' | 'engagement'; id: number; advisorId: number; from: string; to: string;
  decision?: 'renewed' | 'ended' | null; actorUserId: number | null;
  actorRole: 'advisor' | 'founder' | 'admin'; reason?: string | null; at: string;
};

/**
 * The ledger row for the UPDATE just before it in the same batch. `changes() >
 * 0` makes it a no-op when that UPDATE matched nothing, so a stale write leaves
 * no event and a winning one cannot lack one.
 */
export function lifecycleEventStatement(env: Env, e: LifecycleEvent) {
  return env.DB.prepare(
    `INSERT INTO advisor_lifecycle_events
       (subject_kind, subject_id, advisor_id, from_state, to_state, decision,
        actor_user_id, actor_role, reason, created_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() > 0`
  ).bind(e.kind, e.id, e.advisorId, e.from, e.to, e.decision ?? null,
    e.actorUserId, e.actorRole, e.reason ? String(e.reason).slice(0, 500) : null, e.at);
}
