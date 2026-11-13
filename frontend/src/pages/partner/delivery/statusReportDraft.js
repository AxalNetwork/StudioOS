/**
 * #4673 (Delivery audit 1/6) — a composed status report belongs to the
 * engagement and period it was composed for, and nowhere else.
 *
 * Composing is a request; the selection can change while it is in flight. A
 * response that arrives after the engagement or period moved must not appear
 * under the new selection, and a draft must save only into the engagement and
 * period it was composed for. The Worker checks the second half too: its save
 * refuses a body whose `engagement_id` and `period` do not match the URL.
 */

/** The shape a composed draft always has, so no field is read off a null. */
export const EMPTY_DRAFT = Object.freeze({
  engagement_id: null,
  period: '',
  existing: null,
  shipped_from_log: [],
  next_from_milestones: [],
  blocked: [],
  blocked_note: null,
});

/**
 * Latest request only: `start()` returns a ticket, `invalidate()` retires every
 * ticket issued so far (the selection moved), and `isCurrent(ticket)` says
 * whether a response may still be shown.
 */
export function latestOnly() {
  let seq = 0;
  return {
    start: () => { seq += 1; return seq; },
    invalidate: () => { seq += 1; },
    isCurrent: (ticket) => ticket === seq,
  };
}

/**
 * The draft for a composition response. Its identity is the one ASKED for,
 * whatever the response carries; the lists fall back to the empty shape.
 */
export function draftFrom(response, asked) {
  return {
    ...EMPTY_DRAFT,
    ...(response || {}),
    engagement_id: Number(asked.engagement_id),
    period: (response && response.period) || asked.period,
  };
}

/**
 * The save call for a draft: its own engagement and period in the URL and in the body.
 *
 * #5314 part 2: `blocked` is sent only when the caller states it. The Worker
 * leaves an omitted section as it was, and records a present one (an empty
 * one included, as "nothing blocked") — so a save that never showed the
 * section cannot write one.
 */
export function saveRequest(draft, fields) {
  const body = {
    engagement_id: draft.engagement_id, period: draft.period,
    shipped: fields.shipped, next_up: fields.next_up,
  };
  if (Object.prototype.hasOwnProperty.call(fields, 'blocked')) {
    const t = String(fields.blocked ?? '').trim();
    body.blocked = t === '' ? null : t;
  }
  return [draft.engagement_id, draft.period, body];
}

/**
 * #5314 part 2: what a saved report's Blocked section says. `recorded` false
 * is "Not recorded" (a report saved before the section existed); a recorded
 * section with no words is the firm stating nothing is blocked.
 */
export function blockedLine(report) {
  if (!report || !report.blocked_recorded) {
    return { kind: 'not_recorded', text: 'Not recorded', note: report?.blocked_state_note || null };
  }
  if (!report.blocked) return { kind: 'none', text: 'Nothing blocked', note: null };
  return { kind: 'written', text: report.blocked, note: null };
}
