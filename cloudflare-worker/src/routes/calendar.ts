/**
 * Calendar routes — port of backend/app/api/routes/calendar.py.
 *
 * Mounted at /api/calendar. Eighteen endpoints across:
 *   - unified events feed + ICS export
 *   - IC meetings CRUD + RSVP
 *   - founder check-ins CRUD
 *   - Google Calendar OAuth + sync (status, connect, callback, sync, disconnect)
 *   - Microsoft 365 / Outlook OAuth + sync (same five)
 *
 * Every authenticated handler runs through `safe()` so any uncaught error
 * surfaces as a friendly JSON 500 with the cause logged to Cloudflare. The
 * two callbacks intentionally skip requireAuth — the user_id comes from the
 * single-use HMAC-signed state token persisted in oauth_state_tokens.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { getSQL } from '../db';
import { requireAuth } from '../auth';
import {
  googleOAuthAvailable, microsoftOAuthAvailable,
  buildGoogleAuthUrl, buildMicrosoftAuthUrl,
  exchangeGoogleCode, exchangeMicrosoftCode,
  fetchGoogleUserinfo, fetchMicrosoftUserinfo,
  fetchUserEvents, eventsToIcs,
  syncUserToGoogle, syncUserToMicrosoft,
} from '../services/calendar';

const calendar = new Hono<{ Bindings: Env }>();

const STATE_TTL_SECONDS = 600;

// ---------------------------------------------------------------------------
// safe() — defensive wrapper, mirrors routes/auth.ts.
// ---------------------------------------------------------------------------
function safe(label: string, friendly: string, handler: (c: any) => Promise<any>) {
  return async (c: any) => {
    try {
      return await handler(c);
    } catch (e: any) {
      const msg = e?.message || '';
      if (msg === 'Unauthorized' || msg === 'Forbidden') throw e;
      console.error(`[CAL:${label}]`, msg, e?.stack || '');
      return c.json({ error: friendly }, 500);
    }
  };
}

function isAdmin(role: string): boolean { return role.toLowerCase() === 'admin'; }
function lc(role: any): string { return String(role || '').toLowerCase(); }

// ---------------------------------------------------------------------------
// HMAC state — same construction as routes/linkedin.ts. The nonce is the
// row key in oauth_state_tokens (single-use), HMAC binds it to JWT_SECRET so
// even an attacker who guessed the row key cannot forge a valid state.
// ---------------------------------------------------------------------------
function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function hmacSign(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return b64url(sig);
}
async function makeState(env: Env, nonce: string): Promise<string> {
  const sig = await hmacSign(env.JWT_SECRET, nonce);
  return `${nonce}.${sig}`;
}
async function verifyState(env: Env, raw: string): Promise<string | null> {
  const i = raw.indexOf('.');
  if (i < 0) return null;
  const nonce = raw.slice(0, i);
  const sig = raw.slice(i + 1);
  const expected = await hmacSign(env.JWT_SECRET, nonce);
  // crypto.subtle does not expose timingSafeEqual; compare equal-length strings
  // char-by-char to avoid early-exit timing leaks on the HMAC suffix.
  if (sig.length !== expected.length) return null;
  let diff = 0;
  for (let j = 0; j < sig.length; j++) diff |= sig.charCodeAt(j) ^ expected.charCodeAt(j);
  return diff === 0 ? nonce : null;
}

async function persistState(env: Env, nonce: string, userId: number, provider: 'google' | 'microsoft'): Promise<void> {
  const sql = getSQL(env);
  const expires = new Date(Date.now() + STATE_TTL_SECONDS * 1000).toISOString();
  // Opportunistic sweep — keeps the table from growing unbounded.
  const nowIso = new Date().toISOString();
  await sql`DELETE FROM oauth_state_tokens WHERE expires_at < ${nowIso}`;
  await sql`
    INSERT INTO oauth_state_tokens (state, user_id, provider, expires_at)
    VALUES (${nonce}, ${userId}, ${provider}, ${expires})
  `;
}

async function consumeState(env: Env, nonce: string, provider: 'google' | 'microsoft'): Promise<number | null> {
  const sql = getSQL(env);
  const row = (await sql`
    SELECT user_id, expires_at FROM oauth_state_tokens
    WHERE state = ${nonce} AND provider = ${provider}
  ` as any[])[0];
  if (!row) return null;
  await sql`DELETE FROM oauth_state_tokens WHERE state = ${nonce}`;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return row.user_id as number;
}

// ===========================================================================
// Unified feed
// ===========================================================================
calendar.get('/events', safe('events', 'Could not list calendar events', async (c) => {
  const user = await requireAuth(c);
  const url = new URL(c.req.url);
  const fromQ = url.searchParams.get('from');
  const toQ = url.searchParams.get('to');
  const kindsQ = url.searchParams.get('kinds');
  const fromDt = fromQ ? new Date(fromQ) : new Date(Date.now() - 86_400_000);
  const toDt = toQ ? new Date(toQ) : new Date(Date.now() + 90 * 86_400_000);
  if (Number.isNaN(fromDt.getTime()) || Number.isNaN(toDt.getTime())) {
    return c.json({ detail: 'Invalid from/to ISO datetime' }, 400);
  }
  const kinds = kindsQ ? kindsQ.split(',').map(s => s.trim()).filter(Boolean) : undefined;
  const events = await fetchUserEvents(c.env, user.id, lc(user.role), fromDt.toISOString(), toDt.toISOString(), kinds);
  const sql = getSQL(c.env);
  const tok = (await sql`SELECT 1 FROM google_oauth_tokens WHERE user_id = ${user.id}` as any[])[0];
  return c.json({
    items: events,
    from: fromDt.toISOString(),
    to: toDt.toISOString(),
    google_connected: !!tok,
  });
}));

calendar.get('/events.ics', safe('ics', 'Could not export calendar', async (c) => {
  const user = await requireAuth(c);
  const url = new URL(c.req.url);
  const fromQ = url.searchParams.get('from');
  const toQ = url.searchParams.get('to');
  const fromDt = fromQ ? new Date(fromQ) : new Date(Date.now() - 7 * 86_400_000);
  const toDt = toQ ? new Date(toQ) : new Date(Date.now() + 180 * 86_400_000);
  const events = await fetchUserEvents(c.env, user.id, lc(user.role), fromDt.toISOString(), toDt.toISOString());
  const body = eventsToIcs(events, `Axal StudioOS — ${user.name}`);
  return new Response(body, {
    headers: {
      'content-type': 'text/calendar',
      'content-disposition': 'attachment; filename="axal-studioos.ics"',
    },
  });
}));

// ===========================================================================
// IC meetings
// ===========================================================================
function canScheduleIc(role: string): boolean {
  const r = role.toLowerCase();
  return r === 'admin' || r === 'investor';
}

async function serializeIc(env: Env, m: any): Promise<any> {
  const sql = getSQL(env);
  const att = await sql`
    SELECT a.user_id, a.rsvp, u.email, u.name
    FROM ic_meeting_attendees a
    LEFT JOIN users u ON u.id = a.user_id
    WHERE a.meeting_id = ${m.id}
  ` as any[];
  return {
    id: m.id, uid: m.uid, title: m.title, agenda: m.agenda,
    start_at: m.start_at, duration_min: m.duration_min,
    deal_id: m.deal_id, organizer_user_id: m.organizer_user_id,
    location_kind: m.location_kind, location_uri: m.location_uri,
    status: m.status,
    attendees: att.map(a => ({ user_id: a.user_id, email: a.email, name: a.name, rsvp: a.rsvp })),
  };
}

calendar.post('/ic-meetings', safe('ic_create', 'Could not create IC meeting', async (c) => {
  const user = await requireAuth(c);
  if (!canScheduleIc(lc(user.role))) return c.json({ detail: 'Investor or admin role required' }, 403);
  const body = await c.req.json().catch(() => ({}));
  const title = String(body?.title || '').trim().slice(0, 240);
  if (title.length < 2) return c.json({ detail: 'title required (min 2 chars)' }, 400);
  if (!body?.start_at) return c.json({ detail: 'start_at required' }, 400);
  const startAt = new Date(body.start_at);
  if (Number.isNaN(startAt.getTime()) || startAt.getTime() <= Date.now()) {
    return c.json({ detail: 'start_at must be in the future' }, 400);
  }
  const duration = Math.min(600, Math.max(10, parseInt(body.duration_min, 10) || 60));
  const sql = getSQL(c.env);
  const uid = crypto.randomUUID();
  const r = await sql`
    INSERT INTO ic_meetings
      (uid, title, agenda, start_at, duration_min, deal_id, organizer_user_id,
       location_kind, location_uri)
    VALUES
      (${uid}, ${title}, ${body.agenda || null}, ${startAt.toISOString()}, ${duration},
       ${body.deal_id || null}, ${user.id},
       ${body.location_kind || 'video'}, ${body.location_uri || null})
    RETURNING *
  ` as any[];
  const meeting = r[0];
  const attendeeIds = new Set<number>(
    Array.isArray(body.attendee_user_ids)
      ? body.attendee_user_ids.map((n: any) => parseInt(n, 10)).filter((n: number) => Number.isFinite(n))
      : [],
  );
  attendeeIds.add(user.id);
  for (const uid2 of attendeeIds) {
    const u = (await sql`SELECT 1 FROM users WHERE id = ${uid2}` as any[])[0];
    if (!u) continue;
    const rsvp = uid2 === user.id ? 'accepted' : 'invited';
    try {
      await sql`
        INSERT INTO ic_meeting_attendees (meeting_id, user_id, rsvp)
        VALUES (${meeting.id}, ${uid2}, ${rsvp})
      `;
    } catch { /* UNIQUE collision — ignore */ }
  }
  return c.json(await serializeIc(c.env, meeting));
}));

