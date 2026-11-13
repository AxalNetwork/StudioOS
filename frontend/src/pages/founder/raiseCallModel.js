// D1225 (#3224, Calls part 4) — the founder's one call, CLS8–CLS11 and CLS14,
// as pure functions over `GET /api/round-calls/:uid` (D653, D1222). The page
// draws from these; it computes nothing of its own.
//
// AN AMOUNT IS INDICATED, NEVER COMMITTED (D653). A matching investor stays
// nameless until they respond: the Worker sends no name, and this file draws
// none, nor when they opened the call. A value the read does not carry is
// "Not recorded", never a zero.

import { NOT_RECORDED } from '../../lib/absence.js';

export { NOT_RECORDED };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const HIDDEN = 'Not shown until they respond';
export const NAME_HIDDEN = 'Name hidden until they respond';
export const INDICATIVE = 'Indicative. It is an intention, not a payment and not a signed investment.';
export const PAGE_SIZE = 25;

const stampMs = (value) => {
  if (!value) return NaN;
  const s = String(value);
  return Date.parse(s.length === 10 ? `${s}T12:00:00Z` : `${s.replace(' ', 'T')}${/Z|[+-]\d\d:?\d\d$/.test(s) ? '' : 'Z'}`);
};

/** "1 Oct 2026", in UTC as D1 stores it; null with no stamp. */
export function longDay(value) {
  const ms = stampMs(value);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "24 Oct", for a row's last activity. */
export function shortDay(value) {
  const ms = stampMs(value);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "$100,000", and "$1,234.50" only when there are cents; "Not recorded" for none. */
export function money(cents) {
  if (cents == null || !Number.isFinite(Number(cents))) return NOT_RECORDED;
  const n = Number(cents) / 100;
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: Number(cents) % 100 ? 2 : 0, maximumFractionDigits: 2 });
}

const INSTRUMENTS = { safe: 'SAFE', equity: 'Equity', convertible_note: 'Convertible note' };
const today = () => new Date().toISOString().slice(0, 10);

/**
 * The call's state as the canvas names it (CLS8, CLS9): Draft, Open, Awaiting
 * counsel, Expired (sent, past its close) or Closed.
 */
export function stateOf(call, now = today()) {
  if (call.state === 'draft') return 'Draft';
  if (call.state === 'awaiting_counsel') return 'Awaiting counsel';
  if (call.state === 'closed') return 'Closed';
  if (call.state === 'sent' && call.target_close && call.target_close < now) return 'Expired';
  if (call.state === 'sent') return 'Open';
  return call.state;
}

export const STATE_TONE = Object.freeze({ Draft: 'muted', Open: 'green', 'Awaiting counsel': 'amber', Expired: 'muted', Closed: 'muted' });

/** CLS8's line: "Sent 1 Oct 2026 · closes 15 Nov 2026 · SAFE · cap $10,000,000 · minimum $25,000". */
export function callLine(call) {
  const parts = [
    call.sent_at ? `Sent ${longDay(call.sent_at)}` : 'Not sent',
    `closes ${longDay(call.target_close) || NOT_RECORDED}`,
    INSTRUMENTS[call.instrument] || null,
    call.valuation_cap_cents != null ? `cap ${money(call.valuation_cap_cents)}` : null,
    call.discount_bps != null ? `discount ${Number(call.discount_bps) / 100}%` : null,
    call.pre_money_cents != null ? `pre-money ${money(call.pre_money_cents)}` : null,
    call.minimum_cheque_cents != null ? `minimum ${money(call.minimum_cheque_cents)}` : null,
  ];
  return parts.filter(Boolean).join(' · ');
}

/** CLS9: what a call that takes no responses says, or null while it is open. */
export function stateNote(call, progress, now = today()) {
  const state = stateOf(call, now);
  if (state === 'Draft') return { kind: 'draft', line: 'Not sent.' };
  if (state === 'Awaiting counsel') {
    const asked = shortDay(call.counsel_requested_at);
    return {
      kind: 'awaiting',
      line: `Sent ${longDay(call.sent_at) || NOT_RECORDED} · asked to extend to ${longDay(call.target_close) || NOT_RECORDED}${asked ? ` on ${asked}` : ''}`,
      note: 'Responses are paused until counsel approves the extended terms.',
    };
  }
  if (state === 'Expired') return { kind: 'expired', line: `This call closed on ${longDay(call.target_close) || NOT_RECORDED} with ${money(progress.committed_cents)} indicated. It is read-only.` };
  if (state === 'Closed') return { kind: 'closed', line: `This call closed on ${longDay(call.closed_at) || NOT_RECORDED} with ${money(progress.committed_cents)} indicated. It is read-only.` };
  return null;
}

