/**
 * D1211 (#3177, part 6 of #2420) — the Calendar's item drawer and its dialogs,
 * from the canvas "Calendar" (CAL4, CAL5, CAL7, CAL8, CAL18, CAL19). Pure, so
 * `frontend/test/calendar_item_d1211.test.mjs` holds each rule and each word.
 *
 * WHAT A DIALOG SAYS IS WHAT THE WORKER DOES. A create, a move and a cancel
 * send no message from StudioOS: what changes for the people on it is their own
 * calendar copy, where they connected Google or Outlook (`services/calendar/
 * sync.ts`). So the dialogs say that, and never "everyone is told".
 */

/** The drawer's own address. `kind` is the Worker's kind, `id` the row's. */
export const itemPath = (kind, id) => `/calendar/item/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`;

/** `/calendar/item/:kind/:id` → `{ kind, id }`, or null for any other address. */
export function itemOf(pathname = '') {
  const m = /^\/calendar\/item\/([a-z_]+)\/(\d+)\/?$/.exec(String(pathname));
  return m ? { kind: m[1], id: m[2] } : null;
}

/** Each kind's eyebrow (CAL4, CAL5). */
export const KIND_WORDS = Object.freeze({
  ic_meeting: 'IC meeting',
  founder_checkin: 'Check-in',
  investor_meeting: 'Investor meeting',
  advisor_booking: 'Advisor session',
  partner_office_hour: 'Office hours',
  expert_booking: 'Expert session',
  event_ticket: 'Event · going',
  event_hosted: 'Event · hosting',
  calendly_event: 'From Calendly',
});

/** The lengths each dialog offers, in minutes: CAL7 and CAL19 for an IC meeting, CAL8 for a check-in. */
export const LENGTHS = Object.freeze({ ic_meeting: [30, 45, 60, 90], founder_checkin: [15, 30, 45, 60] });

/** An answer in CAL4's words; the Worker's value for each. */
export const ANSWERS = Object.freeze([['accepted', 'Going'], ['tentative', 'Maybe'], ['declined', 'Not going']]);
export const ANSWER_WORD = Object.freeze({ accepted: 'Going', tentative: 'Maybe', declined: 'Not going', invited: 'Not answered yet' });

/** CAL18, left. */
export const NOT_PARTY = 'Only the people invited and studio admins can open this meeting.';
export const NOT_PARTY_SUB = 'Nothing about the meeting is shown.';
/** CAL18, right: the Free-plan gate on creating an IC meeting (a 402 from the Worker). */
export const IC_PLAN = 'Creating IC meetings is part of Investor Professional.';
export const IC_PLAN_SUB = 'Everything else on Calendar works on your plan.';

/** What each change does, in the Worker's own terms. */
export const SAYS = Object.freeze({
  create: 'Each person with Google or Outlook connected gets a copy in their calendar. StudioOS sends no message.',
  move: 'Each person’s calendar copy, where they connected Google or Outlook, moves to the new time. StudioOS sends no message.',
  cancel: 'Each person’s calendar copy, where they connected Google or Outlook, is removed. StudioOS sends no message.',
  meet: 'The link is made on your Google account, and that event becomes your calendar copy.',
});

/** Why a kind offers no Reschedule or Cancel (CAL5's footnotes). */
export function noChangeLine(item) {
  if (!item) return null;
  if (item.status === 'cancelled') return 'No actions on a cancelled meeting.';
  if (item.kind === 'calendly_event') return 'StudioOS cannot change or cancel this booking.';
  if (item.kind === 'advisor_booking' || item.kind === 'partner_office_hour') return 'No cancel here. The booking page handles it.';
  return null;
}

const pad = (n) => String(n).padStart(2, '0');

/** "Lisbon time (UTC+0)" for an IANA zone; the zone's own name when Intl cannot say. */
export function zoneLabel(zone, at = new Date()) {
  if (!zone) return null;
  const city = String(zone).split('/').pop().replace(/_/g, ' ');
  let offset = '';
  try {
    const part = new Intl.DateTimeFormat('en-GB', { timeZone: zone, timeZoneName: 'shortOffset' }).formatToParts(at).find((p) => p.type === 'timeZoneName');
    offset = String(part?.value || '').replace(/^GMT/, 'UTC') || '';
    if (offset === 'UTC') offset = 'UTC+0';
  } catch { return zone; }
  return offset ? `${city} time (${offset})` : `${city} time`;
}

function partsIn(iso, zone) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: zone || undefined, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const o = Object.fromEntries(f.formatToParts(d).map((p) => [p.type, p.value]));
  return { day: `${o.weekday} ${o.day} ${o.month}`, time: `${pad(o.hour)}:${pad(o.minute)}` };
}

