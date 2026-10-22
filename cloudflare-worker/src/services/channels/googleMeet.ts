/**
 * D684 (#1577) — Google Meet: an interview's call is a Calendar event with a
 * Meet link on the member's own Google account, and the call's transcript
 * entries become the interview's session.
 *
 * NO SECOND GOOGLE TOKEN STORE. The member's Google connection is the one
 * Calendar already holds (`google_oauth_tokens`, read through calendar.ts's
 * `loadRefreshTokenExport` and refreshed with `refreshGoogleAccessToken`), and
 * its `calendar.events` scope is what creates the event with a Meet link.
 *
 * READING A TRANSCRIPT needs one more scope, `meetings.space.readonly`. The
 * incremental consent that asks for it is
 * `POST /api/calendar/google/meet-transcripts/connect`, gated by
 * `MEET_TRANSCRIPTS_ENABLED` (D757, #1926): off, it answers 503 and the member
 * is offered no button, since Google refuses the scope until the owner has
 * added it and passed verification. The grant's scopes are recorded in
 * `google_oauth_tokens.scope`; when they are recorded and lack it, nothing is
 * asked of Meet, the call can still be scheduled, and the ref says plainly
 * that Meet transcripts are not available on Axal yet and that the recorder or
 * a pasted conversation will do instead (`meet_transcripts_unavailable`,
 * settled as `no_transcript`). An older row with no recorded scopes is tried,
 * and Meet's 403 settles it the same way.
 *
 * NO PUSH. Meet tells nobody a transcript is ready without Workspace Events and
 * Pub/Sub, so the cron sweeps calls whose end has passed. Every conference on
 * the link that started within six hours of the scheduled start is the call
 * (rejoining after everyone left starts a new one), and every transcript of
 * those is part of it (stopping and restarting transcription makes another).
 * The import waits until each conference has ended and each transcript is
 * generated, then imports all of them in time order; none yet waits; a day
 * after the call it imports what was generated, or settles the ref as
 * `no_transcript` with the reason.
 *
 * Meet REST v2 as read 2026-10-13 (developers.google.com/workspace/meet):
 *   conferenceRecords?filter=space.meeting_code="abc-mnop-xyz"
 *   conferenceRecords/{r}/transcripts            state FILE_GENERATED when done
 *   conferenceRecords/{r}/transcripts/{t}/entries  paginated; participant, text, startTime
 *   conferenceRecords/{r}/participants           signedinUser / anonymousUser / phoneUser .displayName
 * UNVERIFIED: whether entries of external (not signed-in) participants name
 * them; the fallback is "Speaker ?".
 *
 * D871 (#2518):
 *   - ATTACH FROM CALENDAR. A Meet call the member did not schedule from Axal
 *     is found in their own primary Calendar (`findCalendarMeet`, the
 *     `calendar.events` grant they already gave), by event id or by Meet code.
 *     The route accepts it only when the member's account organises it, since
 *     Meet's transcript lands in the organiser's Drive.
 *   - SPEAKERS (`participantLabel`). The founder's own Google account
 *     (`signedinUser.user` = `users/<google_sub>`) reads "Me", a named
 *     participant keeps their name, a dial-in reads "Phone participant N"
 *     (never Meet's partly redacted number), and an unnamed participant reads
 *     "Speaker N", numbered per call in order of first speech. An entry with no
 *     participant at all stays "Speaker ?".
 *   - NO TRANSCRIPT (option A, no new scope). When a call has conference
 *     records but no transcript, its recordings are listed with the scope Axal
 *     already holds (`conferenceRecords/{r}/recordings`). A generated one
 *     settles the ref as `meet_no_transcript_recording`, which tells the
 *     member to download it from Drive and upload it; `meetRecordingLinks`
 *     reads the link live, so no Drive URL is stored. Reading the file itself
 *     would need a Drive scope, which is the owner's call (#2518 question 1B).
 *     conferenceRecords/{r}/recordings     state FILE_GENERATED; driveDestination.exportUri (a drive.google.com view link)
 */
