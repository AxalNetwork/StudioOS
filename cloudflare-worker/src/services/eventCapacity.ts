/**
 * Task #39 — Event engine: seat / waitlist math (design §3).
 *
 * A seat is held by an event_registrations row in {registered, confirmed,
 * attended}. capacity NULL = unlimited. When full, a new registration is
 * waitlisted (if waitlist_enabled) or refused. Freeing a seat (cancel/decline
 * or an admin capacity increase) promotes the lowest waitlist_position to a
 * seat — transactionally, via a compare-and-set UPDATE, so a freed seat is
 * never double-allocated.
 */
import type { Env } from '../types';

export const SEAT_STATUSES = ['registered', 'confirmed', 'attended'] as const;

/**
 * A SQL predicate (for a WHERE clause) that holds only while the event still
 * has a free seat. Folding the capacity check into the same statement that
 * claims the seat makes seat allocation atomic — two concurrent writers can't
 * both pass a separate read-then-write and over-allocate (design §3: a seat is
 * never double-allocated). Bind order: `capacity` (NULL = unlimited → always
 * true), `eventId`, `capacity`. The row being written is itself NOT yet a seat
 * (a brand-new INSERT, or an UPDATE off 'waitlisted'/'cancelled'/'declined'),
 * so it is correctly excluded from the seat count.
 */
export const SEAT_FREE_PREDICATE =
  `(? IS NULL OR (SELECT COUNT(*) FROM event_registrations` +
  ` WHERE event_id = ? AND status IN ('registered','confirmed','attended')) < ?)`;

export interface EventSeatRow {
  id: number;
  capacity: number | null;
  waitlist_enabled: number;
  approval_required: number;
  [k: string]: unknown;
}

export async function seatsTaken(env: Env, eventId: number): Promise<number> {
  const r: any = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM event_registrations
       WHERE event_id = ? AND status IN ('registered','confirmed','attended')`,
  ).bind(eventId).first();
  return Number(r?.n || 0);
}

export async function nextWaitlistPosition(env: Env, eventId: number): Promise<number> {
  const r: any = await env.DB.prepare(
    `SELECT COALESCE(MAX(waitlist_position), 0) AS m FROM event_registrations
       WHERE event_id = ? AND status = 'waitlisted'`,
  ).bind(eventId).first();
  return Number(r?.m || 0) + 1;
}

export function isCapacityFull(event: EventSeatRow, taken: number): boolean {
  return event.capacity != null && taken >= Number(event.capacity);
}

export interface SeatDecision {
  status: 'registered' | 'confirmed' | 'waitlisted';
  waitlistPosition: number | null;
}
export interface SeatRefused {
  full: true;
}

/**
 * Decide the landing status for a brand-new registration. comp seats skip the
 * approval gate (they're confirmed directly, mirroring promotion's "confirmed
 * if … already comp" rule, §3).
 */
export async function classifyNewSeat(
  env: Env,
  event: EventSeatRow,
  opts: { comp?: boolean } = {},
): Promise<SeatDecision | SeatRefused> {
  const taken = await seatsTaken(env, event.id);
  if (isCapacityFull(event, taken)) {
    if (event.waitlist_enabled) {
      return { status: 'waitlisted', waitlistPosition: await nextWaitlistPosition(env, event.id) };
    }
    return { full: true };
  }
  const needsApproval = !!event.approval_required && !opts.comp;
  return { status: needsApproval ? 'registered' : 'confirmed', waitlistPosition: null };
}

/**
 * Each seated registration carries a unique check-in code (the QR payload).
 * Idempotent: returns the existing code, or mints one. UNIQUE(event_id,
 * registration_id) guards against a double insert under a race.
 */
export async function ensureCheckinCode(
  env: Env,
  eventId: number,
  registrationId: number,
): Promise<string> {
  const existing: any = await env.DB.prepare(
    `SELECT code FROM event_checkins WHERE event_id = ? AND registration_id = ?`,
  ).bind(eventId, registrationId).first();
  if (existing?.code) return String(existing.code);
  const code = crypto.randomUUID().replace(/-/g, '');
  try {
    await env.DB.prepare(
      `INSERT INTO event_checkins (event_id, registration_id, code) VALUES (?, ?, ?)`,
    ).bind(eventId, registrationId, code).run();
    return code;
  } catch {
    const again: any = await env.DB.prepare(
      `SELECT code FROM event_checkins WHERE event_id = ? AND registration_id = ?`,
    ).bind(eventId, registrationId).first();
    return again?.code ? String(again.code) : code;
  }
}

export interface PromotedRegistration {
  id: number;
  user_id: number | null;
  email: string | null;
  name: string | null;
  status: 'registered' | 'confirmed';
}

/**
 * Promote waitlisted registrations into every currently-free seat, lowest
 * waitlist_position first. With capacity NULL (unlimited) the whole waitlist is
 * drained. Returns the promoted rows so the caller can notify them (§6).
 *
 * The promote step is a compare-and-set (`… WHERE id = ? AND status =
 * 'waitlisted'`): if the row is no longer waitlisted (a concurrent promotion
 * already took it) the UPDATE reports 0 changes and the loop stops rather than
 * over-allocating the freed seat.
 */
export async function promoteWaitlist(env: Env, event: EventSeatRow): Promise<PromotedRegistration[]> {
  const promoted: PromotedRegistration[] = [];
  for (let guard = 0; guard < 5000; guard++) {
    const taken = await seatsTaken(env, event.id);
    if (event.capacity != null && taken >= Number(event.capacity)) break; // no free seat
    const next: any = await env.DB.prepare(
      `SELECT id, user_id, email, name, comp FROM event_registrations
         WHERE event_id = ? AND status = 'waitlisted'
         ORDER BY waitlist_position ASC, id ASC LIMIT 1`,
    ).bind(event.id).first();
    if (!next) break; // empty waitlist
    const target: 'registered' | 'confirmed' =
      (event.approval_required && !next.comp) ? 'registered' : 'confirmed';
    const cap = event.capacity != null ? Number(event.capacity) : null;
    const upd: any = await env.DB.prepare(
      `UPDATE event_registrations
          SET status = ?, waitlist_position = NULL, updated_at = datetime('now')
        WHERE id = ? AND status = 'waitlisted' AND ${SEAT_FREE_PREDICATE}`,
    ).bind(target, next.id, cap, event.id, cap).run();
    if (!upd?.meta?.changes) break; // lost the seat to a concurrent claim/promotion
    await ensureCheckinCode(env, event.id, Number(next.id));
    promoted.push({
      id: Number(next.id),
      user_id: next.user_id != null ? Number(next.user_id) : null,
      email: next.email ?? null,
      name: next.name ?? null,
      status: target,
    });
  }
  return promoted;
}