calendar.get('/ic-meetings', safe('ic_list', 'Could not list IC meetings', async (c) => {
  const user = await requireAuth(c);
  const sql = getSQL(c.env);
  const rows = await sql`SELECT * FROM ic_meetings ORDER BY start_at DESC` as any[];
  const out: any[] = [];
  for (const m of rows) {
    const att = await sql`SELECT user_id FROM ic_meeting_attendees WHERE meeting_id = ${m.id}` as any[];
    const invited = new Set(att.map(a => a.user_id));
    if (!(isAdmin(lc(user.role)) || m.organizer_user_id === user.id || invited.has(user.id))) continue;
    out.push(await serializeIc(c.env, m));
  }
  return c.json({ items: out });
}));

calendar.post('/ic-meetings/:id/rsvp', safe('ic_rsvp', 'Could not record RSVP', async (c) => {
  const user = await requireAuth(c);
  const meetingId = parseInt(c.req.param('id'), 10);
  const url = new URL(c.req.url);
  const rsvp = url.searchParams.get('rsvp') || '';
  if (!['accepted', 'declined', 'tentative'].includes(rsvp)) {
    return c.json({ detail: 'Invalid rsvp value' }, 400);
  }
  const sql = getSQL(c.env);
  const row = (await sql`
    SELECT id FROM ic_meeting_attendees WHERE meeting_id = ${meetingId} AND user_id = ${user.id}
  ` as any[])[0];
  if (!row) return c.json({ detail: 'You are not invited to this meeting' }, 404);
  await sql`UPDATE ic_meeting_attendees SET rsvp = ${rsvp} WHERE id = ${row.id}`;
  return c.json({ ok: true, rsvp });
}));

