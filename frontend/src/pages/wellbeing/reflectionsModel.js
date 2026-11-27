/**
 * D7118 part 2 (#7118, canvas `Wellness Member Home`, boards WLM-02, WLM-03, WLM-08 to WLM-10): the three
 * independent reflection periods as pure rules. Today, This week and This month each have their own record
 * (`/api/wellbeing/reflections`, `wellbeingReflectionsApi`), their own date and their own state. Nothing is
 * counted against the member, nothing rates anyone's health, and a period with no entry is left out, never a 0.
 */

export const CADENCES = ['day', 'week', 'month'];
/** `/wellbeing?period=today|week|month` opens one period directly (WLM00). */
export const PERIOD_PARAM = Object.freeze({ today: 'day', week: 'week', month: 'month' });
export const PARAM_OF = Object.freeze({ day: 'today', week: 'week', month: 'month' });
export const periodHref = (cadence) => `/wellbeing?period=${PARAM_OF[cadence] || 'today'}`;
export const cadenceOfParam = (v) => (Object.prototype.hasOwnProperty.call(PERIOD_PARAM, String(v || '')) ? PERIOD_PARAM[String(v)] : null);

export const TAB_WORDS = Object.freeze({ day: 'Today', week: 'This week', month: 'This month' });

const q = (key, label, low, high) => Object.freeze({ key, label, low, high });
/** The questions each period asks, in the canvas's order. Every one is optional. The keys are the Worker's. */
export const QUESTIONS = Object.freeze({
  day: Object.freeze([q('energy', 'Energy', 'Drained', 'Charged'), q('stress', 'Stress', 'Calm', 'Overwhelmed'), q('sleep', 'Sleep', 'Poor', 'Restful')]),
  week: Object.freeze([
    q('stress', 'Stress', 'Calm', 'Overwhelmed'), q('sleep', 'Sleep', 'Poor', 'Restful'), q('support', 'Support', 'On my own', 'Well supported'),
    q('decisions', 'Decisions', 'Stuck', 'Clear'), q('energy', 'Energy', 'Drained', 'Charged'),
  ]),
  month: Object.freeze([]),
});

/** The weekly topics the canvas draws. A topic stays in the journal; #7119's consent decides any other use. */
export const WEEK_TOPICS = Object.freeze(['Sleep', 'Fundraising', 'Burnout', 'Co-founder conflict', 'Nutrition', 'Mindfulness']);
export const TOPICS_MAX = 8;
export const TEXT_MAX = 4000;

/** The month's two prompts are stored as one text, each under its own heading line, and read back the same way. */
export const MONTH_PROMPTS = Object.freeze([
  Object.freeze({ key: 'supported', label: 'What supported you this month?', hint: 'A person, a habit, a place…' }),
  Object.freeze({ key: 'carry', label: 'What would you like to carry into next month?', hint: 'Something to keep, or to put down…' }),
]);
const HEAD = (p) => `${p.label}\n`;

export function monthText(parts) {
  const blocks = MONTH_PROMPTS.map((p) => [p, String(parts?.[p.key] || '').trim()]).filter(([, v]) => v);
  return blocks.length ? blocks.map(([p, v]) => `${HEAD(p)}${v}`).join('\n\n') : '';
}
export function monthParts(text) {
  const out = Object.fromEntries(MONTH_PROMPTS.map((p) => [p.key, '']));
  const s = String(text || '');
  if (!s) return out;
  const marks = MONTH_PROMPTS.map((p) => ({ p, at: s.indexOf(HEAD(p)) })).filter((m) => m.at >= 0).sort((a, b) => a.at - b.at);
  // Text written another way keeps every word, under the first prompt.
  if (!marks.length) return { ...out, [MONTH_PROMPTS[0].key]: s.trim() };
  marks.forEach((m, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].at : s.length;
    out[m.p.key] = s.slice(m.at + HEAD(m.p).length, end).trim();
  });
  return out;
}

// ── Dates, in the member's own calendar (the Worker's period dates are YYYY-MM-DD) ─────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const parts = (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || '')); return m ? { y: +m[1], m: +m[2], d: +m[3] } : null; };
const weekday = (p) => DAYS[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()];

/** 2026-11-17 → "Tue 17 Nov 2026"; null for anything else. */
export function dayLabel(d, { year = true } = {}) {
  const p = parts(d);
  return p ? `${weekday(p)} ${p.d} ${MONTHS[p.m - 1]}${year ? ` ${p.y}` : ''}` : null;
}
/** A Monday-to-Sunday week: "16–22 Nov 2026", or "30 Nov – 6 Dec 2026" across a month end. */
export function weekLabel(start, end) {
  const a = parts(start); const b = parts(end);
  if (!a || !b) return null;
  if (a.y === b.y && a.m === b.m) return `${a.d}–${b.d} ${MONTHS[b.m - 1]} ${b.y}`;
  return `${a.d} ${MONTHS[a.m - 1]}${a.y === b.y ? '' : ` ${a.y}`} – ${b.d} ${MONTHS[b.m - 1]} ${b.y}`;
}
/** 2026-11-01 → "November 2026". */
export function monthLabel(start) { const p = parts(start); return p ? `${MONTHS_LONG[p.m - 1]} ${p.y}` : null; }
export const monthName = (start) => { const p = parts(start); return p ? MONTHS_LONG[p.m - 1] : null; };

