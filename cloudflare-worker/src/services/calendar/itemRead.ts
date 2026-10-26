/**
 * D1211 (#3177, part 6 of #2420) — one Calendar item for the person reading it
 * (CAL4's drawer, CAL5's other kinds, CAL18's refusal), and a Google Meet link
 * made at create (owner question 4, option a).
 *
 * THE ITEM IS THE PAGE READ'S ITEM. It comes from the same owner-only reader
 * as `GET /calendar/events` (`fetchUserEventsWithSources`, with cancelled
 * rows), described by `describeItems`, so the drawer can never show more than
 * the list did, or show it to anyone the list would not. A meeting the reader
 * is not part of is not found, the same answer as one that does not exist, so
 * the refusal says nothing about the meeting.
 *
 * PEOPLE BY NAME. The item's attendees leave as `people`: a name, a profile in
 * words, where they stand and their answer. Never an email and never a user
 * number; the reader's own answer is `my_rsvp`.
 *
 * MEET IS THE ORGANISER'S COPY. `googleMeet.createMeeting` makes the event on
 * the creator's own Google calendar. That event is then recorded as their
 * copy (`calendar_sync_records`), so the copy hook PATCHes it rather than
 * writing a second event beside it, a Reschedule moves it and a Cancel
 * removes it. Nobody else's calendar is touched here.
 */
import type { Env } from '../../types';
import { fetchUserEventsWithSources, attachPushRecords, KNOWN_KINDS, type CalendarEvent } from '../calendar';
import { describeItems, type CalendarItem } from './items';
import { cancelMeeting, createMeeting, googleConnection } from '../channels/googleMeet';
import { MEETING_ERRORS, MeetingProviderError, type MeetingErrorCode } from '../channels/meetings';

/** CAL18, left: what a reader who is not part of the meeting is told. Nothing about the meeting. */
export const NOT_PARTY = 'Only the people invited and studio admins can open this meeting.';

const DAY_MS = 86_400_000;
/** How far either side of today a kind with no start lookup is looked for. */
const WIDE_DAYS = 400;

const PROFILE_WORDS: Readonly<Record<string, string>> = {
  admin: 'Admin', founder: 'Founder', partner: 'Operating Partner',
  investor: 'Investor', advisor: 'Advisor', exploring: 'Member',
};
const STAND_WORDS: Readonly<Record<string, string>> = {
  organizer: 'Organiser', attendee: 'Invited', invitee: 'Invited', founder: 'Founder', counterpart: 'With the founder',
};
/** An answer in CAL4's words. A missing answer is said, never assumed. */
export const ANSWER_WORDS: Readonly<Record<string, string>> = {
  accepted: 'Going', tentative: 'Maybe', declined: 'Not going', invited: 'Not answered yet',
};

export interface ItemPerson { name: string | null; profile: string | null; stands: string; answer: string | null }
export type ReadItem = Omit<CalendarItem, 'attendees' | 'organizer_email'> & { people: ItemPerson[]; my_rsvp: string | null };
export type ItemOutcome = { ok: true; item: ReadItem } | { ok: false; status: 400 | 404 | 503; error: string; detail: string };

/** Where to look for the item: around its own start for the two kinds this page writes, else wide. */
async function windowOf(env: Env, kind: CalendarEvent['kind'], id: number): Promise<{ from: string; to: string } | null> {
  const lookup = kind === 'ic_meeting' ? 'SELECT start_at FROM ic_meetings WHERE id = ?'
    : kind === 'founder_checkin' ? 'SELECT start_at FROM founder_checkins WHERE id = ?' : null;
  if (!lookup) {
    const now = Date.now();
    return { from: new Date(now - WIDE_DAYS * DAY_MS).toISOString(), to: new Date(now + WIDE_DAYS * DAY_MS).toISOString() };
  }
  const row = await env.DB.prepare(lookup).bind(id).first<{ start_at: string }>();
  const start = row ? Date.parse(String(row.start_at)) : NaN;
  if (!Number.isFinite(start)) return null;
  return { from: new Date(start - DAY_MS).toISOString(), to: new Date(start + DAY_MS).toISOString() };
}