calendar.delete('/ic-meetings/:id', safe('ic_cancel', 'Could not cancel IC meeting', async (c) => {
  const user = await requireAuth(c);
  const id = parseInt(c.req.param('id'), 10);
  const url = new URL(c.req.url);
  const reason = (url.searchParams.get('reason') || '').trim().slice(0, 240) || null;
  const sql = getSQL(c.env);
  const m = (await sql`SELECT id, organizer_user_id FROM ic_meetings WHERE id = ${id}` as any[])[0];
  if (!m) return c.json({ detail: 'IC meeting not found' }, 404);
  if (!(isAdmin(lc(user.role)) || m.organizer_user_id === user.id)) {
    return c.json({ detail: 'Only the organiser or an admin can cancel' }, 403);
  }
  const nowIso = new Date().toISOString();
  await sql`
    UPDATE ic_meetings
       SET status = 'cancelled', cancelled_at = ${nowIso},
           cancel_reason = ${reason}, updated_at = ${nowIso}
     WHERE id = ${id}
  `;
  return c.json({ ok: true });
}));

// ===========================================================================
// Founder check-ins
// ===========================================================================
async function serializeCheckin(env: Env, c: any): Promise<any> {
  const sql = getSQL(env);
  const f = (await sql`SELECT email, name FROM users WHERE id = ${c.founder_user_id}` as any[])[0];
  const co = c.counterpart_user_id
    ? (await sql`SELECT email, name FROM users WHERE id = ${c.counterpart_user_id}` as any[])[0]
    : null;
  return {
    id: c.id, uid: c.uid, title: c.title, notes: c.notes,
    start_at: c.start_at, duration_min: c.duration_min,
    location_kind: c.location_kind, location_uri: c.location_uri,
    status: c.status,
    founder: { user_id: c.founder_user_id, email: f?.email || null, name: f?.name || null },
    counterpart: co ? { user_id: c.counterpart_user_id, email: co.email, name: co.name } : null,
    project_id: c.project_id,
  };
}

