/**
 * Calendar service — port of backend/app/services/calendar_unified.py.
 *
 * Two responsibilities:
 *   1. Aggregator — fetch the signed-in user's events across IC meetings and
 *      founder check-ins (the only bookable surfaces present in worker D1).
 *   2. OAuth + push-sync — Google Calendar v3 and Microsoft Graph v1.0.
 *
 * Both providers expose the same eight functions (status check, auth-URL,
 * token exchange, refresh, userinfo, push event, delete event, sync user).
 * They are kept as side-by-side pairs (no shared interface) so each
 * provider's quirks stay legible.
 */
import type { Env } from '../types';
import { getSQL } from '../db';
import { encryptString, decryptString } from './cryptoBox';

/**
 * Refresh tokens were originally written in plaintext and migrated to
 * AES-GCM via cryptoBox. Reads first attempt decryption; if that fails
 * (legacy plaintext row, or any malformed blob), the value is returned
 * verbatim. After a successful sync the caller re-encrypts the row so
 * each user transparently rolls forward.
 */
async function loadRefreshToken(
  env: Env, table: 'google_oauth_tokens' | 'microsoft_oauth_tokens', userId: number,
): Promise<{ raw: string; wasPlaintext: boolean } | null> {
  const sql = getSQL(env);
  const rows = await sql.unsafe(
    `SELECT refresh_token FROM ${table} WHERE user_id = ?`, [userId],
  ) as any[];
  const row = rows[0];
  if (!row?.refresh_token) return null;
  const stored: string = row.refresh_token;
  const decrypted = await decryptString(env, stored);
  if (decrypted) return { raw: decrypted, wasPlaintext: false };
  // decryptString returns null on any failure (wrong key, malformed,
  // legacy plaintext). Fall back to the raw value so existing connections
  // keep working through the migration. We log a one-line warning so ops
  // can tell apart "still migrating" from "secret rotated / misconfigured"
  // — the latter shows up as a flood of fallbacks for already-migrated rows.
  console.warn(`[CAL] refresh_token decrypt fallback table=${table} user=${userId} (legacy plaintext or wrong key)`);
  return { raw: stored, wasPlaintext: true };
}

async function reencryptRefreshToken(
  env: Env, table: 'google_oauth_tokens' | 'microsoft_oauth_tokens',
  userId: number, plaintext: string,
): Promise<void> {
  try {
    const enc = await encryptString(env, plaintext);
    const sql = getSQL(env);
    await sql.unsafe(
      `UPDATE ${table} SET refresh_token = ? WHERE user_id = ?`,
      [enc, userId],
    );
  } catch (e: any) {
    console.warn('[CAL] reencrypt failed:', e?.message || e);
  }
}

// ===========================================================================
// Google constants
// ===========================================================================
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
];

// ===========================================================================
// Microsoft constants — Graph v1.0 + Azure AD v2 endpoints. Tenant defaults
// to "common" so personal + work/school accounts both work.
// ===========================================================================
const MICROSOFT_AUTHORITY = 'https://login.microsoftonline.com';
const MICROSOFT_GRAPH = 'https://graph.microsoft.com/v1.0';
const MICROSOFT_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'Calendars.ReadWrite',
  'User.Read',
];

function msTenant(env: Env): string {
  return env.MICROSOFT_TENANT_ID || 'common';
}
function msAuthorize(env: Env): string {
  return `${MICROSOFT_AUTHORITY}/${msTenant(env)}/oauth2/v2.0/authorize`;
}
function msToken(env: Env): string {
  return `${MICROSOFT_AUTHORITY}/${msTenant(env)}/oauth2/v2.0/token`;
}

