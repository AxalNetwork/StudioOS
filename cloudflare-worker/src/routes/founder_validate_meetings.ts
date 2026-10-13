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
import { IntakeError, openSession, writableInterview, type ScopedInterview } from '../services/interviewIntake';
import { providerAvailable } from '../services/channels/connections';
import { MEETING_PROVIDERS, PROVIDER_LABEL, CHANNEL_LIMITS, type MeetingProvider } from '../services/channels/types';
import {
  MEETING_ERRORS, MeetingProviderError, cancelRef, importMeetingRef, loadRef, meetingView, memberRef,
  type MeetingErrorCode, type MeetingRef, type TranscriptFetcher,
} from '../services/channels/meetings';
import * as zoom from '../services/channels/zoom';
import * as meet from '../services/channels/googleMeet';
import { googleOAuthAvailable } from '../services/calendar';

const meetings = new Hono<{ Bindings: Env }>();
type C = Context<{ Bindings: Env }>;

const FETCHERS: Record<MeetingProvider, TranscriptFetcher> = { zoom: zoom.fetchTranscript, google_meet: meet.fetchTranscript };

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
    : /_(not_connected|reconnect|scope_missing)$/.test(failure.code) ? 409 : 502;
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
  const rows = (await c.env.DB.prepare(
    `SELECT * FROM interview_channel_refs WHERE interview_id = ? AND user_id = ?
      ORDER BY datetime(COALESCE(starts_at, created_at)) DESC, id DESC LIMIT 100`,
  ).bind(s.scoped.interview.id, s.user.id).all<MeetingRef>()).results ?? [];
  const google = await meet.googleConnection(c.env, s.user.id);
  const providers = [
    { provider: 'zoom' as const, label: PROVIDER_LABEL.zoom, available: available(c.env, 'zoom'),
      connected: await zoomConnected(c.env, s.user.id), transcript_access: null },
    { provider: 'google_meet' as const, label: PROVIDER_LABEL.google_meet, available: available(c.env, 'google_meet'),
      connected: !!google, transcript_access: meet.transcriptAccess(google) },
  ];
  return c.json({ meetings: rows.map(view), providers });
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

meetings.post('/interviews/:id/meetings', async (c) => {
  const s = await scope(c);
  if (s instanceof Response) return s;
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
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
  // needs Meet's. Say so now, while the member can still reconnect in time.
  const notice: MeetingErrorCode | null = googleConn && meet.transcriptAccess(googleConn) === 'missing' ? 'meet_scope_missing' : null;
  const undo = async () => {
    try {
      if (zoomConn) await zoom.cancelMeeting(c.env, zoomConn, created.externalRef);
      else await meet.cancelMeeting(c.env, googleConn!, created.externalRef);
    } catch { /* best-effort: the member can delete it in their calendar */ }
  };

  let sessionId: number | null = null;
  try {
    const session = await openSession(c.env, s.scoped, provider, 'video');
    sessionId = session.id;
    const uid = crypto.randomUUID();
    await c.env.DB.prepare(
      `INSERT INTO interview_channel_refs
         (uid, provider, external_ref, session_id, interview_id, user_id, join_url, starts_at, ends_at, status, last_error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?)`,
    ).bind(uid, provider, created.externalRef, session.id, s.scoped.interview.id, s.user.id, created.joinUrl,
      created.startsAt, created.endsAt, notice ? MEETING_ERRORS[notice] : null).run();
    const ref = await loadRef(c.env, uid);
    return c.json({
      meeting: ref ? view(ref) : null, session_id: session.id,
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
  if (ref.status === 'cancelled') return c.json({ meeting: view(ref), provider_cancelled: null });
  if (ref.status === 'imported') {
    return refuse(c, 409, { code: 'already_imported', message: 'This call’s transcript is already in the interview. Delete the session instead.' });
  }
  // Only a call still to come is cancelled at the provider; a past one is just set aside.
  let providerCancelled: boolean | null = null;
  const upcoming = ref.status === 'scheduled' && Date.parse(String(ref.ends_at ?? '')) > Date.now();
  if (upcoming) {
    providerCancelled = false;
    try {
      if (ref.provider === 'zoom') {
        const conn = await zoom.zoomConnection(c.env, s.user.id);
        if (conn) providerCancelled = await zoom.cancelMeeting(c.env, conn, ref.external_ref);
      } else {
        const conn = await meet.googleConnection(c.env, s.user.id);
        if (conn) providerCancelled = await meet.cancelMeeting(c.env, conn, ref.external_ref);
      }
    } catch { /* stays false: the page tells the member to cancel it there too */ }
  }
  await cancelRef(c.env, ref.id);
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
  if (ref.status === 'imported') {
    return refuse(c, 409, { code: 'already_imported', message: 'This call’s transcript is already in the interview.' });
  }
  if (Date.parse(String(ref.ends_at ?? '')) > Date.now()) {
    return refuse(c, 409, { code: 'call_not_over', message: 'The call has not ended yet. Its transcript can be fetched after it ends.' });
  }
  if (!available(c.env, ref.provider)) return refuse(c, 503, { code: 'provider_unavailable', message: UNAVAILABLE[ref.provider] });
  // Run here rather than queued: the member pressed the button and waits for the answer.
  const outcome = await importMeetingRef(c.env, ref, FETCHERS[ref.provider]);
  const fresh = await loadRef(c.env, ref.uid);
  if (!fresh) return refuse(c, 404, { code: 'meeting_not_found', message: 'That call no longer exists.' });
  return c.json({ meeting: view(fresh), outcome: outcome.status, segments: outcome.segments });
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
  const tooLarge = () => c.json({ error: 'too_large', message: 'The request body is too large.' }, 413);
  if (Number(c.req.header('content-length') || 0) > CHANNEL_LIMITS.maxBodyBytes) return tooLarge();
  const buf = await c.req.arrayBuffer();
  if (buf.byteLength > CHANNEL_LIMITS.maxBodyBytes) return tooLarge();
  const reply = await zoom.handleZoomWebhook(c.env, new TextDecoder().decode(buf), c.req.raw.headers);
  return c.json(reply.body, reply.status);
});