/** A period's date line, by cadence. */
export function periodLabel(cadence, start, end) {
  return cadence === 'day' ? dayLabel(start) : cadence === 'week' ? weekLabel(start, end) : monthLabel(start);
}
/** A history row's first column: "Mon 16 Nov", "Week of 16 Nov", "October 2026". */
export function historyLabel(cadence, start) {
  const p = parts(start);
  if (!p) return null;
  if (cadence === 'day') return dayLabel(start, { year: false });
  if (cadence === 'week') return `Week of ${p.d} ${MONTHS[p.m - 1]}`;
  return monthLabel(start);
}

/** An instant as the member's own clock: "08:12", "Mon 16 Nov, 21:40". Null when unreadable. */
export function savedAt(iso, timeZone, { withDay = false } = {}) {
  const t = Date.parse(String(iso || '').replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(iso || '')) ? '' : 'Z'));
  if (!Number.isFinite(t)) return null;
  const opts = { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timeZone || 'UTC' };
  try {
    const time = new Intl.DateTimeFormat('en-GB', opts).format(t);
    if (!withDay) return time;
    const d = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: timeZone || 'UTC' }).format(t).replace(',', '');
    return `${d}, ${time}`;
  } catch { return null; }
}

/** The device's IANA zone, or UTC. */
export function deviceTimezone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

// ── State and lines ─────────────────────────────────────────────────────────────────────────────────────────

const NOT_YET = Object.freeze({ day: 'Not yet today', week: 'Not yet this week', month: 'Not yet this month' });
/**
 * A period's state chip from `GET /today`'s slot: ✓ Saved (with when, in the member's zone) or ○ Not yet. A
 * reflection that cannot be decrypted is "Couldn't be read", never "Not yet".
 */
export function periodState(cadence, slot, timeZone) {
  const r = slot?.reflection;
  if (!r) return { kind: 'notyet', word: NOT_YET[cadence] };
  if (r.readable === false) return { kind: 'unreadable', word: 'Couldn’t be read' };
  const at = savedAt(r.updated_at || r.created_at, timeZone, { withDay: cadence !== 'day' });
  return { kind: 'saved', word: at ? `Saved ${cadence === 'day' ? at : at.split(',')[0]}` : 'Saved' };
}

/** A history row's second column: the scores asked, in order ("Energy 3 · Stress 3 · Sleep 4"), or when it was saved. */
export function historyLine(cadence, r, timeZone) {
  if (r?.readable === false) return 'This reflection couldn’t be read. It is unchanged.';
  if (cadence === 'day') {
    const s = r?.scores || {};
    const asked = QUESTIONS.day.filter((x) => s[x.key] != null).map((x) => `${x.label} ${s[x.key]}`);
    return asked.length ? asked.join(' · ') : 'No scores';
  }
  const at = savedAt(r?.updated_at || r?.created_at, timeZone, { withDay: true });
  return at ? `Saved ${at}` : 'Saved';
}
/** A history row's third column: the day's line, quoted and cut at 60 characters, or "No note". */
export function historyNote(cadence, r) {
  if (cadence !== 'day' || r?.readable === false) return null;
  const t = String(r?.text || '').trim();
  if (!t) return 'No note';
  return `“${t.length > 60 ? `${t.slice(0, 59)}…` : t}”`;
}

// ── The editor ──────────────────────────────────────────────────────────────────────────────────────────────

/** The editor's draft from a reflection (or a blank one). */
export function draftFrom(cadence, r) {
  const scores = {};
  for (const x of QUESTIONS[cadence] || []) if (r?.scores?.[x.key] != null) scores[x.key] = r.scores[x.key];
  if (cadence === 'month') return { scores: {}, text: '', topics: [], month: monthParts(r?.text) };
  return { scores, text: String(r?.text || ''), topics: cadence === 'week' ? [...(r?.topics || [])] : [], month: null };
}

export const toggleTopic = (topics, t) => (topics.includes(t) ? topics.filter((x) => x !== t)
  : topics.length >= TOPICS_MAX ? topics : [...topics, t]);

/** Whether the draft has anything to save (the Worker refuses an empty reflection). */
export function draftEmpty(cadence, d) {
  if (cadence === 'month') return !monthText(d?.month);
  return !Object.keys(d?.scores || {}).length && !String(d?.text || '').trim() && !(d?.topics || []).length;
}

/**
 * The PUT body. `base_revision` is the reflection's revision (0 to create), so a stale copy is refused (409
 * reflection_changed), and `request_id` makes a retry of the same save land once.
 */
export function saveBody(cadence, draft, reflection, timezone, requestId) {
  const text = cadence === 'month' ? monthText(draft.month) : String(draft.text || '').trim();
  const body = { timezone, base_revision: reflection ? Number(reflection.revision) || 0 : 0 };
  if (cadence !== 'month' && Object.keys(draft.scores || {}).length) body.scores = { ...draft.scores };
  body.text = text || null;
  if (cadence === 'week') body.topics = [...(draft.topics || [])];
  if (requestId) body.request_id = requestId;
  return body;
}