import type { Env } from '../../types';
import {
  deleteEventFromGoogle, googleOAuthAvailable, loadRefreshTokenExport, reencryptRefreshTokenExport, refreshGoogleAccessToken,
} from '../calendar';
import { enqueueChannelJob, registerChannelJob, registerChannelSweep } from './jobs';
import {
  MeetingProviderError, dueRefs, importMeetingRef, meetingImportHandler, setRefStatus, touchRef, withinCallSlot,
  type MeetingErrorCode, type MeetingRef, type TranscriptFetch,
} from './meetings';
import type { ImportedSegment } from './types';

export const MEET_TRANSCRIPT_SCOPE = 'https://www.googleapis.com/auth/meetings.space.readonly';
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const MEET_API = 'https://meet.googleapis.com/v2';
/** Meet keeps records 30 days; a transcript is normally there within the hour. A day is the wait. */
const GRACE_AFTER_END_MS = 24 * 60 * 60 * 1000;
const MAX_RECORD_PAGES = 20;
const MAX_ENTRY_PAGES = 100;
const MAX_PARTICIPANT_PAGES = 20;

// ───────────────────────────────────────────────────────────── the member's connection

/**
 * The member's Google connection: that a refresh token is held, what it was
 * granted, and the Google account's id (`google_sub`), which is how Meet names
 * a signed-in participant (`users/<id>`). NULL on an older row.
 */
export interface GoogleConnection { userId: number; scope: string; googleSub?: string | null }

export async function googleConnection(env: Env, userId: number): Promise<GoogleConnection | null> {
  try {
    const row = await env.DB.prepare('SELECT scope, google_sub FROM google_oauth_tokens WHERE user_id = ?')
      .bind(userId).first<{ scope: string | null; google_sub: string | null }>();
    return row ? { userId, scope: String(row.scope ?? ''), googleSub: row.google_sub ? String(row.google_sub) : null } : null;
  } catch {
    return null; // no calendar table on this database: nobody is connected
  }
}

/** 'granted' / 'missing' when the grant's scopes are recorded; 'unknown' for an older row with none. */
export function transcriptAccess(conn: GoogleConnection | null): 'granted' | 'missing' | 'unknown' | null {
  if (!conn) return null;
  const scopes = conn.scope.split(/[\s,]+/).filter(Boolean);
  if (!scopes.length) return 'unknown';
  return scopes.includes(MEET_TRANSCRIPT_SCOPE) ? 'granted' : 'missing';
}

/**
 * A fresh access token from the member's stored refresh token. Google's 400
 * (`invalid_grant`) or 401 means the grant is gone; anything else may pass later.
 */