/* ------------------------------------------------------------------ *
 * Recipients
 * ------------------------------------------------------------------ */

/** A recipient is named when chosen, or once they respond (the Worker's own rule). */
export const isNamed = (r) => Boolean(r.name);

/** Their furthest step, in the canvas's words; a hidden match shows none. */
export function furthestOf(r) {
  if (!isNamed(r)) return { key: 'hidden', label: HIDDEN };
  if (r.commitment_cents != null) return { key: 'indicated', label: 'Indicated an amount' };
  if (r.data_room_requested_at) return { key: 'data_room', label: 'Asked for the data room' };
  if (r.responded_at) return { key: 'question', label: 'Asked a question' };
  if (r.opened_at) return { key: 'opened', label: 'Opened the call' };
  return { key: 'none', label: 'Not opened' };
}
const RANK = { indicated: 4, data_room: 3, question: 2, opened: 1, none: 0, hidden: -1 };

/** When they last did something, or null. A hidden match shows none. */
export function lastActivity(r) {
  if (!isNamed(r)) return null;
  const times = [r.committed_at, r.last_response_at, r.responded_at, r.data_room_requested_at, r.opened_at].filter(Boolean).map((t) => stampMs(t)).filter(Number.isFinite);
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
}

export const told = (r) => r.delivery_state === 'notified';
export const notTold = (r) => r.delivery_state === 'not_delivered';

/** "Chosen · …" or "Matching · named once they responded", under the name. */
export function originLine(r) {
  if (!isNamed(r)) return NAME_HIDDEN;
  return r.origin === 'chosen' ? 'Chosen from your pipeline' : 'Matching · named once they responded';
}

export const FILTERS = Object.freeze([
  ['all', 'All'], ['indicated', 'Indicated'], ['data_room', 'Data room'], ['opened', 'Opened'], ['not_opened', 'Not opened'], ['not_told', 'Not told'],
]);
export const SORTS = Object.freeze([['furthest', 'Furthest along'], ['latest', 'Latest']]);

const matches = (r, filter) => {
  if (filter === 'all') return true;
  if (filter === 'not_told') return notTold(r);
  if (!isNamed(r)) return false;
  if (filter === 'indicated') return r.commitment_cents != null;
  if (filter === 'data_room') return Boolean(r.data_room_requested_at);
  if (filter === 'opened') return Boolean(r.opened_at);
  if (filter === 'not_opened') return !r.opened_at;
  return true;
};

/** The rows the controls leave, in their order; ties keep the Worker's order. */
export function visibleRows(recipients, { q = '', filter = 'all', sort = 'furthest' } = {}) {
  const needle = q.trim().toLowerCase();
  return (recipients || [])
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => matches(r, filter))
    .filter(({ r }) => !needle || `${r.name || ''} ${r.email || ''}`.toLowerCase().includes(needle))
    .sort(sort === 'latest'
      ? (a, b) => {
        const x = lastActivity(a.r); const y = lastActivity(b.r);
        if (x === y) return a.i - b.i;
        if (!x) return 1;
        if (!y) return -1;
        return x < y ? 1 : -1;
      }
      : (a, b) => RANK[furthestOf(b.r).key] - RANK[furthestOf(a.r).key] || a.i - b.i)
    .map(({ r }) => r);
}

/** "1–25 of 30". */
export function pageLabel(page, total) {
  if (!total) return '0 of 0';
  const from = page * PAGE_SIZE + 1;
  return `${from}–${Math.min(from + PAGE_SIZE - 1, total)} of ${total}`;
}

/** A recipient's timeline, from the stamps the read carries (CLS11). */
export function timelineOf(r) {
  if (!isNamed(r)) return [];
  return [
    r.opened_at && { at: r.opened_at, label: 'Opened the call' },
    r.data_room_requested_at && { at: r.data_room_requested_at, label: 'Asked for the data room' },
    r.commitment_cents != null && { at: r.committed_at || null, label: 'Indicated an amount', sub: `${money(r.commitment_cents)} · Recorded` },
  ].filter(Boolean);
}