calendar.post('/founder-checkins', safe('ck_create', 'Could not create check-in', async (c) => {
  const user = await requireAuth(c);
  const body = await c.req.json().catch(() => ({}));
  if (!body?.start_at) return c.json({ detail: 'start_at required' }, 400);
  const startAt = new Date(body.start_at);
  if (Number.isNaN(startAt.getTime()) || startAt.getTime() <= Date.now()) {
    return c.json({ detail: 'start_at must be in the future' }, 400);
  }
  const founderId = parseInt(body.founder_user_id, 10);
  if (!Number.isFinite(founderId)) return c.json({ detail: 'founder_user_id required' }, 400);
  const title = String(body?.title || '').trim().slice(0, 240);
  if (title.length < 2) return c.json({ detail: 'title required (min 2 chars)' }, 400);

  const sql = getSQL(c.env);
  const founder = (await sql`SELECT id FROM users WHERE id = ${founderId}` as any[])[0];
  if (!founder) return c.json({ detail: 'founder user not found' }, 404);

  const isSelf = user.id === founderId;
  const requestedCounterId = body.counterpart_user_id ? parseInt(body.counterpart_user_id, 10) : null;
  const isCounter = requestedCounterId === user.id;
  const role = lc(user.role);
  if (!(isAdmin(role) || isSelf || isCounter || ['partner', 'investor', 'mentor'].includes(role))) {
    return c.json({ detail: 'Not allowed to schedule this check-in' }, 403);
  }
  // Default counterpart to caller if not the founder themselves.
  const counterId = requestedCounterId ?? (isSelf ? null : user.id);
  const duration = Math.min(240, Math.max(10, parseInt(body.duration_min, 10) || 30));
  const uid = crypto.randomUUID();
  const r = await sql`
    INSERT INTO founder_checkins
      (uid, founder_user_id, counterpart_user_id, project_id, title, notes,
       start_at, duration_min, location_kind, location_uri)
    VALUES
      (${uid}, ${founderId}, ${counterId}, ${body.project_id || null},
       ${title}, ${body.notes || null}, ${startAt.toISOString()}, ${duration},
       ${body.location_kind || 'video'}, ${body.location_uri || null})
    RETURNING *
  ` as any[];
  return c.json(await serializeCheckin(c.env, r[0]));
}));

