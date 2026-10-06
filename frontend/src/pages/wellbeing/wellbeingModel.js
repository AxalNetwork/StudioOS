/**
 * D570 — Wellbeing's pure half: every derivation the four screens make, kept
 * apart from React so `frontend/test/wellbeing_d570.test.mjs` can drive it
 * against fixtures and against the Worker's own validator.
 *
 * WHAT THE WORKER STORES. `POST /api/wellbeing/checkins` (routes/wellbeing.ts,
 * `submitCanonicalCheckin`) validates with `validateDailyBody` and writes
 * `wellbeing_daily_pulses`. Since D574 (migration 395) it takes eight optional
 * 1–5 scores — the canvas's stress, sleep, support, decisions and energy, and
 * mood, focus and social under "More" — plus `free_text` and `tags`, and
 * needs at least one score.
 *
 *   - ONE CHECK-IN PER WEEK is the route's rule (D574): a save in a week that
 *     already has a row replaces that row, on its own day, and is never
 *     refused. This page still sends the week's `day` when it has one, which
 *     the route would choose anyway.
 *   - The write overwrites every column, so a save sends back every value the
 *     form was prefilled with. Leaving one out would erase it.
 *   - A week saved before D574 has no support or decisions: those read as gaps
 *     for that week, never as zero.
 */
import { titleCase } from '../../lib/absence';

/* ------------------------------------------------------------------ *
 * Check-ins
 * ------------------------------------------------------------------ */

/** The six scores the check-in route stores, in its own order (`DAILY_KEYS`). */
export const ROUTE_SCORE_KEYS = ['mood', 'stress', 'sleep', 'energy', 'focus', 'social', 'support', 'decisions'];
/** The six scores `GET /aggregate` averages for the admin pulse. */
export const AGGREGATE_SCORE_KEYS = ['mood', 'stress', 'sleep', 'energy', 'focus', 'social'];

/** Why support and decisions are drawn and never asked. */
export const NOT_STORED_REASON = 'The check-in has no field for this score yet, so an answer could not be kept.';

/**
 * The canvas's five rows, in its order. `field` is the route's key, or null
 * where the route has none.
 */
export const CANVAS_SCORES = [
  { key: 'stress', label: 'Stress', field: 'stress', low: 'Calm', high: 'Overwhelmed' },
  { key: 'sleep', label: 'Sleep', field: 'sleep', low: 'Poor', high: 'Restful' },
  { key: 'support', label: 'Support', field: 'support', low: 'On my own', high: 'Well supported' },
  { key: 'decisions', label: 'Decisions', field: 'decisions', low: 'Stuck', high: 'Clear' },
  { key: 'energy', label: 'Energy', field: 'energy', low: 'Drained', high: 'Charged' },
];

/**
 * The three scores the route stores that the canvas does not draw. The page
 * asked for them before D570 and still does, under "More": an artboard that
 * leaves a working field out is not an instruction to stop collecting it.
 */
export const MORE_SCORES = [
  { key: 'mood', label: 'Mood', field: 'mood', low: 'Low', high: 'Great' },
  { key: 'focus', label: 'Focus', field: 'focus', low: 'Scattered', high: 'Sharp' },
  { key: 'social', label: 'Connection', field: 'social', low: 'Isolated', high: 'Supported' },
];

/**
 * Topics a member can attach to a check-in. The values are keys of the expert
 * catalogue (`data/expertCategories.ts`), so `/wellbeing/book` can pass the
 * most-used ones as `want_category` and the directory ranks matching experts
 * first. Carried over from the pre-D570 page.
 */
export const TOPICS = [
  { tag: 'therapist_clinical', label: 'Therapy' },
  { tag: 'executive_coach', label: 'Executive coaching' },
  { tag: 'peer_founder_advisor', label: 'Peer support' },
  { tag: 'sleep_specialist_physician', label: 'Sleep' },
  { tag: 'burnout_specialist', label: 'Burnout' },
  { tag: 'psychiatrist', label: 'Anxiety' },
  { tag: 'relationship_counsellor', label: 'Relationships' },
  { tag: 'leadership_coach', label: 'Co-founder conflict' },
  { tag: 'personal_trainer', label: 'Fitness' },
  { tag: 'nutritionist', label: 'Nutrition' },
  { tag: 'mindfulness_coach', label: 'Mindfulness' },
  { tag: 'fundraising_advisor', label: 'Fundraising' },
];
export const MAX_TAGS = 8;

/** `GET /checkins` answers 30 rows unless asked for more (`clampLimit(…, 30, 200)`). */
export const HISTORY_ROW_CAP = 30;

