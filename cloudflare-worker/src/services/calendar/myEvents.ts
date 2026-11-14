/**
 * D1033 (#2874) — My events in the unified calendar: the member's event
 * tickets and the events they host, as two kinds of `CalendarEvent`, plus the
 * "Add to Google Calendar" and "Outlook" links for one event.
 *
 * A TICKET IS A REGISTRATION ROW. There is no tickets table (#2387): a seat is
 * an `event_registrations` row in `registered`, `confirmed`, `attended` or
 * `waitlisted`. Its calendar id is the registration's id, not the event's, so
 * each member's copy is their own `calendar_sync_records` row and cancelling
 * one place never touches anyone else's copy.
 *
 * EACH PLACE IS MARKED, in the title and the notes, because a calendar client
 * shows no pill: "Waitlist · #3: Pricing Workshop" is the only way a Google
 * calendar can say the seat is not yet held. Going and Checked in carry no mark.
 *
 * THE JOIN LINK FOLLOWS #2623, IN THE FEED TOO. `location_uri` carries the
 * event's `location_url` only when `routes/events.ts`'s `canReadJoinLink` would
 * give it: an admin or the host, an in-person event (its address is not a join
 * link), or a seat that is confirmed or checked in and not waiting on payment
 * (`hasConfirmedEventSeat`). A waitlisted, approval-pending or unpaid ticket
 * gets the place and the event page, never the link.
 *
 * NOBODY IS INVITED. These kinds carry no attendees and no organiser, so a sync
 * to Google or Outlook writes a private copy and sends no invitation — a roster
 * is the host's, and is never copied into anyone's calendar.
 */
import type { Env } from '../../types';
import type { CalendarEvent } from '../calendar';
import { hasConfirmedEventSeat, isInPersonEvent } from '../eventsCommon';

/** The two kinds this file produces, in reading order. */
export const MY_EVENT_KINDS = ['event_ticket', 'event_hosted'] as const;

type Row = Record<string, any>;

function isMissingSchema(e: unknown): boolean {
  const msg = String((e as Error)?.message || e || '').toLowerCase();
  return msg.includes('no such table') || msg.includes('no such column') || msg.includes('does not exist');
}

/** The page every copy links to: the signed-in event page, by id. */
export function eventPageUrl(env: Env, eventId: number): string {
  const e = env as Env & { PUBLIC_BASE_URL?: string };
  const base = String(e.PUBLIC_BASE_URL || e.APP_URL || 'https://axal.vc').replace(/\/+$/, '');
  return `${base}/events/${eventId}`;
}

/**
 * Where the member stands, in the canvas's words (#2387, "Your place at an
 * event"). `null` for a status that is not a place on a calendar.
 */
export function placeOf(reg: { status?: string | null; payment_status?: string | null; waitlist_position?: number | null }):
  { code: 'going' | 'pay_to_confirm' | 'waiting_for_host' | 'waitlisted' | 'checked_in'; words: string; mark: string | null; sentence: string } | null {
  switch (reg.status) {
    case 'attended':
      return { code: 'checked_in', words: 'Checked in', mark: null, sentence: 'Checked in.' };
    case 'waitlisted': {
      const pos = Number(reg.waitlist_position);
      const words = Number.isInteger(pos) && pos > 0 ? `Waitlist · #${pos}` : 'Waitlist';
      return { code: 'waitlisted', words, mark: words, sentence: `${words}: no seat yet. You move up when one frees.` };
    }
    case 'registered':
      return {
        code: 'waiting_for_host', words: 'Waiting for the host', mark: 'Waiting for the host',
        sentence: 'Waiting for the host: the host approves each registration.',
      };
    case 'confirmed':
      if (reg.payment_status === 'pending') {
        return {
          code: 'pay_to_confirm', words: 'Pay to confirm', mark: 'Pay to confirm',
          sentence: 'Pay to confirm: your seat is held until payment settles.',
        };
      }
      return { code: 'going', words: 'Going', mark: null, sentence: 'Going.' };
    default:
      return null;
  }
}

/** A hosted event's status, in the canvas's words. `rejected` reads "Sent back" (D917). */
const HOSTED_WORDS: Record<string, string> = {
  draft: 'Draft',
  pending_review: 'Waiting for review',
  rejected: 'Sent back',
  published: 'Published',
};

/** The calendar's location vocabulary: `video`, `room` or `hybrid`. */
function formatOf(row: Row): string {
  if (isInPersonEvent(row)) return 'room';
  return row.location_kind === 'hybrid' ? 'hybrid' : 'video';
}

/**
 * Whether `user` may see `event`: the same rule as `canViewEvent` in
 * `routes/events.ts`, kept here because importing that route file would pull
 * its ticket checkout (and Stripe) into everything that imports the calendar
 * routes (`fund_modules_no_stripe_d707`). The D1033 tests run both on the same
 * cases and require the same answer.
 */
