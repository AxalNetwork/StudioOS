/**
 * D3959 (#3959) — a member's own learning plan, the words and rules the
 * frontend draws by. Pure, for the Node test. The Worker half is on main
 * (#3967, `routes/learning_plan.ts`); every rule here mirrors one it enforces,
 * so the sheet refuses early with the same sentence instead of a round trip.
 *
 *   planBody          the POST body from the sheet's fields, or the reason it
 *                     cannot be sent
 *   rescheduleBody    the PATCH body for a new date and time
 *   splitPlan         the plan page's Upcoming and Past, one row per occurrence
 *   goalRows          each goal with its target date and whether its item is
 *                     done; nothing done reads nothing, never "0%"
 *   calendarActions   what a Learning entry on the Calendar offers
 *
 * People are never named here, and a missing figure is never a 0.
 */
import { NOT_RECORDED } from '../../lib/absence.js';

export { NOT_RECORDED };

export const KIND_WORDS = {
  course: 'Course', lesson: 'Lesson', video: 'Video', webinar: 'Webinar',
  exercise: 'Exercise', exam: 'Exam', study_block: 'Study block',
};
export const REPEAT_WORDS = { none: 'Does not repeat', daily: 'Every day', weekly: 'Every week' };
export const REMINDERS = [
  { value: null, label: 'No reminder' },
  { value: 0, label: 'When it starts' },
  { value: 10, label: '10 minutes before' },
  { value: 30, label: '30 minutes before' },
  { value: 60, label: '1 hour before' },
  { value: 1440, label: '1 day before' },
];
export const DURATIONS = [15, 30, 45, 60, 90, 120];
export const DURATION_MIN = 5;
export const DURATION_MAX = 480;
export const TITLE_MAX = 200;

export const PLAN_TITLE = 'My learning plan';
export const PLAN_SUB = 'What you have put on your calendar to learn, and the goals you set.';
export const ADD_LABEL = 'Add to my plan';
export const STUDY_BLOCK_LABEL = 'Add a study block';
/** What the sheet says under the subject, per kind. */
export const KIND_NOTES = {
  webinar: 'A webinar is planned at its own time, and adding it registers you.',
  exam: 'This only reserves the time. It never starts the exam; you start it on the exam page.',
  exercise: 'It is marked done when you submit the exercise.',
  course: 'It is marked done when Learning records the course complete.',
  lesson: 'It is marked done when Learning records the lesson complete.',
  video: 'It is marked done when Learning records the video complete.',
  study_block: 'Time for your own study. You mark it done.',
};
/** The Worker's refusal codes in the member's words. */
export const REFUSALS = {
  full: 'This webinar is full.',
  webinar_not_open: 'This webinar is not open for registration.',
  webinar_ended: 'This webinar has no upcoming time.',
  webinar_time_fixed: 'A webinar keeps its own time.',
  not_found: 'That learning item is not available to you.',
  support_session_refused: 'A support session cannot change a member’s learning plan.',
};

/** The sheet's refusal, or the thrown error's own words. */
export function refusalOf(err) {
  const code = err?.code || err?.data?.error;
  return REFUSALS[code] || err?.message || 'That did not save. Nothing was changed.';
}

const pad = (n) => String(n).padStart(2, '0');
/** The next half hour from `now`, as the sheet's date and time fields (local). */
export function defaultStart(now = new Date()) {
  const d = new Date(now.getTime());
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60);
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}
/** Local date and time fields as an ISO instant, or null. */
export function instantOf(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) || !/^\d{2}:\d{2}$/.test(String(time || ''))) return null;
  const t = new Date(`${date}T${time}:00`).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/**
 * The POST body for `learningPlanApi.create`, or `{ error }`. `subject` is
 * `{ kind, uid }` (no uid for a study block); `form` is the sheet's fields.
 * A webinar sends no time: the Worker plans it at its own.
 */
export function planBody(subject, form, now = Date.now()) {
  const kind = subject?.kind;
  if (!KIND_WORDS[kind]) return { error: 'Choose what to plan.' };
  if (kind !== 'study_block' && !subject.uid) return { error: 'Choose what to plan.' };
  const body = { item_kind: kind };
  if (kind !== 'study_block') body.item_uid = subject.uid;
  const title = String(form?.title || '').trim();
  if (kind === 'study_block' && !title) return { error: 'Name the study block.' };
  if (title.length > TITLE_MAX) return { error: `The title is at most ${TITLE_MAX} characters.` };
  if (title) body.title_override = title;
  if (form?.remind !== undefined) body.remind_min_before = form.remind;
  const goal = String(form?.goal || '').trim();
  if (goal) body.goal = { text: goal.slice(0, 200), target_date: /^\d{4}-\d{2}-\d{2}$/.test(String(form?.goalDate || '')) ? form.goalDate : null };
  if (kind === 'webinar') return { body };
  const at = instantOf(form?.date, form?.time);
  if (!at) return { error: 'Choose when it starts.' };
  if (Date.parse(at) < now - 60_000) return { error: 'Choose a time that has not passed.' };
  const d = Number(form?.duration);
  if (!Number.isInteger(d) || d < DURATION_MIN || d > DURATION_MAX) return { error: `A duration is ${DURATION_MIN} to ${DURATION_MAX} minutes.` };
  const repeat = REPEAT_WORDS[form?.repeat] ? form.repeat : 'none';
  Object.assign(body, { starts_at: at, duration_min: d, repeat });
  if (repeat !== 'none' && form?.until) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.until)) return { error: 'Repeat until is a date.' };
    if (form.until < String(form.date)) return { error: 'Repeat until comes after the start.' };
    body.repeat_until = form.until;
  }
  return { body };
}