const DAY_MS = 86_400_000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isDay = (value) => typeof value === 'string' && DAY_RE.test(value);
const dayToMs = (day) => {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const msToDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Today as the route writes `day`: the UTC calendar date. */
export const utcToday = (now = Date.now()) => msToDay(now);

/** The Monday that starts `day`'s week. Days are UTC dates, as the route stores them. */
export function weekStart(day) {
  const ms = dayToMs(day);
  return msToDay(ms - ((new Date(ms).getUTCDay() + 6) % 7) * DAY_MS);
}
export const addDays = (day, n) => msToDay(dayToMs(day) + n * DAY_MS);

/**
 * This week's entry: the latest row whose day falls in the same Monday-started
 * week as `today` (the route's own `today`). Null when the week has none.
 */
export function thisWeekEntry(checkins, today) {
  if (!isDay(today)) return null;
  const week = weekStart(today);
  const hits = (checkins || []).filter((row) => isDay(row?.day) && weekStart(row.day) === week);
  if (!hits.length) return null;
  return hits.slice().sort((a, b) => {
    if (a.day !== b.day) return a.day < b.day ? 1 : -1;
    return String(b.created_at || '').localeCompare(String(a.created_at || ''));
  })[0];
}

const score = (value) => (Number.isInteger(value) && value >= 1 && value <= 5 ? value : null);

/** The form a stored entry fills, so a save sends every stored value back. */
export function formFromEntry(entry) {
  const values = {};
  for (const key of ROUTE_SCORE_KEYS) values[key] = score(entry?.[key]);
  return {
    values,
    note: typeof entry?.free_text === 'string' ? entry.free_text : '',
    tags: Array.isArray(entry?.tags) ? entry.tags.slice(0, MAX_TAGS) : [],
  };
}

/**
 * The body for `wellbeingSubmit`. Only answered scores are sent: an unanswered
 * one is absent, never a default 3. `day` is sent only to replace this week's
 * entry. No `support`, `decisions` or `notes` key is ever written, because the
 * route would drop them without a word.
 */
export function buildCheckinPayload({ values = {}, note = '', tags = [], entry = null } = {}) {
  const body = {};
  for (const key of ROUTE_SCORE_KEYS) {
    const value = score(values[key]);
    if (value != null) body[key] = value;
  }
  const text = typeof note === 'string' ? note : '';
  body.free_text = text.trim() ? text : null;
  body.tags = (Array.isArray(tags) ? tags : []).slice(0, MAX_TAGS);
  if (entry && isDay(entry.day)) body.day = entry.day;
  return body;
}

/** How many scores a body carries; the route refuses a body with none. */
export const answeredCount = (body) => ROUTE_SCORE_KEYS.filter((key) => score(body?.[key]) != null).length;

/**
 * The last `weeks` weeks, oldest first, each with the mean of every score
 * recorded that week (null where none was). A week the read did not reach is
 * marked `unread`: when the route returned a full page, rows older than the
 * oldest one returned may exist, and an empty week there is not evidence of
 * no check-in.
 */
export function pastWeeks(checkins, today, weeks = 8) {
  const rows = (checkins || []).filter((row) => isDay(row?.day));
  const current = weekStart(isDay(today) ? today : utcToday());
  const truncated = (checkins || []).length >= HISTORY_ROW_CAP;
  const oldest = rows.length ? rows.map((row) => row.day).sort()[0] : null;
  const readFrom = truncated && oldest ? weekStart(oldest) : null;
  return Array.from({ length: weeks }, (_, i) => {
    const week = addDays(current, -7 * (weeks - 1 - i));
    const inWeek = rows.filter((row) => weekStart(row.day) === week);
    const values = {};
    for (const key of ROUTE_SCORE_KEYS) {
      const recorded = inWeek.map((row) => score(row[key])).filter((value) => value != null);
      values[key] = recorded.length
        ? Math.round((recorded.reduce((sum, value) => sum + value, 0) / recorded.length) * 10) / 10
        : null;
    }
    return { week, entries: inWeek.length, unread: readFrom != null && week <= readFrom, values };
  });
}

/**
 * A sparkline on the canvas's 126 × 26 box, 1 at the bottom and 5 at the top.
 * A week with no value BREAKS the line: it is never drawn as a zero, and a
 * point with no neighbour is drawn as a dot rather than vanishing.
 */
export function sparkPath(series, { width = 126, height = 26, pad = 3 } = {}) {
  const n = series.length;
  const x = (i) => (n <= 1 ? width / 2 : (i * width) / (n - 1));
  const y = (v) => pad + ((5 - v) / 4) * (height - 2 * pad);
  const r = (v) => Math.round(v * 10) / 10;
  const parts = [];
  const dots = [];
  let open = false;
  series.forEach((value, i) => {
    if (value == null) { open = false; return; }
    const px = r(x(i));
    const py = r(y(value));
    if (series[i - 1] == null && series[i + 1] == null) dots.push({ x: px, y: py });
    parts.push(`${open ? 'L' : 'M'}${px} ${py}`);
    open = true;
  });
  return { d: parts.join(' '), dots };
}

/* ------------------------------------------------------------------ *
 * Dates, times and money
 * ------------------------------------------------------------------ */

/**
 * The canvas writes dates one way — "Mon 5 Oct", "10:00", "1 Sep 2026" — so
 * they are assembled from parts rather than left to a locale's own order and
 * abbreviations (en-GB writes "Sept"). A zone the runtime does not know falls
 * back to UTC rather than throwing inside a render.
 */
function partsOf(t, options) {
  let format;
  try { format = new Intl.DateTimeFormat('en-US', options); }
  catch { format = new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }); }
  return Object.fromEntries(format.formatToParts(t).map((p) => [p.type, p.value]));
}

