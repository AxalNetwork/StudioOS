/**
 * Calendar routes — port of backend/app/api/routes/calendar.py.
 *
 * Mounted at /api/calendar. Nineteen endpoints across:
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
  googleRedirectUri, microsoftRedirectUri,
  preflightOAuthSecrets,
} from '../services/calendar';
export { preflightOAuthSecrets };
import { encryptString } from '../services/cryptoBox';

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

// Lazy schema bootstrap — calendar.sql creates oauth_state_tokens with
// (state UNIQUE, user_id, provider CHECK, expires_at, created_at). On a
// prod DB where the table is missing entirely (or was created by the
// integrations/oauth.ts shape lacking `expires_at`), the INSERT below
// throws and `safe()` returns the generic "Could not start Google OAuth"
// string. Bootstrap the calendar shape once per isolate so the OAuth
// start handler is self-healing.
let _calendarOauthStateReady = false;
async function ensureCalendarOauthStateTable(env: Env): Promise<void> {
  if (_calendarOauthStateReady) return;
  try {
    await env.DB.exec(
      'CREATE TABLE IF NOT EXISTS oauth_state_tokens (' +
      'id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
      'state TEXT NOT NULL UNIQUE, ' +
      'user_id INTEGER NOT NULL, ' +
      'provider TEXT NOT NULL, ' +
      'expires_at TEXT NOT NULL, ' +
      "created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')))",
    );
    // Add expires_at if the table existed in the integrations/oauth.ts
    // shape (no expires_at column). Ignore "duplicate column" errors.
    try {
      await env.DB.exec("ALTER TABLE oauth_state_tokens ADD COLUMN expires_at TEXT NOT NULL DEFAULT ''");
    } catch { /* column already exists */ }
    _calendarOauthStateReady = true;
  } catch (e) {
    console.warn('[CAL:ensureOauthStateTable]', (e as Error).message);
  }
}