/** Their questions: matched on their address, which only a named recipient carries. */
export const questionsOf = (r, questions) => (isNamed(r) && r.email ? (questions || []).filter((q) => q.email && q.email === r.email) : []);

/* ------------------------------------------------------------------ *
 * The strip and the funnel (CLS8)
 * ------------------------------------------------------------------ */

export function stripOf(d) {
  const p = d.progress || {};
  const rs = d.recipients || [];
  const waiting = (d.questions || []).filter((q) => !q.answer && !q.update_uid).length;
  const pct = p.target_cents ? Math.min(100, Math.round((Number(p.committed_cents || 0) / Number(p.target_cents)) * 100)) : null;
  return {
    indicated: { value: money(p.committed_cents), sub: `of ${money(p.target_cents)} · indicative`, pct },
    recipients: { value: rs.length, sub: `${rs.filter((r) => r.origin === 'chosen').length} chosen · ${rs.filter((r) => r.origin !== 'chosen').length} matching` },
    opened: { value: p.opened ?? null },
    dataRoom: { value: p.data_room_requests ?? null, sub: 'asked for access' },
    waiting: { value: waiting },
    notTold: { value: p.not_delivered ?? null },
  };
}

export function funnelOf(d) {
  const p = d.progress || {};
  return [
    ['Recipients', (d.recipients || []).length],
    ['Opened', p.opened ?? null],
    ['Asked for the data room', p.data_room_requests ?? null],
    ['Indicated an amount', p.commitments ?? null],
  ];
}

export function funnelSentence(rows) {
  const [r, o, dr, i] = rows.map(([, n]) => n);
  if ([r, o, dr, i].some((n) => n == null)) return null;
  return `Of ${r} recipients, ${o} opened the call, ${dr} asked for the data room and ${i} indicated an amount.`;
}

/* ------------------------------------------------------------------ *
 * Dialogs and refusals (CLS10, CLS12)
 * ------------------------------------------------------------------ */

export const EXTEND_NOTE = 'Extending pauses responses until counsel approves the new terms. Investors keep what they already sent.';
export const EXTEND_TOLD = 'Recipients are told on Axal once counsel approves the new date.';
export const CLOSE_LINE = 'Investors can no longer respond. Nothing already indicated is lost.';
export const CLOSE_TOLD = 'Recipients are told on Axal that the call is closed.';
export const ANSWER_TOLD = 'Investors who asked see your answer.';
export const FOOT_LINE = 'Investors keep what they already sent.';
export const OWNER_ONLY = 'Only the venture’s owner can send, extend or close a call.';

/** A date later than the call's close and not in the past, as the Worker checks it. */
export function extensionValid(call, value, now = today()) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && value > call.target_close && value >= now;
}

const SENTENCES = {
  call_changed: 'This call changed since you opened it. Reload to see its current state.',
  call_read_only: 'This call no longer takes changes. Reload to see its current state.',
  invalid_extension: 'Choose a date after the current closing date.',
  invalid_action: 'That change is not one a call takes.',
  question_unavailable: 'This question can no longer be answered here.',
  founder_required: OWNER_ONLY,
  round_calls_disabled: 'Calls for Capital are switched off, so nothing can change here.',
};

export function refusalOf(e) {
  const code = e?.code || e?.data?.code || (typeof e?.data?.error === 'string' ? e.data.error : null);
  if (code && SENTENCES[code]) return { text: SENTENCES[code], reload: code === 'call_changed' || code === 'call_read_only' };
  if (Number(e?.status) === 403) return { text: OWNER_ONLY, reload: false };
  if (!e?.status || Number(e.status) >= 500) return { text: 'The change could not be confirmed. Check the call before trying again.', reload: true };
  return { text: 'This change was refused. Check the call’s current state.', reload: true };
}

/* ------------------------------------------------------------------ *
 * No permission (CLS14)
 * ------------------------------------------------------------------ */

export const ADMIN_REFUSED = 'Calls belong to the venture’s founders. Studio admins do not open them.';
