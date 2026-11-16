/**
 * #5310 part 2 — NW2 and NW2.1 of the approved Network workspace canvas
 * (`design/incoming/network-workspace/NW2-Relationships.dc.html`, D4799):
 * the member's own relationship book as a table, and one person's sheet.
 * `FounderRelationshipBook.jsx` draws only what these functions return.
 *
 * Every value is the member's own book (`GET /api/contacts/book`, D1352, with
 * #5310's follow-up and activity fields) or one contact's notes and follow-ups
 * (D1351). A value no read carries is Not recorded with its reason, never a
 * zero or a guess: no strength score is stored, and introductions are not
 * joined to a book row.
 */
import { NOT_RECORDED } from '../../lib/absence';
import { sourceChips } from '../account/linkedinModel';

export { NOT_RECORDED };

/** The book's source filter (`GET /api/contacts/book?source=`), in the Worker's words. '' is every source. */
export const SOURCE_FILTERS = Object.freeze([
  { value: '', label: 'All' },
  { value: 'linkedin_csv', label: 'LinkedIn import' },
  { value: 'csv', label: 'CSV import' },
  { value: 'typed', label: 'Added by you' },
]);

const SOURCE_WORD = { linkedin: 'LinkedIn import', csv: 'CSV import', typed: 'Added by you' };

/** A row's sources, in words, one per kind: "LinkedIn import · CSV import". */
export function sourceLine(sources) {
  return sourceChips(sources).map((c) => SOURCE_WORD[c.key]).join(' · ');
}

/** A D1 stamp or a date ("2026-09-27 10:00:00", "2026-09-27"), as its day, or null. */
export function dayOf(stamp) {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(stamp ?? ''));
  return m ? m[1] : null;
}

/**
 * The row's last recorded activity: the latest of its last note, its last
 * finished follow-up, and when it entered the book (imported or added). The
 * full stamp decides the order; the day is what is shown.
 */
export function lastActivity(c) {
  const imported = (c.sources || []).some((s) => s !== 'typed');
  const candidates = [
    [c.last_note_at, 'note'],
    [c.last_done_at, 'follow-up done'],
    [c.created_at, imported ? 'imported' : 'added'],
  ].filter(([at]) => dayOf(at));
  if (!candidates.length) return { text: NOT_RECORDED, at: null };
  const [at, kind] = candidates.reduce((best, x) => (String(x[0]) > String(best[0]) ? x : best));
  return { text: `${dayOf(at)} ${kind}`, at: String(at) };
}

/**
 * The row's follow-up cell. Overdue first (an open follow-up due before today,
 * B1); then the open count with the next due date; then None. The counts come
 * from the read, never from a page of follow-ups.
 */
export function followUpCell(c) {
  const overdue = Number(c.overdue_tasks) || 0;
  const open = Number(c.open_tasks) || 0;
  if (overdue > 0) return { tone: 'overdue', text: `${overdue} overdue` };
  if (open > 0) return { tone: 'open', text: c.next_due_on ? `${open} · due ${dayOf(c.next_due_on)}` : `${open} open · no due date` };
  return { tone: 'none', text: 'None' };
}

/** The table's rows. */
export function bookRows(contacts) {
  return (contacts || []).map((c) => ({
    id: c.id,
    name: c.name || NOT_RECORDED,
    organization: c.company || NOT_RECORDED,
    role: c.title || NOT_RECORDED,
    lastActivity: lastActivity(c).text,
    followUps: followUpCell(c),
    source: sourceLine(c.sources),
  }));
}

/** "1–50 of 142"; "0 people" when the read holds none. */
export function rangeLabel(data) {
  const total = Number(data?.total) || 0;
  if (!total) return '0 people';
  const size = Number(data.page_size) || 50;
  const page = Math.max(1, Number(data.page) || 1);
  const from = (page - 1) * size + 1;
  return `${from}–${Math.min(total, from + size - 1)} of ${total}`;
}
export const pageCount = (data) => Math.max(1, Math.ceil((Number(data?.total) || 0) / (Number(data?.page_size) || 50)));

