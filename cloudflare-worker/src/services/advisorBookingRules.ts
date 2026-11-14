/**
 * D4695 (#4695) — the rules a booking must pass, in one place and as pure
 * functions. `POST /api/advisors/slots/:id/book` (the only door: a booking-link
 * booking and a direct slot booking both come through it) calls these before it
 * reserves, and the reservation's own INSERT repeats the parts that can change
 * between the check and the write (the slot still open, capacity, the weekly
 * cap). Nothing here reads the database.
 *
 * WHAT AN ADVISOR SETS (`advisor_availability_rules`, migration 240):
 *   min_notice_hours  a booking must start at least this far ahead (null = no rule)
 *   buffer_minutes    a booking may not sit closer than this to another booked slot (null = no rule)
 *   weekly_paid_cap   most paid sessions in one week; 0 means accept none (null = no cap)
 *   blackouts         [{ day: 'fri', from: '12:00', to: '18:00' }] in the advisor's own timezone
 *   timezone          IANA name; a missing or unknown one reads as UTC, and says so (`tz_assumed`)
 *
 * NULL IS "NOT SET", NEVER ZERO. A cap of 0 is a rule; no cap is not.
 */

export type Blackout = { day: string; from: string; to: string };
export type AvailabilityRules = {
  weekly_paid_cap: number | null;
  buffer_minutes: number | null;
  min_notice_hours: number | null;
  blackouts: Blackout[];
  timezone: string | null;
};
export type RuleCode = 'slot_blocked' | 'min_notice' | 'blackout' | 'buffer' | 'weekly_cap';
export type RuleRefusal = { status: 409; code: RuleCode; detail: string };

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const MS_MIN = 60_000;
const MS_HOUR = 3_600_000;

/** The rules as a row stores them. A malformed `blackouts_json` reads as none, never as a throw on the booking path. */
export function rulesFromRow(row: {
  weekly_paid_cap?: number | null; buffer_minutes?: number | null; min_notice_hours?: number | null;
  blackouts_json?: string | null; timezone?: string | null;
} | null | undefined): AvailabilityRules {
  const count = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);
  let blackouts: Blackout[] = [];
  try {
    const parsed = row?.blackouts_json ? JSON.parse(row.blackouts_json) : [];
    if (Array.isArray(parsed)) {
      blackouts = parsed.filter((w): w is Blackout => !!w && typeof w.day === 'string' && DAYS.includes(w.day as any)
        && /^\d{2}:\d{2}$/.test(String(w.from)) && /^\d{2}:\d{2}$/.test(String(w.to)));
    }
  } catch { blackouts = []; }
  return {
    weekly_paid_cap: count(row?.weekly_paid_cap), buffer_minutes: count(row?.buffer_minutes),
    min_notice_hours: count(row?.min_notice_hours), blackouts, timezone: row?.timezone ?? null,
  };
}

/** A slot an advisor withdrew. An empty reason is not a block (the same reading `sessionsBlock.ts` uses). */
export const isBlocked = (slot: { blocked_reason?: string | null }): boolean =>
  slot.blocked_reason != null && slot.blocked_reason.trim() !== '';

/** True when `tz` names a zone the runtime knows. */
export function knownZone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

type Wall = { y: number; m: number; d: number; h: number; min: number; weekday: number };

/** The wall-clock reading of an instant in a zone. `weekday` is 0 = Monday. UTC when the zone is unknown. */
export function wallClock(ms: number, tz: string | null | undefined): Wall {
  const zone = knownZone(tz) ? tz : 'UTC';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', weekday: 'short',
  }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(get('weekday'));
  return { y: Number(get('year')), m: Number(get('month')), d: Number(get('day')), h: Number(get('hour')), min: Number(get('minute')), weekday };
}

/** The instant a zone's wall clock reads `y-m-d h:min`. Handles a clock change by re-reading the offset once. */
export function wallToInstant(y: number, m: number, d: number, h: number, min: number, tz: string | null | undefined): number {
  const asUtc = Date.UTC(y, m - 1, d, h, min);
  const offsetAt = (t: number) => {
    const w = wallClock(t, tz);
    return Date.UTC(w.y, w.m - 1, w.d, w.h, w.min) - t;
  };
  let t = asUtc - offsetAt(asUtc);
  const again = offsetAt(t);
  if (asUtc - again !== t) t = asUtc - again;
  return t;
}