async function persistState(env: Env, nonce: string, userId: number, provider: 'google' | 'microsoft'): Promise<void> {
  await ensureCalendarOauthStateTable(env);
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
  // Task #52 — push to attendees' external calendars. All prep
  // (attendee lookup + event assembly + dynamic import) happens inside
  // the waitUntil closure so the IC-create response returns immediately.
  const meetingId = meeting.id;
  const meetingStart = meeting.start_at;
  const meetingTitle = meeting.title;
  const meetingLocKind = meeting.location_kind;
  const meetingLocUri = meeting.location_uri;
  const meetingAgenda = meeting.agenda;
  const endIso = new Date(startAt.getTime() + duration * 60_000).toISOString();
  const icSyncP = (async () => {
    try {
      const { onAxalSessionCreated } = await import('../services/calendar/sync');
      const att = await sql`
        SELECT u.email, u.name FROM ic_meeting_attendees a
        LEFT JOIN users u ON u.id = a.user_id WHERE a.meeting_id = ${meetingId}
      ` as any[];
      const me = (await sql`SELECT email, name FROM users WHERE id = ${user.id}` as any[])[0];
      const ev = {
        id: `ic_meeting:${meetingId}`, kind: 'ic_meeting' as const, source_id: meetingId,
        source_uid: uid, title: meetingTitle, start_at: meetingStart, end_at: endIso,
        status: 'confirmed', location_kind: meetingLocKind, location_uri: meetingLocUri,
        organizer_email: me?.email || null, notes: meetingAgenda || null,
        attendees: [
          { email: me?.email || null, name: me?.name || null, role: 'organizer' as const },
          ...att.filter((a: any) => a.email && a.email !== me?.email)
                .map((a: any) => ({ email: a.email, name: a.name, role: 'invitee' as const })),
        ],
      };
      await onAxalSessionCreated(c.env, ev);
    } catch (e) { console.warn('[calendar] IC sync hook failed', e); }
  })();
  if (c.executionCtx?.waitUntil) c.executionCtx.waitUntil(icSyncP);
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
  // Task #52 — remove from attendees' external calendars (deferred).
  const icCancelP = (async () => {
    try {
      const { onAxalSessionCancelled } = await import('../services/calendar/sync');
      await onAxalSessionCancelled(c.env, 'ic_meeting', id);
    } catch (e) { console.warn('[calendar] IC cancel sync hook failed', e); }
  })();
  if (c.executionCtx?.waitUntil) c.executionCtx.waitUntil(icCancelP);
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
  const checkin = r[0];
  // Task #52 — push founder check-in to attendees' external calendars
  // (deferred via waitUntil so the response returns immediately).
  const ckId = checkin.id;
  const ckStart = checkin.start_at;
  const ckLocKind = checkin.location_kind;
  const ckLocUri = checkin.location_uri;
  const ckNotes = body.notes || null;
  const ckEndIso = new Date(startAt.getTime() + duration * 60_000).toISOString();
  const ckSyncP = (async () => {
    try {
      const f = (await sql`SELECT email, name FROM users WHERE id = ${founderId}` as any[])[0];
      const co = counterId ? (await sql`SELECT email, name FROM users WHERE id = ${counterId}` as any[])[0] : null;
      const ev = {
        id: `founder_checkin:${ckId}`, kind: 'founder_checkin' as const, source_id: ckId,
        source_uid: uid, title, start_at: ckStart, end_at: ckEndIso,
        status: 'confirmed', location_kind: ckLocKind, location_uri: ckLocUri,
        organizer_email: co?.email || f?.email || null, notes: ckNotes,
        attendees: [
          { email: f?.email || null, name: f?.name || null, role: 'founder' as const },
          ...(co ? [{ email: co.email, name: co.name, role: 'counterpart' as const }] : []),
        ],
      };
      const { onAxalSessionCreated } = await import('../services/calendar/sync');
      await onAxalSessionCreated(c.env, ev);
    } catch (e) { console.warn('[calendar] checkin sync hook failed', e); }
  })();
  if (c.executionCtx?.waitUntil) c.executionCtx.waitUntil(ckSyncP);
  return c.json(await serializeCheckin(c.env, checkin));
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
  // Task #52 — remove from attendees' external calendars (deferred).
  const ckCancelP = (async () => {
    try {
      const { onAxalSessionCancelled } = await import('../services/calendar/sync');
      await onAxalSessionCancelled(c.env, 'founder_checkin', id);
    } catch (e) { console.warn('[calendar] checkin cancel sync hook failed', e); }
  })();
  if (c.executionCtx?.waitUntil) c.executionCtx.waitUntil(ckCancelP);
  return c.json({ ok: true });
}));

// ===========================================================================
// Task #52 — "Add to my external calendar" for events that pre-date the
// user's OAuth connection. POST /api/calendar/push/:kind/:source_id pushes
// one specific Axal session to whichever providers the caller has connected.
// ===========================================================================
const PUSHABLE_KINDS = new Set([
  'mentor_booking', 'ic_meeting', 'founder_checkin', 'partner_office_hour',
]);
calendar.post('/push/:kind/:source_id', safe('push_one', 'Could not push event', async (c) => {
  const user = await requireAuth(c);
  const kind = String(c.req.param('kind') || '');
  const sourceId = parseInt(c.req.param('source_id'), 10);
  if (!PUSHABLE_KINDS.has(kind)) return c.json({ detail: 'Unsupported kind' }, 400);
  if (!Number.isFinite(sourceId)) return c.json({ detail: 'invalid source_id' }, 400);
  const { fetchUserEvents } = await import('../services/calendar');
  // Window broad enough to find historic + future bookings.
  const from = new Date(Date.now() - 365 * 86400_000).toISOString();
  const to = new Date(Date.now() + 365 * 86400_000).toISOString();
  const events = await fetchUserEvents(c.env, user.id, user.role, from, to, [kind]);
  const ev = events.find(e => e.source_id === sourceId);
  if (!ev) return c.json({ detail: 'Event not found or not accessible' }, 404);
  const { pushOneEventForUser } = await import('../services/calendar/sync');
  const result = await pushOneEventForUser(c.env, user.id, ev);
  return c.json({ ok: true, pushed: result });
}));

