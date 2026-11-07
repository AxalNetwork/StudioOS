/**
 * D4692 (#4692) — ONE ANSWER TO "CAN THIS SLOT BE BOOKED", for the list a
 * founder browses and for the booking write.
 *
 * Before this, `GET /advisors/:uid/slots` listed every uncancelled slot and
 * `POST /advisors/slots/:id/book` checked a different, shorter set (cancelled,
 * past, full): a slot the advisor had blocked still showed and still booked,
 * and the saved availability rules (paid cap, notice, buffer, blackouts) were
 * stored and shown on the page but read by nothing that sold an hour.
 *
 * `slotRefusal` is the only place the rules live. The list calls it per slot;
 * the booking handler calls it before writing (for a sentence that names the
 * rule) and the INSERT then re-asserts the rules that a second request can
 * change between that read and the write — capacity, cancellation, block,
 * notice, buffer, the weekly paid cap, advisor standing — inside the one
 * statement, so the loser of a race is refused rather than overbooked.
 *
 * THE RULES, in the order they are applied (the first that fails is the answer):
 *   1. advisor      — active, and not paused by an admin (D976)
 *   2. cancelled    — the slot was cancelled
 *   3. blocked      — the advisor blocked it (the reason is private and never sent)
 *   4. past         — it has started
 *   5. full         — pending + confirmed + completed bookings reach its capacity
 *   6. notice       — it starts sooner than `min_notice_hours` from now (NULL = no rule)
 *   7. blackout     — it overlaps a recurring window, read in the advisor's zone
 *   8. buffer       — another booked slot of this advisor is within `buffer_minutes` of it
 *   9. weekly cap   — a PAID session type, and the advisor's paid bookings that
 *                     week (Monday to Monday in their zone) have reached
 *                     `weekly_paid_cap`. A cap of 0 refuses every paid session;
 *                     NULL is no cap; free, included and intro types are never counted.
 *
 * A booking with no session type is not paid, so rule 9 does not apply to it.
 */
import type { Env } from '../types';

export const ACTIVE_BOOKING_STATUSES = ['pending', 'confirmed', 'completed'] as const;

export type SlotFacts = {
  id: number; advisor_id: number; starts_at: string; ends_at: string; capacity: number;
  is_cancelled: number; blocked_reason?: string | null;
};
export type AvailabilityRules = {
  weekly_paid_cap: number | null; buffer_minutes: number | null;
  min_notice_hours: number | null; blackouts: Array<{ day: string; from: string; to: string }>;
  timezone: string | null;
};
export type TypeFacts = {
  price_cents: number | null; is_free_intro: number | null; is_included?: number | null;
} | null;

export type RefusalCode =
  | 'advisor_inactive' | 'advisor_paused' | 'slot_cancelled' | 'slot_blocked' | 'slot_past'
  | 'slot_full' | 'inside_notice' | 'blackout' | 'buffer' | 'weekly_cap';

/** The sentence and status for each rule. A blocked slot reads as a cancelled one: the advisor's reason stays private. */
export const REFUSALS: Readonly<Record<RefusalCode, { status: 400 | 404 | 409; message: string }>> = Object.freeze({
  advisor_inactive: { status: 404, message: 'Slot not available' },
  advisor_paused: { status: 409, message: 'This advisor is not taking new bookings' },
  slot_cancelled: { status: 404, message: 'Slot not available' },
  slot_blocked: { status: 404, message: 'Slot not available' },
  slot_past: { status: 400, message: 'Slot is in the past' },
  slot_full: { status: 409, message: 'Slot full' },
  inside_notice: { status: 409, message: 'This advisor needs more notice than that. Pick a later slot.' },
  blackout: { status: 409, message: 'The advisor is not available at that time. Pick another slot.' },
  buffer: { status: 409, message: 'That slot is too close to another session the advisor has booked. Pick another slot.' },
  weekly_cap: { status: 409, message: 'The advisor is not taking more paid sessions that week. Pick another week.' },
});

type BookedSlot = { slot_id: number; start: number; end: number; paid: boolean };
export type Bookability = {
  advisorState: 'ok' | 'inactive' | 'paused' | 'missing';
  rules: AvailabilityRules;
  zone: string;
  booked: BookedSlot[];
};

