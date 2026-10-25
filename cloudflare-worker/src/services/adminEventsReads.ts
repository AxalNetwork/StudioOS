/**
 * D918 / #2701 — the admin Events desk's reads (part 3 of #2368).
 *
 * Five reads behind `routes/admin_events.ts`: the overview (`GET /overview`),
 * the paged list (`GET /`), one event's counts-only summary, its history and
 * the free-seat preview. Every rule here is D915 §2's, word for word, so the
 * overview, the calendar and the review queue agree:
 *
 *   · seats taken  = registered + confirmed + attended;
 *   · ended        = `ends_at` has passed; with no `ends_at`, a day after start;
 *   · show-up      = attended ÷ seats taken, ended events only;
 *   · overdue      = more than 72 hours since `submitted_at` (SLA_PAST_HOURS);
 *   · clash        = neither event cancelled and their times overlap; an event
 *                    with no `ends_at` lasts one hour for this rule;
 *   · low sign-ups = a cap, starts within 7 days, under a quarter of it taken;
 *   · a seat's source, in order: invitation, then free seat, then signed up.
 *
 * Each block answers alone in D893's shape (`decisions/D893.md`):
 *   · `{ available: true, ... }`                   — read, and true;
 *   · `{ available: false, unreadable: true, reason }` — its store failed;
 *   · `{ recorded: false, reason }`                — nothing records it.
 * A failed block never reads as zero. Counts only: no member's name, email or
 * ID leaves here, except the host line the canvas draws.
 */
import type { Env } from '../types';
import { SLA_PAST_HOURS } from './approvalSources';
import { EVENT_TYPE_IDS } from './eventTypes';
import { evaluateCompEligibility, parseAudienceRules } from './eventAudience';

type Unreadable = { available: false; unreadable: true; reason: string };
type NotRecorded = { recorded: false; reason: string };

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

export const SEATED = ['registered', 'confirmed', 'attended'] as const;
/** "Next 30 days", "On waitlists" and the type and format counts take only these (D915 §3). */
const LIVE = new Set(['published', 'pending_review']);
const EVENT_STATUSES = ['draft', 'pending_review', 'published', 'rejected', 'cancelled'] as const;
const REGISTRATION_STATUSES = ['registered', 'confirmed', 'attended', 'waitlisted', 'declined', 'cancelled'] as const;
const PAYMENT_STATUSES = ['none', 'free', 'pending', 'paid', 'refunded'] as const;
const ROLES = ['founder', 'partner', 'exploring', 'advisor', 'investor', 'admin'] as const;
export const OVERVIEW_WEEKS = [4, 12, 52] as const;

const unreadable = (what: string, e: unknown): Unreadable => {
  console.error('[admin-events-reads]', what, typeof e === 'string' ? e : (e as Error)?.message);
  return {
    available: false,
    unreadable: true,
    reason: `${what} could not be read on this database. That is not the same as none.`,
  };
};

/** Runs `read`; a throw becomes that block's own `unreadable`. */
async function block<T>(what: string, read: () => Promise<T>): Promise<({ available: true } & T) | Unreadable> {
  try {
    return { available: true, ...(await read()) };
  } catch (e) {
    return unreadable(what, e);
  }
}

/** A read shared by several blocks runs once; each block that needs it fails alone. */
function once<T>(read: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | null = null;
  return () => (p ??= read());
}

async function all(env: Env, sql: string, binds: unknown[] = []): Promise<any[]> {
  const r: any = await env.DB.prepare(sql).bind(...binds).all();
  if ((r && 'success' in r && !r.success) || !Array.isArray(r?.results)) throw new Error('rows were not returned');
  return r.results;
}

/** The editor writes UTC instants; legacy offset-free D1 timestamps are UTC too (D916). */
export function timestamp(value: unknown): number {
  if (typeof value !== 'string' || !value.trim()) return Number.NaN;
  const v = value.trim();
  return Date.parse(/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(v) ? v : v.replace(' ', 'T') + 'Z');
}

const hasEnd = (e: { ends_at?: unknown }) => typeof e.ends_at === 'string' && e.ends_at.trim() !== '';
/** D915 §2: ended once `ends_at` has passed; with no `ends_at`, a day after the start. */
export const endedAt = (e: { starts_at?: unknown; ends_at?: unknown }) =>
  hasEnd(e) ? timestamp(e.ends_at) : timestamp(e.starts_at) + DAY;
export const hasEnded = (e: { starts_at?: unknown; ends_at?: unknown }, now: number) => endedAt(e) < now;
/** D915 §2: for the clash rule an event with no `ends_at` lasts one hour. */
const clashEnd = (e: { starts_at?: unknown; ends_at?: unknown }) =>
  hasEnd(e) ? timestamp(e.ends_at) : timestamp(e.starts_at) + HOUR;