// ===========================================================================
// Provider OAuth — generic helpers shared by Google + Microsoft routes.
// ===========================================================================
function failureRedirect(env: Env, provider: string, reason?: string): Response {
  const base = env.APP_URL || '';
  const url = `${base}/calendar?${provider}=error${reason ? `&reason=${encodeURIComponent(reason)}` : ''}`;
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
  const configured = googleOAuthAvailable(c.env);
  return c.json({
    configured,
    available: configured, // back-compat alias
    connected: configured ? !!row : false,
    google_email: row?.google_email || null,
    last_synced_at: row?.last_synced_at || null,
    scope: row?.scope || null,
  });
}));

/**
 * Task #35 — pure helper exposed for testing. Returns the JSON body +
 * HTTP status that `/google/start` should send. Side effect: persists the
 * OAuth state row when secrets are healthy. Split out of the Hono handler
 * so the regression test can drive it without booting the Hono app or
 * synthesising a JWT cookie.
 */
export async function buildGoogleOAuthStartResponse(
  env: Env,
  userId: number,
): Promise<{ status: 200 | 500; body: any }> {
  const missing = preflightOAuthSecrets(env, 'google');
  if (missing.length > 0) {
    return {
      status: 500,
      body: {
        error: {
          code: 'oauth_config_missing',
          message: `Google Calendar OAuth is not fully configured on the server. Missing: ${missing.join(', ')}.`,
          missing,
        },
      },
    };
  }
  const nonce = crypto.randomUUID().replace(/-/g, '');
  try {
    await persistState(env, nonce, userId, 'google');
    const state = await makeState(env, nonce);
    const url = buildGoogleAuthUrl(env, state);
    return { status: 200, body: { redirect_url: url, auth_url: url } };
  } catch (e: any) {
    console.error('[CAL:g_start] persistState/makeState failed:', e?.message, e?.stack || '');
    return {
      status: 500,
      body: {
        error: {
          code: 'oauth_state_error',
          message: `Could not start Google OAuth: ${e?.message || 'unknown error'}`,
        },
      },
    };
  }
}

export async function buildMicrosoftOAuthStartResponse(
  env: Env,
  userId: number,
): Promise<{ status: 200 | 500; body: any }> {
  const missing = preflightOAuthSecrets(env, 'microsoft');
  if (missing.length > 0) {
    return {
      status: 500,
      body: {
        error: {
          code: 'oauth_config_missing',
          message: `Outlook Calendar OAuth is not fully configured on the server. Missing: ${missing.join(', ')}.`,
          missing,
        },
      },
    };
  }
  const nonce = crypto.randomUUID().replace(/-/g, '');
  try {
    await persistState(env, nonce, userId, 'microsoft');
    const state = await makeState(env, nonce);
    const url = buildMicrosoftAuthUrl(env, state);
    return { status: 200, body: { redirect_url: url, auth_url: url } };
  } catch (e: any) {
    console.error('[CAL:ms_start] persistState/makeState failed:', e?.message, e?.stack || '');
    return {
      status: 500,
      body: {
        error: {
          code: 'oauth_state_error',
          message: `Could not start Outlook OAuth: ${e?.message || 'unknown error'}`,
        },
      },
    };
  }
}

async function startGoogleOAuth(c: any) {
  const user = await requireAuth(c);
  const { status, body } = await buildGoogleOAuthStartResponse(c.env, user.id);
  return c.json(body, status);
}
calendar.post('/google/connect', safe('g_connect', 'Could not start Google OAuth', startGoogleOAuth));
calendar.get('/google/start',    safe('g_start',   'Could not start Google OAuth', startGoogleOAuth));
calendar.post('/google/start',   safe('g_start',   'Could not start Google OAuth', startGoogleOAuth));

