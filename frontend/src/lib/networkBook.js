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

/**
 * #4611 finding 9 — THE ARRAY-SAFE COLD VIEW FOR `last_activity_at`.
 *
 * `contacts.filter(isCold)` is what the relationship book did, and
 * `Array.prototype.filter` calls its callback as `(element, index, array)`. So
 * `isCold`'s second parameter — `now`, defaulting to `Date.now()` — received
 * the ROW INDEX. For the first row `now` was 0, and `daysSince(stamp, 0)`
 * clamps at `Math.max(0, …)`, so every contact whose last activity is after
 * 1970 measured 0 days old and no row was ever cold. The summary tile read
 * "Going cold: 0" and "Coldest: Unavailable" while the chip filter beside it
 * — `(row) => isCold(row)`, an arrow, so correctly defaulted — and the table's
 * own per-row "· going cold" both flagged the same records. Three readers of
 * one definition, one of them silently measuring against a clock of 0, 1, 2.
 *
 * `coldView` existed and could not be used: it reads `last_interaction_at`,
 * the investor and advisor tie column, which a founder contact does not carry.
 * This is its founder twin, on `last_activity_at`, and it takes `now` ONCE for
 * the whole list — so every row in a summary is measured against the same
 * instant, which a per-row call cannot guarantee across a midnight boundary.
 *
 * Passing `isCold` bare to `filter` is now a mistake with an alternative
 * rather than a mistake with a workaround.
 */
export function coldBookView(rows, now = Date.now()) {
  return (rows || []).filter((row) => isCold(row, now));
}

/** Days since the coldest book contact's last recorded activity, or null when none are cold. */
export function coldestBookDays(rows, now = Date.now()) {
  const cold = coldBookView(rows, now);
  if (!cold.length) return null;
  return Math.max(...cold.map((row) => daysSince(row.last_activity_at, now)));
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
export function shortDate(value) {
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

/**
 * #6259 — the investor tie's touch history and reminders, read back.
 *
 * The touch log (`GET /api/partnernet/relationships/:id/interactions`) and the
 * reminders (`GET /api/partnernet/reminders?all=1`) were written by the page
 * and never shown. These four helpers are what the page reads them through.
 * They are the investor tie's (`partner_interactions`, `partner_reminders`,
 * migration 338) — not #5310's Person Sheet, which is a different store.
 */

const stamp = (value) => {
  if (!value) return Number.NaN;
  const s = String(value);
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s.replace(' ', 'T')).getTime();
};

/**
 * The recorded touches, newest first: by when the touch happened, then by
 * when it was recorded. The route already orders by `interacted_at DESC`; the
 * page sorts again so the order does not rest on a query nobody here reads.
 * A row with no parseable date sinks to the end rather than to the top.
 */
export function touchHistory(items) {
  const rank = (value) => (Number.isFinite(stamp(value)) ? stamp(value) : -Infinity);
  return [...(Array.isArray(items) ? items : [])].sort((a, b) => (
    rank(b?.interacted_at) - rank(a?.interacted_at) || rank(b?.created_at) - rank(a?.created_at)
  ));
}

/**
 * Who recorded a touch. The route joins `users.name AS recorded_by_name`, and
 * both people on an accepted tie already see each other's name in the book,
 * so the name is shown. "You" for the reader's own; "The other person" only
 * when the name is absent and the id is the other party's; otherwise Not
 * recorded — never a guess at whose touch it was.
 */
export function touchRecorder(row, userId, otherId) {
  const by = Number(row?.recorded_by);
  if (Number.isFinite(by) && userId != null && by === Number(userId)) return 'You';
  const name = String(row?.recorded_by_name ?? '').trim();
  if (name) return name;
  if (Number.isFinite(by) && otherId != null && by === Number(otherId)) return 'The other person';
  return NOT_RECORDED;
}

/** The tie's open reminder: the earliest not-done one, or null. */
export function openReminderFor(reminders, relationshipId) {
  const open = (reminders || []).filter((r) => !Number(r?.done) && Number(r?.relationship_id) === Number(relationshipId));
  if (!open.length) return null;
  return open.reduce((first, r) => (String(r.remind_at) < String(first.remind_at) ? r : first));
}

/**
 * The reminders view's two lists: upcoming (open, soonest first — a due one
 * stays here until it is marked done) and done (most recently done first).
 */
export function reminderLists(reminders) {
  const rows = Array.isArray(reminders) ? reminders : [];
  const upcoming = rows.filter((r) => !Number(r?.done))
    .sort((a, b) => String(a.remind_at).localeCompare(String(b.remind_at)));
  const done = rows.filter((r) => Number(r?.done))
    .sort((a, b) => String(b.done_at || '').localeCompare(String(a.done_at || '')));
  return { upcoming, done };
}