/** A fresh id for one save attempt, reused for its retries. */
export function newRequestId() {
  const r = (globalThis.crypto && globalThis.crypto.randomUUID) ? globalThis.crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `rf-${r}`.slice(0, 64);
}

const codeOf = (e) => e?.data?.error || e?.data?.code || e?.code || null;
/** What a failed save says. The draft is always kept on screen. */
export function saveRefusal(e) {
  switch (codeOf(e)) {
    case 'reflection_protection_unavailable':
      return 'Your words were not saved because they can’t be stored encrypted right now. They are still here; try again in a moment.';
    case 'reflection_not_saved':
      return 'This reflection wasn’t saved. What you wrote is still here; try again.';
    case 'reflection_changed':
      return 'This reflection was changed somewhere else since you opened it. Your words are still here; reload it to see the newer version before saving.';
    case 'reflection_empty':
      return 'Answer a question or write a line before saving.';
    case 'text_too_long':
      return `A reflection is at most ${TEXT_MAX.toLocaleString('en-US')} characters.`;
    default:
      return 'This reflection wasn’t saved. What you wrote is still here; try again.';
  }
}
export const isChanged = (e) => codeOf(e) === 'reflection_changed';

/** What a saved reflection says, in words: only to you, encrypted. */
export const PRIVATE_LINE = 'Only you can read this. Stored encrypted. Eadwyn never reads your check-ins, and nothing you write is sent to a model.';
export const RETENTION_LINE = 'Kept until you delete it. You can export every reflection as a file, or delete one at any time.';
export const SAVES_ONLY = Object.freeze({
  day: 'Saves today’s entry only. This week’s reflection is not touched.',
  week: 'Saving replaces this week’s reflection. Your daily entries stay as they are.',
  month: (m) => `Saves ${m || 'this month'}’s reflection only.`,
});
export const LEFT_OUT = Object.freeze({
  day: 'Days without a reflection are simply left out: nothing is filled in and nothing is counted against you.',
  week: 'Only weeks you saved are listed.',
  month: 'Your monthly reflections, newest first.',
});

/** The month summary's two counts, in words: only what was written, never a rate. */
export function summaryLines(s) {
  if (!s) return null;
  const weeks = (s.weeks || []).map((w) => { const p = parts(w.period_start); return p ? `${p.d} ${MONTHS[p.m - 1]}` : null; }).filter(Boolean);
  return {
    days: { n: Number(s.days_recorded) || 0, note: 'days you chose to write' },
    weeks: { n: weeks.length, note: weeks.length ? `weeks of ${weeks.length > 1 ? `${weeks.slice(0, -1).join(', ')} and ${weeks.at(-1)}` : weeks[0]}` : 'no weekly reflection touches this month' },
  };
}

// ── WLM-03W: "Your last four weeks, in words" (D7118 part 3) ─────────────────────────────────────────────────

/** The four week starts ending with this week's, oldest first, by calendar arithmetic on the Worker's own dates. */
export function lastFourWeeks(currentStart) {
  const p = parts(currentStart);
  if (!p) return [];
  return [21, 14, 7, 0].map((back) => new Date(Date.UTC(p.y, p.m - 1, p.d - back)).toISOString().slice(0, 10));
}

export const NO_ENTRY = '— no entry';
export const UNREAD = 'couldn’t be read';
export const FOUR_WEEKS_FOOT = 'A week or a question you left blank reads “no entry”, never 0. Your own numbers, not a score.';

/**
 * The table: one column per week, one row per weekly question answered in at least one of the four weeks, in the
 * canvas's order. A week with no reflection, or a question left blank, reads "— no entry", never 0; a reflection that
 * could not be read says so rather than looking blank. Null when nothing was answered in the four weeks.
 */
export function fourWeekTable(currentStart, reflections) {
  const starts = lastFourWeeks(currentStart);
  if (!starts.length) return null;
  const byStart = new Map((reflections || []).filter((r) => r?.cadence === 'week')
    .map((r) => [r.period_start, r]));
  const weeks = starts.map((s) => byStart.get(s) || null);
  const cell = (r, key) => {
    if (!r) return { text: NO_ENTRY, empty: true };
    if (r.readable === false) return { text: UNREAD, empty: true };
    const v = r.scores?.[key];
    return v == null ? { text: NO_ENTRY, empty: true } : { text: String(v), empty: false };
  };
  const rows = QUESTIONS.week
    .filter((x) => weeks.some((r) => r && r.readable !== false && r.scores?.[x.key] != null))
    .map((x) => ({ key: x.key, label: x.label, cells: weeks.map((r) => cell(r, x.key)) }));
  if (!rows.length) return null;
  const columns = starts.map((s) => { const q = parts(s); return { start: s, label: `${q.d} ${MONTHS[q.m - 1]}` }; });
  return { columns, rows };
}