/** "Mon 5 Oct" for a stored UTC day. */
export function formatDay(day) {
  if (!isDay(day)) return null;
  const p = partsOf(dayToMs(day), { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  return `${p.weekday} ${p.day} ${p.month}`;
}

/** "Tue 14 Oct" for an instant, in the viewer's zone unless one is given. */
export function formatSlotDay(iso, { timeZone } = {}) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return null;
  const p = partsOf(t, { weekday: 'short', day: 'numeric', month: 'short', timeZone });
  return `${p.weekday} ${p.day} ${p.month}`;
}

/** "10:00" for an instant. */
export function formatTime(iso, { timeZone } = {}) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return null;
  const p = partsOf(t, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone });
  return `${p.hour}:${p.minute}`;
}

/** "Tue 14 Oct · 10:00", or null when the instant is not recorded. */
export function formatWhen(iso, opts = {}) {
  const day = formatSlotDay(iso, opts);
  return day ? `${day} · ${formatTime(iso, opts)}` : null;
}

/** "1 Oct 2026" for a stored timestamp (`datetime('now')` or ISO). */
export function formatDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const t = Date.parse(/^\d{4}-\d{2}-\d{2} \d/.test(raw) ? `${raw.replace(' ', 'T')}Z` : raw);
  if (!Number.isFinite(t)) return null;
  const p = partsOf(t, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return `${p.day} ${p.month} ${p.year}`;
}

/** An amount in minor units, or null when there is none. */
export function money(cents, currency = 'usd') {
  if (cents == null || cents === '') return null;
  const n = Number(cents);
  if (!Number.isFinite(n)) return null;
  const code = String(currency || 'usd').toUpperCase();
  const whole = Number.isInteger(n / 100);
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: code, minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2,
    }).format(n / 100);
  } catch {
    return `${(n / 100).toFixed(2)} ${code}`;
  }
}

/** The viewer's zone, or UTC where the browser will not say. */
export function browserTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

/* ------------------------------------------------------------------ *
 * Bookings
 * ------------------------------------------------------------------ */

const TERMINAL = new Set(['cancelled', 'completed', 'no_show']);
const at = (row) => Date.parse(row?.scheduled_at || '');

/**
 * Upcoming and past, from the rows `GET /bookings/mine` or
 * `GET /experts/me/bookings` returns. A booking with no time (made through an
 * external scheduler) is upcoming until it is cancelled or closed.
 */
export function splitBookings(rows, now = Date.now()) {
  const upcoming = [];
  const past = [];
  for (const row of rows || []) {
    const t = at(row);
    const open = !TERMINAL.has(String(row?.status || ''));
    if (open && (!Number.isFinite(t) || t >= now)) upcoming.push(row);
    else past.push(row);
  }
  const key = (row) => (Number.isFinite(at(row)) ? at(row) : Infinity);
  upcoming.sort((a, b) => key(a) - key(b));
  past.sort((a, b) => (Number.isFinite(at(b)) ? at(b) : -Infinity) - (Number.isFinite(at(a)) ? at(a) : -Infinity));
  return { upcoming, past };
}

