/**
 * D1221 (#2458) — Calls for Capital, the page Raise's "Calls" tab opens, from
 * the owner's canvas (CLS1–CLS15). Pure, so
 * `frontend/test/calls_for_capital_d1221.test.mjs` holds each rule.
 *
 * WHAT IS READ TODAY. The Capital relationships module read's `parts.calls`
 * (`raiseCycle.ts` `callsHistory`): `{ enabled: false }` while
 * `ROUND_CALLS_ENABLED` is off (production today, #1008 item 19), else each call
 * with its recipients, opened, data-room requests, indications, responses and
 * unanswered questions. Readiness while off, delivery failures and co-founders
 * have no read yet, so they say "Not read here yet" (D1221 part 1).
 *
 * A call's amounts are INDICATED, never committed (D653: "indicative
 * intentions in cents, not payments or issuance"; #2458 broken item 2).
 */

export const LIST_PATH = '/raise/capital-relationships/calls';

const UID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Where a call opens: a sent call at its address under Calls, a draft where
 * drafts are still edited (`/round-calls/:uid`) until the sheet moves (part 3).
 */
export function callHref(c) {
  const uid = String(c?.uid ?? '');
  if (!UID.test(uid)) return LIST_PATH;
  return c.state === 'draft' ? `/round-calls/${uid}` : `${LIST_PATH}/${uid}`;
}

export const STATE_WORD = Object.freeze({ draft: 'Draft', awaiting_counsel: 'Awaiting counsel', open: 'Open', expired: 'Expired', closed: 'Closed' });
export const stateWord = (s) => STATE_WORD[s] || 'Not recorded';

const count = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** One row of CLS2, from one `parts.calls` item. A count the read did not return stays null. */
export function callRow(c = {}) {
  return {
    uid: c.uid,
    name: c.name || 'Untitled call',
    state: stateWord(c.effective_state || c.state),
    href: callHref(c),
    sent: c.sent_at || null,
    close: c.target_close || null,
    targetCents: count(c.amount_cents),
    indicatedCents: count(c.committed_cents),
    recipients: count(c.recipients),
    opened: count(c.opened),
    dataRoom: count(c.data_room_requests),
    responded: count(c.responded),
    unanswered: count(c.unanswered_questions),
  };
}

/** The page's state from `parts.calls`: off, unreadable, empty, or the list. */
export function callsState(calls) {
  if (!calls || typeof calls !== 'object') return { kind: 'unreadable', rows: [] };
  if (calls.state === 'unreadable') return { kind: 'unreadable', rows: [] };
  if (calls.enabled === false) return { kind: 'off', rows: [] };
  const items = Array.isArray(calls.items) ? calls.items : [];
  return { kind: items.length ? 'list' : 'empty', rows: items.map(callRow) };
}

/** CLS1's seven readiness items, in the canvas's order. */
export const READINESS = Object.freeze(['Round target', 'Round terms', 'Pitch deck version', 'Data room', 'Use of funds', 'Traction', 'Target close']);

export const WHAT_A_CALL_IS = 'A call for capital is your private invitation to verified investors on Axal to look at this round: its terms, your deck and your data room. Investors answer with an indication, never a payment.';
export const WHY_OFF = 'Calls are switched off while counsel confirms how a call may reach investors (owner action #1008, item 19). Nothing is sent until then.';
export const NEW_CALL_OFF = 'New call is unavailable while calls are switched off.';

export const NOT_YET = 'Not read here yet';

/** What the canvas draws that no read carries yet. Never a zero, never "none". */
export const WAITS = Object.freeze({
  readiness: 'Whether each item is ready is not read here yet: the readiness read works only while calls are on. Each item is set in its own tool.',
  delivery: 'Which invitations could not be delivered is not read here yet.',
  cofounders: 'Co-founders drafting and answering questions is not available yet; the venture’s owner runs each call.',
});
