/**
 * D1596 (#3869) — `sessions:block`: Block proposals for Advisor › Practice ›
 * Sessions, from the advisor's own Axal records. Arithmetic, not a generation:
 * no model is called, nothing is held or charged.
 *
 * WHAT IT READS, all the caller's own, for one window (`days`, 1–60, default 14):
 *   - their open slots: not cancelled, not blocked, and no booking that holds
 *     the slot (`takenForSlot`'s statuses: pending, confirmed, completed);
 *   - the booked slots, only to keep a free afternoon free of bookings;
 *   - four calendar readers (`services/calendar`): events they host, events
 *     they hold a place at, their interview calls, their cohort dates.
 * A reader that fails is named in `dropped` and never counts as an empty
 * calendar. An all-day item (a cohort deadline) never clashes.
 *
 * WHAT IT PROPOSES, at most `MAX_PROPOSALS`, each `{ kind, from, until, open_slots, source }`:
 *   - `clash`: a run of contiguous open slots that overlaps a timed item;
 *   - `free_afternoon`: up to three afternoons (12:00–18:00 in the advisor's
 *     own time zone) holding open slots and no booking, so they can be kept
 *     free. With no valid time zone recorded, none is proposed and `dropped`
 *     says `no_time_zone`.
 * Never a `reason`: a block's reason is the advisor's own words.
 *
 * WHAT IT WRITES: nothing. `routes/rail_run.ts` files the proposals as
 * `ai_rail_proposals` rows; the slot table is written only by the page's own
 * Block (`POST /api/advisors/me/slots/block`), after Accept.
 */
import type { Env } from '../types';
import { cohortDateEvents, interviewCallEvents } from './calendar/sourceReaders';
import { hostedEvents, ticketEvents } from './calendar/myEvents';

export const MAX_PROPOSALS = 10;
export const MAX_FREE_AFTERNOONS = 3;
export const DEFAULT_DAYS = 14;
export const MAX_DAYS = 60;
const AFTERNOON = { from: 12, until: 18 };

export type BlockKind = 'clash' | 'free_afternoon';
export interface BlockProposal { kind: BlockKind; from: string; until: string; open_slots: number; source: string }
export type BlockDropped = { why: 'source_unreadable'; source: CalendarSource } | { why: 'no_time_zone' };

export type CalendarSource = 'hosted_events' | 'event_tickets' | 'interview_calls' | 'cohort_dates';
interface Item { source: CalendarSource; start: number; end: number; allDay: boolean }
interface Slot { id: number; start: number; end: number }

/** What a clash's card says it clashes with, by the item's own kind. */
export const CLASH_WORDS: Readonly<Record<CalendarSource, string>> = Object.freeze({
  hosted_events: 'Clashes with an event you host',
  event_tickets: 'Clashes with an event you hold a place at',
  interview_calls: 'Clashes with an interview call',
  cohort_dates: 'Clashes with a cohort session',
});
export const FREE_AFTERNOON_WORDS = 'A free afternoon in your calendar: open hours and no bookings';

/** The window's days: an integer from 1 to 60, else the default. */
export function windowDays(raw: unknown): number {
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 1 && n <= MAX_DAYS ? n : DEFAULT_DAYS;
}

const ms = (v: unknown) => {
  const s = String(v ?? '');
  // A stored `YYYY-MM-DD HH:MM:SS` is UTC, as CURRENT_TIMESTAMP writes it.
  const t = Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s) ? `${s.replace(' ', 'T')}Z` : s);
  return Number.isFinite(t) ? t : NaN;
};
const iso = (t: number) => new Date(t).toISOString();

/** A recorded IANA time zone the runtime knows, or null. */
export function validZone(tz: unknown): string | null {
  if (typeof tz !== 'string' || !tz.trim()) return null;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz.trim() }); return tz.trim(); } catch { return null; }
}

/** The wall clock of an instant in a zone: its local day and hour. */
function local(t: number, tz: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(t));
  const p = (k: string) => Number(parts.find((x) => x.type === k)?.value);
  return { day: `${parts.find((x) => x.type === 'year')?.value}-${parts.find((x) => x.type === 'month')?.value}-${parts.find((x) => x.type === 'day')?.value}`, y: p('year'), m: p('month'), d: p('day'), h: p('hour'), min: p('minute') };
}

/** The UTC instant of a local wall-clock hour on a local day (two passes, so a DST day lands right). */
function zonedInstant(y: number, m: number, d: number, hour: number, tz: string): number {
  let guess = Date.UTC(y, m - 1, d, hour);
  for (let i = 0; i < 2; i++) {
    const l = local(guess, tz);
    const asUtc = Date.UTC(l.y, l.m - 1, l.d, l.h, l.min);
    guess += Date.UTC(y, m - 1, d, hour) - asUtc;
  }
  return guess;
}

/** Whether a slot overlaps an item; a zero-length item is an instant inside the slot. */
const overlaps = (s: Slot, it: Item) => (it.end > it.start ? it.start < s.end && it.end > s.start : it.start >= s.start && it.start < s.end);