const round2 = (n: number) => Math.round(n * 100) / 100;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const iso = (ms: number) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);

/** Midnight UTC of the Monday of the week holding `ms`. */
export function mondayOf(ms: number): number {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - day * DAY;
}

/** D915 §2: invitation, then free seat, then signed up. */
export function seatSource(r: { invitation_id?: unknown; comp?: unknown }): 'invitation' | 'free_seat' | 'signed_up' {
  if (r.invitation_id != null) return 'invitation';
  if (Number(r.comp) === 1) return 'free_seat';
  return 'signed_up';
}

const ADDED_BY_ADMIN: NotRecorded = {
  recorded: false,
  reason: 'Nothing records a seat an admin added: no write path stores that source.',
};

/** The host's role bucket, or `guest` when the registration has no account. */
function roleOf(r: { user_id?: unknown; role?: unknown }): string {
  if (r.user_id == null) return 'guest';
  // An account that is gone, or a role with no bucket, is not recorded.
  return (ROLES as readonly string[]).includes(String(r.role)) ? String(r.role) : 'not_recorded';
}

function zeroes<K extends string>(keys: readonly K[]): Record<K, number> {
  return Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
}

/** Format, from `location_kind`. The legacy `in_person` reads as in person. */
function formatOf(kind: unknown): 'online' | 'in_person' | 'hybrid' | 'not_recorded' {
  if (kind === 'virtual') return 'online';
  if (kind === 'physical' || kind === 'in_person') return 'in_person';
  if (kind === 'hybrid') return 'hybrid';
  return 'not_recorded';
}

// ── The event rows several reads share ─────────────────────────────────────

const EVENT_ROWS_SQL = `
  SELECT e.*,
         COALESCE(NULLIF(TRIM(u.display_name), ''), u.name) AS host_name, u.role AS host_role,
         p.name AS venture_name,
         COALESCE(r.seats_taken, 0) AS seats_taken, COALESCE(r.attended, 0) AS attended,
         COALESCE(r.waitlisted, 0) AS waitlisted, COALESCE(r.paid, 0) AS paid_tickets
    FROM events e
    LEFT JOIN users u ON u.id = e.host_user_id
    LEFT JOIN projects p ON p.id = e.project_id
    LEFT JOIN (
      SELECT event_id,
             SUM(CASE WHEN status IN ('registered','confirmed','attended') THEN 1 ELSE 0 END) AS seats_taken,
             SUM(CASE WHEN status = 'attended' THEN 1 ELSE 0 END) AS attended,
             SUM(CASE WHEN status = 'waitlisted' THEN 1 ELSE 0 END) AS waitlisted,
             SUM(CASE WHEN payment_status = 'paid' THEN 1 ELSE 0 END) AS paid
        FROM event_registrations GROUP BY event_id
    ) r ON r.event_id = e.id`;

export interface EventRow {
  [k: string]: any;
  id: number;
  starts_at: string | null;
  ends_at: string | null;
  host_user_id: number | null;
  seats_taken: number;
  attended: number;
  waitlisted: number;
  paid_tickets: number;
}

async function readEventRows(env: Env): Promise<EventRow[]> {
  const rows = await all(env, EVENT_ROWS_SQL);
  return rows.map((r) => ({
    ...r,
    id: Number(r.id),
    seats_taken: Number(r.seats_taken || 0),
    attended: Number(r.attended || 0),
    waitlisted: Number(r.waitlisted || 0),
    paid_tickets: Number(r.paid_tickets || 0),
  }));
}

/** Every clash among events that are not cancelled, as id → the ids it overlaps. */
export function clashesOf(events: EventRow[]): Map<number, number[]> {
  const live = events
    .filter((e) => e.status !== 'cancelled')
    .map((e) => ({ id: e.id, start: timestamp(e.starts_at), end: clashEnd(e) }))
    .filter((e) => Number.isFinite(e.start) && Number.isFinite(e.end))
    .sort((a, b) => a.start - b.start || a.id - b.id);
  const out = new Map<number, number[]>();
  const add = (a: number, b: number) => out.set(a, [...(out.get(a) || []), b]);
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length && live[j].start < live[i].end; j++) {
      if (live[i].start < live[j].end) { add(live[i].id, live[j].id); add(live[j].id, live[i].id); }
    }
  }
  return out;
}

const fillOf = (e: EventRow) => {
  const cap = e.capacity != null ? Number(e.capacity) : null;
  return cap && cap > 0 ? round2(e.seats_taken / cap) : null;
};
const showUpOf = (e: EventRow, now: number) =>
  e.status !== 'cancelled' && hasEnded(e, now) && e.seats_taken > 0 ? round2(e.attended / e.seats_taken) : null;