/** A booking's status as the route stores it, worded for a reader. */
export const BOOKING_STATUS = {
  requested: { label: 'Requested', tone: 'warn' },
  scheduled: { label: 'Scheduled', tone: 'info' },
  pending_payment: { label: 'Awaiting payment', tone: 'warn' },
  confirmed: { label: 'Confirmed', tone: 'ok' },
  completed: { label: 'Completed', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
  no_show: { label: 'No-show', tone: 'neutral' },
};
export const bookingStatus = (status) => BOOKING_STATUS[status]
  || { label: titleCase(status) || 'Status not recorded', tone: 'neutral' };

/**
 * A member can rate the expert of a session that has happened: timed, in the
 * past, and not cancelled or still waiting on payment or a reply.
 */
export function canRate(row, now = Date.now()) {
  const t = at(row);
  return Number.isFinite(t) && t < now && !!row?.expert_uid
    && ['scheduled', 'confirmed', 'completed'].includes(row?.status);
}

/**
 * D574 — what `POST /bookings/:uid/cancel` accepts: the member's own booking,
 * still open, not paid (a paid one is the expert's to cancel, with its
 * refund), and not yet started.
 */
export const MEMBER_CANCELLABLE = ['requested', 'scheduled', 'pending_payment', 'confirmed'];
export function canMemberCancel(row, now = Date.now()) {
  if (!MEMBER_CANCELLABLE.includes(row?.status) || row?.payment_status === 'paid') return false;
  const t = at(row);
  return !Number.isFinite(t) || t > now;
}

/** D574 — the stars this member gave the booking's expert, as stored, or null. */
export function storedStars(row) {
  const n = Number(row?.my_stars);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

/** The expert can confirm a request, cancel anything still open, and close a held session. */
export function expertActions(row, now = Date.now()) {
  const status = String(row?.status || '');
  const out = [];
  if (status === 'requested' || status === 'scheduled') out.push('confirmed');
  if (!TERMINAL.has(status)) out.push('cancelled');
  const t = at(row);
  if (status === 'confirmed' && Number.isFinite(t) && t < now) out.push('completed');
  return out;
}

/* ------------------------------------------------------------------ *
 * The expert directory and slots
 * ------------------------------------------------------------------ */

/** The slot length `GET /experts/:uid/slots` generates, and so what a booking asks for. */
export const SESSION_MINUTES = 30;

/**
 * What the booking route is sent. No note, ever: a booking carries none
 * (D331). D574: the chosen service's uid, when one was chosen; the route
 * takes the session's length from it.
 */
export function bookingPayload({ slot = null, external = false, serviceUid = null } = {}) {
  const service = serviceUid ? { service_uid: serviceUid } : {};
  return external ? service : { scheduled_at: slot, duration_minutes: SESSION_MINUTES, ...service };
}

/** D574 — a service's price as the member reads it, or "Free". */
export function servicePrice(s) {
  const cents = Number(s?.price_cents);
  if (!Number.isFinite(cents)) return null;
  if (cents === 0) return 'Free';
  const cur = String(s?.currency || 'usd').toUpperCase();
  return `${cur} ${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

/** D574 — the Confirm step's service line: the chosen service, or a plain session. */
export function chosenServiceLabel(expert, serviceUid) {
  const s = serviceUid && Array.isArray(expert?.services) ? expert.services.find((x) => x.uid === serviceUid) : null;
  return s ? `${s.title} · ${s.duration_minutes} min` : `A ${SESSION_MINUTES}-minute session`;
}

/**
 * The expert a profile page sent to `/wellbeing/book`. The profile passes the
 * card it already read as navigation state and names the expert in
 * `?expert=`; the state counts only when the two agree, so a stale history
 * entry cannot preselect someone the address does not name.
 */
export function arrivedExpert(state, wanted) {
  const e = state?.expert;
  return e && typeof e === 'object' && wanted && e.uid === wanted ? e : null;
}

/**
 * The directory with the arrived expert first. The directory lists twelve,
 * ranked for this member, so the expert someone came for is often not among
 * them. The profile's card is used rather than read again: reading it again
 * would spend one of a free founder's monthly profile views.
 */
export function withArrived(experts = [], arrived = null) {
  if (!arrived || experts.some((e) => e.uid === arrived.uid)) return experts;
  return [arrived, ...experts];
}

/** The directory rate on an expert's card, or null when none is published. */
export function expertRate(expert) {
  if (expert?.pricing_model === 'free') return 'Free';
  const n = Number(expert?.hourly_rate_usd);
  return Number.isFinite(n) && n > 0 ? `${money(n * 100, 'usd')} / hr` : null;
}

/** An expert's categories, named from the catalogue where it was read. */
export function specialties(expert, labels = new Map()) {
  return (Array.isArray(expert?.categories) ? expert.categories : [])
    .map((key) => labels.get(key) || titleCase(key))
    .filter(Boolean);
}

/** The slots grouped by the viewer's calendar day, in order. */
export function groupSlots(slots, { timeZone } = {}) {
  let keyFmt;
  try { keyFmt = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }); }
  catch { keyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }); }
  const groups = new Map();
  for (const iso of slots || []) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) continue;
    const key = keyFmt.format(t);
    if (!groups.has(key)) groups.set(key, { key, label: formatSlotDay(iso, { timeZone }), slots: [] });
    groups.get(key).slots.push({ iso, time: formatTime(iso, { timeZone }) });
  }
  return [...groups.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
}

/** The line under an expert's card about their next opening. */
export function nextOpening(state, { timeZone } = {}) {
  if (!state || state.status === 'loading') return { kind: 'loading', text: 'Reading openings…' };
  if (state.status === 'unreadable') return { kind: 'unreadable', text: 'Openings could not be read' };
  if (state.external) return { kind: 'external', text: 'Books through their own scheduler' };
  const first = (state.slots || []).map((iso) => Date.parse(iso)).filter(Number.isFinite).sort((a, b) => a - b)[0];
  if (first == null) return { kind: 'none', text: 'No open slot in the next few days' };
  return { kind: 'slot', text: `Next: ${formatWhen(new Date(first).toISOString(), { timeZone })}` };
}

/** The most-used topics across past check-ins: the directory's `want_category`. */
export function wantedCategories(checkins, limit = 5) {
  const counts = new Map();
  for (const row of checkins || []) {
    for (const tag of Array.isArray(row?.tags) ? row.tags : []) counts.set(tag, (counts.get(tag) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([tag]) => tag);
}

/* ------------------------------------------------------------------ *
 * The expert's practice
 * ------------------------------------------------------------------ */

/** The route's bounds for a service (`POST/PUT /experts/me/services`). */
export const SERVICE_MINUTES = { min: 5, max: 480 };

export function serviceDraft(service) {
  const cents = Number(service?.price_cents);
  return {
    title: service?.title || '',
    minutes: String(service?.duration_minutes ?? SESSION_MINUTES),
    price: Number.isFinite(cents) ? String(cents / 100) : '0',
    currency: String(service?.currency || 'usd').toLowerCase(),
    description: service?.description || '',
  };
}

/**
 * A service draft as the route takes it, or the field errors. The price is
 * typed in the currency's main unit and sent in cents; zero is a free session,
 * which is what the route means by zero.
 */
export function serviceBody(draft) {
  const fields = {};
  const title = String(draft?.title || '').trim();
  if (!title) fields.title = 'A service needs a name.';
  const minutes = Number(draft?.minutes);
  if (!Number.isInteger(minutes) || minutes < SERVICE_MINUTES.min || minutes > SERVICE_MINUTES.max) {
    fields.minutes = `Length is whole minutes, ${SERVICE_MINUTES.min} to ${SERVICE_MINUTES.max}.`;
  }
  const price = Number(String(draft?.price ?? '').trim() === '' ? NaN : draft.price);
  if (!Number.isFinite(price) || price < 0) fields.price = 'Rate is an amount of zero or more. Zero is a free session.';
  if (Object.keys(fields).length) return { ok: false, fields };
  return {
    ok: true,
    body: {
      title,
      duration_minutes: minutes,
      price_cents: Math.round(price * 100),
      currency: String(draft?.currency || 'usd').toLowerCase(),
      description: String(draft?.description || '').trim() || null,
    },
  };
}

export const serviceRate = (service) => (Number(service?.price_cents) > 0
  ? money(service.price_cents, service.currency)
  : 'Free');

/** 0 is Sunday, as the expert editor has always numbered days. */
export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const FULL_DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const fullDayName = (day) => FULL_DAY_NAMES[day] || null;
const hh = (minute) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
export const windowLabel = (w) => `${DAY_NAMES[w.day_of_week] || '?'} ${hh(w.start_minute)}–${hh(w.end_minute)}`;

/** The zone the grid is drawn in: the windows' own when they agree, else the viewer's. */
export function gridTimeZone(windows, fallback) {
  const zones = [...new Set((windows || []).map((w) => w?.timezone).filter(Boolean))];
  return zones.length === 1 ? zones[0] : fallback;
}

/** Where an instant lands on a weekly grid in `timeZone`. */
function weekPosition(t, timeZone) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(t);
  } catch {
    return null;
  }
  const weekday = parts.find((p) => p.type === 'weekday')?.value;
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  const day = DAY_NAMES.indexOf(weekday);
  return day < 0 || !Number.isInteger(hour) ? null : { day, hour };
}

/**
 * The canvas's weekly grid: Monday to Friday, 08 to 17, widened to hold any
 * window outside it. A cell is `booked` when a booking in the next seven days
 * falls in it, `open` when a window in the grid's zone covers any of the hour,
 * and `closed` otherwise. Windows in another zone are returned in `other` and
 * listed, not guessed onto the grid.
 */
export function availabilityGrid({ windows = [], bookings = [], timeZone = 'UTC', now = Date.now() } = {}) {
  const inZone = windows.filter((w) => (w?.timezone || 'UTC') === timeZone);
  const other = windows.filter((w) => (w?.timezone || 'UTC') !== timeZone);
  const daySet = new Set([1, 2, 3, 4, 5]);
  let first = 8;
  let last = 17;
  for (const w of inZone) {
    daySet.add(w.day_of_week);
    first = Math.min(first, Math.floor(w.start_minute / 60));
    last = Math.max(last, Math.ceil(w.end_minute / 60) - 1);
  }
  const days = [...daySet].filter((d) => d >= 0 && d <= 6).sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  const hours = Array.from({ length: Math.min(last, 23) - Math.max(first, 0) + 1 }, (_, i) => Math.max(first, 0) + i);
  const booked = new Set();
  for (const b of bookings) {
    const t = at(b);
    if (!Number.isFinite(t) || t < now || t >= now + 7 * DAY_MS || TERMINAL.has(String(b?.status || ''))) continue;
    const pos = weekPosition(t, timeZone);
    if (pos) booked.add(`${pos.day}:${pos.hour}`);
  }
  const cells = {};
  for (const day of days) {
    for (const hour of hours) {
      const key = `${day}:${hour}`;
      const open = inZone.some((w) => w.day_of_week === day && w.start_minute < (hour + 1) * 60 && w.end_minute > hour * 60);
      cells[key] = booked.has(key) ? 'booked' : open ? 'open' : 'closed';
    }
  }
  return { days, hours, cells, other, timeZone };
}

/**
 * What a click on one cell does, with the route's add and delete only:
 *   - a closed hour opens as a one-hour window;
 *   - an open hour that IS a one-hour window closes;
 *   - an open hour inside a longer window asks to remove that window, since
 *     closing one hour of it would take two writes that cannot be undone as one;
 *   - a booked hour, or a window holding one, cannot be closed (the canvas's rule).
 */
export function cellAction({ windows = [], cells = {}, day, hour, timeZone = 'UTC' }) {
  const state = cells[`${day}:${hour}`];
  if (state === 'booked') return { kind: 'blocked', reason: 'A member has booked this hour, so it stays open.' };
  const start = hour * 60;
  const end = start + 60;
  const covering = windows.filter((w) => (w?.timezone || 'UTC') === timeZone
    && w.day_of_week === day && w.start_minute < end && w.end_minute > start);
  if (!covering.length) {
    return { kind: 'open', body: { day_of_week: day, start_minute: start, end_minute: end, timezone: timeZone } };
  }
  if (covering.length === 1 && covering[0].start_minute === start && covering[0].end_minute === end) {
    return { kind: 'close', uid: covering[0].uid };
  }
  const holdsBooking = covering.some((w) => Object.entries(cells).some(([key, value]) => {
    if (value !== 'booked') return false;
    const [d, h] = key.split(':').map(Number);
    return d === w.day_of_week && w.start_minute < (h + 1) * 60 && w.end_minute > h * 60;
  }));
  if (holdsBooking) return { kind: 'blocked', reason: 'This hour sits in a window that holds a booking, so the window stays.' };
  return { kind: 'remove', windows: covering };
}

/**
 * The profile form's option lists: the route's own (`VALID_MODALITIES`,
 * `VALID_PRICING_MODELS` in `data/expertCategories.ts`). The pre-D570 form
 * offered `chat` and `insurance`, which `sanitiseExpertInput` drops without a
 * word, so "Profile saved." could follow a choice that was never stored.
 */
export const EXPERT_MODALITIES = [['video', 'Video'], ['phone', 'Phone'], ['in_person', 'In person'], ['async_chat', 'Async chat']];
export const EXPERT_PRICING_MODELS = [
  ['free', 'Free'], ['paid', 'Paid'], ['sliding_scale', 'Sliding scale'], ['first_free_then_paid', 'First session free, then paid'],
];

const csv = (value) => (Array.isArray(value) ? value.join(', ') : '');
const list = (value) => String(value || '').split(',').map((x) => x.trim()).filter(Boolean);

/** The profile form, filled from `GET /experts/me`. */
export function profileDraft(me) {
  return {
    name: me?.name || '',
    headline: me?.headline || '',
    bio: me?.bio || '',
    photo_url: me?.photo_url || '',
    website_url: me?.website_url || '',
    calendly_url: me?.calendly_url || '',
    booking_url: me?.booking_url || '',
    categories: csv(me?.categories),
    sectors: csv(me?.sectors),
    languages: csv(me?.languages),
    timezones: csv(me?.timezones),
    modalities: Array.isArray(me?.modalities) ? me.modalities : ['video'],
    pricing_model: me?.pricing_model || 'paid',
    hourly_rate_usd: Number(me?.hourly_rate_usd) > 0 ? String(me.hourly_rate_usd) : '',
    first_session_free: !!me?.first_session_free,
  };
}

/**
 * The body for `PUT /experts/me`. An empty hourly rate is LEFT OUT: the route
 * turns `null` into 0 (`Number(null)` is finite), so sending it would publish
 * a rate of zero rather than none.
 */
export function profileBody(draft) {
  const fields = {};
  const rate = String(draft?.hourly_rate_usd ?? '').trim();
  const body = {
    name: String(draft?.name || ''),
    headline: String(draft?.headline || ''),
    bio: String(draft?.bio || ''),
    photo_url: String(draft?.photo_url || ''),
    website_url: String(draft?.website_url || ''),
    calendly_url: String(draft?.calendly_url || ''),
    booking_url: String(draft?.booking_url || ''),
    categories: list(draft?.categories),
    sectors: list(draft?.sectors),
    languages: list(draft?.languages),
    timezones: list(draft?.timezones),
    modalities: (draft?.modalities || []).filter((m) => EXPERT_MODALITIES.some(([key]) => key === m)),
    pricing_model: EXPERT_PRICING_MODELS.some(([key]) => key === draft?.pricing_model) ? draft.pricing_model : 'paid',
    first_session_free: !!draft?.first_session_free,
  };
  if (rate !== '') {
    const n = Number(rate);
    if (!Number.isFinite(n) || n < 0) fields.hourly_rate_usd = 'The hourly rate is a number of dollars.';
    else body.hourly_rate_usd = n;
  }
  return Object.keys(fields).length ? { ok: false, fields } : { ok: true, body };
}

/* ------------------------------------------------------------------ *
 * The resource library
 * ------------------------------------------------------------------ */

/** The route's closed set (`ALLOWED_RESOURCE_CATEGORIES`), in the order members see them. */
export const RESOURCE_CATEGORIES = ['hotline', 'therapy', 'peer_group', 'coaching', 'reading'];
export const RESOURCE_CATEGORY_LABELS = {
  hotline: 'Crisis line',
  therapy: 'Therapy',
  peer_group: 'Peer group',
  coaching: 'Coaching',
  reading: 'Reading',
};
export const resourceKind = (category) => RESOURCE_CATEGORY_LABELS[category] || titleCase(category) || 'Kind not recorded';

/** A link a member may open: http(s) only, so a stored `javascript:` is never a href. */
export function safeHref(url) {
  const value = String(url || '').trim();
  return /^https?:\/\/\S+$/i.test(value) ? value : null;
}

/** The small facts the library stores about a resource. */
export function resourceFacts(resource) {
  return [
    resource?.is_24_7 ? '24/7' : null,
    resource?.is_free ? 'Free' : null,
    resource?.region ? String(resource.region).toUpperCase() : null,
  ].filter(Boolean);
}

export const EMPTY_RESOURCE = {
  name: '', category: '', url: '', description: '', region: '', is_24_7: false, is_free: false, sort_order: '100',
  kind: '', topic: '', id: null, file: null,
};

/** D574 — the canvas's formats (`RESOURCE_KINDS` on the route), and a topic's length. */
export const RESOURCE_FORMATS = ['article', 'audio', 'video', 'link'];
export const RESOURCE_FORMAT_LABELS = { article: 'Article', audio: 'Audio', video: 'Video', link: 'Link' };
export const RESOURCE_TOPIC_MAX = 60;
export const resourceFormat = (kind) => RESOURCE_FORMAT_LABELS[kind] || null;

/** D574 part 4 — the types and size `PUT /resources/:id/file` takes (`RESOURCE_FILE_TYPES`). */
export const RESOURCE_FILE_TYPES = {
  'application/pdf': 'PDF', 'audio/mpeg': 'MP3', 'audio/mp4': 'M4A', 'video/mp4': 'MP4', 'video/webm': 'WebM',
};
export const RESOURCE_FILE_MAX_MB = 95;

/** The route's gated path for a resource's file, and only that: never another origin. */
const FILE_PATH = /^\/api\/wellbeing\/resources\/[^/?#]+\/file$/;
export function resourceHref(r) {
  const link = safeHref(r?.url);
  if (link) return link;
  const path = String(r?.file?.url ?? '');
  return FILE_PATH.test(path) ? path : null;
}

/** "PDF · 1.2 MB", or null without a file. */
export function fileLabel(file) {
  if (!file) return null;
  const type = RESOURCE_FILE_TYPES[file.type] || 'File';
  const bytes = Number(file.size);
  if (!Number.isFinite(bytes) || bytes <= 0) return type;
  const size = bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${type} · ${size}`;
}

/** Why a chosen file cannot be uploaded, or null when it can. */
export function fileProblem(file) {
  if (!file) return 'Choose a file.';
  if (!RESOURCE_FILE_TYPES[file.type]) return 'A library file is a PDF, an MP3 or M4A, or an MP4 or WebM video.';
  if (file.size > RESOURCE_FILE_MAX_MB * 1024 * 1024) return `A library file is at most ${RESOURCE_FILE_MAX_MB} MB.`;
  return null;
}

/** D574 — a stored row as the editor holds it, to edit in place. */
export function draftOf(row) {
  return {
    id: row?.id ?? null,
    name: String(row?.name ?? ''), category: String(row?.category ?? ''), url: String(row?.url ?? ''),
    description: String(row?.description ?? ''), region: String(row?.region ?? ''),
    is_24_7: !!row?.is_24_7, is_free: !!row?.is_free, sort_order: String(row?.sort_order ?? '100'),
    kind: String(row?.kind ?? ''), topic: String(row?.topic ?? ''),
    file: row?.file ?? null,
  };
}

/**
 * A resource draft as `POST /resources` or `PATCH /resources/:id` takes it,
 * or the field errors. `status` is the button pressed: save as a draft, or
 * publish.
 */
export function resourceBody(draft, status = 'published') {
  const fields = {};
  const name = String(draft?.name || '').trim();
  if (!name) fields.name = 'A resource needs a title.';
  if (!RESOURCE_CATEGORIES.includes(draft?.category)) fields.category = 'Choose a category.';
  const kind = String(draft?.kind || '');
  if (kind && !RESOURCE_FORMATS.includes(kind)) fields.kind = 'Choose a format.';
  const topic = String(draft?.topic || '').trim();
  if (topic.length > RESOURCE_TOPIC_MAX) fields.topic = `A topic is at most ${RESOURCE_TOPIC_MAX} characters.`;
  const url = String(draft?.url || '').trim();
  if (url && !safeHref(url)) fields.url = 'A link starts with https:// or http://.';
  const rawOrder = String(draft?.sort_order ?? '').trim();
  const order = rawOrder === '' ? 100 : Number(rawOrder);
  if (!Number.isInteger(order)) fields.sort_order = 'Order is a whole number.';
  if (Object.keys(fields).length) return { ok: false, fields };
  return {
    ok: true,
    body: {
      category: draft.category,
      name,
      description: String(draft?.description || '').trim() || null,
      url: url || null,
      region: String(draft?.region || '').trim().toLowerCase() || null,
      is_24_7: !!draft?.is_24_7,
      is_free: !!draft?.is_free,
      sort_order: order,
      kind: kind || null,
      topic: topic || null,
      status: status === 'draft' ? 'draft' : 'published',
    },
  };
}

export const LIBRARY_SORTS = {
  order: 'Members’ order',
  added: 'Newest added',
  title: 'Title',
};

/** Search, kind filter and sort over the rows the route returned. */
export function filterResources(rows, { q = '', category = '', sort = 'order' } = {}) {
  const needle = String(q || '').trim().toLowerCase();
  const out = (rows || []).filter((row) => (!category || row?.category === category)
    && (!needle || `${row?.name || ''} ${row?.description || ''}`.toLowerCase().includes(needle)));
  const added = (row) => String(row?.created_at || '');
  if (sort === 'added') out.sort((a, b) => added(b).localeCompare(added(a)));
  else if (sort === 'title') out.sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')));
  else out.sort((a, b) => (Number(a?.sort_order) || 0) - (Number(b?.sort_order) || 0));
  return out;
}

/** One page of rows and its "1–25 of N" count. */
export function pageOf(rows, page = 1, size = 25) {
  const total = (rows || []).length;
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, page), pages);
  const from = total ? (current - 1) * size + 1 : 0;
  const to = Math.min(total, current * size);
  return { rows: (rows || []).slice(from ? from - 1 : 0, to), from, to, total, pages, page: current };
}
export const countLabel = ({ from, to, total }) => (total ? `${from}–${to} of ${total}` : '0 of 0');

