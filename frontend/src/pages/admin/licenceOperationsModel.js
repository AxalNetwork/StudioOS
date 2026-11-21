/**
 * D4819 part 12 (#5923) — the words of a licence's Operations › Requests and
 * compliance (Licences v2 board L12), as pure functions over reads that are on
 * main already:
 *
 *   requests   GET /api/admin/licences/:uid/requests   (open requests, oldest first)
 *   decision   PATCH /api/admin/escalations/:uid       (the row as decided: status, answered_by_name, answered_at)
 *   notices    GET /api/admin/licences/:uid/notices    (the compliance ladder's notices)
 *
 * Pure, so `frontend/test/licence_operations_d5923.test.mjs` holds each rule.
 * Nothing here turns an unread value into a 0 or a "none".
 */
import { NOT_RECORDED } from '../../lib/absence';
import { toUtcInstant } from '../../lib/notices';

export { NOT_RECORDED };

/**
 * How long a request has been waiting, from its `created_at` to `now`, in the
 * canvas's words: "4 days", "1 day", "5 hours", "Under an hour". A created_at
 * that is not a time is Not recorded, never "0 days".
 */
export function requestAge(createdAt, now = new Date().toISOString()) {
  const from = Date.parse(toUtcInstant(createdAt) || '');
  const to = Date.parse(toUtcInstant(now) || '');
  if (Number.isNaN(from) || Number.isNaN(to)) return NOT_RECORDED;
  const hours = Math.max(0, Math.floor((to - from) / 3_600_000));
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `${days} ${days === 1 ? 'day' : 'days'}`;
  }
  if (hours >= 1) return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  return 'Under an hour';
}

/** The escalation board has two decided states; the canvas calls them Approve and Decline. */
export const DECISION_WORDS = Object.freeze({ answered: 'Approved', declined: 'Declined' });

/** "2026-11-14 10:32 UTC" for an instant, or null when it is not one. */
function utcMinute(v) {
  const t = Date.parse(toUtcInstant(v) || '');
  if (Number.isNaN(t)) return null;
  return `${new Date(t).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/**
 * A request decided on this page, from the row the PATCH answered with (via
 * `recordOf`): what was decided, by whom and when. Who and when come from the
 * record only; a field the record does not carry says Not recorded.
 */
export function decidedLine(record) {
  const word = DECISION_WORDS[record?.status] || (record?.status ? String(record.status) : 'Decided');
  const by = record?.answered_by_name ? String(record.answered_by_name) : NOT_RECORDED;
  const at = utcMinute(record?.answered_at) || NOT_RECORDED;
  return { word, by, at, text: `${word} by ${by} · ${at}` };
}

/**
 * The heading's state for Studio requests, from one read: `undefined` while
 * it is on its way, `null` when it failed, else `{ items, total, branchReadable }`.
 * Only a read that counted none and looked at the branch too is None.
 */
export function requestsState(read) {
  if (read === undefined) return { state: 'reading', word: 'Reading…' };
  if (read === null) return { state: 'unavailable', word: 'Unavailable' };
  if (!Number.isFinite(read.total)) return { state: 'unavailable', word: 'Count unavailable' };
  if (read.total === 0) {
    return read.branchReadable === false
      ? { state: 'unavailable', word: 'Partly unavailable' }
      : { state: 'none', word: 'None' };
  }
  return { state: 'attention', word: `${read.total} waiting` };
}

/* ------------------------------------------------------------------ *
 * Compliance                                                          *
 * ------------------------------------------------------------------ */

/** Notice statuses (migration 264) that close a notice. Every other one is outstanding. */
export const CLOSED_NOTICE_STATUSES = new Set(['accepted', 'withdrawn']);

/** A notice's state in operator words; who has to act is part of the state. */
export const NOTICE_STATE_WORDS = Object.freeze({
  issued: 'Open · waiting on the administrator',
  overdue: 'Overdue · account frozen',
  responded: 'Answered · waiting on HQ’s review',
  rejected: 'Rejected · account frozen',
  accepted: 'Accepted',
  withdrawn: 'Withdrawn',
});

export const noticeStateWord = (status) => NOTICE_STATE_WORDS[status] || (status ? String(status).replace(/_/g, ' ') : NOT_RECORDED);

export const isOutstanding = (n) => !CLOSED_NOTICE_STATUSES.has(n?.status);

/**
 * The Compliance heading's state over the notices read: `undefined` reading,
 * `null` unreadable, else the list. Outstanding notices are counted, so one
 * is seen from the heading without opening any notice.
 */
export function complianceState(items) {
  if (items === undefined) return { state: 'reading', word: 'Reading…', outstanding: null };
  if (!Array.isArray(items)) return { state: 'unavailable', word: 'Unavailable', outstanding: null };
  if (!items.length) return { state: 'none', word: 'No notices', outstanding: 0 };
  const n = items.filter(isOutstanding).length;
  if (!n) return { state: 'ok', word: 'Nothing outstanding', outstanding: 0 };
  return { state: 'attention', word: `${n} outstanding`, outstanding: n };
}
