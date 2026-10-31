/**
 * D1384 (#3692) — the Compliance layer of /calendar. Pure, so
 * `frontend/test/calendar_compliance_d1384.test.mjs` holds each rule and each
 * word.
 *
 * A deadline is a `compliance_due` item (`services/calendar/sourceReaders.ts`),
 * read from `compliance_events`, the store /compliance read and wrote. Every
 * change goes through that page's own writes (`api.complianceUpdate`,
 * `api.complianceDelete`, `api.complianceCreate`), so there is no second store.
 */

export const COMPLIANCE_KIND = 'compliance_due';

/** The Worker's event types, in /compliance's words. */
export const TYPE_WORDS = Object.freeze({
  annual_report: 'Annual report',
  franchise_tax: 'Franchise / corporate tax',
  registered_agent: 'Registered agent',
  board_meeting: 'Board meeting',
  other: 'Other',
});

/** `recurrence` as the Worker stores it, and what completing one adds (`routes/compliance.ts`). */
export const REPEAT_WORDS = Object.freeze({
  annual: 'Every year',
  quarterly: 'Every quarter',
  monthly: 'Every month',
  one_time: 'Once',
});
const REPEAT_DAYS = Object.freeze({ annual: 365, quarterly: 91, monthly: 30 });

export const STATE_WORDS = Object.freeze({ due: 'Due', overdue: 'Overdue', done: 'Done' });

const DAY_MS = 86_400_000;
const dayMs = (day) => Date.parse(`${String(day).slice(0, 10)}T00:00:00Z`);
export const todayKey = (now = new Date()) => {
  const d = now instanceof Date ? now : new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Whole days from today to the due day; negative once it has passed. */
export function daysUntil(due, today = todayKey()) {
  const a = dayMs(today), b = dayMs(due);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / DAY_MS) : null;
}

/** The state the Worker sent, or 'due' when it sent none. Done wins over the date. */
export function stateOf(item) {
  const s = item?.compliance?.state;
  return s === 'done' || s === 'overdue' || s === 'due' ? s : 'due';
}

/**
 * The pill's words: "Done", "Overdue by 3 days", "Due today", "Due in 12 days".
 * The Worker's state decides the word (it counts days in UTC); the reader's own
 * day count only qualifies it, and is left out where the two disagree.
 */
export function stateLine(item, today = todayKey()) {
  const state = stateOf(item);
  if (state === 'done') return 'Done';
  const n = daysUntil(item?.compliance?.due_date || item?.start_at, today);
  if (state === 'overdue') return n != null && n < 0 ? `Overdue by ${-n} ${-n === 1 ? 'day' : 'days'}` : 'Overdue';
  if (n == null || n < 0) return 'Due';
  if (n === 0) return 'Due today';
  return `Due in ${n} ${n === 1 ? 'day' : 'days'}`;
}

/** "Tue 10 Nov 2026", read as the day it is, never shifted by a time zone. */
export function dayWords(day) {
  const ms = dayMs(day);
  if (!Number.isFinite(ms)) return 'Not recorded';
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).formatToParts(new Date(ms));
  const o = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${o.weekday} ${o.day} ${o.month} ${o.year}`;
}

/** The day the Worker adds when a recurring deadline is marked done, or null for one that does not repeat. */
export function nextDueOf(due, recurrence) {
  const days = REPEAT_DAYS[recurrence];
  const ms = dayMs(due);
  if (!days || !Number.isFinite(ms)) return null;
  return new Date(ms + days * DAY_MS).toISOString().slice(0, 10);
}

/** The owner where one was recorded; never a guess. */
export function ownerLine(item) {
  const owner = item?.compliance?.owner;
  return owner ? { name: owner, missing: null } : { name: 'Not recorded', missing: 'Nobody recorded an owner for this deadline.' };
}

/** Where the row came from, in words. */
export function sourceLine(item) {
  const s = item?.compliance?.source;
  if (s === 'auto') return 'Added automatically for the venture’s jurisdiction.';
  if (s === 'google_calendar') return 'Added from a tagged event in your Google Calendar.';
  return null;
}

/** What each change does, in the Worker's own terms. Nothing is sent to anyone. */
export function doneSays(item) {
  const c = item?.compliance || {};
  const next = nextDueOf(c.due_date, c.recurrence);
  return next
    ? `Marks it done. Because it repeats ${String(REPEAT_WORDS[c.recurrence]).toLowerCase()}, the next one is added for ${dayWords(next)}.`
    : 'Marks it done. It does not repeat, so nothing new is added.';
}
export const SAYS = Object.freeze({
  reopen: 'Marks it as not done again. A next deadline already added stays as it is.',
  delete: 'Deletes this deadline for good. Nothing else is deleted, and its venture keeps every other deadline.',
  create: 'Adds the deadline to the venture’s compliance calendar. Nobody is sent anything.',
});

/** What a refused write says: the Worker's sentence, or the plan gate in words. */
export function refusalOf(e) {
  if (e?.status === 402) return 'Adding compliance deadlines is part of the Raise + Grow plan. Everything else on Calendar works on your plan.';
  const text = e?.data?.detail || e?.data?.message || e?.message || 'That did not work. Try again.';
  return String(text);
}

/** The new deadline's fields, checked as `POST /api/compliance/events` checks them. */
export function createError(form) {
  if (!form?.project_id) return 'Choose a venture.';
  if (!String(form.title || '').trim()) return 'Give the deadline a title.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(form.due_date || ''))) return 'Choose a due date.';
  return null;
}
