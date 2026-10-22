/**
 * D875 (#2522) — Meeting Capture for Record a Session: is the member set up to
 * have their Zoom and Google Meet calls transcribed into an interview, and
 * which of their upcoming calls can be.
 *
 * SETUP, FROM STORED ROWS. Each provider's steps are read from what Axal
 * already keeps — the deployment's secrets and vars, the member's
 * `integrations` row for Zoom, their `google_oauth_tokens` row and its granted
 * scopes — so the read never calls Zoom or Google. A step is `done`, `todo`
 * (the member's move, in one sentence) or `blocked` (an earlier step, or the
 * owner, comes first), as D863's Telegram setup reads. What the provider
 * itself requires and Axal cannot see (Zoom's paid plan and transcript
 * setting, Meet's Workspace edition) is a prerequisite with a null state.
 *
 *   Zoom          1 set_up       the three Zoom secrets on this deployment (runbook §1 step 5)
 *                 2 app_open     ZOOM_APP_AUDIENCE: the app open to this member (§1 step 7)
 *                 3 connected    the member's active Zoom connection
 *   Google Meet   1 set_up       the Google Calendar OAuth client on this deployment
 *                 2 connected    the member's Google connection
 *                 3 transcripts  `meetings.space.readonly` granted (`meet_transcripts` of GET /api/calendar/google/status)
 *
 * UPCOMING, FROM THE MEMBER'S OWN CALENDAR. The next 14 days of events on the
 * member's primary Google Calendar that carry a Meet conference or a Zoom join
 * link and are not yet attached to any interview. Each call is its title,
 * start and end, provider and join link, and what attaching it needs. Never an
 * attendee, an organizer's address, a description or a location: the
 * description and location are read only to find a Zoom link, then dropped.
 * A Zoom meeting cannot be read from Google, so whether the member hosts it
 * is checked when it is attached (`verifyHostedMeeting`); a Meet call is
 * offered only when the member organizes it, as `verifyHostedMeet` requires.
 */
import type { Env } from '../../types';
import { zoomDistribution } from '../../integrations/registry';
import { googleOAuthAvailable } from '../calendar';
import { meetTranscriptsState } from '../../routes/calendar';
import type { MeetingProvider } from './types';
import { zoomConfigured, zoomConnection } from './zoom';
import { accessToken, calendarFetch, googleConnection, meetingCodeOf } from './googleMeet';
import { MeetingProviderError } from './meetings';

export type SetupState = 'done' | 'todo' | 'blocked';

export interface SetupStep {
  step: number;
  key: string;
  state: SetupState;
  code: string;
  /** What to do, in our words; null once the step is done. */
  action: string | null;
}

/** Our sentence for each code a step can be left at. */
export const MEETING_SETUP_ACTIONS: Readonly<Record<string, string>> = Object.freeze({
  zoom_not_set_up: 'Zoom calls are not available on Axal yet. Nothing is needed from you; Axal will switch this on.',
  zoom_own_account: 'Zoom has not approved Axal for other Zoom accounts yet. Record the call in Axal, or upload its recording, until it does.',
  zoom_beta: 'Zoom is open to invited founders only for now. If you were not invited, record the call in Axal or upload its recording.',
  zoom_not_connected: 'Connect Zoom in Account › Connectors.',
  needs_zoom: 'Zoom must be available on Axal first.',
  google_not_set_up: 'Google Meet calls are not available on Axal yet. Nothing is needed from you; Axal will switch this on.',
  google_not_connected: 'Connect Google in Account › Connectors.',
  needs_google: 'Connect Google first.',
  meet_transcripts_not_set_up: 'Importing Meet transcripts is not switched on at Axal yet. Nothing is needed from you; until then, record the call in Axal or upload its recording.',
  meet_scope_missing: 'Press Allow transcript import in Account › Connectors, so Axal can read the transcripts of your Meet calls.',
  meet_scope_unknown: 'Press Allow transcript import in Account › Connectors once, so Axal knows it may read your Meet transcripts.',
});

/** What each provider asks of the member's own account, which Axal cannot see. */
export const MEETING_PREREQUISITES: Readonly<Record<MeetingProvider, { key: string; line: string }>> = Object.freeze({
  zoom: { key: 'zoom_cloud_transcript', line: 'Needs a paid Zoom plan with cloud recording on, and "Create audio transcript" turned on in Zoom › Settings › Recording.' },
  google_meet: { key: 'meet_transcription', line: 'Needs a Google Workspace edition with Meet transcription, and someone in the call turns transcription on.' },
});

function step(n: number, key: string, state: SetupState, code: string): SetupStep {
  return { step: n, key, state, code, action: state === 'done' ? null : MEETING_SETUP_ACTIONS[code] ?? null };
}

