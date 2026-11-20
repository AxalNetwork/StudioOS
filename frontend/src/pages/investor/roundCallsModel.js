/**
 * D6160 (#6160), canvas DCA16, DCA17 and DCA21 (D6159): the investor's round
 * calls list, pure. The reply is `GET /api/round-calls` for an investor
 * (`services/roundCalls.ts` `investorList`): per call the company's name, the
 * recorded terms, `effective_state` (open, paused, closed) and `mine`, the
 * caller's own indication, data-room request and question counts. Nothing
 * here reads, names or counts another investor.
 *
 * The filters live in the address (`?filter=`), so Back from a call returns
 * to the same view. An amount is Indicated, never committed.
 */

export const ROUND_CALLS_PATH = '/round-calls';
export const ROUND_CALLS_TITLE = 'Round calls';
export const ROUND_CALLS_LINE = 'Private calls founders sent you. An amount you indicate is Indicated, never committed.';
export const NO_RESPONSE = 'No response recorded';
export const NOT_A_PAYMENT = 'An indication is not a payment or a signed investment.';

/** The status chip: a word and a glyph, never colour alone. */
export const STATE_CHIP = Object.freeze({
  open: { word: 'Open', glyph: '●' },
  paused: { word: 'Paused', glyph: '‖' },
  closed: { word: 'Closed', glyph: '■' },
});

/** DCA16's filters, in the board's order; `needs-answer` is Open with no indication. */
export const FILTERS = Object.freeze([
  { key: 'open', label: 'Open' },
  { key: 'paused', label: 'Paused' },
  { key: 'closed', label: 'Closed' },
  { key: 'all', label: 'All' },
]);
export const NEEDS_ANSWER = Object.freeze({ key: 'needs-answer', label: 'Needs my answer' });
const FILTER_KEYS = new Set([...FILTERS.map((f) => f.key), NEEDS_ANSWER.key]);

const INSTRUMENT_NAME = { safe: 'SAFE', convertible_note: 'Convertible note', equity: 'Priced equity' };
export const instrumentName = (value) => INSTRUMENT_NAME[value] || 'Not recorded';

/** The filter the address names; anything else is All. */
export function filterOf(search) {
  const value = new URLSearchParams(search || '').get('filter');
  return FILTER_KEYS.has(value) ? value : 'all';
}
/** The address of a filter, keeping every other query value. */
export function filterHref(search, key) {
  const params = new URLSearchParams(search || '');
  if (key === 'all') params.delete('filter'); else params.set('filter', key);
  const q = params.toString();
  return ROUND_CALLS_PATH + (q ? `?${q}` : '');
}

/** A state the list knows; a state it does not know is not guessed at. */
export const stateOf = (call) => (STATE_CHIP[call?.effective_state] ? call.effective_state : null);
export const needsAnswer = (call) => stateOf(call) === 'open' && call?.mine != null && call.mine.commitment_cents == null;

export function matchesFilter(call, filter) {
  if (filter === 'all') return true;
  if (filter === NEEDS_ANSWER.key) return needsAnswer(call);
  return stateOf(call) === filter;
}
export function filterCounts(calls) {
  const out = {};
  for (const key of FILTER_KEYS) out[key] = calls.filter((c) => matchesFilter(c, key)).length;
  return out;
}

const day = (value) => String(value || '').slice(0, 10);
/** When a closed call closed: the founder's close, or the close date it passed. */
const closedOn = (call) => (call.state === 'closed' && call.closed_at ? day(call.closed_at) : day(call.target_close));
/**
 * Soonest close first; Closed last, most recently closed first (DCA16's
 * footnote). A call whose state is not known goes last of all.
 */
export function sortCalls(calls) {
  const rank = (c) => ({ open: 0, paused: 0, closed: 1 }[stateOf(c)] ?? 2);
  return [...calls].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r) return r;
    if (rank(a) === 1) return closedOn(b).localeCompare(closedOn(a));
    return day(a.target_close).localeCompare(day(b.target_close));
  });
}

/** "18 Nov", from a recorded date or timestamp; null when it does not read as one. */
export function shortDate(value) {
  const d = day(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const date = new Date(`${d}T12:00:00Z`);
  if (Number.isNaN(date.valueOf())) return null;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

/**
 * The close-date words beside the chip: "Closes in 4 days · 18 Nov",
 * "Closed on 2 Nov", or "Closed" with "Closed early by the founder". `today`
 * is the UTC date, the one the Worker's `effective_state` uses.
 */
export function closeWords(call, today) {
  const state = stateOf(call);
  const close = day(call?.target_close);
  const closeLabel = shortDate(close);
  if (state === 'closed') {
    const early = call.state === 'closed' && call.closed_at && day(call.closed_at) < close;
    const on = shortDate(closedOn(call));
    return { text: on ? `Closed on ${on}` : 'Closed', note: early ? 'Closed early by the founder' : null };
  }
  if (!closeLabel) return { text: 'Close date not recorded', note: null };
  const n = daysBetween(today, close);
  const when = n <= 0 ? 'Closes today' : n === 1 ? 'Closes tomorrow' : `Closes in ${n} days`;
  return { text: `${when} · ${closeLabel}`, note: state === 'paused' ? 'An extension is waiting on counsel' : null };
}

/**
 * The investor's own response, line by line, or the one line
 * "No response recorded" when they have done nothing on the call yet.
 * `money` formats cents (the call pages' `moneyCents`).
 */
export function responseLines(call, money) {
  const mine = call?.mine;
  if (!mine) return { none: true, lines: ['Not recorded · your response was not returned'] };
  const questions = Number(mine.question_count) || 0;
  const answered = Number(mine.answered_count) || 0;
  if (mine.commitment_cents == null && !questions && !mine.data_room_requested_at) return { none: true, lines: [NO_RESPONSE] };
  const lines = [mine.commitment_cents != null ? `Indicated · ${money(mine.commitment_cents)}` : 'Not indicated'];
  lines.push(!questions ? 'No question asked'
    : questions === 1 ? `Question asked · ${answered ? 'answered' : 'not answered'}`
    : `${questions} questions asked · ${answered} answered`);
  const asked = shortDate(mine.data_room_requested_at);
  lines.push(mine.data_room_requested_at ? `Data room · asked on ${asked || 'a date not recorded'}` : 'No data-room request');
  return { none: false, lines };
}

/** "New": sent to me and not opened yet, while it is still open. */
export const isNew = (call) => stateOf(call) === 'open' && call?.mine != null && !call.mine.opened_at;

export const callHref = (call) => `${ROUND_CALLS_PATH}/${encodeURIComponent(call.uid)}`;
export const companyOf = (call) => (call?.company?.name ? String(call.company.name) : null);

/**
 * What a list read means for the page: `off` (503 round_calls_disabled),
 * `verify` (403 verified_investor_required), `unreadable` (a failure, or a
 * 5xx, offered Try again), `refused` (any other refusal), `empty`, or `list`.
 */
export function listState(read) {
  if (read.loading) return 'loading';
  if (read.error) {
    const { code, status } = read.error;
    if (code === 'round_calls_disabled') return 'off';
    if (code === 'verified_investor_required') return 'verify';
    if (!status || status >= 500) return 'unreadable';
    return 'refused';
  }
  const items = read.data?.items;
  if (!Array.isArray(items)) return 'unreadable';
  return items.length ? 'list' : 'empty';
}