/* ------------------------------------------------------------------ *
 * The admin pulse
 * ------------------------------------------------------------------ */

/** The step `GET /aggregate` rounds its counts down to (`COUNT_BUCKET` in routes/wellbeing.ts). */
export const COUNT_STEP = 5;

/**
 * A count `/aggregate` rounded down to a multiple of five, as the range it
 * stands for: 0 is "Fewer than 5", 10 is "10–14". The route rounds so that a
 * count cannot single anyone out, so printed bare it claimed a precision it
 * does not have: a cohort of three founders read "0". A count off the step is
 * floored onto it, so the range still holds the true count. Null when there
 * is no count.
 */
export function countRange(n, step = COUNT_STEP) {
  if (n === null || n === undefined || n === '') return null;
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return null;
  if (v < step) return `Fewer than ${step}`;
  const low = Math.floor(v / step) * step;
  const fmt = (x) => x.toLocaleString('en-GB');
  return `${fmt(low)}–${fmt(low + step - 1)}`;
}

/* ------------------------------------------------------------------ *
 * What the rails may read back
 * ------------------------------------------------------------------ */

/**
 * The rail's coverage lines are sent to the model when a reader asks for a
 * read-back (`POST /api/ai/workspace/explain`), and that route's contract is
 * that they carry no personal data. So each builder takes only the counts it
 * needs: a check-in, a note or a booking cannot reach one, because none is a
 * parameter.
 */