/** D917: the wait counts from `submitted_at`, with `created_at` as the legacy fallback (the Approvals lane's rule). */
const waitingSince = (e: EventRow) => {
  const at = timestamp(e.submitted_at);
  return Number.isFinite(at) ? at : timestamp(e.created_at);
};
/** D915 §2: Overdue is waiting longer than 72 hours (SLA_PAST_HOURS). */
const isOverdue = (e: EventRow, now: number) => e.status === 'pending_review' && now - waitingSince(e) > SLA_PAST_HOURS * HOUR;
const waitingHours = (e: EventRow, now: number) => {
  if (e.status !== 'pending_review') return null;
  const at = waitingSince(e);
  return Number.isFinite(at) ? Math.max(0, Math.floor((now - at) / HOUR)) : null;
};

// ── GET /overview ──────────────────────────────────────────────────────────

export async function readOverview(env: Env, weeks: number, now = Date.now()) {
  const currentMonday = mondayOf(now);
  const start = currentMonday - (weeks - 1) * WEEK;
  const end = currentMonday + WEEK;
  const previousStart = start - weeks * WEEK;
  const inPeriod = (ms: number) => ms >= start && ms < end;
  // A loose bound on the stored text, a day early; the exact cut is made on the parsed time.
  const since = isoDay(previousStart - DAY);

  const events = once(() => readEventRows(env));
  const registrations = once(() => all(env,
    `SELECT r.status, r.comp, r.invitation_id, r.payment_status, r.amount_cents, r.registered_at, e.currency
       FROM event_registrations r LEFT JOIN events e ON e.id = r.event_id
      WHERE r.registered_at >= ?`, [since]));
  const inThisPeriod = async () => (await registrations()).filter((r) => inPeriod(timestamp(r.registered_at)));

  const [queue, upcoming_30d, waitlisted, weekly, show_up, by_status, by_type, by_format, by_role, by_source,
    paid, payment_pending, free_seats, cancelled, needs_attention] = await Promise.all([
    block('The review queue', async () => {
      const waiting = (await events()).filter((e) => e.status === 'pending_review');
      const since = waiting.map(waitingSince).filter(Number.isFinite);
      const oldest = since.length ? Math.min(...since) : null;
      return {
        count: waiting.length,
        oldest_since: oldest == null ? null : iso(oldest),
        oldest_hours: oldest == null ? null : Math.max(0, Math.floor((now - oldest) / HOUR)),
        overdue: waiting.filter((e) => isOverdue(e, now)).length,
        overdue_after_hours: SLA_PAST_HOURS,
        // Queued before submission was stamped: their wait counts from creation, as the Approvals lane's does.
        waiting_from_created_at: waiting.filter((e) => !Number.isFinite(timestamp(e.submitted_at))).length,
      };
    }),
    block('The next 30 days', async () => {
      const rows = (await events()).filter((e) => {
        const s = timestamp(e.starts_at);
        return LIVE.has(e.status) && s >= now && s <= now + 30 * DAY;
      });
      return {
        events: rows.length,
        seats_taken: rows.reduce((n, e) => n + e.seats_taken, 0),
        full: rows.filter((e) => Number(e.capacity) > 0 && e.seats_taken >= Number(e.capacity)).length,
      };
    }),
    block('The waitlists', async () => {
      const rows = (await events()).filter((e) => LIVE.has(e.status) && timestamp(e.starts_at) >= now);
      return { registrations: rows.reduce((n, e) => n + e.waitlisted, 0), events: rows.filter((e) => e.waitlisted > 0).length };
    }),
    block('The weekly registrations and check-ins', async () => {
      const regs = await registrations();
      const checkins = await all(env, `SELECT checked_in_at FROM event_checkins WHERE checked_in_at >= ?`, [since]);
      const buckets = Array.from({ length: weeks }, (_, i) => ({
        week_start: isoDay(start + i * WEEK), registrations: 0, checkins: 0, ...(i === weeks - 1 ? { to_date: true } : {}),
      }));
      const slot = (ms: number) => (inPeriod(ms) ? Math.floor((ms - start) / WEEK) : -1);
      let previous = 0;
      for (const r of regs) {
        const at = timestamp(r.registered_at);
        const i = slot(at);
        if (i >= 0) buckets[i].registrations++;
        else if (at >= previousStart && at < start) previous++;
      }
      for (const r of checkins) { const i = slot(timestamp(r.checked_in_at)); if (i >= 0) buckets[i].checkins++; }
      return {
        weeks: buckets,
        registrations: { this_period: buckets.reduce((n, b) => n + b.registrations, 0), previous_period: previous },
      };
    }),
    block('Show-up', async () => {
      const ended = (await events())
        .filter((e) => e.status !== 'cancelled' && hasEnded(e, now) && inPeriod(endedAt(e)))
        .sort((a, b) => endedAt(b) - endedAt(a) || b.id - a.id);
      const seats = ended.reduce((n, e) => n + e.seats_taken, 0);
      const attended = ended.reduce((n, e) => n + e.attended, 0);
      return {
        events: ended.length,
        seats_taken: seats,
        attended,
        rate: seats > 0 ? round2(attended / seats) : null,
        recent: ended.slice(0, 8).map((e) => ({
          id: e.id, title: e.title, ended_at: iso(endedAt(e)), seats_taken: e.seats_taken, attended: e.attended,
          rate: e.seats_taken > 0 ? round2(e.attended / e.seats_taken) : null,
        })),
      };
    }),
    block('The events by status', async () => {
      const counts = { ...zeroes(EVENT_STATUSES), other: 0 };
      for (const e of await events()) {
        if ((EVENT_STATUSES as readonly string[]).includes(e.status)) counts[e.status as (typeof EVENT_STATUSES)[number]]++;
        else counts.other++;
      }
      return { counts };
    }),
    block('The events by type', async () => {
      const counts = { ...zeroes(EVENT_TYPE_IDS), other: 0 };
      for (const e of await events()) {
        if (!LIVE.has(e.status) || !inPeriod(timestamp(e.starts_at))) continue;
        if ((EVENT_TYPE_IDS as readonly string[]).includes(e.type)) counts[e.type as (typeof EVENT_TYPE_IDS)[number]]++;
        else counts.other++;
      }
      return { counts };
    }),
    block('The events by format', async () => {
      const counts = zeroes(['online', 'in_person', 'hybrid', 'not_recorded'] as const);
      for (const e of await events()) {
        if (LIVE.has(e.status) && inPeriod(timestamp(e.starts_at))) counts[formatOf(e.location_kind)]++;
      }
      return { counts };
    }),
    block('Who registered', async () => {
      const rows = await all(env,
        `SELECT r.user_id, r.registered_at, u.role
           FROM event_registrations r LEFT JOIN users u ON u.id = r.user_id
          WHERE r.status IN ('registered','confirmed','attended') AND r.registered_at >= ?`, [since]);
      const counts = { ...zeroes(ROLES), guest: 0, not_recorded: 0 };
      for (const r of rows) if (inPeriod(timestamp(r.registered_at))) counts[roleOf(r) as keyof typeof counts]++;
      return { counts };
    }),
    block('How seats were got', async () => {
      const counts = zeroes(['invitation', 'free_seat', 'signed_up'] as const);
      for (const r of await inThisPeriod()) if ((SEATED as readonly string[]).includes(r.status)) counts[seatSource(r)]++;
      return { counts, added_by_admin: ADDED_BY_ADMIN };
    }),
    block('The paid tickets', async () => paidByCurrency((await inThisPeriod()).filter((r) => r.payment_status === 'paid'))),
    block('The pending payments', async () => ({
      count: (await inThisPeriod()).filter((r) => r.payment_status === 'pending' && r.status !== 'cancelled' && r.status !== 'declined').length,
    })),
    block('The free seats', async () => ({
      count: (await inThisPeriod()).filter((r) => (SEATED as readonly string[]).includes(r.status) && Number(r.comp) === 1).length,
    })),
    block('The cancelled events', async () => {
      const rows = (await events()).filter((e) => e.status === 'cancelled' && inPeriod(timestamp(e.starts_at)));
      // No cancellation time is stored, so the period is read by start.
      return { events: rows.length, with_paid_tickets: rows.filter((e) => e.paid_tickets > 0).length, counted_by: 'starts_at' };
    }),
    block('What needs attention', async () => needsAttention(await events(), now)),
  ]);

  return {
    weeks,
    period: { start: iso(start), end: iso(end), current_week_to_date: true },
    queue, upcoming_30d, waitlisted, weekly, show_up, by_status, by_type, by_format, by_role, by_source,
    paid, payment_pending, free_seats, cancelled, needs_attention,
    views: { recorded: false, reason: 'No store counts views of an event page, so the funnel starts at registration.' } as NotRecorded,
    feedback: { recorded: false, reason: 'Events have no feedback form yet.' } as NotRecorded,
  };
}

