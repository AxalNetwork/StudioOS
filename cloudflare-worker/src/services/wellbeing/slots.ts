/**
 * D574 — the half-hours a member is offered, from the expert's weekly grid.
 *
 * `expert_availability` holds the grid the expert draws on their practice
 * page: rows of (day_of_week 0–6, start_minute, end_minute, timezone), each a
 * window of local wall time. Until D574 the slots route ignored it and offered
 * weekday half-hours 09:00–17:00 UTC whatever the grid said, so the practice
 * page had to tell the expert "Members are not offered these hours yet".
 *
 * A window is read in ITS OWN timezone: Monday 09:00–12:00 in Europe/Paris
 * is 07:00–10:00 UTC in summer and 08:00–11:00 in winter, and a slot is
 * always the UTC instant of that wall time on that date. A wall time that
 * does not exist (the hour a clock skips forward) is not offered.
 *
 * An expert with no grid keeps the old default hours, and the route says
 * which it used (`source: 'grid' | 'default_hours'`), so a screen never
 * presents the default as the expert's own hours.
 */

export type AvailabilityWindow = {
  day_of_week: number; start_minute: number; end_minute: number; timezone: string | null;
};

export const SLOT_MINUTES = 30;
export const SLOT_DAYS = 14;
/** How many slots the route lists. Booking checks the full set, uncapped. */
export const SLOT_LIST_CAP = 96;

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat | null {
  if (dtfCache.has(tz)) return dtfCache.get(tz)!;
  try {
    const f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short',
    });
    dtfCache.set(tz, f);
    return f;
  } catch {
    return null;
  }
}

/** The wall-clock parts of an instant in a timezone. */
function wallParts(instant: Date, tz: string) {
  const f = formatter(tz);
  if (!f) return null;
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(instant)) p[part.type] = part.value;
  return {
    y: Number(p.year), m: Number(p.month), d: Number(p.day),
    minute: Number(p.hour) * 60 + Number(p.minute),
    dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday),
  };
}

/**
 * The UTC instant of a local wall time, or null when that wall time does not
 * exist in the zone (a spring-forward gap) or the zone is unknown.
 */
export function zonedToUtc(y: number, m: number, d: number, minute: number, tz: string): Date | null {
  const guess = Date.UTC(y, m - 1, d, 0, minute);
  // Two passes settle the offset across a DST edge.
  let t = guess;
  for (let i = 0; i < 2; i++) {
    const w = wallParts(new Date(t), tz);
    if (!w) return null;
    const asUtc = Date.UTC(w.y, w.m - 1, w.d, 0, w.minute);
    t = t + (guess - asUtc);
  }
  const w = wallParts(new Date(t), tz);
  if (!w || w.y !== y || w.m !== m || w.d !== d || w.minute !== minute) return null;
  return new Date(t);
}

function validWindow(w: AvailabilityWindow): boolean {
  return Number.isInteger(w.day_of_week) && w.day_of_week >= 0 && w.day_of_week <= 6
    && Number.isInteger(w.start_minute) && Number.isInteger(w.end_minute)
    && w.start_minute >= 0 && w.end_minute <= 1440 && w.end_minute - w.start_minute >= SLOT_MINUTES;
}

/**
 * Every slot the grid offers from tomorrow (in each window's own zone) for
 * SLOT_DAYS days, as ISO strings, sorted and de-duplicated. `cap` limits the
 * list; pass Infinity to check a booking against the whole set.
 */
export function gridSlots(windows: AvailabilityWindow[], now = new Date(), cap = SLOT_LIST_CAP): string[] {
  const out = new Set<string>();
  for (const w of windows.filter(validWindow)) {
    const tz = String(w.timezone || 'UTC');
    const today = wallParts(now, tz);
    if (!today) continue;
    for (let i = 1; i <= SLOT_DAYS; i++) {
      // The local calendar date i days after today in that zone.
      const date = new Date(Date.UTC(today.y, today.m - 1, today.d + i));
      if (date.getUTCDay() !== w.day_of_week) continue;
      for (let min = w.start_minute; min + SLOT_MINUTES <= w.end_minute; min += SLOT_MINUTES) {
        const at = zonedToUtc(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), min, tz);
        if (at && at.getTime() > now.getTime()) out.add(at.toISOString());
      }
    }
  }
  return [...out].sort().slice(0, cap === Infinity ? undefined : cap);
}

/** The pre-D574 default: weekday half-hours 09:00–17:00 UTC, from tomorrow. */
export function defaultSlots(now = new Date(), cap = SLOT_LIST_CAP): string[] {
  const slots: string[] = [];
  for (let d = 1; d <= SLOT_DAYS; d++) {
    const day = new Date(now.getTime() + d * 86_400_000);
    const dow = day.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    for (let min = 9 * 60; min + SLOT_MINUTES <= 17 * 60; min += SLOT_MINUTES) {
      slots.push(new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 0, min)).toISOString());
    }
  }
  return cap === Infinity ? slots : slots.slice(0, cap);
}

/** The slots offered, and where they came from. */
export function offeredSlots(windows: AvailabilityWindow[], now = new Date(), cap = SLOT_LIST_CAP) {
  const grid = windows.some(validWindow);
  return grid
    ? { source: 'grid' as const, slots: gridSlots(windows, now, cap) }
    : { source: 'default_hours' as const, slots: defaultSlots(now, cap) };
}