function summary(provider: MeetingProvider, steps: SetupStep[]) {
  return {
    steps,
    prerequisites: [{ ...MEETING_PREREQUISITES[provider], state: null }],
    next: steps.find((s) => s.state !== 'done')?.key ?? null,
    ready: steps.every((s) => s.state === 'done'),
  };
}

/** The Zoom and Google Meet setup, read from stored rows only. */
export async function meetingSetup(env: Env, userId: number) {
  // ── Zoom ──
  const zoomUp = zoomConfigured(env);
  const zoomConn = zoomUp ? await zoomConnection(env, userId) : null;
  const audience = zoomDistribution(env.ZOOM_APP_AUDIENCE);
  const zoomSetUp = zoomUp ? step(1, 'set_up', 'done', 'zoom_set_up') : step(1, 'set_up', 'blocked', 'zoom_not_set_up');
  // A member who connected is inside the app's distribution, whatever the var says.
  const zoomOpen = !zoomUp ? step(2, 'app_open', 'blocked', 'needs_zoom')
    : zoomConn || audience === 'public' ? step(2, 'app_open', 'done', 'zoom_open')
      : audience === 'beta' ? step(2, 'app_open', 'todo', 'zoom_beta') : step(2, 'app_open', 'blocked', 'zoom_own_account');
  const zoomConnected = !zoomUp ? step(3, 'connected', 'blocked', 'needs_zoom')
    : zoomConn ? step(3, 'connected', 'done', 'zoom_connected') : step(3, 'connected', 'todo', 'zoom_not_connected');

  // ── Google Meet ──
  const googleUp = googleOAuthAvailable(env);
  const googleConn = googleUp ? await googleConnection(env, userId) : null;
  const googleSetUp = googleUp ? step(1, 'set_up', 'done', 'google_set_up') : step(1, 'set_up', 'blocked', 'google_not_set_up');
  const googleConnected = !googleUp ? step(2, 'connected', 'blocked', 'google_not_set_up')
    : googleConn ? step(2, 'connected', 'done', 'google_connected') : step(2, 'connected', 'todo', 'google_not_connected');
  // The status endpoint's own reading of the grant (`meet_transcripts`), then whether the scopes were recorded at all.
  const scopeState = googleConn ? meetTranscriptsState(env, googleConn.scope) : null;
  const recorded = !!googleConn && googleConn.scope.split(/[\s,]+/).filter(Boolean).length > 0;
  const transcripts = !googleUp ? step(3, 'transcripts', 'blocked', 'google_not_set_up')
    : !googleConn ? step(3, 'transcripts', 'blocked', 'needs_google')
      : scopeState === 'granted' ? step(3, 'transcripts', 'done', 'meet_transcripts_granted')
        : scopeState === 'not_set_up' ? step(3, 'transcripts', 'blocked', 'meet_transcripts_not_set_up')
          : step(3, 'transcripts', 'todo', recorded ? 'meet_scope_missing' : 'meet_scope_unknown');

  return {
    zoom: { ...summary('zoom', [zoomSetUp, zoomOpen, zoomConnected]), audience },
    google_meet: { ...summary('google_meet', [googleSetUp, googleConnected, transcripts]), meet_transcripts: scopeState },
  };
}

// ---------------------------------------------------------------------------
// Upcoming calls
// ---------------------------------------------------------------------------

export const UPCOMING_DAYS = 14;
const MAX_PAGES = 4;
/** Only what this read needs from each event; attendees and the organizer's address are never asked for. */
const EVENT_FIELDS = 'items(id,status,summary,start,end,hangoutLink,location,description,organizer(self),conferenceData(entryPoints(entryPointType,uri))),nextPageToken';

interface CalendarItem {
  id?: string;
  status?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  hangoutLink?: string;
  location?: string;
  description?: string;
  organizer?: { self?: boolean };
  conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> };
}

const ZOOM_LINK = /https:\/\/((?:[a-z0-9-]+\.)?zoom\.us)\/j\/(\d{6,20})/i;

/**
 * A Zoom join link and its meeting id, from the conference, else the location,
 * else the description. The link is rebuilt from the host and the id, so a
 * passcode (`?pwd=`) is never returned: attaching needs only the id.
 */
export function zoomLinkOf(item: CalendarItem): { joinUrl: string; externalRef: string } | null {
  for (const raw of [...(item.conferenceData?.entryPoints ?? []).map((e) => e.uri), item.location, item.description]) {
    const m = ZOOM_LINK.exec(String(raw ?? ''));
    if (m) return { joinUrl: `https://${m[1].toLowerCase()}/j/${m[2]}`, externalRef: m[2] };
  }
  return null;
}

