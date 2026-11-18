/**
 * D7120 (#7120): Wellness group sessions, with a seat per member and
 * confidential attendance. Separate from the 1:1 booking flow
 * (`/api/wellbeing/experts/:uid/book`), which is unchanged.
 *
 * Members (any signed-in member but an investor-only account):
 *   GET  /api/wellbeing/group-sessions                    upcoming sessions, never who reserved
 *   GET  /api/wellbeing/group-sessions/:uid               one session, with the member's own reservation
 *   POST /api/wellbeing/group-sessions/:uid/reserve       take a seat { calendar?: discreet|named|none }
 *   GET  /api/wellbeing/group-reservations/mine           the member's own reservations, cancelled sessions included
 *   POST /api/wellbeing/group-reservations/:uid/cancel    release the seat, under the session's cancellation rule
 *   GET  /api/wellbeing/group-reservations/:uid/calendar.ics   the member's own calendar entry
 * Facilitators (an approved expert, for their own sessions) and HQ admins:
 *   GET  /api/wellbeing/experts/me/group-sessions         the facilitator's sessions and who reserved
 *   POST /api/wellbeing/experts/me/group-sessions         schedule one
 *   POST /api/wellbeing/group-sessions/:uid/cancel        cancel an occurrence; each member is told on their own
 *
 * Seats never oversell. A reservation is one INSERT ... SELECT whose WHERE
 * counts the reserved seats of that session in the same statement; D1 runs a
 * statement whole, so of two members after the last seat exactly one gets it.
 * A repeated request from the same member returns their seat, never a second.
 * The facilitator's eligibility, the session's status and its start are
 * checked again in that statement and just before it.
 *
 * Confidential attendance. A member sees the seat count, never a name. The
 * calendar entry lists no attendee, and by default is titled "Private
 * appointment" with no description. A cancellation notice goes to each member
 * alone. Only the facilitator, and HQ, see who reserved: name and email, so
 * they can let people in.
 *
 * Free sessions only. A price, refunds and a wait-list are the owner's call
 * (Q4 on #7117); a paid session is refused, and a full session says so.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { requireAuth, requireAdmin } from '../auth';
import { holdsOnlyLicence } from '../services/accountLicences';
import { refuse } from '../util/refusal';
import { notify } from '../services/notify';
import wellbeing from './wellbeing';
import { isTimezone } from '../services/wellbeing/reflectionPeriods';
import { SUPPORT_TYPES, SUPPORT_TYPE_KEYS, type SupportType } from '../services/wellbeing/recommend';

const groupSessions = new Hono<{ Bindings: Env }>();
const groupReservations = new Hono<{ Bindings: Env }>();
const facilitator = new Hono<{ Bindings: Env }>();

const LANG_RE = /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i;
export const CALENDAR_CHOICES = ['discreet', 'named', 'none'] as const;
export const LIMITS = {
  title: [3, 120], description: 2000, duration: [15, 240], capacity: [2, 50], cancellationHours: [0, 168],
  leadMinutes: 60, horizonDays: 365,
} as const;

export const WHAT_FACILITATOR_LEARNS = 'Your name and email, so they can let you in. Nothing from your reflections, choices or other bookings.';
export const WHAT_OTHER_MEMBERS_LEARN = 'Nothing. Members never see who else reserved, and your calendar entry lists no one else.';

/**
 * An expert who may run sessions now is the directory's own bar: active,
 * verified, not hidden, a complete profile, not a sample (`seed_`, the
 * SAMPLE_EXPERT_UID_PREFIX of seedExperts.ts, written out because every query
 * here is a complete literal). The tests pin the prefix.
 */
export const SAMPLE_PREFIX_IN_SQL = 'seed_';

type SessionRow = {
  id: number; uid: string; expert_id: number; support_type: string; title: string; description: string | null;
  language: string; timezone: string; starts_at: string; duration_minutes: number; capacity: number;
  price_cents: number; cancellation_hours: number; status: 'scheduled' | 'cancelled';
  cancelled_at: string | null; cancel_reason: string | null; created_at: string;
  expert_uid: string; expert_name: string; expert_headline: string | null; expert_user_id: number | null;
  expert_eligible: number; reserved: number;
};



const nowIso = () => new Date().toISOString();
const endsAt = (s: { starts_at: string; duration_minutes: number }) =>
  new Date(Date.parse(s.starts_at) + s.duration_minutes * 60_000).toISOString();