async function accessToken(env: Env, userId: number): Promise<string> {
  const tok = await loadRefreshTokenExport(env, 'google_oauth_tokens', userId);
  if (!tok) throw new MeetingProviderError('meet_not_connected', false);
  let token: string;
  try {
    token = await refreshGoogleAccessToken(env, tok.raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (/^refresh_failed:(400|401)$/.test(msg)) throw new MeetingProviderError('meet_reconnect', false);
    throw new MeetingProviderError('meet_unreachable', true);
  }
  if (!token) throw new MeetingProviderError('meet_unreachable', true);
  if (tok.wasPlaintext) await reencryptRefreshTokenExport(env, 'google_oauth_tokens', userId, tok.raw);
  return token;
}

// ───────────────────────────────────────────────────────────── schedule

export interface MeetingInput { topic: string; startsAt: string; durationMin: number }
export interface CreatedMeeting { externalRef: string; joinUrl: string; startsAt: string; endsAt: string; meetingCode: string }

const MEET_CODE = /meet\.google\.com\/([a-z]{3,4}-[a-z]{4}-[a-z]{3,4})\b/i;
/** The Meet code a join link carries: `https://meet.google.com/abc-mnop-xyz` → `abc-mnop-xyz`. */
export function meetingCodeOf(joinUrl: string | null | undefined): string | null {
  return MEET_CODE.exec(String(joinUrl ?? ''))?.[1]?.toLowerCase() ?? null;
}

interface CalendarEventBody {
  id?: string; hangoutLink?: string;
  conferenceData?: {
    conferenceId?: string;
    createRequest?: { status?: { statusCode?: string } };
    entryPoints?: { entryPointType?: string; uri?: string }[];
  };
}

function joinOf(ev: CalendarEventBody | null): string | null {
  const video = ev?.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video')?.uri;
  const url = video || ev?.hangoutLink || '';
  return meetingCodeOf(url) && /^https:\/\//.test(url) ? url : null;
}

function calendarFailure(status: number): MeetingProviderError {
  if (status === 401 || status === 403) return new MeetingProviderError('meet_reconnect', false);
  if (status === 429 || status >= 500) return new MeetingProviderError('meet_unreachable', true);
  return new MeetingProviderError('meet_create_failed', false);
}

async function calendarFetch(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(`${CALENDAR_API}${path}`, {
      ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
  } catch {
    throw new MeetingProviderError('meet_unreachable', true);
  }
}

/**
 * A Calendar event on the member's primary calendar, with a Meet conference
 * (`conferenceData.createRequest`, `conferenceDataVersion=1`). No attendees
 * are added and no invitation is sent: the member shares the link.
 */
export async function createMeeting(env: Env, conn: GoogleConnection, input: MeetingInput): Promise<CreatedMeeting> {
  const token = await accessToken(env, conn.userId);
  const startsAt = new Date(input.startsAt).toISOString();
  const endsAt = new Date(Date.parse(startsAt) + input.durationMin * 60_000).toISOString();
  const res = await calendarFetch(token, '/calendars/primary/events?conferenceDataVersion=1', {
    method: 'POST',
    body: JSON.stringify({
      summary: input.topic.slice(0, 200),
      start: { dateTime: startsAt, timeZone: 'UTC' },
      end: { dateTime: endsAt, timeZone: 'UTC' },
      conferenceData: { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } } },
    }),
  });
  if (!res.ok) throw calendarFailure(res.status);
  let ev = await res.json().catch(() => null) as CalendarEventBody | null;
  const eventId = String(ev?.id ?? '');
  if (!/^[A-Za-z0-9_-]{5,1024}$/.test(eventId)) throw new MeetingProviderError('meet_create_failed', false);
  // A conference request may come back `pending`; it is asked for once more.
  if (!joinOf(ev)) {
    const again = await calendarFetch(token, `/calendars/primary/events/${eventId}`);
    ev = again.ok ? await again.json().catch(() => null) as CalendarEventBody | null : null;
  }
  const joinUrl = joinOf(ev);
  if (!joinUrl) {
    await deleteEventFromGoogle(token, eventId);
    throw new MeetingProviderError('meet_link_unavailable', false);
  }
  return { externalRef: eventId, joinUrl, startsAt, endsAt, meetingCode: meetingCodeOf(joinUrl)! };
}

/** Delete the Calendar event (and with it the meeting's place on the calendar). */
export async function cancelMeeting(env: Env, conn: GoogleConnection, externalRef: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{5,1024}$/.test(externalRef)) return false;
  return deleteEventFromGoogle(await accessToken(env, conn.userId), externalRef);
}

/** Confirm the join link is on an event organised by this connected Google account. */
export async function verifyHostedMeet(env: Env, conn: GoogleConnection, joinUrl: string, startedAt: string): Promise<boolean> {
  const code = meetingCodeOf(joinUrl);
  const start = Date.parse(startedAt);
  if (!code || !Number.isFinite(start)) return false;
  const token = await accessToken(env, conn.userId);
  let pageToken = '';
  for (let page = 0; page < 10; page++) {
    const q = new URLSearchParams({
      singleEvents: 'true', showDeleted: 'false', maxResults: '250',
      timeMin: new Date(start - 24 * 60 * 60_000).toISOString(),
      timeMax: new Date(start + 24 * 60 * 60_000).toISOString(),
      ...(pageToken ? { pageToken } : {}),
    });
    const res = await calendarFetch(token, `/calendars/primary/events?${q}`);
    if (res.status === 401 || res.status === 403) throw new MeetingProviderError('meet_reconnect', false);
    if (!res.ok) throw new MeetingProviderError('meet_unreachable', true);
    const body = await res.json().catch(() => null) as {
      items?: Array<{ status?: string; organizer?: { self?: boolean }; hangoutLink?: string;
        conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> } }>;
      nextPageToken?: string;
    } | null;
    if (body?.items?.some((item) => item.status !== 'cancelled' && item.organizer?.self === true &&
      meetingCodeOf(item.hangoutLink || item.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === 'video')?.uri) === code)) {
      return true;
    }
    pageToken = String(body?.nextPageToken || '');
    if (!pageToken) return false;
  }
  return false;
}