calendar.get('/google/callback', async (c) => {
  // Intentionally no requireAuth — the user_id comes from the state row.
  try {
    const url = new URL(c.req.url);
    const code = url.searchParams.get('code');
    const stateRaw = url.searchParams.get('state');
    const error = url.searchParams.get('error');
    if (error || !code || !stateRaw) return failureRedirect(c.env, 'google', error || 'invalid_state');
    const nonce = await verifyState(c.env, stateRaw);
    if (!nonce) return failureRedirect(c.env, 'google', 'invalid_state');
    const userId = await consumeState(c.env, nonce, 'google');
    if (!userId) return failureRedirect(c.env, 'google', 'invalid_state');

    const tokens = await exchangeGoogleCode(c.env, code);
    const refreshToken = tokens?.refresh_token;
    if (!refreshToken) return failureRedirect(c.env, 'google', 'no_refresh_token');
    const info = await fetchGoogleUserinfo(tokens.access_token || '');
    const refreshEnc = await encryptString(c.env, refreshToken);

    const sql = getSQL(c.env);
    const nowIso = new Date().toISOString();
    const existing = (await sql`SELECT id FROM google_oauth_tokens WHERE user_id = ${userId}` as any[])[0];
    if (existing) {
      await sql`
        UPDATE google_oauth_tokens
           SET refresh_token = ${refreshEnc}, scope = ${tokens.scope || ''},
               google_email = ${info.email || null}, google_sub = ${info.id || null},
               updated_at = ${nowIso}
         WHERE user_id = ${userId}
      `;
    } else {
      await sql`
        INSERT INTO google_oauth_tokens
          (user_id, refresh_token, scope, google_email, google_sub)
        VALUES
          (${userId}, ${refreshEnc}, ${tokens.scope || ''},
           ${info.email || null}, ${info.id || null})
      `;
    }
    return successRedirect(c.env, 'google');
  } catch (e: any) {
    const msg = String(e?.message || e);
    console.error('[CAL:g_callback]', msg);
    const m = msg.match(/^token_exchange_failed:(\d+):(.+)$/);
    const reason = m ? `token_exchange:${m[1]}:${m[2]}` : 'token_exchange';
    return failureRedirect(c.env, 'google', reason);
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
  const configured = microsoftOAuthAvailable(c.env);
  return c.json({
    configured,
    available: configured, // back-compat alias
    connected: configured ? !!row : false,
    microsoft_email: row?.microsoft_email || null,
    last_synced_at: row?.last_synced_at || null,
    scope: row?.scope || null,
  });
}));

async function startMicrosoftOAuth(c: any) {
  const user = await requireAuth(c);
  const { status, body } = await buildMicrosoftOAuthStartResponse(c.env, user.id);
  return c.json(body, status);
}
calendar.post('/microsoft/connect', safe('m_connect', 'Could not start Microsoft OAuth', startMicrosoftOAuth));
calendar.get('/microsoft/start',    safe('m_start',   'Could not start Microsoft OAuth', startMicrosoftOAuth));
calendar.post('/microsoft/start',   safe('m_start',   'Could not start Microsoft OAuth', startMicrosoftOAuth));
calendar.get('/outlook/start',      safe('o_start',   'Could not start Outlook OAuth',   startMicrosoftOAuth));
calendar.post('/outlook/start',     safe('o_start',   'Could not start Outlook OAuth',   startMicrosoftOAuth));

