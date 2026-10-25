import { BotError, dispatchBot, stopSessionBot, sessionBot, botView } from '../services/meetingBots';
/**
 * D684 (#1577) — a Zoom or Google Meet call scheduled from a Validate
 * interview, and the transcript it brings back. Mounted on
 * `/api/founder/validate` beside `founder_validate_sessions.ts`, whose paths
 * it does not share.
 *
 *   GET    /interviews/:id/meetings                     the member's calls on the interview, each provider's
 *                                                       availability and whether the member is connected
 *   POST   /interviews/:id/meetings                     schedule one: { provider, starts_at, duration_min?, topic?, auto_record? }
 *   DELETE /interviews/:id/meetings/:refUid             cancel it (at the provider too, while it is still to come)
 *   POST   /interviews/:id/meetings/:refUid/import      fetch and import its transcript now
 *   GET    /interviews/:id/meetings/:refUid/recording   a Meet call's Drive recordings, read live (D871)
 *
 * D871 (#2518): a Meet call the member did not schedule from Axal is attached
 * with `POST /interviews/:id/meetings` and `{ attach: { event_id | meeting_code
 * | join_url }, consent }`, with no `session_id`. The call is found in the
 * member's own Google Calendar and accepted only when their account organises
 * it; it opens its own session, as scheduling does, and keeps the event's start
 * and end so the sweep imports it after the call. With a `session_id`, attach
 * is D685's: a link pasted for the recording in progress.
 *
 * And, separately, `zoomWebhook`: the public receiver for Axal's one Zoom app,
 * `POST /zoom/webhook`, mounted on `/api/channels` outside `requireAuth`. It
 * trusts nothing but Zoom's signature (services/channels/zoom.ts).
 *
 * Ownership is `writableInterview` (services/interviewIntake.ts): the venture
 * the interview belongs to must be the member's to write, and an interview
 * that is not answers 404 — as the sessions routes do. A call belongs to the
 * member who scheduled it (it lives on THEIR Zoom or Google account), so the
 * routes read and act only on the caller's own refs.
 *
 * A scheduled call opens a `video` session on the interview at once, marked
 * with the provider (`submitted_via`), and waits in `draft` until its
 * transcript is imported. Structure and Ask then work on it unchanged.
 */