// ───────────────────────────────────────────────────────────── attach from Calendar (D871)

/** A Meet call as the member's own Calendar holds it. */
export interface CalendarMeet {
  eventId: string; joinUrl: string; meetingCode: string;
  /** The event's own start and end; NULL for an all-day event, which has no times. */
  startsAt: string | null; endsAt: string | null;
  organizerSelf: boolean;
}

/** What the member named the call by: a Calendar event id, or a Meet code (from a link or typed). */
export type MeetTarget = { eventId: string } | { meetingCode: string };

export const EVENT_ID = /^[A-Za-z0-9_-]{5,1024}$/;
const MEET_CODE_ONLY = /^[a-z]{3,4}-[a-z]{4}-[a-z]{3,4}$/;
/** How far back an attach looks: Meet keeps a call's records 30 days. */
const ATTACH_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
const ATTACH_LOOKAHEAD_MS = 366 * 24 * 60 * 60 * 1000;

/** A Meet code typed on its own, normalised, or null. */
export function bareMeetingCode(raw: unknown): string | null {
  const code = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return MEET_CODE_ONLY.test(code) ? code : null;
}

interface CalendarItem extends CalendarEventBody {
  status?: string; organizer?: { self?: boolean };
  start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string };
}

function asCalendarMeet(item: CalendarItem | null): CalendarMeet | null {
  if (!item || item.status === 'cancelled') return null;
  const eventId = String(item.id ?? '');
  const joinUrl = joinOf(item);
  if (!EVENT_ID.test(eventId) || !joinUrl) return null;
  const iso = (v: string | undefined) => (v && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null);
  return {
    eventId, joinUrl, meetingCode: meetingCodeOf(joinUrl)!,
    startsAt: iso(item.start?.dateTime), endsAt: iso(item.end?.dateTime),
    organizerSelf: item.organizer?.self === true,
  };
}

/**
 * The Meet call on the member's own primary Calendar that `target` names, or
 * null when there is none: no such event, a cancelled one, or one without a
 * Meet conference. By code, the window is the last 30 days to a year ahead;
 * a recurring call's code is on every instance, so the instance whose start is
 * nearest now is the one meant (an event id names one instance exactly).
 */
export async function findCalendarMeet(env: Env, conn: GoogleConnection, target: MeetTarget, now = Date.now()): Promise<CalendarMeet | null> {
  const token = await accessToken(env, conn.userId);
  if ('eventId' in target) {
    if (!EVENT_ID.test(target.eventId)) return null;
    const res = await calendarFetch(token, `/calendars/primary/events/${target.eventId}`);
    if (res.status === 404 || res.status === 410) return null;
    if (res.status === 401 || res.status === 403) throw new MeetingProviderError('meet_reconnect', false);
    if (!res.ok) throw new MeetingProviderError('meet_unreachable', true);
    return asCalendarMeet(await res.json().catch(() => null) as CalendarItem | null);
  }
  const code = bareMeetingCode(target.meetingCode);
  if (!code) return null;
  const found: CalendarMeet[] = [];
  let pageToken = '';
  for (let page = 0; page < 10; page++) {
    const q = new URLSearchParams({
      singleEvents: 'true', showDeleted: 'false', maxResults: '250',
      timeMin: new Date(now - ATTACH_LOOKBACK_MS).toISOString(),
      timeMax: new Date(now + ATTACH_LOOKAHEAD_MS).toISOString(),
      ...(pageToken ? { pageToken } : {}),
    });
    const res = await calendarFetch(token, `/calendars/primary/events?${q}`);
    if (res.status === 401 || res.status === 403) throw new MeetingProviderError('meet_reconnect', false);
    if (!res.ok) throw new MeetingProviderError('meet_unreachable', true);
    const body = await res.json().catch(() => null) as { items?: CalendarItem[]; nextPageToken?: string } | null;
    for (const item of body?.items ?? []) {
      const meet = asCalendarMeet(item);
      if (meet && meet.meetingCode === code) found.push(meet);
    }
    pageToken = String(body?.nextPageToken || '');
    if (!pageToken) break;
  }
  const distance = (m: CalendarMeet) => (m.startsAt ? Math.abs(Date.parse(m.startsAt) - now) : Number.POSITIVE_INFINITY);
  return found.sort((a, b) => distance(a) - distance(b))[0] ?? null;
}