/** A type is PAID when it carries a price and is neither included in a retainer nor a free intro. */
export function isPaidType(t: TypeFacts): boolean {
  return !!t && Number(t.price_cents ?? 0) > 0 && !t.is_included && !t.is_free_intro;
}

const ms = (v: unknown): number => {
  const s = String(v ?? '');
  const t = Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s) ? `${s.replace(' ', 'T')}Z` : s);
  return Number.isFinite(t) ? t : NaN;
};

function validZone(tz: unknown): string | null {
  if (typeof tz !== 'string' || !tz.trim()) return null;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz.trim() }); return tz.trim(); } catch { return null; }
}

function localParts(t: number, tz: string) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const parts = f.formatToParts(new Date(t));
  const p = (k: string) => Number(parts.find((x) => x.type === k)?.value);
  return { y: p('year'), m: p('month'), d: p('day'), h: p('hour'), min: p('minute') };
}

/** The UTC instant of a local wall-clock time (two passes, so a DST day lands right). */
function zonedMs(y: number, m: number, d: number, hh: number, mm: number, tz: string): number {
  const want = Date.UTC(y, m - 1, d, hh, mm);
  let guess = want;
  for (let i = 0; i < 2; i++) {
    const l = localParts(guess, tz);
    guess += want - Date.UTC(l.y, l.m - 1, l.d, l.h, l.min);
  }
  return guess;
}

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** [start, end) of the Monday-to-Monday week, in the zone, that holds an instant. */
export function weekBounds(t: number, tz: string): { start: number; end: number } {
  const l = localParts(t, tz);
  const dow = new Date(Date.UTC(l.y, l.m - 1, l.d)).getUTCDay();
  const monday = new Date(Date.UTC(l.y, l.m - 1, l.d - ((dow + 6) % 7)));
  const next = new Date(monday.getTime() + 7 * 86_400_000);
  return {
    start: zonedMs(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate(), 0, 0, tz),
    end: zonedMs(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0, tz),
  };
}

function inBlackout(start: number, end: number, rules: AvailabilityRules, tz: string): boolean {
  if (!rules.blackouts.length) return false;
  const first = localParts(start, tz);
  const last = localParts(Math.max(start, end - 1), tz);
  let day = Date.UTC(first.y, first.m - 1, first.d);
  const stop = Date.UTC(last.y, last.m - 1, last.d);
  for (let i = 0; i < 8 && day <= stop; i++, day += 86_400_000) {
    const dt = new Date(day);
    const name = DAYS[dt.getUTCDay()];
    for (const w of rules.blackouts) {
      if (w.day !== name) continue;
      const [fh, fm] = w.from.split(':').map(Number);
      const [th, tm] = w.to.split(':').map(Number);
      const ws = zonedMs(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate(), fh, fm, tz);
      const we = zonedMs(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate(), th, tm, tz);
      if (start < we && end > ws) return true;
    }
  }
  return false;
}