// ---------------------------------------------------------------------------
// Redirect-URI resolution. Task #5 (DC) — the explicit
// GOOGLE_CALENDAR_REDIRECT_URI / MICROSOFT_CALENDAR_REDIRECT_URI env vars
// remain authoritative when set (so an operator can override per-env without
// a redeploy), but if absent we derive the canonical URI from APP_URL. That
// makes the worker self-bootstrapping on production where APP_URL =
// https://axal.vc and removes the failure mode where a missing redirect var
// makes the provider unconfigured even though the rest of the OAuth client is
// in place.
// ---------------------------------------------------------------------------
// Task #35 — PUBLIC_BASE_URL is the canonical source of truth for the
// public app origin; APP_URL is kept as a back-compat alias. Either
// resolves the OAuth redirect URI; PUBLIC_BASE_URL wins when both are
// set.
function appBase(env: Env): string {
  const e = env as Env & { PUBLIC_BASE_URL?: string };
  return ((e.PUBLIC_BASE_URL || e.APP_URL || '')).replace(/\/+$/, '');
}
// Reject any override that still points at the workers.dev sandbox in
// production — a stale env var set before Task #5 (DC) would otherwise
// regenerate a workers.dev consent screen and the browser would round-
// trip through the new 410-Gone callback guard, breaking the connect.
function isProd(env: Env): boolean {
  const e = String((env as { ENVIRONMENT?: string }).ENVIRONMENT || '').toLowerCase();
  return e === 'production' || e === 'prod';
}
function overrideAcceptable(env: Env, override: string | undefined): string | null {
  if (!override) return null;
  if (isProd(env)) {
    try {
      const host = new URL(override).hostname.toLowerCase();
      if (host.endsWith('.workers.dev')) return null;
    } catch { return null; }
  }
  return override;
}
export function googleRedirectUri(env: Env): string {
  const ov = overrideAcceptable(env, env.GOOGLE_CALENDAR_REDIRECT_URI);
  if (ov) return ov;
  const base = appBase(env);
  return base ? `${base}/api/calendar/google/callback` : '';
}
export function microsoftRedirectUri(env: Env): string {
  const ov = overrideAcceptable(env, env.MICROSOFT_CALENDAR_REDIRECT_URI);
  if (ov) return ov;
  const base = appBase(env);
  return base ? `${base}/api/calendar/microsoft/callback` : '';
}

// ---------------------------------------------------------------------------
// Availability checks. Provider is "available" only when every required
// secret is present and a redirect URI can be resolved (explicit env var OR
// derived from APP_URL).
// ---------------------------------------------------------------------------
export function googleOAuthAvailable(env: Env): boolean {
  return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && googleRedirectUri(env));
}
export function microsoftOAuthAvailable(env: Env): boolean {
  return !!(env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET && microsoftRedirectUri(env));
}

/**
 * Task #35 — pre-flight check that the server has every secret needed to
 * start an OAuth round-trip. Returning the `missing` list lets an admin
 * fix the config without reading worker logs. Lives here (not in
 * routes/calendar.ts) so tests can import it without dragging Hono in.
 */
export function preflightOAuthSecrets(
  env: Env,
  provider: 'google' | 'microsoft',
): string[] {
  const missing: string[] = [];
  if (!env.JWT_SECRET) missing.push('JWT_SECRET');
  if (provider === 'google') {
    if (!env.GOOGLE_CLIENT_ID) missing.push('GOOGLE_CLIENT_ID');
    if (!env.GOOGLE_CLIENT_SECRET) missing.push('GOOGLE_CLIENT_SECRET');
    if (!googleRedirectUri(env)) missing.push('PUBLIC_BASE_URL');
  } else {
    if (!env.MICROSOFT_CLIENT_ID) missing.push('MICROSOFT_CLIENT_ID');
    if (!env.MICROSOFT_CLIENT_SECRET) missing.push('MICROSOFT_CLIENT_SECRET');
    if (!microsoftRedirectUri(env)) missing.push('PUBLIC_BASE_URL');
  }
  return missing;
}

// ===========================================================================
// Auth URL builders
// ===========================================================================
export function buildGoogleAuthUrl(env: Env, state: string): string {
  const p = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!,
    redirect_uri: googleRedirectUri(env),
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
    include_granted_scopes: 'true',
  });
  return `${GOOGLE_AUTH_URL}?${p.toString()}`;
}

export function buildMicrosoftAuthUrl(env: Env, state: string): string {
  const p = new URLSearchParams({
    client_id: env.MICROSOFT_CLIENT_ID!,
    redirect_uri: microsoftRedirectUri(env),
    response_type: 'code',
    response_mode: 'query',
    scope: MICROSOFT_SCOPES.join(' '),
    state,
    prompt: 'consent',
  });
  return `${msAuthorize(env)}?${p.toString()}`;
}