const cutoffAt = (s: { starts_at: string; cancellation_hours: number }) =>
  new Date(Date.parse(s.starts_at) - s.cancellation_hours * 3_600_000).toISOString();

/** A session as a member reads it: seats as a number, never a name. */
export function memberSession(s: SessionRow, mine: { uid: string; status: string; calendar: string } | null = null) {
  const seatsLeft = Math.max(0, Number(s.capacity) - Number(s.reserved));
  const started = Date.parse(s.starts_at) <= Date.now();
  const type = SUPPORT_TYPES[s.support_type as SupportType];
  let state: 'open' | 'full' | 'cancelled' | 'started' | 'facilitator_unavailable' = 'open';
  if (s.status === 'cancelled') state = 'cancelled';
  else if (started) state = 'started';
  else if (!Number(s.expert_eligible)) state = 'facilitator_unavailable';
  else if (seatsLeft === 0) state = 'full';
  return {
    kind: 'session' as const,
    uid: s.uid, title: s.title, description: s.description,
    support_type: { key: s.support_type, label: type?.label ?? s.support_type },
    facilitator: { uid: s.expert_uid, name: s.expert_name, headline: s.expert_headline },
    format: 'group' as const,
    language: s.language, timezone: s.timezone,
    starts_at: s.starts_at, ends_at: endsAt(s), duration_minutes: Number(s.duration_minutes),
    price_cents: 0, free: true,
    capacity: Number(s.capacity), seats_left: seatsLeft,
    state, bookable: state === 'open' && !(mine && mine.status === 'reserved'),
    cancelled: s.status === 'cancelled' ? { at: s.cancelled_at, reason: s.cancel_reason } : null,
    cancellation: {
      hours: Number(s.cancellation_hours), cutoff_at: cutoffAt(s),
      rule: Number(s.cancellation_hours)
        ? `You can cancel until ${Number(s.cancellation_hours)} hours before it starts. It is free, so there is nothing to refund.`
        : 'You can cancel until it starts. It is free, so there is nothing to refund.',
    },
    what_facilitator_learns: WHAT_FACILITATOR_LEARNS,
    what_other_members_learn: WHAT_OTHER_MEMBERS_LEARN,
    my_reservation: mine,
  };
}

async function member(c: any) {
  const user = await requireAuth(c);
  if (holdsOnlyLicence(user, 'investor')) {
    return refuse(c, 403, { code: 'not_available_for_investors', message: 'Wellness is not available for investor accounts.' });
  }
  return user;
}

async function sessionByUid(env: Env, uid: string) {
  return env.DB.prepare(`SELECT s.*, e.uid AS expert_uid, e.name AS expert_name, e.headline AS expert_headline, e.user_id AS expert_user_id,
         CASE WHEN e.is_active = 1 AND e.verified = 1 AND COALESCE(e.hidden_by_admin, 0) = 0
         AND COALESCE(e.profile_completion_pct, 0) >= 70 AND substr(e.uid, 1, 5) <> 'seed_' THEN 1 ELSE 0 END AS expert_eligible,
         (SELECT COUNT(*) FROM wellbeing_group_reservations r WHERE r.session_id = s.id AND r.status = 'reserved') AS reserved
    FROM wellbeing_group_sessions s JOIN experts e ON e.id = s.expert_id WHERE s.uid = ?`).bind(uid).first<SessionRow>();
}

async function myReservation(env: Env, sessionId: number, userId: number) {
  return env.DB.prepare(
    'SELECT uid, status, calendar FROM wellbeing_group_reservations WHERE session_id = ? AND user_id = ?',
  ).bind(sessionId, userId).first<{ uid: string; status: string; calendar: string }>();
}