export async function eventVisibleTo(
  env: Env, event: Row, user: { id: number; role?: string | null; email?: string | null },
): Promise<boolean> {
  if (String(user.role || '') === 'admin' || Number(event.host_user_id) === Number(user.id)) return true;
  const published = event.status === 'published' && (
    event.visibility === 'unlisted' ||
    (event.visibility === 'public' && Number(event.admin_published) === 1)
  );
  if (published) return true;
  // D1031 (#2872), as `canViewEvent`: a member who holds a registration reads the event, also once cancelled.
  const reg = await env.DB.prepare(
    `SELECT id FROM event_registrations WHERE event_id = ? AND user_id = ? LIMIT 1`,
  ).bind(event.id, user.id).first();
  if (reg) return true;
  const inv = await env.DB.prepare(
    `SELECT id FROM event_invitations
       WHERE event_id = ? AND (invited_user_id = ? OR lower(invited_email) = lower(?))
         AND status != 'revoked' LIMIT 1`,
  ).bind(event.id, user.id, user.email ?? null).first();
  return !!inv;
}

/** The same rule as `canReadJoinLink` in `routes/events.ts`, for a row already read. */
export function joinLinkAllowed(
  event: Row, user: { id: number; role?: string | null },
  registration: { status?: string | null; payment_status?: string | null } | null,
): boolean {
  if (String(user.role || '').toLowerCase() === 'admin') return true;
  if (Number(event.host_user_id) === Number(user.id)) return true;
  if (isInPersonEvent(event)) return true;
  return hasConfirmedEventSeat(registration);
}

function shapeCopy(env: Env, row: Row, opts: {
  kind: CalendarEvent['kind']; sourceId: number; sourceUid: string; status: string;
  mark: string | null; sentence: string; joinLink: boolean; tentative: boolean;
}): CalendarEvent {
  const online = !isInPersonEvent(row);
  const withheld = online && !opts.joinLink && !!row.location_url;
  const notes = [
    opts.sentence,
    withheld ? 'The join link shows once you hold a seat.' : null,
    row.summary || null,
  ].filter(Boolean).join('\n');
  return {
    id: `${opts.kind}:${opts.sourceId}`,
    kind: opts.kind,
    source_id: opts.sourceId,
    source_uid: opts.sourceUid,
    title: opts.mark ? `${opts.mark}: ${row.title}` : String(row.title),
    start_at: row.starts_at,
    // No end recorded is a zero-length entry, as `buildEventIcs` writes it —
    // never an invented hour.
    end_at: row.ends_at || row.starts_at,
    status: opts.status,
    location_kind: formatOf(row),
    location_uri: opts.joinLink ? row.location_url ?? null : null,
    place: row.location_text ?? null,
    organizer_email: null,
    attendees: [],
    notes,
    project_id: row.project_id ?? null,
    event_id: Number(row.id),
    url: eventPageUrl(env, Number(row.id)),
    ics_status: opts.tentative ? 'TENTATIVE' : 'CONFIRMED',
  };
}

/*
 * What makes a ticket or a hosted event live is written out twice below, in
 * the readers and in `staleMyEventCopies`, because a query's text takes no
 * interpolation (`scripts/check-sql-prepare.mjs`). The two must say the same
 * thing: a ticket is live while its registration is registered, confirmed, attended or
 * waitlisted (`ACTIVE_REG` in `routes/events.ts`), its
 * event is not cancelled and the member does not host it; a hosted event is
 * live while it is not cancelled. The D1033 tests
 * cancel each one and watch it leave both.
 */

/** The member's tickets. An event they host is listed once, as hosted. */
export async function ticketEvents(env: Env, userId: number, fromIso: string, toIso: string): Promise<CalendarEvent[]> {
  try {
    const me = await env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(userId).first<{ role: string | null }>();
    const res = await env.DB.prepare(
      `SELECT e.*, r.id AS reg_id, r.status AS reg_status, r.payment_status AS reg_payment_status,
              r.waitlist_position AS reg_waitlist_position, r.user_id AS reg_user_id
         FROM event_registrations r
         JOIN events e ON e.id = r.event_id
        WHERE r.user_id = ? AND r.status IN ('registered','confirmed','attended','waitlisted')
          AND e.status <> 'cancelled' AND COALESCE(e.host_user_id, 0) <> r.user_id
          AND e.starts_at >= ? AND e.starts_at <= ?
        ORDER BY e.starts_at ASC`,
    ).bind(userId, fromIso, toIso).all<Row>();
    const out: CalendarEvent[] = [];
    for (const row of res.results || []) {
      const reg = { status: row.reg_status, payment_status: row.reg_payment_status, waitlist_position: row.reg_waitlist_position };
      const place = placeOf(reg);
      if (!place) continue;
      out.push(shapeCopy(env, row, {
        kind: 'event_ticket',
        sourceId: Number(row.reg_id),
        sourceUid: `reg-${row.reg_id}`,
        status: place.code,
        mark: place.mark,
        sentence: place.sentence,
        joinLink: joinLinkAllowed(row, { id: userId, role: me?.role ?? null }, reg),
        tentative: place.code !== 'going' && place.code !== 'checked_in',
      }));
    }
    return out;
  } catch (e) {
    if (isMissingSchema(e)) return [];
    throw e;
  }
}

