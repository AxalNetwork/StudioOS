/**
 * D4817 part 5 (#5311, canvas PF-05, addendum PFA08 and PFA12): the pure model
 * of the investor's Value-add board. No React, no fetch, no clock.
 *
 * Its one source is the support ledger, `GET /api/portfolio-support`: a row
 * per piece of work a member recorded against a company in the book, with its
 * state, its dates, who recorded it and the outcome they wrote.
 *
 * D6203 (#6203) reads what D6202 (#6202) added to the ledger:
 *
 *   - States: Promised and In progress are open; Delivered, Withdrawn and
 *     Cancelled are closed. "Outstanding" is both open states.
 *   - A due date, and Overdue. Overdue is the Worker's, per entry (`overdue`)
 *     and in the figures (`totals.overdue`), by the Worker's own date: this
 *     model never compares a due date with the browser's clock.
 *   - An introduction's meeting: held (with its date), not held, or not
 *     recorded. A meeting nobody recorded reads Not recorded, never "No".
 *   - In progress, Overdue, Introductions made and Meetings resulting are
 *     counted figures. A measured 0 stays 0; a failed read stays Unreadable.
 *   - Introductions are the ledger's own `intro` entries. An introduction
 *     REQUESTED through the quota is access to a company, not support given to
 *     one, and is not read here.
 *
 * A read is the Portfolio model's (`readOf`): loading, ok or unreadable. The
 * ledger answers its figures from their own aggregate read; when that one
 * fails the Worker sends `totals: null` and `page_state: 'unreadable'`, and the
 * figures read Unreadable while the entries beside them still stand.
 */
import { NOT_RECORDED } from '../../lib/absence';
import { UNREADABLE, UNAVAILABLE, day } from './portfolioModel';

export { NOT_RECORDED, UNREADABLE, UNAVAILABLE };

export const KINDS = [
  ['intro', 'Introduction'],
  ['board_prep', 'Board prep'],
  ['hiring', 'Hiring'],
  ['customer', 'Customer'],
  ['fundraising', 'Fundraising'],
  ['other', 'Other'],
];
export const KIND_LABEL = Object.fromEntries(KINDS);
export const STATE_LABEL = { promised: 'Promised', in_progress: 'In progress', delivered: 'Delivered', withdrawn: 'Withdrawn', cancelled: 'Cancelled' };
/** D4642: an amendment's own verb. `amended` covers a change that moved no state. D6203: and the two D6202 moves. */
export const HISTORY_LABEL = { amended: 'Amended', in_progress: 'Started', delivered: 'Delivered', withdrawn: 'Withdrawn', cancelled: 'Cancelled' };
/** D6202: the states an entry is still open in; the rest are closed and cannot be reopened. */
export const OPEN_STATES = new Set(['promised', 'in_progress']);

/** What the ledger leaves unrecorded on one entry, each with the reason a member is shown. */
export const NOT_IN_LEDGER = {
  meeting: 'No meeting is recorded for this introduction.',
  due: 'No due date is recorded for this entry.',
};

/** D6203: the moves an open entry offers, each confirmed in place. In progress never moves back to Promised. */
export const MOVES = {
  promised: ['in_progress', 'delivered', 'withdrawn', 'cancelled'],
  in_progress: ['delivered', 'withdrawn', 'cancelled'],
};
export const MOVE_LABEL = { in_progress: 'Start', delivered: 'Mark delivered', withdrawn: 'Withdraw', cancelled: 'Cancel entry' };

const isNum = (v) => v !== null && v !== undefined && v !== '' && typeof v !== 'boolean' && Number.isFinite(Number(v));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * D6203: a YYYY-MM-DD that names a real day, as the Worker stores a due date or a meeting date (D6202). Checked
 * before a write so a mistyped date is refused in the form, never sent and silently lost.
 */
export function validDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const at = new Date(Date.UTC(y, m - 1, d));
  return at.getUTCFullYear() === y && at.getUTCMonth() === m - 1 && at.getUTCDate() === d;
}

/** The ledger's read must carry its entries and its book to be read at all. */
export const ledgerShape = (v) => Array.isArray(v.entries) && Array.isArray(v.companies) && 'totals' in v;

/**
 * Hours, and the one place a zero must not be manufactured: `null` means
 * nobody recorded a duration, `0` that someone recorded it took none.
 */
export const hoursLabel = (value) => (value == null ? NOT_RECORDED : `${Number(value).toLocaleString('en-US', { maximumFractionDigits: 12 })} h`);

/** The ledger's figures, or null when their own read failed. */
export function totalsOf(read) {
  if (read.state !== 'ok') return null;
  const v = read.value;
  if (v.page_state === 'unreadable' || !v.totals || typeof v.totals !== 'object') return null;
  return v.totals;
}

/**
 * Whether this read holds EVERY entry in scope, so a count over its rows is a
 * count over the ledger: the first page, no state filter, and as many rows as
 * the ledger's own total says it holds.
 */