calendar.get('/founder-checkins', safe('ck_list', 'Could not list check-ins', async (c) => {
  const user = await requireAuth(c);
  const sql = getSQL(c.env);
  const rows = isAdmin(lc(user.role))
    ? await sql`SELECT * FROM founder_checkins ORDER BY start_at DESC` as any[]
    : await sql`
        SELECT * FROM founder_checkins
        WHERE founder_user_id = ${user.id} OR counterpart_user_id = ${user.id}
        ORDER BY start_at DESC
      ` as any[];
  const out = [];
  for (const r of rows) out.push(await serializeCheckin(c.env, r));
  return c.json({ items: out });
}));

calendar.delete('/founder-checkins/:id', safe('ck_cancel', 'Could not cancel check-in', async (c) => {
  const user = await requireAuth(c);
  const id = parseInt(c.req.param('id'), 10);
  const sql = getSQL(c.env);
  const row = (await sql`
    SELECT founder_user_id, counterpart_user_id FROM founder_checkins WHERE id = ${id}
  ` as any[])[0];
  if (!row) return c.json({ detail: 'Check-in not found' }, 404);
  if (!(isAdmin(lc(user.role)) || row.founder_user_id === user.id || row.counterpart_user_id === user.id)) {
    return c.json({ detail: 'Only attendees or admin can cancel' }, 403);
  }
  const nowIso = new Date().toISOString();
  await sql`
    UPDATE founder_checkins SET status = 'cancelled', cancelled_at = ${nowIso}, updated_at = ${nowIso}
    WHERE id = ${id}
  `;
  return c.json({ ok: true });
}));

// ===========================================================================
// Provider OAuth — generic helpers shared by Google + Microsoft routes.
// ===========================================================================
function failureRedirect(env: Env, provider: string, reason?: string): Response {
  const base = env.APP_URL || '';
  const url = `${base}/calendar?${provider}=failed${reason ? `&reason=${encodeURIComponent(reason)}` : ''}`;
  return Response.redirect(url, 302);
}
function successRedirect(env: Env, provider: string): Response {
  const base = env.APP_URL || '';
  return Response.redirect(`${base}/calendar?${provider}=connected`, 302);
}

// ===========================================================================
// Google
// ===========================================================================
calendar.get('/google/status', safe('g_status', 'Could not load Google status', async (c) => {
  const user = await requireAuth(c);
  const sql = getSQL(c.env);
  const row = (await sql`
    SELECT google_email, last_synced_at, scope FROM google_oauth_tokens WHERE user_id = ${user.id}
  ` as any[])[0];
  return c.json({
    available: googleOAuthAvailable(c.env),
    connected: !!row,
    google_email: row?.google_email || null,
    last_synced_at: row?.last_synced_at || null,
    scope: row?.scope || null,
  });
}));

calendar.post('/google/connect', safe('g_connect', 'Could not start Google OAuth', async (c) => {
  const user = await requireAuth(c);
  if (!googleOAuthAvailable(c.env)) {
    return c.json({ detail: 'Google OAuth not configured on server' }, 503);
  }
  const nonce = crypto.randomUUID().replace(/-/g, '');
  await persistState(c.env, nonce, user.id, 'google');
  const state = await makeState(c.env, nonce);
  return c.json({ auth_url: buildGoogleAuthUrl(c.env, state) });
}));