/** Upcoming sessions a member may see: scheduled, not started, run by an eligible facilitator. */
export async function upcomingSessions(env: Env, filters: { support_types?: string[]; language?: string | null } = {}) {
  const rs = await env.DB.prepare(
    `SELECT s.*, e.uid AS expert_uid, e.name AS expert_name, e.headline AS expert_headline, e.user_id AS expert_user_id,
         CASE WHEN e.is_active = 1 AND e.verified = 1 AND COALESCE(e.hidden_by_admin, 0) = 0
         AND COALESCE(e.profile_completion_pct, 0) >= 70 AND substr(e.uid, 1, 5) <> 'seed_' THEN 1 ELSE 0 END AS expert_eligible,
         (SELECT COUNT(*) FROM wellbeing_group_reservations r WHERE r.session_id = s.id AND r.status = 'reserved') AS reserved
    FROM wellbeing_group_sessions s JOIN experts e ON e.id = s.expert_id
      WHERE s.status = 'scheduled' AND datetime(s.starts_at) > datetime(?) AND e.is_active = 1 AND e.verified = 1 AND COALESCE(e.hidden_by_admin, 0) = 0
         AND COALESCE(e.profile_completion_pct, 0) >= 70 AND substr(e.uid, 1, 5) <> 'seed_'
      ORDER BY s.starts_at ASC LIMIT 100`,
  ).bind(nowIso()).all<SessionRow>();
  return (rs.results || []).filter((s) =>
    (!filters.support_types?.length || filters.support_types.includes(s.support_type))
    && (!filters.language || s.language.toLowerCase() === filters.language.toLowerCase()));
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

groupSessions.get('/', async (c) => {
  const user = await member(c);
  if (user instanceof Response) return user;
  const type = c.req.query('support_type');
  if (type && !(SUPPORT_TYPE_KEYS as string[]).includes(type)) return refuse(c, 400, { code: 'invalid_support_type', message: 'Unknown kind of support.' });
  try {
    const rows = await upcomingSessions(c.env, { support_types: type ? [type] : [], language: c.req.query('language') || null });
    return c.json({ sessions: rows.map((s) => memberSession(s)) });
  } catch (e) {
    return refuse(c, 503, { code: 'group_sessions_unreadable', message: 'Group sessions could not be read. This is not a claim that there are none.', raw: e });
  }
});

groupSessions.get('/:uid', async (c) => {
  const user = await member(c);
  if (user instanceof Response) return user;
  const s = await sessionByUid(c.env, c.req.param('uid'));
  if (!s) return refuse(c, 404, { code: 'group_session_not_found', message: 'No such session.' });
  const mine = await myReservation(c.env, s.id, user.id);
  // A cancelled or past session is shown only to a member who reserved it.
  if ((s.status === 'cancelled' || !Number(s.expert_eligible)) && !mine) {
    return refuse(c, 404, { code: 'group_session_not_found', message: 'No such session.' });
  }
  return c.json(memberSession(s, mine ?? null));
});

groupSessions.post('/:uid/reserve', async (c) => {
  const user = await member(c);
  if (user instanceof Response) return user;
  const body = await c.req.json().catch(() => ({})) as any;
  const calendar = body?.calendar ?? 'discreet';
  if (!(CALENDAR_CHOICES as readonly string[]).includes(calendar)) {
    return refuse(c, 400, { code: 'invalid_calendar', message: 'calendar is discreet, named or none.' });
  }
  const s = await sessionByUid(c.env, c.req.param('uid'));
  if (!s) return refuse(c, 404, { code: 'group_session_not_found', message: 'No such session.' });
  const existing = await myReservation(c.env, s.id, user.id);
  if (existing?.status === 'reserved') return c.json({ ...memberSession(s, existing), already_reserved: true });
  if (s.status === 'cancelled') return refuse(c, 409, { code: 'session_cancelled', message: 'This session was cancelled by its facilitator.' });
  if (Date.parse(s.starts_at) <= Date.now()) return refuse(c, 409, { code: 'session_started', message: 'This session has already started.' });
  if (!Number(s.expert_eligible)) return refuse(c, 409, { code: 'facilitator_unavailable', message: 'This session’s facilitator is not taking bookings now.' });

  const uid = crypto.randomUUID().replace(/-/g, '');
  const res = await c.env.DB.prepare(
    `INSERT INTO wellbeing_group_reservations (uid, session_id, user_id, status, calendar, reserved_at)
     SELECT ?, s.id, ?, 'reserved', ?, datetime('now')
       FROM wellbeing_group_sessions s JOIN experts e ON e.id = s.expert_id
      WHERE s.id = ? AND s.status = 'scheduled' AND datetime(s.starts_at) > datetime(?) AND e.is_active = 1 AND e.verified = 1 AND COALESCE(e.hidden_by_admin, 0) = 0
         AND COALESCE(e.profile_completion_pct, 0) >= 70 AND substr(e.uid, 1, 5) <> 'seed_'
        AND (SELECT COUNT(*) FROM wellbeing_group_reservations r
              WHERE r.session_id = s.id AND r.status = 'reserved') < s.capacity
     ON CONFLICT (session_id, user_id) DO UPDATE
        SET status = 'reserved', calendar = excluded.calendar, reserved_at = excluded.reserved_at, cancelled_at = NULL
      WHERE wellbeing_group_reservations.status = 'cancelled'`,
  ).bind(uid, user.id, calendar, s.id, nowIso()).run();
  const mine = await myReservation(c.env, s.id, user.id);
  const fresh = await sessionByUid(c.env, s.uid);
  if (!Number(res?.meta?.changes ?? 0)) {
    if (mine?.status === 'reserved') return c.json({ ...memberSession(fresh!, mine), already_reserved: true });
    return refuse(c, 409, {
      code: 'session_full', message: 'The last seat was just taken. Nothing was reserved.',
      extra: { seats_left: 0 },
    });
  }
  // Each side is told on its own; neither notice names another member.
  await notify(c.env, {
    userId: user.id, type: 'wellbeing_group_reserved', title: 'Your seat is reserved',
    body: `${s.title}, ${new Date(s.starts_at).toUTCString()}.`, link: '/wellbeing',
  });
  if (s.expert_user_id) {
    await notify(c.env, {
      userId: s.expert_user_id, type: 'wellbeing_group_reservation', title: 'A seat was reserved',
      body: `${s.title}: ${Number(fresh!.reserved)} of ${s.capacity} seats reserved.`, link: '/wellbeing/expert-dashboard',
    });
  }
  return c.json({ ...memberSession(fresh!, mine!), reserved: true }, 201);
});

/** A facilitator cancels their own occurrence, or HQ does. Each member is told alone. */
groupSessions.post('/:uid/cancel', async (c) => {
  const user = await requireAuth(c);
  const s = await sessionByUid(c.env, c.req.param('uid'));
  const notFound = () => refuse(c, 404, { code: 'group_session_not_found', message: 'No such session.' });
  if (!s) return notFound();
  if (s.expert_user_id !== user.id) {
    try { await requireAdmin(c); } catch { return notFound(); }
  }
  const body = await c.req.json().catch(() => ({})) as any;
  const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
  if (!reason) return refuse(c, 400, { code: 'reason_required', message: 'Say why, in a sentence members will read.' });
  const res = await c.env.DB.prepare(
    `UPDATE wellbeing_group_sessions SET status = 'cancelled', cancelled_at = ?, cancel_reason = ?, updated_at = datetime('now')
      WHERE id = ? AND status = 'scheduled'`,
  ).bind(nowIso(), reason, s.id).run();
  if (!Number(res?.meta?.changes ?? 0)) return refuse(c, 409, { code: 'session_cancelled', message: 'This session is already cancelled.' });
  const members = await c.env.DB.prepare(
    `SELECT user_id FROM wellbeing_group_reservations WHERE session_id = ? AND status = 'reserved'`,
  ).bind(s.id).all<{ user_id: number }>();
  for (const m of members.results || []) {
    await notify(c.env, {
      userId: m.user_id, type: 'wellbeing_group_cancelled', title: 'A session you reserved was cancelled',
      body: `${s.title}, ${new Date(s.starts_at).toUTCString()}. ${reason}`, link: '/wellbeing',
    });
  }
  return c.json({ ...memberSession((await sessionByUid(c.env, s.uid))!), told: (members.results || []).length });
});

groupReservations.get('/mine', async (c) => {
  const user = await member(c);
  if (user instanceof Response) return user;
  try {
    const rs = await c.env.DB.prepare(
      `SELECT r.uid AS r_uid, r.status AS r_status, r.calendar AS r_calendar, r.reserved_at, r.cancelled_at AS r_cancelled_at, s2.*
         FROM wellbeing_group_reservations r
         JOIN (SELECT s.*, e.uid AS expert_uid, e.name AS expert_name, e.headline AS expert_headline, e.user_id AS expert_user_id,
         CASE WHEN e.is_active = 1 AND e.verified = 1 AND COALESCE(e.hidden_by_admin, 0) = 0
         AND COALESCE(e.profile_completion_pct, 0) >= 70 AND substr(e.uid, 1, 5) <> 'seed_' THEN 1 ELSE 0 END AS expert_eligible,
         (SELECT COUNT(*) FROM wellbeing_group_reservations r WHERE r.session_id = s.id AND r.status = 'reserved') AS reserved
    FROM wellbeing_group_sessions s JOIN experts e ON e.id = s.expert_id) s2 ON s2.id = r.session_id
        WHERE r.user_id = ?
        ORDER BY s2.starts_at DESC LIMIT 100`,
    ).bind(user.id).all<any>();
    return c.json({
      reservations: (rs.results || []).map((r: any) => ({
        uid: r.r_uid, status: r.r_status, calendar: r.r_calendar, reserved_at: r.reserved_at, cancelled_at: r.r_cancelled_at,
        session: memberSession(r, { uid: r.r_uid, status: r.r_status, calendar: r.r_calendar }),
      })),
    });
  } catch (e) {
    return refuse(c, 503, { code: 'reservations_unreadable', message: 'Your reservations could not be read. This is not a claim that you have none.', raw: e });
  }
});

groupReservations.post('/:uid/cancel', async (c) => {
  const user = await member(c);
  if (user instanceof Response) return user;
  const r = await c.env.DB.prepare(
    'SELECT id, session_id, status FROM wellbeing_group_reservations WHERE uid = ? AND user_id = ?',
  ).bind(c.req.param('uid'), user.id).first<{ id: number; session_id: number; status: string }>();
  if (!r) return refuse(c, 404, { code: 'reservation_not_found', message: 'No reservation of yours has that id.' });
  if (r.status !== 'reserved') return refuse(c, 409, { code: 'reservation_not_open', message: 'This reservation is already cancelled.' });
  const s = await c.env.DB.prepare(`SELECT s.*, e.uid AS expert_uid, e.name AS expert_name, e.headline AS expert_headline, e.user_id AS expert_user_id,
         CASE WHEN e.is_active = 1 AND e.verified = 1 AND COALESCE(e.hidden_by_admin, 0) = 0
         AND COALESCE(e.profile_completion_pct, 0) >= 70 AND substr(e.uid, 1, 5) <> 'seed_' THEN 1 ELSE 0 END AS expert_eligible,
         (SELECT COUNT(*) FROM wellbeing_group_reservations r WHERE r.session_id = s.id AND r.status = 'reserved') AS reserved
    FROM wellbeing_group_sessions s JOIN experts e ON e.id = s.expert_id WHERE s.id = ?`).bind(r.session_id).first<SessionRow>();
  if (!s) return refuse(c, 404, { code: 'reservation_not_found', message: 'No reservation of yours has that id.' });
  if (s.status === 'cancelled') return refuse(c, 409, { code: 'session_cancelled', message: 'The facilitator cancelled this session; there is nothing to cancel.' });
  if (Date.parse(s.starts_at) <= Date.now()) return refuse(c, 409, { code: 'session_started', message: 'This session has already started.' });
  if (Date.now() > Date.parse(cutoffAt(s))) {
    return refuse(c, 409, {
      code: 'cancellation_window_closed',
      message: `Cancelling closed ${Number(s.cancellation_hours)} hours before the start. Tell the facilitator if you cannot come.`,
      extra: { cutoff_at: cutoffAt(s) },
    });
  }
  const res = await c.env.DB.prepare(
    `UPDATE wellbeing_group_reservations SET status = 'cancelled', cancelled_at = datetime('now') WHERE id = ? AND status = 'reserved'`,
  ).bind(r.id).run();
  if (!Number(res?.meta?.changes ?? 0)) return refuse(c, 409, { code: 'reservation_not_open', message: 'This reservation is already cancelled.' });
  return c.json({ status: 'cancelled', seat_released: true, refund: { applicable: false, reason: 'This session is free.' } });
});

const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsTime = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** The member's own calendar entry. No attendee is ever listed; "discreet" also hides the title. */
export function reservationIcs(s: { uid: string; title: string; starts_at: string; duration_minutes: number; status: string }, calendar: string) {
  const named = calendar === 'named';
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Axal VC//Wellness//EN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    `UID:${s.uid}@wellness.axal.vc`,
    `DTSTAMP:${icsTime(new Date().toISOString())}`,
    `DTSTART:${icsTime(new Date(s.starts_at).toISOString())}`,
    `DTEND:${icsTime(endsAt(s))}`,
    `SUMMARY:${icsText(named ? `Axal · ${s.title}` : 'Private appointment')}`,
    ...(s.status === 'cancelled' ? ['STATUS:CANCELLED'] : []),
    'CLASS:PRIVATE', 'TRANSP:OPAQUE', 'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
}

groupReservations.get('/:uid/calendar.ics', async (c) => {
  const user = await member(c);
  if (user instanceof Response) return user;
  const r = await c.env.DB.prepare(
    `SELECT r.calendar, r.status AS r_status, s.uid, s.title, s.starts_at, s.duration_minutes, s.status
       FROM wellbeing_group_reservations r JOIN wellbeing_group_sessions s ON s.id = r.session_id
      WHERE r.uid = ? AND r.user_id = ?`,
  ).bind(c.req.param('uid'), user.id).first<any>();
  if (!r || r.r_status !== 'reserved' || r.calendar === 'none') {
    return refuse(c, 404, { code: 'calendar_entry_not_found', message: 'There is no calendar entry for this reservation.' });
  }
  return new Response(reservationIcs(r, r.calendar), {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="appointment.ics"',
      'Cache-Control': 'no-store',
    },
  });
});