calendar.get('/microsoft/callback', async (c) => {
  try {
    const url = new URL(c.req.url);
    const code = url.searchParams.get('code');
    const stateRaw = url.searchParams.get('state');
    const error = url.searchParams.get('error');
    if (error || !code || !stateRaw) return failureRedirect(c.env, 'microsoft', error || 'invalid_state');
    const nonce = await verifyState(c.env, stateRaw);
    if (!nonce) return failureRedirect(c.env, 'microsoft', 'invalid_state');
    const userId = await consumeState(c.env, nonce, 'microsoft');
    if (!userId) return failureRedirect(c.env, 'microsoft', 'invalid_state');

    const tokens = await exchangeMicrosoftCode(c.env, code);
    const refreshToken = tokens?.refresh_token;
    if (!refreshToken) return failureRedirect(c.env, 'microsoft', 'no_refresh_token');
    const info = await fetchMicrosoftUserinfo(tokens.access_token || '');
    const email = info.mail || info.userPrincipalName || null;
    const subId = info.id || null;
    const refreshEnc = await encryptString(c.env, refreshToken);

    const sql = getSQL(c.env);
    const nowIso = new Date().toISOString();
    const existing = (await sql`SELECT id FROM microsoft_oauth_tokens WHERE user_id = ${userId}` as any[])[0];
    if (existing) {
      await sql`
        UPDATE microsoft_oauth_tokens
           SET refresh_token = ${refreshEnc}, scope = ${tokens.scope || ''},
               microsoft_email = ${email}, microsoft_sub = ${subId},
               updated_at = ${nowIso}
         WHERE user_id = ${userId}
      `;
    } else {
      await sql`
        INSERT INTO microsoft_oauth_tokens
          (user_id, refresh_token, scope, microsoft_email, microsoft_sub)
        VALUES
          (${userId}, ${refreshEnc}, ${tokens.scope || ''}, ${email}, ${subId})
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

// Task #1 (AG) — spec-contract aliases. Generic /events CRUD (separate from
// the /ic-meetings + /founder-checkins typed surfaces) writes to the same
// calendar_events table the GET /events read uses. Founders must own the row;
// admin/partner/investor may write any row attributed to them.
calendar.post('/events', async (c) => {
  const user = await requireAuth(c);
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const title = String(body?.title || '').trim();
  const startAt = String(body?.start_at || '').trim();
  const endAt = String(body?.end_at || startAt).trim();
  if (!title || !startAt) return c.json({ detail: 'title and start_at required' }, 400);
  const source = body?.source ? String(body.source).slice(0, 40) : 'manual';
  const kind = body?.kind ? String(body.kind).slice(0, 40) : 'other';
  const externalUri = `axal:manual:${crypto.randomUUID()}`;
  const r = await c.env.DB.prepare(
    `INSERT INTO calendar_events (user_id, source, kind, external_uri, title, start_at, end_at, status,
                                   notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, datetime('now'), datetime('now'))`,
  ).bind(user.id, source, kind, externalUri, title.slice(0, 240),
         startAt, endAt, body?.notes ? String(body.notes).slice(0, 4000) : null).run();
  return c.json({ id: r.meta.last_row_id, ok: true });
});

calendar.patch('/events/:id', async (c) => {
  const user = await requireAuth(c);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ detail: 'Invalid id' }, 400);
  const row = await c.env.DB.prepare('SELECT id, user_id FROM calendar_events WHERE id = ?')
    .bind(id).first<{ id: number; user_id: number }>();
  if (!row) return c.json({ detail: 'Event not found' }, 404);
  if (row.user_id !== user.id && user.role !== 'admin') return c.json({ detail: 'Forbidden' }, 403);
  const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
  const fields: string[] = [];
  const vals: (string | null)[] = [];
  for (const k of ['title', 'start_at', 'end_at', 'status', 'notes', 'location_uri'] as const) {
    if (body[k] !== undefined) {
      fields.push(`${k} = ?`);
      vals.push(body[k] == null ? null : String(body[k]).slice(0, 4000));
    }
  }
  if (!fields.length) return c.json({ ok: true });
  fields.push("updated_at = datetime('now')");
  await c.env.DB.prepare(`UPDATE calendar_events SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...vals, id).run();
  return c.json({ ok: true });
});

calendar.delete('/events/:id', async (c) => {
  const user = await requireAuth(c);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ detail: 'Invalid id' }, 400);
  const row = await c.env.DB.prepare('SELECT id, user_id FROM calendar_events WHERE id = ?')
    .bind(id).first<{ id: number; user_id: number }>();
  if (!row) return c.json({ detail: 'Event not found' }, 404);
  if (row.user_id !== user.id && user.role !== 'admin') return c.json({ detail: 'Forbidden' }, 403);
  await c.env.DB.prepare('DELETE FROM calendar_events WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

// POST aliases for the existing DELETE /google and /microsoft disconnects —
// both verbs are valid per the spec contract.
calendar.post('/google/disconnect', safe('g_disconnect_post', 'Could not disconnect Google', async (c) => {
  const user = await requireAuth(c);
  const sql = getSQL(c.env);
  await sql`DELETE FROM google_oauth_tokens WHERE user_id = ${user.id}`;
  await sql`DELETE FROM calendar_sync_records WHERE user_id = ${user.id} AND provider = 'google'`;
  return c.json({ ok: true });
}));
calendar.post('/microsoft/disconnect', safe('m_disconnect_post', 'Could not disconnect Microsoft', async (c) => {
  const user = await requireAuth(c);
  const sql = getSQL(c.env);
  await sql`DELETE FROM microsoft_oauth_tokens WHERE user_id = ${user.id}`;
  await sql`DELETE FROM calendar_sync_records WHERE user_id = ${user.id} AND provider = 'microsoft'`;
  return c.json({ ok: true });
}));

export default calendar;