function paidByCurrency(rows: any[]) {
  const by = new Map<string, { currency: string | null; count: number; amount_cents: number; amount_not_recorded: number }>();
  for (const r of rows) {
    const currency = typeof r.currency === 'string' && r.currency ? r.currency.toLowerCase() : null;
    const key = currency ?? '';
    const cur = by.get(key) ?? { currency, count: 0, amount_cents: 0, amount_not_recorded: 0 };
    cur.count++;
    if (r.amount_cents == null) cur.amount_not_recorded++;
    else cur.amount_cents += Number(r.amount_cents);
    by.set(key, cur);
  }
  return {
    count: rows.length,
    by_currency: [...by.values()].sort((a, b) => String(a.currency).localeCompare(String(b.currency))),
  };
}

export type AttentionKind = 'overdue' | 'full' | 'low_signups' | 'clash' | 'changed_after_approval' | 'paid_on_cancelled';
const ATTENTION_KINDS: AttentionKind[] = ['overdue', 'full', 'low_signups', 'clash', 'changed_after_approval', 'paid_on_cancelled'];

export function needsAttention(events: EventRow[], now: number) {
  const clashes = clashesOf(events);
  const byId = new Map(events.map((e) => [e.id, e]));
  const items: Array<Record<string, unknown> & { kind: AttentionKind }> = [];
  const item = (kind: AttentionKind, e: EventRow, extra: Record<string, unknown> = {}) =>
    items.push({ kind, event_id: e.id, title: e.title, starts_at: e.starts_at ?? null, ...extra });
  for (const e of events) {
    const cap = Number(e.capacity) > 0 ? Number(e.capacity) : null;
    const start = timestamp(e.starts_at);
    const over = hasEnded(e, now);
    if (isOverdue(e, now)) item('overdue', e, { waiting_hours: waitingHours(e, now) });
    if (LIVE.has(e.status) && !over && cap && e.seats_taken >= cap) item('full', e, { capacity: cap, seats_taken: e.seats_taken, waitlisted: e.waitlisted });
    if (LIVE.has(e.status) && cap && start > now && start <= now + 7 * DAY && e.seats_taken < cap / 4) {
      item('low_signups', e, { capacity: cap, seats_taken: e.seats_taken });
    }
    if (!over && clashes.has(e.id)) item('clash', e, { with: clashes.get(e.id)!.filter((id) => !hasEnded(byId.get(id)!, now)) });
    if (e.status === 'published' && !over && e.changed_after_approval_at) item('changed_after_approval', e, { changed_at: e.changed_after_approval_at });
    if (e.status === 'cancelled' && e.paid_tickets > 0) item('paid_on_cancelled', e, { paid_tickets: e.paid_tickets });
  }
  const live = items.filter((i) => i.kind !== 'clash' || (i.with as number[]).length > 0);
  const counts = zeroes(ATTENTION_KINDS);
  for (const i of live) counts[i.kind]++;
  return { counts, total: live.length, items: live };
}