// ---------------------------------------------------------------------------
// Facilitators
// ---------------------------------------------------------------------------

async function myExpert(env: Env, userId: number) {
  return env.DB.prepare(
    `SELECT e.id, e.uid, e.categories_json, CASE WHEN e.is_active = 1 AND e.verified = 1 AND COALESCE(e.hidden_by_admin, 0) = 0
         AND COALESCE(e.profile_completion_pct, 0) >= 70 AND substr(e.uid, 1, 5) <> 'seed_' THEN 1 ELSE 0 END AS eligible FROM experts e WHERE e.user_id = ?`,
  ).bind(userId).first<{ id: number; uid: string; categories_json: string; eligible: number }>();
}

/** A checked new session, or the first problem as a code. */
export function sessionDraft(body: any, expertCategories: string[], now = Date.now()):
  | { ok: true; v: { support_type: SupportType; title: string; description: string | null; language: string; timezone: string; starts_at: string; duration_minutes: number; capacity: number; cancellation_hours: number } }
  | { ok: false; code: string; message: string } {
  const b = body && typeof body === 'object' ? body : {};
  if (b.price_cents != null && b.price_cents !== 0) {
    return { ok: false, code: 'paid_groups_not_open', message: 'Group sessions are free for now. Paid groups and refunds wait on an owner decision.' };
  }
  if (!(SUPPORT_TYPE_KEYS as string[]).includes(b.support_type)) return { ok: false, code: 'invalid_support_type', message: 'Choose the kind of support this session gives.' };
  if (!SUPPORT_TYPES[b.support_type as SupportType].categories.some((c) => expertCategories.includes(c))) {
    return { ok: false, code: 'support_type_outside_practice', message: 'A session must be within the kinds of support your profile lists.' };
  }
  const title = typeof b.title === 'string' ? b.title.trim() : '';
  if (title.length < LIMITS.title[0] || title.length > LIMITS.title[1]) return { ok: false, code: 'invalid_title', message: `A title is ${LIMITS.title[0]} to ${LIMITS.title[1]} characters.` };
  const description = typeof b.description === 'string' && b.description.trim() ? b.description.trim() : null;
  if (description && description.length > LIMITS.description) return { ok: false, code: 'invalid_description', message: `A description is at most ${LIMITS.description} characters.` };
  if (typeof b.language !== 'string' || !LANG_RE.test(b.language)) return { ok: false, code: 'invalid_language', message: 'language is a code such as en or fr.' };
  if (!isTimezone(b.timezone)) return { ok: false, code: 'invalid_timezone', message: 'timezone is an IANA zone, e.g. Europe/Paris.' };
  const start = typeof b.starts_at === 'string' ? Date.parse(b.starts_at) : NaN;
  if (!Number.isFinite(start)) return { ok: false, code: 'invalid_starts_at', message: 'starts_at is a date and time with its offset.' };
  if (start < now + LIMITS.leadMinutes * 60_000 || start > now + LIMITS.horizonDays * 86_400_000) {
    return { ok: false, code: 'invalid_starts_at', message: `A session starts at least ${LIMITS.leadMinutes} minutes and at most ${LIMITS.horizonDays} days from now.` };
  }
  const int = (v: unknown, [lo, hi]: readonly [number, number]) => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
  if (!int(b.duration_minutes, LIMITS.duration)) return { ok: false, code: 'invalid_duration', message: `A session lasts ${LIMITS.duration[0]} to ${LIMITS.duration[1]} minutes.` };
  if (!int(b.capacity, LIMITS.capacity)) return { ok: false, code: 'invalid_capacity', message: `A group has ${LIMITS.capacity[0]} to ${LIMITS.capacity[1]} seats.` };
  const hours = b.cancellation_hours == null ? 24 : b.cancellation_hours;
  if (!int(hours, LIMITS.cancellationHours)) return { ok: false, code: 'invalid_cancellation_hours', message: `Members may cancel up to 0 to ${LIMITS.cancellationHours[1]} hours before.` };
  return {
    ok: true,
    v: {
      support_type: b.support_type, title, description, language: b.language.toLowerCase(), timezone: b.timezone,
      starts_at: new Date(start).toISOString(), duration_minutes: b.duration_minutes, capacity: b.capacity, cancellation_hours: hours,
    },
  };
}