/** The events the member hosts, every status but cancelled. */
export async function hostedEvents(env: Env, userId: number, fromIso: string, toIso: string): Promise<CalendarEvent[]> {
  try {
    const res = await env.DB.prepare(
      `SELECT e.* FROM events e
        WHERE e.host_user_id = ? AND e.status <> 'cancelled'
          AND e.starts_at >= ? AND e.starts_at <= ?
        ORDER BY e.starts_at ASC`,
    ).bind(userId, fromIso, toIso).all<Row>();
    return (res.results || []).map((row) => {
      const word = HOSTED_WORDS[row.status] || 'Not recorded';
      const published = row.status === 'published';
      return shapeCopy(env, row, {
        kind: 'event_hosted',
        sourceId: Number(row.id),
        sourceUid: `event-${row.id}`,
        status: String(row.status || ''),
        mark: published ? null : word,
        sentence: `You host this event · ${word}.`,
        joinLink: true,
        tentative: !published,
      });
    });
  } catch (e) {
    if (isMissingSchema(e)) return [];
    throw e;
  }
}

/**
 * The copies a sync once wrote for these two kinds whose source has since left
 * the calendar: a place cancelled or declined, an event cancelled, a host
 * changed. Read from the source rows rather than from the sync's date window,
 * so a copy outside the window is not mistaken for one that left.
 */
export async function staleMyEventCopies(
  env: Env, userId: number, provider: 'google' | 'microsoft',
): Promise<{ source_kind: string; source_id: number; external_event_id: string }[]> {
  try {
    const res = await env.DB.prepare(
      `SELECT s.source_kind, s.source_id, s.external_event_id
         FROM calendar_sync_records s
        WHERE s.user_id = ? AND s.provider = ?
          AND ((s.source_kind = 'event_ticket' AND NOT EXISTS (
                  SELECT 1 FROM event_registrations r JOIN events e ON e.id = r.event_id
                   WHERE r.id = s.source_id AND r.user_id = s.user_id
                     AND r.status IN ('registered','confirmed','attended','waitlisted')
                     AND e.status <> 'cancelled' AND COALESCE(e.host_user_id, 0) <> r.user_id))
            OR (s.source_kind = 'event_hosted' AND NOT EXISTS (
                  SELECT 1 FROM events e
                   WHERE e.id = s.source_id AND e.host_user_id = s.user_id AND e.status <> 'cancelled')))`,
    ).bind(userId, provider).all<{ source_kind: string; source_id: number; external_event_id: string }>();
    return res.results || [];
  } catch (e) {
    if (isMissingSchema(e)) return [];
    throw e;
  }
}

function stamp(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/**
 * "Add to Google Calendar" and "Outlook" for one event: the title, the times,
 * the place and the event page, plus the join link only when `joinLink` is true
 * (the caller decides with `joinLinkAllowed`). Built on the server so the page
 * never assembles a join link it was not given.
 */
export function addToCalendarLinks(env: Env, event: Row, joinLink: boolean): {
  google: string; outlook: string; office365: string; join_link_included: boolean;
} {
  const start = new Date(event.starts_at);
  const end = new Date(event.ends_at || event.starts_at);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new Error('event_time_unreadable');
  const page = eventPageUrl(env, Number(event.id));
  const included = joinLink && !!event.location_url;
  const location = [event.location_text, included ? event.location_url : null].filter(Boolean).join(' — ');
  const details = [event.summary || null, `Event page: ${page}`].filter(Boolean).join('\n\n');
  const google = new URLSearchParams({
    action: 'TEMPLATE',
    text: String(event.title || ''),
    dates: `${stamp(start.toISOString())}/${stamp(end.toISOString())}`,
    details,
  });
  if (location) google.set('location', location);
  const outlook = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: String(event.title || ''),
    startdt: start.toISOString(),
    enddt: end.toISOString(),
    body: details,
  });
  if (location) outlook.set('location', location);
  const q = outlook.toString();
  return {
    google: `https://calendar.google.com/calendar/render?${google.toString()}`,
    outlook: `https://outlook.live.com/calendar/0/action/compose?${q}`,
    office365: `https://outlook.office.com/calendar/0/action/compose?${q}`,
    join_link_included: included,
  };
}