/** The PATCH body for a new date and time, or `{ error }`. A webinar keeps its own time. */
export function rescheduleBody(item, date, time, now = Date.now()) {
  if (item?.item_kind === 'webinar') return { error: REFUSALS.webinar_time_fixed };
  const at = instantOf(date, time);
  if (!at) return { error: 'Choose when it starts.' };
  if (Date.parse(at) < now - 60_000) return { error: 'Choose a time that has not passed.' };
  return { body: { starts_at: at } };
}

/** The plan page's rows: one per occurrence, Upcoming (soonest first) and Past (latest first). */
export function splitPlan(items, now = Date.now()) {
  const rows = [];
  for (const it of Array.isArray(items) ? items : []) {
    const occ = Array.isArray(it.occurrences) && it.occurrences.length ? it.occurrences : [it.starts_at];
    for (const at of occ) {
      const t = Date.parse(at);
      if (!Number.isFinite(t)) continue;
      rows.push({
        key: `${it.uid}:${at}`, uid: it.uid, at, kind: it.item_kind, kindWord: KIND_WORDS[it.item_kind] || 'Learning',
        title: it.title || KIND_WORDS[it.item_kind] || 'Learning', href: it.available === false ? null : it.href || null,
        available: it.available !== false, minutes: it.duration_min, repeat: REPEAT_WORDS[it.repeat] || null,
        status: it.status, doneBy: it.done_recorded_by || null, item: it,
        past: t + (Number(it.duration_min) || 0) * 60_000 < now,
      });
    }
  }
  const upcoming = rows.filter((r) => !r.past).sort((a, z) => Date.parse(a.at) - Date.parse(z.at));
  const past = rows.filter((r) => r.past).sort((a, z) => Date.parse(z.at) - Date.parse(a.at));
  return { upcoming, past };
}

/** The status words of a row. A done item says who recorded it. */
export function statusLine(row) {
  if (row.status === 'done') return row.doneBy === 'learning' ? 'Done · recorded by Learning' : 'Done';
  if (row.status === 'skipped') return 'Skipped';
  if (row.status === 'missed') return 'Missed';
  return row.past ? 'Not marked done' : 'Planned';
}

/**
 * Each goal on the plan, with its target date and whether its item is done.
 * There is no percent: a goal is one item, and an item not yet done reads
 * "In progress", never "0%".
 */
export function goalRows(items) {
  const seen = new Set();
  const out = [];
  for (const it of Array.isArray(items) ? items : []) {
    if (!it?.goal?.text || seen.has(it.uid)) continue;
    seen.add(it.uid);
    out.push({
      uid: it.uid, text: it.goal.text, target: it.goal.target_date || null,
      title: it.title, done: it.status === 'done', state: it.status === 'done' ? 'Done' : 'In progress',
    });
  }
  return out.sort((a, z) => String(a.target || '9999').localeCompare(String(z.target || '9999')));
}

/**
 * What a Learning entry on the Calendar offers. A plan item (`learning.plan`)
 * is marked done, rescheduled, opened or removed; a webinar the member is only
 * registered for opens on its page. A done item is not marked again, and a
 * webinar keeps its own time.
 */
export function calendarActions(ev) {
  if (ev?.kind !== 'learning') return [];
  const open = ev.url && String(ev.url).startsWith('/learning') ? { key: 'open', label: 'Open in Learning', to: ev.url } : null;
  if (!ev.learning?.plan || !ev.source_uid) return open ? [open] : [];
  const out = [];
  if (ev.status !== 'done') out.push({ key: 'done', label: 'Mark done' });
  if (ev.learning.item_kind !== 'webinar') out.push({ key: 'reschedule', label: 'Reschedule' });
  if (open) out.push(open);
  out.push({ key: 'remove', label: 'Remove' });
  return out;
}

/** The picker's kinds on the Calendar's New › Plan learning, in order. */
export const PICKER_KINDS = ['course', 'video', 'webinar', 'exercise', 'exam', 'study_block'];