calendar.get('/google/callback', async (c) => {
  // Intentionally no requireAuth — the user_id comes from the state row.
  try {
    const url = new URL(c.req.url);
    const code = url.searchParams.get('code');
    const stateRaw = url.searchParams.get('state');
    const error = url.searchParams.get('error');
    if (error || !code || !stateRaw) return failureRedirect(c.env, 'google', error || 'missing_params');
    const nonce = await verifyState(c.env, stateRaw);
    if (!nonce) return failureRedirect(c.env, 'google', 'bad_state');
    const userId = await consumeState(c.env, nonce, 'google');
    if (!userId) return failureRedirect(c.env, 'google', 'expired_state');

    const tokens = await exchangeGoogleCode(c.env, code);
    const refreshToken = tokens?.refresh_token;
    if (!refreshToken) return failureRedirect(c.env, 'google', 'no_refresh_token');
    const info = await fetchGoogleUserinfo(tokens.access_token || '');

    const sql = getSQL(c.env);
    const nowIso = new Date().toISOString();
    const existing = (await sql`SELECT id FROM google_oauth_tokens WHERE user_id = ${userId}` as any[])[0];
    if (existing) {
      await sql`
        UPDATE google_oauth_tokens
           SET refresh_token = ${refreshToken}, scope = ${tokens.scope || ''},
               google_email = ${info.email || null}, google_sub = ${info.id || null},
               updated_at = ${nowIso}
         WHERE user_id = ${userId}
      `;
    } else {
      await sql`
        INSERT INTO google_oauth_tokens
          (user_id, refresh_token, scope, google_email, google_sub)
        VALUES
          (${userId}, ${refreshToken}, ${tokens.scope || ''},
           ${info.email || null}, ${info.id || null})
      `;
    }
    return successRedirect(c.env, 'google');
  } catch (e: any) {
    console.error('[CAL:g_callback]', e?.message || e);
    return failureRedirect(c.env, 'google', 'token_exchange');
  }
});

calendar.delete('/google', safe('g_disconnect', 'Could not disconnect Google', async (c) => {
  const user = await requireAuth(c);
  const sql = getSQL(c.env);
  await sql`DELETE FROM google_oauth_tokens WHERE user_id = ${user.id}`;
  await sql`DELETE FROM calendar_sync_records WHERE user_id = ${user.id} AND provider = 'google'`;
  return c.json({ ok: true });
}));

calendar.post('/google/sync', safe('g_sync', 'Google sync failed', async (c) => {
  const user = await requireAuth(c);
  if (!googleOAuthAvailable(c.env)) {
    return c.json({ detail: 'Google OAuth not configured on server' }, 503);
  }
  const url = new URL(c.req.url);
  const fromQ = url.searchParams.get('from');
  const toQ = url.searchParams.get('to');
  const fromDt = fromQ ? new Date(fromQ) : new Date(Date.now() - 86_400_000);
  const toDt = toQ ? new Date(toQ) : new Date(Date.now() + 60 * 86_400_000);
  try {
    return c.json(await syncUserToGoogle(c.env, user.id, lc(user.role), fromDt.toISOString(), toDt.toISOString()));
  } catch (e: any) {
    if (e?.message === 'not_connected') return c.json({ detail: 'Connect a Google account first' }, 409);
    return c.json({ detail: `Google sync failed: ${e?.message || e}` }, 502);
  }
}));

// ===========================================================================
// Microsoft 365 / Outlook
// ===========================================================================
calendar.get('/microsoft/status', safe('m_status', 'Could not load Microsoft status', async (c) => {
  const user = await requireAuth(c);
  const sql = getSQL(c.env);
  const row = (await sql`
    SELECT microsoft_email, last_synced_at, scope FROM microsoft_oauth_tokens WHERE user_id = ${user.id}
  ` as any[])[0];
  return c.json({
    available: microsoftOAuthAvailable(c.env),
    connected: !!row,
    microsoft_email: row?.microsoft_email || null,
    last_synced_at: row?.last_synced_at || null,
    scope: row?.scope || null,
  });
}));