facilitator.get('/', async (c) => {
  const user = await requireAuth(c);
  const me = await myExpert(c.env, user.id);
  if (!me) return refuse(c, 404, { code: 'not_an_expert', message: 'You have no expert profile.' });
  const rs = await c.env.DB.prepare(`SELECT s.*, e.uid AS expert_uid, e.name AS expert_name, e.headline AS expert_headline, e.user_id AS expert_user_id,
         CASE WHEN e.is_active = 1 AND e.verified = 1 AND COALESCE(e.hidden_by_admin, 0) = 0
         AND COALESCE(e.profile_completion_pct, 0) >= 70 AND substr(e.uid, 1, 5) <> 'seed_' THEN 1 ELSE 0 END AS expert_eligible,
         (SELECT COUNT(*) FROM wellbeing_group_reservations r WHERE r.session_id = s.id AND r.status = 'reserved') AS reserved
    FROM wellbeing_group_sessions s JOIN experts e ON e.id = s.expert_id WHERE s.expert_id = ? ORDER BY s.starts_at DESC LIMIT 100`).bind(me.id).all<SessionRow>();
  const sessions = rs.results || [];
  const att = sessions.length ? await c.env.DB.prepare(
    `SELECT r.session_id, u.name, u.email, r.reserved_at FROM wellbeing_group_reservations r JOIN users u ON u.id = r.user_id
      WHERE r.status = 'reserved' AND r.session_id IN (SELECT value FROM json_each(?)) ORDER BY r.reserved_at`,
  ).bind(JSON.stringify(sessions.map((s) => s.id))).all<any>() : { results: [] };
  return c.json({
    eligible: !!me.eligible,
    sessions: sessions.map((s) => ({
      ...memberSession(s),
      attendees: (att.results || []).filter((a: any) => a.session_id === s.id).map((a: any) => ({ name: a.name ?? null, email: a.email ?? null, reserved_at: a.reserved_at })),
    })),
  });
});