/** Each attendee by name, profile and answer; the reader's own answer apart. */
async function peopleOf(env: Env, userId: number, ev: CalendarEvent): Promise<{ people: ItemPerson[]; mine: string | null }> {
  // A private session shows no people list (CAL5).
  if (ev.kind === 'expert_booking') return { people: [], mine: null };
  const emails = [...new Set(ev.attendees.map((a) => String(a.email || '').toLowerCase()).filter(Boolean))];
  const byEmail = new Map<string, { id: number; role: string; name: string | null }>();
  if (emails.length) {
    try {
      const r = await env.DB.prepare(
        `SELECT id, LOWER(email) AS email, role, COALESCE(display_name, name) AS name FROM users
          WHERE LOWER(email) IN (SELECT value FROM json_each(?))`,
      ).bind(JSON.stringify(emails)).all<{ id: number; email: string; role: string; name: string | null }>();
      for (const u of r.results || []) byEmail.set(String(u.email), { id: Number(u.id), role: String(u.role || ''), name: u.name ?? null });
    } catch {
      console.warn('[calendar] item people unreadable', { kind: ev.kind, people: emails.length });
    }
  }
  const organiser = String(ev.organizer_email || '').toLowerCase();
  let mine: string | null = null;
  const people = ev.attendees.map((a) => {
    const key = String(a.email || '').toLowerCase();
    const who = byEmail.get(key);
    if (who?.id === userId && a.rsvp) mine = a.rsvp;
    const stands = ev.kind === 'ic_meeting' && key && key === organiser ? 'Organiser' : STAND_WORDS[a.role] || 'Invited';
    return {
      name: a.name || who?.name || null,
      profile: who ? PROFILE_WORDS[who.role] ?? null : null,
      stands,
      answer: a.rsvp ? ANSWER_WORDS[a.rsvp] ?? null : null,
    };
  });
  return { people, mine };
}

/** `GET /calendar/item/:kind/:id`: the reader's own item, or why not. */
export async function readItem(env: Env, user: { id: number; role: string }, kindRaw: string, idRaw: string): Promise<ItemOutcome> {
  const kind = kindRaw as CalendarEvent['kind'];
  const id = Number(idRaw);
  if (!(KNOWN_KINDS as readonly string[]).includes(kindRaw) || !Number.isSafeInteger(id) || id <= 0) {
    return { ok: false, status: 400, error: 'invalid_item', detail: 'That is not a calendar item.' };
  }
  const missing = { ok: false as const, status: 404 as const, error: 'not_party', detail: NOT_PARTY };
  const span = await windowOf(env, kind, id);
  if (!span) return missing;
  const { events, sources } = await fetchUserEventsWithSources(
    env, user.id, String(user.role || '').toLowerCase(), span.from, span.to, [kind], { withCancelled: true },
  );
  if (sources.some((s) => s.ok === false)) {
    return { ok: false, status: 503, error: 'unreadable', detail: 'This item could not be read. Try again.' };
  }
  const ev = events.find((e) => Number(e.source_id) === id);
  if (!ev) return missing;
  const [item] = await describeItems(env, user, await attachPushRecords(env, user.id, [ev]));
  const { people, mine } = await peopleOf(env, user.id, ev);
  const { attendees: _attendees, organizer_email: _organiser, ...rest } = item;
  return { ok: true, item: { ...rest, people, my_rsvp: mine } };
}

/** A refused Meet link: the code, our sentence, and the status `founder_validate_meetings` uses. */
export interface MeetRefusal { status: 409 | 502 | 503; code: MeetingErrorCode; message: string }

export function meetRefusal(failure: MeetingProviderError): MeetRefusal {
  const status = failure.retryable ? 503 : /_(not_connected|reconnect)$/.test(failure.code) ? 409 : 502;
  return { status, code: failure.code, message: MEETING_ERRORS[failure.code] };
}

/**
 * A Meet link on the creator's own Google account, made before anything is
 * saved, so a refusal leaves nothing behind. `undo` deletes it again if the
 * save then fails.
 */
export async function makeMeetLink(env: Env, userId: number, input: { topic: string; startsAt: string; durationMin: number }):
  Promise<{ ok: true; joinUrl: string; externalRef: string; undo: () => Promise<void> } | { ok: false; refusal: MeetRefusal }> {
  const conn = await googleConnection(env, userId);
  if (!conn) return { ok: false, refusal: meetRefusal(new MeetingProviderError('meet_not_connected', false)) };
  try {
    const made = await createMeeting(env, conn, input);
    const undo = async () => {
      try { await cancelMeeting(env, conn, made.externalRef); } catch { /* best-effort: the event stays in their calendar */ }
    };
    return { ok: true, joinUrl: made.joinUrl, externalRef: made.externalRef, undo };
  } catch (x) {
    if (x instanceof MeetingProviderError) return { ok: false, refusal: meetRefusal(x) };
    throw x;
  }
}

/** The Meet event is the creator's Google copy of the item, so the copy hook updates it in place. */
export async function adoptMeetCopy(env: Env, userId: number, kind: 'ic_meeting' | 'founder_checkin', sourceId: number, externalRef: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO calendar_sync_records (user_id, provider, source_kind, source_id, external_event_id, last_synced_at)
     VALUES (?, 'google', ?, ?, ?, ?)
     ON CONFLICT (user_id, provider, source_kind, source_id) DO UPDATE SET external_event_id = excluded.external_event_id`,
  ).bind(userId, kind, sourceId, externalRef, new Date().toISOString()).run();
}