export function holdsWholeLedger(read) {
  const t = totalsOf(read);
  if (!t || !isNum(t.entries)) return false;
  const v = read.value;
  return !v.filter?.state && !(v.page?.offset > 0) && v.entries.length === Number(t.entries);
}

/**
 * The figure row (canvas PF-05): each `{ key, label, value, state, note }`,
 * `state` one of ok, not_recorded, unavailable, unreadable or loading.
 */
export function figuresOf(read) {
  const loading = read.state === 'loading';
  const failed = read.state === 'unreadable';
  const t = totalsOf(read);
  const fromTotals = (key, label, pick, note) => {
    if (loading) return { key, label, value: null, state: 'loading' };
    if (failed || !t) return { key, label, value: UNREADABLE, state: 'unreadable', note: 'The ledger’s figures could not be read.' };
    const value = pick(t);
    if (!isNum(value)) return { key, label, value: UNREADABLE, state: 'unreadable', note: 'The ledger’s figures could not be read.' };
    return { key, label, value: String(Number(value)), state: 'ok', note: note(t) };
  };

  const untouched = read.state === 'ok' && Array.isArray(read.value.untouched) ? read.value.untouched : [];
  // D6203: Introductions made is the Worker's counted figure over the whole scope (D6202 `by_kind.intro`),
  // so it no longer needs a read that holds every entry.
  const intro = (x) => (x.by_kind && typeof x.by_kind === 'object' ? x.by_kind.intro : null);

  return [
    fromTotals('open', 'Open commitments', (x) => x.outstanding, () => 'Promised or in progress, not yet delivered, withdrawn or cancelled'),
    fromTotals('in_progress', 'In progress', (x) => x.in_progress, () => 'Started and not yet delivered'),
    fromTotals('delivered', 'Delivered', (x) => x.delivered, (x) => (isNum(x.companies_in_book)
      ? `${x.companies_supported} of ${plural(Number(x.companies_in_book), 'company', 'companies')} in the book have an entry`
      : 'Every delivered entry in scope')),
    fromTotals('intros', 'Introductions made', (x) => intro(x)?.delivered, (x) => (isNum(intro(x)?.meetings_held)
      ? `Delivered introduction entries · ${plural(Number(intro(x).meetings_held), 'meeting', 'meetings')} resulting`
      : 'Delivered introduction entries')),
    fromTotals('overdue', 'Overdue commitments', (x) => x.overdue, () => 'Open entries past their due date, by the Worker’s date (UTC)'),
    fromTotals('untouched', 'No support recorded', () => untouched.length, () => (untouched.length
      ? untouched.map((x) => x.name).join(', ')
      : 'Every company in the book has an entry')),
  ];
}

/** Hours across the ledger: a total of the timed entries, and how many carry none. */
export function hoursOf(read) {
  const t = totalsOf(read);
  if (read.state === 'loading') return { state: 'loading' };
  if (!t) return { state: 'unreadable', text: UNREADABLE };
  const entries = Number(t.entries) || 0;
  const untimed = Number(t.entries_without_hours) || 0;
  if (entries > 0 && untimed === entries) return { state: 'not_recorded', text: NOT_RECORDED, note: 'No entry carries an hour count.' };
  return {
    state: 'ok',
    text: hoursLabel(t.hours_recorded),
    note: untimed === 0
      ? (entries ? 'Every entry carries an hour count.' : 'No entry is recorded yet.')
      : `${plural(untimed, 'entry carries', 'entries carry')} no hours and ${untimed === 1 ? 'is' : 'are'} not counted.`,
  };
}

/** Who recorded an entry. The ledger read carries the member's id, not their name. */
export function ownerOf(row, me) {
  if (row.recorded_by == null) return { text: NOT_RECORDED, note: 'No member is recorded against this entry.' };
  if (me != null && Number(row.recorded_by) === Number(me)) return { text: 'You' };
  return { text: 'Another member', note: 'Named in the entry’s history.' };
}