// ── GET / — the paged list ─────────────────────────────────────────────────

export const LIST_SORTS = ['starts', 'created', 'seats_taken', 'fill', 'show_up', 'waiting'] as const;
export type ListSort = (typeof LIST_SORTS)[number];
const LIST_WHEN = ['upcoming', 'ended', 'this_week', 'next_30d'] as const;

export interface ListQuery {
  statuses: string[];
  visibility: string | null;
  when: string | null;
  price: string | null;
  featured: boolean | null;
  q: string | null;
  sort: ListSort | null;
  dir: 'asc' | 'desc' | null;
  limit: number;
  offset: number;
}

/** Parses the list's query; returns a refusal word for a value it does not know. */
export function parseListQuery(read: (k: string) => string | undefined, readAll: (k: string) => string[] | undefined):
  ListQuery | { error: string } {
  const statuses = (readAll('status') || []).flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean);
  const visibility = read('visibility')?.trim() || null;
  if (visibility && !['public', 'unlisted', 'private'].includes(visibility)) return { error: 'invalid_visibility' };
  const when = read('when')?.trim() || null;
  if (when && !(LIST_WHEN as readonly string[]).includes(when)) return { error: 'invalid_when' };
  const price = read('price')?.trim() || null;
  if (price && price !== 'free' && price !== 'paid') return { error: 'invalid_price' };
  const f = read('featured')?.trim();
  const featured = f == null || f === '' ? null : ['1', 'true'].includes(f) ? true : ['0', 'false'].includes(f) ? false : undefined;
  if (featured === undefined) return { error: 'invalid_featured' };
  const sort = read('sort')?.trim() || null;
  if (sort && !(LIST_SORTS as readonly string[]).includes(sort)) return { error: 'invalid_sort' };
  const dir = read('dir')?.trim() || null;
  if (dir && dir !== 'asc' && dir !== 'desc') return { error: 'invalid_dir' };
  const q = read('q')?.trim().toLowerCase().slice(0, 200) || null;
  const limit = Math.min(Math.max(Math.floor(Number(read('limit') || 50)) || 50, 1), 200);
  const offset = Math.max(Math.floor(Number(read('offset') || 0)) || 0, 0);
  return { statuses, visibility, when, price, featured, q, sort: sort as ListSort | null, dir: dir as 'asc' | 'desc' | null, limit, offset };
}

