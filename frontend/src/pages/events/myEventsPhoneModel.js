/**
 * D1037 (#2878, part 7 of #2387) — My events on a phone (MEV18a–c), pure so
 * the tests read it without a browser. The phone draws the same reads as the
 * desktop page; nothing here makes one.
 *
 *   - MEV18a: the month as a one-week strip, Monday first, the week that
 *     holds today unless moved, each day with its going and hosting counts;
 *   - MEV18b: the ticket full screen, with the brightness line under the code;
 *   - MEV18c: on the event's day, Hosting's Check in opens the camera sheet,
 *     which says how many of the seats taken are checked in.
 *
 * A count nobody read is never 0: it says so.
 */
import { NOT_RECORDED } from '../../lib/absence.js';
import { eventTime } from './eventTime';
import { dayKey } from './myEventsTabsModel';

/** Below 1024px the page's root carries this class, and `myEventsPhone.css` makes each control a 44 × 44px target. */
export const PHONE_ROOT = 'my-events-phone';
/** MEV18b: under the code, on a phone only. */
export const BRIGHTNESS = 'Turn your screen brightness up at the door.';
/** MEV18c: under the camera. */
export const POINT = 'Point the camera at a ticket’s code.';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (x) => String(x).padStart(2, '0');
const keyOf = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * MEV18a: seven days, Monday first, of the week that holds today in the
 * viewer's zone, moved by `offset` weeks. Each day carries the calendar
 * items that start on it (`calendarItems`), counted as going and hosting,
 * and its words for a screen reader. `title` names the week.
 */
export function weekStrip(items = [], now = Date.now(), zone, offset = 0) {
  const today = dayKey(now, zone);
  const [y, m, d] = String(today).split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  const lead = (base.getUTCDay() + 6) % 7;
  const byDay = new Map();
  for (const it of items || []) {
    const k = dayKey(eventTime(it?.event?.starts_at), zone);
    if (!k) continue;
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(it);
  }
  const days = [];
  for (let i = 0; i < 7; i++) {
    const at = new Date(Date.UTC(y, m - 1, d - lead + offset * 7 + i));
    const key = keyOf(at);
    const on = byDay.get(key) || [];
    const going = on.filter((x) => x.kind === 'going').length;
    const hosting = on.filter((x) => x.kind === 'hosting').length;
    const count = going + hosting;
    const parts = [going ? `going to ${going}` : '', hosting ? `hosting ${hosting}` : ''].filter(Boolean);
    days.push({
      key, day: at.getUTCDate(), weekday: WEEKDAYS[i], month: MONTHS[at.getUTCMonth()], today: key === today, going, hosting,
      label: `${WEEKDAYS[i]} ${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]}${key === today ? ', today' : ''}: ${count ? `${count} event${count > 1 ? 's' : ''}: ${parts.join(', ')}` : 'no events'}`,
    });
  }
  const first = days[0];
  const last = days[6];
  const title = first.month === last.month ? `${first.day}–${last.day} ${last.month}` : `${first.day} ${first.month} – ${last.day} ${last.month}`;
  return { days, title, thisWeek: offset === 0 };
}

/**
 * MEV18c: "[event] · [31] of [42] checked in", from the hosted row's counts
 * (`checked_in` of `seats_taken`) and the check-ins made in this sheet. A
 * count the list did not carry says so, never 0.
 */
export function checkInLine(event, added = 0) {
  const title = String(event?.title || '').trim() || NOT_RECORDED;
  const came = num(event?.counts?.checked_in);
  const had = num(event?.counts?.seats_taken);
  if (came == null || had == null) return `${title} · Checked in: not read here yet`;
  return `${title} · ${came + added} of ${had} checked in`;
}

/** One scan's answer, in the manage page's words (D1036): who was let in, or that they already were. */
export function checkInResult(reply) {
  const who = String(reply?.registration?.name || '').trim();
  return `${reply?.already_checked_in ? 'Already checked in' : 'Checked in'}${who ? `: ${who}` : '.'}`;
}