/** The facts every slot of one advisor is judged against: standing, saved rules and their booked hours. */
export async function loadBookability(env: Env, advisorId: number, now: number): Promise<Bookability> {
  const adv = await env.DB.prepare(
    `SELECT a.is_active AS is_active, a.timezone AS timezone,
            EXISTS (SELECT 1 FROM network_member_states nms
                     WHERE nms.user_id = a.user_id AND nms.paused_at IS NOT NULL) AS paused
       FROM advisors a WHERE a.id = ?`
  ).bind(advisorId).first<{ is_active: number; timezone: string | null; paused: number }>();
  const row = await env.DB.prepare('SELECT * FROM advisor_availability_rules WHERE advisor_id = ?')
    .bind(advisorId).first<any>();
  let blackouts: AvailabilityRules['blackouts'] = [];
  try { const j = JSON.parse(row?.blackouts_json || '[]'); if (Array.isArray(j)) blackouts = j; } catch { blackouts = []; }
  const rules: AvailabilityRules = {
    weekly_paid_cap: row?.weekly_paid_cap ?? null,
    buffer_minutes: row?.buffer_minutes ?? null,
    min_notice_hours: row?.min_notice_hours ?? null,
    blackouts, timezone: row?.timezone ?? null,
  };
  // Eight days back covers the Monday that opens the week of any slot from now on.
  const since = new Date(now - 8 * 86_400_000).toISOString();
  const booked = await env.DB.prepare(
    `SELECT b.slot_id AS slot_id, s.starts_at AS starts_at, s.ends_at AS ends_at,
            (t.id IS NOT NULL AND COALESCE(t.price_cents, 0) > 0
              AND COALESCE(t.is_included, 0) = 0 AND COALESCE(t.is_free_intro, 0) = 0) AS paid
       FROM advisor_bookings b
       JOIN advisor_office_hour_slots s ON s.id = b.slot_id
       LEFT JOIN advisor_session_types t ON t.id = b.session_type_id
      WHERE b.advisor_id = ? AND b.status IN ('pending','confirmed','completed')
        AND datetime(s.starts_at) >= datetime(?)
      LIMIT 5000`
  ).bind(advisorId, since).all<{ slot_id: number; starts_at: string; ends_at: string; paid: number }>();
  return {
    advisorState: !adv ? 'missing' : !adv.is_active ? 'inactive' : adv.paused ? 'paused' : 'ok',
    rules,
    zone: validZone(rules.timezone) || validZone(adv?.timezone) || 'UTC',
    booked: (booked.results || []).map((r) => ({
      slot_id: Number(r.slot_id), start: ms(r.starts_at), end: ms(r.ends_at), paid: !!r.paid,
    })),
  };
}

/** Why a slot cannot be booked now, or null. THE one calculation; the list and the booking both call it. */
export function slotRefusal(
  slot: SlotFacts, ctx: Bookability, opts: { paid: boolean; now: number },
): RefusalCode | null {
  if (ctx.advisorState === 'missing' || ctx.advisorState === 'inactive') return 'advisor_inactive';
  if (ctx.advisorState === 'paused') return 'advisor_paused';
  if (slot.is_cancelled) return 'slot_cancelled';
  if (slot.blocked_reason != null) return 'slot_blocked';
  const start = ms(slot.starts_at);
  const end = ms(slot.ends_at);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'slot_cancelled';
  if (start < opts.now) return 'slot_past';
  const taken = ctx.booked.filter((b) => b.slot_id === slot.id).length;
  if (taken >= slot.capacity) return 'slot_full';
  const r = ctx.rules;
  if (r.min_notice_hours != null && start < opts.now + r.min_notice_hours * 3_600_000) return 'inside_notice';
  if (inBlackout(start, end, r, ctx.zone)) return 'blackout';
  if (r.buffer_minutes != null && r.buffer_minutes > 0) {
    const pad = r.buffer_minutes * 60_000;
    if (ctx.booked.some((b) => b.slot_id !== slot.id && b.start < end + pad && b.end > start - pad)) return 'buffer';
  }
  if (opts.paid && r.weekly_paid_cap != null) {
    const w = weekBounds(start, ctx.zone);
    const used = ctx.booked.filter((b) => b.paid && b.start >= w.start && b.start < w.end).length;
    if (used >= r.weekly_paid_cap) return 'weekly_cap';
  }
  return null;
}

/**
 * The binds the booking INSERT's guard needs, computed from the SAME context
 * the calculation above used: the earliest start, whether the buffer and cap
 * rules apply, and the windows they look at.
 */
export function writeGuard(slot: SlotFacts, ctx: Bookability, opts: { paid: boolean; now: number }) {
  const start = ms(slot.starts_at);
  const end = ms(slot.ends_at);
  const r = ctx.rules;
  const pad = (r.buffer_minutes ?? 0) * 60_000;
  const week = weekBounds(start, ctx.zone);
  const iso = (t: number) => new Date(t).toISOString();
  return {
    minStart: iso(opts.now + (r.min_notice_hours ?? 0) * 3_600_000),
    bufferOn: pad > 0 ? 1 : 0,
    bufferEnd: iso(end + pad),
    bufferStart: iso(start - pad),
    capOn: opts.paid && r.weekly_paid_cap != null ? 1 : 0,
    weekStart: iso(week.start),
    weekEnd: iso(week.end),
    cap: r.weekly_paid_cap ?? 0,
  };
}
