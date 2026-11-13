/**
 * D1359 — "Create the meeting for me" for Microsoft Teams, on the member's own
 * Microsoft calendar connection (`microsoft_oauth_tokens`, with
 * `Calendars.ReadWrite`). It creates an Outlook event starting now with a
 * Teams meeting on it (`isOnlineMeeting`, `teamsForBusiness`) and answers its
 * join link only.
 *
 * A Teams meeting made this way needs a work or school Microsoft 365 account.
 * A personal account's event comes back with no Teams link: that event is
 * deleted again and the member is told to create the meeting in Teams.
 *
 * No token, event id or Microsoft text leaves this file: the caller gets a
 * join link or one of our own codes.
 */
import type { Env } from '../../types';
import {
  loadRefreshTokenExport, microsoftOAuthAvailable, reencryptRefreshTokenExport, refreshMicrosoftAccessToken,
} from '../calendar';

const GRAPH = 'https://graph.microsoft.com/v1.0';
const TIMEOUT_MS = 10_000;

export const TEAMS_ERRORS = {
  teams_not_connected: 'Connect Microsoft in Account › Connectors first, then create the meeting.',
  teams_reconnect: 'Microsoft no longer accepts Axal’s access. Reconnect Microsoft in Account › Connectors, then retry.',
  teams_personal_account: 'This Microsoft account cannot create Teams meetings from Axal: that needs a work or school Microsoft 365 account. Create the meeting in Microsoft Teams and paste its link.',
  teams_create_failed: 'Microsoft did not create the Teams meeting. Create it in Microsoft Teams and paste its link.',
  teams_unreachable: 'Microsoft did not answer. Try again in a minute.',
} as const;
export type TeamsErrorCode = keyof typeof TEAMS_ERRORS;
const STATUS: Record<TeamsErrorCode, number> = {
  teams_not_connected: 409, teams_reconnect: 409, teams_personal_account: 409, teams_create_failed: 502, teams_unreachable: 503,
};

export class TeamsMeetingError extends Error {
  readonly code: TeamsErrorCode;
  readonly status: number;
  constructor(code: TeamsErrorCode) { super(code); this.code = code; this.status = STATUS[code]; }
}

/** Whether Teams meetings can be made on this deployment at all: the Microsoft calendar client is configured. */
export function teamsCreateAvailable(env: Env): boolean {
  return microsoftOAuthAvailable(env);
}

/** Whether the member has connected Microsoft (the calendar connection). Unknown table or row: no. */
export async function microsoftConnected(env: Env, userId: number): Promise<boolean> {
  try {
    return !!(await env.DB.prepare('SELECT 1 AS ok FROM microsoft_oauth_tokens WHERE user_id = ?').bind(userId).first());
  } catch { return false; }
}

async function accessToken(env: Env, userId: number): Promise<string> {
  const tok = await loadRefreshTokenExport(env, 'microsoft_oauth_tokens', userId);
  if (!tok) throw new TeamsMeetingError('teams_not_connected');
  let token: string;
  try {
    token = await refreshMicrosoftAccessToken(env, tok.raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (/^refresh_failed:(400|401)$/.test(msg)) throw new TeamsMeetingError('teams_reconnect');
    throw new TeamsMeetingError('teams_unreachable');
  }
  if (!token) throw new TeamsMeetingError('teams_unreachable');
  if (tok.wasPlaintext) await reencryptRefreshTokenExport(env, 'microsoft_oauth_tokens', userId, tok.raw);
  return token;
}

/** A link on Teams' own hosts, re-serialised; anything else is not a Teams join link. */
export function teamsJoinUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 4096) return null;
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    if (u.protocol !== 'https:' || u.username || u.password) return null;
    return host === 'teams.microsoft.com' || host === 'teams.live.com' || host === 'teams.cloud.microsoft' ? u.toString() : null;
  } catch { return null; }
}

const graphTime = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, '');

async function graph(token: string, path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(`${GRAPH}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch { throw new TeamsMeetingError('teams_unreachable'); }
}

/**
 * A Teams meeting starting now on the member's own Microsoft account, for
 * `durationMin` minutes. Returns the join link only.
 */
export async function createTeamsMeeting(
  env: Env, userId: number, input: { topic: string; durationMin: number }, now = Date.now(),
): Promise<{ joinUrl: string }> {
  const token = await accessToken(env, userId);
  const res = await graph(token, '/me/events', {
    method: 'POST',
    body: JSON.stringify({
      subject: input.topic,
      start: { dateTime: graphTime(now), timeZone: 'UTC' },
      end: { dateTime: graphTime(now + input.durationMin * 60_000), timeZone: 'UTC' },
      isOnlineMeeting: true,
      onlineMeetingProvider: 'teamsForBusiness',
    }),
  });
  if (res.status === 401 || res.status === 403) throw new TeamsMeetingError('teams_reconnect');
  if (res.status === 429 || res.status >= 500) throw new TeamsMeetingError('teams_unreachable');
  if (!res.ok) throw new TeamsMeetingError('teams_create_failed');
  const event = await res.json().catch(() => null) as { id?: unknown; onlineMeeting?: { joinUrl?: unknown } | null } | null;
  const joinUrl = teamsJoinUrl(event?.onlineMeeting?.joinUrl);
  if (joinUrl) return { joinUrl };
  // An event with no Teams meeting (a personal account): do not leave it in their calendar.
  if (typeof event?.id === 'string' && event.id) {
    await graph(token, `/me/events/${encodeURIComponent(event.id)}`, { method: 'DELETE' }).catch(() => undefined);
  }
  throw new TeamsMeetingError(event?.id ? 'teams_personal_account' : 'teams_create_failed');
}