import { Hono, type Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { refuse } from '../util/refusal';
import { IntakeError, openSession, writableInterview, writableSession, type ScopedInterview } from '../services/interviewIntake';
import { providerAvailable } from '../services/channels/connections';
import { MEETING_PROVIDERS, PROVIDER_LABEL, type MeetingProvider } from '../services/channels/types';
import {
  MEETING_ERRORS, MeetingProviderError, cancelRef, importMeetingRef, loadRef, meetingView, memberRef, withinCallSlot,
  type MeetingErrorCode, type MeetingImporter, type MeetingRef,
} from '../services/channels/meetings';
import { readCappedBody } from '../services/channels/events';
import * as zoom from '../services/channels/zoom';
import * as meet from '../services/channels/googleMeet';
import { googleOAuthAvailable } from '../services/calendar';
import { CONSENT_METHODS } from '../services/interviewSessions';

const meetings = new Hono<{ Bindings: Env }>();
type C = Context<{ Bindings: Env }>;

/** The same import each provider's `meeting_import` job runs. */
const IMPORTERS: Record<MeetingProvider, MeetingImporter> = {
  zoom: zoom.importZoomRef,
  google_meet: (env, ref, hint) => importMeetingRef(env, ref, meet.fetchTranscript, hint),
};

/**
 * Whether a provider can be used on this deployment. Zoom needs its three
 * platform secrets. Meet needs what the Google connection itself needs to
 * refresh a token (calendar.ts's resolution: GOOGLE_CAL_* or GOOGLE_CLIENT_*,
 * and a callback base).
 */
function available(env: Env, provider: MeetingProvider): boolean {
  return provider === 'zoom' ? providerAvailable(env, 'zoom') : googleOAuthAvailable(env);
}

const UNAVAILABLE: Record<MeetingProvider, string> = {
  zoom: 'Zoom calls are not available on Axal yet.',
  google_meet: 'Google Meet calls are not available on Axal yet.',
};
const CONNECT_FIRST: Record<MeetingProvider, string> = {
  zoom: 'Connect Zoom in Account › Connectors first, then schedule the call.',
  google_meet: 'Connect Google in Account › Connectors first, then schedule the call.',
};

/**
 * An IntakeError's sentence is one services/interviewIntake.ts wrote (never a
 * provider's or SQLite's text), so it may be shown with its code.
 */
function intakeRefusal(c: C, refusal: IntakeError): Response {
  return refuse(c, refusal.status, { code: refusal.code, message: refusal.message });
}

/** Provider trouble as the member reads it: a code and our sentence, the provider's words nowhere. */
function providerRefusal(c: C, failure: MeetingProviderError): Response {
  const status = failure.retryable ? 503
    : /_(not_connected|reconnect)$/.test(failure.code) ? 409 : 502;
  return refuse(c, status, { code: failure.code, message: MEETING_ERRORS[failure.code] });
}

/** The caller and the interview they may write, or the refusal. */
async function scope(c: C): Promise<{ user: User; scoped: ScopedInterview } | Response> {
  const user = (await requireAuth(c)) as User;
  try {
    return { user, scoped: await writableInterview(c.env, user.id, Number(c.req.param('id'))) };
  } catch (x) {
    if (x instanceof IntakeError) return intakeRefusal(c, x);
    throw x;
  }
}

async function zoomConnected(env: Env, userId: number): Promise<boolean> {
  return !!(await zoom.zoomConnection(env, userId));
}

const view = (ref: MeetingRef) => meetingView(ref, PROVIDER_LABEL[ref.provider]);

// ---------------------------------------------------------------------------
// The interview's calls
// ---------------------------------------------------------------------------

meetings.get('/interviews/:id/meetings', async (c) => {
  const s = await scope(c);
  if (s instanceof Response) return s;
  // A restarted Zoom call's first instance shares the call's session and shows
  // as the call itself; a later instance has a session of its own and is listed.
  const rows = (await c.env.DB.prepare(
    `SELECT * FROM interview_channel_refs r WHERE r.interview_id = ? AND r.user_id = ?
        AND NOT EXISTS (SELECT 1 FROM interview_channel_refs p WHERE p.session_id = r.session_id AND p.id < r.id)
      ORDER BY datetime(COALESCE(r.starts_at, r.created_at)) DESC, r.id DESC LIMIT 100`,
  ).bind(s.scoped.interview.id, s.user.id).all<MeetingRef>()).results ?? [];
  const google = await meet.googleConnection(c.env, s.user.id);
  const providers = [
    { provider: 'zoom' as const, label: PROVIDER_LABEL.zoom, available: available(c.env, 'zoom'),
      connected: await zoomConnected(c.env, s.user.id), transcript_access: null },
    { provider: 'google_meet' as const, label: PROVIDER_LABEL.google_meet, available: available(c.env, 'google_meet'),
      connected: !!google, transcript_access: meet.transcriptAccess(google) },
  ];
  const items=await Promise.all(rows.map(async row=>({ ...view(row), bot:c.env.MEETING_BOT_RUN ? await sessionBot(c.env,row.session_id,s.user.id).then(run=>run?botView(run):null) : null })));
  return c.json({ meetings: items, providers });
});

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

const MIN_DURATION = 5;
const MAX_DURATION = 300;
const MAX_AHEAD_MS = 366 * 24 * 60 * 60 * 1000;
/** Zoom's own limit on a topic is 200 characters. */
const MAX_TOPIC = 200;
/** A call may be scheduled to start now; a few minutes of clock skew are allowed. */
const PAST_SLACK_MS = 10 * 60 * 1000;

function attachedLink(raw: unknown): { provider: MeetingProvider; joinUrl: string; externalRef: string } | null {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) return null;
    const host = url.hostname.toLowerCase();
    if (host === 'zoom.us' || host.endsWith('.zoom.us')) {
      const id = /^\/j\/(\d{6,20})\/?$/.exec(url.pathname)?.[1];
      return id ? { provider: 'zoom', joinUrl: url.toString(), externalRef: id } : null;
    }
    if (host === 'meet.google.com') {
      const code = /^\/([a-z]{3,4}-[a-z]{4}-[a-z]{3,4})\/?$/i.exec(url.pathname)?.[1]?.toLowerCase();
      return code ? { provider: 'google_meet', joinUrl: url.toString(), externalRef: code } : null;
    }
  } catch { /* invalid link */ }
  return null;
}