/**
 * The list. Filters, sorts and the clash flag need every event's counts and
 * times, so the rows are read once and cut here; `total` is the filtered count.
 * With no `sort` the order is today's: newest created first.
 */
export async function readEventList(env: Env, q: ListQuery, now = Date.now()) {
  const rows = await readEventRows(env);
  const clashes = clashesOf(rows);
  const monday = mondayOf(now);
  const kept = rows.filter((e) => {
    if (q.statuses.length && !q.statuses.includes(e.status)) return false;
    if (q.visibility && e.visibility !== q.visibility) return false;
    if (q.price === 'free' && Number(e.price_cents || 0) > 0) return false;
    if (q.price === 'paid' && !(Number(e.price_cents || 0) > 0)) return false;
    if (q.featured != null && (Number(e.featured) === 1) !== q.featured) return false;
    const start = timestamp(e.starts_at);
    if (q.when === 'upcoming' && hasEnded(e, now)) return false;
    if (q.when === 'ended' && !hasEnded(e, now)) return false;
    if (q.when === 'this_week' && !(start >= monday && start < monday + WEEK)) return false;
    if (q.when === 'next_30d' && !(start >= now && start <= now + 30 * DAY)) return false;
    if (q.q) {
      const hay = [e.title, e.host_name, e.venture_name].map((s) => String(s ?? '').toLowerCase());
      if (!hay.some((s) => s.includes(q.q!))) return false;
    }
    return true;
  });
  const value = (e: EventRow): number | null => {
    switch (q.sort) {
      case 'starts': { const t = timestamp(e.starts_at); return Number.isFinite(t) ? t : null; }
      case 'seats_taken': return e.seats_taken;
      case 'fill': return fillOf(e);
      case 'show_up': return showUpOf(e, now);
      case 'waiting': return waitingHours(e, now);
      default: { const t = timestamp(e.created_at); return Number.isFinite(t) ? t : null; }
    }
  };
  const dir = q.dir ?? (q.sort === 'starts' ? 'asc' : 'desc');
  const sign = dir === 'asc' ? 1 : -1;
  // A missing value sorts last either way: unknown is not the smallest number.
  kept.sort((a, b) => {
    const va = value(a), vb = value(b);
    if (va == null && vb == null) return b.id - a.id;
    if (va == null) return 1;
    if (vb == null) return -1;
    return (va - vb) * sign || b.id - a.id;
  });
  const page = kept.slice(q.offset, q.offset + q.limit);
  return {
    total: kept.length,
    limit: q.limit,
    offset: q.offset,
    rows: page.map((e) => ({
      row: e,
      counts: {
        seats_taken: e.seats_taken,
        attended: e.attended,
        waitlisted: e.waitlisted,
        fill: fillOf(e),
        ended: hasEnded(e, now),
        show_up: showUpOf(e, now),
        waiting_hours: waitingHours(e, now),
        host: hostLine(e),
        venture: e.project_id == null ? null : { name: e.venture_name ?? null },
        clash: (clashes.get(e.id) || []).length > 0,
      },
    })),
  };
}

/** The canvas's host line: a name and a role, nothing else. */
function hostLine(e: { host_user_id?: unknown; host_name?: unknown; host_role?: unknown }) {
  if (e.host_user_id == null) return null;
  return { name: (e.host_name as string) ?? null, role: (e.host_role as string) ?? null };
}

// ── GET /:id/summary ───────────────────────────────────────────────────────

