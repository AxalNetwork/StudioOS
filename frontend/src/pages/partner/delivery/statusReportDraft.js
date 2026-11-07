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

/** The save call for a draft: its own engagement and period in the URL and in the body. */
export function saveRequest(draft, fields) {
  return [draft.engagement_id, draft.period, {
    engagement_id: draft.engagement_id, period: draft.period,
    shipped: fields.shipped, next_up: fields.next_up,
  }];
}
