/** D4704 part 3 (#4704): booking transition policy, atomic status change and actor/time record. */
import type { Env, User } from '../types';
import { actsForAdvisor } from './advisorAccess';
import { logAdminAction } from './adminAudit';
import { logActorAct } from './actorLog';
import { isAdmin, nowIso } from '../routes/_t13t14t15_helpers';
import { type BookingRow } from './advisorPractice';
import { practiceRefusal } from './practiceRefusal';

export type BookingTransition = {
  allowed: string[]; nextStatus: string; whoCan: 'advisor' | 'founder' | 'either';
  reason?: string | null;
  /** #4702: the answer this transition records, if it is one. */
  decision?: 'accepted' | 'declined';
};
async function requireBookingParty(env: Env, user: User, id: number, whoCan: BookingTransition['whoCan']) {
  const b = await env.DB.prepare('SELECT * FROM advisor_bookings WHERE id = ?').bind(id).first<BookingRow>();
  if (!b) return practiceRefusal({ detail: 'Booking not found' }, 404);
  // #4715: the advisor side is the policy's answer (licence today, owned row),
  // never the stored users.advisor_id pointer on its own.
  const isAdvisor = await actsForAdvisor(env, user, b.advisor_id);
  const isOwner = b.founder_user_id === user.id;
  const adm = isAdmin(user);
  let allowed = adm;
  if (whoCan === 'advisor') allowed = allowed || isAdvisor;
  if (whoCan === 'founder') allowed = allowed || isOwner;
  if (whoCan === 'either') allowed = allowed || isAdvisor || isOwner;
  if (!allowed) return practiceRefusal({ detail: 'Forbidden' }, 403);
  return { b, isAdvisor, isOwner, adm };
}

export async function transitionBooking(env: Env, user: User, id: number, opts: BookingTransition) {
  const { b, isAdvisor, isOwner, adm } = await requireBookingParty(env, user, id, opts.whoCan);
  if (!opts.allowed.includes(b.status)) {
    return practiceRefusal({ detail: `Cannot transition from ${b.status}` }, 409);
  }
  // D4703 (#4703): the status read above is the status this write expects.
  // Two presses at once (a cancel and a confirm, or two cancels) used to both
  // pass the check and both write; now the second changes nothing and says so.
  //
  // #4702 (D4702): the ANSWER is recorded apart from the status. Confirming is an
  // accept. A cancel by the advisor of a request still waiting is a decline. A
  // cancel by anyone of a session already accepted leaves the accept as it was,
  // and a client withdrawing a request before any answer records no answer, so
  // neither the client's cancellation nor an admin's changes the advisor's rate.
  const at = nowIso();
  const cancelledBy = opts.nextStatus === 'cancelled'
    ? (isAdvisor && !adm ? 'advisor' : isOwner && !adm ? 'client' : 'admin') : null;
  const decision = opts.decision
    ?? (opts.nextStatus === 'cancelled' && b.status === 'pending' && cancelledBy === 'advisor' ? 'declined' : null);
  const wrote = await env.DB.prepare(
    `UPDATE advisor_bookings SET status = ?, cancel_reason = COALESCE(?, cancel_reason),
            advisor_decision = COALESCE(?, advisor_decision),
            advisor_decided_at = CASE WHEN ? IS NOT NULL THEN ? ELSE advisor_decided_at END,
            cancelled_by = COALESCE(?, cancelled_by), updated_at = ?
      WHERE id = ? AND status = ?`
  ).bind(opts.nextStatus, opts.reason ?? null, decision, decision, at, cancelledBy, at, id, b.status).run();
  if (Number((wrote as any)?.meta?.changes ?? 0) === 0) {
    return practiceRefusal({ detail: 'This booking changed while you were looking at it. Reload it and try again.' }, 409);
  }
  // #4692: WHO closed the session, and when.
  //
  // The row carried the OUTCOME and not the hand: `status` says what happened,
  // `cancelled_by` says which side cancelled and `advisor_decision` holds the
  // answer, but none of them names the account that pressed the button, and
  // `updated_at` is the row's clock rather than an act. So a completed session
  // (which is what the advisor is paid on) and a cancel could not be traced to
  // a person at all — including a cancel an admin made on someone else's
  // booking, which reached no audit store.
  //
  // Recorded AFTER the conditional UPDATE changed a row, so the refused press
  // on a stale status above leaves no record of an act that did not happen.
  // Both writers are best effort by their own contract: the session has
  // already changed, and a lost line is better than an act undone by its own
  // record.
  //
  // An admin's press is the privileged one and goes to `logAdminAction`, which
  // reaches HQ's governance feed (D159); the advisor's and the client's own go
  // to `activity_logs` through `logActorAct` (D637). `adm` decides, exactly as
  // it decides `cancelled_by` above, so one press cannot be an admin to one
  // store and the advisor to the other. Ids and states only: `opts.reason` is
  // free text the person typed and stays out of both.
  const actorRole = adm ? 'admin' : isAdvisor ? 'advisor' : 'client';
  const act = {
    booking_id: id, advisor_id: b.advisor_id, slot_id: b.slot_id,
    from_status: b.status, to_status: opts.nextStatus,
    actor_role: actorRole, cancelled_by: cancelledBy, decision, at,
  };
  if (actorRole === 'admin') {
    await logAdminAction(env, user.id, String(user.email || ''),
      `advisor_booking_${opts.nextStatus}`, { ...act, target_user_id: b.founder_user_id });
  } else {
    await logActorAct(env, user, `advisor_booking_${opts.nextStatus}`, act);
  }
}
