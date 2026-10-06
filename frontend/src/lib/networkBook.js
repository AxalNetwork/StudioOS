/**
 * The relationship book's two derived facts: how long since a contact was
 * touched, and whether that makes them "going cold".
 *
 * ONE DEFINITION, THREE READERS. The Network desk (A6), `/network/relationships`
 * and `/network/organizations` each carried their own `daysSince` and their own
 * `> 60`, so the desk could flag a contact the zone did not — or the reverse —
 * the first time one copy was edited. The canvas's cold window is 60 days
 * (`network_relationship_book.test.mjs` pins it against the canvas).
 *
 * WHAT IT READS IS `last_activity_at` AND NOTHING ELSE. That column is stamped
 * when a contact is created, so an untouched contact ages into "going cold" on
 * its 61st day. The flag is honest about the column; the column does not yet
 * tell a touch from an arrival.
 *
 * D551 (#1144): a contact now carries a `strength` and an `organization`
 * (migration 386), and the contact list carries its follow-up rollup —
 * `next_task_due`, `open_tasks` and `last_reply_at` — so the pages read those
 * here too, and print "Not recorded" for any of them that is absent.
 */

import { NOT_RECORDED } from './absence.js';

/** Days after the last recorded activity at which a contact reads as going cold. */
export const COLD_AFTER_DAYS = 60;

/** Whole days since a stored timestamp, or null when nothing parseable is stored. */
export function daysSince(value, now = Date.now()) {
  if (!value) return null;
  const stamp = new Date(value).getTime();
  if (!Number.isFinite(stamp)) return null;
  return Math.max(0, Math.floor((now - stamp) / 86400000));
}

/**
 * Going cold: last activity recorded, and more than the window ago.
 *
 * A contact with NO recorded activity is not cold — it is unknown, and calling
 * it cold would flag every imported contact the day it arrived.
 */
export function isCold(row, now = Date.now()) {
  const days = daysSince(row?.last_activity_at, now);
  return days !== null && days > COLD_AFTER_DAYS;
}

/** The organization a contact recorded, or '' — never inferred from an email domain. */
export function organizationOf(row) {
  return String(row?.organization || row?.company || row?.firm || '').trim();
}

/**
 * Ties whose recorded last touch (the log's MAX) is past the cold window.
 * A tie with no touch is unknown, not cold. Founder readers keep `isCold`,
 * which reads `last_activity_at` and is a different column.
 */
export function coldView(rows, now = Date.now()) {
  return (rows || []).filter((row) => {
    const days = daysSince(row?.last_interaction_at, now);
    return days !== null && days > COLD_AFTER_DAYS;
  });
}

/** Days since the coldest tie's last touch, or null when none are cold. */
export function coldestDays(rows, now = Date.now()) {
  const cold = coldView(rows, now);
  if (!cold.length) return null;
  return Math.max(...cold.map((row) => daysSince(row.last_interaction_at, now)));
}

/**
 * A date-only reminder (`YYYY-MM-DD`) is due on the viewer's calendar day,
 * not at the end of that UTC day. An ISO instant is due when that instant
 * has passed.
 */
export function reminderDue(remindAt, now = Date.now(), timeZone = 'UTC') {
  if (remindAt == null || remindAt === '') return false;
  const s = String(remindAt).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const local = new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(now));
    return local >= s;
  }
  const at = new Date(s).getTime();
  return Number.isFinite(at) && at <= now;
}

/** The canvas's strength set, in its order (A6: Strong, Warm, Cool). */
export const STRENGTHS = [
  { value: 'strong', label: 'Strong' },
  { value: 'warm', label: 'Warm' },
  { value: 'cool', label: 'Cool' },
];

/** A contact's strength as the pages print it: its label, or Not recorded — never Cool by default. */
export function strengthLabel(row) {
  const hit = STRENGTHS.find((s) => s.value === String(row?.strength || '').toLowerCase());
  return hit ? hit.label : NOT_RECORDED;
}

/** "Oct 20, 2026" from a stored date or timestamp; null when nothing parseable is stored. */
function shortDate(value) {
  if (!value) return null;
  const s = String(value);
  const t = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s).getTime();
  if (!Number.isFinite(t)) return null;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(t);
}

/**
 * The follow-up a contact has open, from the list's rollup: the next due
 * date (overdue when it has passed), open follow-ups with no date, or none.
 * A row from a Worker without the rollup reads Not recorded, not "none open".
 */
export function followUp(row, now = Date.now()) {
  if (row?.open_tasks === undefined) return { state: 'not_recorded', text: NOT_RECORDED };
  const open = Number(row.open_tasks) || 0;
  if (!open) return { state: 'none', text: 'No open follow-up' };
  const due = shortDate(row.next_task_due);
  if (!due) return { state: 'undated', text: `${open} open, no due date` };
  const overdue = new Date(/^\d{4}-\d{2}-\d{2}$/.test(row.next_task_due) ? `${row.next_task_due}T23:59:59Z` : row.next_task_due).getTime() < now;
  return { state: overdue ? 'overdue' : 'due', text: overdue ? `Follow-up overdue since ${due}` : `Follow up due ${due}` };
}

/** When the last reply was logged, or Not recorded. */
export function lastNote(row) {
  return shortDate(row?.last_reply_at) || NOT_RECORDED;
}
