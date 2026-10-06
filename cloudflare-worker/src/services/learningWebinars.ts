/**
 * D560 (#1161) — Learning webinars: the shape a member sees, the join window,
 * and the recording link. Shared by `routes/learning_webinars.ts` (members)
 * and `routes/admin_learning_webinars.ts` (the Super Admin).
 *
 * THE JOIN LINK IS GATED HERE, NOWHERE ELSE. `memberWebinar` puts `join_url`
 * in a payload only when the caller is registered, the webinar is published,
 * and `now` is inside `joinWindowOpen`. Lists never carry it.
 *
 * NULL IS NOT RECORDED. No capacity is "no limit set" (`capacity: null`), not
 * zero seats; a past webinar with no recording says so in words.
 */
import type { Env } from '../types';

/** The link opens this long before the start, and closes at the end. */
export const JOIN_LEAD_MS = 15 * 60 * 1000;

export const WEBINAR_STATUSES = ['draft', 'published', 'cancelled'] as const;

export const WEBINAR_COLS = 'id, uid, title, abstract, host_name, starts_at, ends_at, timezone, join_url, capacity, '
  + 'recording_item_uid, visibility, status, created_by, created_at, updated_at, published_at';

export type WebinarRow = {
  id: number; uid: string; title: string; abstract: string | null; host_name: string | null;
  starts_at: string | null; ends_at: string | null; timezone: string | null; join_url: string | null;
  capacity: number | null; recording_item_uid: string | null; visibility: string; status: string;
  created_at: string; updated_at: string; published_at: string | null;
};

const ms = (iso: string | null | undefined) => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

/** Whether the join link may be served at `now`: from 15 minutes before the start until the end. */
export function joinWindowOpen(w: { starts_at: string | null; ends_at: string | null }, now: number): boolean {
  const start = ms(w.starts_at);
  const end = ms(w.ends_at);
  if (start === null || end === null) return false;
  return now >= start - JOIN_LEAD_MS && now < end;
}

/** upcoming, live or past, by the clock; null when the times are not recorded. */
export function webinarPhase(w: { starts_at: string | null; ends_at: string | null }, now: number): 'upcoming' | 'live' | 'past' | null {
  const start = ms(w.starts_at);
  const end = ms(w.ends_at);
  if (start === null || end === null) return null;
  if (now >= end) return 'past';
  return now >= start ? 'live' : 'upcoming';
}

export async function registeredCounts(env: Env, ids: number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (!ids.length) return out;
  const placeholders = ids.map(() => '?').join(', ');
  const res = await env.DB.prepare(
    `SELECT webinar_id, COUNT(*) AS n FROM learning_webinar_registrations WHERE webinar_id IN (${placeholders}) GROUP BY webinar_id`,
  ).bind(...ids).all<{ webinar_id: number; n: number }>();
  for (const r of res.results || []) out.set(Number(r.webinar_id), Number(r.n));
  return out;
}

/**
 * The recording, as a member sees it. A past webinar with none, or whose item
 * is not a published video, says "Recording not available" rather than
 * linking to something the member cannot open.
 */
export async function recordingOf(env: Env, w: WebinarRow) {
  if (!w.recording_item_uid) return { available: false as const, reason: 'Recording not available' };
  const item = await env.DB.prepare(`SELECT uid, kind, status, visibility FROM learning_items WHERE uid = ?`)
    .bind(w.recording_item_uid).first<{ uid: string; kind: string; status: string; visibility: string }>();
  if (!item || item.kind !== 'video' || item.status !== 'published') {
    return { available: false as const, reason: 'Recording not available' };
  }
  return { available: true as const, item_uid: item.uid, href: `/learning/videos/${item.uid}` };
}

/**
 * A webinar for a member. `join_url` is included only for a registered member
 * of a published webinar inside the join window; otherwise it is null, and
 * `join` says why.
 */
export function memberWebinar(w: WebinarRow, opts: { registeredCount: number; registered: boolean; now: number }) {
  const open = w.status === 'published' && opts.registered && joinWindowOpen(w, opts.now);
  const join = w.status !== 'published' ? 'cancelled'
    : !opts.registered ? 'not_registered'
    : open ? 'open'
    : webinarPhase(w, opts.now) === 'past' ? 'ended' : 'not_yet';
  return {
    uid: w.uid, title: w.title, abstract: w.abstract ?? null, host_name: w.host_name ?? null,
    starts_at: w.starts_at, ends_at: w.ends_at, timezone: w.timezone ?? null,
    capacity: w.capacity ?? null, registered_count: opts.registeredCount,
    seats_left: w.capacity == null ? null : Math.max(0, Number(w.capacity) - opts.registeredCount),
    status: w.status, phase: webinarPhase(w, opts.now),
    recording_item_uid: w.recording_item_uid ?? null,
    join_url: open ? w.join_url : null,
    join,
  };
}