/** One ledger entry as a commitment row: what, who, its state, and the dates the ledger holds. */
export function commitmentOf(row, me) {
  const state = STATE_LABEL[row.state] ? row.state : 'unknown';
  let closed;
  if (row.state === 'delivered') closed = { label: 'Delivered', date: day(row.delivered_at), missing: 'Delivery date not recorded' };
  else if (row.state === 'withdrawn') closed = { label: 'Withdrawn', date: day(row.withdrawn_at), missing: 'Withdrawal date not recorded' };
  else if (row.state === 'cancelled') closed = { label: 'Cancelled', date: day(row.cancelled_at), missing: 'Cancellation date not recorded' };
  else closed = { label: 'Open', date: null, missing: 'Not delivered yet' };
  const open = OPEN_STATES.has(row.state);
  return {
    uid: row.uid,
    company: row.project_name || (row.project_id != null ? `Startup ${row.project_id}` : 'Company not recorded'),
    companyUid: row.project_uid || null,
    kind: KIND_LABEL[row.kind] || row.kind || 'Kind not recorded',
    isIntro: row.kind === 'intro',
    summary: row.summary || NOT_RECORDED,
    owner: ownerOf(row, me),
    state,
    stateLabel: STATE_LABEL[row.state] || 'State not recorded',
    recorded: day(row.created_at),
    promised: day(row.promised_at),
    closed,
    open,
    moves: MOVES[row.state] || [],
    // D6203: the due date the ledger holds, and the Worker's own Overdue for it. A closed entry is never overdue.
    due: day(row.due_date),
    overdue: open && row.overdue === true,
    meeting: row.kind === 'intro' ? meetingOf(row) : null,
    hours: hoursLabel(row.hours),
    outcome: row.outcome && String(row.outcome).trim() ? String(row.outcome).trim() : null,
    revision: Number(row.revision) || 1,
    row,
  };
}

/**
 * D6203: an introduction's meeting, as D6202 records it. Not recorded is not "No": nobody wrote it down.
 */
export function meetingOf(row) {
  if (row.meeting_outcome === 'held') return { state: 'held', text: 'Yes', date: day(row.meeting_at) };
  if (row.meeting_outcome === 'not_held') return { state: 'not_held', text: 'No', date: null };
  return { state: 'not_recorded', text: NOT_RECORDED, date: null, note: NOT_IN_LEDGER.meeting };
}

/** The rows of one ledger read, newest first as the Worker orders them. */
export function commitmentsOf(read, me) {
  if (read.state !== 'ok') return [];
  return read.value.entries.map((r) => commitmentOf(r, me));
}

/**
 * The introductions the ledger records: its `intro` entries, each with its
 * meeting. `complete` says whether the read held every entry. `counts` are the
 * Worker's own over the whole scope (D6202 `by_kind.intro`), or null when the
 * figures could not be read.
 */
export function introductionsOf(read, me) {
  if (read.state === 'loading') return { state: 'loading', rows: [] };
  if (read.state !== 'ok') return { state: 'unreadable', rows: [], reason: 'The support ledger could not be read.' };
  const rows = read.value.entries.filter((r) => r.kind === 'intro').map((r) => commitmentOf(r, me));
  const complete = holdsWholeLedger(read);
  return {
    state: 'ok',
    rows,
    complete,
    delivered: rows.filter((r) => r.state === 'delivered').length,
    promised: rows.filter((r) => r.open).length,
    counts: introCounts(totalsOf(read)),
    reason: complete ? null : (totalsOf(read)
      ? `Counted only over a read that holds every entry; this one holds the newest ${read.value.entries.length} of ${read.value.totals.entries}.`
      : 'The ledger’s total could not be read, so the introductions cannot be shown to be all of them.'),
  };
}

/** D6203: the Worker's introduction figures, each a number or null; null when the figures were not read. */
export function introCounts(t) {
  const k = t && t.by_kind && typeof t.by_kind === 'object' ? t.by_kind.intro : null;
  if (!k || typeof k !== 'object') return null;
  const n = (v) => (isNum(v) ? Number(v) : null);
  return { made: n(k.delivered), open: n(k.outstanding), meetings: n(k.meetings_held) };
}

/** The per-company rollup: every company in the book, including those with nothing recorded. */
export function companySupportOf(read) {
  if (read.state !== 'ok') return [];
  return read.value.companies.map((c) => ({
    key: String(c.project_id),
    name: c.name || `Startup ${c.project_id}`,
    uid: c.project_uid || null,
    entries: Number(c.entries) || 0,
    delivered: Number(c.delivered) || 0,
    // D6203: outstanding is both open states, as the figures count it.
    promised: (Number(c.promised) || 0) + (Number(c.in_progress) || 0),
    withdrawn: Number(c.withdrawn) || 0,
    cancelled: Number(c.cancelled) || 0,
    // A company whose entries are all untimed, or that has none, has no hours recorded.
    hours: Number(c.entries_without_hours) === Number(c.entries)
      ? NOT_RECORDED
      : `${Math.round((Number(c.hours) || 0) * 100) / 100} h`,
    untimed: Number(c.entries_without_hours) || 0,
  }));
}

/** The query a commitments view reads: the filter's state, and the page offset. */
export function ledgerParams(filter, offset) {
  const params = {};
  if (offset) params.offset = offset;
  // D6203: Outstanding is promised or in progress, which the Worker reads as `state=open`.
  if (filter === 'outstanding') params.state = 'open';
  if (filter === 'delivered') params.state = 'delivered';
  return params;
}

/** A row of the current view: the Worker narrows by state, and the page checks it again. */
export function inView(filter) {
  return (row) => (filter === 'delivered' ? row.state === 'delivered'
    : filter === 'outstanding' ? OPEN_STATES.has(row.state)
      : true);
}
