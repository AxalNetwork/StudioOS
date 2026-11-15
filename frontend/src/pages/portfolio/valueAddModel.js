/**
 * D4817 part 5 (#5311, canvas PF-05, addendum PFA08 and PFA12): the pure model
 * of the investor's Value-add board. No React, no fetch, no clock.
 *
 * Its one source is the support ledger, `GET /api/portfolio-support`: a row
 * per piece of work a member recorded against a company in the book, with its
 * state (Promised, Delivered or Withdrawn), its dates, who recorded it and the
 * outcome they wrote. The ledger records WORK, not results, so:
 *
 *   - "In progress", "Cancelled", a due date and "Overdue" are not states or
 *     fields of the ledger. They read Not recorded with that reason, never 0.
 *   - A meeting that resulted from an introduction is not recorded anywhere.
 *     It reads Not recorded with that reason, never "no meeting".
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
export const STATE_LABEL = { promised: 'Promised', delivered: 'Delivered', withdrawn: 'Withdrawn' };
/** D4642: an amendment's own verb. `amended` covers a change that moved no state. */
export const HISTORY_LABEL = { amended: 'Amended', delivered: 'Delivered', withdrawn: 'Withdrawn' };

/** What the ledger does not record, each with the reason a member is shown. */
export const NOT_IN_LEDGER = {
  inProgress: 'The ledger has no In progress state.',
  overdue: 'The ledger records no due date for a commitment.',
  meeting: 'The support ledger records the work promised and delivered, not the meetings that came of it.',
};

const isNum = (v) => v !== null && v !== undefined && v !== '' && typeof v !== 'boolean' && Number.isFinite(Number(v));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

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
  const notInLedger = (key, label, reason) => ({ key, label, value: NOT_RECORDED, state: 'not_recorded', note: reason });

  const untouched = read.state === 'ok' && Array.isArray(read.value.untouched) ? read.value.untouched : [];
  const intros = introductionsOf(read);
  let introFigure;
  if (loading) introFigure = { key: 'intros', label: 'Introductions made', value: null, state: 'loading' };
  else if (intros.state === 'unreadable') introFigure = { key: 'intros', label: 'Introductions made', value: UNREADABLE, state: 'unreadable', note: intros.reason };
  else if (!intros.complete) introFigure = { key: 'intros', label: 'Introductions made', value: UNAVAILABLE, state: 'unavailable', note: intros.reason };
  else introFigure = { key: 'intros', label: 'Introductions made', value: String(intros.delivered), state: 'ok', note: `Delivered introduction entries · ${plural(intros.promised, 'still promised', 'still promised')}` };

  return [
    fromTotals('open', 'Open commitments', (x) => x.promised, () => 'Promised and not yet delivered or withdrawn'),
    notInLedger('in_progress', 'In progress', NOT_IN_LEDGER.inProgress),
    fromTotals('delivered', 'Delivered', (x) => x.delivered, (x) => (isNum(x.companies_in_book)
      ? `${x.companies_supported} of ${plural(Number(x.companies_in_book), 'company', 'companies')} in the book have an entry`
      : 'Every delivered entry in scope')),
    introFigure,
    notInLedger('overdue', 'Overdue commitments', NOT_IN_LEDGER.overdue),
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
  else closed = { label: 'Open', date: null, missing: 'Not delivered yet' };
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
    hours: hoursLabel(row.hours),
    outcome: row.outcome && String(row.outcome).trim() ? String(row.outcome).trim() : null,
    revision: Number(row.revision) || 1,
    row,
  };
}

/** The rows of one ledger read, newest first as the Worker orders them. */
export function commitmentsOf(read, me) {
  if (read.state !== 'ok') return [];
  return read.value.entries.map((r) => commitmentOf(r, me));
}

/**
 * The introductions the ledger records: its `intro` entries, delivered or
 * promised, each with "meeting resulting" Not recorded. `complete` says
 * whether the read held every entry, so the counts are the ledger's.
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
    promised: rows.filter((r) => r.state === 'promised').length,
    reason: complete ? null : (totalsOf(read)
      ? `Counted only over a read that holds every entry; this one holds the newest ${read.value.entries.length} of ${read.value.totals.entries}.`
      : 'The ledger’s total could not be read, so the introductions cannot be shown to be all of them.'),
  };
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
    promised: Number(c.promised) || 0,
    withdrawn: Number(c.withdrawn) || 0,
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
  if (filter === 'outstanding') params.state = 'promised';
  if (filter === 'delivered') params.state = 'delivered';
  return params;
}

/** A row of the current view: the Worker narrows by state, and the page checks it again. */
export function inView(filter) {
  return (row) => (filter === 'delivered' ? row.state === 'delivered'
    : filter === 'outstanding' ? row.state === 'promised'
      : true);
}