/** Monday 00:00 to the next Monday 00:00 in the advisor's zone, as the instants that bound the week `ms` falls in. */
export function weekBounds(ms: number, tz: string | null | undefined): { from: number; until: number } {
  const w = wallClock(ms, tz);
  const monday = new Date(Date.UTC(w.y, w.m - 1, w.d - w.weekday));
  const next = new Date(Date.UTC(w.y, w.m - 1, w.d - w.weekday + 7));
  return {
    from: wallToInstant(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate(), 0, 0, tz),
    until: wallToInstant(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0, tz),
  };
}

const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** The first blackout window `[startMs, endMs)` overlaps, reading each window on the advisor's own calendar day. */
export function blackoutHit(rules: AvailabilityRules, startMs: number, endMs: number): Blackout | null {
  if (!rules.blackouts.length) return null;
  const first = wallClock(startMs, rules.timezone);
  const last = wallClock(Math.max(startMs, endMs - 1), rules.timezone);
  let day = Date.UTC(first.y, first.m - 1, first.d);
  const lastDay = Date.UTC(last.y, last.m - 1, last.d);
  for (let guard = 0; day <= lastDay && guard < 8; guard++, day += 86_400_000) {
    const date = new Date(day);
    const weekday = (date.getUTCDay() + 6) % 7;
    for (const b of rules.blackouts) {
      if (DAYS[weekday] !== b.day) continue;
      const from = wallToInstant(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), Math.floor(minutesOf(b.from) / 60), minutesOf(b.from) % 60, rules.timezone);
      const to = wallToInstant(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), Math.floor(minutesOf(b.to) / 60), minutesOf(b.to) % 60, rules.timezone);
      if (startMs < to && endMs > from) return b;
    }
  }
  return null;
}

export type BookedSpan = { starts_at: string; ends_at: string };

/**
 * The checks that need no database round trip beyond what the caller already
 * read. `paidThisWeek` is the number of paid sessions already held in the
 * slot's week (null when the caller did not need it); `booked` is the
 * advisor's other slots that hold a booking, near this one.
 */
export function ruleRefusal(input: {
  slot: { starts_at: string; ends_at: string; blocked_reason?: string | null };
  rules: AvailabilityRules; now: number; paid: boolean; paidThisWeek: number | null; booked: BookedSpan[];
}): RuleRefusal | null {
  const { slot, rules, now } = input;
  if (isBlocked(slot)) return { status: 409, code: 'slot_blocked', detail: 'This slot is not available' };
  const start = Date.parse(slot.starts_at);
  const end = Date.parse(slot.ends_at);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return { status: 409, code: 'slot_blocked', detail: 'This slot is not available' };
  }
  if (rules.min_notice_hours != null && start - now < rules.min_notice_hours * MS_HOUR) {
    return { status: 409, code: 'min_notice', detail: `This advisor needs at least ${rules.min_notice_hours} hours' notice` };
  }
  if (blackoutHit(rules, start, end)) {
    return { status: 409, code: 'blackout', detail: 'This advisor is not taking bookings at this time' };
  }
  if (rules.buffer_minutes != null && rules.buffer_minutes > 0) {
    const buf = rules.buffer_minutes * MS_MIN;
    for (const o of input.booked) {
      const s = Date.parse(o.starts_at);
      const e = Date.parse(o.ends_at);
      if (Number.isFinite(s) && Number.isFinite(e) && start < e + buf && end + buf > s) {
        return { status: 409, code: 'buffer', detail: 'This slot is too close to another session this advisor has booked' };
      }
    }
  }
  if (input.paid && rules.weekly_paid_cap != null && (input.paidThisWeek ?? 0) >= rules.weekly_paid_cap) {
    return { status: 409, code: 'weekly_cap', detail: 'This advisor has no paid sessions left that week' };
  }
  return null;
}

/** A session type that charges: priced above zero, and neither included in the plan nor a free intro. */
export const isPaidType = (t: { price_cents: number | null; is_free_intro?: number | null; is_included?: number | null } | null | undefined): boolean =>
  !!t && Number(t.price_cents ?? 0) > 0 && !t.is_free_intro && !t.is_included;

/** A slot time as the canonical UTC instant, or null when it is not a date. */
export function canonicalInstant(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  const t = Date.parse(v.trim());
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