facilitator.post('/', async (c) => {
  const user = await requireAuth(c);
  const me = await myExpert(c.env, user.id);
  if (!me) return refuse(c, 404, { code: 'not_an_expert', message: 'You have no expert profile.' });
  if (!me.eligible) return refuse(c, 403, { code: 'expert_not_approved', message: 'Only an approved, listed expert can schedule group sessions.' });
  let cats: string[] = [];
  try { cats = JSON.parse(me.categories_json || '[]'); } catch { cats = []; }
  const d = sessionDraft(await c.req.json().catch(() => null), cats);
  if (!d.ok) return refuse(c, 400, { code: d.code, message: d.message });
  const uid = crypto.randomUUID().replace(/-/g, '');
  const v = d.v;
  await c.env.DB.prepare(
    `INSERT INTO wellbeing_group_sessions
       (uid, expert_id, support_type, title, description, language, timezone, starts_at, duration_minutes, capacity,
        price_cents, cancellation_hours, status, created_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'scheduled', ?)`,
  ).bind(uid, me.id, v.support_type, v.title, v.description, v.language, v.timezone, v.starts_at, v.duration_minutes, v.capacity, v.cancellation_hours, user.id).run();
  return c.json(memberSession((await sessionByUid(c.env, uid))!), 201);
});

export { groupSessions, groupReservations, facilitator };
export default groupSessions;

export const mount: RouteMount[] = [
  { path: '/api/wellbeing/group-sessions', router: groupSessions, before: [wellbeing] },
  { path: '/api/wellbeing/group-reservations', router: groupReservations, before: [wellbeing] },
  { path: '/api/wellbeing/experts/me/group-sessions', router: facilitator, before: [wellbeing] },
];