calendar.post('/microsoft/connect', safe('m_connect', 'Could not start Microsoft OAuth', async (c) => {
  const user = await requireAuth(c);
  if (!microsoftOAuthAvailable(c.env)) {
    return c.json({ detail: 'Microsoft OAuth not configured on server' }, 503);
  }
  const nonce = crypto.randomUUID().replace(/-/g, '');
  await persistState(c.env, nonce, user.id, 'microsoft');
  const state = await makeState(c.env, nonce);
  return c.json({ auth_url: buildMicrosoftAuthUrl(c.env, state) });
}));

calendar.get('/microsoft/callback', async (c) => {
  try {
    const url = new URL(c.req.url);
    const code = url.searchParams.get('code');
    const stateRaw = url.searchParams.get('state');
    const error = url.searchParams.get('error');
    if (error || !code || !stateRaw) return failureRedirect(c.env, 'microsoft', error || 'missing_params');
    const nonce = await verifyState(c.env, stateRaw);
    if (!nonce) return failureRedirect(c.env, 'microsoft', 'bad_state');
    const userId = await consumeState(c.env, nonce, 'microsoft');
    if (!userId) return failureRedirect(c.env, 'microsoft', 'expired_state');

    const tokens = await exchangeMicrosoftCode(c.env, code);
    const refreshToken = tokens?.refresh_token;
    if (!refreshToken) return failureRedirect(c.env, 'microsoft', 'no_refresh_token');
    const info = await fetchMicrosoftUserinfo(tokens.access_token || '');
    const email = info.mail || info.userPrincipalName || null;
    const subId = info.id || null;

    const sql = getSQL(c.env);
    const nowIso = new Date().toISOString();
    const existing = (await sql`SELECT id FROM microsoft_oauth_tokens WHERE user_id = ${userId}` as any[])[0];
    if (existing) {
      await sql`
        UPDATE microsoft_oauth_tokens
           SET refresh_token = ${refreshToken}, scope = ${tokens.scope || ''},
               microsoft_email = ${email}, microsoft_sub = ${subId},
               updated_at = ${nowIso}
         WHERE user_id = ${userId}
      `;
    } else {
      await sql`
        INSERT INTO microsoft_oauth_tokens
          (user_id, refresh_token, scope, microsoft_email, microsoft_sub)
        VALUES
          (${userId}, ${refreshToken}, ${tokens.scope || ''}, ${email}, ${subId})
      `;
    }
    return successRedirect(c.env, 'microsoft');
  } catch (e: any) {
    console.error('[CAL:m_callback]', e?.message || e);
    return failureRedirect(c.env, 'microsoft', 'token_exchange');
  }
});

calendar.delete('/microsoft', safe('m_disconnect', 'Could not disconnect Microsoft', async (c) => {
  const user = await requireAuth(c);
  const sql = getSQL(c.env);
  await sql`DELETE FROM microsoft_oauth_tokens WHERE user_id = ${user.id}`;
  await sql`DELETE FROM calendar_sync_records WHERE user_id = ${user.id} AND provider = 'microsoft'`;
  return c.json({ ok: true });
}));

calendar.post('/microsoft/sync', safe('m_sync', 'Microsoft sync failed', async (c) => {
  const user = await requireAuth(c);
  if (!microsoftOAuthAvailable(c.env)) {
    return c.json({ detail: 'Microsoft OAuth not configured on server' }, 503);
  }
  const url = new URL(c.req.url);
  const fromQ = url.searchParams.get('from');
  const toQ = url.searchParams.get('to');
  const fromDt = fromQ ? new Date(fromQ) : new Date(Date.now() - 86_400_000);
  const toDt = toQ ? new Date(toQ) : new Date(Date.now() + 60 * 86_400_000);
  try {
    return c.json(await syncUserToMicrosoft(c.env, user.id, lc(user.role), fromDt.toISOString(), toDt.toISOString()));
  } catch (e: any) {
    if (e?.message === 'not_connected') return c.json({ detail: 'Connect a Microsoft account first' }, 409);
    return c.json({ detail: `Microsoft sync failed: ${e?.message || e}` }, 502);
  }
}));

export default calendar;