function meetLinkOf(item: CalendarItem): { joinUrl: string; externalRef: string } | null {
  const video = item.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri;
  const url = [video, item.hangoutLink].find((u) => u && meetingCodeOf(u) && /^https:\/\//.test(u));
  const code = url ? meetingCodeOf(url) : null;
  return url && code ? { joinUrl: `https://meet.google.com/${code}`, externalRef: code } : null;
}

export interface UpcomingCall {
  provider: MeetingProvider;
  title: string | null;
  starts_at: string;
  ends_at: string | null;
  join_url: string;
  /** How to attach it to an interview, or null and why not. */
  attach: { method: 'POST'; path: string; body: { attach: { join_url: string }; session_id: null }; needs: string[] } | null;
  attach_blocked: string | null;
}

/** Our words for a call that cannot be attached from here. */
export const ATTACH_BLOCKED: Readonly<Record<string, string>> = Object.freeze({
  meet_not_organizer: 'Axal can import only a Meet call you organize. Ask the organizer for the transcript, or record the call in Axal.',
  zoom_not_connected: 'Connect Zoom to attach this call.',
  zoom_not_set_up: 'Zoom calls are not available on Axal yet.',
});

/**
 * The member's own upcoming calls in the next 14 days, not yet attached. A
 * member with no Google connection has none to list (`connected: false`).
 * Throws `MeetingProviderError` when Google refuses or cannot be reached.
 */
export async function upcomingCalls(env: Env, userId: number, now = Date.now()): Promise<{ connected: boolean; calls: UpcomingCall[] }> {
  if (!googleOAuthAvailable(env)) return { connected: false, calls: [] };
  const conn = await googleConnection(env, userId);
  if (!conn) return { connected: false, calls: [] };
  const token = await accessToken(env, userId);
  const zoomUp = zoomConfigured(env);
  const zoomOn = zoomUp && !!(await zoomConnection(env, userId));

  const found: Array<{ item: CalendarItem; provider: MeetingProvider; joinUrl: string; externalRef: string }> = [];
  let pageToken = '';
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = new URLSearchParams({
      singleEvents: 'true', orderBy: 'startTime', showDeleted: 'false', maxResults: '250', fields: EVENT_FIELDS,
      timeMin: new Date(now).toISOString(), timeMax: new Date(now + UPCOMING_DAYS * 86_400_000).toISOString(),
      ...(pageToken ? { pageToken } : {}),
    });
    const res = await calendarFetch(token, `/calendars/primary/events?${q}`);
    if (res.status === 401 || res.status === 403) throw new MeetingProviderError('meet_reconnect', false);
    if (!res.ok) throw new MeetingProviderError('meet_unreachable', true);
    const body = await res.json().catch(() => null) as { items?: CalendarItem[]; nextPageToken?: string } | null;
    for (const item of body?.items ?? []) {
      // A cancelled event, or an all-day one (no time), is not a call.
      if (item.status === 'cancelled' || !item.start?.dateTime) continue;
      const meet = meetLinkOf(item);
      const zoom = meet ? null : zoomLinkOf(item);
      const link = meet ?? zoom;
      if (link) found.push({ item, provider: meet ? 'google_meet' : 'zoom', ...link });
    }
    pageToken = String(body?.nextPageToken || '');
    if (!pageToken) break;
  }
  if (!found.length) return { connected: true, calls: [] };

  // A call already held for an interview (any member, any state: one row per call) is not offered again.
  const held = new Set(((await env.DB.prepare(
    `SELECT provider, external_ref FROM interview_channel_refs
      WHERE provider || ':' || external_ref IN (SELECT value FROM json_each(?))`,
  ).bind(JSON.stringify(found.map((f) => `${f.provider}:${f.externalRef}`))).all<{ provider: string; external_ref: string }>()).results ?? [])
    .map((r) => `${r.provider}:${r.external_ref}`));

  const calls: UpcomingCall[] = [];
  for (const f of found) {
    if (held.has(`${f.provider}:${f.externalRef}`)) continue;
    const blocked = f.provider === 'google_meet'
      ? (f.item.organizer?.self === true ? null : 'meet_not_organizer')
      : !zoomUp ? 'zoom_not_set_up' : zoomOn ? null : 'zoom_not_connected';
    const title = String(f.item.summary ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) || null;
    calls.push({
      provider: f.provider,
      title,
      starts_at: new Date(Date.parse(f.item.start!.dateTime!)).toISOString(),
      ends_at: f.item.end?.dateTime ? new Date(Date.parse(f.item.end.dateTime)).toISOString() : null,
      join_url: f.joinUrl,
      attach: blocked ? null : {
        method: 'POST',
        path: '/api/founder/validate/interviews/:interview_id/meetings',
        body: { attach: { join_url: f.joinUrl }, session_id: null },
        needs: ['interview_id', 'session_id'],
      },
      attach_blocked: blocked ? ATTACH_BLOCKED[blocked] : null,
    });
  }
  return { connected: true, calls };
}