/** Minutes between two instants, or null when either is missing. */
export function minutesOf(item) {
  const a = Date.parse(item?.start_at), b = Date.parse(item?.end_at);
  return Number.isFinite(a) && Number.isFinite(b) && b > a ? Math.round((b - a) / 60_000) : null;
}

/**
 * CAL4's When: "Thu 12 Nov · 14:00–15:00 · 60 min · Lisbon time (UTC+0)."
 * In the reader's zone; where the row records another (an advisor's), its
 * time there follows. An end nobody recorded says so.
 */
export function whenLine(item, zone) {
  const s = partsIn(item?.start_at, zone);
  if (!s) return 'Not recorded';
  const e = partsIn(item?.end_at, zone);
  const mins = minutesOf(item);
  const head = e && mins != null ? `${s.day} · ${s.time}–${e.time} · ${mins} min` : `${s.day} · ${s.time} · its end is not recorded`;
  const here = zoneLabel(zone, new Date(item.start_at));
  const there = item?.time_zone && item.time_zone !== zone ? partsIn(item.start_at, item.time_zone) : null;
  return `${head}${here ? ` · ${here}` : ''}.${there ? ` ${there.time} ${zoneLabel(item.time_zone, new Date(item.start_at))}.` : ''}`;
}

/** The short form a dialog's sub uses: "Thu 12 Nov · 14:00–15:00". */
export function whenShort(item, zone) {
  const s = partsIn(item?.start_at, zone);
  const e = partsIn(item?.end_at, zone);
  if (!s) return 'Not recorded';
  return e ? `${s.day} · ${s.time}–${e.time}` : `${s.day} · ${s.time}`;
}

/** Join is open from 15 minutes before the start until the end (CAL4: "Join turns violet 15 minutes before the start"). */
export function joinOpen(item, now = Date.now()) {
  const a = Date.parse(item?.start_at), b = Date.parse(item?.end_at);
  if (!item?.location_uri || item?.status === 'cancelled' || !Number.isFinite(a)) return false;
  return now >= a - 15 * 60_000 && now < (Number.isFinite(b) ? b : a + 60 * 60_000);
}

/** "[4] of [5] going", from the answers the Worker gave. A kind that records none says nothing. */
export function goingLine(people) {
  const list = Array.isArray(people) ? people : [];
  if (!list.some((p) => p.answer)) return null;
  return `${list.filter((p) => p.answer === 'Going').length} of ${list.length} going`;
}

/** CAL4's Copies: one line per provider, from `pushed_to`. */
export function copyLines(item) {
  const on = new Set(Array.isArray(item?.pushed_to) ? item.pushed_to : []);
  return [['google', 'Google'], ['microsoft', 'Outlook']].map(([key, name]) => ({ key, name, copied: on.has(key) }));
}

/**
 * A `datetime-local` value as an instant, or null. The control holds the
 * reader's local time with no zone; `new Date` reads it as local.
 */
export function startOf(local) {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** CAL7's inline error: "Choose a time from now on." for a start that is not ahead. */
export function startError(local, now = Date.now()) {
  const d = startOf(local);
  if (!local) return null;
  if (!d) return 'That is not a date and time.';
  return d.getTime() <= now ? 'Choose a time from now on.' : null;
}

/** What a refused write says: our sentence from the Worker, and the plan gate in CAL18's words. */
export function refusalOf(e) {
  if (e?.status === 402) return { plan: true, text: IC_PLAN };
  const text = e?.data?.message || e?.data?.detail || e?.message || 'That did not work. Try again.';
  return { plan: false, text: String(text) };
}

/**
 * The New menu (CAL8 A), for a role. Items that leave the page carry ↗ and
 * say where they go. IC meeting only where the Worker allows it.
 */
export function newMenu(role) {
  const r = String(role || '').toLowerCase();
  const out = [];
  if (r === 'admin' || r === 'investor') out.push({ key: 'ic', label: 'IC meeting' });
  out.push({ key: 'checkin', label: 'Check-in' });
  if (r === 'founder' || r === 'admin') {
    out.push({ key: 'interview', label: 'Interview call ↗', sub: 'Opens Validate › Customer research', to: '/validate/customer-research' });
    out.push({ key: 'advisor', label: 'Book an advisor session ↗', sub: 'Opens Build › Team › Advisors', to: '/advisors' });
  }
  out.push({ key: 'event', label: 'Event ↗', sub: 'Opens New event', to: '/events/new' });
  return out;
}
