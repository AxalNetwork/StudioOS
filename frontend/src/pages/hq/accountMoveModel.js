/**
 * D5043 (#5043) — what HQ Team says about a cross-branch move's second leg, as pure functions.
 *
 * Three facts, never folded into one:
 *   1. the SOURCE closed the account (the move-out). Only the Worker's record says so;
 *   2. the DESTINATION stored an invitation (`invited.stored`);
 *   3. the destination's mailer SENT it (`invited.email_sent`): true, false, or not reported.
 *
 * Nothing here says the person "was contacted" or "was told". The most the platform knows is
 * that a branch reported its mailer sent a message; whether anyone read it is not recorded.
 */

/** A move's view, from the move POST's answer or from an open-moves item. */
export function moveView(src) {
  if (!src || typeof src !== 'object') return null;
  const op = src.operation && typeof src.operation === 'object' ? src.operation : null;
  // An open-moves item IS the operation; a move answer carries it beside the legs.
  const item = src.uid ? src : null;
  const target = (item ? item.target : src.target) || {};
  const invitation = item
    ? (item.invitation ? { stored: true, uid: item.invitation.uid, email_sent: item.invitation.email_sent, reason: item.invitation.email_reason || null } : null)
    : (src.invited && src.invited.ok ? invitedFacts(src.invited) : null);
  const failure = item
    ? (item.status === 'invite_failed' ? { code: item.last_error_code || null, message: item.last_error || null } : null)
    : (src.invited && src.invited.ok === false ? { code: src.invited.code || null, message: src.invited.reason || null } : null);
  return {
    uid: item ? item.uid : (op ? op.uid : null),
    from: item ? item.from : src.from,
    to: item ? item.to : src.to,
    who: target.name || target.email || 'The account',
    email: target.email || null,
    role: target.role || null,
    recoverable: item ? item.moved_out === true : Boolean(op && op.recoverable),
    inProgress: item ? item.status === 'inviting' : false,
    attempts: item ? Number(item.attempts || 0) : 1,
    invitation,
    failure,
    recordsNote: (item ? item.records_note : src.records_note) || null,
  };
}

/** The destination's answer, reduced to the facts it reported. */
export function invitedFacts(invited) {
  if (!invited || invited.ok !== true) return null;
  return {
    stored: invited.stored !== false,
    uid: invited.uid || null,
    email_sent: typeof invited.email_sent === 'boolean' ? invited.email_sent : null,
    reason: invited.reason || null,
    link: typeof invited.invite_link === 'string' ? invited.invite_link : null,
    reused: invited.reused === true,
    accepted: invited.accepted === true,
  };
}

/** A retry's answer applied to the view it was pressed on. */
export function applyRetry(view, res) {
  const next = res && res.operation ? moveView(res.operation) : { ...view };
  return { ...next, invitation: invitedFacts(res && res.invited) || next.invitation, failure: null, inProgress: false };
}

/**
 * A retry that threw. A refusal with a body is the Worker's sentence (and its record of the move,
 * when it got that far). No status at all is a request whose answer never arrived: the invitation
 * may or may not exist, and the view says exactly that rather than guessing.
 */
export function applyRetryError(view, ex) {
  const data = ex && ex.data && typeof ex.data === 'object' ? ex.data : null;
  if (!ex || !ex.status) {
    return { ...view, unknown: true, failure: { code: 'no_answer', message: 'The answer did not arrive, so whether the invitation was created is not known. Read the moves again before retrying; a retry cannot create a second invitation for this move.' } };
  }
  const base = data && data.operation ? moveView(data.operation) : view;
  return {
    ...base,
    unknown: false,
    failure: { code: (data && data.error) || ex.code || null, message: (data && data.message) || ex.message || 'The retry was refused.' },
  };
}

/** The lines the outcome draws for the invitation, in order: created, email, next step. */
export function invitationLines(view) {
  const inv = view && view.invitation;
  if (!inv) {
    return [{ key: 'created', state: 'not_created', text: `Invitation not created on ${view ? view.to : 'the destination'}.` }];
  }
  const lines = [{
    key: 'created',
    state: 'created',
    text: inv.accepted
      ? `Invitation created on ${view.to}, and the person has already accepted it there.`
      : `Invitation created on ${view.to}${inv.reused ? ' (the one stored by an earlier attempt for this move)' : ''}.`,
  }];
  if (inv.email_sent === true) {
    lines.push({ key: 'email', state: 'sent', text: `Email sent: ${view.to} reports that its mailer sent the invitation. Whether it was read is not known.` });
  } else if (inv.email_sent === false) {
    lines.push({ key: 'email', state: 'not_sent', text: `Email not sent: ${inv.reason || `${view.to} reports that its mailer did not send the invitation.`}` });
  } else {
    lines.push({ key: 'email', state: 'not_reported', text: `Email: not reported. ${view.to} did not say whether its mailer sent the invitation.` });
  }
  if (inv.email_sent !== true && !inv.accepted) {
    lines.push({
      key: 'next',
      state: 'manual',
      text: inv.link
        ? `Next: pass this invitation link to ${view.email || view.who} yourself. It is shown only in this answer.`
        : `Next: ${view.email || view.who} has not been sent the invitation. HQ does not keep its link: it was shown once, in the answer that created the invitation. If it was not passed on, ask ${view.to}'s administrators to reach them.`,
      link: inv.link || null,
    });
  }
  return lines;
}

/** The one sentence for a failed or in-flight second leg. */
export function failureLine(view) {
  if (!view) return null;
  if (view.inProgress) return `The invitation on ${view.to} is being asked for now. Read the moves again in a moment.`;
  if (!view.failure) return null;
  if (view.failure.code === 'destination_active') {
    return view.failure.message || `${view.to} already has an active account for this person, so no invitation was created.`;
  }
  return view.failure.message || `The invitation on ${view.to} did not land.`;
}