export function homeCoverage(resources) {
  if (!Array.isArray(resources)) return [];
  const lines = [`${resources.length} resource${resources.length === 1 ? '' : 's'} in the library`];
  const open = resources.filter((r) => r?.category === 'hotline' && r?.is_24_7).length;
  if (open) lines.push(`${open} crisis line${open === 1 ? '' : 's'} open 24/7`);
  return lines;
}

export function practiceCoverage({ services, windows, upcoming }) {
  const lines = [];
  if (Array.isArray(services)) {
    const active = services.filter((s) => s?.is_active !== 0 && s?.is_active !== false).length;
    lines.push(`${services.length} service${services.length === 1 ? '' : 's'}, ${active} active`);
  }
  if (Array.isArray(windows)) lines.push(`${windows.length} weekly window${windows.length === 1 ? '' : 's'} open`);
  if (Number.isInteger(upcoming)) lines.push(`${upcoming} upcoming booking${upcoming === 1 ? '' : 's'}`);
  return lines;
}

export function libraryCoverage(resources) {
  if (!Array.isArray(resources)) return [];
  // D574 — an admin's read carries drafts; they are counted apart, never as published.
  const published = resources.filter((r) => r?.status !== 'draft');
  const drafts = resources.length - published.length;
  const lines = [`${published.length} resource${published.length === 1 ? '' : 's'} published`];
  if (drafts) lines.push(`${drafts} draft${drafts === 1 ? '' : 's'} not yet published`);
  for (const category of RESOURCE_CATEGORIES) {
    const n = published.filter((r) => r?.category === category).length;
    if (n) lines.push(`${resourceKind(category)}: ${n}`);
  }
  return lines;
}