/** "142 people · private to you". */
export function bookCountLine(data) {
  const total = Number(data?.total);
  return Number.isFinite(total) ? `${total} ${total === 1 ? 'person' : 'people'} · private to you` : 'Private to you';
}

/** The Person Sheet's context line, from the book row alone. */
export function contextLine(c) {
  const imported = (c.sources || []).some((s) => s !== 'typed');
  const how = imported ? `Imported${(c.sources || []).some((s) => s.startsWith('linkedin')) ? ' from LinkedIn' : ''}` : 'Added by you';
  const on = dayOf(c.created_at);
  const since = dayOf(c.connected_on);
  return `${how}${on ? ` on ${on}` : ''}${since ? ` · connected since ${since}` : ''}.`;
}

/**
 * The sheet's follow-ups, open ones first (the Worker's order), each with its
 * state in words: Overdue (due before `today`), due, no due date, or done.
 */
export function followUpRows(tasks, today) {
  return (tasks || []).map((t) => {
    const due = dayOf(t.due_on);
    if (t.done_at) return { uid: t.uid, title: t.title, done: true, tone: 'done', line: `done ${dayOf(t.done_at) || NOT_RECORDED}` };
    if (due && due < today) return { uid: t.uid, title: t.title, done: false, tone: 'overdue', line: `Overdue · due ${due}` };
    return { uid: t.uid, title: t.title, done: false, tone: 'open', line: due ? `due ${due}` : 'No due date' };
  });
}

/**
 * The sheet's interaction history: what the book records about this person,
 * newest first: notes written, follow-ups finished, when they entered the
 * book, and the LinkedIn connection date. Introductions are not joined to a
 * book row, so none is listed (D5310).
 */
export function historyRows(c, notes, tasks) {
  const rows = [];
  for (const n of notes || []) if (dayOf(n.created_at)) rows.push({ key: `n-${n.uid}`, at: String(n.created_at), text: 'Private note added' });
  for (const t of tasks || []) if (dayOf(t.done_at)) rows.push({ key: `t-${t.uid}`, at: String(t.done_at), text: `Follow-up done · ${t.title}` });
  if (dayOf(c.created_at)) {
    const imported = (c.sources || []).some((s) => s !== 'typed');
    rows.push({ key: 'entered', at: String(c.created_at), text: imported ? `Imported${(c.sources || []).some((s) => s.startsWith('linkedin')) ? ' from LinkedIn' : ''}` : 'Added to your book' });
  }
  if (dayOf(c.connected_on)) rows.push({ key: 'connected', at: String(c.connected_on), text: 'Connected on LinkedIn' });
  return rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).map((r) => ({ ...r, day: dayOf(r.at) }));
}

/** A follow-up's body, or what to fix first. A due date is a day, today or later is not required (the Worker records any day). */
export function followUpBody(title, dueOn) {
  const t = String(title || '').trim();
  if (!t) return { error: 'Write what to follow up on.' };
  if (t.length > 300) return { error: 'Keep it to 300 characters.' };
  if (dueOn && !/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) return { error: 'Pick a due date, or leave it empty.' };
  return { title: t, due_on: dueOn || null };
}

/** A note's body, or what to fix first (the Worker stores 1 to 4,000 characters). */
export function noteBody(text) {
  const t = String(text || '').trim();
  if (!t) return { error: 'Write the note first.' };
  if (t.length > 4000) return { error: 'Keep a note to 4,000 characters.' };
  return { body: t };
}

export const STRENGTH_LINE = 'Relationship strength: Not recorded. The platform keeps notes, follow-ups and introductions, not a strength score.';
export const ADD_PERSON_UNBUILT = 'Adding a person by hand is not built yet: your book is filled by importing today.';
export const ROLE_NOTE = 'Role / context is the title on the record; the relationship kind (investor, customer, peer) is not recorded.';