/** The interviewee's consent as scheduling takes it, or null. */
function consentOf(body: Record<string, unknown> | null): string | null {
  const consent = body?.consent && typeof body.consent === 'object' ? body.consent as Record<string, unknown> : null;
  const method = String(consent?.method ?? '');
  return consent?.status === 'given' && (CONSENT_METHODS as readonly string[]).includes(method) ? method : null;
}

/** The Meet call an attach without a session names: a Calendar event id, a typed code, or a Meet link. */
function meetTarget(attach: Record<string, unknown> | null): meet.MeetTarget | null {
  if (typeof attach?.event_id === 'string') return meet.EVENT_ID.test(attach.event_id) ? { eventId: attach.event_id } : null;
  const code = meet.bareMeetingCode(attach?.meeting_code);
  if (code) return { meetingCode: code };
  const link = attachedLink(attach?.join_url);
  return link?.provider === 'google_meet' ? { meetingCode: link.externalRef } : null;
}

/**
 * D871: attach a Meet call from the member's own Calendar. Nothing is stored
 * unless the event is on their primary calendar, has that Meet conference, has
 * times, is organised by their account, ended no more than 30 days ago (Meet's
 * retention), and is not already a call on an interview.
 */
async function attachCalendarMeet(c: C, s: { user: User; scoped: ScopedInterview }, body: Record<string, unknown>, target: meet.MeetTarget) {
  const consentMethod = consentOf(body);
  if (!consentMethod) {
    return refuse(c, 400, { code: 'consent_required',
      message: 'Record how the interviewee agreed to be recorded and transcribed before you attach the call.',
      extra: { accepted: CONSENT_METHODS } });
  }
  if (!available(c.env, 'google_meet')) return refuse(c, 503, { code: 'provider_unavailable', message: UNAVAILABLE.google_meet });
  const googleConn = await meet.googleConnection(c.env, s.user.id);
  if (!googleConn) return refuse(c, 409, { code: 'connect_first', message: 'Connect Google in Account › Connectors first, then attach the call.' });
  let call: meet.CalendarMeet | null;
  try {
    call = await meet.findCalendarMeet(c.env, googleConn, target);
  } catch (e) {
    if (e instanceof MeetingProviderError) return providerRefusal(c, e);
    throw e;
  }
  if (!call) {
    return refuse(c, 404, { code: 'meeting_not_in_calendar',
      message: 'No Google Meet call with that link or event is in your Google Calendar. Attach a call from your own calendar.' });
  }
  if (!call.organizerSelf) {
    return refuse(c, 409, { code: 'meeting_not_hosted',
      message: 'Axal can import only a call hosted by the account you connected. Record this call in-app instead.' });
  }
  if (!call.startsAt || !call.endsAt) {
    return refuse(c, 409, { code: 'meeting_no_time', message: 'That Calendar event has no start and end time. Attach a timed Meet call.' });
  }
  if (Date.parse(call.endsAt) < Date.now() - 30 * 24 * 60 * 60 * 1000) {
    return refuse(c, 409, { code: 'meeting_expired',
      message: 'Google Meet keeps a call’s transcript for 30 days, and this call ended before that. Paste the conversation instead.' });
  }
  // One call, one interview: the event itself, or the same link pasted for a
  // recording during it. Both start in this call's slot; an event whose time
  // moved since is still refused, by the table's UNIQUE (provider, external_ref).
  const taken = (await c.env.DB.prepare(
    `SELECT starts_at, ends_at FROM interview_channel_refs
      WHERE provider = 'google_meet' AND status <> 'cancelled' AND external_ref IN (?, ?)`,
  ).bind(call.eventId, call.meetingCode).all<Pick<MeetingRef, 'starts_at' | 'ends_at'>>()).results ?? [];
  if (taken.some((r) => withinCallSlot(Date.parse(call!.startsAt!), r))) {
    return refuse(c, 409, { code: 'meeting_link_reused', message: 'This call is already attached to an interview.' });
  }
  const notice: MeetingErrorCode | null = meet.transcriptAccess(googleConn) === 'missing' ? 'meet_transcripts_unavailable' : null;
  let sessionId: number | null = null;
  try {
    const session = await openSession(c.env, s.scoped, 'google_meet', 'video', { method: consentMethod });
    sessionId = session.id;
    const uid = crypto.randomUUID();
    await c.env.DB.prepare(
      `INSERT INTO interview_channel_refs
         (uid, provider, external_ref, session_id, interview_id, user_id, join_url, starts_at, ends_at, status, last_error)
       VALUES (?, 'google_meet', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(uid, call.eventId, session.id, s.scoped.interview.id, s.user.id, call.joinUrl, call.startsAt, call.endsAt,
      Date.parse(call.endsAt) > Date.now() ? 'scheduled' : 'ended', notice ? MEETING_ERRORS[notice] : null).run();
    const ref = await loadRef(c.env, uid);
    return c.json({ meeting: ref ? view(ref) : null, session_id: session.id,
      notice: notice ? { code: notice, message: MEETING_ERRORS[notice] } : null }, 201);
  } catch (x) {
    if (sessionId) {
      await c.env.DB.prepare(
        `DELETE FROM interview_sessions WHERE id = ? AND NOT EXISTS (SELECT 1 FROM interview_transcript_segments WHERE session_id = ?)`,
      ).bind(sessionId, sessionId).run();
    }
    if (x instanceof IntakeError) return intakeRefusal(c, x);
    if (/UNIQUE constraint/i.test(x instanceof Error ? x.message : '')) {
      return refuse(c, 409, { code: 'meeting_link_reused', message: 'This call is already attached to an interview.' });
    }
    throw x;
  }
}

async function attachCall(c: C, s: { user: User; scoped: ScopedInterview }, body: Record<string, unknown>) {
  const attach = body.attach && typeof body.attach === 'object' ? body.attach as Record<string, unknown> : null;
  if (body.session_id == null && (body.provider == null || body.provider === 'google_meet')) {
    const target = meetTarget(attach);
    if (target) return attachCalendarMeet(c, s, body, target);
  }
  const link = attachedLink(attach?.join_url);
  if (!link || (body.provider != null && body.provider !== link.provider)) {
    return refuse(c, 400, { code: 'meeting_link_invalid', message: 'Paste a Zoom or Google Meet join link for the call you host.' });
  }
  const sessionId = Number(body.session_id);
  if (!Number.isSafeInteger(sessionId) || sessionId <= 0) {
    return refuse(c, 400, { code: 'session_required', message: 'Start a video recording session before attaching its call.' });
  }
  let session: Awaited<ReturnType<typeof writableSession>>['session'];
  try {
    session = (await writableSession(c.env, s.user.id, sessionId)).session;
  } catch (e) {
    if (e instanceof IntakeError) return intakeRefusal(c, e);
    throw e;
  }
  const meta = await c.env.DB.prepare('SELECT submitted_via FROM interview_sessions WHERE id = ?')
    .bind(sessionId).first<{ submitted_via: string | null }>();
  if (Number(session.interview_id) !== Number(s.scoped.interview.id) || Number(session.created_by_user_id) !== Number(s.user.id)) {
    return refuse(c, 404, { code: 'session_not_found', message: 'That session no longer exists.' });
  }
  if (session.channel !== 'video' || meta?.submitted_via || !['draft', 'recording', 'paused'].includes(session.status)) {
    return refuse(c, 409, { code: 'session_not_recording', message: 'Attach a call to the video recording you are starting.' });
  }
  if (session.consent_status !== 'given' || !session.consent_method) {
    return refuse(c, 409, { code: 'consent_required', message: 'Record consent before attaching a call transcript.' });
  }
  if (!available(c.env, link.provider)) return refuse(c, 503, { code: 'provider_unavailable', message: UNAVAILABLE[link.provider] });
  const zoomConn = link.provider === 'zoom' ? await zoom.zoomConnection(c.env, s.user.id) : null;
  const googleConn = link.provider === 'google_meet' ? await meet.googleConnection(c.env, s.user.id) : null;
  if (!zoomConn && !googleConn) return refuse(c, 409, { code: 'connect_first', message: CONNECT_FIRST[link.provider] });
  try {
    const hosted = zoomConn
      ? await zoom.verifyHostedMeeting(c.env, zoomConn, link.externalRef)
      : await meet.verifyHostedMeet(c.env, googleConn!, link.joinUrl, session.started_at || session.created_at);
    if (!hosted) return refuse(c, 409, { code: 'meeting_not_hosted',
      message: 'Axal can import only a call hosted by the account you connected. Record this call in-app instead.' });
  } catch (e) {
    if (e instanceof MeetingProviderError) return providerRefusal(c, e);
    throw e;
  }
  try {
    const uid = crypto.randomUUID();
    await c.env.DB.prepare(
      `INSERT INTO interview_channel_refs
         (uid, provider, external_ref, session_id, interview_id, user_id, join_url, starts_at, ends_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'scheduled')`,
    ).bind(uid, link.provider, link.externalRef, sessionId, s.scoped.interview.id, s.user.id,
      link.joinUrl, session.started_at || session.created_at).run();
    const ref = await loadRef(c.env, uid);
    return c.json({ meeting: ref ? view(ref) : null, session_id: sessionId,
      notice: { code: 'hosted_transcript_only',
        message: 'Axal will import a transcript only if this connected account hosts the call and the provider makes a transcript. The recording remains a separate session.' } }, 201);
  } catch (e) {
    if (/UNIQUE constraint/i.test(e instanceof Error ? e.message : '')) {
      return refuse(c, 409, { code: 'meeting_link_reused',
        message: 'This meeting link is already attached to an interview. Use a new meeting link for this session.' });
    }
    throw e;
  }
}

meetings.post('/interviews/:id/meetings', async (c) => {
  const s = await scope(c);
  if (s instanceof Response) return s;
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (body?.attach != null) return attachCall(c, s, body);
  const provider = String(body?.provider ?? '') as MeetingProvider;
  if (!(MEETING_PROVIDERS as readonly string[]).includes(provider)) {
    return refuse(c, 400, { code: 'provider_invalid', message: 'Choose Zoom or Google Meet.' });
  }
  const startMs = Date.parse(String(body?.starts_at ?? ''));
  const now = Date.now();
  if (!Number.isFinite(startMs) || startMs < now - PAST_SLACK_MS || startMs > now + MAX_AHEAD_MS) {
    return refuse(c, 400, { code: 'starts_at_invalid', message: 'Choose a start time from now to a year ahead.' });
  }
  const duration = body?.duration_min == null ? 30 : Number(body.duration_min);
  if (!Number.isInteger(duration) || duration < MIN_DURATION || duration > MAX_DURATION) {
    return refuse(c, 400, { code: 'duration_invalid', message: `Choose a length from ${MIN_DURATION} to ${MAX_DURATION} minutes.` });
  }
  // The point of the call is its transcript, and #1470's rule is no consent, no
  // AI over a recording: the interviewee's consent is recorded here, with how
  // it was given, or the call is not scheduled.
  const consent = body?.consent && typeof body.consent === 'object' ? body.consent as Record<string, unknown> : null;
  const consentMethod = String(consent?.method ?? '');
  if (consent?.status !== 'given' || !(CONSENT_METHODS as readonly string[]).includes(consentMethod)) {
    return refuse(c, 400, {
      code: 'consent_required',
      message: 'Record how the interviewee agreed to be recorded and transcribed before you schedule the call.',
      extra: { accepted: CONSENT_METHODS },
    });
  }
  // Neutral by default: the topic is visible to everyone the member invites.
  const topic = String(body?.topic ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TOPIC) || 'Customer interview';
  const input = { topic, startsAt: new Date(startMs).toISOString(), durationMin: duration, autoRecord: body?.auto_record === true };

  if (!available(c.env, provider)) return refuse(c, 503, { code: 'provider_unavailable', message: UNAVAILABLE[provider] });
  const zoomConn = provider === 'zoom' ? await zoom.zoomConnection(c.env, s.user.id) : null;
  const googleConn = provider === 'google_meet' ? await meet.googleConnection(c.env, s.user.id) : null;
  if (!zoomConn && !googleConn) return refuse(c, 409, { code: 'connect_first', message: CONNECT_FIRST[provider] });

  let created: { externalRef: string; joinUrl: string; startsAt: string; endsAt: string };
  try {
    created = zoomConn ? await zoom.createMeeting(c.env, zoomConn, input) : await meet.createMeeting(c.env, googleConn!, input);
  } catch (x) {
    if (x instanceof MeetingProviderError) return providerRefusal(c, x);
    throw x;
  }

  // Scheduling works with Calendar's own scope; reading the transcript later
  // needs Meet's, which no Axal consent asks for yet (#1585), so reconnecting
  // cannot help. Say so now, while the member can still plan to record the
  // call in Axal or paste it afterwards.
  const notice: MeetingErrorCode | null = googleConn && meet.transcriptAccess(googleConn) === 'missing' ? 'meet_transcripts_unavailable' : null;
  const undo = async () => {
    try {
      if (zoomConn) await zoom.cancelMeeting(c.env, zoomConn, created.externalRef);
      else await meet.cancelMeeting(c.env, googleConn!, created.externalRef);
    } catch { /* best-effort: the member can delete it in their calendar */ }
  };

  let sessionId: number | null = null;
  try {
    const session = await openSession(c.env, s.scoped, provider, 'video', { method: consentMethod });
    sessionId = session.id;
    const uid = crypto.randomUUID();
    await c.env.DB.prepare(
      `INSERT INTO interview_channel_refs
         (uid, provider, external_ref, session_id, interview_id, user_id, join_url, starts_at, ends_at, status, last_error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?)`,
    ).bind(uid, provider, created.externalRef, session.id, s.scoped.interview.id, s.user.id, created.joinUrl,
      created.startsAt, created.endsAt, notice ? MEETING_ERRORS[notice] : null).run();
    const ref = await loadRef(c.env, uid);
    let bot=null, bot_error=null;
    if (body?.auto_send_bot !== false) {
      try { bot=await dispatchBot(c.env,s.user,session,{meeting_url:created.joinUrl,scheduled_at:created.startsAt}); }
      catch (e) { bot_error=e instanceof BotError?e.body():{code:'bot_unavailable',message:'Eadwyn AI could not be queued. Open the session to check its status.'}; }
    }
    return c.json({
      bot, bot_error, meeting: ref ? view(ref) : null, session_id: session.id,
      notice: notice ? { code: notice, message: MEETING_ERRORS[notice] } : null,
    }, 201);
  } catch (x) {
    // Nothing half-made stays behind: the call at the provider and the empty session go.
    await undo();
    if (sessionId) {
      await c.env.DB.prepare(
        `DELETE FROM interview_sessions WHERE id = ? AND NOT EXISTS (SELECT 1 FROM interview_transcript_segments WHERE session_id = ?)`,
      ).bind(sessionId, sessionId).run();
    }
    if (x instanceof IntakeError) return intakeRefusal(c, x);
    if (/UNIQUE constraint/i.test(x instanceof Error ? x.message : '')) {
      return refuse(c, 409, { code: 'meeting_conflict', message: 'The provider gave this call an id Axal already holds. Schedule it again.' });
    }
    throw x;
  }
});

// ---------------------------------------------------------------------------
// Cancelling
// ---------------------------------------------------------------------------

meetings.delete('/interviews/:id/meetings/:refUid', async (c) => {
  const s = await scope(c);
  if (s instanceof Response) return s;
  const ref = await memberRef(c.env, s.user.id, s.scoped.interview.id, c.req.param('refUid'));
  if (!ref) return refuse(c, 404, { code: 'meeting_not_found', message: 'That call no longer exists.' });
  try { await stopSessionBot(c.env,ref.session_id,s.user.id); }
  catch { return refuse(c,503,{code:'bot_stop_pending',message:'Eadwyn AI is still stopping. Try cancelling the call again.'}); }
  if (ref.status === 'cancelled') return c.json({ meeting: view(ref), provider_cancelled: view(ref).provider_cancelled });
  if (ref.status === 'imported') {
    return refuse(c, 409, { code: 'already_imported', message: 'This call’s transcript is already in the interview. Delete the session instead.' });
  }
  // Only a call still to come is cancelled at the provider; a past one is just set aside.
  let providerCancelled: boolean | null = null;
  const upcoming = ref.status === 'scheduled' && Date.parse(String(ref.ends_at ?? '')) > Date.now();
  if (upcoming) {
    providerCancelled = false;
    try {
      const attached = await c.env.DB.prepare('SELECT submitted_via FROM interview_sessions WHERE id = ?')
        .bind(ref.session_id).first<{ submitted_via: string | null }>();
      if (!attached?.submitted_via) providerCancelled = null;
      else if (ref.provider === 'zoom') {
        const conn = await zoom.zoomConnection(c.env, s.user.id);
        if (conn) providerCancelled = await zoom.cancelMeeting(c.env, conn, ref.external_ref);
      } else {
        const conn = await meet.googleConnection(c.env, s.user.id);
        if (conn) providerCancelled = await meet.cancelMeeting(c.env, conn, ref.external_ref);
      }
    } catch { /* stays false: the page tells the member to cancel it there too */ }
  }
  await cancelRef(c.env, ref.id, providerCancelled === false ? (ref.provider === 'zoom' ? 'zoom_cancel_unconfirmed' : 'meet_cancel_unconfirmed') : providerCancelled === true ? (ref.provider === 'zoom' ? 'zoom_cancel_confirmed' : 'meet_cancel_confirmed') : null);
  const fresh = await loadRef(c.env, ref.uid);
  return c.json({ meeting: fresh ? view(fresh) : null, provider_cancelled: providerCancelled });
});

// ---------------------------------------------------------------------------
// Importing now
// ---------------------------------------------------------------------------

meetings.post('/interviews/:id/meetings/:refUid/import', async (c) => {
  const s = await scope(c);
  if (s instanceof Response) return s;
  const ref = await memberRef(c.env, s.user.id, s.scoped.interview.id, c.req.param('refUid'));
  if (!ref) return refuse(c, 404, { code: 'meeting_not_found', message: 'That call no longer exists.' });
  if (ref.status === 'cancelled') return refuse(c, 409, { code: 'meeting_cancelled', message: 'This call was cancelled.' });
  if (ref.status === 'imported' && (ref.provider !== 'zoom' || zoom.instanceOf(ref))) {
    return refuse(c, 409, { code: 'already_imported', message: 'This call’s transcript is already in the interview.' });
  }
  if (!ref.ends_at || Date.parse(ref.ends_at) > Date.now()) {
    return refuse(c, 409, { code: 'call_not_over', message: 'The call has not ended yet. Its transcript can be fetched after it ends.' });
  }
  if (!available(c.env, ref.provider)) return refuse(c, 503, { code: 'provider_unavailable', message: UNAVAILABLE[ref.provider] });
  // Run here rather than queued: the member pressed the button and waits for the answer.
  const outcome = await IMPORTERS[ref.provider](c.env, ref, {});
  const fresh = await loadRef(c.env, ref.uid);
  if (!fresh) return refuse(c, 404, { code: 'meeting_not_found', message: 'That call no longer exists.' });
  return c.json({ meeting: view(fresh), outcome: outcome.status, segments: outcome.segments });
});

// ---------------------------------------------------------------------------
// A Meet call's recording (D871)
// ---------------------------------------------------------------------------

/**
 * The Drive recordings of the member's own Meet call, read live from Meet with
 * their grant, for "Download it, then upload it here". Axal never fetches the
 * file: that would need a Drive scope (#2518, question 1).
 */
meetings.get('/interviews/:id/meetings/:refUid/recording', async (c) => {
  const s = await scope(c);
  if (s instanceof Response) return s;
  const ref = await memberRef(c.env, s.user.id, s.scoped.interview.id, c.req.param('refUid'));
  if (!ref || ref.provider !== 'google_meet') return refuse(c, 404, { code: 'meeting_not_found', message: 'That call no longer exists.' });
  if (ref.status === 'cancelled') return refuse(c, 409, { code: 'meeting_cancelled', message: 'This call was cancelled.' });
  if (!available(c.env, 'google_meet')) return refuse(c, 503, { code: 'provider_unavailable', message: UNAVAILABLE.google_meet });
  const got = await meet.meetRecordingLinks(c.env, ref);
  if ('fail' in got) return providerRefusal(c, new MeetingProviderError(got.fail, got.retryable));
  return c.json({ recordings: got.recordings });
});

export default meetings;

// ---------------------------------------------------------------------------
// The Zoom webhook (public)
// ---------------------------------------------------------------------------

/**
 * Mounted on `/api/channels` (so it answers `POST /api/channels/zoom/webhook`),
 * outside `requireAuth`. The body is read once, raw, capped before parsing —
 * the signature is over those exact bytes.
 */
export const zoomWebhook = new Hono<{ Bindings: Env }>();

zoomWebhook.post('/zoom/webhook', async (c) => {
  // Counted as it arrives: a body without Content-Length is never buffered whole.
  const buf = await readCappedBody(c.req.raw);
  if (!buf) return c.json({ error: 'too_large', message: 'The request body is too large.' }, 413);
  const reply = await zoom.handleZoomWebhook(c.env, new TextDecoder().decode(buf), c.req.raw.headers);
  return c.json(reply.body, reply.status);
});