// ===========================================================================
// Token exchange / refresh — fetch with explicit timeout, fail with thrown
// Error so callers can map to a HTTP status.
// ===========================================================================
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 10_000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

export async function exchangeGoogleCode(env: Env, code: string): Promise<any> {
  if (!googleOAuthAvailable(env)) throw new Error('google_oauth_unavailable');
  const body = new URLSearchParams({
    code,
    client_id: env.GOOGLE_CLIENT_ID!,
    client_secret: env.GOOGLE_CLIENT_SECRET!,
    redirect_uri: googleRedirectUri(env),
    grant_type: 'authorization_code',
  });
  const r = await fetchWithTimeout(GOOGLE_TOKEN_URL, {
    method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  if (!r.ok) {
    console.warn('[CAL] google token exchange', r.status);
    throw new Error(`token_exchange_failed:${r.status}`);
  }
  return r.json();
}

export async function refreshGoogleAccessToken(env: Env, refreshToken: string): Promise<string> {
  if (!googleOAuthAvailable(env)) throw new Error('google_oauth_unavailable');
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: env.GOOGLE_CLIENT_ID!,
    client_secret: env.GOOGLE_CLIENT_SECRET!,
    grant_type: 'refresh_token',
  });
  const r = await fetchWithTimeout(GOOGLE_TOKEN_URL, {
    method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  if (!r.ok) {
    console.warn('[CAL] google refresh', r.status);
    throw new Error(`refresh_failed:${r.status}`);
  }
  return ((await r.json()) as any).access_token as string;
}

export async function fetchGoogleUserinfo(accessToken: string): Promise<any> {
  try {
    const r = await fetchWithTimeout(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (r.ok) return r.json();
  } catch (e: any) {
    console.warn('[CAL] google userinfo failed:', e?.message || e);
  }
  return {};
}

export async function exchangeMicrosoftCode(env: Env, code: string): Promise<any> {
  if (!microsoftOAuthAvailable(env)) throw new Error('microsoft_oauth_unavailable');
  const body = new URLSearchParams({
    code,
    client_id: env.MICROSOFT_CLIENT_ID!,
    client_secret: env.MICROSOFT_CLIENT_SECRET!,
    redirect_uri: microsoftRedirectUri(env),
    grant_type: 'authorization_code',
    scope: MICROSOFT_SCOPES.join(' '),
  });
  const r = await fetchWithTimeout(msToken(env), {
    method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  if (!r.ok) {
    console.warn('[CAL] ms token exchange', r.status);
    throw new Error(`token_exchange_failed:${r.status}`);
  }
  return r.json();
}

export async function refreshMicrosoftAccessToken(env: Env, refreshToken: string): Promise<string> {
  if (!microsoftOAuthAvailable(env)) throw new Error('microsoft_oauth_unavailable');
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: env.MICROSOFT_CLIENT_ID!,
    client_secret: env.MICROSOFT_CLIENT_SECRET!,
    grant_type: 'refresh_token',
    scope: MICROSOFT_SCOPES.join(' '),
  });
  const r = await fetchWithTimeout(msToken(env), {
    method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  if (!r.ok) {
    console.warn('[CAL] ms refresh', r.status);
    throw new Error(`refresh_failed:${r.status}`);
  }
  return ((await r.json()) as any).access_token as string;
}

export async function fetchMicrosoftUserinfo(accessToken: string): Promise<any> {
  try {
    const r = await fetchWithTimeout(`${MICROSOFT_GRAPH}/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (r.ok) return r.json();
  } catch (e: any) {
    console.warn('[CAL] ms userinfo failed:', e?.message || e);
  }
  return {};
}

// ===========================================================================
// Aggregator — IC meetings + founder check-ins. The worker D1 has no
// mentor_bookings or partner_bookings tables, so those kinds are skipped
// (the FastAPI version reads them when present).
// ===========================================================================
export interface CalendarEvent {
  id: string;
  kind: 'ic_meeting' | 'founder_checkin' | 'mentor_booking' | 'partner_office_hour' | 'calendly_event';
  source_id: number;
  source_uid: string;
  title: string;
  start_at: string;
  end_at: string;
  status: string;
  location_kind: string | null;
  location_uri: string | null;
  organizer_email: string | null;
  attendees: { email: string | null; name: string | null; role: string; rsvp?: string }[];
  notes: string | null;
  deal_id?: number | null;
  project_id?: number | null;
}

function addMinutes(iso: string, mins: number): string {
  return new Date(new Date(iso).getTime() + mins * 60_000).toISOString();
}

async function icEvents(env: Env, userId: number, isAdmin: boolean,
                        fromIso: string, toIso: string): Promise<CalendarEvent[]> {
  const sql = getSQL(env);
  const rows = await sql`
    SELECT m.* FROM ic_meetings m
    WHERE m.start_at >= ${fromIso} AND m.start_at <= ${toIso}
      AND m.status != 'cancelled'
  ` as any[];
  const out: CalendarEvent[] = [];
  for (const m of rows) {
    const attendeeRows = await sql`
      SELECT a.user_id, a.rsvp, u.email, u.name
      FROM ic_meeting_attendees a
      LEFT JOIN users u ON u.id = a.user_id
      WHERE a.meeting_id = ${m.id}
    ` as any[];
    const invited = new Set(attendeeRows.map(a => a.user_id));
    if (!(isAdmin || m.organizer_user_id === userId || invited.has(userId))) continue;
    const organizer = (await sql`SELECT email FROM users WHERE id = ${m.organizer_user_id}` as any[])[0];
    out.push({
      id: `ic_meeting:${m.id}`,
      kind: 'ic_meeting',
      source_id: m.id,
      source_uid: m.uid,
      title: m.title,
      start_at: m.start_at,
      end_at: addMinutes(m.start_at, m.duration_min),
      status: m.status,
      location_kind: m.location_kind,
      location_uri: m.location_uri,
      organizer_email: organizer?.email || null,
      attendees: attendeeRows.map(a => ({
        email: a.email || null, name: a.name || null, role: 'attendee', rsvp: a.rsvp,
      })),
      notes: m.agenda || null,
      deal_id: m.deal_id,
    });
  }
  return out;
}

async function checkinEvents(env: Env, userId: number, isAdmin: boolean,
                             fromIso: string, toIso: string): Promise<CalendarEvent[]> {
  const sql = getSQL(env);
  const rows = isAdmin
    ? await sql`
        SELECT * FROM founder_checkins
        WHERE start_at >= ${fromIso} AND start_at <= ${toIso} AND status != 'cancelled'
      ` as any[]
    : await sql`
        SELECT * FROM founder_checkins
        WHERE start_at >= ${fromIso} AND start_at <= ${toIso} AND status != 'cancelled'
          AND (founder_user_id = ${userId} OR counterpart_user_id = ${userId})
      ` as any[];
  const out: CalendarEvent[] = [];
  for (const c of rows) {
    const founder = (await sql`SELECT email, name FROM users WHERE id = ${c.founder_user_id}` as any[])[0];
    const counter = c.counterpart_user_id
      ? (await sql`SELECT email, name FROM users WHERE id = ${c.counterpart_user_id}` as any[])[0]
      : null;
    const attendees: CalendarEvent['attendees'] = [];
    if (founder) attendees.push({ email: founder.email, name: founder.name, role: 'founder' });
    if (counter) attendees.push({ email: counter.email, name: counter.name, role: 'counterpart' });
    out.push({
      id: `founder_checkin:${c.id}`,
      kind: 'founder_checkin',
      source_id: c.id,
      source_uid: c.uid,
      title: c.title,
      start_at: c.start_at,
      end_at: addMinutes(c.start_at, c.duration_min),
      status: c.status,
      location_kind: c.location_kind,
      location_uri: c.location_uri,
      organizer_email: counter?.email || founder?.email || null,
      attendees,
      notes: c.notes || null,
      project_id: c.project_id,
    });
  }
  return out;
}

// Mentor + partner office-hour bookings live in tables that may not yet
// exist in worker D1 (the FastAPI backend owns them). Wrap each query in
// a try/catch so a missing table degrades to an empty list instead of a
// 500. Any *other* error is rethrown so genuine bugs are still surfaced.
function isMissingTableError(e: any): boolean {
  const msg = String(e?.message || e || '').toLowerCase();
  return msg.includes('no such table') || msg.includes('does not exist');
}

async function mentorBookingEvents(env: Env, userId: number, isAdmin: boolean,
                                   fromIso: string, toIso: string): Promise<CalendarEvent[]> {
  const sql = getSQL(env);
  try {
    // Visibility: requester, mentor (via users.mentor_id), or admin.
    const me = (await sql`SELECT mentor_id FROM users WHERE id = ${userId}` as any[])[0];
    const myMentorId = me?.mentor_id || null;
    const rows = await sql`
      SELECT b.* FROM mentor_bookings b
      WHERE b.scheduled_start >= ${fromIso} AND b.scheduled_start <= ${toIso}
        AND b.status IN ('requested', 'confirmed', 'completed')
    ` as any[];
    const out: CalendarEvent[] = [];
    for (const b of rows) {
      const isRequester = b.requester_user_id === userId;
      const isMentor = !!(myMentorId && b.mentor_id === myMentorId);
      if (!(isAdmin || isRequester || isMentor)) continue;
      const mentor = (await sql`SELECT email, name FROM mentors WHERE id = ${b.mentor_id}` as any[])[0];
      const requester = (await sql`SELECT email, name FROM users WHERE id = ${b.requester_user_id}` as any[])[0];
      out.push({
        id: `mentor_booking:${b.id}`,
        kind: 'mentor_booking',
        source_id: b.id,
        source_uid: b.uid,
        title: `Mentor session — ${b.topic || ''}`.trim(),
        start_at: b.scheduled_start,
        end_at: b.scheduled_end,
        status: b.status,
        location_kind: 'video',
        location_uri: b.meeting_uri || null,
        organizer_email: mentor?.email || null,
        attendees: [
          { email: mentor?.email || null, name: mentor?.name || null, role: 'mentor' },
          { email: requester?.email || null, name: requester?.name || null, role: 'mentee' },
        ],
        notes: b.questions || null,
        project_id: b.project_id || null,
      });
    }
    return out;
  } catch (e) {
    if (isMissingTableError(e)) return [];
    throw e;
  }
}

async function partnerOfficeHourEvents(env: Env, userId: number, isAdmin: boolean,
                                       fromIso: string, toIso: string): Promise<CalendarEvent[]> {
  const sql = getSQL(env);
  try {
    const me = (await sql`SELECT partner_id FROM users WHERE id = ${userId}` as any[])[0];
    const myPartnerId = me?.partner_id || null;
    const rows = await sql`
      SELECT b.* FROM partner_bookings b
      WHERE b.scheduled_start >= ${fromIso} AND b.scheduled_start <= ${toIso}
        AND b.status IN ('requested', 'confirmed', 'completed')
    ` as any[];
    const out: CalendarEvent[] = [];
    for (const b of rows) {
      const isRequester = b.requester_user_id === userId;
      const isPartnerSide = !!(myPartnerId && b.partner_id === myPartnerId);
      if (!(isAdmin || isRequester || isPartnerSide)) continue;
      const partner = (await sql`SELECT email, name FROM partners WHERE id = ${b.partner_id}` as any[])[0];
      const requester = (await sql`SELECT email, name FROM users WHERE id = ${b.requester_user_id}` as any[])[0];
      out.push({
        id: `partner_office_hour:${b.id}`,
        kind: 'partner_office_hour',
        source_id: b.id,
        source_uid: b.uid,
        title: `Partner office hours — ${b.topic || ''}`.trim(),
        start_at: b.scheduled_start,
        end_at: b.scheduled_end,
        status: b.status,
        location_kind: 'video',
        location_uri: b.meeting_uri || null,
        organizer_email: partner?.email || null,
        attendees: [
          { email: partner?.email || null, name: partner?.name || null, role: 'partner' },
          { email: requester?.email || null, name: requester?.name || null, role: 'requester' },
        ],
        notes: b.questions || null,
        project_id: b.project_id || null,
      });
    }
    return out;
  } catch (e) {
    if (isMissingTableError(e)) return [];
    throw e;
  }
}

// Task #3 — Calendly events surfaced in the unified calendar. Read from
// the local `calendar_events` projection table written by the Calendly
// provider's webhook + sync. Visibility: requester only (admin sees all).
async function calendlyEvents(env: Env, userId: number, isAdmin: boolean,
                              fromIso: string, toIso: string): Promise<CalendarEvent[]> {
  try {
    const where = isAdmin
      ? "source = 'calendly' AND start_at >= ? AND start_at <= ?"
      : "source = 'calendly' AND user_id = ? AND start_at >= ? AND start_at <= ?";
    const stmt = isAdmin
      ? env.DB.prepare(`SELECT * FROM calendar_events WHERE ${where}`).bind(fromIso, toIso)
      : env.DB.prepare(`SELECT * FROM calendar_events WHERE ${where}`).bind(userId, fromIso, toIso);
    const res = await stmt.all<{
      id: number; uid: string; user_id: number; external_uri: string;
      title: string | null; start_at: string; end_at: string; status: string;
      location_kind: string | null; location_uri: string | null;
      organizer_email: string | null; invitee_email: string | null;
      invitee_name: string | null; notes: string | null;
    }>();
    return (res.results || []).map(r => ({
      id: `calendly_event:${r.id}`,
      kind: 'calendly_event',
      source_id: r.id,
      source_uid: r.uid,
      title: r.title || 'Calendly meeting',
      start_at: r.start_at,
      end_at: r.end_at,
      status: r.status,
      location_kind: r.location_kind || 'video',
      location_uri: r.location_uri,
      organizer_email: r.organizer_email,
      attendees: [
        ...(r.organizer_email ? [{ email: r.organizer_email, name: null, role: 'organizer' as const }] : []),
        ...(r.invitee_email ? [{ email: r.invitee_email, name: r.invitee_name, role: 'invitee' as const }] : []),
      ],
      notes: r.notes,
      project_id: null,
    }));
  } catch (e) {
    if (isMissingTableError(e)) return [];
    throw e;
  }
}

export async function fetchUserEvents(
  env: Env, userId: number, role: string, fromIso: string, toIso: string,
  kinds?: string[],
): Promise<CalendarEvent[]> {
  const isAdmin = role.toLowerCase() === 'admin';
  const wanted = new Set(
    kinds && kinds.length
      ? kinds
      : ['mentor_booking', 'ic_meeting', 'founder_checkin', 'partner_office_hour', 'calendly_event'],
  );
  const out: CalendarEvent[] = [];
  if (wanted.has('mentor_booking')) out.push(...await mentorBookingEvents(env, userId, isAdmin, fromIso, toIso));
  if (wanted.has('ic_meeting')) out.push(...await icEvents(env, userId, isAdmin, fromIso, toIso));
  if (wanted.has('founder_checkin')) out.push(...await checkinEvents(env, userId, isAdmin, fromIso, toIso));
  if (wanted.has('partner_office_hour')) out.push(...await partnerOfficeHourEvents(env, userId, isAdmin, fromIso, toIso));
  if (wanted.has('calendly_event')) out.push(...await calendlyEvents(env, userId, isAdmin, fromIso, toIso));
  out.sort((a, b) => a.start_at.localeCompare(b.start_at));
  return out;
}

// ===========================================================================
// ICS export — RFC 5545.
// ===========================================================================
function icsDt(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}
function icsEscape(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\n/g, '\\n');
}

export function eventsToIcs(events: CalendarEvent[], calendarName = 'Axal StudioOS'): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Axal StudioOS//EN',
    `X-WR-CALNAME:${icsEscape(calendarName)}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  const now = icsDt(new Date().toISOString());
  for (const ev of events) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${ev.kind}-${ev.source_uid}@axal.vc`);
    lines.push(`DTSTAMP:${now}`);
    lines.push(`DTSTART:${icsDt(ev.start_at)}`);
    lines.push(`DTEND:${icsDt(ev.end_at)}`);
    lines.push(`SUMMARY:${icsEscape(ev.title)}`);
    if (ev.notes) lines.push(`DESCRIPTION:${icsEscape(ev.notes)}`);
    if (ev.location_uri) lines.push(`LOCATION:${icsEscape(ev.location_uri)}`);
    for (const a of ev.attendees) {
      if (a.email) lines.push(`ATTENDEE;CN=${icsEscape(a.name || a.email)}:mailto:${a.email}`);
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

// ===========================================================================
// Push to Google Calendar primary
// ===========================================================================
function googlePayload(ev: CalendarEvent): any {
  const body: any = {
    summary: ev.title,
    description: ev.notes || '',
    start: { dateTime: ev.start_at, timeZone: 'UTC' },
    end: { dateTime: ev.end_at, timeZone: 'UTC' },
    source: { title: 'Axal StudioOS', url: 'https://axal.vc' },
  };
  if (ev.location_uri) body.location = ev.location_uri;
  const att = ev.attendees
    .filter(a => a.email && a.email !== ev.organizer_email)
    .map(a => ({ email: a.email, displayName: a.name }));
  if (att.length) body.attendees = att;
  return body;
}

export async function pushEventToGoogle(
  accessToken: string, ev: CalendarEvent, googleEventId: string | null,
): Promise<string | null> {
  const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
  const payload = JSON.stringify(googlePayload(ev));
  try {
    if (googleEventId) {
      const r = await fetchWithTimeout(
        `${GOOGLE_CALENDAR_API}/calendars/primary/events/${googleEventId}`,
        { method: 'PATCH', headers, body: payload },
      );
      if (r.status === 404) {
        // Remote was deleted — fall through to a fresh insert.
      } else if (!r.ok) {
        console.warn('[CAL] gcal patch', r.status);
        return null;
      } else {
        return ((await r.json()) as any).id as string;
      }
    }
    const r = await fetchWithTimeout(
      `${GOOGLE_CALENDAR_API}/calendars/primary/events`,
      { method: 'POST', headers, body: payload },
    );
    if (!r.ok) {
      console.warn('[CAL] gcal insert', r.status);
      return null;
    }
    return ((await r.json()) as any).id as string;
  } catch (e: any) {
    console.warn('[CAL] gcal push exception:', e?.message || e);
    return null;
  }
}

export async function deleteEventFromGoogle(accessToken: string, googleEventId: string): Promise<boolean> {
  try {
    const r = await fetchWithTimeout(
      `${GOOGLE_CALENDAR_API}/calendars/primary/events/${googleEventId}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } },
    );
    return r.status === 200 || r.status === 204 || r.status === 404 || r.status === 410;
  } catch (e: any) {
    console.warn('[CAL] gcal delete exception:', e?.message || e);
    return false;
  }
}

// ===========================================================================
// Push to Microsoft Graph /me/events
// ===========================================================================
function microsoftPayload(ev: CalendarEvent): any {
  const body: any = {
    subject: ev.title,
    body: { contentType: 'text', content: ev.notes || '' },
    start: { dateTime: ev.start_at, timeZone: 'UTC' },
    end: { dateTime: ev.end_at, timeZone: 'UTC' },
  };
  if (ev.location_uri) body.location = { displayName: ev.location_uri };
  const att = ev.attendees
    .filter(a => a.email && a.email !== ev.organizer_email)
    .map(a => ({
      emailAddress: { address: a.email, name: a.name || a.email },
      type: 'required',
    }));
  if (att.length) body.attendees = att;
  return body;
}

export async function pushEventToMicrosoft(
  accessToken: string, ev: CalendarEvent, eventId: string | null,
): Promise<string | null> {
  const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
  const payload = JSON.stringify(microsoftPayload(ev));
  try {
    if (eventId) {
      const r = await fetchWithTimeout(
        `${MICROSOFT_GRAPH}/me/events/${eventId}`,
        { method: 'PATCH', headers, body: payload },
      );
      if (r.status === 404) {
        // Fall through to fresh insert.
      } else if (!r.ok) {
        console.warn('[CAL] ms patch', r.status);
        return null;
      } else {
        return ((await r.json()) as any).id as string;
      }
    }
    const r = await fetchWithTimeout(
      `${MICROSOFT_GRAPH}/me/events`,
      { method: 'POST', headers, body: payload },
    );
    if (!r.ok) {
      console.warn('[CAL] ms insert', r.status);
      return null;
    }
    return ((await r.json()) as any).id as string;
  } catch (e: any) {
    console.warn('[CAL] ms push exception:', e?.message || e);
    return null;
  }
}

export async function deleteEventFromMicrosoft(accessToken: string, eventId: string): Promise<boolean> {
  try {
    const r = await fetchWithTimeout(
      `${MICROSOFT_GRAPH}/me/events/${eventId}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } },
    );
    return r.status === 200 || r.status === 204 || r.status === 404 || r.status === 410;
  } catch (e: any) {
    console.warn('[CAL] ms delete exception:', e?.message || e);
    return false;
  }
}

// ===========================================================================
// User → provider sync. Iterates the user's events in window, upserts each
// via the provider's API, mirrors the result into calendar_sync_records.
// ===========================================================================
export interface SyncSummary {
  pushed: number; updated: number; failed: number; skipped: number; total: number;
}

export async function syncUserToGoogle(
  env: Env, userId: number, role: string, fromIso: string, toIso: string,
): Promise<SyncSummary> {
  const tok = await loadRefreshToken(env, 'google_oauth_tokens', userId);
  if (!tok) throw new Error('not_connected');
  const accessToken = await refreshGoogleAccessToken(env, tok.raw);
  if (tok.wasPlaintext) await reencryptRefreshToken(env, 'google_oauth_tokens', userId, tok.raw);
  return syncUserToProvider(env, userId, role, fromIso, toIso, 'google', accessToken);
}

export async function syncUserToMicrosoft(
  env: Env, userId: number, role: string, fromIso: string, toIso: string,
): Promise<SyncSummary> {
  const tok = await loadRefreshToken(env, 'microsoft_oauth_tokens', userId);
  if (!tok) throw new Error('not_connected');
  const accessToken = await refreshMicrosoftAccessToken(env, tok.raw);
  if (tok.wasPlaintext) await reencryptRefreshToken(env, 'microsoft_oauth_tokens', userId, tok.raw);
  return syncUserToProvider(env, userId, role, fromIso, toIso, 'microsoft', accessToken);
}

async function syncUserToProvider(
  env: Env, userId: number, role: string, fromIso: string, toIso: string,
  provider: 'google' | 'microsoft', accessToken: string,
): Promise<SyncSummary> {
  const sql = getSQL(env);
  const events = await fetchUserEvents(env, userId, role, fromIso, toIso);
  let pushed = 0, updated = 0, failed = 0;
  for (const ev of events) {
    const rec = (await sql`
      SELECT external_event_id FROM calendar_sync_records
      WHERE user_id = ${userId} AND provider = ${provider}
        AND source_kind = ${ev.kind} AND source_id = ${ev.source_id}
    ` as any[])[0];
    const existing = rec?.external_event_id || null;
    const newId = provider === 'google'
      ? await pushEventToGoogle(accessToken, ev, existing)
      : await pushEventToMicrosoft(accessToken, ev, existing);
    if (!newId) { failed++; continue; }
    const nowIso = new Date().toISOString();
    if (rec) {
      await sql`
        UPDATE calendar_sync_records
           SET external_event_id = ${newId}, last_synced_at = ${nowIso}
         WHERE user_id = ${userId} AND provider = ${provider}
           AND source_kind = ${ev.kind} AND source_id = ${ev.source_id}
      `;
      updated++;
    } else {
      try {
        await sql`
          INSERT INTO calendar_sync_records
            (user_id, provider, source_kind, source_id, external_event_id, last_synced_at)
          VALUES (${userId}, ${provider}, ${ev.kind}, ${ev.source_id}, ${newId}, ${nowIso})
        `;
        pushed++;
      } catch {
        // Concurrent insert — count as failed rather than silently update.
        failed++;
      }
    }
  }
  const nowIso = new Date().toISOString();
  const tokenTable = provider === 'google' ? 'google_oauth_tokens' : 'microsoft_oauth_tokens';
  await sql.unsafe(
    `UPDATE ${tokenTable} SET last_synced_at = ? WHERE user_id = ?`,
    [nowIso, userId],
  );
  return { pushed, updated, failed, skipped: 0, total: events.length };
}
