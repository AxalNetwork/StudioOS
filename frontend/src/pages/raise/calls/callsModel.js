/**
 * D1221 (#2458) — Calls for Capital, the page Raise's "Calls" tab opens, from
 * the owner's canvas (CLS1–CLS15). Pure, so
 * `frontend/test/calls_for_capital_d1221.test.mjs` and
 * `frontend/test/calls_page_d1223.test.mjs` hold each rule.
 *
 * WHAT IS READ. The Capital relationships module read's `parts.calls`
 * (`raiseCycle.ts` `callsHistory`): `{ enabled: false }` while
 * `ROUND_CALLS_ENABLED` is off (production today, #1008 item 19), else each call
 * with its recipients, opened, data-room requests, indications, responses,
 * invitations not delivered (D1222) and unanswered questions. D1223 adds
 * CLS1's readiness, `GET /api/round-calls/readiness` (D1222), which answers
 * whether calls are on or off.
 *
 * A call's amounts are INDICATED, never committed (D653: "indicative
 * intentions in cents, not payments or issuance"; #2458 broken item 2).
 */

export const LIST_PATH = '/raise/capital-relationships/calls';

const UID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Where a call opens: under Calls in the Raise shell, a draft as well as a
 * sent call (D1224, #3223). A draft there opens the new-call sheet on it.
 */
export function callHref(c) {
  const uid = String(c?.uid ?? '');
  if (!UID.test(uid)) return LIST_PATH;
  return `${LIST_PATH}/${uid}`;
}

export const STATE_WORD = Object.freeze({ draft: 'Draft', awaiting_counsel: 'Awaiting counsel', open: 'Open', expired: 'Expired', closed: 'Closed' });
export const stateWord = (s) => STATE_WORD[s] || 'Not recorded';

const count = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * One row of CLS2, from one `parts.calls` item. A count the read did not
 * return stays null. A call not yet sent has invited, opened and indicated
 * nothing, so its engagement counts are null with `sent: null` ("Not sent"),
 * never the 0 the read's COUNT returns for it.
 */
export function callRow(c = {}) {
  const sent = c.sent_at || null;
  const after = (v) => (sent ? count(v) : null);
  return {
    uid: c.uid,
    name: c.name || 'Untitled call',
    state: stateWord(c.effective_state || c.state),
    href: callHref(c),
    sent,
    close: c.target_close || null,
    targetCents: count(c.amount_cents),
    indicatedCents: after(c.committed_cents),
    recipients: after(c.recipients),
    opened: after(c.opened),
    dataRoom: after(c.data_room_requests),
    responded: after(c.responded),
    notDelivered: after(c.not_delivered),
    unanswered: after(c.unanswered_questions),
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

/**
 * Every invitation the venture's sent calls could not deliver, or null when
 * no sent call returned the count (a draft's is null, never 0).
 */
export function notDeliveredTotal(rows = []) {
  const known = rows.map((r) => r.notDelivered).filter((v) => v != null);
  return known.length ? known.reduce((a, b) => a + b, 0) : null;
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** CLS2's sentence over the table: how many invitations were not delivered, once any count is known. */
export function notDeliveredLine(rows = []) {
  const total = notDeliveredTotal(rows);
  if (total == null) return null;
  if (total === 0) return 'Every invitation your calls sent was delivered on Axal.';
  return `${plural(total, 'invitation')} could not be delivered on Axal. Open the call to see which.`;
}

/** The call that is open now, if any: New call waits until it closes (CLS2). */
export const openCall = (rows = []) => rows.find((r) => r.state === 'Open') || null;

/**
 * New call (CLS1, CLS2, CLS12): on, or off with the one sentence that says
 * why. Switched-off is the Worker's (`ROUND_CALLS_ENABLED`); "one call at a
 * time" is the canvas's rule (CLS2), which the Worker does not enforce yet.
 */
export function newCallState(st, readStatus = 'ready') {
  if (readStatus === 'loading') return { enabled: false, reason: 'New call waits until your calls are read.' };
  if (readStatus === 'unreadable' || st.kind === 'unreadable') return { enabled: false, reason: 'New call stays off until the calls can be read.' };
  if (st.kind === 'off') return { enabled: false, reason: 'Calls are not switched on yet.' };
  const open = openCall(st.rows);
  if (open) return { enabled: false, reason: `One call at a time. ${open.name} is open.` };
  return { enabled: true, reason: null };
}

const DAY = 86400000;
const isoDay = (v) => (/^\d{4}-\d{2}-\d{2}/.test(String(v ?? '')) ? Date.parse(`${String(v).slice(0, 10)}T00:00:00Z`) : NaN);

/** Whole days from `today` to a close date, or null when either is not a date. */
export function daysUntil(close, today) {
  const a = isoDay(today); const b = isoDay(close);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / DAY) : null;
}

/** Indicated as a whole percentage of the target, or null when either is not recorded. */
export function indicatedPct(row) {
  if (row?.indicatedCents == null || !row?.targetCents) return null;
  return Math.max(0, Math.min(100, Math.round((row.indicatedCents / row.targetCents) * 100)));
}

/**
 * CLS2's strip, for the open call: the call, Indicated of target, Responses,
 * Questions waiting and Closes in. A figure the read did not return is null.
 */
export function openStrip(rows = [], today = new Date().toISOString().slice(0, 10)) {
  const r = openCall(rows);
  if (!r) return null;
  const days = daysUntil(r.close, today);
  return {
    name: r.name,
    sent: r.sent,
    indicatedCents: r.indicatedCents,
    targetCents: r.targetCents,
    pct: indicatedPct(r),
    responses: r.responded != null && r.recipients != null ? `${r.responded} of ${r.recipients}` : null,
    unanswered: r.unanswered,
    closesIn: days == null ? null : days <= 0 ? 'Closes today' : plural(days, 'day'),
    close: r.close,
  };
}

/** CLS1's seven readiness items, in the canvas's order. */
export const READINESS = Object.freeze(['Round target', 'Round terms', 'Pitch deck version', 'Data room', 'Use of funds', 'Traction', 'Target close']);

/** The tool each readiness item is set in, by the Worker's key (D1222 `ventureReadiness`). */
export const READINESS_TOOL = Object.freeze({
  round: { tool: 'Round settings', path: '/raise/capital-relationships/commitments' },
  terms: { tool: 'Cap table', path: '/raise/cap-table' },
  deck: { tool: 'Pitch deck', path: '/raise/pitch-deck' },
  data_room: { tool: 'Data room', path: '/raise/data-room' },
  use_of_funds: { tool: 'Use of funds', path: '/raise/use-of-funds' },
  traction: { tool: 'Fundraising readiness', path: '/raise/fundraising-readiness' },
  close: { tool: 'Round settings', path: '/raise/capital-relationships/commitments' },
});

const PROJECT = /^[1-9]\d*$/;

/**
 * CLS1's readiness, from `GET /api/round-calls/readiness`: each item ready,
 * missing, or (Round terms) written in the call itself, each opening the tool
 * it is set in. The count is the Worker's `ready` of `counted`; an answer
 * without them draws no count.
 */
export function readinessView(read, projectId = null) {
  if (!read || read.status === 'loading') return { status: 'loading', items: [], summary: null };
  const data = read.status === 'ready' ? read.data : null;
  if (!data || !Array.isArray(data.items)) return { status: 'unreadable', items: [], summary: null };
  const q = PROJECT.test(String(projectId ?? '')) ? `?project_id=${projectId}` : '';
  const items = data.items.map((i) => {
    const tool = READINESS_TOOL[i?.key] || null;
    const state = i?.ready === true ? 'ready' : i?.ready === false ? 'missing' : 'in_call';
    return {
      key: String(i?.key ?? ''),
      label: i?.label || 'Not recorded',
      state,
      word: state === 'ready' ? 'Ready' : state === 'missing' ? 'Missing' : 'Set in the call',
      reason: i?.reason || null,
      tool: tool?.tool || null,
      href: tool ? `${tool.path}${q}` : null,
    };
  });
  const ok = Number.isInteger(data.ready) && Number.isInteger(data.counted);
  return { status: 'ready', items, summary: ok ? `${data.ready} of ${data.counted} ready` : null };
}

export const WHAT_A_CALL_IS = 'A call for capital is your private invitation to verified investors on Axal to look at this round: its terms, your deck and your data room. Investors answer with an indication, never a payment.';
export const OFF_TITLE = 'Calls for Capital are not switched on yet';
export const OFF_LINE = 'Axal switches them on once its counsel has confirmed how a call may reach investors. Nothing you prepare is sent until then.';
export const WHY_OFF = 'Calls are switched off while counsel confirms how a call may reach investors (owner action #1008, item 19). Nothing is sent until then.';
export const NEW_CALL_OFF = 'New call is unavailable while calls are switched off.';
export const READINESS_NOTE = 'These are read from your Raise modules. No investor sees them.';
export const MEANWHILE = 'Work your investors in Capital relationships. A call reaches only investors with a verified Axal account.';
export const INDICATED_NOTE = 'Indicated amounts are intentions, not payments or commitments.';

/** "What a call does" (CLS1) and "How a call works" (CLS2): the four steps. */
export const HOW = Object.freeze(['Set the round and terms', 'Pick the deck and data room', 'Choose investors', 'Counsel checks the terms, then you send']);

export const NOT_YET = 'Not read here yet';