/** Runs of contiguous open slots, each slot starting where the last ended. */
function runsOf(slots: readonly Slot[]): Slot[][] {
  const out: Slot[][] = [];
  for (const s of [...slots].sort((a, b) => a.start - b.start || a.id - b.id)) {
    const last = out[out.length - 1];
    if (last && last[last.length - 1].end === s.start) last.push(s); else out.push([s]);
  }
  return out;
}

/** The four readers, each kept apart: one that fails is named, never read as an empty calendar. */
async function calendarItems(env: Env, userId: number, from: string, until: string): Promise<{ items: Item[]; dropped: BlockDropped[] }> {
  const items: Item[] = [];
  const dropped: BlockDropped[] = [];
  const readers: Array<[CalendarSource, () => Promise<Array<{ start_at: string; end_at: string; all_day?: boolean }>>]> = [
    ['hosted_events', () => hostedEvents(env, userId, from, until)],
    ['event_tickets', () => ticketEvents(env, userId, from, until)],
    ['interview_calls', () => interviewCallEvents(env, userId, from, until)],
    ['cohort_dates', () => cohortDateEvents(env, userId, from, until)],
  ];
  for (const [source, read] of readers) {
    try {
      for (const e of await read()) {
        const start = ms(e.start_at);
        const end = ms(e.end_at || e.start_at);
        if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error('calendar_source_unreadable');
        items.push({ source, start, end, allDay: e.all_day === true });
      }
    } catch {
      dropped.push({ why: 'source_unreadable', source });
    }
  }
  return { items, dropped };
}

/**
 * The proposals for one advisor's window. `advisorId` is the caller's own
 * profile, resolved by the route from the session; `userId` is the caller.
 */
export async function sessionBlockProposals(
  env: Env, input: { advisorId: number; userId: number; timezone: unknown; days: number; now?: number },
): Promise<{ proposals: BlockProposal[]; dropped: BlockDropped[] }> {
  const now = input.now ?? Date.now();
  const from = iso(now);
  const until = iso(now + input.days * 86_400_000);
  const open = ((await env.DB.prepare(
    `SELECT s.id, s.starts_at, s.ends_at FROM advisor_office_hour_slots s
      WHERE s.advisor_id = ? AND s.starts_at >= ? AND s.starts_at < ? AND s.is_cancelled = 0
        AND (s.blocked_reason IS NULL OR TRIM(s.blocked_reason) = '')
        AND NOT EXISTS (SELECT 1 FROM advisor_bookings b WHERE b.slot_id = s.id AND b.status IN ('pending','confirmed','completed'))
      ORDER BY s.starts_at ASC, s.id ASC LIMIT 500`,
  ).bind(input.advisorId, from, until).all<{ id: number; starts_at: string; ends_at: string }>()).results ?? [])
    .map((r) => ({ id: Number(r.id), start: ms(r.starts_at), end: ms(r.ends_at) }))
    .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start);
  const booked = ((await env.DB.prepare(
    `SELECT s.starts_at, s.ends_at FROM advisor_office_hour_slots s
      WHERE s.advisor_id = ? AND s.starts_at >= ? AND s.starts_at < ? AND s.is_cancelled = 0
        AND EXISTS (SELECT 1 FROM advisor_bookings b WHERE b.slot_id = s.id AND b.status IN ('pending','confirmed','completed'))
      LIMIT 500`,
  ).bind(input.advisorId, from, until).all<{ starts_at: string; ends_at: string }>()).results ?? [])
    .map((r) => ({ start: ms(r.starts_at), end: ms(r.ends_at) }));

  const { items, dropped } = await calendarItems(env, input.userId, from, until);
  const timed = items.filter((i) => !i.allDay);
  const proposals: BlockProposal[] = [];

  for (const run of runsOf(open)) {
    const hit = timed.find((it) => run.some((s) => overlaps(s, it)));
    if (!hit) continue;
    proposals.push({ kind: 'clash', from: iso(run[0].start), until: iso(run[run.length - 1].end), open_slots: run.length, source: CLASH_WORDS[hit.source] });
  }

  const tz = validZone(input.timezone);
  if (!tz) {
    dropped.push({ why: 'no_time_zone' });
  } else {
    const days = new Map<string, Slot[]>();
    for (const s of open) {
      const a = local(s.start, tz);
      const b = local(s.end - 1, tz);
      if (a.day !== b.day || a.h < AFTERNOON.from || b.h >= AFTERNOON.until) continue;
      days.set(a.day, [...(days.get(a.day) ?? []), s]);
    }
    let kept = 0;
    for (const [day, slots] of [...days].sort((x, y) => x[0].localeCompare(y[0]))) {
      if (kept >= MAX_FREE_AFTERNOONS) break;
      const [y, m, d] = day.split('-').map(Number);
      const start = zonedInstant(y, m, d, AFTERNOON.from, tz);
      const end = zonedInstant(y, m, d, AFTERNOON.until, tz);
      // Free means free: no booking that afternoon, and nothing timed in the calendar.
      if (booked.some((b) => b.start < end && b.end > start) || timed.some((it) => overlaps({ id: 0, start, end }, it))) continue;
      proposals.push({ kind: 'free_afternoon', from: iso(start), until: iso(end), open_slots: slots.length, source: FREE_AFTERNOON_WORDS });
      kept++;
    }
  }
  return { proposals: proposals.slice(0, MAX_PROPOSALS), dropped };
}