export async function readEventSummary(env: Env, event: any, now = Date.now()) {
  const id = Number(event.id);
  const regs = once(() => all(env,
    `SELECT r.status, r.comp, r.invitation_id, r.payment_status, r.amount_cents, r.registered_at, r.user_id,
            u.role
       FROM event_registrations r LEFT JOIN users u ON u.id = r.user_id
      WHERE r.event_id = ?`, [id]));
  const seated = async () => (await regs()).filter((r) => (SEATED as readonly string[]).includes(r.status));

  const [host, registrations, by_source, by_role, payments, free_seats, checkins, invitations, reminders, seats_by_day] = await Promise.all([
    block('The host', async () => {
      if (event.host_user_id == null) return { host: null, venture: null };
      const rows = await all(env,
        `SELECT COALESCE(NULLIF(TRIM(u.display_name), ''), u.name) AS host_name, u.role AS host_role,
                (SELECT p.name FROM projects p WHERE p.id = ?) AS venture_name
           FROM users u WHERE u.id = ?`, [event.project_id ?? null, event.host_user_id]);
      const r = rows[0] || {};
      return {
        host: rows.length ? { name: r.host_name ?? null, role: r.host_role ?? null } : null,
        venture: event.project_id == null ? null : { name: r.venture_name ?? null },
      };
    }),
    block('The registrations', async () => {
      const counts = { ...zeroes(REGISTRATION_STATUSES), other: 0 };
      for (const r of await regs()) {
        if ((REGISTRATION_STATUSES as readonly string[]).includes(r.status)) counts[r.status as (typeof REGISTRATION_STATUSES)[number]]++;
        else counts.other++;
      }
      const seats = counts.registered + counts.confirmed + counts.attended;
      const ended = event.status !== 'cancelled' && hasEnded(event, now);
      return {
        by_status: counts,
        seats_taken: seats,
        capacity: event.capacity != null ? Number(event.capacity) : null,
        ended,
        show_up: ended && seats > 0 ? round2(counts.attended / seats) : null,
      };
    }),
    block('How seats were got', async () => {
      const counts = zeroes(['invitation', 'free_seat', 'signed_up'] as const);
      for (const r of await seated()) counts[seatSource(r)]++;
      return { counts, added_by_admin: ADDED_BY_ADMIN };
    }),
    block('Who registered', async () => {
      const counts = { ...zeroes(ROLES), guest: 0, not_recorded: 0 };
      for (const r of await seated()) counts[roleOf(r) as keyof typeof counts]++;
      return { counts };
    }),
    block('The payments', async () => {
      const rows = await regs();
      const by_payment_status = { ...zeroes(PAYMENT_STATUSES), not_recorded: 0, other: 0 };
      for (const r of rows) {
        if (r.payment_status == null || r.payment_status === '') by_payment_status.not_recorded++;
        else if ((PAYMENT_STATUSES as readonly string[]).includes(r.payment_status)) by_payment_status[r.payment_status as (typeof PAYMENT_STATUSES)[number]]++;
        else by_payment_status.other++;
      }
      return {
        price_cents: Number(event.price_cents || 0),
        currency: event.currency ?? null,
        by_payment_status,
        paid: paidByCurrency(rows.filter((r) => r.payment_status === 'paid').map((r) => ({ ...r, currency: event.currency }))),
        payment_pending: rows.filter((r) => r.payment_status === 'pending' && r.status !== 'cancelled' && r.status !== 'declined').length,
        refunds: { recorded: false, reason: 'A refunded ticket is not marked here. HQ refunds a ticket’s payment in Revenue › Billing.' } as NotRecorded,
      };
    }),
    block('The free seats', async () => ({ count: (await seated()).filter((r) => Number(r.comp) === 1).length })),
    block('The check-ins', async () => {
      const rows = await all(env, `SELECT COUNT(*) AS n FROM event_checkins WHERE event_id = ?`, [id]);
      return { count: Number(rows[0]?.n || 0) };
    }),
    block('The invitations', async () => {
      const rows = await all(env, `SELECT status, source, comp FROM event_invitations WHERE event_id = ?`, [id]);
      const by_status = { ...zeroes(['pending', 'accepted', 'declined', 'revoked'] as const), other: 0 };
      const by_source = { ...zeroes(['manual', 'auto_partner', 'auto_lp'] as const), other: 0 };
      for (const r of rows) {
        if (r.status in by_status && r.status !== 'other') by_status[r.status as keyof typeof by_status]++; else by_status.other++;
        if (r.source in by_source && r.source !== 'other') by_source[r.source as keyof typeof by_source]++; else by_source.other++;
      }
      return { total: rows.length, free_seat: rows.filter((r) => Number(r.comp) === 1).length, by_status, by_source };
    }),
    block('The reminders', async () => {
      const rows = await all(env, `SELECT kind, COUNT(*) AS n FROM event_notifications WHERE event_id = ? GROUP BY kind`, [id]);
      const by_kind = { ...zeroes(['reminder_24h', 'reminder_1h'] as const), other: 0 };
      for (const r of rows) {
        if (r.kind === 'reminder_24h' || r.kind === 'reminder_1h') by_kind[r.kind as 'reminder_24h' | 'reminder_1h'] += Number(r.n);
        else by_kind.other += Number(r.n);
      }
      return { sent: by_kind.reminder_24h + by_kind.reminder_1h + by_kind.other, by_kind };
    }),
    block('Seats taken by day', async () => {
      // By the date each current seat holder registered: cancel and promotion dates are not stored.
      const by = new Map<string, number>();
      let undated = 0;
      for (const r of await seated()) {
        const at = timestamp(r.registered_at);
        if (!Number.isFinite(at)) { undated++; continue; }
        const day = isoDay(at);
        by.set(day, (by.get(day) || 0) + 1);
      }
      let running = 0;
      const days = [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, seats]) => ({ day, seats, total: (running += seats) }));
      return { days, registered_at_not_recorded: undated, counted_by: 'registered_at' };
    }),
  ]);

  return { event_id: id, host, registrations, by_source, by_role, payments, free_seats, checkins, invitations, reminders, seats_by_day };
}