// ───────────────────────────────────────────────────────────── Meet REST

const RECORD_NAME = /^conferenceRecords\/[A-Za-z0-9_-]+$/;
const TRANSCRIPT_NAME = /^conferenceRecords\/[A-Za-z0-9_-]+\/transcripts\/[A-Za-z0-9_-]+$/;

interface ConferenceRecord { name: string; startTime?: string; endTime?: string }
interface Transcript { name: string; state?: string; startTime?: string }
interface TranscriptEntry { participant?: string; text?: string; startTime?: string; endTime?: string }
interface Participant {
  name?: string;
  signedinUser?: { user?: string; displayName?: string };
  anonymousUser?: { displayName?: string };
  phoneUser?: { displayName?: string };
}
interface Recording { name?: string; state?: string; startTime?: string; driveDestination?: { file?: string; exportUri?: string } }

/**
 * GET on Meet. A 403 is read for its reason only: an insufficient scope means
 * Meet transcripts are not available to Axal yet (no reconnect grants it); a
 * disabled API is the owner's. Nothing of the body goes further.
 */
async function meetGet<T>(token: string, path: string): Promise<T | null> {
  let res: Response;
  try {
    res = await fetch(`${MEET_API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    throw new MeetingProviderError('meet_unreachable', true);
  }
  if (res.ok) return await res.json().catch(() => null) as T | null;
  if (res.status === 404) return null;
  if (res.status === 401) throw new MeetingProviderError('meet_reconnect', false);
  if (res.status === 403) {
    const body = await res.json().catch(() => null) as { error?: { details?: { reason?: string }[] } } | null;
    const disabled = (body?.error?.details ?? []).some((d) => d?.reason === 'SERVICE_DISABLED');
    throw new MeetingProviderError(disabled ? 'meet_api_disabled' : 'meet_transcripts_unavailable', false);
  }
  if (res.status === 429 || res.status >= 500) throw new MeetingProviderError('meet_unreachable', true);
  throw new MeetingProviderError('meet_fetch_failed', false);
}

const ms = (iso: string | undefined) => (iso ? Date.parse(iso) : NaN);

interface Found {
  records: ConferenceRecord[];
  ready: { record: ConferenceRecord; transcript: Transcript }[];
  /** Transcripts of the call not generated yet (started, or ended and still being written). */
  pending: number;
}

/** The call's conference records and, of their transcripts, those whose file is generated. */
async function findTranscripts(token: string, meetingCode: string, ref: MeetingRef): Promise<Found> {
  // A Meet link may be used again. Only conferences that started within this
  // interview's slot are its call (a rejoin after everyone left is a second
  // one); other uses of the link are unrelated (`withinCallSlot`).
  if (!Number.isFinite(ms(ref.starts_at ?? undefined))) return { records: [], ready: [], pending: 0 };
  const candidates: ConferenceRecord[] = [];
  let pageToken = '';
  for (let page = 0; page < MAX_RECORD_PAGES; page++) {
    const q = new URLSearchParams({ filter: `space.meeting_code = "${meetingCode}"`, pageSize: '100', ...(pageToken ? { pageToken } : {}) });
    const list = await meetGet<{ conferenceRecords?: ConferenceRecord[]; nextPageToken?: string }>(token, `/conferenceRecords?${q.toString()}`);
    candidates.push(...(list?.conferenceRecords ?? []).filter((r) => RECORD_NAME.test(String(r?.name ?? ''))));
    pageToken = String(list?.nextPageToken ?? '');
    if (!pageToken) break;
  }
  const records = candidates.filter((r) => withinCallSlot(ms(r.startTime), ref))
    .sort((a, b) => ms(a.startTime) - ms(b.startTime));
  const ready: Found['ready'] = [];
  let pending = 0;
  for (const record of records) {
    const t = await meetGet<{ transcripts?: Transcript[] }>(token, `/${record.name}/transcripts`);
    const transcripts = (t?.transcripts ?? []).filter((x) => TRANSCRIPT_NAME.test(String(x?.name ?? '')))
      .sort((a, b) => (ms(a.startTime) || 0) - (ms(b.startTime) || 0));
    for (const transcript of transcripts) {
      if (transcript.state === 'FILE_GENERATED') ready.push({ record, transcript });
      else pending += 1;
    }
  }
  return { records, ready, pending };
}

/**
 * Ready to import, still worth waiting for, or settled with the reason there
 * is none. Within the day after the call, a part still under way (a conference
 * not ended, a transcript not generated) is waited for, so an import never
 * settles the call on its first part and leaves the rest behind; after that,
 * what was generated is imported.
 */
function settle(found: Found, ref: MeetingRef, now: number): 'ready' | 'wait' | MeetingErrorCode {
  const end = ms(ref.ends_at ?? undefined);
  const inGrace = !Number.isFinite(end) || now - end < GRACE_AFTER_END_MS;
  const underWay = found.pending > 0 || found.records.some((r) => !r.endTime);
  if (found.ready.length && !(inGrace && underWay)) return 'ready';
  if (inGrace) return 'wait';
  return found.records.length ? 'meet_no_transcript' : 'meet_no_record';
}

/**
 * How one Meet participant is labelled (D871): `label` when it has its own,
 * else `kind` for the per-call numbering. A dial-in's displayName is its
 * partly redacted phone number, which is never stored.
 */
export function participantLabel(p: Participant | null | undefined, ownUser: string | null):
  { label: string } | { kind: 'phone' | 'unnamed'; key: string } {
  const key = String(p?.signedinUser?.user || p?.name || '');
  if (ownUser && p?.signedinUser?.user === ownUser) return { label: 'Me' };
  if (p?.phoneUser) return { kind: 'phone', key };
  const name = String(p?.signedinUser?.displayName || p?.anonymousUser?.displayName || '').replace(/\s+/g, ' ').trim();
  return name ? { label: name.slice(0, 80) } : { kind: 'unnamed', key };
}

type Labelled = ReturnType<typeof participantLabel>;

async function participantsOf(token: string, recordName: string, ownUser: string | null): Promise<Map<string, Labelled>> {
  const out = new Map<string, Labelled>();
  let pageToken = '';
  for (let page = 0; page < MAX_PARTICIPANT_PAGES; page++) {
    const q = new URLSearchParams({ pageSize: '100', ...(pageToken ? { pageToken } : {}) });
    const body = await meetGet<{ participants?: Participant[]; nextPageToken?: string }>(token, `/${recordName}/participants?${q.toString()}`);
    for (const p of body?.participants ?? []) if (p?.name) out.set(p.name, participantLabel(p, ownUser));
    pageToken = String(body?.nextPageToken ?? '');
    if (!pageToken) break;
  }
  return out;
}

/** Numbers the call's dial-ins and unnamed participants in order of first speech, across its conference records. */
class SpeakerBook {
  private numbers = new Map<string, string>();
  private counts = { phone: 0, unnamed: 0 };
  label(entryParticipant: string, known: Map<string, Labelled>): string {
    const p = known.get(entryParticipant);
    if (!p) return entryParticipant ? this.numbered('unnamed', `entry:${entryParticipant}`) : 'Speaker ?';
    if ('label' in p) return p.label;
    return this.numbered(p.kind, `${p.kind}:${p.key || entryParticipant}`);
  }
  private numbered(kind: 'phone' | 'unnamed', key: string): string {
    let label = this.numbers.get(key);
    if (!label) {
      this.counts[kind] += 1;
      label = kind === 'phone' ? `Phone participant ${this.counts.phone}` : `Speaker ${this.counts.unnamed}`;
      this.numbers.set(key, label);
    }
    return label;
  }
}

/**
 * Every entry of the call's generated transcripts, in order, labelled by
 * participant, with offsets from the start of the first conference record.
 */
async function readEntries(token: string, found: Found, ownUser: string | null): Promise<ImportedSegment[]> {
  const base = Math.min(...found.ready.map((r) => ms(r.record.startTime)).filter(Number.isFinite));
  const out: ImportedSegment[] = [];
  const named = new Map<string, Map<string, Labelled>>();
  const book = new SpeakerBook();
  for (const { record, transcript } of found.ready) {
    if (!named.has(record.name)) named.set(record.name, await participantsOf(token, record.name, ownUser));
    const names = named.get(record.name)!;
    let pageToken = '';
    for (let page = 0; page < MAX_ENTRY_PAGES; page++) {
      const q = new URLSearchParams({ pageSize: '100', ...(pageToken ? { pageToken } : {}) });
      const body = await meetGet<{ transcriptEntries?: TranscriptEntry[]; nextPageToken?: string }>(
        token, `/${transcript.name}/entries?${q.toString()}`,
      );
      for (const e of body?.transcriptEntries ?? []) {
        const text = String(e?.text ?? '').trim();
        if (!text) continue;
        const start = ms(e.startTime);
        const end = ms(e.endTime);
        out.push({
          speaker: book.label(String(e.participant ?? ''), names),
          text: text.slice(0, 8000),
          startMs: Number.isFinite(base) && Number.isFinite(start) ? Math.max(0, start - base) : null,
          endMs: Number.isFinite(base) && Number.isFinite(end) ? Math.max(0, end - base) : null,
        });
      }
      pageToken = String(body?.nextPageToken ?? '');
      if (!pageToken) break;
    }
  }
  return out;
}

/** The call's generated recordings, each with its Drive view link. Listing needs no Drive scope. */
async function listRecordings(token: string, records: ConferenceRecord[]): Promise<{ url: string; started_at: string | null }[]> {
  const out: { url: string; started_at: string | null }[] = [];
  for (const record of records) {
    const body = await meetGet<{ recordings?: Recording[] }>(token, `/${record.name}/recordings`);
    for (const r of body?.recordings ?? []) {
      const url = String(r?.driveDestination?.exportUri ?? '');
      let ok = false;
      try { ok = r?.state === 'FILE_GENERATED' && new URL(url).protocol === 'https:' && new URL(url).hostname === 'drive.google.com'; } catch { ok = false; }
      if (ok) out.push({ url, started_at: Number.isFinite(ms(r.startTime)) ? new Date(ms(r.startTime)).toISOString() : null });
    }
  }
  return out;
}

/**
 * Why a call with no transcript settled. With conference records but no
 * transcript, a generated recording turns `meet_no_transcript` into
 * `meet_no_transcript_recording` (download it, then upload it). A recording
 * listing that fails leaves the plain reason: the call is settled either way.
 */
async function noTranscriptCode(token: string, found: Found, code: MeetingErrorCode): Promise<MeetingErrorCode> {
  if (code !== 'meet_no_transcript') return code;
  try {
    return (await listRecordings(token, found.records)).length ? 'meet_no_transcript_recording' : code;
  } catch (e) {
    if (e instanceof MeetingProviderError) return code;
    throw e;
  }
}

/** The member's connection and a token for Meet, or the reason there is none (no Meet call made). */
async function meetAccess(env: Env, ref: MeetingRef): Promise<{ token: string; code: string; ownUser: string | null } | { fail: MeetingErrorCode; retryable: boolean }> {
  const code = meetingCodeOf(ref.join_url);
  if (!code) return { fail: 'meet_no_record', retryable: false };
  const conn = await googleConnection(env, Number(ref.user_id));
  if (!conn) return { fail: 'meet_not_connected', retryable: false };
  if (transcriptAccess(conn) === 'missing') return { fail: 'meet_transcripts_unavailable', retryable: false };
  try {
    return { token: await accessToken(env, conn.userId), code, ownUser: conn.googleSub ? `users/${conn.googleSub}` : null };
  } catch (e) {
    if (e instanceof MeetingProviderError) return { fail: e.code, retryable: e.retryable };
    throw e;
  }
}

/**
 * Reasons that settle a call rather than fail it: there is nothing the member
 * can retry or reconnect their way out of, only the recorder or a paste.
 */
const SETTLES = new Set<MeetingErrorCode>(['meet_no_record', 'meet_transcripts_unavailable']);

/** A Meet call's transcript, through the member's own Google connection. */
export async function fetchTranscript(env: Env, ref: MeetingRef, _hint: Record<string, unknown>, now = Date.now()): Promise<TranscriptFetch> {
  const access = await meetAccess(env, ref);
  if ('fail' in access) {
    return SETTLES.has(access.fail) ? { kind: 'none', code: access.fail } : { kind: 'error', code: access.fail, retryable: access.retryable };
  }
  let found: Found;
  try {
    found = await findTranscripts(access.token, access.code, ref);
  } catch (e) {
    if (e instanceof MeetingProviderError && SETTLES.has(e.code)) return { kind: 'none', code: e.code };
    throw e;
  }
  const state = settle(found, ref, now);
  if (state === 'wait') return { kind: 'waiting' };
  if (state !== 'ready') return { kind: 'none', code: await noTranscriptCode(access.token, found, state) };
  const segments = await readEntries(access.token, found, access.ownUser);
  return segments.length ? { kind: 'segments', segments } : { kind: 'none', code: 'transcript_empty' };
}

/**
 * The Drive recordings of a member's own Meet call, read live (no link is
 * stored), for "Download it, then upload it here". Empty when Meet lists none.
 */
export async function meetRecordingLinks(env: Env, ref: MeetingRef):
  Promise<{ recordings: { url: string; started_at: string | null }[] } | { fail: MeetingErrorCode; retryable: boolean }> {
  const access = await meetAccess(env, ref);
  if ('fail' in access) return access;
  try {
    const found = await findTranscripts(access.token, access.code, ref);
    return { recordings: await listRecordings(access.token, found.records) };
  } catch (e) {
    if (e instanceof MeetingProviderError) return { fail: e.code, retryable: e.retryable };
    throw e;
  }
}

registerChannelJob('meeting_import', 'google_meet',
  meetingImportHandler('google_meet', (env, ref, hint) => importMeetingRef(env, ref, fetchTranscript, hint)));

// ───────────────────────────────────────────────────────────── the sweep

/** What one ref's look came to, for the cron's count and the tests. */
export type SweepResult = 'queued' | 'waiting' | 'no_transcript' | 'failed' | 'skipped';

async function sweepOne(env: Env, ref: MeetingRef, now: Date): Promise<SweepResult> {
  // Touched first: a ref that throws below is not looked at again for ten minutes.
  await touchRef(env, ref.id);
  const settleOn = async (code: MeetingErrorCode, retryable: boolean): Promise<SweepResult> => {
    if (retryable) return 'skipped';
    const status = SETTLES.has(code) ? 'no_transcript' : 'failed';
    await setRefStatus(env, ref.id, status, code);
    return status;
  };
  const access = await meetAccess(env, ref);
  if ('fail' in access) return settleOn(access.fail, access.retryable);
  let found: Found;
  try {
    found = await findTranscripts(access.token, access.code, ref);
  } catch (e) {
    if (!(e instanceof MeetingProviderError)) throw e;
    return settleOn(e.code, e.retryable);
  }
  const state = settle(found, ref, now.getTime());
  if (state === 'wait') {
    if (ref.status === 'scheduled') await setRefStatus(env, ref.id, 'ended', null);
    return 'waiting';
  }
  if (state !== 'ready') {
    await setRefStatus(env, ref.id, 'no_transcript', await noTranscriptCode(access.token, found, state));
    return 'no_transcript';
  }
  await setRefStatus(env, ref.id, 'transcript_ready', null);
  // Keyed by the look, not the ref: an import that found nothing yet (and put
  // the ref back to 'ended') must be able to queue again on a later sweep.
  await enqueueChannelJob(env, 'meeting_import', 'google_meet', `${ref.uid}:${now.getTime()}`, { refUid: ref.uid });
  return 'queued';
}

/**
 * Meet calls whose end has passed and that were not looked at in the last ten
 * minutes, twenty at a time; and a found transcript that went quiet (a lost
 * job) is looked at again. Each ref in its own try: one bad ref never stops
 * the rest.
 */
export async function sweepMeet(env: Env, now: Date): Promise<SweepResult[]> {
  if (!googleOAuthAvailable(env)) return [];
  const refs = await dueRefs(env, 'google_meet', {
    endedBefore: now.toISOString(),
    idleBefore: new Date(now.getTime() - 10 * 60_000).toISOString(),
    limit: 20,
  });
  const results: SweepResult[] = [];
  for (const ref of refs) {
    try {
      results.push(await sweepOne(env, ref, now));
    } catch (e) {
      console.error('[meet] sweep failed ref=%s', ref.uid, e instanceof Error ? e.name : 'error');
      results.push('skipped');
    }
  }
  return results;
}

registerChannelSweep('google_meet', async (env, now) => { await sweepMeet(env, now); });