// ── GET /:id/history ───────────────────────────────────────────────────────

/**
 * The event's admin actions, plus the host's submissions and edits. Actors read
 * as `admin` or `host`, never a name. A send-back carries its reason.
 */
export async function readEventHistory(env: Env, event: any) {
  const id = Number(event.id);
  return block('The history', async () => {
    const rows = await all(env,
      `SELECT id, admin_user_id, action, report_type, filters_json, exported_at
         FROM admin_audit_log
        WHERE json_extract(filters_json, '$.event_id') = ?
          AND ((report_type = 'events' AND action IN ('event_approved','event_rejected','event_unpublished','event_featured','event_cancelled','event_capacity_override'))
               OR action IN ('event_submitted', 'event_updated'))
        ORDER BY exported_at, id`, [id]);
    const items = rows.map((r) => {
      let details: any = {};
      try { details = JSON.parse(r.filters_json || '{}') || {}; } catch { details = {}; }
      const byHost = event.host_user_id != null && Number(r.admin_user_id) === Number(event.host_user_id);
      // The desk's own actions are an admin's; a submission or an edit is the host's unless an admin made it.
      const actor = r.report_type !== 'events' && byHost ? 'host' : 'admin';
      const item: Record<string, unknown> = { at: r.exported_at, action: r.action, actor };
      if (r.action === 'event_rejected') item.reason = typeof details.reason === 'string' ? details.reason : null;
      if (r.action === 'event_featured') item.featured = details.featured === true;
      if (r.action === 'event_capacity_override') item.capacity = details.capacity ?? null;
      if (r.action === 'event_updated') item.fields = Array.isArray(details.fields) ? details.fields.filter((f: unknown) => typeof f === 'string') : [];
      return item;
    });
    return {
      created_at: event.created_at ?? null,
      submitted_at: event.submitted_at ?? null,
      approved_at: event.approved_at ?? null,
      changed_after_approval_at: event.changed_after_approval_at ?? null,
      items,
    };
  });
}

// ── GET /:id/comp-preview ──────────────────────────────────────────────────

/**
 * A dry run of what approve would invite: the two sources approve mints
 * (official partners, invested LPs), minus anyone already invited. Mints
 * nothing. The other three flags give a seat at sign-up and invite no one.
 */
export async function readCompPreview(env: Env, event: any) {
  const id = Number(event.id);
  const rules = parseAudienceRules(event.audience_rules_json);
  const sources = await block('The free-seat audience', async () => {
    const invited = await all(env, `SELECT invited_user_id, invited_email FROM event_invitations WHERE event_id = ?`, [id]);
    const users = new Set(invited.filter((r) => r.invited_user_id != null).map((r) => Number(r.invited_user_id)));
    const emails = new Set(invited.filter((r) => r.invited_email).map((r) => String(r.invited_email).toLowerCase()));
    const principals = await evaluateCompEligibility(env, {
      comp_official_partners: !!rules.comp_official_partners,
      comp_invested_lps: !!rules.comp_invested_lps,
    }, event.host_user_id ?? null, { strict: true });
    const tally = (on: boolean, source: 'auto_partner' | 'auto_lp') => {
      if (!on) return { on: false, eligible: null, already_invited: null, would_invite: null };
      const set = principals.filter((p) => p.source === source && (p.user_id != null || p.email));
      const already = set.filter((p) => (p.user_id != null && users.has(Number(p.user_id))) || (p.email && emails.has(p.email.toLowerCase()))).length;
      return { on: true, eligible: set.length, already_invited: already, would_invite: set.length - already };
    };
    return {
      official_partners: tally(!!rules.comp_official_partners, 'auto_partner'),
      invested_lps: tally(!!rules.comp_invested_lps, 'auto_lp'),
    };
  });
  return {
    event_id: id,
    sources,
    seat_at_sign_up: (['comp_investors', 'comp_project_founders', 'comp_host_connections'] as const).filter((k) => !!rules[k]),
    minted: 0,
  };
}
